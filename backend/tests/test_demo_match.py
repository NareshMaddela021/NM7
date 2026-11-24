# ruff: noqa: E501
"""Demo match fix: in the demo company's Hire now, the made-up people who are ready to join have agreed to matching
(a demo-marked consent row, as consent.grant writes it), so the requirement strips show Met / Not met with a quote and
the top people for each demo job show about 85-95% instead of "50% match" with every requirement Unknown. Both demo
resets, only demo records, still a few writes.
"""

import time

import pytest
from pymongo.asynchronous.collection import AsyncCollection

from app.companies import demo as company_demo
from app.core.db import (
    JOBS,
    TRUST_CONSENTS,
    TRUST_CRITERIA,
    TRUST_CRITERIA_EVALS,
    TRUST_CRITERIA_QUEUE,
    TRUST_WORK_PREFS,
)
from app.core.time import now
from app.hire import demo as hire_demo
from app.trust.consent import PURPOSES
from app.trust.criteria import evaluate as EV
from app.trust.criteria.router import blend
from tests.test_companies_signup import H, no_network  # noqa: F401

CS, DA, SE = "Customer Support Executive", "Junior Data Analyst", "Software Engineer Trainee"
# the people who should lead each demo job, with the score Hire now shows (hire/demo.py DEMO_CV)
TOP = {CS: {"hire-demo-02": 91, "hire-demo-08": 91, "hire-demo-01": 88, "hire-demo-04": 88, "hire-demo-06": 88},
       DA: {"hire-demo-27": 90, "hire-demo-28": 88}, SE: {"hire-demo-29": 90, "hire-demo-30": 88}}  # fmt: skip


@pytest.fixture(autouse=True)
def vetting_public(monkeypatch):
    from app.hire.vetting import access

    async def public(db):
        return {"public": True, "testers": []}

    monkeypatch.setattr(access, "settings", public)


async def _rows(client, session, job):
    r = await client.get(f"/api/company/{company_demo.COMPANY_ID}/hire/shortlist", params={"job": job, "size": 50},
                         headers=H(session))  # fmt: skip
    assert r.status_code == 200, r.text
    return r.json()


def _check_top(title, data):
    rows = data["items"]
    shown = {x["key"]: blend(x["match"]["score"], x["criteria"]) for x in rows}
    for uid, want in TOP[title].items():
        assert shown.get(uid) == want, (title, uid, shown)
        assert 85 <= shown[uid] <= 95
    # the leaders come first, every strip is answered (agreed to matching, nothing waiting), each Met / Not met quoted
    lead = [x["key"] for x in rows[: len(TOP[title])]]
    assert set(lead) == set(TOP[title]), (title, lead)
    for x in rows:
        cr = x["criteria"]
        assert cr["consent"] and not cr["pending"]
        for it in cr["items"]:
            assert it["status"] == "unknown" or (it["quote"] and it["sourceLabel"]), it
    # a believable spread below the leaders, not everyone the same
    rest = sorted({v for k, v in shown.items() if k not in TOP[title]}, reverse=True)
    assert rest and max(rest) < min(TOP[title].values()) and len(rest) >= 3, (title, rest)
    top = rows[0]["criteria"]
    assert top["mustMet"] == top["mustTotal"] and any(
        i["status"] == "not_met" for r in rows for i in r["criteria"]["items"]
    )


async def test_hire_demo_people_agreed_to_matching_and_lead_with_high_scores(client, db, admin_client, monkeypatch):
    owner = await admin_client()
    r = (await owner.post("/api/admin/demo-company/hire/open")).json()
    rows = await db[TRUST_CONSENTS].find({"purpose": EV.PURPOSE}).to_list(100)
    assert len(rows) == 30 and {x["user_id"] for x in rows} == {f"hire-demo-{i:02d}" for i in range(1, 31)}
    p = PURPOSES[EV.PURPOSE]
    for x in rows:  # the row consent.grant writes, marked demo (DPDP)
        assert x["demo"] is True and x["channel"] == "demo" and x["version"] == p.version and x["withdrawn_at"] is None
    assert await EV.consented(db, [x["user_id"] for x in rows]) == {x["user_id"] for x in rows}
    assert await db[TRUST_WORK_PREFS].count_documents({"_id": {"$regex": "^hire-demo-"}, "demo": True}) == 30
    # the answers come from the stored cache (the real rules' answers): even with an AI key nothing is queued
    monkeypatch.setattr(EV, "ai_on", lambda: True)
    _check_top(CS, await _rows(client, r["session"], r["bulkJob"]))
    se = await db[JOBS].find_one({"company_id": company_demo.COMPANY_ID, "title": SE, "status": "active"})
    _check_top(SE, await _rows(client, r["session"], se["_id"]))
    assert await db[TRUST_CRITERIA_QUEUE].count_documents({}) == 0
    # a second reset is a clean copy
    r = (await owner.post("/api/admin/demo-company/hire/open")).json()
    assert await db[TRUST_CONSENTS].count_documents({"purpose": EV.PURPOSE}) == 30
    assert await db[TRUST_CRITERIA].count_documents({"company_id": company_demo.COMPANY_ID}) == 3  # CS, DA, SE
    _check_top(CS, await _rows(client, r["session"], r["bulkJob"]))


async def test_plain_demo_reset_matches_its_live_jobs(client, db, admin_client, monkeypatch):
    owner = await admin_client()
    r = (await owner.post("/api/admin/demo-company/open")).json()
    monkeypatch.setattr(EV, "ai_on", lambda: True)
    live = {
        j["title"]: j["_id"]
        for j in await db[JOBS].find({"company_id": company_demo.COMPANY_ID, "status": "active"}).to_list(20)
    }
    for title in (DA, SE):
        _check_top(title, await _rows(client, r["session"], live[title]))
    assert await db[TRUST_CRITERIA_QUEUE].count_documents({}) == 0


async def test_demo_matching_touches_only_demo_records(client, db, admin_client):
    t = now()
    real = "real-user-1"
    await db[TRUST_CONSENTS].insert_one({"user_id": real, "purpose": EV.PURPOSE, "version": 1, "granted_at": t,
                                         "withdrawn_at": None, "channel": "settings"})  # fmt: skip
    await db[TRUST_WORK_PREFS].insert_one({"_id": real, "languages": ["Telugu"], "updated_at": t})
    await db[TRUST_CRITERIA_EVALS].insert_one({"_id": f"{real}:abc", "user_id": real, "status": "met", "at": t})
    await db[TRUST_CRITERIA].insert_one({"_id": "real-job-1", "company_id": "real-co", "items": [], "edited": True})
    # a demo person's id on a row that isn't marked demo stays too (only rows this demo wrote are removed)
    await db[TRUST_CONSENTS].insert_one({"user_id": "hire-demo-99", "purpose": "profile_sharing", "version": 1,
                                         "granted_at": t, "withdrawn_at": None, "channel": "settings"})  # fmt: skip
    owner = await admin_client()
    for _ in range(2):
        await owner.post("/api/admin/demo-company/hire/open")
        await owner.post("/api/admin/demo-company/open")
    assert await db[TRUST_CONSENTS].count_documents({"user_id": real}) == 1
    assert await db[TRUST_CONSENTS].count_documents({"user_id": "hire-demo-99"}) == 1
    assert await db[TRUST_WORK_PREFS].count_documents({"_id": real}) == 1
    assert await db[TRUST_CRITERIA_EVALS].count_documents({"user_id": real}) == 1
    assert await db[TRUST_CRITERIA].count_documents({"_id": "real-job-1"}) == 1
    # what the demo wrote is all marked demo and only for the demo people / the demo company
    assert await db[TRUST_CONSENTS].count_documents({"demo": True, "user_id": {"$not": {"$regex": "^hire-demo-"}}}) == 0
    evals = await db[TRUST_CRITERIA_EVALS].find({"user_id": {"$ne": real}}).to_list(2000)
    assert evals and all(e["user_id"].startswith("hire-demo-") and e["demo"] for e in evals)
    crit = await db[TRUST_CRITERIA].find({"_id": {"$ne": "real-job-1"}}).to_list(20)
    assert crit and all(c["company_id"] == company_demo.COMPANY_ID and c["demo"] for c in crit)


async def test_demo_matching_stays_a_few_writes_and_fast(db, monkeypatch):
    from app.hire.skillcheck import ensure_bank

    await company_demo.create(db)
    await ensure_bank(db)  # the question bank (loaded once on a live site)
    calls = {"one": 0, "many": 0, "bulk": 0, "update": 0}
    real = {k: getattr(AsyncCollection, k) for k in ("insert_one", "insert_many", "bulk_write", "update_one")}

    def counted(name, key):
        async def inner(self, *a, **kw):
            calls[key] += 1
            return await real[name](self, *a, **kw)

        return inner

    for name, key in (("insert_one", "one"), ("insert_many", "many"), ("bulk_write", "bulk"), ("update_one", "update")):
        monkeypatch.setattr(AsyncCollection, name, counted(name, key))
    started = time.perf_counter()
    await hire_demo.seed_people(db)
    n = await hire_demo.seed_matching(db)
    took = time.perf_counter() - started
    assert n >= 30 * 10  # every demo person × every distinct requirement of the demo jobs
    assert calls["one"] == 0 and calls["update"] == 0, calls
    assert calls["many"] <= 9 and calls["bulk"] == 1, calls  # one insert per collection, one bulk write of answers
    assert took < 10, took
