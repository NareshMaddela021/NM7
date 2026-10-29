"""Download gating: guests need an account; once payments are on, downloads need a paid plan."""

import pytest

from app.core.config import get_settings
from app.core.db import ORDERS, SETTINGS
from tests.conftest import buy, signup

PDF = {"format": "pdf", "what": "resume", "name": "Sai_Varsha_Resume.pdf"}


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


async def test_guest_needs_an_account(client):
    e = (await client.get("/api/me/entitlements")).json()
    assert e["canDownload"] is False and e["reason"] == "guest"
    for body in (PDF, {"format": "docx"}, {"format": "pdf", "what": "cover"}):
        r = await client.post("/api/me/exports", json=body)
        assert r.status_code == 401 and err(r) == "not_signed_in"


async def test_guest_needs_an_account_even_while_payments_are_off(client, payments_off):
    assert (await client.get("/api/me/entitlements")).json()["reason"] == "guest"
    assert (await client.post("/api/me/exports", json=PDF)).status_code == 401


async def test_payments_off_means_free_downloads_for_signed_in_users(customer, payments_off):
    e = (await customer.get("/api/me/entitlements")).json()
    assert e == {"canDownload": True, "reason": "payments_off", "paymentsOn": False, "planId": "diy", "price": 99}
    for fmt in ("pdf", "docx"):
        assert (await customer.post("/api/me/exports", json={"format": fmt})).status_code == 200


async def test_unpaid_user_gets_402_with_the_price_from_settings(customer, db):
    await db[SETTINGS].update_one({"_id": "site"}, {"$set": {"plans.diy.amount": 149_00}}, upsert=True)
    e = (await customer.get("/api/me/entitlements")).json()
    assert e["canDownload"] is False and e["reason"] == "unpaid" and e["paymentsOn"] is True and e["price"] == 149
    for body in (PDF, {"format": "docx"}, {"format": "docx", "what": "cover"}):
        r = await customer.post("/api/me/exports", json=body)
        assert r.status_code == 402 and err(r) == "payment_required"
        assert r.json()["error"]["planId"] == "diy" and r.json()["error"]["price"] == 149


async def test_an_unpaid_order_unlocks_nothing(customer, razorpay):
    await buy(customer, plan="diy", role=None, pay=False)
    assert (await customer.post("/api/me/exports", json=PDF)).status_code == 402


@pytest.mark.parametrize(("plan", "reason"), [("diy", "paid"), ("expert", "plan"), ("launch", "plan")])
async def test_any_paid_plan_unlocks_downloads_for_good(customer, razorpay, plan, reason):
    assert (await customer.post("/api/me/exports", json=PDF)).status_code == 402
    await buy(customer, plan=plan, role=None if plan == "diy" else "Data Analyst")
    e = (await customer.get("/api/me/entitlements")).json()
    assert e["canDownload"] is True and e["reason"] == reason
    r = await customer.post("/api/me/exports", json={"format": "docx"})
    assert r.status_code == 200 and r.json()["reason"] == reason


async def test_a_refunded_order_does_not_count(customer, razorpay, db):
    await buy(customer, plan="diy", role=None)
    await db[ORDERS].update_many({}, {"$set": {"status": "refunded"}})
    assert (await customer.post("/api/me/exports", json=PDF)).status_code == 402


async def test_someone_elses_payment_does_not_count(customer, razorpay, make_client, outbox):
    await buy(customer, plan="diy", role=None)
    other = make_client()
    await signup(other, outbox, email="ravi@example.com", name="Ravi")
    assert (await other.post("/api/me/exports", json=PDF)).status_code == 402
    assert (await customer.post("/api/me/exports", json=PDF)).status_code == 200


async def test_admins_can_always_download(admin_client):
    owner = await admin_client("owner")
    e = (await owner.get("/api/me/entitlements")).json()
    assert e["canDownload"] is True and e["reason"] == "admin"
    assert (await owner.post("/api/me/exports", json=PDF)).status_code == 200


async def test_bad_format_is_refused(customer, payments_off):
    r = await customer.post("/api/me/exports", json={"format": "exe"})
    assert r.status_code == 422


async def test_share_link_is_free_but_its_download_follows_the_owner(customer, make_client, razorpay, monkeypatch):
    r = await customer.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": {"personal": {"name": "Sai"}}})
    assert r.status_code == 201
    # publishing a share link needs no payment
    r = await customer.put("/api/me/share", json={"on": True, "slug": "sai-v", "resumeId": "r1"})
    assert r.status_code == 200
    viewer = make_client()
    assert (await viewer.get("/api/public/resumes/sai-v")).json()["canDownload"] is False
    r = await viewer.post("/api/public/resumes/sai-v/export")
    assert r.status_code == 402 and err(r) == "payment_required"
    assert (await viewer.post("/api/public/resumes/nobody/export")).status_code == 404

    await buy(customer, plan="diy", role=None)
    assert (await viewer.get("/api/public/resumes/sai-v")).json()["canDownload"] is True
    assert (await viewer.post("/api/public/resumes/sai-v/export")).status_code == 200

    # while payments are off anyone with the link can download
    await customer.put("/api/me/share", json={"on": True, "slug": "sai-v2", "resumeId": "r1"})
    monkeypatch.setattr(get_settings(), "razorpay_key_id", "")
    assert (await viewer.post("/api/public/resumes/sai-v2/export")).status_code == 200


async def test_approved_experts_can_download_but_applicants_cannot(make_client, outbox, db):
    from tests.conftest import approved_expert

    expert, _ = await approved_expert(make_client, outbox, db)
    assert (await expert.get("/api/me/entitlements")).json()["reason"] == "expert"
    assert (await expert.post("/api/me/exports", json=PDF)).status_code == 200
    applicant = make_client()
    await signup(applicant, outbox, email="new@example.com", role="expert")
    assert (await applicant.post("/api/me/exports", json=PDF)).status_code == 402
