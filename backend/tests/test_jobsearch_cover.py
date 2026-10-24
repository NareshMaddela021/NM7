"""Cover letter + cold message from a job match (Phase 2): lengths and tones, the person's own proofs, [Hiring
Manager] with a reminder, the cold message under 300 characters, 1 free a day (unlimited with the Tailor pack), an
AI letter that invents facts is rejected, AI off still writes a letter, saved with the job and deleted with it."""

import pytest

from app.core.config import get_settings
from app.core.db import JOB_MATCHES
from app.jobsearch import cover, facts
from app.jobsearch.parse import parse
from tests.conftest import signup
from tests.jobs_helpers import POSTS, add_resume, mock_claude, reply, resume

DA = POSTS["01_data_analyst_fresher"]


@pytest.fixture
async def customer(client, outbox):
    await signup(client, outbox)
    await add_resume(client)
    return client


async def grant(admin_client, c):
    owner = await admin_client("owner")
    uid = (await c.get("/api/auth/me")).json()["id"]
    await owner.post(f"/api/admin/customers/{uid}/job-pack", json={"feature": "tailor", "granted": True})


async def new_match(c):
    r = await c.post("/api/me/jobs/match", json={"resumeId": "r1", "text": DA})
    assert r.status_code == 201, r.text
    return r.json()


def test_rules_letters_use_only_the_resume():
    p = parse(DA)
    data = resume()
    res = facts.resume_text(data)
    for length in cover.LENGTHS:
        for tone in cover.TONES:
            w = cover.write(p, data, length, tone, "")
            text = "\n".join(w["paragraphs"])
            assert facts.ok(text, res, allowed=f"{p.title} {p.company} {p.location}"), (
                length,
                tone,
                facts.problems(text, res, f"{p.title} {p.company}"),
            )  # noqa: E501
            assert w["greeting"] == "Dear [Hiring Manager]," and "Replace [Hiring Manager]" in w["reminder"]
            assert len(w["cold"]) <= 300 and "Data Analyst" in w["cold"]
            assert w["subject"] == "Application for Data Analyst - Sai Varsha"
            assert w["paragraphs"][0].startswith(
                "I am writing to apply for the Data Analyst role at Brightpath Analytics"
            )
    short = cover.write(p, data, "short", "fresher", "")
    standard = cover.write(p, data, "standard", "fresher", "")
    assert short["words"] < standard["words"] and short["words"] <= 120
    assert cover.write(p, data, "formal", "fresher", "")["close"] == "Yours faithfully,"
    assert "career break" in cover.write(p, data, "standard", "returning", "")["paragraphs"][0]
    named = cover.write(p, data, "standard", "experienced", "Priya Menon")
    assert named["greeting"] == "Dear Priya Menon," and named["reminder"] == "" and named["cold"].startswith("Hi Priya")
    # the proofs are the person's own lines, and the page can highlight them
    assert "Cleaned CSV files in Python every week" in standard["used"]


async def test_write_from_the_match_screen_and_saved_with_the_job(customer, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    m = await new_match(customer)
    r = await customer.post(f"/api/me/jobs/matches/{m['id']}/cover", json={"length": "standard", "tone": "fresher"})
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["source"] == "rules" and c["email"].startswith("Dear [Hiring Manager],") and c["resumeId"] == "r1"
    assert "templates" in c["note"]
    saved = (await customer.get(f"/api/me/jobs/matches/{m['id']}")).json()["covers"]
    assert [x["id"] for x in saved] == [c["id"]]
    assert (await customer.delete(f"/api/me/jobs/matches/{m['id']}/cover/{c['id']}")).status_code == 204
    assert (await customer.get(f"/api/me/jobs/matches/{m['id']}")).json()["covers"] == []


async def test_one_free_letter_a_day_then_the_tailor_pack(customer, admin_client):
    m = await new_match(customer)
    url = f"/api/me/jobs/matches/{m['id']}/cover"
    assert (await customer.post(url, json={"useAi": False})).status_code == 201
    r = await customer.post(url, json={"useAi": False})
    assert r.status_code == 402 and r.json()["error"]["code"] == "free_limit"
    assert (await customer.get("/api/me/jobs/access")).json()["free"]["coversLeft"] == 0
    await grant(admin_client, customer)
    for _ in range(2):
        assert (await customer.post(url, json={"useAi": False})).status_code == 201


async def test_ai_letter_that_invents_facts_is_rejected(customer, monkeypatch):
    api = mock_claude(monkeypatch, cover)
    bad = ["I am applying for the Data Analyst role at Brightpath Analytics.",
           "At Infosys I led a team of 12 and cut costs by 40% using Snowflake and Tableau.",
           "I would love to talk. Thank you."] * 8  # fmt: skip
    api.replies = {"claude-haiku-5-5": reply({"paragraphs": bad, "subject": "Application - 10 years at Infosys",
                                              "cold": "Hi, I led 12 people at Infosys."})}  # fmt: skip
    m = await new_match(customer)
    c = (await customer.post(f"/api/me/jobs/matches/{m['id']}/cover", json={"length": "standard"})).json()
    assert len(api.sent) == 1
    assert c["source"] == "rules" and "templates" in c["note"]
    for field in (c["email"], c["subject"], c["cold"]):
        assert "Infosys" not in field and "40%" not in field and "Snowflake" not in field


async def test_honest_ai_letter_is_used(customer, monkeypatch, admin_client):
    await grant(admin_client, customer)
    api = mock_claude(monkeypatch, cover)
    good = [
        "I am writing to apply for the Data Analyst role at Brightpath Analytics, where I can use my love of data.",
        "As a Data Analyst Intern at Northwind Retail, I made dashboards in Power BI for the sales team and cleaned "
        "CSV files in Python every week. I also built the Sales Dashboard Revamp project with Power BI, SQL and Excel, "
        "and I hold the Google Data Analytics Certificate from Google.",
        "Your post asks for SQL, Excel and Python. I have used each of them in real work: Python to clean data files "
        "every week, SQL and Excel in my dashboard project, and Power BI to turn the numbers into clear charts that a "
        "sales team could read at a glance. I studied B.Tech in Computer Science at Lakeview Institute of Technology, "
        "and I enjoy turning messy data into answers that people can act on.",
        "I would be glad to talk about how I can help Brightpath Analytics. Thank you for your time and consideration.",
    ]
    cold = "Hi, I'm Sai, a Data Analyst Intern at Northwind Retail. Could I share my resume for the Data Analyst role?"
    subject = "Application for Data Analyst - Sai Varsha"
    api.replies = {"claude-haiku-5-5": reply({"paragraphs": good, "subject": subject, "cold": cold})}
    m = await new_match(customer)
    c = (await customer.post(f"/api/me/jobs/matches/{m['id']}/cover", json={"length": "short"})).json()
    assert c["source"] == "rules"  # too long for a short email: the rules letter instead
    c = (await customer.post(f"/api/me/jobs/matches/{m['id']}/cover", json={"length": "standard"})).json()
    assert c["source"] == "ai", c
    assert c["paragraphs"] == good and c["cold"].startswith("Hi, I'm Sai")


def test_everyday_words_are_not_skills():
    # "turning messy data into answers" and "clear charts" in a letter are not Lathe or "Charts and graphs"
    text = "I enjoy turning messy data into clear charts that a team can read at a glance."
    assert facts.problems(text, facts.resume_text(resume()), "") == []


async def test_delete_all_removes_letters(customer, db):
    m = await new_match(customer)
    await customer.post(f"/api/me/jobs/matches/{m['id']}/cover", json={"useAi": False})
    await customer.delete("/api/me/jobs")
    assert await db[JOB_MATCHES].count_documents({}) == 0


async def test_letters_are_private(customer, make_client, outbox):
    m = await new_match(customer)
    other = make_client()
    await signup(other, outbox, email="o2@example.com")
    assert (await other.post(f"/api/me/jobs/matches/{m['id']}/cover", json={})).status_code == 404
