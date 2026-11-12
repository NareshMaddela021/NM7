"""H1 "Ready to join" (Phase 5): a candidate says they can start now, and how.

  GET    /api/me/hire                    the candidate's own "Ready to join" (or the empty form)
  PUT    /api/me/hire                    {on, consent, joinDate, cities, remote, salary {amount, unit}, noticeDays,
                                         jobTypes}: saving counts as confirming
  POST   /api/me/hire/confirm            "Still ready": one tap, the 7 days start again
  POST   /api/me/hire/pause {paused}     pause (or resume) without losing anything
  DELETE /api/me/hire                    remove it altogether
  PUT    /api/me/hire/emails {on}         the "Still ready" reminder email on / off
  POST   /api/public/hire/still-ready {token}   the email's one-tap "Still ready" link (no sign-in)

Available = on, with consent ("Companies hiring now can see my profile and invite me"), not paused, and confirmed
within the last `confirm_days` (Admin → Settings, 7). Older than that it is stale: not available, and nobody sees it
until the candidate taps "Still ready". A day before it goes stale the candidate gets one email (and the card says
so in the app); never a second one for the same week, never to a bounced address or someone who turned these
emails off. The candidate's phone and email are never shown to a company until the candidate accepts an invite (H2).
"""

from datetime import date, timedelta
from html import escape
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, HIRE_PROFILES, USERS
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import now
from app.site import get_site

router = APIRouter(prefix="/api/me/hire", tags=["hire in 30 minutes"])
public = APIRouter(prefix="/api/public/hire", tags=["hire in 30 minutes"])

JOB_TYPES = ("full_time", "internship", "part_time", "contract")
STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"
TOKEN_RULES = [(30, timedelta(hours=1))]


class SalaryIn(CamelModel):
    amount: float = Field(ge=0, le=10_000_000)  # unit month: rupees a month (25000); unit lpa: lakhs a year (3.5)
    unit: Literal["month", "lpa"] = "month"


class HireIn(CamelModel):
    on: bool
    consent: bool = False
    join_date: str = Field("", max_length=10)  # YYYY-MM-DD, the earliest day they can start
    cities: list[str] = Field(default_factory=list, max_length=5)
    remote: bool = False
    salary: SalaryIn | None = None
    notice_days: int = Field(0, ge=0, le=180)
    job_types: list[Literal[JOB_TYPES]] = Field(default_factory=list, max_length=4)  # type: ignore[valid-type]

    @field_validator("cities")
    @classmethod
    def _cities(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for c in v:
            c = " ".join(str(c).split())[:40]
            if c and c.lower() not in (x.lower() for x in out):
                out.append(c)
        return out

    @field_validator("join_date")
    @classmethod
    def _date(cls, v: str) -> str:
        v = v.strip()
        if not v:
            return ""
        try:
            date.fromisoformat(v)
        except ValueError:
            raise ValueError("Give the date like 2026-12-01.") from None
        return v


def available(p: dict[str, Any] | None, site: dict[str, Any], t=None) -> bool:
    """On, with consent, not paused and confirmed within the last confirm_days."""
    if not p or not p.get("on") or not p.get("consent_at") or p.get("paused_at"):
        return False
    t = t or now()
    return bool(p.get("confirmed_at")) and p["confirmed_at"] > t - timedelta(days=int(site["hire"]["confirm_days"]))


def state(p: dict[str, Any] | None, site: dict[str, Any], t=None) -> dict[str, Any]:
    """{on, available, stale, due, paused, consent, …fields, confirmedAt, expiresAt}. due: a day or less left."""
    t = t or now()
    p = p or {}
    days = int(site["hire"]["confirm_days"])
    confirmed = p.get("confirmed_at")
    expires = confirmed + timedelta(days=days) if confirmed else None
    ok = available(p, site, t)
    s = p.get("salary") or None
    return {
        "siteOn": bool(site["hire"]["on"]),
        "on": bool(p.get("on")),
        "available": ok,
        "stale": bool(p.get("on")) and not p.get("paused_at") and bool(confirmed) and not ok,
        "due": ok and expires is not None and expires - t <= timedelta(days=1),
        "paused": bool(p.get("paused_at")),
        "consent": bool(p.get("consent_at")),
        "joinDate": p.get("join_date", ""),
        "cities": p.get("cities") or [],
        "remote": bool(p.get("remote")),
        "salary": {"amount": s["amount"], "unit": s["unit"]} if s else None,
        "noticeDays": int(p.get("notice_days") or 0),
        "jobTypes": p.get("job_types") or [],
        "confirmedAt": int(confirmed.timestamp() * 1000) if confirmed else None,
        "expiresAt": int(expires.timestamp() * 1000) if expires else None,
        "confirmDays": days,
    }


async def _out(db, uid: str) -> dict[str, Any]:
    out = state(await db[HIRE_PROFILES].find_one({"_id": uid}), await get_site(db))
    u = await db[USERS].find_one({"_id": uid}, {"notify": 1}) or {}
    out["emails"] = ((u.get("notify") or {}).get("email") or {}).get("hire", True) is not False
    return out


@router.get("")
async def get_hire(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return await _out(db, auth.user.id)


@router.put("")
async def put_hire(body: HireIn, request: Request, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    site = await get_site(db)
    if body.on and not site["hire"]["on"]:
        raise ApiError(409, "hire_off", "Hiring now is switched off for the moment.")
    if body.on and not body.consent:
        raise ApiError(400, "consent", "Tick the box to let companies hiring now see your profile and invite you.")
    if body.on and not body.cities and not body.remote:
        raise ApiError(400, "where", "Add a city, or tick Remote.")
    t = now()
    old = await db[HIRE_PROFILES].find_one({"_id": auth.user.id}) or {}
    sets: dict[str, Any] = {
        "on": body.on,
        "join_date": body.join_date,
        "cities": body.cities,
        "remote": body.remote,
        "salary": body.salary.model_dump() if body.salary else None,
        "notice_days": body.notice_days,
        "job_types": list(body.job_types),
        "updated_at": t,
    }
    if body.on:
        sets["confirmed_at"] = t  # saving counts as "still ready"
        sets["consent_at"] = old.get("consent_at") or t
        sets["paused_at"] = None
    else:
        sets["consent_at"] = old.get("consent_at") if body.consent else None
    await db[HIRE_PROFILES].update_one(
        {"_id": auth.user.id}, {"$set": sets, "$setOnInsert": {"created_at": t}}, upsert=True
    )
    await audit(db, auth.user.id, "hire.available", data={"on": body.on}, ip=client_ip(request))
    return await _out(db, auth.user.id)


async def confirm(db, uid: str) -> bool:
    """ "Still ready": the days start again. Only for someone who is on and has consent."""
    r = await db[HIRE_PROFILES].update_one(
        {"_id": uid, "on": True, "consent_at": {"$ne": None}},
        {"$set": {"confirmed_at": now(), "paused_at": None, "updated_at": now()}},
    )
    return bool(r.matched_count)


@router.post("/confirm")
async def confirm_now(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    if not await confirm(db, auth.user.id):
        raise ApiError(409, "not_on", "Turn on “Ready to join” first.")
    return await _out(db, auth.user.id)


class PauseIn(CamelModel):
    paused: bool


@router.post("/pause")
async def pause(body: PauseIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    t = now()
    sets: dict[str, Any] = {"paused_at": t if body.paused else None, "updated_at": t}
    if not body.paused:
        sets["confirmed_at"] = t  # back from a pause: ready again from today
    r = await db[HIRE_PROFILES].update_one({"_id": auth.user.id, "on": True}, {"$set": sets})
    if not r.matched_count:
        raise ApiError(409, "not_on", "Turn on “Ready to join” first.")
    return await _out(db, auth.user.id)


@router.delete("")
async def remove(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await db[HIRE_PROFILES].delete_one({"_id": auth.user.id})
    return await _out(db, auth.user.id)


class EmailsIn(CamelModel):
    on: bool


@router.put("/emails")
async def emails(body: EmailsIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await db[USERS].update_one({"_id": auth.user.id}, {"$set": {"notify.email.hire": body.on}})
    return await _out(db, auth.user.id)


# ---------- the one-tap "Still ready" email ----------


def still_token(uid: str) -> str:
    return f"{uid}.{keyed_hash('hire-still-ready', uid)[:32]}"


def token_user(token: str) -> str | None:
    uid, _, sig = (token or "").rpartition(".")
    return uid if uid and sig and same(sig, keyed_hash("hire-still-ready", uid)[:32]) else None


class TokenIn(CamelModel):
    token: str = Field(min_length=10, max_length=200)


@public.post("/still-ready")
async def still_ready(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    key = f"hire-still:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, TOKEN_RULES)
    await rate_limit.record(db, key)
    uid = token_user(body.token)
    if not uid or not await confirm(db, uid):
        raise ApiError(404, "invalid_link", "This link doesn’t work any more. Sign in and tap “Still ready”.")
    p = await db[HIRE_PROFILES].find_one({"_id": uid})
    return {"ok": True, "expiresAt": state(p, await get_site(db))["expiresAt"]}


def reminder_email(u: dict[str, Any], days: int) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (u.get("name") or "").split(" ")[0] or "there"
    yes = f"{site}/hire/still-ready#t={still_token(u['_id'])}"
    edit = f"{site}/me/hire"
    lines = [
        f"Hi {first},",
        "",
        f"You said you are ready to join a job now. To stay visible to companies hiring now for the next {days} "
        "days, tap Still ready:",
        yes,
        "",
        f"Changed your plans? Update or pause it here: {edit}",
        "If you do nothing, companies stop seeing you as ready from tomorrow. Nothing is deleted.",
        "",
        "Nm7 · nm7.si",
    ]
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(first)},</p><p>You said you are ready to join a job now. To stay '
        f"visible to companies hiring now for the next {days} days, tap Still ready:</p>"
        f'<p><a href="{escape(yes)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;'
        f'border-radius:8px;text-decoration:none">Still ready</a></p>'
        f'<p style="color:#666;font-size:13px">Changed your plans? <a href="{escape(edit)}">Update or pause it</a>. '
        "If you do nothing, companies stop seeing you as ready from tomorrow. Nothing is deleted.</p></div>"
    )
    subject = "Still ready to join? One tap"
    return Email(to=u["email"], to_name=u.get("name", ""), subject=subject, text="\n".join(lines), html=html)


def wants_email(u: dict[str, Any]) -> bool:
    if not u or not u.get("email_verified_at") or u.get("email_bounced") or u.get("demo"):
        return False
    return ((u.get("notify") or {}).get("email") or {}).get("hire", True) is not False


async def send_reminders(db, mailer: Mailer, t=None) -> int:
    """Run by every automation pass: one email a day before "Ready to join" goes stale, once per confirmation."""
    t = t or now()
    site = await get_site(db)
    if not site["hire"]["on"]:
        return 0
    days = int(site["hire"]["confirm_days"])
    due_from = t - timedelta(days=days)  # older than this: already stale
    due_to = t - timedelta(days=max(0, days - 1))  # a day or less left
    sent = 0
    q = {"on": True, "consent_at": {"$ne": None}, "paused_at": None, "confirmed_at": {"$gt": due_from, "$lte": due_to}}
    async for p in db[HIRE_PROFILES].find(q).limit(500):
        if p.get("reminded_for") == p["confirmed_at"]:
            continue  # this week's reminder went already
        claimed = await db[HIRE_PROFILES].update_one(
            {"_id": p["_id"], "reminded_for": {"$ne": p["confirmed_at"]}}, {"$set": {"reminded_for": p["confirmed_at"]}}
        )
        if not claimed.modified_count:
            continue
        u = await db[USERS].find_one({"_id": p["_id"]})
        if wants_email(u):
            sent += await send_safely(mailer, reminder_email(u, days))
    return sent
