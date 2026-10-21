"""Cookie flags and request limits (audit #29, #33, #34)."""

from datetime import timedelta

from fastapi import Response

from app.auth import sessions
from app.core.config import Settings


def _cookie(monkeypatch, **env):
    monkeypatch.setattr(sessions, "get_settings", lambda: Settings(secret_key="x", **env))
    r = Response()
    sessions.set_cookie(r, "nm7_session", "t", timedelta(days=30))
    return r.headers["set-cookie"]


def test_session_cookie_flags_in_prod(monkeypatch):
    c = _cookie(monkeypatch, app_env="prod", cookie_samesite="lax", cookie_domain=".nm7.si")
    assert "Secure" in c and "HttpOnly" in c and "SameSite=lax" in c and "Domain=.nm7.si" in c
    c = _cookie(monkeypatch, app_env="prod", cookie_samesite="none")
    assert "Secure" in c and "SameSite=none" in c


def test_dev_cookie_is_not_secure_unless_cross_site(monkeypatch):
    assert "Secure" not in _cookie(monkeypatch, app_env="dev", cookie_samesite="lax")
    assert "Secure" in _cookie(monkeypatch, app_env="dev", cookie_samesite="none")


async def test_body_over_the_limit_is_413_in_the_error_shape(client):
    big = {"data": {"summary": "x" * (2 * 1024 * 1024 + 10)}}
    r = await client.patch("/api/me/resumes/r1", json=big)
    assert r.status_code == 413
    assert r.json() == {"error": {"code": "too_large", "message": "This request is too large."}}
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


async def test_chunked_body_over_the_limit_is_413(client):
    async def chunks():
        for _ in range(3):
            yield b'{"summary": "' + b"x" * (1024 * 1024) + b'"}'

    r = await client.patch("/api/me/resumes/r1", content=chunks(), headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"


async def test_unknown_route_answers_in_the_error_shape(client):
    r = await client.get("/api/nothing-here")
    assert r.status_code == 404 and r.json() == {"error": {"code": "not_found", "message": "Not Found"}}
