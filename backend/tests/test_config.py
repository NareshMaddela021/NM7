from app.core.config import Settings


def test_mongodb_settings_from_env(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb+srv://user:pass@nm7.example.mongodb.net/?retryWrites=true")
    monkeypatch.setenv("MONGODB_DB", "nm7")
    s = Settings()
    assert s.mongodb_uri.startswith("mongodb+srv://") and s.mongodb_db == "nm7"


def test_cors_origins_from_comma_list(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://nm7.si/, https://www.nm7.si")
    assert Settings().cors_origins == ["https://nm7.si", "https://www.nm7.si"]


def test_blank_cookie_domain_is_none(monkeypatch):
    monkeypatch.setenv("COOKIE_DOMAIN", "")
    assert Settings().cookie_domain is None


def test_app_env_fails_closed_to_prod(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    s = Settings(_env_file=None)
    assert s.app_env == "prod" and s.is_prod and s.trusted_proxy_hops == 1
