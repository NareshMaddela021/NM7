"""Phase 2 C4: the company trust score (parts and reasons), the badge on job cards / pages and the company page,
"Report this job" (3 different people pause it; Admin dismisses or closes), the response badge from real data only,
and no silent rejections (14 days without an update → Closed (no reply), one polite email a day)."""

from datetime import timedelta

from app.companies import trust
from app.core.db import APPLICATIONS, COMPANIES, JOB_REPORTS, JOBS, USERS
from app.core.time import now
from tests.conftest import signup
from tests.test_companies_posting import JOB, no_ai  # noqa: F401
from tests.test_companies_posting import verified as _verified
from tests.test_companies_signup import H, err, no_network, sign_up  # noqa: F401


async def verified(client, outbox, db):
    """A Verified company with its score worked out (the helper sets the review in the database directly)."""
    session, cid = await _verified(client, outbox, db)
    await trust.refresh(db, cid)
    return session, cid


async def students(client, outbox, n, make_client):
    out = []
    for i in range(n):
        c = make_client()
        await signup(c, outbox, email=f"student{i}@example.com", name=f"Student {i}")
        out.append(c)
    return out


async def test_score_parts_and_badge(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    doc = await db[COMPANIES].find_one({"_id": cid})
    s = await trust.score_of(db, doc)
    parts = {p["code"]: p["points"] for p in s["parts"]}
    # verified 45, company email 10, domain 2000 days old 10, mail server 5, no reports 15, replies 8 (too few)
    assert parts == {"verified": 45, "domain_email": 10, "domain_old": 10, "mail": 5, "reports": 15, "replies": 8}
    assert s["value"] == 93 and s["replyDays"] is None
    # a Basic company scores lower; an individual recruiter lower still; blocked is 0
    assert (await trust.score_of(db, {**doc, "review": {"state": "pending"}, "verified_until": None}))["value"] == 68
    _, ind = await sign_up(
        client,
        outbox,
        email="priya@gmail.com",
        details={"legalName": "Priya", "category": "individual", "website": ""},
        individual={"linkedin": "linkedin.com/in/priya-hr", "declared": True},
    )
    assert (await trust.score_of(db, await db[COMPANIES].find_one({"_id": ind["id"]})))["value"] == 38
    assert (await trust.score_of(db, {**doc, "review": {"state": "blocked"}}))["value"] == 0
    # the badge on the board and the company page
    job = (await client.post(f"/api/company/{cid}/jobs", json={"job": JOB}, headers=H(session))).json()
    item = (await client.get("/api/jobs", params={"q": "Junior Data Analyst"})).json()["items"][0]
    assert item["companyTrust"]["level"] == "verified" and item["companyTrust"]["score"] == 93
    assert {"code": "verified", "points": 45} in item["companyTrust"]["parts"]
    page = (await client.get(f"/api/jobs/{job['slug']}")).json()
    assert page["companyTrust"]["slug"] == doc["slug"]
    cp = (await client.get(f"/api/companies/{doc['slug']}")).json()
    assert cp["score"] == 93 and cp["parts"]
    # collector jobs carry no company badge
    await db[JOBS].update_one({"_id": job["id"]}, {"$unset": {"company_id": ""}})
    assert "companyTrust" not in (await client.get(f"/api/jobs/{job['slug']}")).json()


async def test_reports_pause_and_admin(client, outbox, db, make_client, admin_client):
    session, cid = await verified(client, outbox, db)
    job = (await client.post(f"/api/company/{cid}/jobs", json={"job": JOB}, headers=H(session))).json()
    assert (await client.post(f"/api/jobs/{job['id']}/report", json={"reason": "scam"})).status_code == 401
    s = await students(client, outbox, 4, make_client)
    r = await s[0].post(f"/api/jobs/{job['id']}/report", json={"reason": "scam", "note": "Asked me to pay on the call"})
    assert r.json() == {"reported": True, "paused": False}
    assert err(await s[0].post(f"/api/jobs/{job['id']}/report", json={"reason": "fake"})) == "already"
    await s[1].post(f"/api/jobs/{job['id']}/report", json={"reason": "fake"})
    r = await s[2].post(f"/api/jobs/{job['id']}/report", json={"reason": "wrong_info"})
    assert r.json()["paused"] is True
    assert (await db[JOBS].find_one({"_id": job["id"]}))["status"] == "paused"
    assert (await db[COMPANIES].find_one({"_id": cid}))["score"]["value"] == 93 - 15  # 3 reports × 5
    owner = await admin_client("owner")
    q = (await owner.get("/api/admin/job-reports")).json()
    assert q[0]["count"] == 3 and q[0]["held"] and "Asked me to pay on the call" in [x["note"] for x in q[0]["reports"]]
    # dismiss: live again; the reports are done
    assert (await owner.post(f"/api/admin/job-reports/{job['id']}/resolve", json={"action": "dismiss"})).json() == {
        "status": "active"
    }
    assert (await owner.get("/api/admin/job-reports")).json() == []
    assert await db[JOB_REPORTS].count_documents({"state": "done"}) == 3
    # close needs a note
    await s[3].post(f"/api/jobs/{job['id']}/report", json={"reason": "expired"})
    assert err(await owner.post(f"/api/admin/job-reports/{job['id']}/resolve", json={"action": "close"})) == "note"
    r = await owner.post(
        f"/api/admin/job-reports/{job['id']}/resolve", json={"action": "close", "note": "The role was filled"}
    )
    assert r.json() == {"status": "closed"}
    assert (await (await admin_client("support")).get("/api/admin/job-reports")).status_code == 403


async def apply_nm7(db, uid, job_id, days_ago, answered_after=None, status="applied", key=None):
    t = now() - timedelta(days=days_ago)
    tl = [{"status": "applied", "at": t}]
    if answered_after is not None:
        tl.append({"status": "shortlisted", "at": t + timedelta(days=answered_after)})
        status = "shortlisted"
    await db[APPLICATIONS].insert_one(
        {
            "user_id": uid,
            "key": key or f"j{abs(hash((job_id, uid))) % 10**12}",
            "job_id": job_id,
            "channel": "nm7",
            "status": status,
            "company": "Acme Analytics Pvt Ltd",
            "role": "Junior Data Analyst",
            "timeline": tl,
            "created_at": t,
            "updated_at": t,
        }
    )


async def test_response_badge_and_no_silent_rejections(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    job = (
        await client.post(f"/api/company/{cid}/jobs", json={"job": {**JOB, "applyMethod": "nm7"}}, headers=H(session))
    ).json()
    await apply_nm7(db, "u1", job["id"], 10, answered_after=2)
    await apply_nm7(db, "u2", job["id"], 9, answered_after=4)
    assert (await trust.reply_stats(db, cid))["days"] is None  # only 2 answers: no badge
    await apply_nm7(db, "u3", job["id"], 8, answered_after=3)
    rs = await trust.reply_stats(db, cid)
    assert (rs["days"], rs["answered"], rs["asked"]) == (3, 3, 3)
    assert (await trust.refresh(db, cid))["replyDays"] == 3
    # silent for 15 days: closed, the student told (once a day; not when follow-up emails are off)
    await signup(client, outbox, email="silent@example.com", name="Sai Kumar")
    uid = (await db[USERS].find_one({"email": "silent@example.com"}))["_id"]
    await apply_nm7(db, uid, job["id"], 15)
    await apply_nm7(db, uid, job["id"], 3, key="recent")  # 3 days old: stays open
    before = len(outbox.sent)
    assert await trust.close_silent(db, outbox) == 1
    a = await db[APPLICATIONS].find_one({"user_id": uid, "status": "no_reply"})
    assert a["timeline"][-1]["status"] == "no_reply"
    mail = outbox.sent[-1]
    assert (
        len(outbox.sent) == before + 1 and mail.to == "silent@example.com" and "hasn't replied in 14 days" in mail.text
    )
    assert (await db[APPLICATIONS].find_one({"user_id": uid, "key": "recent"}))["status"] == "applied"
    st = (await client.get("/api/me/state")).json()["apps"]
    assert "no_reply" in {x["status"] for x in st}
    # another silent one the same day: closed, no second email
    await apply_nm7(db, uid, job["id"] + "x", 20)
    await db[JOBS].insert_one(
        {**(await db[JOBS].find_one({"_id": job["id"]})), "_id": job["id"] + "x", "slug": "x-1", "dedupe_key": "x"}
    )
    n = len(outbox.sent)
    assert await trust.close_silent(db, outbox) == 1 and len(outbox.sent) == n
    # collector jobs (no company on Nm7) are never auto-closed
    await db[JOBS].insert_one(
        {
            **(await db[JOBS].find_one({"_id": job["id"]})),
            "_id": "col1",
            "slug": "c-1",
            "dedupe_key": "c",
            "company_id": None,
        }
    )
    await apply_nm7(db, uid, "col1", 30)
    assert await trust.close_silent(db, outbox) == 0
