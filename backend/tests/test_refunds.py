from datetime import timedelta

import httpx
import pyotp
import pytest

from app.auth.admin_service import create_admin
from app.core.db import ORDERS, PAYMENTS, REFUNDS
from app.core.time import now
from app.refunds.models import Refund
from tests.conftest import PASSWORD, buy, payment_event, send_webhook, signup


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def customer(client, outbox):
    await signup(client, outbox)
    return client


@pytest.fixture
def admin_client(make_client, db):
    async def make(role="owner", email=None):
        email = email or f"{role}@nm7.si"
        _, secret, _ = await create_admin(db, email, role.title(), role, PASSWORD)
        c = make_client()
        await c.post("/api/auth/admin/login", json={"email": email, "password": PASSWORD})
        r = await c.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(secret).now()})
        assert r.status_code == 200, r.text
        return c

    return make


async def set_order(db, order_id, **values):
    await db[ORDERS].update_one({"_id": order_id}, {"$set": values})


QUALITY = {"reason": "quality", "details": "The summary still has my old job title in it."}


# ---------- customer requests ----------


async def test_late_order_is_refunded_at_once(customer, razorpay, db, outbox, make_client):
    _, order = await buy(customer)
    r = await customer.post(f"/api/orders/{order['id']}/refund", json={"reason": "late"})
    assert r.status_code == 400 and err(r) == "not_late"

    await set_order(db, order["id"], deadline_at=now() - timedelta(minutes=1))
    r = await customer.post(f"/api/orders/{order['id']}/refund", json={"reason": "late"})
    assert r.status_code == 200
    out = r.json()
    assert out["status"] == "refunded"
    assert out["refunds"][0] | {"createdAt": None} == {
        "id": "RF-2001",
        "amount": 99900,
        "reason": "late",
        "status": "approved",
        "auto": True,
        "createdAt": None,
        "processedAt": None,
    }
    assert razorpay.refunds.calls.last.request.url.path == "/v1/payments/pay_RS1001/refund"
    assert razorpay.last_json(razorpay.refunds)["amount"] == 99900
    assert "Refund started" in outbox.sent[-1].subject and "3–5 business days" in outbox.sent[-1].text

    refund = Refund.load(await db[REFUNDS].find_one({}))
    event = {
        "event": "refund.processed",
        "payload": {
            "refund": {
                "entity": {
                    "id": refund.razorpay_refund_id,
                    "payment_id": "pay_RS1001",
                    "amount": 99900,
                    "status": "processed",
                }
            }
        },
    }
    await send_webhook(make_client(), event, "evt_r1")
    assert (await db[REFUNDS].find_one({"_id": "RF-2001"}))["status"] == "processed"
    assert (await db[PAYMENTS].find_one({}))["status"] == "refunded"


async def test_cancel_before_an_expert_accepts(customer, razorpay, db):
    _, order = await buy(customer)
    r = await customer.post(f"/api/orders/{order['id']}/refund", json={"reason": "cancel"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"

    _, second = await buy(customer)
    await set_order(db, second["id"], status="in_progress")
    r = await customer.post(f"/api/orders/{second['id']}/refund", json={"reason": "cancel"})
    assert r.status_code == 409 and err(r) == "cannot_cancel"


async def test_other_reasons_wait_for_review(customer, razorpay, outbox):
    _, order = await buy(customer)
    r = await customer.post(f"/api/orders/{order['id']}/refund", json={"reason": "quality", "details": "bad"})
    assert err(r) == "details_required"
    r = await customer.post(f"/api/orders/{order['id']}/refund", json=QUALITY)
    assert r.status_code == 200
    assert r.json()["status"] == "offer" and r.json()["refunds"][0]["status"] == "review"
    assert not razorpay.refunds.called
    assert "Refund request received" in outbox.sent[-1].subject
    r = await customer.post(f"/api/orders/{order['id']}/refund", json=QUALITY)
    assert r.status_code == 409 and err(r) == "refund_exists"


async def test_refund_needs_a_paid_order_of_your_own(customer, razorpay, make_client, outbox):
    created, _ = await buy(customer, pay=False)
    r = await customer.post(f"/api/orders/{created['orderId']}/refund", json=QUALITY)
    assert r.status_code == 409 and err(r) == "not_refundable"
    _, order = await buy(customer)
    other = make_client()
    await signup(other, outbox, email="kiran@example.com")
    assert (await other.post(f"/api/orders/{order['id']}/refund", json=QUALITY)).status_code == 404


async def test_razorpay_refusing_the_refund_changes_nothing(customer, razorpay, db):
    _, order = await buy(customer)
    await set_order(db, order["id"], deadline_at=now() - timedelta(minutes=1))
    razorpay.refunds.mock(return_value=httpx.Response(400, json={"error": {"description": "insufficient balance"}}))
    r = await customer.post(f"/api/orders/{order['id']}/refund", json={"reason": "late"})
    assert r.status_code == 502
    assert await db[REFUNDS].count_documents({}) == 0
    assert (await customer.get(f"/api/orders/{order['id']}")).json()["status"] == "offer"


# ---------- admin decisions ----------


async def test_admin_approves_in_full(customer, razorpay, admin_client, outbox):
    _, order = await buy(customer)
    await customer.post(f"/api/orders/{order['id']}/refund", json=QUALITY)
    finance = await admin_client("finance")

    listed = (await finance.get("/api/admin/refunds?status=review")).json()
    assert listed["total"] == 1 and listed["items"][0]["customer"]["email"] == "sai@example.com"
    assert listed["items"][0]["details"] == QUALITY["details"]

    r = await finance.post("/api/admin/refunds/RF-2001/approve", json={"note": "Fair point"})
    assert r.status_code == 200 and r.json()["status"] == "approved" and r.json()["razorpayRefundId"]
    assert (await customer.get(f"/api/orders/{order['id']}")).json()["status"] == "refunded"
    assert "Refund started" in outbox.sent[-1].subject

    r = await finance.post("/api/admin/refunds/RF-2001/approve", json={})
    assert r.status_code == 409 and err(r) == "already_decided"

    log = (await (await admin_client("owner")).get("/api/admin/audit-log?action=refund.approved")).json()
    assert log[0]["target"] == "RF-2001" and log[0]["actorName"] == "Finance"


async def test_partial_refund_keeps_the_order_going(customer, razorpay, admin_client):
    _, order = await buy(customer)
    await customer.post(f"/api/orders/{order['id']}/refund", json=QUALITY)
    owner = await admin_client()
    r = await owner.post("/api/admin/refunds/RF-2001/approve", json={"amount": 999999})
    assert r.status_code == 400 and err(r) == "amount_too_high"
    r = await owner.post("/api/admin/refunds/RF-2001/approve", json={"amount": 50000})
    assert r.status_code == 200 and r.json()["amount"] == 50000
    assert razorpay.last_json(razorpay.refunds)["amount"] == 50000
    assert (await customer.get(f"/api/orders/{order['id']}")).json()["status"] == "offer"


async def test_admin_rejects_and_customer_can_ask_again(customer, razorpay, admin_client, outbox):
    _, order = await buy(customer)
    await customer.post(f"/api/orders/{order['id']}/refund", json=QUALITY)
    support = await admin_client("support")
    assert err(await support.post("/api/admin/refunds/RF-2001/reject", json={"note": "no"})) == "invalid_input"
    r = await support.post("/api/admin/refunds/RF-2001/reject", json={"note": "The draft matches your brief."})
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert "The draft matches your brief." in outbox.sent[-1].text
    r = await customer.post(f"/api/orders/{order['id']}/refund", json=QUALITY)
    assert r.status_code == 200 and r.json()["refunds"][-1]["id"] == "RF-2002"


async def test_failed_refund_can_be_requested_again(customer, razorpay, db, make_client):
    _, order = await buy(customer)
    await set_order(db, order["id"], deadline_at=now() - timedelta(minutes=1))
    await customer.post(f"/api/orders/{order['id']}/refund", json={"reason": "late"})
    rid = (await db[REFUNDS].find_one({}))["razorpay_refund_id"]
    event = {"event": "refund.failed", "payload": {"refund": {"entity": {"id": rid, "status": "failed"}}}}
    await send_webhook(make_client(), event, "evt_f1")
    assert (await db[REFUNDS].find_one({"_id": "RF-2001"}))["status"] == "failed"


async def test_refund_permissions(customer, razorpay, admin_client):
    _, order = await buy(customer)
    await customer.post(f"/api/orders/{order['id']}/refund", json=QUALITY)
    quality = await admin_client("quality")
    assert err(await quality.get("/api/admin/refunds")) == "no_permission"
    assert err(await quality.post("/api/admin/refunds/RF-2001/approve", json={})) == "no_permission"
    assert err(await customer.post("/api/admin/refunds/RF-2001/approve", json={})) == "admin_only"
    finance = await admin_client("finance")
    assert err(await finance.get("/api/admin/orders")) == "no_permission"
    assert (await finance.get("/api/admin/payments")).status_code == 200
    assert err(await (await admin_client("ops")).get("/api/admin/payments")) == "no_permission"


# ---------- admin lists ----------


async def test_admin_order_queue(customer, razorpay, admin_client, db, outbox, make_client):
    _, a = await buy(customer, role="Data Analyst")  # RS-1001
    _, b = await buy(customer, role="Product Manager")  # RS-1002
    await buy(customer, pay=False)  # RS-1003, unpaid
    other = make_client()
    await signup(other, outbox, email="kiran@example.com", name="Kiran Rao")
    _, c = await buy(other)  # RS-1004
    await set_order(db, b["id"], deadline_at=now() + timedelta(hours=2))
    await set_order(db, c["id"], deadline_at=now() - timedelta(hours=1))

    ops = await admin_client("ops")
    page = (await ops.get("/api/admin/orders")).json()
    assert page["total"] == 4
    assert [o["id"] for o in page["items"]] == ["RS-1004", "RS-1002", "RS-1001", "RS-1003"]
    late = page["items"][0]
    assert late["late"] is True and late["hoursLeft"] < 0 and late["customer"]["name"] == "Kiran Rao"
    assert page["items"][3]["hoursLeft"] is None

    assert [o["id"] for o in (await ops.get("/api/admin/orders?late=true")).json()["items"]] == ["RS-1004"]
    assert (await ops.get("/api/admin/orders?q=kiran")).json()["total"] == 1
    assert (await ops.get("/api/admin/orders?q=rs-1002")).json()["items"][0]["id"] == "RS-1002"
    assert (await ops.get("/api/admin/orders?status=pending_payment")).json()["total"] == 1
    paged = (await ops.get("/api/admin/orders?limit=2&offset=2")).json()
    assert paged["total"] == 4 and len(paged["items"]) == 2


async def test_admin_payments_list(customer, razorpay, admin_client, make_client):
    await buy(customer)
    await buy(customer, pay=False)
    await send_webhook(make_client(), payment_event("payment.captured", "order_ELSEWHERE", "pay_ORPHAN", 99900), "e1")
    finance = await admin_client("finance")
    page = (await finance.get("/api/admin/payments")).json()
    assert page["total"] == 3
    statuses = sorted(p["status"] for p in page["items"])
    assert statuses == ["captured", "captured", "created"]
    unmatched = (await finance.get("/api/admin/payments?unmatched=true")).json()["items"]
    assert len(unmatched) == 1 and unmatched[0]["razorpayPaymentId"] == "pay_ORPHAN"
    assert unmatched[0]["orderId"] is None and unmatched[0]["error"] == "Paid, but no matching order"
    named = [p for p in page["items"] if p["orderId"] == "RS-1001"][0]
    assert named["customerName"] == "Sai Varsha" and named["method"] is None
