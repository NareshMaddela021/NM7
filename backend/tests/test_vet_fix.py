# ruff: noqa: E501
"""Vetting fix batch (owner's end-to-end test before switching vetting on):

1. Both demo resets ("Reset and open as company" and "Hire in 60 minutes") give some of the made-up people who are
   ready to join a real "Skill verified" (L2) badge for the demo jobs (Customer Support Executive, Junior Data Analyst,
   Software Engineer Trainee), stored exactly as the real flow stores it, so Hire now shows the badges and the
   "Skill verified only" filter finds people. Still one insert per collection.
2. Typing speed on written practical tasks and the speed of the whole test, checked on the server against the time it
   saw: one impossible-speed signal alone is Watch with a plain reason; Needs retest only with another signal (a
   paste, text that appeared without key presses); never a rejection.
"""

from datetime import timedelta

import pytest
from bson import ObjectId

from app.companies import demo as company_demo
from app.core.db import SKILL_ATTEMPTS, USERS, VETTING_VERIFIED
from app.hire.vetting import engine as E
from app.hire.vetting import grade
from tests.test_companies_signup import H, no_network  # noqa: F401
from tests.test_vetting import ANSWER, URL, _paper, _right, _slow, student


@pytest.fixture(autouse=True)
def vetting_public(monkeypatch):
    from app.hire.vetting import access

    async def public(db):
        return {"public": True, "testers": []}

    monkeypatch.setattr(access, "settings", public)


# --- 1. demo badges ---------------------------------------------------------------------------------------------


async def _verified_rows(client, session, job):
    r = await client.get(f"/api/company/{company_demo.COMPANY_ID}/hire/shortlist",
                         params={"job": job, "size": 50, "verified": True}, headers=H(session))  # fmt: skip
    assert r.status_code == 200, r.text
    return r.json()["items"]


async def test_hire_demo_people_hold_real_skill_verified_badges(client, db, admin_client):
    owner = await admin_client()
    r = (await owner.post("/api/admin/demo-company/hire/open")).json()
    assert r["candidates"] == 30
    recs = await db[VETTING_VERIFIED].find({"user_id": {"$regex": "^hire-demo-"}}).to_list(50)
    assert len(recs) == 8
    # the same fields router.award writes, and the same entry on the person
    for v in recs:
        assert {"user_id", "test", "slug", "role", "band", "score", "task_score", "at", "expires_at"} <= set(v)
        assert (
            v["score"] >= E.PASS_MCQ and v["task_score"] >= E.PASS_TASK and not E.is_expired(v["expires_at"], v["at"])
        )
        u = await db[USERS].find_one({"_id": v["user_id"]})
        assert [s["skill"] for s in u["verified_skills"]] == [v["test"]] and u["verified_skills"][0]["source"] == "v2"
        assert u["vetting"]["level"] == 2
    assert {v["test"] for v in recs} == {"Customer support", "SQL", "Java"}
    # Hire now: the bulk post (Customer Support Executive) with "Skill verified only"
    rows = await _verified_rows(client, r["session"], r["bulkJob"])
    assert all(x["skillVerified"] and not x["skillVerified"]["expired"] for x in rows)
    mine = [x for x in rows if x["skillVerified"]["test"] == "Customer support"]
    assert len(mine) >= 3
    for row in mine:
        sv = row["skillVerified"]
        assert sv["role"] and sv["bandLabel"] and sv["score"] >= 70 and sv["taskStars"] and sv["forThisJob"]
        assert row["level"]["level"] == 2
    # ranked first without the filter too
    every = (await client.get(f"/api/company/{company_demo.COMPANY_ID}/hire/shortlist",
                              params={"job": r["bulkJob"], "size": 50}, headers=H(r["session"]))).json()["items"]  # fmt: skip
    assert every[0]["skillVerified"] and len(every) > len(rows)
    # a second reset is a clean copy
    await owner.post("/api/admin/demo-company/hire/open")
    assert await db[VETTING_VERIFIED].count_documents({"user_id": {"$regex": "^hire-demo-"}}) == 8


async def test_plain_demo_reset_has_skill_verified_people_for_its_jobs(client, db, admin_client):
    owner = await admin_client()
    r = (await owner.post("/api/admin/demo-company/open")).json()
    assert r["candidates"] == 30
    live = {
        j["title"]: j["_id"]
        for j in await db["jobs"].find({"company_id": company_demo.COMPANY_ID, "status": "active"}).to_list(20)
    }
    assert {"Junior Data Analyst", "Software Engineer Trainee"} <= set(live)
    for title, test in (("Junior Data Analyst", "SQL"), ("Software Engineer Trainee", "Java")):
        rows = await _verified_rows(client, r["session"], live[title])
        mine = [x for x in rows if x["skillVerified"]["test"] == test]
        assert len(mine) >= 2 and all(x["skillVerified"]["forThisJob"] for x in mine), (title, rows)


async def test_hire_demo_badges_add_no_per_person_writes(db, monkeypatch):
    from pymongo.asynchronous.collection import AsyncCollection

    from app.hire import demo as hire_demo

    calls = {"one": 0, "many": 0}
    real_one, real_many = AsyncCollection.insert_one, AsyncCollection.insert_many

    async def one(self, *a, **kw):
        calls["one"] += 1
        return await real_one(self, *a, **kw)

    async def many(self, *a, **kw):
        calls["many"] += 1
        return await real_many(self, *a, **kw)

    from app.hire.skillcheck import ensure_bank

    await ensure_bank(db)
    monkeypatch.setattr(AsyncCollection, "insert_one", one)
    monkeypatch.setattr(AsyncCollection, "insert_many", many)
    await hire_demo.seed_people(db)
    assert calls["one"] == 0 and calls["many"] <= 6, calls


# --- 2. typing speed and impossible speed ------------------------------------------------------------------------

OWN = " ".join(
    f"Step {i}: I would note detail number {i * 7} for the report and check it twice with the team lead."
    for i in range(40)
)
LONG = " ".join(
    ["I would greet the customer, listen to the full problem, check the order and explain the fix."] * 40
)  # ~3,700 characters


def test_typing_check_is_fair():
    # 3,700 characters 20 seconds after the task opened: faster than anyone types
    fast = E.typing_check(chars=3700, pasted=0, elapsed_s=20, keys=3700, first_key_ms=2000, typing_ms=18_000)
    assert fast["impossible"] and fast["cps"] > 100
    # the same answer over 12 minutes: fine
    ok = E.typing_check(chars=3700, pasted=0, elapsed_s=720, keys=3900, first_key_ms=60_000, typing_ms=600_000)
    assert not ok["impossible"] and not ok["untyped"]
    # a short answer is never judged on speed
    assert not E.typing_check(chars=250, pasted=0, elapsed_s=2, keys=0, first_key_ms=None, typing_ms=0)["impossible"]
    # text that appeared with almost no key presses and no paste (an old page that sends no counts: not judged)
    assert E.typing_check(chars=3700, pasted=0, elapsed_s=900, keys=12, first_key_ms=5000, typing_ms=4000)["untyped"]
    assert not E.typing_check(chars=3700, pasted=0, elapsed_s=900, keys=None, first_key_ms=None, typing_ms=None)[
        "untyped"
    ]
    # reading first, then typing: the speed is measured from the first key press
    late = E.typing_check(chars=3000, pasted=0, elapsed_s=400, keys=3100, first_key_ms=380_000, typing_ms=20_000)
    assert late["impossible"]


def test_one_impossible_speed_signal_is_watch_two_signals_needs_retest():
    alone = E.integrity({"typingImpossible": True})
    assert alone["level"] == "watch" and alone["reasons"] == ["typing_speed"]
    assert E.POINTS["typing_speed"].startswith("The written answer arrived faster")
    with_paste = E.integrity({"typingImpossible": True, "pastedChars": 3000, "taskChars": 3700})
    assert with_paste["level"] == "retest" and set(with_paste["reasons"]) == {"typing_speed", "paste"}
    untyped = E.integrity({"typingImpossible": True, "untypedText": True})
    assert untyped["level"] == "retest"
    # each weaker signal alone stays clean
    assert E.integrity({"untypedText": True})["level"] == "clean"
    assert E.integrity({"pastedChars": 3000, "taskChars": 3700})["level"] == "clean"
    # the whole test faster than it can be read (server clock): Watch alone
    assert E.integrity({"fastPaper": True})["level"] == "watch"
    assert E.integrity({"fastPaper": True, "fastAnswers": 9})["points"] == 3  # one signal, counted once
    # plain explanations with the numbers
    lines = E.explain(
        {"typingImpossible": True, "taskChars": 3700, "taskSeconds": 20, "cps": 185.0, "firstKeyMs": 2000}
    )
    assert any("3,700 characters" in x and "20 seconds" in x for x in lines)


def _fake_grade(monkeypatch):
    async def fake(db_, uid, role, task, rubric, answer, speech=None):
        return {
            "scores": [{"key": c["key"], "score": 4, "reason": "Clear."} for c in rubric],
            "confidence": "high",
            "model": "m",
        }

    monkeypatch.setattr(grade, "grade_text", fake)


async def _passed(c, db, skill="SQL", band="1-3"):
    """A passed test taken over a fair time (the server's clock), so only the task's own signals count."""
    await c.post(f"{URL}/consent")
    p = (await _paper(c, skill=skill, band=band)).json()
    await db[SKILL_ATTEMPTS].update_one(
        {"_id": ObjectId(p["id"])}, {"$set": {"started_at": E_now() - timedelta(minutes=10)}}
    )
    r = (await c.post(f"{URL}/{p['id']}/submit", json={"answers": await _right(db, p), "times": _slow(p)})).json()
    assert r["pass"] and not r["retest"]
    return p["id"]


async def _started_ago(db, aid, seconds):
    await db[SKILL_ATTEMPTS].update_one(
        {"_id": ObjectId(aid)}, {"$set": {"task.started_at": E_now() - timedelta(seconds=seconds)}}
    )


def E_now():
    from app.core.time import now

    return now()


async def test_task_typed_in_seconds_is_watch_and_with_a_paste_needs_retest(
    outbox, db, make_client, admin_client, monkeypatch
):
    _fake_grade(monkeypatch)
    c = await student(make_client, outbox, "tara@example.com", "Tara V")
    aid = await _passed(c, db)
    await c.post(f"{URL}/{aid}/task/start")
    # ~600 words a few seconds after the task opened, typed (key presses counted): Watch, the badge still comes
    r = (
        await c.post(
            f"{URL}/{aid}/task/submit", json={"text": LONG, "keys": 3800, "firstKeyMs": 1500, "typingMs": 4000}
        )
    ).json()
    a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(aid)})
    assert a["integrity"]["level"] == "watch" and a["integrity"]["reasons"] == ["typing_speed"]
    assert a["signals"]["taskSeconds"] < 30 and a["signals"]["keys"] == 3800 and a["signals"]["firstKeyMs"] == 1500
    assert any("characters" in x for x in a["integrity"]["explain"])
    assert r["verified"] and r["integrityNote"] != "Nothing unusual was noticed."
    assert "typing" not in str(r).lower()  # the candidate never sees the flags
    # pasted and impossibly fast: Needs retest (a free retest, never a rejection), no badge for this attempt
    c2 = await student(make_client, outbox, "omar@example.com", "Omar K")
    aid2 = await _passed(c2, db)
    await c2.post(f"{URL}/{aid2}/task/start")
    r2 = (
        await c2.post(
            f"{URL}/{aid2}/task/submit",
            json={"text": LONG, "pastedChars": len(LONG), "keys": 2, "firstKeyMs": 900, "typingMs": 0},
        )
    ).json()
    a2 = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(aid2)})
    assert a2["integrity"]["level"] == "retest" and {"typing_speed", "paste"} <= set(a2["integrity"]["reasons"])
    assert r2["verified"] is None and r2["freeRetest"]
    # an honest answer written over 15 minutes is clean
    c3 = await student(make_client, outbox, "lata@example.com", "Lata P")
    aid3 = await _passed(c3, db)
    await c3.post(f"{URL}/{aid3}/task/start")
    await _started_ago(db, aid3, 900)
    r3 = (
        await c3.post(
            f"{URL}/{aid3}/task/submit", json={"text": OWN, "keys": 3900, "firstKeyMs": 40_000, "typingMs": 700_000}
        )
    ).json()
    a3 = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(aid3)})
    assert (
        a3["integrity"]["level"] == "clean" and r3["integrityNote"] == "Nothing unusual was noticed." and r3["verified"]
    )
    # the short answers the other tests send are never judged on speed
    c4 = await student(make_client, outbox, "noor@example.com", "Noor A")
    aid4 = await _passed(c4, db)
    await c4.post(f"{URL}/{aid4}/task/start")
    await c4.post(f"{URL}/{aid4}/task/submit", json={"text": ANSWER})
    assert (await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(aid4)}))["integrity"]["level"] == "clean"


async def test_whole_test_faster_than_reading_on_the_server_clock(outbox, db, make_client):
    c = await student(make_client, outbox, "ira@example.com", "Ira M")
    await c.post(f"{URL}/consent")
    p = (await _paper(c)).json()
    # the page claims 20 s per question, but the server saw the whole paper answered within a second or two
    times = {q["id"]: 20_000 for q in p["questions"]}
    r = (await c.post(f"{URL}/{p['id']}/submit", json={"answers": await _right(db, p), "times": times})).json()
    a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(p["id"])})
    assert a["signals"]["fastPaper"] and a["integrity"]["level"] == "watch" and "too_fast" in a["integrity"]["reasons"]
    assert r["pass"] and not r["retest"]  # Watch never blocks the result
    # the same paper over a fair time is not flagged
    c2 = await student(make_client, outbox, "jaya@example.com", "Jaya R")
    await c2.post(f"{URL}/consent")
    p2 = (await _paper(c2)).json()
    await db[SKILL_ATTEMPTS].update_one(
        {"_id": ObjectId(p2["id"])}, {"$set": {"started_at": E_now() - timedelta(minutes=10)}}
    )
    await c2.post(f"{URL}/{p2['id']}/submit", json={"answers": await _right(db, p2), "times": times})
    a2 = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(p2["id"])})
    assert not a2["signals"]["fastPaper"] and a2["integrity"]["level"] == "clean"


async def test_admin_integrity_queue_shows_plain_reasons(outbox, db, make_client, admin_client, monkeypatch):
    _fake_grade(monkeypatch)
    c = await student(make_client, outbox, "ravi9@example.com", "Ravi N")
    aid = await _passed(c, db)
    await db[SKILL_ATTEMPTS].update_one(
        {"_id": ObjectId(aid)}, {"$set": {"strict": True}}
    )  # a second retest: a person decides
    await c.post(f"{URL}/{aid}/task/start")
    await c.post(f"{URL}/{aid}/task/submit", json={"text": LONG, "pastedChars": len(LONG), "keys": 0, "typingMs": 0})
    owner = await admin_client()
    q = (await owner.get("/api/admin/vetting/queue", params={"kind": "integrity"})).json()
    item = q["items"][0]
    assert E.POINTS["typing_speed"] in item["attempt"]["integrity"]["reasons"]
    assert any("characters" in x and "seconds" in x for x in item["attempt"]["integrity"]["explain"])
