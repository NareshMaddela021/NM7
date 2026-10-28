"""Multiple campuses under one college group: admin sets the group up; owners see roll-up numbers by campus (never
student data); campus coordinators stay isolated; shared format, drive schedule and recruiter invite; Campus only."""

import pytest

from app.core.db import DRIVES, OFFERS, ORGANIZATIONS, RECRUITER_INVITES
from tests.conftest import signup
from tests.test_college_drives import a_drive, students
from tests.test_orgs import FIELDS
from tests.test_orgs_phase2 import coordinator


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def campus(owner, name, code, plan="campus"):
    o = (await owner.post("/api/admin/orgs", json={"name": name, "type": "college", "city": "Guntur"})).json()
    g = (
        await owner.post(
            f"/api/admin/orgs/{o['id']}/groups", json={"name": "B.Tech 2026", "code": code, "customFields": FIELDS}
        )
    ).json()
    await owner.put(f"/api/admin/orgs/{o['id']}/billing/plan", json={"planId": plan})
    await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    return o, g


async def setup(owner, make_client, outbox, db):
    a, ga = await campus(owner, "Vignan Guntur", "VIGG26")
    b, gb = await campus(owner, "Vignan Vizag", "VIGV26")
    head = make_client()
    await signup(head, outbox, "chair@vignan.example", name="Group Chair")
    grp = (await owner.post("/api/admin/college-groups", json={"name": "Vignan Group"})).json()
    r = await owner.put(
        f"/api/admin/college-groups/{grp['id']}",
        json={
            "name": "Vignan Group",
            "orgIds": [a["id"], b["id"]],
            "ownerEmails": ["chair@vignan.example"],
            "groupPrice": 4000000,
            "priceNote": "2 campuses, 1 year",
        },
    )
    assert r.status_code == 200, r.text
    return a, ga, b, gb, head, grp


async def test_rollup_counts_only_and_isolation(owner, make_client, outbox, db):
    a, ga, b, gb, head, grp = await setup(owner, make_client, outbox, db)
    sa = await students(make_client, outbox, 3, code="VIGG26", prefix="a")
    sb = await students(make_client, outbox, 2, code="VIGV26", prefix="b")
    ca, _ = await coordinator(owner, make_client, outbox, a["id"], email="ca@example.com")
    await ca.post(
        f"/api/org/{a['id']}/offers",
        json={"membershipId": sa[0][1], "company": "Infosys", "ctcLpa": 4.0, "status": "accepted"},
    )
    await ca.post(
        f"/api/org/{a['id']}/offers",
        json={"membershipId": sa[1][1], "company": "Zoho", "ctcLpa": 8.0, "status": "joined"},
    )
    d = (await head.get(f"/api/college-group/{grp['id']}")).json()
    by = {c["name"]: c for c in d["campuses"]}
    assert (by["Vignan Guntur"]["joined"], by["Vignan Guntur"]["placed"], by["Vignan Guntur"]["highest"]) == (3, 2, 8.0)
    assert (by["Vignan Vizag"]["joined"], by["Vignan Vizag"]["placed"]) == (2, 0)
    assert (d["total"]["joined"], d["total"]["placed"], d["total"]["median"]) == (5, 2, 6.0)
    raw = str(d)
    assert "Student" not in raw and "@" not in raw and "21A0" not in raw  # numbers only
    # a campus coordinator still sees only their campus
    assert (await ca.get(f"/api/org/{b['id']}/offers")).status_code == 404
    assert (await ca.get(f"/api/college-group/{grp['id']}")).status_code == 404
    # strangers and students: 404
    assert (await sb[0][0].get(f"/api/college-group/{grp['id']}")).status_code == 404
    assert (await head.get("/api/me/college-groups")).json()[0]["campuses"] == 2
    # admin-only setup
    assert (await ca.post("/api/admin/college-groups", json={"name": "Mine"})).status_code in (401, 403)
    # a campus can be in one group only
    g2 = (await owner.post("/api/admin/college-groups", json={"name": "Other"})).json()
    r = await owner.put(f"/api/admin/college-groups/{g2['id']}", json={"name": "Other", "orgIds": [a["id"]]})
    assert r.status_code == 409


async def test_shared_format_drive_and_invite(owner, make_client, outbox, db):
    a, ga, b, gb, head, grp = await setup(owner, make_client, outbox, db)
    await db[ORGANIZATIONS].update_one(
        {"_id": a["id"]}, {"$set": {"branding": {"color": "#7a1f1f", "header": "Vignan University"}}}
    )
    r = await head.put(f"/api/college-group/{grp['id']}/format", json={"fromOrgId": a["id"]})
    assert r.json() == {"updated": 1}
    assert (await db[ORGANIZATIONS].find_one({"_id": b["id"]}))["branding"]["header"] == "Vignan University"
    # a drive day's schedule copied to the other campus (its own groups, no students)
    ca, _ = await coordinator(owner, make_client, outbox, a["id"], email="ca@example.com")
    await students(make_client, outbox, 2, code="VIGG26", prefix="a")
    base, d = await a_drive(ca, a["id"], ga["id"])
    r = await head.post(
        f"/api/college-group/{grp['id']}/share-drive",
        json={"orgId": a["id"], "driveId": d["id"], "toOrgIds": [b["id"]]},
    )
    assert r.json() == {"copied": 1}
    copy = await db[DRIVES].find_one({"org_id": b["id"]})
    assert (
        copy["group_ids"] == [gb["id"]] and len(copy["slots"]) == 2 and all(s["members"] == [] for s in copy["slots"])
    )
    # the recruiter invited to the other campus, emailed its own link
    inv = (
        await ca.post(
            f"/api/org/{a['id']}/recruiter-invites",
            json={
                "company": "Acme",
                "recruiterName": "Ravi",
                "email": "ravi@acme.example",
                "groupIds": [ga["id"]],
                "expiresOn": "2026-12-31",
            },
        )
    ).json()
    n = len(outbox.sent)
    r = await head.post(
        f"/api/college-group/{grp['id']}/share-invite",
        json={"orgId": a["id"], "inviteId": inv["id"], "toOrgIds": [b["id"]]},
    )
    assert r.json() == {"copied": 1}
    assert outbox.sent[n].to == "ravi@acme.example" and "/recruiter/" in outbox.sent[n].text
    copy = await db[RECRUITER_INVITES].find_one({"org_id": b["id"]})
    assert copy["group_ids"] == [gb["id"]] and copy["board"] == {}
    # only campuses on the Campus plan count; an Owner who isn't the group's owner gets 404
    await owner.put(f"/api/admin/orgs/{a['id']}/billing/plan", json={"planId": "drive"})
    await owner.put(f"/api/admin/orgs/{b['id']}/billing/plan", json={"planId": "drive"})
    assert (await head.get(f"/api/college-group/{grp['id']}")).status_code == 404
    assert await db[OFFERS].count_documents({}) == 0
