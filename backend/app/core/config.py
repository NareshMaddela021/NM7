"""Settings, read from environment variables (or a local .env file)."""

import re
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["dev", "test", "prod"] = "dev"
    # MongoDB (Atlas in production). Atlas gives a mongodb+srv:// URI; local tests use a one-node replica set.
    mongodb_uri: str = "mongodb://127.0.0.1:27017/?replicaSet=rs0"
    mongodb_db: str = "nm7"
    secret_key: str = "dev-only-secret-change-me"
    # Encrypts authenticator secrets. Falls back to SECRET_KEY; changing it breaks existing admin authenticators.
    encryption_key: str = ""
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
    # Extra allowed origins as a full-match regex, e.g. Vercel preview deployments. Keep it tied to your own
    # project and team, never all of *.vercel.app (anyone can deploy there). Empty = none.
    cors_origin_regex: str = ""
    cookie_domain: str | None = None
    # "lax" when the site and API share a domain (nm7.si + api.nm7.si). "none" when they are different sites,
    # e.g. testing on *.onrender.com (needs HTTPS; the origin check still blocks other sites).
    cookie_samesite: Literal["lax", "none"] = "lax"

    # Email (Zoho ZeptoMail)
    zeptomail_token: str = ""
    zeptomail_url: str = "https://api.zeptomail.in/v1.1/email"  # India data centre
    email_from: str = "noreply@nm7.si"

    # One-time owner setup from the website (POST /api/admin/setup) for hosts without a shell. Only works while no
    # admin exists and the token is at least 24 characters. Remove it after use.
    admin_setup_token: str = ""

    # Razorpay — empty until keys exist
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [o.strip().rstrip("/") for o in v.split(",") if o.strip()]
        return v

    @field_validator("cors_origin_regex")
    @classmethod
    def _valid_regex(cls, v: str) -> str:
        v = v.strip()
        if v:
            re.compile(v)  # fail at start-up, not on the first request
        return v

    @field_validator("cookie_domain", mode="before")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        return v or None

    def origin_allowed(self, origin: str) -> bool:
        origin = origin.rstrip("/")
        if origin in self.cors_origins:
            return True
        return bool(self.cors_origin_regex) and re.fullmatch(self.cors_origin_regex, origin) is not None

    @property
    def is_prod(self) -> bool:
        return self.app_env == "prod"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.is_prod and s.secret_key.startswith("dev-only"):
        raise RuntimeError("SECRET_KEY must be set in production")
    return s
