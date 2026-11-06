"""Phase 4 E5: the job readiness score. The maths and weights, up to 3 "Things left" with their places, Admin's
weights (adding up to 100), recomputed only when something it reads changes."""

from app.core.db import CERTIFICATES, JOB_MATCHES, JOBS, USERS
from app.simple.readiness import WEIGHTS, compute, role_skills
from tests.conftest import signup
from tests.jobs_helpers import add_resume, resume, strong_resume

URL = "/api/me/simple/readiness"


def inputs(**over):
    base = {
        "data": strong_resume(),
        "has_resume": True,
        "ats": 100,
        "roles": ["Data Analyst"],
        "role_skills": ["sql", "python", "power bi", "excel"],
        "linkedin": True,
        "practised": 3,
        "certs": 1,
    }
    return {**base, **over}


def test_score_maths_and_things_left():
    full = compute(inputs(), WEIGHTS)
    assert full["score"] == 100 and full["left"] == [] and all(p["done"] for p in full["parts"])
    # each part counts its own weight
    assert compute(inputs(linkedin=False), WEIGHTS)["score"] == 90
    assert compute(inputs(certs=0), WEIGHTS)["score"] == 90
    assert compute(inputs(practised=1), WEIGHTS)["score"] == 90  # 1 of 3 answers practised: 5 of 15
    assert compute(inputs(ats=60), WEIGHTS)["score"] == 90  # 25 × 0.6 = 15
    half = compute(inputs(role_skills=["sql", "python", "react", "java"]), WEIGHTS)
    assert half["score"] == 90 and half["left"] == [{"key": "skills", "path": "/builder", "points": 10}]
    # no resume: nothing from the resume parts; the biggest gaps first, at most 3
    none = compute(inputs(has_resume=False, data={}, ats=0, linkedin=False, practised=0, certs=0, roles=[]), WEIGHTS)
    assert none["score"] == 0
    assert [x["key"] for x in none["left"]] == ["score", "resume", "roles"]  # 25, 20, 20 (roles before interview)
    assert none["left"][2]["path"] == "/me/auto-apply"
    # Admin's weights
    w = {"resume": 0, "score": 0, "linkedin": 50, "interview": 0, "skills": 0, "certs": 50}
    assert compute(inputs(linkedin=False), w)["score"] == 50
    assert compute(inputs(linkedin=False), w)["left"] == [{"key": "linkedin", "path": "/linkedin", "points": 50}]


def test_role_skills_from_live_jobs():
    jobs = [
        {"title": "Junior Data Analyst", "skills": ["SQL", "Excel"]},
        {"title": "Data Analyst Intern", "skills": ["SQL", "Power BI"]},
        {"title": "Chef", "skills": ["Cooking"]},
    ]
    assert role_skills(jobs, ["Data Analyst"]) == ["sql", "excel", "power bi"]
    assert role_skills(jobs, []) == []


async def test_endpoint_reads_the_real_things_and_caches(client, outbox, db, admin_client):
    await signup(client, outbox, email="ravi@example.com", name="Ravi Kumar")
    uid = (await db[USERS].find_one({"email": "ravi@example.com"}))["_id"]
    r = (await client.get(URL)).json()
    assert r["score"] == 0 and len(r["left"]) == 3
    await add_resume(client, data=resume(links={}, certs=[]))
    r = (await client.get(URL)).json()
    first = r["score"]
    assert 0 < first < 100 and {x["key"] for x in r["left"]} >= {"roles"}
    # cached: the same answer without recomputing (a changed weight-free field in the saved copy shows it)
    await db[USERS].update_one({"_id": uid}, {"$set": {"simple.readiness.out.score": 1}})
    assert (await client.get(URL)).json()["score"] == 1
    # something it reads changes → recomputed
    await db[CERTIFICATES].insert_one({"_id": "c1", "user_id": uid, "name": "Excel basics"})
    after_cert = (await client.get(URL)).json()["score"]
    assert after_cert == first + 10
    await db[JOB_MATCHES].insert_one(
        {"_id": "m1", "user_id": uid, "interview": {"practised": {"q1": {}, "q2": {}, "q3": {}}}}
    )
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.roles": ["Data Analyst"]}})
    await db[JOBS].insert_one(
        {"_id": "j1", "title": "Data Analyst", "skills": ["SQL", "Python"], "status": "active", "closes_at": None}
    )
    r = (await client.get(URL)).json()
    assert r["score"] == after_cert + 15 + 20  # practice done; the resume has SQL and Python
    assert "roles" not in {x["key"] for x in r["left"]} and "interview" not in {x["key"] for x in r["left"]}
    # Admin → Settings: weights must add up to 100
    owner = await admin_client("owner")
    bad = {"resume": 50, "score": 50, "linkedin": 50, "interview": 0, "skills": 0, "certs": 0}
    resp = await owner.put("/api/admin/settings", json={"simple": {"on": True, "weights": bad}})
    assert resp.status_code == 422
    w = {"resume": 0, "score": 0, "linkedin": 0, "interview": 50, "skills": 0, "certs": 50}
    resp = await owner.put("/api/admin/settings", json={"simple": {"on": True, "weights": w}})
    assert resp.json()["simple"]["weights"] == w
    assert (await client.get(URL)).json()["score"] == 100
    assert (await owner.get("/api/admin/settings")).json()["simple"]["defaultTeHi"] == "simple"  # the rest kept


async def test_strong_student_is_fully_ready_except_practice(client, outbox, db):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    await add_resume(client, data=strong_resume())
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.roles": ["Data Analyst"]}})
    r = (await client.get(URL)).json()
    assert r["score"] == 85 and [x["key"] for x in r["left"]] == ["interview"]
