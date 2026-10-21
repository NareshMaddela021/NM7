"""Phase 4B: GST invoices, credit notes, proformas with payment links, offline payments, the GSTR-1 register."""

import asyncio
import io
from datetime import UTC, datetime

import pytest
from pypdf import PdfReader

from app.billing import subscription
from app.billing.invoices import MAX_NUMBER
from app.billing.pdf import in_words, money
from app.core.db import AUDIT_LOG, INVOICES, ORDERS, ORGANIZATIONS, PAYMENTS, REFUNDS
from app.core.time import financial_year, now
from tests.conftest import send_webhook, signup
from tests.test_billing_plans import BUYER_GSTIN, details, gstin, pay

SUPPLIER_GSTIN = gstin("37AAACA1234B1Z")  # Andhra Pradesh (invented)


def text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)


async def new_owner(make_client, outbox, email, name="Sri Venkateswara College"):
    c = make_client()
    await signup(c, outbox, email, name="Owner")
    r = await c.post("/api/me/orgs", json={"name": name, "type": "college", "city": "Tirupati"})
    assert r.status_code == 201, r.text
    return c, r.json()["orgId"]


async def gst_on(nm7, state="37", **supplier):
    s = (await nm7.get("/api/admin/billing/settings")).json()
    s.pop("gstOn"), s.pop("missing")
    s["supplier"].update(
        gstin=SUPPLIER_GSTIN, stateCode=state, address="Plot 7, Hitech Road, Tirupati 517501",
        signatory="Naresh M", sac="998431", **supplier,
    )  # fmt: skip
    r = await nm7.put("/api/admin/billing/settings", json=s)
    assert r.status_code == 200 and r.json()["gstOn"], r.text
    return r.json()


async def buy(c, client, org_id, pid, plan="drive"):
    r = await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": plan})
    assert r.status_code == 201, r.text
    created = r.json()
    assert (await pay(client, created, pid)).status_code == 200
    return created


async def docs(c, org_id):
    r = await c.get(f"/api/org/{org_id}/billing/invoices")
    assert r.status_code == 200, r.text
    return r.json()


async def pdf(c, org_id, doc_id):
    r = await c.get(f"/api/org/{org_id}/billing/invoices/{doc_id}/pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf", r.text
    return r.content


@pytest.fixture
async def org(make_client, outbox):
    return await new_owner(make_client, outbox, "owner@college.example")


# ---------- GST ----------


async def test_gst_off_prints_no_tax_lines(org, client, razorpay, db, outbox):
    c, org_id = org
    await details(c, org_id, "37")
    created = await buy(c, client, org_id, "pay_OFF1")
    [inv] = await docs(c, org_id)
    assert inv["kind"] == "invoice" and inv["gstOn"] is False and inv["tax"] == 0 and inv["total"] == 4999_00
    assert inv["number"] == (await db[ORDERS].find_one({"_id": created["orderId"]}))["invoice_no"]
    snap = (await db[INVOICES].find_one({"_id": inv["id"]}))["snapshot"]
    assert snap["tax_lines"] == [] and snap["totals"]["tax"] == 0
    t = text(await pdf(c, org_id, inv["id"]))
    assert "Invoice" in t and "Tax Invoice" not in t
    for word in ("CGST", "SGST", "IGST", "GSTIN", "SAC", "Place of supply"):
        assert word not in t, word
    assert "₹4,999.00" in t and "Rupees Four Thousand Nine Hundred Ninety Nine Only" in t
    assert "AsuraaX AI Private Limited" in t


async def test_gst_split_cgst_sgst_same_state_igst_other_state(
    org, make_client, outbox, client, razorpay, admin_client, db
):
    nm7 = await admin_client("owner")
    await gst_on(nm7, "37")
    # same state (Andhra Pradesh → Andhra Pradesh): CGST 9% + SGST 9%
    c, org_id = org
    await details(c, org_id, "37")
    await buy(c, client, org_id, "pay_SAME")
    [inv] = await docs(c, org_id)
    snap = (await db[INVOICES].find_one({"_id": inv["id"]}))["snapshot"]
    assert [(t["kind"], t["rate_bp"], t["amount"]) for t in snap["tax_lines"]] == [
        ("cgst", 900, 449_91), ("sgst", 900, 449_91)
    ]  # fmt: skip
    assert snap["totals"] == {**snap["totals"], "taxable": 4999_00, "tax": 899_82, "total": 5898_82, "igst": 0}
    assert snap["place_of_supply"] == {"code": "37", "name": "Andhra Pradesh"} and snap["sac"] == "998431"
    t = text(await pdf(c, org_id, inv["id"]))
    assert "Tax Invoice" in t and "CGST @ 9%" in t and "SGST @ 9%" in t and "IGST" not in t
    assert SUPPLIER_GSTIN in t and "998431" in t and "Naresh M" in t and "₹5,898.82" in t

    # another state, a registered buyer (Andhra Pradesh → Karnataka): IGST 18%
    c2, org2 = await new_owner(make_client, outbox, "owner2@college.example", "RV College")
    await details(c2, org2, "29", BUYER_GSTIN)
    await buy(c2, client, org2, "pay_OTHER")
    [inv2] = await docs(c2, org2)
    snap2 = (await db[INVOICES].find_one({"_id": inv2["id"]}))["snapshot"]
    assert [(t["kind"], t["rate_bp"], t["amount"]) for t in snap2["tax_lines"]] == [("igst", 1800, 899_82)]
    assert snap2["recipient"]["gstin"] == BUYER_GSTIN and snap2["place_of_supply"]["code"] == "29"
    t2 = text(await pdf(c2, org2, inv2["id"]))
    assert "IGST @ 18%" in t2 and "CGST" not in t2 and BUYER_GSTIN in t2


def test_amount_in_words_and_money_use_the_indian_system():
    assert in_words(5898_82) == "Rupees Five Thousand Eight Hundred Ninety Eight and Eighty Two Paise Only"
    assert in_words(1_23_45_678_00) == (
        "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only"
    )
    assert money(1_23_45_678_50) == "₹1,23,45,678.50" and money(0) == "₹0.00"


# ---------- numbering ----------


async def test_invoice_numbers_are_consecutive_and_reset_each_financial_year(
    make_client, outbox, client, razorpay, db, monkeypatch
):
    owners = [await new_owner(make_client, outbox, f"o{i}@college.example", f"College {i}") for i in range(5)]
    created = []
    for c, org_id in owners:
        await details(c, org_id, "37")
        r = await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "drive"})
        created.append(r.json())
    # five payments confirmed at the same moment: one number each, no gaps, none reused
    rs = await asyncio.gather(*(pay(client, cr, f"pay_C{i}") for i, cr in enumerate(created)))
    assert all(r.status_code == 200 for r in rs)
    numbers = sorted([d["number"] async for d in db[INVOICES].find({"kind": "invoice"})])
    fy = financial_year(now())
    assert numbers == [f"NM7/{fy}/{n:04d}" for n in range(1, 6)]
    assert all(len(n) <= MAX_NUMBER for n in numbers)
    orders = [await db[ORDERS].find_one({"_id": cr["orderId"]}) for cr in created]
    assert sorted(o["invoice_no"] for o in orders) == numbers  # the order and its invoice share the number

    # a payment in the next financial year starts again at 0001
    c, org_id = owners[0]
    monkeypatch.setattr("app.orders.service.now", lambda: datetime(2031, 4, 1, 3, 0, tzinfo=UTC))
    r = await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "campus"})
    await pay(client, r.json(), "pay_NEXTFY")
    inv = await db[INVOICES].find_one({"order_id": r.json()["orderId"]})
    assert inv["number"] == "NM7/31-32/0001" and inv["fy"] == "31-32" and inv["date"] == "2031-04-01"


async def test_invoice_snapshot_unchanged_after_price_edit(org, client, razorpay, admin_client, db):
    c, org_id = org
    await details(c, org_id, "37")
    await buy(c, client, org_id, "pay_SNAP")
    [inv] = await docs(c, org_id)
    before = (await db[INVOICES].find_one({"_id": inv["id"]}))["snapshot"]
    first = await pdf(c, org_id, inv["id"])

    nm7 = await admin_client("owner")
    plans = {p["id"]: p for p in (await nm7.get("/api/admin/billing/plans")).json()}
    drive = plans["drive"]
    body = {k: drive[k] for k in ("name", "blurb", "periodDays", "limits", "onSale", "public")}
    body["features"] = drive["features"] | {"recruiterLinks": True}
    body["features"].pop("kiosk")
    r = await nm7.put("/api/admin/billing/plans/drive", json={**body, "price": 6999_00})
    assert r.status_code == 200, r.text
    await gst_on(nm7, "37", legalName="Renamed Pvt Ltd")
    await details(c, org_id, "29", BUYER_GSTIN)  # the organization moves state and adds a GSTIN

    doc = await db[INVOICES].find_one({"_id": inv["id"]})
    assert doc["snapshot"] == before and doc["snapshot"]["lines"][0]["rate"] == 4999_00
    assert await pdf(c, org_id, inv["id"]) == first  # the same file, every time
    t = text(first)
    assert "Renamed" not in t and BUYER_GSTIN not in t and "₹4,999.00" in t


# ---------- refunds → credit notes ----------


async def test_refund_issues_credit_note_and_adjusts_plan(org, client, razorpay, admin_client, db):
    nm7 = await admin_client("owner")
    await gst_on(nm7, "37")
    c, org_id = org
    await details(c, org_id, "37")
    created = await buy(c, client, org_id, "pay_REF")
    url = f"/api/admin/orgs/{org_id}/billing/orders/{created['orderId']}/refund"

    # a part refund: a credit note for that part (GST split the same way); the plan stays
    r = await nm7.post(url, json={"amount": 1179_76, "note": "Goodwill: late start"})
    assert r.status_code == 201, r.text
    [cn] = r.json()["creditNotes"]
    fy = financial_year(now())
    assert cn["number"] == f"NM7CN/{fy}/0001" and len(cn["number"]) <= 16 and cn["total"] == 1179_76
    assert cn["against"] == f"NM7/{fy}/0001" and cn["kind"] == "credit_note"
    snap = (await db[INVOICES].find_one({"_id": cn["id"]}))["snapshot"]
    assert snap["totals"]["taxable"] == 999_80 and snap["totals"]["cgst"] == 89_98 and snap["totals"]["sgst"] == 89_98
    assert razorpay.last_json(razorpay.refunds)["amount"] == 1179_76
    assert subscription.state_of(await db[ORGANIZATIONS].find_one({"_id": org_id})) == "active"
    t = text(await pdf(c, org_id, cn["id"]))
    assert "Credit Note" in t and f"NM7/{fy}/0001" in t and "Goodwill: late start" in t

    # Razorpay confirms the first refund (one open refund per order, as for every order) …
    rf = await db[REFUNDS].find_one({"order_id": created["orderId"]})
    ev = {
        "event": "refund.processed",
        "payload": {"refund": {"entity": {"id": rf["razorpay_refund_id"], "amount": rf["amount"]}}},
    }
    assert (await send_webhook(client, ev, "evt_rf1")).status_code == 200
    # … then the rest: a second credit note, the order is refunded and the plan goes back to Free (nothing deleted)
    r = await nm7.post(url, json={"note": "Cancelled by the college"})
    assert r.status_code == 201, r.text
    [cn2] = r.json()["creditNotes"]
    assert cn2["number"] == f"NM7CN/{fy}/0002" and cn2["total"] == 5898_82 - 1179_76
    assert (await db[ORDERS].find_one({"_id": created["orderId"]}))["status"] == "refunded"
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    assert subscription.state_of(o) == "free" and o["subscription_history"][-1]["plan_id"] == "drive"
    r = await nm7.post(url, json={"note": "Again"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_refunded"
    # the invoice itself is never changed; both credit notes are listed for the Owner
    kinds = [d["kind"] for d in await docs(c, org_id)]
    assert sorted(kinds) == ["credit_note", "credit_note", "invoice"]
    actions = {a["action"] async for a in db[AUDIT_LOG].find({"data.orgs": org_id})}
    assert {"credit_note_issued", "plan_refunded", "plan_activated"} <= actions


# ---------- offline payments and proformas ----------


async def test_offline_payment_activates_plan_and_issues_invoice(org, admin_client, db, outbox):
    c, org_id = org
    await details(c, org_id, "37")
    nm7 = await admin_client("finance")
    url = f"/api/admin/orgs/{org_id}/billing/offline-payment"
    body = {"planId": "campus", "method": "bank_transfer", "reference": "UTR123456", "paidOn": "2026-01-05",
            "amount": 1}  # fmt: skip
    r = await nm7.post(url, json=body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "amount_mismatch"
    assert subscription.state_of(await db[ORGANIZATIONS].find_one({"_id": org_id})) == "free"
    r = await nm7.post(url, json={**body, "amount": 24999_00})
    assert r.status_code == 201, r.text
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    assert subscription.state_of(o) == "active" and o["subscription"]["plan_id"] == "campus"
    assert o["subscription"]["source"] == "offline"
    [inv] = await docs(c, org_id)
    assert inv["number"] == r.json()["invoiceNo"] and inv["total"] == 24999_00
    mail = next(m for m in outbox.sent if m.to == "owner@college.example" and "plan active" in m.subject)
    assert (
        mail.attachments and mail.attachments[0][0] == inv["fileName"] and mail.attachments[0][1] == "application/pdf"
    )
    assert text(mail.attachments[0][2]).count("Campus") >= 1
    entry = await db[AUDIT_LOG].find_one({"action": "payment_offline"})
    assert entry["data"]["reference"] == "UTR123456"
    # an Owner can't record payments
    r = await c.post(url, json={**body, "amount": 24999_00})
    assert r.status_code in (401, 403)


async def test_proforma_payment_link_paid_by_webhook(org, client, razorpay, admin_client, db, outbox):
    c, org_id = org
    await details(c, org_id, "37")
    nm7 = await admin_client("owner")
    r = await nm7.post(f"/api/admin/orgs/{org_id}/billing/proforma", json={"planId": "drive", "paymentLink": True})
    assert r.status_code == 201, r.text
    pf = r.json()
    fy = financial_year(now())
    assert pf["number"] == f"NM7PF/{fy}/0001" and pf["paymentLink"].startswith("https://rzp.io/")
    sent = razorpay.last_json(razorpay.links)
    assert sent["amount"] == 4999_00 and sent["reference_id"] == pf["orderId"]
    t = text(await pdf(c, org_id, pf["id"]))
    assert "Proforma Invoice" in t and "not a tax invoice" in t and pf["paymentLink"] in t
    assert subscription.state_of(await db[ORGANIZATIONS].find_one({"_id": org_id})) == "free"

    # Razorpay's own payment.captured for the link's order comes first (no notes) → kept as unmatched money …
    link = razorpay.last_link
    entity = {"id": "pay_LINK1", "entity": "payment", "order_id": "order_PLINK1", "amount": 4999_00,
              "currency": "INR", "method": "upi", "status": "captured"}  # fmt: skip
    await send_webhook(client, {"event": "payment.captured", "payload": {"payment": {"entity": entity}}}, "evt_l1")
    assert await db[PAYMENTS].find_one({"razorpay_payment_id": "pay_LINK1", "order_id": None})
    # … then payment_link.paid: matched, paid, plan on, tax invoice
    ev = {"event": "payment_link.paid", "payload": {
        "payment_link": {"entity": {**link, "status": "paid", "amount_paid": 4999_00}},
        "payment": {"entity": entity}, "order": {"entity": {"id": "order_PLINK1"}}}}  # fmt: skip
    assert (await send_webhook(client, ev, "evt_l2")).status_code == 200
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    assert subscription.state_of(o) == "active" and o["subscription"]["order_id"] == pf["orderId"]
    order = await db[ORDERS].find_one({"_id": pf["orderId"]})
    assert order["status"] == "done" and order["invoice_no"] == f"NM7/{fy}/0001"
    assert not await db[PAYMENTS].find_one({"razorpay_payment_id": "pay_LINK1", "order_id": None})
    assert await db[PAYMENTS].count_documents({}) == 2  # nothing deleted: the earlier record says what it matched
    assert sorted(d["kind"] for d in await docs(c, org_id)) == ["invoice", "proforma"]
    # the same event again changes nothing
    assert (await send_webhook(client, ev, "evt_l3")).status_code == 200
    assert await db[INVOICES].count_documents({"kind": "invoice"}) == 1


async def test_offline_payment_for_a_proforma_closes_its_link(org, razorpay, admin_client, db):
    c, org_id = org
    await details(c, org_id, "37")
    nm7 = await admin_client("owner")
    pf = (
        await nm7.post(f"/api/admin/orgs/{org_id}/billing/proforma", json={"planId": "drive", "paymentLink": True})
    ).json()
    body = {"orderId": pf["orderId"], "method": "cheque", "reference": "CHQ 000123", "paidOn": "2026-01-05",
            "amount": 4999_00}  # fmt: skip
    r = await nm7.post(f"/api/admin/orgs/{org_id}/billing/offline-payment", json=body)
    assert r.status_code == 201, r.text
    assert razorpay.link_cancels.called
    r = await nm7.post(f"/api/admin/orgs/{org_id}/billing/offline-payment", json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_paid"


# ---------- isolation and the register ----------


async def test_org_a_cannot_see_org_b_invoices(org, make_client, outbox, client, razorpay, db):
    c, org_a = org
    await details(c, org_a, "37")
    await buy(c, client, org_a, "pay_A")
    [inv_a] = await docs(c, org_a)
    c2, org_b = await new_owner(make_client, outbox, "owner2@college.example", "RV College")
    assert (await c2.get(f"/api/org/{org_a}/billing/invoices")).status_code in (403, 404)
    assert (await c2.get(f"/api/org/{org_a}/billing/invoices/{inv_a['id']}/pdf")).status_code in (403, 404)
    r = await c2.get(f"/api/org/{org_b}/billing/invoices/{inv_a['id']}/pdf")  # its own org, another's document
    assert r.status_code == 404
    assert await docs(c2, org_b) == []
    # a member of org A (not staff) sees nothing either
    member = make_client()
    await signup(member, outbox, "member@college.example", name="Member")
    assert (await member.get(f"/api/org/{org_a}/billing/invoices")).status_code in (403, 404)


async def test_gstr1_csv_lists_invoices_and_credit_notes(org, make_client, outbox, client, razorpay, admin_client):
    nm7 = await admin_client("owner")
    await gst_on(nm7, "37")
    c, org_id = org
    await details(c, org_id, "37")
    created = await buy(c, client, org_id, "pay_G1")
    c2, org2 = await new_owner(make_client, outbox, "owner2@college.example", "RV College")
    await details(c2, org2, "29", BUYER_GSTIN)
    await buy(c2, client, org2, "pay_G2")
    await nm7.post(f"/api/admin/orgs/{org_id}/billing/orders/{created['orderId']}/refund", json={"note": "Cancelled"})
    fy = financial_year(now())
    r = await nm7.get(f"/api/admin/org-invoices?fy={fy}")
    assert r.status_code == 200, r.text
    listing = r.json()
    assert listing["totals"]["invoice"]["count"] == 2 and listing["totals"]["credit_note"]["count"] == 1
    r = await nm7.get(f"/api/admin/org-invoices/gstr1.csv?fy={fy}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.lstrip("﻿").strip().splitlines()
    assert lines[0].startswith("gstr1_table,document_type,number,date")
    rows = {line.split(",")[2]: line for line in lines[1:]}
    assert (
        rows[f"NM7/{fy}/0001"].startswith("B2CS,Invoice")
        and ",4999.00,0.00,449.91,449.91,0.00,5898.82," in rows[f"NM7/{fy}/0001"]
    )
    assert rows[f"NM7/{fy}/0002"].startswith("B2B,Invoice") and BUYER_GSTIN in rows[f"NM7/{fy}/0002"]
    assert rows[f"NM7CN/{fy}/0001"].startswith(f"CDNUR,Credit note,NM7CN/{fy}/0001")
    assert f"NM7/{fy}/0001" in rows[f"NM7CN/{fy}/0001"]
    # an Owner can't read the register
    assert (await c.get(f"/api/admin/org-invoices/gstr1.csv?fy={fy}")).status_code in (401, 403)
