# ruff: noqa: E501
"""Phase 6 S2: learning paths with proof. Courses → a guided project → the role's skill check. "I finished this course"
is progress only (never a skill); the badge needs BOTH a passed official skill check (late or low scores don't count)
and the project sent; it shows to companies and on the public link. Weekly nudges at most once a week, with a stop
link. Admin edits paths (projects must be free). Everything goes with the account."""

from datetime import timedelta

from app.core.db import LEARN_PROGRESS, SKILL_ATTEMPTS, USERS
from app.core.time import now
from app.seek import paths
from tests.conftest import signup


async def _uid(db):
    return (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]


async def _attempt(db, uid, score, late=False, skill="SQL"):
    t = now()
    await db[SKILL_ATTEMPTS].insert_one({"user_id": uid, "skill": skill, "started_at": t, "ends_at": t,
                                         "submitted_at": t, "score": score, "late": late, "total": 10})  # fmt: skip


async def test_path_progress_and_badge_only_with_both(client, outbox, db):
    await signup(client, outbox)
    uid = await _uid(db)
    lst = (await client.get("/api/me/learn")).json()
    assert lst["started"] == [] and any(p["role"] == "data-analyst" for p in lst["paths"])
    d = (await client.post("/api/me/learn/data-analyst/start")).json()
    assert d["started"] and d["test"]["skill"] == "SQL" and d["test"]["pass"] == 60
    skills = {c["skill"] for c in d["courses"]}
    assert {"Microsoft Excel", "SQL", "Power BI"} <= skills and all(not c["done"] for c in d["courses"])
    assert d["project"]["title"] and d["project"]["steps"] and d["progress"] == 0 and d["verified"] is None

    # a course ticked: progress only, no skill anywhere
    cid = d["courses"][0]["id"]
    d = (await client.put("/api/me/learn/data-analyst/course", json={"courseId": cid, "done": True})).json()
    assert d["courses"][0]["done"] and d["progress"] > 0
    u = await db[USERS].find_one({"_id": uid})
    assert not u.get("verified_skills")
    assert (
        await client.put("/api/me/learn/data-analyst/course", json={"courseId": "nope", "done": True})
    ).status_code == 404

    # the project: a real link or a few lines
    assert (await client.post("/api/me/learn/data-analyst/project", json={"text": "done"})).status_code == 422
    assert (await client.post("/api/me/learn/data-analyst/project", json={"link": "my sheet"})).status_code == 422
    d = (await client.post("/api/me/learn/data-analyst/project", json={"link": "https://docs.google.com/x"})).json()
    assert d["project"]["sent"]["link"] == "https://docs.google.com/x" and d["verified"] is None  # no check yet

    # a low score, or a late one, never verifies
    await _attempt(db, uid, 50)
    await _attempt(db, uid, 90, late=True)
    d = (await client.get("/api/me/learn/data-analyst")).json()
    assert d["verified"] is None and d["test"]["best"]["score"] == 50
    # passed: verified now, recorded once, with the date
    await _attempt(db, uid, 80)
    await paths.on_skill_check(db, uid, "SQL")
    d = (await client.get("/api/me/learn/data-analyst")).json()
    assert d["verified"]["skill"] == "SQL" and d["verified"]["at"]
    u = await db[USERS].find_one({"_id": uid})
    assert [v["skill"] for v in u["verified_skills"]] == ["SQL"]
    await client.get("/api/me/learn/data-analyst")
    assert len((await db[USERS].find_one({"_id": uid}))["verified_skills"]) == 1
    assert (await paths.verified_of(db, [uid]))[uid][0]["skill"] == "SQL"
    assert (await client.get("/api/me/learn")).json()["started"][0]["verified"]["skill"] == "SQL"


async def test_check_passed_but_no_project_is_not_verified(client, outbox, db):
    await signup(client, outbox)
    uid = await _uid(db)
    await client.post("/api/me/learn/data-analyst/start")
    await _attempt(db, uid, 100)
    await paths.on_skill_check(db, uid, "SQL")
    assert (await client.get("/api/me/learn/data-analyst")).json()["verified"] is None
    assert not (await db[USERS].find_one({"_id": uid})).get("verified_skills")
    # a project before starting the path is refused
    assert (
        await client.post("/api/me/learn/qa-tester/project", json={"link": "https://x.example/a"})
    ).status_code == 409


async def test_admin_edits_paths_free_only(client, outbox, admin_client, db):
    owner = await admin_client("owner")
    d = (await owner.get("/api/admin/learn-paths")).json()
    assert len(d["items"]) == 20 and "SQL" in d["tests"] and d["passScore"] == 60
    body = {"skills": ["SQL", "Python"], "test": "SQL", "active": True,
            "project": {"title": "Report", "brief": "Make a small report from data", "steps": ["Load", "Chart"], "submit": "link"}}  # fmt: skip
    r = await owner.put("/api/admin/learn-paths/data-analyst", json=body)
    assert r.status_code == 200 and r.json()["skills"] == ["SQL", "Python"]
    paid = {**body, "project": {**body["project"], "brief": "Pay a 500 fee and make a report"}}
    assert (await owner.put("/api/admin/learn-paths/data-analyst", json=paid)).status_code == 422
    assert (
        await owner.put("/api/admin/learn-paths/data-analyst", json={**body, "test": "Juggling"})
    ).status_code == 422
    assert (await owner.put("/api/admin/learn-paths/nope", json=body)).status_code == 404
    await signup(client, outbox)
    assert {c["skill"] for c in (await client.post("/api/me/learn/data-analyst/start")).json()["courses"]} == {
        "SQL",
        "Python",
    }


async def test_weekly_nudge_once_and_stop_link(client, outbox, db):
    await signup(client, outbox)
    uid = await _uid(db)
    await client.post("/api/me/learn/data-analyst/start")
    assert await paths.send_nudges(db, outbox) == 0  # touched today
    await db[LEARN_PROGRESS].update_many({}, {"$set": {"updated_at": now() - timedelta(days=8)}})
    outbox.sent.clear()
    assert await paths.send_nudges(db, outbox) == 1
    m = outbox.sent[-1]
    assert "Data analyst learning path is 0% done" in m.text and "Stop these emails" in m.text
    assert await paths.send_nudges(db, outbox) == 0  # not twice in a week
    r = await client.post("/api/public/learn/stop-nudges", json={"token": paths.unsub_token(uid)})
    assert r.status_code == 200
    await db[LEARN_PROGRESS].update_many({}, {"$set": {"nudged_at": None}})
    await db[USERS].update_one({"_id": uid}, {"$set": {"learn_nudged_at": None}})
    assert await paths.send_nudges(db, outbox) == 0
    assert (
        await client.post("/api/public/learn/stop-nudges", json={"token": f"{uid}.bad-signature"})
    ).status_code == 404


async def test_badge_on_public_link_and_erased(client, make_client, outbox, db):
    from app.me.erase import erase_account

    await signup(client, outbox)
    uid = await _uid(db)
    await db[USERS].update_one(
        {"_id": uid}, {"$set": {"verified_skills": [{"skill": "SQL", "role": "data-analyst", "at": now()}]}}
    )
    await client.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": {"personal": {"name": "Sai"}}})
    assert (await client.put("/api/me/share", json={"on": True, "slug": "sai-v", "resumeId": "r1"})).status_code == 200
    seen = (await make_client().get("/api/public/resumes/sai-v")).json()["verified"]
    assert [v["skill"] for v in seen] == ["SQL"] and seen[0]["at"]
    await client.post("/api/me/learn/data-analyst/start")
    await erase_account(db, uid)
    assert "verified_skills" not in await db[USERS].find_one({"_id": uid})
    assert await db[LEARN_PROGRESS].count_documents({"user_id": uid}) == 0
