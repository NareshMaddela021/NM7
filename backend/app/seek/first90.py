# ruff: noqa: E501  (checklist and message text on one line each)
"""Phase 6 S10: the first 90 days after joining, check-ins, and weekly progress during the search.

  GET  /api/me/progress                          this week (applications, interviews, skills verified, readiness change),
                                                 an honest message, and my jobs joined with their first-90-days checklist
  POST /api/me/progress/joined {company, role, joinDate}       I joined a job found elsewhere (an Nm7 offer marked
                                                 Joined appears by itself)
  PUT  /api/me/progress/joined/{id}/item {item, done}
  POST /api/me/progress/joined/{id}/checkin {day: 7|30, ok, problems, note}   "Is the job what was promised?"
  POST /api/me/progress/joined/{id}/report {problems, note}   "Something isn't as promised?" any day of the first 90
  POST /api/public/progress/stop {token}         stop the weekly progress and check-in emails
Admin ("companies"):
  GET  /api/admin/joining-reports · POST /api/admin/joining-reports/{id}/close {note}

A "No" at a check-in, or a report sent any day in the first 90 days, becomes a report to Nm7 (Admin → Joining
reports). Only Nm7 sees it; the company is never told who wrote it. Reports about the same company from two or more
different people in 180 days lower its trust score (5 points for each one after the first). Weekly progress counts
only what really happened; with nothing to show, it says so kindly and suggests one next step.
"""

import logging
import re
from datetime import date, timedelta
from html import escape
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Request
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import APPLICATIONS, COMPANIES, DB, HIRE_OFFERS, HIRE_SLOTS, JOINING_REPORTS, JOININGS, USERS
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import IST, now
from app.me.service import ms

log = logging.getLogger("nm7.progress")
me = APIRouter(prefix="/api/me/progress", tags=["job seekers"])
public = APIRouter(prefix="/api/public/progress", tags=["job seekers"])
admin = APIRouter(prefix="/api/admin/joining-reports", tags=["job seekers"])

CHECKLIST = {
    "week1": [("w1-docs", "Hand in your documents and get your offer letter signed copy"), ("w1-pay", "Note your pay day, PF / ESI and leave rules"),
              ("w1-people", "Learn your manager's and two teammates' names and roles"), ("w1-goals", "Ask what a good first month looks like")],
    "month1": [("m1-check", "Have a 10-minute check-in with your manager"), ("m1-tools", "Be able to use the main tools on your own"),
               ("m1-note", "Keep a short note of what you did each week")],
    "month3": [("m3-review", "Ask how your probation review will work and prepare for it"), ("m3-wins", "List three things you did well with numbers if you can"),
               ("m3-next", "Pick one skill to grow next (a free learning path helps)")],
}  # fmt: skip
ITEMS = {k for v in CHECKLIST.values() for k, _ in v}
TIPS = ["Arrive on time and tell your manager early if you'll be late or absent.", "Ask questions: in the first weeks nobody expects you to know everything.",
        "Keep copies of your offer letter, pay slips and any written promises.", "If something is not as promised (pay, role, hours, place), raise it politely in writing first."]  # fmt: skip
PROBLEMS = ("salary", "role", "hours", "location", "fee", "safety", "other")  # fee: asked to pay a deposit or a fee
REPORT_DAYS = 90  # the report button shows for the whole first 90 days
CHECK_DAYS = (7, 30)
REPORTS_WINDOW = timedelta(days=180)
WEEK = timedelta(days=7)


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "Not found.") from None


def today() -> date:
    return now().astimezone(IST).date()


def day_n(j: dict[str, Any]) -> int:
    try:
        return (today() - date.fromisoformat(j["join_date"])).days + 1
    except (KeyError, ValueError):
        return 0


async def sync_offers(db, uid: str) -> None:
    """An Nm7 offer marked Joined gets its joining record (once)."""
    async for o in db[HIRE_OFFERS].find({"user_id": uid, "status": "joined"}):
        c = await db[COMPANIES].find_one({"_id": o.get("company_id")}, {"details.legal_name": 1}) or {}
        doc = {"user_id": uid, "company_id": o.get("company_id"), "company": c.get("details", {}).get("legal_name", ""),
               "role": o.get("role") or o.get("title") or "", "join_date": o.get("join_date") or today().isoformat(),
               "source": "offer", "checklist": [], "checkins": {}, "created_at": now()}  # fmt: skip
        await db[JOININGS].update_one({"offer_id": o["_id"]}, {"$setOnInsert": doc}, upsert=True)


def joining_out(j: dict[str, Any]) -> dict[str, Any]:
    n = day_n(j)
    due = [d for d in CHECK_DAYS if n >= d and str(d) not in (j.get("checkins") or {})]
    return {"id": str(j["_id"]), "company": j["company"], "role": j["role"], "joinDate": j["join_date"], "day": n,
            "source": j["source"], "checklist": {k: [{"id": i, "text": t, "done": i in (j.get("checklist") or [])} for i, t in v] for k, v in CHECKLIST.items()},
            "checkins": {k: {"ok": v["ok"], "at": ms(v["at"])} for k, v in (j.get("checkins") or {}).items()},
            "due": due[0] if due else None, "tips": TIPS, "canReport": 1 <= n <= REPORT_DAYS,
            "reports": [{"at": ms(r["at"]), "problems": r["problems"]} for r in j.get("reports") or []]}  # fmt: skip


async def week_numbers(db, uid: str) -> dict[str, Any]:
    since = now() - WEEK
    apps = await db[APPLICATIONS].count_documents({"user_id": uid, "created_at": {"$gte": since}})
    interviews = await db[APPLICATIONS].count_documents({"user_id": uid, "interview.at": {"$gte": since}})
    interviews += await db[HIRE_SLOTS].count_documents({"user_id": uid, "booked_at": {"$gte": since}})
    u = await db[USERS].find_one({"_id": uid}, {"verified_skills": 1, "progress_snap": 1}) or {}
    skills = [v["skill"] for v in u.get("verified_skills") or [] if v.get("at") and v["at"] >= since]
    from app.simple.readiness import readiness

    ready = (await readiness(db, uid))["score"]
    snap = u.get("progress_snap") or {}
    change = ready - snap["score"] if snap.get("score") is not None else None
    if not snap.get("at") or now() - snap["at"] >= WEEK:  # one snapshot a week: the change is week on week
        await db[USERS].update_one({"_id": uid}, {"$set": {"progress_snap": {"score": ready, "at": now()}}})
    return {
        "applications": apps,
        "interviews": interviews,
        "skillsVerified": skills,
        "readiness": ready,
        "readinessChange": change,
    }


def message(w: dict[str, Any]) -> str:
    """Honest and kind: what happened, never invented numbers, never pressure."""
    if w["interviews"]:
        return "You had an interview this week. Whatever the result, each one makes the next easier."
    if w["skillsVerified"]:
        return f"You proved {', '.join(w['skillsVerified'])} this week. Companies hiring now can see it."
    if w["applications"]:
        return "You applied this week. Replies can take time; keep your Ready to join details fresh."
    if w["readinessChange"] and w["readinessChange"] > 0:
        return "Your readiness went up this week. Small steps add up."
    return "A quiet week is fine. One small step: a practice test or one course on your learning path."


@me.get("")
async def progress(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    await sync_offers(db, uid)
    w = await week_numbers(db, uid)
    jobs = [joining_out(j) async for j in db[JOININGS].find({"user_id": uid}).sort("created_at", -1).limit(10)]
    return {"week": w, "message": message(w), "joined": jobs}


class JoinedIn(CamelModel):
    company: str = Field(min_length=2, max_length=120)
    role: str = Field(min_length=2, max_length=120)
    join_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


@me.post("/joined", status_code=201)
async def joined(body: JoinedIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    try:
        d = date.fromisoformat(body.join_date)
    except ValueError:
        raise ApiError(422, "bad_date", "Give the joining date like 2026-11-01.") from None
    if d > today() + timedelta(days=60) or d < today() - timedelta(days=365):
        raise ApiError(422, "bad_date", "Use a joining date within the last year or the next 60 days.")
    rx = f"^{re.escape(body.company.strip())}$"
    c = await db[COMPANIES].find_one(
        {"details.legal_name": {"$regex": rx, "$options": "i"}, "demo": {"$ne": True}}, {"_id": 1}
    )
    doc = {"user_id": auth.user.id, "company_id": (c or {}).get("_id"), "company": body.company.strip(), "role": body.role.strip(),
           "join_date": body.join_date, "source": "self", "checklist": [], "checkins": {}, "created_at": now()}  # fmt: skip
    doc["_id"] = (await db[JOININGS].insert_one(doc)).inserted_id
    return joining_out(doc)


async def _mine(db, uid: str, jid: str) -> dict[str, Any]:
    j = await db[JOININGS].find_one({"_id": _oid(jid), "user_id": uid})
    if not j:
        raise ApiError(404, "not_found", "That job isn't here.")
    return j


class ItemIn(CamelModel):
    item: str = Field(min_length=2, max_length=20)
    done: bool


@me.put("/joined/{jid}/item")
async def item(jid: str, body: ItemIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    j = await _mine(db, auth.user.id, jid)
    if body.item not in ITEMS:
        raise ApiError(404, "not_found", "No such checklist item.")
    await db[JOININGS].update_one({"_id": j["_id"]}, {"$addToSet" if body.done else "$pull": {"checklist": body.item}})
    return joining_out(await db[JOININGS].find_one({"_id": j["_id"]}))


class CheckinIn(CamelModel):
    day: Literal[7, 30]
    ok: bool
    problems: list[Literal[PROBLEMS]] = Field(default_factory=list, max_length=7)  # type: ignore[valid-type]
    note: str = Field("", max_length=1000)


class ReportIn(CamelModel):
    problems: list[Literal[PROBLEMS]] = Field(min_length=1, max_length=7)  # type: ignore[valid-type]
    note: str = Field("", max_length=1000)


async def joining_penalty(db, cid: str) -> int:
    """Points off the company's trust score: 5 for each different person reporting after the first (180 days)."""
    people = await db[JOINING_REPORTS].distinct(
        "user_id", {"company_id": cid, "at": {"$gte": now() - REPORTS_WINDOW}, "status": {"$ne": "dismissed"}}
    )
    return 5 * max(0, len(people) - 1)


@me.post("/joined/{jid}/checkin")
async def checkin(jid: str, body: CheckinIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    j = await _mine(db, auth.user.id, jid)
    if day_n(j) < body.day:
        raise ApiError(409, "too_early", f"This check-in opens on day {body.day}.")
    if str(body.day) in (j.get("checkins") or {}):
        raise ApiError(409, "done", "You answered this check-in already.")
    if not body.ok and not body.problems:
        raise ApiError(422, "problems", "Pick what isn't as promised.")
    t = now()
    await db[JOININGS].update_one({"_id": j["_id"]}, {"$set": {f"checkins.{body.day}": {"ok": body.ok, "at": t}}})
    if not body.ok:
        await _report(db, auth.user.id, j, body.day, list(body.problems), body.note, "checkin")
    return joining_out(await db[JOININGS].find_one({"_id": j["_id"]}))


async def _report(db, uid: str, j: dict[str, Any], day: int, problems: list[str], note: str, how: str) -> None:
    """A report to Nm7 (Admin → Joining reports); the company is never told who wrote it."""
    t = now()
    await db[JOINING_REPORTS].insert_one({"joining_id": j["_id"], "user_id": uid, "company_id": j.get("company_id"),
                                          "company": j["company"], "role": j["role"], "day": day, "problems": problems,
                                          "note": note.strip(), "at": t, "status": "open", "how": how})  # fmt: skip
    await db[JOININGS].update_one({"_id": j["_id"]}, {"$push": {"reports": {"at": t, "problems": problems}}})
    await audit(
        db,
        uid,
        "joining.reported",
        target=j.get("company_id") or "",
        data={"day": day, "problems": problems, "how": how},
    )
    if j.get("company_id"):
        from app.companies.trust import refresh

        await refresh(db, j["company_id"])


@me.post("/joined/{jid}/report")
async def report(jid: str, body: ReportIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """ "Something isn't as promised? Report it": any day of the first 90, not only at the check-ins."""
    j = await _mine(db, auth.user.id, jid)
    n = day_n(j)
    if n < 1:
        raise ApiError(409, "not_started", "You can report once you've joined.")
    if n > REPORT_DAYS:
        raise ApiError(
            409, "too_late", f"Reports here are for the first {REPORT_DAYS} days. Contact Nm7 support instead."
        )
    key = f"joining-report:{auth.user.id}"
    await rate_limit.check(
        db, key, [(5, timedelta(days=1))], "You've sent several reports today. Nm7 will look at them first."
    )
    await rate_limit.record(db, key)
    await _report(db, auth.user.id, j, n, list(dict.fromkeys(body.problems)), body.note, "anytime")
    return joining_out(await db[JOININGS].find_one({"_id": j["_id"]}))


# --- emails -------------------------------------------------------------------------------------------------------


def unsub_token(user_id: str) -> str:
    return f"{user_id}.{keyed_hash('progress-unsub', user_id)[:32]}"


def unsub_user(token: str) -> str | None:
    uid, _, sig = (token or "").rpartition(".")
    return uid if uid and sig and same(sig, keyed_hash("progress-unsub", uid)[:32]) else None


class TokenIn(CamelModel):
    token: str = Field(min_length=10, max_length=200)


@public.post("/stop")
async def stop(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    key = f"progress-unsub:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, [(20, timedelta(hours=1))])
    await rate_limit.record(db, key)
    uid = unsub_user(body.token)
    if not uid or not await db[USERS].find_one({"_id": uid}, {"_id": 1}):
        raise ApiError(404, "invalid_link", "This link doesn't work.")
    await db[USERS].update_one({"_id": uid}, {"$set": {"progress_emails_off": True}})
    return {"ok": True}


def _mail(u: dict[str, Any], subject: str, lines: list[str], link: str) -> Email:
    site = get_settings().site_url.rstrip("/")
    stop_url = f"{site}/stop-alerts#t={unsub_token(u['_id'])}&k=progress"
    first = (u.get("name") or "").split(" ")[0] or "there"
    text = "\n".join([f"Hi {first},", "", *lines, "", f"Open: {site}{link}", "", f"Stop these emails: {stop_url}"])
    html = (f'<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p>Hi {escape(first)},</p>'
            + "".join(f"<p>{escape(x)}</p>" for x in lines)
            + f'<p><a href="{escape(site + link)}">Open</a></p><p style="color:#666;font-size:13px"><a href="{escape(stop_url)}" style="color:#666">Stop these emails</a></p></div>')  # fmt: skip
    return Email(to=u["email"], to_name=u.get("name", ""), subject=subject, text=text, html=html)


ELIGIBLE = {
    "email_verified_at": {"$ne": None},
    "email_bounced": {"$ne": True},
    "progress_emails_off": {"$ne": True},
    "deleted_at": None,
    "demo": {"$ne": True},
}


async def send_checkins(db, mailer: Mailer, limit: int = 300) -> int:
    """Day 7 and day 30 after joining: one email each, once."""
    sent = 0
    async for j in db[JOININGS].find({}).limit(limit):
        n = day_n(j)
        for d in CHECK_DAYS:
            if n < d or str(d) in (j.get("checkins") or {}) or d in (j.get("checkin_mailed") or []):
                continue
            got = await db[JOININGS].update_one(
                {"_id": j["_id"], "checkin_mailed": {"$ne": d}}, {"$push": {"checkin_mailed": d}}
            )
            u = await db[USERS].find_one({"_id": j["user_id"], **ELIGIBLE}, {"email": 1, "name": 1})
            if got.modified_count and u and await send_safely(mailer, _mail(u, f"Day {d} at {j['company']}: is the job what was promised?",
                    [f"It's day {d} at {j['company']}. Is the job what was promised: the pay, the role, the hours and the place?",
                     "Answer in one tap. If something isn't right, you can tell Nm7 privately."], "/me/progress")):  # fmt: skip
                sent += 1
    return sent


async def send_weekly(db, mailer: Mailer, limit: int = 300) -> int:
    """Once a week, while the person is searching (has applied in the last 30 days and hasn't joined)."""
    t = now()
    sent = 0
    since = t - timedelta(days=30)
    uids = await db[APPLICATIONS].distinct("user_id", {"created_at": {"$gte": since}})
    for uid in uids[:limit]:
        if await db[JOININGS].find_one({"user_id": uid}, {"_id": 1}):
            continue
        u = await db[USERS].find_one({"_id": uid, **ELIGIBLE, "$or": [{"progress_mailed_at": None}, {"progress_mailed_at": {"$lt": t - WEEK + timedelta(hours=1)}}]},
                                     {"email": 1, "name": 1})  # fmt: skip
        if not u:
            continue
        w = await week_numbers(db, uid)
        await db[USERS].update_one({"_id": uid}, {"$set": {"progress_mailed_at": t}})
        lines = [f"This week: {w['applications']} application{'s' if w['applications'] != 1 else ''}, {w['interviews']} interview{'s' if w['interviews'] != 1 else ''}"
                 + (f", skills verified: {', '.join(w['skillsVerified'])}" if w["skillsVerified"] else "") + ".",
                 f"Job readiness: {w['readiness']}%" + (f" ({'+' if w['readinessChange'] > 0 else ''}{w['readinessChange']} since last week)" if w["readinessChange"] else "") + ".",
                 message(w)]  # fmt: skip
        if await send_safely(mailer, _mail(u, "Your week on Nm7", lines, "/me/progress")):
            sent += 1
    if sent:
        log.info("weekly progress: %d email(s) sent", sent)
    return sent


# --- admin --------------------------------------------------------------------------------------------------------


@admin.get("")
async def reports(db: DB, _: AdminAuth("companies"), status: str = "open") -> list[dict[str, Any]]:
    q = {"status": status} if status in ("open", "closed", "dismissed") else {}
    out = []
    async for r in db[JOINING_REPORTS].find(q).sort("at", -1).limit(200):
        out.append({"id": str(r["_id"]), "company": r["company"], "companyId": r.get("company_id"), "role": r["role"], "day": r["day"],
                    "problems": r["problems"], "note": r["note"], "at": ms(r["at"]), "status": r["status"],
                    "how": r.get("how") or "checkin"})  # fmt: skip
    return out


class CloseIn(CamelModel):
    dismiss: bool = False  # not about the company (it no longer counts towards the trust score)
    note: str = Field("", max_length=500)


@admin.post("/{rid}/close")
async def close(rid: str, body: CloseIn, db: DB, auth: AdminAuth("companies")) -> dict[str, Any]:
    r = await db[JOINING_REPORTS].find_one({"_id": _oid(rid)})
    if not r:
        raise ApiError(404, "not_found", "No such report.")
    st = "dismissed" if body.dismiss else "closed"
    await db[JOINING_REPORTS].update_one(
        {"_id": r["_id"]}, {"$set": {"status": st, "admin_note": body.note.strip(), "closed_at": now()}}
    )
    await audit(db, auth.user.id, "joining.report_closed", target=str(r["_id"]), data={"status": st})
    if r.get("company_id"):
        from app.companies.trust import refresh

        await refresh(db, r["company_id"])
    return {"status": st}
