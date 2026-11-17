"""The 100 test users for checking the live site (Admin → Settings → "Test users"): made-up, marked demo, opened only
by a one-time link, never emailed, never shown to a real company, and removed with everything they made."""

from app.admin import test_users
from app.core.db import APPLICATIONS, RESUMES, SESSIONS, USERS
from app.core.email import Email, send_safely
from tests.test_companies_apply import company_job
from tests.test_jobs_public import add

ADMIN = "/api/admin/test-users"
MINE = {"_id": {"$regex": "^demo-test-"}}


def test_people_are_all_different_and_mixed():
    people = [test_users.person(i) for i in range(test_users.COUNT)]
    assert len({p["name"] for p in people}) == len({p["email"] for p in people}) == 100
    assert all(p["name"].endswith("(test)") and p["email"].endswith("@test.nm7.invalid") for p in people)
    assert {k: sum(p["kind"] == k for p in people) for k in test_users.KINDS} == dict.fromkeys(test_users.KINDS, 25)
    assert [sum(p["stage"] == s for p in people) for s in ("none", "started", "full")] == [20, 20, 60]
    assert max(p["years"] for p in people) >= 15 and all(p["years"] == 0 for p in people if p["kind"] == "student")
    phones = {test_users.resume_data(p)["personal"]["phone"] for p in people}
    assert len(phones) == 100  # a shared phone number is a fraud signal


async def test_create_open_and_remove(client, outbox, db, admin_client, make_client):
    assert (await (await admin_client("support")).post(ADMIN)).status_code == 403  # owner only
    owner = await admin_client("owner")
    assert (await owner.get(ADMIN)).json()["count"] == 0
    assert (await owner.post(f"{ADMIN}/1/open")).status_code == 404  # none yet
    assert (await owner.post(ADMIN)).json() == {"created": 100, "resumes": 80}
    listed = (await owner.get(ADMIN)).json()
    assert listed["count"] == 100 and listed["users"][0]["n"] == 1 and not listed["users"][0]["opened"]
    # not real: left out of the admin numbers and the customers list
    assert (await owner.get("/api/admin/stats")).json()["customers"] == 0
    assert (await owner.get("/api/admin/customers")).json()["total"] == 0
    # no password: the sign-in page never lets them in
    bad = await client.post(
        "/api/auth/login", json={"email": "user003@test.nm7.invalid", "password": "anything-at-all"}
    )
    assert bad.status_code in (400, 401, 422)
    # the one-time link signs a browser in as test user 3 (experienced, full resume)
    r = (await owner.post(f"{ADMIN}/3/open")).json()
    token = r["path"].split("#t=")[1]
    assert r["path"].startswith("/demo-student#t=") and r["user"] == "demo-test-003"
    phone = make_client()
    assert (await phone.post("/api/public/demo-student", json={"token": token})).json() == {"path": "/me"}
    assert (await phone.post("/api/public/demo-student", json={"token": token})).status_code == 400  # one time
    me = (await phone.get("/api/auth/me")).json()
    assert me["name"].endswith("(test)") and me["role"] == "customer"
    assert len((await phone.get("/api/me/resumes")).json()) == 1
    assert (await owner.post(f"{ADMIN}/0/open")).status_code == 404
    assert (await owner.post(f"{ADMIN}/101/open")).status_code == 404
    # a job that applies on another website: only a row in the test user's own tracker
    web = await add(db, title="Data Analyst", applyUrl="https://a.example/apply")
    assert (await phone.post(f"/api/jobs/{web['_id']}/apply", json={})).status_code == 201
    # a real company's job on Nm7: refused, so the company never sees a made-up applicant
    _, cid, job = await company_job(make_client(), outbox, db)
    no = await phone.post(f"/api/jobs/{job['id']}/apply", json={"consent": True, "resumeId": "r1"})
    assert no.status_code == 409 and no.json()["error"]["code"] == "test_user"
    assert await db[APPLICATIONS].count_documents({"company_id": cid}) == 0
    # creating again starts fresh: what test user 3 made is gone, and that browser is signed out
    assert (await owner.post(ADMIN)).json()["created"] == 100
    assert await db[APPLICATIONS].count_documents({"user_id": "demo-test-003"}) == 0
    assert (await phone.get("/api/auth/me")).status_code == 401
    # remove: nothing of theirs is left
    assert (await owner.request("DELETE", ADMIN)).json() == {"removed": 100}
    assert await db[USERS].count_documents(MINE) == 0
    assert await db[RESUMES].count_documents({"user_id": MINE["_id"]}) == 0
    assert await db[SESSIONS].count_documents({"user_id": MINE["_id"]}) == 0
    assert (await owner.get(ADMIN)).json() == {"count": 0, "total": 100, "users": []}


async def test_never_emailed(outbox):
    msg = Email(to="user007@test.nm7.invalid", to_name="A (test)", subject="Hi", text="Hi", html="<p>Hi</p>")
    assert await send_safely(outbox, msg) is True
    assert outbox.sent == []
