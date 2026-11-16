"""Payment method (Admin → Settings → Payments: Razorpay or off), the Razorpay keys status, and the old WhatsApp
orders after WhatsApp payments were removed: every WhatsApp buy / mark-paid / cancel / refund endpoint is gone (404),
the old WhatsApp number is removed from the settings by the automation pass, old WhatsApp orders stay listed read-only
(labelled "old (WhatsApp)") with a pending count, a Razorpay payment link can be emailed for them (one, or every
pending one once) and its payment_link.paid webhook marks them paid, auto-cancel leaves orders with an open link
alone, and old paid WhatsApp orders still show in the report. With the Razorpay keys missing nothing breaks: payments
are "off" and every payment endpoint answers 503."""

from datetime import date, timedelta

import pytest

from app.auth.models import User
from app.automation import run_rules
from app.billing.settings import get_billing
from app.core.config import get_settings
from app.core.db import AUDIT_LOG, ORDERS, ORGANIZATIONS, PAYMENTS, SETTINGS, USERS, next_number
from app.core.time import now
from app.orders.models import Order, OrderItem
from app.orders.pricing import CURRENCY, price
from app.orders.service import mark_paid
from app.payments.models import Payment
from app.site import get_site
from app.wapay import service
from app.wapay.settings import business_ready, forget_whatsapp_number
from tests.conftest import buy, send_webhook, signup
from tests.test_billing_plans import details, owner_org  # noqa: F401  (fixture)

NUMBER = "+919876543210"
KEYS = ("razorpay_key_id", "razorpay_key_secret", "razorpay_webhook_secret")


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def customer(client, outbox):
    await signup(client, outbox)
    return client


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


@pytest.fixture
def no_keys(monkeypatch):
    """The Razorpay keys are not set on the server."""
    for k in KEYS:
        monkeypatch.setattr(get_settings(), k, "")


# ---------- old WhatsApp orders, stored the way the removed flow stored them ----------


async def _wa_order_id(db) -> str:
    return f"NM7-{await next_number(db, 'wa_order_no', 24001)}"


async def old_order(
    db, email="sai@example.com", plan="linkedin_pack", role=None, addons=None, status="awaiting_payment"
):
    """An order from before WhatsApp payments were removed (method whatsapp; unpaid unless `old_paid` is called)."""
    user = User.load(await db[USERS].find_one({"email": email}))
    items = price(plan, addons or [], await get_site(db))
    order = Order(
        _id=await _wa_order_id(db),
        customer_id=user.id,
        plan=plan,
        target_role=role,
        status=status,
        method="whatsapp",
        amount=sum(i[3] for i in items),
        currency=CURRENCY,
        items=[
            OrderItem(position=pos, kind=kind, code=code, name=name, amount=amount)
            for pos, (kind, code, name, amount) in enumerate(items)
        ],
    )
    await db[ORDERS].insert_one(order.to_mongo())
    return order


async def old_org_order(db, org_id, email="owner@college.example", plan="drive"):
    """An organization's plan ordered on WhatsApp back then (unpaid)."""
    from app.billing.checkout import new_org_order, quote

    user = User.load(await db[USERS].find_one({"email": email}))
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    order = await new_org_order(db, o, user.id, await quote(db, o, plan))
    order.id = await _wa_order_id(db)
    order.status = "awaiting_payment"
    order.method = "whatsapp"
    await db[ORDERS].insert_one(order.to_mongo())
    return order


async def old_paid(db, order_id, reference="UTR123456789", amount=None, method="upi"):
    """An old WhatsApp order an admin marked paid back then: its payment (UTR, raw.whatsapp), a receipt number (or a
    GST invoice number once business details were set) and whatever it unlocked."""
    o = await db[ORDERS].find_one({"_id": order_id})
    payment = Payment(
        order_id=order_id,
        amount=amount or o["amount"],
        status="created",
        method=method,
        reference="".join(reference.split()).upper(),
        raw={"whatsapp": {"paid_on": date.today().isoformat(), "recorded_by": "admin-then", "reason": ""}},
    )
    await db[PAYMENTS].insert_one(payment.to_mongo())
    invoice = business_ready(await get_billing(db))
    paid, _ = await mark_paid(db, payment.id, None, method, source="whatsapp", invoice=invoice)
    return paid


async def owned(c):
    return (await c.get("/api/me/linkedin/pack/status")).json()["owned"]


def link_paid_event(link_id: str, order_id: str, payment_id: str, amount: int) -> dict:
    payment = {"id": payment_id, "entity": "payment", "amount": amount, "currency": "INR", "status": "captured",
               "method": "upi", "order_id": f"order_L{payment_id}", "notes": {"order_id": order_id}}  # fmt: skip
    return {
        "entity": "event",
        "event": "payment_link.paid",
        "payload": {"payment_link": {"entity": {"id": link_id, "status": "paid"}}, "payment": {"entity": payment}},
    }


# ---------- the payment method ----------


async def test_mode_defaults_to_razorpay_with_keys_else_off(client, monkeypatch, db):
    assert (await client.get("/api/public/payment-mode")).json() == {"mode": "razorpay", "replyHours": ""}
    monkeypatch.setattr(get_settings(), "razorpay_key_id", "")
    assert (await client.get("/api/public/payment-mode")).json()["mode"] == "off"


async def test_a_saved_whatsapp_mode_counts_as_razorpay(client, db):
    await db[SETTINGS].update_one(
        {"_id": "payments"}, {"$set": {"mode": "whatsapp", "whatsapp_number": NUMBER}}, upsert=True
    )
    assert (await client.get("/api/public/payment-mode")).json() == {"mode": "razorpay", "replyHours": ""}


async def test_settings_accept_only_off_or_razorpay(owner, db, monkeypatch):
    await db[SETTINGS].update_one({"_id": "payments"}, {"$set": {"mode": "whatsapp"}}, upsert=True)
    got = (await owner.get("/api/admin/payment-settings")).json()
    assert got == {"mode": "razorpay", "active": "razorpay", "razorpayReady": True, "businessReady": False,
                   "pendingWhatsapp": 0}  # fmt: skip
    for bad in ({"mode": "whatsapp", "whatsappNumber": NUMBER}, {"mode": "whatsapp"}, {"mode": "upi"}, {}):
        assert (await owner.put("/api/admin/payment-settings", json=bad)).status_code == 422
    r = await owner.put("/api/admin/payment-settings", json={"mode": "off"})
    assert r.status_code == 200 and r.json()["mode"] == "off" and r.json()["active"] == "off"
    assert "whatsappNumber" not in r.json() and "replyHours" not in r.json()
    stored = await db[SETTINGS].find_one({"_id": "payments"})
    assert stored["mode"] == "off" and "whatsapp_number" not in stored and "reply_hours" not in stored
    log = await db[AUDIT_LOG].find_one({"action": "settings.payments"})
    assert log["data"] == {"mode": {"from": "whatsapp", "to": "off"}}
    r = await owner.put("/api/admin/payment-settings", json={"mode": "razorpay"})
    assert r.status_code == 200 and r.json()["active"] == "razorpay"
    monkeypatch.setattr(get_settings(), "razorpay_key_secret", "")
    r = await owner.put("/api/admin/payment-settings", json={"mode": "razorpay"})
    assert r.status_code == 400 and err(r) == "razorpay_not_ready"


async def test_only_settings_admins_change_the_mode(admin_client, customer):
    finance = await admin_client("finance")
    assert (await finance.put("/api/admin/payment-settings", json={"mode": "off"})).status_code == 403
    assert (await customer.put("/api/admin/payment-settings", json={"mode": "off"})).status_code in (401, 403)


async def test_off_means_nothing_can_be_bought(customer, owner):
    await owner.put("/api/admin/payment-settings", json={"mode": "off"})
    assert (await customer.get("/api/public/payment-mode")).json()["mode"] == "off"
    r = await customer.post("/api/orders", json={"planId": "diy", "addons": []})
    assert r.status_code == 503 and err(r) == "payments_unavailable"
    st = (await customer.get("/api/me/linkedin/pack/status")).json()
    assert st["paymentsOn"] is False and st["onSale"] is False
    assert (await customer.get("/api/me/entitlements")).json()["reason"] == "payments_off"


async def test_pages_know_the_mode(customer, owner, owner_org):  # noqa: F811
    assert (await customer.get("/api/me/linkedin/pack/status")).json()["mode"] == "razorpay"
    c, _, org_id = owner_org
    assert (await c.get(f"/api/org/{org_id}/billing")).json()["paymentMode"] == "razorpay"
    await owner.put("/api/admin/payment-settings", json={"mode": "off"})
    st = (await customer.get("/api/me/linkedin/pack/status")).json()
    assert st["mode"] == "off" and st["onSale"] is False
    assert (await c.get(f"/api/org/{org_id}/billing")).json()["paymentMode"] == "off"


# ---------- the Razorpay keys (the Admin banner) ----------


async def test_status_lists_every_missing_key_by_name(admin_client, customer, no_keys):
    finance = await admin_client("finance")
    r = await finance.get("/api/admin/payments/status")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "razorpayReady": False,
        "missing": ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
        "mode": "off",
    }
    assert (await customer.get("/api/admin/payments/status")).status_code in (401, 403)


async def test_status_with_the_keys_set_and_one_missing(admin_client, monkeypatch):
    ops = await admin_client("ops")  # any admin with the dashboard
    r = await ops.get("/api/admin/payments/status")
    assert r.status_code == 200 and r.json() == {"razorpayReady": True, "missing": [], "mode": "razorpay"}
    monkeypatch.setattr(get_settings(), "razorpay_webhook_secret", "")
    r = await ops.get("/api/admin/payments/status")
    assert r.json() == {"razorpayReady": True, "missing": ["RAZORPAY_WEBHOOK_SECRET"], "mode": "razorpay"}


# ---------- WhatsApp payments are gone ----------


async def test_the_old_whatsapp_number_and_reply_hours_are_removed(db):
    await db[SETTINGS].update_one(
        {"_id": "payments"},
        {"$set": {"mode": "whatsapp", "whatsapp_number": NUMBER, "reply_hours": "9-9", "cancel_after_hours": 48}},
        upsert=True,
    )
    assert await forget_whatsapp_number(db) is True
    stored = await db[SETTINGS].find_one({"_id": "payments"})
    assert "whatsapp_number" not in stored and "reply_hours" not in stored
    assert stored["mode"] == "whatsapp" and stored["cancel_after_hours"] == 48
    assert await forget_whatsapp_number(db) is False  # done once


async def test_the_automation_pass_removes_the_number(db):
    await db[SETTINGS].update_one({"_id": "payments"}, {"$set": {"reply_hours": "9-9"}}, upsert=True)
    assert (await run_rules(db))["whatsapp_number_removed"] == 1
    assert "reply_hours" not in await db[SETTINGS].find_one({"_id": "payments"})
    assert (await run_rules(db))["whatsapp_number_removed"] == 0


async def test_every_whatsapp_payment_endpoint_is_gone(customer, owner, owner_org, db, razorpay):  # noqa: F811
    r = await customer.post("/api/orders/whatsapp", json={"planId": "linkedin_pack", "addons": []})
    assert r.status_code in (404, 405)
    _, paid = await buy(customer, plan="expert")
    r = await customer.post(f"/api/orders/{paid['id']}/whatsapp-addon", json={"item": "express"})
    assert r.status_code == 404
    o = await old_order(db)
    paid_body = {"method": "upi", "reference": "UTR123456789", "amount": 149_00, "paidOn": date.today().isoformat()}
    for path, body in (("paid", paid_body), ("cancel", {}), ("refund", {"method": "upi", "reference": "RFD-1"})):
        r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/{path}", json=body)
        assert r.status_code in (404, 405), (path, r.status_code)
    c, _, org_id = owner_org
    await details(c, org_id)
    assert (await c.post(f"/api/org/{org_id}/billing/whatsapp", json={"planId": "drive"})).status_code in (404, 405)
    assert (await db[ORDERS].find_one({"_id": o.id}))["status"] == "awaiting_payment"
    assert await db[ORDERS].count_documents({"method": "whatsapp"}) == 1  # nothing new was created


# ---------- old WhatsApp orders: read-only ----------


async def test_old_orders_are_listed_read_only_with_a_label_and_a_pending_count(
    customer, admin_client, make_client, outbox, db
):
    o = await old_order(db)
    other = make_client()
    await signup(other, outbox, email="ravi@example.com", name="Ravi")
    await old_order(db, email="ravi@example.com", plan="diy")
    finance = await admin_client("finance")
    listed = (await finance.get("/api/admin/whatsapp/orders")).json()
    assert {r["id"] for r in listed} == {"NM7-24001", "NM7-24002"}
    row = next(r for r in listed if r["id"] == o.id)
    assert row["label"] == "old (WhatsApp)" and row["paymentLink"] is None and row["status"] == "awaiting_payment"
    assert row["item"] == "LinkedIn pack" and row["amount"] == 149_00 and row["customer"]["email"] == "sai@example.com"
    assert "chatUrl" not in row and row["payment"] is None
    assert (await finance.get("/api/admin/whatsapp/pending")).json() == {"pending": 2}
    owner = await admin_client("owner", email="boss@nm7.si")
    assert (await owner.get("/api/admin/payment-settings")).json()["pendingWhatsapp"] == 2
    # customers can't see or pay them on their own
    assert (await customer.get("/api/admin/whatsapp/orders")).status_code in (401, 403)
    assert (await customer.get("/api/admin/whatsapp/pending")).status_code in (401, 403)
    r = await customer.post(
        "/api/payments/verify",
        json={"razorpay_order_id": o.id, "razorpay_payment_id": "pay_x", "razorpay_signature": "x"},
    )
    assert r.status_code == 404
    for role in ("support", "ops", "quality"):
        assert (await (await admin_client(role)).get("/api/admin/whatsapp/orders")).status_code == 403
    # the customer still sees the order, unpaid; nothing unlocks
    mine = (await customer.get("/api/orders")).json()
    assert mine[0]["id"] == o.id and mine[0]["status"] == "awaiting_payment"
    assert await owned(customer) is False


async def test_old_paid_orders_show_their_payment_and_unlock(customer, owner, owner_org, db):  # noqa: F811
    o = await old_order(db)
    await old_paid(db, o.id, reference="utr 5555 6666")
    assert await owned(customer) is True
    rows = (await owner.get("/api/admin/whatsapp/orders?status=paid")).json()
    assert [r["id"] for r in rows] == [o.id]
    assert rows[0]["receiptNo"].startswith("NM7R/") and rows[0]["invoiceNo"] is None  # no business details then
    assert rows[0]["payment"] == {"method": "upi", "reference": "UTR55556666", "amount": 149_00,
                                  "paidOn": date.today().isoformat()}  # fmt: skip
    assert (await owner.get("/api/admin/whatsapp/orders")).json() == []  # nothing waiting
    # an organization's old plan order
    c, _, org_id = owner_org
    await details(c, org_id)
    org = await old_org_order(db, org_id)
    assert (await owner.get("/api/admin/whatsapp/pending")).json() == {"pending": 1}
    await old_paid(db, org.id, reference="UTR-ORG-1")
    assert (await c.get(f"/api/org/{org_id}")).json()["billing"]["planId"] == "drive"


async def test_a_customers_refund_request_on_an_old_order_is_not_refunded_through_razorpay(
    customer, owner, db, razorpay
):
    o = await old_order(db, plan="diy")
    await old_paid(db, o.id)
    r = await customer.post(
        f"/api/orders/{o.id}/refund", json={"reason": "other", "details": "I bought this by mistake, sorry."}
    )
    assert r.status_code == 200, r.text
    assert r.json()["refunds"][0]["status"] == "review"
    rid = r.json()["refunds"][0]["id"]
    r = await owner.post(f"/api/admin/refunds/{rid}/approve", json={})
    assert r.status_code == 409 and err(r) == "whatsapp_order"
    assert not razorpay.refunds.called
    r = await owner.post(f"/api/admin/orders/{o.id}/razorpay-refund", json={"reason": "other"})
    assert r.status_code == 409 and err(r) == "old_whatsapp"
    assert (await db[ORDERS].find_one({"_id": o.id}))["status"] == "done"


async def test_payment_link_is_emailed_and_its_payment_marks_the_order_paid(
    customer, owner, razorpay, outbox, db, make_client
):
    hook = make_client()  # Razorpay's servers: no session cookie
    o = await old_order(db)
    r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/payment-link")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["url"].startswith("https://rzp.io/i/") and out["emailed"] is True and out["to"] == "sai@example.com"
    sent = razorpay.last_json(razorpay.links)
    assert sent["amount"] == 149_00 and sent["notes"]["order_id"] == o.id
    mail = outbox.sent[-1]
    assert mail.to == "sai@example.com" and mail.subject == f"Pay for order {o.id} — ₹149"
    assert "no longer take payments on WhatsApp" in mail.text and out["url"] in mail.text
    doc = await db[ORDERS].find_one({"_id": o.id})
    assert doc["method"] is None and doc["moved_from"] == "whatsapp" and doc["payment_link"]["id"] == out["id"]
    row = (await owner.get("/api/admin/whatsapp/orders")).json()[0]
    assert row["id"] == o.id and row["label"] == "old (WhatsApp)" and row["paymentLink"]["url"] == out["url"]
    assert (await owner.get("/api/admin/whatsapp/pending")).json() == {"pending": 1}
    # a link webhook for the wrong amount never marks it paid
    r = await send_webhook(hook, link_paid_event(out["id"], o.id, "pay_LINKBAD", 1_00), "evt_link_bad")
    assert r.status_code == 200
    assert (await db[ORDERS].find_one({"_id": o.id}))["paid_at"] is None
    # paid through the link
    before = len(outbox.sent)
    r = await send_webhook(hook, link_paid_event(out["id"], o.id, "pay_LINK1", 149_00), "evt_link_1")
    assert r.status_code == 200, r.text
    doc = await db[ORDERS].find_one({"_id": o.id})
    assert doc["status"] == "done" and doc["paid_at"] is not None and doc["invoice_no"].startswith("NM7/")
    assert doc["method"] != "whatsapp"
    assert await owned(customer) is True
    assert len(outbox.sent) == before + 1 and outbox.sent[-1].to == "sai@example.com"
    assert (await owner.get("/api/admin/whatsapp/pending")).json() == {"pending": 0}
    pays = (await owner.get("/api/admin/payments")).json()["items"]
    assert any(p["source"] == "link" and p["status"] == "captured" for p in pays)
    # replayed: nothing changes, no second receipt
    n = len(outbox.sent)
    r = await send_webhook(hook, link_paid_event(out["id"], o.id, "pay_LINK1", 149_00), "evt_link_1")
    assert r.json().get("duplicate") is True and len(outbox.sent) == n
    # a paid order can't get another link
    r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/payment-link")
    assert r.status_code == 409 and err(r) == "not_payable"


async def test_links_to_every_pending_order_go_out_once(customer, owner, razorpay, outbox, db):
    a = await old_order(db)
    await old_order(db, plan="diy")
    await old_order(db, status="cancelled")
    paid = await old_order(db)
    await old_paid(db, paid.id)
    r = await owner.post("/api/admin/whatsapp/payment-links")
    assert r.status_code == 200 and r.json() == {"sent": 2, "failed": 0}
    assert razorpay.links.call_count == 2
    assert sum(1 for m in outbox.sent if m.subject.startswith("Pay for order")) == 2
    assert (await owner.post("/api/admin/whatsapp/payment-links")).json() == {"sent": 0, "failed": 0}
    assert (await db[ORDERS].find_one({"_id": a.id}))["moved_from"] == "whatsapp"


async def test_auto_cancel_leaves_orders_with_an_open_payment_link(customer, owner, razorpay, db):
    linked = await old_order(db)
    plain = await old_order(db)
    fresh = await old_order(db)
    assert (await owner.post(f"/api/admin/whatsapp/orders/{linked.id}/payment-link")).status_code == 200
    for o, hours in ((linked, 73), (plain, 73), (fresh, 71)):
        await db[ORDERS].update_one({"_id": o.id}, {"$set": {"created_at": now() - timedelta(hours=hours)}})
    done = await run_rules(db)
    assert done["whatsapp_cancel"] == 1
    status = {o["_id"]: o["status"] async for o in db[ORDERS].find()}
    assert status == {linked.id: "awaiting_payment", plain.id: "cancelled", fresh.id: "awaiting_payment"}
    # once the link has expired, it is cancelled too
    await db[ORDERS].update_one({"_id": linked.id}, {"$set": {"payment_link.expires_at": now() - timedelta(minutes=1)}})
    assert await service.cancel_stale(db) == 1
    assert (await db[ORDERS].find_one({"_id": linked.id}))["status"] == "cancelled"


# ---------- reports ----------


async def test_report_and_csv_split_old_whatsapp_and_razorpay(customer, owner, razorpay, db):
    a = await old_order(db)
    await old_order(db)
    await old_order(db, status="cancelled")
    await old_paid(db, a.id, reference="UTR-REP-1")
    _, r = await buy(customer, plan="diy")
    rep = (await owner.get("/api/admin/whatsapp/report?days=30")).json()
    assert rep["moneyIn"]["whatsapp"] == 149_00 and rep["moneyIn"]["razorpay"] == r["amount"]
    assert rep["counts"] == {"pending": 1, "paid": 1, "cancelled": 1}
    resp = await owner.get("/api/admin/whatsapp/report.csv?days=30")
    assert resp.status_code == 200 and "text/csv" in resp.headers["content-type"]
    lines = resp.text.lstrip("﻿").strip().splitlines()
    assert lines[0].startswith("Order,Customer,Email,Item,Amount (Rs),Method,UTR / reference,Paid on")
    assert any("NM7-24001" in x and "UTR-REP-1" in x and "WhatsApp · upi" in x for x in lines[1:])
    assert any(r["id"] in x and "Razorpay · upi" in x for x in lines[1:])
    pays = (await owner.get("/api/admin/payments")).json()["items"]
    sources = {p["orderId"]: (p["source"], p["reference"]) for p in pays}
    assert sources[a.id] == ("old_whatsapp", "UTR-REP-1") and sources[r["id"]] == ("razorpay", None)


# ---------- the Razorpay keys missing: nothing breaks ----------


async def test_without_keys_payments_are_off_and_buying_answers_503(customer, razorpay, db, monkeypatch):
    created = (await customer.post("/api/orders", json={"planId": "diy", "addons": []})).json()
    for k in KEYS:
        monkeypatch.setattr(get_settings(), k, "")
    assert (await customer.get("/api/public/payment-mode")).json()["mode"] == "off"
    r = await customer.post("/api/orders", json={"planId": "diy", "addons": []})
    assert r.status_code == 503 and err(r) == "payments_unavailable"
    r = await customer.post(f"/api/orders/{created['orderId']}/pay")
    assert r.status_code == 503 and err(r) == "payments_unavailable"


async def test_without_keys_a_payment_link_answers_503_with_a_message(customer, owner, db, no_keys):
    o = await old_order(db)
    r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/payment-link")
    assert r.status_code == 503 and err(r) == "payments_unavailable"
    assert "switched on" in r.json()["error"]["message"]
    r = await owner.post("/api/admin/whatsapp/payment-links")
    assert r.status_code == 200 and r.json() == {"sent": 0, "failed": 1}
    doc = await db[ORDERS].find_one({"_id": o.id})
    assert doc["method"] == "whatsapp" and doc["payment_link"] is None


async def test_without_keys_the_webhook_answers_503(make_client, db, no_keys):
    r = await send_webhook(make_client(), link_paid_event("plink_X", "NM7-24001", "pay_X", 149_00), secret="x")
    assert r.status_code == 503 and err(r) == "payments_unavailable"


async def test_without_keys_the_automation_pass_runs(customer, db, no_keys):
    o = await old_order(db)
    await db[ORDERS].update_one({"_id": o.id}, {"$set": {"created_at": now() - timedelta(hours=73)}})
    done = await run_rules(db)
    assert done["payment_check_flags"] == -1  # the daily check with Razorpay is skipped
    assert done["whatsapp_cancel"] == 1
    assert await db[SETTINGS].find_one({"_id": "payment_check"}) is None
