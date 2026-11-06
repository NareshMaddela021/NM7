"""Phase 3 A7 + demo: Admin → Auto Apply (numbers per day Auto vs Manual by channel, the off switch that stops
everything, editable defaults, pause a student, pause a company, the run log), the company's "Not relevant" mark
(repeated marks stop that student's auto applications there), and the demo student shortcut (never public)."""

from app.autoapply import demo, engine
from app.core.db import APPLICATIONS, AUDIT_LOG, AUTO_ITEMS, JOBS, USERS
from app.site import get_site
from tests.test_auto_apply_engine import URL, company_job, no_ai, roomy, run, student  # noqa: F401
from tests.test_companies_posting import verified
from tests.test_companies_signup import H, no_network  # noqa: F401

ADMIN = "/api/admin/auto-apply"
DEFAULTS = {
    "on": True,
    "minScore": 70,
    "dailyLimit": 5,
    "maxDailyLimit": 10,
    "previewDays": 3,
    "companyCap": 10,
    "trustMin": 40,
    "borderline": 5,
    "atsMin": 60,
    "emailDailyCap": 80,
    "irrelevantStop": 2,
}


async def test_admin_numbers_off_switch_and_defaults(client, outbox, db, admin_client):
    assert (await (await admin_client("support")).get(ADMIN)).status_code == 403
    owner = await admin_client("owner")
    session, cid = await verified(client, outbox, db)
    j1 = await company_job(client, session, cid, "Junior Data Analyst")
    await company_job(client, session, cid, "Data Analyst Two")
    uid = await student(client, outbox, db)
    await client.post(f"/api/jobs/{j1['id']}/apply", json={"consent": True})  # one by hand
    await engine.run(db, outbox, force=True)
    o = (await owner.get(ADMIN)).json()
    today = o["days"][0]
    assert today["auto"] == {"nm7": 1} and today["manual"] == {"nm7": 1}
    assert o["students"]["on"] == 1 and o["runs"][0]["counts"]["applied"] == 1
    # the off switch: nothing is applied or sent
    r = await owner.put(f"{ADMIN}/settings", json={**DEFAULTS, "on": False})
    assert r.json()["on"] is False
    await company_job(client, session, cid, "Data Analyst Three")
    assert await run(db) == {"off": True}
    assert await db[APPLICATIONS].count_documents({"user_id": uid, "origin": "auto"}) == 1
    # defaults are editable and checked; everything is logged
    assert (await owner.put(f"{ADMIN}/settings", json={**DEFAULTS, "dailyLimit": 11})).status_code == 400
    await owner.put(f"{ADMIN}/settings", json={**DEFAULTS, "minScore": 80, "previewDays": 0})
    site = (await get_site(db))["auto_apply"]
    assert site["on"] is True and site["min_score"] == 80 and site["preview_days"] == 0
    assert await db[AUDIT_LOG].count_documents({"action": "auto_apply.admin_settings"}) == 2


async def test_pause_student_and_company(client, outbox, db, admin_client):
    owner = await admin_client("owner")
    session, cid = await verified(client, outbox, db)
    await company_job(
        client, session, cid, "Junior Data Analyst", questions=[{"text": "Notice period in days?", "kind": "number"}]
    )
    uid = await student(client, outbox, db)
    await engine.run(db, outbox, force=True)
    users = (await owner.get(f"{ADMIN}/users", params={"q": "sai"})).json()
    assert users[0]["id"] == uid and users[0]["stuck"] == 1
    # paused by Admin: the run skips them and their answers can't send
    await owner.post(f"{ADMIN}/users/{uid}/pause", json={"paused": True, "reason": "Complaints from companies"})
    it = (await client.get(f"{URL}/items")).json()["needsAnswer"][0]
    r = await client.post(f"{URL}/items/{it['id']}/answer", json={"answers": {"q1": 30}})
    assert r.json()["error"]["code"] == "admin_paused"
    await company_job(client, session, cid, "Data Analyst Two")
    assert (await run(db))["users"] == 0
    await owner.post(f"{ADMIN}/users/{uid}/pause", json={"paused": False})
    # a company paused by Admin gets no auto applications
    await owner.post(f"{ADMIN}/companies/{cid}/pause", json={"paused": True, "reason": "Asked us to"})
    out = await run(db)
    assert out["applied"] == 0
    assert await db[AUDIT_LOG].count_documents({"action": {"$regex": "^auto_apply.admin_(pause|resume)"}}) == 3


async def test_not_relevant_marks_stop_that_company(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    j1 = await company_job(client, session, cid, "Junior Data Analyst")
    j2 = await company_job(client, session, cid, "Data Analyst Two")
    uid = await student(client, outbox, db)
    await engine.run(db, outbox, force=True)
    rows = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
    assert len(rows) == 2 and all(r["origin"] == "auto" for r in rows)
    r = await client.post(
        f"/api/company/{cid}/applicants/{rows[0]['id']}/irrelevant", json={"on": True}, headers=H(session)
    )
    assert r.json() == {"irrelevant": True, "marks": 1, "stopped": False}
    r = await client.post(
        f"/api/company/{cid}/applicants/{rows[1]['id']}/irrelevant", json={"on": True}, headers=H(session)
    )
    assert r.json()["stopped"] is True
    assert cid in (await db[USERS].find_one({"_id": uid}))["auto_apply"]["blocked_companies"]
    j3 = await company_job(client, session, cid, "Data Analyst Three")
    await run(db)
    assert not await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j3["id"]})
    assert {j1["id"], j2["id"]} == {a["job_id"] async for a in db[APPLICATIONS].find({"user_id": uid})}


async def test_demo_student(client, outbox, db, admin_client, make_client):
    owner = await admin_client("owner")
    r = (await owner.post(f"{ADMIN}/demo")).json()
    assert r["path"].startswith("/demo-student#t=") and r["items"] == 4
    token = r["path"].split("#t=")[1]
    browser = make_client()
    assert (await browser.post("/api/public/demo-student", json={"token": token})).json() == {"path": "/me/auto-apply"}
    assert (await browser.post("/api/public/demo-student", json={"token": token})).status_code == 400  # one time
    me = (await browser.get("/api/auth/me")).json()
    assert me["name"] == "Kavya Reddy (demo)" and me["role"] == "customer"
    items = (await browser.get(f"{URL}/items")).json()
    assert len(items["needsAnswer"]) == 1 and len(items["ready"]) == 1 and len(items["applied"]) == 2
    assert {x["channel"] for x in items["applied"]} == {"nm7", "email"}
    st = (await browser.get("/api/me/state")).json()["apps"]
    assert any(a.get("sentEmail") for a in st) and all(a.get("origin") == "auto" for a in st)
    # demo jobs are never public, and demo students never run
    j = await db[JOBS].find_one({"_id": demo.EXTRA_JOBS[0]})
    assert (await client.get(f"/api/jobs/{j['slug']}")).status_code == 404
    await db[USERS].update_many({}, {"$set": {"auto_apply.run_day": None}})
    assert (await engine.run(db, outbox, force=True))["users"] == 0
    # reset is repeatable
    again = (await owner.post(f"{ADMIN}/demo")).json()
    assert again["items"] == 4 and await db[AUTO_ITEMS].count_documents({"user_id": demo.STUDENT_ID}) == 4
