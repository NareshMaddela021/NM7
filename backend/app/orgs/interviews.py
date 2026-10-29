"""Interview scheduling (R3; the `interview_scheduling` feature, Campus). A recruiter schedules a round from the
shortlist board; each student gets an email with an .ics calendar file (Google Calendar, Outlook, Apple Calendar)
and sees it in My drive day and My groups, where they Confirm or ask for another time (with a reason). The
recruiter and the college's coordinators see confirmed / waiting / asked-for-another-time. A new time sends an
updated .ics (same event, higher sequence). The day before, the automation pass sends a reminder (once per student
per time, never to a bounced address or someone who turned interview reminders off). No paid calendar service.

Recruiter (the portal's invite session or a recruiter account; the invite must be active):
  GET  /api/recruiter/{token}/interviews                    rounds with each student's answer
  POST /api/recruiter/{token}/interviews                    {ids, round, date, time (IST), minutes, place, link,
                                                            interviewer, notes}: students on the shortlist board
  PUT  /api/recruiter/{token}/interviews/{id}               a new time / place: everyone is asked again
  POST /api/recruiter/{token}/interviews/{id}/cancel
Student:
  GET  /api/me/interviews                                   upcoming (and the last week's), with my answer
  POST /api/me/interviews/{id}/confirm · /reschedule {reason}
  GET  /api/me/interviews/{id}/ics                          the calendar file again
  PUT  /api/me/interviews/reminders {on}                    the day-before reminder email
  POST /api/public/interviews/stop-reminders {token}        the link in the reminder email (no sign-in)
Coordinators:
  GET  /api/org/{org_id}/interviews                         every round in their groups, with each student's answer
"""

import re
from datetime import date, datetime, time, timedelta
from html import escape
from typing import Any, Literal

from fastapi import APIRouter, Header, Request, Response
from pydantic import Field, field_validator
from pymongo.asynchronous.database import AsyncDatabase

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.core import ics, rate_limit
from app.core.config import get_settings
from app.core.db import DB, INTERVIEWS, MEMBERSHIPS, ORGANIZATIONS, RECRUITER_INVITES, USERS
from app.core.email import Email, Mailer, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import IST, now
from app.me.service import ms
from app.orgs.recruiter import NO_STORE
from app.orgs.recruiter_portal import STAGES, _audit, _cid, _signed_in, visible
from app.orgs.scope import NOT_FOUND, OrgScope, features_of, require_feature

portal = APIRouter(prefix="/api/recruiter/{token}/interviews", tags=["interviews"])
me = APIRouter(prefix="/api/me/interviews", tags=["interviews"])
public = APIRouter(prefix="/api/public/interviews", tags=["interviews"])
staff = APIRouter(prefix="/api/org/{org_id}/interviews", tags=["interviews"])

MAX_DAYS = 120
CREATE_RULES = [(60, timedelta(hours=1))]  # rounds made or changed per invite
ASK_RULES = [(10, timedelta(hours=1))]  # a student's answers per hour
UNSUB_RULES = [(30, timedelta(hours=1))]
REMIND_FROM = time(9, 0)  # the day before, from 9:00 IST
STYLE = "font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5"
STATUS = {"pending": "Waiting for an answer", "confirmed": "Confirmed", "reschedule": "Asked for another time"}


class RoundIn(CamelModel):
    round: str = Field(min_length=1, max_length=60)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    minutes: int = Field(30, ge=10, le=480)
    place: str = Field("", max_length=200)
    link: str = Field("", max_length=500)
    interviewer: str = Field(min_length=1, max_length=80)
    notes: str = Field("", max_length=500)

    @field_validator("round", "place", "interviewer", "notes")
    @classmethod
    def _tidy(cls, v):
        return " ".join(v.split())

    @field_validator("link")
    @classmethod
    def _link(cls, v):
        v = v.strip()
        if v and not re.match(r"^https://[^\s<>\"']+$", v):
            raise ValueError("Give the online link starting with https://")
        return v


class NewIn(RoundIn):
    ids: list[str] = Field(min_length=1, max_length=100)


class AskIn(CamelModel):
    reason: str = Field(min_length=5, max_length=300)


class OnIn(CamelModel):
    on: bool


class TokenIn(CamelModel):
    token: str = Field(min_length=10, max_length=200)


# ---------- helpers ----------
def _start(body: RoundIn) -> datetime:
    try:
        d = date.fromisoformat(body.date)
        h, m = (int(x) for x in body.time.split(":"))
        t = datetime.combine(d, time(h, m), IST)
    except ValueError:
        raise ApiError(400, "bad_time", "Give the date and time like 2026-11-20 and 10:30.") from None
    if t < now() + timedelta(minutes=15) or t > now() + timedelta(days=MAX_DAYS):
        raise ApiError(400, "bad_time", f"Choose a time from 15 minutes from now up to {MAX_DAYS} days ahead.")
    if not body.place and not body.link:
        raise ApiError(400, "where", "Add a place or an online link.")
    return t


def ist(t: datetime) -> str:
    """'Fri 20 Nov 2026, 10:30 AM IST'."""
    return t.astimezone(IST).strftime("%a %-d %b %Y, %-I:%M %p IST")


def interview_ics(iv: dict[str, Any], cancelled: bool = False) -> bytes:
    where = " · ".join(x for x in (iv["place"], iv["link"]) if x)
    desc = "\n".join(
        x
        for x in (
            f"{iv['company']} – {iv['round']}",
            f"Interviewer: {iv['interviewer']}",
            f"Online: {iv['link']}" if iv["link"] else "",
            iv["notes"],
            f"Confirm or ask for another time: {get_settings().site_url}/me/drive",
        )
        if x
    )
    return ics.event(
        uid=f"{iv['_id']}@nm7.si",
        sequence=iv["seq"],
        start=iv["starts_at"],
        minutes=iv["minutes"],
        summary=f"Interview: {iv['company']} – {iv['round']}",
        location=where,
        description=desc,
        url=iv["link"],
        cancelled=cancelled,
    )


def _email(iv: dict[str, Any], to: str, name: str, kind: str, stop: str = "") -> Email:
    first = (name or "").split(" ")[0] or "there"
    site = get_settings().site_url
    head = {
        "new": f"{iv['company']} invited you to an interview",
        "update": f"New time for your {iv['company']} interview",
        "cancel": f"{iv['company']} cancelled this interview",
        "remind": f"Reminder: your {iv['company']} interview is tomorrow",
    }[kind]
    lines = [
        f"Round: {iv['round']}",
        f"When: {ist(iv['starts_at'])} ({iv['minutes']} minutes)",
        *([f"Where: {iv['place']}"] if iv["place"] else []),
        *([f"Online: {iv['link']}"] if iv["link"] else []),
        f"Interviewer: {iv['interviewer']}",
        *([f"Notes: {iv['notes']}"] if iv["notes"] else []),
    ]
    act = "" if kind == "cancel" else f"Confirm or ask for another time: {site}/me/drive"
    attached = "The calendar file is attached (Google Calendar, Outlook, Apple Calendar)." if kind != "remind" else ""
    stop_line = [f"Stop interview reminder emails: {stop}"] if stop else []
    text = "\n".join([f"Hi {first},", "", head + ".", "", *lines, "", act, attached, *stop_line, "", "Nm7 · nm7.si"])
    rows = "".join(f"<li>{escape(x)}</li>" for x in lines)
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(first)},</p><p><b>{escape(head)}.</b></p><ul>{rows}</ul>'
        + (f'<p><a href="{escape(site)}/me/drive">Confirm or ask for another time</a></p>' if act else "")
        + (
            f'<p style="color:#666;font-size:13px"><a href="{escape(stop)}" style="color:#666">Stop interview '
            "reminder emails</a></p>"
            if stop
            else ""
        )
        + "</div>"
    )
    subject = {"new": "Interview", "update": "New time", "cancel": "Cancelled", "remind": "Tomorrow"}[kind]
    when = iv["starts_at"].astimezone(IST).strftime("%-d %b, %-I:%M %p")
    return Email(
        to=to,
        to_name=name,
        subject=f"{subject}: {iv['company']} – {iv['round']}, {when}",
        text=text,
        html=html,
        attachments=[("interview.ics", "text/calendar", interview_ics(iv, cancelled=kind == "cancel"))],
    )


async def _notify(db, mailer, iv: dict[str, Any], kind: str, only: set[str] | None = None) -> int:
    uids = [s["user_id"] for s in iv["students"] if only is None or s["user_id"] in only]
    sent = 0
    async for u in db[USERS].find({"_id": {"$in": uids}, "email_bounced": {"$ne": True}}, {"email": 1, "name": 1}):
        if await send_safely(mailer, _email(iv, u["email"], u.get("name", ""), kind)):
            sent += 1
    return sent


def _student_out(iv: dict[str, Any], s: dict[str, Any], names: dict[str, str], inv_id: str | None) -> dict[str, Any]:
    return {
        "id": _cid(inv_id, s["membership_id"]) if inv_id else s["membership_id"],
        "name": names.get(s["membership_id"]) or "A student who stopped sharing",
        "status": s["status"],
        "statusName": STATUS[s["status"]],
        "reason": s.get("reason") or "",
        "at": ms(s.get("at")),
    }


def round_out(iv: dict[str, Any], names: dict[str, str], inv_id: str | None = None) -> dict[str, Any]:
    st = [s["status"] for s in iv["students"]]
    return {
        "id": iv["_id"],
        "company": iv["company"],
        "round": iv["round"],
        "startsAt": ms(iv["starts_at"]),
        "when": ist(iv["starts_at"]),
        "date": iv["starts_at"].astimezone(IST).date().isoformat(),
        "time": iv["starts_at"].astimezone(IST).strftime("%H:%M"),
        "minutes": iv["minutes"],
        "place": iv["place"],
        "link": iv["link"],
        "interviewer": iv["interviewer"],
        "notes": iv["notes"],
        "cancelled": bool(iv.get("cancelled_at")),
        "counts": {k: st.count(k) for k in STATUS},
        "students": [_student_out(iv, s, names, inv_id) for s in iv["students"]],
    }


# ---------- recruiter ----------
async def _inv(db, token: str, request: Request, session: str | None) -> dict[str, Any]:
    inv = await _signed_in(db, token, request, session)
    if not features_of(inv["_org"])["interview_scheduling"]:
        raise ApiError(402, "plan_feature", "Interview scheduling is in the Campus plan.")
    return inv


async def _visible_names(db, inv: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    rows = {r["membership_id"]: r for r in await visible(db, inv)}
    return rows, {m: r["name"] for m, r in rows.items()}


async def _round(db, inv: dict[str, Any], iid: str) -> dict[str, Any]:
    iv = await db[INTERVIEWS].find_one({"_id": iid, "invite_id": inv["_id"]})
    if not iv:
        raise NOT_FOUND
    return iv


@portal.get("")
async def list_rounds(
    token: str, request: Request, response: Response, db: DB, x_recruiter_session: str | None = Header(None)
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    inv = await _inv(db, token, request, x_recruiter_session)
    _, names = await _visible_names(db, inv)
    rounds = await db[INTERVIEWS].find({"invite_id": inv["_id"]}).sort("starts_at", 1).to_list(200)
    return {"rounds": [round_out(iv, names, inv["_id"]) for iv in rounds]}


@portal.post("", status_code=201)
async def schedule(
    token: str,
    body: NewIn,
    request: Request,
    response: Response,
    db: DB,
    mailer: MailerDep,
    x_recruiter_session: str | None = Header(None),
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    inv = await _inv(db, token, request, x_recruiter_session)
    key = f"interview-make:{inv['_id']}"
    await rate_limit.check(db, key, CREATE_RULES, "Too many changes. Please try again later.")
    start = _start(body)
    rows, names = await _visible_names(db, inv)
    by_cid = {_cid(inv["_id"], m): r for m, r in rows.items()}
    board = inv.get("board") or {}
    picked = []
    for cid in dict.fromkeys(body.ids):
        r = by_cid.get(cid)
        if not r:
            raise NOT_FOUND
        if (board.get(r["membership_id"]) or {}).get("stage") not in STAGES[:3]:
            raise ApiError(400, "not_shortlisted", f"Shortlist {r['name']} first, then schedule the interview.")
        picked.append(r)
    await rate_limit.record(db, key)
    t = now()
    iv = {
        "_id": new_id(),
        "org_id": inv["org_id"],
        "invite_id": inv["_id"],
        "company": inv["company"],
        "recruiter_email": inv["email"],
        "group_ids": sorted({r["group_id"] for r in picked}),
        **body.model_dump(exclude={"ids", "date", "time"}),
        "starts_at": start,
        "seq": 0,
        "students": [
            {
                "membership_id": r["membership_id"],
                "user_id": r["user_id"],
                "group_id": r["group_id"],
                "status": "pending",
                "reason": "",
                "at": None,
                "reminded_seq": None,
            }
            for r in picked
        ],  # fmt: skip
        "demo": bool(inv.get("demo")),
        "created_at": t,
        "updated_at": t,
        "cancelled_at": None,
    }
    await db[INTERVIEWS].insert_one(iv)
    for r in picked:  # shortlisted → interview on the board
        if (board.get(r["membership_id"]) or {}).get("stage") == "shortlisted":
            await _to_interview(db, inv, r["membership_id"])
    sent = await _notify(db, mailer, iv, "new")
    await audit(
        db, None, "recruiter_interview", target=inv["_id"], data=_audit(inv, count=len(picked), round=body.round)
    )
    return {**round_out(iv, names, inv["_id"]), "emailsSent": sent}


async def _to_interview(db, inv: dict[str, Any], mid: str) -> None:
    await db[RECRUITER_INVITES].update_one(
        {"_id": inv["_id"], f"board.{mid}.stage": "shortlisted"},
        {"$set": {f"board.{mid}.stage": "interview", f"board.{mid}.at": now()}},
    )


@portal.put("/{iid}")
async def reschedule(
    token: str,
    iid: str,
    body: RoundIn,
    request: Request,
    response: Response,
    db: DB,
    mailer: MailerDep,
    x_recruiter_session: str | None = Header(None),
) -> dict[str, Any]:
    """A new time or place: the same calendar event with a higher sequence, and every student is asked again."""
    response.headers.update(NO_STORE)
    inv = await _inv(db, token, request, x_recruiter_session)
    iv = await _round(db, inv, iid)
    if iv.get("cancelled_at"):
        raise ApiError(400, "cancelled", "This interview was cancelled. Schedule a new one.")
    key = f"interview-make:{inv['_id']}"
    await rate_limit.check(db, key, CREATE_RULES, "Too many changes. Please try again later.")
    await rate_limit.record(db, key)
    start = _start(body)
    for s in iv["students"]:
        s.update(status="pending", reason="", at=None, reminded_seq=None)
    sets = {**body.model_dump(exclude={"date", "time"}), "starts_at": start, "seq": iv["seq"] + 1,
            "students": iv["students"], "updated_at": now()}  # fmt: skip
    await db[INTERVIEWS].update_one({"_id": iid}, {"$set": sets})
    iv.update(sets)
    sent = await _notify(db, mailer, iv, "update")
    await audit(db, None, "recruiter_interview_change", target=inv["_id"], data=_audit(inv, round=iv["round"]))
    _, names = await _visible_names(db, inv)
    return {**round_out(iv, names, inv["_id"]), "emailsSent": sent}


@portal.post("/{iid}/cancel")
async def cancel(
    token: str,
    iid: str,
    request: Request,
    response: Response,
    db: DB,
    mailer: MailerDep,
    x_recruiter_session: str | None = Header(None),
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    inv = await _inv(db, token, request, x_recruiter_session)
    iv = await _round(db, inv, iid)
    if not iv.get("cancelled_at"):
        iv["cancelled_at"] = now()
        iv["seq"] += 1
        await db[INTERVIEWS].update_one({"_id": iid}, {"$set": {"cancelled_at": iv["cancelled_at"], "seq": iv["seq"]}})
        await _notify(db, mailer, iv, "cancel")
        await audit(db, None, "recruiter_interview_cancel", target=inv["_id"], data=_audit(inv, round=iv["round"]))
    _, names = await _visible_names(db, inv)
    return round_out(iv, names, inv["_id"])


# ---------- student ----------
def reminders_on(user: dict[str, Any]) -> bool:
    return ((user.get("notify") or {}).get("email") or {}).get("interviews", True) is not False


def unsub_token(user_id: str) -> str:
    return f"{user_id}.{keyed_hash('interview-unsub', user_id)[:32]}"


def _mine_out(iv: dict[str, Any], s: dict[str, Any], org_names: dict[str, str]) -> dict[str, Any]:
    return {
        "id": iv["_id"],
        "orgName": org_names.get(iv["org_id"], ""),
        "company": iv["company"],
        "round": iv["round"],
        "startsAt": ms(iv["starts_at"]),
        "when": ist(iv["starts_at"]),
        "minutes": iv["minutes"],
        "place": iv["place"],
        "link": iv["link"],
        "interviewer": iv["interviewer"],
        "notes": iv["notes"],
        "cancelled": bool(iv.get("cancelled_at")),
        "status": s["status"],
        "statusName": STATUS[s["status"]],
        "reason": s.get("reason") or "",
    }


async def _mine(db, user_id: str, iid: str) -> tuple[dict[str, Any], dict[str, Any]]:
    iv = await db[INTERVIEWS].find_one({"_id": iid, "students.user_id": user_id})
    if not iv:
        raise NOT_FOUND
    return iv, next(s for s in iv["students"] if s["user_id"] == user_id)


@me.get("")
async def my_interviews(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    since = now() - timedelta(days=7)
    rounds = await (
        db[INTERVIEWS].find({"students.user_id": auth.user.id, "starts_at": {"$gte": since}}).sort("starts_at", 1)
    ).to_list(100)
    org_names = {
        o["_id"]: o["name"]
        async for o in db[ORGANIZATIONS].find({"_id": {"$in": list({i["org_id"] for i in rounds})}}, {"name": 1})
    }
    u = await db[USERS].find_one({"_id": auth.user.id}, {"notify": 1}) or {}
    out = [_mine_out(iv, next(s for s in iv["students"] if s["user_id"] == auth.user.id), org_names) for iv in rounds]
    return {"interviews": out, "reminders": reminders_on(u)}


async def _answer(db, mailer, auth, iid: str, status: Literal["confirmed", "reschedule"], reason: str = ""):
    key = f"interview-ask:{auth.user.id}"
    await rate_limit.check(db, key, ASK_RULES, "Too many answers. Please try again later.")
    await rate_limit.record(db, key)
    iv, s = await _mine(db, auth.user.id, iid)
    if iv.get("cancelled_at"):
        raise ApiError(400, "cancelled", "This interview was cancelled.")
    if iv["starts_at"] < now():
        raise ApiError(400, "past", "This interview has already happened.")
    t = now()
    await db[INTERVIEWS].update_one(
        {"_id": iid, "students.user_id": auth.user.id},
        {"$set": {"students.$.status": status, "students.$.reason": reason, "students.$.at": t}},
    )
    s.update(status=status, reason=reason, at=t)
    await audit(
        db, auth.user.id, f"interview_{status}", target=iid,
        data={"orgs": [iv["org_id"]], "invite": iv["invite_id"]},
    )  # fmt: skip
    if status == "reschedule" and mailer is not None:  # tell the recruiter, so they can pick a new time
        u = await db[USERS].find_one({"_id": auth.user.id}, {"name": 1}) or {}
        text = (
            f"{u.get('name') or 'A student'} asked for another time for {iv['company']} – {iv['round']} "
            f"({ist(iv['starts_at'])}).\n\nReason: {reason}\n\nChange the time in your recruiter portal: Interviews."
            "\n\nNm7 · nm7.si"
        )
        html = f'<div style="{STYLE}">' + "".join(f"<p>{escape(p)}</p>" for p in text.split("\n\n")) + "</div>"
        await send_safely(mailer, Email(iv["recruiter_email"], "", f"Another time asked: {iv['round']}", text, html))
    orgs = {o["_id"]: o["name"] async for o in db[ORGANIZATIONS].find({"_id": iv["org_id"]}, {"name": 1})}
    return _mine_out(iv, s, orgs)


@me.post("/{iid}/confirm")
async def confirm(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return await _answer(db, None, auth, iid, "confirmed")


@me.post("/{iid}/reschedule")
async def ask_another_time(iid: str, body: AskIn, auth: CustomerAuth, db: DB, mailer: MailerDep) -> dict[str, Any]:
    return await _answer(db, mailer, auth, iid, "reschedule", " ".join(body.reason.split()))


@me.get("/{iid}/ics")
async def my_ics(iid: str, auth: CustomerAuth, db: DB) -> Response:
    iv, _ = await _mine(db, auth.user.id, iid)
    return Response(
        interview_ics(iv, cancelled=bool(iv.get("cancelled_at"))),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="interview.ics"', "Cache-Control": "no-store"},
    )


@me.put("/reminders")
async def set_reminders(body: OnIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await db[USERS].update_one({"_id": auth.user.id}, {"$set": {"notify.email.interviews": body.on}})
    return {"reminders": body.on}


@public.post("/stop-reminders")
async def stop_reminders(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    key = f"interview-unsub:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, UNSUB_RULES)
    await rate_limit.record(db, key)
    uid, _, sig = body.token.partition(".")
    if not (uid and sig and same(sig, keyed_hash("interview-unsub", uid)[:32])):
        raise ApiError(404, "invalid_link", "This link doesn’t work. You can turn reminders off on My drive day.")
    await db[USERS].update_one({"_id": uid}, {"$set": {"notify.email.interviews": False}})
    return {"ok": True}


# ---------- coordinators ----------
@staff.get("")
async def college_rounds(db: DB, scope: OrgScope) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    require_feature(o, "recruiter_links")
    q: dict[str, Any] = {"org_id": scope.org_id, "starts_at": {"$gte": now() - timedelta(days=30)}}
    rounds = await db[INTERVIEWS].find(q).sort("starts_at", 1).to_list(300)
    if scope.group_ids is not None:  # a coordinator of some groups sees only their students
        allowed = set(scope.group_ids)
        for iv in rounds:
            iv["students"] = [s for s in iv["students"] if s["group_id"] in allowed]
        rounds = [iv for iv in rounds if iv["students"]]
    mids = [s["membership_id"] for iv in rounds for s in iv["students"]]
    members = {m["_id"]: m["user_id"] async for m in db[MEMBERSHIPS].find({"_id": {"$in": mids}}, {"user_id": 1})}
    users = {u["_id"]: u.get("name") or "" async for u in db[USERS].find({"_id": {"$in": list(members.values())}})}
    names = {m: users.get(uid, "") for m, uid in members.items()}
    return {"rounds": [round_out(iv, names) for iv in rounds], "on": features_of(o)["interview_scheduling"]}


# ---------- the day-before reminder ----------
async def send_reminders(db: AsyncDatabase, mailer: Mailer) -> int:
    """Runs in the automation pass: from 9:00 IST the day before, one reminder per student per time (a new time
    reminds again), not to someone who asked for another time, a bounced address or reminders turned off."""
    t = now()
    local = t.astimezone(IST)
    if local.time() < REMIND_FROM:
        return 0
    tomorrow = local.date() + timedelta(days=1)
    lo = datetime.combine(tomorrow, time(0, 0), IST)
    sent = 0
    q = {"cancelled_at": None, "starts_at": {"$gte": lo, "$lt": lo + timedelta(days=1)}}
    fields = {"email": 1, "name": 1, "notify": 1, "email_bounced": 1}
    async for iv in db[INTERVIEWS].find(q):
        for s in iv["students"]:
            if s["status"] == "reschedule" or s.get("reminded_seq") == iv["seq"]:
                continue
            u = await db[USERS].find_one({"_id": s["user_id"]}, fields)
            ok = False
            if u and not u.get("email_bounced") and reminders_on(u):
                stop = f"{get_settings().site_url}/stop-alerts#k=interviews&t={unsub_token(u['_id'])}"
                ok = await send_safely(mailer, _email(iv, u["email"], u.get("name", ""), "remind", stop))
            await db[INTERVIEWS].update_one(
                {"_id": iv["_id"], "students.user_id": s["user_id"]},
                {"$set": {"students.$.reminded_seq": iv["seq"]}},
            )
            sent += int(ok)
    return sent
