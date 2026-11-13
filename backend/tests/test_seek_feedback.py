# ruff: noqa: E501
"""Phase 6 S6: interview feedback. A company can give 1–3 short reasons only after Not selected; the student sees
kind words with practice and free courses, never the interviewer's name or who wrote it; private self-reviews with
tips; recent reasons add a pointer to readiness "things left"; erased with the account."""

from app.core.db import APPLICATIONS, INTERVIEW_REVIEWS, USERS
from app.simple.readiness import compute
from tests.test_companies_apply import company_job, student
from tests.test_companies_posting import no_ai  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401

ANSWERS = {"consent": True, "answers": {"q1": "yes", "q2": 12, "q3": "Day"}}


async def _applied(client, outbox, db, make_client):
    session, cid, job = await company_job(client, outbox, db)
    s = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    assert (await s.post(f"/api/jobs/{job['id']}/apply", json=ANSWERS)).status_code == 201
    app_id = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"][0]["id"]
    return session, cid, app_id, s


async def test_feedback_only_after_not_selected_kind_and_nameless(client, outbox, db, make_client):
    session, cid, app_id, s = await _applied(client, outbox, db, make_client)
    url = f"/api/company/{cid}/applicants/{app_id}/feedback"
    body = {"reasons": ["skills", "communication"], "skill": "SQL", "note": "Practise joins."}
    assert (await client.post(url, json=body, headers=H(session))).status_code == 409  # not rejected yet
    await client.post(f"/api/company/{cid}/applicants/{app_id}/status", json={"status": "rejected"}, headers=H(session))
    assert (await client.post(url, json={"reasons": []}, headers=H(session))).status_code == 422  # 1–3 reasons
    assert (
        await client.post(url, json={"reasons": ["skills", "fit", "filled", "other"]}, headers=H(session))
    ).status_code == 422
    assert (await client.post(url, json=body, headers=H(session))).status_code == 200
    stored = (await db[APPLICATIONS].find_one({}))["feedback"]
    assert set(stored) == {"reasons", "skill", "note", "at"}  # no interviewer, no account
    d = (await s.get("/api/me/feedback")).json()
    fb = d["feedback"][0]
    assert fb["job"] and fb["company"]
    by = {h["reason"]: h for h in fb["help"]}
    assert "more SQL" in by["skills"]["text"] and by["skills"]["practice"] == "role-SQL" and by["skills"]["courses"]
    assert by["communication"]["practice"] == "english-email" and by["communication"]["interview"]
    assert by["note"]["note"] == "Practise joins."
    blob = str(d).lower()
    assert "@" not in blob and "interviewer" not in blob and "rejected" not in blob and "failed" not in blob


async def test_readiness_points_to_feedback(client, outbox, db, make_client):
    session, cid, app_id, s = await _applied(client, outbox, db, make_client)
    await client.post(f"/api/company/{cid}/applicants/{app_id}/status", json={"status": "rejected"}, headers=H(session))
    r = (await s.get("/api/me/simple/readiness")).json()
    assert "feedback" not in [x["key"] for x in r["left"]]
    await client.post(
        f"/api/company/{cid}/applicants/{app_id}/feedback", json={"reasons": ["filled"]}, headers=H(session)
    )
    r = (await s.get("/api/me/simple/readiness")).json()
    assert "feedback" not in [x["key"] for x in r["left"]]  # "position filled" is nothing to work on
    await client.post(
        f"/api/company/{cid}/applicants/{app_id}/feedback", json={"reasons": ["experience"]}, headers=H(session)
    )
    r = (await s.get("/api/me/simple/readiness")).json()
    assert {"key": "feedback", "path": "/me/feedback", "points": 0} in r["left"]


def test_compute_adds_the_pointer_without_points():
    base = {
        "data": {},
        "role_skills": [],
        "roles": [],
        "has_resume": False,
        "ats": 0,
        "linkedin": False,
        "practised": 0,
        "certs": False,
    }
    w = {"resume": 20, "score": 25, "linkedin": 10, "interview": 15, "skills": 20, "certs": 10}
    a, b = compute(base, w), compute({**base, "feedback": 2}, w)
    assert a["score"] == b["score"] and b["left"][-1]["key"] == "feedback"


async def test_self_review_tips_private_and_erased(client, outbox, db, make_client):
    from app.me.erase import erase_account

    s = await student(make_client, outbox, "kiran@example.com", "Kiran")
    r = await s.post(
        "/api/me/feedback/self",
        json={
            "company": "Acme",
            "role": "Analyst",
            "date": "2026-11-10",
            "asked": "Tell me about yourself. Then two SQL queries.",
            "went": "badly",
            "notes": "Nervous",
        },
    )
    assert r.status_code == 201
    tips = r.json()["tips"]
    assert (
        "doesn't decide anything" in tips[0]
        and any("Tell me about yourself" in t for t in tips)
        and any("technical" in t for t in tips)
    )
    other = await student(make_client, outbox, "ravi@example.com", "Ravi")
    assert (await other.get("/api/me/feedback")).json()["reviews"] == []  # private
    assert (await other.delete(f"/api/me/feedback/self/{r.json()['id']}")).status_code == 404
    uid = (await db[USERS].find_one({"email": "kiran@example.com"}))["_id"]
    await erase_account(db, uid)
    assert await db[INTERVIEW_REVIEWS].count_documents({"user_id": uid}) == 0
