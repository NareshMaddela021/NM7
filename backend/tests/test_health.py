from sqlalchemy.exc import OperationalError

from app.core.db import get_db


async def test_health_ok(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "db": "ok"}


async def test_health_reports_db_down(app, client):
    class DownSession:
        async def execute(self, *_):
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    async def down_db():
        yield DownSession()

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
