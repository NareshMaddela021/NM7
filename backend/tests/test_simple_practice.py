"""Re-test 12 Nov, N1: the easy dashboard's practice interview gives the same "clarity" feedback as the full practice
mode after each answer (length, filler words, structure, a missing result or number, a better version from their own
answer and resume), and practising counts for the readiness item "Practise an interview"."""

from app.simple.practice import coach
from tests.conftest import signup
from tests.jobs_helpers import add_resume, strong_resume

URL = "/api/me/simple/practice"


async def test_feedback_after_each_answer_and_readiness(client, outbox):
    await signup(client, outbox, email="ravi@example.com", name="Ravi Kumar")
    await add_resume(client, data=strong_resume())
    before = (await client.get("/api/me/simple/readiness")).json()
    interview = next(p for p in before["parts"] if p["key"] == "interview")
    assert interview["got"] == 0
    r = await client.post(URL, json={"q": "q3", "answer": "Um, I like, basically made a dashboard in Power BI."})
    assert r.status_code == 200, r.text
    fb = r.json()["feedback"]
    assert fb["kind"] == "clarity" and "filler" in fb["filler"]
    assert "Missing: " in fb["structure"] and "result" in fb["structure"]  # STAR: no result yet
    assert "Um" not in fb["better"] and "basically" not in fb["better"]
    assert "saving 4 hours a week" in fb["better"].lower() or "12 store managers" in fb["better"]  # their own result
    assert r.json()["done"] == 1
    for q in ("q1", "q2", "q4"):
        r = await client.post(URL, json={"q": q, "answer": "I am a fresher who likes data work."})
        assert r.status_code == 200
    after = (await client.get("/api/me/simple/readiness")).json()
    interview = next(p for p in after["parts"] if p["key"] == "interview")
    assert interview["done"] is True and "interview" not in [x["key"] for x in after["left"]]
    assert after["score"] > before["score"]
    assert (await client.post(URL, json={"q": "q9", "answer": "x"})).status_code == 422


def test_intro_better_version_uses_the_resume_only():
    d = strong_resume(personal={"name": "Ravi Kumar"})
    fb = coach("q1", "Hello, I am a fresher.", d)
    assert fb["better"].startswith("Hello, I am a fresher.")
    assert "My name is Ravi Kumar." in fb["better"] and "Some of that is missing" in fb["structure"]
    assert "[" not in fb["better"]  # nothing made up, no gaps
    fb5 = coach("q5", "What will I learn in the first month?", d)
    assert fb5["structure"].startswith("Good") and fb5["result"] == ""
