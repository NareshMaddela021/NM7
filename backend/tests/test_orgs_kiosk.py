"""Nm7 for Organizations (Phase 3A): per-organization feature switches and kiosk mode — hashed links and PINs,
expiry, revocation, the emailed sign-in code (expiry, tries, reuse), kiosk sign-ins, joins, prints and limits."""

from datetime import timedelta

import pytest

from app.core import rate_limit
from app.core.db import AUDIT_LOG, EMAIL_CODES, KIOSKS, MEMBERSHIPS, SESSIONS, USERS
from app.core.security import keyed_hash
from app.core.time import IST, now
from tests.conftest import PASSWORD, signup
from tests.test_orgs import RESUME, setup_group
from tests.test_orgs_phase2 import coordinator, second_org


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def features(owner, org_id, **on):
    r = await owner.put(f"/api/admin/orgs/{org_id}/features", json=on)
    assert r.status_code == 200, r.text
    return r.json()["features"]


async def make_kiosk(c, org_id, group_id, label="Stall 1", pin="2468", **extra):
    r = await c.post(f"/api/org/{org_id}/kiosks", json={"groupId": group_id, "label": label, "pin": pin, **extra})
    assert r.status_code == 201, r.text
    k = r.json()
    return k, k["url"].rsplit("/", 1)[1]


async def kiosk_login(c, outbox, token, email="asha@example.com", name="Asha Rao"):
    r = await c.post(f"/api/kiosk/{token}/code", json={"email": email})
    assert r.status_code == 200, r.text
    r = await c.post(
        f"/api/kiosk/{token}/verify",
        json={"email": email, "code": outbox.last_code(email), "name": name, "terms": True},
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
async def setup(owner):
    org, g = await setup_group(owner)
    await features(owner, org["id"], kiosk=True)
    return org, g


# ---------- feature switches ----------


async def test_features_default_off_and_only_the_super_admin_switches_them(owner, admin_client, make_client, outbox):
    org, g = await setup_group(owner)
    assert org["features"] == {"kiosk": False, "branding": False, "recruiterLinks": False}
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    ops = await admin_client("ops")
    for who in (c, ops):
        assert (await who.put(f"/api/admin/orgs/{org['id']}/features", json={"kiosk": True})).status_code == 403
    # switched off: kiosks don't exist (404), for coordinators and for the kiosk screen
    assert (await c.get(f"/api/org/{org['id']}/kiosks")).status_code == 404
    body = {"groupId": g["id"], "label": "Stall 1", "pin": "2468"}
    assert (await c.post(f"/api/org/{org['id']}/kiosks", json=body)).status_code == 404
    assert (await c.get(f"/api/org/{org['id']}")).json()["features"]["kiosk"] is False

    assert (await features(owner, org["id"], kiosk=True))["kiosk"] is True
    k, token = await make_kiosk(c, org["id"], g["id"])
    assert (await make_client().get(f"/api/kiosk/{token}")).status_code == 200
    # switched off again: the existing link and every staff endpoint answer 404
    await features(owner, org["id"], kiosk=False)
    assert (await make_client().get(f"/api/kiosk/{token}")).status_code == 404
    assert (await c.get(f"/api/org/{org['id']}/kiosks")).status_code == 404
    assert (await c.post(f"/api/org/{org['id']}/kiosks/{k['id']}/revoke")).status_code == 404
    entries = await owner.get("/api/admin/org-audit")
    assert [e["details"] for e in entries.json() if e["action"] == "org_features"][:2] == [
        {"kiosk": False},
        {"kiosk": True},
    ]


# ---------- creating and revoking ----------


async def test_kiosk_links_and_pins_are_stored_hashed_and_expire_by_default_tonight(setup, owner, db, make_client):
    org, g = setup
    k, token = await make_kiosk(owner, org["id"], g["id"], pin="135790")
    doc = await db[KIOSKS].find_one({"_id": k["id"]})
    assert token not in str(doc) and "135790" not in str(doc)
    assert doc["token_hash"] == keyed_hash("kiosk", token)
    end = doc["expires_at"].astimezone(IST)
    assert end.date() == now().astimezone(IST).date() and (end.hour, end.minute) == (23, 59)
    assert k["state"] == "idle" and k["label"] == "Stall 1" and k["groupName"] == g["name"]
    info = (await make_client().get(f"/api/kiosk/{token}")).json()
    assert info["org"]["name"] == "JNTU Anantapur" and info["group"]["name"] == g["name"]
    assert info["label"] == "Stall 1" and info["consentText"].startswith("My resume will be shared")
    listed = (await owner.get(f"/api/org/{org['id']}/kiosks")).json()
    assert listed[0]["state"] == "active"  # the screen just checked in
    assert "url" not in listed[0]  # the link is shown once, when made


async def test_expiry_limits_and_pin_rules(setup, owner):
    org, g = setup
    base = {"groupId": g["id"], "label": "Stall 2", "pin": "1234"}
    day = lambda n: (now().astimezone(IST).date() + timedelta(days=n)).isoformat()  # noqa: E731
    assert (await owner.post(f"/api/org/{org['id']}/kiosks", json={**base, "expiresOn": day(2)})).status_code == 201
    r = await owner.post(f"/api/org/{org['id']}/kiosks", json={**base, "expiresOn": day(3)})
    assert r.status_code == 400 and err(r) == "bad_expiry"
    assert (await owner.post(f"/api/org/{org['id']}/kiosks", json={**base, "expiresOn": day(-1)})).status_code == 400
    for pin in ("123", "1234567", "12a4"):
        assert (await owner.post(f"/api/org/{org['id']}/kiosks", json={**base, "pin": pin})).status_code == 422


async def test_expired_and_revoked_links_end_at_once_including_signed_in_candidates(
    setup, owner, db, make_client, outbox
):
    org, g = setup
    k, token = await make_kiosk(owner, org["id"], g["id"])
    c = make_client()
    await kiosk_login(c, outbox, token)
    assert (await c.get("/api/auth/me")).status_code == 200
    r = await owner.post(f"/api/org/{org['id']}/kiosks/{k['id']}/revoke")
    assert r.json()["state"] == "revoked"
    assert (await c.get("/api/auth/me")).status_code == 401  # signed out with the kiosk
    r = await make_client().get(f"/api/kiosk/{token}")
    assert r.status_code == 410 and err(r) == "kiosk_ended"

    k2, token2 = await make_kiosk(owner, org["id"], g["id"], label="Stall 2")
    await db[KIOSKS].update_one({"_id": k2["id"]}, {"$set": {"expires_at": now() - timedelta(seconds=1)}})
    assert err(await make_client().get(f"/api/kiosk/{token2}")) == "kiosk_ended"
    assert (await make_client().get("/api/kiosk/not-a-real-token")).status_code == 404
    actions = [e["action"] async for e in db[AUDIT_LOG].find({"target": k["id"]}).sort("_id", 1)]
    assert actions == ["kiosk_create", "kiosk_session", "kiosk_revoke"]


async def test_viewers_see_kiosks_but_cant_create_or_revoke(setup, owner, make_client, outbox):
    org, g = setup
    k, _ = await make_kiosk(owner, org["id"], g["id"])
    v, _ = await coordinator(owner, make_client, outbox, org["id"], "viewer@example.com", role="viewer")
    assert len((await v.get(f"/api/org/{org['id']}/kiosks")).json()) == 1
    body = {"groupId": g["id"], "label": "Mine", "pin": "1111"}
    assert (await v.post(f"/api/org/{org['id']}/kiosks", json=body)).status_code == 403
    assert (await v.post(f"/api/org/{org['id']}/kiosks/{k['id']}/revoke")).status_code == 403


async def test_org_a_staff_cant_reach_org_b_kiosks(setup, owner, make_client, outbox):
    org, g = setup
    org_b, g_b = await second_org(owner)
    await features(owner, org_b["id"], kiosk=True)
    kb, _ = await make_kiosk(owner, org_b["id"], g_b["id"])
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    assert (await c.get(f"/api/org/{org_b['id']}/kiosks")).status_code == 404
    assert (await c.post(f"/api/org/{org['id']}/kiosks/{kb['id']}/revoke")).status_code == 404
    body = {"groupId": g_b["id"], "label": "x", "pin": "1111"}
    assert (await c.post(f"/api/org/{org['id']}/kiosks", json=body)).status_code == 404
    # a coordinator limited to some groups sees only those groups' kiosks
    g2 = (await owner.post(f"/api/admin/orgs/{org['id']}/groups", json={"name": "MBA 2026", "code": "MBA26"})).json()
    await make_kiosk(owner, org["id"], g2["id"], label="MBA stall")
    limited, _ = await coordinator(owner, make_client, outbox, org["id"], "lim@example.com", group_ids=[g["id"]])
    assert [x["label"] for x in (await limited.get(f"/api/org/{org['id']}/kiosks")).json()] == []
    await make_kiosk(owner, org["id"], g["id"], label="Main stall")
    assert [x["label"] for x in (await limited.get(f"/api/org/{org['id']}/kiosks")).json()] == ["Main stall"]


# ---------- the emailed code ----------


async def test_code_login_creates_an_account_and_a_short_kiosk_session(setup, owner, db, make_client, outbox):
    org, g = setup
    k, token = await make_kiosk(owner, org["id"], g["id"])
    c = make_client()
    r = await c.post(f"/api/kiosk/{token}/code", json={"email": "New.Person@example.com"})
    assert r.json() == {"sent": True, "newAccount": True}
    mail = outbox.sent[-1]
    assert "JNTU Anantapur" in mail.text and "kiosk" in mail.subject
    code = outbox.last_code("New.Person@example.com")
    stored = await db[EMAIL_CODES].find_one({"purpose": "kiosk"})
    assert code not in str(stored)
    body = {"email": "new.person@example.com", "code": code, "name": " ", "terms": True}
    assert err(await c.post(f"/api/kiosk/{token}/verify", json=body)) == "name_required"
    body["name"] = "New  Person"
    assert err(await c.post(f"/api/kiosk/{token}/verify", json={**body, "terms": False})) == "terms_required"
    r = await c.post(f"/api/kiosk/{token}/verify", json=body)  # the same code still works
    assert r.status_code == 200 and r.json()["name"] == "New Person" and r.json()["newAccount"] is True
    assert (await c.get("/api/me/state")).status_code == 200  # signed in as a normal customer account
    assert (await c.post(f"/api/kiosk/{token}/code", json={"email": "x@example.com"})).status_code == 200
    assert (await c.post(f"/api/kiosk/{token}/code", json={"email": "x@example.com"})).status_code == 429  # 1/min


async def test_code_expiry_tries_and_reuse(setup, owner, db, make_client, outbox):
    org, g = setup
    _, token = await make_kiosk(owner, org["id"], g["id"])
    c = make_client()
    await c.post(f"/api/kiosk/{token}/code", json={"email": "asha@example.com"})
    code = outbox.last_code("asha@example.com")
    good = {"email": "asha@example.com", "code": code, "name": "Asha Rao", "terms": True}
    wrong = {**good, "code": "000000" if code != "000000" else "111111"}
    for _ in range(5):
        assert err(await c.post(f"/api/kiosk/{token}/verify", json=wrong)) == "invalid_code"
    assert err(await c.post(f"/api/kiosk/{token}/verify", json=good)) == "invalid_code"  # 5 tries used up

    await db["rate_events"].delete_many({"key": rate_limit.stored("code:asha@example.com")})
    await c.post(f"/api/kiosk/{token}/code", json={"email": "asha@example.com"})
    good["code"] = outbox.last_code("asha@example.com")
    await db[EMAIL_CODES].update_many({"purpose": "kiosk", "used_at": None}, {"$set": {"expires_at": now()}})
    assert err(await c.post(f"/api/kiosk/{token}/verify", json=good)) == "invalid_code"  # expired

    await db["rate_events"].delete_many({"key": rate_limit.stored("code:asha@example.com")})
    await c.post(f"/api/kiosk/{token}/code", json={"email": "asha@example.com"})
    good["code"] = outbox.last_code("asha@example.com")
    r = await c.post(f"/api/kiosk/{token}/verify", json=good)
    assert r.status_code == 200 and r.json()["newAccount"] is True
    u = await db[USERS].find_one({"email_lc": "asha@example.com"})
    assert u["role"] == "customer" and u["email_verified_at"] and u["terms_accepted_at"]
    s = await db[SESSIONS].find_one({"user_id": u["_id"]})
    assert s["kiosk_id"] and s["expires_at"] - now() < timedelta(minutes=46)
    assert err(await make_client().post(f"/api/kiosk/{token}/verify", json=good)) == "invalid_code"  # used once


async def test_existing_accounts_sign_in_with_the_code_staff_accounts_cant(setup, owner, db, make_client, outbox):
    org, g = setup
    _, token = await make_kiosk(owner, org["id"], g["id"])
    await signup(make_client(), outbox, "old@example.com", name="Old Member")
    expert = make_client()
    await signup(expert, outbox, "exp@example.com", role="expert", name="Ex Pert")
    c = make_client()
    r = await c.post(f"/api/kiosk/{token}/code", json={"email": "exp@example.com"})
    assert r.status_code == 403 and err(r) == "not_customer"
    assert (await c.post(f"/api/kiosk/{token}/code", json={"email": "owner@nm7.si"})).status_code == 403
    await db["rate_events"].delete_many({})  # sign-up just emailed this address a code
    me = await kiosk_login(c, outbox, token, "old@example.com", name="")
    assert me["newAccount"] is False and me["name"] == "Old Member" and me["membership"] is None

    # an address signed up but never confirmed: the code proves it, and the unconfirmed password stops working
    await signup(make_client(), outbox, "squat@example.com", name="Someone Else", verify=False)
    await db["rate_events"].delete_many({})
    me = await kiosk_login(make_client(), outbox, token, "squat@example.com", name="")
    r = await make_client().post("/api/auth/login", json={"email": "squat@example.com", "password": PASSWORD})
    assert r.status_code == 401


async def test_code_rate_limits_per_kiosk(setup, owner, db, make_client, outbox):
    org, g = setup
    k, token = await make_kiosk(owner, org["id"], g["id"])
    t = now()
    key = rate_limit.stored(f"kiosk-code:{k['id']}")
    await db["rate_events"].insert_many([{"key": key, "at": t} for _ in range(120)])
    r = await make_client().post(f"/api/kiosk/{token}/code", json={"email": "a1@example.com"})
    assert r.status_code == 429


# ---------- joining, printing, leaving the kiosk ----------


async def test_kiosk_join_print_and_approval_rules(owner, db, make_client, outbox):
    org, g = await setup_group(owner, settings={"requireApproval": True})
    await features(owner, org["id"], kiosk=True)
    k, token = await make_kiosk(owner, org["id"], g["id"])
    c = make_client()
    await kiosk_login(c, outbox, token)
    assert (await c.post("/api/me/resumes", json={"id": "k1", "name": "Kiosk", "data": RESUME})).status_code == 201
    body = {"consent": False, "fields": {"roll": "21A01", "branch": "CSE"}, "resumeId": "k1"}
    assert err(await c.post(f"/api/kiosk/{token}/join", json=body)) == "consent_required"
    r = await c.post(f"/api/kiosk/{token}/join", json={**body, "consent": True})
    assert r.status_code == 201 and r.json()["approval"] == "pending"
    assert (await c.post(f"/api/kiosk/{token}/print")).json() == {"ok": True}  # their own copy, even while Pending
    join = await db[AUDIT_LOG].find_one({"action": "member_join"})
    assert join["data"]["kiosk"] == k["id"]
    listed = (await owner.get(f"/api/org/{org['id']}/kiosks")).json()[0]
    assert (listed["sessionsToday"], listed["printsToday"]) == (1, 1)
    m = await db[MEMBERSHIPS].find_one({})
    assert m["approval"] == "pending" and m["consent"]["given"] is True

    # signing in again at the kiosk finds the membership (to keep editing the same resume)
    c2 = make_client()
    await db["rate_events"].delete_many({})
    again = await kiosk_login(c2, outbox, token)
    assert again["membership"] == {"resumeId": "k1", "approval": "pending"}
    # the coordinator's audit shows the kiosk actions
    acts = {e["action"] for e in (await owner.get(f"/api/org/{org['id']}/audit")).json()}
    assert {"kiosk_create", "kiosk_session", "kiosk_print", "member_join"} <= acts


async def test_kiosk_actions_need_a_sign_in_at_that_kiosk(setup, owner, make_client, outbox):
    org, g = setup
    _, token = await make_kiosk(owner, org["id"], g["id"])
    _, token2 = await make_kiosk(owner, org["id"], g["id"], label="Stall 2")
    anon = make_client()
    assert (await anon.post(f"/api/kiosk/{token}/print")).status_code == 401
    normal = make_client()
    await signup(normal, outbox, "web@example.com")
    r = await normal.post(f"/api/kiosk/{token}/print")
    assert r.status_code == 401 and err(r) == "not_signed_in"  # a normal session isn't a kiosk sign-in
    c = make_client()
    await kiosk_login(c, outbox, token)
    assert (await c.post(f"/api/kiosk/{token2}/print")).status_code == 401  # another kiosk's sign-in


async def test_exit_pin_is_checked_and_rate_limited(setup, owner, make_client):
    org, g = setup
    _, token = await make_kiosk(owner, org["id"], g["id"], pin="9876")
    c = make_client()
    assert err(await c.post(f"/api/kiosk/{token}/exit", json={"pin": "1111"})) == "wrong_pin"
    assert (await c.post(f"/api/kiosk/{token}/exit", json={"pin": "9876"})).json() == {"ok": True}
    for _ in range(5):
        await c.post(f"/api/kiosk/{token}/exit", json={"pin": "0000"})
    assert (await c.post(f"/api/kiosk/{token}/exit", json={"pin": "9876"})).status_code == 429


async def test_continue_link_signs_in_once_on_the_phone(setup, owner, db, make_client, outbox):
    org, g = setup
    _, token = await make_kiosk(owner, org["id"], g["id"])
    c = make_client()
    await kiosk_login(c, outbox, token)
    assert (await c.post(f"/api/kiosk/{token}/send-link")).json() == {"sent": True}
    link = outbox.sent[-1].text.split("/continue?t=")[1].split()[0]
    assert link not in str(await db[EMAIL_CODES].find_one({"purpose": "continue"}))
    phone = make_client()
    assert (await phone.post("/api/public/continue", json={"token": link})).json() == {"ok": True}
    me = await phone.get("/api/auth/me")
    assert me.json()["email"] == "asha@example.com"
    s = await db[SESSIONS].find_one({"user_id": me.json()["id"], "kiosk_id": None})
    assert s["expires_at"] - now() > timedelta(days=29)  # a normal sign-in on their own phone
    r = await make_client().post("/api/public/continue", json={"token": link})
    assert r.status_code == 404 and err(r) == "link_invalid"
    for _ in range(2):
        await c.post(f"/api/kiosk/{token}/send-link")
    assert (await c.post(f"/api/kiosk/{token}/send-link")).status_code == 429
