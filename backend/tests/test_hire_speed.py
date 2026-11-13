"""Phase 5 H9: hiring speed from real events (minutes to first candidate, invite accepted, interview, offer; % of roles
in 30 minutes; funnel), the "Hired in 30 minutes" badge only when a real role did it, the admin supply map (real
people only), and the demo (30 candidates, a bulk post, slots, one offer; never shown to real companies)."""

from datetime import timedelta

from app.core.db import COMPANIES, HIRE_INVITES, HIRE_OFFERS, HIRE_PROFILES, HIRE_SLOTS, JOBS, USERS
from app.core.time import now
from app.hire import speed as sp
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401
from tests.test_hire_shortlist import post_job, ready
from tests.test_hire_slots import accepted, when


def test_math():
    t = now()
    fast = {"posted": t, "shown": t + timedelta(minutes=1), "accepted": t + timedelta(minutes=8),
            "interview": t + timedelta(minutes=25), "offer": None}  # fmt: skip
    slow = {**fast, "interview": t + timedelta(minutes=45), "offer": t + timedelta(hours=3)}
    assert sp.in_goal(fast) and not sp.in_goal(slow)
    assert not sp.in_goal({**fast, "interview": None})  # nothing booked or offered: not "hired in 30"
    assert sp.minutes(t, t + timedelta(seconds=150)) == 2 and sp.minutes(t, None) is None
    roles = [{"minutes": {"shown": 1, "accepted": 8, "interview": 25, "offer": None}, "in30": True},
             {"minutes": {"shown": 3, "accepted": None, "interview": None, "offer": None}, "in30": False},
             {"minutes": dict.fromkeys(("shown", "accepted", "interview", "offer")), "in30": False}]  # fmt: skip
    s = sp.summary(roles)
    assert s["roles"] == 2 and s["in30"] == 1 and s["in30Pct"] == 50 and s["avgMinutes"]["shown"] == 2
    assert sp.domain_for(["Tally", "GST", "SQL"]) == "Accounts" and sp.domain_for([]) == "Other"


async def test_speed_board_and_badge(client, outbox, db, make_client):
    session, cid, job, asha, uid = await accepted(client, outbox, db, make_client)  # shortlist run + invite accepted
    slug = (await db[COMPANIES].find_one({"_id": cid}))["slug"]
    page = (await client.get(f"/api/companies/{slug}")).json()
    assert page["hiredIn30"] is False  # no interview or offer yet
    one = {"job": job, "slots": [{**when(30), "place": "Office"}]}
    sid = (await client.post(f"/api/company/{cid}/hire/slots", json=one, headers=H(session))).json()["items"][0]["id"]
    await asha.post(f"/api/me/hire/slots/{sid}/book", json={})
    out = (await client.get(f"/api/company/{cid}/hire/speed", headers=H(session))).json()
    row = next(r for r in out["items"] if r["id"] == job)
    assert row["in30"] and row["minutes"]["shown"] is not None and row["minutes"]["interview"] is not None
    assert out["in30Pct"] == 100 and out["badge"] is True
    assert out["funnel"]["invited"] == 1 and out["funnel"]["accepted"] == 1 and out["funnel"]["interviews"] == 1
    assert (await client.get(f"/api/companies/{slug}")).json()["hiredIn30"] is True
    # an old post that took hours: not in 30 minutes, and the badge needs a real role
    await db[JOBS].update_one({"_id": job}, {"$set": {"posted_at": now() - timedelta(hours=5)}})
    out = (await client.get(f"/api/company/{cid}/hire/speed", headers=H(session))).json()
    assert out["in30Pct"] == 0 and out["badge"] is False
    assert (await client.get(f"/api/companies/{slug}")).json()["hiredIn30"] is False
    _ = uid


async def test_supply_map_real_people_only(client, outbox, db, make_client, admin_client):
    session, cid = await verified(client, outbox, db)
    await post_job(client, session, cid)  # one live job in Hyderabad
    await ready(make_client, outbox, "asha@example.com", "Asha Rao")
    await ready(make_client, outbox, "bala@example.com", "Bala K", cities=["Pune"], remote=True)
    await ready(make_client, outbox, "demo@example.com", "Demo Person")
    await db[USERS].update_one({"email": "demo@example.com"}, {"$set": {"demo": True}})
    stale = await ready(make_client, outbox, "old@example.com", "Old One")
    old = (await db[USERS].find_one({"email": "old@example.com"}))["_id"]
    await db[HIRE_PROFILES].update_one({"_id": old}, {"$set": {"confirmed_at": now() - timedelta(days=9)}})
    owner = await admin_client()
    out = (await owner.get("/api/admin/hire/supply")).json()
    assert out["available"] == 2 and out["remote"] == 1
    by = {r["city"]: r for r in out["byCity"]}
    assert by["Hyderabad"] == {"city": "Hyderabad", "available": 1, "liveJobs": 1} and by["Pune"]["available"] == 1
    assert sum(d["available"] for d in out["byDomain"]) == 2
    _ = stale


async def test_demo(client, outbox, db, admin_client):
    owner = await admin_client()
    r = (await owner.post("/api/admin/demo-company/hire/open")).json()
    assert r["session"] and r["candidates"] == 30
    assert await db[HIRE_PROFILES].count_documents({"_id": {"$regex": "^hire-demo-"}}) == 30
    job = await db[JOBS].find_one({"_id": r["bulkJob"]})
    assert job["demo"] and job["hire_bulk"]["openings"] == 50
    assert await db[HIRE_SLOTS].count_documents({"job_id": job["_id"], "status": "open"}) == 3
    # round C: the demo story is in order (invite → accepted → interview booked → attended → offer sent)
    from app.hire.bulk import board

    b = await board(db, job["company_id"], job)
    assert [b[k] for k in ("invited", "accepted", "interviewsBooked", "attended", "offersSent", "offersAccepted")] == [
        1,
        1,
        1,
        1,
        1,
        0,
    ]
    assert b["stages"] == {"offer": 1} and b["toOffer"] == [] and b["toInterview"] == []
    assert await db[HIRE_OFFERS].count_documents({"job_id": job["_id"], "status": "sent"}) == 1
    # one live-job slot is left (13 Nov live test: it started at 3 of 3, so Post a job couldn't be tried)
    from app.companies.limits import posting_room

    lim = await posting_room(db, await db[COMPANIES].find_one({"_id": job["company_id"]}))
    assert lim["allowed"] and lim["used"] == lim["limit"] - 1, lim
    # the demo company sees demo people on the shortlist (with test results and history)
    sl = (await client.get(f"/api/company/{job['company_id']}/hire/shortlist", params={"job": job["_id"], "size": 50},
                           headers=H(r["session"]))).json()  # fmt: skip
    assert len(sl["items"]) >= 9
    assert any(x["skillCheck"] for x in sl["items"]) and any(x["reliability"]["score"] for x in sl["items"])
    assert any(x["reliability"]["label"] == "New - no history yet" for x in sl["items"])
    # demo people are never shown to a real company: test_hire_shortlist.test_demo_and_real_never_mix
    # a second reset gives a clean copy (no duplicates)
    await owner.post("/api/admin/demo-company/hire/open")
    assert await db[HIRE_PROFILES].count_documents({"_id": {"$regex": "^hire-demo-"}}) == 30
    assert await db[HIRE_INVITES].count_documents({"company_id": job["company_id"]}) == 1
