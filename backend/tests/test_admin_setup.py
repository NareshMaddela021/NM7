import re

import pyotp
import pytest
from sqlalchemy import select

from app.audit import AuditLog
from app.auth.admin_service import create_admin
from app.auth.models import User
from app.core.config import get_settings
from tests.conftest import PASSWORD, signup

TOKEN = "setup-token-0123456789-abcdefghij"
BODY = {"token": TOKEN, "email": "owner@nm7.si", "name": "Naresh", "password": PASSWORD, "passwordConfirm": PASSWORD}


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
def token_set(monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_setup_token", TOKEN)


def secret_from(uri: str) -> str:
    return re.search(r"secret=([A-Z2-7]+)", uri).group(1)


async def actions(db):
    return [a for (a,) in await db.execute(select(AuditLog.action).order_by(AuditLog.id))]


async def test_works_once(client, token_set, db, make_client):
    r = await client.post("/api/admin/setup", json=BODY)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["otpauthUri"].startswith("otpauth://totp/Nm7:owner%40nm7.si?") and "issuer=Nm7" in out["otpauthUri"]
    assert len(out["recoveryCodes"]) == 10 and len(set(out["recoveryCodes"])) == 10
    assert out["secret"] == secret_from(out["otpauthUri"])
    # Nothing is saved until the authenticator is confirmed.
    assert (await db.execute(select(User))).first() is None

    assert err(await client.post("/api/admin/setup/verify", json={"code": "000000"})) == "invalid_code"
    code = pyotp.TOTP(out["secret"]).now()
    r = await client.post("/api/admin/setup/verify", json={"code": code})
    assert r.status_code == 200 and r.json() == {"ok": True, "email": "owner@nm7.si"}

    owner = (await db.execute(select(User))).scalar_one()
    assert owner.role == "admin" and owner.admin_role == "owner" and owner.verified
    assert {"admin.setup_started", "admin.setup_bad_code", "admin.setup_completed"} <= set(await actions(db))

    # The new owner signs in with password + a recovery code (the code used in setup can't be reused).
    admin = make_client()
    await admin.post("/api/auth/admin/login", json={"email": "owner@nm7.si", "password": PASSWORD})
    assert err(await admin.post("/api/auth/admin/verify", json={"code": code})) == "invalid_code"
    r = await admin.post("/api/auth/admin/verify", json={"code": out["recoveryCodes"][0]})
    assert r.status_code == 200 and r.json()["user"]["adminRole"] == "owner"

    # Closed for good, even with the token still set and a fresh pending ticket.
    assert (await client.post("/api/admin/setup", json=BODY)).status_code == 404
    assert (await client.post("/api/admin/setup/verify", json={"code": code})).status_code == 404


async def test_closed_when_an_admin_already_exists(client, token_set, db):
    await create_admin(db, "first@nm7.si", "First", "owner", PASSWORD)
    await db.commit()
    r = await client.post("/api/admin/setup", json=BODY)
    assert r.status_code == 404 and err(r) == "not_found"
    assert (await client.post("/api/admin/setup/verify", json={"code": "123456"})).status_code == 404


async def test_ticket_from_before_another_admin_appeared_is_refused(client, token_set, db):
    out = (await client.post("/api/admin/setup", json=BODY)).json()
    await create_admin(db, "first@nm7.si", "First", "owner", PASSWORD)
    await db.commit()
    r = await client.post("/api/admin/setup/verify", json={"code": pyotp.TOTP(out["secret"]).now()})
    assert r.status_code == 404
    assert (await db.execute(select(User.email).where(User.role == "admin"))).scalars().all() == ["first@nm7.si"]


async def test_wrong_token(client, token_set, db):
    for _ in range(5):
        r = await client.post("/api/admin/setup", json={**BODY, "token": "wrong-" + TOKEN})
        assert r.status_code == 403 and err(r) == "invalid_token"
    assert (await actions(db)).count("admin.setup_bad_token") == 5
    r = await client.post("/api/admin/setup", json=BODY)  # even the right token waits now
    assert r.status_code == 429


async def test_missing_or_short_token_env(client, db, monkeypatch):
    for value in ("", "too-short"):
        monkeypatch.setattr(get_settings(), "admin_setup_token", value)
        r = await client.post("/api/admin/setup", json={**BODY, "token": value})
        assert r.status_code == 404
        assert (await client.post("/api/admin/setup/verify", json={"code": "123456"})).status_code == 404
    assert (await db.execute(select(User))).first() is None


async def test_input_checks(client, token_set, outbox):
    r = await client.post("/api/admin/setup", json={**BODY, "passwordConfirm": "Other2026x"})
    assert err(r) == "password_mismatch"
    r = await client.post("/api/admin/setup", json={**BODY, "password": "short1", "passwordConfirm": "short1"})
    assert err(r) == "weak_password"
    await signup(client, outbox, email="owner@nm7.si")
    assert err(await client.post("/api/admin/setup", json=BODY)) == "email_taken"


async def test_verify_needs_the_ticket(client, token_set, make_client):
    out = (await client.post("/api/admin/setup", json=BODY)).json()
    other = make_client()  # no ticket cookie
    r = await other.post("/api/admin/setup/verify", json={"code": pyotp.TOTP(out["secret"]).now()})
    assert r.status_code == 400 and err(r) == "setup_expired"
    client.cookies.set("nm7_admin_setup", "tampered", path="/api/admin/setup")
    assert err(await client.post("/api/admin/setup/verify", json={"code": "123456"})) == "setup_expired"
