"""Interview prep pack + practice (Phase 3): 10 questions (about you 3, own projects 3, must-have skills 3, one STAR
situation question) answered from the resume only, intro in 60 s and 2 min, honest weak-spot answers, 5 questions to
ask, homework; free = the first 3 questions; the Interview pack (admin grant) unlocks the rest; AI answers that invent
facts or claim a missing skill are rejected; practice feedback (structure, result, length, filler words, a better
version) and saved progress; AI off still works; deleted with the job-search data."""

import pytest

from app.core.config import get_settings
from app.core.db import JOB_MATCHES
from app.jobsearch import facts, interview
from app.jobsearch.parse import parse
from tests.conftest import signup
from tests.jobs_helpers import POSTS, add_resume, mock_claude, reply, resume

DA = POSTS["01_data_analyst_fresher"]


@pytest.fixture
async def customer(client, outbox):
    await signup(client, outbox)
    await add_resume(client)
    return client


async def grant(admin_client, c, feature="interview"):
    owner = await admin_client("owner")
    uid = (await c.get("/api/auth/me")).json()["id"]
    r = await owner.post(f"/api/admin/customers/{uid}/job-pack", json={"feature": feature, "granted": True})
    assert r.status_code < 300, r.text


async def new_match(c):
    r = await c.post("/api/me/jobs/match", json={"resumeId": "r1", "text": DA})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.parametrize("name", sorted(POSTS))
def test_pack_on_every_sample_post_uses_only_the_resume(name):
    p = parse(POSTS[name])
    data = resume()
    pack = interview.rules_pack(p, data)
    qs = pack["questions"]
    assert [q["id"] for q in qs] == [f"q{i}" for i in range(1, 11)]
    assert [q["group"] for q in qs] == ["about"] * 3 + ["project"] * 3 + ["skill"] * 3 + ["hr"]
    for q in qs:
        assert q["answer"] and q["tips"]
        assert interview._honest(q["answer"], q, p, data), (
            q["id"],
            facts.problems(q["answer"], facts.resume_text(data), p.title),
        )
    assert set(qs[9]["star"]) == {"situation", "task", "action", "result"}
    for k in ("sec60", "min2"):
        assert facts.ok(pack["intro"][k], facts.resume_text(data), f"{p.title} {p.company} {p.location}")
    assert len(pack["intro"]["min2"].split()) > len(pack["intro"]["sec60"].split())
    assert len(pack["ask"]) == 5 and len(pack["homework"]) >= 6
    assert pack["weak"][-1]["q"] == "What is your biggest weakness?"


def test_missing_skill_answers_are_honest():
    p = parse(DA)
    pack = interview.rules_pack(p, resume())
    by = {q["q"]: q for q in pack["questions"]}
    pivot = by["How have you used Pivot tables?"]
    assert pivot["missing"] == "Pivot tables" and pivot["answer"].startswith("I haven't used Pivot tables")
    assert by["How have you used SQL?"]["answer"].startswith("I have used SQL. In my project Sales Dashboard Revamp")
    assert any("Pivot tables" in w["q"] for w in pack["weak"])
    # STAR from the person's own work bullet, with [gaps] instead of an invented result
    star = pack["questions"][9]["star"]
    assert star["situation"].startswith("When I was Data Analyst Intern at Northwind Retail")
    assert star["result"] == interview.RESULT_GAP


def test_ai_answers_are_fact_checked_one_by_one():
    p = parse(DA)
    data = resume()
    good = ("I built the Sales Dashboard Revamp project with Power BI, SQL and Excel. It gave the college fest's "
            "sponsor team dashboards they could read at a glance. My part was the data and the charts. "
            "[Add how it turned out.]")  # fmt: skip
    honest = (
        "I haven't used Pivot tables in a job or project yet. I have used SQL and Excel in my dashboard "
        "project, so I'm comfortable with data in tables, and I'd be glad to learn Pivot tables quickly."
    )
    claims = ("I have used Pivot tables every day as a Data Analyst Intern at Northwind Retail to summarise sales "
              "for the team, and I can build them quickly in Excel whenever the business needs it.")  # fmt: skip
    invents = ("At Infosys I led a team of 12 and cut the reporting time by 40% using Snowflake, which taught me how "
               "to work under pressure and deliver results for big clients every single week.")  # fmt: skip
    ai = {"answers": {"q4": {"answer": good, "tips": []}, "q9": {"answer": honest, "tips": []},
                      "q5": {"answer": invents, "tips": []}}, "sec60": "", "min2": ""}  # fmt: skip
    pack = interview.build(p, data, ai)
    by = {q["id"]: q for q in pack["questions"]}
    assert by["q4"]["source"] == "ai" and by["q4"]["answer"] == good
    assert by["q9"]["source"] == "ai" and by["q9"]["answer"] == honest
    assert by["q5"]["source"] == "rules" and "Infosys" not in by["q5"]["answer"]
    assert pack["rejected"] == 1 and pack["source"] == "ai"
    ai["answers"] = {"q9": {"answer": claims, "tips": []}}
    pack = interview.build(p, data, ai)
    assert pack["questions"][8]["source"] == "rules" and pack["rejected"] == 1  # claiming a missing skill


def test_numbers_are_whole_numbers():
    # "5 years" is not backed by the "2025" in a date, and "20 people" isn't either
    res = facts.resume_text(resume())
    assert facts.problems("I have 5 years of experience and led 20 people.", res) == ["the number 5", "the number 20"]
    assert facts.ok("My CGPA was 8.2 and I finished in 2025.", res)


def test_practice_feedback_rules():
    p = parse(DA)
    data = resume()
    qs = interview.questions(p, data)
    fb = interview.feedback(qs[9], "Um so basically when I was an intern, like, I had to clean files, and I cleaned "
                                   "CSV files in Python every week, you know.", data)  # fmt: skip
    assert fb["star"] == {"situation": True, "task": True, "action": True, "result": False}
    assert "Missing: result" in fb["structure"] and "No result or number" in fb["result"]
    assert fb["fillers"] == {"um": 1, "like": 1, "basically": 1, "you know": 1} and "4 filler words" in fb["filler"]
    assert "a bit short" in fb["length"]
    assert "um" not in fb["better"].lower().split() and "basically" not in fb["better"]
    assert fb["better"].endswith(interview.RESULT_GAP)
    long = interview.feedback(qs[0], " ".join(["I made dashboards in Power BI for the sales team."] * 30), data)
    assert "a bit long" in long["length"] and long["fillers"] == {}


async def test_free_gets_three_questions_then_the_pack_unlocks(customer, admin_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    m = await new_match(customer)
    url = f"/api/me/jobs/matches/{m['id']}/interview"
    assert (await customer.get(url)).status_code == 404
    r = await customer.post(url, json={})
    assert r.status_code == 201, r.text
    v = r.json()
    assert not v["unlocked"] and len(v["questions"]) == 3 and len(v["locked"]) == 7
    assert v["weak"] is None and v["ask"] is None and v["homework"] is None and set(v["intro"]) == {"sec60"}
    assert "templates" in v["note"] and v["source"] == "rules"
    # the match itself never carries the locked parts
    full = (await customer.get(f"/api/me/jobs/matches/{m['id']}")).json()
    assert full["interview"] == {"practised": 0, "total": 10}
    # practise a free question; a locked one is refused
    r = await customer.post(f"{url}/practice", json={"qid": "q1", "answer": "I'm Sai. I made dashboards in Power BI."})
    assert r.status_code == 200 and r.json()["progress"] == {"done": 1, "total": 3, "of": 10}
    r = await customer.post(f"{url}/practice", json={"qid": "q4", "answer": "I built it."})
    assert r.status_code == 402 and r.json()["error"]["code"] == "interview_locked"
    # the Interview pack (an admin grant here) unlocks everything; progress is kept
    await grant(admin_client, customer)
    v = (await customer.get(url)).json()
    assert v["unlocked"] and len(v["questions"]) == 10 and v["locked"] == []
    assert v["weak"] and len(v["ask"]) == 5 and v["homework"] and v["intro"]["min2"]
    assert v["questions"][0]["practised"]["answer"].startswith("I'm Sai")
    said = "When I was an intern I had to finish a report and I cleaned CSV files in Python, so it was on time."
    r = await customer.post(f"{url}/practice", json={"qid": "q10", "answer": said})
    assert r.json()["progress"] == {"done": 2, "total": 10, "of": 10}
    # remaking the pack keeps the practice
    v = (await customer.post(url, json={"useAi": False})).json()
    assert v["progress"]["done"] == 2
    assert (await customer.get(f"/api/me/jobs/matches/{m['id']}")).json()["interview"]["practised"] == 2


async def test_the_tailor_pack_does_not_unlock_interview(customer, admin_client):
    await grant(admin_client, customer, "tailor")
    m = await new_match(customer)
    v = (await customer.post(f"/api/me/jobs/matches/{m['id']}/interview", json={"useAi": False})).json()
    assert not v["unlocked"] and len(v["questions"]) == 3


async def test_ai_pack_and_feedback_with_the_fact_check(customer, admin_client, monkeypatch):
    await grant(admin_client, customer)
    api = mock_claude(monkeypatch, interview)
    good = ("I'm Sai Varsha. I studied B.Tech in Computer Science, and as a Data Analyst Intern at Northwind Retail I "
            "made dashboards in Power BI for the sales team and cleaned CSV files in Python every week.")  # fmt: skip
    made_up = "I worked at Wipro for 5 years and led 20 people, so I know analytics well. " * 2
    answers = [{"id": "q1", "answer": good, "tips": ["Smile."]}, {"id": "q2", "answer": made_up}]
    api.replies = {"claude-haiku-5-5": reply({"answers": answers})}
    m = await new_match(customer)
    url = f"/api/me/jobs/matches/{m['id']}/interview"
    v = (await customer.post(url, json={})).json()
    assert len(api.sent) == 1
    assert v["questions"][0]["answer"] == good and v["questions"][0]["source"] == "ai"
    assert "Wipro" not in v["questions"][1]["answer"] and v["questions"][1]["source"] == "rules"
    # practice: an AI "better version" that adds a number the person never said is dropped
    better = "I cleaned CSV files in Python and saved 10 hours a week."
    api.replies = {"claude-haiku-5-5": reply({"structure": "Good.", "result": "Add a number.", "better": better})}
    r = (await customer.post(f"{url}/practice", json={"qid": "q5", "answer": "I cleaned CSV files in Python."})).json()
    assert r["feedback"]["source"] == "rules" and "10 hours" not in r["feedback"]["better"]
    api.replies = {"claude-haiku-5-5": reply({"structure": "Clear.", "result": "Add the result.",
                                              "better": "As a Data Analyst Intern at Northwind Retail, I cleaned CSV "
                                                        "files in Python every week. [Add the result.]"})}  # fmt: skip
    r = (await customer.post(f"{url}/practice", json={"qid": "q5", "answer": "I cleaned CSV files in Python."})).json()
    assert r["feedback"]["source"] == "ai" and r["feedback"]["structure"] == "Clear."
    assert r["progress"]["done"] == 1  # the same question twice counts once


async def test_deleted_with_job_search_data(customer, db):
    m = await new_match(customer)
    await customer.post(f"/api/me/jobs/matches/{m['id']}/interview", json={"useAi": False})
    await customer.post(
        f"/api/me/jobs/matches/{m['id']}/interview/practice", json={"qid": "q1", "answer": "Hi.", "useAi": False}
    )
    assert (await customer.delete("/api/me/jobs")).status_code == 204
    assert await db[JOB_MATCHES].count_documents({}) == 0


async def test_private(customer, make_client, outbox):
    m = await new_match(customer)
    await customer.post(f"/api/me/jobs/matches/{m['id']}/interview", json={"useAi": False})
    other = make_client()
    await signup(other, outbox, email="o3@example.com")
    assert (await other.get(f"/api/me/jobs/matches/{m['id']}/interview")).status_code == 404
