"""Admin → Organizations → "Reset and open as coordinator" took ~40 s on the live server (27 Nov): ~290 database round
trips one after another, each a network hop to the database, and four slow password hashes. The reset now builds the
records in memory and writes them with one insert_many per collection, a few calls at a time, with one shared hash.

These tests add a made-up network delay to every database call, so they catch a slide back to one write per record
whatever the speed of the machine running them: at 40 ms a hop, the old reset took over 11 s; the new one about 0.5 s.
"""

import asyncio
import time

import pytest
from pymongo.asynchronous import pool

from app.core import security
from app.core.db import ALUMNI, DRIVES, JOBS, MEMBERSHIPS, OFFERS, ORG_STAFF, ORGANIZATIONS, RESUMES, ROLL_LISTS, USERS
from app.orgs import demo
from app.orgs.demo import COORDINATOR_ID, ORG_ID

HOP = 0.04  # seconds per database round trip (the live server to its database is a few times this)


@pytest.fixture
def slow_network(monkeypatch):
    """Every message to the database waits HOP first, as if it crossed a network. Counts the round trips."""
    trips = {"n": 0}
    real = pool.AsyncConnection.send_message

    async def delayed(self, *a, **kw):
        trips["n"] += 1
        await asyncio.sleep(HOP)
        return await real(self, *a, **kw)

    monkeypatch.setattr(pool.AsyncConnection, "send_message", delayed)
    return trips


@pytest.fixture
def hashes(monkeypatch):
    n = {"n": 0}
    real = security.hash_password

    async def counted(pw):
        n["n"] += 1
        return await real(pw)

    monkeypatch.setattr(demo, "hash_password", counted)
    return n


async def test_reset_is_a_few_round_trips_not_one_per_record(db, slow_network, hashes):
    await demo.create_demo(db)  # a reset over an existing demo college, like the button
    slow_network["n"] = hashes["n"] = 0
    t = time.perf_counter()
    out = await demo.create_demo(db, "admin-1")
    took = time.perf_counter() - t
    assert out["students"] == 48
    assert slow_network["n"] <= 60, slow_network["n"]  # was ~290
    assert hashes["n"] == 1  # one unusable hash for every demo account (was four, ~64 MB of memory each)
    assert took < 6, f"reset took {took:.1f} s"  # ~0.5 s; the old one-by-one writes took over 11 s here


async def test_reset_then_open_as_coordinator_shows_the_demo_college(admin_client, db):
    owner = await admin_client("owner")
    for _ in range(2):  # a second reset is clean: same data, no duplicate keys
        r = await owner.post("/api/admin/demo-org")
        assert r.status_code == 200, r.text
        assert r.json()["students"] == 48 and r.json()["recruiterPath"].startswith("/recruiter/")
    assert await db[ORGANIZATIONS].count_documents({"_id": ORG_ID, "demo": True}) == 1
    assert await db[MEMBERSHIPS].count_documents({"org_id": ORG_ID}) == 48
    assert await db[RESUMES].count_documents({"user_id": {"$regex": "^demo-u-"}}) > 30
    assert await db[ROLL_LISTS].count_documents({"org_id": ORG_ID}) == 2
    assert await db[USERS].count_documents({"email": {"$regex": r"@demo\.nm7\.invalid$"}, "demo": True}) == 54
    assert await db[ORG_STAFF].count_documents({"org_id": ORG_ID}) == 2
    assert await db[DRIVES].count_documents({"org_id": ORG_ID}) == 1
    assert await db[OFFERS].count_documents({"org_id": ORG_ID}) > 10
    assert await db[ALUMNI].count_documents({"org_id": ORG_ID}) == 4
    assert await db[JOBS].count_documents({"demo": True}) == 30
    # then "open as coordinator": the admin's college view opens /org/demo-engineering-college
    r = await owner.post("/api/admin/views/switch", json={"role": "college"})
    assert r.status_code == 200 and r.json()["path"] == f"/org/{ORG_ID}"
    assert (await owner.get("/api/auth/me")).json()["id"] == COORDINATOR_ID
    home = await owner.get(f"/api/org/{ORG_ID}")
    assert home.status_code == 200 and home.json()["role"] == "coordinator"
    for p in ("/drives", "/offers", "/alumni/summary", "/reviewers"):
        assert (await owner.get(f"/api/org/{ORG_ID}{p}")).status_code == 200, p
