"""Company trust score and student protection (Phase 2, C4).

Trust score 0–100, with the reasons in plain words (shown on every job card / page of the company and on its page):
  verification   Verified by Nm7 45 · emails confirmed 20 (an individual recruiter 15) · neither 0
  domain         company email on the website's domain 10 · domain over a year old 10 (unknown 5) · mail server 5
  reports        15, minus 5 for each student report in the last 90 days (never below 0)
  replies        up to 15 from how many Nm7 applications the company answered within 14 days (8 until there are
                 at least 3 to judge by)
It is worked out again on every company decision, report and once a day (automation pass), and kept on the company.

Response badge: "Usually replies in N days" — the median days from applying to the company's first answer
(shortlisted, interview, offer or not selected) over the last 90 days, only with at least 3 answers. Never made up.

No silent rejections: an application sent on Nm7 that the company hasn't moved for 14 days (Admin → Settings, "no
reply after") becomes Closed (no reply). The student sees it in My applications and gets a polite email (at most one a
day, never after they turned follow-up emails off, never to an unconfirmed or bounced address).
"""

import statistics
from datetime import timedelta
from html import escape
from typing import Any

from app.companies.model import trust_of
from app.core.config import get_settings
from app.core.db import APPLICATIONS, COMPANIES, JOB_REPORTS, JOBS, USERS
from app.core.email import Email, send_safely
from app.core.time import IST, now
from app.site import get_site

ANSWERED = ("shortlisted", "interview", "offer", "rejected")
WINDOW = timedelta(days=90)


async def reply_stats(db, cid: str) -> dict[str, Any]:
    """{answered, asked, rate, days}: Nm7 applications to this company's jobs in the last 90 days and how fast it
    answered (days = the median, None with fewer than 3 answers)."""
    t = now()
    job_ids = [j["_id"] async for j in db[JOBS].find({"company_id": cid}, {"_id": 1})]
    if not job_ids:
        return {"answered": 0, "asked": 0, "rate": None, "days": None}
    asked = answered_fast = 0
    days: list[float] = []
    async for a in db[APPLICATIONS].find(
        {"job_id": {"$in": job_ids}, "channel": "nm7", "created_at": {"$gte": t - WINDOW}}
    ):
        asked += 1
        first = next((s for s in a.get("timeline") or [] if s["status"] in ANSWERED), None)
        if first:
            d = (first["at"] - a["created_at"]).total_seconds() / 86400
            days.append(d)
            answered_fast += d <= 14
    return {
        "answered": len(days),
        "asked": asked,
        "rate": answered_fast / asked if asked else None,
        "days": max(1, round(statistics.median(days))) if len(days) >= 3 else None,
    }


async def score_of(db, c: dict[str, Any]) -> dict[str, Any]:
    trust = trust_of(c)
    parts: list[tuple[str, int]] = []
    if trust == "verified":
        parts.append(("verified", 45))
    elif trust == "basic":
        parts.append(
            ("individual" if c.get("kind") == "individual" else "emails", 15 if c.get("kind") == "individual" else 20)
        )
    if c.get("kind") == "company" and (c.get("emails") or {}).get("company"):
        parts.append(("domain_email", 10))
    dom = c.get("domain") or {}
    if c.get("kind") == "company":
        age = dom.get("age_days")
        parts.append(
            ("domain_old", 10)
            if age is not None and age >= 365
            else ("domain_unknown", 5)
            if age is None
            else ("domain_new", 0)
        )
        if dom.get("mx"):
            parts.append(("mail", 5))
    job_ids = [j["_id"] async for j in db[JOBS].find({"company_id": c["_id"]}, {"_id": 1})]
    reports = (
        await db[JOB_REPORTS].count_documents({"job_id": {"$in": job_ids}, "at": {"$gte": now() - WINDOW}})
        if job_ids
        else 0
    )
    parts.append(("reports", max(0, 15 - 5 * reports)))
    rs = await reply_stats(db, c["_id"])
    parts.append(("replies", round(15 * rs["rate"]) if rs["asked"] >= 3 and rs["rate"] is not None else 8))
    if trust == "blocked":
        parts = [("blocked", 0)]
    value = max(0, min(100, sum(p for _, p in parts)))
    return {
        "value": value,
        "parts": [{"code": k, "points": p} for k, p in parts],
        "reports": reports,
        "replyDays": rs["days"],
        "at": now(),
    }


async def refresh(db, cid: str) -> dict[str, Any] | None:
    c = await db[COMPANIES].find_one({"_id": cid})
    if not c:
        return None
    s = await score_of(db, c)
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"score": s}})
    return s


async def refresh_all(db, limit: int = 500) -> int:
    """Once a day in the automation pass: every company's score (reports and replies change over time)."""
    day = now().astimezone(IST).date().isoformat()
    n = 0
    async for c in (
        db[COMPANIES].find({"$or": [{"score_day": {"$ne": day}}, {"score_day": None}]}, {"_id": 1}).limit(limit)
    ):
        await refresh(db, c["_id"])
        await db[COMPANIES].update_one({"_id": c["_id"]}, {"$set": {"score_day": day}})
        n += 1
    return n


def badge(c: dict[str, Any] | None) -> dict[str, Any] | None:
    """What a job card / page shows about its company: {name, slug, level, score, parts, replyDays}."""
    if not c or c.get("demo"):
        return None
    s = c.get("score") or {}
    return {
        "slug": c["slug"],
        "level": trust_of(c),
        "score": s.get("value"),
        "parts": s.get("parts") or [],
        "replyDays": s.get("replyDays"),
    }


# ---------- no silent rejections ----------


async def close_silent(db, mailer, limit: int = 500) -> int:
    """Nm7 applications nobody moved for `no_reply_days` (default 14): Closed (no reply), the student told."""
    days = int((await get_site(db))["companies"].get("no_reply_days", 14))
    t = now()
    rows = (
        await db[APPLICATIONS]
        .find(
            {
                "channel": "nm7",
                "status": {"$in": ["applied", "viewed"]},
                "created_at": {"$lte": t - timedelta(days=days)},
                "job_id": {"$exists": True},
            }
        )
        .limit(limit)
        .to_list(None)
    )
    if not rows:
        return 0
    jobs = {
        j["_id"]: j async for j in db[JOBS].find({"_id": {"$in": list({a["job_id"] for a in rows})}}, {"company_id": 1})
    }
    rows = [a for a in rows if (jobs.get(a["job_id"]) or {}).get("company_id")]  # only jobs a company runs on Nm7
    by_user: dict[str, list[dict[str, Any]]] = {}
    for a in rows:
        await db[APPLICATIONS].update_one(
            {"_id": a["_id"], "status": {"$in": ["applied", "viewed"]}},
            {"$set": {"status": "no_reply", "updated_at": t}, "$push": {"timeline": {"status": "no_reply", "at": t}}},
        )
        by_user.setdefault(a["user_id"], []).append(a)
    from app.jobs.apply import followups_on

    site = get_settings().site_url.rstrip("/")
    day = t.astimezone(IST).date().isoformat()
    for uid, apps in by_user.items():
        u = await db[USERS].find_one({"_id": uid})
        if not u or not followups_on(u) or not u.get("email_verified_at") or u.get("email_bounced"):
            continue
        if u.get("no_reply_email_day") == day:
            continue
        first = (u.get("name") or "").split(" ")[0] or "there"
        lines = [f"- {a['role']} at {a['company']}" for a in apps[:5]]
        text = "\n".join(
            [
                f"Hi {first},",
                "",
                f"The company hasn't replied in {days} days, so we've closed these applications for you:",
                "",
                *lines,
                "",
                "It isn't about you: companies often fill roles quickly. New jobs that "
                f"match you are waiting: {site}/jobs?sort=match",
                "",
                "Nm7 · nm7.si",
            ]
        )
        html = "<p>" + escape(text).replace("\n", "<br>") + "</p>"
        if await send_safely(mailer, Email(u["email"], u.get("name", ""), "An update on your application", text, html)):
            await db[USERS].update_one({"_id": uid}, {"$set": {"no_reply_email_day": day}})
    return len(rows)
