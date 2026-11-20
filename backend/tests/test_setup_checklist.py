# ruff: noqa: E501  (dense test data)
"""Profile setup P2: the dashboard checklist. Each detector reads existing data, the order and the next step, Skip for
now, hidden switches, under-18, multi-role, the complete state and renewals, and the weekly reminder rules."""

from datetime import UTC, datetime, timedelta

from app.core.db import (
    APPLICATIONS,
    EXPERT_PROFILES,
    HIRE_PROFILES,
    JOB_PROFILES,
    MEMBERSHIPS,
    PRACTICE_ATTEMPTS,
    SKILL_ATTEMPTS,
    TRUST_DOCUMENTS,
    TRUST_FACE,
    USERS,
    VETTING_INTERVIEWS,
    VETTING_REVIEWERS,
    VETTING_VERIFIED,
)
from app.core.time import now
from app.setup import checklist as C
from app.setup import registry as R
from tests.conftest import signup

ON = {"on": True, "public": True}
OFF = {"on": False, "public": False}
TESTER = {"on": True, "public": False}


def sw(**kw):
    return {"vetting": ON, "trust": ON, "hire": ON, "payments": ON, **kw}


def ids(c):
    return [s["id"] for s in c["steps"]]


def status(c):
    return {s["id"]: s["status"] for s in c["steps"]}


async def person(client, outbox, roles=("jobseeker",), email="asha@example.com"):
    me = await signup(client, outbox, email=email, name="Asha Rao", pickRoles=True)
    r = await client.post("/api/auth/roles", json={"add": list(roles), "expertTerms": "expert" in roles})
    assert r.status_code == 200, r.text
    C._cache.clear()
    return me


async def everyone(db):
    await db["settings"].update_one(
        {"_id": "site"}, {"$set": {"vetting.public": True, "trust.public": True}}, upsert=True
    )


async def get(client, role=None):
    C._cache.clear()
    r = await client.get("/api/me/checklist" + (f"?role={role}" if role else ""))
    assert r.status_code == 200, r.text
    return r.json()


# ---------- detectors (pure) ----------


def test_detectors():
    assert R.preferences({}) == "todo"
    full = {"salary": {"amount": 30000}, "notice_days": 30, "on": True, "cities": ["Pune"]}
    assert R.preferences({"hire": full}) == "done"
    assert R.preferences({"hire": {**full, "cities": [], "remote": True}}) == "done"
    assert R.preferences({"hire": {**full, "salary": None}}) == "todo"
    assert R.resume_ats({"resume": {"ats": 59}}) == "todo" and R.resume_ats({"resume": {"ats": 60}}) == "done"
    assert R.first_resume({"resume": {"complete": True}}) == "done" and R.first_resume({"resume": None}) == "todo"
    assert R.education({"edu": {"institution": "JNTU", "degree": "B.Tech", "year": True}}) == "done"
    assert R.education({"edu": {"institution": "JNTU", "degree": "", "year": True}}) == "todo"
    assert R.practice({"practice": 1}) == "done" and R.practice({}) == "todo"
    assert R.skill_badge({"badges": ["java"]}) == "done"
    assert R.skill_badge({"skill_waiting": True}) == "waiting" and R.skill_badge({}) == "todo"
    assert R.identity({"face": "verified"}) == "done" and R.identity({"docs_ok": True}) == "done"
    assert R.identity({"face": "review"}) == "waiting" and R.identity({"docs_review": True}) == "waiting"
    assert R.identity({"face": "retry"}) == "todo"
    assert R.interview({"l3": True}) == "done" and R.interview({"interview_waiting": True}) == "waiting"
    assert R.auto_apply({"auto_apply": True}) == "done" and R.auto_apply({}) == "todo"
    assert R.skills({"skills": True}) == "done" and R.college_group({"group": True}) == "done"
    assert R.first_application({"applications": 1}) == "done" and R.first_application({"launch": True}) == "done"
    assert R.first_application({}) == "todo"
    good = {"about": {"headline": "Recruiter", "bio": "x" * 150}, "photo": True}
    assert R.expert_profile({"expert": good}) == "done"
    assert R.expert_profile({"expert": {**good, "photo": False}}) == "todo"
    assert R.expert_services({"expert": {"services": {"plans": ["expert"]}}}) == "done"
    assert R.expert_availability({"expert": {"services": {"perWeek": 5}}}) == "done"
    assert R.expert_availability({"expert": {"services": {"perWeek": 5}}, "reviewer": True}) == "todo"
    assert (
        R.expert_availability({"expert": {"services": {"perWeek": 5}}, "reviewer": True, "reviewer_slots": True})
        == "done"
    )
    assert R.calibration({"calibrated": True}) == "done" and R.payout({"payout_ok": True}) == "done"
    assert R.submitted({"expert_status": "approved"}) == "done"
    assert (
        R.submitted({"expert_status": "review"}) == "waiting"
        and R.submitted({"expert_status": "testReview"}) == "waiting"
    )
    assert R.submitted({"expert_status": "changes"}) == "todo" and R.submitted({}) == "todo"


def test_registry_shape():
    for role, steps in R.STEPS.items():
        assert len({s.id for s in steps}) == len(steps), role
        for s in steps:
            assert s.title and s.reward and s.minutes > 0 and s.link.startswith("/")
    assert R.step_ids("jobseeker") == (
        "preferences",
        "education",
        "resume",
        "papers",
        "skill",
        "identity",
        "interview",
        "autoapply",
    )


# ---------- order, next step, skip, hidden switches, under-18 (pure) ----------


def test_order_and_next_step():
    c = C.build("jobseeker", {}, sw(), {})
    assert ids(c) == ["preferences", "resume", "skill", "identity", "interview", "autoapply"]
    assert c["next"] == "preferences" and status(c)["preferences"] == "next" and status(c)["resume"] == "later"
    assert c["total"] == 5 and c["done"] == 0 and not c["complete"]  # ID + selfie is optional
    f = {"hire": {"salary": {"amount": 1}, "notice_days": 0, "on": True, "remote": True}, "skill_waiting": True}
    c = C.build("jobseeker", f, sw(), {})
    assert status(c)["preferences"] == "done" and status(c)["skill"] == "waiting" and c["next"] == "resume"
    assert c["percent"] == 20
    # fresher: college / course / year and the practice papers, in their place
    c = C.build("jobseeker", {"fresher": True}, sw(), {})
    assert ids(c)[:4] == ["preferences", "education", "resume", "papers"]


def test_skip_moves_on():
    c = C.build("jobseeker", {}, sw(), {"check_skipped": ["preferences"]})
    s = {x["id"]: x for x in c["steps"]}
    assert c["next"] == "resume" and s["preferences"]["skipped"] and s["preferences"]["status"] == "later"
    # optional steps come after required ones; when everything left was skipped, the first skipped comes back
    every = ["preferences", "resume", "skill", "interview", "autoapply"]
    c = C.build("jobseeker", {}, sw(), {"check_skipped": every})
    assert c["next"] == "identity"
    c = C.build("jobseeker", {}, sw(), {"check_skipped": [*every, "identity"]})
    assert c["next"] == "preferences"


def test_hidden_switches_and_testers():
    c = C.build("jobseeker", {}, sw(vetting=OFF, trust=OFF), {})
    assert ids(c) == ["preferences", "resume", "autoapply"]
    c = C.build("jobseeker", {}, sw(hire=OFF), {})
    assert "preferences" not in ids(c)
    c = C.build("jobseeker", {}, sw(vetting=TESTER), {})  # a tester / demo person / admin persona sees it, marked
    s = {x["id"]: x for x in c["steps"]}
    assert s["skill"]["testersOnly"] and not s["resume"]["testersOnly"]
    assert "payout" not in ids(C.build("expert", {}, sw(payments=OFF), {}))
    assert "calibration" not in ids(C.build("expert", {}, sw(), {}))
    assert "calibration" in ids(C.build("expert", {"reviewer": True}, sw(), {}))


def test_under_18_no_id_step():
    assert "identity" not in ids(C.build("jobseeker", {"minor": True}, sw(), {}))
    assert "identity" not in ids(C.build("expert", {"minor": True}, sw(), {}))
    assert "identity" in ids(C.build("jobseeker", {"minor": False}, sw(), {}))


def test_complete_and_renewals():
    t = now()
    hire = {"salary": {"amount": 1}, "notice_days": 0, "on": True, "remote": True, "confirmed_at": t}
    f = {"hire": hire, "resume": {"ats": 80}, "badges": ["java"], "l3": True, "auto_apply": True}
    c = C.build("jobseeker", f, sw(), {}, t)
    assert c["complete"] and c["firstComplete"] and c["renewals"] == [] and c["next"] is None
    # later: a badge expired (the skill step unticks) and Ready to join is a week old — the card stays small,
    # with renewals only
    f2 = {**f, "badges": [], "expired_badges": ["java"], "hire": {**hire, "confirmed_at": t - timedelta(days=8)}}
    c = C.build("jobseeker", f2, sw(), {"check_done_at": t}, t)
    assert c["complete"] and not c["firstComplete"]
    assert [r["id"] for r in c["renewals"]] == ["badge", "still_looking"]


# ---------- the API on real data ----------


async def test_new_job_seeker_and_auto_tick(client, outbox, db):
    me = await person(client, outbox)
    c = await get(client)
    assert c["role"] == "jobseeker" and c["next"] == "preferences"
    assert ids(c) == ["preferences", "resume", "autoapply"]  # vetting and trust are off for normal people
    # saving Ready to join's salary, notice and city ticks the step (nothing else to do)
    await db[HIRE_PROFILES].insert_one({"_id": me["id"], "on": False, "salary": {"amount": 30000, "unit": "month"},
                                        "notice_days": 15, "cities": ["Pune"]})  # fmt: skip
    c = await get(client)
    assert status(c)["preferences"] == "done" and c["next"] == "resume"
    await db[USERS].update_one({"_id": me["id"]}, {"$set": {"auto_apply.on": True}})
    assert status(await get(client))["autoapply"] == "done"


async def test_existing_user_sees_ticks(client, outbox, db):
    me = await person(client, outbox)
    await everyone(db)
    t = now()
    uid = me["id"]
    await db[HIRE_PROFILES].insert_one(
        {"_id": uid, "on": True, "salary": {"amount": 1}, "notice_days": 0, "remote": True}
    )
    await db[VETTING_VERIFIED].insert_one({"user_id": uid, "test": "java", "expires_at": t + timedelta(days=30)})
    await db[USERS].update_one({"_id": uid}, {"$set": {"vetting_l3_until": t + timedelta(days=30)}})
    await db[TRUST_FACE].insert_one({"_id": uid, "status": "verified"})
    c = await get(client)
    st = status(c)
    assert st["preferences"] == st["skill"] == st["interview"] == st["identity"] == "done"
    assert c["next"] == "resume"


async def test_waiting_for_review(client, outbox, db):
    me = await person(client, outbox)
    await everyone(db)
    uid = me["id"]
    await db[SKILL_ATTEMPTS].insert_one({"user_id": uid, "skill": "java", "task": {"status": "review"}})
    await db[VETTING_INTERVIEWS].insert_one({"user_id": uid, "test": "java", "status": "review"})
    await db[TRUST_DOCUMENTS].insert_one({"user_id": uid, "kind": "pan", "review": {"status": "open"}})
    st = status(await get(client))
    assert st["skill"] == st["interview"] == st["identity"] == "waiting"


async def test_fresher_and_student_detectors(client, outbox, db):
    me = await person(client, outbox, roles=("jobseeker", "student"))
    uid = me["id"]
    r = await client.put(
        "/api/me/setup/jobseeker",
        json={"answers": {"experience": "fresher", "college": "JNTU", "course": "B.Tech", "year": 2026}},
    )
    assert r.status_code == 200, r.text
    c = await get(client, "jobseeker")
    assert status(c)["education"] == "done" and "papers" in ids(c)  # the quick start's answers fill the profile
    await db[PRACTICE_ATTEMPTS].insert_one({"user_id": uid, "set": "aptitude", "finished_at": now()})
    assert status(await get(client, "jobseeker"))["papers"] == "done"
    s = await get(client, "student")
    assert s["role"] == "student" and status(s)["practice"] == "done" and s["next"] == "skills"
    await db[JOB_PROFILES].update_one(
        {"_id": uid}, {"$set": {"data.skillGroups": [{"label": "Tech", "value": "SQL, Excel"}]}}
    )
    await db[MEMBERSHIPS].insert_one({"user_id": uid, "org_id": "o1", "left_at": None, "joined_at": now()})
    await db[APPLICATIONS].insert_one({"user_id": uid, "key": "k1", "status": "applied"})
    st = status(await get(client, "student"))
    assert st["skills"] == st["group"] == st["apply"] == "done" and st["resume"] == "next"


async def test_multi_role_shows_active_roles_checklist(client, outbox, db):
    await person(client, outbox, roles=("jobseeker", "student"))
    r = await client.post("/api/auth/roles/switch", json={"role": "student"})
    assert r.status_code == 200, r.text
    c = await get(client)
    assert c["role"] == "student" and c["active"] == "student" and c["roles"] == ["jobseeker", "student"]
    assert (await get(client, "jobseeker"))["role"] == "jobseeker"
    r = await client.get("/api/me/checklist?role=expert")
    assert r.status_code == 404  # not one of my roles


async def test_skip_api(client, outbox, db):
    me = await person(client, outbox)
    r = await client.post("/api/me/checklist/jobseeker/skip", json={"step": "preferences"})
    assert r.status_code == 200 and r.json()["next"] == "resume"
    u = await db[USERS].find_one({"_id": me["id"]})
    assert u["setup"]["jobseeker"]["check_skipped"] == ["preferences"]
    r = await client.post("/api/me/checklist/jobseeker/skip", json={"step": "preferences", "undo": True})
    assert r.json()["next"] == "preferences"
    r = await client.post("/api/me/checklist/jobseeker/skip", json={"step": "nope"})
    assert r.status_code == 400


async def test_expert_waiting_after_submit(client, outbox, db, monkeypatch):
    from app.wapay import settings as pay

    async def off(_db):
        return False

    monkeypatch.setattr(pay, "payments_on", off)
    me = await person(client, outbox, roles=("expert",))
    uid = me["id"]
    c = await get(client)
    assert c["role"] == "expert" and c["next"] == "profile" and "payout" not in ids(c)  # payments aren't live
    await db[EXPERT_PROFILES].update_one(
        {"_id": uid},
        {"$set": {"status": "review", "profile.about": {"headline": "Recruiter", "bio": "b" * 160}, "profile.photo": "data:x",
                  "profile.services": {"plans": ["expert"], "perWeek": 5}}},
        upsert=True,
    )  # fmt: skip
    c = await get(client)
    assert status(c)["submit"] == "waiting" and c["next"] is None and not c["complete"]
    await db[EXPERT_PROFILES].update_one({"_id": uid}, {"$set": {"status": "approved"}})
    c = await get(client)
    assert c["complete"] and status(c)["submit"] == "done"
    assert (await db[USERS].find_one({"_id": uid}))["setup"]["expert"]["check_done_at"]


async def test_reviewer_gets_calibration(client, outbox, db):
    me = await person(client, outbox, roles=("expert",))
    await everyone(db)
    await db[VETTING_REVIEWERS].insert_one(
        {"_id": me["id"], "status": "calibrating", "slots": [{"day": 1, "hour": 10}]}
    )
    c = await get(client)
    assert "calibration" in ids(c) and status(c)["calibration"] != "done"


async def test_under_18_api(client, outbox, db):
    me = await person(client, outbox)
    await everyone(db)
    await db["trust_profiles"].insert_one(
        {"_id": me["id"], "age_checked_at": now(), "adult_from": now() + timedelta(days=400)}
    )
    assert "identity" not in ids(await get(client))


async def test_reminders_setting(client, outbox, db):
    me = await person(client, outbox)
    assert (await client.get("/api/me/checklist/reminders")).json() == {"on": True}
    r = await client.put("/api/me/checklist/reminders", json={"on": False})
    assert r.json() == {"on": False}
    assert (await db[USERS].find_one({"_id": me["id"]}))["setup_reminders_off"] is True
    assert (await get(client))["reminders"] is False


# ---------- weekly reminders ----------

NOON = datetime(2026, 11, 19, 6, 30, tzinfo=UTC)  # 12:00 IST


async def _old(db, uid, days=3):
    await db[USERS].update_one({"_id": uid}, {"$set": {"created_at": NOON - timedelta(days=days)}})


async def test_reminder_rules(client, outbox, db):
    me = await person(client, outbox)
    uid = me["id"]
    outbox.sent.clear()
    # vetting / trust switches off and nobody listed as a tester: nobody is emailed
    assert await C.remind(db, outbox, t=NOON) == 0
    await everyone(db)
    # new accounts wait two days
    assert await C.remind(db, outbox, t=NOON) == 0
    await _old(db, uid)
    await db[USERS].update_one({"_id": uid}, {"$unset": {"setup_checked_at": ""}})
    # quiet hours: none at 11 PM IST
    assert await C.remind(db, outbox, t=datetime(2026, 11, 19, 17, 30, tzinfo=UTC)) == 0
    assert await C.remind(db, outbox, t=NOON) == 1
    m = outbox.sent[-1]
    assert m.to == "asha@example.com" and "Next: Add your job preferences in Ready to join" in m.text and "k=setup" in m.text
    # at most one a week
    await db[USERS].update_one({"_id": uid}, {"$unset": {"setup_checked_at": ""}})
    assert await C.remind(db, outbox, t=NOON + timedelta(days=3)) == 0
    await db[USERS].update_one({"_id": uid}, {"$unset": {"setup_checked_at": ""}})
    assert await C.remind(db, outbox, t=NOON + timedelta(days=8)) == 1


async def test_reminders_off_and_link(client, outbox, db):
    me = await person(client, outbox)
    await everyone(db)
    await _old(db, me["id"])
    r = await client.post("/api/public/setup/stop-reminders", json={"token": C.unsub_token(me["id"])})
    assert r.status_code == 200
    assert await C.remind(db, outbox, t=NOON) == 0
    r = await client.post("/api/public/setup/stop-reminders", json={"token": me["id"] + ".bad-signature-here"})
    assert r.status_code == 404


async def test_no_reminder_when_complete(client, outbox, db):
    me = await person(client, outbox, roles=("expert",))
    await everyone(db)
    await _old(db, me["id"])
    await db[EXPERT_PROFILES].update_one({"_id": me["id"]}, {"$set": {"status": "approved"}}, upsert=True)
    await db[USERS].update_one({"_id": me["id"]}, {"$set": {"setup.expert.check_done_at": now()}})
    assert await C.remind(db, outbox, t=NOON) == 0


async def test_tester_only_while_switch_off(client, outbox, db):
    a = await person(client, outbox, email="asha@example.com")
    await _old(db, a["id"])
    await db["settings"].update_one(
        {"_id": "site"}, {"$set": {"vetting.public": True, "trust.testers": ["asha@example.com"]}}, upsert=True
    )
    assert await C.remind(db, outbox, t=NOON) == 1
