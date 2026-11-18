"""Auto Apply 2.0, phase A2 (internal Nm7 jobs): a company's post is scored against opted-in people without blocking
the post and routed by their approval mode; the company's per-job controls (off / max / lowest vetting level); the
"Sent by Auto Apply" label and what the company receives (score with 3 reasons, cover note, notice, salary, badges only
where vetting shows to it); screening answers from the profile, else Waiting and sent on answer; the company's moves
reach the candidate's tracker with a notice (email only via may_mail) and rejections feed learning; the switch-OFF
isolation; the memory-safe caps; the demo."""

from app.autoapply import instant, learning
from app.core.db import APPLICATIONS, AUTO_ITEMS, COMPANIES, JOBS, RESUMES, USERS
from app.core.time import now
from app.site import save_site
from tests.conftest import signup
from tests.jobs_helpers import add_resume, strong_resume
from tests.test_auto_apply_engine import company_job, no_ai, roomy  # noqa: F401
from tests.test_auto_apply_v2 import EMAIL, RULES, V2, tester
from tests.test_companies_posting import verified
from tests.test_companies_signup import H, no_network  # noqa: F401

FOUNDER = "founder@gmail.com"  # verified()'s company admin
TEST_CO = {"auto_apply_v2": {"testers": [EMAIL, FOUNDER]}}  # a tester on the team: a test company while OFF


async def setup(client, outbox, db, mode="full_auto", test_company=True, **over):
    uid = await tester(client, outbox, db, mode=mode, **over)
    if test_company:
        await save_site(db, TEST_CO)
    session, cid = await verified(client, outbox, db)
    return uid, session, cid


async def apps_of(client, session, cid):
    return (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]


# ---------- instant apply on post, by mode ----------


async def test_post_scores_at_once_full_auto_sends_and_labels(client, outbox, db):
    uid, session, cid = await setup(client, outbox, db, mode="full_auto", noticePeriod="30_days", minSalary=300000)
    hi = await company_job(client, session, cid, "Junior Data Analyst", salary={"min": 400000, "period": "yearly"})
    mid = await company_job(client, session, cid, "Data Analyst Java", skills=["SQL", "Java", "Spring", "Kafka"])
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": hi["id"]})
    assert app and app["origin"] == "auto" and app["v2"] and app["company_id"] == cid  # sent with the post
    x = app["auto_v2"]
    assert x["label"] == "Sent by Auto Apply" and x["score"] >= 70 and x["notice"] == "30 days"
    assert x["salary"] == "₹3 lakh a year or more"
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": hi["id"]})
    assert it["state"] == "applied" and it["instant"] and it["channel_v2"] == "internal"
    sug = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": mid["id"]})
    assert sug["state"] == "suggested" and 55 <= sug["score"] < 70
    assert (await db[JOBS].find_one({"_id": hi["id"]}))["auto_scan"]["state"] == "done"
    # the company's applicant card: label, score with 3 plain reasons, cover note, notice, salary, tailored resume
    row = next(a for a in await apps_of(client, session, cid) if a["jobId"] == hi["id"])
    assert row["origin"] == "auto" and row["auto"]["label"] == "Sent by Auto Apply"
    assert row["auto"]["score"] == x["score"] and len(row["auto"]["reasons"]) == 3
    assert row["auto"]["reasons"][0].startswith("Matches 2 of 2 skills")
    assert all("your" not in r.lower() for r in row["auto"]["reasons"])
    assert 5 <= len(row["auto"]["coverNote"]) <= 6 and row["auto"]["notice"] == "30 days"
    assert row["auto"]["tailored"] and row["auto"]["badges"] == []  # vetting hidden from this company: no badges
    one = (await client.get(f"/api/company/{cid}/applicants/{row['id']}", headers=H(session))).json()
    assert one["auto"]["coverNote"] == row["auto"]["coverNote"] and one["data"]["exp"]
    # the candidate's tracker: channel Nm7, Viewed once the company opened the list
    tr = (await client.get(f"{V2}/tracker")).json()
    r = next(i for i in tr["items"] if i["job"]["id"] == hi["id"])
    assert r["channel"] == "internal" and r["stage"] == "viewed" and r["instant"]


async def test_approve_each_goes_to_morning_list_and_digest_to_weekly(client, outbox, db):
    uid, session, cid = await setup(client, outbox, db, mode="approve")
    j = await company_job(client, session, cid, "Junior Data Analyst")
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["id"]})
    assert it["state"] == "waiting_approval" and it["mode"] == "approve" and it["copy_id"]
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 0  # nothing before Approve
    assert (await client.post(f"{V2}/approve/{it['_id']}")).json()["state"] == "applied"
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["id"]})
    assert app["auto_v2"]["label"] == "Sent by Auto Apply"
    # weekly digest
    await client.put(f"{V2}/rules", json={**RULES, "mode": "digest"})
    j2 = await company_job(client, session, cid, "Data Analyst Trainee")
    it2 = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j2["id"]})
    assert it2["state"] == "waiting_approval" and it2["mode"] == "digest"
    assert (await client.get(f"{V2}/approvals")).json()["mode"] == "digest"


async def test_rules_blocked_companies_limit_pause_and_stop(client, outbox, db):
    uid, session, cid = await setup(client, outbox, db, mode="full_auto", avoid=["acme"], dailyLimit=1)
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"details.legal_name": "Acme Labs"}})
    j = await company_job(client, session, cid, "Junior Data Analyst")
    assert await db[AUTO_ITEMS].count_documents({"user_id": uid}) == 0  # a blocked company
    await client.put(f"{V2}/rules", json={**RULES, "mode": "full_auto", "dailyLimit": 1})
    await db[JOBS].update_one({"_id": j["id"]}, {"$set": {"auto_scan.state": "reset"}})
    await instant.queue(db, await db[JOBS].find_one({"_id": j["id"]}))
    out = await instant.run(db)
    assert out["instant_applied"] == 1
    j2 = await company_job(client, session, cid, "Data Analyst Trainee")
    assert await db[AUTO_ITEMS].count_documents({"user_id": uid, "job_id": j2["id"]}) == 0  # today's limit used
    # paused: nothing; stopped (consent withdrawn): nothing
    await client.post(f"{V2}/pause", json={"paused": True})
    await db[AUTO_ITEMS].update_many({"user_id": uid}, {"$set": {"counted_day": "2000-01-01"}})
    j3 = await company_job(client, session, cid, "Data Analyst Intern")
    assert await db[AUTO_ITEMS].count_documents({"user_id": uid, "job_id": j3["id"]}) == 0
    await client.post(f"{V2}/pause", json={"paused": False})
    await client.post(f"{V2}/stop")
    j4 = await company_job(client, session, cid, "Reporting Data Analyst")
    assert await db[AUTO_ITEMS].count_documents({"user_id": uid, "job_id": j4["id"]}) == 0


# ---------- the company's controls ----------


async def test_company_controls_off_max_and_min_level(client, outbox, db):
    uid, session, cid = await setup(client, outbox, db, mode="approve")
    info = (await client.get(f"/api/company/{cid}/auto-apply", headers=H(session))).json()
    assert info["on"] and info["defaults"] == {"accept": True, "max": 50, "minLevel": 0}
    # off, sent with the post: nobody is applied
    off = await company_job(client, session, cid, "Junior Data Analyst", autoApply={"accept": False})
    assert off["autoApply"]["accept"] is False
    assert (await db[JOBS].find_one({"_id": off["id"]}))["auto_controls"] == {
        "accept": False,
        "max": 50,
        "min_level": 0,
    }
    assert await db[AUTO_ITEMS].count_documents({"user_id": uid, "job_id": off["id"]}) == 0
    # a minimum vetting level the candidate is under
    lvl = await company_job(client, session, cid, "Data Analyst Trainee", autoApply={"accept": True, "minLevel": 2})
    assert await db[AUTO_ITEMS].count_documents({"user_id": uid, "job_id": lvl["id"]}) == 0
    # turning it on again (no edit used) looks at the opted-in people again
    r = await client.put(f"/api/company/{cid}/jobs/{off['id']}/auto-apply", json={"accept": True, "max": 1},
                         headers=H(session))  # fmt: skip
    assert r.status_code == 200 and r.json()["autoApply"] == {"accept": True, "max": 1, "minLevel": 0, "received": 0}
    assert r.json()["editsLeft"] == 2
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": off["id"]})
    assert it["state"] == "waiting_approval"
    # the maximum is reached before the candidate approves (someone else's auto application): never sent
    await db[APPLICATIONS].insert_one(
        {"job_id": off["id"], "user_id": "someone", "origin": "auto", "company_id": cid, "channel": "nm7",
         "status": "applied", "key": "k-other", "created_at": now()}
    )  # fmt: skip
    assert (await client.post(f"{V2}/approve/{it['_id']}")).json()["state"] == "skipped"
    assert (await db[AUTO_ITEMS].find_one({"_id": it["_id"]}))["reason"] == "company_max"
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 0
    jobs = (await client.get(f"/api/company/{cid}/jobs", headers=H(session))).json()
    assert next(x for x in jobs if x["id"] == off["id"])["autoApply"]["received"] == 1
    # a level that fits after the vetting engine raised it
    await db[USERS].update_one({"_id": uid}, {"$set": {"vetting": {"level": 2}}})
    await client.put(f"/api/company/{cid}/jobs/{lvl['id']}/auto-apply", json={"accept": True, "max": 60, "minLevel": 2},
                     headers=H(session))  # fmt: skip
    assert (await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": lvl["id"]}))["state"] == "waiting_approval"
    # bad values
    bad = await client.put(f"/api/company/{cid}/jobs/{lvl['id']}/auto-apply", json={"max": 0}, headers=H(session))
    assert bad.status_code == 400


async def test_controls_hidden_from_companies_without_2_0(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    info = (await client.get(f"/api/company/{cid}/auto-apply", headers=H(session))).json()
    assert info["on"] is False
    j = await company_job(client, session, cid, "Junior Data Analyst", autoApply={"accept": False})
    assert "autoApply" not in j and "auto_controls" not in await db[JOBS].find_one({"_id": j["id"]})
    r = await client.put(f"/api/company/{cid}/jobs/{j['id']}/auto-apply", json={"accept": False}, headers=H(session))
    assert r.status_code == 404
    assert all("autoApply" not in x for x in (await client.get(f"/api/company/{cid}/jobs", headers=H(session))).json())


async def test_badges_and_vetting_reason_only_where_vetting_shows(client, outbox, db):
    uid, session, cid = await setup(client, outbox, db, mode="full_auto")
    await db[USERS].update_one({"_id": uid}, {"$set": {"vetting": {"level": 2, "ready_now": True}}})
    j = await company_job(client, session, cid, "Junior Data Analyst")
    row = next(a for a in await apps_of(client, session, cid) if a["jobId"] == j["id"])
    assert row["auto"]["badges"] == [] and row["level"] is None
    assert not any("Vetting" in r for r in row["auto"]["reasons"])
    await save_site(db, {"vetting": {"public": True}})
    row = next(a for a in await apps_of(client, session, cid) if a["jobId"] == j["id"])
    assert row["auto"]["badges"][:2] == ["L2 · Skill verified", "Ready now"]
    assert len(row["auto"]["reasons"]) == 3


# ---------- screening questions ----------


async def test_screening_from_profile_or_waiting_then_sent_on_answer(client, outbox, db):
    uid, session, cid = await setup(client, outbox, db, mode="approve")
    q = {"text": "How many months of SQL have you used?", "kind": "number"}
    j = await company_job(client, session, cid, "Junior Data Analyst", questions=[q])
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["id"]})
    assert it["state"] == "needs_answer" and it["instant"]
    w = (await client.get(f"{V2}/waiting")).json()
    assert w[0]["questions"][0]["text"] == q["text"]
    r = await client.post(f"{V2}/waiting/{it['_id']}/answer", json={"answers": {"q1": 9}})
    assert r.json()["state"] == "applied"  # sent the moment they answered
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["id"]})
    assert app["answers"] == {"q1": 9} and app["auto_v2"]["label"] == "Sent by Auto Apply"
    # the next job with the same question is answered from the profile: straight to the approval list
    j2 = await company_job(client, session, cid, "Data Analyst Trainee", questions=[q])
    it2 = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j2["id"]})
    assert it2["state"] == "waiting_approval" and it2["answers"] == {"q1": 9}


# ---------- status sync ----------


async def test_status_sync_notice_email_and_learning(client, outbox, db):
    uid, session, cid = await setup(client, outbox, db, mode="full_auto")
    j1 = await company_job(client, session, cid, "Junior Data Analyst")
    j2 = await company_job(client, session, cid, "Data Analyst Trainee")
    j3 = await company_job(client, session, cid, "Data Analyst Intern")
    outbox.sent.clear()
    rows = {a["jobId"]: a for a in await apps_of(client, session, cid)}  # opening the list: Viewed, in-app only
    assert [m for m in outbox.sent if m.to == EMAIL] == []
    tr = (await client.get(f"{V2}/tracker")).json()
    assert {u["status"] for u in tr["updates"]} == {"viewed"} and len(tr["updates"]) == 3

    async def move(jid, status):
        r = await client.post(f"/api/company/{cid}/applicants/{rows[jid]['id']}/status", json={"status": status},
                              headers=H(session))  # fmt: skip
        assert r.status_code == 200

    await move(j1["id"], "shortlisted")
    mail = [m for m in outbox.sent if m.to == EMAIL]
    assert len(mail) == 1 and "shortlisted you" in mail[0].text and "/me/auto-apply/v2" in mail[0].text
    await move(j1["id"], "offer")
    await move(j2["id"], "rejected")
    await move(j3["id"], "rejected")
    tr = (await client.get(f"{V2}/tracker")).json()
    by = {i["job"]["id"]: i for i in tr["items"]}
    assert (by[j1["id"]]["stage"], by[j1["id"]]["outcome"]) == ("closed", "offer")
    assert (by[j2["id"]]["stage"], by[j2["id"]]["outcome"]) == ("closed", "rejected")
    assert "chose other applicants" in by[j2["id"]]["notice"]["text"]
    # two rejections for the same kind of role: learning lowers it
    assert (await learning.penalties(db, uid))["data analyst"] == {"rejections": 2, "penalty": 5}
    assert (await client.get(V2)).json()["learning"][0]["penalty"] == 5
    # read
    assert (await client.post(f"{V2}/tracker/seen")).json()["seen"] == 3
    assert (await client.get(f"{V2}/tracker")).json()["updates"] == []


async def test_job_closed_and_interview_reach_the_tracker(client, outbox, db):
    uid, session, cid = await setup(client, outbox, db, mode="full_auto")
    j = await company_job(client, session, cid, "Junior Data Analyst")
    j2 = await company_job(client, session, cid, "Data Analyst Trainee")
    rows = {a["jobId"]: a for a in await apps_of(client, session, cid)}
    from datetime import timedelta

    from app.core.time import IST

    when = (now() + timedelta(days=2)).astimezone(IST)
    outbox.sent.clear()
    r = await client.post(
        f"/api/company/{cid}/applicants/{rows[j2['id']]['id']}/interview",
        json={"date": when.date().isoformat(), "time": "10:30", "place": "Office"},
        headers=H(session),
    )
    assert r.status_code == 200
    assert len([m for m in outbox.sent if m.to == EMAIL]) == 1  # the invitation only, not a second 2.0 email
    r = await client.post(f"/api/company/{cid}/jobs/{j['id']}/status", json={"status": "closed"}, headers=H(session))
    assert r.status_code == 200
    tr = {i["job"]["id"]: i for i in (await client.get(f"{V2}/tracker")).json()["items"]}
    assert (tr[j["id"]]["stage"], tr[j["id"]]["outcome"]) == ("closed", "closed")
    assert (tr[j2["id"]]["stage"], tr[j2["id"]]["outcome"]) == ("replied", "interview")


# ---------- the switch ----------


async def test_switch_off_no_real_user_applications_to_real_companies_and_no_mail(client, outbox, db, make_client):
    # a tester with 2.0 on, a real company (no tester on its team): nothing reaches it while OFF
    uid, session, cid = await setup(client, outbox, db, mode="full_auto", test_company=False)
    j = await company_job(client, session, cid, "Junior Data Analyst")
    assert await db[AUTO_ITEMS].count_documents({"job_id": j["id"]}) == 0
    assert await db[APPLICATIONS].count_documents({"job_id": j["id"]}) == 0
    # a real (non-tester) person with a stale 2.0 opt-in is never scanned
    other = make_client()
    await signup(other, outbox, email="ravi@example.com", name="Ravi Kumar")
    await add_resume(other, data=strong_resume())
    oid = (await db[USERS].find_one({"email": "ravi@example.com"}))["_id"]
    a = (await db[USERS].find_one({"_id": uid}))["auto_apply"]
    await db[USERS].update_one({"_id": oid}, {"$set": {"auto_apply": a}})
    await save_site(db, TEST_CO)  # now a test company
    outbox.sent.clear()
    j2 = await company_job(client, session, cid, "Data Analyst Trainee")
    assert await db[AUTO_ITEMS].count_documents({"user_id": oid}) == 0
    assert await db[AUTO_ITEMS].count_documents({"user_id": uid, "job_id": j2["id"]}) == 1  # the tester, test co
    # a demo account never reaches a real company, even when public
    await db[USERS].update_one({"_id": oid}, {"$set": {"demo": True}})
    await save_site(db, {"auto_apply_v2": {"public": True, "testers": []}})
    j3 = await company_job(client, session, cid, "Data Analyst Intern")
    assert await db[AUTO_ITEMS].count_documents({"user_id": oid}) == 0
    assert await db[AUTO_ITEMS].count_documents({"user_id": uid, "job_id": j3["id"]}) == 1  # public: real people
    # no 2.0 email to anyone but listed testers while OFF: an admin's move notice is in-app only
    await save_site(db, {"auto_apply_v2": {"public": False, "testers": [FOUNDER]}})
    await db[USERS].update_one({"_id": uid}, {"$set": {"role": "admin"}})
    row = next(x for x in await apps_of(client, session, cid) if x["jobId"] == j2["id"])
    outbox.sent.clear()
    await client.post(f"/api/company/{cid}/applicants/{row['id']}/status", json={"status": "shortlisted"},
                      headers=H(session))  # fmt: skip
    assert [m for m in outbox.sent if m.to == EMAIL] == []
    assert (await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j2["id"]}))["notice"]["status"] == "shortlisted"


async def test_access_pairing_rules():
    v2 = {"public": False, "testers": ["t@x.com"]}
    real_co = {"_id": "c", "members": [{"email_lc": "boss@co.com"}]}
    test_co = {"_id": "c", "members": [{"email_lc": "t@x.com"}]}
    demo_co = {"_id": "d", "demo": True}
    tester_u = {"email_lc": "t@x.com"}
    assert not instant.access.pair_ok(tester_u, real_co, v2)
    assert instant.access.pair_ok(tester_u, test_co, v2)
    assert not instant.access.pair_ok({"email_lc": "real@x.com"}, test_co, v2)
    assert instant.access.pair_ok({"demo": True}, demo_co, v2) and not instant.access.pair_ok(tester_u, demo_co, v2)
    assert not instant.access.pair_ok({"demo": True}, real_co, {**v2, "public": True})
    assert instant.access.pair_ok({"email_lc": "real@x.com"}, real_co, {**v2, "public": True})


# ---------- memory-safe caps ----------


async def test_caps_per_pass_and_resume_where_it_stopped(client, outbox, db):
    await save_site(db, {"auto_apply_v2": {"public": True}})
    session, cid = await verified(client, outbox, db)
    j = await company_job(client, session, cid, "Junior Data Analyst", autoApply={"accept": True, "max": 4})
    t = now()
    for k in range(6):
        uid = f"00000000-0000-0000-0000-00000000000{k}"
        await db[USERS].insert_one(
            {"_id": uid, "email": f"p{k}@example.com", "email_lc": f"p{k}@example.com", "name": f"P {k}",
             "role": "customer", "disabled_at": None, "created_at": t,
             "auto_apply": {"on": True, "consent_at": t, "v2_consent_at": t, "roles": ["Data Analyst"],
                            "cities": ["Hyderabad"], "remote": True, "mode": "full_auto", "daily_limit": 10}}
        )  # fmt: skip
        await db[RESUMES].insert_one(
            {"key": "r1", "user_id": uid, "name": "Main", "data": strong_resume(), "active": True, "versions": [],
             "created_at": t, "updated_at": t}
        )  # fmt: skip
    await db[JOBS].update_one({"_id": j["id"]}, {"$set": {"auto_scan.state": "reset"}})
    assert await instant.queue(db, await db[JOBS].find_one({"_id": j["id"]}))
    out = await instant.run(db, scan_cap=2)
    assert out["instant_applied"] == 2
    scan = (await db[JOBS].find_one({"_id": j["id"]}))["auto_scan"]
    assert scan["state"] == "pending" and scan["after"] == "00000000-0000-0000-0000-000000000001"
    out = await instant.run(db, send_cap=1)  # one prepared per pass at most
    assert (
        out["instant_applied"] == 1 and (await db[JOBS].find_one({"_id": j["id"]}))["auto_scan"]["state"] == "pending"
    )
    await instant.run(db)
    scan = (await db[JOBS].find_one({"_id": j["id"]}))["auto_scan"]
    assert scan["state"] == "done" and scan["scanned"] == 6
    assert await db[APPLICATIONS].count_documents({"job_id": j["id"], "origin": "auto"}) == 4  # the company's max
    # another heavy job running: the pass waits
    from app.automation import release_lease, take_lease

    assert await take_lease(db, "heavy")
    assert (await instant.run(db)) == {"waiting_heavy": True}
    await release_lease(db, "heavy")


# ---------- demo ----------


async def test_demo_company_shows_labelled_auto_applications(client, outbox, db, admin_client):
    admin = await admin_client()
    r = await admin.post("/api/admin/demo-company/open")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["auto"] >= 1
    session = out["session"]
    cid = out["company"]
    items = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
    auto = [a for a in items if a["auto"]]
    assert len(auto) == out["auto"]
    assert all(a["auto"]["label"] == "Sent by Auto Apply" and len(a["auto"]["reasons"]) >= 2 for a in auto)
    assert all(a["auto"]["coverNote"] for a in auto)
    jobs = (await client.get(f"/api/company/{cid}/jobs", headers=H(session))).json()
    live = [x for x in jobs if x["status"] == "active"]
    assert live and all(x["autoApply"]["accept"] for x in live)


async def test_todays_auto_apply_obeys_a_company_that_turned_auto_applications_off(client, outbox, db):
    from tests.test_auto_apply_engine import run as run_v1
    from tests.test_auto_apply_engine import student

    await save_site(db, {"auto_apply_v2": {"testers": [FOUNDER]}})  # this company sees the controls
    session, cid = await verified(client, outbox, db)
    off = await company_job(client, session, cid, "Junior Data Analyst", autoApply={"accept": False})
    plain = await company_job(client, session, cid, "Data Analyst Trainee")
    uid = await student(client, outbox, db)
    await run_v1(db)
    got = {a["job_id"] async for a in db[APPLICATIONS].find({"user_id": uid})}
    assert plain["id"] in got and off["id"] not in got
    assert (await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": off["id"]}))["reason"] == "company_off"
