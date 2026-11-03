"""Persistência: histórico de sincronizações, favoritos, layouts e auditoria.

Mesmo código para os dois bancos:
  - PostgreSQL em produção (DATABASE_URL=postgresql://...), driver psycopg 3;
  - SQLite em desenvolvimento e testes (DATABASE_URL=sqlite:///caminho.db).
O SQL é escrito com '?' e convertido para '%s' no PostgreSQL. Datas são texto ISO 8601 UTC
('YYYY-MM-DDTHH:MM:SSZ'), que se ordena corretamente nos dois bancos.

Espaços de trabalho: o navegador gera um código aleatório; o servidor guarda apenas o
SHA-256 desse código. Não há nome, e-mail ou IP associados (ver docs/PRIVACIDADE.md).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

SCHEMA_VERSION = 1
WORKSPACE_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
FAVORITE_KINDS = {"nasa_image", "apod", "sky_object", "neo", "telescope"}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def workspace_hash(token: str) -> str:
    if not WORKSPACE_RE.match(token or ""):
        raise ValueError("código de espaço de trabalho inválido")
    return hashlib.sha256(token.encode()).hexdigest()


def _ddl(pg: bool) -> list[str]:
    pk = "BIGSERIAL PRIMARY KEY" if pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    return [
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
        f"""CREATE TABLE IF NOT EXISTS sync_history (
            id {pk}, source_id TEXT NOT NULL, cache_key TEXT NOT NULL, at TEXT NOT NULL,
            ok INTEGER NOT NULL, latency_ms REAL, items INTEGER, error TEXT)""",
        "CREATE INDEX IF NOT EXISTS ix_sync_source_at ON sync_history (source_id, at)",
        "CREATE INDEX IF NOT EXISTS ix_sync_at ON sync_history (at)",
        f"""CREATE TABLE IF NOT EXISTS favorites (
            id {pk}, workspace TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
            title TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL,
            UNIQUE (workspace, kind, ref))""",
        f"""CREATE TABLE IF NOT EXISTS layouts (
            id {pk}, workspace TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL,
            updated_at TEXT NOT NULL, UNIQUE (workspace, name))""",
        f"""CREATE TABLE IF NOT EXISTS audit_log (
            id {pk}, at TEXT NOT NULL, workspace TEXT, action TEXT NOT NULL, detail TEXT)""",
        "CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log (at)",
    ]


class Storage:
    def __init__(self, url: str):
        self.url = url
        self.pg = url.startswith(("postgres://", "postgresql://"))
        self._lock = threading.Lock()
        if self.pg:
            import psycopg  # noqa: F401 — falha cedo se o driver não estiver instalado
            self._sqlite_path = None
        else:
            path = url.removeprefix("sqlite:///") if url.startswith("sqlite:///") else url
            self._sqlite_path = path
            if path != ":memory:":
                Path(path).parent.mkdir(parents=True, exist_ok=True)
            # Uma conexão compartilhada (com trava) serve ':memory:' e cargas pequenas.
            self._sqlite = sqlite3.connect(path, check_same_thread=False)

    # ---------------------------------------------------------- infraestrutura
    @contextmanager
    def _cursor(self) -> Iterator[Any]:
        if self.pg:
            import psycopg
            with psycopg.connect(self.url, connect_timeout=10) as conn:
                with conn.cursor() as cur:
                    yield cur
                conn.commit()
        else:
            with self._lock:
                cur = self._sqlite.cursor()
                try:
                    yield cur
                    self._sqlite.commit()
                except Exception:
                    self._sqlite.rollback()
                    raise
                finally:
                    cur.close()

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.pg else sql

    def execute(self, sql: str, params: tuple = ()) -> int:
        with self._cursor() as cur:
            cur.execute(self._sql(sql), params)
            return cur.rowcount

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(self._sql(sql), params)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

    async def run(self, fn, *args):
        return await asyncio.to_thread(fn, *args)

    def migrate(self) -> None:
        with self._cursor() as cur:
            for stmt in _ddl(self.pg):
                cur.execute(stmt)
            cur.execute("SELECT version FROM schema_version")
            if cur.fetchone() is None:
                cur.execute(self._sql("INSERT INTO schema_version (version) VALUES (?)"), (SCHEMA_VERSION,))

    def ping(self) -> bool:
        return bool(self.query("SELECT 1 AS ok"))

    # ---------------------------------------------------------- sincronizações
    def record_sync(self, source_id: str, key: str, at: str, ok: bool, latency_ms: float | None,
                    items: int | None, error: str | None) -> None:
        self.execute("INSERT INTO sync_history (source_id, cache_key, at, ok, latency_ms, items, error) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?)",
                     (source_id, key, at, 1 if ok else 0, latency_ms, items, (error or None) and error[:500]))

    def sync_history(self, source_id: str | None, limit: int) -> list[dict]:
        if source_id:
            return self.query("SELECT source_id, cache_key, at, ok, latency_ms, items, error FROM sync_history "
                              "WHERE source_id = ? ORDER BY at DESC, id DESC LIMIT ?", (source_id, limit))
        return self.query("SELECT source_id, cache_key, at, ok, latency_ms, items, error FROM sync_history "
                          "ORDER BY at DESC, id DESC LIMIT ?", (limit,))

    def sync_summary(self, hours: int, now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        since = (now - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
        rows = self.query("SELECT source_id, at, ok, latency_ms, items FROM sync_history WHERE at >= ? ORDER BY at",
                          (since,))
        per: dict[str, dict] = {}
        buckets: dict[str, dict] = {}
        for r in rows:
            s = per.setdefault(r["source_id"], {"source_id": r["source_id"], "total": 0, "ok": 0, "lat": [],
                                                "items": 0, "last_failure_at": None})
            s["total"] += 1
            if r["ok"]:
                s["ok"] += 1
                s["items"] += r["items"] or 0
            else:
                s["last_failure_at"] = r["at"]
            if r["latency_ms"] is not None:
                s["lat"].append(r["latency_ms"])
            hour = r["at"][:13] + ":00:00Z"
            b = buckets.setdefault(hour, {"hour": hour, "ok": 0, "fail": 0})
            b["ok" if r["ok"] else "fail"] += 1
        sources = []
        for s in per.values():
            lat = sorted(s.pop("lat"))
            s["success_rate"] = round(s["ok"] / s["total"], 4) if s["total"] else None
            s["latency_p50_ms"] = _pct(lat, 0.5)
            s["latency_p95_ms"] = _pct(lat, 0.95)
            s["records_processed"] = s.pop("items")
            sources.append(s)
        return {"hours": hours, "since": since, "total_syncs": len(rows),
                "sources": sorted(sources, key=lambda s: s["source_id"]),
                "hourly": [buckets[k] for k in sorted(buckets)]}

    def purge_history(self, days: int) -> int:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        n = self.execute("DELETE FROM sync_history WHERE at < ?", (cutoff,))
        n += self.execute("DELETE FROM audit_log WHERE at < ?", (cutoff,))
        return n

    # ---------------------------------------------------------- favoritos
    def add_favorite(self, ws: str, kind: str, ref: str, title: str, data: dict) -> None:
        if kind not in FAVORITE_KINDS:
            raise ValueError(f"tipo de favorito desconhecido: {kind}")
        self.execute("INSERT INTO favorites (workspace, kind, ref, title, data, created_at) VALUES (?, ?, ?, ?, ?, ?) "
                     "ON CONFLICT (workspace, kind, ref) DO UPDATE SET title = excluded.title, data = excluded.data",
                     (ws, kind, ref, title, json.dumps(data, ensure_ascii=False), utc_now()))
        self.audit(ws, "favorite.add", f"{kind}:{ref}")

    def list_favorites(self, ws: str) -> list[dict]:
        rows = self.query("SELECT kind, ref, title, data, created_at FROM favorites WHERE workspace = ? "
                          "ORDER BY created_at DESC, id DESC", (ws,))
        for r in rows:
            r["data"] = json.loads(r["data"])
        return rows

    def remove_favorite(self, ws: str, kind: str, ref: str) -> bool:
        n = self.execute("DELETE FROM favorites WHERE workspace = ? AND kind = ? AND ref = ?", (ws, kind, ref))
        if n:
            self.audit(ws, "favorite.remove", f"{kind}:{ref}")
        return n > 0

    # ---------------------------------------------------------- layouts
    def save_layout(self, ws: str, name: str, data: dict) -> None:
        self.execute("INSERT INTO layouts (workspace, name, data, updated_at) VALUES (?, ?, ?, ?) "
                     "ON CONFLICT (workspace, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                     (ws, name, json.dumps(data, ensure_ascii=False), utc_now()))
        self.audit(ws, "layout.save", name)

    def list_layouts(self, ws: str) -> list[dict]:
        rows = self.query("SELECT name, data, updated_at FROM layouts WHERE workspace = ? ORDER BY updated_at DESC", (ws,))
        for r in rows:
            r["data"] = json.loads(r["data"])
        return rows

    def delete_layout(self, ws: str, name: str) -> bool:
        n = self.execute("DELETE FROM layouts WHERE workspace = ? AND name = ?", (ws, name))
        if n:
            self.audit(ws, "layout.delete", name)
        return n > 0

    def delete_workspace(self, ws: str) -> int:
        """Direito de eliminação (LGPD art. 18): apaga tudo do espaço de trabalho."""
        n = self.execute("DELETE FROM favorites WHERE workspace = ?", (ws,))
        n += self.execute("DELETE FROM layouts WHERE workspace = ?", (ws,))
        self.execute("DELETE FROM audit_log WHERE workspace = ?", (ws[:12],))
        self.audit(None, "workspace.delete", f"{n} registros removidos")
        return n

    # ---------------------------------------------------------- auditoria
    def audit(self, ws: str | None, action: str, detail: str | None = None) -> None:
        self.execute("INSERT INTO audit_log (at, workspace, action, detail) VALUES (?, ?, ?, ?)",
                     (utc_now(), ws[:12] if ws else None, action, (detail or "")[:300]))

    def audit_entries(self, limit: int) -> list[dict]:
        return self.query("SELECT at, workspace, action, detail FROM audit_log ORDER BY at DESC, id DESC LIMIT ?", (limit,))


def _pct(sorted_vals: list[float], q: float) -> float | None:
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, max(0, round(q * (len(sorted_vals) - 1))))
    return round(sorted_vals[idx], 1)
