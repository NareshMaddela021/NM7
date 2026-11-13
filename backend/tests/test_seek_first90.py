# ruff: noqa: E501
"""Phase 6 S10: the first 90 days. A joined job (told by the student, or an Nm7 offer marked Joined) gets a checklist
and day 7 / day 30 check-ins; a "No" becomes a report to Nm7; reports from two or more different people lower the
company's trust score; weekly progress counts only real events with honest messages; emails respect the stop link."""

from datetime import timedelta

from app.core.db import APPLICATIONS, COMPANIES, JOINING_REPORTS, JOININGS, USERS
from app.core.time import IST, now
from app.seek import first90
from tests.conftest import signup
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import no_network  # noqa: F401


def ago(days):
    return (now().astimezone(IST).date() - timedelta(days=days)).isoformat()


async def test_checklist_and_checkins(client, outbox, db):
    await signup(client, outbox)
    assert (
        await client.post(
            "/api/me/progress/joined", json={"company": "Acme", "role": "Analyst", "joinDate": "1999-01-01"}
        )
    ).status_code == 422
    j = (
        await client.post("/api/me/progress/joined", json={"company": "Acme", "role": "Analyst", "joinDate": ago(9)})
    ).json()
    assert j["day"] == 10 and j["due"] == 7 and len(j["checklist"]["week1"]) == 4 and j["tips"]
    item = j["checklist"]["week1"][0]["id"]
    j = (await client.put(f"/api/me/progress/joined/{j['id']}/item", json={"item": item, "done": True})).json()
    assert j["checklist"]["week1"][0]["done"]
    assert (
        await client.post(f"/api/me/progress/joined/{j['id']}/checkin", json={"day": 30, "ok": True})
    ).status_code == 409  # too early
    assert (
        await client.post(f"/api/me/progress/joined/{j['id']}/checkin", json={"day": 7, "ok": False})
    ).status_code == 422  # say what
    j = (await client.post(f"/api/me/progress/joined/{j['id']}/checkin", json={"day": 7, "ok": True})).json()
    assert j["checkins"]["7"]["ok"] and j["due"] is None
    assert (
        await client.post(
            f"/api/me/progress/joined/{j['id']}/checkin", json={"day": 7, "ok": False, "problems": ["salary"]}
        )
    ).status_code == 409
    assert await db[JOINING_REPORTS].count_documents({}) == 0


async def test_reports_from_two_people_lower_trust(client, outbox, db, make_client, admin_client):
    session, cid = await verified(client, outbox, db)
    name = (await db[COMPANIES].find_one({"_id": cid}))["details"]["legal_name"]
    from app.companies.trust import refresh

    base = (await refresh(db, cid))["value"]
    people = []
    for e in ("a@example.com", "b@example.com"):
        s = make_client()
        await signup(s, outbox, email=e, name=e[0].upper())
        j = (
            await s.post("/api/me/progress/joined", json={"company": name, "role": "Analyst", "joinDate": ago(8)})
        ).json()
        r = await s.post(
            f"/api/me/progress/joined/{j['id']}/checkin",
            json={"day": 7, "ok": False, "problems": ["salary", "hours"], "note": "Pay is lower than the offer."},
        )
        assert r.status_code == 200
        people.append(s)
        if e.startswith("a"):
            assert (await db[COMPANIES].find_one({"_id": cid}))["score"]["value"] == base  # one person: no change
    assert (await db[COMPANIES].find_one({"_id": cid}))["score"]["value"] == base - 5
    owner = await admin_client("owner")
    rows = (await owner.get("/api/admin/joining-reports")).json()
    assert len(rows) == 2 and rows[0]["problems"] == ["salary", "hours"] and rows[0]["companyId"] == cid
    assert (await owner.post(f"/api/admin/joining-reports/{rows[0]['id']}/close", json={"dismiss": True})).json()[
        "status"
    ] == "dismissed"
    assert (await db[COMPANIES].find_one({"_id": cid}))["score"]["value"] == base  # dismissed: no longer counts


async def test_offer_joined_appears_and_weekly_numbers(client, outbox, db):
    from app.core.db import HIRE_OFFERS

    await signup(client, outbox)
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    await db[HIRE_OFFERS].insert_one(
        {"user_id": uid, "company_id": "nope", "status": "joined", "role": "Support executive", "join_date": ago(2)}
    )
    d = (await client.get("/api/me/progress")).json()
    assert [x["role"] for x in d["joined"]] == ["Support executive"] and d["joined"][0]["source"] == "offer"
    assert (await client.get("/api/me/progress")).json()["joined"].__len__() == 1  # not twice
    w = d["week"]
    assert w["applications"] == 0 and w["interviews"] == 0 and w["skillsVerified"] == []
    assert "quiet week" in d["message"].lower()
    await db[APPLICATIONS].insert_one({"user_id": uid, "job_id": "j1", "status": "applied", "created_at": now()})
    d = (await client.get("/api/me/progress")).json()
    assert d["week"]["applications"] == 1 and "applied this week" in d["message"]


async def test_emails_once_and_stop_link(client, outbox, db):
    await signup(client, outbox)
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    await db[APPLICATIONS].insert_one({"user_id": uid, "job_id": "j1", "status": "applied", "created_at": now()})
    outbox.sent.clear()
    assert await first90.send_weekly(db, outbox) == 1
    m = outbox.sent[-1]
    assert "This week: 1 application, 0 interviews." in m.text and "Stop these emails" in m.text
    assert await first90.send_weekly(db, outbox) == 0  # once a week
    # check-ins: day 7 email once; nothing after the stop link
    j = (
        await client.post("/api/me/progress/joined", json={"company": "Acme", "role": "Analyst", "joinDate": ago(7)})
    ).json()
    assert await first90.send_checkins(db, outbox) == 1 and "Day 7 at Acme" in outbox.sent[-1].subject
    assert await first90.send_checkins(db, outbox) == 0
    assert (await client.post("/api/public/progress/stop", json={"token": first90.unsub_token(uid)})).status_code == 200
    await db[JOININGS].update_many({}, {"$set": {"join_date": ago(30), "checkin_mailed": [7]}})
    assert await first90.send_checkins(db, outbox) == 0  # day 30 due, but emails are off
    assert j


async def test_erase(client, outbox, db):
    from app.me.erase import erase_account

    await signup(client, outbox)
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    j = (
        await client.post("/api/me/progress/joined", json={"company": "Acme", "role": "Analyst", "joinDate": ago(8)})
    ).json()
    await client.post(
        f"/api/me/progress/joined/{j['id']}/checkin",
        json={"day": 7, "ok": False, "problems": ["role"], "note": "Different role"},
    )
    await erase_account(db, uid)
    assert await db[JOININGS].count_documents({"user_id": uid}) == 0
    r = await db[JOINING_REPORTS].find_one({})
    assert r["user_id"] is None and r["note"] == "" and r["problems"] == ["role"]


async def test_demo_students(client, make_client, admin_client, db):
    owner = await admin_client("owner")
    r = (await owner.post("/api/admin/seek/demo", json={"who": "meera"})).json()
    assert r["path"].startswith("/demo-student#t=") and r["picks"]
    token = r["path"].split("t=")[1]
    s = make_client()
    assert (await s.post("/api/public/demo-student", json={"token": token})).json()[
        "path"
    ] == "/me/learn?role=data-analyst"
    assert (await s.post("/api/public/demo-student", json={"token": token})).status_code == 400  # one time
    learn = (await s.get("/api/me/learn/data-analyst")).json()
    assert learn["verified"]["skill"] == "SQL" and 0 < learn["progress"] < 100
    assert (await s.get("/api/me/roles")).json()["roles"][0]["id"]
    assert (await s.get("/api/me/practice")).json()["topics"]
    oc = (await s.get("/api/me/offer-check")).json()
    assert oc[0]["verdict"] == "warning" and any(f["kind"] == "bond" for f in oc[0]["findings"])
    assert (await s.get("/api/me/feedback")).json()["feedback"][0]["help"]
    assert (await s.get("/api/me/state")).status_code == 200  # the dashboard loads (the demo application is complete)
    pg = (await s.get("/api/me/programs")).json()
    assert pg[0]["status"] == "completed" and pg[0]["certificate"]
    assert (await make_client().get(f"/api/public/certificates/{pg[0]['certificate']}")).json()["valid"]
    r = (await owner.post("/api/admin/seek/demo", json={"who": "arjun"})).json()
    a = make_client()
    assert (await a.post("/api/public/demo-student", json={"token": r["path"].split("t=")[1]})).json()[
        "path"
    ] == "/me/progress"
    j = (await a.get("/api/me/progress")).json()["joined"][0]
    assert j["day"] == 10 and j["checkins"]["7"]["ok"] and j["due"] is None
    # never public: demo jobs and projects stay off the board
    assert all(p["id"] != "demo-seek-project" for p in (await client.get("/api/programs")).json())
    assert (await client.get("/api/jobs/demo-seek-job")).status_code == 404
    # reset again works (no duplicates)
    await owner.post("/api/admin/seek/demo", json={"who": "meera"})
    assert await db["program_apps"].count_documents({"program_id": "demo-seek-project"}) == 1
