from datetime import UTC, datetime, timedelta

import httpx
import pyotp
import pytest
from sqlalchemy import select, update

from app.auth.admin_service import create_admin
from app.cli import run as cli_run
from app.core.config import get_settings
from app.core.time import now
from app.orders.models import Order
from app.orders.service import financial_year
from app.payments.models import Payment
from app.payments.razorpay import BASE_URL
from tests.conftest import PASSWORD, buy, checkout_signature, payment_event, send_webhook, signup


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def customer(client, outbox):
    await signup(client, outbox)
    outbox.sent.clear()
    return client


def invoice_prefix() -> str:
    return f"NM7/{financial_year(now())}/"


# ---------- creating orders ----------


async def test_create_order(customer, razorpay):
    r = await customer.post("/api/orders", json={"planId": "expert", "role": "Data Analyst"})
    assert r.status_code == 201
    out = r.json()
    assert out["orderId"] == "RS-1001" and out["razorpayOrderId"] == "order_T0001"
    assert out["amount"] == 99900 and out["currency"] == "INR" and out["keyId"] == "rzp_test_key"
    assert out["prefill"] == {"name": "Sai Varsha", "email": "sai@example.com", "contact": None}

    sent = razorpay.last_json(razorpay.orders)
    assert sent == {
        "amount": 99900,
        "currency": "INR",
        "receipt": "RS-1001",
        "notes": {"order_id": "RS-1001", "customer_id": sent["notes"]["customer_id"]},
    }

    order = (await customer.get("/api/orders/RS-1001")).json()
    assert order["status"] == "pending_payment" and order["targetRole"] == "Data Analyst"
    assert order["price"] == 999 and order["planName"] == "Expert rewrite"
    assert order["items"] == [{"kind": "plan", "code": "expert", "name": "Expert rewrite", "amount": 99900}]
    assert order["paidAt"] is None and order["invoiceNo"] is None


async def test_prices_come_from_the_server(customer, razorpay):
    r = await customer.post("/api/orders", json={"planId": "launch", "addons": ["express", "revision"], "amount": 1})
    assert r.json()["amount"] == 299900 + 29900 + 19900
    cases = [
        ({"planId": "diy", "addons": ["express"]}, 400, "addon_not_allowed"),
        ({"planId": "launch", "addons": ["linkedin"]}, 400, "addon_not_allowed"),
        ({"planId": "expert", "addons": ["gold"]}, 400, "unknown_addon"),
        ({"planId": "expert", "addons": ["express", "express"]}, 400, "duplicate_addon"),
        ({"planId": "platinum"}, 422, "invalid_input"),
    ]
    for body, status, code in cases:
        r = await customer.post("/api/orders", json=body)
        assert r.status_code == status and err(r) == code, body


async def test_only_customers_can_order(client, outbox, make_client, razorpay):
    assert err(await make_client().post("/api/orders", json={"planId": "expert"})) == "not_signed_in"
    await signup(client, outbox, email="ravi@example.com", role="expert")
    r = await client.post("/api/orders", json={"planId": "expert"})
    assert r.status_code == 403 and err(r) == "wrong_role"


async def test_payments_off_without_keys(customer, monkeypatch):
    monkeypatch.setattr(get_settings(), "razorpay_key_id", "")
    r = await customer.post("/api/orders", json={"planId": "expert"})
    assert r.status_code == 503 and err(r) == "payments_unavailable"


async def test_razorpay_down_creates_nothing(customer, razorpay, db):
    razorpay.orders.mock(return_value=httpx.Response(500, json={"error": {"description": "oops"}}))
    r = await customer.post("/api/orders", json={"planId": "expert"})
    assert r.status_code == 502 and err(r) == "payment_provider_error"
    assert (await db.execute(select(Order))).first() is None


# ---------- checkout handler ----------


async def test_verify_marks_paid_and_emails_once(customer, razorpay, outbox):
    created, order = await buy(customer)
    assert order["status"] == "offer" and order["paymentId"] == "pay_RS1001"
    assert order["invoiceNo"] == invoice_prefix() + "0001"
    paid = datetime.fromisoformat(order["paidAt"])
    assert datetime.fromisoformat(order["deadlineAt"]) - paid == timedelta(hours=48)
    assert len(outbox.sent) == 1 and "RS-1001" in outbox.sent[0].subject and "₹999" in outbox.sent[0].text

    # Calling again is harmless.
    pid = "pay_RS1001"
    r = await customer.post(
        "/api/payments/verify",
        json={
            "razorpayOrderId": created["razorpayOrderId"],
            "razorpayPaymentId": pid,
            "razorpaySignature": checkout_signature(created["razorpayOrderId"], pid),
        },
    )
    assert r.status_code == 200 and r.json()["invoiceNo"] == order["invoiceNo"]
    assert len(outbox.sent) == 1


async def test_verify_rejects_a_bad_signature(customer, razorpay, db):
    created, _ = await buy(customer, pay=False)
    r = await customer.post(
        "/api/payments/verify",
        json={
            "razorpay_order_id": created["razorpayOrderId"],
            "razorpay_payment_id": "pay_X",
            "razorpay_signature": "0" * 64,
        },
    )
    assert r.status_code == 400 and err(r) == "invalid_signature"
    assert (await customer.get(f"/api/orders/{created['orderId']}")).json()["status"] == "pending_payment"


async def test_cannot_verify_someone_elses_order(customer, razorpay, make_client, outbox):
    created, _ = await buy(customer, pay=False)
    other = make_client()
    await signup(other, outbox, email="kiran@example.com")
    pid = "pay_X"
    r = await other.post(
        "/api/payments/verify",
        json={
            "razorpay_order_id": created["razorpayOrderId"],
            "razorpay_payment_id": pid,
            "razorpay_signature": checkout_signature(created["razorpayOrderId"], pid),
        },
    )
    assert r.status_code == 404
    assert (await other.get(f"/api/orders/{created['orderId']}")).status_code == 404
    assert (await other.get("/api/orders")).json() == []


async def test_diy_is_done_at_once_and_express_is_24h(customer, razorpay):
    _, diy = await buy(customer, plan="diy")
    assert diy["status"] == "done" and diy["deadlineAt"] is None
    _, fast = await buy(customer, addons=["express"])
    delta = datetime.fromisoformat(fast["deadlineAt"]) - datetime.fromisoformat(fast["paidAt"])
    assert delta == timedelta(hours=24)
    assert fast["invoiceNo"] == invoice_prefix() + "0002"
    mine = (await customer.get("/api/orders")).json()
    assert [o["id"] for o in mine] == ["RS-1002", "RS-1001"]


# ---------- webhook ----------


async def test_webhook_needs_a_valid_signature(client, razorpay):
    r = await send_webhook(client, {"event": "payment.captured"}, secret="wrong")
    assert r.status_code == 400 and err(r) == "invalid_signature"


async def test_webhook_marks_paid_once(customer, razorpay, outbox, make_client):
    created, _ = await buy(customer, pay=False)
    event = payment_event("payment.captured", created["razorpayOrderId"], "pay_W1", 99900, method="card")
    hook = make_client()
    r = await send_webhook(hook, event, event_id="evt_1")
    assert r.json() == {"ok": True}
    order = (await customer.get(f"/api/orders/{created['orderId']}")).json()
    assert order["status"] == "offer" and order["paymentMethod"] == "card" and order["paymentId"] == "pay_W1"
    assert len(outbox.sent) == 1

    assert (await send_webhook(hook, event, event_id="evt_1")).json() == {"ok": True, "duplicate": True}
    # order.paid for the same payment, and the checkout handler arriving late, change nothing.
    await send_webhook(hook, payment_event("order.paid", created["razorpayOrderId"], "pay_W1", 99900), "evt_2")
    rid = created["razorpayOrderId"]
    r = await customer.post(
        "/api/payments/verify",
        json={
            "razorpay_order_id": rid,
            "razorpay_payment_id": "pay_W1",
            "razorpay_signature": checkout_signature(rid, "pay_W1"),
        },
    )
    assert r.status_code == 200 and len(outbox.sent) == 1


async def test_webhook_amount_mismatch_is_not_paid(customer, razorpay, make_client, db):
    hook = make_client()  # Razorpay's servers: no session cookie
    created, _ = await buy(customer, pay=False)
    await send_webhook(hook, payment_event("payment.captured", created["razorpayOrderId"], "pay_W1", 100), "e1")
    assert (await customer.get(f"/api/orders/{created['orderId']}")).json()["status"] == "pending_payment"
    p = (await db.execute(select(Payment))).scalar_one()
    assert p.status == "created" and "mismatch" in p.error


async def test_failed_then_successful_payment(customer, razorpay, make_client, db):
    hook = make_client()  # Razorpay's servers: no session cookie
    created, _ = await buy(customer, pay=False)
    rid = created["razorpayOrderId"]
    await send_webhook(
        hook,
        payment_event("payment.failed", rid, "pay_F1", 99900, error_description="Payment declined by bank"),
        "e1",
    )
    p = (await db.execute(select(Payment))).scalar_one()
    assert p.status == "failed" and p.error == "Payment declined by bank"
    assert (await customer.get(f"/api/orders/{created['orderId']}")).json()["status"] == "pending_payment"

    await send_webhook(hook, payment_event("payment.captured", rid, "pay_OK", 99900), "e2")
    assert (await customer.get(f"/api/orders/{created['orderId']}")).json()["status"] == "offer"


async def test_payment_without_an_order_is_kept(client, razorpay, db):
    await send_webhook(client, payment_event("payment.captured", "order_UNKNOWN", "pay_ORPHAN", 99900), "e1")
    await send_webhook(client, payment_event("payment.captured", "order_UNKNOWN", "pay_ORPHAN", 99900), "e2")
    rows = (await db.execute(select(Payment))).scalars().all()
    assert len(rows) == 1 and rows[0].order_id is None and rows[0].status == "captured"


# ---------- admins, invoices, expiry ----------


async def test_admin_with_orders_permission_can_read_any_order(customer, razorpay, make_client, db):
    created, _ = await buy(customer, pay=False)
    _, secret, _ = await create_admin(db, "support@nm7.si", "Support", "support", PASSWORD)
    await db.commit()
    admin = make_client()
    await admin.post("/api/auth/admin/login", json={"email": "support@nm7.si", "password": PASSWORD})
    await admin.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(secret).now()})
    assert (await admin.get(f"/api/orders/{created['orderId']}")).status_code == 200
    assert (await admin.get("/api/orders")).status_code == 403  # "my orders" is for customers


def test_financial_year():
    assert financial_year(datetime(2027, 3, 31, 18, 0, tzinfo=UTC)) == "26-27"  # 31 Mar 23:30 IST
    assert financial_year(datetime(2027, 3, 31, 18, 31, tzinfo=UTC)) == "27-28"  # 1 Apr 00:01 IST
    assert financial_year(datetime(2099, 6, 1, tzinfo=UTC)) == "99-00"


async def test_unpaid_orders_expire_and_can_still_be_paid(customer, razorpay, make_client, db, capsys):
    hook = make_client()  # Razorpay's servers: no session cookie
    created, _ = await buy(customer, pay=False)
    await db.execute(update(Order).values(created_at=now() - timedelta(hours=25)))
    await db.commit()
    await cli_run(["expire-orders"])
    assert "1 unpaid order(s)" in capsys.readouterr().out
    assert (await customer.get(f"/api/orders/{created['orderId']}")).json()["status"] == "expired"
    await send_webhook(hook, payment_event("payment.captured", created["razorpayOrderId"], "pay_L", 99900), "e1")
    assert (await customer.get(f"/api/orders/{created['orderId']}")).json()["status"] == "offer"


def test_base_url_is_razorpay():
    assert BASE_URL == "https://api.razorpay.com/v1"
