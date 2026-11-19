# ruff: noqa: E501  (dense test data)
"""Profile setup P3: the company and college checklists. Auto-ticks from existing data, the next step, Skip for now,
hidden steps (Auto Apply 2.0 switch, plan features, individual recruiters), who can see and act (only the company's
own team / the college's own staff), and the weekly reminder rules."""

from datetime import UTC, datetime, timedelta

import pytest

from app.core.db import (
    AUDIT_LOG,
    COMPANIES,
    DRIVES,
    HIRE_SLOTS,
    JOBS,
    ORGANIZATIONS,
    RECRUITER_INVITES,
    TRUST_EMPLOYER,
    USERS,
)
from app.core.time import now
from app.setup import checklist as C
from app.setup import registry as R
from app.setup import teams as T
from tests.test_companies_queue import basic_company, code_sign_in
from tests.test_companies_signup import H, no_network, sign_up  # noqa: F401
from tests.test_orgs import member, setup_group
from tests.test_orgs_phase2 import coordinator, second_org

NOON = datetime(2026, 11, 19, 6, 30, tzinfo=UTC)  # 12:00 IST
ON = {"on": True, "public": True}
OFF = {"on": False, "public": False}


def status(c):
    return {s["id"]: s["status"] for s in c["steps"]}


@pytest.fixture(autouse=True)
def fresh_cache():
    T._cache.clear()
    yield
    T._cache.clear()


async def checklist(client, cid, session):
    T._cache.clear()
    r = await client.get(f"/api/company/{cid}/checklist", headers=H(session))
    assert r.status_code == 200, r.text
    return r.json()


# ---------- the engine, pure ----------


def test_registry_shape():
    assert R.ROLES == ("jobseeker", "student", "expert") and R.TEAMS == ("company", "college")
    assert R.step_ids("company") == ("basics", "business", "job", "slots", "screening", "team", "connect")
    assert R.step_ids("college") == ("basics", "groups", "students", "drive", "companies", "reports")
    for kind in R.TEAMS:
        for s in R.STEPS[kind]:
            assert s.who and s.title and s.reward and s.minutes > 0 and not any(ch.isdigit() for ch in s.reward)


def test_company_detectors_and_hidden_steps():
    f = {"emails_ok": True, "about": True, "registered": True, "verified": False, "in_review": True, "team": 1,
         "jobs_live": False, "jobs_review": True, "questions": False, "slots": False, "ats": False}  # fmt: skip
    c = C.build("company", f, {"autoapply2": OFF}, {})
    assert status(c) == {
        "basics": "done",
        "business": "waiting",
        "job": "waiting",
        "slots": "next",
        "screening": "later",
        "team": "later",
    }
    assert c["total"] == 6 and c["done"] == 1
    # an individual recruiter has no GST / Udyam / CIN: no business check; a tester company sees "connect" (optional)
    c = C.build("company", {**f, "registered": False}, {"autoapply2": {"on": True, "public": False}}, {})
    assert "business" not in status(c)
    assert next(s for s in c["steps"] if s["id"] == "connect")["testersOnly"] is True
    assert c["total"] == 5  # optional steps don't count
    # Skip for now moves on; skipped steps come back when nothing else is left
    c = C.build("company", f, {"autoapply2": OFF}, {"check_skipped": ["slots"]})
    assert c["next"] == "screening"
    done = {**f, "verified": True, "jobs_live": True, "questions": True, "team": 2}
    assert C.build("company", done, {"autoapply2": OFF}, {"check_skipped": ["slots"]})["next"] == "slots"
    assert C.build("company", {**done, "slots": True}, {"autoapply2": OFF}, {})["complete"] is True


def test_college_detectors_links_and_plan_features():
    f = {"id": "o1", "named": True, "city": False, "billing": False, "features": {"drives": False, "recruiter_links": False},
         "groups": 1, "members": 0, "drives": 0, "recruiters": 0, "reports": False}  # fmt: skip
    c = C.build("college", f, {}, {})
    assert status(c) == {
        "basics": "next",
        "groups": "done",
        "students": "later",
        "reports": "later",
    }  # paid steps hidden
    links = {s["id"]: s["link"] for s in c["steps"]}
    assert (
        links["basics"] == "/org/o1/billing"
        and links["groups"] == "/org/o1#og-new"
        and links["reports"] == "/org/o1/dashboard"
    )
    c = C.build("college", {**f, "city": True, "features": {"drives": True, "recruiter_links": True}}, {}, {})
    assert list(status(c)) == ["basics", "groups", "students", "drive", "companies", "reports"]
    assert c["next"] == "students" and c["total"] == 6


# ---------- company ----------


async def test_new_company_sees_the_right_next_step(client, outbox, db):
    session, c = await sign_up(client, outbox)  # the admin's email only: sign-up isn't finished
    cid = c["id"]
    out = await checklist(client, cid, session)
    assert out["title"] == "Set up your company" and out["canSkip"] is True
    assert out["next"] == "basics"
    basics = out["steps"][0]
    assert basics["link"] == "/company#overview" and basics["canAct"] is True  # "Continue sign-up" is there
    assert "connect" not in status(out)  # Auto Apply 2.0 off for this company
    assert all(s["status"] != "done" for s in out["steps"] if s["id"] != "basics")


async def test_existing_company_with_data_sees_ticks(client, outbox, db):
    session, cid = await basic_company(client, outbox)  # both emails proven, sent to Nm7's team
    await db[COMPANIES].update_one(
        {"_id": cid},
        {
            "$set": {
                "details.about": "We build dashboards.",
                "members.1": {"email_lc": "ops@acme.com", "role": "view", "status": "invited"},
            }
        },
    )
    await db[JOBS].insert_one(
        {
            "_id": "j1",
            "company_id": cid,
            "status": "active",
            "title": "Analyst",
            "questions": [{"id": "q1", "text": "Can you work from Pune?", "kind": "yesno"}],
        }
    )
    await db[HIRE_SLOTS].insert_one({"company_id": cid, "job_id": "j1", "status": "open", "starts_at": now()})
    out = await checklist(client, cid, session)
    assert status(out) == {
        "basics": "done",
        "business": "waiting",
        "job": "done",
        "slots": "done",
        "screening": "done",
        "team": "done",
    }
    assert out["next"] is None and out["complete"] is False  # only the check by Nm7's team is left (waiting)
    # Nm7's team approves it: complete, and it stays small from then on
    await db[COMPANIES].update_one(
        {"_id": cid}, {"$set": {"review.state": "approved", "verified_until": now() + timedelta(days=300)}}
    )
    out = await checklist(client, cid, session)
    assert out["complete"] is True and out["done"] == out["total"] == 6
    assert (await db[COMPANIES].find_one({"_id": cid}))["setup"]["check_done_at"]


async def test_trust_registry_check_counts(client, outbox, db):
    session, cid = await basic_company(client, outbox)
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": True}}, upsert=True)
    await db[TRUST_EMPLOYER].insert_one({"_id": cid, "status": "verified"})
    assert status(await checklist(client, cid, session))["business"] == "done"


async def test_skip_permissions_and_other_companies(client, outbox, db, make_client):
    session, cid = await basic_company(client, outbox)
    r = await client.post(f"/api/company/{cid}/checklist/skip", json={"step": "job"}, headers=H(session))
    assert r.status_code == 200 and r.json()["next"] == "slots"
    assert next(s for s in r.json()["steps"] if s["id"] == "job")["skipped"] is True
    r = await client.post(f"/api/company/{cid}/checklist/skip", json={"step": "job", "undo": True}, headers=H(session))
    assert r.json()["next"] == "job"
    assert (
        await client.post(f"/api/company/{cid}/checklist/skip", json={"step": "nope"}, headers=H(session))
    ).status_code == 400
    # a view-only team admin sees it, can't skip, and each step says who can do it
    await client.post(f"/api/company/{cid}/team", json={"email": "viewer@acme.com", "role": "view"}, headers=H(session))
    other = make_client()
    vs = (await code_sign_in(other, outbox, "viewer@acme.com")).json()["session"]
    await other.get("/api/company/mine", headers=H(vs))  # the first sign-in accepts the invite
    out = await checklist(other, cid, vs)
    assert out["canSkip"] is False and all(s["canAct"] is False for s in out["steps"])
    assert next(s for s in out["steps"] if s["id"] == "job")["actBy"] == "A team admin who can post jobs"
    assert (
        await other.post(f"/api/company/{cid}/checklist/skip", json={"step": "job"}, headers=H(vs))
    ).status_code == 403
    assert (
        await other.put(f"/api/company/{cid}/checklist/reminders", json={"on": False}, headers=H(vs))
    ).status_code == 403
    # someone from another company: not found; nobody signed in: 401
    s2, c2 = await sign_up(
        make_client(),
        outbox,
        email="boss@gmail.com",
        details={"legalName": "Other Co Pvt Ltd", "website": "other.com", "category": "startup"},
    )
    assert (await client.get(f"/api/company/{cid}/checklist", headers=H(s2))).status_code == 404
    assert (await client.get(f"/api/company/{cid}/checklist")).status_code == 401


async def test_connect_step_for_auto_apply_testers(client, outbox, db):
    session, cid = await basic_company(client, outbox)
    await db["settings"].update_one(
        {"_id": "site"}, {"$set": {"auto_apply_v2.testers": ["founder@gmail.com"]}}, upsert=True
    )
    out = await checklist(client, cid, session)
    row = next(s for s in out["steps"] if s["id"] == "connect")
    assert row["testersOnly"] is True and row["required"] is False and row["link"] == "/company#connect"


# ---------- college ----------


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def test_college_checklist_for_coordinators(owner, make_client, outbox, db):
    org, g = await setup_group(owner)  # name, city and a group already
    oid = org["id"]
    c, _ = await coordinator(owner, make_client, outbox, oid)
    T._cache.clear()
    out = (await c.get(f"/api/org/{oid}/checklist")).json()
    assert out["title"] == "Set up your college"
    assert status(out) == {"basics": "done", "groups": "done", "students": "next", "reports": "later"}  # free plan
    assert next(s for s in out["steps"] if s["id"] == "students")["link"] == f"/org/{oid}#og-groups"
    # a student joins; a paid plan adds the drive and recruiter steps; a drive day and an invite tick them
    s, _ = await member(make_client, outbox, "asha@example.com", "Asha Rao")
    r = await s.post(
        "/api/me/groups/join",
        json={"code": "JNTUA26", "consent": True, "fields": {"roll": "21A01", "branch": "CSE"}, "resumeId": "r1"},
    )
    assert r.status_code == 201, r.text
    await owner.put(f"/api/admin/orgs/{oid}/billing/plan", json={"planId": "campus"})
    await db[DRIVES].insert_one({"_id": "d1", "org_id": oid, "name": "Drive"})
    await db[RECRUITER_INVITES].insert_one({"_id": "i1", "org_id": oid, "email_lc": "hr@infosys.com"})
    await db[AUDIT_LOG].insert_one({"_id": 999999, "action": "placement_report", "data": {"orgs": [oid]}, "at": now()})
    T._cache.clear()
    out = (await c.get(f"/api/org/{oid}/checklist?fresh=1")).json()
    assert set(status(out).values()) == {"done"} and out["complete"] is True


async def test_college_skip_viewers_and_other_colleges(owner, make_client, outbox, db):
    org, _ = await setup_group(owner)
    oid = org["id"]
    await db[ORGANIZATIONS].update_one({"_id": oid}, {"$set": {"city": ""}})
    c, _ = await coordinator(owner, make_client, outbox, oid)
    T._cache.clear()
    out = (await c.get(f"/api/org/{oid}/checklist")).json()
    assert out["next"] == "basics"
    basics = out["steps"][0]
    assert basics["canAct"] is False and basics["actBy"] == "Your organization’s Owner"  # the address is on Billing
    r = await c.post(f"/api/org/{oid}/checklist/skip", json={"step": "basics"})
    assert r.status_code == 200 and r.json()["next"] == "students"
    # a viewer sees it read-only and can't skip
    v, _ = await coordinator(owner, make_client, outbox, oid, email="viewer@example.com", role="viewer")
    out = (await v.get(f"/api/org/{oid}/checklist")).json()
    assert out["canSkip"] is False and all(s["canAct"] is False for s in out["steps"])
    assert (await v.post(f"/api/org/{oid}/checklist/skip", json={"step": "students"})).status_code == 403
    # another college's coordinator: 404 (never learns it exists); a non-college organization has no checklist
    o2, _ = await second_org(owner)
    other, _ = await coordinator(owner, make_client, outbox, o2["id"], email="other@example.com")
    assert (await other.get(f"/api/org/{oid}/checklist")).status_code == 404
    assert (await other.get(f"/api/org/{o2['id']}/checklist")).status_code == 404  # a skill centre
    stranger = make_client()
    from tests.conftest import signup

    await signup(stranger, outbox, "nobody@example.com", name="No Body")
    assert (await stranger.get(f"/api/org/{oid}/checklist")).status_code == 404


# ---------- weekly reminders ----------


async def _old(db, coll, oid):
    await db[coll].update_one({"_id": oid}, {"$set": {"created_at": now() - timedelta(days=3)}})


async def test_company_reminder_rules(client, outbox, db):
    session, cid = await basic_company(client, outbox)
    outbox.sent.clear()
    assert await T.remind(db, outbox, t=NOON) == 0  # Vetting Trust off and no testers: nobody
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.testers": ["founder@gmail.com"]}}, upsert=True)
    assert await T.remind(db, outbox, t=NOON) == 0  # the first two days: none
    await _old(db, COMPANIES, cid)
    await db[COMPANIES].update_one({"_id": cid}, {"$unset": {"setup.checked_at": ""}})
    assert await T.remind(db, outbox, t=datetime(2026, 11, 19, 17, 30, tzinfo=UTC)) == 0  # 11 PM IST: quiet
    assert await T.remind(db, outbox, t=NOON) == 1
    m = outbox.sent[-1]
    assert m.to == "founder@gmail.com" and "Next: Post your first job" in m.text and "k=setup" in m.text
    assert "/company#jobs" in m.text
    # at most once a week
    await db[COMPANIES].update_one({"_id": cid}, {"$unset": {"setup.checked_at": ""}})
    assert await T.remind(db, outbox, t=NOON + timedelta(days=3)) == 0
    await db[COMPANIES].update_one({"_id": cid}, {"$unset": {"setup.checked_at": ""}})
    assert await T.remind(db, outbox, t=NOON + timedelta(days=8)) == 1
    # the stop link
    token = m.text.split("#t=")[1].split("&")[0]
    assert (await client.post("/api/public/setup/stop-reminders", json={"token": token})).status_code == 200
    assert (await db[COMPANIES].find_one({"_id": cid}))["setup"]["reminders_off"] is True
    await db[COMPANIES].update_one({"_id": cid}, {"$unset": {"setup.checked_at": "", "setup.reminded_at": ""}})
    assert await T.remind(db, outbox, t=NOON + timedelta(days=20)) == 0
    assert (
        await client.post("/api/public/setup/stop-reminders", json={"token": f"co:{cid}.bad-signature-here"})
    ).status_code == 404


async def test_company_reminder_skips_demo_bounced_and_setting(client, outbox, db):
    session, cid = await basic_company(client, outbox)
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": True}}, upsert=True)
    await _old(db, COMPANIES, cid)
    await db["email_blocks"].insert_one({"_id": "founder@gmail.com", "reason": "bounce"})
    assert await T.remind(db, outbox, t=NOON) == 0
    await db["email_blocks"].delete_many({})
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"demo": True}, "$unset": {"setup.checked_at": ""}})
    assert await T.remind(db, outbox, t=NOON) == 0
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"demo": False}, "$unset": {"setup.checked_at": ""}})
    r = await client.put(f"/api/company/{cid}/checklist/reminders", json={"on": False}, headers=H(session))
    assert r.json() == {"on": False}
    assert (await checklist(client, cid, session))["reminders"] is False
    assert await T.remind(db, outbox, t=NOON) == 0
    await client.put(f"/api/company/{cid}/checklist/reminders", json={"on": True}, headers=H(session))
    assert await T.remind(db, outbox, t=NOON) == 1


async def test_college_reminder_to_owners_and_none_when_complete(owner, make_client, outbox, db):
    org, _ = await setup_group(owner)
    oid = org["id"]
    o, _ = await coordinator(owner, make_client, outbox, oid, email="principal@example.com", role="owner")
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": True}}, upsert=True)
    await _old(db, ORGANIZATIONS, oid)
    outbox.sent.clear()
    assert await T.remind(db, outbox, t=NOON) == 1
    m = outbox.sent[-1]
    assert m.to == "principal@example.com" and "Next: Invite your students" in m.text and f"/org/{oid}" in m.text
    # complete: no more reminders
    await db[ORGANIZATIONS].update_one(
        {"_id": oid},
        {"$set": {"setup.check_done_at": now()}, "$unset": {"setup.checked_at": "", "setup.reminded_at": ""}},
    )
    assert await T.remind(db, outbox, t=NOON + timedelta(days=8)) == 0
    # a demo college never
    await db[ORGANIZATIONS].update_one(
        {"_id": oid}, {"$set": {"demo": True}, "$unset": {"setup.check_done_at": "", "setup.checked_at": ""}}
    )
    assert await T.remind(db, outbox, t=NOON + timedelta(days=16)) == 0
    assert (
        await db[USERS].count_documents({"setup_reminded_at": {"$ne": None}}) == 0
    )  # people's own reminders untouched
