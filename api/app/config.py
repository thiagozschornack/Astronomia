"""Configuração lida de variáveis de ambiente (ver .env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    nasa_api_key: str = field(default_factory=lambda: os.getenv("NASA_API_KEY", "DEMO_KEY"))
    http_timeout_s: float = field(default_factory=lambda: _float("HTTP_TIMEOUT_S", 20))
    user_agent: str = field(default_factory=lambda: os.getenv(
        "HTTP_USER_AGENT", "EmpreenderTHZ-Astronomy-Center/0.2 (+contato no README)"))
    default_site_name: str = field(default_factory=lambda: os.getenv("DEFAULT_SITE_NAME", "Joinville/SC"))
    default_lat: float = field(default_factory=lambda: _float("DEFAULT_LAT", -26.3045))
    default_lon: float = field(default_factory=lambda: _float("DEFAULT_LON", -48.8487))
    default_tz: str = field(default_factory=lambda: os.getenv("DEFAULT_TZ", "America/Sao_Paulo"))
    brand_logo_url: str = field(default_factory=lambda: os.getenv("BRAND_LOGO_URL", "/brand/logo.svg"))
    # Origens liberadas: as do site (CORS_ORIGINS) + as do app Android/iOS (APP_CORS_ORIGINS).
    # O app Capacitor roda em https://localhost (Android) e capacitor://localhost (iOS).
    cors_origins: tuple[str, ...] = field(default_factory=lambda: tuple(dict.fromkeys(
        o.strip() for o in (os.getenv("CORS_ORIGINS", "") + "," + os.getenv(
            "APP_CORS_ORIGINS", "https://localhost,capacitor://localhost")).split(",") if o.strip())))
    rate_limit_per_min: int = field(default_factory=lambda: int(_float("RATE_LIMIT_PER_MIN", 120)))
    frontend_dir: Path = field(default_factory=lambda: Path(os.getenv(
        "FRONTEND_DIR", str(Path(__file__).resolve().parents[2] / "frontend"))))

    database_url: str = field(default_factory=lambda: os.getenv(
        "DATABASE_URL", "sqlite:///" + str(Path(__file__).resolve().parents[1] / "data" / "astro.db")))
    scheduler_enabled: bool = field(default_factory=lambda: os.getenv("SCHEDULER_ENABLED", "true").lower() == "true")
    sync_history_days: int = field(default_factory=lambda: int(_float("SYNC_HISTORY_DAYS", 30)))
    admin_token: str = field(default_factory=lambda: os.getenv("ADMIN_TOKEN", ""))

    @property
    def using_demo_key(self) -> bool:
        return self.nasa_api_key == "DEMO_KEY"


settings = Settings()
