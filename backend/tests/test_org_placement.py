"""Placement dashboard (colleges, Phase 1): tiles for every plan; charts, who's-missing lists, reminders and roll
lists on Drive / Campus; numbers that match the data; roll-list matching; coordinators see only their organization and
groups; consent / leaving removes a student at once; no ID numbers; the demo organization and its exclusion from real
numbers; the server's ATS score gives the same numbers as the student's ATS check."""

import json
from pathlib import Path

import pytest

from app.core.db import AUDIT_LOG, MEMBERSHIPS, ORGANIZATIONS, USERS
from app.orgs import demo
from app.orgs.ats import ats_score
from app.orgs.placement import parse_roll_list
from tests.test_orgs import RESUME, join, member, setup_group
from tests.test_orgs_phase2 import coordinator, second_org

CASES = json.loads((Path(__file__).parent / "fixtures" / "ats_cases.json").read_text())
STRONG = CASES[1]["data"]  # scores 100
ASHA = {**STRONG, "personal": {**STRONG["personal"], "name": "Asha Rao"}}
ROLL_CSV = (
    "Name,Roll Number,Branch,Email\n"
    "Asha Rao,21A01,CSE,asha@example.com\n"
    "Bala K,21a-02,ECE,\n"  # matched by roll number (case and punctuation don't matter)
    "Chitra S,21A03,CSE,chitra@example.com\n"
    "Dev M,21A04,CSE,dev@example.com\n"  # never joins
)


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def plan(owner, org_id, plan_id):
    r = await owner.put(f"/api/admin/orgs/{org_id}/billing/plan", json={"planId": plan_id})
    assert r.status_code == 200, r.text


async def three(owner, make_client, outbox, db):
    """JNTU Anantapur with Asha (strong resume), Bala (no resume: deleted it) and Chitra (thin resume)."""
    org, g = await setup_group(owner)
    clients = {}
    for email, name, roll, branch, data in (
        ("asha@example.com", "Asha Rao", "21A01", "CSE", ASHA),
        ("bala@example.com", "Bala K", "21A02", "ECE", RESUME),
        ("chitra@example.com", "Chitra S", "21A03", "CSE", {"personal": {"name": "Chitra S"}, "skillGroups": []}),
    ):  # fmt: skip
        c, _ = await member(make_client, outbox, email, name, data)
        r = await join(c, roll=roll, branch=branch)
        assert r.status_code == 201, r.text
        clients[name.split()[0].lower()] = (c, r.json()["id"])
    # Bala's shared resume is gone (deleted from another device): joined, no resume
    await db[MEMBERSHIPS].update_one({"_id": clients["bala"][1]}, {"$set": {"resume_id": "gone"}})
    return org, g, clients


def test_ats_score_matches_the_students_ats_check():
    for c in CASES:
        assert ats_score(c["data"])["score"] == c["score"], c["name"]


def test_roll_list_csv():
    rows = parse_roll_list(ROLL_CSV)
    assert [r["roll"] for r in rows] == ["21A01", "21a-02", "21A03", "21A04"] and rows[1]["email"] == ""
    # no header: name, roll, branch, email; duplicates kept once; blank lines skipped
    rows = parse_roll_list("Asha Rao,21A01,CSE,asha@example.com\n\nAsha Rao,21A01,CSE,asha@example.com\n")
    assert rows == [{"name": "Asha Rao", "roll": "21A01", "branch": "CSE", "email": "asha@example.com"}]
    # header in another order, a column more
    rows = parse_roll_list("Email ID,Branch,Student Name,Reg No,Phone\nx@y.com,ECE,Ravi,R9,98\n")
    assert rows == [{"name": "Ravi", "roll": "R9", "branch": "ECE", "email": "x@y.com"}]
    for bad in ("Name,Aadhaar\nAsha,2345 6789 0123\n", ""):
        with pytest.raises(Exception) as e:
            parse_roll_list(bad)
        assert getattr(e.value, "code", "") in ("id_number", "roll_list_empty")


async def test_free_plan_shows_tiles_only(owner, make_client, outbox, db):
    org, g, _ = await three(owner, make_client, outbox, db)
    coord, _ = await coordinator(owner, make_client, outbox, org["id"])
    j = (await coord.get(f"/api/org/{org['id']}/placement")).json()
    assert j["insights"] is False and set(j) == {"tiles", "insights", "role", "group", "groups", "updatedAt"}
    assert j["tiles"]["joined"] == 3 and j["tiles"]["shared"] == 2 and j["tiles"]["invited"] is None
    r = await coord.put(f"/api/org/{org['id']}/groups/{g['id']}/roll-list", json={"csv": ROLL_CSV})
    assert r.status_code == 402 and err(r) == "plan_feature"
    r = await coord.get(f"/api/org/{org['id']}/placement/missing.csv", params={"list": "noResume"})
    assert r.status_code == 402
    # Nm7 can switch it on for one organization (admin override)
    await owner.put(f"/api/admin/orgs/{org['id']}/features", json={"placementInsights": True})
    assert (await coord.get(f"/api/org/{org['id']}/placement")).json()["insights"] is True


async def test_numbers_match_the_data_and_roll_list_matching(owner, make_client, outbox, db):
    org, g, people = await three(owner, make_client, outbox, db)
    await plan(owner, org["id"], "drive")
    coord, _ = await coordinator(owner, make_client, outbox, org["id"])
    base = f"/api/org/{org['id']}"
    r = await coord.put(f"{base}/groups/{g['id']}/roll-list", json={"csv": ROLL_CSV})
    assert r.status_code == 200 and r.json()["count"] == 4 and r.json()["joined"] == 3
    # approvals / review / print / LinkedIn / shortlist state, set directly
    await db[MEMBERSHIPS].update_one({"_id": people["asha"][1]}, {"$set": {"review_status": "ready"}})
    await db[MEMBERSHIPS].update_one(
        {"_id": people["chitra"][1]}, {"$set": {"review_status": "needs_changes", "review_note": "Add projects"}}
    )
    j = (await coord.get(f"{base}/placement")).json()
    t = j["tiles"]
    chitra_ats = ats_score({"personal": {"name": "Chitra S"}, "skillGroups": []})["score"]
    assert t["invited"] == 4 and t["joined"] == 3 and t["joinedFromRoll"] == 3
    assert t["shared"] == 2 and t["sharedPct"] == 67 and t["approved"] == 2 and t["ready"] == 1
    assert t["atsAvg"] == round((100 + chitra_ats) / 2) and t["atsBands"] == {"low": 1, "mid": 0, "high": 1}
    assert t["linkedinReady"] == 1 and t["printed"] == 0 and t["shortlisted"] == 0
    assert [f["n"] for f in j["funnel"]] == [4, 3, 2, 2, 1, 0]
    lists = j["lists"]
    assert [r["name"] for r in lists["notJoined"]] == ["Dev M"] and lists["notJoined"][0]["roll"] == "21A04"
    assert [r["name"] for r in lists["noResume"]] == ["Bala K"]
    assert [r["name"] for r in lists["lowAts"]] == ["Chitra S"]
    assert {r["name"] for r in lists["notLinkedin"]} == {"Bala K", "Chitra S"}
    assert lists["needsChanges"][0]["missing"] == ["Add projects"]
    assert {r["name"] for r in lists["notPrinted"]} == {"Asha Rao", "Chitra S"}
    assert j["atsBy"] == "branch" and {b["key"] for b in j["atsByBranch"]} == {"CSE"}
    gaps = {m["key"]: m for m in j["topMissing"]}
    assert gaps["no_projects"]["pct"] == 50 and gaps["no_projects"]["text"] == "have no projects"
    assert any(s["name"] == "Python" for s in j["skills"])
    assert sum(w["joined"] for w in j["weekly"]) == 3
    # nothing more than the dashboard needs: no emails, phones or ID numbers in the rows
    for rows in lists.values():
        for row in rows:
            assert set(row) == {
                "membershipId",
                "name",
                "roll",
                "branch",
                "group",
                "groupId",
                "missing",
                "lastActive",
                "ats",
            }
    # a student edits their resume: the next read has the new score ("live" without a refresh)
    c = people["chitra"][0]
    await c.patch("/api/me/resumes/r1", json={"data": STRONG})
    t2 = (await coord.get(f"{base}/placement")).json()["tiles"]
    assert t2["atsAvg"] == 100 and t2["atsBands"]["low"] == 0
    # leaving the group (withdrawing consent) takes a student out at once
    assert (await c.post(f"/api/me/groups/{people['chitra'][1]}/leave")).status_code == 204
    t3 = (await coord.get(f"{base}/placement")).json()["tiles"]
    assert t3["joined"] == 2 and t3["joinedFromRoll"] == 2
    # CSV of one list, logged
    r = await coord.get(f"{base}/placement/missing.csv", params={"list": "notJoined"})
    assert r.status_code == 200 and "Dev M,21A04,CSE" in r.text
    actions = {a["action"] async for a in db[AUDIT_LOG].find({"data.orgs": org["id"]})}
    assert {"roll_list_upload", "placement_export"} <= actions
    shown = {a["action"] for a in (await coord.get(f"{base}/audit")).json()}  # the organization's Activity log
    assert {"roll_list_upload", "placement_export"} <= shown
    # the roll list itself never takes an ID number
    r = await coord.put(f"{base}/groups/{g['id']}/roll-list", json={"csv": "Name,Roll,Aadhaar\nA,1,2345 6789 0123\n"})
    assert r.status_code == 400 and err(r) == "id_number"
    assert (await coord.get(f"{base}/groups/{g['id']}/roll-list")).json()["count"] == 4
    assert (await coord.delete(f"{base}/groups/{g['id']}/roll-list")).status_code == 204
    assert (await coord.get(f"{base}/placement")).json()["tiles"]["invited"] is None


async def test_coordinators_see_only_their_org_and_groups(owner, make_client, outbox, db):
    org, g, _ = await three(owner, make_client, outbox, db)
    other, og = await second_org(owner)
    await plan(owner, org["id"], "campus")
    stranger, _ = await coordinator(owner, make_client, outbox, other["id"], email="other@example.com")
    assert (await stranger.get(f"/api/org/{org['id']}/placement")).status_code == 404
    assert (await stranger.get(f"/api/org/{other['id']}/placement", params={"group": g["id"]})).status_code == 404
    r = await stranger.put(f"/api/org/{org['id']}/groups/{g['id']}/roll-list", json={"csv": ROLL_CSV})
    assert r.status_code == 404
    assert (await stranger.get(f"/api/org/{other['id']}/placement")).json()["tiles"]["joined"] == 0
    # a coordinator limited to another group of the same organization doesn't see this group's students
    g2 = (await owner.post(f"/api/admin/orgs/{org['id']}/groups", json={"name": "MBA 2026", "code": "MBA26"})).json()
    narrow, _ = await coordinator(owner, make_client, outbox, org["id"], email="n@example.com", group_ids=[g2["id"]])
    assert (await narrow.get(f"/api/org/{org['id']}/placement")).json()["tiles"]["joined"] == 0
    assert (await narrow.get(f"/api/org/{org['id']}/placement", params={"group": g["id"]})).status_code == 404
    # a viewer can look but not upload or export
    viewer, _ = await coordinator(owner, make_client, outbox, org["id"], email="v@example.com", role="viewer")
    assert (await viewer.get(f"/api/org/{org['id']}/placement")).status_code == 200
    assert (
        await viewer.put(f"/api/org/{org['id']}/groups/{g['id']}/roll-list", json={"csv": ROLL_CSV})
    ).status_code == 403
    assert (
        await viewer.get(f"/api/org/{org['id']}/placement/missing.csv", params={"list": "lowAts"})
    ).status_code == 403


async def test_reminders_reach_members_without_a_resume(owner, make_client, outbox, db):
    org, g, people = await three(owner, make_client, outbox, db)
    await plan(owner, org["id"], "drive")
    coord, _ = await coordinator(owner, make_client, outbox, org["id"])
    before = len(outbox.sent)
    r = await coord.post(f"/api/org/{org['id']}/placement/remind", json={"ids": [people["bala"][1]], "note": "Today!"})
    assert r.status_code == 200 and r.json()["sent"] == 1
    mail = outbox.sent[before]
    assert mail.to == "bala@example.com" and "Today!" in mail.text
    # once a day per member
    r = await coord.post(f"/api/org/{org['id']}/placement/remind", json={"ids": [people["bala"][1]]})
    assert r.json()["sent"] == 0 and r.json()["reasons"]["recent"] == 1


async def test_demo_org(owner, db, outbox):
    made = (await owner.post("/api/admin/demo-org")).json()
    path = made.pop("recruiterPath")  # the demo recruiter invite, signed in (tests/test_org_recruiter_portal.py)
    assert path.startswith("/recruiter/") and "#s=" in path
    assert made == {"orgId": demo.ORG_ID, "name": "Demo Engineering College", "students": 48, "groups": 2}
    j = (await owner.get(f"/api/org/{demo.ORG_ID}/placement")).json()
    t = j["tiles"]
    assert j["insights"] is True and t["invited"] == 60 and t["joined"] == 48 and t["joinedFromRoll"] == 48
    assert len(j["lists"]["notJoined"]) == 12 and t["shared"] < 48 and t["atsAvg"] is not None
    assert {b["key"] for b in j["atsByBranch"]} == {"CSE", "ECE"}
    # left out of real numbers
    assert (await owner.get("/api/admin/stats")).json()["customers"] == 0
    assert (await owner.get("/api/admin/customers")).json()["total"] == 0
    assert (await owner.get("/api/admin/billing/summary")).json()["activePaidOrgs"] == 0
    orgs = (await owner.get("/api/admin/orgs")).json()
    assert [o["demo"] for o in orgs if o["id"] == demo.ORG_ID] == [True]
    # never emailed: a reminder to every demo student sends nothing
    ids = [m["_id"] async for m in db[MEMBERSHIPS].find({"org_id": demo.ORG_ID})]
    r = await owner.post(f"/api/org/{demo.ORG_ID}/placement/remind", json={"ids": ids[:20]})
    assert r.json()["sent"] == 0 and r.json()["reasons"]["demo"] == 20
    # nobody real can join its groups
    r = await owner.get("/api/public/join/DEMOCSE26")
    assert r.status_code == 410 and r.json()["error"]["code"] == "group_inactive"
    # reset gives the same data; remove deletes it all
    assert (await owner.post("/api/admin/demo-org")).json()["students"] == 48
    # demo users: 48 students, the demo alumni, the demo reviewer and the demo coordinator
    assert await db[USERS].count_documents({"demo": True}) == 48 + len(demo.ALUMNI_PEOPLE) + 2
    assert (await owner.delete("/api/admin/demo-org")).status_code == 204
    assert await db[USERS].count_documents({"demo": True}) == 0
    assert await db[ORGANIZATIONS].count_documents({"_id": demo.ORG_ID}) == 0


def test_demo_resumes_have_everything_the_builder_saves():
    """The screens read every list of a resume; the demo's made-up resumes carry them all (empty when unused)."""
    import random

    d = demo._resume(random.Random(1), "Lakshmi Rao", "CSE", "lakshmi@demo.nm7.invalid", 0)
    for k in ("exp", "edu", "proj", "certs", "ach", "langs", "custom", "skillGroups", "linkExtras"):
        assert isinstance(d[k], list), k
    for k in ("personal", "links", "hidden", "titles", "pinfo", "offLines"):
        assert isinstance(d[k], dict), k
    for k in ("summary", "hobbies", "strengths"):
        assert isinstance(d[k], str), k
