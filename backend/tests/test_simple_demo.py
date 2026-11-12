"""Phase 4 demo: "Ravi Kumar (demo)" on the Easy dashboard in Telugu: a half-done resume, readiness near 60%, the demo
company's jobs as his top jobs, one "Needs your answer" question; a one-time link from Admin; never public."""

from app.autoapply import engine
from app.core.db import AUTO_ITEMS, JOBS, USERS
from app.simple import demo
from app.site import save_site
from tests.test_jobs_public import add

ADMIN = "/api/admin/simple/demo"


async def test_ravi_demo(client, outbox, db, admin_client, make_client):
    assert (await (await admin_client("support")).post(ADMIN)).status_code == 403
    owner = await admin_client("owner")
    # live jobs on the board don't change the demo: Ravi is compared with the demo company's jobs only
    for t in ("Data Analyst", "Software Engineer", "Design Engineer"):
        await add(
            db,
            title=t,
            skills=["Python", "Tableau", "Power BI", "Java", "React"],
            applyUrl=f"https://a.example/{t[:4]}",
        )
    r = (await owner.post(ADMIN)).json()
    assert r["path"].startswith("/demo-student#t=") and r["items"] == 1
    token = r["path"].split("#t=")[1]
    phone = make_client()
    assert (await phone.post("/api/public/demo-student", json={"token": token})).json() == {"path": "/me/simple"}
    assert (await phone.post("/api/public/demo-student", json={"token": token})).status_code == 400  # one time
    me = (await phone.get("/api/auth/me")).json()
    assert me["name"] == "Ravi Kumar (demo)" and me["role"] == "customer"
    home = (await phone.get("/api/me/simple")).json()
    assert home["lang"] == "en" and home["mode"] == "simple"  # Telugu hidden (the default): Ravi in English
    await save_site(db, {"languages": {"te_hi": True}})
    assert (await phone.get("/api/me/simple")).json()["lang"] == "te"
    assert home["next"]["key"] == "projects"  # half-done: no project yet
    assert 55 <= home["readiness"]["score"] <= 65, home["readiness"]  # about 60%
    assert home["counts"]["needs"] == 1
    jobs = (await phone.get("/api/me/simple/jobs")).json()
    assert len(jobs["items"]) == 3 and all(j["demo"] for j in jobs["items"])
    # re-test N3: the full dashboard's "Jobs for you" card shows the same jobs with the same scores
    card = (await phone.get("/api/me/jobs-for-you")).json()
    assert card["state"] == "on" and all(j["demo"] for j in card["items"])
    assert [(j["id"], j["match"]["score"]) for j in card["items"]] == [(j["id"], j["match"]) for j in jobs["items"]]
    assert jobs["autoOn"] is True and jobs["needs"] == 1
    # never public: demo jobs aren't on the board, and the morning run leaves demo students out
    j = await db[JOBS].find_one({"_id": jobs["items"][0]["id"]})
    assert (await client.get(f"/api/jobs/{j['slug']}")).status_code == 404
    await db[USERS].update_many({}, {"$set": {"auto_apply.run_day": None}})
    assert (await engine.run(db, outbox, force=True))["users"] == 0
    # reset is repeatable, and the Auto Apply demo link still opens Kavya's Auto Apply page
    assert (await owner.post(ADMIN)).json()["items"] == 1
    assert await db[AUTO_ITEMS].count_documents({"user_id": demo.STUDENT_ID}) == 1
    kavya = (await owner.post("/api/admin/auto-apply/demo")).json()["path"].split("#t=")[1]
    other = make_client()
    assert (await other.post("/api/public/demo-student", json={"token": kavya})).json() == {"path": "/me/auto-apply"}
