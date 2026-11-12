"""H6 Instant offer (Phase 5): an offer from a template, answered online, with a PDF, joining check-ins and "Joined".

Company (header X-Recruiter-Account; main / full / posting admins):
  POST /api/company/{cid}/hire/offers {job, person, title, salary {amount, unit}, joinDate, place, notes, respondDays}
                                     only for a person at Shortlisted / Interview (they accepted the invite or were
                                     shortlisted, so their contact details are already shared)
  GET  /api/company/{cid}/hire/offers?job=
  GET  /api/company/{cid}/hire/offers/{id}/pdf
  POST /api/company/{cid}/hire/offers/{id}/joined {joined, reason}     the company's side of "Joined" / dropped out
  POST /api/company/{cid}/hire/offers/{id}/withdraw {reason}           before an answer
Candidate (signed in):
  GET  /api/me/hire/offers
  POST /api/me/hire/offers/{id}/answer {answer: accept|decline, typedName, agree, reason}
  POST /api/me/hire/offers/{id}/joining {joining, reason}   the check-ins 7 days and 1 day before: still joining?
  POST /api/me/hire/offers/{id}/joined {joined, reason}     the candidate's side of "Joined"
  GET  /api/me/hire/offers/{id}/pdf

Accepting needs the candidate to type their name (as on their account) and tick the box; we keep the typed name, the
tick and the time. It is a record of the answer, not a legal e-signature, and the page and PDF say so. Joining
check-ins go by email 7 days and 1 day before the join date (the automation pass, once each). "Joined" is final once
either side says so and the other doesn't disagree; a drop-out needs a reason. Joined / dropped feed reliability (H4).
The application moves to Offer; accepting adds the offer to each college the candidate belongs to (offer tracking and
placement stats), joining marks it Joined there.
"""

from datetime import date, datetime, timedelta
from html import escape
from io import BytesIO
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header, Query, Response
from fpdf import FPDF, XPos, YPos
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.billing.pdf import _font_paths
from app.companies.model import POST
from app.companies.signup import company_for
from app.core.config import get_settings
from app.core.db import APPLICATIONS, DB, HIRE_OFFERS, JOBS, MEMBERSHIPS, OFFERS, USERS
from app.core.email import Email, Mailer, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.hire import reliability
from app.jobs.apply import app_key, status_change
from app.me.service import ms

company = APIRouter(prefix="/api/company", tags=["hire in 30 minutes"])
me = APIRouter(prefix="/api/me/hire/offers", tags=["hire in 30 minutes"])

STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"
NOT_ESIGN = ("This is a record of your answer on Nm7 (your typed name, the box you ticked and the time). It is not a "
             "legal e-signature; the company may send its own appointment letter.")  # fmt: skip
TEMPLATE = (
    "Dear {name},\n\n{company} is happy to offer you the role of {title}{place}. Your salary will be {salary}. "
    "We would like you to join on {join}.\n\n{notes}Please accept or decline this offer on Nm7 by {by}.\n\n"
    "Regards,\n{by_name}\n{company}"
)


class SalaryIn(CamelModel):
    amount: float = Field(gt=0, le=10_000_000)
    unit: Literal["month", "lpa"] = "month"


class OfferIn(CamelModel):
    job: str = Field(min_length=1, max_length=40)
    person: str = Field(min_length=1, max_length=64)
    title: str = Field("", max_length=120)  # the job title if empty
    salary: SalaryIn
    join_date: str = Field(min_length=10, max_length=10)
    place: str = Field("", max_length=120)
    notes: str = Field("", max_length=1000)
    respond_days: int = Field(3, ge=1, le=14)

    @field_validator("join_date")
    @classmethod
    def _date(cls, v: str) -> str:
        d = date.fromisoformat(v)
        if d < date.today() or d > date.today() + timedelta(days=365):
            raise ValueError("Pick a join date from today up to a year ahead.")
        return v


def salary_text(s: dict[str, Any]) -> str:
    if s["unit"] == "lpa":
        return f"₹{s['amount']:g} lakh a year"
    return f"₹{inr(int(s['amount']))} a month"


def inr(n: int) -> str:
    """Indian digit grouping: 125000 → 1,25,000."""
    s = str(n)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    return ",".join([head, *parts, tail]) if head else ",".join([*parts, tail])


def letter(o: dict[str, Any]) -> str:
    return TEMPLATE.format(
        name=o["candidate_name"] or "Candidate", company=o["company_name"], title=o["title"],
        place=f" at {o['place']}" if o.get("place") else "", salary=salary_text(o["salary"]),
        join=date.fromisoformat(o["join_date"]).strftime("%-d %B %Y"),
        notes=f"{o['notes']}\n\n" if o.get("notes") else "", by=o["respond_by"].astimezone(IST).strftime("%-d %B %Y"),
        by_name=o.get("by_name") or "The hiring team",
    )  # fmt: skip


def state(o: dict[str, Any], t: datetime | None = None) -> str:
    st = o["status"]
    if st == "sent" and o["respond_by"] < (t or now()):
        return "expired"
    return st


def offer_out(o: dict[str, Any], t: datetime | None = None) -> dict[str, Any]:
    return {
        "id": str(o["_id"]), "jobId": o["job_id"], "company": o["company_name"], "title": o["title"],
        "salary": o["salary"], "salaryText": salary_text(o["salary"]), "joinDate": o["join_date"],
        "place": o.get("place", ""), "letter": letter(o), "status": state(o, t), "respondBy": ms(o["respond_by"]),
        "answeredAt": ms(o.get("answered_at")), "typedName": o.get("typed_name", ""),
        "declineReason": o.get("decline_reason", ""), "joined": o.get("joined") or {},
        "dropReason": o.get("drop_reason", ""),
        "candidate": o["candidate_name"], "createdAt": ms(o["created_at"]), "notESign": NOT_ESIGN,
    }  # fmt: skip


def pdf(o: dict[str, Any]) -> bytes:
    p = _font_paths()
    doc = FPDF(orientation="P", unit="mm", format="A4")
    doc.add_font("main", "", p["main"])
    doc.add_font("main", "B", p["bold"])
    doc.set_margins(18, 18, 18)
    doc.add_page()
    doc.set_font("main", "B", 15)
    doc.multi_cell(0, 8, f"Offer: {o['title']}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    doc.set_font("main", "", 10)
    doc.multi_cell(0, 5, o["company_name"], new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    doc.ln(4)
    doc.set_font("main", "", 11)
    doc.multi_cell(0, 6, letter(o), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    doc.ln(4)
    st = state(o)
    if st in ("accepted", "joined", "dropped"):
        when = o["answered_at"].astimezone(IST).strftime("%-d %b %Y, %-I:%M %p IST")
        doc.set_font("main", "B", 11)
        doc.multi_cell(0, 6, f"Accepted by {o.get('typed_name', '')} on {when}.", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    elif st == "declined":
        doc.multi_cell(0, 6, "Declined by the candidate.", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    doc.ln(3)
    doc.set_font("main", "", 8)
    doc.multi_cell(0, 4, NOT_ESIGN, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    out = BytesIO()
    doc.output(out)
    return out.getvalue()


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That offer isn’t here.") from None


def _pdf_response(o: dict[str, Any]) -> Response:
    return Response(pdf(o), media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="offer.pdf"'})  # fmt: skip


def offer_email(o: dict[str, Any], to: str, kind: str, reason: str = "") -> Email:
    """kind: sent / accepted / declined / checkin7 / checkin1 / withdrawn (to the candidate or the company)."""
    site = get_settings().site_url.rstrip("/")
    link = f"{site}/me/hire#offers"
    first = (o["candidate_name"] or "").split(" ")[0] or "there"
    join = date.fromisoformat(o["join_date"]).strftime("%-d %b")
    subject, body = {
        "sent": (f"Offer from {o['company_name']}: {o['title']}", f"{o['company_name']} sent you an offer. Read it "
                 f"and accept or decline here: {link}"),
        "accepted": (f"{o['candidate_name']} accepted your offer", f"{o['candidate_name']} accepted the {o['title']} "
                     f"offer and plans to join on {join}."),
        "declined": (f"{o['candidate_name']} declined your offer", f"{o['candidate_name']} declined the {o['title']} "
                     f"offer.{f' Reason: {reason}' if reason else ''}"),
        "checkin7": (f"Joining {o['company_name']} on {join}?", f"Your joining day at {o['company_name']} is in a week."
                     " "
                     f"Still joining? Tell us in one tap: {link}"),
        "checkin1": (f"Tomorrow: joining {o['company_name']}", f"You join {o['company_name']} tomorrow ({join}). Still "
                     f"joining? Tell us in one tap: {link}"),
        "withdrawn": (f"Offer withdrawn: {o['title']}",
                      f"{o['company_name']} withdrew the offer.{f' Reason: {reason}' if reason else ''}"),
    }[kind]  # fmt: skip
    hi = f"Hi {first}," if kind in ("sent", "checkin7", "checkin1", "withdrawn") else "Hi,"
    text = "\n".join([hi, "", body, "", "Nm7 · nm7.si"])
    html = f'<div style="{STYLE}"><p>{escape(hi)}</p><p>{escape(body)}</p></div>'
    return Email(to=to, to_name="", subject=subject, text=text, html=html)


async def _candidate_mail(db, mailer: Mailer, o: dict[str, Any], kind: str, reason: str = "") -> int:
    u = await db[USERS].find_one({"_id": o["user_id"]}, {"email": 1, "email_bounced": 1, "demo": 1})
    if not u or u.get("email_bounced") or u.get("demo"):
        return 0
    return await send_safely(mailer, offer_email(o, u["email"], kind, reason))


async def _college(db, o: dict[str, Any], status: str) -> None:
    """Offer tracking for each college the candidate belongs to (placement stats)."""
    t = now()
    lpa = o["salary"]["amount"] if o["salary"]["unit"] == "lpa" else round(o["salary"]["amount"] * 12 / 100000, 2)
    async for m in db[MEMBERSHIPS].find({"user_id": o["user_id"], "approval": "approved"}):
        await db[OFFERS].update_one(
            {"_id": f"hire-{o['_id']}-{m['_id']}"},
            {"$set": {"status": status, "updated_at": t},
             "$setOnInsert": {"org_id": m["org_id"], "membership_id": m["_id"], "user_id": o["user_id"],
                              "group_id": m.get("group_id"), "company": o["company_name"][:80], "role": o["title"][:80],
                              "ctc_lpa": lpa,
                              "type": "internship" if o.get("job_type") == "internship" else "full_time",
                              "offer_date": o["created_at"].astimezone(IST).date().isoformat(), "source": "hire",
                              "created_by": "hire", "created_at": t}},
            upsert=True,
        )  # fmt: skip


# --- company ------------------------------------------------------------------------------------------------------


@company.post("/{cid}/hire/offers", status_code=201)
async def send_offer(
    cid: str, body: OfferIn, db: DB, mailer: MailerDep, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, c, m = await company_for(db, cid, x_recruiter_account, POST)
    j = await db[JOBS].find_one({"_id": body.job, "company_id": cid})
    if not j:
        raise ApiError(404, "not_found", "That job isn’t one of yours.")
    a = await db[APPLICATIONS].find_one(
        {"user_id": body.person, "key": app_key(j["_id"]), "company_id": cid, "company_removed_at": None}
    )
    if not a or a.get("status") not in ("shortlisted", "interview", "offer"):
        raise ApiError(409, "not_ready", "Send an offer to someone who accepted your invite or is shortlisted.")
    if await db[HIRE_OFFERS].find_one({"company_id": cid, "job_id": j["_id"], "user_id": body.person,
                                       "status": {"$in": ["sent", "accepted", "joined"]}}):  # fmt: skip
        raise ApiError(409, "already", "This person already has an offer for this job.")
    u = await db[USERS].find_one({"_id": body.person}, {"name": 1})
    t = now()
    o = {
        "_id": ObjectId(), "company_id": cid, "job_id": j["_id"], "user_id": body.person,
        "company_name": c["details"]["legal_name"], "title": body.title.strip() or j["title"],
        "candidate_name": (u or {}).get("name", ""), "salary": body.salary.model_dump(), "join_date": body.join_date,
        "place": body.place.strip(), "notes": body.notes.strip(), "job_type": j.get("job_type", "full_time"),
        "respond_by": t + timedelta(days=body.respond_days), "status": "sent", "by": acc["email_lc"],
        "by_name": m.get("name", ""), "created_at": t, "updated_at": t,
    }  # fmt: skip
    await db[HIRE_OFFERS].insert_one(o)
    change = status_change(a, "offer", t)
    if change:
        await db[APPLICATIONS].update_one({"_id": a["_id"]}, change)
    await _candidate_mail(db, mailer, o, "sent")
    await audit(
        db, None, "hire.offer", target=cid, data={"by": acc["email_lc"], "job": j["_id"], "offer": str(o["_id"])}
    )
    return offer_out(o, t)


@company.get("/{cid}/hire/offers")
async def company_offers(
    cid: str, db: DB, job: str = Query("", max_length=40), x_recruiter_account: str | None = Header(None)
) -> list[dict[str, Any]]:
    await company_for(db, cid, x_recruiter_account)
    q: dict[str, Any] = {"company_id": cid} | ({"job_id": job} if job else {})
    t = now()
    return [offer_out(o, t) | {"person": o["user_id"]} async for o in db[HIRE_OFFERS].find(q).sort("created_at", -1)]


async def _company_offer(db, cid: str, oid: str, session: str | None, roles=None) -> tuple[dict, dict[str, Any]]:
    acc, _, _ = await company_for(db, cid, session, roles)
    o = await db[HIRE_OFFERS].find_one({"_id": _oid(oid), "company_id": cid})
    if not o:
        raise ApiError(404, "not_found", "That offer isn’t here.")
    return acc, o


@company.get("/{cid}/hire/offers/{oid}/pdf")
async def company_pdf(cid: str, oid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> Response:
    _, o = await _company_offer(db, cid, oid, x_recruiter_account)
    return _pdf_response(o)


class JoinedIn(CamelModel):
    joined: bool
    reason: str = Field("", max_length=300)


async def _joined(db, o: dict[str, Any], side: str, body: JoinedIn) -> dict[str, Any]:
    if state(o) not in ("accepted", "joined", "dropped"):
        raise ApiError(409, "not_accepted", "Only an accepted offer can be marked Joined.")
    if date.fromisoformat(o["join_date"]) > now().astimezone(IST).date():
        raise ApiError(409, "not_yet", "Mark it on or after the join date.")
    if not body.joined and len(body.reason.strip()) < 3:
        raise ApiError(400, "reason", "Say why they didn’t join.")
    t = now()
    joined = {**(o.get("joined") or {}), side: body.joined}
    other = joined.get("candidate" if side == "company" else "company")
    status = "joined" if body.joined and other is not False else "dropped" if not body.joined else o["status"]
    sets: dict[str, Any] = {"joined": joined, "status": status, "updated_at": t}
    if not body.joined:
        sets["drop_reason"] = body.reason.strip()
    await db[HIRE_OFFERS].update_one({"_id": o["_id"]}, {"$set": sets})
    ref = str(o["_id"])
    await reliability.forget(db, o["user_id"], "joined", ref)
    await reliability.forget(db, o["user_id"], "dropped", ref)
    if status in ("joined", "dropped"):
        await reliability.record(db, o["user_id"], status, o["company_id"], ref)
    await _college(db, o, "joined" if status == "joined" else "declined" if status == "dropped" else "accepted")
    return offer_out({**o, **sets}, t)


@company.post("/{cid}/hire/offers/{oid}/joined")
async def company_joined(
    cid: str, oid: str, body: JoinedIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict:
    acc, o = await _company_offer(db, cid, oid, x_recruiter_account, POST)
    out = await _joined(db, o, "company", body)
    await audit(
        db, None, "hire.offer_joined", target=cid, data={"by": acc["email_lc"], "offer": oid, "joined": body.joined}
    )
    return out


class ReasonIn(CamelModel):
    reason: str = Field("", max_length=300)


@company.post("/{cid}/hire/offers/{oid}/withdraw")
async def withdraw(
    cid: str, oid: str, body: ReasonIn, db: DB, mailer: MailerDep, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, o = await _company_offer(db, cid, oid, x_recruiter_account, POST)
    if state(o) != "sent":
        raise ApiError(409, "answered", "Only an offer waiting for an answer can be withdrawn.")
    if len(body.reason.strip()) < 3:
        raise ApiError(400, "reason", "Say why, so the candidate knows.")
    sets = {"status": "withdrawn", "withdraw_reason": body.reason.strip(), "updated_at": now()}
    await db[HIRE_OFFERS].update_one({"_id": o["_id"]}, {"$set": sets})
    await _candidate_mail(db, mailer, o, "withdrawn", body.reason.strip())
    await audit(db, None, "hire.offer_withdraw", target=cid, data={"by": acc["email_lc"], "offer": oid})
    return offer_out({**o, **sets})


# --- candidate ----------------------------------------------------------------------------------------------------


@me.get("")
async def my_offers(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    t = now()
    q = {"user_id": auth.user.id, "status": {"$ne": "withdrawn"}}
    return [offer_out(o, t) async for o in db[HIRE_OFFERS].find(q).sort("created_at", -1)]


class AnswerIn(CamelModel):
    answer: Literal["accept", "decline"]
    typed_name: str = Field("", max_length=120)
    agree: bool = False
    reason: str = Field("", max_length=300)


def same_name(a: str, b: str) -> bool:
    norm = lambda s: " ".join(str(s).lower().replace(".", " ").split())  # noqa: E731
    return bool(norm(a)) and norm(a) == norm(b)


async def _mine(db, uid: str, oid: str) -> dict[str, Any]:
    o = await db[HIRE_OFFERS].find_one({"_id": _oid(oid), "user_id": uid, "status": {"$ne": "withdrawn"}})
    if not o:
        raise ApiError(404, "not_found", "That offer isn’t here.")
    return o


@me.post("/{oid}/answer")
async def answer(oid: str, body: AnswerIn, auth: CustomerAuth, db: DB, mailer: MailerDep) -> dict[str, Any]:
    uid = auth.user.id
    o = await _mine(db, uid, oid)
    t = now()
    st = state(o, t)
    if st != "sent":
        raise ApiError(
            409, "answered", "This offer has expired." if st == "expired" else "You answered this offer already."
        )
    sets: dict[str, Any] = {"answered_at": t, "updated_at": t}
    if body.answer == "accept":
        if not body.agree:
            raise ApiError(400, "agree", "Tick the box to accept the offer.")
        name = (await db[USERS].find_one({"_id": uid}, {"name": 1}) or {}).get("name", "")
        if not same_name(body.typed_name, name):
            raise ApiError(400, "typed_name", f"Type your name as it is on your account: {name}.")
        sets |= {"status": "accepted", "typed_name": " ".join(body.typed_name.split()), "agreed": True}
    else:
        sets |= {"status": "declined", "decline_reason": body.reason.strip()}
    done = await db[HIRE_OFFERS].update_one({"_id": o["_id"], "status": "sent"}, {"$set": sets})
    if not done.modified_count:
        raise ApiError(409, "answered", "You answered this offer already.")
    o |= sets
    if body.answer == "accept":
        await _college(db, o, "accepted")
    if o.get("by"):
        await send_safely(mailer, offer_email(o, o["by"], "accepted" if body.answer == "accept" else "declined",
                                              body.reason.strip()))  # fmt: skip
    await audit(db, uid, f"hire.offer_{sets['status']}", target=o["company_id"], data={"offer": oid})
    return offer_out(o, t)


class JoiningIn(CamelModel):
    joining: bool
    reason: str = Field("", max_length=300)


@me.post("/{oid}/joining")
async def joining(oid: str, body: JoiningIn, auth: CustomerAuth, db: DB, mailer: MailerDep) -> dict[str, Any]:
    """The check-in: still joining? "No" (with a reason) is a drop-out the company is told about."""
    o = await _mine(db, auth.user.id, oid)
    if state(o) != "accepted":
        raise ApiError(409, "not_accepted", "Only an accepted offer has a joining check-in.")
    t = now()
    if body.joining:
        await db[HIRE_OFFERS].update_one({"_id": o["_id"]}, {"$set": {"still_joining_at": t, "updated_at": t}})
        return offer_out({**o, "still_joining_at": t}, t)
    if len(body.reason.strip()) < 3:
        raise ApiError(400, "reason", "Say why, so the company knows.")
    sets = {"status": "dropped", "drop_reason": body.reason.strip(), "joined": {"candidate": False}, "updated_at": t}
    await db[HIRE_OFFERS].update_one({"_id": o["_id"]}, {"$set": sets})
    await reliability.record(db, o["user_id"], "dropped", o["company_id"], str(o["_id"]))
    await _college(db, o, "declined")
    if o.get("by"):
        await send_safely(mailer, offer_email({**o, **sets}, o["by"], "declined", body.reason.strip()))
    return offer_out({**o, **sets}, t)


@me.post("/{oid}/joined")
async def candidate_joined(oid: str, body: JoinedIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return await _joined(db, await _mine(db, auth.user.id, oid), "candidate", body)


@me.get("/{oid}/pdf")
async def my_pdf(oid: str, auth: CustomerAuth, db: DB) -> Response:
    return _pdf_response(await _mine(db, auth.user.id, oid))


# --- joining check-ins (the automation pass) ----------------------------------------------------------------------


async def send_checkins(db, mailer: Mailer, t: datetime | None = None) -> int:
    """Accepted offers: one email 7 days and one 1 day before the join date (India date), once each."""
    t = t or now()
    today = t.astimezone(IST).date()
    sent = 0
    for days, flag, kind in ((7, "checkin7", "checkin7"), (1, "checkin1", "checkin1")):
        day = (today + timedelta(days=days)).isoformat()
        async for o in db[HIRE_OFFERS].find({"status": "accepted", "join_date": day, flag: {"$ne": True}}).limit(500):
            got = await db[HIRE_OFFERS].update_one({"_id": o["_id"], flag: {"$ne": True}}, {"$set": {flag: True}})
            if got.modified_count:
                sent += await _candidate_mail(db, mailer, o, kind)
    return sent
