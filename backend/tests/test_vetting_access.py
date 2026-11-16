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
