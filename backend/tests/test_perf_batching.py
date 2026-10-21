"""Fewer, smaller queries: shared-resume rows without the whole resume, filters applied in Mongo first, and the
batched helpers (recruiter link counts, work lists, free-download checks, the experts page) giving exactly what
the one-at-a-time versions gave."""

import os
from datetime import timedelta

import pytest
from pymongo import AsyncMongoClient, monitoring

from app.core.db import JOB_PROFILES, MEMBERSHIPS, ORDER_WORK, ORDERS, RECRUITER_LINKS
from app.core.time import now
from app.experts.service import active_order_counts, load_profiles
from app.orders.models import Order
from app.orgs.recruiter import live_counts, live_rows
from app.orgs.service import (
    filter_rows,
    group_downloads_free,
    membership_match,
    printable,
    row_out,
    shared_rows,
)
from app.work.service import load_work, view, views
from tests.conftest import approved_expert, buy, signup
from tests.test_orgs import RESUME, join, member, setup_group
from tests.test_orgs_kiosk import features
from tests.test_orgs_recruiter import make_link, opted_in

BIG = {
    **RESUME,
    "summary": "x" * 20_000,
    "exp": [*RESUME["exp"], {"company": "Wipro", "role": "Dev", "bullets": ["y" * 5_000]}],
}


class Counter(monitoring.CommandListener):
    """Counts the read commands a piece of code sends (find / aggregate / count), by collection."""

    def __init__(self):
        self.reads: list[str] = []

    def started(self, event):
        if event.command_name in ("find", "aggregate", "count"):
            self.reads.append(f"{event.command_name}:{event.command[event.command_name]}")

    def succeeded(self, event):
        pass

    def failed(self, event):
        pass


@pytest.fixture
async def counted():
    """(db, counter): the same test database through a client that counts every read command."""
    counter = Counter()
    client = AsyncMongoClient(os.environ["MONGODB_URI"], tz_aware=True, event_listeners=[counter])
    yield client[os.environ["MONGODB_DB"]], counter
    await client.close()


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def members(owner, make_client, outbox, n=3, data=None):
    org, g = await setup_group(owner)
    ids = []
    for i in range(n):
        c, _ = await member(make_client, outbox, f"p{i}@example.com", f"Person {i}", data)
        r = await join(c, roll=f"21A0{i}")
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    return org, g, ids


# ---------- #7: rows without the resume ----------


async def test_rows_carry_the_resume_only_when_asked(owner, make_client, outbox, db):
    org, g, ids = await members(owner, make_client, outbox, data=BIG)
    light = await shared_rows(db, {"group_id": g["id"]})
    full = await shared_rows(db, {"group_id": g["id"]}, with_data=True)
    assert len(light) == len(full) == 3
    assert all("_data" not in r for r in light) and all(r["_data"]["summary"] == BIG["summary"] for r in full)
    assert [row_out(r) for r in light] == [row_out(r) for r in full]  # the table is the same either way
    assert light[0]["completeness"] == 100 and light[0]["template"] == "fresher" and light[0]["name"] == "Asha Rao"
    with pytest.raises(RuntimeError):
        printable(light[0])
    assert printable(full[0])["exp"] == [
        {"company": "Infosys", "role": "Intern"},
        {"company": "Wipro", "role": "Dev", "bullets": ["y" * 5_000]},
    ]


async def test_list_pages_do_not_read_whole_resumes(owner, make_client, outbox, counted):
    await members(owner, make_client, outbox, data=BIG)
    db, counter = counted
    rows = await shared_rows(db, {"org_id": {"$ne": None}})
    assert len(rows) == 3
    assert [c for c in counter.reads] == [
        "find:memberships",
        "find:users",
        "find:org_groups",
        "find:organizations",
        "find:resumes",
    ]


async def test_mongo_prefilter_matches_the_python_filters(owner, make_client, outbox, db):
    org, g, ids = await members(owner, make_client, outbox, n=4)
    t = now()
    await db[MEMBERSHIPS].update_one({"_id": ids[0]}, {"$set": {"approval": "pending"}})
    await db[MEMBERSHIPS].update_one({"_id": ids[1]}, {"$set": {"approval": "rejected", "review_status": "ready"}})
    await db[MEMBERSHIPS].update_one(
        {"_id": ids[2]}, {"$set": {"review_status": "ready", "printed_at": t, "joined_at": t - timedelta(days=10)}}
    )
    await db[MEMBERSHIPS].update_one({"_id": ids[3]}, {"$set": {"review_status": "needs_changes"}})
    day = lambda d: (t + timedelta(days=d)).date().isoformat()  # noqa: E731
    cases = [
        {},
        {"approval": "all"},
        {"approval": "pending"},
        {"approval": "rejected"},
        {"approval": "all", "review": "none"},
        {"approval": "all", "review": "ready"},
        {"review": "needs_changes"},
        {"approval": "all", "not_printed": True},
        {"approval": "all", "ready_not_printed": True},
        {"approval": "all", "joined_from": day(-3)},
        {"approval": "all", "joined_to": day(-3)},
        {"approval": "all", "joined_from": day(-30), "joined_to": day(0)},
        {"approval": "all", "joined_from": day(1)},
    ]
    everything = await shared_rows(db, {"group_id": g["id"]})
    seen = set()
    for f in cases:
        expected = sorted(r["membership_id"] for r in filter_rows(everything, f))
        pre = await shared_rows(db, {"group_id": g["id"], **membership_match(f)})
        assert sorted(r["membership_id"] for r in pre) == expected, f
        assert sorted(r["membership_id"] for r in filter_rows(pre, f)) == expected, f
        seen.add(len(expected))
    assert {0, 1, 2, 3, 4} & seen and max(seen) == 4  # the cases really do cut the set in different ways


# ---------- #39: batched helpers ----------


async def test_group_downloads_free_reads_groups_once(owner, make_client, outbox, counted, db):
    org, g, _ = await members(owner, make_client, outbox, n=1)
    o2 = (await owner.post("/api/admin/orgs", json={"name": "Skill Hub", "type": "skill_centre"})).json()
    g2 = (await owner.post(f"/api/admin/orgs/{o2['id']}/groups", json={"name": "Welders", "code": "WELD26"})).json()
    r = await owner.patch(f"/api/admin/groups/{g2['id']}", json={"settings": {"membersDownloadFree": True}})
    assert r.status_code == 200, r.text
    c, me = await member(make_client, outbox, "two@example.com", "Two Groups")
    assert (await join(c)).status_code == 201
    assert (await join(c, code="WELD26", roll="", branch="")).status_code == 201
    cdb, counter = counted
    assert await group_downloads_free(cdb, me["id"]) is True
    # not one group query per membership; one read of the paying organizations (their plan must include it)
    assert counter.reads == ["find:memberships", "find:org_groups", "find:organizations"]
    await db[MEMBERSHIPS].update_many({"user_id": me["id"]}, {"$set": {"left_at": now()}})
    assert await group_downloads_free(db, me["id"]) is False


async def test_link_counts_equal_live_rows_per_link(owner, make_client, outbox, db, counted):
    org, g = await setup_group(owner)
    await features(owner, org["id"], recruiter_links=True)
    r = await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    assert r.status_code == 200
    joined = []
    for i in range(4):
        _, j = await opted_in(make_client, outbox, f"c{i}@example.com", f"Cand {i}", roll=f"21A0{i}")
        joined.append(j["id"])
    links = []
    for ids in (joined[:2], joined[1:], joined):
        link, _ = await make_link(owner, org["id"], ids=ids)
        links.append(link["id"])
    # one candidate leaves, one link expires, one is revoked
    await db[MEMBERSHIPS].update_one({"_id": joined[0]}, {"$set": {"left_at": now()}})
    await db[RECRUITER_LINKS].update_one({"_id": links[1]}, {"$set": {"expires_at": now() - timedelta(days=1)}})
    await db[RECRUITER_LINKS].update_one({"_id": links[2]}, {"$set": {"revoked_at": now()}})
    docs = await db[RECRUITER_LINKS].find({"_id": {"$in": links}}).to_list(None)
    per_link = {}
    for lk in docs:
        per_link[lk["_id"]] = (
            len(await live_rows(db, lk)) if not (lk.get("revoked_at") or lk["expires_at"] <= now()) else 0
        )
    cdb, counter = counted
    assert await live_counts(cdb, docs) == per_link == {links[0]: 1, links[1]: 0, links[2]: 0}
    assert len([c for c in counter.reads if c == "find:memberships"]) == 1  # one pass for all the links


async def test_work_list_equals_one_view_per_order(client, outbox, make_client, db, razorpay, admin_client):
    await signup(client, outbox)
    orders = [(await buy(client))[1]["id"] for _ in range(3)]
    expert, expert_id = await approved_expert(make_client, outbox, db)
    admin = await admin_client("ops")
    for oid in orders[:2]:
        assert (await admin.post(f"/api/admin/orders/{oid}/assign", json={"expertId": expert_id})).status_code == 200
    original = {
        "personal": {"name": "Sai"},
        "pinfo": {"father": "Rao"},
        "prefs": {"salaryMin": 5},
        "hidden": {"pinfo": True},
    }
    assert (await client.patch(f"/api/work/{orders[0]}", json={"original": original})).status_code == 200
    customer_id = (await db[ORDERS].find_one({"_id": orders[0]}))["customer_id"]
    privacy = {"experts": True, "salary": False, "personal": False}
    await db[JOB_PROFILES].update_one({"_id": customer_id}, {"$set": {"privacy": privacy}}, upsert=True)
    for side, q in (("customer", {"_id": {"$in": orders}}), ("expert", {"_id": {"$in": orders[:2]}})):
        docs = [Order.load(o) for o in await db[ORDERS].find(q).sort("paid_at", -1).to_list(None)]
        assert [await view(db, o, await load_work(db, o.id), side) for o in docs] == await views(db, docs, side)
    mine = (await expert.get("/api/work")).json()
    assert [w["id"] for w in mine] == sorted(orders[:2], reverse=True) or len(mine) == 2
    assert mine[-1]["original"] == {
        "personal": {"name": "Sai"},
        "prefs": {},
        "hidden": {"pinfo": True},
    }  # consent rules still apply
    assert (await client.get("/api/work")).json() == await views(
        db,
        [Order.load(o) for o in await db[ORDERS].find({"_id": {"$in": orders}}).sort("paid_at", -1).to_list(None)],
        "customer",
    )


async def test_experts_page_helpers_equal_per_expert_queries(make_client, outbox, db, admin_client, counted):
    ids = []
    for i in range(3):
        _, uid = await approved_expert(make_client, outbox, db, email=f"e{i}@example.com", name=f"Expert {i}")
        ids.append(uid)
    await db[ORDER_WORK].insert_many(
        [
            {"_id": "RS-1", "expert_id": ids[0], "accepted_at": now(), "data": {}},
            {"_id": "RS-2", "expert_id": ids[0], "accepted_at": now(), "data": {}},
            {"_id": "RS-3", "expert_id": ids[0], "accepted_at": None, "data": {}},  # offered, not accepted
            {"_id": "RS-4", "expert_id": ids[1], "accepted_at": now(), "data": {}},
        ]
    )
    cdb, counter = counted
    counts = await active_order_counts(cdb, ids)
    profiles = {p["_id"] for p in await load_profiles(cdb, ids)}
    assert counts == {ids[0]: 2, ids[1]: 1} and profiles == set(ids)
    assert counter.reads == ["aggregate:order_work", "find:expert_profiles"]
    for uid in ids:
        assert counts.get(uid, 0) == await db[ORDER_WORK].count_documents(
            {"expert_id": uid, "accepted_at": {"$ne": None}}
        )
    admin = await admin_client("ops")
    page = (await admin.get("/api/admin/experts")).json()
    assert {e["id"]: e["orders"] for e in page} == {ids[0]: 2, ids[1]: 1, ids[2]: 0}
