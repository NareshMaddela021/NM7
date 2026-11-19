"""Sign in / sign up with Google: the ID-token checks (signed with a test RSA key; Google is never called), linking to
an existing account, new accounts through the email sign-up path, admins and two-step logins refused, Settings
connect / remove, and what is stored."""

import base64
import json
import re
import time

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from app.auth import google
from app.auth.admin_service import create_admin
from app.core.config import get_settings
from app.core.db import AUDIT_LOG, SESSIONS, USERS
from app.core.security import encrypt
from app.core.time import now
from tests.conftest import PASSWORD, signup

CID = "test-client.apps.googleusercontent.com"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def jwk(key, kid: str) -> dict:
    n = key.public_key().public_numbers()
    return {
        "kty": "RSA",
        "alg": "RS256",
        "use": "sig",
        "kid": kid,
        "n": b64(n.n.to_bytes((n.n.bit_length() + 7) // 8, "big")),
        "e": b64(n.e.to_bytes(3, "big")),
    }


JWKS = {"keys": [jwk(KEY, "k1")]}


def token(sub="g-100", email="asha@gmail.com", key=KEY, kid="k1", alg="RS256", **over) -> str:
    t = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": CID,
        "sub": sub,
        "email": email,
        "email_verified": True,
        "name": "Asha Rao",
        "picture": "https://lh3.googleusercontent.com/a/photo",
        "iat": t,
        "exp": t + 3600,
        "nonce": "x",
        "hd": "x",
        **over,
    }
    claims = {k: v for k, v in claims.items() if v is not None}
    h = b64(json.dumps({"alg": alg, "kid": kid, "typ": "JWT"}).encode())
    p = b64(json.dumps(claims).encode())
    sig = key.sign(f"{h}.{p}".encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{h}.{p}.{b64(sig)}"


@pytest.fixture(autouse=True)
def google_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "google_client_id", CID)
    google.set_test_keys(JWKS)
    yield
    google.set_test_keys(None)


def err(r):
    return r.json()["error"]["code"]


async def go(c, tok=None, **body):
    return await c.post("/api/auth/google", json={"credential": tok or token(), **body})


# ---------- the token checks ----------


@pytest.mark.parametrize(
    "tok",
    [
        pytest.param(lambda: token(aud="someone-else.apps.googleusercontent.com"), id="bad audience"),
        pytest.param(lambda: token(iss="https://evil.example.com"), id="bad issuer"),
        pytest.param(lambda: token(exp=int(time.time()) - 600, iat=int(time.time()) - 4200), id="expired"),
        pytest.param(lambda: token(iat=int(time.time()) + 600), id="issued in the future"),
        pytest.param(lambda: token(key=OTHER_KEY), id="bad signature"),
        pytest.param(lambda: token(kid="unknown"), id="unknown kid"),
        pytest.param(lambda: token(alg="HS256"), id="not RS256"),
        pytest.param(lambda: token()[:-6] + "AAAAAA", id="tampered"),
        pytest.param(lambda: "not.a.jwt", id="garbage"),
        pytest.param(lambda: token(sub=None), id="no sub"),
    ],
)
async def test_bad_tokens_are_refused(client, db, tok):
    r = await go(client, tok())
    assert r.status_code == 400 and err(r) == "google_invalid"
    assert await db[USERS].count_documents({}) == 0
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_unverified_google_email_is_refused(client, db):
    r = await go(client, token(email_verified=False))
    assert r.status_code == 400 and err(r) == "google_unverified"
    assert "isn’t verified" in r.json()["error"]["message"]
    assert await db[USERS].count_documents({}) == 0


async def test_off_without_a_client_id(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "google_client_id", "")
    assert (await go(client)).status_code == 404
    assert (await client.get("/api/public/site-flags")).json()["googleClientId"] == ""


async def test_small_leeway_and_plain_issuer_accepted(client):
    t = int(time.time())
    r = await go(client, token(iss="accounts.google.com", exp=t - 30, iat=t - 3630))
    assert r.status_code == 200


async def test_failed_tries_are_rate_limited(client):
    for _ in range(30):
        await go(client, token(key=OTHER_KEY))
    r = await go(client)
    assert r.status_code == 429


async def test_keys_cached_by_max_age_and_refetched_for_an_unknown_kid(monkeypatch):
    google.set_test_keys(None)
    calls = []

    async def fetch():
        calls.append(1)
        keys = [jwk(KEY, "k1")] + ([jwk(OTHER_KEY, "k2")] if len(calls) > 1 else [])
        return {"keys": keys}, 21600

    monkeypatch.setattr(google, "fetch_jwks", fetch)
    monkeypatch.setattr(google, "MIN_REFETCH", 0)
    assert google.max_age("public, max-age=21600, must-revalidate") == 21600
    assert (await google.verify(token())).sub == "g-100"
    assert (await google.verify(token())).email == "asha@gmail.com"
    assert len(calls) == 1  # cached
    assert (await google.verify(token(key=OTHER_KEY, kid="k2"))).sub == "g-100"  # Google rotated its keys
    assert len(calls) == 2


def test_test_keys_from_the_environment_never_work_in_production(monkeypatch):
    google.set_test_keys(None)
    monkeypatch.setattr(get_settings(), "google_test_jwks", json.dumps(JWKS))
    monkeypatch.setattr(get_settings(), "app_env", "prod")
    google._load_env_keys()
    assert not google._cache.fixed and google._cache.keys == {}
    monkeypatch.setattr(get_settings(), "app_env", "dev")
    google._load_env_keys()
    assert google._cache.fixed and "k1" in google._cache.keys


async def test_test_client_id_only_outside_production(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "google_client_id", "")
    monkeypatch.setattr(get_settings(), "google_test_client_id", CID)
    assert (await client.get("/api/public/site-flags")).json()["googleClientId"] == ""  # never shown
    monkeypatch.setattr(get_settings(), "app_env", "prod")
    assert (await go(client)).status_code == 404
    monkeypatch.setattr(get_settings(), "app_env", "test")
    assert (await go(client)).status_code == 200


# ---------- new accounts ----------


async def test_new_job_seeker_signs_up_with_google(client, db, outbox):
    r = await go(client, role="customer", next="/me/jobs")
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["isNew"] and me["role"] == "customer" and me["verified"] and me["hasPassword"] is False
    assert me["google"]["email"] == "asha@gmail.com" and me["name"] == "Asha Rao"
    assert (await client.get("/api/auth/me")).json()["id"] == me["id"]
    u = await db[USERS].find_one({"_id": me["id"]})
    assert u["terms_accepted_at"] and u["email_verified_at"] and u["password_hash"] == ""
    assert outbox.sent == []  # no code step: Google proved the address
    # the next time it is a plain sign-in
    again = await go(client)
    assert again.status_code == 200 and again.json()["isNew"] is False and again.json()["id"] == me["id"]
    assert await db[USERS].count_documents({}) == 1


async def test_new_expert_and_default_role(make_client, db):
    a = (await go(make_client(), token(sub="g-e", email="exp@gmail.com"), role="expert")).json()
    assert a["role"] == "expert" and a["expertStatus"] == "draft"
    b = (await go(make_client(), token(sub="g-c", email="cust@gmail.com"))).json()
    assert b["role"] == "customer"  # the sign-up page's default
    assert (await go(make_client(), role="admin")).status_code == 422


async def test_only_sub_email_name_picture_are_stored(client, db):
    tok = token()
    me = (await go(client, tok, role="customer")).json()
    u = await db[USERS].find_one({"_id": me["id"]})
    assert set(u["google"]) == {"sub", "email", "name", "picture", "linked_at"}
    assert u["google"]["sub"] == "g-100" and u["google"]["picture"].startswith("https://")
    flat = json.dumps(u, default=str)
    assert tok not in flat and tok.split(".")[2] not in flat and "nonce" not in flat and '"hd"' not in flat
    async for row in db[AUDIT_LOG].find({}):
        assert tok.split(".")[1] not in json.dumps(row, default=str)


async def test_new_google_user_goes_through_the_same_consent_and_under_18_gate(make_client, db, outbox, client):
    c = make_client()
    me = (await go(c, token(sub="g-kid", email="kid@gmail.com", name="Chintu S"), role="customer")).json()
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "kid@gmail.com"}}, upsert=True)
    privacy = (await c.get("/api/me/trust/privacy")).json()
    assert privacy["age"]["checked"] is False  # asked for the date of birth like every new account
    dob = now().date().replace(year=now().year - 15)
    st = (await c.post("/api/me/trust/age", json={"dob": dob.isoformat()})).json()
    assert st["minor"] and st["parent"] is None
    r = await c.post("/api/me/trust/consents/ai_interview")
    assert r.status_code == 403 and err(r) == "parent_needed"
    await c.post("/api/me/trust/parent", json={"email": "amma@example.com", "name": "Lakshmi"})
    tok = re.search(r"#k=parent&t=([A-Za-z0-9_-]+)", outbox.sent[-1].text).group(1)
    ok = await client.post(
        "/api/public/trust/parent/confirm",
        json={"token": tok, "parentName": "Lakshmi S", "relation": "mother", "agree": True},
    )
    assert ok.status_code == 200
    assert (await c.post("/api/me/trust/consents/ai_interview")).json()["status"] == "granted"
    assert me["id"]


# ---------- existing accounts ----------


async def test_links_to_the_existing_verified_account_no_duplicate(make_client, db, outbox):
    c = make_client()
    mine = await signup(c, outbox, email="Asha@Gmail.com", name="Asha R")
    g = make_client()
    r = await go(g)
    assert r.status_code == 200 and r.json()["id"] == mine["id"] and r.json()["isNew"] is False
    assert await db[USERS].count_documents({}) == 1
    u = await db[USERS].find_one({"_id": mine["id"]})
    assert u["google"]["sub"] == "g-100" and u["password_hash"]  # the password still works
    assert u["name"] == "Asha R"
    assert (await c.post("/api/auth/login", json={"email": "asha@gmail.com", "password": PASSWORD})).status_code == 200


async def test_existing_unverified_account_is_linked_and_marked_verified(make_client, db, outbox):
    c = make_client()
    await signup(c, outbox, email="asha@gmail.com", name="Someone Else", verify=False)
    before = await db[USERS].find_one({"email_lc": "asha@gmail.com"})
    assert before["email_verified_at"] is None and before["unverified_expires_at"]
    r = await go(make_client())
    assert r.status_code == 200 and r.json()["id"] == before["_id"] and r.json()["verified"] and r.json()["isNew"]
    u = await db[USERS].find_one({"_id": before["_id"]})
    assert u["email_verified_at"] and "unverified_expires_at" not in u and "signup_token_hash" not in u
    # whoever typed a password at the unconfirmed sign-up never proved the address: that password is gone
    assert u["password_hash"] == "" and u["name"] == "Asha Rao"
    bad = await make_client().post("/api/auth/login", json={"email": "asha@gmail.com", "password": PASSWORD})
    assert bad.status_code == 401
    assert await db[USERS].count_documents({}) == 1


async def test_account_linked_to_a_different_google_account_is_refused(make_client, db, outbox):
    await signup(make_client(), outbox, email="asha@gmail.com")
    assert (await go(make_client(), token(sub="g-1"))).status_code == 200
    r = await go(make_client(), token(sub="g-2"))
    assert r.status_code == 409 and err(r) == "google_other_account"
    assert (await db[USERS].find_one({"email_lc": "asha@gmail.com"}))["google"]["sub"] == "g-1"


async def test_disabled_account_refused(make_client, db, outbox):
    me = await signup(make_client(), outbox, email="asha@gmail.com")
    await db[USERS].update_one({"_id": me["id"]}, {"$set": {"disabled_at": now()}})
    r = await go(make_client())
    assert r.status_code == 403 and err(r) == "account_disabled"


# ---------- admins and two-step ----------


async def test_admin_can_never_use_google(client, db):
    admin, _secret, _codes = await create_admin(db, "owner@gmail.com", "Naresh", "owner", PASSWORD)
    r = await go(client, token(sub="g-admin", email="owner@gmail.com"))
    assert r.status_code == 403 and err(r) == "use_admin_login"
    assert r.json()["error"]["message"] == "Use your password to sign in to admin."
    assert await db[SESSIONS].count_documents({"user_id": admin.id}) == 0
    assert not (await db[USERS].find_one({"_id": admin.id})).get("google")
    # even if a Google link were put on an admin somehow, it opens nothing
    await db[USERS].update_one({"_id": admin.id}, {"$set": {"google": {"sub": "g-admin", "email": "x@gmail.com"}}})
    r = await go(client, token(sub="g-admin", email="x@gmail.com"))
    assert r.status_code == 403 and err(r) == "use_admin_login"
    assert await db[SESSIONS].count_documents({"user_id": admin.id}) == 0


async def test_two_step_account_never_skips_its_code(make_client, db, outbox):
    me = await signup(make_client(), outbox, email="asha@gmail.com")
    await db[USERS].update_one({"_id": me["id"]}, {"$set": {"totp_secret_enc": encrypt("JBSWY3DPEHPK3PXP")}})
    c = make_client()
    r = await go(c)
    assert r.status_code == 403 and err(r) == "use_password_login"
    assert (await c.get("/api/auth/me")).status_code == 401


async def test_admin_cannot_connect_google_in_settings(make_client, db):
    import pyotp

    from tests.test_admin_auth import password_step

    _admin, secret, _ = await create_admin(db, "ops@nm7.si", "Ops", "ops", PASSWORD)
    c = make_client()
    await password_step(c, "ops@nm7.si")
    await c.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(secret).now()})
    r = await c.post("/api/auth/google/link", json={"credential": token(email="ops@gmail.com")})
    assert r.status_code == 403 and err(r) == "use_admin_login"


# ---------- Settings: connect / remove ----------


async def test_settings_connect_and_remove_with_a_password(client, db, outbox):
    me = await signup(client, outbox, email="sai@example.com")
    assert me["google"] is None and me["hasPassword"] is True
    r = await client.post("/api/auth/google/link", json={"credential": token(email="sai.other@gmail.com")})
    assert r.status_code == 200 and r.json()["google"]["email"] == "sai.other@gmail.com"
    # a different Google address is fine: it signs in to this account by its Google ID
    assert (await client.get("/api/auth/me")).json()["google"]["email"] == "sai.other@gmail.com"
    r = await client.delete("/api/auth/google")
    assert r.status_code == 200 and r.json()["google"] is None
    assert "google" not in await db[USERS].find_one({"_id": me["id"]})


async def test_unlink_blocked_for_the_last_way_to_sign_in(client, db, outbox):
    me = (await go(client, role="customer")).json()
    r = await client.delete("/api/auth/google")
    assert r.status_code == 400 and err(r) == "set_password_first"
    assert (await db[USERS].find_one({"_id": me["id"]}))["google"]
    r = await client.post(
        "/api/auth/password/change",
        json={"currentPassword": "x", "password": "Newpass2026", "passwordConfirm": "Newpass2026"},
    )
    assert r.status_code == 400 and err(r) == "no_password"
    # setting a password reuses Forgot password (the code goes to the account's email)
    await client.post("/api/auth/password/forgot", json={"email": "asha@gmail.com"})
    code = outbox.last_code("asha@gmail.com")
    r = await client.post(
        "/api/auth/password/reset",
        json={"email": "asha@gmail.com", "code": code, "password": "Newpass2026", "passwordConfirm": "Newpass2026"},
    )
    assert r.status_code == 200
    await client.post("/api/auth/login", json={"email": "asha@gmail.com", "password": "Newpass2026"})
    assert (await client.delete("/api/auth/google")).status_code == 200


async def test_connect_refused_when_that_google_account_is_on_another_account(make_client, db, outbox):
    await go(make_client(), role="customer")  # asha@gmail.com, g-100
    c = make_client()
    await signup(c, outbox, email="sai@example.com")
    r = await c.post("/api/auth/google/link", json={"credential": token()})
    assert r.status_code == 409 and err(r) == "google_taken"


async def test_no_password_never_matches_the_empty_hash(client, db):
    from app.core.security import verify_password

    assert await verify_password("", "not-a-real-password-1") is False
    await go(client, role="customer")
    r = await client.post("/api/auth/login", json={"email": "asha@gmail.com", "password": "not-a-real-password-1"})
    assert r.status_code == 401


async def test_deleting_the_account_removes_the_google_link(client, db):
    from app.me.erase import erase_account

    me = (await go(client, role="customer")).json()
    await erase_account(db, me["id"])
    assert "google" not in await db[USERS].find_one({"_id": me["id"]})
    from app.trust import retention as R

    assert "google_link" in R.TYPES
