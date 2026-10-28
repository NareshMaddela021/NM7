"""Offer tracking: stats match the data (placed / not placed by branch and batch, highest / median / average,
offers per company, multiple offers), packages never reach recruiters or other students, "Selected" on the shortlist
board pre-fills an offer, CSV and the placement report PDF, organization isolation, deleted with the account."""

import pytest

from app.college.offers import stats_of
from app.core.db import AUDIT_LOG, MEMBERSHIPS, OFFERS
from app.me.erase import erase_user_data
from tests.test_college_drives import campus, students
from tests.test_org_recruiter_portal import invite, sign_in
from tests.test_orgs_phase2 import coordinator, second_org


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


def _p(i, branch, group="2026"):
    return {"id": f"m{i}", "name": f"S{i}", "roll": f"R{i}", "branch": branch, "group": group, "group_id": group}


def test_stats_match_the_data():
    people = {p["id"]: p for p in [_p(1, "CSE"), _p(2, "CSE"), _p(3, "ECE"), _p(4, "ECE"), _p(5, "ECE", "2025")]}

    def o(m, c, ctc, kind="full_time", st="accepted"):
        return {"membership_id": m, "company": c, "ctc_lpa": ctc, "type": kind, "status": st}

    offers = [
        o("m1", "Infosys", 3.6),
        o("m1", "Zoho", 7.2),  # m1: two offers
        o("m2", "TCS", 3.36, st="declined"),  # declined: not placed, not counted
        o("m3", "Bosch", 6.0, kind="ppo"),
        o("m4", "Infosys", None, kind="internship"),  # internship: listed, doesn't place
        o("m5", "Infosys", 4.5, st="joined"),
    ]
    s = stats_of(people, offers)
    assert (s["students"], s["placed"], s["notPlaced"], s["offers"]) == (5, 3, 2, 5)
    assert s["packages"] == {"count": 4, "highest": 7.2, "median": 5.25, "average": 5.33}  # (3.6+7.2+6+4.5)/4 = 5.325
    assert {r["name"]: (r["students"], r["placed"], r["percent"]) for r in s["byBranch"]} == {
        "CSE": (2, 1, 50),
        "ECE": (3, 2, 67),
    }
    assert {r["name"]: (r["students"], r["placed"]) for r in s["byBatch"]} == {"2025": (1, 1), "2026": (4, 2)}
    assert s["byCompany"][0] == {"company": "Infosys", "offers": 3, "fullTime": 2, "internships": 1, "ppo": 0}
    assert [m["student"]["id"] for m in s["multiple"]] == ["m1"] and s["multiple"][0]["companies"] == [
        "Infosys",
        "Zoho",
    ]


async def test_record_stats_report_and_privacy(owner, make_client, outbox, db):
    org, g = await campus(owner)
    r = await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    assert r.status_code == 200
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    people = await students(make_client, outbox, 3)
    (s0, m0), (s1, m1), (s2, m2) = people
    base = f"/api/org/{org['id']}/offers"
    r = await c.post(
        base,
        json={
            "membershipId": m0,
            "company": "Infosys",
            "role": "Systems Engineer",
            "ctcLpa": 3.6,
            "type": "full_time",
            "offerDate": "2026-11-01",
            "status": "accepted",
        },
    )
    assert r.status_code == 201 and r.json()["student"]["roll"] == "21A00"
    oid = r.json()["id"]
    await c.post(base, json={"membershipId": m0, "company": "Zoho", "ctcLpa": 7.2, "status": "offered"})
    await c.post(base, json={"membershipId": m1, "company": "TCS", "ctcLpa": 3.36, "status": "declined"})
    s = (await c.get(f"{base}/stats")).json()
    assert (s["placed"], s["notPlaced"], s["packages"]["highest"], s["packages"]["median"]) == (1, 2, 7.2, 5.4)
    # the student sees only their own offers
    mine = (await s0.get("/api/me/offers")).json()
    assert {o["company"] for o in mine} == {"Infosys", "Zoho"} and mine[0]["org"]
    assert (await s2.get("/api/me/offers")).json() == []
    # never to recruiters: no CTC or offers anywhere in what a recruiter sees
    await db[MEMBERSHIPS].update_many({}, {"$set": {"recruiter_opt_in": True, "approval": "approved"}})
    inv, tok = await invite(c, org["id"], [g["id"]])
    rec = make_client()
    h = await sign_in(rec, outbox, tok)
    page = (await rec.get(f"/api/recruiter/{tok}/candidates", headers=h)).text
    first = (await rec.get(f"/api/recruiter/{tok}/candidates", headers=h)).json()["candidates"][0]["id"]
    one = (await rec.get(f"/api/recruiter/{tok}/candidates/{first}", headers=h)).text
    for blob in (page, one):
        assert "3.6" not in blob and "7.2" not in blob and "ctc" not in blob.lower() and "Zoho" not in blob
    # "Selected" on the board pre-fills an offer
    cid = next(x["id"] for x in (await rec.get(f"/api/recruiter/{tok}/candidates", headers=h)).json()["candidates"])
    await rec.put(f"/api/recruiter/{tok}/board/{cid}", headers=h, json={"stage": "selected", "note": "Strong SQL"})
    sug = (await c.get(f"{base}/suggestions")).json()
    assert len(sug) == 1 and sug[0]["company"] == "Acme Analytics" and sug[0]["note"] == "Strong SQL"
    # edit, CSV, PDF
    r = await c.put(
        f"{base}/{oid}",
        json={"membershipId": m0, "company": "Infosys", "role": "Systems Engineer", "ctcLpa": 4.0, "status": "joined"},
    )
    assert r.json()["status"] == "joined" and r.json()["ctcLpa"] == 4.0
    csv = (await c.get(f"{base}/offers.csv")).text
    assert "Infosys" in csv and "Joined" in csv and "21A00" in csv
    pdf = await c.get(f"{base}/report.pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    acts = {a["action"] async for a in db[AUDIT_LOG].find({"data.orgs": org["id"]})}
    assert {"offer_create", "offer_update", "offer_export"} <= acts
    # viewers look but don't record
    viewer, _ = await coordinator(owner, make_client, outbox, org["id"], email="viewer@example.com", role="viewer")
    assert (await viewer.get(f"{base}/stats")).status_code == 200
    assert (await viewer.post(base, json={"membershipId": m2, "company": "X"})).status_code == 403
    # another organization
    o2, _ = await second_org(owner)
    await owner.put(f"/api/admin/orgs/{o2['id']}/billing/plan", json={"planId": "campus"})
    other, _ = await coordinator(owner, make_client, outbox, o2["id"], email="other@example.com")
    assert (await other.get(f"/api/org/{o2['id']}/offers")).json() == []
    assert (
        await other.post(f"/api/org/{o2['id']}/offers", json={"membershipId": m2, "company": "X"})
    ).status_code == 404
    assert (
        await other.put(f"/api/org/{o2['id']}/offers/{oid}", json={"membershipId": m0, "company": "X"})
    ).status_code == 404
    # deleted with the account
    uid = (await db[MEMBERSHIPS].find_one({"_id": m0}))["user_id"]
    assert (await erase_user_data(db, uid))["offers"] == 2
    assert await db[OFFERS].count_documents({"user_id": uid}) == 0


async def test_off_on_free(owner, make_client, outbox):
    from tests.test_orgs import setup_group

    org, _ = await setup_group(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    assert (await c.get(f"/api/org/{org['id']}/offers")).status_code == 404
