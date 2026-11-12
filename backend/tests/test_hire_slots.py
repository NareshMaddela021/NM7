"""Phase 5 H5: one-tap interview slots. The company offers times (India time); only a candidate who accepted an invite
(or was shortlisted) can book; one tap books, both get an .ics; another time moves it (a reason is needed); two
people can't take the same time; cancelling needs a reason; reminders 1 day and 1 hour before, once each;
Attended / No-show feed reliability and can be cleared."""

from datetime import timedelta

from app.core.db import APPLICATIONS, HIRE_EVENTS, HIRE_SLOTS, USERS
from app.core.time import IST, now
from app.hire import slots as sl
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_hire_shortlist import post_job, ready


def when(hours: float) -> dict:
    t = (now() + timedelta(hours=hours)).astimezone(IST)
    return {"date": t.strftime("%Y-%m-%d"), "time": t.strftime("%H:%M")}


async def accepted(client, outbox, db, make_client, email="asha@example.com", name="Asha Rao", setup=None):
    session, cid, job = setup or (None, None, None)
    if not setup:
        session, cid = await verified(client, outbox, db)
        job = await post_job(client, session, cid)
    c = await ready(make_client, outbox, email, name)
    uid = (await db[USERS].find_one({"email": email}))["_id"]
    await client.post(f"/api/company/{cid}/hire/invite", json={"job": job, "people": [uid]}, headers=H(session))
    inv = [i for i in (await c.get("/api/me/hire/invites")).json() if i["status"] == "sent"][0]
    await c.post(f"/api/me/hire/invites/{inv['id']}", json={"answer": "accept"})
    return session, cid, job, c, uid


async def test_book_move_cancel_and_ics(client, outbox, db, make_client):
    session, cid, job, asha, uid = await accepted(client, outbox, db, make_client)
    url = f"/api/company/{cid}/hire/slots"
    bad = await client.post(url, json={"job": job, "slots": [{**when(48), "place": ""}]}, headers=H(session))
    assert err(bad) == "where"
    past = await client.post(url, json={"job": job, "slots": [{**when(-1), "place": "Office"}]}, headers=H(session))
    assert err(past) == "bad_time"
    body = {"job": job, "slots": [{**when(48), "minutes": 30, "place": "Hitech City office", "interviewer": "Uma",
                                   "round": "HR"}, {**when(50), "link": "https://meet.example.com/x"}]}  # fmt: skip
    r = await client.post(url, json=body, headers=H(session))
    assert r.status_code == 201 and r.json()["added"] == 2
    mine = (await asha.get("/api/me/hire/slots")).json()
    assert len(mine) == 1 and len(mine[0]["open"]) == 2 and mine[0]["mine"] is None
    first, second = mine[0]["open"]
    n0 = len(outbox.sent)
    b = (await asha.post(f"/api/me/hire/slots/{first['id']}/book", json={})).json()
    assert b["status"] == "booked"
    mails = outbox.sent[n0:]
    assert len(mails) == 2 and all(m.attachments[0][0] == "interview.ics" for m in mails)  # both sides
    assert {m.to for m in mails} >= {"asha@example.com"}
    assert b"BEGIN:VEVENT" in mails[0].attachments[0][2] and "Hitech City office" in mails[0].text
    a = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": job})
    assert a["status"] == "interview" and a["interview"]["place"] == "Hitech City office"
    # moving it needs a reason, frees the first time
    assert err(await asha.post(f"/api/me/hire/slots/{second['id']}/book", json={})) == "reason"
    moved = await asha.post(f"/api/me/hire/slots/{second['id']}/book", json={"reason": "College exam that day"})
    assert moved.json()["status"] == "booked" and "moved" in outbox.sent[-1].subject.lower()
    assert (await db[HIRE_SLOTS].find_one({"place": "Hitech City office"}))["status"] == "open"
    ics = await asha.get(f"/api/me/hire/slots/{second['id']}/ics")
    assert ics.status_code == 200 and ics.headers["content-type"].startswith("text/calendar")
    assert (await client.get(f"{url}/{second['id']}/ics", headers=H(session))).status_code == 200
    # the company sees who booked
    rows = (await client.get(url, params={"job": job}, headers=H(session))).json()
    assert [r["who"].get("name") for r in rows if r["booked"]] == ["Asha Rao"]
    # cancel needs a reason
    assert err(await asha.post(f"/api/me/hire/slots/{second['id']}/cancel", json={})) == "reason"
    await asha.post(f"/api/me/hire/slots/{second['id']}/cancel", json={"reason": "Got another offer"})
    assert "cancelled" in outbox.sent[-1].subject.lower() and b"BEGIN:VEVENT" in outbox.sent[-1].attachments[0][2]
    assert (await db[APPLICATIONS].find_one({"user_id": uid, "job_id": job}))["interview"] is None


async def test_only_invited_and_no_double_booking(client, outbox, db, make_client):
    session, cid, job, asha, _ = await accepted(client, outbox, db, make_client)
    _, _, _, bala, _ = await accepted(
        client, outbox, db, make_client, "bala@example.com", "Bala K", (session, cid, job)
    )
    stranger = await ready(make_client, outbox, "chitra@example.com", "Chitra M")
    one = {"job": job, "slots": [{**when(30), "place": "Office"}]}
    r = await client.post(f"/api/company/{cid}/hire/slots", json=one, headers=H(session))
    sid = r.json()["items"][0]["id"]
    assert (await stranger.get("/api/me/hire/slots")).json() == []
    assert err(await stranger.post(f"/api/me/hire/slots/{sid}/book", json={})) == "not_found"
    assert (await asha.post(f"/api/me/hire/slots/{sid}/book", json={})).status_code == 200
    assert err(await bala.post(f"/api/me/hire/slots/{sid}/book", json={})) == "taken"
    # the company cancels a booked time: a reason, and the candidate is told
    assert (
        err(await client.post(f"/api/company/{cid}/hire/slots/{sid}/cancel", json={}, headers=H(session))) == "reason"
    )
    out = await client.post(f"/api/company/{cid}/hire/slots/{sid}/cancel", json={"reason": "The interviewer is ill"},
                            headers=H(session))  # fmt: skip
    assert (
        out.json()["status"] == "cancelled" and "The interviewer is ill" in outbox.sent[-2].text + outbox.sent[-1].text
    )


async def test_reminders_and_marks(client, outbox, db, make_client):
    session, cid, job, asha, uid = await accepted(client, outbox, db, make_client)
    one = {"job": job, "slots": [{**when(20), "place": "Office"}]}
    r = await client.post(f"/api/company/{cid}/hire/slots", json=one, headers=H(session))
    sid = r.json()["items"][0]["id"]
    await asha.post(f"/api/me/hire/slots/{sid}/book", json={})
    assert await sl.send_reminders(db, outbox) == 2  # a day before: candidate + company
    assert "Tomorrow" in outbox.sent[-1].subject
    assert await sl.send_reminders(db, outbox) == 0  # once
    s = await db[HIRE_SLOTS].find_one({})
    assert await sl.send_reminders(db, outbox, s["starts_at"] - timedelta(minutes=50)) == 2  # 1 hour before
    assert "In 1 hour" in outbox.sent[-1].subject
    # marks only after it starts; they feed reliability, and can be cleared
    mark = f"/api/company/{cid}/hire/slots/{sid}/mark"
    assert err(await client.post(mark, json={"result": "no_show"}, headers=H(session))) == "not_yet"
    await db[HIRE_SLOTS].update_one({"_id": s["_id"]}, {"$set": {"starts_at": now() - timedelta(minutes=5)}})
    assert (await client.post(mark, json={"result": "no_show"}, headers=H(session))).json()["mark"] == "no_show"
    assert (await asha.get("/api/me/hire/reliability")).json()["lines"][-1] == "Came to 0 of 1 interviews"
    await client.post(mark, json={"result": "attended"}, headers=H(session))  # corrected
    kinds = [e["kind"] async for e in db[HIRE_EVENTS].find({"user_id": uid})]
    assert kinds == ["attended"]
    await client.post(mark, json={"result": "clear"}, headers=H(session))
    assert not await db[HIRE_EVENTS].find_one({"user_id": uid})
