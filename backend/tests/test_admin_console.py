"""Admin console endpoints: real numbers, empty states, actions with audit entries, and role permissions."""

from datetime import timedelta

import pytest

from app.core.db import AUDIT_LOG, ORDERS
from app.core.time import now
from tests.conftest import PASSWORD, buy, signup


def err(r):
    return r.json()["error"]["code"]


async def actions(db):
    return [a["action"] async for a in db[AUDIT_LOG].find({"action": {"$not": {"$regex": "^admin\\."}}}).sort("_id", 1)]


async def test_dashboard_starts_empty_then_counts(client, outbox, razorpay, admin_client):
    owner = await admin_client()
    s = (await owner.get("/api/admin/stats")).json()
    assert s["revenue"] == 0 and s["ordersPaid"] == 0 and s["customers"] == 0 and s["openOrders"] == 0
    await signup(client, outbox)
    await buy(client)
    s = (await owner.get("/api/admin/stats")).json()
    assert s["revenue"] == 99900 and s["ordersPaid"] == 1 and s["customers"] == 1
    assert s["openOrders"] == 1 and s["unassigned"] == 1 and s["ordersByPlan"] == {"expert": 1}


@pytest.mark.parametrize(
    ("role", "path", "ok"),
    [
        ("support", "/api/admin/customers", True),
        ("support", "/api/admin/settings", False),
        ("finance", "/api/admin/reports", True),
        ("finance", "/api/admin/customers", False),
        ("quality", "/api/admin/quality", True),
        ("quality", "/api/admin/team", False),
        ("ops", "/api/admin/automation", True),
        ("ops", "/api/admin/invoices", False),
    ],
)
async def test_permissions(admin_client, role, path, ok):
    c = await admin_client(role)
    assert (await c.get(path)).status_code == (200 if ok else 403)


async def test_customers_cannot_open_admin(client, outbox):
    await signup(client, outbox)
    for path in (
        "/api/admin/stats",
        "/api/admin/customers",
        "/api/admin/tickets",
        "/api/admin/settings",
        "/api/admin/team",
    ):
        assert (await client.get(path)).status_code == 403


async def test_customers_block_notes_and_tickets(client, outbox, make_client, db, admin_client):
    me = await signup(client, outbox, name="Asha Rao")
    await client.post("/api/me/tickets", json={"topic": "Payment", "text": "Charged twice"})
    support = await admin_client("support")

    rows = (await support.get("/api/admin/customers", params={"q": "asha"})).json()
    assert rows["total"] == 1 and rows["items"][0]["email"] == "sai@example.com"
    assert (await support.get("/api/admin/customers", params={"q": "nobody"})).json() == {"items": [], "total": 0}
    detail = (await support.get(f"/api/admin/customers/{me['id']}")).json()
    assert detail["orders"] == [] and detail["tickets"][0]["text"] == "Charged twice"

    tickets = (await support.get("/api/admin/tickets", params={"status": "open"})).json()
    assert len(tickets) == 1 and tickets[0]["customer"]["email"] == "sai@example.com"
    r = await support.post(
        f"/api/admin/tickets/{tickets[0]['id']}/reply", json={"reply": "Only one charge went through."}
    )
    assert r.json()["status"] == "resolved" and r.json()["emailed"]
    assert outbox.sent[-1].to == "sai@example.com" and "Only one charge" in outbox.sent[-1].text
    assert (await client.get("/api/me/tickets")).json()[0]["reply"] == "Only one charge went through."

    assert (await support.put(f"/api/admin/customers/{me['id']}/notes", json={"notes": "VIP"})).status_code == 200
    r = await support.post(f"/api/admin/customers/{me['id']}/block", json={"blocked": True, "reason": "fraud"})
    assert r.status_code == 200
    assert (await client.get("/api/auth/me")).status_code == 401  # signed out at once
    other = make_client()
    r = await other.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    assert r.status_code == 401 or err(r) == "account_disabled"
    await support.post(f"/api/admin/customers/{me['id']}/block", json={"blocked": False})
    assert (
        await other.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    ).status_code == 200
    assert await actions(db) == ["ticket.replied", "customer.notes", "customer.blocked", "customer.unblocked"]


async def test_prices_change_checkout_and_are_logged(client, outbox, razorpay, db, admin_client):
    owner = await admin_client()
    s = (await owner.get("/api/admin/settings")).json()
    assert s["plans"]["expert"]["amount"] == 99900 and s["deliveryHours"] == 48
    r = await owner.put(
        "/api/admin/settings",
        json={
            "plans": {"expert": {"amount": 89900, "active": True}, "launch": {"amount": 299900, "active": False}},
            "deliveryHours": 72,
        },
    )
    assert r.json()["plans"]["expert"]["amount"] == 89900 and r.json()["deliveryHours"] == 72
    pub = (await client.get("/api/public/prices")).json()
    assert pub["plans"]["expert"]["price"] == 899 and pub["plans"]["launch"]["active"] is False

    await signup(client, outbox)
    created, order = await buy(client)
    assert created["amount"] == 89900
    assert order["deadlineAt"] and order["paidAt"]
    r = await client.post("/api/orders", json={"planId": "launch", "addons": []})
    assert err(r) == "unknown_plan"
    entry = await db[AUDIT_LOG].find_one({"action": "settings.changed"})
    assert entry["data"]["plans.expert"]["from"]["amount"] == 99900 and entry["data"]["delivery_hours"]["to"] == 72
    assert (await owner.put("/api/admin/settings", json={"plans": {"expert": {"amount": 5}}})).status_code == 422


async def test_automation_rules(client, outbox, razorpay, db, admin_client):
    ops = await admin_client("ops")
    rules = (await ops.get("/api/admin/automation")).json()
    assert [r["id"] for r in rules] == ["expire_unpaid", "offer_timeout", "deadline_alert", "org_plan_reminders"]
    await signup(client, outbox)
    created, _ = await buy(client, pay=False)
    await db[ORDERS].update_one({"_id": created["orderId"]}, {"$set": {"created_at": now() - timedelta(hours=30)}})
    r = await ops.put("/api/admin/automation/expire_unpaid", json={"on": False, "value": 24})
    assert r.json()[0]["on"] is False
    assert "expire_unpaid" not in (await ops.post("/api/admin/automation/run")).json()["acted"]
    await ops.put("/api/admin/automation/expire_unpaid", json={"on": True, "value": 24})
    r = (await ops.post("/api/admin/automation/run")).json()
    assert r["acted"]["expire_unpaid"] == 1 and r["rules"][0]["acted"] == 1 and r["rules"][0]["lastRun"]
    assert (await db[ORDERS].find_one({"_id": created["orderId"]}))["status"] == "expired"
    assert (await ops.put("/api/admin/automation/nope", json={"on": True, "value": 1})).status_code == 404
    assert "automation.changed" in await actions(db)


async def test_deadline_alert_emails_once(client, outbox, razorpay, db, admin_client):
    ops = await admin_client("ops")
    await signup(client, outbox)
    _, order = await buy(client)
    await db[ORDERS].update_one({"_id": order["id"]}, {"$set": {"deadline_at": now() + timedelta(hours=2)}})
    assert (await ops.post("/api/admin/automation/run")).json()["acted"]["deadline_alert"] == 1
    assert outbox.sent[-1].to == "info@nm7.si" and order["id"] in outbox.sent[-1].subject
    assert (await ops.post("/api/admin/automation/run")).json()["acted"]["deadline_alert"] == 0


async def test_reports_csv_and_invoices(client, outbox, razorpay, db, admin_client):
    await signup(client, outbox, name="=HYPERLINK(evil)")
    await buy(client)
    owner = await admin_client()
    rep = (await owner.get("/api/admin/reports", params={"days": 7})).json()
    assert rep["byPlan"] == {"expert": 1} and rep["moneyIn"] == 99900 and len(rep["daily"]) == 1
    r = await owner.get("/api/admin/reports/orders.csv", params={"days": 7})
    assert r.headers["content-type"] == "text/csv; charset=utf-8" and r.content[:3] == b"\xef\xbb\xbf"
    lines = r.content.decode("utf-8-sig").strip().splitlines()  # the BOM is only a byte-order mark, not a column
    assert lines[0].startswith("order,invoice") and "'=HYPERLINK(evil)" in lines[1]
    inv = (await owner.get("/api/admin/invoices")).json()
    assert inv["total"] == 1 and inv["items"][0]["invoiceNo"].startswith("NM7/")
    assert "report.exported" in await actions(db)


async def test_quality_audit(client, outbox, razorpay, db, admin_client):
    q = await admin_client("quality")
    assert (await q.get("/api/admin/quality")).json()["orders"] == []
    await signup(client, outbox)
    _, order = await buy(client)
    assert (await q.put(f"/api/admin/quality/{order['id']}", json={"scores": [1, 1, 1, 1, 1]})).status_code == 404
    await db[ORDERS].update_one({"_id": order["id"]}, {"$set": {"status": "delivered", "delivered_at": now()}})
    r = await q.put(f"/api/admin/quality/{order['id']}", json={"scores": [1, 0, 1, 1, 1], "note": "numbers"})
    assert r.status_code == 200
    rows = (await q.get("/api/admin/quality")).json()["orders"]
    assert rows[0]["scores"] == [1, 0, 1, 1, 1]
    assert (await q.put(f"/api/admin/quality/{order['id']}", json={"scores": [1]})).status_code == 422


async def test_team(admin_client, db, make_client):
    owner = await admin_client()
    team = (await owner.get("/api/admin/team")).json()
    assert [t["role"] for t in team] == ["owner"] and team[0]["twoStep"] and team[0]["lastLogin"]
    r = await owner.post(
        "/api/admin/team", json={"email": "ops2@nm7.si", "name": "Ops", "role": "ops", "password": PASSWORD}
    )
    assert (
        r.status_code == 201 and r.json()["otpauthUri"].startswith("otpauth://") and len(r.json()["recoveryCodes"]) > 0
    )
    new_id = r.json()["id"]
    assert (
        await owner.post(
            "/api/admin/team", json={"email": "ops2@nm7.si", "name": "x", "role": "ops", "password": PASSWORD}
        )
    ).status_code == 409
    r = await owner.patch(f"/api/admin/team/{new_id}", json={"role": "support"})
    assert [t["role"] for t in r.json()] == ["owner", "support"]
    me = team[0]["id"]
    assert err(await owner.patch(f"/api/admin/team/{me}", json={"disabled": True})) == "not_yourself"
    r = await owner.patch(f"/api/admin/team/{new_id}", json={"disabled": True})
    assert r.json()[1]["disabled"] is True
    assert await actions(db) == ["team.added", "team.changed", "team.changed"]


async def test_last_owner_is_kept(admin_client):
    owner = await admin_client()
    second = await admin_client("owner", "owner2@nm7.si")
    team = (await second.get("/api/admin/team")).json()
    first_id = team[0]["id"]
    assert (await second.patch(f"/api/admin/team/{first_id}", json={"role": "ops"})).status_code == 200
    assert (await owner.get("/api/admin/team")).status_code == 401  # role change signs them out
    second_id = team[1]["id"]
    third = await admin_client("owner", "owner3@nm7.si")
    await third.patch(f"/api/admin/team/{second_id}", json={"disabled": True})
    r = await second.get("/api/admin/team")
    assert r.status_code == 401


async def test_setup_status(client, admin_client):
    assert (await client.get("/api/admin/setup/status")).json() == {"open": False}  # no setup token in tests
    await admin_client()
    assert (await client.get("/api/admin/setup/status")).json() == {"open": False}
