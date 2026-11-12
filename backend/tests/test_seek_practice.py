# ruff: noqa: E501
"""Phase 6 S3: practice tests. Unlimited; answers explained after each question; topic scores; weak topics linked to
free courses; never the official bank; practice never counts as a verified score (the S2 badge and what companies
see read only official checks); erased with the account."""

from app.core.db import PRACTICE_ATTEMPTS, SKILL_QUESTIONS, USERS
from app.hire.skillcheck import ensure_bank
from app.seek import paths
from app.seek.practice_bank import SETS
from tests.conftest import signup


async def _uid(db):
    return (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]


def right_of(qid):
    sid, _, n = qid.rpartition(":")
    return SETS[sid]["questions"][int(n)][3]


async def test_practice_explains_scores_and_links_weak_topics(client, outbox, db, monkeypatch):
    from app.seek import practice

    # a fixed order so all 3 Percentages questions are among the 10 (a random draw may leave 2: too few to call it weak)
    monkeypatch.setattr(practice.random, "shuffle", lambda xs: None)
    await signup(client, outbox)
    d = (await client.get("/api/me/practice")).json()
    ids = {s["id"] for s in d["sets"]}
    assert {
        "aptitude-numbers",
        "aptitude-reasoning",
        "english-grammar",
        "english-email",
        "coding-basics",
        "role-SQL",
    } <= ids
    assert d["topics"] == [] and d["weak"] == [] and "never counts" in d["note"]
    t = (await client.post("/api/me/practice/start", json={"set": "aptitude-numbers"})).json()
    assert len(t["questions"]) == 10 and all("answer" not in q and "why" not in q for q in t["questions"])
    # every answer wrong: explained each time
    for q in t["questions"]:
        wrong = (right_of(q["id"]) + 1) % len(q["options"])
        r = (await client.post(f"/api/me/practice/{t['id']}/answer", json={"q": q["id"], "choice": wrong})).json()
        assert r["right"] is False and r["answer"] == right_of(q["id"]) and r["why"] and r["counted"]
    # a second try shows the explanation but doesn't change the score
    q0 = t["questions"][0]
    r = (
        await client.post(f"/api/me/practice/{t['id']}/answer", json={"q": q0["id"], "choice": right_of(q0["id"])})
    ).json()
    assert r["right"] and not r["counted"]
    f = (await client.post(f"/api/me/practice/{t['id']}/finish")).json()
    assert f["right"] == 0 and f["total"] == 10 and f["verified"] is False
    weak = {w["topic"]: w for w in f["weak"]}
    assert "Percentages" in weak and weak["Percentages"]["pct"] == 0
    assert weak["Percentages"]["courses"] and weak["Percentages"]["courses"][0]["provider"] == "Khan Academy"
    # unlimited: start again any time; a question from another test is refused
    t2 = (await client.post("/api/me/practice/start", json={"set": "coding-basics"})).json()
    assert t2["questions"][0]["code"] is True
    assert (
        await client.post(f"/api/me/practice/{t2['id']}/answer", json={"q": q0["id"], "choice": 0})
    ).status_code == 404
    assert (await client.post("/api/me/practice/start", json={"set": "nope"})).status_code == 404
    o = (await client.get("/api/me/practice")).json()
    assert o["tests"] == 1 and any(x["topic"] == "Percentages" for x in o["topics"])


async def test_practice_never_counts_as_verified(client, outbox, db):
    await signup(client, outbox)
    uid = await _uid(db)
    await client.post("/api/me/learn/data-analyst/start")
    await client.post("/api/me/learn/data-analyst/project", json={"link": "https://docs.google.com/x"})
    t = (await client.post("/api/me/practice/start", json={"set": "role-SQL"})).json()
    for q in t["questions"]:  # all right
        await client.post(f"/api/me/practice/{t['id']}/answer", json={"q": q["id"], "choice": right_of(q["id"])})
    assert (await client.post(f"/api/me/practice/{t['id']}/finish")).json()["right"] == len(t["questions"])
    await paths.on_skill_check(db, uid, "SQL")
    d = (await client.get("/api/me/learn/data-analyst")).json()
    assert d["verified"] is None and d["test"]["best"] is None
    assert not (await db[USERS].find_one({"_id": uid})).get("verified_skills")
    sk = (await client.get("/api/me/skill-checks")).json()
    assert all(s["last"] is None for s in sk["skills"])


async def test_practice_questions_are_not_the_official_bank(db):
    await ensure_bank(db)
    official = {q["question"].strip().lower() async for q in db[SKILL_QUESTIONS].find({}, {"question": 1})}
    mine = {q[1].strip().lower() for s in SETS.values() for q in s["questions"]}
    assert official and not (official & mine)


async def test_erased_with_the_account(client, outbox, db):
    from app.me.erase import erase_account

    await signup(client, outbox)
    uid = await _uid(db)
    await client.post("/api/me/practice/start", json={"set": "english-grammar"})
    await erase_account(db, uid)
    assert await db[PRACTICE_ATTEMPTS].count_documents({"user_id": uid}) == 0
