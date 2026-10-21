import re
from datetime import timedelta

from app.auth.models import User
from app.core.db import EMAIL_CODES, RATE_EVENTS, SESSIONS, USERS
from app.core.security import hash_password
from app.core.time import now
from tests.conftest import PASSWORD, signup

NEW_PW = "Fresh2026pass"


def err(r):
    return r.json()["error"]["code"]


async def clear_limits(db):
    await db[RATE_EVENTS].delete_many({})


# ---------- sign-up & email verification ----------


async def signup_raw(client, email="sai@example.com"):
    body = {
        "role": "customer",
        "name": "Sai",
        "email": email,
        "password": PASSWORD,
        "passwordConfirm": PASSWORD,
        "termsAccepted": True,
    }
    return await client.post("/api/auth/signup", json=body)


async def test_signup_sends_code_and_verify_signs_in(client, outbox):
    r = await client.post(
        "/api/auth/signup",
        json={
            "role": "customer",
            "name": "  Sai   Varsha ",
            "email": "Sai@Example.com",
            "phone": "98765 43210",
            "password": PASSWORD,
            "passwordConfirm": PASSWORD,
            "termsAccepted": True,
        },
    )
    assert r.status_code == 201
    assert r.json() == {"email": "Sai@example.com", "codeSent": True}
    assert len(outbox.sent) == 1 and "Nm7 code" in outbox.sent[0].subject

    assert (await client.get("/api/auth/me")).status_code == 401
    r = await client.post("/api/auth/verify-email", json={"email": "sai@example.com", "code": "000000"})
    assert r.status_code == 400 and err(r) == "invalid_code"

    code = outbox.last_code("sai@example.com")
    r = await client.post("/api/auth/verify-email", json={"email": "sai@example.com", "code": code})
    assert r.status_code == 200
    user = r.json()
    assert user["verified"] is True and user["name"] == "Sai Varsha" and user["phone"] == "+91 98765 43210"
    assert user["role"] == "customer" and user["expertStatus"] is None
    assert "nm7_session" in r.cookies

    me = await client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["id"] == user["id"]

    # The code is used up.
    r = await client.post("/api/auth/verify-email", json={"email": "sai@example.com", "code": code})
    assert r.status_code == 400


async def test_expert_signup_starts_as_draft(client, outbox):
    user = await signup(client, outbox, email="ravi@example.com", role="expert", name="Ravi")
    assert user["role"] == "expert" and user["expertStatus"] == "draft"


async def test_signup_rejects_bad_input(client):
    base = {
        "role": "customer",
        "name": "A",
        "email": "a@example.com",
        "password": PASSWORD,
        "passwordConfirm": PASSWORD,
        "termsAccepted": True,
    }
    cases = [
        ({"password": "short1", "passwordConfirm": "short1"}, "weak_password"),
        ({"password": "onlyletters", "passwordConfirm": "onlyletters"}, "weak_password"),
        ({"passwordConfirm": PASSWORD + "x"}, "password_mismatch"),
        ({"termsAccepted": False}, "terms_required"),
        ({"phone": "12345"}, "invalid_phone"),
        ({"name": "   "}, "name_required"),
    ]
    for patch, code in cases:
        r = await client.post("/api/auth/signup", json={**base, **patch})
        assert r.status_code == 400 and err(r) == code, (patch, r.text)
    r = await client.post("/api/auth/signup", json={**base, "email": "not-an-email"})
    assert r.status_code == 422 and err(r) == "invalid_input"
    r = await client.post("/api/auth/signup", json={**base, "role": "admin"})
    assert r.status_code == 422


async def test_signup_with_an_existing_email_looks_the_same_and_sends_a_reminder(client, outbox, make_client, db):
    """Nobody can use sign-up to find out who has an account: the answer is the fresh sign-up's "code sent", while
    the account's owner gets a sign-in reminder (no code), and nothing about the account changes."""
    await signup(client, outbox)
    await clear_limits(db)
    before = await db[USERS].find_one({"email_lc": "sai@example.com"})
    codes = await db[EMAIL_CODES].count_documents({"user_id": before["_id"]})
    r = await make_client().post(
        "/api/auth/signup",
        json={
            "role": "expert",
            "name": "X",
            "email": "SAI@example.com",
            "password": NEW_PW,
            "passwordConfirm": NEW_PW,
            "termsAccepted": True,
        },
    )
    assert r.status_code == 201 and r.json() == {"email": "sai@example.com", "codeSent": True}
    assert len(outbox.sent) == 2 and outbox.sent[-1].to == "sai@example.com"
    reminder = outbox.sent[-1]
    assert reminder.subject == "You already have an Nm7 account" and "/login" in reminder.text
    assert "Hi Sai Varsha" in reminder.text and not re.search(r"\b\d{6}\b", reminder.text)  # no code
    assert await db[EMAIL_CODES].count_documents({"user_id": before["_id"]}) == codes  # none made
    assert await db[USERS].find_one({"email_lc": "sai@example.com"}) == before  # name, role, password unchanged
    r = await client.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    assert r.status_code == 200
    # the same per-email limit as a fresh sign-up (one a minute), so the reminders can't be used to spam anyone
    r = await make_client().post(
        "/api/auth/signup",
        json={
            "role": "customer",
            "name": "X",
            "email": "sai@example.com",
            "password": PASSWORD,
            "passwordConfirm": PASSWORD,
            "termsAccepted": True,
        },
    )
    assert r.status_code == 429 and len(outbox.sent) == 2


async def test_unverified_signup_can_be_redone(client, outbox, db):
    await signup(client, outbox, verify=False, name="First")
    first_code = outbox.last_code("sai@example.com")
    # A second sign-up within a minute is rate limited…
    r = await client.post(
        "/api/auth/signup",
        json={
            "role": "expert",
            "name": "Second",
            "email": "sai@example.com",
            "password": NEW_PW,
            "passwordConfirm": NEW_PW,
            "termsAccepted": True,
        },
    )
    assert r.status_code == 429 and "Retry-After" in r.headers
    await clear_limits(db)
    # …afterwards it replaces the unverified account and the old code stops working.
    await signup(client, outbox, verify=False, name="Second", role="expert", password=NEW_PW, passwordConfirm=NEW_PW)
    r = await client.post("/api/auth/verify-email", json={"email": "sai@example.com", "code": first_code})
    assert r.status_code == 400
    code = outbox.last_code("sai@example.com")
    r = await client.post("/api/auth/verify-email", json={"email": "sai@example.com", "code": code})
    assert r.json()["name"] == "Second" and r.json()["role"] == "expert"
    assert (
        await client.post("/api/auth/login", json={"email": "sai@example.com", "password": NEW_PW})
    ).status_code == 200


async def test_code_stops_working_after_five_wrong_tries(client, outbox):
    await signup(client, outbox, verify=False)
    code = outbox.last_code("sai@example.com")
    wrong = "111111" if code != "111111" else "222222"
    for _ in range(5):
        r = await client.post("/api/auth/verify-email", json={"email": "sai@example.com", "code": wrong})
        assert r.status_code == 400
    r = await client.post("/api/auth/verify-email", json={"email": "sai@example.com", "code": code})
    assert r.status_code == 400


async def test_expired_code_is_refused(client, outbox, db):
    await signup(client, outbox, verify=False)
    await db[EMAIL_CODES].update_many({}, {"$set": {"expires_at": now() - timedelta(seconds=1)}})
    r = await client.post(
        "/api/auth/verify-email", json={"email": "sai@example.com", "code": outbox.last_code("sai@example.com")}
    )
    assert r.status_code == 400


async def test_resend_is_limited_and_never_reveals_accounts(client, outbox, db):
    await signup(client, outbox, verify=False)
    r = await client.post("/api/auth/verify-email/resend", json={"email": "sai@example.com"})
    assert r.status_code == 429  # sign-up just sent one
    await clear_limits(db)
    r = await client.post("/api/auth/verify-email/resend", json={"email": "sai@example.com"})
    assert r.status_code == 200 and len(outbox.sent) == 2
    r = await client.post("/api/auth/verify-email/resend", json={"email": "nobody@example.com"})
    assert r.status_code == 200 and len(outbox.sent) == 2


# ---------- login / logout ----------


async def test_login_logout(client, outbox, make_client):
    await signup(client, outbox)
    other = make_client()
    r = await other.post("/api/auth/login", json={"email": "SAI@example.com", "password": PASSWORD})
    assert r.status_code == 200 and r.json()["email"] == "sai@example.com"
    assert (await other.get("/api/auth/me")).status_code == 200

    assert (await other.post("/api/auth/logout")).status_code == 200
    assert (await other.get("/api/auth/me")).status_code == 401
    # The first browser is still signed in.
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_login_wrong_password_and_unknown_email_look_the_same(client, outbox):
    await signup(client, outbox)
    a = await client.post("/api/auth/login", json={"email": "sai@example.com", "password": "Wrong12345"})
    b = await client.post("/api/auth/login", json={"email": "who@example.com", "password": "Wrong12345"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


async def test_login_is_rate_limited_after_ten_failures(client, outbox):
    await signup(client, outbox)
    for _ in range(10):
        r = await client.post("/api/auth/login", json={"email": "sai@example.com", "password": "Wrong12345"})
        assert r.status_code == 401
    r = await client.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    assert r.status_code == 429 and err(r) == "rate_limited"


async def test_login_before_verifying_sends_a_new_code(client, outbox, db):
    await signup(client, outbox, verify=False)
    await clear_limits(db)
    r = await client.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    assert r.status_code == 403 and err(r) == "email_not_verified"
    assert len(outbox.sent) == 2
    # Within the same minute, no extra email.
    r = await client.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    assert r.status_code == 403 and len(outbox.sent) == 2


async def test_admins_and_disabled_accounts_cannot_use_customer_login(client, outbox, db):
    admin = User(
        email="admin@nm7.si",
        name="Owner",
        role="admin",
        admin_role="owner",
        password_hash=await hash_password(PASSWORD),
        email_verified_at=now(),
    )
    await db[USERS].insert_one(admin.to_mongo())
    r = await client.post("/api/auth/login", json={"email": "admin@nm7.si", "password": PASSWORD})
    assert r.status_code == 403 and err(r) == "use_admin_login"

    await signup(client, outbox)
    await db[USERS].update_one({"email_lc": "sai@example.com"}, {"$set": {"disabled_at": now()}})
    assert (await client.get("/api/auth/me")).status_code == 401  # existing session stops working
    r = await client.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    assert r.status_code == 403 and err(r) == "account_disabled"


async def test_session_expiry_slides_for_customers(client, outbox, db):
    await signup(client, outbox)
    old = now() - timedelta(hours=2)
    await db[SESSIONS].update_many({}, {"$set": {"last_seen_at": old, "expires_at": now() + timedelta(days=1)}})
    r = await client.get("/api/auth/me")
    assert r.status_code == 200 and "nm7_session" in r.headers.get("set-cookie", "")
    s = await db[SESSIONS].find_one({})
    assert s["expires_at"] > now() + timedelta(days=29)


async def test_expired_session_is_signed_out(client, outbox, db):
    await signup(client, outbox)
    await db[SESSIONS].update_many({}, {"$set": {"expires_at": now() - timedelta(seconds=1)}})
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_changes_from_other_sites_are_blocked(client, outbox):
    await signup(client, outbox)
    r = await client.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and err(r) == "bad_origin"
    r = await client.post("/api/auth/logout", headers={"Origin": ""})
    assert r.status_code == 403
    assert (await client.get("/api/auth/me")).status_code == 200


# ---------- forgot / reset password ----------


async def test_password_reset(client, outbox, db, make_client):
    await signup(client, outbox)
    await clear_limits(db)

    r = await make_client().post("/api/auth/password/forgot", json={"email": "nobody@example.com"})
    assert r.status_code == 200 and len(outbox.sent) == 1  # nothing sent, same answer

    browser = make_client()
    r = await browser.post("/api/auth/password/forgot", json={"email": "sai@example.com"})
    assert r.status_code == 200 and len(outbox.sent) == 2 and "reset" in outbox.sent[-1].subject
    code = outbox.last_code("sai@example.com")

    body = {"email": "sai@example.com", "code": "000000", "password": NEW_PW, "passwordConfirm": NEW_PW}
    assert err(await browser.post("/api/auth/password/reset", json=body)) == "invalid_code"
    body["code"] = code
    r = await browser.post("/api/auth/password/reset", json={**body, "passwordConfirm": "nope"})
    assert err(r) == "password_mismatch"
    r = await browser.post("/api/auth/password/reset", json=body)
    assert r.status_code == 200

    assert (await client.get("/api/auth/me")).status_code == 401  # old sessions signed out
    r = await browser.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    assert r.status_code == 401
    r = await browser.post("/api/auth/login", json={"email": "sai@example.com", "password": NEW_PW})
    assert r.status_code == 200


async def test_reset_also_verifies_an_unverified_email(client, outbox, db):
    await signup(client, outbox, verify=False)
    await clear_limits(db)
    await client.post("/api/auth/password/forgot", json={"email": "sai@example.com"})
    code = outbox.last_code("sai@example.com")
    body = {"email": "sai@example.com", "code": code, "password": NEW_PW, "passwordConfirm": NEW_PW}
    assert (await client.post("/api/auth/password/reset", json=body)).status_code == 200
    r = await client.post("/api/auth/login", json={"email": "sai@example.com", "password": NEW_PW})
    assert r.status_code == 200 and r.json()["verified"] is True


# ---------- ZeptoMail ----------
