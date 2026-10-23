"""The LinkedIn pack (Rs 149): who owns it. Payments off → nothing to buy, an admin can grant it; payments on →
paid orders (the pack or Career Launch) unlock it, failed / unpaid ones never do, a full refund takes it away."""

import pytest

from app.core.config import get_settings
from app.core.db import LINKEDIN_PACKS, ORDERS, SETTINGS
from tests.conftest import buy, payment_event, send_webhook, signup

QUALITY = {"reason": "quality", "details": "I changed my mind about the LinkedIn pack."}


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def customer(client, outbox):
    await signup(client, outbox)
    return client


@pytest.fixture
def payments_off(monkeypatch):
    monkeypatch.setattr(get_settings(), "razorpay_key_id", "")
    monkeypatch.setattr(get_settings(), "razorpay_key_secret", "")


async def status(c):
    r = await c.get("/api/me/linkedin/pack/status")
    assert r.status_code == 200, r.text
    return r.json()


async def customer_id(admin, email="sai@example.com"):
    items = (await admin.get(f"/api/admin/customers?q={email}")).json()["items"]
    return items[0]["id"]


# ---------- payments off ----------


async def test_payments_off_nothing_on_sale_and_no_order(customer, payments_off):
    s = await status(customer)
    assert s == {
        "owned": False,
        "source": "",
        "orderId": None,
        "purchasedAt": None,
        "paymentsOn": False,
        "onSale": False,
        "price": 149,
    }
    r = await customer.post("/api/orders", json={"planId": "linkedin_pack", "role": None, "addons": []})
    assert r.status_code == 503


async def test_guests_see_the_price_but_own_nothing(client, payments_off):
    s = await status(client)
    assert s["owned"] is False and s["price"] == 149


async def test_admin_grant_unlocks_for_that_customer_only_and_is_audited(
    customer, payments_off, admin_client, make_client, outbox
):
    other = make_client()
    await signup(other, outbox, email="ravi@example.com", name="Ravi")
    owner = await admin_client("owner")
    uid = await customer_id(owner)
    r = await owner.post(f"/api/admin/customers/{uid}/linkedin-pack", json={"granted": True, "note": "testing"})
    assert r.status_code == 200 and r.json()["linkedinPack"]["source"] == "grant"
    s = await status(customer)
    assert s["owned"] is True and s["source"] == "grant" and s["orderId"] is None and s["purchasedAt"]
    assert (await status(other))["owned"] is False  # isolation
    detail = (await owner.get(f"/api/admin/customers/{uid}")).json()
    assert detail["linkedinPack"]["source"] == "grant"
    log = (await owner.get("/api/admin/audit-log?action=linkedin_pack.granted")).json()
    assert log[0]["target"] == uid
    # take it back
    r = await owner.post(f"/api/admin/customers/{uid}/linkedin-pack", json={"granted": False})
    assert r.json()["linkedinPack"] is None and (await status(customer))["owned"] is False
    assert (await owner.get("/api/admin/audit-log?action=linkedin_pack.revoked")).json()[0]["target"] == uid


async def test_grant_needs_the_customers_permission(customer, payments_off, admin_client):
    owner = await admin_client("owner")
    uid = await customer_id(owner)
    quality = await admin_client("quality")
    r = await quality.post(f"/api/admin/customers/{uid}/linkedin-pack", json={"granted": True})
    assert r.status_code == 403
    assert (await customer.post(f"/api/admin/customers/{uid}/linkedin-pack", json={"granted": True})).status_code in (
        401,
        403,
    )


# ---------- payments on ----------


async def test_paid_pack_unlocks_at_once_with_an_invoice(customer, razorpay, db, outbox):
    s = await status(customer)
    assert s["paymentsOn"] is True and s["onSale"] is True and s["owned"] is False
    created, order = await buy(customer, plan="linkedin_pack", role=None)
    assert created["amount"] == 149_00 and "LinkedIn pack" in created["description"]
    assert order["status"] == "done" and order["invoiceNo"].startswith("NM7/")
    s = await status(customer)
    assert s["owned"] is True and s["source"] == "order" and s["orderId"] == order["id"]
    rec = await db[LINKEDIN_PACKS].find_one({})
    assert rec["order_id"] == order["id"] and rec["source"] == "order"
    assert "Your LinkedIn pack is unlocked" in outbox.sent[-1].text


async def test_the_pack_takes_no_add_ons_and_does_not_unlock_downloads(customer, razorpay):
    r = await customer.post("/api/orders", json={"planId": "linkedin_pack", "addons": ["express"]})
    assert r.status_code == 400 and err(r) == "addon_not_allowed"
    await buy(customer, plan="linkedin_pack", role=None)
    assert (await customer.post("/api/me/exports", json={"format": "pdf"})).status_code == 402


async def test_unpaid_or_failed_payment_never_unlocks(customer, razorpay, make_client):
    created, _ = await buy(customer, plan="linkedin_pack", role=None, pay=False)
    ev = payment_event("payment.failed", created["razorpayOrderId"], "pay_FAIL1", 149_00)
    assert (await send_webhook(make_client(), ev)).status_code == 200
    assert (await status(customer))["owned"] is False


async def test_webhook_payment_unlocks(customer, razorpay, make_client):
    created, _ = await buy(customer, plan="linkedin_pack", role=None, pay=False)
    ev = payment_event("payment.captured", created["razorpayOrderId"], "pay_OK1", 149_00)
    assert (await send_webhook(make_client(), ev)).status_code == 200
    s = await status(customer)
    assert s["owned"] is True and s["orderId"] == created["orderId"]


async def test_a_full_refund_takes_access_away(customer, razorpay, admin_client, db):
    _, order = await buy(customer, plan="linkedin_pack", role=None)
    assert (await status(customer))["owned"] is True
    r = await customer.post(f"/api/orders/{order['id']}/refund", json=QUALITY)
    assert r.status_code == 200, r.text
    finance = await admin_client("finance")
    rid = r.json()["refunds"][0]["id"]
    assert (await finance.post(f"/api/admin/refunds/{rid}/approve", json={})).status_code == 200
    assert (await db[ORDERS].find_one({"_id": order["id"]}))["status"] == "refunded"
    assert (await status(customer))["owned"] is False
    assert await db[LINKEDIN_PACKS].count_documents({}) == 0


async def test_a_refunded_order_never_counts_even_if_the_record_stays(customer, razorpay, db):
    _, order = await buy(customer, plan="linkedin_pack", role=None)
    await db[ORDERS].update_one({"_id": order["id"]}, {"$set": {"status": "refunded"}})
    assert (await status(customer))["owned"] is False


async def test_career_launch_includes_the_pack(customer, razorpay):
    _, order = await buy(customer, plan="launch", role="Data Analyst")
    s = await status(customer)
    assert s["owned"] is True and s["source"] == "launch" and s["orderId"] == order["id"]


async def test_grant_refused_once_paid(customer, razorpay, admin_client):
    await buy(customer, plan="linkedin_pack", role=None)
    owner = await admin_client("owner")
    uid = await customer_id(owner)
    r = await owner.post(f"/api/admin/customers/{uid}/linkedin-pack", json={"granted": True})
    assert r.status_code == 409 and err(r) == "already_paid"
    # revoking a grant never removes a paid pack
    await owner.post(f"/api/admin/customers/{uid}/linkedin-pack", json={"granted": False})
    assert (await status(customer))["owned"] is True


async def test_paying_after_a_grant_replaces_it(customer, razorpay, admin_client, db):
    owner = await admin_client("owner")
    uid = await customer_id(owner)
    await owner.post(f"/api/admin/customers/{uid}/linkedin-pack", json={"granted": True})
    _, order = await buy(customer, plan="linkedin_pack", role=None)
    rec = await db[LINKEDIN_PACKS].find_one({"_id": uid})
    assert rec["source"] == "order" and rec["order_id"] == order["id"] and "granted_by" not in rec


async def test_price_is_admin_editable_and_public(customer, razorpay, admin_client, client, db):
    owner = await admin_client("owner")
    r = await owner.put("/api/admin/settings", json={"plans": {"linkedin_pack": {"amount": 199_00, "active": True}}})
    assert r.status_code == 200 and r.json()["plans"]["linkedin_pack"]["amount"] == 199_00
    assert (await status(customer))["price"] == 199
    prices = (await client.get("/api/public/prices")).json()
    assert prices["plans"]["linkedin_pack"] == {"name": "LinkedIn pack", "price": 199, "active": True}
    created, _ = await buy(customer, plan="linkedin_pack", role=None, pay=False)
    assert created["amount"] == 199_00
    # switched off for sale: no new orders, "Coming soon" again
    await db[SETTINGS].update_one({"_id": "site"}, {"$set": {"plans.linkedin_pack.active": False}})
    assert (await status(customer))["onSale"] is False
    r = await customer.post("/api/orders", json={"planId": "linkedin_pack", "addons": []})
    assert r.status_code == 400 and err(r) == "unknown_plan"
