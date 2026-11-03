"""Efemérides locais e central de eventos astronômicos (Etapa 3).

Tudo aqui é CÁLCULO LOCAL, sem rede, rotulado assim na API. As posições oficiais do Sistema Solar
vêm do JPL Horizons (horizons.py); este módulo serve para:
- desenhar órbitas e animar a simulação (elementos orbitais médios);
- encontrar eventos: fases da Lua, eclipses, estações, chuvas de meteoros, oposições,
  conjunções e elongações máximas.

Algoritmos e simplificações declaradas:
- Planetas: elementos keplerianos médios do JPL (E. M. Standish, "Approximate Positions of the
  Planets", válidos de 1800 a 2050). Erro típico de alguns minutos de arco para os planetas
  internos e até ~10' para Saturno; datas de oposição e conjunção com erro de até ~1 dia.
- Lua: Meeus, Astronomical Algorithms, cap. 47, com os termos principais (erro ~0,1°).
- Fases da Lua: Meeus cap. 49, com termos planetários (erro de poucos minutos).
- Eclipses: Meeus cap. 54 (tipo, instante do máximo e magnitude); a faixa de visibilidade de um
  eclipse solar não é calculada.
- Sol: Meeus cap. 25, baixa precisão (~0,01°): estações com erro de até ~15 minutos.
- ΔT (TT − UTC) fixo em 69 s, adequado para 2020–2030.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from . import astro

DELTA_T_S = 69.0
J2000 = 2451545.0
OBLIQUITY_J2000 = 23.4392911
D2R = math.pi / 180.0
AU_KM = 149_597_870.7
LIGHT_MIN_PER_AU = 8.316746


def jd_utc(dt: datetime) -> float:
    return astro.julian_day(dt)


def jd_tt(dt: datetime) -> float:
    return astro.julian_day(dt) + DELTA_T_S / 86400.0


def from_jd_tt(jde: float) -> datetime:
    """Instante UTC a partir de um JDE (tempo dinâmico)."""
    secs = (jde - 2440587.5) * 86400.0 - DELTA_T_S
    return datetime.fromtimestamp(round(secs), timezone.utc)


def norm360(x: float) -> float:
    return x % 360.0


def ang_diff(a: float, b: float) -> float:
    """Diferença a − b em graus, no intervalo (−180, 180]."""
    d = (a - b) % 360.0
    return d - 360.0 if d > 180.0 else d


# ================================================================ planetas (Standish)
# a [UA], e, I [°], L [°], ϖ [°], Ω [°] e as taxas por século juliano.
ELEMENTS = {
    "mercury": ((0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593),
                (0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081)),
    "venus": ((0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255),
              (0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418)),
    "earth": ((1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0),
              (0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0)),
    "mars": ((1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891),
             (0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343)),
    "jupiter": ((5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909),
                (-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106)),
    "saturn": ((9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448),
               (-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794)),
    "uranus": ((19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503),
               (-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589)),
    "neptune": ((30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574),
                (0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664)),
    "pluto": ((39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684),
              (-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482)),
}

BODIES = {
    # id, nome, código Horizons, raio médio (km), período orbital (dias), cor de exibição
    "mercury": ("Mercúrio", "199", 2439.7, 87.969, "#B7B2AA"),
    "venus": ("Vênus", "299", 6051.8, 224.701, "#E8D29A"),
    "earth": ("Terra", "399", 6371.0, 365.256, "#5FA8FF"),
    "mars": ("Marte", "499", 3389.5, 686.980, "#E0704B"),
    "jupiter": ("Júpiter", "599", 69911.0, 4332.59, "#D9B38C"),
    "saturn": ("Saturno", "699", 58232.0, 10759.22, "#E6CF8B"),
    "uranus": ("Urano", "799", 25362.0, 30688.5, "#8FD8E0"),
    "neptune": ("Netuno", "899", 24622.0, 60182.0, "#5C7CFA"),
    "pluto": ("Plutão (planeta anão)", "999", 1188.3, 90560.0, "#B39C8A"),
}
PLANETS = [k for k in BODIES if k not in ("earth", "pluto")]
NAMES = {k: v[0] for k, v in BODIES.items()} | {"sun": "Sol", "moon": "Lua"}


def elements_at(body: str, jde: float) -> dict:
    base, rate = ELEMENTS[body]
    t = (jde - J2000) / 36525.0
    a, e, inc, mean_lon, peri, node = (b + r * t for b, r in zip(base, rate))
    return {"a": a, "e": e, "i": inc, "L": mean_lon, "varpi": peri, "node": node}


def solve_kepler(m_deg: float, e: float) -> float:
    """Anomalia excêntrica (graus) pela iteração de Newton."""
    m = math.radians((m_deg + 180.0) % 360.0 - 180.0)
    ea = m + e * math.sin(m)
    for _ in range(30):
        d = (ea - e * math.sin(ea) - m) / (1 - e * math.cos(ea))
        ea -= d
        if abs(d) < 1e-12:
            break
    return math.degrees(ea)


def _orbit_xyz(el: dict, ecc_anom_deg: float) -> tuple[float, float, float]:
    a, e = el["a"], el["e"]
    ea = math.radians(ecc_anom_deg)
    xp = a * (math.cos(ea) - e)
    yp = a * math.sqrt(1 - e * e) * math.sin(ea)
    w = math.radians(el["varpi"] - el["node"])
    o = math.radians(el["node"])
    i = math.radians(el["i"])
    cw, sw, co, so, ci, si = math.cos(w), math.sin(w), math.cos(o), math.sin(o), math.cos(i), math.sin(i)
    x = (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp
    y = (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp
    z = (sw * si) * xp + (cw * si) * yp
    return x, y, z


def heliocentric(body: str, jde: float) -> tuple[float, float, float]:
    """Posição heliocêntrica eclíptica J2000 (UA)."""
    el = elements_at(body, jde)
    return _orbit_xyz(el, solve_kepler(el["L"] - el["varpi"], el["e"]))


def orbit_path(body: str, jde: float, points: int = 180) -> list[list[float]]:
    el = elements_at(body, jde)
    return [[round(c, 5) for c in _orbit_xyz(el, 360.0 * k / points)] for k in range(points + 1)]


def ecl_to_eq(lon: float, lat: float, eps: float = OBLIQUITY_J2000) -> tuple[float, float]:
    """Eclíptica → equatorial (graus)."""
    l, b, e = lon * D2R, lat * D2R, eps * D2R
    ra = math.atan2(math.sin(l) * math.cos(e) - math.tan(b) * math.sin(e), math.cos(l))
    dec = math.asin(math.sin(b) * math.cos(e) + math.cos(b) * math.sin(e) * math.sin(l))
    return norm360(math.degrees(ra)), math.degrees(dec)


def geocentric(body: str, jde: float) -> dict:
    """Posição geocêntrica de um planeta: longitude/latitude eclípticas J2000, RA/Dec J2000, distância."""
    px, py, pz = heliocentric(body, jde)
    ex, ey, ez = heliocentric("earth", jde)
    dx, dy, dz = px - ex, py - ey, pz - ez
    # correção de tempo-luz (uma iteração basta)
    dist = math.sqrt(dx * dx + dy * dy + dz * dz)
    px, py, pz = heliocentric(body, jde - dist * LIGHT_MIN_PER_AU / 1440.0)
    dx, dy, dz = px - ex, py - ey, pz - ez
    dist = math.sqrt(dx * dx + dy * dy + dz * dz)
    lon = norm360(math.degrees(math.atan2(dy, dx)))
    lat = math.degrees(math.asin(dz / dist))
    ra, dec = ecl_to_eq(lon, lat)
    return {"lon": lon, "lat": lat, "ra": ra, "dec": dec, "dist_au": dist,
            "r_sun_au": math.sqrt(px * px + py * py + pz * pz)}


def sun_geocentric(jde: float) -> dict:
    """Sol geocêntrico no mesmo referencial (eclíptica J2000) dos planetas."""
    ex, ey, ez = heliocentric("earth", jde)
    dist = math.sqrt(ex * ex + ey * ey + ez * ez)
    lon = norm360(math.degrees(math.atan2(-ey, -ex)))
    lat = math.degrees(math.asin(-ez / dist))
    ra, dec = ecl_to_eq(lon, lat)
    return {"lon": lon, "lat": lat, "ra": ra, "dec": dec, "dist_au": dist}


def sun_apparent_longitude(jde: float) -> float:
    """Longitude aparente do Sol, equinócio da data (Meeus cap. 25, baixa precisão)."""
    t = (jde - J2000) / 36525.0
    l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
    m = math.radians(357.52911 + 35999.05029 * t - 0.0001537 * t * t)
    c = ((1.914602 - 0.004817 * t - 0.000014 * t * t) * math.sin(m)
         + (0.019993 - 0.000101 * t) * math.sin(2 * m) + 0.000289 * math.sin(3 * m))
    omega = math.radians(125.04 - 1934.136 * t)
    return norm360(l0 + c - 0.00569 - 0.00478 * math.sin(omega))


def precession_lon(jde: float) -> float:
    """Precessão geral em longitude desde J2000 (graus), aproximação linear."""
    return 1.396971 * (jde - J2000) / 36525.0


# ================================================================ Lua (Meeus 47, termos principais)
_LR = [  # D, M, M', F, Σl (1e-6 °), Σr (1e-3 km)
    (0, 0, 1, 0, 6288774, -20905355), (2, 0, -1, 0, 1274027, -3699111), (2, 0, 0, 0, 658314, -2955968),
    (0, 0, 2, 0, 213618, -569925), (0, 1, 0, 0, -185116, 48888), (0, 0, 0, 2, -114332, -3149),
    (2, 0, -2, 0, 58793, 246158), (2, -1, -1, 0, 57066, -152138), (2, 0, 1, 0, 53322, -170733),
    (2, -1, 0, 0, 45758, -204586), (0, 1, -1, 0, -40923, -129620), (1, 0, 0, 0, -34720, 108743),
    (0, 1, 1, 0, -30383, 104755), (2, 0, 0, -2, 15327, 10321), (0, 0, 1, 2, -12528, 0),
    (0, 0, 1, -2, 10980, 79661), (4, 0, -1, 0, 10675, -34782), (0, 0, 3, 0, 10034, -23210),
    (4, 0, -2, 0, 8548, -21636), (2, 1, -1, 0, -7888, 24208), (2, 1, 0, 0, -6766, 30824),
    (1, 0, -1, 0, -5163, -8379), (1, 1, 0, 0, 4987, -16675), (2, -1, 1, 0, 4036, -12831),
    (2, 0, 2, 0, 3994, -10445), (4, 0, 0, 0, 3861, -11650), (2, 0, -3, 0, 3665, 14403),
    (0, 1, -2, 0, -2689, -7003), (2, 0, -1, 2, -2602, 0), (2, -1, -2, 0, 2390, 10056),
    (1, 0, 1, 0, -2348, 6322), (2, -2, 0, 0, 2236, -9884), (0, 1, 2, 0, -2120, 5751),
    (0, 2, 0, 0, -2069, 0),
]
_B = [  # D, M, M', F, Σb (1e-6 °)
    (0, 0, 0, 1, 5128122), (0, 0, 1, 1, 280602), (0, 0, 1, -1, 277693), (2, 0, 0, -1, 173237),
    (2, 0, -1, 1, 55413), (2, 0, -1, -1, 46271), (2, 0, 0, 1, 32573), (0, 0, 2, 1, 17198),
    (2, 0, 1, -1, 9266), (0, 0, 2, -1, 8822), (2, -1, 0, -1, 8216), (2, 0, -2, -1, 4324),
    (2, 0, 1, 1, 4200), (2, 1, 0, -1, -3359), (2, -1, -1, 1, 2463), (2, -1, 0, 1, 2211),
    (2, -1, -1, -1, 2065), (0, 1, -1, -1, -1870), (4, 0, -1, -1, 1828), (0, 1, 0, 1, -1794),
    (0, 0, 0, 3, -1749), (0, 1, -1, 1, -1565), (1, 0, 0, 1, -1491), (0, 1, 1, 1, -1475),
    (0, 1, 1, -1, -1410), (0, 1, 0, -1, -1344), (1, 0, 0, -1, -1335), (0, 0, 3, 1, 1107),
    (4, 0, 0, -1, 1021), (4, 0, -1, 1, 833),
]


def moon_geocentric(jde: float) -> dict:
    """Lua geocêntrica: longitude/latitude (J2000), RA/Dec J2000, distância (km)."""
    t = (jde - J2000) / 36525.0
    lp = 218.3164477 + 481267.88123421 * t - 0.0015786 * t * t
    d = 297.8501921 + 445267.1114034 * t - 0.0018819 * t * t
    m = 357.5291092 + 35999.0502909 * t - 0.0001536 * t * t
    mp = 134.9633964 + 477198.8675055 * t + 0.0087414 * t * t
    f = 93.2720950 + 483202.0175233 * t - 0.0036539 * t * t
    a1 = 119.75 + 131.849 * t
    a2 = 53.09 + 479264.290 * t
    a3 = 313.45 + 481266.484 * t
    e = 1 - 0.002516 * t - 0.0000074 * t * t
    sl = sr = sb = 0.0
    for cd, cm, cmp_, cf, kl, kr in _LR:
        arg = math.radians(cd * d + cm * m + cmp_ * mp + cf * f)
        fac = e ** abs(cm)
        sl += kl * fac * math.sin(arg)
        sr += kr * fac * math.cos(arg)
    for cd, cm, cmp_, cf, kb in _B:
        arg = math.radians(cd * d + cm * m + cmp_ * mp + cf * f)
        sb += kb * (e ** abs(cm)) * math.sin(arg)
    sl += 3958 * math.sin(math.radians(a1)) + 1962 * math.sin(math.radians(lp - f)) + 318 * math.sin(math.radians(a2))
    sb += (-2235 * math.sin(math.radians(lp)) + 382 * math.sin(math.radians(a3))
           + 175 * math.sin(math.radians(a1 - f)) + 175 * math.sin(math.radians(a1 + f))
           + 127 * math.sin(math.radians(lp - mp)) - 115 * math.sin(math.radians(lp + mp)))
    lon_date = norm360(lp + sl / 1e6)
    lat = sb / 1e6
    lon = norm360(lon_date - precession_lon(jde))
    ra, dec = ecl_to_eq(lon, lat)
    return {"lon": lon, "lat": lat, "lon_of_date": lon_date, "ra": ra, "dec": dec,
            "dist_km": 385000.56 + sr / 1000.0}


def moon_illumination(jde: float) -> tuple[float, float]:
    """Fração iluminada (0–1) e elongação Lua–Sol (graus, 0–360, crescente de 0 a 180)."""
    moon = moon_geocentric(jde)
    sun = sun_geocentric(jde)
    elong = norm360(moon["lon"] - sun["lon"])
    cos_psi = (math.cos(math.radians(moon["lat"])) * math.cos(math.radians(moon["lon"] - sun["lon"])))
    psi = math.acos(max(-1.0, min(1.0, cos_psi)))
    r_sun = sun["dist_au"] * AU_KM
    i = math.atan2(r_sun * math.sin(psi), moon["dist_km"] - r_sun * math.cos(psi))
    return (1 + math.cos(i)) / 2, elong


def separation(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Separação angular (graus)."""
    a1, d1, a2, d2 = (math.radians(x) for x in (ra1, dec1, ra2, dec2))
    c = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(a1 - a2)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


# ================================================================ fases da Lua (Meeus 49)
_PHASE_NAMES = {0.0: "Lua nova", 0.25: "Quarto crescente", 0.5: "Lua cheia", 0.75: "Quarto minguante"}


def _mean_phase(k: float) -> tuple[float, float, float, float, float, float, float]:
    t = k / 1236.85
    jde = (2451550.09766 + 29.530588861 * k + 0.00015437 * t ** 2 - 0.000000150 * t ** 3
           + 0.00000000073 * t ** 4)
    e = 1 - 0.002516 * t - 0.0000074 * t * t
    m = 2.5534 + 29.10535670 * k - 0.0000014 * t ** 2 - 0.00000011 * t ** 3
    mp = (201.5643 + 385.81693528 * k + 0.0107582 * t ** 2 + 0.00001238 * t ** 3
          - 0.000000058 * t ** 4)
    f = (160.7108 + 390.67050284 * k - 0.0016118 * t ** 2 - 0.00000227 * t ** 3
         + 0.000000011 * t ** 4)
    om = 124.7746 - 1.56375588 * k + 0.0020672 * t ** 2 + 0.00000215 * t ** 3
    return t, jde, e, m, mp, f, om


def moon_phase_jde(k: float) -> float:
    """Instante (JDE) da fase k: inteiro = nova, +0,25 crescente, +0,5 cheia, +0,75 minguante."""
    frac = round((k % 1) * 4) / 4
    t, jde, e, m, mp, f, om = _mean_phase(k)
    s = lambda x: math.sin(math.radians(x))  # noqa: E731
    c = lambda x: math.cos(math.radians(x))  # noqa: E731
    if frac in (0.0, 0.5):
        k1, k2, k3, k4 = ((-0.40720, 0.17241, 0.01608, 0.01039) if frac == 0.0
                          else (-0.40614, 0.17302, 0.01614, 0.01043))
        k5, k6, k7 = (0.00739, -0.00514, 0.00208) if frac == 0.0 else (0.00734, -0.00515, 0.00209)
        corr = (k1 * s(mp) + k2 * e * s(m) + k3 * s(2 * mp) + k4 * s(2 * f) + k5 * e * s(mp - m)
                + k6 * e * s(mp + m) + k7 * e * e * s(2 * m) - 0.00111 * s(mp - 2 * f) - 0.00057 * s(mp + 2 * f)
                + 0.00056 * e * s(2 * mp + m) - 0.00042 * s(3 * mp) + 0.00042 * e * s(m + 2 * f)
                + 0.00038 * e * s(m - 2 * f) - 0.00024 * e * s(2 * mp - m) - 0.00017 * s(om)
                - 0.00007 * s(mp + 2 * m) + 0.00004 * s(2 * mp - 2 * f) + 0.00004 * s(3 * m)
                + 0.00003 * s(mp + m - 2 * f) + 0.00003 * s(2 * mp + 2 * f) - 0.00003 * s(mp + m + 2 * f)
                + 0.00003 * s(mp - m + 2 * f) - 0.00002 * s(mp - m - 2 * f) - 0.00002 * s(3 * mp + m)
                + 0.00002 * s(4 * mp))
    else:
        corr = (-0.62801 * s(mp) + 0.17172 * e * s(m) - 0.01183 * e * s(mp + m) + 0.00862 * s(2 * mp)
                + 0.00804 * s(2 * f) + 0.00454 * e * s(mp - m) + 0.00204 * e * e * s(2 * m)
                - 0.00180 * s(mp - 2 * f) - 0.00070 * s(mp + 2 * f) - 0.00040 * s(3 * mp)
                - 0.00034 * e * s(2 * mp - m) + 0.00032 * e * s(m + 2 * f) + 0.00032 * e * s(m - 2 * f)
                - 0.00028 * e * e * s(mp + 2 * m) + 0.00027 * e * s(2 * mp + m) - 0.00017 * s(om)
                - 0.00005 * s(mp - m - 2 * f) + 0.00004 * s(2 * mp + 2 * f) - 0.00004 * s(mp + m + 2 * f)
                + 0.00004 * s(mp - 2 * m) + 0.00003 * s(mp + m - 2 * f) + 0.00003 * s(3 * m)
                + 0.00002 * s(2 * mp - 2 * f) + 0.00002 * s(mp - m + 2 * f) - 0.00002 * s(3 * mp + m))
        w = (0.00306 - 0.00038 * e * c(m) + 0.00026 * c(mp) - 0.00002 * c(mp - m)
             + 0.00002 * c(mp + m) + 0.00002 * c(2 * f))
        corr += w if frac == 0.25 else -w
    planetary = [
        (299.77 + 0.107408 * k - 0.009173 * t * t, 0.000325), (251.88 + 0.016321 * k, 0.000165),
        (251.83 + 26.651886 * k, 0.000164), (349.42 + 36.412478 * k, 0.000126),
        (84.66 + 18.206239 * k, 0.000110), (141.74 + 53.303771 * k, 0.000062),
        (207.14 + 2.453732 * k, 0.000060), (154.84 + 7.306860 * k, 0.000056),
        (34.52 + 27.261239 * k, 0.000047), (207.19 + 0.121824 * k, 0.000042),
        (291.34 + 1.844379 * k, 0.000040), (161.72 + 24.198154 * k, 0.000037),
        (239.56 + 25.513099 * k, 0.000035), (331.55 + 3.592518 * k, 0.000023),
    ]
    return jde + corr + sum(coef * s(arg) for arg, coef in planetary)


def _k_near(dt: datetime) -> float:
    year = dt.year + (dt.timetuple().tm_yday - 1) / 365.25
    return math.floor((year - 2000) * 12.3685)


def moon_phases(start: datetime, end: datetime) -> list[dict]:
    out = []
    k0 = _k_near(start) - 1
    for i in range(0, int((end - start).days / 7) + 12):
        k = k0 + i * 0.25
        when = from_jd_tt(moon_phase_jde(k))
        if when > end:
            break
        if when >= start:
            out.append({"when": when, "phase": _PHASE_NAMES[round((k % 1) * 4) / 4], "k": k})
    return out


# ================================================================ eclipses (Meeus 54)
def eclipse_at(k: float) -> dict | None:
    """Eclipse na lunação k (inteiro: solar; +0,5: lunar), ou None."""
    lunar = (k % 1) != 0
    t, jde, e, m, mp, f, om = _mean_phase(k)
    s = lambda x: math.sin(math.radians(x))  # noqa: E731
    c = lambda x: math.cos(math.radians(x))  # noqa: E731
    if abs(s(f)) > 0.36:
        return None
    f1 = f - 0.02665 * s(om)
    a1 = 299.77 + 0.107408 * k - 0.009173 * t * t
    jmax = (jde + (-0.4065 if lunar else -0.4075) * s(mp) + (0.1727 if lunar else 0.1721) * e * s(m)
            + 0.0161 * s(2 * mp) - 0.0097 * s(2 * f1) + 0.0073 * e * s(mp - m) - 0.0050 * e * s(mp + m)
            - 0.0023 * s(mp - 2 * f1) + 0.0021 * e * s(2 * m) + 0.0012 * s(mp + 2 * f1)
            + 0.0006 * e * s(2 * mp + m) - 0.0004 * s(3 * mp) - 0.0003 * e * s(m + 2 * f1)
            + 0.0003 * s(a1) - 0.0002 * e * s(m - 2 * f1) - 0.0002 * e * s(2 * mp - m) - 0.0002 * s(om))
    p = (0.2070 * e * s(m) + 0.0024 * e * s(2 * m) - 0.0392 * s(mp) + 0.0116 * s(2 * mp)
         - 0.0073 * e * s(mp + m) + 0.0067 * e * s(mp - m) + 0.0118 * s(2 * f1))
    q = (5.2207 - 0.0048 * e * c(m) + 0.0020 * e * c(2 * m) - 0.3299 * c(mp)
         - 0.0060 * e * c(mp + m) + 0.0041 * e * c(mp - m))
    w = abs(c(f1))
    gamma = (p * c(f1) + q * s(f1)) * (1 - 0.0048 * w)
    u = 0.0059 + 0.0046 * e * c(m) - 0.0182 * c(mp) + 0.0004 * c(2 * mp) - 0.0005 * c(m + mp)
    ag = abs(gamma)
    when = from_jd_tt(jmax)
    if not lunar:
        if ag > 1.5433 + u:
            return None
        if ag < 0.9972:
            if u < 0:
                kind = "total"
            elif u > 0.0047:
                kind = "anular"
            else:
                kind = "híbrido" if u < 0.00464 * math.sqrt(1 - gamma * gamma) else "anular"
            mag = None
        else:
            kind = "parcial"
            mag = (1.5433 + u - ag) / (0.5461 + 2 * u)
        return {"body": "solar", "kind": kind, "when": when, "gamma": round(gamma, 4),
                "magnitude": round(mag, 3) if mag is not None else None, "central": ag < 0.9972}
    pen = (1.5573 + u - ag) / 0.5450
    umb = (1.0128 - u - ag) / 0.5450
    if pen <= 0:
        return None
    kind = "penumbral" if umb <= 0 else "total" if umb >= 1 else "parcial"
    n = 0.5458 + 0.0400 * c(mp)

    def semi(h):
        return round(60.0 / n * math.sqrt(h * h - gamma * gamma)) if h > ag else None
    return {"body": "lunar", "kind": kind, "when": when, "gamma": round(gamma, 4),
            "magnitude": round(umb if umb > 0 else pen, 3), "penumbral_magnitude": round(pen, 3),
            "umbral_magnitude": round(umb, 3),
            "semi_duration_min": {"penumbral": semi(1.5573 + u), "partial": semi(1.0128 - u),
                                  "total": semi(0.4678 - u)}}


def eclipses(start: datetime, end: datetime) -> list[dict]:
    out = []
    k0 = _k_near(start) - 1
    for i in range(0, int((end - start).days / 14) + 6):
        k = k0 + i * 0.5
        _, jde, *_ = _mean_phase(k)
        if from_jd_tt(jde) > end + timedelta(days=2):
            break
        ecl = eclipse_at(k)
        if ecl and start <= ecl["when"] <= end:
            out.append(ecl)
    return out


# ================================================================ estações
def _find_sun_longitude(target: float, guess: datetime) -> datetime:
    jde = jd_tt(guess)
    for _ in range(12):
        diff = ang_diff(target, sun_apparent_longitude(jde))
        jde += diff * 365.2422 / 360.0
        if abs(diff) < 1e-6:
            break
    return from_jd_tt(jde)


SEASONS = [(0.0, 3, "Equinócio de março", "outono no hemisfério sul, primavera no norte"),
           (90.0, 6, "Solstício de junho", "inverno no hemisfério sul, verão no norte"),
           (180.0, 9, "Equinócio de setembro", "primavera no hemisfério sul, outono no norte"),
           (270.0, 12, "Solstício de dezembro", "verão no hemisfério sul, inverno no norte")]


def seasons(start: datetime, end: datetime) -> list[dict]:
    out = []
    for year in range(start.year, end.year + 1):
        for lon, month, name, note in SEASONS:
            when = _find_sun_longitude(lon, datetime(year, month, 20, 12, tzinfo=timezone.utc))
            if start <= when <= end:
                out.append({"when": when, "name": name, "note": note})
    return out


# ================================================================ chuvas de meteoros
# Calendário de referência da International Meteor Organization (IMO): longitude solar do máximo
# (J2000), radiante, taxa horária zenital (ZHR) típica, velocidade e período de atividade.
METEOR_SHOWERS = [
    {"code": "QUA", "name": "Quadrântidas", "peak_lon": 283.15, "ra": 230, "dec": 49, "zhr": "80 (60–200)",
     "v": 41, "active": "28/12 a 12/01", "parent": "asteroide 2003 EH1"},
    {"code": "LYR", "name": "Líridas", "peak_lon": 32.32, "ra": 271, "dec": 34, "zhr": "18",
     "v": 49, "active": "14/04 a 30/04", "parent": "cometa C/1861 G1 (Thatcher)"},
    {"code": "ETA", "name": "Eta Aquáridas", "peak_lon": 45.5, "ra": 338, "dec": -1, "zhr": "50 (40–85)",
     "v": 66, "active": "19/04 a 28/05", "parent": "cometa 1P/Halley"},
    {"code": "SDA", "name": "Delta Aquáridas do Sul", "peak_lon": 127.0, "ra": 340, "dec": -16, "zhr": "25",
     "v": 41, "active": "12/07 a 23/08", "parent": "cometa 96P/Machholz (provável)"},
    {"code": "PER", "name": "Perseidas", "peak_lon": 140.0, "ra": 48, "dec": 58, "zhr": "100",
     "v": 59, "active": "17/07 a 24/08", "parent": "cometa 109P/Swift-Tuttle"},
    {"code": "DRA", "name": "Dracônidas", "peak_lon": 195.4, "ra": 262, "dec": 54, "zhr": "variável (~10)",
     "v": 20, "active": "06/10 a 10/10", "parent": "cometa 21P/Giacobini-Zinner"},
    {"code": "ORI", "name": "Oriônidas", "peak_lon": 208.0, "ra": 95, "dec": 16, "zhr": "20",
     "v": 66, "active": "02/10 a 07/11", "parent": "cometa 1P/Halley"},
    {"code": "LEO", "name": "Leônidas", "peak_lon": 235.27, "ra": 152, "dec": 22, "zhr": "15",
     "v": 71, "active": "06/11 a 30/11", "parent": "cometa 55P/Tempel-Tuttle"},
    {"code": "GEM", "name": "Geminídeas", "peak_lon": 262.2, "ra": 112, "dec": 33, "zhr": "150",
     "v": 35, "active": "04/12 a 20/12", "parent": "asteroide 3200 Phaethon"},
    {"code": "URS", "name": "Úrsidas", "peak_lon": 270.7, "ra": 217, "dec": 76, "zhr": "10",
     "v": 33, "active": "17/12 a 26/12", "parent": "cometa 8P/Tuttle"},
]


def meteor_showers(start: datetime, end: datetime) -> list[dict]:
    out = []
    for year in range(start.year - 1, end.year + 1):
        for sh in METEOR_SHOWERS:
            # longitude J2000 → equinócio da data, para comparar com a longitude aparente do Sol
            guess = datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=(sh["peak_lon"] - 280.0) % 360 * 365.2422 / 360)
            target = norm360(sh["peak_lon"] + precession_lon(jd_tt(guess)))
            when = _find_sun_longitude(target, guess)
            if start <= when <= end:
                illum, elong = moon_illumination(jd_tt(when))
                out.append({**sh, "when": when, "moon_illumination": round(illum, 2),
                            "moon_waxing": elong < 180})
    return out


# ================================================================ eventos planetários
def _refine_min(fn, t0: float, t1: float, iters: int = 40) -> float:
    """Mínimo de fn em [t0, t1] (JDE) por busca da seção áurea."""
    g = (math.sqrt(5) - 1) / 2
    a, b = t0, t1
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = fn(c), fn(d)
    for _ in range(iters):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = fn(c)
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = fn(d)
    return (a + b) / 2


def _elong(body: str, jde: float) -> float:
    """Elongação em longitude eclíptica planeta − Sol (graus, −180..180)."""
    return ang_diff(geocentric(body, jde)["lon"], sun_geocentric(jde)["lon"])


def planet_events(start: datetime, end: datetime) -> list[dict]:
    out = []
    j0, j1 = jd_tt(start), jd_tt(end)
    days = int(j1 - j0) + 1
    grid = [j0 + i for i in range(-1, days + 2)]
    for body in PLANETS:
        el = [_elong(body, j) for j in grid]
        for i in range(1, len(grid)):
            a, b = el[i - 1], el[i]
            # cruzamentos de 0° (conjunção com o Sol) e de 180° (oposição)
            if a * b < 0 and abs(a - b) < 90:
                jd = grid[i - 1] + a / (a - b)
                for _ in range(3):
                    v = _elong(body, jd)
                    jd -= v / ((_elong(body, jd + 0.01) - v) / 0.01)
                if body in ("mercury", "venus"):
                    g = geocentric(body, jd)
                    sun = sun_geocentric(jd)
                    kind = "inferior" if g["dist_au"] < sun["dist_au"] else "superior"
                    out.append({"type": "conjunction_sun", "body": body, "jde": jd, "kind": kind})
                else:
                    out.append({"type": "conjunction_sun", "body": body, "jde": jd, "kind": None})
            elif abs(a - b) > 180 and abs(a) > 150 and abs(b) > 150 and body not in ("mercury", "venus"):
                jd = grid[i - 1] + (180 - abs(a)) / ((180 - abs(a)) + (180 - abs(b)))
                for _ in range(3):
                    v = ang_diff(_elong(body, jd), 180.0)
                    jd -= v / ((ang_diff(_elong(body, jd + 0.01), 180.0) - v) / 0.01)
                g = geocentric(body, jd)
                out.append({"type": "opposition", "body": body, "jde": jd, "dist_au": g["dist_au"]})
        if body in ("mercury", "venus"):
            ab = [abs(x) for x in el]
            for i in range(1, len(grid) - 1):
                if ab[i] >= ab[i - 1] and ab[i] > ab[i + 1] and ab[i] > 10:
                    jd = _refine_min(lambda j: -abs(_elong(body, j)), grid[i - 1], grid[i + 1])
                    e = _elong(body, jd)
                    out.append({"type": "greatest_elongation", "body": body, "jde": jd,
                                "elongation_deg": abs(e), "side": "leste (céu do entardecer)" if e > 0 else "oeste (céu do amanhecer)"})
    # conjunções entre planetas (separação mínima < 3°)
    bright = ["mercury", "venus", "mars", "jupiter", "saturn"]
    pos = {b: [geocentric(b, j) for j in grid] for b in bright}
    for i, b1 in enumerate(bright):
        for b2 in bright[i + 1:]:
            sep = [separation(p1["ra"], p1["dec"], p2["ra"], p2["dec"]) for p1, p2 in zip(pos[b1], pos[b2])]
            for k in range(1, len(grid) - 1):
                if sep[k] <= sep[k - 1] and sep[k] < sep[k + 1] and sep[k] < 3.5:
                    def f(j, b1=b1, b2=b2):
                        g1, g2 = geocentric(b1, j), geocentric(b2, j)
                        return separation(g1["ra"], g1["dec"], g2["ra"], g2["dec"])
                    jd = _refine_min(f, grid[k - 1], grid[k + 1])
                    s = f(jd)
                    if s < 3.0 and abs(_elong(b1, jd)) > 12:
                        out.append({"type": "planet_conjunction", "body": b1, "body2": b2, "jde": jd,
                                    "separation_deg": s})
    # conjunções da Lua com planetas brilhantes (separação mínima < 4°)
    hours = [j0 + h / 4 for h in range(-4, int((j1 - j0) * 4) + 8)]  # a cada 6 h
    moon = [moon_geocentric(j) for j in hours]
    for body in bright:
        pl = [geocentric(body, j) for j in hours]
        sep = [separation(m_["ra"], m_["dec"], p["ra"], p["dec"]) for m_, p in zip(moon, pl)]
        for k in range(1, len(hours) - 1):
            if sep[k] <= sep[k - 1] and sep[k] < sep[k + 1] and sep[k] < 5:
                def f(j, body=body):
                    m_, p = moon_geocentric(j), geocentric(body, j)
                    return separation(m_["ra"], m_["dec"], p["ra"], p["dec"])
                jd = _refine_min(f, hours[k - 1], hours[k + 1], iters=30)
                s = f(jd)
                if s < 4.0 and abs(_elong(body, jd)) > 15:
                    out.append({"type": "moon_conjunction", "body": body, "jde": jd, "separation_deg": s})
    for ev in out:
        ev["when"] = from_jd_tt(ev.pop("jde"))
    return [ev for ev in out if start <= ev["when"] <= end]


# ================================================================ visibilidade local
def body_radec(body: str, when: datetime) -> tuple[float, float]:
    jde = jd_tt(when)
    if body == "moon":
        m = moon_geocentric(jde)
        return m["ra"], m["dec"]
    if body == "sun":
        s = sun_geocentric(jde)
        return s["ra"], s["dec"]
    g = geocentric(body, jde)
    return g["ra"], g["dec"]


def altitude(body_or_radec, when: datetime, lat: float, lon: float) -> float:
    ra, dec = body_radec(body_or_radec, when) if isinstance(body_or_radec, str) else body_or_radec
    return astro.alt_az(ra, dec, lat, lon, when)[0]


def sun_altitude(when: datetime, lat: float, lon: float) -> float:
    return altitude("sun", when, lat, lon)


# ================================================================ central de eventos
EVENT_TYPES = {
    "moon_phase": "Fases da Lua",
    "eclipse": "Eclipses",
    "meteor_shower": "Chuvas de meteoros",
    "conjunction": "Conjunções",
    "opposition": "Oposições",
    "elongation": "Elongações máximas",
    "season": "Equinócios e solstícios",
}


def _fmt_deg(x: float) -> str:
    return f"{x:.1f}".replace(".", ",") + "°"


@lru_cache(maxsize=64)
def _raw_events(start_iso: str, days: int) -> tuple:
    start = datetime.fromisoformat(start_iso)
    end = start + timedelta(days=days)
    return (tuple(moon_phases(start, end)), tuple(eclipses(start, end)), tuple(seasons(start, end)),
            tuple(meteor_showers(start, end)), tuple(planet_events(start, end)))


def build_events(start: datetime, days: int, lat: float, lon: float, zone=None) -> list[dict]:
    """Lista de eventos com descrição e visibilidade no local informado."""
    start = start.replace(minute=0, second=0, microsecond=0)
    zone = zone or timezone.utc
    phases, ecl, seas, showers, planetary = _raw_events(start.isoformat(), days)
    events: list[dict] = []

    def add(type_, when, title, description, visibility=None, importance=1, extra=None):
        events.append({"type": type_, "type_label": EVENT_TYPES[type_], "when": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "title": title, "description": description, "visibility": visibility,
                       "importance": importance, **(extra or {})})

    for ph in phases:
        add("moon_phase", ph["when"], ph["phase"], "Instante da fase calculado para o centro da Terra.",
            importance=2 if ph["phase"] in ("Lua nova", "Lua cheia") else 1)

    for e in ecl:
        if e["body"] == "solar":
            title = f"Eclipse solar {e['kind']}"
            desc = ("Máximo do eclipse (instante de maior aproximação do eixo da sombra ao centro da Terra). "
                    + (f"Magnitude máxima {e['magnitude']:.3f}. ".replace(".", ",", 1) if e["magnitude"] else "")
                    + "A faixa de visibilidade não é calculada aqui: consulte o mapa da NASA.")
            s_alt = sun_altitude(e["when"], lat, lon)
            vis = ("Sol acima do horizonte no seu local no instante do máximo; a visibilidade depende da faixa do eclipse."
                   if s_alt > 0 else "Sol abaixo do horizonte no seu local no instante do máximo: provavelmente não visível.")
            add("eclipse", e["when"], title, desc, vis, 3,
                {"link": "https://science.nasa.gov/eclipses/", "gamma": e["gamma"], "eclipse_kind": e["kind"]})
        else:
            title = f"Eclipse lunar {e['kind']}"
            sd = e["semi_duration_min"]
            dur = []
            if sd.get("total"):
                dur.append(f"totalidade de cerca de {2 * sd['total']} min")
            if sd.get("partial"):
                dur.append(f"fase parcial de cerca de {2 * sd['partial']} min")
            desc = (f"Magnitude umbral {e['umbral_magnitude']:.3f}".replace(".", ",")
                    + (f"; {', '.join(dur)}" if dur else "") + ".")
            m_alt = altitude("moon", e["when"], lat, lon)
            vis = (f"Lua acima do horizonte no seu local no máximo (altitude {_fmt_deg(m_alt)}): visível se o céu estiver limpo."
                   if m_alt > 0 else "Lua abaixo do horizonte no seu local no instante do máximo: não visível daqui.")
            add("eclipse", e["when"], title, desc, vis, 3, {"gamma": e["gamma"], "eclipse_kind": e["kind"]})

    for s in seas:
        add("season", s["when"], s["name"], f"Início astronômico: {s['note']}.", importance=1)

    for sh in showers:
        # melhor horário: madrugada local (04:00 no fuso aproximado pela longitude)
        night = sh["when"].replace(hour=0, minute=0, second=0) + timedelta(hours=4 - lon / 15.0)
        if night < sh["when"] - timedelta(hours=14):
            night += timedelta(days=1)
        alt = altitude((sh["ra"], sh["dec"]), night, lat, lon)
        moon_pct = round(sh["moon_illumination"] * 100)
        moon_txt = ("Lua pouco iluminada: boas condições" if moon_pct < 35
                    else f"Lua {moon_pct}% iluminada: o luar reduz os meteoros visíveis")
        vis = (f"Radiante a {_fmt_deg(alt)} de altitude por volta das 4 h locais. {moon_txt}."
               if alt > 0 else f"Radiante abaixo do horizonte de madrugada neste local: poucos ou nenhum meteoro. {moon_txt}.")
        add("meteor_shower", sh["when"], f"Máximo das {sh['name']}",
            f"Taxa horária zenital típica {sh['zhr']}; meteoros a {sh['v']} km/s; ativa de {sh['active']}. "
            f"Origem: {sh['parent']}. Horário do máximo previsto pela longitude solar; pode variar algumas horas.",
            vis, 2, {"code": sh["code"], "link": "https://www.imo.net/resources/calendar/"})

    for ev in planetary:
        name = NAMES[ev["body"]]
        when = ev["when"]
        if ev["type"] == "opposition":
            add("opposition", when, f"{name} em oposição",
                f"{name} fica do lado oposto ao Sol, visível a noite toda e no brilho máximo do ano. "
                f"Distância à Terra: {ev['dist_au']:.2f} UA.".replace(".", ",", 1),
                _best_time(ev["body"], when, lat, lon, zone, window_h=14, min_alt=10), importance=2)
        elif ev["type"] == "conjunction_sun":
            kind = f" {ev['kind']}" if ev["kind"] else ""
            add("conjunction", when, f"{name} em conjunção{kind} com o Sol",
                f"{name} fica na direção do Sol e não pode ser observado por alguns dias.", importance=1)
        elif ev["type"] == "greatest_elongation":
            add("elongation", when, f"{name} na elongação máxima",
                f"Maior afastamento aparente do Sol: {_fmt_deg(ev['elongation_deg'])} a {ev['side']}. "
                "Bom momento para observar.", _best_time(ev["body"], when, lat, lon, zone, window_h=16, min_alt=3,
                                                        sun_max=-6), importance=2 if ev["body"] == "mercury" else 1)
        elif ev["type"] == "planet_conjunction":
            name2 = NAMES[ev["body2"]]
            add("conjunction", when, f"Conjunção de {name} e {name2}",
                f"Os dois planetas ficam a {_fmt_deg(ev['separation_deg'])} um do outro (separação mínima).",
                _best_time(ev["body"], when, lat, lon, zone), 2)
        elif ev["type"] == "moon_conjunction":
            add("conjunction", when, f"Lua próxima de {name}",
                f"Separação mínima de {_fmt_deg(ev['separation_deg'])} vista do centro da Terra; "
                "do seu local pode variar até ~1°.", _best_time(ev["body"], when, lat, lon, zone), 1)
    events.sort(key=lambda e: e["when"])
    return events


_DIRS = ["norte", "nordeste", "leste", "sudeste", "sul", "sudoeste", "oeste", "noroeste"]


def compass(az: float) -> str:
    return _DIRS[int((az + 22.5) % 360 // 45)]


def _best_time(body: str, when: datetime, lat: float, lon: float, zone, window_h: int = 12,
               min_alt: float = 8.0, sun_max: float = -9.0) -> str:
    """Melhor horário com céu escuro perto do evento: maior altitude do objeto com o Sol abaixo de sun_max."""
    if abs(_elong(body, jd_tt(when))) < 12:
        return "Muito próximo do Sol: difícil ou impossível de observar."
    best = None
    for k in range(-window_h * 4, window_h * 4 + 1):
        t = when + timedelta(minutes=15 * k)
        if sun_altitude(t, lat, lon) > sun_max:
            continue
        ra, dec = body_radec(body, t)
        alt, az = astro.alt_az(ra, dec, lat, lon, t)
        if alt >= min_alt and (best is None or alt > best[1]):
            best = (t, alt, az)
    if best is None:
        return "Não fica bem posicionado com céu escuro no seu local nesse período."
    t, alt, az = best
    loc = t.astimezone(zone)
    return (f"Melhor observação no seu local: {loc.strftime('%d/%m')} por volta das {loc.strftime('%H:%M')} "
            f"(horário local), a {_fmt_deg(alt)} de altitude na direção {compass(az)}.")


# ================================================================ calendário (iCalendar)
def to_ics(events: list[dict], alarm_minutes: int | None = None) -> str:
    def esc(t: str) -> str:
        return t.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

    def fold(line: str) -> str:
        out, cur = [], ""
        for ch in line:
            if len((cur + ch).encode("utf-8")) > 74:
                out.append(cur)
                cur = " " + ch
            else:
                cur += ch
        out.append(cur)
        return "\r\n".join(out)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EmpreenderTHZ//Astronomy Center//PT-BR",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Eventos astronômicos — EmpreenderTHZ"]
    for ev in events:
        start = ev["when"].replace("-", "").replace(":", "")
        uid = f"{ev['type']}-{start}-{abs(hash(ev['title'])) % 10**8}@astronomy.empreenderthz"
        desc = ev["description"] + (f"\n{ev['visibility']}" if ev.get("visibility") else "")
        desc += "\nCálculo local do EmpreenderTHZ Astronomy Center; confira fontes oficiais para eventos críticos."
        lines += ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{stamp}", f"DTSTART:{start}", f"DTEND:{start}",
                  fold(f"SUMMARY:{esc(ev['title'])}"), fold(f"DESCRIPTION:{esc(desc)}"),
                  f"CATEGORIES:{esc(ev['type_label'])}", "TRANSP:TRANSPARENT"]
        if ev.get("link"):
            lines.append(fold(f"URL:{ev['link']}"))
        if alarm_minutes:
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", fold(f"DESCRIPTION:{esc(ev['title'])}"),
                      f"TRIGGER:-PT{int(alarm_minutes)}M", "END:VALARM"]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
