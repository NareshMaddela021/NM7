"""Interview scheduling (R3, Campus): a valid .ics with the right time (IST in, UTC out), emails with the file to each
student, Confirm / ask for another time (the recruiter is told), a new time asks everyone again with an updated .ics
(same UID, higher SEQUENCE), cancel, coordinators see answers (only their groups), the day-before reminder (once, not
after opting out, the unsubscribe link works), only shortlisted students, the plan switch, and account erase."""

from datetime import date, datetime, time, timedelta

from app.core import ics
from app.core.db import INTERVIEWS, USERS
from app.core.time import IST, now
from app.orgs import interviews
from tests.test_org_recruiter_portal import campus, err, invite, owner, plan, resume, sign_in  # noqa: F401
from tests.test_orgs_recruiter import opted_in


def unfold(raw: bytes) -> list[str]:
    return raw.decode().replace("\r\n ", "").split("\r\n")


def test_ics_is_valid_and_times_are_utc():
    start = datetime(2026, 11, 20, 10, 30, tzinfo=IST)  # 10:30 IST = 05:00 UTC
    raw = ics.event(uid="abc@nm7.si", sequence=2, start=start, minutes=45, summary="Interview: Acme, Inc; round 1",
                    location="Room 4", description="Line one\nLine two " + "x" * 120,
                    url="https://meet.example/x")  # fmt: skip
    assert raw.endswith(b"\r\n") and b"\n" not in raw.replace(b"\r\n", b"")  # CRLF only
    assert all(len(line.encode()) <= 75 for line in raw.decode().split("\r\n"))  # folded
    lines = unfold(raw)
    assert lines[0] == "BEGIN:VCALENDAR" and lines[-2] == "END:VCALENDAR"
    assert "DTSTART:20261120T050000Z" in lines and "DTEND:20261120T054500Z" in lines
    assert "SEQUENCE:2" in lines and "UID:abc@nm7.si" in lines and "STATUS:CONFIRMED" in lines
    assert "SUMMARY:Interview: Acme\\, Inc\\; round 1" in lines
    assert any(x.startswith("DESCRIPTION:Line one\\nLine two") for x in lines)
    # a long Telugu line folds between characters, never inside one
    raw = ics.event(uid="u", sequence=0, start=start, minutes=30, summary="ఇంటర్వ్యూ " * 20)
    assert all(len(line.encode()) <= 75 for line in raw.decode().split("\r\n"))
    assert "STATUS:CANCELLED" in unfold(ics.event(uid="u", sequence=1, start=start, minutes=30, summary="x",
                                                  cancelled=True))  # fmt: skip


def when(days=3, hm="10:30"):
    return {"date": (now().astimezone(IST).date() + timedelta(days=days)).isoformat(), "time": hm}


ROUND = {"round": "Technical round 1", "minutes": 45, "place": "Seminar hall, Block A", "link": "",
         "interviewer": "Meera S", "notes": "Bring your college ID."}  # fmt: skip


async def setup(campus, owner, make_client, outbox, **inv_extra):  # noqa: F811
    org, g = campus
    a, _ = await opted_in(make_client, outbox, "asha@example.com", "Asha Rao",
                          data=resume("Asha Rao", "asha@example.com"))  # fmt: skip
    b, _ = await opted_in(make_client, outbox, "bala@example.com", "Bala M",
                          data=resume("Bala M", "bala@example.com"), roll="2")  # fmt: skip
    inv, token = await invite(owner, org["id"], [g["id"]], **inv_extra)
    rec = make_client()
    h = await sign_in(rec, outbox, token)
    base = f"/api/recruiter/{token}"
    ids = {c["name"]: c["id"] for c in (await rec.get(f"{base}/candidates", headers=h)).json()["candidates"]}
    return org, inv, rec, h, base, ids, a, b


async def test_schedule_answer_reschedule_cancel(campus, owner, db, make_client, outbox):  # noqa: F811
    org, inv, rec, h, base, ids, asha, bala = await setup(campus, owner, make_client, outbox)
    body = {**ROUND, **when(), "ids": [ids["Asha Rao"], ids["Bala M"]]}
    # only shortlisted students
    r = await rec.post(f"{base}/interviews", headers=h, json=body)
    assert r.status_code == 400 and err(r) == "not_shortlisted"
    for cid in ids.values():
        await rec.put(f"{base}/board/{cid}", headers=h, json={"stage": "shortlisted"})
    # a place or a link; a time in the future; https links only
    assert err(await rec.post(f"{base}/interviews", headers=h, json={**body, "place": ""})) == "where"
    assert err(await rec.post(f"{base}/interviews", headers=h, json={**body, **when(-1)})) == "bad_time"
    assert (await rec.post(f"{base}/interviews", headers=h, json={**body, "link": "http://x.y"})).status_code == 422
    sent = len(outbox.sent)
    r = await rec.post(f"{base}/interviews", headers=h, json=body)
    assert r.status_code == 201, r.text
    rnd = r.json()
    assert rnd["emailsSent"] == 2 and rnd["counts"] == {"pending": 2, "confirmed": 0, "reschedule": 0}
    assert rnd["time"] == "10:30" and rnd["when"].endswith("10:30 AM IST")
    mails = outbox.sent[sent:]
    assert {m.to for m in mails} == {"asha@example.com", "bala@example.com"}
    m = mails[0]
    assert m.subject.startswith("Interview: Acme Analytics – Technical round 1") and "10:30 AM IST" in m.text
    name, mime, data = m.attachments[0]
    assert name == "interview.ics" and mime == "text/calendar"
    lines = unfold(data)
    d = date.fromisoformat(body["date"])
    utc = datetime.combine(d, time(5, 0)).strftime("%Y%m%dT%H%M%SZ")  # 10:30 IST is 05:00 UTC
    assert f"DTSTART:{utc}" in lines and "SEQUENCE:0" in lines and "LOCATION:Seminar hall\\, Block A" in lines
    uid = next(x for x in lines if x.startswith("UID:"))
    # shortlisted → interview on the board
    stages = {c["name"]: c["stage"] for c in (await rec.get(f"{base}/candidates", headers=h)).json()["candidates"]}
    assert stages == {"Asha Rao": "interview", "Bala M": "interview"}

    # the students see it, confirm or ask for another time
    mine = (await asha.get("/api/me/interviews")).json()
    assert mine["reminders"] is True and mine["interviews"][0]["company"] == "Acme Analytics"
    iid = mine["interviews"][0]["id"]
    assert (await asha.post(f"/api/me/interviews/{iid}/confirm")).json()["status"] == "confirmed"
    r = await bala.post(f"/api/me/interviews/{iid}/reschedule", json={"reason": "I have an exam that morning"})
    assert r.json()["status"] == "reschedule"
    told = outbox.sent[-1]
    assert told.to == "ravi@acme.example" and "I have an exam that morning" in told.text
    assert (await bala.post(f"/api/me/interviews/{iid}/reschedule", json={"reason": "no"})).status_code == 422
    ics_file = await asha.get(f"/api/me/interviews/{iid}/ics")
    assert ics_file.headers["content-type"].startswith("text/calendar") and uid in ics_file.text
    # someone else's interview: 404
    from tests.test_orgs import member

    other, _ = await member(make_client, outbox, "zed@example.com", "Zed")
    assert (await other.post(f"/api/me/interviews/{iid}/confirm")).status_code == 404

    # the recruiter and the coordinator see the answers
    rnd = (await rec.get(f"{base}/interviews", headers=h)).json()["rounds"][0]
    assert rnd["counts"] == {"pending": 0, "confirmed": 1, "reschedule": 1}
    assert {s["name"]: s["reason"] for s in rnd["students"]}["Bala M"] == "I have an exam that morning"
    col = (await owner.get(f"/api/org/{org['id']}/interviews")).json()
    assert col["on"] is True and col["rounds"][0]["counts"]["confirmed"] == 1
    assert {s["name"] for s in col["rounds"][0]["students"]} == {"Asha Rao", "Bala M"}

    # a new time: everyone asked again, updated .ics with the same UID and a higher sequence
    sent = len(outbox.sent)
    r = await rec.put(f"{base}/interviews/{iid}", headers=h, json={**ROUND, **when(4, "14:00")})
    assert r.status_code == 200 and r.json()["counts"] == {"pending": 2, "confirmed": 0, "reschedule": 0}
    mail = outbox.sent[sent]
    assert mail.subject.startswith("New time:") and "2:00 PM IST" in mail.text
    lines = unfold(mail.attachments[0][2])
    assert uid in lines and "SEQUENCE:1" in lines
    d4 = date.fromisoformat(when(4)["date"])
    assert f"DTSTART:{datetime.combine(d4, time(8, 30)).strftime('%Y%m%dT%H%M%SZ')}" in lines  # 14:00 IST

    # cancel: a CANCELLED .ics; students can't answer any more
    r = await rec.post(f"{base}/interviews/{iid}/cancel", headers=h)
    assert r.json()["cancelled"] is True
    assert "STATUS:CANCELLED" in unfold(outbox.sent[-1].attachments[0][2])
    assert err(await asha.post(f"/api/me/interviews/{iid}/confirm")) == "cancelled"


async def test_day_before_reminder_once_and_opt_out(campus, owner, db, make_client, outbox):  # noqa: F811
    org, inv, rec, h, base, ids, asha, bala = await setup(campus, owner, make_client, outbox)
    for cid in ids.values():
        await rec.put(f"{base}/board/{cid}", headers=h, json={"stage": "shortlisted"})
    r = await rec.post(f"{base}/interviews", headers=h, json={**ROUND, **when(1, "11:00"), "ids": list(ids.values())})
    iid = r.json()["id"]
    # turn the clock: today after 9:00 IST, the interview tomorrow
    tomorrow_11 = datetime.combine(now().astimezone(IST).date() + timedelta(days=1), time(11, 0), IST)
    assert (await db[INTERVIEWS].find_one({"_id": iid}))["starts_at"] == tomorrow_11
    import app.orgs.interviews as mod

    real = mod.now
    mod.now = lambda: datetime.combine(tomorrow_11.date() - timedelta(days=1), time(8, 0), IST)
    try:
        assert await interviews.send_reminders(db, outbox) == 0  # before 9:00
        mod.now = lambda: datetime.combine(tomorrow_11.date() - timedelta(days=1), time(9, 5), IST)
        # Bala turns reminders off
        assert (await bala.put("/api/me/interviews/reminders", json={"on": False})).json()["reminders"] is False
        sent = len(outbox.sent)
        assert await interviews.send_reminders(db, outbox) == 1
        m = outbox.sent[sent]
        assert m.to == "asha@example.com" and m.subject.startswith("Tomorrow:") and "stop-alerts#k=interviews" in m.text
        assert await interviews.send_reminders(db, outbox) == 0  # once
        # the unsubscribe link from the email
        token = m.text.split("#k=interviews&t=")[1].split()[0]
        assert (await make_client().post("/api/public/interviews/stop-reminders", json={"token": token})).is_success
        u = await db[USERS].find_one({"email": "asha@example.com"})
        assert u["notify"]["email"]["interviews"] is False
        bad = await make_client().post("/api/public/interviews/stop-reminders", json={"token": "x" * 20 + ".y" * 5})
        assert bad.status_code == 404
    finally:
        mod.now = real


async def test_plan_switch_and_erase(campus, owner, db, make_client, outbox):  # noqa: F811
    org, inv, rec, h, base, ids, asha, bala = await setup(campus, owner, make_client, outbox)
    await rec.put(f"{base}/board/{ids['Asha Rao']}", headers=h, json={"stage": "shortlisted"})
    r = await rec.post(f"{base}/interviews", headers=h, json={**ROUND, **when(), "ids": [ids["Asha Rao"]]})
    assert r.status_code == 201
    await plan(owner, org["id"], "drive")
    r = await rec.get(f"{base}/interviews", headers=h)
    assert r.status_code == 402 and err(r) == "plan_feature"
    # the student's own interviews stay visible to them
    assert len((await asha.get("/api/me/interviews")).json()["interviews"]) == 1
    # erasing the account takes them off every round
    from app.me.erase import erase_user_data

    uid = (await db[USERS].find_one({"email": "asha@example.com"}))["_id"]
    await erase_user_data(db, uid)
    assert (await db[INTERVIEWS].find_one({}))["students"] == []


async def test_demo_round(owner, db, make_client):  # noqa: F811
    from app.orgs import demo

    made = await demo.create_demo(db, None)
    token, rest = made["recruiterPath"].removeprefix("/recruiter/").split("#s=")
    h = {"X-Recruiter-Session": rest.split("&a=")[0]}
    rounds = (await make_client().get(f"/api/recruiter/{token}/interviews", headers=h)).json()["rounds"]
    assert len(rounds) == 1 and rounds[0]["counts"] == {"pending": 0, "confirmed": 1, "reschedule": 1}
    assert rounds[0]["round"].endswith("(demo)") and rounds[0]["time"] == "10:30"
    await demo.remove_demo(db)
    assert await db[INTERVIEWS].count_documents({}) == 0
