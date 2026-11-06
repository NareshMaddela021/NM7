"""Job board J1: the job model's checks, the dedupe key, Admin → Jobs (add / edit / pause / close / reopen / delete,
search and filters, counts), bulk import (JSON and CSV, preview with per-row errors, then import), the expired-link
list, roles (Owner and Operations only), the audit log, and the 30 demo jobs."""

import pytest

from app.core.db import AUDIT_LOG, JOBS
from app.jobs.model import JobIn, dedupe_key

JOB = {
    "title": "Junior Data Analyst",
    "company": {"name": "Acme Analytics", "website": "acme.example"},
    "locations": ["Hyderabad", "hyderabad", "Pune"],
    "workType": "hybrid",
    "jobType": "full_time",
    "experience": "fresher",
    "salary": {"min": 300000, "max": 450000, "period": "yearly"},
    "skills": ["sql", "PowerBI", "Storytelling"],
    "description": "We need a fresher who knows SQL and Power BI to build weekly dashboards for our sales team.",
    "applyMethod": "link",
    "applyUrl": "https://acme.example/careers/123",
}


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


def test_model_cleans_and_checks():
    j = JobIn.model_validate(JOB)
    assert j.locations == ["Hyderabad", "Pune"] and j.company.website == "https://acme.example"
    assert j.skills == ["SQL", "Power BI", "Storytelling"]  # dictionary names; unknown kept as written
    bad = [
        {**JOB, "applyUrl": ""},  # a link job needs its link
        {**JOB, "applyMethod": "email", "applyUrl": ""},  # an email job needs the email
        {**JOB, "locations": []},  # not remote: needs a city
        {**JOB, "salary": {"min": 5, "max": 1}},
        {**JOB, "experience": "senior"},
        {**JOB, "description": "short"},
        {**JOB, "applyUrl": "javascript:alert(1)"},
        {**JOB, "unknown": 1},
    ]
    for b in bad:
        with pytest.raises(ValueError):
            JobIn.model_validate(b)
    assert JobIn.model_validate({**JOB, "workType": "remote", "locations": []}).locations == []
    # the dedupe key ignores case, punctuation and the order of places
    a = dedupe_key("Acme Analytics", "Junior Data Analyst", ["Pune", "Hyderabad"], False, "https://x.y/1/")
    b = dedupe_key("ACME analytics.", "junior data-analyst", ["hyderabad", "pune"], False, "https://X.Y/1")
    assert a == b and a != dedupe_key("Acme", "Junior Data Analyst", ["Pune"], False, "https://x.y/1")


async def test_add_edit_status_delete_and_audit(owner, admin_client, db):
    r = await owner.post("/api/admin/jobs", json=JOB)
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["source"] == "admin" and job["status"] == "active" and job["slug"].startswith("junior-data-analyst-acme")
    assert job["salary"] == {"min": 300000, "max": 450000, "period": "yearly"}
    # the same job again: refused, pointing at the one there
    r = await owner.post("/api/admin/jobs", json={**JOB, "title": "junior data analyst"})
    assert r.status_code == 409 and err(r) == "duplicate" and r.json()["error"]["id"] == job["id"]
    # edit
    r = await owner.put(f"/api/admin/jobs/{job['id']}", json={**JOB, "title": "Data Analyst (Fresher)"})
    assert r.status_code == 200 and r.json()["title"] == "Data Analyst (Fresher)" and r.json()["slug"] == job["slug"]
    # pause, close with a reason, reopen
    for status, reason in (("paused", ""), ("closed", "Position filled"), ("active", "")):
        r = await owner.post(f"/api/admin/jobs/{job['id']}/status", json={"status": status, "reason": reason})
        assert r.json()["status"] == status
    assert r.json()["closedReason"] == ""
    # list: search and filters, counts
    await owner.post("/api/admin/jobs", json={**JOB, "title": "Java Developer", "experience": "1_3",
                                               "applyUrl": "https://acme.example/careers/456"})  # fmt: skip
    page = (await owner.get("/api/admin/jobs?q=java")).json()
    assert [j["title"] for j in page["items"]] == ["Java Developer"]
    assert (await owner.get("/api/admin/jobs?experience=fresher")).json()["total"] == 1
    assert page["counts"]["source"] == {"admin": 2} and page["counts"]["experience"] == {"fresher": 1, "1_3": 1}
    full = (await owner.get(f"/api/admin/jobs/{job['id']}")).json()
    assert full["description"].startswith("We need a fresher")
    # delete
    assert (await owner.delete(f"/api/admin/jobs/{job['id']}")).json() == {"ok": True}
    assert (await owner.get(f"/api/admin/jobs/{job['id']}")).status_code == 404
    acts = [a["action"] async for a in db[AUDIT_LOG].find({"action": {"$regex": "^job\\."}})]
    for a in ("job.create", "job.edit", "job.pause", "job.close", "job.reopen", "job.delete"):
        assert a in acts
    # roles: Operations can, Support and Finance can't
    ops = await admin_client("ops")
    assert (await ops.get("/api/admin/jobs")).status_code == 200
    for role in ("support", "finance"):
        c = await admin_client(role)
        assert (await c.get("/api/admin/jobs")).status_code == 403


async def test_bulk_import_preview_then_import(owner, db):
    intern = {**JOB, "title": "Cloud Intern", "experience": "internship", "jobType": "internship",
              "applyUrl": "https://acme.example/c/9"}  # fmt: skip
    rows = [JOB, {**JOB, "title": "x"}, intern, "oops"]
    import json

    r = await owner.post("/api/admin/jobs/import", json={"format": "json", "text": json.dumps(rows)})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["committed"] is False and (p["created"], p["rejected"]) == (2, 2)
    assert [x["result"] for x in p["rows"]] == ["created", "rejected", "created", "rejected"]
    assert any("title" in e for e in p["rows"][1]["errors"])
    assert await db[JOBS].count_documents({}) == 0  # a preview saves nothing
    r = await owner.post("/api/admin/jobs/import", json={"format": "json", "text": json.dumps(rows), "commit": True})
    assert (r.json()["created"], r.json()["committed"]) == (2, True)
    assert {j["source"] async for j in db[JOBS].find()} == {"bulk"}
    # again: skipped; one changed: updated
    rows[0] = {**JOB, "salary": {"min": 350000, "max": 500000, "period": "yearly"}}
    r = await owner.post("/api/admin/jobs/import", json={"format": "json", "text": json.dumps(rows), "commit": True})
    assert (r.json()["updated"], r.json()["skipped"], r.json()["created"]) == (1, 1, 0)
    # CSV with ; between list items
    csv = (
        "title,company,locations,work_type,experience,skills,description,apply_method,apply_email,salary_min,"
        "salary_max,salary_period\n"
        "Support Engineer,Bluepeak,Chennai;Bengaluru,onsite,0_1,Linux;SQL,"
        '"Help customers fix issues with our cloud product, by phone and chat.",email,hr@bluepeak.example,'
        "20000,30000,monthly\n"
        "Bad row,,Chennai,onsite,fresher,,too short,link,,,,\n"
    )
    r = await owner.post("/api/admin/jobs/import", json={"format": "csv", "text": csv, "commit": True})
    out = r.json()
    assert (out["created"], out["rejected"]) == (1, 1), out
    j = await db[JOBS].find_one({"title": "Support Engineer"})
    assert j["locations"] == ["Chennai", "Bengaluru"] and j["apply"]["email"] == "hr@bluepeak.example"
    assert j["salary"] == {"min": 20000, "max": 30000, "period": "monthly"} and j["skills"] == ["Linux", "SQL"]
    assert err(await owner.post("/api/admin/jobs/import", json={"format": "json", "text": "{nope"})) == "bad_file"


async def test_expired_list_and_demo_jobs(owner, db):
    r = await owner.post("/api/admin/jobs", json=JOB)
    jid = r.json()["id"]
    await db[JOBS].update_one({"_id": jid}, {"$set": {"link_check.fails": 2, "status": "closed",
                                                       "closed_reason": "apply link failed twice (404)"}})  # fmt: skip
    ex = (await owner.get("/api/admin/jobs/expired")).json()
    assert [x["id"] for x in ex] == [jid] and ex[0]["closedReason"].startswith("apply link failed")
    # reopen: the link check starts again
    await owner.post(f"/api/admin/jobs/{jid}/status", json={"status": "active"})
    assert (await owner.get("/api/admin/jobs/expired")).json() == []
    from app.orgs import demo

    await demo.create_demo(db, None)
    demo_jobs = await db[JOBS].count_documents({"demo": True})
    assert demo_jobs == 30
    assert all(["(demo)" in j["company"]["name"] async for j in db[JOBS].find({"demo": True})])
    await demo.remove_demo(db)
    assert await db[JOBS].count_documents({"demo": True}) == 0 and await db[JOBS].count_documents({}) == 1
