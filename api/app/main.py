"""EmpreenderTHZ Astronomy Center — API (Etapa 3: Sistema Solar 3D, eventos e céu com planetas; aceita o app Android)."""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date as date_cls, datetime, time as dtime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import astro, ephemeris, parsers
from .config import settings
from .provenance import Registry, static_envelope
from .realtime import Broadcaster, Scheduler, sse_stream
from .sources import SPECS, Sources
from .storage import FAVORITE_KINDS, Storage, workspace_hash
from .telescopes import REVIEWED_AT, TELESCOPES

VERSION = "0.3.0"
log = logging.getLogger("astro")


def _schedule(app: FastAPI, sources: Sources) -> Scheduler:
    """Mantém as fontes aquecidas: cada tarefa roda logo após o vencimento do cache."""
    sch = Scheduler()
    jobs = [
        ("kp", 601, sources.kp), ("plasma", 121, sources.plasma), ("mag", 121, sources.mag),
        ("xray", 121, sources.xray), ("dst", 901, sources.dst), ("f107", 3601, sources.f107),
        ("sunspots", 21601, sources.sunspots), ("alerts", 301, sources.alerts),
        ("solar_imagery", 301, sources.solar_imagery), ("sentry", 3601, sources.sentry),
        ("neo_default", 3601, lambda: sources.close_approaches(30, 10)),
        ("exo_summary", 43201, sources.exo_summary), ("apod", 3601, lambda: sources.apod(None)),
    ]
    for i, (name, every_s, fn) in enumerate(jobs):
        sch.add(name, every_s, fn, start_delay_s=2 + i)  # escalonado para não disparar tudo junto
    storage: Storage = app.state.storage

    async def purge():
        n = await storage.run(storage.purge_history, settings.sync_history_days)
        log.info("retenção: %s registros antigos removidos", n)
    sch.add("retencao_historico", 86400, purge, start_delay_s=60)
    return sch


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = httpx.AsyncClient(timeout=settings.http_timeout_s, follow_redirects=True,
                               headers={"User-Agent": settings.user_agent})
    registry = Registry()
    for spec in SPECS:
        registry.register(spec)
    storage = Storage(settings.database_url)
    await storage.run(storage.migrate)
    broadcaster = Broadcaster()
    loop = asyncio.get_running_loop()

    def on_sync(ev: dict) -> None:
        loop.create_task(_persist(storage, ev))
        broadcaster.publish("sync", ev)

    registry.listeners.append(on_sync)
    app.state.registry = registry
    app.state.storage = storage
    app.state.broadcaster = broadcaster
    app.state.sources = Sources(registry, client)
    app.state.started_at = time.time()
    app.state.scheduler = _schedule(app, app.state.sources)
    if settings.scheduler_enabled:
        app.state.scheduler.start()
    try:
        yield
    finally:
        await app.state.scheduler.stop()
        await client.aclose()


async def _persist(storage: Storage, ev: dict) -> None:
    try:
        await storage.run(storage.record_sync, ev["source_id"], ev["key"], ev["at"], ev["ok"],
                          ev["latency_ms"], ev["items"], ev["error"])
    except Exception:  # noqa: BLE001 — falha do banco não interrompe a entrega dos dados
        log.exception("falha ao gravar histórico de sincronização")


app = FastAPI(title="EmpreenderTHZ Astronomy Center API", version=VERSION, lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json")

if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                       allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["*"])

_hits: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def guard(request: Request, call_next):
    if request.url.path.startswith("/api/") and settings.rate_limit_per_min > 0:
        ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "?")
        now = time.monotonic()
        q = _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= settings.rate_limit_per_min:
            return JSONResponse({"detail": "Limite de requisições atingido. Tente em 1 minuto."},
                                status_code=429, headers={"Retry-After": "60"})
        q.append(now)
        if len(_hits) > 5000:  # descarta IPs sem requisições no último minuto (nada fica retido)
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > 60]:
                _hits.pop(k, None)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return response


def reply(result: tuple[int, dict]) -> JSONResponse:
    status, body = result
    return JSONResponse(body, status_code=status)


def src(request: Request) -> Sources:
    return request.app.state.sources


# ------------------------------------------------------------ plataforma

@app.get("/api/health")
async def health(request: Request):
    storage: Storage = request.app.state.storage
    try:
        db_ok = await storage.run(storage.ping)
    except Exception:  # noqa: BLE001
        db_ok = False
    return JSONResponse({
        "status": "ok" if db_ok else "degraded", "version": VERSION,
        "uptime_s": round(time.time() - request.app.state.started_at),
        "database": {"engine": "postgresql" if storage.pg else "sqlite", "ok": db_ok},
        "scheduler": settings.scheduler_enabled,
        "stream_subscribers": request.app.state.broadcaster.subscribers,
    }, status_code=200 if db_ok else 503)


@app.get("/api/config")
async def config():
    return {
        "brand": {"name": "EmpreenderTHZ Astronomy Center", "logo_url": settings.brand_logo_url,
                  "slogan": "Explore o universo. Descubra o conhecimento."},
        "site": {"name": settings.default_site_name, "lat": settings.default_lat,
                 "lon": settings.default_lon, "tz": settings.default_tz},
        "nasa_demo_key": settings.using_demo_key,
        "version": VERSION,
    }


@app.get("/api/sources")
async def sources_status(request: Request):
    return {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sources": request.app.state.registry.status_report()}


# ------------------------------------------------------------ clima espacial

@app.get("/api/space-weather/kp")
async def kp(request: Request):
    return reply(await src(request).kp())


@app.get("/api/space-weather/solar-wind/plasma")
async def plasma(request: Request):
    return reply(await src(request).plasma())


@app.get("/api/space-weather/solar-wind/mag")
async def mag(request: Request):
    return reply(await src(request).mag())


@app.get("/api/space-weather/f107")
async def f107(request: Request):
    return reply(await src(request).f107())


@app.get("/api/space-weather/sunspots")
async def sunspots(request: Request):
    return reply(await src(request).sunspots())


@app.get("/api/space-weather/alerts")
async def alerts(request: Request):
    return reply(await src(request).alerts())


@app.get("/api/space-weather/xray")
async def xray(request: Request):
    return reply(await src(request).xray())


@app.get("/api/space-weather/dst")
async def dst(request: Request):
    status, env = await src(request).dst()
    if env.get("data"):
        env = {**env, "data": [{**r, "level": parsers.dst_level(r["dst"])} for r in env["data"]]}
    return JSONResponse(env, status_code=status)


@app.get("/api/solar/imagery")
async def solar_imagery(request: Request):
    return reply(await src(request).solar_imagery())


# ------------------------------------------------------------ objetos próximos

@app.get("/api/neo/close-approaches")
async def close_approaches(request: Request,
                           days: int = Query(30, ge=1, le=60),
                           dist_ld: int = Query(10, ge=1, le=100)):
    s = src(request)
    (status, cad), (_, sentry) = await asyncio.gather(s.close_approaches(days, dist_ld), s.sentry())
    if cad.get("data") is not None:
        risk_table = sentry.get("data") if sentry.get("status") in ("ok", "stale") else None
        rows = []
        for row in cad["data"]:
            row = dict(row)
            if risk_table is None:
                row["sentry"] = None
            else:
                hit = risk_table.get(str(row.get("designation") or "").strip())
                row["sentry"] = {"listed": hit is not None, **(hit or {})}
            rows.append(row)
        cad = {**cad, "data": rows}
    sentry_meta = {k: v for k, v in sentry.items() if k != "data"}
    return JSONResponse({**cad, "related": {"sentry": sentry_meta},
                         "query": {"days": days, "dist_ld": dist_ld}}, status_code=status)


# ------------------------------------------------------------ exoplanetas

@app.get("/api/exoplanets/summary")
async def exo_summary(request: Request):
    return reply(await src(request).exo_summary())


@app.get("/api/exoplanets/points")
async def exo_points(request: Request):
    return reply(await src(request).exo_points())


# ------------------------------------------------------------ imagens

@app.get("/api/images/apod")
async def apod(request: Request, date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    if date:
        d = date_cls.fromisoformat(date)
        if d < date_cls(1995, 6, 16) or d > datetime.now(timezone.utc).date():
            raise HTTPException(422, "A APOD existe de 1995-06-16 até hoje.")
    return reply(await src(request).apod(date))


@app.get("/api/images/search")
async def image_search(request: Request,
                       q: str = Query(..., min_length=2, max_length=100),
                       page: int = Query(1, ge=1, le=100),
                       year_start: int | None = Query(None, ge=1920, le=2100),
                       year_end: int | None = Query(None, ge=1920, le=2100)):
    return reply(await src(request).image_search(q.strip(), page, year_start, year_end))


# ------------------------------------------------------------ céu

@app.get("/api/sky/resolve")
async def resolve(request: Request, name: str = Query(..., min_length=1, max_length=80)):
    status, env = await src(request).resolve(name.strip())
    if env.get("data") and env["data"].get("not_found"):
        return JSONResponse({**env, "data": None, "status": "not_found",
                             "error": f"'{name}' não foi encontrado no SIMBAD, NED ou VizieR."},
                            status_code=404)
    return JSONResponse(env, status_code=status)


@app.get("/api/sky/visibility")
async def visibility(ra: float = Query(..., ge=0, lt=360), dec: float = Query(..., ge=-90, le=90),
                     lat: float = Query(settings.default_lat, ge=-90, le=90),
                     lon: float = Query(settings.default_lon, ge=-180, le=180),
                     tz: str = Query(settings.default_tz, max_length=64),
                     date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, f"Fuso horário desconhecido: {tz}")
    now = datetime.now(timezone.utc)
    day = date_cls.fromisoformat(date) if date else now.astimezone(zone).date()
    start = datetime.combine(day, dtime(0, 0), tzinfo=zone).astimezone(timezone.utc)
    rts = astro.rise_transit_set(ra, dec, lat, lon, start)
    alt, az = astro.alt_az(ra, dec, lat, lon, now)
    sun_ra, sun_dec = astro.sun_radec(now)
    sun_alt, _ = astro.alt_az(sun_ra, sun_dec, lat, lon, now)

    def local(dt):
        return dt.astimezone(zone).isoformat(timespec="minutes") if dt else None

    data = {
        "now_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "altitude_deg": round(alt, 2), "azimuth_deg": round(az, 2),
        "above_horizon": alt > 0,
        "sun_altitude_deg": round(sun_alt, 2), "sky_condition": astro.sky_condition(sun_alt),
        "date_local": day.isoformat(), "timezone": tz,
        "rise_local": local(rts["rise_utc"]), "transit_local": local(rts["transit_utc"]),
        "set_local": local(rts["set_utc"]),
        "max_altitude_deg": round(rts["max_altitude_deg"], 2), "visibility": rts["visibility"],
        "simplifications": [
            "Coordenadas J2000 sem precessão: horários com erro típico de 1 a 2 minutos.",
            "Altitude atual geométrica (sem refração); nascer e ocaso com refração padrão (h0 = −0,5667°).",
            "Sol, Lua e planetas se movem no céu: use o painel \"Sol, Lua e planetas agora\" (JPL Horizons).",
        ],
    }
    return static_envelope("calculation", "EmpreenderTHZ Astronomy Center",
                           "Cálculo astronômico local (algoritmos de J. Meeus)", data,
                           "Calculado a cada consulta")


# ------------------------------------------------------------ Sistema Solar (Etapa 3)

def _zone(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, f"Fuso horário desconhecido: {tz}")


def _day(date: str | None) -> datetime:
    day = date_cls.fromisoformat(date) if date else datetime.now(timezone.utc).date()
    if not (1950 <= day.year <= 2050):
        raise HTTPException(422, "Use datas entre 1950 e 2050 (validade dos elementos orbitais médios).")
    return datetime.combine(day, dtime(0, 0), tzinfo=timezone.utc)


def _body_meta(key: str) -> dict:
    name, code, radius, period, color = ephemeris.BODIES[key]
    return {"id": key, "name": name, "horizons_id": code, "radius_km": radius, "period_days": period, "color": color}


@app.get("/api/solar-system/positions")
async def solar_system_positions(request: Request,
                                 date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Posições heliocêntricas oficiais (JPL Horizons) para a data, 0 h UTC."""
    when = _day(date)
    status, env = await src(request).solar_system(when)
    if env.get("data"):
        earth = env["data"].get("earth")
        bodies = []
        for key, v in env["data"].items():
            r = (v["x"] ** 2 + v["y"] ** 2 + v["z"] ** 2) ** 0.5
            d_earth = None
            if earth and key != "earth":
                d_earth = ((v["x"] - earth["x"]) ** 2 + (v["y"] - earth["y"]) ** 2 + (v["z"] - earth["z"]) ** 2) ** 0.5
            bodies.append({**_body_meta(key), **v, "r_au": r, "earth_dist_au": d_earth,
                           "light_minutes_from_earth": d_earth * ephemeris.LIGHT_MIN_PER_AU if d_earth else None})
        env = {**env, "data": {"date": when.strftime("%Y-%m-%d"), "frame": "Heliocêntrico, eclíptica J2000 (ICRF), UA",
                               "bodies": bodies}}
    return JSONResponse(env, status_code=status)


@app.get("/api/solar-system/model")
async def solar_system_model(date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Elementos orbitais médios e órbitas desenhadas: base da animação (simulação)."""
    when = _day(date)
    jde = ephemeris.jd_tt(when)
    bodies = []
    for key in ephemeris.BODIES:
        base, rate = ephemeris.ELEMENTS[key]
        bodies.append({**_body_meta(key), "elements_j2000": base, "rates_per_century": rate,
                       "orbit": ephemeris.orbit_path(key, jde, 240 if key in ("pluto", "neptune", "uranus") else 180)})
    data = {"epoch": when.strftime("%Y-%m-%d"), "bodies": bodies,
            "element_order": ["a (UA)", "e", "i (°)", "L (°)", "ϖ (°)", "Ω (°)"],
            "simplifications": [
                "Elementos keplerianos médios (Standish, JPL), válidos de 1800 a 2050.",
                "Erro típico de minutos de arco para os planetas internos e até ~10' para os externos.",
                "Usados para desenhar órbitas e animar o tempo; as posições oficiais da data vêm do JPL Horizons.",
            ]}
    return static_envelope("simulation", "EmpreenderTHZ Astronomy Center a partir de elementos do NASA/JPL",
                           "Elementos orbitais médios dos planetas (E. M. Standish, JPL)", data,
                           "Calculado a cada consulta", "https://ssd.jpl.nasa.gov/planets/approx_pos.html")


@app.get("/api/sky/solar-system")
async def sky_solar_system(request: Request,
                           lat: float = Query(settings.default_lat, ge=-90, le=90),
                           lon: float = Query(settings.default_lon, ge=-180, le=180),
                           tz: str = Query(settings.default_tz, max_length=64)):
    """Sol, Lua e planetas agora: RA/Dec do JPL Horizons e altitude/azimute calculados no local."""
    zone = _zone(tz)
    now = datetime.now(timezone.utc)
    hour = now.replace(minute=0, second=0, microsecond=0)
    status, env = await src(request).sky_bodies(hour)
    if env.get("data"):
        illum, elong = ephemeris.moon_illumination(ephemeris.jd_tt(now))
        start = datetime.combine(now.astimezone(zone).date(), dtime(0, 0), tzinfo=zone).astimezone(timezone.utc)
        rows = []
        for key, v in env["data"].items():
            alt, az = astro.alt_az(v["ra"], v["dec"], lat, lon, now)
            h0 = -0.8333 if key == "sun" else 0.125 if key == "moon" else astro.H0_STAR
            rts = astro.rise_transit_set(v["ra"], v["dec"], lat, lon, start, h0)
            fmt = lambda d: d.astimezone(zone).isoformat(timespec="minutes") if d else None  # noqa: E731
            rows.append({"id": key, "name": ephemeris.NAMES[key], "ra": v["ra"], "dec": v["dec"],
                         "dist_au": v["dist_au"], "altitude_deg": round(alt, 2), "azimuth_deg": round(az, 2),
                         "above_horizon": alt > 0, "rise_local": fmt(rts["rise_utc"]),
                         "transit_local": fmt(rts["transit_utc"]), "set_local": fmt(rts["set_utc"]),
                         "visibility": rts["visibility"],
                         "color": ephemeris.BODIES[key][4] if key in ephemeris.BODIES else ("#FFD27A" if key == "sun" else "#DCE3F2")})
        phase = ("Lua nova" if illum < 0.03 else "Lua cheia" if illum > 0.97
                 else ("Crescente" if elong < 180 else "Minguante"))
        sun_alt = next(r["altitude_deg"] for r in rows if r["id"] == "sun")
        env = {**env, "data": {
            "computed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "site": {"lat": lat, "lon": lon, "tz": tz},
            "sky_condition": astro.sky_condition(sun_alt), "bodies": rows,
            "moon": {"illumination": round(illum, 3), "phase": phase, "waxing": elong < 180},
            "simplifications": [
                "RA/Dec geocêntricos do JPL Horizons no início da hora; altitude e azimute calculados para agora.",
                "Para a Lua, a posição vista do seu local pode diferir até ~1° (paralaxe).",
                "Nascer e ocaso com a posição do início do dia: erro de alguns minutos (até ~30 min para a Lua).",
            ]}}
    return JSONResponse(env, status_code=status)


# ------------------------------------------------------------ central de eventos (Etapa 3)

def _events(start: str | None, days: int, lat: float, lon: float, tz: str, types: str | None) -> tuple[list, dict]:
    zone = _zone(tz)
    if start:
        first = datetime.combine(date_cls.fromisoformat(start), dtime(0, 0), tzinfo=zone).astimezone(timezone.utc)
    else:
        first = datetime.combine(datetime.now(zone).date(), dtime(0, 0), tzinfo=zone).astimezone(timezone.utc)
    if not (1950 <= first.year <= 2049):
        raise HTTPException(422, "Use datas entre 1950 e 2049.")
    wanted = {t for t in (types or "").split(",") if t} or set(ephemeris.EVENT_TYPES)
    unknown = wanted - set(ephemeris.EVENT_TYPES)
    if unknown:
        raise HTTPException(422, f"Tipos de evento desconhecidos: {', '.join(sorted(unknown))}")
    events = [e for e in ephemeris.build_events(first, days, lat, lon, zone) if e["type"] in wanted]
    return events, {"start": first.strftime("%Y-%m-%dT%H:%M:%SZ"), "days": days, "types": sorted(wanted),
                    "site": {"lat": lat, "lon": lon, "tz": tz}}


@app.get("/api/events")
async def events(start: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
                 days: int = Query(90, ge=1, le=400),
                 lat: float = Query(settings.default_lat, ge=-90, le=90),
                 lon: float = Query(settings.default_lon, ge=-180, le=180),
                 tz: str = Query(settings.default_tz, max_length=64),
                 types: str | None = Query(None, max_length=200)):
    evs, query = await asyncio.to_thread(_events, start, days, lat, lon, tz, types)
    data = {"query": query, "type_labels": ephemeris.EVENT_TYPES, "events": evs,
            "simplifications": [
                "Fases da Lua e eclipses: algoritmos de J. Meeus (erro de poucos minutos).",
                "Oposições, conjunções e elongações: elementos orbitais médios do JPL (erro de até ~1 dia na data).",
                "Equinócios e solstícios: erro de até ~15 minutos.",
                "Chuvas de meteoros: máximo previsto pela longitude solar do calendário da IMO; a atividade real varia.",
                "A faixa de visibilidade dos eclipses solares não é calculada: consulte os mapas da NASA.",
            ]}
    return static_envelope("calculation", "EmpreenderTHZ Astronomy Center",
                           "Central de eventos astronômicos (cálculo local)", data,
                           "Calculado a cada consulta", "https://science.nasa.gov/eclipses/")


@app.get("/api/events.ics")
async def events_ics(start: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
                     days: int = Query(90, ge=1, le=400),
                     lat: float = Query(settings.default_lat, ge=-90, le=90),
                     lon: float = Query(settings.default_lon, ge=-180, le=180),
                     tz: str = Query(settings.default_tz, max_length=64),
                     types: str | None = Query(None, max_length=200),
                     alarm: int | None = Query(None, ge=5, le=10080),
                     only: str | None = Query(None, max_length=40, pattern=r"^[0-9TZ:-]+$")):
    """Calendário iCalendar (.ics) com os eventos, para importar no Google Agenda, Outlook ou celular."""
    evs, _ = await asyncio.to_thread(_events, start, days, lat, lon, tz, types)
    if only:
        evs = [e for e in evs if e["when"] == only]
    body = ephemeris.to_ics(evs, alarm)
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="eventos-astronomicos-empreenderthz.ics"'})


# ------------------------------------------------------------ telescópios

@app.get("/api/telescopes")
async def telescopes():
    return static_envelope("reference", "Curadoria EmpreenderTHZ a partir dos portais oficiais",
                           "Catálogo de telescópios e observatórios", TELESCOPES,
                           f"Revisado manualmente em {REVIEWED_AT}")


@app.get("/api/telescopes/{tid}")
async def telescope(tid: str):
    item = next((t for t in TELESCOPES if t["id"] == tid), None)
    if not item:
        raise HTTPException(404, "Telescópio não catalogado.")
    return static_envelope("reference", "Curadoria EmpreenderTHZ a partir dos portais oficiais",
                           item["name"], item, f"Revisado manualmente em {REVIEWED_AT}", item["portal"])


# ------------------------------------------------------------ tempo real e operação

@app.get("/api/stream")
async def stream(request: Request):
    """Server-Sent Events: um evento 'sync' a cada sincronização de fonte."""
    return StreamingResponse(sse_stream(request.app.state.broadcaster, is_disconnected=request.is_disconnected),
                             media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/sync-history")
async def sync_history(request: Request, source_id: str | None = Query(None, max_length=40),
                       limit: int = Query(100, ge=1, le=1000)):
    st: Storage = request.app.state.storage
    return {"items": await st.run(st.sync_history, source_id, limit)}


@app.get("/api/sync-history/summary")
async def sync_summary(request: Request, hours: int = Query(24, ge=1, le=24 * 30)):
    st: Storage = request.app.state.storage
    return await st.run(st.sync_summary, hours)


@app.get("/api/scheduler")
async def scheduler_status(request: Request):
    return {"enabled": settings.scheduler_enabled, "jobs": request.app.state.scheduler.status()}


# ------------------------------------------------------------ espaço de trabalho (favoritos e layouts)

def ws_of(token: str | None) -> str:
    try:
        return workspace_hash(token or "")
    except ValueError:
        raise HTTPException(400, "Cabeçalho X-Workspace ausente ou inválido (16 a 64 caracteres A–Z, a–z, 0–9, _ ou -).")


def _limit_json(data: dict, max_bytes: int) -> dict:
    if len(json.dumps(data, ensure_ascii=False).encode()) > max_bytes:
        raise HTTPException(413, f"Conteúdo maior que {max_bytes // 1024} KB.")
    return data


class FavoriteIn(BaseModel):
    kind: str = Field(..., max_length=20)
    ref: str = Field(..., min_length=1, max_length=200)
    title: str = Field(..., min_length=1, max_length=300)
    data: dict = Field(default_factory=dict)


class LayoutIn(BaseModel):
    data: dict


@app.get("/api/favorites")
async def favorites(request: Request, x_workspace: str | None = Header(None)):
    st: Storage = request.app.state.storage
    return {"items": await st.run(st.list_favorites, ws_of(x_workspace))}


@app.post("/api/favorites", status_code=201)
async def add_favorite(request: Request, fav: FavoriteIn, x_workspace: str | None = Header(None)):
    if fav.kind not in FAVORITE_KINDS:
        raise HTTPException(422, f"Tipo inválido. Use: {', '.join(sorted(FAVORITE_KINDS))}.")
    st: Storage = request.app.state.storage
    await st.run(st.add_favorite, ws_of(x_workspace), fav.kind, fav.ref, fav.title, _limit_json(fav.data, 20_000))
    return {"saved": True}


@app.delete("/api/favorites/{kind}/{ref:path}")
async def remove_favorite(request: Request, kind: str, ref: str, x_workspace: str | None = Header(None)):
    st: Storage = request.app.state.storage
    if not await st.run(st.remove_favorite, ws_of(x_workspace), kind, ref):
        raise HTTPException(404, "Favorito não encontrado.")
    return {"removed": True}


@app.get("/api/layouts")
async def layouts(request: Request, x_workspace: str | None = Header(None)):
    st: Storage = request.app.state.storage
    return {"items": await st.run(st.list_layouts, ws_of(x_workspace))}


@app.put("/api/layouts/{name}")
async def save_layout(request: Request, name: str, body: LayoutIn, x_workspace: str | None = Header(None)):
    name = name.strip()
    if not 1 <= len(name) <= 60:
        raise HTTPException(422, "O nome do layout deve ter de 1 a 60 caracteres.")
    st: Storage = request.app.state.storage
    await st.run(st.save_layout, ws_of(x_workspace), name, _limit_json(body.data, 50_000))
    return {"saved": True}


@app.delete("/api/layouts/{name}")
async def delete_layout(request: Request, name: str, x_workspace: str | None = Header(None)):
    st: Storage = request.app.state.storage
    if not await st.run(st.delete_layout, ws_of(x_workspace), name):
        raise HTTPException(404, "Layout não encontrado.")
    return {"removed": True}


@app.delete("/api/workspace")
async def delete_workspace(request: Request, x_workspace: str | None = Header(None)):
    st: Storage = request.app.state.storage
    return {"removed_records": await st.run(st.delete_workspace, ws_of(x_workspace))}


@app.get("/api/audit")
async def audit(request: Request, limit: int = Query(200, ge=1, le=2000),
                authorization: str | None = Header(None)):
    expected = f"Bearer {settings.admin_token}"
    if not settings.admin_token or not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(401, "Acesso restrito à administração (ADMIN_TOKEN).")
    st: Storage = request.app.state.storage
    return {"items": await st.run(st.audit_entries, limit)}


# ------------------------------------------------------------ frontend

if settings.frontend_dir.is_dir():
    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")
