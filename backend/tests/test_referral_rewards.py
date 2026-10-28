"""Referral rewards: 3 invited friends who confirm their email and build a named resume unlock the inviter's
downloads (as a paid resume plan would); "2 of 3" progress; one reward per account; the inviter's device or network
and disposable emails don't count; admin sees and revokes; admin turns it off / changes the number."""

import pytest

from app.core.db import REFERRAL_REWARDS, USERS
from app.me.rewards import disposable
from tests.conftest import signup

PDF = {"format": "pdf"}


def browser(make_client, ip):
    c = make_client()
    c.headers["X-Forwarded-For"] = ip
    return c


async def invited(make_client, outbox, code, n, *, ip="10.0.0.", email="f{i}@example.com", resume=True, start=0):
    out = []
    for i in range(start, start + n):
        c = browser(make_client, f"{ip}{i + 10}")
        await signup(c, outbox, email.format(i=i), name=f"Friend {i}", ref=code)
        if resume:
            body = {"id": "r1", "name": "Main", "data": {"personal": {"name": f"Friend {i}"}}}
            assert (await c.post("/api/me/resumes", json=body)).status_code == 201
        out.append(c)
    return out


@pytest.fixture
async def inviter(make_client, outbox, razorpay):
    c = browser(make_client, "192.168.1.5")
    await signup(c, outbox, "asha@example.com", name="Asha Rao")
    assert (await c.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": {}})).status_code == 201
    code = (await c.get("/api/me/referral")).json()["code"]
    return c, code


async def test_three_friends_unlock_downloads_once(inviter, make_client, outbox, db):
    c, code = inviter
    assert (await c.post("/api/me/exports", json=PDF)).status_code == 402
    await invited(make_client, outbox, code, 2)
    # a friend who never confirmed their email, and one with no named resume, don't count yet
    late = browser(make_client, "10.0.1.1")
    await signup(late, outbox, "late@example.com", name="Late Friend", ref=code, verify=False)
    await invited(make_client, outbox, code, 1, email="nores{i}@example.com", resume=False, start=7)
    ref = (await c.get("/api/me/referral")).json()
    assert ref["reward"] == {"on": True, "needed": 3, "counted": 2, "unlocked": False, "revoked": False, "at": None}
    whys = sorted(r["why"] or "" for r in ref["referrals"])
    assert whys == ["", "", "email_not_confirmed", "no_resume"]
    assert (await c.post("/api/me/exports", json=PDF)).status_code == 402
    # the third friend: downloads unlock, like the resume plan
    await invited(make_client, outbox, code, 1, start=2)
    ref = (await c.get("/api/me/referral")).json()["reward"]
    assert ref["counted"] == 3 and ref["unlocked"] is True and ref["at"]
    ent = (await c.get("/api/me/entitlements")).json()
    assert ent["reason"] == "referral"
    assert (await c.post("/api/me/exports", json=PDF)).status_code == 200
    # one reward per account
    await invited(make_client, outbox, code, 3, start=10)
    assert await db[REFERRAL_REWARDS].count_documents({}) == 1
    # friends see nothing of this, and a friend's own downloads aren't unlocked
    friend = (await invited(make_client, outbox, code, 1, start=20))[0]
    assert (await friend.post("/api/me/exports", json=PDF)).status_code == 402


async def test_same_device_network_and_disposable_emails_dont_count(inviter, make_client, outbox, db):
    c, code = inviter
    # the same browser as the inviter (their session cookie goes along)
    await signup(c, outbox, "alt1@example.com", name="Alt One", ref=code, verify=False)
    u = await db[USERS].find_one({"email": "alt1@example.com"})
    assert u["ref_flags"] == ["same_device"]
    # the inviter's network address
    await invited(make_client, outbox, code, 1, ip="192.168.1.", start=-5)  # 192.168.1.5
    # disposable inbox
    await invited(make_client, outbox, code, 1, email="x{i}@mailinator.com", start=30)
    await invited(make_client, outbox, code, 1, email="y{i}@sub.yopmail.com", start=31)
    ref = (await c.get("/api/me/referral")).json()
    assert ref["reward"]["counted"] == 0
    assert all(r["why"] == "not_eligible" for r in ref["referrals"] if r["name"] != "Alt")
    assert disposable("a@MAILINATOR.com") and not disposable("a@gmail.com")
    # no network address is stored for this
    assert "signup_ip" not in str(await db[USERS].find_one({"email": "x30@mailinator.com"}))


async def test_admin_sees_revokes_and_settings(inviter, make_client, outbox, admin_client, db):
    c, code = inviter
    owner = await admin_client("owner")
    # the number is admin-set: 2
    s = (await owner.get("/api/admin/settings")).json()
    assert s["referral"] == {"on": True, "needed": 3}
    r = await owner.put("/api/admin/settings", json={"referral": {"on": True, "needed": 2}})
    assert r.json()["referral"] == {"on": True, "needed": 2}
    await invited(make_client, outbox, code, 2)
    assert (await c.get("/api/me/referral")).json()["reward"]["unlocked"] is True
    rows = (await owner.get("/api/admin/referral-rewards")).json()
    assert len(rows) == 1 and rows[0]["name"] == "Asha Rao" and rows[0]["friends"] == 2 and rows[0]["revokedAt"] is None
    uid = rows[0]["userId"]
    # revoke: locked again, not given again
    r = await owner.post(f"/api/admin/referral-rewards/{uid}/revoke", json={"note": "Same person"})
    assert r.json() == {"revoked": True}
    assert (await owner.post(f"/api/admin/referral-rewards/{uid}/revoke", json={})).status_code == 404
    reward = (await c.get("/api/me/referral")).json()["reward"]
    assert reward["unlocked"] is False and reward["revoked"] is True
    assert (await c.post("/api/me/exports", json=PDF)).status_code == 402
    # not for customers
    assert (await c.get("/api/admin/referral-rewards")).status_code in (401, 403)
    # off: no new rewards
    await owner.put("/api/admin/settings", json={"referral": {"on": False, "needed": 2}})
    b = browser(make_client, "172.16.0.1")
    await signup(b, outbox, "bala@example.com", name="Bala K")
    bcode = (await b.get("/api/me/referral")).json()["code"]
    await invited(make_client, outbox, bcode, 2, start=40)
    assert (await b.get("/api/me/referral")).json()["reward"]["unlocked"] is False
    assert await db[REFERRAL_REWARDS].count_documents({}) == 1
