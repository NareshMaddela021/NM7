"""Phase 2 C3: companies post jobs safely. Unfair wording blocked, scam signs and the AI check (once per job) send the
job to Admin review, fresher-fit warnings, duplicate open jobs refused, 2 edits on a live job, trust-level limits,
isolation between companies, the phrase lists in Settings, and the AI description writer never inventing facts."""

import pytest

from app.companies import jobcheck
from app.core.config import get_settings
from app.core.db import AUDIT_LOG, COMPANIES, JOBS
from tests.test_companies_queue import basic_company
from tests.test_companies_signup import H, err, no_network, sign_up  # noqa: F401

JOB = {
    "title": "Junior Data Analyst",
    "locations": ["Hyderabad"],
    "experience": "fresher",
    "skills": ["SQL", "Power BI"],
    "description": "Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome.",
}


@pytest.fixture(autouse=True)
def no_ai(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")


async def verified(client, outbox, db, email="founder@gmail.com", site="acme.com"):
    session, cid = await basic_company(client, outbox, email=email, site=site)
    await db[COMPANIES].update_one(
        {"_id": cid},
        {
            "$set": {
                "review.state": "approved",
                "verified_until": __import__("app.core.time", fromlist=["now"]).now().replace(year=2030),
            }
        },
    )
    return session, cid


async def test_post_checks_review_and_limits(client, outbox, db, admin_client):
    session, cid = await basic_company(client, outbox)  # Basic: 1 job a week
    url = f"/api/company/{cid}/jobs"
    # check first: nothing saved
    r = (
        await client.post(
            f"{url}/check",
            json={
                "job": {
                    **JOB,
                    "description": "Male preferred. Age below 25. Need 3 years experience in SQL dashboards.",
                }
            },
            headers=H(session),
        )
    ).json()
    assert {"male preferred", "an age limit"} <= set(r["blocked"]) and r["warnings"] and "3+ years" in r["warnings"][0]
    assert (await client.post(f"{url}/check", json={"job": {"title": "x"}}, headers=H(session))).json()["errors"]
    assert await db[JOBS].count_documents({}) == 0
    # unfair wording is blocked
    r = await client.post(
        url, json={"job": {**JOB, "description": JOB["description"] + " Female candidates only."}}, headers=H(session)
    )
    assert err(r) == "unfair_wording" and "female candidates only" in r.json()["error"]["blocked"]
    # a clean job goes live, from the company, Apply on Nm7 by default
    r = await client.post(url, json={"job": JOB}, headers=H(session))
    assert r.status_code == 201, r.text
    job = r.json()
    assert (job["status"], job["apply"]["method"], job["editsLeft"]) == ("active", "nm7", 2)
    doc = await db[JOBS].find_one({"_id": job["id"]})
    assert (doc["source"], doc["company_id"], doc["company"]["name"]) == ("company", cid, "Acme Analytics Pvt Ltd")
    assert (await client.get(f"/api/jobs/{job['slug']}")).status_code == 200  # live on the board
    # Basic: one a week
    assert err(await client.post(url, json={"job": {**JOB, "title": "Data Intern"}}, headers=H(session))) == "limit"
    await db[COMPANIES].update_one(
        {"_id": cid}, {"$set": {"review.state": "approved", "verified_until": doc["created_at"].replace(year=2030)}}
    )
    # the same job open in the same city: refused; another city is fine
    assert err(await client.post(url, json={"job": JOB}, headers=H(session))) == "duplicate"
    # scam signs → Admin review (not public)
    scam = {
        **JOB,
        "title": "Data Entry Operator",
        "description": "Work from home typing jobs. Pay a registration fee of Rs 500 to start. "
        "Contact only on WhatsApp.",
    }
    r = await client.post(url, json={"job": scam}, headers=H(session))
    assert r.json()["status"] == "review" and any("registration fee" in x for x in r.json()["review"]["reasons"])
    rev = r.json()
    assert (await client.get(f"/api/jobs/{rev['slug']}")).status_code == 200  # the page exists…
    assert (await client.get("/api/jobs", params={"q": "Data Entry"})).json()["total"] == 0  # …but not listed
    assert (
        err(await client.post(f"{url}/{rev['id']}/status", json={"status": "active"}, headers=H(session)))
        == "in_review"
    )
    # Admin: reject with a reason (emailed); approve another
    owner = await admin_client("owner")
    assert (
        err(await owner.post(f"/api/admin/jobs/{rev['id']}/review", json={"approve": False, "reason": ""})) == "reason"
    )
    r = await owner.post(
        f"/api/admin/jobs/{rev['id']}/review", json={"approve": False, "reason": "Asks candidates to pay a fee"}
    )
    assert r.json()["status"] == "closed" and "Asks candidates to pay a fee" in outbox.sent[-1].text
    scam2 = {
        **JOB,
        "title": "Field Sales Trainee",
        "description": "Meet shop owners and explain our app. No interview required for freshers who join this week.",
    }
    r2 = (await client.post(url, json={"job": scam2}, headers=H(session))).json()
    assert r2["status"] == "review"
    r = await owner.post(f"/api/admin/jobs/{r2['id']}/review", json={"approve": True})
    assert r.json()["status"] == "active" and "is now live" in outbox.sent[-1].text
    assert (await owner.get("/api/admin/jobs", params={"status": "review"})).json()["total"] == 0
    # the company's own list; another company can't see or change these
    mine = (await client.get(url, headers=H(session))).json()
    assert {j["title"] for j in mine} == {"Junior Data Analyst", "Data Entry Operator", "Field Sales Trainee"}
    s2, other = await sign_up(client, outbox, email="other@gmail.com")
    c2 = other["id"]
    assert (await client.get(f"/api/company/{c2}/jobs", headers=H(s2))).json() == []
    assert err(await client.put(f"/api/company/{c2}/jobs/{job['id']}", json={"job": JOB}, headers=H(s2))) == "not_found"
    assert (await client.get(url, headers=H(s2))).status_code == 404
    actions = [a["action"] async for a in db[AUDIT_LOG].find({"target": cid, "action": {"$regex": "^company.job"}})]
    assert actions.count("company.job_post") == 3


async def test_edits_status_roles_and_settings(client, outbox, db, admin_client):
    session, cid = await verified(client, outbox, db)
    url = f"/api/company/{cid}/jobs"
    job = (await client.post(url, json={"job": JOB}, headers=H(session))).json()
    for n in (1, 0):
        r = await client.put(
            f"{url}/{job['id']}",
            json={"job": {**JOB, "description": JOB["description"] + f" Edit {n}."}},
            headers=H(session),
        )
        assert r.json()["editsLeft"] == n
    assert err(await client.put(f"{url}/{job['id']}", json={"job": JOB}, headers=H(session))) == "edit_limit"
    # paused jobs don't count as live edits; close is final
    r = await client.post(f"{url}/{job['id']}/status", json={"status": "paused"}, headers=H(session))
    assert r.json()["status"] == "paused"
    r = await client.post(f"{url}/{job['id']}/status", json={"status": "closed"}, headers=H(session))
    assert (r.json()["status"], r.json()["closedReason"]) == ("closed", "closed by the company")
    assert (
        err(await client.post(f"{url}/{job['id']}/status", json={"status": "active"}, headers=H(session))) == "closed"
    )
    # a view-only admin can read, not post
    await client.post(f"/api/company/{cid}/team", json={"email": "view@acme.com", "role": "view"}, headers=H(session))
    await client.post("/api/recruiter-account/code", json={"email": "view@acme.com"})
    sv = (
        await client.post(
            "/api/recruiter-account/session", json={"email": "view@acme.com", "code": outbox.last_code("view@acme.com")}
        )
    ).json()["session"]
    await client.get("/api/company/mine", headers=H(sv))
    assert len((await client.get(url, headers=H(sv))).json()) == 1
    assert err(await client.post(url, json={"job": {**JOB, "title": "Another"}}, headers=H(sv))) == "not_allowed"
    # the phrase lists are settings
    owner = await admin_client("owner")
    s = (await owner.get("/api/admin/settings")).json()["jobChecks"]
    assert "male preferred" in s["blocked"] and "registration fee" in s["scam"]
    await owner.put(
        "/api/admin/settings", json={"jobChecks": {"blocked": s["blocked"] + ["Night Owls Only"], "scam": s["scam"]}}
    )
    r = await client.post(
        url,
        json={"job": {**JOB, "title": "Support Agent", "description": JOB["description"] + " Night owls only."}},
        headers=H(session),
    )
    assert err(r) == "unfair_wording"


async def test_ai_check_once_and_writer_never_invents(client, outbox, db, monkeypatch):
    session, cid = await verified(client, outbox, db)
    calls = []

    async def fake_ai(db_, company_id, j):
        calls.append(j["title"])
        return {"suspicious": "crypto" in j["description"].lower(), "reasons": ["Promises crypto returns"]}

    monkeypatch.setattr(jobcheck, "ai_check", fake_ai)
    url = f"/api/company/{cid}/jobs"
    ok = (await client.post(url, json={"job": JOB}, headers=H(session))).json()
    sus = (
        await client.post(
            url,
            json={
                "job": {
                    **JOB,
                    "title": "Investment Associate",
                    "description": "Help clients invest in crypto schemes and grow their money fast.",
                }
            },
            headers=H(session),
        )
    ).json()
    assert (
        ok["status"] == "active"
        and sus["status"] == "review"
        and "AI check: Promises crypto returns" in sus["review"]["reasons"]
    )
    await client.put(
        f"{url}/{ok['id']}", json={"job": {**JOB, "description": JOB["description"] + " Updated."}}, headers=H(session)
    )
    for _ in range(3):
        await client.get(f"/api/jobs/{ok['slug']}")
    assert calls == ["Junior Data Analyst", "Investment Associate"]  # once per job, never per view or edit
    # the writer: without AI, the plain template from the 3 lines
    w = (
        await client.post(
            f"{url}/write",
            json={"role": "Junior Data Analyst", "skills": "SQL, Power BI", "place": "Hyderabad, ₹3–4.5 LPA"},
            headers=H(session),
        )
    ).json()
    assert w["source"] == "template" and "SQL, Power BI" in w["description"] and "₹3–4.5 LPA" in w["description"]
    # with AI: an answer that invents a salary or perks is thrown away; a clean one is kept
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-key")
    from app.core import claude

    invented_text = (
        "You will build dashboards in SQL. We offer 6 LPA, health insurance and free lunch. Founded in 1999."
    )
    clean_text = "You will build weekly dashboards in SQL and Power BI for our stores in Hyderabad. Freshers welcome."
    answers = iter([invented_text, clean_text])

    async def fake_models(feature, content, schema, check, **kw):
        return check({"description": next(answers)})

    monkeypatch.setattr(claude, "ask_models", fake_models)
    bad = (
        await client.post(
            f"{url}/write",
            json={"role": "Junior Data Analyst", "skills": "SQL, Power BI", "place": "Hyderabad, 3 LPA"},
            headers=H(session),
        )
    ).json()
    assert bad["source"] == "template" and {"6 LPA", "insurance", "free lunch", "founded"} <= set(bad["removed"])
    good = (
        await client.post(
            f"{url}/write",
            json={"role": "Junior Data Analyst", "skills": "SQL, Power BI", "place": "Hyderabad"},
            headers=H(session),
        )
    ).json()
    assert good["source"] == "ai" and "Hyderabad" in good["description"]


def test_rules():
    c = jobcheck.check
    assert c({**JOB})["blocked"] == [] and c({**JOB})["scam"] == []
    assert c({**JOB, "description": "Only males need apply, unmarried preferred"})["blocked"] == [
        "only males",
        "unmarried",
    ]
    assert c({**JOB, "description": "Boys only for this role"})["blocked"] == ["boys only"]
    assert c({**JOB, "description": "Telegram only: send your CV"})["scam"] == ["telegram only"]
    assert c({**JOB, "experience": "1_3", "description": "2 years of experience in SQL"})["warnings"] == []
    assert c({**JOB, "experience": "internship", "description": "1+ yrs experience in Excel"})["warnings"]
    assert jobcheck.invented("Pay is 3 LPA in Hyderabad", "Analyst\nSQL\nHyderabad 3 LPA") == []
