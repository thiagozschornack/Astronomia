"""Conectores às fontes oficiais. Cada conector: busca HTTP + normalização (parsers)."""
from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import quote

import httpx

from . import ephemeris, horizons, parsers
from .config import settings
from .provenance import Registry, SourceSpec

NOAA_LICENSE = "Dados do governo dos EUA, domínio público; citar NOAA SWPC"
JPL_LICENSE = "Citar NASA/JPL Center for Near Earth Object Studies (CNEOS)"
HORIZONS_LICENSE = "Citar NASA/JPL Horizons (Giorgini et al.); uso livre"

SPECS: list[SourceSpec] = [
    SourceSpec("swpc_kp", "Índice Kp planetário", "NOAA Space Weather Prediction Center",
               "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
               "https://www.swpc.noaa.gov/products/planetary-k-index",
               "periodic", 600, "Valores de 3 em 3 horas",
               "O valor do intervalo em curso só fecha ao fim das 3 h", NOAA_LICENSE),
    SourceSpec("swpc_plasma", "Vento solar — plasma (L1)", "NOAA Space Weather Prediction Center",
               "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json",
               "https://www.swpc.noaa.gov/products/real-time-solar-wind",
               "near_real_time", 120, "Amostras de 1 minuto",
               "Medido no ponto L1, cerca de 1 h antes de alcançar a Terra; processamento de minutos",
               NOAA_LICENSE),
    SourceSpec("swpc_mag", "Vento solar — campo magnético (L1)", "NOAA Space Weather Prediction Center",
               "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
               "https://www.swpc.noaa.gov/products/real-time-solar-wind",
               "near_real_time", 120, "Amostras de 1 minuto",
               "Medido no ponto L1, cerca de 1 h antes de alcançar a Terra; processamento de minutos",
               NOAA_LICENSE),
    SourceSpec("swpc_f107", "Fluxo solar F10.7", "NOAA SWPC (medição do NRC Canadá, Penticton)",
               "https://services.swpc.noaa.gov/json/f107_cm_flux.json",
               "https://www.swpc.noaa.gov/phenomena/f107-cm-radio-emissions",
               "periodic", 3600, "Medições diárias", "Publicado horas após a medição", NOAA_LICENSE),
    SourceSpec("swpc_sunspots", "Número de manchas solares (mensal)",
               "NOAA SWPC (número de manchas: SILSO, Observatório Real da Bélgica)",
               "https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json",
               "https://www.swpc.noaa.gov/products/solar-cycle-progression",
               "archive", 21600, "Médias mensais", "O mês corrente entra após o fechamento", NOAA_LICENSE),
    SourceSpec("swpc_alerts", "Alertas e avisos de clima espacial", "NOAA Space Weather Prediction Center",
               "https://services.swpc.noaa.gov/products/alerts.json",
               "https://www.swpc.noaa.gov/products/alerts-watches-and-warnings",
               "periodic", 300, "Emitidos quando os limiares são atingidos",
               "Minutos após a detecção", NOAA_LICENSE),
    SourceSpec("swpc_xray", "Fluxo de raios X solar (GOES)", "NOAA SWPC — satélite GOES primário",
               "https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json",
               "https://www.swpc.noaa.gov/products/goes-x-ray-flux",
               "near_real_time", 120, "Amostras de 1 minuto",
               "Minutos de processamento; mede a radiação que chega à Terra em ~8 min", NOAA_LICENSE),
    SourceSpec("swpc_dst", "Índice Dst (Kyoto, via NOAA)", "WDC for Geomagnetism, Kyoto — distribuído pela NOAA SWPC",
               "https://services.swpc.noaa.gov/products/kyoto-dst.json",
               "https://wdc.kugi.kyoto-u.ac.jp/dst_realtime/index.html",
               "periodic", 900, "Valores horários (tempo real provisório)",
               "Valores provisórios; os definitivos são publicados por Kyoto meses depois",
               "Citar World Data Center for Geomagnetism, Kyoto"),
    SourceSpec("solar_imagery", "Imagens solares mais recentes", "NASA SDO e ESA/NASA SOHO",
               "https://sdo.gsfc.nasa.gov/assets/img/latest/", "https://sdo.gsfc.nasa.gov/data/",
               "periodic", 300, "Arquivos substituídos a cada poucos minutos a cada hora",
               "Horário mostrado é o da atualização do arquivo no servidor, não o instante exato da exposição",
               "Créditos: NASA/SDO e as equipes AIA e HMI; SOHO (ESA & NASA)"),
    SourceSpec("jpl_cad", "Aproximações de objetos próximos à Terra", "NASA/JPL CNEOS — SBDB Close-Approach API",
               "https://ssd-api.jpl.nasa.gov/cad.api", "https://ssd-api.jpl.nasa.gov/doc/cad.html",
               "periodic", 3600, "Órbitas recalculadas conforme novas observações",
               "Previsões; podem mudar com novas medições", JPL_LICENSE),
    SourceSpec("jpl_sentry", "Monitoramento de risco de impacto (Sentry)", "NASA/JPL CNEOS — Sentry",
               "https://ssd-api.jpl.nasa.gov/sentry.api", "https://ssd-api.jpl.nasa.gov/doc/sentry.html",
               "periodic", 3600, "Atualizado conforme novas órbitas", "Previsões probabilísticas",
               JPL_LICENSE),
    SourceSpec("exoplanet_archive", "NASA Exoplanet Archive (TAP)", "NASA Exoplanet Science Institute / Caltech-IPAC",
               "https://exoplanetarchive.ipac.caltech.edu/TAP/sync",
               "https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html",
               "catalog", 43200, "Atualizado periodicamente pelo arquivo",
               "Reflete publicações já incorporadas ao catálogo",
               "Agradecimento exigido: 'This research has made use of the NASA Exoplanet Archive'"),
    SourceSpec("nasa_apod", "Astronomy Picture of the Day", "NASA / APOD",
               "https://api.nasa.gov/planetary/apod", "https://apod.nasa.gov/apod/",
               "daily", 3600, "Uma publicação por dia",
               "Imagem selecionada; normalmente de arquivo, não é observação ao vivo",
               "Direitos variam por imagem; verificar o crédito de cada publicação"),
    SourceSpec("nasa_images", "NASA Image and Video Library", "NASA",
               "https://images-api.nasa.gov/search", "https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf",
               "archive", 3600, "Acervo atualizado pela NASA", "Imagens de arquivo",
               "Em geral sem direitos autorais da NASA; verificar créditos e as diretrizes de uso da NASA"),
    SourceSpec("jpl_horizons_3d", "Efemérides do Sistema Solar (heliocêntricas)", "NASA/JPL Solar System Dynamics — Horizons",
               "https://ssd.jpl.nasa.gov/api/horizons.api", "https://ssd.jpl.nasa.gov/horizons/",
               "catalog", 21600, "Posições calculadas pelo JPL para a data pedida (0 h UTC)",
               "Efeméride de alta precisão; não é observação", HORIZONS_LICENSE),
    SourceSpec("jpl_horizons_sky", "Posições no céu de Sol, Lua e planetas", "NASA/JPL Solar System Dynamics — Horizons",
               "https://ssd.jpl.nasa.gov/api/horizons.api", "https://ssd.jpl.nasa.gov/horizons/",
               "catalog", 3600, "Posições geocêntricas calculadas pelo JPL, renovadas a cada hora",
               "Efeméride de alta precisão; posição geocêntrica (a Lua pode diferir até ~1° do céu local)", HORIZONS_LICENSE),
    SourceSpec("cds_sesame", "Resolução de nomes (Sesame/SIMBAD)", "CDS Strasbourg — Sesame",
               "https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV", "https://cds.unistra.fr/cgi-bin/Sesame",
               "catalog", 86400, "Catálogo mantido pelo CDS", "Não se aplica",
               "Citar SIMBAD (Wenger et al. 2000) e CDS"),
]


SOLAR_IMAGES = [
    {"id": "aia193", "label": "SDO/AIA 193 Å", "institution": "NASA SDO",
     "url": "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0193.jpg",
     "description": "Coroa a ~1,2 milhão K; buracos coronais aparecem escuros"},
    {"id": "aia171", "label": "SDO/AIA 171 Å", "institution": "NASA SDO",
     "url": "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0171.jpg",
     "description": "Coroa calma e arcos magnéticos, ~600 mil K"},
    {"id": "aia304", "label": "SDO/AIA 304 Å", "institution": "NASA SDO",
     "url": "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0304.jpg",
     "description": "Cromosfera e região de transição, ~50 mil K; proeminências e filamentos"},
    {"id": "hmiic", "label": "SDO/HMI contínuo", "institution": "NASA SDO",
     "url": "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIIC.jpg",
     "description": "Fotosfera em luz visível: manchas solares"},
    {"id": "hmib", "label": "SDO/HMI magnetograma", "institution": "NASA SDO",
     "url": "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIB.jpg",
     "description": "Polaridade do campo magnético na fotosfera (branco e preto)"},
    {"id": "c2", "label": "SOHO/LASCO C2", "institution": "ESA/NASA SOHO",
     "url": "https://soho.nascom.nasa.gov/data/realtime/c2/1024/latest.jpg",
     "description": "Coroa externa de 2 a 6 raios solares; ejeções de massa coronal"},
    {"id": "c3", "label": "SOHO/LASCO C3", "institution": "ESA/NASA SOHO",
     "url": "https://soho.nascom.nasa.gov/data/realtime/c3/1024/latest.jpg",
     "description": "Coroa até ~30 raios solares; ejeções de massa coronal e cometas rasantes"},
]


class Sources:
    def __init__(self, registry: Registry, client: httpx.AsyncClient):
        self.registry = registry
        self.client = client
        self.spec = {s.id: s for s in SPECS}

    async def _json(self, url: str, params: dict | None = None) -> Any:
        r = await self.client.get(url, params=params)
        r.raise_for_status()
        return r.json()

    async def _series(self, sid: str, parser) -> tuple[int, dict]:
        async def fetch():
            rows = parser(await self._json(self.spec[sid].url))
            if not rows:
                raise ValueError("resposta sem registros válidos")
            return rows, rows[-1].get("time") or rows[-1].get("month")
        return await self.registry.get(sid, fetch)

    # -- clima espacial
    async def kp(self):
        return await self._series("swpc_kp", parsers.parse_kp)

    async def plasma(self):
        return await self._series("swpc_plasma", parsers.parse_plasma)

    async def mag(self):
        return await self._series("swpc_mag", parsers.parse_mag)

    async def f107(self):
        return await self._series("swpc_f107", parsers.parse_f107)

    async def sunspots(self):
        return await self._series("swpc_sunspots", parsers.parse_sunspots)

    async def alerts(self):
        async def fetch():
            rows = parsers.parse_alerts(await self._json(self.spec["swpc_alerts"].url))
            return rows, rows[0]["issued"] if rows else None
        return await self.registry.get("swpc_alerts", fetch)

    async def xray(self):
        return await self._series("swpc_xray", parsers.parse_xray)

    async def dst(self):
        return await self._series("swpc_dst", parsers.parse_dst)

    async def solar_imagery(self):
        async def head(img: dict) -> dict:
            try:
                r = await self.client.head(img["url"])
                r.raise_for_status()
                return {**img, "available": True, "updated_at": parsers.parse_http_date(r.headers.get("last-modified")),
                        "error": None}
            except Exception as exc:  # noqa: BLE001
                return {**img, "available": False, "updated_at": None, "error": f"{type(exc).__name__}: {exc}"[:200]}

        async def fetch():
            items = await asyncio.gather(*(head(i) for i in SOLAR_IMAGES))
            if not any(i["available"] for i in items):
                raise ConnectionError("nenhuma imagem solar respondeu")
            stamps = [i["updated_at"] for i in items if i["updated_at"]]
            return list(items), max(stamps) if stamps else None
        return await self.registry.get("solar_imagery", fetch)

    # -- objetos próximos à Terra
    async def close_approaches(self, days: int, dist_ld: int):
        async def fetch():
            payload = await self._json(self.spec["jpl_cad"].url, {
                "date-min": "now", "date-max": f"+{days}", "dist-max": f"{dist_ld}LD",
                "sort": "date", "diameter": "true", "fullname": "true",
            })
            return parsers.parse_cad(payload), None
        return await self.registry.get("jpl_cad", fetch, key=f"{days}:{dist_ld}")

    async def sentry(self):
        async def fetch():
            return parsers.parse_sentry(await self._json(self.spec["jpl_sentry"].url)), None
        return await self.registry.get("jpl_sentry", fetch)

    # -- exoplanetas
    async def _tap(self, query: str) -> list[dict]:
        payload = await self._json(self.spec["exoplanet_archive"].url, {"query": query, "format": "json"})
        return parsers.table_rows(payload)

    async def exo_summary(self):
        async def fetch():
            total, methods, toi = await asyncio.gather(
                self._tap("select count(*) as n from pscomppars"),
                self._tap("select discoverymethod, count(*) as n from pscomppars group by discoverymethod"),
                self._tap("select count(*) as n from toi where tfopwg_disp = 'PC'"),
            )
            confirmed = parsers.num(parsers.pick(total[0], "n")) if total else None
            if confirmed is None:
                raise ValueError("contagem de confirmados ausente")
            by_method = sorted(
                ({"method": parsers.pick(r, "discoverymethod"), "count": parsers.num(parsers.pick(r, "n"))}
                 for r in methods), key=lambda r: -(r["count"] or 0))
            return {
                "confirmed": int(confirmed),
                "by_method": by_method,
                "tess_candidates_pc": (int(parsers.num(parsers.pick(toi[0], "n")))
                                       if toi and parsers.num(parsers.pick(toi[0], "n")) is not None else None),
            }, None
        return await self.registry.get("exoplanet_archive", fetch, key="summary")

    async def exo_points(self):
        async def fetch():
            rows = await self._tap(
                "select pl_name, hostname, discoverymethod, disc_year, pl_rade, pl_bmasse, "
                "pl_orbper, sy_dist, pl_eqt from pscomppars")
            pts = parsers.parse_exo_points(rows)
            if not pts:
                raise ValueError("nenhum planeta com período e raio")
            return pts, None
        return await self.registry.get("exoplanet_archive", fetch, key="points")

    # -- imagens
    async def apod(self, date: str | None):
        async def fetch():
            params = {"api_key": settings.nasa_api_key, "thumbs": "true"}
            if date:
                params["date"] = date
            data = parsers.parse_apod(await self._json(self.spec["nasa_apod"].url, params))
            return data, data["date"]
        return await self.registry.get("nasa_apod", fetch, key=date or "today")

    async def image_search(self, q: str, page: int, year_start: int | None, year_end: int | None):
        async def fetch():
            params: dict[str, Any] = {"q": q, "media_type": "image", "page": page}
            if year_start:
                params["year_start"] = year_start
            if year_end:
                params["year_end"] = year_end
            return parsers.parse_nasa_images(await self._json(self.spec["nasa_images"].url, params)), None
        return await self.registry.get("nasa_images", fetch, key=f"{q.lower()}|{page}|{year_start}|{year_end}")

    # -- resolução de nomes
    async def resolve(self, name: str):
        async def fetch():
            r = await self.client.get(self.spec["cds_sesame"].url + "?" + quote(name))
            r.raise_for_status()
            found = parsers.parse_sesame(r.text)
            # Nome não encontrado é resposta válida da fonte, não falha de integração.
            return (found or {"not_found": True, "query": name}), None
        return await self.registry.get("cds_sesame", fetch, key=name.lower())

    # -- Sistema Solar (JPL Horizons, Etapa 3)
    async def _horizons_vector(self, command: str, center: str, plane: str, when) -> dict:
        r = await self.client.get(horizons.API_URL, params=horizons.vector_params(command, center, plane, when))
        r.raise_for_status()
        return horizons.parse_vectors(r.text)

    async def solar_system(self, when):
        """Posições heliocêntricas eclípticas (J2000, UA) dos planetas e de Plutão na data (0 h UTC)."""
        async def fetch():
            sem = asyncio.Semaphore(3)

            async def one(body):
                async with sem:
                    v = await self._horizons_vector(ephemeris.BODIES[body][1], "500@10", "ECLIPTIC", when)
                    return body, v
            got = dict(await asyncio.gather(*(one(b) for b in ephemeris.BODIES)))
            data = {b: {"x": v["x"], "y": v["y"], "z": v["z"], "jd": v["jd"]} for b, v in got.items()}
            return data, when.strftime("%Y-%m-%dT%H:%M:%SZ")
        return await self.registry.get("jpl_horizons_3d", fetch, key=when.strftime("%Y-%m-%d"))

    async def sky_bodies(self, when):
        """RA/Dec geocêntricos (ICRF) de Sol, Lua e planetas no início da hora indicada."""
        targets = {"sun": "10", "moon": "301", **{b: ephemeris.BODIES[b][1] for b in ephemeris.PLANETS}}

        async def fetch():
            sem = asyncio.Semaphore(3)

            async def one(body, cmd):
                async with sem:
                    v = await self._horizons_vector(cmd, "500@399", "FRAME", when)
                    ra, dec, dist = horizons.radec_from_vector(v["x"], v["y"], v["z"])
                    return body, {"ra": ra, "dec": dec, "dist_au": dist}
            got = dict(await asyncio.gather(*(one(b, c) for b, c in targets.items())))
            return got, when.strftime("%Y-%m-%dT%H:%M:%SZ")
        return await self.registry.get("jpl_horizons_sky", fetch, key=when.strftime("%Y-%m-%dT%H"))
