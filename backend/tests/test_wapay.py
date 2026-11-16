"""Payment method (Admin → Settings → Payments: Razorpay or off) and the retired WhatsApp payments: every WhatsApp
buy / mark-paid endpoint answers 410, the old WhatsApp number is removed from the settings, old WhatsApp orders stay
listed read-only (labelled "old (WhatsApp)") with a pending count, a Razorpay payment link can be emailed for them
(one, or every pending one once) and its payment_link.paid webhook marks them paid, auto-cancel leaves orders with an
open link alone, and old paid WhatsApp orders can still be refunded offline and show in the report."""

from datetime import date, timedelta
from unittest.mock import patch

import pytest

from app.auth.models import User
from app.automation import run_rules
from app.core.config import get_settings
from app.core.db import AUDIT_LOG, ORDERS, ORGANIZATIONS, SETTINGS, USERS
from app.core.time import now
from app.wapay import service
from tests.conftest import buy, send_webhook, signup
from tests.test_billing_plans import details, owner_org  # noqa: F401  (fixture)

NUMBER = "+919876543210"


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def customer(client, outbox):
    await signup(client, outbox)
    return client


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


# ---------- old WhatsApp orders, made the way the retired flow made them ----------


async def _whatsapp_was_on(_db):
    return {"whatsapp_number": NUMBER, "reply_hours": ""}


async def old_order(db, email="sai@example.com", plan="linkedin_pack", role=None, addons=None, coupon=None):
    """An unpaid order from before WhatsApp payments were retired (status awaiting_payment, method whatsapp)."""
    user = User.load(await db[USERS].find_one({"email": email}))
    with patch.object(service, "_whatsapp_on", _whatsapp_was_on):
        order, _ = await service.create_customer_order(db, user, plan, role, addons or [], coupon)
    return order


async def old_org_order(db, org_id, email="owner@college.example", plan="drive"):
    from app.billing.checkout import quote

    user = User.load(await db[USERS].find_one({"email": email}))
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    with patch.object(service, "_whatsapp_on", _whatsapp_was_on):
        order, _ = await service.create_org_order(db, o, user, await quote(db, o, plan))
    return order


async def old_paid(db, order_id, reference="UTR123456789", amount=None, method="upi"):
    """An old WhatsApp order an admin marked paid back then (UTR recorded)."""
    o = await db[ORDERS].find_one({"_id": order_id})
    paid, _ = await service.mark_paid_whatsapp(
        db, order_id, "admin-then", method=method, reference=reference, amount=amount or o["amount"],
        paid_on=date.today(),
    )  # fmt: skip
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


async def test_settings_accept_only_off_or_razorpay_and_remove_the_number(owner, db, monkeypatch):
    await db[SETTINGS].update_one(
        {"_id": "payments"},
        {"$set": {"mode": "whatsapp", "whatsapp_number": NUMBER, "reply_hours": "9-9"}},
        upsert=True,
    )
    got = (await owner.get("/api/admin/payment-settings")).json()
    assert got == {"mode": "razorpay", "active": "razorpay", "razorpayReady": True, "businessReady": False,
                   "pendingWhatsapp": 0}  # fmt: skip
    for bad in ({"mode": "whatsapp", "whatsappNumber": NUMBER}, {"mode": "whatsapp"}, {"mode": "upi"}):
        assert (await owner.put("/api/admin/payment-settings", json=bad)).status_code == 422
    r = await owner.put("/api/admin/payment-settings", json={"mode": "off"})
    assert r.status_code == 200 and r.json()["mode"] == "off" and r.json()["active"] == "off"
    assert "whatsappNumber" not in r.json()
    stored = await db[SETTINGS].find_one({"_id": "payments"})
    assert stored["mode"] == "off" and stored["whatsapp_number"] == "" and stored["reply_hours"] == ""
    log = await db[AUDIT_LOG].find_one({"action": "settings.payments"})
    assert log["data"]["whatsapp_number"] == {"removed": True} and "98765" not in str(log)
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


# ---------- WhatsApp payments are retired ----------


async def test_every_whatsapp_payment_endpoint_answers_410(customer, owner, db, razorpay):
    r = await customer.post("/api/orders/whatsapp", json={"planId": "linkedin_pack", "addons": []})
    assert r.status_code == 410 and err(r) == "whatsapp_payments_retired"
    _, paid = await buy(customer, plan="expert")
    r = await customer.post(f"/api/orders/{paid['id']}/whatsapp-addon", json={"item": "express"})
    assert r.status_code == 410 and err(r) == "whatsapp_payments_retired"
    o = await old_order(db)
    body = {"method": "upi", "reference": "UTR123456789", "amount": 149_00, "paidOn": date.today().isoformat()}
    r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/paid", json=body)
    assert r.status_code == 410 and err(r) == "whatsapp_payments_retired"
    assert (await db[ORDERS].find_one({"_id": o.id}))["status"] == "awaiting_payment"
    assert await db[ORDERS].count_documents({"method": "whatsapp"}) == 1  # nothing new was created
    # still admin-only (customers never reach it)
    assert (await customer.post(f"/api/admin/whatsapp/orders/{o.id}/paid", json=body)).status_code in (401, 403)


async def test_org_whatsapp_checkout_is_retired_but_a_free_code_still_redeems(owner, owner_org, db):  # noqa: F811
    c, _, org_id = owner_org
    await details(c, org_id)
    r = await c.post(f"/api/org/{org_id}/billing/whatsapp", json={"planId": "drive"})
    assert r.status_code == 410 and err(r) == "whatsapp_payments_retired"
    assert await db[ORDERS].count_documents({}) == 0
    r = await owner.post("/api/admin/coupons", json={"code": "DRIVEFREE", "type": "free", "items": ["drive"]})
    assert r.status_code == 201, r.text
    r = await c.post(f"/api/org/{org_id}/billing/whatsapp", json={"planId": "drive", "code": "drivefree"})
    assert r.status_code in (200, 201) and r.json()["unlocked"] is True, r.text
    assert (await c.get(f"/api/org/{org_id}")).json()["billing"]["planId"] == "drive"


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
    c = await old_order(db)
    await owner.post(f"/api/admin/whatsapp/orders/{c.id}/cancel", json={"reason": "Asked"})
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


async def test_cancel_an_old_order_once(customer, owner, db):
    o = await old_order(db)
    r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/cancel", json={"reason": "Asked"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/cancel", json={})
    assert r.status_code == 409 and err(r) == "not_cancellable"


# ---------- refunds of old paid WhatsApp orders (offline) ----------


async def test_offline_refund_of_an_old_paid_order_removes_access(customer, owner, admin_client, db, razorpay):
    o = await old_order(db)
    await old_paid(db, o.id)
    assert await owned(customer) is True
    support = await admin_client("support")
    body = {"method": "upi", "reference": "RFD-1234"}
    assert (await support.post(f"/api/admin/whatsapp/orders/{o.id}/refund", json=body)).status_code == 403
    # not through Razorpay: it was paid outside it
    r = await owner.post(f"/api/admin/orders/{o.id}/razorpay-refund", json={"reason": "other"})
    assert r.status_code == 409 and err(r) == "old_whatsapp"
    assert not razorpay.refunds.called
    r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/refund", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "refunded" and r.json()["refunds"][0]["status"] == "processed"
    assert await owned(customer) is False
    r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/refund", json=body)
    assert r.status_code == 409
    assert await db[AUDIT_LOG].count_documents({"action": "whatsapp.refunded"}) == 1


async def test_a_customers_refund_request_on_an_old_order_is_settled_by_the_admin(customer, owner, db):
    o = await old_order(db, plan="diy")
    await old_paid(db, o.id)
    r = await customer.post(
        f"/api/orders/{o.id}/refund", json={"reason": "other", "details": "I bought this by mistake, sorry."}
    )
    assert r.status_code == 200, r.text
    assert r.json()["refunds"][0]["status"] == "review"
    r = await owner.post(
        f"/api/admin/whatsapp/orders/{o.id}/refund", json={"method": "bank", "reference": "IMPS998877"}
    )
    assert r.json()["status"] == "refunded" and len(r.json()["refunds"]) == 1
    assert (await customer.post("/api/me/exports", json={"format": "pdf"})).status_code == 402


async def test_old_org_order_refunded_in_full_goes_back_to_free(owner_org, owner, db):  # noqa: F811
    c, _, org_id = owner_org
    await details(c, org_id)
    o = await old_org_order(db, org_id)
    await old_paid(db, o.id, reference="UTR-ORG-1")
    assert (await db[ORGANIZATIONS].find_one({"_id": org_id}))["subscription"]["plan_id"] == "drive"
    r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/refund", json={"method": "bank", "reference": "NEFT-55"})
    assert r.status_code == 200, r.text
    assert (await c.get(f"/api/org/{org_id}")).json()["billing"]["planId"] == "free"


# ---------- reports ----------


async def test_report_and_csv_split_old_whatsapp_and_razorpay(customer, owner, razorpay, db):
    a = await old_order(db)
    await old_order(db)
    c = await old_order(db)
    await old_paid(db, a.id, reference="UTR-REP-1")
    await owner.post(f"/api/admin/whatsapp/orders/{c.id}/cancel", json={})
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


async def test_an_old_order_with_a_payment_link_can_still_be_cancelled_and_its_link_closes(
    customer, owner, razorpay, db
):
    o = await old_order(db)
    link = (await owner.post(f"/api/admin/whatsapp/orders/{o.id}/payment-link")).json()
    r = await owner.post(f"/api/admin/whatsapp/orders/{o.id}/cancel", json={"reason": "Asked"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"
    assert str(razorpay.link_cancels.calls.last.request.url).endswith(f"/payment_links/{link['id']}/cancel")
    assert (await owner.get("/api/admin/whatsapp/pending")).json() == {"pending": 0}
