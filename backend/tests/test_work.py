"""Order fulfilment between the customer, the assigned expert and admins."""

from app.core.db import ORDER_WORK, ORDERS
from tests.conftest import approved_expert, buy, signup


def err(r):
    return r.json()["error"]["code"]


async def setup_order(client, outbox, make_client, db, razorpay, admin_client):
    await signup(client, outbox)
    _, order = await buy(client)
    expert, expert_id = await approved_expert(make_client, outbox, db)
    admin = await admin_client("ops")
    r = await admin.post(f"/api/admin/orders/{order['id']}/assign", json={"expertId": expert_id})
    assert r.status_code == 200, r.text
    return order["id"], expert, expert_id, admin


async def test_full_flow(client, outbox, make_client, db, razorpay, admin_client):
    oid, expert, _, admin = await setup_order(client, outbox, make_client, db, razorpay, admin_client)
    # customer: intake + a message
    r = await client.patch(f"/api/work/{oid}", json={"intake": {"target": "Data Analyst"}, "role": "Data Analyst"})
    assert r.status_code == 200, r.text
    r = await client.patch(f"/api/work/{oid}", json={"messages": [{"from": "expert", "text": "Hi!"}]})
    assert r.json()["messages"][0]["from"] == "customer"  # can't speak for the expert

    # expert sees it, accepts, saves a private draft, then sends it
    mine = (await expert.get("/api/work")).json()
    assert [w["id"] for w in mine] == [oid] and mine[0]["status"] == "offer"
    assert (await expert.patch(f"/api/work/{oid}", json={"status": "progress"})).json()["status"] == "progress"
    assert (await db[ORDERS].find_one({"_id": oid}))["status"] == "in_progress"
    draft = {"n": 1, "label": "Draft 1", "data": {"summary": "x"}, "sent": False}
    await expert.patch(f"/api/work/{oid}", json={"versions": [draft]})
    assert (await client.get(f"/api/work/{oid}")).json()["versions"] == []  # unsent drafts stay private
    r = await expert.patch(f"/api/work/{oid}", json={"versions": [{**draft, "sent": True}], "status": "waiting"})
    assert r.status_code == 200
    assert len((await client.get(f"/api/work/{oid}")).json()["versions"]) == 1

    # customer can't change the expert's drafts or deliver; asks for changes, then approves with a rating
    assert err(await client.patch(f"/api/work/{oid}", json={"versions": []})) == "not_allowed"
    assert err(await client.patch(f"/api/work/{oid}", json={"status": "delivered"})) == "bad_status"
    assert err(await client.patch(f"/api/work/{oid}", json={"rating": 5})) == "bad_status"
    assert (await client.patch(f"/api/work/{oid}", json={"status": "revision"})).json()["status"] == "revision"
    r = await expert.patch(f"/api/work/{oid}", json={"status": "delivered"})
    assert r.json()["status"] == "delivered" and r.json()["deliveredAt"]
    r = await client.patch(f"/api/work/{oid}", json={"status": "approved", "rating": 5, "review": "Great"})
    assert r.json()["status"] == "approved" and r.json()["rating"] == 5
    # admin can read it but not write in the chat
    assert (await admin.get(f"/api/work/{oid}")).status_code == 200
    assert (await admin.get(f"/api/admin/orders/{oid}")).json()["work"]["rating"] == 5


async def test_strangers_get_404(client, outbox, make_client, db, razorpay, admin_client):
    oid, _, _, _ = await setup_order(client, outbox, make_client, db, razorpay, admin_client)
    other_customer = make_client()
    await signup(other_customer, outbox, "x@example.com")
    other_expert, _ = await approved_expert(make_client, outbox, db, "e2@example.com", "Other Expert")
    for c in (other_customer, other_expert):
        assert (await c.get(f"/api/work/{oid}")).status_code == 404
        assert (await c.patch(f"/api/work/{oid}", json={"messages": [{"text": "hi"}]})).status_code == 404
    assert (await other_customer.get("/api/work")).json() == []
    assert (await other_expert.get("/api/work")).json() == []
    support = await admin_client("finance")  # no "orders" permission
    assert (await support.get(f"/api/work/{oid}")).status_code == 404


async def test_decline_returns_order_to_queue(client, outbox, make_client, db, razorpay, admin_client):
    oid, expert, _, admin = await setup_order(client, outbox, make_client, db, razorpay, admin_client)
    r = await expert.patch(f"/api/work/{oid}", json={"status": "declined"})
    assert r.status_code == 200
    assert (await db[ORDER_WORK].find_one({"_id": oid}))["expert_id"] is None
    assert (await expert.get(f"/api/work/{oid}")).status_code == 404
    assert (await admin.get("/api/admin/stats")).json()["unassigned"] == 1


async def test_expired_offer_cannot_be_accepted(client, outbox, make_client, db, razorpay, admin_client):
    from datetime import timedelta

    from app.core.time import now

    oid, expert, _, admin = await setup_order(client, outbox, make_client, db, razorpay, admin_client)
    await db[ORDER_WORK].update_one({"_id": oid}, {"$set": {"offer_expires_at": now() - timedelta(minutes=1)}})
    assert err(await expert.patch(f"/api/work/{oid}", json={"status": "progress"})) == "offer_expired"
    r = await admin.post("/api/admin/automation/run")
    assert r.json()["acted"]["offer_timeout"] == 1
    assert (await db[ORDER_WORK].find_one({"_id": oid}))["expert_id"] is None


async def test_assign_needs_approved_expert(client, outbox, make_client, db, razorpay, admin_client):
    await signup(client, outbox)
    _, order = await buy(client)
    pending = make_client()
    me = await signup(pending, outbox, "p@example.com", role="expert", name="Pending")
    admin = await admin_client("ops")
    r = await admin.post(f"/api/admin/orders/{order['id']}/assign", json={"expertId": me["id"]})
    assert err(r) == "bad_expert"
    assert (await pending.get("/api/work")).json() == []
