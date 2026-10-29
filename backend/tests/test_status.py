"""Public status: /health answers GET and HEAD (uptime monitors), /api/public/status gives states only."""

import time

from app.core import email as email_mod


async def test_health_get_and_head(client):
    assert (await client.get("/health")).json() == {"status": "ok", "db": "ok"}
    r = await client.head("/health")
    assert r.status_code == 200


async def test_status_states_only(client, monkeypatch):
    r = await client.get("/api/public/status")
    body = r.json()
    assert r.status_code == 200 and body["api"] == "ok" and body["email"] in ("ok", "degraded", "off")
    assert set(body) == {"api", "email", "checkedAt"}  # nothing internal
    assert r.headers["cache-control"] == "no-store"
    # most recent sends failing: degraded
    email_mod.RECENT.clear()
    for _ in range(4):
        email_mod.RECENT.append((time.time(), False))
    assert (await client.get("/api/public/status")).json()["email"] == "degraded"
    email_mod.RECENT.clear()
