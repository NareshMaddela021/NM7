"""Phase 3 A2 + A3: the Auto Apply daily engine and "Needs your answer".

Only eligible jobs (score, roles, cities, levels, salary, avoided companies), the hard-rule skips (closed, dead link,
reported, scam-flagged, low trust, company paused), never twice (re-runs, manual applies), the daily limit (stuck jobs
don't use it), 2 per company in 30 days, tailored copies with only the resume's facts, the Auto label for companies,
stuck → the run continues → answer → applied at once (remember for next time; over the limit → first thing next
run), borderline matches, preview days with Approve / Approve all, and the off switch."""

from datetime import timedelta

import pytest

from app.autoapply import engine
from app.core.db import APPLICATIONS, AUDIT_LOG, AUTO_COPIES, AUTO_ITEMS, AUTO_RUNS, COMPANIES, JOB_REPORTS, JOBS, USERS
from app.core.time import now
from app.jobs import fit as fitmod
from app.jobsearch import facts
from app.site import save_site
from tests.conftest import signup
from tests.jobs_helpers import add_resume, strong_resume
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401

URL = "/api/me/auto-apply"
RULES = {
    "roles": ["Data Analyst", "SQL"],
    "cities": ["Hyderabad"],
    "remote": True,
    "minScore": 60,
    "dailyLimit": 5,
    "consent": True,
}
DESC = "Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given."


@pytest.fixture(autouse=True)
async def roomy(db):
    await save_site(db, {"companies": {"verified_live_jobs": 50}, "auto_apply": {"company_cap": 10}})


async def student(client, outbox, db, preview=False, **rules):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    await add_resume(client, data=strong_resume())
    r = await client.put(URL, json={**RULES, **rules})
    assert r.status_code == 200, r.text
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    if not preview:  # past the preview days
        await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.started_at": now() - timedelta(days=5)}})
    return uid


async def company_job(client, session, cid, title, **over):
    job = {
        "title": title,
        "locations": ["Hyderabad"],
        "experience": "fresher",
        "skills": ["SQL", "Power BI"],
        "description": DESC,
        **over,
    }
    r = await client.post(f"/api/company/{cid}/jobs", json={"job": job}, headers=H(session))
    assert r.status_code == 201, r.text
    return r.json()


async def run(db):
    await db[USERS].update_many({}, {"$set": {"auto_apply.run_day": None}})  # let the student run again
    return await engine.run(db, force=True)


async def test_selects_only_eligible_jobs_and_never_twice(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    good = await company_job(client, session, cid, "Junior Data Analyst")
    low = await company_job(
        client, session, cid, "SQL Java Backend Developer", skills=["Java", "Spring", "Kafka"], experience="1_3"
    )
    far = await company_job(client, session, cid, "Data Analyst Chennai", locations=["Chennai"])
    dead = await company_job(client, session, cid, "Data Analyst Trainee")
    await db[JOBS].update_one({"_id": dead["id"]}, {"$set": {"link_check.fails": 2}})
    reported = await company_job(client, session, cid, "Data Analyst Intern")
    await db[JOB_REPORTS].insert_one(
        {
            "_id": f"x:{reported['id']}",
            "job_id": reported["id"],
            "state": "open",
            "at": now(),
            "user_id": "x",
            "reason": "fake",
        }
    )
    closed = await company_job(client, session, cid, "Data Analyst Associate")
    await db[JOBS].update_one({"_id": closed["id"]}, {"$set": {"status": "closed"}})
    # a low-trust company and an avoided one
    s2, c2 = await verified(client, outbox, db, email="priya@gmail.com")
    shady = await company_job(client, s2, c2, "Data Analyst Shady")
    uid = await student(client, outbox, db)
    await db[COMPANIES].update_one({"_id": c2}, {"$set": {"score.value": 30}})
    out = await engine.run(db, force=True)
    assert out["applied"] == 1 and out["users"] == 1
    apps = await db[APPLICATIONS].find({"user_id": uid}).to_list(None)
    assert [a["job_id"] for a in apps] == [good["id"]]
    a = apps[0]
    assert a["origin"] == "auto" and a["channel"] == "nm7" and a["company_id"] == cid and a["consent_at"]
    assert a["copy_id"] and a["resume_version"]["key"] and a["score"] >= 60
    for j in (low, far, dead, reported, closed, shady):
        assert not await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["id"]})
    log = (await db[AUTO_RUNS].find_one({"_id": engine.today()}))["counts"]
    assert (
        log["applied"] == 1 and log["skip_dead_link"] == 1 and log["skip_reported"] == 1 and log["skip_low_trust"] == 1
    )
    assert await db[AUDIT_LOG].count_documents({"action": "auto_apply.applied", "target": good["id"]}) == 1
    # the company sees it labelled Auto, with the tailored copy as sent
    rows = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
    assert rows[0]["origin"] == "auto" and rows[0]["resume"].endswith("(Auto Apply)")
    one = (await client.get(f"/api/company/{cid}/applicants/{rows[0]['id']}", headers=H(session))).json()
    copy = await db[AUTO_COPIES].find_one({"_id": a["copy_id"]})
    assert one["data"]["summary"] == copy["data"]["summary"]
    # My applications shows it as Auto
    st = (await client.get("/api/me/state")).json()["apps"]
    assert [x["origin"] for x in st if x.get("jobId") == good["id"]] == ["auto"]
    # re-runs (same day or later) never apply twice
    assert (await run(db))["applied"] == 0
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 1


async def test_tailored_copy_keeps_to_the_facts(client, outbox, db, monkeypatch):
    session, cid = await verified(client, outbox, db)
    await company_job(client, session, cid, "Junior Data Analyst")
    uid = await student(client, outbox, db)

    async def invented(db_, uid_, run_):  # an AI answer that invents a skill, a number and a company
        return {
            "summary": "Data analyst with 10 years at Google, expert in AWS, SQL and Power BI dashboards for sales.",
            "bullets": [],
        }

    monkeypatch.setattr(engine, "_ai", invented)
    assert (await engine.run(db, force=True))["applied"] == 1
    copy = await db[AUTO_COPIES].find_one({"user_id": uid})
    text = copy["data"]["summary"]
    assert "Google" not in text and "AWS" not in text and "10 years" not in text
    job = await db[JOBS].find_one({"company_id": cid})
    assert facts.ok(text, facts.resume_text(strong_resume()), f"{job['title']} {job['company']['name']} Hyderabad")
    assert copy["stats"]["ai_rejected"] >= 1


async def test_daily_limit_company_cap_and_manual_applies(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    jobs = [await company_job(client, session, cid, f"Data Analyst {i}") for i in range(4)]
    uid = await student(client, outbox, db, dailyLimit=2)
    await save_site(db, {"auto_apply": {"company_cap": 3}})
    # one applied by hand first: never applied again, and it counts towards the company cap
    await client.post(f"/api/jobs/{jobs[0]['id']}/apply", json={"consent": True})
    assert (await engine.run(db, force=True))["applied"] == 2  # the daily limit
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 3
    # tomorrow: the 30-day company cap (3) stops the last one
    await db[AUTO_ITEMS].update_many({"user_id": uid}, {"$set": {"counted_day": "2000-01-01"}})
    out = await run(db)
    assert out["applied"] == 0 and (await db[AUTO_RUNS].find_one({"_id": engine.today()}))["counts"]["skip_company_cap"]
    assert await db[APPLICATIONS].count_documents({"user_id": uid, "origin": "auto"}) == 2


async def test_stuck_continue_answer_remember_and_queue(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    notice = {"text": "What is your notice period in days?", "kind": "number"}
    shift = {"text": "Which shift suits you?", "kind": "choice", "options": ["Day", "Night"], "accept": ["Day"]}
    asks = await company_job(client, session, cid, "Data Analyst Notice", questions=[notice])
    plain = await company_job(client, session, cid, "Data Analyst Plain")
    asks2 = await company_job(client, session, cid, "Data Analyst Shift", questions=[shift, notice])
    uid = await student(client, outbox, db, dailyLimit=1)
    out = await engine.run(db, force=True)
    # the question jobs wait; the run carried on and applied to the plain one; stuck jobs didn't use the limit
    assert out["applied"] == 1 and out["needs_answer"] == 2
    assert await db[APPLICATIONS].find_one({"user_id": uid, "job_id": plain["id"]})
    items = (await client.get(f"{URL}/items")).json()
    assert {x["job"]["id"] for x in items["needsAnswer"]} == {asks["id"], asks2["id"]}
    it = next(x for x in items["needsAnswer"] if x["job"]["id"] == asks["id"])
    assert it["questions"] == [{"id": "q1", "text": notice["text"], "kind": "number", "options": []}]
    # a bad answer, then a good one: over today's limit (1) → queued for the next run
    r = await client.post(f"{URL}/items/{it['id']}/answer", json={"answers": {"q1": "soon"}})
    assert r.json()["error"]["code"] == "answers"
    r = await client.post(f"{URL}/items/{it['id']}/answer", json={"answers": {"q1": 30}, "remember": True})
    assert r.json() == {"state": "queued"}
    saved = (await db[USERS].find_one({"_id": uid}))["auto_apply"]["answers"]
    assert saved == {"what is your notice period in days": 30}
    # the next day: the queued one goes first, and the saved notice answer is reused for the shift job's question
    await db[AUTO_ITEMS].update_many({"user_id": uid}, {"$set": {"counted_day": "2000-01-01"}})
    out = await run(db)
    assert out["applied"] == 1 and await db[APPLICATIONS].find_one({"user_id": uid, "job_id": asks["id"]})
    it2 = next(x for x in (await client.get(f"{URL}/items")).json()["needsAnswer"] if x["job"]["id"] == asks2["id"])
    assert [q["id"] for q in it2["questions"]] == ["q1"]  # only the shift question is still missing
    # answering within the limit applies at once
    await db[AUTO_ITEMS].update_many({"user_id": uid}, {"$set": {"counted_day": "2000-01-01"}})
    r = await client.post(f"{URL}/items/{it2['id']}/answer", json={"answers": {"q1": "Day"}})
    assert r.json() == {"state": "applied"}
    a = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": asks2["id"]})
    assert a["answers"] == {"q1": "Day", "q2": 30} and a["fit"]["ok"] and a["origin"] == "auto"
    # a closed job's stuck item expires
    stuck = await company_job(
        client, session, cid, "Data Analyst Later", questions=[{"text": "Can you join on a Monday?", "kind": "yesno"}]
    )
    await run(db)
    await db[JOBS].update_one({"_id": stuck["id"]}, {"$set": {"status": "closed"}})
    await run(db)
    assert (await db[AUTO_ITEMS].find_one({"job_id": stuck["id"]}))["state"] == "expired"


async def test_borderline_go_and_skip(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    j1 = await company_job(client, session, cid, "Junior Data Analyst")
    j2 = await company_job(client, session, cid, "Data Analyst Two")
    score = fitmod.fit(await db[JOBS].find_one({"_id": j1["id"]}), fitmod.Person({"_id": "x", "data": strong_resume()}))
    uid = await student(client, outbox, db, minScore=min(100, score["score"] + 3))
    out = await engine.run(db, force=True)
    assert out["applied"] == 0 and out["needs_answer"] == 2
    items = (await client.get(f"{URL}/items")).json()["needsAnswer"]
    assert {x["kind"] for x in items} == {"borderline"}
    a, b = items
    assert (await client.post(f"{URL}/items/{a['id']}/go")).json() == {"state": "applied"}
    assert (await client.post(f"{URL}/items/{b['id']}/skip")).json() == {"state": "skipped"}
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 1
    assert (await client.post(f"{URL}/items/{b['id']}/go")).status_code == 404
    assert {j1["id"], j2["id"]} >= {x["job_id"] async for x in db[APPLICATIONS].find({"user_id": uid})}


async def test_preview_days_approve_and_off_switch(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    j1 = await company_job(client, session, cid, "Junior Data Analyst")
    j2 = await company_job(client, session, cid, "Data Analyst Two")
    j3 = await company_job(client, session, cid, "Data Analyst Three")
    uid = await student(client, outbox, db, preview=True)
    out = await engine.run(db, force=True)
    assert out["waiting_approval"] == 3 and out["applied"] == 0
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 0  # nothing sent before Approve
    waiting = (await client.get(f"{URL}/items")).json()["waiting"]
    one = next(x for x in waiting if x["job"]["id"] == j1["id"])
    assert (await client.post(f"{URL}/items/{one['id']}/approve")).json() == {"state": "applied"}
    skip = next(x for x in waiting if x["job"]["id"] == j2["id"])
    await client.post(f"{URL}/items/{skip['id']}/skip")
    # the off switch: nothing is sent
    await save_site(db, {"auto_apply": {"on": False, "company_cap": 10}})
    r = await client.post(f"{URL}/items/approve-all")
    assert r.status_code == 409 and r.json()["error"]["code"] == "site_off"
    assert (await run(db)) == {"off": True}
    await save_site(db, {"auto_apply": {"on": True, "company_cap": 10}})
    assert (await client.post(f"{URL}/items/approve-all")).json() == {"applied": 1}
    got = {a["job_id"] async for a in db[APPLICATIONS].find({"user_id": uid})}
    assert got == {j1["id"], j3["id"]}
    # paused by the student or by Admin: the run leaves them alone
    await client.post(f"{URL}/pause", json={"paused": True})
    j4 = await company_job(client, session, cid, "Data Analyst Four")
    assert (await run(db))["users"] == 0
    assert not await db[AUTO_ITEMS].find_one({"job_id": j4["id"]})


async def test_morning_only_and_resumable(client, outbox, db, monkeypatch):
    session, cid = await verified(client, outbox, db)
    await company_job(client, session, cid, "Junior Data Analyst")
    uid = await student(client, outbox, db)
    early = now().replace(hour=0, minute=30)  # 06:00 IST
    monkeypatch.setattr(engine, "now", lambda: early)
    assert await engine.run(db) == {"waiting": True}
    monkeypatch.undo()
    # a student locked by another pass is left for later; once the lock is old the run picks them up
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.lock_until": now() + timedelta(minutes=5)}})
    assert (await engine.run(db, force=True))["users"] == 0
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.lock_until": now() - timedelta(minutes=1)}})
    assert (await engine.run(db, force=True))["applied"] == 1
    assert (await engine.run(db, force=True))["users"] == 0  # done for today


async def test_company_cap_on_answer_and_approve(client, outbox, db):
    """Fix round item 9: the 30-day company cap holds on every path, not only the morning run: answering a question
    and Approve / Approve all in the preview days never send a third application to the same company."""
    session, cid = await verified(client, outbox, db)
    await save_site(db, {"auto_apply": {"company_cap": 2}})
    q = {"text": "What is your notice period in days?", "kind": "number"}
    asks = await company_job(client, session, cid, "Data Analyst Notice", questions=[q])
    uid = await student(client, outbox, db)
    assert (await engine.run(db, force=True))["needs_answer"] == 1
    await company_job(client, session, cid, "Data Analyst One")
    await company_job(client, session, cid, "Data Analyst Two")
    assert (await run(db))["applied"] == 2  # the company's cap is now used up
    it = (await client.get(f"{URL}/items")).json()["needsAnswer"][0]
    r = await client.post(f"{URL}/items/{it['id']}/answer", json={"answers": {"q1": 30}})
    assert r.json()["state"] == "skipped"
    assert not await db[APPLICATIONS].find_one({"user_id": uid, "job_id": asks["id"]})
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 2
    # the preview days: Approve and Approve all keep to the cap too
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.started_at": now()}})
    await company_job(client, session, cid, "Data Analyst Three")
    await company_job(client, session, cid, "Data Analyst Four")
    await db[AUTO_ITEMS].update_many({"user_id": uid}, {"$set": {"counted_day": "2000-01-01"}})
    await db[APPLICATIONS].update_many({"user_id": uid}, {"$set": {"created_at": now() - timedelta(days=40)}})
    assert (await run(db))["waiting_approval"] == 2  # an old month: room again for 2
    await db[APPLICATIONS].update_many({"user_id": uid}, {"$set": {"created_at": now()}})  # and now no room
    waiting = (await client.get(f"{URL}/items")).json()["waiting"]
    assert (await client.post(f"{URL}/items/{waiting[0]['id']}/approve")).json() == {"state": "skipped"}
    assert (await client.post(f"{URL}/items/approve-all")).json() == {"applied": 0}
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 2
