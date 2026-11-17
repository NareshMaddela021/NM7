"""Auto Apply 2.0 (A1 "Engine"): score parts and thresholds, the candidate's rules, the daily limit, tailoring (one
version per job, never twice; the truth check blocks anything invented; the rules fallback), approval modes (full auto,
approve each with "Approve all", weekly digest), the Waiting section (answers saved to the profile, then sent at
once), learning from rejections, the tracker and "What was sent", the launch switch (OFF: hidden from real users and
no 2.0 email), Admin settings, the demo and schema strictness."""

from datetime import timedelta

import pytest

from app.autoapply import access, demo, engine, learning, rules, score, tailoring, v2engine
from app.core import claude
from app.core.config import get_settings
from app.core.db import APPLICATIONS, AUTO_COPIES, AUTO_ITEMS, JOBS, RESUMES, USERS
from app.core.time import now
from app.site import get_site, save_site
from tests.conftest import signup
from tests.jobs_helpers import add_resume, strong_resume
from tests.test_auto_apply_engine import company_job, no_ai, roomy  # noqa: F401
from tests.test_companies_posting import verified
from tests.test_companies_signup import H, no_network  # noqa: F401

V2 = "/api/me/auto-apply/v2"
EMAIL = "sai@example.com"
RULES = {"roles": ["Data Analyst", "SQL"], "cities": ["Hyderabad"], "remote": True, "dailyLimit": 10}
SITE = {"auto_apply_v2": {"testers": [EMAIL]}}


async def tester(client, outbox, db, mode="approve", testers=True, **over):
    if testers:
        await save_site(db, SITE)
    await signup(client, outbox, email=EMAIL, name="Sai Varsha")
    await add_resume(client, data=strong_resume())
    r = await client.put(f"{V2}/rules", json={**RULES, "mode": mode, **over})
    assert r.status_code == 200, r.text
    r = await client.post(f"{V2}/consent", json={"agree": True})
    assert r.status_code == 200, r.text
    assert r.json()["on"] is True
    return (await db[USERS].find_one({"email": EMAIL}))["_id"]


async def run(db, mailer=None):
    await db[USERS].update_many({}, {"$set": {"auto_apply.run_day": None}})
    return await engine.run(db, mailer, force=True)


# three jobs: 93 (auto), 63 (suggested), 53 (skipped) for the strong resume, a fresher in Hyderabad, L0, today
async def three_jobs(client, session, cid):
    hi = await company_job(client, session, cid, "Junior Data Analyst")
    mid = await company_job(client, session, cid, "Data Analyst Java", skills=["SQL", "Java", "Spring", "Kafka"])
    low = await company_job(client, session, cid, "Data Analyst Kafka", skills=["Kafka", "Spring", "Scala"])
    return hi, mid, low


# ---------- pure parts ----------


def test_score_parts_and_thresholds():
    t = now()
    job = {
        "title": "Junior Data Analyst",
        "remote": False,
        "locations": ["Hyderabad"],
        "experience": "fresher",
        "salary": {"min": 30000, "max": 40000, "period": "monthly"},
        "posted_at": t - timedelta(days=1),
    }
    f = {"found": ["SQL", "Power BI"], "missing": ["Tableau", "Excel"], "level": "fresher", "years": 0.5}
    a = {"cities": ["Hyderabad"], "min_salary": 400000}
    p = score.parts(job, f, a, vetting_level=2, t=t)
    pts = {k: v["points"] for k, v in p["parts"].items()}
    assert pts == {"skills": 20, "experience": 20, "city": 10, "salary": 10, "vetting": 8, "freshness": 10}
    assert p["score"] == 78 and p["penalty"] == 0
    assert sum(v["max"] for v in p["parts"].values()) == 100
    # salary under the minimum, not stated; freshness drops; learning penalty
    assert score.parts(job, f, {**a, "min_salary": 900000}, t=t)["parts"]["salary"]["points"] == 0
    assert score.parts({**job, "salary": None}, f, a, t=t)["parts"]["salary"]["points"] == 6
    assert score.parts({**job, "posted_at": t - timedelta(days=20)}, f, a, t=t)["parts"]["freshness"]["points"] == 3
    pen = {"data analyst": {"rejections": 3, "penalty": 10}}
    assert score.parts(job, f, a, vetting_level=2, penalties=pen, t=t)["score"] == 68
    site = {"auto_apply_v2": {"auto_min": 70, "suggest_min": 55}}
    assert [score.band(s, site) for s in (70, 69, 55, 54)] == ["auto", "suggest", "suggest", "skip"]
    assert score.band(72, site, {"min_score": 75}) == "suggest"  # the candidate may only be stricter
    # fair matching: nothing about the person beyond the resume's skills / years / city and their own rules
    assert {"gender", "religion", "caste", "age", "photo"} <= set(score.NOT_USED)


def test_rules_filter():
    j = {
        "title": "Junior Data Analyst",
        "skills": ["SQL"],
        "locations": ["Hyderabad"],
        "remote": False,
        "experience": "fresher",
        "job_type": "full_time",
        "salary": {"min": 300000, "period": "yearly"},
        "company": {"name": "Acme Labs"},
    }
    a = {"roles": ["data analyst"], "cities": ["Hyderabad"], "remote": True}
    assert rules.check(j, a) is None
    assert rules.check(j, {**a, "roles": ["Java"]}) == "role"
    assert rules.check(j, {**a, "cities": ["Pune"]}) == "place"
    assert rules.check({**j, "remote": True, "locations": []}, {**a, "cities": ["Pune"]}) is None
    assert rules.check({**j, "remote": True, "locations": []}, {**a, "cities": ["Pune"], "remote": False}) == "place"
    assert rules.check(j, {**a, "experience": ["3_5"]}) == "experience"
    assert rules.check(j, {**a, "job_types": ["internship"]}) == "job_type"
    assert rules.check(j, {**a, "min_salary": 500000}) == "salary"
    assert rules.check(j, {**a, "avoid": ["acme"]}) == "blocked_company"
    assert rules.limit_of({}, {"auto_apply_v2": {"daily_limit": 10, "max_daily_limit": 25}}) == 10
    assert rules.limit_of({"daily_limit": 40}, {"auto_apply_v2": {"daily_limit": 10, "max_daily_limit": 25}}) == 25
    assert rules.mode_of({}) == "approve"


def test_learning_penalty_steps():
    assert [learning.penalty_for(n) for n in range(6)] == [0, 0, 5, 10, 15, 15]
    assert learning.role_type("Junior Data Analyst (Remote)") == learning.role_type("Data Analyst Trainee")


def test_schema_is_strict_and_prompt_is_fair():
    assert claude.schema_problems(tailoring.SCHEMA) == []
    data = {
        **strong_resume(),
        "personal": {"name": "Sai Varsha", "email": EMAIL, "gender": "female", "photo": "x"},
        "gender": "female",
        "dob": "2001-01-01",
        "religion": "x",
    }
    from app.autoapply.engine import parsed_for

    job = {
        "_id": "j",
        "title": "Data Analyst",
        "description": "SQL work",
        "company": {"name": "Acme"},
        "locations": ["Hyderabad"],
        "skills": ["SQL"],
    }
    text = tailoring.prompt(parsed_for(job), data, {"notice_period": "30_days"})
    for bad in ("Sai Varsha", EMAIL, "female", "2001", "religion", "gender"):
        assert bad not in text
    assert "notice period is 30 days" in text


async def test_mail_filter_and_access(db):
    v2 = (await get_site(db))["auto_apply_v2"]
    assert access.allowed({"role": "admin"}, v2) and access.allowed({"demo": True}, v2)
    assert not access.allowed({"email": EMAIL}, v2)
    assert await access.mail_filter(db) is None  # OFF, no testers: nobody gets a 2.0 email
    await save_site(db, SITE)
    v2 = (await get_site(db))["auto_apply_v2"]
    assert access.allowed({"email": EMAIL}, v2) and access.may_mail({"email": EMAIL}, v2)
    assert not access.may_mail({"role": "admin", "email": "boss@nm7.si"}, v2)
    assert not access.may_mail({"demo": True, "email": EMAIL}, v2)
    assert (await access.mail_filter(db))["email_lc"] == {"$in": [EMAIL]}
    await save_site(db, {"auto_apply_v2": {"public": True}})
    assert await access.mail_filter(db) == {} and await access.is_public(db)


# ---------- the switch ----------


async def test_switch_off_hides_everything_from_real_users(client, outbox, db):
    await signup(client, outbox, email=EMAIL)
    await add_resume(client, data=strong_resume())
    for path in ("", "/rules", "/tracker", "/suggested", "/waiting", "/approvals"):
        assert (await client.get(f"{V2}{path}")).status_code == 404, path
    assert (await client.put(f"{V2}/rules", json=RULES)).status_code == 404
    assert (await client.post(f"{V2}/consent", json={"agree": True})).status_code == 404
    # a stale 2.0 opt-in on a real user does nothing while hidden: today's engine runs for them, no 2.0 items, no email
    uid = (await db[USERS].find_one({"email": EMAIL}))["_id"]
    await client.put("/api/me/auto-apply", json={**RULES, "consent": True, "minScore": 60, "dailyLimit": 5})
    await db[USERS].update_one(
        {"_id": uid}, {"$set": {"auto_apply.v2_consent_at": now(), "auto_apply.started_at": now() - timedelta(days=5)}}
    )
    session, cid = await verified(client, outbox, db)
    await company_job(client, session, cid, "Junior Data Analyst")
    outbox.sent.clear()
    await run(db, outbox)
    assert await db[AUTO_ITEMS].count_documents({"user_id": uid, "v2": True}) == 0
    assert await db[APPLICATIONS].count_documents({"user_id": uid, "origin": "auto"}) == 1  # v1, as before
    # public: they get it
    await save_site(db, {"auto_apply_v2": {"public": True}})
    assert (await client.get(V2)).status_code == 200


async def test_admin_v2_gets_no_mail_while_hidden(client, outbox, db):
    """An admin may use 2.0 while hidden, but only testers get 2.0 emails."""
    uid = await tester(client, outbox, db, mode="full_auto", testers=True)
    await save_site(db, {"auto_apply_v2": {"testers": []}})
    await db[USERS].update_one({"_id": uid}, {"$set": {"role": "admin"}})
    session, cid = await verified(client, outbox, db)
    await company_job(client, session, cid, "Junior Data Analyst")
    outbox.sent.clear()
    await run(db, outbox)
    assert await db[APPLICATIONS].count_documents({"user_id": uid, "v2": True}) == 1
    assert [m for m in outbox.sent if m.to == EMAIL] == []


# ---------- the engine ----------


async def test_thresholds_approve_each_and_approve_all(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    hi, mid, low = await three_jobs(client, session, cid)
    hi2 = await company_job(client, session, cid, "Data Analyst Trainee")
    uid = await tester(client, outbox, db)  # approve each: the DEFAULT
    out = await run(db)
    assert out["v2_waiting_approval"] == 2 and out["v2_suggested"] == 1 and out["v2_skip_score"] == 1
    items = {i["job_id"]: i async for i in db[AUTO_ITEMS].find({"user_id": uid})}
    assert items[hi["id"]]["state"] == "waiting_approval" and items[hi["id"]]["score"] >= 70
    assert items[hi["id"]]["parts"]["skills"]["points"] == 40
    assert items[mid["id"]]["state"] == "suggested" and 55 <= items[mid["id"]]["score"] < 70
    assert low["id"] not in items
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 0  # nothing sent before Approve
    lst = (await client.get(f"{V2}/approvals")).json()
    assert lst["mode"] == "approve" and len(lst["items"]) == 2
    assert lst["items"][0]["version"]["coverNote"] and 5 <= len(lst["items"][0]["version"]["coverNote"]) <= 6
    r = await client.post(f"{V2}/approve/{items[hi['id']]['_id']}")
    assert r.json()["state"] == "applied"
    r = await client.post(f"{V2}/approve-all")
    assert r.json()["applied"] == 1
    apps = await db[APPLICATIONS].find({"user_id": uid}).to_list(None)
    assert {a["job_id"] for a in apps} == {hi["id"], hi2["id"]} and all(a["v2"] for a in apps)
    # Suggested for you: apply → sent now (no questions)
    sug = (await client.get(f"{V2}/suggested")).json()
    assert [s["job"]["id"] for s in sug] == [mid["id"]] and sug[0]["reasons"]
    assert (await client.post(f"{V2}/suggested/{sug[0]['id']}/apply")).json()["state"] == "applied"
    # a re-run never applies twice
    await run(db)
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 3


async def test_full_auto_daily_limit_and_rules(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    a = await company_job(client, session, cid, "Junior Data Analyst")
    b = await company_job(client, session, cid, "Data Analyst Trainee")
    blocked = await company_job(client, session, cid, "Data Analyst Blocked")
    await db[JOBS].update_one({"_id": blocked["id"]}, {"$set": {"company.name": "Blocked Traders"}})
    far = await company_job(client, session, cid, "Data Analyst Chennai", locations=["Chennai"])
    uid = await tester(client, outbox, db, mode="full_auto", dailyLimit=1, avoid=["blocked"])
    assert (await client.put(f"{V2}/rules", json={**RULES, "dailyLimit": 26})).status_code == 422
    out = await run(db)
    assert out["v2_applied"] == 1
    apps = [x["job_id"] for x in await db[APPLICATIONS].find({"user_id": uid}).to_list(None)]
    assert len(apps) == 1 and apps[0] in (a["id"], b["id"])
    assert blocked["id"] not in apps and far["id"] not in apps
    st = (await client.get(V2)).json()
    assert st["today"] == {"used": 1, "limit": 1} and st["rules"]["mode"] == "full_auto"
    # the next day the other one goes
    await db[AUTO_ITEMS].update_many({"user_id": uid}, {"$set": {"counted_day": "2000-01-01"}})
    await run(db)
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 2


async def test_weekly_digest_mode(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    await company_job(client, session, cid, "Junior Data Analyst")
    uid = await tester(client, outbox, db, mode="digest")
    await run(db)
    it = await db[AUTO_ITEMS].find_one({"user_id": uid})
    assert it["state"] == "waiting_approval" and it["mode"] == "digest"
    assert (await client.get(f"{V2}/approvals")).json()["mode"] == "digest"


async def test_waiting_answer_saved_to_profile_and_sent_at_once(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    q = {"text": "How many months of SQL have you used?", "kind": "number"}
    asks = await company_job(client, session, cid, "Junior Data Analyst", questions=[q])
    uid = await tester(client, outbox, db)  # approve each, but an answered question goes at once
    await run(db)
    w = (await client.get(f"{V2}/waiting")).json()
    assert len(w) == 1 and w[0]["questions"][0]["text"] == q["text"] and w[0]["stage"] == "waiting"
    r = await client.post(f"{V2}/waiting/{w[0]['id']}/answer", json={"answers": {"q1": 8}})
    assert r.json() == {"state": "applied", "saved": 1}
    u = await db[USERS].find_one({"_id": uid})
    assert u["auto_apply"]["answers"][engine.norm(q["text"])] == 8
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": asks["id"]})
    assert app["answers"] == {"q1": 8}
    # never asked again: the next job with the same question doesn't wait
    await company_job(client, session, cid, "Data Analyst Trainee", questions=[q])
    await run(db)
    assert (await client.get(f"{V2}/waiting")).json() == []
    assert await db[AUTO_ITEMS].count_documents({"user_id": uid, "state": "waiting_approval"}) == 1


async def test_tracker_what_was_sent_rejections_learning_and_stop(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    j1 = await company_job(client, session, cid, "Junior Data Analyst")
    j2 = await company_job(client, session, cid, "Data Analyst Trainee", applyMethod="email", applyEmail="hr@acme.com")
    uid = await tester(client, outbox, db, mode="full_auto", noticePeriod="30_days")
    await run(db, outbox)
    tr = (await client.get(f"{V2}/tracker")).json()
    assert [s["key"] for s in tr["stages"]] == ["ready", "waiting", "applied", "viewed", "replied", "closed"]
    rows = {x["job"]["id"]: x for x in tr["items"]}
    assert rows[j1["id"]]["stage"] == "applied" and rows[j1["id"]]["channel"] == "internal"
    assert rows[j2["id"]]["channel"] == "email"
    sent = (await client.get(f"{V2}/sent/{rows[j1['id']]['id']}")).json()
    assert sent["wentOut"] and sent["version"]["source"] == "rules" and sent["version"]["resume"]["exp"]
    assert any("notice period is 30 days" in x for x in sent["version"]["coverNote"])
    assert {a["question"] for a in sent["version"]["answers"]} >= {"What is your notice period?"}
    # a company on Nm7 updates its own; the candidate marks an email reply
    assert (
        await client.post(f"{V2}/tracker/{rows[j1['id']]['id']}/status", json={"status": "rejected"})
    ).status_code == 409
    r = await client.post(f"{V2}/tracker/{rows[j2['id']]['id']}/status", json={"status": "rejected"})
    assert r.json() == {"stage": "closed"}
    await db[APPLICATIONS].update_one(
        {"user_id": uid, "job_id": j1["id"]}, {"$set": {"status": "rejected", "updated_at": now()}}
    )
    pen = await learning.penalties(db, uid)
    assert pen["data analyst"] == {"rejections": 2, "penalty": 5}
    st = (await client.get(V2)).json()
    assert st["learning"][0]["penalty"] == 5
    # pause and stop
    assert (await client.post(f"{V2}/pause", json={"paused": True})).json()["on"] is False
    await db[AUTO_ITEMS].insert_one({"_id": "x1", "user_id": uid, "job_id": "jx", "state": "suggested"})
    st = (await client.post(f"{V2}/stop")).json()
    assert st["on"] is False and st["consent"]["at"] is None
    assert (await db[AUTO_ITEMS].find_one({"_id": "x1"}))["state"] == "withdrawn"


# ---------- tailoring ----------


def fake_ai(answer, calls):
    async def call(p, data, a, stats=None):
        calls.append(p.title)
        return answer(data)

    return call


def good_answer(data):
    return {
        "summary": "Data Analyst Intern at Northwind Retail, skilled in SQL and Power BI.",
        "bullets": [{"id": "e0-0", "text": "Built 6 Power BI dashboards used by 12 store managers"}],
        "skills_order": ["SQL", "Python", "Statistics", "Pandas", "Data Cleaning"],
        "cover_note": [
            "I am applying for the Junior Data Analyst role.",
            "I use SQL and Power BI in my work.",
            "At Northwind Retail I built 6 Power BI dashboards.",
            "I cleaned weekly CSV files in Python.",
            "Thank you for reading my application.",
        ],
        "answers": [{"key": "why_role", "answer": "The role uses SQL and Power BI, which I use every week."}],
    }


async def _setup_tailor(client, outbox, db, monkeypatch, answer):
    session, cid = await verified(client, outbox, db)
    j = await company_job(client, session, cid, "Junior Data Analyst")
    await signup(client, outbox, email=EMAIL)
    await add_resume(client, data=strong_resume())
    uid = (await db[USERS].find_one({"email": EMAIL}))["_id"]
    r = await db[RESUMES].find_one({"user_id": uid})
    job = await db[JOBS].find_one({"_id": j["id"]})
    calls: list = []
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    monkeypatch.setattr(tailoring, "call_model", fake_ai(answer, calls))
    return uid, r, job, calls


async def test_tailoring_ai_version_cached_never_twice(client, outbox, db, monkeypatch):
    uid, r, job, calls = await _setup_tailor(client, outbox, db, monkeypatch, good_answer)
    v = await tailoring.build(db, uid, r, job, {"cities": ["Hyderabad"]})
    assert v["source"] == "ai" and v["truth"] == {"ok": True, "blocked": False, "problems": []}
    assert v["data"]["skillGroups"][0]["value"].startswith("SQL")
    assert v["data"]["exp"][0]["description"].startswith("Built 6 Power BI dashboards used by 12")
    assert len(v["cover_note"]) == 5 and v["answers"][0]["key"] == "why_role"
    again = await tailoring.build(db, uid, r, job, {})
    assert again["_id"] == v["_id"] and calls == ["Junior Data Analyst"]  # never tailored twice
    assert await db[AUTO_COPIES].count_documents({"user_id": uid, "job_id": job["_id"]}) == 1
    # a new resume version is a new key
    await db[RESUMES].update_one({"_id": r["_id"]}, {"$set": {"updated_at": now() + timedelta(seconds=5)}})
    r2 = await db[RESUMES].find_one({"_id": r["_id"]})
    assert (await tailoring.build(db, uid, r2, job, {}))["_id"] != v["_id"] and len(calls) == 2


@pytest.mark.parametrize(
    "bad",
    [
        {"skills_order": ["Kubernetes", "SQL"]},  # a skill not on the resume
        {"summary": "MBA graduate and Data Analyst Intern at Northwind Retail."},  # a degree
        {"cover_note": ["I led 40 analysts at Google.", "a", "b", "c", "d"]},  # a number and a company
        {"answers": [{"key": "experience", "answer": "I was a Senior Data Analyst for 5 years."}]},  # title, number
        {"bullets": [{"id": "e0-0", "text": "Built 9 Tableau dashboards for 50 managers"}]},  # new numbers
    ],
)
async def test_truth_check_blocks_invented_content(client, outbox, db, monkeypatch, bad):
    uid, r, job, _ = await _setup_tailor(client, outbox, db, monkeypatch, lambda d: {**good_answer(d), **bad})
    v = await tailoring.build(db, uid, r, job, {})
    assert v["source"] == "rules" and v["truth"]["blocked"] is True and v["truth"]["problems"]
    orig = r["data"]
    assert v["data"]["exp"] == orig["exp"] and v["data"]["summary"] == orig["summary"]  # untailored lines
    text = " ".join([*v["cover_note"], *(a["answer"] for a in v["answers"])])
    for word in ("Kubernetes", "MBA", "Google", "Senior", "Tableau dashboards for 50"):
        assert word not in text
    assert tailoring.truth.doc_problems(v["data"], orig) == []


async def test_fallback_without_ai_or_quota(client, outbox, db, monkeypatch):
    uid, r, job, calls = await _setup_tailor(client, outbox, db, monkeypatch, good_answer)
    from app.core import ai_quota

    monkeypatch.setitem(ai_quota.PER_PERSON, "autoapply_tailor", 0)  # today's allowance used up
    v = await tailoring.build(db, uid, r, job, {})
    assert v["source"] == "rules" and calls == [] and v["stats"]["ai"] == "limited"
    assert 5 <= len(v["cover_note"]) <= 6 and v["cover_note"][0].startswith("I am applying for the Junior Data Analyst")

    async def broken(*a, **k):
        raise claude.Unusable("invalid")

    await db[AUTO_COPIES].delete_many({})
    monkeypatch.setitem(ai_quota.PER_PERSON, "autoapply_tailor", 25)
    monkeypatch.setattr(tailoring, "call_model", broken)
    v = await tailoring.build(db, uid, r, job, {})
    assert v["source"] == "rules" and v["stats"]["ai"] == "failed"
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    await db[AUTO_COPIES].delete_many({})
    assert (await tailoring.build(db, uid, r, job, {}))["stats"]["ai"] == "no_key"


# ---------- Admin and demo ----------


async def test_admin_settings_and_stats(client, outbox, db, admin_client):
    assert (await (await admin_client("support")).get("/api/admin/auto-apply/v2")).status_code == 403
    owner = await admin_client("owner")
    o = (await owner.get("/api/admin/auto-apply/v2")).json()
    assert o["settings"]["public"] is False and o["settings"]["autoMin"] == 70 and o["settings"]["suggestMin"] == 55
    assert o["settings"]["dailyLimit"] == 10 and o["settings"]["maxDailyLimit"] == 25
    body = {**o["settings"], "testers": ["Sai@Example.com", "bad"], "autoMin": 75, "suggestMin": 60, "freePerWeek": 5}
    r = await owner.put("/api/admin/auto-apply/v2/settings", json=body)
    assert r.status_code == 200 and r.json()["testers"] == [EMAIL] and r.json()["autoMin"] == 75
    assert (await owner.put("/api/admin/auto-apply/v2/settings", json={**body, "suggestMin": 80})).status_code == 400
    assert (await get_site(db))["auto_apply_v2"]["free_per_week"] == 5
    # the tester now sees 2.0
    await signup(client, outbox, email=EMAIL)
    assert (await client.get(V2)).json()["thresholds"] == {"auto": 75, "suggest": 60}
    assert (await owner.get("/api/admin/auto-apply/v2")).json()["stats"]["optedIn"] == 0


async def test_demo_kavya_shows_every_state(db):
    await demo.create(db)
    tr = await v2engine.tracker(db, demo.STUDENT_ID)
    stages = {s["key"]: s["count"] for s in tr["stages"]}
    assert all(stages[k] >= 1 for k in stages), stages
    assert {x["channel"] for x in tr["items"]} >= {"internal", "email", "one_tap"}
    assert await db[AUTO_ITEMS].count_documents({"user_id": demo.STUDENT_ID, "state": "suggested"}) >= 2
    w = await db[AUTO_ITEMS].count_documents({"user_id": demo.STUDENT_ID, "state": "needs_answer"})
    assert w >= 1
    u = await db[USERS].find_one({"_id": demo.STUDENT_ID})
    assert u["auto_apply"]["v2_consent_at"] and u["auto_apply"]["mode"] == "approve"
    assert await db[AUTO_COPIES].count_documents({"user_id": demo.STUDENT_ID, "v2": True}) >= 1


def test_truth_allows_only_the_jobs_own_numbers():
    job = "Data Analyst L2 Acme 2026 Hyderabad"
    assert tailoring.truth.problems("I am applying for the Data Analyst L2 role at Acme 2026.", "SQL", job) == []
    assert "the number 40" in tailoring.truth.problems("I built 40 dashboards.", "SQL", job)


async def test_v2_waits_while_another_heavy_job_runs(client, outbox, db, monkeypatch):
    from app.core import heavy

    session, cid = await verified(client, outbox, db)
    await company_job(client, session, cid, "Junior Data Analyst")
    uid = await tester(client, outbox, db, mode="full_auto")

    async def busy(_db):
        return False

    monkeypatch.setattr(heavy, "_take", busy)
    out = await run(db)
    assert out.get("v2_waiting_heavy") == 1 and await db[APPLICATIONS].count_documents({"user_id": uid}) == 0
    assert not (await db[USERS].find_one({"_id": uid}))["auto_apply"].get("run_day")  # picked up on the next pass
