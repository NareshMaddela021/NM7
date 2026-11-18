# ruff: noqa: E501
"""Vetting Trust T11: one-tap interview booking, reminders and joining-day confirmations.

Signed links (validity, expiry, scope, one booking at a time, the 2-hour change window); two people tapping one time;
reminders at the right times, quiet hours, no duplicates with the old H5 reminders; joining-day messages; "I've joined"
and the company's one-tap confirmation stored as events; opt-outs respected; switch OFF: the old flows unchanged."""

import asyncio
import re
from datetime import date, datetime, time, timedelta

from bson import ObjectId

from app.core.db import (
    APPLICATIONS,
    HIRE_EVENTS,
    HIRE_OFFERS,
    HIRE_SLOTS,
    TRUST_AGENT_EVENTS,
    TRUST_BOOK_LINKS,
    TRUST_JOIN_EVENTS,
)
from app.core.time import IST, now
from app.hire import offers as HO
from app.hire import slots as HS
from app.jobs.apply import app_key
from app.trust import retention as R
from app.trust.agent import providers as P
from app.trust.booking import service as S
from app.trust.booking import texts as TX
from tests.test_companies_posting import no_ai  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_trust_t5 import add_slots, co, make_tester, no_kick, person  # noqa: F401

PUB = "/api/public/trust"


def at(days: int = 0, hour: int = 11, minute: int = 0) -> datetime:
    d = (now().astimezone(IST) + timedelta(days=days)).date()
    return datetime.combine(d, time(hour, minute), IST)


def sent(name: str) -> list[dict]:
    return [m for m in P.SENT if m.get("name") == name]


def token_in(text: str, k: str = "book") -> str:
    m = re.search(rf"#k={k}&t=([A-Za-z0-9._-]+)", text)
    assert m, text
    return m.group(1)


async def shortlisted(db, uid: str, cid: str, jid: str) -> None:
    t = now()
    await db[APPLICATIONS].insert_one({"key": app_key(jid), "user_id": uid, "job_id": jid, "company_id": cid, "status": "shortlisted",
                                       "company": "Acme", "role": "Analyst", "channel": "nm7", "timeline": [{"status": "shortlisted", "at": t}],
                                       "company_removed_at": None, "created_at": t, "updated_at": t})  # fmt: skip


async def setup(client, outbox, db, make_client, email="asha.t11@example.com", phone="9876511111", **kw):
    session, cid, job = await co(client, outbox, db)
    slots = await add_slots(client, session, cid, job["id"], 2)
    c, uid = await person(make_client, outbox, db, email, phone, **kw)
    await shortlisted(db, uid, cid, job["id"])
    return session, cid, job, slots, c, uid


async def invite(db, outbox, hour=11):
    P.SENT.clear()
    return await S.run(db, outbox, t=at(0, hour), force=True)


async def test_link_signature_expiry_scope(client, outbox, db, make_client):
    session, cid, job, slots, c, uid = await setup(client, outbox, db, make_client)
    link = await S.link_for(
        db, "interview", user_id=uid, company_id=cid, job_id=job["id"], source="test", until=now() + timedelta(days=3)
    )
    tok = S.token_for(link)
    assert S.read_token(tok) == ("interview", link["_id"])
    assert S.read_token(tok[:-1] + ("0" if tok[-1] != "0" else "1")) is None  # changed
    assert S.read_token(tok, at=now().timestamp() + 4 * 86400) is None  # expired
    letter, lid, exp, sig = tok.split(".")
    assert S.read_token(f"j.{lid}.{exp}.{sig}") is None  # another kind with the same signature
    anon = make_client()
    assert err(await anon.post(f"{PUB}/join/check", json={"token": tok})) == "invalid_link"  # scoped to its kind
    assert (await anon.post(f"{PUB}/book/check", json={"token": tok})).status_code == 200
    # the same person × job always gets the same link (a later message only extends it)
    again = await S.link_for(
        db, "interview", user_id=uid, company_id=cid, job_id=job["id"], source="x", until=now() + timedelta(days=9)
    )
    assert again["_id"] == link["_id"] and again["expires_at"] > link["expires_at"]
    # revoked / expired in the database: refused even with a good signature
    await db[TRUST_BOOK_LINKS].update_one({"_id": link["_id"]}, {"$set": {"expires_at": now() - timedelta(minutes=1)}})
    assert err(await anon.post(f"{PUB}/book/check", json={"token": tok})) == "invalid_link"
    assert err(await anon.post(f"{PUB}/book/check", json={"token": "b.zzz.1.abc" + "x" * 20})) == "invalid_link"


async def test_invite_book_move_cancel(client, outbox, db, make_client):
    session, cid, job, slots, c, uid = await setup(client, outbox, db, make_client)
    got = await invite(db, outbox)
    assert got.get("invited") == 1, got
    wa = sent(TX.NAMES["book"])
    assert len(wa) == 1 and wa[0]["params"][2] and "#k=book&t=" in wa[0]["params"][3]
    mail = [m for m in outbox.sent if m.to == "asha.t11@example.com" and "Pick your interview time" in m.subject]
    assert len(mail) == 1 and "/stop-alerts#k=book&t=" in mail[0].text and "<a href=" in mail[0].html
    tok = token_in(mail[0].text)
    assert (await invite(db, outbox)).get("invited") is None and not sent(TX.NAMES["book"])  # once
    anon = make_client()  # no sign-in
    view = (await anon.post(f"{PUB}/book/check", json={"token": tok})).json()
    assert (
        view["first"] == "Asha" and len(view["open"]) == 2 and view["mine"] is None and "maps" in view["open"][0]["map"]
    )
    n0 = len(outbox.sent)
    b = (await anon.post(f"{PUB}/book/pick", json={"token": tok, "slot": slots[0]["id"]})).json()
    assert b["mine"]["id"] == slots[0]["id"] and b["mine"]["canChange"] and len(b["open"]) == 1
    assert len(outbox.sent) - n0 == 2  # both sides told (with the calendar file)
    a = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": job["id"]})
    assert a["status"] == "interview" and a["interview"]["slot_id"] == ObjectId(slots[0]["id"])
    # a second tap on the same time changes nothing
    assert (await anon.post(f"{PUB}/book/pick", json={"token": tok, "slot": slots[0]["id"]})).json()["mine"][
        "id"
    ] == slots[0]["id"]
    # another time moves it (one booking per link)
    m = (await anon.post(f"{PUB}/book/pick", json={"token": tok, "slot": slots[1]["id"]})).json()
    assert m["mine"]["id"] == slots[1]["id"] and "moved" in outbox.sent[-1].subject.lower()
    assert await db[HIRE_SLOTS].count_documents({"job_id": job["id"], "user_id": uid, "status": "booked"}) == 1
    assert (await db[HIRE_SLOTS].find_one({"_id": ObjectId(slots[0]["id"])}))["status"] == "open"
    # the company sees it live
    live = (await client.get(f"/api/company/{cid}/trust/booking", headers=H(session))).json()
    assert [e["kind"] for e in live["events"]][:3] == ["t11_moved", "t11_booked", "t11_invite"] and live["events"][0][
        "name"
    ] == "Asha Rao"
    rows = (await client.get(f"/api/company/{cid}/hire/slots", params={"job": job["id"]}, headers=H(session))).json()
    assert [r["who"].get("name") for r in rows if r["booked"]] == ["Asha Rao"]
    # cancel needs a reason; then the time is free and the same link books again
    assert err(await anon.post(f"{PUB}/book/cancel", json={"token": tok})) == "reason"
    x = (await anon.post(f"{PUB}/book/cancel", json={"token": tok, "reason": "Got another offer"})).json()
    assert x["mine"] is None and len(x["open"]) == 2 and "cancelled" in outbox.sent[-1].subject.lower()
    assert (await db[APPLICATIONS].find_one({"user_id": uid, "job_id": job["id"]}))["interview"] is None
    assert (await anon.post(f"{PUB}/book/pick", json={"token": tok, "slot": slots[0]["id"]})).json()["mine"][
        "id"
    ] == slots[0]["id"]
    # a time of another job can't be booked with this link
    session2, cid2, job2 = await co(client, outbox, db)
    other = await add_slots(client, session2, cid2, job2["id"], 1)
    assert err(await anon.post(f"{PUB}/book/pick", json={"token": tok, "slot": other[0]["id"]})) == "not_found"


async def test_change_window_and_cant_make_it(client, outbox, db, make_client):
    session, cid, job, slots, c, uid = await setup(
        client, outbox, db, make_client, "bala.t11@example.com", "9876511112"
    )
    link = await S.link_for(
        db, "interview", user_id=uid, company_id=cid, job_id=job["id"], source="test", until=now() + timedelta(days=3)
    )
    tok, anon = S.token_for(link), make_client()
    await anon.post(f"{PUB}/book/pick", json={"token": tok, "slot": slots[0]["id"]})
    await db[HIRE_SLOTS].update_one(
        {"_id": ObjectId(slots[0]["id"])}, {"$set": {"starts_at": now() + timedelta(minutes=90)}}
    )
    v = (await anon.post(f"{PUB}/book/check", json={"token": tok})).json()
    assert v["mine"]["canChange"] is False
    assert err(await anon.post(f"{PUB}/book/pick", json={"token": tok, "slot": slots[1]["id"]})) == "too_late"
    assert err(await anon.post(f"{PUB}/book/cancel", json={"token": tok, "reason": "Sick today"})) == "too_late"
    assert err(await anon.post(f"{PUB}/book/cant", json={"token": tok})) == "reason"
    v = (await anon.post(f"{PUB}/book/cant", json={"token": tok, "reason": "Bus strike in my town"})).json()
    assert v["mine"]["cantSent"] is True
    assert outbox.sent[-1].to == "founder@gmail.com" and "Bus strike" in outbox.sent[-1].text
    assert (await db[HIRE_SLOTS].find_one({"_id": ObjectId(slots[0]["id"])}))[
        "status"
    ] == "booked"  # the company decides
    assert await db[TRUST_AGENT_EVENTS].find_one({"kind": "t11_cant", "user_id": uid})
    # a time starting within the window can't be newly booked either
    await db[HIRE_SLOTS].update_one(
        {"_id": ObjectId(slots[1]["id"])}, {"$set": {"starts_at": now() + timedelta(minutes=30)}}
    )
    assert (await anon.post(f"{PUB}/book/check", json={"token": tok})).json()["open"] == []


async def test_two_people_one_time_and_double_tap(client, outbox, db, make_client):
    session, cid, job, slots, c, uid = await setup(
        client, outbox, db, make_client, "chitra.t11@example.com", "9876511113"
    )
    c2, uid2 = await person(make_client, outbox, db, "dev.t11@example.com", "9876511114")
    await shortlisted(db, uid2, cid, job["id"])
    t1 = S.token_for(
        await S.link_for(
            db, "interview", user_id=uid, company_id=cid, job_id=job["id"], source="t", until=now() + timedelta(days=3)
        )
    )
    t2 = S.token_for(
        await S.link_for(
            db, "interview", user_id=uid2, company_id=cid, job_id=job["id"], source="t", until=now() + timedelta(days=3)
        )
    )
    a, b = make_client(), make_client()
    r1, r2 = await asyncio.gather(a.post(f"{PUB}/book/pick", json={"token": t1, "slot": slots[0]["id"]}),
                                  b.post(f"{PUB}/book/pick", json={"token": t2, "slot": slots[0]["id"]}))  # fmt: skip
    codes = sorted([r1.status_code, r2.status_code])
    assert codes == [200, 409] and "taken" in (r1.text + r2.text)
    s = await db[HIRE_SLOTS].find_one({"_id": ObjectId(slots[0]["id"])})
    assert s["user_id"] in (uid, uid2)
    # one link, two times tapped at once: never two bookings
    winner_tok = t1 if s["user_id"] == uid else t2
    loser_tok, loser = (t2, uid2) if s["user_id"] == uid else (t1, uid)
    await db[HIRE_SLOTS].insert_one(
        {
            **(await db[HIRE_SLOTS].find_one({"_id": ObjectId(slots[1]["id"])})),
            "_id": ObjectId(),
            "starts_at": now() + timedelta(days=4),
        }
    )
    free = [x["id"] for x in (await a.post(f"{PUB}/book/check", json={"token": loser_tok})).json()["open"]]
    assert len(free) == 2
    await asyncio.gather(a.post(f"{PUB}/book/pick", json={"token": loser_tok, "slot": free[0]}),
                         b.post(f"{PUB}/book/pick", json={"token": loser_tok, "slot": free[1]}))  # fmt: skip
    assert await db[HIRE_SLOTS].count_documents({"job_id": job["id"], "user_id": loser, "status": "booked"}) == 1
    assert winner_tok


async def booked_tomorrow(db, slots, uid, hour=10, minute=0):
    sid = ObjectId(slots[0]["id"])
    await db[HIRE_SLOTS].update_one(
        {"_id": sid},
        {
            "$set": {
                "status": "booked",
                "user_id": uid,
                "starts_at": at(1, hour, minute),
                "booked_at": now() - timedelta(days=2),
            }
        },
    )
    return sid


async def test_reminders_timing_quiet_hours_no_duplicates(client, outbox, db, make_client):
    session, cid, job, slots, c, uid = await setup(
        client, outbox, db, make_client, "esha.t11@example.com", "9876511115"
    )
    sid = await booked_tomorrow(db, slots, uid)
    P.SENT.clear()
    await S.run(db, outbox, t=at(0, 18), force=True)  # before the evening time: nothing
    assert not sent(TX.NAMES["reminder"])
    n0 = len(outbox.sent)
    got = await S.run(db, outbox, t=at(0, 19, 30), force=True)
    assert got.get("day_email_sent") == 1 and got.get("day_wa_sent") == 1, got
    wa = sent(TX.NAMES["reminder"])[0]
    assert (
        wa["params"][3].startswith("tomorrow")
        and "Hitech City office" in wa["params"][4]
        and "#k=book&t=" in wa["params"][5]
    )
    mail = outbox.sent[n0:]
    assert len(mail) == 1 and mail[0].subject.startswith("Tomorrow") and "google.com/maps" in mail[0].text
    await S.run(db, outbox, t=at(0, 20), force=True)  # once
    assert len(sent(TX.NAMES["reminder"])) == 1 and len(outbox.sent) == n0 + 1
    # the old H5 reminder: only the company's, the candidate gets nothing twice
    n1 = len(outbox.sent)
    await HS.send_reminders(db, outbox, at(0, 20, 30))
    new = outbox.sent[n1:]
    assert [m.to for m in new] == ["founder@gmail.com"]
    await HS.send_reminders(db, outbox, at(1, 9, 5))
    assert all(m.to != "esha.t11@example.com" for m in outbox.sent[n1:])
    # 2 hours before is 8 AM: in the quiet hours, so the email goes and WhatsApp waits until 9 AM
    got = await S.run(db, outbox, t=at(1, 8, 0), force=True)
    assert got.get("soon_email_sent") == 1 and got.get("soon_wa_waiting") == 1 and len(sent(TX.NAMES["reminder"])) == 1
    got = await S.run(db, outbox, t=at(1, 9, 1), force=True)
    assert got.get("soon_wa_sent") == 1 and len(sent(TX.NAMES["reminder"])) == 2
    s = await db[HIRE_SLOTS].find_one({"_id": sid})
    assert s["t11_flow"] and s["t11"]["soon"]["wa"]["status"] == "sent"


async def test_quiet_hours_too_late_is_dropped_and_daily_cap(client, outbox, db, make_client):
    session, cid, job, slots, c, uid = await setup(
        client, outbox, db, make_client, "farah.t11@example.com", "9876511116"
    )
    sid = await booked_tomorrow(db, slots, uid, 8, 30)
    await db[HIRE_SLOTS].update_one(
        {"_id": sid}, {"$set": {"booked_at": at(0, 22)}}
    )  # booked after the evening time: no "tomorrow"
    P.SENT.clear()
    got = await S.run(db, outbox, t=at(1, 6, 45), force=True)
    assert got.get("soon_wa_waiting") == 1 and got.get("soon_email_sent") == 1 and "day_email_sent" not in got
    await S.run(db, outbox, t=at(1, 8, 40), force=True)  # it started: the WhatsApp is dropped, never sent late
    assert not sent(TX.NAMES["reminder"]) and not (await db[HIRE_SLOTS].find_one({"_id": sid}))["t11"]["soon"].get("wa")
    # the daily cap (Admin, default 4): the 5th T11 WhatsApp of the day waits
    d = at(1).date().isoformat()
    await db[TRUST_AGENT_EVENTS].insert_many(
        [{"kind": "t11_wa", "user_id": uid, "day": d, "at": at(1, 9)} for _ in range(4)]
    )
    u = await db["users"].find_one({"_id": uid})
    from app.site import get_site

    assert await S._wa(db, await get_site(db), u, "reminder", ["a", "b", "c", "d", "e", "f"], at(1, 10)) == "daily_cap"


async def test_opt_out_and_consent_respected(client, outbox, db, make_client):
    session, cid, job, slots, c, uid = await setup(
        client, outbox, db, make_client, "gita.t11@example.com", "9876511117"
    )
    from app.trust.agent import service as A

    await A.opt_out(db, uid, "whatsapp", "words")
    got = await invite(db, outbox)
    assert got.get("invited") == 1 and not sent(TX.NAMES["book"])  # email only
    link = await db[TRUST_BOOK_LINKS].find_one({"user_id": uid})
    assert (
        link["invite"]["wa"] == "opted_out" and link["invite"]["email"] == "sent" and not link["invite"]["wa_pending"]
    )
    # no consent at all: no WhatsApp either
    session2, cid2, job2 = await co(client, outbox, db)
    await add_slots(client, session2, cid2, job2["id"], 1)
    c2, uid2 = await person(make_client, outbox, db, "hari.t11@example.com", "9876511118", consent=False)
    await shortlisted(db, uid2, cid2, job2["id"])
    await invite(db, outbox)
    assert (await db[TRUST_BOOK_LINKS].find_one({"user_id": uid2}))["invite"]["wa"] == "no_consent"
    # an invite in the quiet hours waits for the morning, and is sent once
    session3, cid3, job3 = await co(client, outbox, db)
    await add_slots(client, session3, cid3, job3["id"], 1)
    c3, uid3 = await person(make_client, outbox, db, "isha.t11@example.com", "9876511119")
    await shortlisted(db, uid3, cid3, job3["id"])
    await invite(db, outbox, hour=22)
    lk = await db[TRUST_BOOK_LINKS].find_one({"user_id": uid3})
    assert lk["invite"]["wa"] == "quiet_hours" and lk["invite"]["wa_pending"] and not sent(TX.NAMES["book"])
    await S.run(db, outbox, t=at(1, 9, 30), force=True)
    assert (
        len(sent(TX.NAMES["book"])) == 1
        and not (await db[TRUST_BOOK_LINKS].find_one({"user_id": uid3}))["invite"]["wa_pending"]
    )


async def offer(db, uid, cid, join: date, status="accepted") -> ObjectId:
    oid = ObjectId()
    t = now()
    await db[HIRE_OFFERS].insert_one({"_id": oid, "user_id": uid, "job_id": "j-t11", "company_id": cid, "company_name": "Acme Foods", "candidate_name": "Asha Rao",
                                      "title": "Store analyst", "salary": {"amount": 25000, "unit": "month"}, "join_date": join.isoformat(), "place": "Madhapur",
                                      "notes": "", "status": status, "respond_by": t + timedelta(days=3), "answered_at": t, "typed_name": "Asha Rao",
                                      "agreed": True, "by": "founder@gmail.com", "created_at": t, "updated_at": t})  # fmt: skip
    return oid


async def test_joining_day_messages_and_answers(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db)
    c, uid = await person(make_client, outbox, db, "jaya.t11@example.com", "9876511120", lang="hi")
    tomorrow = at(1).date()
    oid = await offer(db, uid, cid, tomorrow)
    r = await client.put(
        f"/api/company/{cid}/trust/booking/joinings/{oid}",
        json={"time": "10:00", "place": "Hitech City, Gate 2", "map": "https://maps.example.com/x"},
        headers=H(session),
    )
    assert r.status_code == 200 and r.json()["time"] == "10:00"
    assert (
        err(
            await client.put(
                f"/api/company/{cid}/trust/booking/joinings/{oid}", json={"map": "http://x"}, headers=H(session)
            )
        )
        == "invalid_input"
    )
    # the old "joining tomorrow" email doesn't go (T11 sends its own)
    n0 = len(outbox.sent)
    await HO.send_checkins(db, outbox, at(0, 12))
    assert len(outbox.sent) == n0
    P.SENT.clear()
    got = await S.run(db, outbox, t=at(0, 19, 30), force=True)
    assert got.get("eve_email_sent") == 1 and got.get("eve_wa_sent") == 1, got
    wa = sent(TX.NAMES["join_eve"])[0]
    assert wa["lang"] == "hi" and "10:00 AM" in wa["params"][2] and "Hitech City" in wa["params"][2]
    mail = outbox.sent[-1]
    assert mail.to == "jaya.t11@example.com" and "कल" in mail.subject
    tok = token_in(mail.text, "join")
    anon = make_client()
    v = (await anon.post(f"{PUB}/join/check", json={"token": tok})).json()
    assert (
        v["stage"] == "before"
        and v["time"] == "10:00"
        and v["map"] == "https://maps.example.com/x"
        and v["lang"] == "hi"
    )
    assert (await anon.post(f"{PUB}/join/act", json={"token": tok, "action": "yes"})).json()["answered"]["coming"]
    assert err(await anon.post(f"{PUB}/join/act", json={"token": tok, "action": "joined"})) == "not_yet"
    assert err(await anon.post(f"{PUB}/join/act", json={"token": tok, "action": "reschedule"})) == "reason"
    await anon.post(f"{PUB}/join/act", json={"token": tok, "action": "reschedule", "reason": "Can I join on Monday?"})
    assert outbox.sent[-1].to == "founder@gmail.com" and "Monday" in outbox.sent[-1].text
    kinds = [e["kind"] async for e in db[TRUST_JOIN_EVENTS].find({"offer_id": str(oid)}).sort("at", 1)]
    assert kinds == ["coming", "reschedule"]
    # the day itself: good luck with directions in the morning, then "Did you join?"
    got = await S.run(db, outbox, t=at(1, 9, 15), force=True)
    assert (
        got.get("morning_wa_sent") == 1
        and sent(TX.NAMES["join_morning"])[0]["params"][3] == "https://maps.example.com/x"
    )
    got = await S.run(db, outbox, t=at(1, 13, 15), force=True)
    assert got.get("checkin_wa_sent") == 1 and got.get("checkin_email_sent") == 1
    await S.run(db, outbox, t=at(1, 13, 45), force=True)
    assert len(sent(TX.NAMES["join_checkin"])) == 1  # once
    live = (await client.get(f"/api/company/{cid}/trust/booking", headers=H(session))).json()
    j = next(x for x in live["joinings"] if x["id"] == str(oid))
    assert [a["kind"] for a in j["answers"]] == ["coming", "reschedule"] and j["place"] == "Hitech City, Gate 2"


async def test_ive_joined_and_company_confirm_events(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db)
    c, uid = await person(make_client, outbox, db, "kiran.t11@example.com", "9876511121")
    today = now().astimezone(IST).date()
    oid = await offer(db, uid, cid, today)
    P.SENT.clear()
    got = await S.run(db, outbox, t=datetime.combine(today, time(13, 30), IST), force=True)
    assert got.get("checkin_email_sent") == 1
    tok = token_in(next(m for m in reversed(outbox.sent) if m.to == "kiran.t11@example.com").text, "join")
    anon = make_client()
    v = (await anon.post(f"{PUB}/join/act", json={"token": tok, "action": "joined"})).json()
    assert v["joined"] is True and v["stage"] == "day"
    o = await db[HIRE_OFFERS].find_one({"_id": oid})
    assert o["status"] == "joined" and o["joined"]["candidate"] is True
    assert await db[HIRE_EVENTS].find_one({"user_id": uid, "kind": "joined"})  # H4 reliability as before
    # the company: one tap from its email
    got = await S.run(db, outbox, t=datetime.combine(today, time(17, 10), IST), force=True)
    assert got.get("company_email_sent") == 1
    cmail = outbox.sent[-1]
    assert cmail.to == "founder@gmail.com" and "join today" in cmail.subject
    ctok = token_in(cmail.text, "cjoin")
    assert (
        err(await anon.post(f"{PUB}/join/check", json={"token": ctok})) == "invalid_link"
    )  # a company link isn't a candidate link
    cv = (await anon.post(f"{PUB}/cjoin/check", json={"token": ctok})).json()
    assert cv["canAnswer"] and cv["candidate"] == "Asha Rao"
    assert err(await anon.post(f"{PUB}/cjoin/act", json={"token": ctok, "joined": False})) == "reason"
    cv = (await anon.post(f"{PUB}/cjoin/act", json={"token": ctok, "joined": True})).json()
    assert cv["joined"] == {"candidate": True, "company": True}
    rows = [
        (e["side"], e["kind"], e["via"]) async for e in db[TRUST_JOIN_EVENTS].find({"offer_id": str(oid)}).sort("at", 1)
    ]
    assert rows == [("candidate", "joined", "link"), ("company", "joined", "link")]
    # the signed-in H6 path stores the event too (for T15), once per answer
    r = await client.post(f"/api/company/{cid}/hire/offers/{oid}/joined", json={"joined": True}, headers=H(session))
    assert r.status_code == 200
    assert await db[TRUST_JOIN_EVENTS].count_documents({"offer_id": str(oid), "via": "hire"}) == 1


async def test_switch_off_isolation_old_flows_unchanged(client, outbox, db, make_client):
    """A real company and a real candidate (not testers): no link, no WhatsApp, no T11 email; the old H5 reminders and
    the old joining check-in go exactly as before; a link made by hand doesn't open."""
    session, cid, job = await co(client, outbox, db, test=False)
    slots = await add_slots(client, session, cid, job["id"], 2)
    c, uid = await person(make_client, outbox, db, "lata.t11@example.com", "9876511122", test=False)
    await shortlisted(db, uid, cid, job["id"])
    n0 = len(outbox.sent)
    got = await invite(db, outbox)
    assert got == {} and not P.SENT and len(outbox.sent) == n0
    assert not await db[TRUST_BOOK_LINKS].find_one({"user_id": uid})
    sid = await booked_tomorrow(db, slots, uid)
    await S.run(db, outbox, t=at(0, 19, 30), force=True)
    assert len(outbox.sent) == n0 and not (await db[HIRE_SLOTS].find_one({"_id": sid})).get("t11")
    assert await HS.send_reminders(db, outbox, at(0, 19, 30)) == 2  # candidate + company, as before
    assert {m.to for m in outbox.sent[-2:]} == {"lata.t11@example.com", "founder@gmail.com"}
    oid = await offer(db, uid, cid, at(1).date())
    await HO.send_checkins(db, outbox, at(0, 12))
    assert outbox.sent[-1].to == "lata.t11@example.com" and "Tomorrow" in outbox.sent[-1].subject
    assert not (await db[HIRE_OFFERS].find_one({"_id": oid})).get("t11_flow")
    link = await S.link_for(
        db, "interview", user_id=uid, company_id=cid, job_id=job["id"], source="t", until=now() + timedelta(days=3)
    )
    assert err(await make_client().post(f"{PUB}/book/check", json={"token": S.token_for(link)})) == "invalid_link"
    assert (await client.get(f"/api/company/{cid}/trust/booking", headers=H(session))).status_code == 404
    # a tester candidate with a real company isn't on the new flow either (T5's pairing rule)
    c2, uid2 = await person(make_client, outbox, db, "mala.t11@example.com", "9876511123")
    await shortlisted(db, uid2, cid, job["id"])
    await invite(db, outbox)
    assert not await db[TRUST_BOOK_LINKS].find_one({"user_id": uid2})


async def test_admin_settings_run_templates_retention(client, outbox, db, make_client, admin_client):
    admin_client = await admin_client()
    r = await admin_client.get("/api/admin/trust/booking")
    assert r.status_code == 200
    d = r.json()
    assert d["settings"]["soonHours"] == 2 and d["settings"]["eveAt"] == "19:00" and len(d["templates"]) == 15
    bad = await admin_client.put(
        "/api/admin/trust/booking", json={**d["settings"], "morningAt": "14:00", "checkinAt": "13:00"}
    )
    assert err(bad) == "times"
    ok = await admin_client.put(
        "/api/admin/trust/booking", json={**d["settings"], "soonHours": 3, "approved": {"hi": True}}
    )
    assert ok.json()["settings"]["soonHours"] == 3 and ok.json()["settings"]["approved"]["hi"] is True
    assert (await admin_client.post("/api/admin/trust/booking/run")).status_code == 200
    assert {"book_links", "join_events"} <= set(R.TYPES)
    # three languages, the same placeholders, no payments anywhere
    for k in TX.NAMES:
        ph = {lang: sorted(set(re.findall(r"\{\{\d\}\}", TX.TEMPLATES[lang][k]))) for lang in TX.LANGS}
        assert ph["en"] == ph["hi"] == ph["te"], k
    assert not [x for x in TX.all_texts() if re.search(r"\b(pay|payment|upi|fee|fees|refund)\b|₹", x, re.I)]
