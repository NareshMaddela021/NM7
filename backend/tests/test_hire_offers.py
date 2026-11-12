"""Phase 5 H6: instant offer. Only for someone who accepted the invite; from a template; Accept needs the typed name and
the box (kept with the time; not a legal e-sign); Decline; a PDF; joining check-ins 7 days and 1 day before, once
each; "Joined" from either side, or a drop-out with a reason; reliability and the college's offer tracking follow."""

from datetime import timedelta

from bson import ObjectId

from app.core.db import APPLICATIONS, HIRE_EVENTS, HIRE_OFFERS, MEMBERSHIPS, OFFERS, USERS
from app.core.time import IST, now
from app.hire import offers as of
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_hire_shortlist import ready
from tests.test_hire_slots import accepted


def day(n: int) -> str:
    return (now().astimezone(IST).date() + timedelta(days=n)).isoformat()


def test_inr_and_salary():
    assert of.inr(125000) == "1,25,000" and of.inr(25000) == "25,000" and of.inr(999) == "999"
    assert of.inr(12345678) == "1,23,45,678"
    assert of.salary_text({"amount": 25000, "unit": "month"}) == "₹25,000 a month"
    assert of.salary_text({"amount": 3.6, "unit": "lpa"}) == "₹3.6 lakh a year"
    assert of.same_name("asha  rao", "Asha Rao") and not of.same_name("", "") and not of.same_name("Asha", "Asha Rao")


async def test_offer_accept_pdf_and_joined(client, outbox, db, make_client):
    session, cid, job, asha, uid = await accepted(client, outbox, db, make_client)
    await db[MEMBERSHIPS].insert_one(
        {"_id": "m1", "org_id": "org1", "group_id": "g1", "user_id": uid, "approval": "approved"}
    )
    url = f"/api/company/{cid}/hire/offers"
    body = {"job": job, "person": uid, "salary": {"amount": 25000, "unit": "month"}, "joinDate": day(10),
            "place": "Hyderabad", "notes": "Bring your ID proof on day one."}  # fmt: skip
    r = await client.post(url, json=body, headers=H(session))
    assert r.status_code == 201, r.text
    o = r.json()
    assert "₹25,000 a month" in o["letter"] and "Hyderabad" in o["letter"] and o["status"] == "sent"
    assert "Offer from" in outbox.sent[-1].subject
    assert (await db[APPLICATIONS].find_one({"user_id": uid, "job_id": job}))["status"] == "offer"
    assert err(await client.post(url, json=body, headers=H(session))) == "already"
    # accept: the typed name and the box
    a = f"/api/me/hire/offers/{o['id']}/answer"
    assert err(await asha.post(a, json={"answer": "accept", "typedName": "Asha Rao"})) == "agree"
    assert err(await asha.post(a, json={"answer": "accept", "typedName": "Someone", "agree": True})) == "typed_name"
    r = (await asha.post(a, json={"answer": "accept", "typedName": "asha rao", "agree": True})).json()
    assert r["status"] == "accepted" and r["typedName"] == "asha rao" and r["answeredAt"] and "not a" in r["notESign"]
    assert "accepted your offer" in outbox.sent[-1].subject
    assert err(await asha.post(a, json={"answer": "decline"})) == "answered"
    # the college's offer tracking
    col = await db[OFFERS].find_one({"org_id": "org1"})
    assert col["status"] == "accepted" and col["company"] and col["ctc_lpa"] == 3.0 and col["source"] == "hire"
    # PDF on both sides
    pdf = await asha.get(f"/api/me/hire/offers/{o['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert (await client.get(f"{url}/{o['id']}/pdf", headers=H(session))).content.startswith(b"%PDF")
    # joining check-ins: 7 days and 1 day before, once each
    await db[HIRE_OFFERS].update_one({}, {"$set": {"join_date": day(7)}})
    assert await of.send_checkins(db, outbox) == 1 and "Joining" in outbox.sent[-1].subject
    assert await of.send_checkins(db, outbox) == 0
    await db[HIRE_OFFERS].update_one({}, {"$set": {"join_date": day(1)}})
    assert await of.send_checkins(db, outbox) == 1 and "Tomorrow" in outbox.sent[-1].subject
    # Joined: not before the join date; then from the company's side
    j = f"{url}/{o['id']}/joined"
    assert err(await client.post(j, json={"joined": True}, headers=H(session))) == "not_yet"
    await db[HIRE_OFFERS].update_one({}, {"$set": {"join_date": day(0)}})
    assert (await client.post(j, json={"joined": True}, headers=H(session))).json()["status"] == "joined"
    assert (await asha.post(f"/api/me/hire/offers/{o['id']}/joined", json={"joined": True})).json()[
        "status"
    ] == "joined"
    assert (await db[OFFERS].find_one({"org_id": "org1"}))["status"] == "joined"
    assert [e["kind"] async for e in db[HIRE_EVENTS].find({"user_id": uid})] == ["joined"]


async def test_decline_dropout_and_rules(client, outbox, db, make_client):
    session, cid, job, asha, uid = await accepted(client, outbox, db, make_client)
    stranger = await ready(make_client, outbox, "chitra@example.com", "Chitra M")
    url = f"/api/company/{cid}/hire/offers"
    other = (await db[USERS].find_one({"email": "chitra@example.com"}))["_id"]
    body = {"job": job, "salary": {"amount": 3.6, "unit": "lpa"}, "joinDate": day(20)}
    assert err(await client.post(url, json={**body, "person": other}, headers=H(session))) == "not_ready"
    o = (await client.post(url, json={**body, "person": uid}, headers=H(session))).json()
    assert err(await stranger.get(f"/api/me/hire/offers/{o['id']}/pdf")) == "not_found"
    # the candidate accepts, then the check-in: can't join (a reason)
    await asha.post(
        f"/api/me/hire/offers/{o['id']}/answer", json={"answer": "accept", "typedName": "Asha Rao", "agree": True}
    )
    jn = f"/api/me/hire/offers/{o['id']}/joining"
    assert err(await asha.post(jn, json={"joining": False})) == "reason"
    r = (await asha.post(jn, json={"joining": False, "reason": "Family moved to Pune"})).json()
    assert r["status"] == "dropped" and r["dropReason"] == "Family moved to Pune"
    assert "declined" in outbox.sent[-1].subject
    assert [e["kind"] async for e in db[HIRE_EVENTS].find({"user_id": uid})] == ["dropped"]
    # an unanswered offer expires
    o2 = await db[HIRE_OFFERS].find_one({"_id": ObjectId(o["id"])})
    await db[HIRE_OFFERS].update_one(
        {"_id": o2["_id"]}, {"$set": {"status": "sent", "respond_by": now() - timedelta(hours=1)}}
    )
    assert (await asha.get("/api/me/hire/offers")).json()[0]["status"] == "expired"
    assert err(await asha.post(f"/api/me/hire/offers/{o['id']}/answer", json={"answer": "decline"})) == "answered"
    # withdraw needs a reason, only while waiting
    await db[HIRE_OFFERS].update_one({"_id": o2["_id"]}, {"$set": {"respond_by": now() + timedelta(days=2)}})
    w = f"{url}/{o['id']}/withdraw"
    assert err(await client.post(w, json={}, headers=H(session))) == "reason"
    assert (await client.post(w, json={"reason": "Role closed"}, headers=H(session))).json()["status"] == "withdrawn"
    assert (await asha.get("/api/me/hire/offers")).json() == []
