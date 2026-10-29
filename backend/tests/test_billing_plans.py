"""Phase 4A: organization plans, limits, checkout (webhook-only activation), expiry with grace, reminders,
the Owner role, admin plan editor and billing settings."""

from datetime import date, timedelta

import pytest

from app.billing import subscription
from app.billing.gst import _CHARS, gstin_checksum_ok, gstin_problem
from app.core.db import MEMBERSHIPS, ORDERS, ORGANIZATIONS
from tests.conftest import checkout_signature, payment_event, send_webhook, signup
from tests.test_orgs import RESUME, join, member


def gstin(prefix14: str) -> str:
    """A GSTIN with the right check digit (the test data is invented)."""
    for ch in _CHARS:
        if gstin_checksum_ok(prefix14 + ch):
            return prefix14 + ch
    raise AssertionError


BUYER_GSTIN = gstin("29AAACN1234F1Z")  # Karnataka


@pytest.fixture
async def owner_org(make_client, outbox):
    """A signed-in person who started an organization from /for-orgs ("Start free"): its Owner."""
    c = make_client()
    me = await signup(c, outbox, "owner@college.example", name="Priya Owner")
    r = await c.post("/api/me/orgs", json={"name": "Sri Venkateswara College", "type": "college", "city": "Tirupati"})
    assert r.status_code == 201, r.text
    return c, me, r.json()["orgId"]


async def details(c, org_id, state="29", gst=""):
    body = {"legalName": "Sri Venkateswara College Trust", "address": "1 College Road, Tirupati 517502",
            "stateCode": state, "gstin": gst, "email": "accounts@college.example"}  # fmt: skip
    r = await c.put(f"/api/org/{org_id}/billing/details", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def group(c, org_id, code="SVC26"):
    return await c.post(f"/api/org/{org_id}/groups", json={"name": "2026 batch", "code": code})


async def pay(client, created, payment_id="pay_ORG1"):
    ev = payment_event("payment.captured", created["razorpayOrderId"], payment_id, created["amount"])
    return await send_webhook(client, ev, event_id=f"evt_{payment_id}")


# ---------- Start free, Owner, billing page ----------


async def test_start_free_makes_an_owner_on_the_free_plan(owner_org, db):
    c, me, org_id = owner_org
    home = (await c.get(f"/api/org/{org_id}")).json()
    assert home["role"] == "owner" and home["isOwner"] and home["canManage"]
    assert home["billing"]["planId"] == "free" and home["billing"]["state"] == "free"
    assert home["billing"]["limits"] == {"members": 50, "groups": 1, "coordinators": 1, "kiosks": 0, "recruiters": 0}
    assert home["features"]["kiosk"] is False and home["features"]["branding"] is False
    page = (await c.get(f"/api/org/{org_id}/billing")).json()
    assert [p["id"] for p in page["plans"]] == ["drive", "campus"]
    assert page["plans"][0]["price"] == 4999_00 and page["plans"][1]["price"] == 24999_00
    assert page["testMode"] is True and page["details"] is None


async def test_coordinators_cannot_open_billing(owner_org, admin_client, make_client, outbox, db):
    _, _, org_id = owner_org
    nm7 = await admin_client("owner")
    r = await nm7.post(f"/api/admin/orgs/{org_id}/staff", json={"email": "coord@example.com", "role": "coordinator"})
    assert r.status_code == 201, r.text
    token = r.json()["inviteUrl"].rsplit("/", 1)[1]
    c = make_client()
    await signup(c, outbox, "coord@example.com", name="Coord")
    assert (await c.post(f"/api/org-invites/{token}/accept", json={})).status_code == 200
    r = await c.get(f"/api/org/{org_id}/billing")
    assert r.status_code == 403 and r.json()["error"]["code"] == "viewer_only"
    home = (await c.get(f"/api/org/{org_id}")).json()
    assert home["isOwner"] is False and home["billing"]["planId"] == "free"  # banners still shown


async def test_gstin_must_be_valid_and_match_the_state(owner_org):
    c, _, org_id = owner_org
    bad = {"legalName": "Trust", "address": "1 College Road", "stateCode": "29", "gstin": "29AAACN1234F1Z0"}
    r = await c.put(f"/api/org/{org_id}/billing/details", json=bad)
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_gstin"
    r = await c.put(f"/api/org/{org_id}/billing/details", json={**bad, "stateCode": "33", "gstin": BUYER_GSTIN})
    assert r.status_code == 400 and "Karnataka" in r.json()["error"]["message"]
    assert (await details(c, org_id, "29", BUYER_GSTIN.lower()))["gstin"] == BUYER_GSTIN
    assert gstin_problem("27AAPFU0939F1ZV") is None  # a well-known valid GSTIN format example


# ---------- checkout: the plan turns on only from the verified webhook ----------


async def test_plan_activates_only_from_verified_webhook(owner_org, client, razorpay, db, outbox):
    c, _, org_id = owner_org
    r = await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "drive"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "billing_details_required"
    await details(c, org_id)
    r = await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "drive", "amount": 1})
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["amount"] == 4999_00  # GST is off until a supplier GSTIN is entered; the browser sets no amount
    assert razorpay.last_json(razorpay.orders)["amount"] == 4999_00

    # the browser's checkout handler (a valid signature) changes nothing
    pid = "pay_ORG1"
    r = await c.post("/api/payments/verify", json={
        "razorpay_order_id": created["razorpayOrderId"], "razorpay_payment_id": pid,
        "razorpay_signature": checkout_signature(created["razorpayOrderId"], pid)})  # fmt: skip
    assert r.status_code == 200 and r.json()["status"] == "pending_payment"
    assert not razorpay.payments.called  # not even asked: the webhook is the only way in
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    assert subscription.state_of(o) == "free"

    # a forged webhook (wrong secret) is refused
    ev = payment_event("payment.captured", created["razorpayOrderId"], pid, created["amount"])
    r = await send_webhook(client, ev, secret="not-the-secret")
    assert r.status_code == 400
    assert subscription.state_of(await db[ORGANIZATIONS].find_one({"_id": org_id})) == "free"

    # a captured payment for a different amount doesn't turn it on
    r = await send_webhook(client, payment_event("payment.captured", created["razorpayOrderId"], pid, 100), "evt_x")
    assert r.status_code == 200
    assert subscription.state_of(await db[ORGANIZATIONS].find_one({"_id": org_id})) == "free"

    # the verified webhook does
    assert (await pay(client, created, pid)).status_code == 200
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    assert subscription.state_of(o) == "active" and o["subscription"]["plan_id"] == "drive"
    start = date.fromisoformat(o["subscription"]["starts_on"])
    assert date.fromisoformat(o["subscription"]["ends_on"]) == start + timedelta(days=59)  # 60 days, inclusive
    order = await db[ORDERS].find_one({"_id": created["orderId"]})
    assert order["status"] == "done" and order["kind"] == "org" and order["invoice_no"].startswith("NM7/")
    home = (await c.get(f"/api/org/{org_id}")).json()
    assert home["features"]["kiosk"] and home["features"]["branding"] and home["features"]["recruiterLinks"]
    assert home["billing"]["limits"]["members"] == 500
    assert any("Drive plan active" in m.subject for m in outbox.sent)
    # a replayed webhook changes nothing
    assert (await pay(client, created, pid)).json().get("duplicate") is True
    # org orders never show up as the Owner's personal orders or unlock personal downloads
    assert (await c.get("/api/orders")).json() == []
    assert (await c.get("/api/me/entitlements")).json()["reason"] != "plan"


async def test_live_key_is_refused_while_razorpay_is_in_test_mode(owner_org, razorpay, monkeypatch):
    from app.core.config import get_settings

    c, _, org_id = owner_org
    await details(c, org_id)
    monkeypatch.setattr(get_settings(), "razorpay_key_id", "rzp_live_abc")
    r = await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "drive"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "payments_test_mode"
    assert not razorpay.orders.called


async def test_org_discount_applies_before_gst(owner_org, admin_client, razorpay):
    c, _, org_id = owner_org
    await details(c, org_id)
    nm7 = await admin_client("owner")
    custom = {"price": 9999_00, "periodMonths": 6,
              "limits": {"members": 1000, "groups": 8, "coordinators": 4, "kiosks": 2},
              "features": {"branding": True, "recruiterLinks": False, "membersDownloadFree": True}}  # fmt: skip
    r = await nm7.put(f"/api/admin/orgs/{org_id}/billing/pricing", json={"discountPct": 10, "customPlan": custom})
    assert r.status_code == 200, r.text
    q = (await c.get(f"/api/org/{org_id}/billing/quote?plan=drive")).json()
    assert (q["listPrice"], q["discount"], q["taxable"], q["total"]) == (4999_00, 499_90, 4499_10, 4499_10)
    page = (await c.get(f"/api/org/{org_id}/billing")).json()
    assert [p["id"] for p in page["plans"]] == ["drive", "campus", "custom"]
    q = (await c.get(f"/api/org/{org_id}/billing/quote?plan=custom")).json()
    assert q["listPrice"] == 9999_00 and q["taxable"] == 8999_10


# ---------- limits ----------


async def test_limit_reached_pauses_joins_without_deleting(owner_org, admin_client, make_client, outbox, db):
    c, _, org_id = owner_org
    nm7 = await admin_client("owner")
    free = next(p for p in (await nm7.get("/api/admin/billing/plans")).json() if p["id"] == "free")
    free["limits"]["members"] = 2
    r = await nm7.put("/api/admin/billing/plans/free", json=free)
    assert r.status_code == 200 and r.json()["version"] == 2
    assert (await group(c, org_id)).status_code == 201
    for i in range(2):
        m, _ = await member(make_client, outbox, f"m{i}@example.com", f"Member {i}")
        assert (await join(m, code="SVC26", roll=f"R{i}")).status_code == 201
    third, _ = await member(make_client, outbox, "m2@example.com", "Member 2")
    r = await join(third, code="SVC26", roll="R2")
    assert r.status_code == 409 and r.json()["error"]["code"] == "org_limit"
    assert "upgrade" in r.json()["error"]["message"]
    assert await db[MEMBERSHIPS].count_documents({"org_id": org_id, "left_at": None}) == 2  # nobody removed
    # a member who already joined can still update their answers
    first = make_client()
    await first.post("/api/auth/login", json={"email": "m0@example.com", "password": "Nm7@2026x"})
    assert (await join(first, code="SVC26", roll="R0-new")).status_code == 201
    # the Owner's second group is paused too (Free: 1 group), with the upgrade message
    r = await group(c, org_id, code="SVC27")
    assert r.status_code == 409 and r.json()["error"]["code"] == "plan_limit"
    assert "ask your Owner to upgrade" in r.json()["error"]["message"]
    # the banners: members 100% used, groups 100% used
    b = (await c.get(f"/api/org/{org_id}")).json()["billing"]
    assert {w["key"] for w in b["warnings"] if w["kind"] == "usage"} == {"members", "groups"}
    # everything is still readable
    rows = (await c.get(f"/api/org/{org_id}/shared-resumes")).json()
    assert rows["total"] == 2
    # Nm7's admins may go over on purpose
    assert (
        await nm7.post(f"/api/admin/orgs/{org_id}/groups", json={"name": "Extra", "code": "SVC28"})
    ).status_code == 201


async def test_owner_invites_coordinators_within_the_plan(owner_org, outbox):
    c, _, org_id = owner_org
    r = await c.post(f"/api/org/{org_id}/team", json={"email": "a@example.com", "role": "coordinator"})
    assert r.status_code == 201, r.text
    r = await c.post(f"/api/org/{org_id}/team", json={"email": "b@example.com", "role": "viewer"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "plan_limit"
    r = await c.post(f"/api/org/{org_id}/team", json={"email": "c@example.com", "role": "owner"})
    assert r.status_code == 422  # only Nm7 makes Owners
    team = (await c.get(f"/api/org/{org_id}/team")).json()
    assert sorted(t["role"] for t in team) == ["coordinator", "owner"]
    owner_row = next(t for t in team if t["role"] == "owner")
    r = await c.delete(f"/api/org/{org_id}/team/{owner_row['id']}")
    assert r.status_code == 403


async def test_kiosk_limit_comes_from_the_plan(owner_org, admin_client, db):
    c, _, org_id = owner_org
    assert (await group(c, org_id)).status_code == 201
    g = (await c.get(f"/api/org/{org_id}")).json()["groupList"][0]
    body = {"groupId": g["id"], "label": "Stall 1", "pin": "4321"}
    assert (await c.post(f"/api/org/{org_id}/kiosks", json=body)).status_code == 404  # Free: no kiosks
    nm7 = await admin_client("owner")
    r = await nm7.put(f"/api/admin/orgs/{org_id}/billing/plan", json={"planId": "drive"})
    assert r.status_code == 200, r.text
    for i in range(3):
        assert (await c.post(f"/api/org/{org_id}/kiosks", json={**body, "label": f"Stall {i}"})).status_code == 201
    r = await c.post(f"/api/org/{org_id}/kiosks", json={**body, "label": "Stall 4"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "plan_limit"


# ---------- expiry: grace, then Free limits; reminders ----------


async def test_plan_expiry_grace_then_free_limits(owner_org, admin_client, make_client, outbox, db, monkeypatch):
    c, _, org_id = owner_org
    nm7 = await admin_client("owner")
    start = date(2026, 1, 1)
    body = {"planId": "drive", "startsOn": start.isoformat(), "endsOn": "2026-03-01"}
    assert (await nm7.put(f"/api/admin/orgs/{org_id}/billing/plan", json=body)).status_code == 200

    def on(day: str):
        monkeypatch.setattr(subscription, "today_ist", lambda: date.fromisoformat(day))

    on("2026-01-15")  # while the plan runs: two groups and a member
    for code in ("SVC26", "SVC27"):
        assert (await group(c, org_id, code=code)).status_code == 201
    m, _ = await member(make_client, outbox, "m@example.com", "Member")
    assert (await join(m, code="SVC26", roll="R1")).status_code == 201

    on("2026-02-25")  # active, ends within 7 days: banner
    b = (await c.get(f"/api/org/{org_id}")).json()["billing"]
    assert b["state"] == "active" and b["daysLeft"] == 4
    assert any(w["kind"] == "ends_soon" for w in b["warnings"])

    on("2026-03-05")  # ended, inside the 7-day grace: still Drive
    home = (await c.get(f"/api/org/{org_id}")).json()
    assert home["billing"]["state"] == "grace" and home["billing"]["planId"] == "drive"
    assert home["features"]["kiosk"] is True
    assert any(w["kind"] == "grace" for w in home["billing"]["warnings"])

    on("2026-03-09")  # grace over: Free limits; nothing deleted, still readable
    home = (await c.get(f"/api/org/{org_id}")).json()
    assert home["billing"]["state"] == "expired" and home["billing"]["planId"] == "free"
    assert home["features"]["kiosk"] is False and home["features"]["branding"] is False
    assert len(home["groupList"]) == 2 and home["members"] == 1
    assert (await c.get(f"/api/org/{org_id}/shared-resumes")).json()["total"] == 1
    r = await group(c, org_id, code="SVC28")  # 2 groups already, Free allows 1
    assert r.status_code == 409 and r.json()["error"]["code"] == "plan_limit"
    # renewing starts today (the old plan lapsed)
    await details(c, org_id)
    q = (await c.get(f"/api/org/{org_id}/billing/quote?plan=drive")).json()
    assert q["total"] == 4999_00


async def test_reminders_14_7_1_then_grace_then_free_each_once(owner_org, admin_client, outbox, db, monkeypatch):
    c, _, org_id = owner_org
    nm7 = await admin_client("owner")
    body = {"planId": "campus", "startsOn": "2026-01-01", "endsOn": "2026-06-30"}
    assert (await nm7.put(f"/api/admin/orgs/{org_id}/billing/plan", json=body)).status_code == 200

    async def run(day: str) -> list[str]:
        monkeypatch.setattr(subscription, "today_ist", lambda: date.fromisoformat(day))
        before = len(outbox.sent)
        await subscription.run_reminders(db, 1, outbox)
        return [m.subject for m in outbox.sent[before:] if m.to == "owner@college.example" and "plan" in m.subject]

    assert await run("2026-06-01") == []
    assert "ends in 14 days" in (await run("2026-06-16"))[0]
    assert await run("2026-06-17") == []  # once
    assert "ends in 7 days" in (await run("2026-06-25"))[0]  # (the day-13 … day-8 passes send nothing)
    assert "ends in 1 day" in (await run("2026-06-29"))[0]
    assert "has ended" in (await run("2026-07-02"))[0]
    assert await run("2026-07-03") == []
    assert "Free plan now" in (await run("2026-07-08"))[0]
    assert await run("2026-07-20") == []


async def test_a_missed_reminder_is_not_sent_late(owner_org, admin_client, outbox, db, monkeypatch):
    _, _, org_id = owner_org
    nm7 = await admin_client("owner")
    body = {"planId": "drive", "startsOn": "2026-01-01", "endsOn": "2026-01-31"}
    assert (await nm7.put(f"/api/admin/orgs/{org_id}/billing/plan", json=body)).status_code == 200
    monkeypatch.setattr(subscription, "today_ist", lambda: date(2026, 1, 27))  # 4 days left: 7-day one, not 14
    await subscription.run_reminders(db, 1, outbox)
    subjects = [m.subject for m in outbox.sent if m.to == "owner@college.example" and "plan" in m.subject]
    assert len(subjects) == 1 and "ends in 7 days" in subjects[0]


# ---------- admin ----------


async def test_plan_edits_are_versioned_and_never_change_a_bought_plan(owner_org, admin_client, client, razorpay, db):
    c, _, org_id = owner_org
    await details(c, org_id)
    created = (await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "drive"})).json()
    nm7 = await admin_client("owner")
    drive = next(p for p in (await nm7.get("/api/admin/billing/plans")).json() if p["id"] == "drive")
    drive.update(price=5999_00)
    drive["limits"]["members"] = 400
    r = await nm7.put("/api/admin/billing/plans/drive", json=drive)
    assert r.status_code == 200
    saved = r.json()
    assert saved["version"] == 2 and saved["history"][0]["price"] == 4999_00
    # the order started before the edit is paid at its own price and gets the terms it was sold on
    assert (await pay(client, created)).status_code == 200
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    assert o["subscription"]["price"] == 4999_00 and o["subscription"]["limits"]["members"] == 500
    assert o["subscription"]["plan_version"] == 1
    # new checkouts use the new price
    assert (await c.get(f"/api/org/{org_id}/billing/quote?plan=drive")).json()["listPrice"] == 5999_00


async def test_feature_overrides_sit_on_top_of_the_plan(owner_org, admin_client):
    c, _, org_id = owner_org
    nm7 = await admin_client("owner")
    r = await nm7.put(f"/api/admin/orgs/{org_id}/features", json={"branding": True})
    assert r.json()["features"]["branding"] is True and r.json()["featureOverrides"]["branding"] is True
    await nm7.put(f"/api/admin/orgs/{org_id}/billing/plan", json={"planId": "drive"})
    r = await nm7.put(f"/api/admin/orgs/{org_id}/features", json={"recruiterLinks": False})
    assert r.json()["features"]["recruiterLinks"] is False  # forced off despite Drive
    r = await nm7.put(f"/api/admin/orgs/{org_id}/features", json={"recruiterLinks": None})
    assert r.json()["features"]["recruiterLinks"] is True and r.json()["featureOverrides"]["recruiterLinks"] is None


async def test_billing_settings_validate_the_supplier_gstin(admin_client):
    nm7 = await admin_client("owner")
    s = (await nm7.get("/api/admin/billing/settings")).json()
    assert s["supplier"]["legalName"] == "AsuraaX AI Private Limited" and s["gstOn"] is False
    assert s["commissionPct"] == 20 and s["razorpayLive"] is False and s["partnerDiscountOn"] is False
    assert "GSTIN" in s["missing"]
    s["supplier"].update(gstin="29AAACN1234F1Z0", stateCode="29")
    r = await nm7.put("/api/admin/billing/settings", json=s)
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_gstin"
    s["supplier"].update(gstin=gstin("29AABCA1234B1Z"), address="Bengaluru", signatory="Naresh", sac="998314")
    r = await nm7.put("/api/admin/billing/settings", json=s)
    assert r.status_code == 200 and r.json()["gstOn"] is True and r.json()["missing"] == []
    finance = await admin_client("finance", email="fin@nm7.si")
    assert (await finance.put("/api/admin/billing/settings", json=s)).status_code == 403


async def test_admin_dashboard_counts_org_revenue_and_renewals(owner_org, admin_client, client, razorpay, db):
    c, _, org_id = owner_org
    await details(c, org_id)
    created = (await c.post(f"/api/org/{org_id}/billing/checkout", json={"planId": "drive"})).json()
    await pay(client, created)
    nm7 = await admin_client("owner")
    s = (await nm7.get("/api/admin/billing/summary")).json()
    assert s["revenue"] == 4999_00 and s["activePaidOrgs"] == 1 and s["renewalsDue"] == []
    await db[ORGANIZATIONS].update_one(
        {"_id": org_id}, {"$set": {"subscription.ends_on": (date.today() + timedelta(days=10)).isoformat()}}
    )
    s = (await nm7.get("/api/admin/billing/summary")).json()
    assert [r["orgId"] for r in s["renewalsDue"]] == [org_id]


async def test_old_organizations_keep_working_after_the_upgrade(admin_client, db):
    """Organizations created before plans existed get no plan limits until Nm7 assigns a plan (the migration)."""
    from app.billing import migrate
    from app.core.db import SETTINGS

    nm7 = await admin_client("owner")
    org = (await nm7.post("/api/admin/orgs", json={"name": "Old College", "type": "college"})).json()
    await db[ORGANIZATIONS].update_one({"_id": org["id"]}, {"$set": {"features": {"kiosk": False, "branding": True}}})
    await db[SETTINGS].delete_one({"_id": migrate.MARKER_ID})
    assert await migrate.run(db) is True
    assert await migrate.run(db) is False  # once
    o = await db[ORGANIZATIONS].find_one({"_id": org["id"]})
    assert subscription.limits_of(o) == {
        "members": None,
        "groups": None,
        "coordinators": None,
        "kiosks": None,
        "recruiters": None,
    }
    assert o["features"] == {"branding": True}  # an old "off" now follows the plan; "on" stays
    _ = RESUME
