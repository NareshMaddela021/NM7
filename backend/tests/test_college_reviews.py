"""Faculty reviewers: invited as a staff role, see only assigned students (and nothing else of the organization),
comment on sections, set needs changes / approved (feeds the review status), students see and resolve comments,
organization isolation, gating, erased with the account."""

import pytest

from app.core.db import MEMBERSHIPS, REVIEW_COMMENTS
from app.me.erase import erase_user_data
from tests.conftest import signup
from tests.test_college_drives import campus, students
from tests.test_orgs_phase2 import coordinator, second_org


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def reviewer(c, org_id, make_client, outbox, email="prof@example.com"):
    r = await c.post(f"/api/org/{org_id}/reviewers", json={"email": email})
    assert r.status_code == 201, r.text
    token = r.json()["inviteUrl"].rsplit("/", 1)[1]
    rc = make_client()
    await signup(rc, outbox, email, name="Prof Rao")
    assert (await rc.post(f"/api/org-invites/{token}/accept")).status_code == 200
    staff_id = next(x["id"] for x in (await c.get(f"/api/org/{org_id}/reviewers")).json() if x["email"] == email)
    return rc, staff_id


async def test_assigned_only_comments_status_and_resolve(owner, make_client, outbox, db):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    (s0, m0), (s1, m1) = await students(make_client, outbox, 2)
    rc, sid = await reviewer(c, org["id"], make_client, outbox)
    base = f"/api/review/{org['id']}"
    assert (await rc.get(f"{base}/students")).json()["students"] == []
    # assign s0 only
    r = await c.put(f"/api/org/{org['id']}/reviewers/{sid}/students", json={"membershipIds": [m0]})
    assert r.json()["chosen"] == [m0]
    ss = (await rc.get(f"{base}/students")).json()["students"]
    assert [x["id"] for x in ss] == [m0]
    # the unassigned student: 404 everywhere
    assert (await rc.get(f"{base}/students/{m1}")).status_code == 404
    assert (
        await rc.post(f"{base}/students/{m1}/comments", json={"section": "exp", "text": "Add numbers"})
    ).status_code == 404
    assert (await rc.put(f"{base}/students/{m1}/status", json={"status": "approved"})).status_code == 404
    # nothing else of the organization
    for path in ("", "/team", "/shared-resumes", "/placement", "/drives", "/offers", "/audit", "/kiosks"):
        assert (await rc.get(f"/api/org/{org['id']}{path}")).status_code == 404, path
    # the resume and a comment on a line of a section
    one = (await rc.get(f"{base}/students/{m0}")).json()
    assert one["data"]["personal"] and one["comments"] == []
    r = await rc.post(
        f"{base}/students/{m0}/comments",
        json={"section": "proj", "line": "Built a dashboard", "text": "Say what it changed — a number."},
    )
    assert r.status_code == 201 and r.json()["sectionName"] == "Projects"
    assert (await rc.post(f"{base}/students/{m0}/comments", json={"section": "nope", "text": "x y"})).status_code == 400
    # status feeds the review status the placement office uses
    assert (
        await rc.put(f"{base}/students/{m0}/status", json={"status": "needs_changes", "note": "See comments"})
    ).json() == {"reviewStatus": "needs_changes"}
    m = await db[MEMBERSHIPS].find_one({"_id": m0})
    assert m["review_status"] == "needs_changes" and m["review_note"] == "See comments"
    await rc.put(f"{base}/students/{m0}/status", json={"status": "approved"})
    assert (await db[MEMBERSHIPS].find_one({"_id": m0}))["review_status"] == "ready"
    # the student sees and resolves it; the other student sees nothing
    mine = (await s0.get("/api/me/review-comments")).json()
    assert (
        len(mine) == 1
        and mine[0]["section"] == "proj"
        and mine[0]["line"] == "Built a dashboard"
        and mine[0]["resolved"] is False
    )
    assert (await s1.get("/api/me/review-comments")).json() == []
    assert (
        await s1.post(f"/api/me/review-comments/{mine[0]['id']}/resolve", json={"resolved": True})
    ).status_code == 404
    assert (await s0.post(f"/api/me/review-comments/{mine[0]['id']}/resolve", json={"resolved": True})).json()[
        "resolved"
    ] is True
    assert (await rc.get(f"{base}/students")).json()["students"][0]["openComments"] == 0
    # reviewers don't count against the coordinator limit, show in My organizations as reviewers
    orgs = (await rc.get("/api/me/orgs")).json()
    assert orgs[0]["role"] == "reviewer"
    # erased with the account
    uid = m["user_id"]
    assert (await erase_user_data(db, uid))["review_comments"] == 1
    assert await db[REVIEW_COMMENTS].count_documents({"user_id": uid}) == 0


async def test_isolation_and_gating(owner, make_client, outbox):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    ((_, m0),) = await students(make_client, outbox, 1)
    rc, sid = await reviewer(c, org["id"], make_client, outbox)
    await c.put(f"/api/org/{org['id']}/reviewers/{sid}/students", json={"membershipIds": [m0]})
    # another college's coordinator can't assign or see this reviewer
    o2, _ = await second_org(owner)
    await owner.put(f"/api/admin/orgs/{o2['id']}/billing/plan", json={"planId": "campus"})
    other, _ = await coordinator(owner, make_client, outbox, o2["id"], email="other@example.com")
    assert (await other.get(f"/api/org/{o2['id']}/reviewers/{sid}/students")).status_code == 404
    assert (await other.get(f"/api/review/{org['id']}/students")).status_code == 404
    # someone else's students can't be assigned
    ((_, outsider_mid),) = await students(make_client, outbox, 1, code="WELD26", prefix="o")
    r = await c.put(f"/api/org/{org['id']}/reviewers/{sid}/students", json={"membershipIds": [m0, outsider_mid]})
    assert r.json()["chosen"] == [m0]
    # off on Free
    await owner.put(f"/api/admin/orgs/{org['id']}/features", json={"facultyReview": False})
    assert (await rc.get(f"/api/review/{org['id']}/students")).status_code == 404
    assert (await c.get(f"/api/org/{org['id']}/reviewers")).status_code == 404
