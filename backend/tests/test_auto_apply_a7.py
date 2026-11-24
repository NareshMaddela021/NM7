"""Auto Apply 2.0, phase A7: the Replies inbox (every channel, newest first, unread markers, linked to the tracker row);
interview invites (an "interview" status, or an email reply the rules read as one; the optional AI reader with a strict
schema, counted in the AI allowance, and nothing when there is no AI); the interview alert by email and WhatsApp
(opt-in, a configured sender, may_mail while the switch is OFF); the weekly summary (in-app and one email), the weekly
digest email and the one-routine-email-a-day rule; the "Auto Apply" section of Admin → Daily report (per channel and
each success measure met / not met at its edges); pricing (off by default; on: the free and paid weekly limits); and
Kavya's demo inbox with an interview invite."""

from datetime import timedelta

import pytest
from bson import ObjectId

from app.admin import daily_report as dr
from app.autoapply import demo, replies, stats, sync, v2engine, weekly
from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import (
    AI_USAGE,
    APPLICATIONS,
    AUTO_ITEMS,
    AUTO_MAIL,
    AUTO_MORNINGS,
    AUTO_REPLIES,
    DAILY_REPORTS,
    EMAIL_BLOCKS,
    USERS,
)
from app.core.time import IST, ist_day, now
from app.site import get_site, save_site
from tests.test_auto_apply_a3 import email_on, hook, sent_setup  # noqa: F401, F811
from tests.test_auto_apply_a6 import morning_mails, ok, ready, site_job
from tests.test_auto_apply_engine import company_job, no_ai, roomy  # noqa: F401
from tests.test_auto_apply_v2 import EMAIL, V2, run, tester
from tests.test_companies_posting import verified
from tests.test_companies_signup import no_network  # noqa: F401

ADMIN_V2 = "/api/admin/auto-apply/v2"


def oid() -> str:
    return str(ObjectId())


async def item(db, uid, **over):
    t = now()
    doc = {"_id": oid(), "user_id": uid, "job_id": oid(), "company": "Orbit Labs", "title": "Junior Data Analyst",
           "slug": "x", "state": "applied", "v2": True, "channel_v2": "internal", "created_at": t, "updated_at": t,
           **over}  # fmt: skip
    await db[AUTO_ITEMS].insert_one(doc)
    return doc


async def application(db, uid, it, status="applied", at=None, **over):
    t = at or now()
    tl = [{"status": "applied", "at": t}] + ([{"status": status, "at": t}] if status != "applied" else [])
    doc = {"_id": oid(), "key": f"job:{it['job_id']}", "user_id": uid, "job_id": it["job_id"], "status": status,
           "origin": "auto", "v2": True, "channel_v2": it.get("channel_v2"), "auto_item_id": it["_id"],
           "timeline": tl, "created_at": t, "updated_at": t, "company": it["company"], "role": it["title"],
           **over}  # fmt: skip
    await db[APPLICATIONS].insert_one(doc)
    return doc


def notice(status, text, at, seen=False):
    return {"status": status, "text": text, "at": at, "seen": seen}


# ---------- reading a reply ----------


def test_rules_read_replies():
    k = replies.rules_kind
    assert k("Interview invitation", "We'd like to invite you to an interview on Friday.") == "interview"
    assert k("Re: Application", "Are you free for a quick call tomorrow? calendly.com/orbit/30") == "interview"
    assert k("Re", "Unfortunately we are moving forward with other candidates.") == "rejection"
    assert k("Re", "After the interview, we regret to inform you…") == "rejection"  # rejection wins
    assert k("Thanks", "Thank you for applying. We will contact you for an interview if you are shortlisted.") == (
        "acknowledgement"
    )
    assert k("Re", "Could you please share your notice period?") == "question"
    assert k("Re", "Noted, thanks.") is None


async def test_ai_reader_strict_schema_counted_and_falls_back(db, monkeypatch):
    assert claude.schema_problems(replies.SCHEMA) == []
    assert replies.SCHEMA["additionalProperties"] is False
    assert replies.check({"kind": "interview"}) == "interview"
    with pytest.raises(claude.Unusable):
        replies.check({"kind": "maybe"})
    # no AI key: the rules' "can't tell" stays "other", nothing is counted
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    assert await replies.classify(db, "u1", "Re", "Noted, thanks.") == ("other", "none")
    assert await db[AI_USAGE].count_documents({}) == 0
    # the rules decide first: the AI is never asked
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    calls = []

    async def fake(subject, text):
        calls.append(text)
        return "interview"

    monkeypatch.setattr(replies, "call_model", fake)
    assert await replies.classify(db, "u1", "Re", "Unfortunately not.") == ("rejection", "rules")
    assert calls == []
    # the rules can't tell: the AI reads it, counted in the allowance as autoapply_reply
    assert await replies.classify(db, "u1", "Re", "Please see the attached schedule.") == ("interview", "ai")
    day = ai_quota.today()
    assert (await db[AI_USAGE].find_one({"_id": f"{day}|stat|autoapply_reply|calls"}))["n"] == 1
    assert (await db[AI_USAGE].find_one({"_id": f"{day}|person|autoapply_reply|u1"}))["n"] == 1

    # the AI fails: no guess
    async def broken(subject, text):
        raise claude.Unusable("bad_kind")

    monkeypatch.setattr(replies, "call_model", broken)
    assert await replies.classify(db, "u1", "Re", "Please see the attached schedule.") == ("other", "none")
    assert (await db[AI_USAGE].find_one({"_id": f"{day}|stat|autoapply_reply|failed"}))["n"] == 1
    # today's allowance used up: no call
    monkeypatch.setitem(ai_quota.PER_PERSON, "autoapply_reply", 0)
    monkeypatch.setattr(replies, "call_model", fake)
    n = len(calls)
    assert await replies.classify(db, "u2", "Re", "Please see the attached schedule.") == ("other", "none")
    assert len(calls) == n
    assert "autoapply_reply" in ai_quota.FEATURES and "autoapply_reply" in ai_quota.PER_KIOSK


# ---------- the inbox ----------


async def test_inbox_merges_every_channel_newest_first_with_unread(client, outbox, db):
    uid = await tester(client, outbox, db)
    t = now()
    nm7 = await item(db, uid, notices=[notice("viewed", "Orbit Labs opened your application.", t - timedelta(hours=5)),
                                       notice("interview", "Orbit Labs invited you to an interview.",
                                              t - timedelta(hours=2))])  # fmt: skip
    part = await item(
        db,
        uid,
        channel_v2="partner",
        partner={"name": "Darwinbox", "state": "delivered"},
        company="Zeta",
        notices=[notice("shortlisted", "Zeta shortlisted you.", t - timedelta(hours=3))],
    )
    await item(db, uid, state="ready", notices=[notice("remind", "Did you apply?", t - timedelta(minutes=5))])
    mail = await item(db, uid, channel_v2="email", company="Kappa")
    await db[AUTO_REPLIES].insert_one({"_id": "r1", "user_id": uid, "item_id": mail["_id"], "company": "Kappa",
                                       "title": "Analyst", "from": "hr@kappa.in", "from_name": "Kappa HR",
                                       "subject": "Re: Application", "text": "Thanks, we will be in touch.",
                                       "received_at": t - timedelta(hours=1), "kind": "acknowledgement"})  # fmt: skip
    await item(db, "someone-else", notices=[notice("interview", "Not yours", t)])
    d = ok(await client.get(f"{V2}/inbox"))
    rows = d["items"]
    assert [r["text"][:10] for r in rows] == ["Thanks, we", "Orbit Labs", "Zeta short", "Orbit Labs"]
    assert [r["channel"] for r in rows] == ["email", "internal", "partner", "internal"]
    assert rows[0]["itemId"] == mail["_id"] and rows[0]["kindText"] == "Received" and not rows[0]["interview"]
    assert rows[1]["interview"] and rows[1]["itemId"] == nm7["_id"] and rows[1]["label"] == "On Nm7"
    assert rows[2]["label"] == "Hiring system · Darwinbox" and rows[2]["itemId"] == part["_id"]
    assert d["unread"] == 4 and d["interviews"] == 1 and all(r["unread"] for r in rows)
    assert ok(await client.get(V2))["inboxUnread"] == 4
    # one read, then all read; a new one is unread again
    d = ok(await client.post(f"{V2}/inbox/read", json={"ids": [rows[1]["id"]]}))
    assert d["unread"] == 3 and not next(r for r in d["items"] if r["id"] == rows[1]["id"])["unread"]
    assert ok(await client.post(f"{V2}/inbox/read", json={}))["unread"] == 0
    await db[AUTO_ITEMS].update_one(
        {"_id": part["_id"]}, {"$push": {"notices": notice("offer", "Zeta made you an offer.", now())}}
    )
    d = ok(await client.get(f"{V2}/inbox"))
    assert d["unread"] == 1 and d["items"][0]["status"] == "offer" and d["items"][0]["unread"]


async def test_inbox_behind_the_switch(client, outbox, db):
    await tester(client, outbox, db)
    await save_site(db, {"auto_apply_v2": {"testers": [], "public": False}})
    assert (await client.get(f"{V2}/inbox")).status_code == 404
    assert (await client.get(f"{V2}/week")).status_code == 404


# ---------- interview invites and the alert ----------


async def test_email_reply_read_as_interview_invite(client, outbox, db, email_on):  # noqa: F811
    uid, j, it = await sent_setup(client, outbox, db)
    alias = (await client.get(f"{V2}/email")).json()["address"]
    n = len(outbox.sent)
    ev = {
        "type": "email.received",
        "data": {
            "email_id": "in_9",
            "from": "Priya <priya@orbit.example>",
            "to": [alias],
            "subject": "Next steps",
            "text": "Hi Sai, we would like to invite you to an interview on Friday at 3 PM.",
        },
    }
    r = (await hook(client, ev)).json()
    assert r["stored"] and r["kind"] == "interview"
    mine = [m for m in outbox.sent[n:] if m.to == EMAIL]
    assert len(mine) == 1 and mine[0].subject.startswith("Interview invitation · Reply from")  # one email, not two
    rep = await db[AUTO_REPLIES].find_one({"user_id": uid})
    assert rep["kind"] == "interview" and rep["kind_by"] == "rules"
    got = await db[AUTO_ITEMS].find_one({"_id": it["_id"]})
    assert got["interview_at"] and got["interview_alert"]["why"] == "ok" and got["interview_alert"]["email"] is False
    row = next(x for x in ok(await client.get(f"{V2}/tracker"))["items"] if x["id"] == it["_id"])
    assert row["stage"] == "replied" and row["outcome"] == "interview"
    inbox = ok(await client.get(f"{V2}/inbox"))
    assert inbox["items"][0]["interview"] and inbox["items"][0]["kindText"] == "Interview invite"
    # a second invite for the same row: no second alert
    await hook(client, {**ev, "data": {**ev["data"], "email_id": "in_10"}})
    assert len([m for m in outbox.sent[n:] if m.to == EMAIL]) == 2  # only the forwarded reply


class FakeWhatsApp:
    def __init__(self, available=True):
        self.available = available
        self.sent = []

    async def send(self, to, text):
        self.sent.append((to, text))
        return True


async def test_status_interview_alert_email_whatsapp_and_switch_off(client, outbox, db, monkeypatch):
    from app.college import reminders

    uid = await tester(client, outbox, db)
    wa = FakeWhatsApp()
    monkeypatch.setattr(reminders, "GATEWAY", wa)

    async def invite():
        it = await item(db, uid)
        app = await application(db, uid, it, status="interview")
        n = len(outbox.sent)
        assert await sync.on_status(db, app, "interview", outbox)
        return it, [m for m in outbox.sent[n:] if m.to == EMAIL]

    # not opted in to WhatsApp: the email only (one, not the old status email as well)
    it, mails = await invite()
    assert [m.subject for m in mails] == ["Interview invitation"] and "invited you to an interview" in mails[0].text
    a = (await db[AUTO_ITEMS].find_one({"_id": it["_id"]}))["interview_alert"]
    assert a == {"email": True, "whatsapp": False, "why": "ok", "whatsapp_why": "not_opted_in"} and wa.sent == []
    # once per row
    got = await replies.alert_interview(db, it["_id"], "again", outbox)
    assert got["why"] == "already"
    # opted in, with a phone and a configured sender: WhatsApp too
    await db[USERS].update_one({"_id": uid}, {"$set": {"notify.whatsapp.jobs": True, "phone": "98480 12345"}})
    it, mails = await invite()
    assert len(mails) == 1 and wa.sent and wa.sent[0][0] == "919848012345" and "interview" in wa.sent[0][1]
    # no sender configured (today's state): skipped and noted
    monkeypatch.setattr(reminders, "GATEWAY", FakeWhatsApp(available=False))
    it, mails = await invite()
    assert (await db[AUTO_ITEMS].find_one({"_id": it["_id"]}))["interview_alert"]["whatsapp_why"] == "no_sender"
    # the switch OFF and not a tester (an admin sees 2.0 but gets nothing): no email, no WhatsApp
    monkeypatch.setattr(reminders, "GATEWAY", wa)
    n_wa = len(wa.sent)
    await save_site(db, {"auto_apply_v2": {"testers": [], "public": False}})
    await db[USERS].update_one({"_id": uid}, {"$set": {"role": "admin"}})
    it, mails = await invite()
    assert mails == [] and len(wa.sent) == n_wa
    assert (await db[AUTO_ITEMS].find_one({"_id": it["_id"]}))["interview_alert"]["why"] == "switch_off"
    # a demo account never, even when public
    await save_site(db, {"auto_apply_v2": {"testers": [EMAIL], "public": True}})
    await db[USERS].update_one({"_id": uid}, {"$set": {"role": "customer", "demo": True}})
    it, mails = await invite()
    assert mails == [] and len(wa.sent) == n_wa
    # public, a real person: both
    await db[USERS].update_one({"_id": uid}, {"$set": {"demo": False}})
    it, mails = await invite()
    assert len(mails) == 1 and len(wa.sent) == n_wa + 1


# ---------- the week ----------


async def week_data(db, uid):
    t = now()
    rows = {}
    for ch, status in (("internal", "viewed"), ("internal", "interview"), ("email", "applied"), ("form", "applied"),
                       ("one_tap", "applied"), ("partner", "shortlisted")):  # fmt: skip
        it = await item(db, uid, channel_v2=ch, applied_at=t)
        rows.setdefault(ch, []).append(await application(db, uid, it, status=status))
    old = await item(db, uid)
    await application(db, uid, old, at=t - timedelta(days=9))  # last week: not counted
    await item(db, uid, notices=[notice("interview", "Orbit invited you.", t - timedelta(hours=1)),
                                 notice("rejected", "Zeta chose others.", t - timedelta(days=2))])  # fmt: skip
    await item(db, uid, interview_at=t - timedelta(hours=3), replied_at=t - timedelta(hours=3))
    await db[AUTO_REPLIES].insert_one({"_id": oid(), "user_id": uid, "received_at": t - timedelta(hours=3),
                                       "text": "x", "kind": "interview"})  # fmt: skip
    await item(db, uid, state="needs_answer")
    job = await site_job(db)  # an open job (a kit for a closed one isn't "ready")
    await item(db, uid, state="ready", channel_v2="one_tap", job_id=job["_id"])
    return rows


async def test_weekly_summary_contents(client, outbox, db):
    uid = await tester(client, outbox, db)
    await week_data(db, uid)
    w = ok(await client.get(f"{V2}/week"))
    by = {x["key"]: x["sent"] for x in w["byChannel"]}
    assert by == {"internal": 2, "email": 1, "partner": 1, "form": 1, "one_tap": 1} and w["sent"] == 6
    assert w["viewed"] == 3  # viewed, interview, shortlisted
    assert w["replies"] == 3  # the email reply + interview + rejected
    assert w["interviews"] == 2  # the interview status + the email invite
    assert w["waiting"] == 1 and w["ready"] == 1 and w["mode"] == "approve" and w["digest"] == []
    assert w["lines"][0].startswith("Last 7 days: 6 applications sent (Nm7 2, Email 1, Partner 1, Company form 1")
    assert "One routine Auto Apply email a day" in w["rule"]


async def test_one_routine_email_a_day(client, outbox, db, monkeypatch):
    uid, jobs, items = await ready(client, outbox, db)  # not the weekly day: the morning email only
    assert len(morning_mails(outbox)) == 1
    assert not [m for m in outbox.sent if m.subject.startswith(("Auto Apply today", "Your Auto Apply week"))]
    assert (await db[USERS].find_one({"_id": uid}))["auto_summary_day"] == ist_day()
    # the weekly day: the weekly summary replaces the morning email (and carries the jobs ready)
    await db[AUTO_MORNINGS].delete_many({})
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_summary_day": None}})
    monkeypatch.setattr(weekly, "WEEKDAY", now().astimezone(IST).weekday())
    n = len(outbox.sent)
    await run(db, outbox)
    new = [m.subject for m in outbox.sent[n:] if m.to == EMAIL]
    assert new == ["Your Auto Apply week"]
    wk = [m for m in outbox.sent[n:] if m.to == EMAIL][0]
    assert "2 jobs are ready for you to apply to yourself" in wk.text and "/me/auto-apply/v2?tab=ready" in wk.text
    m = await db[AUTO_MORNINGS].find_one({"_id": f"{uid}:{ist_day()}"})
    assert m["count"] == 2 and not m["mailed_at"] and m["mailed_in"] == "weekly"  # still listed in-app
    # the same day again: nothing more
    await run(db, outbox)
    assert [x.subject for x in outbox.sent[n:] if x.to == EMAIL] == ["Your Auto Apply week"]
    # not a tester while OFF: in-app only
    await db[AUTO_MORNINGS].delete_many({})
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.v2_week": None, "auto_summary_day": None}})
    await save_site(db, {"auto_apply_v2": {"testers": [], "public": False}})
    await db[USERS].update_one({"_id": uid}, {"$set": {"role": "admin"}})
    n = len(outbox.sent)
    await run(db, outbox)
    assert [x for x in outbox.sent[n:] if x.to == EMAIL] == []
    assert await db[AUTO_MORNINGS].count_documents({"user_id": uid}) == 1


async def test_weekly_digest_mode_email(client, outbox, db, monkeypatch):
    uid = await tester(client, outbox, db, mode="digest")
    for title, score in (("Junior Data Analyst", 88), ("BI Analyst", 76)):
        await item(db, uid, state="waiting_approval", mode="digest", title=title, score=score)
    monkeypatch.setattr(weekly, "WEEKDAY", now().astimezone(IST).weekday())
    site = await get_site(db)
    u = await db[USERS].find_one({"_id": uid})
    got = await weekly.routine(db, u, site, ist_day(), outbox)
    assert got["weekly"] is True
    m = [x for x in outbox.sent if x.to == EMAIL][-1]
    assert m.subject == "Your Auto Apply week · this week's list"
    assert "This week's list: 2 jobs waiting for your approval" in m.text
    assert m.text.index("Junior Data Analyst at Orbit Labs (match 88)") < m.text.index("BI Analyst at Orbit Labs")
    assert "/me/auto-apply/v2?tab=approve" in m.text
    w = ok(await client.get(f"{V2}/week"))
    assert w["mode"] == "digest" and [d["title"] for d in w["digest"]] == ["Junior Data Analyst", "BI Analyst"]
    assert w["lastEmailWeek"] == weekly.week_key(now())
    # once a week; and never after "Stop these emails"
    assert (await weekly.routine(db, u, site, ist_day(), outbox))["weekly"] is False
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.v2_week": None, "notify.email.autoapply": False}})
    n = len(outbox.sent)
    assert (await weekly.routine(db, u, site, ist_day(), outbox))["weekly"] is False and len(outbox.sent) == n


# ---------- Admin numbers ----------


async def test_daily_report_auto_apply_section_numbers(client, outbox, db, admin_client):
    uid = await tester(client, outbox, db)
    t = now()
    for ch, status, extra in (
        ("internal", "interview", {}),
        ("internal", "applied", {"auto_full": True}),
        ("partner", "shortlisted", {"partner": {"name": "Darwinbox", "state": "delivered"}}),
        ("partner", "applied", {"partner": {"name": "Darwinbox", "state": "kept"}}),
        ("form", "applied", {}),
        ("one_tap", "applied", {}),
        ("email", "applied", {"replied_at": t}),
        ("email", "applied", {}),
    ):
        it = await item(db, uid, channel_v2=ch, applied_at=t, **extra)
        await application(db, uid, it, status=status)
    demo_it = await item(db, uid, channel_v2="internal", demo=True)
    await application(db, uid, demo_it, demo=True)  # never counted
    await item(db, uid, state="ready", channel_v2="one_tap", form_proof={"ok": False})  # a form that failed
    for k, extra in enumerate(({"bounced_at": t}, {}, {})):
        await db[AUTO_MAIL].insert_one({"_id": oid(), "user_id": uid, "job_id": f"j{k}", "kind": "first", "at": t,
                                        **extra})  # fmt: skip
    s = await stats.section(db)
    ch = {r["key"]: r for r in s["channels"]}
    assert ch["internal"] | {} == {**ch["internal"], "sent": 2, "delivered": 2, "failed": 0, "interviews": 1,
                                   "replied": 1, "replyRate": 50.0}  # fmt: skip
    assert (ch["partner"]["sent"], ch["partner"]["delivered"], ch["partner"]["failed"]) == (2, 1, 1)
    assert ch["partner"]["replied"] == 1 and ch["partner"]["interviews"] == 0
    assert (ch["email"]["sent"], ch["email"]["delivered"], ch["email"]["failed"], ch["email"]["replied"]) == (
        3,
        2,
        1,
        1,
    )
    assert (ch["form"]["sent"], ch["form"]["failed"]) == (1, 1) and ch["one_tap"]["sent"] == 1
    assert s["totals"]["sent"] == 9 and s["switchOn"] is False and s["pricingOn"] is False
    keys = [m["key"] for m in s["measures"]]
    assert keys == ["replyRate", "perSeeker", "answered24h", "bounce", "complaints", "companyComplaints", "oneTap",
                    "autoShare"]  # fmt: skip
    # the snapshot keeps it (additive), and the report and the Admin page show it
    doc = await dr.snapshot(db, dr.ist_today(), True)
    assert doc["autoApply"]["channels"][0]["key"] == "internal" and doc["m"]["liveJobs"] is not None
    y = await dr.snapshot(db, dr.ist_today() - timedelta(days=1), False)  # backfilled days: no state, no section
    assert "autoApply" not in y
    owner = await admin_client("owner")
    rep = ok(await owner.get("/api/admin/daily-report"))
    assert rep["today"]["autoApply"]["totals"]["sent"] == 9
    assert ok(await owner.get(f"{ADMIN_V2}/stats"))["channels"][1]["key"] == "email"
    assert await db[DAILY_REPORTS].count_documents({}) >= 1


def _fake(monkeypatch, *, week=None, prev=None, m30=None, people=10, asked=(10, 7), mail=None, company=0,
          tap=(10, 5)):  # fmt: skip
    t = now()

    async def by_channel(db, since, until, user_id=None):
        if until - since > timedelta(days=8):
            return m30 if m30 is not None else {"internal": {"sent": 100, "replied": 10}}
        if until < t - timedelta(days=3):
            return prev if prev is not None else {}
        return week if week is not None else {"internal": {"sent": 100, "auto": 50}}

    async def seekers(db):
        return people

    async def answered(db, now_):
        return asked

    async def mail_(db, since, until):
        return mail or {"sent": 1000, "bounced": 19, "complained": 0}

    async def one_tap(db, now_):
        return tap

    async def blocks(*a, **k):
        return company

    monkeypatch.setattr(stats, "by_channel", by_channel)
    monkeypatch.setattr(stats, "seekers", seekers)
    monkeypatch.setattr(stats, "answered_24h", answered)
    monkeypatch.setattr(stats, "_mail", mail_)
    monkeypatch.setattr(stats, "one_tap", one_tap)
    return blocks


async def _measures(db, monkeypatch, **kw):
    blocks = _fake(monkeypatch, **kw)

    class Coll:
        count_documents = staticmethod(blocks)

    class FakeDb(dict):
        def __getitem__(self, k):
            return Coll() if k == EMAIL_BLOCKS else db[k]

    return {m["key"]: m for m in await stats.measures(FakeDb(), now())}


async def test_success_measures_met_and_not_met_at_their_edges(db, monkeypatch):
    m = await _measures(db, monkeypatch)
    assert m["replyRate"]["value"] == 10.0 and m["replyRate"]["state"] == "met"  # exactly 10%
    assert m["perSeeker"]["value"] == 10.0 and m["perSeeker"]["state"] == "met"  # exactly 10 a week
    assert m["answered24h"]["value"] == 70.0 and m["answered24h"]["state"] == "met"
    assert m["bounce"]["value"] == 1.9 and m["bounce"]["state"] == "met"
    assert m["complaints"]["value"] == 0.0 and m["complaints"]["state"] == "met"
    assert m["companyComplaints"]["value"] == 0 and m["companyComplaints"]["state"] == "met"
    assert m["oneTap"]["value"] == 50.0 and m["oneTap"]["state"] == "met"
    assert m["autoShare"]["state"] == "none" and m["autoShare"]["prev"] is None  # no week before to compare
    m = await _measures(db, monkeypatch, m30={"internal": {"sent": 1000, "replied": 99}}, people=4, asked=(10, 6),
                        mail={"sent": 1000, "bounced": 20, "complained": 1}, company=1, tap=(10, 4),
                        week={"internal": {"sent": 100, "auto": 40}},
                        prev={"internal": {"sent": 100, "auto": 40}})  # fmt: skip
    assert m["replyRate"]["value"] == 9.9 and m["replyRate"]["state"] == "miss"
    assert m["perSeeker"]["value"] == 25.0 and m["perSeeker"]["state"] == "met"  # exactly 25 a week
    assert m["answered24h"]["state"] == "miss"
    assert m["bounce"]["value"] == 2.0 and m["bounce"]["state"] == "miss"  # must be below 2%
    assert m["complaints"]["value"] == 0.1 and m["complaints"]["state"] == "miss"  # must be below 0.1%
    assert m["companyComplaints"]["state"] == "miss"
    assert m["oneTap"]["state"] == "miss"
    assert m["autoShare"]["value"] == 40.0 and m["autoShare"]["state"] == "miss"  # flat is not growth
    m = await _measures(db, monkeypatch, people=3, week={"internal": {"sent": 100, "auto": 41}},
                        prev={"internal": {"sent": 100, "auto": 40}})  # fmt: skip
    assert m["perSeeker"]["value"] == 33.3 and m["perSeeker"]["state"] == "miss"  # over 25
    assert m["autoShare"]["state"] == "met" and m["autoShare"]["prev"] == 40.0
    m = await _measures(db, monkeypatch, people=11, m30={}, asked=(0, 0), mail={"sent": 0, "bounced": 0,
                        "complained": 0}, tap=(0, 0), week={}, prev={})  # fmt: skip
    assert m["perSeeker"]["value"] == 0.0 and m["perSeeker"]["state"] == "miss"
    for k in ("replyRate", "answered24h", "bounce", "complaints", "oneTap", "autoShare"):
        assert m[k]["state"] == "none" and m[k]["value"] is None, k
    m = await _measures(db, monkeypatch, people=0)
    assert m["perSeeker"]["state"] == "none"


async def test_measures_counted_from_records(client, outbox, db):
    uid = await tester(client, outbox, db)
    t = now()
    # waiting questions: asked 2 days ago, one answered in 3 hours, one after 30 hours, one still open
    for wait in (3, 30, None):
        await item(db, uid, state="needs_answer" if wait is None else "applied", created_at=t - timedelta(days=2),
                   **({"answered_at": t - timedelta(days=2) + timedelta(hours=wait)} if wait else {}))  # fmt: skip
    assert await stats.answered_24h(db, t) == (3, 1)
    # one tap: listed 3 days ago, one confirmed; one listed today (still open: not counted)
    day3 = (t - timedelta(days=3)).date().isoformat()
    await item(db, uid, state="applied", channel_v2="one_tap", listed_day=day3, one_tap={"at": t})
    await item(db, uid, state="ready", channel_v2="one_tap", listed_day=day3)
    await item(db, uid, state="ready", channel_v2="one_tap", listed_day=t.date().isoformat())
    assert await stats.one_tap(db, t) == (2, 1)
    # company opt-outs and complaints in the last 30 days; a bounce isn't one
    await db[EMAIL_BLOCKS].insert_many([{"_id": "@a.in", "reason": "opt_out", "at": t},
                                        {"_id": "b@b.in", "reason": "bounce", "at": t}])  # fmt: skip
    m = {x["key"]: x for x in await stats.measures(db, t)}
    assert m["companyComplaints"]["value"] == 1 and m["companyComplaints"]["state"] == "miss"
    assert m["answered24h"]["value"] == 33.3 and m["oneTap"]["value"] == 50.0
    assert await stats.seekers(db) == 1


# ---------- pricing ----------


async def test_pricing_off_by_default_and_on_enforces_free_and_paid_limits(client, outbox, db, admin_client):
    uid = await tester(client, outbox, db, dailyLimit=10)
    site = await get_site(db)
    v2 = site["auto_apply_v2"]
    assert v2["pricing_on"] is False and v2["payments_on"] is False
    day = ist_day()
    for k in range(3):  # 3 counted this week
        await item(db, uid, counted_day=day, job_id=f"cj{k}")
    u = await db[USERS].find_one({"_id": uid})
    await save_site(db, {"auto_apply_v2": {**v2, "free_per_week": 2}})
    # pricing OFF: the free allowance is not enforced
    assert await v2engine.left_today(db, u, await get_site(db), "2000-01-01") == 10
    assert ok(await client.get(V2))["pricing"] == {"on": False}
    # pricing ON: the free allowance (2 a week, 3 used) stops everything
    await save_site(db, {"auto_apply_v2": {**v2, "pricing_on": True, "free_per_week": 5, "paid_limit": 20}})
    assert await v2engine.left_today(db, u, await get_site(db), "2000-01-01") == 2
    p = ok(await client.get(V2))["pricing"]
    assert p == {"on": True, "plan": "free", "weekLimit": 5, "usedThisWeek": 3, "leftThisWeek": 2}
    # a paid plan: the paid limit
    await db[USERS].update_one(
        {"_id": uid}, {"$set": {"auto_apply.plan": "paid", "auto_apply.paid_until": now() + timedelta(days=5)}}
    )
    u = await db[USERS].find_one({"_id": uid})
    assert await v2engine.left_today(db, u, await get_site(db), "2000-01-01") == 10  # the daily limit is lower
    await save_site(db, {"auto_apply_v2": {**v2, "pricing_on": True, "free_per_week": 2, "paid_limit": 4}})
    assert await v2engine.left_today(db, u, await get_site(db), "2000-01-01") == 1
    assert ok(await client.get(V2))["pricing"]["plan"] == "paid"
    # the paid plan ended: back to the free allowance
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.paid_until": now() - timedelta(days=1)}})
    u = await db[USERS].find_one({"_id": uid})
    assert await v2engine.left_today(db, u, await get_site(db), "2000-01-01") == -1
    # 0 = no weekly limit
    await save_site(db, {"auto_apply_v2": {**v2, "pricing_on": True, "free_per_week": 0}})
    assert await v2engine.left_today(db, u, await get_site(db), "2000-01-01") == 10
    # Admin: complete and editable, payments stay "coming soon"
    owner = await admin_client("owner")
    s = ok(await owner.get(ADMIN_V2))["settings"]
    assert {"pricingOn", "freePerWeek", "paidLimit", "paymentsOn"} <= set(s)
    r = await owner.put(f"{ADMIN_V2}/settings", json={**s, "pricingOn": True, "freePerWeek": 15, "paidLimit": 60})
    assert ok(r)["pricingOn"] is True and r.json()["freePerWeek"] == 15
    assert (await owner.put(f"{ADMIN_V2}/settings", json={**s, "paymentsOn": True})).status_code == 422
    r = await owner.put(f"{ADMIN_V2}/settings", json={**s, "freePerWeek": 20, "paidLimit": 10})
    assert r.status_code == 400
    assert (await get_site(db))["auto_apply_v2"]["payments_on"] is False


async def test_pricing_on_stops_the_engine_at_the_free_allowance(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    a = await company_job(client, session, cid, "Junior Data Analyst")
    b = await company_job(client, session, cid, "Data Analyst Trainee")
    uid = await tester(client, outbox, db, mode="full_auto")
    v2 = (await get_site(db))["auto_apply_v2"]
    await save_site(db, {"auto_apply_v2": {**v2, "pricing_on": True, "free_per_week": 1}})
    await run(db, outbox)
    assert await db[APPLICATIONS].count_documents({"user_id": uid}) == 1
    sent = await db[AUTO_ITEMS].find_one({"user_id": uid, "state": "applied"})
    assert sent["auto_full"] is True  # sent with no tap: counts in the fully automatic share
    await save_site(db, {"auto_apply_v2": {**v2, "pricing_on": False, "free_per_week": 1}})  # off: no weekly limit
    await run(db, outbox)
    assert {x["job_id"] async for x in db[APPLICATIONS].find({"user_id": uid})} == {a["id"], b["id"]}


# ---------- demo ----------


async def test_demo_kavya_has_a_replies_inbox_with_an_interview_invite(make_client, db, admin_client):
    owner = await admin_client("owner")
    r = await owner.post("/api/admin/auto-apply/demo")
    assert r.status_code == 200, r.text
    kavya = make_client()
    token = r.json()["path"].split("#t=")[1]
    assert (await kavya.post("/api/public/demo-student", json={"token": token})).status_code == 200
    d = ok(await kavya.get(f"{V2}/inbox"))
    assert d["interviews"] >= 2 and d["unread"] >= 3
    first = d["items"][0]
    assert first["channel"] == "email" and first["interview"] and first["kindText"] == "Interview invite"
    assert "invite you to an interview" in first["text"] and first["itemId"]
    assert any(x["source"] == "status" and x["status"] == "interview" for x in d["items"])
    assert any(not x["unread"] for x in d["items"])  # older ones read
    row = next(x for x in ok(await kavya.get(f"{V2}/tracker"))["items"] if x["id"] == first["itemId"])
    assert row["outcome"] == "interview"
    w = ok(await kavya.get(f"{V2}/week"))
    assert w["interviews"] >= 2 and w["sent"] >= 1
    assert await db[AUTO_REPLIES].count_documents({"user_id": demo.STUDENT_ID}) == 1
