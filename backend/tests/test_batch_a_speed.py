"""Batch A (20 Nov live test): the slow paths that timed out on the live server.

1. Admin → Companies → "Reset and open as company (Hire in 60 minutes)": the 30 made-up people are written with one
   insert per collection, not ~150 one-by-one writes, so the reset finishes well inside the page's 25 s.
4. /api/me/skill-checks: a cold bank load (after a deploy) or a slow job count never holds the page up: it answers
   with the questions already stored and finishes the load in the background.
"""

import asyncio

import pytest
from pymongo.asynchronous.collection import AsyncCollection

from app.core.db import HIRE_EVENTS, HIRE_PROFILES, RESUMES, SKILL_ATTEMPTS, USERS
from app.hire import demo as hire_demo
from app.hire.vetting import router as vr
from app.hire.vetting import store
from tests.test_companies_apply import student


@pytest.fixture(autouse=True)
def vetting_public(monkeypatch):
    from app.hire.vetting import access

    async def public(db):
        return {"public": True, "testers": []}

    monkeypatch.setattr(access, "settings", public)


async def test_hire_demo_writes_people_in_a_few_round_trips(db, monkeypatch):
    calls = {"one": 0}
    real = AsyncCollection.insert_one

    async def counted(self, *a, **kw):
        calls["one"] += 1
        return await real(self, *a, **kw)

    monkeypatch.setattr(AsyncCollection, "insert_one", counted)
    before = calls["one"]
    from app.companies import demo as company_demo

    await company_demo.create(db)
    company_only = calls["one"] - before
    calls["one"] = 0
    out = await hire_demo.create(db)
    assert out["candidates"] == 30
    # the plain company reset's own writes, plus a handful for the bulk post, slots, invite, offer: never one per person
    assert calls["one"] - company_only <= 10, calls["one"]
    assert await db[USERS].count_documents({"_id": {"$regex": "^hire-demo-"}, "demo": True}) == 30
    assert await db[RESUMES].count_documents({"user_id": {"$regex": "^hire-demo-"}}) == 30
    assert await db[HIRE_PROFILES].count_documents({"_id": {"$regex": "^hire-demo-"}, "on": True}) == 30
    shared = await db[SKILL_ATTEMPTS].find({"user_id": {"$regex": "^hire-demo-"}}).to_list(100)
    assert shared and all(a["share"] and len(a["question_ids"]) == 10 for a in shared)
    assert await db[HIRE_EVENTS].count_documents({"user_id": {"$regex": "^hire-demo-"}}) > 0
    # a second reset is clean (no duplicate key errors, same numbers)
    await hire_demo.create(db)
    assert await db[USERS].count_documents({"_id": {"$regex": "^hire-demo-"}}) == 30


async def test_skill_checks_answer_while_the_banks_are_still_loading(make_client, outbox, db, monkeypatch):
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    assert (await c.get("/api/me/skill-checks")).status_code == 200  # loaded once, the normal way

    gate = asyncio.Event()
    real = store._load_all

    async def slow(db_):
        await gate.wait()  # a cold load that takes "forever"
        await real(db_)

    monkeypatch.setattr(store, "_load_all", slow)
    monkeypatch.setattr(store, "WAIT", 0.2)
    monkeypatch.setattr(store, "_LOAD", None)
    r = await asyncio.wait_for(c.get("/api/me/skill-checks"), 5)
    assert r.status_code == 200 and r.json()["roles"]  # answered with the stored questions
    assert store._LOAD is not None and not store._LOAD.done()  # still loading in the background
    gate.set()
    await asyncio.wait_for(store._LOAD, 5)
    assert await store.banks_ready(db, wait=1)


async def test_skill_checks_answer_while_the_demand_count_is_slow(make_client, outbox, db, monkeypatch):
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    gate = asyncio.Event()

    async def slow(db_):
        await gate.wait()
        return {"SQL": 7}

    monkeypatch.setattr(vr, "_count_demand", slow)
    monkeypatch.setattr(vr, "DEMAND_WAIT", 0.2)
    monkeypatch.setattr(vr, "_DEMAND", {"at": None, "counts": {}, "task": None})
    r = await asyncio.wait_for(c.get("/api/me/skill-checks"), 5)
    assert r.status_code == 200 and all(x["demand"] == 0 for x in r.json()["roles"])
    gate.set()
    await asyncio.wait_for(vr._DEMAND["task"], 5)


async def test_a_failed_bank_load_never_fails_the_page(make_client, outbox, db, monkeypatch):
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    assert (await c.get("/api/me/skill-checks")).status_code == 200

    async def broken(db_):
        raise RuntimeError("database hiccup")

    monkeypatch.setattr(store, "_load_all", broken)
    monkeypatch.setattr(store, "_LOAD", None)
    assert (await c.get("/api/me/skill-checks")).status_code == 200
    assert await store.banks_ready(db) is False
