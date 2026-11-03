"""Governança de dados: catálogo de fontes, cache com rastreabilidade e saúde operacional.

Todo dado entregue ao frontend sai dentro de um "envelope" que declara a fonte,
o tipo de conteúdo, o horário da observação e da sincronização e o estado.
Se a fonte falhar e não houver dado anterior, o envelope sai sem dados
(status "unavailable") — nunca com valores substitutos.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

CONTENT_TYPES = {
    "live": "Transmissão ao vivo confirmada",
    "near_real_time": "Quase tempo real",
    "periodic": "Atualização periódica",
    "daily": "Publicação diária",
    "archive": "Arquivo",
    "catalog": "Catálogo científico",
    "reference": "Referência institucional",
    "calculation": "Cálculo local",
    "simulation": "Simulação",
}


def iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class SourceSpec:
    id: str
    label: str
    institution: str
    url: str
    docs_url: str
    content_type: str
    ttl_s: int
    update_frequency: str
    latency_note: str
    license_note: str

    def public(self) -> dict:
        return {
            "id": self.id, "label": self.label, "institution": self.institution,
            "url": self.url, "docs_url": self.docs_url, "license": self.license_note,
        }


@dataclass
class SourceState:
    last_attempt_at: float | None = None
    last_success_at: float | None = None
    last_error: str | None = None
    last_error_at: float | None = None
    last_latency_ms: float | None = None
    ok_count: int = 0
    error_count: int = 0
    last_items: int | None = None


@dataclass
class CacheEntry:
    fetched_at: float
    observed_at: str | None
    data: Any


Fetcher = Callable[[], Awaitable[tuple[Any, str | None]]]


class Registry:
    def __init__(self, clock: Callable[[], float] = time.time):
        self.clock = clock
        self.specs: dict[str, SourceSpec] = {}
        self.states: dict[str, SourceState] = {}
        self.cache: dict[tuple[str, str], CacheEntry] = {}
        self.locks: dict[tuple[str, str], asyncio.Lock] = {}
        self.listeners: list[Callable[[dict], None]] = []

    def _emit(self, **event) -> None:
        """Avisa ouvintes (histórico persistente, SSE) sobre cada tentativa de sincronização."""
        for fn in self.listeners:
            try:
                fn(event)
            except Exception:  # noqa: BLE001 — ouvinte com defeito não derruba a consulta
                pass

    def register(self, spec: SourceSpec) -> None:
        if spec.content_type not in CONTENT_TYPES:
            raise ValueError(f"tipo de conteúdo desconhecido: {spec.content_type}")
        self.specs[spec.id] = spec
        self.states[spec.id] = SourceState()

    def _fresh(self, spec: SourceSpec, entry: CacheEntry | None) -> bool:
        return entry is not None and self.clock() - entry.fetched_at < spec.ttl_s

    async def get(self, source_id: str, fetcher: Fetcher, key: str = "default") -> tuple[int, dict]:
        spec = self.specs[source_id]
        ck = (source_id, key)
        if self._fresh(spec, self.cache.get(ck)):
            return 200, self.envelope(spec, self.cache[ck], "ok")
        lock = self.locks.setdefault(ck, asyncio.Lock())
        async with lock:
            entry = self.cache.get(ck)
            if self._fresh(spec, entry):
                return 200, self.envelope(spec, entry, "ok")
            state = self.states[source_id]
            state.last_attempt_at = self.clock()
            t0 = time.perf_counter()
            try:
                data, observed = await fetcher()
            except Exception as exc:  # noqa: BLE001 — qualquer falha da fonte é registrada
                state.error_count += 1
                state.last_error = f"{type(exc).__name__}: {exc}"[:300]
                state.last_error_at = self.clock()
                state.last_latency_ms = round((time.perf_counter() - t0) * 1000, 1)
                self._emit(source_id=source_id, key=key, at=iso(state.last_error_at), ok=False,
                           latency_ms=state.last_latency_ms, items=None, error=state.last_error,
                           observed_at=entry.observed_at if entry else None)
                if entry is not None:
                    return 200, self.envelope(spec, entry, "stale", state.last_error)
                return 503, self.envelope(spec, None, "unavailable", state.last_error)
            state.last_latency_ms = round((time.perf_counter() - t0) * 1000, 1)
            state.ok_count += 1
            state.last_success_at = self.clock()
            state.last_items = len(data) if isinstance(data, (list, dict)) else None
            entry = CacheEntry(self.clock(), observed, data)
            self.cache[ck] = entry
            self._emit(source_id=source_id, key=key, at=iso(state.last_success_at), ok=True,
                       latency_ms=state.last_latency_ms, items=state.last_items, error=None,
                       observed_at=observed)
            return 200, self.envelope(spec, entry, "ok")

    def envelope(self, spec: SourceSpec, entry: CacheEntry | None, status: str,
                 error: str | None = None) -> dict:
        return {
            "source": spec.public(),
            "content_type": spec.content_type,
            "content_label": CONTENT_TYPES[spec.content_type],
            "update_frequency": spec.update_frequency,
            "latency_note": spec.latency_note,
            "observed_at": entry.observed_at if entry else None,
            "fetched_at": iso(entry.fetched_at) if entry else None,
            "age_s": round(self.clock() - entry.fetched_at) if entry else None,
            "status": status,
            "error": error,
            "data": entry.data if entry else None,
        }

    def health(self, source_id: str) -> str:
        st = self.states[source_id]
        if st.last_attempt_at is None:
            return "idle"
        if st.last_success_at is None:
            return "down"
        if st.last_error_at and st.last_error_at > st.last_success_at:
            return "degraded"
        return "operational"

    def status_report(self) -> list[dict]:
        out = []
        for sid, spec in self.specs.items():
            st = self.states[sid]
            out.append({
                **spec.public(),
                "content_type": spec.content_type,
                "content_label": CONTENT_TYPES[spec.content_type],
                "update_frequency": spec.update_frequency,
                "cache_ttl_s": spec.ttl_s,
                "health": self.health(sid),
                "last_attempt_at": iso(st.last_attempt_at),
                "last_success_at": iso(st.last_success_at),
                "last_error": st.last_error,
                "last_error_at": iso(st.last_error_at),
                "last_latency_ms": st.last_latency_ms,
                "ok_count": st.ok_count,
                "error_count": st.error_count,
                "last_items": st.last_items,
            })
        return out


def static_envelope(content_type: str, institution: str, label: str, data: Any,
                    note: str, docs_url: str | None = None) -> dict:
    """Envelope para conteúdo que não vem de sincronização (referência, cálculo)."""
    return {
        "source": {"id": None, "label": label, "institution": institution,
                   "url": None, "docs_url": docs_url, "license": None},
        "content_type": content_type,
        "content_label": CONTENT_TYPES[content_type],
        "update_frequency": note,
        "latency_note": "Não se aplica",
        "observed_at": None,
        "fetched_at": None,
        "age_s": None,
        "status": "ok",
        "error": None,
        "data": data,
    }
