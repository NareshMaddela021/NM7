"""Job board J2: the collector's upload (bearer key, off without a key, wrong keys counted, batches with created /
updated / skipped / rejected and reasons, the batch limit) and the daily dead-link check (polite probing, 404 twice
closes with the reason, a good answer resets, 403 / 429 give no verdict, HEAD refused → GET, closing dates)."""

from datetime import timedelta

import httpx
import pytest

from app.core.config import get_settings
from app.core.db import AUDIT_LOG, JOBS
from app.core.time import now
from app.jobs import linkcheck
from tests.test_jobs_admin import JOB

KEY = "k" * 40


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(get_settings(), "job_ingest_key", KEY)
    return {"Authorization": f"Bearer {KEY}"}


def err(r):
    return r.json()["error"]["code"]


async def test_off_without_a_key_and_wrong_keys(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "job_ingest_key", "")
    r = await client.post("/api/jobs/ingest", json={"jobs": [JOB]})
    assert r.status_code == 503 and err(r) == "ingest_off"
    monkeypatch.setattr(get_settings(), "job_ingest_key", KEY)
    for h in ({}, {"Authorization": "Bearer wrong"}, {"Authorization": KEY}):
        r = await client.post("/api/jobs/ingest", json={"jobs": [JOB]}, headers=h)
        assert r.status_code == 401 and err(r) == "bad_key"
    for _ in range(7):
        await client.post("/api/jobs/ingest", json={"jobs": [JOB]}, headers={"Authorization": "Bearer nope"})
    assert (await client.post("/api/jobs/ingest", json=[JOB], headers={"Authorization": "Bearer x"})).status_code == 429


async def test_batch_created_updated_skipped_rejected(client, key, db):
    second = {**JOB, "title": "Java Developer", "experience": "1_3", "apply_url": "https://acme.example/c/2",
              "applyUrl": "https://acme.example/c/2"}  # fmt: skip
    second.pop("apply_url")
    bad = {**JOB, "applyUrl": "", "title": "No link"}
    r = await client.post("/api/jobs/ingest", json={"jobs": [JOB, second, bad, 42]}, headers=key)
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["created"], out["updated"], out["skipped"], out["rejected"]) == (2, 0, 0, 2)
    assert [x["result"] for x in out["results"]] == ["created", "created", "rejected", "rejected"]
    assert out["results"][0]["id"] and out["results"][2]["title"] == "No link"
    assert any("applyUrl" in e for e in out["results"][2]["errors"])
    assert {j["source"] async for j in db[JOBS].find()} == {"collector"}
    # the next morning: one unchanged, one changed (a new salary), one new; snake_case keys work too
    changed = {**second, "salary": {"min": 600000, "max": 900000, "period": "yearly"}}
    third = {"title": "Cloud Support Associate", "company": {"name": "Bluepeak"}, "locations": [],
             "work_type": "remote", "experience": "0_1", "apply_method": "email", "apply_email": "HR@bluepeak.example",
             "description": "Answer customer tickets about our cloud servers and fix simple problems."}  # fmt: skip
    r = await client.post("/api/jobs/ingest", json=[JOB, changed, third], headers=key)
    out = r.json()
    assert (out["created"], out["updated"], out["skipped"], out["rejected"]) == (1, 1, 1, 0), out
    j = await db[JOBS].find_one({"title": "Cloud Support Associate"})
    assert j["remote"] is True and j["apply"]["email"] == "hr@bluepeak.example"
    assert await db[JOBS].count_documents({}) == 3
    # limits and shape
    assert err(await client.post("/api/jobs/ingest", json={"jobs": []}, headers=key)) == "no_jobs"
    assert err(await client.post("/api/jobs/ingest", content=b"{nope", headers=key)) == "bad_json"
    assert err(await client.post("/api/jobs/ingest", json={"jobs": [JOB] * 501}, headers=key)) == "too_many"
    logs = [a["data"] async for a in db[AUDIT_LOG].find({"action": "job.ingest"})]
    assert logs[0] == {"created": 2, "updated": 0, "skipped": 0, "rejected": 2}
    assert KEY not in str(await db[AUDIT_LOG].find().to_list(None))  # the key is never stored


def server(answers: dict[str, list]):
    """A fake web: each path answers its list in turn (an int status, "timeout", or ("HEAD", status) pairs)."""
    seen = []

    def handler(request: httpx.Request):
        seen.append((request.method, request.url.host, request.url.path, request.headers.get("user-agent")))
        todo = answers[request.url.path]
        a = todo[0] if len(todo) == 1 else todo.pop(0)
        if a == "timeout":
            raise httpx.ReadTimeout("slow", request=request)
        if isinstance(a, dict):
            return httpx.Response(a[request.method])
        return httpx.Response(a)

    return httpx.MockTransport(handler), seen


async def add(db, client_admin, path, **extra):
    r = await client_admin.post("/api/admin/jobs", json={**JOB, "applyUrl": f"https://acme.example{path}",
                                                         "title": f"Job {path}", **extra})  # fmt: skip
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_dead_link_check(admin_client, db, monkeypatch):
    monkeypatch.setattr(linkcheck, "SAME_SITE_GAP", 0)
    owner = await admin_client("owner")
    dead = await add(db, owner, "/dead")
    good = await add(db, owner, "/good")
    shy = await add(db, owner, "/shy")
    slow = await add(db, owner, "/slow")
    nohead = await add(db, owner, "/nohead")
    email = (await owner.post("/api/admin/jobs", json={**JOB, "applyMethod": "email", "applyUrl": "",
                                                        "applyEmail": "a@b.example"})).json()["id"]  # fmt: skip
    expired = await add(db, owner, "/old", closesAt=(now() + timedelta(hours=1)).isoformat())
    await db[JOBS].update_one({"_id": expired}, {"$set": {"closes_at": now() - timedelta(minutes=1)}})
    transport, seen = server({"/dead": [404], "/good": [200], "/shy": [403], "/slow": ["timeout"],
                              "/nohead": [{"HEAD": 405, "GET": 200}]})  # fmt: skip
    first = await linkcheck.run(db, transport)
    assert first == {"checked": 5, "failed": 2, "closed": 0, "expired": 1}
    assert all(ua.startswith("Nm7LinkCheck/") for *_, ua in seen)
    assert ("GET", "acme.example", "/nohead", seen[0][3]) in [(m, h, p, u) for m, h, p, u in seen]
    jobs = {j["_id"]: j async for j in db[JOBS].find()}
    assert jobs[good]["link_check"]["ok"] is True and jobs[good]["link_check"]["fails"] == 0
    assert jobs[shy]["link_check"]["ok"] is None and jobs[shy]["link_check"]["fails"] == 0  # no verdict
    assert jobs[dead]["link_check"]["fails"] == 1 and jobs[dead]["status"] == "active"
    assert jobs[slow]["link_check"]["error"] == "no answer in 10 seconds"
    assert jobs[nohead]["link_check"]["ok"] is True
    assert jobs[email]["link_check"]["at"] is None  # email jobs aren't checked
    assert jobs[expired]["status"] == "closed" and jobs[expired]["closed_reason"] == "the closing date has passed"
    # checked today: not again until tomorrow
    assert (await linkcheck.run(db, transport))["checked"] == 0
    await db[JOBS].update_many({}, {"$set": {"link_check.at": now() - timedelta(hours=21)}})
    # /good now fails once; /dead fails again → closed
    transport, _ = server({"/dead": [404], "/good": [500], "/shy": [429], "/slow": [200], "/nohead": [200]})
    second = await linkcheck.run(db, transport)
    assert second["closed"] == 1
    jobs = {j["_id"]: j async for j in db[JOBS].find()}
    assert jobs[dead]["status"] == "closed"
    assert jobs[dead]["closed_reason"] == "apply link failed twice in a row (HTTP 404)"
    assert jobs[good]["status"] == "active" and jobs[good]["link_check"]["fails"] == 1
    assert jobs[slow]["link_check"]["fails"] == 0  # a good answer resets
    assert await db[AUDIT_LOG].count_documents({"action": "job.link_closed", "target": dead}) == 1
    # the admin reopens it: counted from zero again, and it shows on the expired list until then
    ex = [x["id"] for x in (await owner.get("/api/admin/jobs/expired")).json()]
    assert dead in ex and good in ex
    await owner.post(f"/api/admin/jobs/{dead}/status", json={"status": "active"})
    j = await db[JOBS].find_one({"_id": dead})
    assert j["status"] == "active" and j["link_check"]["fails"] == 0
