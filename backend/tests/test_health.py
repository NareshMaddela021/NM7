from pymongo.errors import ServerSelectionTimeoutError

from app.core.db import get_db


async def test_health_ok(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "db": "ok"}


async def test_health_reports_db_down(app, client):
    class DownDatabase:
        async def command(self, *_):
            raise ServerSelectionTimeoutError("connection refused")

    async def down_db():
        return DownDatabase()

    app.dependency_overrides[get_db] = down_db
    r = await client.get("/health")
    assert r.status_code == 503
    assert r.json()["db"] == "down"


async def test_cors_allows_frontend_with_credentials(client):
    r = await client.options(
        "/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert r.headers["access-control-allow-credentials"] == "true"


async def test_cors_rejects_other_origins(client):
    r = await client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def _app_with(monkeypatch, **env):
    from app.core.config import get_settings
    from app.main import create_app

    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    try:
        return create_app()
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


async def test_vercel_preview_origins_by_regex(monkeypatch):
    from httpx import ASGITransport, AsyncClient

    app = _app_with(
        monkeypatch,
        CORS_ORIGINS="https://nm7.vercel.app",
        CORS_ORIGIN_REGEX=r"https://nm7-[a-z0-9-]+-acme-team\.vercel\.app",
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", cookies={"nm7_session": "x"}) as c:
        for origin, ok in [
            ("https://nm7.vercel.app", True),
            ("https://nm7-git-feature-x-acme-team.vercel.app", True),
            ("https://nm7-a1b2c3d4e-acme-team.vercel.app", True),
            ("https://evil.vercel.app", False),
            ("https://nm7-a1b2-acme-team.vercel.app.evil.com", False),
        ]:
            r = await c.get("/health", headers={"Origin": origin})
            assert (r.headers.get("access-control-allow-origin") == origin) is ok, origin
            # Same rule for cookie-carrying changes (origin check).
            r = await c.post("/api/auth/logout", headers={"Origin": origin})
            assert (r.status_code != 403) is ok, origin


async def test_version_reports_the_deployed_commit(client, monkeypatch):
    monkeypatch.setenv("RENDER_GIT_COMMIT", "abc123")
    assert (await client.get("/version")).json() == {"commit": "abc123"}
    monkeypatch.delenv("RENDER_GIT_COMMIT")
    assert (await client.get("/version")).json()["commit"] in ("unknown", __import__("os").environ.get("GIT_COMMIT"))
