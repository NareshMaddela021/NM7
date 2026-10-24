import time
from datetime import timedelta

import pyotp
import pytest

from app.auth.admin_service import check_totp, create_admin
from app.auth.models import User
from app.cli import run as cli_run
from app.core.db import ADMIN_CHALLENGES, SESSIONS, USERS
from app.core.security import decrypt
from app.core.time import now
from tests.conftest import PASSWORD, signup

EMAIL = "admin@nm7.si"


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def admin(db):
    user, secret, codes = await create_admin(db, EMAIL, "Naresh (owner)", "owner", PASSWORD)
    return {"user": user, "secret": secret, "codes": codes}


async def password_step(client, email=EMAIL, password=PASSWORD):
    return await client.post("/api/auth/admin/login", json={"email": email, "password": password})


async def test_two_step_login(client, admin, db):
    r = await password_step(client)
    assert r.status_code == 200 and r.json() == {"status": "code_required", "user": None}
    assert (await client.get("/api/auth/me")).status_code == 401  # not signed in yet

    r = await client.post("/api/auth/admin/verify", json={"code": "000000"})
    assert r.status_code == 400 and err(r) == "invalid_code"

    r = await client.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(admin["secret"]).now()})
    assert r.status_code == 200 and r.json()["status"] == "signed_in"
    me = (await client.get("/api/auth/me")).json()
    assert me["role"] == "admin" and me["adminRole"] == "owner"

    s = await db[SESSIONS].find_one({})
    assert s["two_step"] and timedelta(hours=11) < s["expires_at"] - now() <= timedelta(hours=12)

    # The challenge is used up.
    r = await client.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(admin["secret"]).now()})
    assert err(r) == "no_challenge"


async def test_wrong_password_or_non_admin(client, admin, outbox):
    assert err(await password_step(client, password="Wrong12345")) == "invalid_credentials"
    await signup(client, outbox)  # a customer
    r = await password_step(client, email="sai@example.com")
    assert r.status_code == 401 and err(r) == "invalid_credentials"


async def test_same_code_cannot_be_used_twice(client, admin, make_client):
    code = pyotp.TOTP(admin["secret"]).now()
    await password_step(client)
    assert (await client.post("/api/auth/admin/verify", json={"code": code})).status_code == 200

    other = make_client()
    await password_step(other)
    r = await other.post("/api/auth/admin/verify", json={"code": code})
    assert r.status_code == 400


async def test_recovery_code_works_once(client, admin, make_client):
    code = admin["codes"][0]
    await password_step(client)
    r = await client.post("/api/auth/admin/verify", json={"code": code.lower()})
    assert r.status_code == 200

    other = make_client()
    await password_step(other)
    assert (await other.post("/api/auth/admin/verify", json={"code": code})).status_code == 400


async def test_trusted_device_skips_the_code_for_30_days(client, admin, make_client, db):
    await password_step(client)
    r = await client.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(admin["secret"]).now(), "trust": True})
    assert r.status_code == 200 and "nm7_trust" in r.cookies
    await client.post("/api/auth/logout")

    r = await password_step(client)
    assert r.json()["status"] == "signed_in"
    assert (await client.get("/api/auth/me")).json()["role"] == "admin"

    # Still needs the right password.
    await client.post("/api/auth/logout")
    assert err(await password_step(client, password="Wrong12345")) == "invalid_credentials"

    # Another browser is not trusted.
    assert (await password_step(make_client())).json()["status"] == "code_required"

    # Forgetting the device brings the code back.
    await client.post("/api/auth/admin/forget-device")
    assert (await password_step(client)).json()["status"] == "code_required"


async def test_challenge_expires_and_has_five_tries(client, admin, db):
    await password_step(client)
    for _ in range(5):
        assert err(await client.post("/api/auth/admin/verify", json={"code": "000000"})) == "invalid_code"
    r = await client.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(admin["secret"]).now()})
    assert err(r) == "no_challenge"

    await password_step(client)
    await db[ADMIN_CHALLENGES].update_many({}, {"$set": {"expires_at": now() - timedelta(seconds=1)}})
    r = await client.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(admin["secret"]).now()})
    assert err(r) == "no_challenge"


async def test_verify_without_password_step(client, admin):
    r = await client.post("/api/auth/admin/verify", json={"code": "123456"})
    assert r.status_code == 400 and err(r) == "no_challenge"


def test_totp_window_and_reuse(admin):
    user: User = admin["user"]
    totp = pyotp.TOTP(decrypt(user.totp_secret_enc))
    t = time.time()
    assert not check_totp(user, totp.at(t - 90), at=t)  # too old
    assert check_totp(user, totp.at(t - 30), at=t)  # one step back is fine
    assert check_totp(user, totp.at(t), at=t)
    assert not check_totp(user, totp.at(t - 30), at=t)  # older than the last used step
    assert not check_totp(user, "12345", at=t)


async def test_role_permissions(client, admin, db, make_client, outbox):
    await password_step(client)
    await client.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(admin["secret"]).now()})
    r = await client.get("/api/admin/audit-log")
    assert r.status_code == 200
    actions = [e["action"] for e in r.json()]
    assert "admin.login" in actions and r.json()[0]["actorName"] == "Naresh (owner)"

    # Finance can't see the team audit log.
    await db[USERS].update_one({"email_lc": EMAIL}, {"$set": {"admin_role": "finance"}})
    r = await client.get("/api/admin/audit-log")
    assert r.status_code == 403 and err(r) == "no_permission"

    # A session without two-step is not enough.
    await db[USERS].update_one({"email_lc": EMAIL}, {"$set": {"admin_role": "owner"}})
    await db[SESSIONS].update_many({}, {"$set": {"two_step": False}})
    assert err(await client.get("/api/admin/audit-log")) == "admin_only"

    customer = make_client()
    await signup(customer, outbox)
    assert err(await customer.get("/api/admin/audit-log")) == "admin_only"
    assert err(await make_client().get("/api/admin/audit-log")) == "not_signed_in"


async def test_admin_session_does_not_slide(client, admin, db):
    await password_step(client)
    await client.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(admin["secret"]).now()})
    soon = now() + timedelta(minutes=30)
    soon = soon.replace(microsecond=soon.microsecond // 1000 * 1000)  # MongoDB keeps milliseconds
    await db[SESSIONS].update_many({}, {"$set": {"last_seen_at": now() - timedelta(hours=3), "expires_at": soon}})
    assert (await client.get("/api/auth/me")).status_code == 200
    assert (await db[SESSIONS].find_one({}))["expires_at"] == soon


async def test_cli_create_and_reset(monkeypatch, capsys, db):
    monkeypatch.setenv("NM7_ADMIN_PASSWORD", PASSWORD)
    await cli_run(["create-admin", "--email", "ops@nm7.si", "--name", "Ops", "--role", "ops"])
    out = capsys.readouterr().out
    assert "otpauth://totp/Nm7:ops%40nm7.si" in out and out.count("-") >= 10
    user = User.load(await db[USERS].find_one({"email_lc": "ops@nm7.si"}))
    assert user.role == "admin" and user.admin_role == "ops" and user.totp_secret_enc

    with pytest.raises(SystemExit):
        await cli_run(["create-admin", "--email", "ops@nm7.si", "--name", "Ops", "--role", "ops"])

    old_secret = user.totp_secret_enc
    await cli_run(["reset-admin-2fa", "--email", "ops@nm7.si"])
    user = User.load(await db[USERS].find_one({"email_lc": "ops@nm7.si"}))
    assert user.totp_secret_enc != old_secret
