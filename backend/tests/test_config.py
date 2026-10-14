import pytest

from app.core.config import Settings


@pytest.mark.parametrize(
    "given",
    ["postgres://u:p@h:5432/db", "postgresql://u:p@h:5432/db", "postgresql+asyncpg://u:p@h:5432/db"],
)
def test_database_url_uses_asyncpg(given):
    assert Settings(database_url=given).database_url == "postgresql+asyncpg://u:p@h:5432/db"


def test_cors_origins_from_comma_list(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://nm7.si/, https://www.nm7.si")
    assert Settings().cors_origins == ["https://nm7.si", "https://www.nm7.si"]


def test_blank_cookie_domain_is_none(monkeypatch):
    monkeypatch.setenv("COOKIE_DOMAIN", "")
    assert Settings().cookie_domain is None
