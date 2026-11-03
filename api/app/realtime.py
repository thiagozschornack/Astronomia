"""Atualização contínua: agendador de sincronizações e difusão de eventos (SSE)."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

log = logging.getLogger("astro.realtime")


class Broadcaster:
    """Distribui eventos para os navegadores conectados ao /api/stream."""

    def __init__(self, max_queue: int = 100):
        self._subs: set[asyncio.Queue] = set()
        self.max_queue = max_queue

    @property
    def subscribers(self) -> int:
        return len(self._subs)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(self.max_queue)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def publish(self, event: str, data: dict) -> None:
        msg = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        for q in list(self._subs):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:  # cliente lento: descarta e ele recarrega ao reconectar
                self._subs.discard(q)


async def sse_stream(b: Broadcaster, heartbeat_s: float = 25.0, is_disconnected=None):
    q = b.subscribe()
    try:
        yield "retry: 5000\n\n"
        while True:
            if is_disconnected and await is_disconnected():
                break
            try:
                yield await asyncio.wait_for(q.get(), timeout=heartbeat_s)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
    finally:
        b.unsubscribe(q)


@dataclass
class Job:
    name: str
    interval_s: float
    run: Callable[[], Awaitable[object]]
    next_at: float = 0.0
    runs: int = 0
    last_error: str | None = None


@dataclass
class Scheduler:
    """Executa cada tarefa no seu intervalo. Uma instância por implantação (um worker)."""
    jobs: list[Job] = field(default_factory=list)
    tick_s: float = 5.0
    clock: Callable[[], float] = time.monotonic
    _task: asyncio.Task | None = None

    def add(self, name: str, interval_s: float, run: Callable[[], Awaitable[object]], start_delay_s: float = 0) -> None:
        self.jobs.append(Job(name, interval_s, run, next_at=self.clock() + start_delay_s))

    async def run_due(self) -> list[str]:
        now = self.clock()
        due = [j for j in self.jobs if j.next_at <= now]
        for j in due:
            j.next_at = now + j.interval_s
        results = await asyncio.gather(*(j.run() for j in due), return_exceptions=True)
        for j, res in zip(due, results):
            j.runs += 1
            j.last_error = f"{type(res).__name__}: {res}" if isinstance(res, Exception) else None
            if j.last_error:
                log.warning("tarefa %s falhou: %s", j.name, j.last_error)
        return [j.name for j in due]

    async def _loop(self) -> None:
        while True:
            try:
                await self.run_due()
            except Exception:  # noqa: BLE001 — o laço nunca morre
                log.exception("erro no agendador")
            await asyncio.sleep(self.tick_s)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def status(self) -> list[dict]:
        now = self.clock()
        return [{"name": j.name, "interval_s": j.interval_s, "runs": j.runs,
                 "next_in_s": round(max(0, j.next_at - now)), "last_error": j.last_error} for j in self.jobs]
