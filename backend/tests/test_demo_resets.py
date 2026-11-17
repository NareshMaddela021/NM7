# ruff: noqa: E501
"""Demo resets and heavy jobs on the 512 MB server (17 Nov: a coordinator reset ran out of memory; the Hire in 60
minutes reset answered 500). Each demo resets only its own made-up people, in any order; one heavy job runs at a time;
the daily fraud scan streams resumes instead of loading them all."""

import tracemalloc
from datetime import timedelta

from app.core.db import HIRE_PROFILES, LOCKS, RESUMES, USERS
from app.core.time import now


async def test_resets_in_any_order_never_break_each_other(client, db, admin_client):
    owner = await admin_client()
    for p in [
        "/api/admin/demo-company/hire/open",
        "/api/admin/demo-org/coordinator",
        "/api/admin/demo-company/hire/open",
        "/api/admin/demo-company/open",
        "/api/admin/demo-org/coordinator",
        "/api/admin/demo-company/hire/open",
    ]:
        r = await owner.post(p)
        assert r.status_code == 200, (p, r.text)
    assert await db[HIRE_PROFILES].count_documents({"_id": {"$regex": "^hire-demo-"}}) == 30
    # the college demo's reset leaves the Hire in 60 minutes people alone (it used to delete every demo user)
    await owner.post("/api/admin/demo-org/coordinator")
    assert await db[USERS].count_documents({"_id": {"$regex": "^hire-demo-"}}) == 30


async def test_one_heavy_job_at_a_time(client, db, admin_client):
    from app.hire.vetting.ladder import hourly_if_due

    owner = await admin_client()
    await db[LOCKS].update_one({"_id": "heavy"}, {"$set": {"until": now() + timedelta(minutes=5)}}, upsert=True)
    r = await owner.post("/api/admin/demo-org/coordinator")
    assert r.status_code == 429 and r.json()["error"]["code"] == "busy"
    assert (await owner.post("/api/admin/demo-company/hire/open")).status_code == 429
    assert await hourly_if_due(db) == {}  # a background job skips this pass
    await db[LOCKS].update_one({"_id": "heavy"}, {"$set": {"until": None}})
    assert (await owner.post("/api/admin/demo-org/coordinator")).status_code == 200
    assert (await db[LOCKS].find_one({"_id": "heavy"}))["until"] is None  # released after the job


async def test_fraud_scan_streams_resumes(db):
    from app.hire.vetting.trust import fraud_scan

    filler = " ".join(f"word{i % 400} skill{i % 97} project{i % 53}" for i in range(1500))  # ~30 KB of text each
    docs = [{"user_id": f"u{i}", "active": True, "data": {"personal": {"phone": f"98765{i:05d}"}, "summary": f"{filler} person {i}"}}
            for i in range(1500)]  # fmt: skip
    docs.append(
        {
            "user_id": "u-copy",
            "active": True,
            "data": {"personal": {"phone": "9876500001"}, "summary": docs[1]["data"]["summary"]},
        }
    )
    await db[RESUMES].insert_many(docs)
    del docs
    tracemalloc.start()
    out = await fraud_scan(db)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert out.get("phone") == 1 and out.get("resume", 0) >= 1  # still finds the planted copy
    assert peak < 25_000_000, f"fraud scan held {peak / 1e6:.0f} MB"  # ~45 MB of resumes, never all in memory
