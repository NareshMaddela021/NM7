"""Razorpay end to end (Razorpay's API mocked by FakeRazorpay): a successful payment with its GST invoice (inclusive
split, CGST + SGST / IGST / none, company + GSTIN, the PDF in the receipt and as a download), a failed payment tried
again on the same Razorpay order, a closed tab completed by the webhook, admin refunds (full, partial, status from
refund.processed), double clicks and webhook-after-verify (one transition), a wrong signature, a wrong amount,
webhook replays, the test-mode guard, add-ons on a paid order, the "Finish your payment" reminders, the daily check
against Razorpay, and an organization's proforma emailed with its payment link."""

import asyncio
import io
import time
from datetime import datetime, timedelta

import pytest
from pypdf import PdfReader

from app.core.config import get_settings
from app.core.db import INVOICES, ORDERS, PAYMENTS, REFUNDS, SETTINGS, USERS
from app.core.time import now
from app.payments.reminders import send_reminders
from tests.conftest import buy, checkout_signature, payment_event, send_webhook, signup
from tests.test_billing_invoices import gst_on, new_owner
from tests.test_billing_plans import BUYER_GSTIN, details

RECEIPT = "Payment received — order "


def err(r):
    return r.json()["error"]["code"]


def receipts(outbox, order_id=None):
    return [m for m in outbox.sent if m.subject.startswith(RECEIPT) and (not order_id or m.subject.endswith(order_id))]


@pytest.fixture
async def customer(client, outbox):
    await signup(client, outbox)
    return client


@pytest.fixture
def hook(make_client):
    """Razorpay's servers posting webhooks (no session cookie)."""
    return make_client()


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def start(c, plan="expert", role="Data Analyst", billing=None, addons=None):
    body = {"planId": plan, "role": role, "addons": addons or []}
    if billing is not None:
        body["billing"] = billing
    r = await c.post("/api/orders", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def verify_body(created, pid=None, signature=None):
    pid = pid or f"pay_{created['orderId'].replace('-', '')}"
    rid = created["razorpayOrderId"]
    return {"razorpay_order_id": rid, "razorpay_payment_id": pid,
            "razorpay_signature": signature or checkout_signature(rid, pid)}  # fmt: skip


async def verify(c, created, pid=None):
    r = await c.post("/api/payments/verify", json=verify_body(created, pid))
    assert r.status_code == 200, r.text
    return r.json()


async def invoice_of(db, order_id):
    return await db[INVOICES].find_one({"order_id": order_id, "kind": "invoice"})


def pdf_text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)


# ---------- success, and the GST invoice ----------


async def test_success_pays_once_with_an_invoice_in_the_receipt_and_as_a_download(
    customer, razorpay, admin_client, outbox, db, make_client
):
    nm7 = await admin_client("owner")
    await gst_on(nm7, "37")  # supplier in Andhra Pradesh
    created = await start(customer, billing={"stateCode": "37"})  # the buyer too
    assert created["amount"] == 999_00 and razorpay.last_json(razorpay.orders)["amount"] == 999_00
    o = await verify(customer, created)
    assert o["status"] == "offer" and o["paidAt"] and o["invoiceNo"].startswith("NM7/")
    inv = await invoice_of(db, created["orderId"])
    assert inv["number"] == o["invoiceNo"] and inv["customer_id"] and inv["org_id"] is None
    snap = inv["snapshot"]
    assert [(t["kind"], t["rate_bp"], t["amount"]) for t in snap["tax_lines"]] == [
        ("cgst", 900, 7619), ("sgst", 900, 7619)
    ]  # fmt: skip
    # GST-inclusive: the parts always add up to what was paid (the rounding paisa stays in the taxable value)
    assert snap["totals"]["taxable"] == 84662 and snap["totals"]["tax"] == 15238 and snap["totals"]["total"] == 999_00
    assert snap["lines"][0]["description"] == "Expert rewrite" and snap["recipient"]["name"] == "Sai Varsha"
    assert await db[INVOICES].count_documents({"order_id": created["orderId"]}) == 1
    # the receipt carries the PDF
    [mail] = receipts(outbox, created["orderId"])
    assert mail.to == "sai@example.com" and o["invoiceNo"] in mail.text
    [(name, mime, data)] = mail.attachments
    assert mime == "application/pdf" and name.endswith(".pdf") and data.startswith(b"%PDF")
    t = pdf_text(data)
    assert "Tax Invoice" in t and "CGST @ 9%" in t and "₹999.00" in t
    # the download: the owner (and an orders admin), nobody else
    r = await customer.get(f"/api/orders/{created['orderId']}/invoice.pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    other = make_client()
    await signup(other, outbox, email="other@example.com", name="Other")
    assert (await other.get(f"/api/orders/{created['orderId']}/invoice.pdf")).status_code == 404
    assert (await nm7.get(f"/api/orders/{created['orderId']}/invoice.pdf")).status_code == 200
    # an unpaid order has no invoice yet
    unpaid = await start(customer, plan="diy", role=None)
    r = await customer.get(f"/api/orders/{unpaid['orderId']}/invoice.pdf")
    assert r.status_code == 404 and err(r) == "no_invoice"


async def test_igst_for_a_company_in_another_state(customer, razorpay, admin_client, db):
    await gst_on(await admin_client("owner"), "37")
    billing = {"companyName": "Acme Analytics Pvt Ltd", "gstin": BUYER_GSTIN, "address": "1 MG Road, Bengaluru"}
    created = await start(customer, billing=billing)
    await verify(customer, created)
    snap = (await invoice_of(db, created["orderId"]))["snapshot"]
    assert [(t["kind"], t["rate_bp"], t["amount"]) for t in snap["tax_lines"]] == [("igst", 1800, 15239)]
    assert snap["totals"]["taxable"] == 84661 and snap["totals"]["total"] == 999_00
    assert snap["recipient"]["name"] == "Acme Analytics Pvt Ltd" and snap["recipient"]["gstin"] == BUYER_GSTIN
    assert snap["place_of_supply"]["code"] == "29"
    t = pdf_text((await customer.get(f"/api/orders/{created['orderId']}/invoice.pdf")).content)
    assert "Acme Analytics Pvt Ltd" in t and BUYER_GSTIN in t and "IGST @ 18%" in t


async def test_no_tax_lines_while_the_supplier_gstin_is_empty(customer, razorpay, db):
    created = await start(customer, billing={"companyName": "Acme Analytics Pvt Ltd", "gstin": BUYER_GSTIN})
    await verify(customer, created)
    inv = await invoice_of(db, created["orderId"])
    snap = inv["snapshot"]
    assert snap["tax_lines"] == [] and snap["totals"]["tax"] == 0 and snap["totals"]["taxable"] == 999_00
    assert snap["gst_on"] is False and snap["recipient"]["gstin"] == BUYER_GSTIN


async def test_bad_billing_details_are_refused(customer, razorpay, db):
    r = await customer.post("/api/orders", json={"planId": "diy", "billing": {"companyName": "X", "gstin": "29ABC"}})
    assert r.status_code == 400 and err(r) == "bad_gstin"
    r = await customer.post("/api/orders", json={"planId": "diy", "billing": {"gstin": BUYER_GSTIN}})
    assert r.status_code == 400 and err(r) == "company_required"
    r = await customer.post("/api/orders", json={"planId": "diy", "billing": {"stateCode": "99"}})
    assert r.status_code == 400 and err(r) == "bad_state"
    assert not razorpay.orders.called and await db[ORDERS].count_documents({}) == 0


# ---------- failure, closed tab ----------


async def test_failed_payment_leaves_the_order_payable_on_the_same_razorpay_order(customer, razorpay, hook, db):
    created = await start(customer)
    ev = payment_event("payment.failed", created["razorpayOrderId"], "pay_FAIL1", created["amount"],
                       error_description="Bank declined")  # fmt: skip
    assert (await send_webhook(hook, ev, "evt_fail1")).status_code == 200
    p = await db[PAYMENTS].find_one({"order_id": created["orderId"]})
    assert p["status"] == "failed" and p["error"] == "Bank declined"
    order = (await customer.get(f"/api/orders/{created['orderId']}")).json()
    assert order["status"] == "pending_payment" and order["paidAt"] is None
    r = await customer.post(f"/api/orders/{created['orderId']}/pay")
    assert r.status_code == 200, r.text
    again = r.json()
    assert again["razorpayOrderId"] == created["razorpayOrderId"] and again["amount"] == created["amount"]
    assert razorpay.orders.call_count == 1  # no new Razorpay order
    # an expired order can still be paid
    await db[ORDERS].update_one({"_id": created["orderId"]}, {"$set": {"status": "expired"}})
    assert (await customer.post(f"/api/orders/{created['orderId']}/pay")).status_code == 200
    o = await verify(customer, again, "pay_OK2")
    assert o["status"] == "offer"
    r = await customer.post(f"/api/orders/{created['orderId']}/pay")
    assert r.status_code == 409 and err(r) == "already_paid"


async def test_closed_tab_is_completed_by_the_webhook_alone(customer, razorpay, hook, outbox, db):
    created = await start(customer, plan="linkedin_pack", role=None)
    ev = payment_event("payment.captured", created["razorpayOrderId"], "pay_TAB1", created["amount"])
    assert (await send_webhook(hook, ev, "evt_tab1")).json() == {"ok": True}
    doc = await db[ORDERS].find_one({"_id": created["orderId"]})
    assert doc["status"] == "done" and doc["paid_at"] and doc["invoice_no"]
    assert (await customer.get("/api/me/linkedin/pack/status")).json()["owned"] is True
    assert len(receipts(outbox, created["orderId"])) == 1
    assert not razorpay.payments.called  # no verify call happened
    assert await db[INVOICES].count_documents({"order_id": created["orderId"]}) == 1


# ---------- refunds ----------


async def refund_processed(hook, refund_id, amount, event_id):
    entity = {"id": refund_id, "entity": "refund", "amount": amount, "status": "processed"}
    return await send_webhook(hook, {"event": "refund.processed", "payload": {"refund": {"entity": entity}}}, event_id)


async def test_admin_refunds_partial_then_the_rest_with_the_status_from_razorpay(
    customer, razorpay, owner, hook, admin_client, outbox, db
):
    created, paid = await buy(customer)
    oid = created["orderId"]
    assert (
        await (await admin_client("ops")).post(f"/api/admin/orders/{oid}/razorpay-refund", json={})
    ).status_code == 403
    r = await owner.post(f"/api/admin/orders/{oid}/razorpay-refund", json={"amount": 300_00, "reason": "late",
                                                                          "note": "Delivered late"})  # fmt: skip
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "offer"  # partial: the order goes on
    sent = razorpay.last_json(razorpay.refunds)
    assert sent["amount"] == 300_00 and str(razorpay.refunds.calls.last.request.url).endswith(
        f"/payments/{paid['paymentId']}/refund"
    )
    assert any(m.to == "sai@example.com" for m in outbox.sent[-1:])
    mine = (await customer.get(f"/api/orders/{oid}")).json()["refunds"]
    assert [(x["amount"], x["status"]) for x in mine] == [(300_00, "approved")]
    # one at a time: the first must finish at Razorpay
    r = await owner.post(f"/api/admin/orders/{oid}/razorpay-refund", json={})
    assert r.status_code == 409 and err(r) == "refund_exists"
    rf = await db[REFUNDS].find_one({"order_id": oid})
    assert (await refund_processed(hook, rf["razorpay_refund_id"], 300_00, "evt_rf1")).status_code == 200
    mine = (await customer.get(f"/api/orders/{oid}")).json()["refunds"]
    assert [(x["amount"], x["status"]) for x in mine] == [(300_00, "processed")]
    # the rest
    r = await owner.post(f"/api/admin/orders/{oid}/razorpay-refund", json={"reason": "other"})
    assert r.status_code == 200 and r.json()["status"] == "refunded"
    assert razorpay.last_json(razorpay.refunds)["amount"] == 699_00
    rf2 = await db[REFUNDS].find_one({"order_id": oid, "amount": 699_00})
    await refund_processed(hook, rf2["razorpay_refund_id"], 699_00, "evt_rf2")
    mine = (await customer.get(f"/api/orders/{oid}")).json()["refunds"]
    assert sorted((x["amount"], x["status"]) for x in mine) == [(300_00, "processed"), (699_00, "processed")]
    assert (await db[PAYMENTS].find_one({"order_id": oid}))["status"] == "refunded"
    row = next(p for p in (await owner.get("/api/admin/payments")).json()["items"] if p["orderId"] == oid)
    assert row["refunded"] == 999_00 and row["refundStatus"] == "processed"
    r = await owner.post(f"/api/admin/orders/{oid}/razorpay-refund", json={})
    assert r.status_code == 409 and err(r) == "already_refunded"


async def test_admin_full_refund_in_one_go_and_old_whatsapp_orders_are_refused(customer, razorpay, owner, db):
    from tests.test_wapay import old_order, old_paid

    created, _ = await buy(customer, plan="linkedin_pack", role=None)
    r = await owner.post(f"/api/admin/orders/{created['orderId']}/razorpay-refund", json={"reason": "cancel"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled" and razorpay.last_json(razorpay.refunds)["amount"] == 149_00
    assert (await customer.get("/api/me/linkedin/pack/status")).json()["owned"] is False
    old = await old_order(db)
    await old_paid(db, old.id)
    calls = razorpay.refunds.call_count
    r = await owner.post(f"/api/admin/orders/{old.id}/razorpay-refund", json={})
    assert r.status_code == 409 and err(r) == "old_whatsapp" and razorpay.refunds.call_count == calls


# ---------- double clicks, bad signatures, wrong amounts, replays ----------


async def test_double_click_and_webhook_after_verify_pay_once(customer, razorpay, hook, outbox, db):
    created = await start(customer)
    body = verify_body(created, "pay_DBL1")
    rs = await asyncio.gather(*(customer.post("/api/payments/verify", json=body) for _ in range(3)))
    assert [r.status_code for r in rs] == [200, 200, 200], [r.text for r in rs]
    assert {r.json()["status"] for r in rs} == {"offer"}
    r = await customer.post("/api/payments/verify", json=body)  # and once more, later
    assert r.status_code == 200
    ev = payment_event("payment.captured", created["razorpayOrderId"], "pay_DBL1", created["amount"])
    assert (await send_webhook(hook, ev, "evt_dbl1")).status_code == 200
    assert len(receipts(outbox, created["orderId"])) == 1
    assert await db[INVOICES].count_documents({"order_id": created["orderId"]}) == 1
    assert await db[PAYMENTS].count_documents({"order_id": created["orderId"], "status": "captured"}) == 1
    doc = await db[ORDERS].find_one({"_id": created["orderId"]})
    paid_at = doc["paid_at"]
    await send_webhook(hook, ev, "evt_dbl2")  # another event id: still nothing new
    assert (await db[ORDERS].find_one({"_id": created["orderId"]}))["paid_at"] == paid_at
    assert len(receipts(outbox)) == 1


async def test_wrong_signature_is_refused_and_the_order_stays_unpaid(customer, razorpay, db):
    created = await start(customer)
    r = await customer.post("/api/payments/verify", json=verify_body(created, "pay_SIG1", signature="0" * 64))
    assert r.status_code == 400 and err(r) == "invalid_signature"
    doc = await db[ORDERS].find_one({"_id": created["orderId"]})
    assert doc["status"] == "pending_payment" and doc["paid_at"] is None
    assert not razorpay.payments.called


async def test_wrong_amount_is_never_paid(customer, razorpay, hook, outbox, db):
    created = await start(customer)
    razorpay.payment_overrides = {"amount": 1_00}
    r = await customer.post("/api/payments/verify", json=verify_body(created, "pay_AMT1"))
    assert r.status_code == 409 and err(r) == "payment_mismatch"
    ev = payment_event("payment.captured", created["razorpayOrderId"], "pay_AMT1", 1_00)
    assert (await send_webhook(hook, ev, "evt_amt1")).status_code == 200
    doc = await db[ORDERS].find_one({"_id": created["orderId"]})
    assert doc["status"] == "pending_payment" and doc["paid_at"] is None
    p = await db[PAYMENTS].find_one({"order_id": created["orderId"]})
    assert p["status"] == "created" and p["error"].startswith("Amount mismatch")
    assert receipts(outbox) == [] and await db[INVOICES].count_documents({}) == 0


async def test_webhook_replay_and_bad_signature(customer, razorpay, hook, outbox, db):
    created = await start(customer, plan="diy", role=None)
    ev = payment_event("payment.captured", created["razorpayOrderId"], "pay_RPL1", created["amount"])
    assert (await send_webhook(hook, ev, "evt_rpl")).json() == {"ok": True}
    assert (await send_webhook(hook, ev, "evt_rpl")).json() == {"ok": True, "duplicate": True}
    assert len(receipts(outbox)) == 1 and await db[INVOICES].count_documents({}) == 1
    assert await db[PAYMENTS].count_documents({"status": "captured"}) == 1
    other = await start(customer, plan="linkedin_pack", role=None)
    bad = payment_event("payment.captured", other["razorpayOrderId"], "pay_RPL2", other["amount"])
    r = await send_webhook(hook, bad, "evt_bad", secret="not-the-secret")
    assert r.status_code == 400 and err(r) == "invalid_signature"
    assert (await db[ORDERS].find_one({"_id": other["orderId"]}))["paid_at"] is None


# ---------- the test-mode guard ----------


async def test_live_keys_are_refused_until_razorpay_live_is_on(customer, razorpay, monkeypatch, db):
    monkeypatch.setattr(get_settings(), "razorpay_key_id", "rzp_live_abc123")
    r = await customer.post("/api/orders", json={"planId": "diy"})
    assert r.status_code == 503 and err(r) == "payments_test_mode"
    assert not razorpay.orders.called and await db[ORDERS].count_documents({}) == 0
    await db[SETTINGS].update_one({"_id": "billing"}, {"$set": {"razorpay_live": True}}, upsert=True)
    r = await customer.post("/api/orders", json={"planId": "diy"})
    assert r.status_code == 201 and r.json()["keyId"] == "rzp_live_abc123"
    # and with "Razorpay live" on, a test key is refused
    monkeypatch.setattr(get_settings(), "razorpay_key_id", "rzp_test_key")
    r = await customer.post("/api/orders", json={"planId": "diy"})
    assert r.status_code == 503 and err(r) == "payments_unavailable"


# ---------- add-ons ----------


async def test_express_add_on_on_a_paid_expert_order(customer, razorpay, make_client, outbox, db):
    unpaid = await start(customer, plan="expert")
    r = await customer.post(f"/api/orders/{unpaid['orderId']}/addon", json={"item": "express"})
    assert r.status_code == 404  # not paid yet
    created, paid = await buy(customer)
    parent = created["orderId"]
    deadline = datetime.fromisoformat(paid["deadlineAt"].replace("Z", "+00:00"))
    assert deadline - now() > timedelta(hours=40)
    r = await customer.post(f"/api/orders/{parent}/addon", json={"item": "express"})
    assert r.status_code == 201, r.text
    add = r.json()
    assert add["orderId"] != parent and add["amount"] == 299_00 and add["description"].startswith("Express")
    assert razorpay.last_json(razorpay.orders)["amount"] == 299_00
    doc = await db[ORDERS].find_one({"_id": add["orderId"]})
    assert doc["kind"] == "addon" and doc["parent_id"] == parent
    o = await verify(customer, add)
    assert o["status"] == "done"
    p = await db[ORDERS].find_one({"_id": parent})
    assert [i["code"] for i in p["items"]][-1] == "express" and p["items"][-1]["paid_via"] == add["orderId"]
    assert p["deadline_at"] - now() <= timedelta(hours=24)
    assert len(receipts(outbox, add["orderId"])) == 1
    r = await customer.post(f"/api/orders/{parent}/addon", json={"item": "express"})
    assert r.status_code == 409 and err(r) == "already_added"
    assert (await customer.post(f"/api/orders/{parent}/addon", json={"item": "nothing"})).status_code == 400
    assert (await customer.post(f"/api/orders/{parent}/addon", json={"item": "upgrade:diy"})).status_code == 400
    other = make_client()
    await signup(other, outbox, email="other@example.com", name="Other")
    assert (await other.post(f"/api/orders/{parent}/addon", json={"item": "revision"})).status_code == 404


# ---------- reminders ----------


async def age(db, order_id, hours):
    await db[ORDERS].update_one({"_id": order_id}, {"$set": {"created_at": now() - timedelta(hours=hours)}})


async def test_at_most_two_reminders_and_none_after_paying(customer, razorpay, hook, outbox, db):
    a, _ = await buy(customer, pay=False)
    b, _ = await buy(customer, plan="diy", role=None, pay=False)
    c, _ = await buy(customer, plan="linkedin_pack", role=None)  # paid
    for x in (a, b, c):
        await age(db, x["orderId"], 2)
    assert await send_reminders(db, outbox) == 2
    subjects = [m.subject for m in outbox.sent if m.subject.startswith("Finish your payment")]
    assert sorted(subjects) == sorted(f"Finish your payment — order {x['orderId']}" for x in (a, b))
    assert await send_reminders(db, outbox) == 0  # the first one only once
    # b is paid now; a gets its second (last) reminder after ~20 hours, then nothing
    await send_webhook(hook, payment_event("payment.captured", b["razorpayOrderId"], "pay_B", b["amount"]), "evt_b")
    for x in (a, b):
        await age(db, x["orderId"], 21)
    assert await send_reminders(db, outbox) == 1
    last = outbox.sent[-1]
    assert last.subject.endswith(a["orderId"]) and "last reminder" in last.text
    await age(db, a["orderId"], 30)
    assert await send_reminders(db, outbox) == 0
    assert (await db[ORDERS].find_one({"_id": a["orderId"]}))["reminders_sent"] == 2


async def test_no_reminders_for_bounced_or_opted_out_people_and_failed_wording(
    customer, razorpay, make_client, hook, outbox, db
):
    bounced, opted = make_client(), make_client()
    b_me = await signup(bounced, outbox, email="bounce@example.com", name="Bo")
    o_me = await signup(opted, outbox, email="optout@example.com", name="Op")
    await db[USERS].update_one({"_id": b_me["id"]}, {"$set": {"email_bounced": True}})
    await db[USERS].update_one({"_id": o_me["id"]}, {"$set": {"notify.email.payments": False}})
    x, _ = await buy(bounced, plan="diy", role=None, pay=False)
    y, _ = await buy(opted, plan="diy", role=None, pay=False)
    z, _ = await buy(customer, plan="diy", role=None, pay=False)
    await send_webhook(hook, payment_event("payment.failed", z["razorpayOrderId"], "pay_F", z["amount"]), "evt_f")
    for o in (x, y, z):
        await age(db, o["orderId"], 2)
    n = len(outbox.sent)
    assert await send_reminders(db, outbox) == 1
    [mail] = outbox.sent[n:]
    assert mail.to == "sai@example.com" and "didn’t go through" in mail.text and f"pay={z['orderId']}" in mail.text


# ---------- the daily check ----------


async def test_daily_check_flags_differences_copies_fees_and_flags_can_be_resolved(customer, razorpay, owner, db):
    ok, ok_paid = await buy(customer, plan="diy", role=None)
    mism, mism_paid = await buy(customer, plan="linkedin_pack", role=None)
    refd, refd_paid = await buy(customer, plan="tailor_pack", role=None)
    t = int(time.time())
    razorpay.listed = [
        {"id": ok_paid["paymentId"], "amount": ok["amount"], "status": "captured", "fee": 2_36, "tax": 36,
         "amount_refunded": 0, "created_at": t},
        {"id": "pay_STRANGER", "order_id": "order_ELSEWHERE", "amount": 500_00, "status": "captured",
         "amount_refunded": 0, "created_at": t},
        {"id": mism_paid["paymentId"], "amount": mism["amount"] + 1_00, "status": "captured", "amount_refunded": 0,
         "created_at": t},
        {"id": refd_paid["paymentId"], "amount": refd["amount"], "status": "captured", "amount_refunded": 20_00,
         "created_at": t},
        {"id": "pay_OLDFAIL", "amount": 99_00, "status": "failed", "created_at": t},  # failed, unknown: no flag
    ]  # fmt: skip
    r = await owner.post("/api/admin/payments/checks/run")
    assert r.status_code == 200, r.text
    check = r.json()
    q = razorpay.payment_list.calls.last.request.url.params
    assert int(q["to"]) - int(q["from"]) == 3 * 86400 and q["count"] == "100"
    flags = {(f["kind"], f["payment_id"]) for f in check["flags"]}
    assert flags == {("missing", "pay_STRANGER"), ("amount", mism_paid["paymentId"]),
                     ("refund", refd_paid["paymentId"])}  # fmt: skip
    assert check["checked"] == 5 and all(not f["resolved"] for f in check["flags"])
    row = next(p for p in (await owner.get("/api/admin/payments")).json()["items"] if p["orderId"] == ok["orderId"])
    assert row["fee"] == 2_36 and row["tax"] == 36
    listed = (await owner.get("/api/admin/payments/checks")).json()
    assert listed["open"] == 3 and listed["items"][0]["day"] == check["day"]
    n = next(f["n"] for f in check["flags"] if f["kind"] == "missing")
    url = f"/api/admin/payments/checks/{check['day']}/flags/{n}/resolve"
    assert (await owner.post(url, json={"note": "x"})).status_code == 422
    r = await owner.post(url, json={"note": "Paid on another site, refunded"})
    assert r.status_code == 200 and next(f for f in r.json()["flags"] if f["n"] == n)["resolved"] is True
    assert (await owner.get("/api/admin/payments/checks")).json()["open"] == 2
    bad = f"/api/admin/payments/checks/{check['day']}/flags/99/resolve"
    assert (await owner.post(bad, json={"note": "nothing here"})).status_code == 404
    # running again keeps what was resolved
    again = (await owner.post("/api/admin/payments/checks/run")).json()
    assert next(f for f in again["flags"] if f["kind"] == "missing")["resolved"] is True
    from app.payments.admin import daily_if_due

    assert await daily_if_due(db) == 2  # the automation pass: once a day
    assert await daily_if_due(db) == -1


# ---------- organizations: a proforma with its payment link, by email ----------


async def test_org_proforma_with_link_emails_the_link_and_the_pdf(make_client, outbox, razorpay, admin_client, db):
    c, org_id = await new_owner(make_client, outbox, "owner@college.example")
    await details(c, org_id, "37")
    nm7 = await admin_client("owner")
    r = await nm7.post(f"/api/admin/orgs/{org_id}/billing/proforma", json={"planId": "drive", "paymentLink": True})
    assert r.status_code == 201, r.text
    pf = r.json()
    assert pf["emailed"] is True and pf["emailedTo"] == "accounts@college.example"
    mail = outbox.sent[-1]
    assert mail.to == "accounts@college.example" and pf["number"] in mail.subject and "4,999" in mail.subject
    assert pf["paymentLink"] in mail.text and pf["paymentLink"] in mail.html
    [(name, mime, data)] = mail.attachments
    assert mime == "application/pdf" and data.startswith(b"%PDF") and "Proforma Invoice" in pdf_text(data)
    # without a link: no email
    n = len(outbox.sent)
    r = await nm7.post(f"/api/admin/orgs/{org_id}/billing/proforma", json={"planId": "drive"})
    assert r.status_code == 201 and "emailed" not in r.json() and len(outbox.sent) == n
