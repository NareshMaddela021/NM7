# ruff: noqa: E501
"""The vetting launch switch (Admin → Skill checks → Launch; site settings `vetting`): OFF by default. While it is off
an ordinary person gets the old skill checks at the same address and the V2-only endpoints answer 404; a tester (an
email on the list) and a demo account get V2; companies see no "Skill verified" badge or filter unless the company is
the demo company; invites go to testers only. The owner turns it on in Admin settings and everyone gets V2."""

from datetime import timedelta

from app.core.db import USERS, VETTING_VERIFIED
from app.core.time import now
from app.hire.vetting import access
from tests.test_companies_apply import student
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_hire_shortlist import READY, post_job

URL = "/api/me/skill-checks"


async def test_hidden_by_default_old_checks_for_everyone_else(outbox, db, make_client, admin_client):
    assert (await access.settings(db)) == {"public": False, "testers": []}
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    assert (await c.get(f"{URL}/access")).json() == {"on": False}
    cat = (await c.get(URL)).json()
    assert cat["minutes"] == 10 and "skills" in cat and "roles" not in cat  # the old catalog
    paper = (await c.post(f"{URL}/start", json={"skill": "SQL"})).json()
    assert len(paper["questions"]) == 10 and len(paper["spoken"]) == 3  # the old paper, H3 questions only
    for path in ("/consent",):
        assert (await c.post(f"{URL}{path}")).status_code == 404
    assert (await c.get(f"{URL}/{paper['id']}")).status_code == 404
    assert (await c.put(f"{URL}/{paper['id']}/progress", json={})).status_code == 404
    r = (await c.post(f"{URL}/{paper['id']}/submit", json={"answers": {}, "tabSwitches": 1})).json()
    assert r["score"] == 0 and r["tabSwitches"] == 1
    assert (await c.put(f"{URL}/{paper['id']}/share", json={"share": True})).json()["share"] is True

    # a tester (the owner's own account) and a demo account get V2
    owner = await admin_client()
    s = (
        await owner.put("/api/admin/settings", json={"vetting": {"public": False, "testers": [" Ravi@Example.com "]}})
    ).json()
    assert s["vetting"] == {"public": False, "testers": ["ravi@example.com"]}
    t = await student(make_client, outbox, "ravi@example.com", "Ravi K")
    assert (await t.get(f"{URL}/access")).json() == {"on": True}
    assert "roles" in (await t.get(URL)).json()
    d = await student(make_client, outbox, "demo@example.com", "Demo Student")
    await db[USERS].update_one({"email": "demo@example.com"}, {"$set": {"demo": True}})
    assert (await d.get(f"{URL}/access")).json() == {"on": True}
    assert (await c.get(f"{URL}/access")).json() == {"on": False}  # still off for Asha

    # public: everyone
    await owner.put("/api/admin/settings", json={"vetting": {"public": True, "testers": []}})
    assert (await c.get(f"{URL}/access")).json() == {"on": True} and "roles" in (await c.get(URL)).json()


async def test_companies_see_no_badges_or_filters_while_hidden(client, outbox, db, make_client, admin_client):
    session, cid = await verified(client, outbox, db)
    job = await post_job(client, session, cid)
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    await c.put("/api/me/hire", json=READY)
    u = await db[USERS].find_one({"email": "asha@example.com"})
    t = now()
    await db[VETTING_VERIFIED].insert_one({"user_id": u["_id"], "test": "SQL", "band": "1-3", "score": 82, "task_score": 80,
                                            "at": t, "expires_at": t + timedelta(days=90)})  # fmt: skip
    url = f"/api/company/{cid}/hire/shortlist"
    out = (await client.get(url, params={"job": job, "verified": "true"}, headers=H(session))).json()
    assert out["vetting"] is False and out["items"] and out["items"][0]["skillVerified"] is None  # filter ignored too
    owner = await admin_client()
    await owner.put("/api/admin/settings", json={"vetting": {"public": True, "testers": []}})
    out = (await client.get(url, params={"job": job, "verified": "true"}, headers=H(session))).json()
    assert out["vetting"] is True and out["items"][0]["skillVerified"]["test"] == "SQL"


async def test_invites_only_reach_testers_while_hidden(db):
    assert await access.mail_filter(db) is None
    from app.site import save_site

    await save_site(db, {"vetting": {"public": False, "testers": ["ravi@example.com"]}})
    assert await access.mail_filter(db) == {"email_lc": {"$in": ["ravi@example.com"]}}
    await save_site(db, {"vetting": {"public": True, "testers": []}})
    assert await access.mail_filter(db) == {}


async def test_v1_hidden_hire_now_applicants_level_and_reminder_as_before(client, outbox, db, make_client):
    from app.core.db import HIRE_PROFILES
    from app.hire.available import send_reminders

    session, cid = await verified(client, outbox, db)
    job = await post_job(client, session, cid)
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    await c.put("/api/me/hire", json=READY)
    assert (await c.get("/api/me/level")).status_code == 404
    out = (
        await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job, "minLevel": 4}, headers=H(session))
    ).json()
    row = out["items"][0]  # the V1 filter is ignored while hidden
    assert "level" not in row and "readyNow" not in row and "reasons" not in row
    u = await db[USERS].find_one({"email": "asha@example.com"})
    await db[HIRE_PROFILES].update_one({"_id": u["_id"]}, {"$set": {"confirmed_at": now() - timedelta(days=8)}})
    out = (await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job}, headers=H(session))).json()
    assert out["items"] == []  # stale after 7 days, as before (V1 keeps them 21 days)
    await db[HIRE_PROFILES].update_one(
        {"_id": u["_id"]}, {"$set": {"confirmed_at": now() - timedelta(days=6, hours=12)}}
    )
    assert await send_reminders(db, outbox) == 1 and "Still ready" in outbox.sent[-1].subject  # the old email


async def test_v3_interviews_hidden(client, outbox, db, make_client):
    c = await student(make_client, outbox, "meena@example.com", "Meena S")
    assert (await c.get("/api/me/interviews/roles")).status_code == 404
    assert (await c.post("/api/me/interviews/start", json={"test": "SQL", "consent": True})).status_code == 404
    session, cid = await verified(client, outbox, db)
    u = await db[USERS].find_one({"email": "meena@example.com"})
    assert (await client.get(f"/api/company/{cid}/hire/interview/{u['_id']}", headers=H(session))).status_code == 404


async def test_v5_hidden_appeals_export_reminders_and_no_retention(outbox, db, make_client):
    from bson import ObjectId

    from app.core.db import AUDIT_LOG
    from app.hire.vetting import trust as T

    c = await student(make_client, outbox, "kiran@example.com", "Kiran P")
    assert (await c.get("/api/me/appeals")).status_code == 404
    assert (await c.get("/api/me/data-export")).status_code == 404
    u = await db[USERS].find_one({"email": "kiran@example.com"})
    t = now()
    await db[VETTING_VERIFIED].insert_one({"user_id": u["_id"], "test": "Excel", "slug": "excel", "role": "Office assistant (Excel)", "band": "1-3",
                                            "score": 80, "task_score": 80, "at": t - timedelta(days=76), "expires_at": t + timedelta(days=14)})  # fmt: skip
    assert await T.reverify_reminders(db, outbox) == 0  # hidden: no email to a real person
    v = await db[VETTING_VERIFIED].find_one({"user_id": u["_id"]})
    assert "reminded" not in v  # not marked either: they still get it after the launch
    await db[AUDIT_LOG].insert_one(
        {"_id": ObjectId(), "action": "x", "ip": "203.0.113.9", "at": now() - timedelta(days=31)}
    )
    out = await T.daily_if_due(db, outbox)
    assert out["retention_waits"] == 1 and await db[AUDIT_LOG].find_one({"ip": "203.0.113.9"})  # nothing rewritten
