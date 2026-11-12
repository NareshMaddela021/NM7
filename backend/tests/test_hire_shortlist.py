"""Phase 5 H2: instant shortlist. Only Verified companies; only available candidates who agreed to be seen, who suit
the place and the kind of job; ranked by match (salary above the range steps down); no email or phone until the
candidate accepts; invite one or all; Accept moves them to Shortlisted in the company dashboard; Not interested needs
a reason; the free roles a month, the hourly and daily limits (Admin can change them); demo and real never mix."""

from datetime import timedelta

from app.core.db import APPLICATIONS, COMPANIES, HIRE_PROFILES, USERS
from app.core.time import now
from app.hire import shortlist as sl
from app.site import get_site, save_site
from tests.jobs_helpers import resume
from tests.test_companies_apply import student
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401

READY = {"on": True, "consent": True, "joinDate": "2026-12-01", "cities": ["Hyderabad"], "salary": {"amount": 25000,
         "unit": "month"}, "noticeDays": 0, "jobTypes": ["full_time"]}  # fmt: skip


async def post_job(client, session, cid, **over):
    r = await client.post(f"/api/company/{cid}/jobs", json={"job": {**JOB, **over}}, headers=H(session))
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def ready(make_client, outbox, email, name, data=None, **over):
    c = await student(make_client, outbox, email, name, data)
    r = await c.put("/api/me/hire", json={**READY, **over})
    assert r.status_code == 200, r.text
    return c


def test_small_pieces():
    assert (
        sl.short_name("Asha Rani Rao") == "Asha R."
        and sl.short_name("Ravi") == "Ravi"
        and sl.short_name("") == "Candidate"
    )
    assert round(sl.monthly({"amount": 3.6, "unit": "lpa"})) == 30000
    job = {"min": 240000, "max": 360000, "period": "yearly"}  # 20,000 – 30,000 a month
    assert sl.salary_fit({"amount": 25000, "unit": "month"}, job)["fit"] == "within"
    assert sl.salary_fit({"amount": 5, "unit": "lpa"}, job)["fit"] == "above"
    assert sl.salary_fit({"amount": 15000, "unit": "month"}, job)["fit"] == "below"
    assert sl.salary_fit(None, job)["fit"] == "unknown" and sl.salary_fit({"amount": 1}, None)["fit"] == "unknown"
    assert sl.place_ok({"cities": ["hyderabad"]}, {"locations": ["Hyderabad"]}) == "Hyderabad"
    assert sl.place_ok({"cities": ["Pune"]}, {"locations": ["Hyderabad"]}) is None
    assert sl.place_ok({"cities": []}, {"remote": True}) == "remote"


async def test_verified_only_and_ranking_and_privacy(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    job = await post_job(client, session, cid, salary={"min": 240000, "max": 360000, "period": "yearly"})
    # four people; two shown in order, the rest don't suit
    await ready(make_client, outbox, "asha@example.com", "Asha Rao")  # SQL + Power BI on the resume, 25k
    weak = resume(
        personal={"name": "Bala Krishnan", "headline": "Office assistant", "location": "Hyderabad"},
        summary="Office assistant, good with Excel.",
        skillGroups=[{"id": "c", "label": "Core", "value": "Excel"}],
        exp=[],
        proj=[],
        certs=[],
    )
    await ready(make_client, outbox, "bala@example.com", "Bala Krishnan", data=weak)
    await ready(make_client, outbox, "chitra@example.com", "Chitra M", cities=["Pune"])  # wrong city
    no_consent = await student(make_client, outbox, "dev@example.com", "Dev Patel")
    await no_consent.put("/api/me/hire", json={**READY, "on": False, "consent": False})
    out = (await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job}, headers=H(session))).json()
    names = [x["name"] for x in out["items"]]
    assert names == ["Asha R.", "Bala K."] and out["available"] == 2
    top = out["items"][0]
    assert top["match"]["score"] > out["items"][1]["match"]["score"] and "SQL" in top["match"]["found"]
    assert top["salary"]["fit"] == "within" and top["availability"]["joinDate"] == "2026-12-01"
    assert top["reliability"]["label"] == "New - no history yet" and top["skillCheck"] is None
    assert top["verified"] == []
    blob = str(out)
    assert "@example.com" not in blob and "phone" not in blob  # never contact details on the shortlist
    # Phase 6 S2: a "Skill verified" badge (check passed + project sent) shows, with its date
    asha = await db[USERS].find_one({"email": "asha@example.com"})
    await db[USERS].update_one(
        {"_id": asha["_id"]}, {"$set": {"verified_skills": [{"skill": "SQL", "role": "data-analyst", "at": now()}]}}
    )
    out = (await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job}, headers=H(session))).json()
    assert out["items"][0]["verified"][0]["skill"] == "SQL" and out["items"][0]["verified"][0]["at"]
    # stale (7 days without Still ready) drops out
    asha = await db[USERS].find_one({"email": "asha@example.com"})
    await db[HIRE_PROFILES].update_one({"_id": asha["_id"]}, {"$set": {"confirmed_at": now() - timedelta(days=8)}})
    out = (await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job}, headers=H(session))).json()
    assert [x["name"] for x in out["items"]] == ["Bala K."]
    # a Basic company (not verified) sees its applicants only
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"verified_until": now() - timedelta(days=1)}})
    r = await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job}, headers=H(session))
    assert r.status_code == 403 and err(r) == "verified_only" and "applicants" in r.json()["error"]["message"]


async def test_invite_accept_decline(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    job = await post_job(client, session, cid)
    asha = await ready(make_client, outbox, "asha@example.com", "Asha Rao")
    bala = await ready(make_client, outbox, "bala@example.com", "Bala Krishnan")
    items = (await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job}, headers=H(session))).json()[
        "items"
    ]
    keys = [x["key"] for x in items]
    n0 = len(outbox.sent)
    body = {"job": job, "people": keys, "note": "Can you start Monday?"}
    r = await client.post(f"/api/company/{cid}/hire/invite", json=body, headers=H(session))
    assert r.json()["sent"] == 2 and len(outbox.sent) == n0 + 2  # bulk invite: both emailed
    assert "invited you" in outbox.sent[-1].subject and "only if you accept" in outbox.sent[-1].text
    legal = (await db[COMPANIES].find_one({"_id": cid}))["details"]["legal_name"]
    assert outbox.sent[-1].subject.startswith(f"{legal} invited you")  # the company's real name
    again = await client.post(
        f"/api/company/{cid}/hire/invite", json={"job": job, "people": keys[:1]}, headers=H(session)
    )
    assert again.json()["sent"] == 0 and again.json()["skipped"][0]["why"] == "invited"
    # the company sees no contact details before an answer
    rows = (await client.get(f"/api/company/{cid}/hire/invites", headers=H(session))).json()
    assert all(x["status"] == "sent" and "contact" not in x for x in rows)
    # Asha accepts: shortlisted in the company dashboard, contact shows
    mine = (await asha.get("/api/me/hire/invites")).json()
    assert (
        mine[0]["role"] == JOB["title"] and mine[0]["note"] == "Can you start Monday?" and mine[0]["company"] == legal
    )
    assert (await asha.post(f"/api/me/hire/invites/{mine[0]['id']}", json={"answer": "accept"})).json()[
        "status"
    ] == "accepted"
    assert (
        err(await asha.post(f"/api/me/hire/invites/{mine[0]['id']}", json={"answer": "decline", "reason": "salary"}))
        == "answered"
    )
    a = await db[APPLICATIONS].find_one({"job_id": job, "origin": "invite"})
    assert a["status"] == "shortlisted" and a["channel"] == "nm7" and a["consent_at"]
    apps = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
    assert apps[0]["contact"]["email"] == "asha@example.com"
    # Bala: a reason is needed
    b = (await bala.get("/api/me/hire/invites")).json()[0]
    assert err(await bala.post(f"/api/me/hire/invites/{b['id']}", json={"answer": "decline"})) == "reason"
    await bala.post(f"/api/me/hire/invites/{b['id']}", json={"answer": "decline", "reason": "salary"})
    rows = {x["key"]: x for x in (await client.get(f"/api/company/{cid}/hire/invites", headers=H(session))).json()}
    accepted = [x for x in rows.values() if x["status"] == "accepted"][0]
    declined = [x for x in rows.values() if x["status"] == "declined"][0]
    assert accepted["contact"]["email"] == "asha@example.com" and accepted["name"] == "Asha Rao"
    assert "contact" not in declined and declined["reasonText"] == "The salary is too low"


async def test_limits_and_gate(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    jobs = [await post_job(client, session, cid, title=f"Analyst {i}") for i in range(2)]
    await ready(make_client, outbox, "asha@example.com", "Asha Rao")
    site = await get_site(db)
    # one free role a month and the feature closed (Admin → Plans): the second role needs it turned on
    await save_site(
        db, {"hire": {**site["hire"], "free_shortlists": 1, "open": {"instant": False, "tests": True, "bulk": True}}}
    )
    url = f"/api/company/{cid}/hire/shortlist"
    assert (await client.get(url, params={"job": jobs[0]}, headers=H(session))).status_code == 200
    assert (await client.get(url, params={"job": jobs[0]}, headers=H(session))).status_code == 200  # same role again
    r = await client.get(url, params={"job": jobs[1]}, headers=H(session))
    assert r.status_code == 402 and err(r) == "plan"
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"hire_features": ["instant"]}})  # Admin turned it on
    assert (await client.get(url, params={"job": jobs[1]}, headers=H(session))).status_code == 200
    # shortlists an hour
    await save_site(db, {"hire": {**(await get_site(db))["hire"], "shortlists_per_hour": 3}})
    assert err(await client.get(url, params={"job": jobs[1]}, headers=H(session))) == "rate_limited"
    # invites a day
    await save_site(db, {"hire": {**(await get_site(db))["hire"], "shortlists_per_hour": 100, "invites_per_day": 0}})
    key = (await client.get(url, params={"job": jobs[1]}, headers=H(session))).json()["items"][0]["key"]
    r = await client.post(f"/api/company/{cid}/hire/invite", json={"job": jobs[1], "people": [key]}, headers=H(session))
    assert err(r) == "invites_limit"


async def test_demo_and_real_never_mix(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    job = await post_job(client, session, cid)
    await ready(make_client, outbox, "asha@example.com", "Asha Rao")
    await ready(make_client, outbox, "demo1@example.com", "Demo Person")
    await db[USERS].update_one({"email": "demo1@example.com"}, {"$set": {"demo": True}})
    out = (await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job}, headers=H(session))).json()
    assert [x["name"] for x in out["items"]] == ["Asha R."]
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"demo": True}})
    out = (await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job}, headers=H(session))).json()
    assert [x["name"] for x in out["items"]] == ["Demo P."]


async def test_admin_settings_and_company_grant(client, outbox, db, admin_client):
    session, cid = await verified(client, outbox, db)
    owner = await admin_client()
    s = (await owner.get("/api/admin/settings")).json()["hire"]
    assert s == {"on": True, "confirmDays": 7, "freeShortlists": 20, "shortlistsPerHour": 20, "invitesPerDay": 60,
                 "replyHours": 24,
                 "open": {"instant": True, "tests": True, "bulk": True}}  # fmt: skip
    r = await owner.put(
        "/api/admin/settings", json={"hire": {"on": True, "freeShortlists": 5, "open": {"instant": False}}}
    )
    out = r.json()["hire"]
    assert out["freeShortlists"] == 5 and out["confirmDays"] == 7 and out["invitesPerDay"] == 60  # the rest kept
    assert out["open"] == {"instant": False, "tests": True, "bulk": True}
    r = await owner.put(f"/api/admin/companies/{cid}/hire-features", json={"features": ["instant", "instant"]})
    assert r.json()["hireFeatures"] == ["instant"]
    c = await db[COMPANIES].find_one({"_id": cid})
    assert await sl.gate(db, c, "instant") and not await sl.gate(db, {**c, "hire_features": []}, "instant")
