"""Pay via WhatsApp: the payment mode, pending orders and the wa.me link, an admin marking orders paid (Owner /
Finance only, unique UTR, amount reasons, never twice, never a cancelled order), receipts without a GST invoice until
business details are set, auto-cancel, refunds, reports, and Razorpay still working when it is the mode."""

from datetime import date, timedelta
from urllib.parse import parse_qs, unquote, urlparse

import pytest

from app.automation import run_rules
from app.core.config import get_settings
from app.core.db import AUDIT_LOG, INVOICES, ORDERS, ORGANIZATIONS, SETTINGS
from app.core.time import now
from tests.conftest import buy, signup
from tests.test_billing_plans import details, owner_org  # noqa: F401  (fixture)

NUMBER = "+91 98765 43210"
TODAY = date.today().isoformat()


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
async def whatsapp(owner):
    r = await owner.put(
        "/api/admin/payment-settings",
        json={
            "mode": "whatsapp",
            "whatsappNumber": NUMBER,
            "replyHours": "We reply 9 am - 9 pm",
            "cancelAfterHours": 72,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


async def order(c, plan="linkedin_pack", role=None, addons=None):
    r = await c.post("/api/orders/whatsapp", json={"planId": plan, "role": role, "addons": addons or []})
    assert r.status_code == 201, r.text
    return r.json()


async def paid(admin, order_id, reference="UTR123456789", amount=149_00, **extra):
    body = {"method": "upi", "reference": reference, "amount": amount, "paidOn": TODAY, **extra}
    return await admin.post(f"/api/admin/whatsapp/orders/{order_id}/paid", json=body)


async def owned(c):
    return (await c.get("/api/me/linkedin/pack/status")).json()["owned"]


# ---------- the mode ----------


async def test_mode_defaults_to_razorpay_with_keys_else_off(client, monkeypatch, db):
    assert (await client.get("/api/public/payment-mode")).json() == {"mode": "razorpay", "replyHours": ""}
    monkeypatch.setattr(get_settings(), "razorpay_key_id", "")
    assert (await client.get("/api/public/payment-mode")).json()["mode"] == "off"


async def test_settings_validate_the_number_and_keep_it_out_of_the_log(owner, db, monkeypatch):
    r = await owner.put("/api/admin/payment-settings", json={"mode": "whatsapp", "whatsappNumber": ""})
    assert r.status_code == 400 and err(r) == "number_required"
    r = await owner.put("/api/admin/payment-settings", json={"mode": "whatsapp", "whatsappNumber": "12345"})
    assert r.status_code == 400 and err(r) == "bad_number"
    r = await owner.put("/api/admin/payment-settings", json={"mode": "whatsapp", "whatsappNumber": "98765-43210"})
    assert r.status_code == 200 and r.json()["whatsappNumber"] == "+919876543210" and r.json()["active"] == "whatsapp"
    assert r.json()["cancelAfterHours"] == 72 and r.json()["businessReady"] is False
    log = await db[AUDIT_LOG].find_one({"action": "settings.payments"})
    assert "98765" not in str(log)
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
    r = await customer.post("/api/orders/whatsapp", json={"planId": "linkedin_pack", "addons": []})
    assert r.status_code == 409 and err(r) == "not_whatsapp"
    r = await customer.post("/api/orders", json={"planId": "diy", "addons": []})
    assert r.status_code == 503
    st = (await customer.get("/api/me/linkedin/pack/status")).json()
    assert st["paymentsOn"] is False and st["onSale"] is False
    assert (await customer.get("/api/me/entitlements")).json()["reason"] == "payments_off"


# ---------- WhatsApp orders ----------


async def test_pending_order_and_the_wa_link_carry_no_personal_data(customer, whatsapp, db):
    o = await order(customer)
    assert o["orderId"] == "NM7-24001" and o["item"] == "LinkedIn pack" and o["amount"] == 149_00
    assert o["replyHours"] == "We reply 9 am - 9 pm"
    url = urlparse(o["waUrl"])
    assert url.scheme == "https" and url.netloc == "wa.me" and url.path == "/919876543210"
    text = parse_qs(url.query)["text"][0]
    assert text == "Hi Nm7, I want to buy LinkedIn pack (Rs 149). Order NM7-24001."
    for private in ("sai@example.com", "Sai", "Varsha", "@"):
        assert private not in unquote(o["waUrl"])
    doc = await db[ORDERS].find_one({"_id": "NM7-24001"})
    assert doc["status"] == "awaiting_payment" and doc["method"] == "whatsapp" and doc["paid_at"] is None
    # nothing unlocks; the order shows as waiting
    assert await owned(customer) is False
    assert (await customer.get("/api/me/entitlements")).json()["reason"] == "unpaid"
    mine = (await customer.get("/api/orders")).json()
    assert mine[0]["id"] == "NM7-24001" and mine[0]["status"] == "awaiting_payment" and mine[0]["method"] == "whatsapp"
    # Razorpay's checkout is closed in WhatsApp mode
    assert (await customer.post("/api/orders", json={"planId": "diy", "addons": []})).status_code == 503


async def test_expert_order_with_add_ons(customer, whatsapp):
    o = await order(customer, plan="expert", role="Data Analyst", addons=["express"])
    assert o["item"] == "Expert rewrite + Express delivery (24h)" and o["amount"] == (999 + 299) * 100
    assert "Rs 1,298" in parse_qs(urlparse(o["waUrl"]).query)["text"][0]


async def test_customers_can_never_mark_their_own_order_paid(customer, whatsapp, admin_client):
    o = await order(customer)
    assert (await paid(customer, o["orderId"])).status_code in (401, 403)
    r = await customer.post(
        "/api/payments/verify",
        json={"razorpay_order_id": o["orderId"], "razorpay_payment_id": "pay_x", "razorpay_signature": "x"},
    )
    assert r.status_code == 404
    for role in ("support", "ops", "quality"):
        assert (await paid(await admin_client(role), o["orderId"])).status_code == 403
    assert await owned(customer) is False


async def test_too_many_open_orders(customer, whatsapp):
    for _ in range(5):
        await order(customer)
    r = await customer.post("/api/orders/whatsapp", json={"planId": "linkedin_pack", "addons": []})
    assert r.status_code == 429 and err(r) == "too_many_open"


# ---------- marking paid ----------


async def test_mark_paid_unlocks_for_that_customer_only_with_a_receipt_and_no_gst_invoice(
    customer, whatsapp, admin_client, make_client, outbox, db
):
    o = await order(customer)
    other = make_client()
    await signup(other, outbox, email="ravi@example.com", name="Ravi")
    await order(other)
    finance = await admin_client("finance")
    listed = (await finance.get("/api/admin/whatsapp/orders")).json()
    assert {r["id"] for r in listed} == {"NM7-24001", "NM7-24002"}
    row = next(r for r in listed if r["id"] == o["orderId"])
    assert row["item"] == "LinkedIn pack" and row["amount"] == 149_00 and row["customer"]["email"] == "sai@example.com"
    r = await paid(finance, o["orderId"])
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "done" and out["receiptNo"].startswith("NM7R/") and out["invoiceNo"] is None
    assert out["paymentMethod"] == "upi"
    assert await owned(customer) is True and await owned(other) is False
    mail = outbox.sent[-1]
    assert mail.subject == "Payment received for NM7-24001" and mail.to == "sai@example.com"
    assert "Receipt no.: NM7R/" in mail.text and "UTR123456789" in mail.text
    assert "AsuraaX" not in mail.text and "Private Limited" not in mail.text
    assert await db[INVOICES].count_documents({}) == 0
    log = await db[AUDIT_LOG].find_one({"action": "whatsapp.paid"})
    assert log["target"] == "NM7-24001" and log["data"]["reference"] == "UTR123456789"


async def test_gst_invoice_once_business_details_are_set(customer, whatsapp, owner, db):
    await db[SETTINGS].update_one(
        {"_id": "billing"},
        {"$set": {"supplier.address": "1 MG Road, Bengaluru 560001", "supplier.gstin": "29AAACN1234F1Z5",
                  "supplier.state_code": "29"}},
        upsert=True,
    )  # fmt: skip
    o = await order(customer)
    out = (await paid(owner, o["orderId"])).json()
    assert out["invoiceNo"].startswith("NM7/") and out["receiptNo"] is None


async def test_duplicate_utr_refused(customer, whatsapp, owner):
    a = await order(customer)
    b = await order(customer)
    assert (await paid(owner, a["orderId"], reference="utr 4455 6677")).status_code == 200
    r = await paid(owner, b["orderId"], reference="UTR44556677")
    assert r.status_code == 409 and err(r) == "duplicate_reference"


async def test_a_different_amount_needs_a_reason(customer, whatsapp, owner, db):
    o = await order(customer)
    r = await paid(owner, o["orderId"], amount=100_00)
    assert r.status_code == 400 and err(r) == "reason_required"
    r = await paid(owner, o["orderId"], amount=100_00, reason="Student discount agreed in chat")
    assert r.status_code == 200
    log = await db[AUDIT_LOG].find_one({"action": "whatsapp.paid"})
    assert log["data"]["amount"] == 100_00 and log["data"]["reason"] == "Student discount agreed in chat"


async def test_never_paid_twice_and_never_after_cancel(customer, whatsapp, owner):
    a = await order(customer)
    assert (await paid(owner, a["orderId"], reference="UTR-A-1")).status_code == 200
    r = await paid(owner, a["orderId"], reference="UTR-A-2")
    assert r.status_code == 409 and err(r) == "already_paid"
    b = await order(customer)
    assert (
        await owner.post(f"/api/admin/whatsapp/orders/{b['orderId']}/cancel", json={"reason": "Asked"})
    ).status_code == 200
    r = await paid(owner, b["orderId"], reference="UTR-B-1")
    assert r.status_code == 409 and err(r) == "cancelled"
    r = await owner.post(f"/api/admin/whatsapp/orders/{a['orderId']}/cancel", json={})
    assert r.status_code == 409 and err(r) == "not_cancellable"


async def test_dates_and_references_are_checked(customer, whatsapp, owner):
    o = await order(customer)
    future = (date.today() + timedelta(days=2)).isoformat()
    assert err(await paid(owner, o["orderId"], paidOn=future)) == "bad_date"
    assert err(await paid(owner, o["orderId"], reference="  ab ")) == "reference_required"


async def test_diy_and_expert_orders(customer, whatsapp, owner):
    d = await order(customer, plan="diy")
    assert (await customer.post("/api/me/exports", json={"format": "pdf"})).status_code == 402
    await paid(owner, d["orderId"], reference="UTR-DIY-1", amount=99_00)
    assert (await customer.post("/api/me/exports", json={"format": "pdf"})).status_code == 200
    e = await order(customer, plan="expert", role="Data Analyst")
    out = (await paid(owner, e["orderId"], reference="UTR-EXP-1", amount=999_00)).json()
    assert out["status"] == "offer"  # finding an expert; delivery counted from now
    from datetime import datetime

    deadline = datetime.fromisoformat(out["deadlineAt"].replace("Z", "+00:00"))
    assert timedelta(hours=47) < deadline - now() <= timedelta(hours=48)


async def test_career_launch_paid_on_whatsapp_includes_the_pack(customer, whatsapp, owner):
    o = await order(customer, plan="launch", role="Data Analyst")
    await paid(owner, o["orderId"], reference="UTR-LAUNCH", amount=2999_00)
    assert await owned(customer) is True


async def test_add_on_for_a_paid_order_opens_the_chat_only(customer, whatsapp, owner, client, outbox):
    e = await order(customer, plan="expert", role="Data Analyst")
    url = f"/api/orders/{e['orderId']}/whatsapp-addon"
    r = await customer.post(url, json={"item": "express"})
    assert r.status_code == 404  # not paid yet
    await paid(owner, e["orderId"], reference="UTR-ADD-1", amount=999_00)
    r = await customer.post(url, json={"item": "express"})
    assert r.status_code == 200, r.text
    text = parse_qs(urlparse(r.json()["waUrl"]).query)["text"][0]
    assert text.startswith("Hi Nm7, I want to add Express delivery") and text.endswith(f"to order {e['orderId']}.")
    r = await customer.post(url, json={"item": "upgrade:launch"})
    assert "Upgrade to Career Launch (Rs 2,000)" in r.json()["message"]
    assert (await customer.post(url, json={"item": "upgrade:diy"})).status_code == 400
    assert (await customer.post(url, json={"item": "nothing"})).status_code == 400
    # another customer's order: not found
    await signup(client, outbox, email="other-addon@example.com")
    assert (await client.post(url, json={"item": "express"})).status_code == 404


async def test_pages_know_the_mode(customer, owner, owner_org):  # noqa: F811
    assert (await customer.get("/api/me/linkedin/pack/status")).json()["mode"] == "razorpay"
    c, _, org_id = owner_org
    assert (await c.get(f"/api/org/{org_id}/billing")).json()["paymentMode"] == "razorpay"
    await owner.put("/api/admin/payment-settings", json={"mode": "whatsapp", "whatsappNumber": NUMBER})
    assert (await customer.get("/api/me/linkedin/pack/status")).json()["mode"] == "whatsapp"
    assert (await c.get(f"/api/org/{org_id}/billing")).json()["paymentMode"] == "whatsapp"
    await owner.put("/api/admin/payment-settings", json={"mode": "off", "whatsappNumber": NUMBER})
    st = (await customer.get("/api/me/linkedin/pack/status")).json()
    assert st["mode"] == "off" and st["onSale"] is False


# ---------- auto-cancel and refunds ----------


async def test_unpaid_orders_are_cancelled_after_the_set_hours(customer, whatsapp, owner, db):
    old = await order(customer)
    fresh = await order(customer)
    await db[ORDERS].update_one({"_id": old["orderId"]}, {"$set": {"created_at": now() - timedelta(hours=73)}})
    await db[ORDERS].update_one({"_id": fresh["orderId"]}, {"$set": {"created_at": now() - timedelta(hours=71)}})
    done = await run_rules(db)
    assert done["whatsapp_cancel"] == 1
    assert (await db[ORDERS].find_one({"_id": old["orderId"]}))["status"] == "cancelled"
    assert (await db[ORDERS].find_one({"_id": fresh["orderId"]}))["status"] == "awaiting_payment"
    # a shorter setting applies on the next pass
    await owner.put(
        "/api/admin/payment-settings", json={"mode": "whatsapp", "whatsappNumber": NUMBER, "cancelAfterHours": 24}
    )
    await db["locks"].delete_many({})
    assert (await run_rules(db))["whatsapp_cancel"] == 1


async def test_refund_removes_access(customer, whatsapp, owner, admin_client, db):
    o = await order(customer)
    await paid(owner, o["orderId"])
    assert await owned(customer) is True
    support = await admin_client("support")
    body = {"method": "upi", "reference": "RFD-1234"}
    assert (await support.post(f"/api/admin/whatsapp/orders/{o['orderId']}/refund", json=body)).status_code == 403
    r = await owner.post(f"/api/admin/whatsapp/orders/{o['orderId']}/refund", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "refunded" and r.json()["refunds"][0]["status"] == "processed"
    assert await owned(customer) is False
    r = await owner.post(f"/api/admin/whatsapp/orders/{o['orderId']}/refund", json=body)
    assert r.status_code == 409
    assert await db[AUDIT_LOG].count_documents({"action": "whatsapp.refunded"}) == 1


async def test_a_customers_refund_request_is_settled_by_the_admin(customer, whatsapp, owner):
    o = await order(customer, plan="diy")
    await paid(owner, o["orderId"], amount=99_00)
    r = await customer.post(
        f"/api/orders/{o['orderId']}/refund", json={"reason": "other", "details": "I bought this by mistake, sorry."}
    )
    assert r.status_code == 200, r.text
    assert r.json()["refunds"][0]["status"] == "review"
    r = await owner.post(
        f"/api/admin/whatsapp/orders/{o['orderId']}/refund", json={"method": "bank", "reference": "IMPS998877"}
    )
    assert r.json()["status"] == "refunded" and len(r.json()["refunds"]) == 1
    assert (await customer.post("/api/me/exports", json={"format": "pdf"})).status_code == 402


# ---------- organizations ----------


async def test_org_plan_on_whatsapp(owner_org, whatsapp, owner, db, outbox):  # noqa: F811
    c, _, org_id = owner_org
    await details(c, org_id)
    r = await c.post(f"/api/org/{org_id}/billing/whatsapp", json={"planId": "drive"})
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["orderId"].startswith("NM7-") and o["quote"]["planName"] == "Drive"
    assert "Drive plan" in parse_qs(urlparse(o["waUrl"]).query)["text"][0]
    assert (await c.get(f"/api/org/{org_id}/billing")).json()["pendingOrderId"] == o["orderId"]
    r = await paid(owner, o["orderId"], reference="UTR-ORG-1", amount=o["amount"])
    assert r.status_code == 200, r.text
    org = await db[ORGANIZATIONS].find_one({"_id": org_id})
    assert org["subscription"]["plan_id"] == "drive"
    assert await db[INVOICES].count_documents({"kind": "invoice"}) == 0  # no GST invoice without business details
    # refund in full: back to Free
    r = await owner.post(
        f"/api/admin/whatsapp/orders/{o['orderId']}/refund", json={"method": "bank", "reference": "NEFT-55"}
    )
    assert r.status_code == 200, r.text
    home = (await c.get(f"/api/org/{org_id}")).json()
    assert home["billing"]["planId"] == "free"


# ---------- reports, and Razorpay as before ----------


async def test_report_and_csv(customer, whatsapp, owner):
    a = await order(customer)
    await order(customer)
    c = await order(customer)
    await paid(owner, a["orderId"], reference="UTR-REP-1")
    await owner.post(f"/api/admin/whatsapp/orders/{c['orderId']}/cancel", json={})
    rep = (await owner.get("/api/admin/whatsapp/report?days=30")).json()
    assert rep["moneyIn"]["whatsapp"] == 149_00 and rep["moneyIn"]["razorpay"] == 0
    assert rep["counts"] == {"pending": 1, "paid": 1, "cancelled": 1}
    r = await owner.get("/api/admin/whatsapp/report.csv?days=30")
    assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
    lines = r.text.lstrip("﻿").strip().splitlines()
    assert lines[0].startswith("Order,Customer,Email,Item,Amount (Rs),Method,UTR / reference,Paid on")
    assert "NM7-24001" in lines[1] and "UTR-REP-1" in lines[1] and "WhatsApp · upi" in lines[1]


async def test_razorpay_mode_works_as_before(customer, owner, razorpay):
    await owner.put("/api/admin/payment-settings", json={"mode": "razorpay"})
    _, o = await buy(customer, plan="linkedin_pack", role=None)
    assert o["status"] == "done" and o["invoiceNo"].startswith("NM7/")
    assert await owned(customer) is True
    r = await customer.post("/api/orders/whatsapp", json={"planId": "diy", "addons": []})
    assert r.status_code == 409
