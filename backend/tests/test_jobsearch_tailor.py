"""Tailor this resume (Phase 1, Tailor pack): a copy named after the job, suggestions with before → after, Accept /
Skip, the original never changes, and no AI line ever adds a fact (a mocked Claude that invents a company, a number
or a skill is rejected and the rules version is used)."""

from datetime import date

import pytest

from app.core.config import get_settings
from app.core.db import RESUMES
from app.jobsearch import facts, tailor
from tests.conftest import signup
from tests.jobs_helpers import POSTS, add_resume, mock_claude, reply, resume

DA = POSTS["01_data_analyst_fresher"]
TWO_PROJECTS = resume(
    proj=[
        {"title": "College Fest Website", "tagline": "Event site", "description": "Built the fest website in HTML",
         "tech": "HTML, CSS"},
        {"title": "Sales Dashboard Revamp", "tagline": "Power BI dashboards for a college fest's sponsor sales",
         "description": "made sales dashboards in power bi and sql for the sponsors team",
         "tech": "Power BI, SQL, Excel"},
    ]
)  # fmt: skip


@pytest.fixture
async def customer(client, outbox, admin_client):
    await signup(client, outbox)
    await add_resume(client, data=TWO_PROJECTS)
    owner = await admin_client("owner")
    uid = (await client.get("/api/auth/me")).json()["id"]
    r = await owner.post(f"/api/admin/customers/{uid}/job-pack", json={"feature": "tailor", "granted": True})
    assert r.status_code == 200
    return client


async def new_match(c, text=DA):
    r = await c.post("/api/me/jobs/match", json={"resumeId": "r1", "text": text})
    assert r.status_code == 201, r.text
    return r.json()


async def original(db):
    return (await db[RESUMES].find_one({"key": "r1"}))["data"]


# ---------- the fact check ----------


def test_fact_check_rejects_anything_new():
    res = facts.resume_text(resume())
    assert facts.ok("Data Analyst Intern at Northwind Retail, skilled in Python, SQL and Power BI.", res)
    assert "the name Infosys" in facts.problems("Worked at Infosys on Python reports.", res)
    assert "the number 40" in facts.problems("Cut report time by 40% with Python.", res)
    assert "the skill Tableau" not in facts.problems("Built Tableau dashboards.", res)  # Tableau is on the resume
    assert "the skill Snowflake" in facts.problems("Built Snowflake pipelines.", res)
    assert facts.problems("Holds an MBA from IIM.", res)  # a degree and a college that aren't there
    assert "contact details or an ID number" in facts.problems("Call 98765 43210.", res)
    # the job's own title / company may be named (a cover letter says where it applies), not its skills
    assert facts.ok(
        "Keen to join Brightpath Analytics as a Data Analyst.", res, allowed="Data Analyst Brightpath Analytics"
    )
    assert facts.problems("Skilled in VLOOKUP.", res, allowed="Data Analyst Brightpath Analytics")


# ---------- the copy and the suggestions ----------


async def test_locked_without_the_tailor_pack(client, outbox):
    await signup(client, outbox, email="free@example.com")
    await add_resume(client)
    m = await new_match(client)
    r = await client.post(f"/api/me/jobs/matches/{m['id']}/tailor", json={"useAi": False})
    assert r.status_code == 402 and r.json()["error"]["code"] == "tailor_locked"


async def test_copy_named_after_the_job_and_original_unchanged(customer, db):
    before = await original(db)
    m = await new_match(customer)
    r = await customer.post(f"/api/me/jobs/matches/{m['id']}/tailor", json={"useAi": False})
    assert r.status_code == 200, r.text
    t = r.json()
    d = date.today().strftime("%d %b %Y").lstrip("0")
    assert t["copy"]["name"] == f"Data Analyst - Brightpath Analytics - {d}"
    assert t["original"] == {"id": "r1", "name": "Main"}
    kinds = [s["kind"] for s in t["suggestions"]]
    assert {"headline", "summary", "skills", "bullet", "projects"} <= set(kinds)
    for s in t["suggestions"]:
        assert s["status"] == "pending" and s["before"] != s["after"]
    copy = await db[RESUMES].find_one({"key": t["copy"]["id"]})
    assert copy["data"] == before and copy["tailored_from"] == "r1"  # a copy, nothing applied yet
    assert t["scoreNow"] == t["scoreBefore"] and t["scoreIfAll"] >= t["scoreBefore"]
    # the match links to the copy; asking again returns the same copy
    again = (await customer.post(f"/api/me/jobs/matches/{m['id']}/tailor", json={"useAi": False})).json()
    assert again["copy"] == t["copy"]
    assert (await customer.get(f"/api/me/jobs/matches/{m['id']}")).json()["tailoredResumeId"] == t["copy"]["id"]
    assert await db[RESUMES].count_documents({}) == 2


async def test_accept_and_skip_change_only_the_copy(customer, db):
    before = await original(db)
    m = await new_match(customer)
    t = (await customer.post(f"/api/me/jobs/matches/{m['id']}/tailor", json={"useAi": False})).json()
    sugg = {s["kind"]: s for s in t["suggestions"]}
    url = f"/api/me/jobs/matches/{m['id']}/suggestions"
    r = (await customer.post(f"{url}/{sugg['headline']['id']}", json={"action": "accept"})).json()
    assert next(s for s in r["suggestions"] if s["kind"] == "headline")["status"] == "accepted"
    r = (await customer.post(f"{url}/{sugg['summary']['id']}", json={"action": "skip"})).json()
    for s in r["suggestions"]:
        if s["status"] == "pending":
            r = (await customer.post(f"{url}/{s['id']}", json={"action": "accept"})).json()
    copy = (await db[RESUMES].find_one({"key": t["copy"]["id"]}))["data"]
    assert copy["personal"]["headline"] == sugg["headline"]["after"]
    assert copy["summary"] == before["summary"]  # skipped
    assert copy["proj"][0]["title"] == "Sales Dashboard Revamp"  # most relevant first
    assert copy["skillGroups"][0]["value"].startswith("SQL, Python")  # must-haves first, in the job's order
    bullet = next(s for s in t["suggestions"] if s["kind"] == "bullet" and "power bi" in s["before"])
    assert "Power BI" in bullet["after"] and bullet["after"][0].isupper()
    assert await original(db) == before  # the original never changes
    assert r["scoreNow"] >= r["scoreBefore"]
    # a decided suggestion stays decided
    again = (await customer.post(f"{url}/{sugg['headline']['id']}", json={"action": "skip"})).json()
    assert next(s for s in again["suggestions"] if s["kind"] == "headline")["status"] == "accepted"


async def test_ai_that_invents_facts_is_rejected(customer, db, monkeypatch):
    api = mock_claude(monkeypatch, tailor)
    api.replies = {"claude-haiku-5-5": reply({
        "summary": "Data Analyst with 3 years at Infosys, skilled in Python, SQL and Snowflake, cut costs by 40%.",
        "bullets": [
            {"id": "p1-0", "text": "Built sales dashboards in Power BI and SQL for 12 sponsors at Infosys"},
            {"id": "e0-0", "text": "Made Power BI dashboards for the sales team, adding Tableau and VLOOKUP"},
        ],
    })}  # fmt: skip
    before = await original(db)
    m = await new_match(customer)
    t = (await customer.post(f"/api/me/jobs/matches/{m['id']}/tailor", json={"useAi": True})).json()
    assert len(api.sent) == 1
    for s in t["suggestions"]:
        assert s["source"] == "rules", s  # every invented line was dropped
        assert "Infosys" not in s["after"] and "40" not in s["after"] and "Snowflake" not in s["after"]
    url = f"/api/me/jobs/matches/{m['id']}/suggestions"
    for s in t["suggestions"]:
        await customer.post(f"{url}/{s['id']}", json={"action": "accept"})
    copy = (await db[RESUMES].find_one({"key": t["copy"]["id"]}))["data"]
    text = facts.resume_text(copy)
    assert "Infosys" not in text and "40%" not in text and "Snowflake" not in text
    # every fact of the copy was already on the resume (only the job title is new, in the headline)
    assert set(facts.NUMBER.findall(text)) <= set(facts.NUMBER.findall(facts.resume_text(before)))
    assert await original(db) == before


async def test_honest_ai_lines_are_used(customer, monkeypatch):
    api = mock_claude(monkeypatch, tailor)
    api.replies = {"claude-haiku-5-5": reply({
        "summary": "Data Analyst Intern at Northwind Retail, skilled in Python, SQL and Power BI, with a Google "
                   "Data Analytics Certificate. Looking for a Data Analyst role at Brightpath Analytics.",
        "bullets": [{"id": "p1-0", "text": "Built sales dashboards in Power BI and SQL for the sponsors team"}],
    })}  # fmt: skip
    m = await new_match(customer)
    t = (await customer.post(f"/api/me/jobs/matches/{m['id']}/tailor", json={"useAi": True})).json()
    by = {s["id"]: s for s in t["suggestions"]}
    assert by["summary"]["source"] == "ai"
    assert by["bullet-p1-0"]["source"] == "ai" and by["bullet-p1-0"]["after"].startswith("Built sales dashboards")


async def test_ai_off_gives_rules_suggestions(customer, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    m = await new_match(customer)
    t = (await customer.post(f"/api/me/jobs/matches/{m['id']}/tailor", json={"useAi": True})).json()
    assert t["suggestions"] and all(s["source"] == "rules" for s in t["suggestions"])
    assert "rules" in t["note"]


async def test_too_many_resumes(customer, db):
    for i in range(19):
        await add_resume(customer, key=f"x{i}", active=False)
    m = await new_match(customer)
    r = await customer.post(f"/api/me/jobs/matches/{m['id']}/tailor", json={"useAi": False})
    assert r.status_code == 400 and r.json()["error"]["code"] == "too_many"


async def test_saved_in_my_applications_with_score_and_tailored_copy(customer):
    m = await new_match(customer)
    t = (await customer.post(f"/api/me/jobs/matches/{m['id']}/tailor", json={"useAi": False})).json()
    body = {"id": "a1", "company": m["company"], "role": m["title"], "status": "applied", "matchId": m["id"],
            "score": m["score"], "tailoredResumeId": t["copy"]["id"], "resumeId": t["copy"]["id"]}  # fmt: skip
    r = await customer.post("/api/me/applications", json=body)
    assert r.status_code == 201, r.text
    apps = (await customer.get("/api/me/state")).json()["apps"]
    a = next(x for x in apps if x["id"] == "a1")
    assert a["matchId"] == m["id"] and a["score"] == m["score"] and a["tailoredResumeId"] == t["copy"]["id"]
    r = await customer.patch("/api/me/applications/a1", json={"status": "interview"})
    assert r.json()["status"] == "interview" and r.json()["score"] == m["score"]
