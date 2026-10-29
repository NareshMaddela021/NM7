"""The annual student pass (P1): Rs 199 a year (price from Settings & prices) unlocks downloads, the Tailor,
Interview and LinkedIn packs for 12 months; WhatsApp orders marked paid by the admin; codes ("Annual pass" in the
Applies-to list); admin grant; a second pass extends; a refund takes it away; after it ends, things bought
separately stay unlocked; the 7-day reminder (once); Off mode; the daily summary counts passes."""

from datetime import timedelta

from app.automation import run_rules
from app.core.db import ORDERS
from app.core.time import now
from app.jobsearch.access import has
from app.linkedin.pack import pack_status
from app.me import student_pass
from tests.test_coupons import apply, make, person, set_mode
from tests.test_wapay import NUMBER, err, order, paid  # noqa: F401


async def everything(c, db, uid):
    ok = (await c.post("/api/me/exports", json={"format": "pdf", "what": "resume"})).status_code == 200
    return {
        "downloads": ok,
        "tailor": await has(db, uid, "tailor"),
        "interview": await has(db, uid, "interview"),
        "linkedin": (await pack_status(db, uid)) is not None,
    }


ALL = {"downloads": True, "tailor": True, "interview": True, "linkedin": True}
NONE = {"downloads": False, "tailor": False, "interview": False, "linkedin": False}


async def test_whatsapp_pass_unlocks_everything_for_12_months(admin_client, make_client, outbox, db):
    owner = await admin_client("owner")
    await set_mode(owner, "whatsapp")
    c, me = await person(make_client, outbox)
    uid = me["id"]
    assert await everything(c, db, uid) == NONE
    st = (await c.get("/api/me/pass")).json()
    assert st == {"active": False, "until": None, "untilText": "", "source": "", "price": 199.0, "onSale": True,
                  "mode": "whatsapp"}  # fmt: skip
    o = await order(c, plan="annual_pass")
    assert (await paid(owner, o["orderId"], amount=199_00)).status_code == 200
    assert await everything(c, db, uid) == ALL
    st = (await c.get("/api/me/pass")).json()
    assert st["active"] and st["source"] == "order"
    until = (await student_pass.active(db, uid))["until"]
    paid_at = (await db[ORDERS].find_one({"_id": o["orderId"]}))["paid_at"]
    assert until - paid_at == timedelta(days=365)
    # what each page asks the server
    assert (await c.get("/api/me/entitlements")).json()["reason"] == "pass"
    li = (await c.get("/api/me/linkedin/pack/status")).json()
    assert li["owned"] is True and li["source"] == "pass"
    jobs = (await c.get("/api/me/jobs/access")).json()
    assert jobs["tailor"] and jobs["interview"] and jobs["tailorSource"] == "pass"
    detail = (await owner.get(f"/api/admin/customers/{uid}")).json()
    assert detail["annualPass"]["source"] == "order" and detail["linkedinPack"]["source"] == "pass"
    # a second pass bought early starts when the first ends
    o2 = await order(c, plan="annual_pass")
    await paid(owner, o2["orderId"], reference="UTR222222222", amount=199_00)
    assert (await student_pass.active(db, uid))["until"] - paid_at == timedelta(days=730)
    # the daily summary counts passes
    from app.admin.daily import numbers
    from app.core.time import IST

    n = await numbers(db, now().astimezone(IST).date())
    assert n["passesSold"] == 2


async def test_expiry_keeps_separate_purchases_and_refund_takes_it_away(admin_client, make_client, outbox, db):
    owner = await admin_client("owner")
    await set_mode(owner, "whatsapp")
    c, me = await person(make_client, outbox)
    uid = me["id"]
    o = await order(c, plan="annual_pass")
    await paid(owner, o["orderId"], amount=199_00)
    li = await order(c, plan="linkedin_pack")  # bought separately as well
    await paid(owner, li["orderId"], reference="UTR333333333", amount=149_00)
    # 366 days later: the pass has ended; the LinkedIn pack bought on its own stays
    await db[ORDERS].update_many(
        {"customer_id": uid, "plan": "annual_pass"}, {"$set": {"paid_at": now() - timedelta(days=366)}}
    )
    assert await everything(c, db, uid) == {**NONE, "linkedin": True}
    assert (await c.get("/api/me/pass")).json()["active"] is False
    # a refunded pass: gone at once
    c2, me2 = await person(make_client, outbox, "two@example.com")
    o = await order(c2, plan="annual_pass")
    await paid(owner, o["orderId"], reference="UTR444444444", amount=199_00)
    assert (await everything(c2, db, me2["id"]))["tailor"] is True
    body = {"method": "upi", "reference": "RFD-1234"}
    r = await owner.post(f"/api/admin/whatsapp/orders/{o['orderId']}/refund", json=body)
    assert r.status_code == 200, r.text
    assert await everything(c2, db, me2["id"]) == NONE


async def test_codes_admin_grant_and_off_mode(admin_client, make_client, outbox, db):
    owner = await admin_client("owner")
    await set_mode(owner, "whatsapp")
    # "Annual pass" in a code's Applies-to list
    await make(owner, code="PASSFREE", type="free", items=["annual_pass"])
    await make(owner, code="HALF", type="percent", value=50, items=["annual_pass"])
    await make(owner, code="TAILORONLY", type="free", items=["tailor_pack"])
    c, me = await person(make_client, outbox)
    assert err(await apply(c, "TAILORONLY", item="annual_pass")) == "code_wrong_item"
    q = (await apply(c, "HALF", item="annual_pass")).json()
    assert q["original"] == 199_00 and q["final"] == 99_50
    r = await apply(c, "PASSFREE", item="annual_pass")
    assert r.status_code == 200 and r.json()["unlocked"], r.text
    assert await everything(c, db, me["id"]) == ALL
    # an admin grant (Admin → Customers), then taken back
    c2, me2 = await person(make_client, outbox, "three@example.com")
    r = await owner.post(f"/api/admin/customers/{me2['id']}/annual-pass", json={"granted": True, "note": "test"})
    assert r.status_code == 200 and r.json()["annualPass"]["source"] == "grant"
    assert await everything(c2, db, me2["id"]) == ALL
    await owner.post(f"/api/admin/customers/{me2['id']}/annual-pass", json={"granted": False})
    assert (await everything(c2, db, me2["id"]))["tailor"] is False
    # Off: nothing on sale (downloads are free anyway)
    await set_mode(owner, "off")
    st = (await c2.get("/api/me/pass")).json()
    assert st["onSale"] is False and st["mode"] == "off"
    assert (await c2.post("/api/orders/whatsapp", json={"planId": "annual_pass"})).status_code in (400, 409)
    # the price comes from Settings & prices
    r = await owner.put("/api/admin/settings", json={"plans": {"annual_pass": {"amount": 249_00, "active": True}}})
    assert r.status_code == 200, r.text
    assert (await c2.get("/api/me/pass")).json()["price"] == 249.0


async def test_reminder_seven_days_before_once(admin_client, make_client, outbox, db):
    owner = await admin_client("owner")
    await set_mode(owner, "whatsapp")
    c, me = await person(make_client, outbox)
    o = await order(c, plan="annual_pass")
    await paid(owner, o["orderId"], amount=199_00)
    assert await student_pass.send_reminders(db, outbox) == 0  # a year away
    await db[ORDERS].update_one({"_id": o["orderId"]}, {"$set": {"paid_at": now() - timedelta(days=360)}})
    sent = len(outbox.sent)
    assert await student_pass.send_reminders(db, outbox) == 1
    m = outbox.sent[sent]
    assert m.to == "sai@example.com" and m.subject.startswith("Your Nm7 annual pass ends on")
    assert "stay in your account" in m.text
    assert await student_pass.send_reminders(db, outbox) == 0  # once per end date
    # the automation pass runs it
    await db["locks"].delete_many({})
    assert "pass_reminders" in await run_rules(db)
