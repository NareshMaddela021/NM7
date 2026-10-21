"""Phase 4C: partner applications, codes and links, attribution at the first payment, the commission ledger
(earned, payable after 30 days, reversed on refunds, paid out), self-referral and what partners can see."""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.core.db import AUDIT_LOG, COMMISSIONS, ORDERS, ORGANIZATIONS, PARTNERS, REFUNDS
from tests.conftest import send_webhook, signup
from tests.test_billing_invoices import buy, docs, gst_on, new_owner
from tests.test_billing_plans import details, group, pay
from tests.test_orgs import join, member


async def apply(c, email="ravi@partner.example", name="Ravi Kumar"):
    body = {"name": name, "organisation": "Ravi Placements", "email": email, "phone": "+91 98765 43210"}
    r = await c.post("/api/public/partners/apply", json=body)
    assert r.status_code == 201, r.text


async def approved_partner(make_client, outbox, nm7, email="ravi@partner.example", name="Ravi Kumar"):
    """A partner who applied, has an Nm7 account with the same email, and was approved."""
    pc = make_client()
    await apply(pc, email, name)
    await signup(pc, outbox, email, name=name)
    p = next(x for x in (await nm7.get("/api/admin/partners")).json() if x["email"] == email)
    r = await nm7.post(f"/api/admin/partners/{p['id']}/approve", json={})
    assert r.status_code == 200, r.text
    return pc, r.json()


@pytest.fixture
async def nm7(admin_client):
    return await admin_client("owner")


async def referred_org(make_client, outbox, code, email="owner@college.example", name="Sri Venkateswara College"):
    """An Owner who arrived through the partner link (cookie) and filled billing details."""
    c, org_id = await new_owner(make_client, outbox, email, name)
    r = await c.post("/api/public/referral", json={"code": code.lower()})
    assert r.status_code == 200 and r.json()["code"] == code
    await details(c, org_id, "37")
    return c, org_id


async def test_partner_apply_approve_and_dashboard(make_client, outbox, nm7, db):
    pc, p = await approved_partner(make_client, outbox, nm7)
    assert p["code"] == "ASX-RAVI" and p["link"].endswith("/for-orgs?ref=ASX-RAVI") and p["status"] == "approved"
    stored = await db[PARTNERS].find_one({"_id": p["id"]})
    assert set(stored) >= {"name", "organisation", "email", "phone"}
    assert not {"pan", "bank", "account", "ifsc", "aadhaar"} & {k.lower() for k in stored}  # nothing else collected
    mail = next(
        m for m in outbox.sent if m.to == "ravi@partner.example" and "partner" in m.subject and "code" in m.subject
    )
    assert "ASX-RAVI" in mail.text and "/for-orgs?ref=ASX-RAVI" in mail.text
    home = (await pc.get("/api/partner")).json()
    assert home["code"] == "ASX-RAVI" and home["orgs"] == [] and home["totals"]["earned"] == 0
    assert home["terms"] == {"commissionPct": 20, "commissionMonths": 12, "payableDays": 30, "referralDays": 90,
                             "discountPct": 0}  # fmt: skip
    # a second application with the same email changes nothing; the second partner with the same name gets ASX-RAVI2
    await apply(make_client(), "ravi@partner.example")
    assert await db[PARTNERS].count_documents({"email_lc": "ravi@partner.example"}) == 1
    _, p2 = await approved_partner(make_client, outbox, nm7, "ravi2@partner.example", "Ravi Teja")
    assert p2["code"] == "ASX-RAVI2"
    # not a partner: no partner page; an unknown code sets no cookie
    stranger = make_client()
    await signup(stranger, outbox, "someone@example.com", name="Someone")
    assert (await stranger.get("/api/partner")).status_code == 403
    r = await stranger.post("/api/public/referral", json={"code": "ASX-NOBODY"})
    assert r.json()["code"] is None and "nm7_ref" not in r.headers.get("set-cookie", "")


async def test_referral_ties_org_at_first_payment_and_books_commission(
    make_client, outbox, client, razorpay, nm7, db, monkeypatch
):
    pc, p = await approved_partner(make_client, outbox, nm7)
    r = await make_client().post("/api/public/referral", json={"code": "ASX-RAVI"})
    cookie = r.headers["set-cookie"]
    assert "nm7_ref=ASX-RAVI" in cookie and "Max-Age=7776000" in cookie and "HttpOnly" in cookie  # 90 days
    c, org_id = await referred_org(make_client, outbox, "ASX-RAVI")
    assert (await c.get(f"/api/org/{org_id}/billing/quote?plan=drive")).json()["partnerCode"] == "ASX-RAVI"
    created = await buy(c, client, org_id, "pay_P1")
    assert created["partnerCode"] == "ASX-RAVI"
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    assert o["partner"]["partner_id"] == p["id"] and o["partner"]["via"] == "link"
    [e] = await db[COMMISSIONS].find({"partner_id": p["id"]}).to_list(None)
    today = date.fromisoformat(e["earned_on"])
    assert e["kind"] == "commission" and e["base"] == 4999_00 and e["pct"] == 20 and e["amount"] == 999_80
    assert e["payable_on"] == (today + timedelta(days=30)).isoformat()
    home = (await pc.get("/api/partner")).json()
    assert home["totals"] == {"earned": 999_80, "pending": 999_80, "payable": 0, "paid": 0}
    assert [(x["name"], x["plan"]) for x in home["orgs"]] == [("Sri Venkateswara College", "Drive")]

    # a later payment with another partner's code stays with the first partner, and earns commission (first 12 months)
    _, p2 = await approved_partner(make_client, outbox, nm7, "meena@partner.example", "Meena")
    r = await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "campus", "refCode": "ASX-MEENA"})
    assert r.status_code == 201 and r.json()["partnerCode"] is None
    await pay(client, r.json(), "pay_P2")
    assert (await db[ORGANIZATIONS].find_one({"_id": org_id}))["partner"]["partner_id"] == p["id"]
    assert await db[COMMISSIONS].count_documents({"partner_id": p2["id"]}) == 0
    assert await db[COMMISSIONS].count_documents({"partner_id": p["id"]}) == 2

    # 12 months after the first payment: no more commission
    later = datetime.now(UTC) + timedelta(days=370)
    monkeypatch.setattr("app.orders.service.now", lambda: later)
    r = await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "drive"})
    await pay(client, r.json(), "pay_P3")
    assert await db[COMMISSIONS].count_documents({"partner_id": p["id"]}) == 2

    # nothing payable before 30 days; then "mark paid" with a reference pays exactly what's due
    url = f"/api/admin/partners/{p['id']}/payouts"
    r = await nm7.post(url, json={"reference": "UTR998877", "tdsNote": "TDS 194H deducted"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "nothing_payable"
    monkeypatch.setattr("app.partners.router.today_ist", lambda: today + timedelta(days=31))
    r = await nm7.post(url, json={"reference": "UTR998877", "tdsNote": "TDS 194H deducted"})
    assert r.status_code == 201 and r.json()["amount"] == 999_80 + 4999_80 and r.json()["entries"] == 2
    monkeypatch.setattr("app.partners.service.today_ist", lambda: today + timedelta(days=31))
    detail = (await nm7.get(f"/api/admin/partners/{p['id']}")).json()
    assert detail["totals"]["paid"] == 5999_60 and detail["payouts"][0]["reference"] == "UTR998877"
    entry = await db[AUDIT_LOG].find_one({"action": "commission_payout"})
    assert entry["data"]["amount"] == 5999_60 and entry["data"]["tds_note"] == "TDS 194H deducted"
    assert await db[AUDIT_LOG].count_documents({"action": "commission_earned"}) == 2


async def test_self_referral_blocked(make_client, outbox, client, razorpay, nm7, db):
    pc, p = await approved_partner(make_client, outbox, nm7)
    # the partner starts their own organization and types their own code
    r = await pc.post("/api/me/orgs", json={"name": "Ravi Skill Centre", "type": "skill_centre", "city": "Guntur"})
    org_id = r.json()["orgId"]
    await details(pc, org_id, "37")
    r = await pc.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "drive", "refCode": "ASX-RAVI"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "self_referral"
    # … or came through their own link: the code is ignored, the payment goes through, nothing is credited
    await pc.post("/api/public/referral", json={"code": "ASX-RAVI"})
    assert (await pc.get(f"/api/org/{org_id}/billing/quote?plan=drive")).json()["partnerCode"] is None
    await buy(pc, client, org_id, "pay_SELF")
    assert "partner" not in await db[ORGANIZATIONS].find_one({"_id": org_id})
    assert await db[COMMISSIONS].count_documents({}) == 0

    # the partner is a coordinator of another organization: its Owner can't use the partner's code either
    c, other = await new_owner(make_client, outbox, "owner2@college.example", "RV College")
    assert (
        await c.post(f"/api/org/{other}/team", json={"email": "ravi@partner.example", "role": "coordinator"})
    ).status_code == 201
    await details(c, other, "37")
    r = await c.post(f"/api/org/{other}/billing/checkout", json={"planId": "drive", "refCode": "asx-ravi"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "self_referral"
    # and the admin can't tie it by hand
    r = await nm7.put(f"/api/admin/orgs/{other}/partner", json={"partnerId": p["id"], "note": "asked by phone"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "self_referral"


async def test_partner_cannot_see_member_data(make_client, outbox, client, razorpay, nm7, db):
    pc, p = await approved_partner(make_client, outbox, nm7)
    c, org_id = await referred_org(make_client, outbox, "ASX-RAVI")
    assert (await group(c, org_id, "SVC26")).status_code == 201
    m, _ = await member(make_client, outbox, "asha@example.com", "Asha Rao")
    assert (await join(m, "SVC26")).status_code in (200, 201)
    await buy(c, client, org_id, "pay_M1")
    r = await pc.get("/api/partner")
    assert r.status_code == 200
    body = r.text
    assert "Sri Venkateswara College" in body
    for secret in ("Asha", "asha@example.com", "98765 43210", "JNTU", "SVC26", "owner@college.example", org_id):
        assert secret not in body, secret
    assert set(r.json()["orgs"][0]) == {"name", "plan", "since"}
    # and no way into the organization itself
    for path in ("", "/shared-resumes", "/team", "/audit", "/billing", "/billing/invoices"):
        assert (await pc.get(f"/api/org/{org_id}{path}")).status_code in (403, 404), path
    assert (await pc.get("/api/admin/partners")).status_code in (401, 403)


async def test_refund_issues_credit_note_and_reverses_commission(
    make_client, outbox, client, razorpay, nm7, db, monkeypatch
):
    await gst_on(nm7, "37")
    pc, p = await approved_partner(make_client, outbox, nm7)
    c, org_id = await referred_org(make_client, outbox, "ASX-RAVI")
    created = await buy(c, client, org_id, "pay_R1")  # 4,999 + 18% GST = 5,898.82; commission on 4,999 → 999.80
    url = f"/api/admin/orgs/{org_id}/billing/orders/{created['orderId']}/refund"
    # a quarter refunded: credit note, and a quarter of the commission reversed
    r = await nm7.post(url, json={"amount": 1474_71, "note": "Part refund"})
    assert r.status_code == 201, r.text
    [cn] = r.json()["creditNotes"]
    assert cn["kind"] == "credit_note" and cn["taxable"] == 1249_75
    rev = await db[COMMISSIONS].find_one({"kind": "reversal"})
    assert rev["amount"] == -249_95 and rev["refund_id"] and rev["document"] == cn["number"]
    assert (await pc.get("/api/partner")).json()["totals"]["earned"] == 999_80 - 249_95
    # Razorpay confirms, then the rest is refunded: everything reversed, the plan back to Free
    rf = await db[REFUNDS].find_one({"order_id": created["orderId"]})
    ev = {
        "event": "refund.processed",
        "payload": {"refund": {"entity": {"id": rf["razorpay_refund_id"], "amount": rf["amount"]}}},
    }
    await send_webhook(client, ev, "evt_rp1")
    r = await nm7.post(url, json={"note": "Cancelled"})
    assert r.status_code == 201, r.text
    entries = await db[COMMISSIONS].find({"partner_id": p["id"]}).to_list(None)
    assert sum(e["amount"] for e in entries) == 0 and len(entries) == 3
    assert sorted(d["kind"] for d in await docs(c, org_id)) == ["credit_note", "credit_note", "invoice"]
    assert await db[AUDIT_LOG].count_documents({"action": "commission_reversed"}) == 2
    # nothing left to pay out
    today = date.fromisoformat(entries[0]["earned_on"])
    monkeypatch.setattr("app.partners.router.today_ist", lambda: today + timedelta(days=31))
    r = await nm7.post(f"/api/admin/partners/{p['id']}/payouts", json={"reference": "UTR1"})
    assert r.status_code == 409


async def test_admin_corrects_the_partner_and_partner_discount_setting(make_client, outbox, client, razorpay, nm7, db):
    _, p = await approved_partner(make_client, outbox, nm7)
    c, org_id = await new_owner(make_client, outbox, "owner@college.example")
    await details(c, org_id, "37")
    # the partner discount is off by default; switched on, a typed code lowers the price
    q = (await c.get(f"/api/org/{org_id}/billing/quote?plan=drive&ref=ASX-RAVI")).json()
    assert q["partnerCode"] == "ASX-RAVI" and q["discount"] == 0
    s = (await nm7.get("/api/admin/billing/settings")).json()
    s.pop("gstOn"), s.pop("missing")
    await nm7.put("/api/admin/billing/settings", json={**s, "partnerDiscountOn": True, "partnerDiscountPct": 10})
    q = (await c.get(f"/api/org/{org_id}/billing/quote?plan=drive&ref=ASX-RAVI")).json()
    assert q["discount"] == 499_90 and q["total"] == 4499_10
    r = await c.get(f"/api/org/{org_id}/billing/quote?plan=drive&ref=NOPE-1")
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_ref_code"
    # paid without a code: not tied; the admin ties it afterwards (logged); later payments earn commission
    await buy(c, client, org_id, "pay_A1")
    assert await db[COMMISSIONS].count_documents({}) == 0
    r = await nm7.put(
        f"/api/admin/orgs/{org_id}/partner", json={"partnerId": p["id"], "note": "Brought by Ravi offline"}
    )
    assert r.status_code == 200, r.text
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    first = await db[ORDERS].find_one({"org_id": org_id, "paid_at": {"$type": "date"}})
    assert o["partner"]["via"] == "admin" and o["partner"]["since"] == first["paid_at"]  # the period runs from then
    r = await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "drive"})
    await pay(client, r.json(), "pay_A2")
    assert await db[COMMISSIONS].count_documents({"partner_id": p["id"]}) == 1
    assert (await db[AUDIT_LOG].find_one({"action": "org_partner_set"}))["data"]["note"] == "Brought by Ravi offline"
    billing = (await nm7.get(f"/api/admin/orgs/{org_id}/billing")).json()
    assert billing["partner"]["code"] == "ASX-RAVI"
