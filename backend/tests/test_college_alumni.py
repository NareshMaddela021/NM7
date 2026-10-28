"""Alumni network: who can opt in (past batches, or invited), current students of the same college browse and ask
(5 a week), the alumnus is emailed and replies inside Nm7, contact details never leak, pause / leave, coordinators
see counts only, other colleges see nothing, Campus only, erased with the account."""

import pytest

from app.core.db import ALUMNI, MEMBERSHIPS
from app.me.erase import erase_user_data
from tests.test_college_drives import campus, students
from tests.test_orgs_phase2 import coordinator, second_org

PROFILE = {
    "company": "Infosys",
    "role": "Systems Engineer",
    "city": "Pune",
    "batch": 2022,
    "referrals": True,
    "mentoring": True,
}


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def setup(owner, make_client, outbox, db):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    (alum, am), (cur, cm), (cur2, _) = await students(make_client, outbox, 3)
    await db[MEMBERSHIPS].update_one({"_id": am}, {"$set": {"academic.year": 2022}})  # a past batch
    return org, c, alum, cur, cur2


async def test_opt_in_browse_request_reply_and_privacy(owner, make_client, outbox, db):
    org, c, alum, cur, cur2 = await setup(owner, make_client, outbox, db)
    # a current student can't opt in as an alumnus; the past-batch student can
    r = await cur.put(f"/api/me/alumni/profile/{org['id']}", json=PROFILE)
    assert r.status_code == 403
    ov = (await alum.get("/api/me/alumni")).json()
    assert [x["orgId"] for x in ov["canJoin"]] == [org["id"]]
    a = (await alum.put(f"/api/me/alumni/profile/{org['id']}", json=PROFILE)).json()
    # current students browse: no email or phone anywhere
    rows = (await cur.get(f"/api/me/alumni/browse/{org['id']}")).json()
    assert len(rows) == 1 and rows[0]["company"] == "Infosys" and rows[0]["referrals"] is True
    raw = (await cur.get(f"/api/me/alumni/browse/{org['id']}")).text
    assert "@example.com" not in raw and "phone" not in raw.lower()
    # a request: the alumnus is emailed (no student contact in it) and replies inside Nm7
    n = len(outbox.sent)
    r = await cur.post(
        "/api/me/alumni/requests",
        json={
            "alumniId": a["id"],
            "kind": "referral",
            "note": "Could you refer me for the Infosys SE role? I have done SQL projects.",
        },
    )
    assert r.status_code == 201, r.text
    mail = outbox.sent[n]
    assert (
        "asked you for a referral" in mail.subject and "s1@example.com" not in mail.text and "/me/alumni" in mail.text
    )
    inbox = (await alum.get("/api/me/alumni/inbox")).json()
    assert inbox[0]["from"] and inbox[0]["kind"] == "referral" and "@" not in str(inbox)
    rid = inbox[0]["id"]
    rr = await alum.post(
        f"/api/me/alumni/requests/{rid}/reply", json={"text": "Sure — send your resume through the Nm7 link."}
    )
    assert rr.status_code == 200
    mine = (await cur.get("/api/me/alumni/requests")).json()
    assert mine[0]["replies"][0]["text"].startswith("Sure") and "@" not in str(mine)
    # nobody else sees it
    assert (await cur2.get("/api/me/alumni/requests")).json() == []
    assert (await cur2.post(f"/api/me/alumni/requests/{rid}/reply", json={"text": "hello"})).status_code == 404
    # coordinators: counts only
    s = (await c.get(f"/api/org/{org['id']}/alumni/summary")).json()
    assert (s["alumni"], s["referrals"], s["requests30d"], s["replied30d"]) == (1, 1, 1, 1)
    assert "note" not in str(s) and "Sure" not in str(s)
    # pause: hidden and can't be asked
    await alum.put(f"/api/me/alumni/profile/{org['id']}", json={**PROFILE, "paused": True})
    assert (await cur.get(f"/api/me/alumni/browse/{org['id']}")).json() == []
    assert (
        await cur2.post(
            "/api/me/alumni/requests",
            json={"alumniId": a["id"], "kind": "mentoring", "note": "Could you mentor me for interviews?"},
        )
    ).status_code == 404
    # leave
    await alum.put(f"/api/me/alumni/profile/{org['id']}", json=PROFILE)
    assert (await alum.delete(f"/api/me/alumni/profile/{org['id']}")).status_code == 200
    assert (await cur.get(f"/api/me/alumni/browse/{org['id']}")).json() == []
    # erased with the account
    uid = (await db[ALUMNI].find_one({"_id": a["id"]}))["user_id"]
    out = await erase_user_data(db, uid)
    assert out["alumni"] == 1 and out["alumni_requests"] == 1


async def test_five_requests_a_week_and_only_open_kinds(owner, make_client, outbox, db):
    org, c, alum, cur, _ = await setup(owner, make_client, outbox, db)
    a = (await alum.put(f"/api/me/alumni/profile/{org['id']}", json={**PROFILE, "mentoring": False})).json()
    note = "Could you refer me please? I have built two data projects."
    r = await cur.post("/api/me/alumni/requests", json={"alumniId": a["id"], "kind": "mentoring", "note": note})
    assert r.status_code == 400 and r.json()["error"]["code"] == "not_open"
    for _ in range(5):
        assert (
            await cur.post("/api/me/alumni/requests", json={"alumniId": a["id"], "kind": "referral", "note": note})
        ).status_code == 201
    r = await cur.post("/api/me/alumni/requests", json={"alumniId": a["id"], "kind": "referral", "note": note})
    assert r.status_code == 429 and "5 requests a week" in r.json()["error"]["message"]


async def test_other_colleges_invites_and_gating(owner, make_client, outbox, db):
    org, c, alum, cur, _ = await setup(owner, make_client, outbox, db)
    a = (await alum.put(f"/api/me/alumni/profile/{org['id']}", json=PROFILE)).json()
    # a student of another college can't browse or ask
    o2, g2 = await second_org(owner)
    await owner.put(f"/api/admin/orgs/{o2['id']}/billing/plan", json={"planId": "campus"})
    ((outsider, _),) = await students(make_client, outbox, 1, code="WELD26", prefix="o")
    assert (await outsider.get(f"/api/me/alumni/browse/{org['id']}")).status_code == 404
    r = await outsider.post(
        "/api/me/alumni/requests", json={"alumniId": a["id"], "kind": "referral", "note": "Could you refer me please?"}
    )
    assert r.status_code == 404
    # an emailed invite lets someone without a past membership opt in
    n = len(outbox.sent)
    r = await c.post(f"/api/org/{org['id']}/alumni/invites", json={"emails": ["old.grad@example.com"]})
    assert r.json() == {"invited": 1, "emailed": 1}
    url = next(x for x in outbox.sent[n].text.split() if "/alumni/join/" in x)
    from tests.conftest import signup

    grad = make_client()
    await signup(grad, outbox, "old.grad@example.com", name="Old Grad")
    assert (await grad.put(f"/api/me/alumni/profile/{org['id']}", json=PROFILE)).status_code == 403
    assert (await grad.post(f"/api/me/alumni/join/{url.rsplit('/', 1)[1]}")).status_code == 200
    assert (await grad.put(f"/api/me/alumni/profile/{org['id']}", json=PROFILE)).status_code == 200
    assert len((await cur.get(f"/api/me/alumni/browse/{org['id']}")).json()) == 2
    # Drive plan: no alumni network
    await owner.put(f"/api/admin/orgs/{org['id']}/billing/plan", json={"planId": "drive"})
    assert (await cur.get(f"/api/me/alumni/browse/{org['id']}")).status_code == 404
    assert (await c.get(f"/api/org/{org['id']}/alumni/summary")).status_code == 404
