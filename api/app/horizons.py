"""JPL Horizons: consulta e leitura de tabelas de vetores (Etapa 3).

API: https://ssd.jpl.nasa.gov/api/horizons.api (documentação em https://ssd-api.jpl.nasa.gov/doc/horizons.html).
Usamos sempre EPHEM_TYPE=VECTORS em CSV, que traz X, Y, Z entre as marcas $$SOE e $$EOE:
- heliocêntrico eclíptico J2000 (CENTER=500@10, REF_PLANE=ECLIPTIC) para o Sistema Solar 3D;
- geocêntrico equatorial ICRF (CENTER=500@399, REF_PLANE=FRAME) para posições no céu (RA/Dec).
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta

API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"


class HorizonsError(ValueError):
    pass


def vector_params(command: str, center: str, plane: str, start: datetime) -> dict:
    stop = start + timedelta(hours=1)
    fmt = "%Y-%m-%d %H:%M"
    return {
        "format": "text",
        "COMMAND": f"'{command}'",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": f"'{center}'",
        "START_TIME": f"'{start.strftime(fmt)}'",
        "STOP_TIME": f"'{stop.strftime(fmt)}'",
        "STEP_SIZE": "'1h'",
        "VEC_TABLE": "1",
        "REF_SYSTEM": "ICRF",
        "REF_PLANE": plane,
        "OUT_UNITS": "AU-D",
        "CSV_FORMAT": "YES",
        "TIME_TYPE": "UT",
    }


def parse_vectors(text: str) -> dict:
    """Primeira linha entre $$SOE e $$EOE: instante e X, Y, Z (UA)."""
    if "$$SOE" not in text or "$$EOE" not in text:
        msg = next((ln.strip() for ln in text.splitlines() if "error" in ln.lower() or "no ephemeris" in ln.lower()), "")
        raise HorizonsError(f"Resposta do Horizons sem tabela de efemérides. {msg[:200]}".strip())
    body = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    for line in body.splitlines():
        cols = [c.strip() for c in line.split(",")]
        if len(cols) < 5 or not cols[0]:
            continue
        try:
            jd = float(cols[0])
            x, y, z = (float(cols[i]) for i in (2, 3, 4))
        except ValueError:
            continue
        if not all(math.isfinite(v) for v in (x, y, z)):
            continue
        return {"jd": jd, "calendar": cols[1].replace("A.D. ", ""), "x": x, "y": y, "z": z}
    raise HorizonsError("Tabela do Horizons sem linhas válidas.")


def radec_from_vector(x: float, y: float, z: float) -> tuple[float, float, float]:
    """Vetor equatorial (ICRF) → RA, Dec (graus) e distância (UA)."""
    r = math.sqrt(x * x + y * y + z * z)
    ra = math.degrees(math.atan2(y, x)) % 360.0
    dec = math.degrees(math.asin(z / r))
    return ra, dec, r
