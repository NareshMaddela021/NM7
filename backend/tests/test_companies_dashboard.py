"""Phase 2 C2: the company dashboard (overview numbers, company page with logo, activity log, request a change of
verified details) and the public company page (Basic or Verified only; never demo, blocked or unconfirmed)."""

import base64
from datetime import timedelta

from app.core.db import APPLICATIONS, COMPANIES, JOBS
from app.core.time import now
from tests.test_companies_queue import basic_company
from tests.test_companies_signup import H, err, no_network, sign_up  # noqa: F401

PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 40).decode()


async def test_overview_page_activity_and_change(client, outbox, db):
    session, cid = await basic_company(client, outbox)
    for jid, owner, status in (("j1", cid, "active"), ("j2", cid, "closed"), ("j3", "someone-else", "active")):
        await db[JOBS].insert_one(
            {"_id": jid, "company_id": owner, "status": status, "created_at": now(), "dedupe_key": jid, "slug": jid}
        )
    await db[APPLICATIONS].insert_many(
        [{"user_id": "u1", "key": "a", "job_id": "j1"}, {"user_id": "u2", "key": "a", "job_id": "j3"}]
    )
    o = (await client.get(f"/api/company/{cid}/overview", headers=H(session))).json()
    assert (o["liveJobs"], o["jobs"], o["applicants"], o["trust"], o["review"]) == (1, 2, 1, "basic", "pending")
    assert o["room"]["limit"] == 1 and o["myRole"] == "main"
    # the company page: about + logo; a view-only admin can read, not change
    r = await client.put(
        f"/api/company/{cid}/page", json={"about": "We build tools for shops.", "logo": PNG}, headers=H(session)
    )
    assert (
        r.status_code == 200 and r.json()["logo"] == PNG and r.json()["details"]["about"] == "We build tools for shops."
    )
    assert (
        await client.put(
            f"/api/company/{cid}/page", json={"about": "x", "logo": "data:text/html;base64,PGI+"}, headers=H(session)
        )
    ).status_code == 422
    await client.post(f"/api/company/{cid}/team", json={"email": "view@acme.com", "role": "view"}, headers=H(session))
    await client.post("/api/recruiter-account/code", json={"email": "view@acme.com"})
    sv = (
        await client.post(
            "/api/recruiter-account/session", json={"email": "view@acme.com", "code": outbox.last_code("view@acme.com")}
        )
    ).json()["session"]
    await client.get("/api/company/mine", headers=H(sv))
    assert (await client.get(f"/api/company/{cid}/overview", headers=H(sv))).json()["myRole"] == "view"
    assert err(await client.put(f"/api/company/{cid}/page", json={"about": "x"}, headers=H(sv))) == "not_allowed"
    acts = (await client.get(f"/api/company/{cid}/activity", headers=H(sv))).json()
    assert acts[0]["action"] == "company.team_add" and "company.page" in {a["action"] for a in acts}
    # verified details are locked; a change request unlocks them and starts a new check
    assert err(await client.post(f"/api/company/{cid}/request-change", headers=H(session))) == "not_locked"
    await db[COMPANIES].update_one(
        {"_id": cid}, {"$set": {"review": {"state": "approved"}, "verified_until": now() + timedelta(days=300)}}
    )
    assert (await client.get(f"/api/company/{cid}", headers=H(session))).json()["trust"] == "verified"
    r = await client.post(f"/api/company/{cid}/request-change", headers=H(session))
    assert (r.json()["trust"], r.json()["review"]["state"]) == ("basic", "draft")
    assert err(await client.post(f"/api/company/{cid}/request-change", headers=H(sv))) == "not_allowed"


async def test_public_company_page(client, outbox, db):
    session, cid = await basic_company(client, outbox)
    await client.put(f"/api/company/{cid}/page", json={"about": "Retail analytics.", "logo": PNG}, headers=H(session))
    slug = (await db[COMPANIES].find_one({"_id": cid}))["slug"]
    job = {"company_id": cid, "demo": False, "closes_at": None, "posted_at": now(), "company": {"name": "Acme"},
           "locations": ["Pune"], "remote": False, "work_type": "onsite", "job_type": "full_time",
           "experience": "fresher", "skills": [], "apply": {"method": "nm7"}, "created_at": now()}  # fmt: skip
    await db[JOBS].insert_one(
        {**job, "_id": "pj1", "status": "active", "slug": "a-1", "dedupe_key": "a", "title": "Analyst"}
    )
    await db[JOBS].insert_one(
        {**job, "_id": "pj2", "status": "paused", "slug": "b-1", "dedupe_key": "b", "title": "Paused"}
    )
    p = (await client.get(f"/api/companies/{slug}")).json()
    assert (p["name"], p["about"], p["website"], p["trust"], p["logo"]) == (
        "Acme Analytics Pvt Ltd",
        "Retail analytics.",
        "https://acme.com",
        "basic",
        PNG,
    )
    assert [j["title"] for j in p["jobs"]] == ["Analyst"]
    r = await client.get(f"/api/companies/{slug}/logo")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")
    # unconfirmed, blocked and demo companies have no public page
    _, draft = await sign_up(client, outbox, email="new@gmail.com")
    dslug = (await db[COMPANIES].find_one({"_id": draft["id"]}))["slug"]
    assert (await client.get(f"/api/companies/{dslug}")).status_code == 404
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"review.state": "blocked"}})
    assert (await client.get(f"/api/companies/{slug}")).status_code == 404
    assert (await client.get(f"/api/companies/{slug}/logo")).status_code == 404
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"review.state": "pending", "demo": True}})
    assert (await client.get(f"/api/companies/{slug}")).status_code == 404
