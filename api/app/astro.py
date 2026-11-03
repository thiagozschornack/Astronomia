"""Cálculos astronômicos locais (algoritmos de Meeus, Astronomical Algorithms, 2ª ed.).

Simplificações declaradas (também expostas pela API):
- Coordenadas tratadas como J2000/ICRS, sem precessão nem nutação para o objeto:
  erro típico de 1 a 2 minutos nos horários de nascer/ocaso em 2026.
- Altitude geométrica (sem refração) para a posição instantânea; nascer e ocaso
  usam h0 = -0,5667° (refração padrão no horizonte).
- Sol em baixa precisão (Meeus cap. 25), erro ~0,01°.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

SIDEREAL_RATE = 360.98564736629  # graus de rotação da Terra por dia solar médio
SIDEREAL_DAY = 360.0 / SIDEREAL_RATE  # em dias
H0_STAR = -0.5667


def julian_day(dt: datetime) -> float:
    if dt.tzinfo is None:
        raise ValueError("datetime precisa de fuso horário")
    return dt.timestamp() / 86400.0 + 2440587.5


def gmst_deg(jd: float) -> float:
    """Tempo sideral médio de Greenwich em graus (Meeus 12.4)."""
    d = jd - 2451545.0
    t = d / 36525.0
    theta = 280.46061837 + SIDEREAL_RATE * d + 0.000387933 * t * t - t ** 3 / 38710000.0
    return theta % 360.0


def alt_az(ra: float, dec: float, lat: float, lon_east: float, when: datetime) -> tuple[float, float]:
    """Altitude e azimute (graus; azimute a partir do norte, sentido leste)."""
    lst = (gmst_deg(julian_day(when)) + lon_east) % 360.0
    h = math.radians((lst - ra) % 360.0)
    phi, delta = math.radians(lat), math.radians(dec)
    sin_alt = math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.cos(h)
    alt = math.asin(max(-1.0, min(1.0, sin_alt)))
    az = math.atan2(-math.cos(delta) * math.sin(h),
                    math.sin(delta) * math.cos(phi) - math.cos(delta) * math.sin(phi) * math.cos(h))
    return math.degrees(alt), math.degrees(az) % 360.0


def rise_transit_set(ra: float, dec: float, lat: float, lon_east: float,
                     start_utc: datetime, h0: float = H0_STAR) -> dict:
    """Nascer, culminação e ocaso de um objeto fixo nas 24 h a partir de start_utc."""
    th0 = gmst_deg(julian_day(start_utc))
    m0 = ((ra - lon_east - th0) % 360.0) / SIDEREAL_RATE
    transit = start_utc + timedelta(days=m0)
    max_alt = 90.0 - abs(lat - dec)
    phi, delta = math.radians(lat), math.radians(dec)
    cos_h0 = (math.sin(math.radians(h0)) - math.sin(phi) * math.sin(delta)) / (math.cos(phi) * math.cos(delta))
    result = {"transit_utc": transit, "max_altitude_deg": max_alt, "rise_utc": None, "set_utc": None}
    if cos_h0 < -1:
        result["visibility"] = "circumpolar"
        return result
    if cos_h0 > 1:
        result["visibility"] = "nunca_nasce"
        return result
    dm = math.degrees(math.acos(cos_h0)) / SIDEREAL_RATE
    rise = m0 - dm
    if rise < 0:
        rise += SIDEREAL_DAY
    set_ = m0 + dm
    if set_ >= 1.0:
        set_ -= SIDEREAL_DAY
    result.update(visibility="nasce_e_se_poe",
                  rise_utc=start_utc + timedelta(days=rise),
                  set_utc=start_utc + timedelta(days=set_))
    return result


def sun_radec(when: datetime) -> tuple[float, float]:
    """Ascensão reta e declinação aparentes do Sol (graus), baixa precisão."""
    t = (julian_day(when) - 2451545.0) / 36525.0
    l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
    m = math.radians(357.52911 + 35999.05029 * t - 0.0001537 * t * t)
    c = ((1.914602 - 0.004817 * t - 0.000014 * t * t) * math.sin(m)
         + (0.019993 - 0.000101 * t) * math.sin(2 * m) + 0.000289 * math.sin(3 * m))
    omega = math.radians(125.04 - 1934.136 * t)
    lam = math.radians(l0 + c - 0.00569 - 0.00478 * math.sin(omega))
    eps = math.radians(23.4392911 - 0.0130042 * t + 0.00256 * math.cos(omega))
    ra = math.degrees(math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))) % 360.0
    dec = math.degrees(math.asin(math.sin(eps) * math.sin(lam)))
    return ra, dec


def sky_condition(sun_alt: float) -> str:
    if sun_alt > -0.833:
        return "Dia (Sol acima do horizonte)"
    if sun_alt > -6:
        return "Crepúsculo civil"
    if sun_alt > -12:
        return "Crepúsculo náutico"
    if sun_alt > -18:
        return "Crepúsculo astronômico"
    return "Noite astronômica (céu escuro)"


def ensure_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc)
