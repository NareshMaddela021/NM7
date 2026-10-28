"""Eligibility filters: the math and the reasons, exceptions, the "verified" tick (cleared when a number changes),
no rules on personal attributes, the eligible list feeding drive slots and a recruiter invite (consenting students
only), plan gating and organization isolation."""

import pytest

from app.college.eligibility import check
from app.core.db import AUDIT_LOG, MEMBERSHIPS
from tests.test_college_drives import a_drive, campus, students
from tests.test_org_recruiter_portal import invite, sign_in
from tests.test_orgs_phase2 import coordinator, second_org


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


def test_the_math_and_the_reasons():
    rules = {
        "cgpa_min": 7.0,
        "backlogs_max": 0,
        "branches": ["CSE", "ECE"],
        "years": [2026],
        "tenth_min": 60,
        "twelfth_min": 60,
    }
    ok = {"cgpa": 7.0, "backlogs": 0, "year": 2026, "tenth": 60, "twelfth": 75.5}
    assert check(rules, ok, "cse") == []  # boundaries are inclusive; branch ignores case
    bad = {"cgpa": 6.4, "backlogs": 2, "year": 2025, "tenth": 58.5, "twelfth": None}
    assert check(rules, bad, "MECH") == [
        "CGPA 6.4 < 7.0",
        "Backlogs 2 > 0",
        "Branch MECH not in CSE, ECE",
        "Passing year 2025 not in 2026",
        "10th 58.5% < 60%",
        "12th % not given",
    ]
    assert check({"cgpa_min": 7.0}, {}, "CSE") == ["CGPA not given"]
    assert check({}, bad, "MECH") == []


async def test_rules_exceptions_verify_and_slots(owner, make_client, outbox, db):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    people = await students(make_client, outbox, 3)
    base, d = await a_drive(c, org["id"], g["id"])
    infosys = d["companies"][0]["id"]
    eb = f"/api/org/{org['id']}/drives/{d['id']}/companies/{infosys}"
    marks = [
        {"cgpa": 8.1, "backlogs": 0, "year": 2026},
        {"cgpa": 6.4, "backlogs": 0, "year": 2026},
        {"cgpa": 7.5, "backlogs": 1, "year": 2026},
    ]
    for (s, mid), m in zip(people, marks, strict=True):
        r = await s.put(f"/api/me/academic/{mid}", json=m)
        assert r.status_code == 200 and r.json()["verified"] is False
    # someone else's membership: 404
    assert (await people[0][0].put(f"/api/me/academic/{people[1][1]}", json={"cgpa": 9})).status_code == 404
    # no rules: everyone
    e = (await c.get(f"{eb}/eligibility")).json()
    assert e["counts"] == {"eligible": 3, "total": 3} and e["hasRules"] is False
    # rules; personal attributes aren't rules (ignored, never stored)
    r = await c.put(f"{eb}/rules", json={"cgpaMin": 7, "backlogsMax": 0, "gender": "F", "caste": "x"})
    e = r.json()
    assert e["rules"] == {
        "cgpaMin": 7.0,
        "backlogsMax": 0,
        "branches": [],
        "years": [],
        "tenthMin": None,
        "twelfthMin": None,
    }
    doc = await db["drives"].find_one({"_id": d["id"]})
    assert set(doc["companies"][0]["rules"]) == {"cgpa_min", "backlogs_max"}
    by = {r["id"]: r for r in e["rows"]}
    assert by[people[0][1]]["eligible"] and by[people[0][1]]["reasons"] == []
    assert by[people[1][1]]["reasons"] == ["CGPA 6.4 < 7.0"]
    assert by[people[2][1]]["reasons"] == ["Backlogs 1 > 0"]
    assert e["counts"]["eligible"] == 1
    # an exception with a note
    r = await c.put(f"{eb}/exceptions/{people[2][1]}", json={"note": "Backlog cleared, result awaited"})
    by = {x["id"]: x for x in r.json()["rows"]}
    assert by[people[2][1]]["eligible"] and by[people[2][1]]["exception"] == "Backlog cleared, result awaited"
    # slots take only the eligible list
    d = (await c.post(f"{base}/auto-assign")).json()
    assert sum(s["students"] for s in d["slots"]) == 2
    # verified tick; a changed number clears it
    v = await c.put(f"/api/org/{org['id']}/academic/{people[0][1]}/verify", json={"verified": True})
    assert v.json()["verified"] is True
    assert (await people[0][0].get(f"/api/me/academic/{people[0][1]}")).json()["verified"] is True
    await people[0][0].put(f"/api/me/academic/{people[0][1]}", json={**marks[0], "cgpa": 8.4})
    assert (await people[0][0].get(f"/api/me/academic/{people[0][1]}")).json()["verified"] is False
    acts = {a["action"] async for a in db[AUDIT_LOG].find({"data.orgs": org["id"]})}
    assert {"eligibility_rules", "eligibility_exception", "academic_verify"} <= acts


async def test_share_with_a_recruiter_invite_only_consenting_students(owner, make_client, outbox, db):
    org, g = await campus(owner)
    r = await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    assert r.status_code == 200
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    people = await students(make_client, outbox, 3)
    # two allow recruiter sharing; one doesn't
    await db[MEMBERSHIPS].update_many(
        {"_id": {"$in": [people[0][1], people[1][1]]}}, {"$set": {"recruiter_opt_in": True, "approval": "approved"}}
    )
    await db[MEMBERSHIPS].update_one(
        {"_id": people[2][1]}, {"$set": {"recruiter_opt_in": False, "approval": "approved"}}
    )
    for s, mid in people:
        await s.put(f"/api/me/academic/{mid}", json={"cgpa": 8, "backlogs": 0})
    await people[1][0].put(f"/api/me/academic/{people[1][1]}", json={"cgpa": 6, "backlogs": 0})
    base, d = await a_drive(c, org["id"], g["id"])
    eb = f"/api/org/{org['id']}/drives/{d['id']}/companies/{d['companies'][0]['id']}"
    await c.put(f"{eb}/rules", json={"cgpaMin": 7})
    inv, tok = await invite(c, org["id"], [g["id"]])
    r = await c.post(f"{eb}/share", json={"inviteId": inv["id"]})
    assert r.json() == {"shared": 1, "eligible": 2, "notOptedIn": 1, "invite": "Acme Analytics"}
    rec = make_client()
    h = await sign_in(rec, outbox, tok)
    cands = (await rec.get(f"/api/recruiter/{tok}/candidates", headers=h)).json()["candidates"]
    assert len(cands) == 1  # s0 only: s1 is under the CGPA rule, s2 didn't allow recruiter sharing
    assert (await c.get(f"{eb}/eligibility")).json()["invites"][0]["shared"] is True


async def test_gating_and_isolation(owner, make_client, outbox):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    people = await students(make_client, outbox, 1)
    base, d = await a_drive(c, org["id"], g["id"])
    eb = f"/api/org/{org['id']}/drives/{d['id']}/companies/{d['companies'][0]['id']}"
    o2, _ = await second_org(owner)
    await owner.put(f"/api/admin/orgs/{o2['id']}/billing/plan", json={"planId": "campus"})
    other, _ = await coordinator(owner, make_client, outbox, o2["id"], email="other@example.com")
    assert (await other.get(eb)).status_code == 404
    assert (
        await other.get(f"/api/org/{o2['id']}/drives/{d['id']}/companies/{d['companies'][0]['id']}/eligibility")
    ).status_code == 404
    assert (
        await other.put(f"/api/org/{o2['id']}/academic/{people[0][1]}/verify", json={"verified": True})
    ).status_code == 404
    # the feature switched off for this organization
    await owner.put(f"/api/admin/orgs/{org['id']}/features", json={"eligibility": False})
    assert (await c.get(f"{eb}/eligibility")).status_code == 404
