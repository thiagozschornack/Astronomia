"""Normalização das respostas das fontes oficiais.

Funções puras (somente biblioteca padrão), testáveis sem rede.
Regra central: nenhum valor é inventado. Campo ausente ou inválido vira None,
e registros sem os campos essenciais são descartados.
"""
from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any

AU_KM = 149_597_870.7
LD_KM = 384_399.0
LD_AU = LD_KM / AU_KM

_TIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M",
    "%Y-%b-%d %H:%M:%S",
    "%Y-%b-%d %H:%M",
    "%Y-%m-%d",
    "%Y-%m",
)


def num(value: Any) -> float | None:
    """Converte para float; valores de preenchimento de fontes científicas viram None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        f = float(value)
    else:
        s = str(value).strip()
        if s == "" or s.lower() in {"null", "nan", "none", "n/a"}:
            return None
        try:
            f = float(s)
        except ValueError:
            return None
    if math.isnan(f) or math.isinf(f) or abs(f) >= 1e30:
        return None
    return f


def parse_time(value: Any) -> str | None:
    """Converte carimbos de tempo variados para ISO 8601 UTC ('...Z')."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1]
    if s.endswith("+00:00"):
        s = s[:-6]
    for fmt in _TIME_FORMATS:
        try:
            dt = datetime.strptime(s, fmt)
        except ValueError:
            continue
        return dt.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return None


def table_rows(payload: Any) -> list[dict]:
    """Aceita os formatos tabulares usados pelas fontes e devolve lista de dicts.

    - lista de listas com cabeçalho na primeira linha (produtos NOAA SWPC)
    - lista de dicts (NOAA /json, NASA Exoplanet Archive TAP)
    - {"fields": [...], "data": [[...]]} (APIs JPL SSD)
    - {"metadata": [{"name": ...}], "data": [[...]]} (TAP em JSON)
    """
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        if isinstance(payload.get("fields"), list):
            names = [str(f) for f in payload["fields"]]
            return [dict(zip(names, r)) for r in payload["data"] if isinstance(r, list)]
        if isinstance(payload.get("metadata"), list):
            names = [str(m.get("name")) for m in payload["metadata"] if isinstance(m, dict)]
            return [dict(zip(names, r)) for r in payload["data"] if isinstance(r, list)]
        if payload["data"] and isinstance(payload["data"][0], dict):
            return payload["data"]
    if isinstance(payload, list) and payload:
        if isinstance(payload[0], list):
            header = [str(h) for h in payload[0]]
            return [dict(zip(header, r)) for r in payload[1:] if isinstance(r, list)]
        if isinstance(payload[0], dict):
            return [r for r in payload if isinstance(r, dict)]
    return []


def pick(row: dict, *keys: str) -> Any:
    """Primeiro campo presente entre as chaves (sem diferenciar maiúsculas)."""
    lower = {str(k).lower(): v for k, v in row.items()}
    for k in keys:
        if k in row:
            return row[k]
        if k.lower() in lower:
            return lower[k.lower()]
    return None


# ---------------------------------------------------------------- NOAA SWPC

def g_scale(kp: float | None) -> str | None:
    """Escala NOAA de tempestades geomagnéticas a partir do Kp."""
    if kp is None:
        return None
    for limit, label in ((9, "G5"), (8, "G4"), (7, "G3"), (6, "G2"), (5, "G1")):
        if kp >= limit:
            return label
    return "G0"


def _series(payload: Any, mapping: dict[str, tuple[str, ...]], time_keys=("time_tag",)) -> list[dict]:
    out: dict[str, dict] = {}
    for row in table_rows(payload):
        t = parse_time(pick(row, *time_keys))
        if t is None:
            continue
        rec = {"time": t}
        for field, keys in mapping.items():
            rec[field] = num(pick(row, *keys))
        if all(rec[f] is None for f in mapping):
            continue
        out[t] = rec
    return [out[k] for k in sorted(out)]


def parse_kp(payload: Any) -> list[dict]:
    rows = _series(payload, {"kp": ("Kp", "kp_index", "estimated_kp")})
    rows = [r for r in rows if r["kp"] is not None]
    for r in rows:
        r["g_scale"] = g_scale(r["kp"])
    return rows


def _active_only(payload: Any) -> Any:
    """Arquivos RTSW (desde abril/2026) misturam satélites; fica só o registro marcado como ativo.

    Formatos antigos, sem o campo "active", passam sem alteração.
    """
    rows = table_rows(payload)
    if rows and any("active" in r for r in rows):
        return [r for r in rows if r.get("active") in (True, 1, "true", "True")]
    return payload


def parse_plasma(payload: Any) -> list[dict]:
    return _series(_active_only(payload), {
        "density": ("proton_density", "density"),
        "speed": ("proton_speed", "speed"),
        "temperature": ("proton_temperature", "temperature"),
    })


def parse_mag(payload: Any) -> list[dict]:
    return _series(_active_only(payload), {"bz": ("bz_gsm",), "bt": ("bt",)})


def parse_f107(payload: Any) -> list[dict]:
    rows = _series(payload, {"flux": ("flux", "Flux")}, time_keys=("time_tag", "TimeStamp"))
    return [r for r in rows if r["flux"] is not None and r["flux"] > 0]


def parse_sunspots(payload: Any) -> list[dict]:
    out = []
    for row in table_rows(payload):
        t = parse_time(pick(row, "time-tag", "time_tag"))
        ssn = num(pick(row, "ssn"))
        f107 = num(pick(row, "f10.7"))
        if t is None:
            continue
        ssn = ssn if ssn is not None and ssn >= 0 else None
        f107 = f107 if f107 is not None and f107 > 0 else None
        if ssn is None and f107 is None:
            continue
        out.append({"month": t[:7], "ssn": ssn, "f107": f107})
    return sorted(out, key=lambda r: r["month"])


_ALERT_PREFIXES = ("ALERT:", "WARNING:", "WATCH:", "SUMMARY:", "EXTENDED WARNING:", "CANCEL")


def parse_alerts(payload: Any, limit: int = 30) -> list[dict]:
    out = []
    for row in table_rows(payload):
        issued = parse_time(pick(row, "issue_datetime"))
        message = str(pick(row, "message") or "").replace("\r", "")
        if not issued or not message.strip():
            continue
        lines = [ln.strip() for ln in message.split("\n") if ln.strip()]
        title = next((ln for ln in lines if ln.upper().startswith(_ALERT_PREFIXES)), lines[0])
        out.append({
            "id": pick(row, "product_id"),
            "issued": issued,
            "title": title[:160],
            "message": message.strip()[:2000],
        })
    out.sort(key=lambda r: r["issued"], reverse=True)
    return out[:limit]


# ---------------------------------------------------------------- JPL SSD

def diameter_range_from_h(h: float | None) -> tuple[float, float] | None:
    """Faixa de diâmetro (km) pela magnitude absoluta H, albedo 0,25 a 0,05."""
    if h is None:
        return None
    base = 10 ** (-h / 5)
    return (1329 / math.sqrt(0.25) * base, 1329 / math.sqrt(0.05) * base)


def parse_cad(payload: Any) -> list[dict]:
    out = []
    for row in table_rows(payload):
        when = parse_time(pick(row, "cd"))
        dist = num(pick(row, "dist"))
        if when is None or dist is None:
            continue
        h = num(pick(row, "h"))
        diameter = num(pick(row, "diameter"))
        rec = {
            "designation": pick(row, "des"),
            "name": (str(pick(row, "fullname") or pick(row, "des") or "")).strip(),
            "approach_utc": when,
            "time_uncertainty": pick(row, "t_sigma_f"),
            "dist_au": dist,
            "dist_ld": dist / LD_AU,
            "dist_km": dist * AU_KM,
            "dist_min_au": num(pick(row, "dist_min")),
            "dist_max_au": num(pick(row, "dist_max")),
            "v_rel_kms": num(pick(row, "v_rel")),
            "h_mag": h,
            "diameter_km": diameter,
            "diameter_sigma_km": num(pick(row, "diameter_sigma")),
            "diameter_basis": "medido" if diameter is not None else None,
            "diameter_range_km": None,
        }
        if diameter is None:
            rng = diameter_range_from_h(h)
            if rng:
                rec["diameter_range_km"] = [round(rng[0], 4), round(rng[1], 4)]
                rec["diameter_basis"] = "estimado pela magnitude H (albedo 0,05–0,25)"
        out.append(rec)
    return sorted(out, key=lambda r: r["approach_utc"])


def parse_sentry(payload: Any) -> dict[str, dict]:
    out = {}
    for row in table_rows(payload):
        des = pick(row, "des")
        if not des:
            continue
        out[str(des).strip()] = {
            "ps_cum": num(pick(row, "ps_cum")),
            "ts_max": pick(row, "ts_max"),
            "ip": num(pick(row, "ip")),
            "n_imp": pick(row, "n_imp"),
            "range": pick(row, "range"),
        }
    return out


# ---------------------------------------------------------------- NASA

def parse_apod(payload: Any) -> dict:
    if not isinstance(payload, dict) or not payload.get("title") or not payload.get("date"):
        raise ValueError("resposta APOD sem título ou data")
    return {
        "date": payload["date"],
        "title": payload["title"],
        "explanation": payload.get("explanation"),
        "media_type": payload.get("media_type"),
        "url": payload.get("url"),
        "hdurl": payload.get("hdurl"),
        "thumbnail_url": payload.get("thumbnail_url"),
        "copyright": (payload.get("copyright") or "").strip() or None,
        "page_url": "https://apod.nasa.gov/apod/ap{}.html".format(
            payload["date"][2:].replace("-", "")),
    }


def parse_nasa_images(payload: Any) -> dict:
    coll = (payload or {}).get("collection") or {}
    items = []
    for it in coll.get("items") or []:
        data = (it.get("data") or [{}])[0]
        nasa_id = data.get("nasa_id")
        if not nasa_id:
            continue
        preview = next((l.get("href") for l in it.get("links") or []
                        if l.get("rel") == "preview" and l.get("render") in (None, "image")), None)
        items.append({
            "nasa_id": nasa_id,
            "title": data.get("title"),
            "date_created": parse_time(data.get("date_created")),
            "center": data.get("center"),
            "description": (data.get("description") or "")[:1200] or None,
            "keywords": (data.get("keywords") or [])[:10],
            "creator": data.get("photographer") or data.get("secondary_creator"),
            "preview": preview,
            "page_url": f"https://images.nasa.gov/details/{nasa_id}",
        })
    total = ((coll.get("metadata") or {}).get("total_hits"))
    return {"total_hits": total, "items": items}


def parse_exo_points(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        per, rad = num(pick(r, "pl_orbper")), num(pick(r, "pl_rade"))
        if per is None or rad is None or per <= 0 or rad <= 0:
            continue
        out.append({
            "name": pick(r, "pl_name"),
            "host": pick(r, "hostname"),
            "method": pick(r, "discoverymethod"),
            "year": num(pick(r, "disc_year")),
            "period_d": per,
            "radius_re": rad,
            "mass_me": num(pick(r, "pl_bmasse")),
            "dist_pc": num(pick(r, "sy_dist")),
            "teq_k": num(pick(r, "pl_eqt")),
        })
    return out


# ---------------------------------------------------------------- CDS Sesame

def parse_sesame(xml_text: str) -> dict | None:
    """Resolve nome de objeto via resposta XML do serviço Sesame (CDS)."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None
    for resolver in root.iter("Resolver"):
        ra = num((resolver.findtext("jradeg") or "").strip())
        dec = num((resolver.findtext("jdedeg") or "").strip())
        if ra is None or dec is None:
            continue
        return {
            "name": (resolver.findtext("oname") or "").strip() or None,
            "otype": (resolver.findtext("otype") or "").strip() or None,
            "ra_deg": ra,
            "dec_deg": dec,
            "resolver": resolver.get("name"),
        }
    return None


# ---------------------------------------------------------------- Etapa 2: Sol

def flare_class(flux: float | None) -> str | None:
    """Classe de fulguração GOES pelo fluxo de raios X 0,1–0,8 nm (W/m²): A, B, C, M, X."""
    if flux is None or flux <= 0:
        return None
    for letter, base in (("X", 1e-4), ("M", 1e-5), ("C", 1e-6), ("B", 1e-7), ("A", 1e-8)):
        if flux >= base:
            return f"{letter}{flux / base:.1f}"
    return f"A{flux / 1e-8:.1f}"


def parse_xray(payload: Any) -> list[dict]:
    """GOES (NOAA /json/goes/primary/xrays-*.json): canais 0,05–0,4 nm (curto) e 0,1–0,8 nm (longo)."""
    out: dict[str, dict] = {}
    for row in table_rows(payload):
        t = parse_time(pick(row, "time_tag"))
        flux = num(pick(row, "flux"))
        energy = str(pick(row, "energy") or "")
        if t is None or flux is None or flux <= 0:
            continue
        rec = out.setdefault(t, {"time": t, "long": None, "short": None, "satellite": pick(row, "satellite")})
        if energy.startswith("0.1-0.8"):
            rec["long"] = flux
        elif energy.startswith("0.05-0.4"):
            rec["short"] = flux
    rows = [out[k] for k in sorted(out) if out[k]["long"] is not None or out[k]["short"] is not None]
    for r in rows:
        r["flare_class"] = flare_class(r["long"])
    return rows


def parse_dst(payload: Any) -> list[dict]:
    return [r for r in _series(payload, {"dst": ("dst",)}) if r["dst"] is not None]


def dst_level(dst: float | None) -> str | None:
    """Classificação usual da intensidade de tempestade pelo Dst (nT)."""
    if dst is None:
        return None
    if dst <= -250:
        return "Tempestade extrema"
    if dst <= -100:
        return "Tempestade intensa"
    if dst <= -50:
        return "Tempestade moderada"
    if dst <= -30:
        return "Tempestade fraca"
    return "Calmo"


def parse_http_date(value: str | None) -> str | None:
    """Cabeçalho Last-Modified (RFC 7231) para ISO UTC."""
    if not value:
        return None
    try:
        dt = datetime.strptime(value.strip(), "%a, %d %b %Y %H:%M:%S GMT")
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
