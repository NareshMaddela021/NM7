"""Phase 3 A6: the Auto Apply summary card, one summary email a day only when something happened (and never after
"Stop these emails" or to an unconfirmed address), and the weekly report with real numbers and tips from real data."""

from datetime import datetime

from app.autoapply import engine, summary
from app.core.db import APPLICATIONS, USERS
from app.core.time import IST, now
from tests.test_auto_apply_engine import URL, company_job, no_ai, roomy, run, student  # noqa: F401
from tests.test_companies_posting import verified
from tests.test_companies_signup import no_network  # noqa: F401


def mails_to(outbox, to):
    return [m for m in outbox.sent if m.to == to and "Auto Apply" in m.subject]


async def test_daily_summary_once_and_only_with_news(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    await company_job(client, session, cid, "Junior Data Analyst")
    await company_job(
        client, session, cid, "Data Analyst Notice", questions=[{"text": "Notice period in days?", "kind": "number"}]
    )
    uid = await student(client, outbox, db)
    await engine.run(db, outbox, force=True)
    mine = mails_to(outbox, "sai@example.com")
    assert len(mine) == 1
    m = mine[0]
    assert m.subject == "Auto Apply today: Applied 1 · 1 need your answer · 0 ready to apply"
    assert "/me/auto-apply#needs" in m.text and "Stop these emails: " in m.text and "k=autoapply" in m.text
    # the card
    s = (await client.get(f"{URL}/summary")).json()
    assert s["today"]["applied"] == 1 and s["today"]["needsAnswer"] == 1 and s["setUp"] and s["emails"]
    # the same day again: no second email
    await run(db)
    assert len(mails_to(outbox, "sai@example.com")) == 1
    # a quiet day: no email
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_summary_day": None}})
    assert (await summary.after_run(db, outbox, {"_id": uid}, "2000-01-01"))["daily"] is False


async def test_stop_emails_and_unconfirmed(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    await company_job(client, session, cid, "Junior Data Analyst")
    uid = await student(client, outbox, db)
    token = summary.unsub_token(uid)
    assert (await client.post("/api/public/auto-apply/stop-emails", json={"token": token + "x"})).status_code == 404
    assert (await client.post("/api/public/auto-apply/stop-emails", json={"token": token})).json() == {"ok": True}
    await engine.run(db, outbox, force=True)
    assert mails_to(outbox, "sai@example.com") == []
    assert (await client.get(f"{URL}/summary")).json()["emails"] is False
    assert (await client.put(f"{URL}/emails", json={"on": True})).json() == {"on": True}
    await db[USERS].update_one({"_id": uid}, {"$set": {"email_verified_at": None}})
    assert (await summary.after_run(db, outbox, {"_id": uid}, engine.today()))["daily"] is False


async def test_weekly_report_real_numbers_and_tips(client, outbox, db, monkeypatch):
    session, cid = await verified(client, outbox, db)
    for i in range(3):
        await company_job(client, session, cid, f"Data Analyst {i}", skills=["SQL", "Power BI", "Kafka"])
    uid = await student(client, outbox, db)
    await engine.run(db, outbox, force=True)
    apps = await db[APPLICATIONS].find({"user_id": uid}).to_list(None)
    assert len(apps) == 3
    t = now()
    await db[APPLICATIONS].update_one(
        {"_id": apps[0]["_id"]},
        {
            "$push": {
                "timeline": {
                    "$each": [
                        {"status": "viewed", "at": t},
                        {"status": "shortlisted", "at": t},
                        {"status": "interview", "at": t},
                    ]
                }
            },
            "$set": {"status": "interview"},
        },
    )
    await db[APPLICATIONS].update_one(
        {"_id": apps[1]["_id"]}, {"$push": {"timeline": {"status": "viewed", "at": t}}, "$set": {"status": "viewed"}}
    )
    w = (await client.get(f"{URL}/summary")).json()["week"]
    assert (w["applied"], w["viewed"], w["shortlisted"], w["interviews"]) == (3, 2, 1, 1)
    assert w["tips"][0] == {"kind": "skill", "skill": "Kafka", "n": 3, "of": 3}
    # Monday: the weekly email, once
    monday = datetime(2026, 11, 9, 9, 0, tzinfo=IST)
    monkeypatch.setattr(summary, "now", lambda: monday)
    out = await summary.after_run(db, outbox, {"_id": uid}, "2026-11-09")
    assert out["weekly"] is True
    m = next(x for x in outbox.sent if x.subject == "Your Auto Apply week")
    assert "applied 3 · viewed 2 · shortlisted 1 · interviews 1" in m.text
    assert "Kafka was asked in 3 of the 3 jobs that matched you and isn't on your resume" in m.text
    assert (await summary.after_run(db, outbox, {"_id": uid}, "2026-11-09"))["weekly"] is False
