"""H5 One-tap interview slots (Phase 5): the company offers times, the candidate picks one, both get a calendar file.

Company (header X-Recruiter-Account; main / full / posting admins):
  POST /api/company/{cid}/hire/slots {job, slots: [{date, time, minutes, place, link, interviewer, round}]}  (IST)
  GET  /api/company/{cid}/hire/slots?job=           the slots, who booked each, and the marks
  POST /api/company/{cid}/hire/slots/{id}/cancel {reason}    the booked candidate is emailed the cancellation
  POST /api/company/{cid}/hire/slots/{id}/mark {result: attended | no_show | clear}   after it starts
  GET  /api/company/{cid}/hire/slots/{id}/ics       the calendar file
Candidate (signed in; only for jobs where they accepted an invite or were shortlisted):
  GET  /api/me/hire/slots                           per job: the open times and my booking
  POST /api/me/hire/slots/{id}/book {reason}        one tap; picking another time for the same job is a reschedule
                                                    (a reason is needed when it moves a booking)
  POST /api/me/hire/slots/{id}/cancel {reason}
  GET  /api/me/hire/slots/{id}/ics

Both sides get an email with the .ics on booking, rescheduling and cancelling. Reminders go 1 day and 1 hour before
(the automation pass; once each). The booking also sets the company application's interview (stage Interview), so the
dashboard and My applications show it. Attended / No-show feed the reliability score (H4); the candidate never sees
which company marked it, and a mark can be cleared.
"""

from datetime import date, datetime, time, timedelta
from html import escape
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header, Query, Response
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.companies.model import POST
from app.companies.signup import company_for
from app.core import ics
from app.core.config import get_settings
from app.core.db import APPLICATIONS, COMPANIES, DB, HIRE_INVITES, HIRE_SLOTS, JOBS, USERS
from app.core.email import Email, Mailer, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.hire import reliability
from app.jobs.apply import app_key, status_change
from app.me.service import ms

company = APIRouter(prefix="/api/company", tags=["hire in 60 minutes"])
me = APIRouter(prefix="/api/me/hire/slots", tags=["hire in 60 minutes"])

STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"
MAX_SLOTS = 30


class SlotIn(CamelModel):
    date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD, India time
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    minutes: int = Field(30, ge=10, le=240)
    place: str = Field("", max_length=200)
    link: str = Field("", max_length=300)
    interviewer: str = Field("", max_length=80)
    round: str = Field("", max_length=60)

    @field_validator("link")
    @classmethod
    def _link(cls, v: str) -> str:
        v = v.strip()
        if v and not v.startswith("https://"):
            raise ValueError("The online link must start with https://")
        return v


class SlotsIn(CamelModel):
    job: str = Field(min_length=1, max_length=40)
    slots: list[SlotIn] = Field(min_length=1, max_length=MAX_SLOTS)


def starts(s: SlotIn, t: datetime | None = None) -> datetime:
    t = t or now()
    try:
        h, m = (int(x) for x in s.time.split(":"))
        at = datetime.combine(date.fromisoformat(s.date), time(h, m), IST)
    except ValueError:
        raise ApiError(400, "bad_time", "Give the date and time like 2026-11-20 and 10:30.") from None
    if at < t + timedelta(minutes=15) or at > t + timedelta(days=60):
        raise ApiError(400, "bad_time", "Choose times from 15 minutes from now up to 60 days ahead.")
    if not s.place.strip() and not s.link:
        raise ApiError(400, "where", "Add a place or an online link for each time.")
    return at


def ist(t: datetime) -> str:
    return t.astimezone(IST).strftime("%a %-d %b, %-I:%M %p IST")


def slot_out(s: dict[str, Any], who: dict[str, str] | None = None) -> dict[str, Any]:
    out = {
        "id": str(s["_id"]), "jobId": s["job_id"], "at": ms(s["starts_at"]), "minutes": s["minutes"],
        "place": s["place"], "link": s["link"], "interviewer": s["interviewer"], "round": s["round"],
        "status": s["status"], "booked": bool(s.get("user_id")), "cancelReason": s.get("cancel_reason") or "",
        "mark": s.get("mark") or "",
    }  # fmt: skip
    if who is not None:
        out["who"] = who
    return out


def cal(s: dict[str, Any], company: str, role: str, cancelled: bool = False) -> bytes:
    site = get_settings().site_url.rstrip("/")
    return ics.event(
        uid=f"slot-{s['_id']}@nm7.si", sequence=int(s.get("seq", 0)), start=s["starts_at"], minutes=s["minutes"],
        summary=f"Interview: {company} – {role}" + (f" ({s['round']})" if s.get("round") else ""),
        location=" · ".join(x for x in (s["place"], s["link"]) if x),
        description="\n".join(x for x in (f"{company} – {role}", f"With: {s['interviewer']}" if s.get("interviewer")
                                          else "", f"{site}/me/hire") if x),
        url=s["link"], cancelled=cancelled,
    )  # fmt: skip


def slot_email(to: str, name: str, s: dict[str, Any], company: str, role: str, kind: str, reason: str = "") -> Email:
    """kind: booked / moved / cancelled / day / hour."""
    first = (name or "").split(" ")[0] or "there"
    when = ist(s["starts_at"])
    head = {
        "booked": f"Interview booked: {role} at {company}",
        "moved": f"Interview moved: {role} at {company}",
        "cancelled": f"Interview cancelled: {role} at {company}",
        "day": f"Tomorrow: interview for {role} at {company}",
        "hour": f"In 1 hour: interview for {role} at {company}",
    }[kind]
    lines = [
        f"When: {when} ({s['minutes']} minutes)",
        *([f"Round: {s['round']}"] if s.get("round") else []),
        *([f"With: {s['interviewer']}"] if s.get("interviewer") else []),
        *([f"Where: {s['place']}"] if s["place"] else []),
        *([f"Online: {s['link']}"] if s["link"] else []),
        *([f"Reason: {reason}"] if reason else []),
    ]
    text = "\n".join([f"Hi {first},", "", head + ".", "", *lines, "", "Nm7 · nm7.si"])
    html = (f'<div style="{STYLE}"><p>Hi {escape(first)},</p><p><b>{escape(head)}.</b></p><ul>'
            + "".join(f"<li>{escape(x)}</li>" for x in lines) + "</ul></div>")  # fmt: skip
    att = [("interview.ics", "text/calendar", cal(s, company, role, cancelled=kind == "cancelled"))]
    return Email(to=to, to_name=name, subject=f"{head} · {when}", text=text, html=html, attachments=att)


async def _names(db, s: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    c = await db[COMPANIES].find_one({"_id": s["company_id"]}, {"details.legal_name": 1})
    j = await db[JOBS].find_one({"_id": s["job_id"]}, {"title": 1})
    return ((c or {}).get("details") or {}).get("legal_name", "The company"), (j or {}).get("title", ""), c or {}


async def notify(db, mailer: Mailer, s: dict[str, Any], kind: str, reason: str = "") -> int:
    """The candidate and the company member who offered the times."""
    company, role, _ = await _names(db, s)
    sent = 0
    if s.get("user_id"):
        u = await db[USERS].find_one({"_id": s["user_id"]}, {"email": 1, "name": 1, "email_bounced": 1, "demo": 1})
        if u and not u.get("email_bounced") and not u.get("demo"):
            sent += await send_safely(mailer, slot_email(u["email"], u.get("name", ""), s, company, role, kind, reason))
    if s.get("by"):
        sent += await send_safely(mailer, slot_email(s["by"], "", s, company, role, kind, reason))
    return sent


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That time isn’t here.") from None


async def may_book(db, uid: str, job_id: str) -> bool:
    """Accepted an invite for the job, or the company moved the application to Shortlisted / Interview."""
    if await db[HIRE_INVITES].find_one({"user_id": uid, "job_id": job_id, "status": "accepted"}, {"_id": 1}):
        return True
    a = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": job_id, "company_removed_at": None}, {"status": 1})
    return bool(a and a.get("status") in ("shortlisted", "interview"))


async def _set_interview(db, s: dict[str, Any], uid: str, clear: bool = False) -> None:
    a = await db[APPLICATIONS].find_one({"user_id": uid, "key": app_key(s["job_id"])})
    if not a:
        return
    if clear:
        await db[APPLICATIONS].update_one({"_id": a["_id"]}, {"$set": {"interview": None, "updated_at": now()}})
        return
    old = a.get("interview") or {}
    iv = {"starts_at": s["starts_at"], "minutes": s["minutes"], "place": s["place"], "link": s["link"], "notes": "",
          "round": s["round"], "interviewer": s["interviewer"], "seq": int(old.get("seq", -1)) + 1,
          "by": s.get("by", ""), "slot_id": s["_id"]}  # fmt: skip
    upd: dict[str, Any] = {"$set": {"interview": iv, "updated_at": now()}}
    change = status_change(a, "interview")
    if change:
        upd["$set"] |= change["$set"]
        upd["$push"] = change["$push"]
    await db[APPLICATIONS].update_one({"_id": a["_id"]}, upd)


# --- company ------------------------------------------------------------------------------------------------------


@company.post("/{cid}/hire/slots", status_code=201)
async def add_slots(cid: str, body: SlotsIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account, POST)
    j = await db[JOBS].find_one({"_id": body.job, "company_id": cid}, {"status": 1})
    if not j:
        raise ApiError(404, "not_found", "That job isn’t one of yours.")
    t = now()
    docs = []
    for s in body.slots:
        doc = {"_id": ObjectId(), "company_id": cid, "job_id": body.job, "starts_at": starts(s, t),
               "minutes": s.minutes, "place": s.place.strip(), "link": s.link, "interviewer": s.interviewer.strip(),
               "round": s.round.strip(), "status": "open", "user_id": None, "seq": 0, "by": acc["email_lc"],
               "created_at": t, "updated_at": t}  # fmt: skip
        docs.append(doc)
    open_now = await db[HIRE_SLOTS].count_documents({"company_id": cid, "job_id": body.job, "status": "open"})
    if open_now + len(docs) > MAX_SLOTS:
        raise ApiError(409, "too_many", f"At most {MAX_SLOTS} open times a job.")
    await db[HIRE_SLOTS].insert_many(docs)
    await audit(db, None, "hire.slots", target=cid, data={"by": acc["email_lc"], "job": body.job, "n": len(docs)})
    return {"added": len(docs), "items": [slot_out(d, {}) for d in docs]}


@company.get("/{cid}/hire/slots")
async def list_slots(
    cid: str, db: DB, job: str = Query("", max_length=40), x_recruiter_account: str | None = Header(None)
) -> list[dict[str, Any]]:
    await company_for(db, cid, x_recruiter_account)
    q: dict[str, Any] = {"company_id": cid} | ({"job_id": job} if job else {})
    rows = await db[HIRE_SLOTS].find(q).sort("starts_at", 1).to_list(500)
    uids = list({r["user_id"] for r in rows if r.get("user_id")})
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": uids}}, {"name": 1})}
    return [
        slot_out(r, {"name": users.get(r["user_id"], {}).get("name", "")} if r.get("user_id") else {}) for r in rows
    ]


class ReasonIn(CamelModel):
    reason: str = Field("", max_length=300)


@company.post("/{cid}/hire/slots/{sid}/cancel")
async def company_cancel(
    cid: str, sid: str, body: ReasonIn, db: DB, mailer: MailerDep, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, _, _ = await company_for(db, cid, x_recruiter_account, POST)
    s = await db[HIRE_SLOTS].find_one({"_id": _oid(sid), "company_id": cid})
    if not s or s["status"] == "cancelled":
        raise ApiError(404, "not_found", "That time isn’t here.")
    t = now()
    if s["starts_at"] <= t:  # round E: a time that has started or passed is marked Attended / No-show, not cancelled
        raise ApiError(409, "past", "This interview time has passed. Mark it Attended or No-show instead.")
    if s.get("user_id") and len(body.reason.strip()) < 3:
        raise ApiError(400, "reason", "Say why, so the candidate knows.")
    sets = {"status": "cancelled", "cancel_reason": body.reason.strip(), "cancelled_by": "company", "updated_at": t,
            "seq": int(s.get("seq", 0)) + 1}  # fmt: skip
    await db[HIRE_SLOTS].update_one({"_id": s["_id"]}, {"$set": sets})
    s |= sets
    if s.get("user_id"):
        await _set_interview(db, s, s["user_id"], clear=True)
        await notify(db, mailer, s, "cancelled", s["cancel_reason"])
    await audit(db, None, "hire.slot_cancel", target=cid, data={"by": acc["email_lc"], "slot": sid})
    return slot_out(s, {})


class MarkIn(CamelModel):
    result: Literal["attended", "no_show", "clear"]


@company.post("/{cid}/hire/slots/{sid}/mark")
async def mark(
    cid: str, sid: str, body: MarkIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, _, _ = await company_for(db, cid, x_recruiter_account, POST)
    s = await db[HIRE_SLOTS].find_one({"_id": _oid(sid), "company_id": cid})
    if not s or s["status"] != "booked" or not s.get("user_id"):
        raise ApiError(404, "not_found", "Only a booked time can be marked.")
    if s["starts_at"] > now():
        raise ApiError(409, "not_yet", "Mark it once the interview has started.")
    ref = str(s["_id"])
    for k in ("attended", "no_show"):
        await reliability.forget(db, s["user_id"], k, ref)
    if body.result != "clear":
        await reliability.record(db, s["user_id"], body.result, cid, ref)
    new = "" if body.result == "clear" else body.result
    await db[HIRE_SLOTS].update_one({"_id": s["_id"]}, {"$set": {"mark": new, "updated_at": now()}})
    await audit(
        db, None, "hire.slot_mark", target=cid, data={"by": acc["email_lc"], "slot": sid, "result": body.result}
    )
    return slot_out({**s, "mark": new}, {})


@company.get("/{cid}/hire/slots/{sid}/ics")
async def company_ics(cid: str, sid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> Response:
    await company_for(db, cid, x_recruiter_account)
    s = await db[HIRE_SLOTS].find_one({"_id": _oid(sid), "company_id": cid})
    if not s:
        raise ApiError(404, "not_found", "That time isn’t here.")
    company_name, role, _ = await _names(db, s)
    return Response(cal(s, company_name, role, s["status"] == "cancelled"), media_type="text/calendar",
                    headers={"Content-Disposition": 'attachment; filename="interview.ics"'})  # fmt: skip


# --- candidate ----------------------------------------------------------------------------------------------------


@me.get("")
async def my_slots(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    uid = auth.user.id
    jobs = {i["job_id"] async for i in db[HIRE_INVITES].find({"user_id": uid, "status": "accepted"}, {"job_id": 1})}
    async for a in db[APPLICATIONS].find(
        {"user_id": uid, "status": {"$in": ["shortlisted", "interview"]}, "company_removed_at": None}, {"job_id": 1}
    ):
        if a.get("job_id"):
            jobs.add(a["job_id"])
    t = now()
    out = []
    for jid in sorted(jobs):
        rows = (
            await db[HIRE_SLOTS]
            .find({"job_id": jid, "status": {"$in": ["open", "booked"]}})
            .sort("starts_at", 1)
            .to_list(100)
        )
        mine = next((r for r in rows if r.get("user_id") == uid), None)
        free = [r for r in rows if r["status"] == "open" and r["starts_at"] > t + timedelta(minutes=10)]
        if not rows and not mine:
            continue
        company_name, role, _ = await _names(db, rows[0]) if rows else ("", "", {})
        out.append({"jobId": jid, "company": company_name, "role": role,
                    "mine": slot_out(mine) if mine else None, "open": [slot_out(r) for r in free]})  # fmt: skip
    return out


@me.post("/{sid}/book")
async def book(sid: str, body: ReasonIn, auth: CustomerAuth, db: DB, mailer: MailerDep) -> dict[str, Any]:
    uid = auth.user.id
    s = await db[HIRE_SLOTS].find_one({"_id": _oid(sid)})
    if not s or not await may_book(db, uid, s["job_id"]):
        raise ApiError(404, "not_found", "That time isn’t here.")
    t = now()
    if s["starts_at"] <= t + timedelta(minutes=10):
        raise ApiError(409, "too_late", "That time is too soon. Pick another.")
    old = await db[HIRE_SLOTS].find_one({"job_id": s["job_id"], "user_id": uid, "status": "booked"})
    if old and old["_id"] == s["_id"]:
        return slot_out(s)
    if old and len(body.reason.strip()) < 3:
        raise ApiError(400, "reason", "Say why you are moving it, so the company knows.")
    got = await db[HIRE_SLOTS].find_one_and_update(
        {"_id": s["_id"], "status": "open", "user_id": None},
        {"$set": {"status": "booked", "user_id": uid, "booked_at": t, "updated_at": t}, "$inc": {"seq": 1}},
        return_document=True,
    )
    if not got:
        raise ApiError(409, "taken", "Someone just took that time. Pick another.")
    if old:  # a reschedule: the old time is free again
        await db[HIRE_SLOTS].update_one(
            {"_id": old["_id"]}, {"$set": {"status": "open", "user_id": None, "updated_at": t}, "$inc": {"seq": 1}}
        )
    await _set_interview(db, got, uid)
    await notify(db, mailer, got, "moved" if old else "booked", body.reason.strip())
    await audit(db, uid, "hire.slot_book", target=got["company_id"], data={"slot": sid, "moved": bool(old)})
    return slot_out(got)


@me.post("/{sid}/cancel")
async def cancel(sid: str, body: ReasonIn, auth: CustomerAuth, db: DB, mailer: MailerDep) -> dict[str, Any]:
    uid = auth.user.id
    s = await db[HIRE_SLOTS].find_one({"_id": _oid(sid), "user_id": uid, "status": "booked"})
    if not s:
        raise ApiError(404, "not_found", "You have no booking at that time.")
    if len(body.reason.strip()) < 3:
        raise ApiError(400, "reason", "Say why, so the company knows.")
    t = now()
    await db[HIRE_SLOTS].update_one(
        {"_id": s["_id"]}, {"$set": {"status": "open", "user_id": None, "updated_at": t}, "$inc": {"seq": 1}}
    )
    await _set_interview(db, s, uid, clear=True)
    await notify(db, mailer, {**s, "seq": int(s.get("seq", 0)) + 1}, "cancelled", body.reason.strip())
    await audit(db, uid, "hire.slot_cancel", target=s["company_id"], data={"slot": sid})
    return {"ok": True}


@me.get("/{sid}/ics")
async def my_ics(sid: str, auth: CustomerAuth, db: DB) -> Response:
    s = await db[HIRE_SLOTS].find_one({"_id": _oid(sid), "user_id": auth.user.id})
    if not s:
        raise ApiError(404, "not_found", "You have no booking at that time.")
    company_name, role, _ = await _names(db, s)
    return Response(cal(s, company_name, role), media_type="text/calendar",
                    headers={"Content-Disposition": 'attachment; filename="interview.ics"'})  # fmt: skip


# --- reminders (the automation pass) ------------------------------------------------------------------------------


async def send_reminders(db, mailer: Mailer, t: datetime | None = None) -> int:
    """1 day and 1 hour before each booked time; once each (claimed before sending)."""
    t = t or now()
    sent = 0
    for kind, ahead, flag in (
        ("day", timedelta(days=1), "reminded_day"),
        ("hour", timedelta(hours=1), "reminded_hour"),
    ):
        q = {"status": "booked", "starts_at": {"$gt": t, "$lte": t + ahead}, flag: {"$ne": True}}
        async for s in db[HIRE_SLOTS].find(q).limit(500):
            if kind == "day" and s["starts_at"] <= t + timedelta(hours=1):
                await db[HIRE_SLOTS].update_one({"_id": s["_id"]}, {"$set": {flag: True}})
                continue  # booked less than an hour before: the 1-hour reminder is enough
            got = await db[HIRE_SLOTS].update_one({"_id": s["_id"], flag: {"$ne": True}}, {"$set": {flag: True}})
            if got.modified_count:
                sent += await notify(db, mailer, s, kind)
    return sent
