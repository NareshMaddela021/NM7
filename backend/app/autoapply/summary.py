"""Auto Apply summaries (Phase 3, A6): the in-app card, one email a day when something happened, and a weekly report.

  GET  /api/me/auto-apply/summary          today: applied · need your answer · ready to apply · waiting for Approve;
                                           this week: applied, viewed, shortlisted, interviews, and 1-2 tips
  PUT  /api/me/auto-apply/emails {on}      the summary emails on / off (the same switch as "Stop these emails")
  POST /api/public/auto-apply/stop-emails {token}

Every number is counted from the student's own records: nothing is estimated or made up. Tips come only from real data
(a skill asked by several of the jobs that matched them this week and missing from their resume; jobs waiting for
their answer). The daily email goes after the student's part of the morning run, only when something happened that
day, at most once a day; the weekly one on Mondays. Never to an unconfirmed or bounced address or after "Stop these
emails".
"""

from collections import Counter
from datetime import timedelta
from html import escape
from typing import Any

from fastapi import APIRouter, Request
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import APPLICATIONS, AUTO_ITEMS, DB, JOB_FIT, USERS
from app.core.email import Email, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import IST, now

router = APIRouter(prefix="/api/me/auto-apply", tags=["auto apply"])
public = APIRouter(prefix="/api/public/auto-apply", tags=["auto apply"])

STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"
UNSUB_RULES = [(30, timedelta(hours=1))]
OPEN = ("needs_answer",)


def emails_on(u: dict[str, Any]) -> bool:
    return ((u.get("notify") or {}).get("email") or {}).get("autoapply", True) is not False


def unsub_token(uid: str) -> str:
    return f"{uid}.{keyed_hash('autoapply-unsub', uid)[:32]}"


def unsub_user(token: str) -> str | None:
    uid, _, sig = (token or "").rpartition(".")
    return uid if uid and sig and same(sig, keyed_hash("autoapply-unsub", uid)[:32]) else None


def _day_bounds(day: str):
    from datetime import date, datetime, time

    d = date.fromisoformat(day)
    start = datetime.combine(d, time(0, 0), IST)
    return start, start + timedelta(days=1)


async def today_counts(db, uid: str, day: str) -> dict[str, int]:
    start, end = _day_bounds(day)
    q = {"user_id": uid}
    return {
        "applied": await db[AUTO_ITEMS].count_documents(
            {**q, "state": {"$in": ["applied", "sent"]}, "applied_at": {"$gte": start, "$lt": end}}
        ),
        "needsAnswer": await db[AUTO_ITEMS].count_documents({**q, "state": "needs_answer"}),
        "ready": await db[AUTO_ITEMS].count_documents({**q, "state": "ready"}),
        "waiting": await db[AUTO_ITEMS].count_documents({**q, "state": "waiting_approval"}),
        "newToday": await db[AUTO_ITEMS].count_documents({**q, "created_at": {"$gte": start, "$lt": end}}),
    }


async def week(db, uid: str, t=None) -> dict[str, Any]:
    t = t or now()
    since = t - timedelta(days=7)
    apps = (
        await db[APPLICATIONS]
        .find({"user_id": uid, "origin": "auto", "created_at": {"$gte": since}}, {"status": 1, "timeline": 1})
        .to_list(500)
    )

    def reached(a, s):
        return any(x["status"] == s for x in a.get("timeline") or [])

    out = {
        "applied": len(apps),
        "viewed": sum(1 for a in apps if reached(a, "viewed") or a["status"] in ("shortlisted", "interview", "offer")),
        "shortlisted": sum(1 for a in apps if reached(a, "shortlisted")),
        "interviews": sum(1 for a in apps if reached(a, "interview")),
    }
    tips: list[dict[str, Any]] = []
    jobs = [
        x["job_id"] async for x in db[AUTO_ITEMS].find({"user_id": uid, "created_at": {"$gte": since}}, {"job_id": 1})
    ]
    if jobs:
        missing = Counter()
        async for f in db[JOB_FIT].find({"_id": {"$in": [f"{uid}:{j}" for j in jobs]}}, {"fit.missing": 1}):
            missing.update(set((f.get("fit") or {}).get("missing") or []))
        top = missing.most_common(1)
        if top and top[0][1] >= 2:
            tips.append({"kind": "skill", "skill": top[0][0], "n": top[0][1], "of": len(jobs)})
    waiting = await db[AUTO_ITEMS].count_documents({"user_id": uid, "state": "needs_answer"})
    if waiting:
        tips.append({"kind": "answers", "n": waiting})
    out["tips"] = tips[:2]
    return out


@router.get("/summary")
async def summary(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    from app.autoapply.engine import today

    u = await db[USERS].find_one({"_id": auth.user.id}, {"notify": 1, "auto_apply": 1}) or {}
    return {
        "setUp": bool((u.get("auto_apply") or {}).get("consent_at")),
        "on": bool((u.get("auto_apply") or {}).get("on")),
        "today": await today_counts(db, auth.user.id, today()),
        "week": await week(db, auth.user.id),
        "emails": emails_on(u),
    }


class OnIn(CamelModel):
    on: bool


@router.put("/emails")
async def set_emails(body: OnIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await db[USERS].update_one({"_id": auth.user.id}, {"$set": {"notify.email.autoapply": body.on}})
    return {"on": body.on}


class TokenIn(CamelModel):
    token: str = Field(min_length=10, max_length=200)


@public.post("/stop-emails")
async def stop_emails(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    key = f"autoapply-unsub:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, UNSUB_RULES)
    await rate_limit.record(db, key)
    uid = unsub_user(body.token)
    if not uid or not await db[USERS].find_one({"_id": uid}, {"_id": 1}):
        raise ApiError(
            404, "invalid_link", "This link doesn’t work. You can turn these emails off on the Auto Apply page."
        )
    await db[USERS].update_one({"_id": uid}, {"$set": {"notify.email.autoapply": False}})
    return {"ok": True}


# ---------- the emails ----------


def _mail(u: dict[str, Any], subject: str, lines: list[str], buttons: list[tuple[str, str]]) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (u.get("name") or "").split(" ")[0] or "there"
    stop = f"{site}/stop-alerts#t={unsub_token(u['_id'])}&k=autoapply"
    text = "\n".join(
        [
            f"Hi {first},",
            "",
            *lines,
            "",
            *[f"{label}: {site}{path}" for label, path in buttons],
            "",
            f"Stop these emails: {stop}",
            "",
            "Nm7 · nm7.si",
        ]
    )
    btn = "".join(
        f'<a href="{escape(site + path)}" style="display:inline-block;margin:4px 8px 4px 0;padding:8px 14px;'
        f'background:#111827;color:#fff;border-radius:8px;text-decoration:none">{escape(label)}</a>'
        for label, path in buttons
    )
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(first)},</p>'
        + "".join(f"<p>{escape(x)}</p>" for x in lines)
        + f"<p>{btn}</p>"
        + f'<p style="color:#666;font-size:13px"><a href="{escape(stop)}" style="color:#666">Stop these emails</a></p>'
        + "</div>"
    )
    return Email(to=u["email"], to_name=u.get("name", ""), subject=subject, text=text, html=html)


def _can_email(u: dict[str, Any]) -> bool:
    return bool(u.get("email") and u.get("email_verified_at") and not u.get("email_bounced") and emails_on(u))


async def after_run(db, mailer, u: dict[str, Any], day: str) -> dict[str, bool]:
    """The daily summary (when something happened today) and, on Mondays, the weekly report: once each."""
    out = {"daily": False, "weekly": False}
    fresh = await db[USERS].find_one({"_id": u["_id"]}) or u
    if not _can_email(fresh) or mailer is None:
        return out
    c = await today_counts(db, u["_id"], day)
    if fresh.get("auto_summary_day") != day and (c["applied"] or c["newToday"]):
        parts = [f"Applied {c['applied']}", f"{c['needsAnswer']} need your answer", f"{c['ready']} ready to apply"]
        if c["waiting"]:
            parts.append(f"{c['waiting']} waiting for your Approve")
        mail = _mail(
            fresh,
            "Auto Apply today: " + " · ".join(parts[:3]),
            ["Here is what Auto Apply did today:", " · ".join(parts) + "."],
            [
                ("Applied", "/me/jobs"),
                ("Needs your answer", "/me/auto-apply#needs"),
                ("Ready to apply", "/me/auto-apply#ready"),
            ],
        )
        if await send_safely(mailer, mail):
            await db[USERS].update_one({"_id": u["_id"]}, {"$set": {"auto_summary_day": day}})
            out["daily"] = True
    t = now().astimezone(IST)
    wk = f"{t.isocalendar().year}-W{t.isocalendar().week:02d}"
    if t.weekday() == 0 and fresh.get("auto_week") != wk:
        w = await week(db, u["_id"])
        if w["applied"]:
            lines = [
                f"Last 7 days: applied {w['applied']} · viewed {w['viewed']} · shortlisted {w['shortlisted']} · "
                f"interviews {w['interviews']}."
            ]
            for tip in w["tips"]:
                if tip["kind"] == "skill":
                    lines.append(
                        f"Tip: {tip['skill']} was asked in {tip['n']} of the {tip['of']} jobs that matched "
                        "you and isn't on your resume. If you know it, add it."
                    )
                else:
                    lines.append(f"Tip: {tip['n']} job(s) are waiting for your answer.")
            if await send_safely(
                mailer, _mail(fresh, "Your Auto Apply week", lines, [("See my applications", "/me/jobs")])
            ):
                await db[USERS].update_one({"_id": u["_id"]}, {"$set": {"auto_week": wk}})
                out["weekly"] = True
    return out
