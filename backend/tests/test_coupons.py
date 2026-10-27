"""Codes (Admin → Codes): free codes unlock at once (no WhatsApp), discounts lower the order, every rule is checked
on the server (expired / paused / scheduled / used up / used before / wrong item / wrong organization), the last use
can't be taken twice, wrong codes are rate limited, used codes can't be deleted, bulk codes are one-time, an
organization's plan turns on like a paid order, Off mode allows only free codes, and only the Owner admin sees codes."""

import asyncio
from datetime import date, timedelta

import pytest

from app.core.db import AUDIT_LOG, COUPON_USES, COUPONS, MEMBERSHIPS, ORDERS, ORGANIZATIONS
from app.coupons.service import forget_user
from tests.conftest import signup
from tests.test_billing_plans import details, owner_org  # noqa: F401  (fixture)
from tests.test_wapay import NUMBER, paid

TODAY = date.today()


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def set_mode(owner, mode):
    body = {"mode": mode, "whatsappNumber": NUMBER if mode == "whatsapp" else "", "replyHours": "9-9",
            "cancelAfterHours": 72}  # fmt: skip
    r = await owner.put("/api/admin/payment-settings", json=body)
    assert r.status_code == 200, r.text


@pytest.fixture
async def whatsapp(owner):
    await set_mode(owner, "whatsapp")


async def make(owner, code="SAVE50", type="percent", value=50, items=("all",), **extra):  # noqa: A002
    body = {"code": code, "type": type, "value": value, "items": list(items), **extra}
    r = await owner.post("/api/admin/coupons", json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def person(make_client, outbox, email="sai@example.com", resume=True):
    c = make_client()
    me = await signup(c, outbox, email)
    if resume:
        r = await c.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": {"personal": {"name": "Sai"}}})
        assert r.status_code in (200, 201), r.text
    return c, me


async def apply(c, code, item="resume", **extra):
    return await c.post("/api/me/codes/apply", json={"code": code, "item": item, **extra})


async def export(c, fmt="pdf", resume_id=None, what="resume"):
    return await c.post("/api/me/exports", json={"format": fmt, "what": what, "resumeId": resume_id})


# ---------- admin only ----------


async def test_only_the_owner_admin_can_open_codes(owner, admin_client, client, outbox):
    await make(owner)
    finance = await admin_client("finance", email="fin@nm7.example")
    await signup(client, outbox)
    routes = [
        ("get", "/api/admin/coupons", None),
        ("get", "/api/admin/coupons/targets", None),
        ("post", "/api/admin/coupons", {"type": "free", "items": ["all"]}),
        ("post", "/api/admin/coupons/bulk", {"type": "free", "items": ["all"], "prefix": "X", "count": 2}),
        ("put", "/api/admin/coupons/SAVE50", {"type": "free", "items": ["all"]}),
        ("post", "/api/admin/coupons/SAVE50/pause", None),
        ("post", "/api/admin/coupons/SAVE50/resume", None),
        ("delete", "/api/admin/coupons/SAVE50", None),
        ("get", "/api/admin/coupons/SAVE50/uses", None),
        ("get", "/api/admin/coupons/SAVE50/uses.csv", None),
    ]
    for c, who in ((client, "customer"), (finance, "finance")):
        for method, url, body in routes:
            r = await getattr(c, method)(url, **({"json": body} if body else {}))
            assert r.status_code == 403, (who, method, url, r.status_code)


# ---------- creating, listing, editing ----------


async def test_create_normalises_and_lists_with_search_and_filters(owner, db):
    row = await make(owner, code=" save 50 ", note="Diwali")
    assert row["code"] == "SAVE50" and row["status"] == "active" and row["label"] == "50% off"
    assert row["uses"] == 0 and row["perLimit"] == 1 and row["totalLimit"] is None
    r = await owner.post("/api/admin/coupons", json={"code": "Save50", "type": "free", "items": ["all"]})
    assert r.status_code == 409 and err(r) == "code_taken"
    auto = await make(owner, code="", type="flat", value=50_00, items=["resume"], totalLimit=100)
    assert len(auto["code"]) == 8 and auto["label"] == "Rs 50 off" and auto["itemNames"] == ["Resume download"]
    await make(owner, code="LATER", type="free", validFrom=(TODAY + timedelta(days=3)).isoformat())
    await make(owner, code="OLD", type="free", validUntil=(TODAY - timedelta(days=1)).isoformat())
    lst = (await owner.get("/api/admin/coupons")).json()["codes"]
    assert {r["code"]: r["status"] for r in lst} == {"SAVE50": "active", auto["code"]: "active", "LATER": "scheduled",
                                                     "OLD": "expired"}  # fmt: skip
    assert [r["code"] for r in (await owner.get("/api/admin/coupons?q=diwali")).json()["codes"]] == ["SAVE50"]
    assert [r["code"] for r in (await owner.get("/api/admin/coupons?q=save")).json()["codes"]] == ["SAVE50"]
    assert {r["code"] for r in (await owner.get("/api/admin/coupons?status=scheduled")).json()["codes"]} == {"LATER"}
    assert {r["code"] for r in (await owner.get("/api/admin/coupons?type=flat")).json()["codes"]} == {auto["code"]}
    r = await owner.post("/api/admin/coupons", json={"type": "percent", "value": 100, "items": ["all"]})
    assert r.status_code == 422
    actions = {a["action"] async for a in db[AUDIT_LOG].find({"action": {"$regex": "^coupon"}})}
    assert actions == {"coupon.created"}


async def test_edit_pause_resume_and_delete_only_when_unused(owner, make_client, outbox, whatsapp, db):
    await make(owner, code="FREE1", type="free", items=["resume"])
    r = await owner.put("/api/admin/coupons/free1", json={"type": "free", "items": ["resume"], "note": "Batch A"})
    assert r.status_code == 200 and r.json()["note"] == "Batch A"
    assert (await owner.post("/api/admin/coupons/FREE1/pause")).json()["status"] == "paused"
    c, _ = await person(make_client, outbox)
    r = await apply(c, "FREE1")
    assert r.status_code == 400 and err(r) == "code_paused"
    assert (await owner.post("/api/admin/coupons/FREE1/resume")).json()["status"] == "active"
    assert (await apply(c, "FREE1")).status_code == 200
    r = await owner.delete("/api/admin/coupons/FREE1")
    assert r.status_code == 409 and err(r) == "code_used"
    # editing keeps the past use and its amounts
    await owner.put("/api/admin/coupons/FREE1", json={"type": "percent", "value": 10, "items": ["all"]})
    uses = (await owner.get("/api/admin/coupons/FREE1/uses")).json()
    assert uses["code"]["uses"] == 1 and uses["uses"][0]["final"] == 0 and uses["uses"][0]["original"] == 99_00
    await make(owner, code="UNUSED")
    assert (await owner.delete("/api/admin/coupons/UNUSED")).status_code == 200
    assert await db[COUPONS].find_one({"_id": "UNUSED"}) is None
    actions = [a["action"] async for a in db[AUDIT_LOG].find({"action": {"$regex": "^coupon"}}).sort("_id", 1)]
    for a in ("coupon.created", "coupon.edited", "coupon.paused", "coupon.resumed", "coupon.redeemed",
              "coupon.deleted"):  # fmt: skip
        assert a in actions, a


# ---------- free codes ----------


async def test_free_code_unlocks_one_resume_for_good_without_whatsapp(owner, make_client, outbox, whatsapp, db):
    await make(owner, code="CAMPUS26", type="free", items=["resume"], totalLimit=100)
    c, me = await person(make_client, outbox)
    assert (await export(c)).status_code == 402
    r = await apply(c, " campus 26 ", resumeId="r1")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["unlocked"] and out["free"] and out["text"] == "Code applied - unlocked" and out["resumeId"] == "r1"
    o = await db[ORDERS].find_one({"_id": out["orderId"]})
    assert o["amount"] == 0 and o["method"] == "coupon" and o["status"] == "done" and o["resume_id"] == "r1"
    assert o["coupon"] == {"code": "CAMPUS26", "type": "free", "value": 0, "original": 99_00, "discount": 99_00,
                           "final": 0}  # fmt: skip
    assert o["paid_at"] is not None and o["receipt_no"]
    assert await db[ORDERS].count_documents({"method": "whatsapp"}) == 0  # no WhatsApp step
    # PDF and Word, again and again
    for fmt in ("pdf", "docx", "pdf", "docx"):
        r = await export(c, fmt, "r1")
        assert r.status_code == 200 and r.json()["reason"] == "resume", r.text
    assert (await export(c, "pdf")).status_code == 200  # the active resume
    assert (await c.get("/api/me/entitlements?resumeId=r1")).json()["canDownload"] is True
    # only that resume: another one, cover letters and the Tailor pack stay locked
    await c.post("/api/me/resumes", json={"id": "r2", "name": "Other", "data": {"personal": {"name": "Sai"}}})
    assert (await export(c, "pdf", "r2")).status_code == 402
    assert (await export(c, "pdf", "r1", what="cover")).status_code == 402
    from app.jobsearch.access import has

    assert await has(db, me["id"], "tailor") is False
    # the same person can't use it twice; the resume reads as already unlocked first
    r = await apply(c, "CAMPUS26", resumeId="r1")
    assert r.status_code in (400, 409) and err(r) in ("already_unlocked", "code_used_before")
    row = (await owner.get("/api/admin/coupons/CAMPUS26/uses")).json()
    assert row["code"]["uses"] == 1 and row["uses"][0]["name"] == "Sai Varsha" and row["uses"][0]["status"] == "used"
    csv = (await owner.get("/api/admin/coupons/CAMPUS26/uses.csv")).text
    assert "CAMPUS26" in csv and "Resume download" in csv and "99" in csv


async def test_free_pack_code_unlocks_like_a_paid_order(owner, make_client, outbox, whatsapp, db):
    await make(owner, code="TAILORFREE", type="free", items=["tailor_pack", "interview_pack"])
    c, me = await person(make_client, outbox)
    r = await apply(c, "tailorfree", item="tailor_pack")
    assert r.status_code == 200 and r.json()["unlocked"], r.text
    from app.jobsearch.access import has

    assert await has(db, me["id"], "tailor") is True
    r = await apply(c, "tailorfree", item="tailor_pack")
    assert r.status_code == 400 and err(r) == "code_used_before"
    await make(owner, code="TAILOR2", type="free", items=["tailor_pack"])
    r = await apply(c, "TAILOR2", item="tailor_pack")  # a second code isn't wasted on what they already have
    assert r.status_code == 409 and err(r) == "already_unlocked"
    assert (await owner.get("/api/admin/coupons/TAILOR2/uses")).json()["uses"] == []
    # per person 1: the Interview pack needs a second use
    r = await apply(c, "tailorfree", item="interview_pack")
    assert r.status_code == 400 and err(r) == "code_used_before"


async def test_free_code_through_the_whatsapp_order_also_unlocks_at_once(owner, make_client, outbox, whatsapp, db):
    await make(owner, code="LIFREE", type="free", items=["linkedin_pack"])
    c, _ = await person(make_client, outbox)
    r = await c.post("/api/orders/whatsapp", json={"planId": "linkedin_pack", "code": "lifree"})
    assert r.status_code == 201 and r.json()["unlocked"] is True and r.json()["amount"] == 0
    assert (await c.get("/api/me/linkedin/pack/status")).json()["owned"] is True
    assert await db[ORDERS].count_documents({"method": "whatsapp"}) == 0


# ---------- discounts ----------


async def test_percent_and_flat_codes_lower_the_whatsapp_order(owner, make_client, outbox, whatsapp, db):
    await make(owner, code="SAVE50", type="percent", value=50, items=["linkedin_pack"])
    await make(owner, code="FLAT50", type="flat", value=50_00, items=["resume"])
    c, _ = await person(make_client, outbox)
    q = (await apply(c, "save50", item="linkedin_pack")).json()
    assert (q["original"], q["discount"], q["final"], q["free"]) == (149_00, 74_50, 74_50, False)
    assert q["text"] == "Rs 149 -> Rs 74.50 with SAVE50" and q["unlocked"] is False
    q = (await apply(c, "FLAT50")).json()
    assert q["text"] == "Rs 99 -> Rs 49 with FLAT50"
    assert await db[COUPON_USES].count_documents({}) == 0  # a quote doesn't use the code
    r = await c.post("/api/orders/whatsapp", json={"planId": "diy", "code": "flat50"})
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["amount"] == 49_00 and "FLAT50" in out["message"] and "Rs 99 -> Rs 49" in out["message"]
    o = await db[ORDERS].find_one({"_id": out["orderId"]})
    assert o["coupon"]["original"] == 99_00 and o["coupon"]["discount"] == 50_00 and o["coupon"]["final"] == 49_00
    assert [i["amount"] for i in o["items"]] == [99_00, -50_00]
    u = await db[COUPON_USES].find_one({"order_id": o["_id"]})
    assert u["status"] == "reserved"
    # the admin marks it paid as now: the use counts for good and the download unlocks (account-wide, as paid)
    r = await paid(owner, o["_id"], amount=49_00)
    assert r.status_code == 200, r.text
    assert (await db[COUPON_USES].find_one({"order_id": o["_id"]}))["status"] == "used"
    assert (await export(c, "docx", "r1")).json()["reason"] == "paid"
    rows = (await owner.get("/api/admin/whatsapp/orders?status=paid")).json()
    rows = rows if isinstance(rows, list) else rows.get("orders", rows.get("rows"))
    assert rows[0]["coupon"] == {"code": "FLAT50", "original": 99_00, "discount": 50_00, "final": 49_00}
    rep = (await owner.get("/api/admin/whatsapp/report?days=30")).json()
    assert rep["codes"] == {"orders": 1, "discount": 50_00, "free": 0}
    csv = (await owner.get("/api/admin/whatsapp/report.csv?days=30")).text
    assert "FLAT50" in csv
    my = (await c.get("/api/orders")).json()
    assert my[0]["coupon"]["code"] == "FLAT50"


async def test_cancelled_order_gives_the_use_back(owner, make_client, outbox, whatsapp, db):
    await make(owner, code="ONE", type="percent", value=10, items=["all"], totalLimit=1)
    a, _ = await person(make_client, outbox)
    b, _ = await person(make_client, outbox, "b@example.com")
    r = await a.post("/api/orders/whatsapp", json={"planId": "diy", "code": "ONE"})
    assert r.status_code == 201
    r2 = await apply(b, "ONE")
    assert r2.status_code == 400 and err(r2) == "code_used_up"
    oid = r.json()["orderId"]
    assert (await owner.post(f"/api/admin/whatsapp/orders/{oid}/cancel", json={"reason": "x"})).status_code == 200
    assert (await db[COUPONS].find_one({"_id": "ONE"}))["uses"] == 0
    assert (await apply(b, "ONE")).status_code == 200


# ---------- the rules ----------


async def test_every_rejection_has_its_own_message(owner, make_client, outbox, whatsapp, db, owner_org):  # noqa: F811
    _, _, org_id = owner_org
    await make(owner, code="OLD", type="free", validUntil=(TODAY - timedelta(days=1)).isoformat())
    await make(owner, code="LATER", type="free", validFrom=(TODAY + timedelta(days=2)).isoformat())
    await make(owner, code="PAUSED", type="free")
    await owner.post("/api/admin/coupons/PAUSED/pause")
    await make(owner, code="GONE", type="percent", value=10, totalLimit=1)
    await make(owner, code="TWICE", type="percent", value=10)
    await make(owner, code="PACKONLY", type="free", items=["tailor_pack"])
    await make(owner, code="ORGONLY", type="free", only={"kind": "org", "id": org_id})
    c, _ = await person(make_client, outbox)
    other, _ = await person(make_client, outbox, "o@example.com")
    assert (await apply(other, "GONE")).status_code == 200
    assert (await other.post("/api/orders/whatsapp", json={"planId": "diy", "code": "GONE"})).status_code == 201
    assert (await c.post("/api/orders/whatsapp", json={"planId": "diy", "code": "TWICE"})).status_code == 201
    expect = {
        "NOPE": ("code_not_found", "couldn’t find"),
        "OLD": ("code_expired", "expired"),
        "LATER": ("code_not_started", "works from"),
        "PAUSED": ("code_paused", "isn’t active"),
        "GONE": ("code_used_up", "fully used"),
        "TWICE": ("code_used_before", "already used"),
        "PACKONLY": ("code_wrong_item", "isn’t valid for the Resume download"),
        "ORGONLY": ("code_wrong_org", "isn’t valid for your organization"),
    }
    for code, (want, text) in expect.items():
        r = await apply(c, code)
        assert r.status_code == 400 and err(r) == want, (code, r.text)
        assert text in r.json()["error"]["message"], (code, r.json())


async def test_org_only_code_works_for_its_members(owner, make_client, outbox, whatsapp, db, owner_org):  # noqa: F811
    _, _, org_id = owner_org
    await make(owner, code="SVCFREE", type="free", items=["resume"], only={"kind": "org", "id": org_id})
    member, me = await person(make_client, outbox)
    outsider, _ = await person(make_client, outbox, "x@example.com")
    await db[MEMBERSHIPS].insert_one({"_id": "m1", "user_id": me["id"], "org_id": org_id, "group_id": "g1",
                                      "left_at": None, "consent": {"given": True}, "approval": "approved"})  # fmt: skip
    assert err(await apply(outsider, "SVCFREE")) == "code_wrong_org"
    assert (await apply(member, "SVCFREE")).json()["unlocked"] is True
    row = (await owner.get("/api/admin/coupons")).json()["codes"][0]
    assert row["only"] == {"kind": "org", "id": org_id, "name": "Sri Venkateswara College"}


async def test_two_people_cannot_take_the_last_use(owner, make_client, outbox, whatsapp, db):
    await make(owner, code="LAST", type="free", items=["resume"], totalLimit=1)
    people = [await person(make_client, outbox, f"p{i}@example.com") for i in range(6)]
    rs = await asyncio.gather(*(apply(c, "LAST") for c, _ in people))
    assert sorted(r.status_code for r in rs) == [200] + [400] * 5
    assert {err(r) for r in rs if r.status_code == 400} == {"code_used_up"}
    assert (await db[COUPONS].find_one({"_id": "LAST"}))["uses"] == 1
    assert await db[COUPON_USES].count_documents({"code": "LAST"}) == 1


async def test_one_person_cannot_use_a_code_twice_at_the_same_moment(owner, make_client, outbox, whatsapp, db):
    await make(owner, code="MINE", type="percent", value=10)
    c, _ = await person(make_client, outbox)
    rs = await asyncio.gather(*(c.post("/api/orders/whatsapp", json={"planId": "diy", "code": "MINE"})
                                for _ in range(4)))  # fmt: skip
    assert sorted(r.status_code for r in rs) == [201, 400, 400, 400]
    assert await db[COUPON_USES].count_documents({"code": "MINE"}) == 1
    assert (await db[COUPONS].find_one({"_id": "MINE"}))["uses"] == 1


async def test_ten_wrong_codes_an_hour_then_a_wait(owner, make_client, outbox, whatsapp):
    await make(owner, code="REAL", type="percent", value=10)
    c, _ = await person(make_client, outbox)
    for i in range(10):
        assert (await apply(c, f"WRONG{i}")).status_code == 400
    r = await apply(c, "REAL")
    assert r.status_code == 429 and "wait" in r.json()["error"]["message"]


async def test_bulk_codes_are_one_time_each(owner, make_client, outbox, whatsapp, db):
    r = await owner.post("/api/admin/coupons/bulk", json={"prefix": "drive", "count": 5, "type": "free",
                                                          "items": ["resume"], "note": "Drive 1"})  # fmt: skip
    assert r.status_code == 201, r.text
    codes = r.json()["codes"]
    assert len(codes) == 5 and len(set(codes)) == 5 and all(k.startswith("DRIVE-") and len(k) == 10 for k in codes)
    a, _ = await person(make_client, outbox)
    b, _ = await person(make_client, outbox, "b@example.com")
    assert (await apply(a, codes[0])).json()["unlocked"]
    assert err(await apply(b, codes[0])) == "code_used_up"
    assert (await apply(b, codes[1])).json()["unlocked"]
    lst = (await owner.get("/api/admin/coupons?q=DRIVE")).json()["codes"]
    assert len(lst) == 5 and all(x["totalLimit"] == 1 and x["batch"] == r.json()["batch"] for x in lst)
    assert await db[AUDIT_LOG].find_one({"action": "coupon.bulk_created", "data.count": 5})


# ---------- payment modes ----------


async def test_off_mode_allows_only_free_codes(owner, make_client, outbox, db):
    await set_mode(owner, "off")
    await make(owner, code="HALF", type="percent", value=50)
    await make(owner, code="GIFT", type="free", items=["interview_pack"])
    c, me = await person(make_client, outbox)
    r = await apply(c, "HALF", item="interview_pack")
    assert r.status_code == 409 and err(r) == "code_needs_payment"
    assert (await apply(c, "GIFT", item="interview_pack")).json()["unlocked"] is True
    from app.jobsearch.access import has

    assert await has(db, me["id"], "interview") is True


async def test_razorpay_order_charges_the_lower_amount(owner, make_client, outbox, razorpay, db):
    await make(owner, code="TEN", type="percent", value=10, items=["expert"])
    c, _ = await person(make_client, outbox)
    r = await c.post("/api/orders", json={"planId": "expert", "role": "Analyst", "addons": [], "code": "ten"})
    assert r.status_code == 201, r.text
    assert r.json()["amount"] == 899_10
    o = await db[ORDERS].find_one({"_id": r.json()["orderId"]})
    assert o["coupon"]["code"] == "TEN" and o["amount"] == 899_10
    assert (await db[COUPON_USES].find_one({"order_id": o["_id"]}))["status"] == "reserved"


# ---------- organization plans ----------


async def test_org_plan_code_turns_the_plan_on_once_per_org(owner, whatsapp, owner_org, db):  # noqa: F811
    c, _, org_id = owner_org
    await details(c, org_id)
    await make(owner, code="DRIVEFREE", type="free", items=["drive"], perLimit=1)
    q = (await c.get(f"/api/org/{org_id}/billing/quote?plan=drive&code=drivefree")).json()
    assert q["total"] == 0 and q["code"] == "DRIVEFREE" and q["free"] is True
    assert q["codeText"] == "Code applied - unlocked"
    r = await c.post(f"/api/org/{org_id}/billing/code", json={"planId": "drive", "code": "DRIVEFREE"})
    assert r.status_code == 201 and r.json()["unlocked"] is True, r.text
    home = (await c.get(f"/api/org/{org_id}")).json()
    assert home["billing"]["planId"] == "drive"
    o = await db[ORDERS].find_one({"_id": r.json()["orderId"]})
    assert o["kind"] == "org" and o["amount"] == 0 and o["status"] == "done" and o["coupon"]["code"] == "DRIVEFREE"
    r = await c.post(f"/api/org/{org_id}/billing/code", json={"planId": "drive", "code": "DRIVEFREE"})
    assert r.status_code == 400 and err(r) == "code_used_before"
    assert "Your organization has already used" in r.json()["error"]["message"]
    assert await db[AUDIT_LOG].find_one({"action": "coupon.redeemed", "data.orgs": org_id})


async def test_org_discount_code_lowers_the_whatsapp_order(owner, whatsapp, owner_org, db):  # noqa: F811
    c, _, org_id = owner_org
    await details(c, org_id)
    await make(owner, code="CAMPUS20", type="percent", value=20, items=["campus"])
    r = await c.post(f"/api/org/{org_id}/billing/whatsapp", json={"planId": "campus", "code": "campus20"})
    assert r.status_code == 201, r.text
    o = await db[ORDERS].find_one({"_id": r.json()["orderId"]})
    assert o["coupon"]["discount"] == 4999_80 and o["billing"]["taxable"] == 19999_20
    assert "CAMPUS20" in r.json()["message"]
    assert (await db[COUPON_USES].find_one({"order_id": o["_id"]}))["who"] == f"org:{org_id}"
    assert err(await c.post(f"/api/org/{org_id}/billing/code", json={"planId": "drive", "code": "campus20"})) == (
        "code_wrong_item"
    )


async def test_org_plan_codes_only_on_billing_and_only_for_their_org(
    owner,
    whatsapp,
    owner_org,  # noqa: F811
    make_client,
    outbox,
    db,  # noqa: F811
):
    c, _, org_id = owner_org
    await details(c, org_id)
    await db[ORGANIZATIONS].insert_one({"_id": "org2", "name": "Other College"})
    await make(owner, code="OTHERORG", type="free", items=["drive"], only={"kind": "org", "id": "org2"})
    r = await c.post(f"/api/org/{org_id}/billing/code", json={"planId": "drive", "code": "OTHERORG"})
    assert r.status_code == 400 and err(r) == "code_wrong_org"
    s, _ = await person(make_client, outbox, "stu@example.com")
    r = await apply(s, "OTHERORG", item="drive")
    assert r.status_code == 400 and err(r) == "code_wrong_item"


# ---------- deleting an account ----------


async def test_forget_user_anonymises_their_uses(owner, make_client, outbox, whatsapp, db):
    await make(owner, code="GIFT", type="free", items=["resume"])
    c, me = await person(make_client, outbox)
    assert (await apply(c, "GIFT")).status_code == 200
    assert await forget_user(db, me["id"]) == 1
    u = await db[COUPON_USES].find_one({"code": "GIFT"})
    assert u["user_id"] is None and u["who"] == "user:forgotten" and u["forgotten"] is True
    row = (await owner.get("/api/admin/coupons/GIFT/uses")).json()["uses"][0]
    assert row["name"] == "Deleted account" and row["email"] == ""
    assert (await db[COUPONS].find_one({"_id": "GIFT"}))["uses"] == 1
