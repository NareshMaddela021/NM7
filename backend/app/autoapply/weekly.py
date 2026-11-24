"""Auto Apply 2.0, phase A7: the candidate's week (in-app and one email) and the rule that keeps routine Auto Apply
emails to one a day.

  GET  /api/me/auto-apply/v2/week     the last 7 days: applications sent by channel, viewed, replies, interviews,
                                      questions waiting, jobs ready, this week's list (Weekly digest mode)

The one-email-a-day rule for a person in Auto Apply 2.0 (their part of the morning run, app/autoapply/engine.py):
  - On the weekly day (Monday, IST) the weekly summary is the only routine email. It also carries today's "N jobs
    ready" count and, in Weekly digest mode, this week's list to approve (the weekly digest email). The morning list
    is still made in-app that day, but not emailed.
  - On other days at most one: the A6 morning email ("N jobs ready to apply", which now also says what Auto Apply did
    today), or, when no job is ready, today's summary ("Auto Apply today: …") when something happened.
  - Today's Auto Apply summary emails (the old daily summary and the old weekly report) are never sent to a 2.0 person
    on top of these.
  Event emails are not routine and are not merged: a company's reply forwarded from the apply address, the interview
  alert, and the status updates (A2). Every 2.0 email goes only through access.may_mail (while the switch is OFF:
  listed testers only, never admins or demo accounts), to a confirmed, unbounced address, and never after "Stop these
  emails".
"""

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter

from app.auth.deps import CustomerAuth
from app.autoapply import access, rules, stats
from app.core.db import AUTO_ITEMS, AUTO_MORNINGS, AUTO_REPLIES, DB, USERS
from app.core.email import send_safely
from app.core.time import IST, now

router = APIRouter(prefix="/api/me/auto-apply/v2", tags=["auto apply 2.0"])

WEEKDAY = 0  # Monday (IST): the weekly summary
DIGEST_SHOWN = 10


def week_key(t: datetime) -> str:
    c = t.astimezone(IST).isocalendar()
    return f"{c.year}-W{c.week:02d}"


def weekly_day(t: datetime) -> bool:
    return t.astimezone(IST).weekday() == WEEKDAY


async def week(db, uid: str, t: datetime | None = None) -> dict[str, Any]:
    """The candidate's last 7 days, counted from their own records (nothing estimated)."""
    from app.autoapply.onetap import listing
    from app.me.service import ms

    t = t or now()
    since = t - timedelta(days=7)
    got = await stats.by_channel(db, since, t, user_id=uid)
    by = [{"key": k, "label": label, "sent": int((got.get(k) or {}).get("sent", 0))} for k, label in stats.CHANNELS]
    from app.core.db import APPLICATIONS

    q = {"user_id": uid, "v2": True, "created_at": {"$gte": since}}
    viewed = await db[APPLICATIONS].count_documents(
        {**q, "$or": [{"status": {"$in": ["viewed", "shortlisted", "interview", "offer"]}},
                      {"timeline.status": "viewed"}]}
    )  # fmt: skip
    emails = await db[AUTO_REPLIES].count_documents({"user_id": uid, "received_at": {"$gte": since}})
    moves = 0
    interviews = 0
    async for r in await db[AUTO_ITEMS].aggregate([
        {"$match": {"user_id": uid, "v2": True, "notices.at": {"$gte": since}}},
        {"$project": {"notices": 1, "interview_at": 1}},
        {"$unwind": "$notices"},
        {"$match": {"notices.at": {"$gte": since}, "notices.status": {"$in": ["shortlisted", "interview", "offer",
                                                                               "rejected"]}}},
        {"$group": {"_id": None, "n": {"$sum": 1},
                    "iv": {"$sum": {"$cond": [{"$eq": ["$notices.status", "interview"]}, 1, 0]}}}},
    ]):  # fmt: skip
        moves, interviews = int(r["n"]), int(r["iv"])
    interviews += await db[AUTO_ITEMS].count_documents(
        {"user_id": uid, "v2": True, "interview_at": {"$gte": since}, "notices.status": {"$ne": "interview"}}
    )
    u = await db[USERS].find_one({"_id": uid}, {"auto_apply": 1}) or {}
    a = u.get("auto_apply") or {}
    mode = rules.mode_of(a)
    approvals = await db[AUTO_ITEMS].count_documents({"user_id": uid, "state": "waiting_approval"})
    digest = []
    if mode == "digest":
        async for it in (
            db[AUTO_ITEMS]
            .find({"user_id": uid, "state": "waiting_approval"}, {"title": 1, "company": 1, "score": 1})
            .sort("score", -1)
            .limit(DIGEST_SHOWN)
        ):
            digest.append({"id": it["_id"], "title": it.get("title") or "", "company": it.get("company") or "",
                           "score": it.get("score")})  # fmt: skip
    return {
        "since": ms(since),
        "until": ms(t),
        "sent": sum(x["sent"] for x in by),
        "byChannel": by,
        "viewed": viewed,
        "replies": emails + moves,
        "interviews": interviews,
        "waiting": await db[AUTO_ITEMS].count_documents({"user_id": uid, "state": "needs_answer"}),
        "ready": (await listing(db, uid))["open"],
        "approvals": approvals,
        "mode": mode,
        "digest": digest,
        "lastEmailWeek": a.get("v2_week") or None,
    }


def _lines(w: dict[str, Any]) -> list[str]:
    parts = [f"{x['label']} {x['sent']}" for x in w["byChannel"] if x["sent"]]
    lines = [
        f"Last 7 days: {w['sent']} application{'s' if w['sent'] != 1 else ''} sent"
        + (f" ({', '.join(parts)})" if parts else "")
        + f" · viewed {w['viewed']} · replies {w['replies']} · interviews {w['interviews']}.",
    ]
    if w["waiting"]:
        lines.append(f"{w['waiting']} question{'s are' if w['waiting'] != 1 else ' is'} waiting for your answer.")
    if w["ready"]:
        lines.append(f"{w['ready']} job{'s are' if w['ready'] != 1 else ' is'} ready for you to apply to yourself.")
    if w["mode"] == "digest" and w["approvals"]:
        lines.append(f"This week's list: {w['approvals']} job{'s' if w['approvals'] != 1 else ''} waiting for your "
                     "approval. Nothing is sent until you approve.")  # fmt: skip
        lines += [f"· {d['title']} at {d['company']}" + (f" (match {d['score']})" if d.get("score") is not None else "")
                  for d in w["digest"]]  # fmt: skip
    return lines


def worth_sending(w: dict[str, Any]) -> bool:
    return bool(w["sent"] or w["replies"] or w["waiting"] or w["ready"] or (w["mode"] == "digest" and w["approvals"]))


async def send_weekly(db, mailer, u: dict[str, Any], w: dict[str, Any]) -> bool:
    from app.autoapply.summary import _mail

    buttons = [("See my week", "/me/auto-apply/v2?tab=week")]
    if w["mode"] == "digest" and w["approvals"]:
        buttons.insert(0, ("Approve this week's list", "/me/auto-apply/v2?tab=approve"))
    if w["ready"]:
        buttons.append(("Jobs ready", "/me/auto-apply/v2?tab=ready"))
    subject = "Your Auto Apply week" + (" · this week's list" if w["mode"] == "digest" and w["approvals"] else "")
    return await send_safely(mailer, _mail(u, subject, _lines(w), buttons))


async def routine(db, u: dict[str, Any], site: dict[str, Any], day: str, mailer=None) -> dict[str, Any]:
    """After a 2.0 person's part of the morning run: the in-app morning list, and at most ONE routine email."""
    from app.autoapply import onetap
    from app.autoapply.summary import _can_email, after_run

    t = now()
    v2 = site["auto_apply_v2"]
    fresh = await db[USERS].find_one({"_id": u["_id"]}) or u
    mail_ok = mailer is not None and access.may_mail(fresh, v2) and _can_email(fresh)
    out = {"listed": 0, "weekly": False, "morning": False, "daily": False}
    wk = week_key(t)
    if mail_ok and weekly_day(t) and (fresh.get("auto_apply") or {}).get("v2_week") != wk:
        out["listed"] = await onetap.morning(db, fresh, site, day, None)  # in-app only today
        w = await week(db, fresh["_id"], t)
        if worth_sending(w) and await send_weekly(db, mailer, fresh, w):
            await db[USERS].update_one(
                {"_id": fresh["_id"]},
                {"$set": {"auto_apply.v2_week": wk, "auto_week": wk, "auto_summary_day": day}},
            )
            await db[AUTO_MORNINGS].update_one({"_id": f"{fresh['_id']}:{day}"}, {"$set": {"mailed_in": "weekly"}})
            out["weekly"] = True
            return out
    else:
        out["listed"] = await onetap.morning(db, fresh, site, day, mailer if mail_ok else None)
    m = await db[AUTO_MORNINGS].find_one({"_id": f"{fresh['_id']}:{day}"}, {"mailed_at": 1}) or {}
    out["morning"] = bool(m.get("mailed_at"))
    if mail_ok and not out["morning"]:
        got = await after_run(db, mailer, fresh, day, weekly=False)  # today's summary, when something happened
        out["daily"] = got["daily"]
    return out


@router.get("/week")
async def get_week(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    from app.autoapply.v2 import _allowed

    await _allowed(db, auth.user.id)
    w = await week(db, auth.user.id)
    return {**w, "lines": _lines(w), "rule": "One routine Auto Apply email a day at most: the weekly summary on "
            "Mondays, otherwise the morning “jobs ready” email or today’s summary. Replies and interview alerts come "
            "as they happen."}  # fmt: skip
