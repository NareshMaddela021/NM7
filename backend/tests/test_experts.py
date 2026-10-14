"""Expert applications: profile, submit, admin review, test task."""

from app.core.db import AUDIT_LOG, EXPERT_PROFILES, USERS
from tests.conftest import signup

PROFILE = {
    "about": {"name": "Ravi Kumar", "headline": "Senior Data Analyst", "bio": "x" * 160, "languages": ["English"]},
    "expertise": {"domains": ["Data & analytics"], "levels": ["fresher"]},
    "proof": {"experience": [{"role": "Analyst", "company": "Acme"}]},
    "services": {"plans": ["expert"], "perWeek": 5},
    "payout": {"method": "upi", "upi": "ravi@okaxis", "pan": "ABCDE1234F"},
    "agree": True,
    "status": "approved",  # ignored: the expert can't approve themselves
}


def err(r):
    return r.json()["error"]["code"]


async def expert(make_client, outbox, email="ravi@example.com"):
    c = make_client()
    me = await signup(c, outbox, email, role="expert", name="Ravi Kumar")
    return c, me["id"]


async def test_apply_review_test_approve(make_client, outbox, db, admin_client):
    c, uid = await expert(make_client, outbox)
    assert (await c.get("/api/expert/profile")).json() is None
    r = await c.put("/api/expert/profile", json={**PROFILE, "agree": False})
    assert r.status_code == 200 and r.json()["status"] == "draft" and r.json()["payout"]["upi"] == "ravi@okaxis"
    assert err(await c.post("/api/expert/profile/submit")) == "incomplete"
    await c.put("/api/expert/profile", json=PROFILE)
    stored = await db[EXPERT_PROFILES].find_one({"_id": uid})
    assert "ravi@okaxis" not in str(stored) and "ABCDE1234F" not in str(stored)  # payout details are encrypted
    assert (await c.post("/api/expert/profile/submit")).json()["status"] == "review"
    assert err(await c.put("/api/expert/profile", json=PROFILE)) == "locked"

    admin = await admin_client("ops")
    apps = (await admin.get("/api/admin/experts", params={"status": "review"})).json()
    assert [a["id"] for a in apps] == [uid]
    detail = (await admin.get(f"/api/admin/experts/{uid}")).json()
    assert detail["profile"]["payout"]["upi"].endswith("axis") and "ravi" not in detail["profile"]["payout"]["upi"]
    r = await admin.post(f"/api/admin/experts/{uid}/decision", json={"action": "test", "note": "Nice profile"})
    assert r.json()["status"] == "test"
    assert "test task" in outbox.sent[-1].text

    r = await c.post("/api/expert/test", json={"data": {"summary": "rewritten"}})
    assert r.json()["status"] == "testReview"
    r = await admin.post(
        f"/api/admin/experts/{uid}/decision", json={"action": "pass", "scores": {"ats": 4, "impact": 4}}
    )
    assert r.json()["status"] == "approved"
    assert (await db[USERS].find_one({"_id": uid}))["expert_status"] == "approved"
    assert (await c.get("/api/auth/me")).json()["expertStatus"] == "approved"
    actions = [a["action"] async for a in db[AUDIT_LOG].find({"action": {"$regex": "^expert"}}).sort("_id", 1)]
    assert actions == ["expert.test", "expert.pass"]
    # wrong order of steps
    assert err(await admin.post(f"/api/admin/experts/{uid}/decision", json={"action": "approve"})) == "bad_status"


async def test_only_experts_and_permitted_admins(client, outbox, make_client, admin_client):
    await signup(client, outbox)
    assert (await client.get("/api/expert/profile")).status_code == 403
    _, uid = await expert(make_client, outbox)
    finance = await admin_client("finance")
    assert (await finance.get("/api/admin/experts")).status_code == 403
    assert (await finance.post(f"/api/admin/experts/{uid}/decision", json={"action": "approve"})).status_code == 403
    assert (await client.get("/api/admin/experts")).status_code == 403
