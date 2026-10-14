"""Things Postgres protected with row locks / transactions, hit at the same moment on MongoDB."""

import asyncio

import pyotp
import pytest

from app.auth.admin_service import create_admin
from app.core.config import get_settings
from app.core.db import COUNTERS, ORDERS, USERS
from tests.conftest import PASSWORD, buy, checkout_signature, payment_event, send_webhook, signup


async def test_checkout_and_webhook_together_pay_once(client, outbox, razorpay, make_client, db):
    await signup(client, outbox)
    outbox.sent.clear()
    created, _ = await buy(client, pay=False)
    rid, pid = created["razorpayOrderId"], "pay_RACE"
    body = {"razorpay_order_id": rid, "razorpay_payment_id": pid, "razorpay_signature": checkout_signature(rid, pid)}
    hook = make_client()
    results = await asyncio.gather(
        client.post("/api/payments/verify", json=body),
        send_webhook(hook, payment_event("payment.captured", rid, pid, 99900), "evt_race"),
        send_webhook(hook, payment_event("order.paid", rid, pid, 99900), "evt_race2"),
    )
    assert [r.status_code for r in results] == [200, 200, 200]
    order = await db[ORDERS].find_one({"_id": created["orderId"]})
    assert order["status"] == "offer" and order["invoice_no"].endswith("/0001")
    assert len(outbox.sent) == 1  # one receipt
    invoice_counter = await db[COUNTERS].find_one({"_id": {"$regex": "^invoice:"}})
    assert invoice_counter["value"] == 1  # no invoice number used up twice


async def test_two_admins_approving_together_refund_once(client, outbox, razorpay, make_client, db):
    await signup(client, outbox)
    _, order = await buy(client)
    await client.post(
        f"/api/orders/{order['id']}/refund", json={"reason": "quality", "details": "Not what I asked for."}
    )

    admins = []
    for email in ("a@nm7.si", "b@nm7.si"):
        _, secret, _ = await create_admin(db, email, "Finance", "finance", PASSWORD)
        c = make_client()
        await c.post("/api/auth/admin/login", json={"email": email, "password": PASSWORD})
        await c.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(secret).now()})
        admins.append(c)
    results = await asyncio.gather(*(c.post("/api/admin/refunds/RF-2001/approve", json={}) for c in admins))
    assert sorted(r.status_code for r in results) == [200, 409]
    assert razorpay.refunds.call_count == 1


async def test_two_owner_setups_at_once_make_one_owner(make_client, db, monkeypatch):
    token = "setup-token-0123456789-abcdefghij"
    monkeypatch.setattr(get_settings(), "admin_setup_token", token)
    browsers, secrets = [make_client(), make_client()], []
    for i, b in enumerate(browsers):
        r = await b.post(
            "/api/admin/setup",
            json={
                "token": token,
                "email": f"owner{i}@nm7.si",
                "name": "Owner",
                "password": PASSWORD,
                "passwordConfirm": PASSWORD,
            },
        )
        secrets.append(r.json()["secret"])
    results = await asyncio.gather(
        *(
            b.post("/api/admin/setup/verify", json={"code": pyotp.TOTP(s).now()})
            for b, s in zip(browsers, secrets, strict=True)
        )
    )
    assert sorted(r.status_code for r in results) == [200, 404]
    assert await db[USERS].count_documents({"role": "admin"}) == 1


@pytest.mark.parametrize("tries", [6])
async def test_one_email_code_signs_in_once(client, outbox, make_client, tries):
    await signup(client, outbox, verify=False)
    code = outbox.last_code("sai@example.com")
    results = await asyncio.gather(
        *(
            make_client().post("/api/auth/verify-email", json={"email": "sai@example.com", "code": code})
            for _ in range(tries)
        )
    )
    assert sorted(r.status_code for r in results) == [200] + [400] * (tries - 1)
