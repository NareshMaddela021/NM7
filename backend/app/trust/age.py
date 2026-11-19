# ruff: noqa: E501  (plain-language emails)
"""The age gate and verifiable parental consent (DPDP, children's data).

The first time a person uses Vetting Trust they give their date of birth. Only the day they turn 18 is kept (never
the birth date itself), and it is never used for scoring, ranking or AI prompts: it only decides whether a parent must
agree first. Under 18: the person gives a parent's email, the parent gets a one-time link (valid 7 days), reads what
Nm7 does and confirms (or declines). Until a parent confirms, every Trust feature that needs a consent is blocked for
the minor (`require_ok`), and the minor can't give consents. The parent's answer is kept as the record. On the day the
person turns 18 they count as an adult without asking anyone.

  POST /api/me/trust/age        {dob: "YYYY-MM-DD"}       once
  POST /api/me/trust/parent     {email, name?}            sends the parent the link (3 a day)
  POST /api/public/trust/parent/check    {token}          what the parent is asked
  POST /api/public/trust/parent/confirm  {token, parentName, relation, agree}
  POST /api/public/trust/parent/decline  {token}
"""

from datetime import UTC, date, datetime, timedelta
from html import escape
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import EmailStr, Field

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, TRUST_PARENTS, TRUST_PROFILES, USERS
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import hash_token, new_token
from app.core.time import now
from app.me.service import ms
from app.trust import access

me = APIRouter(prefix="/api/me/trust", tags=["trust"], dependencies=[access.ON])
public = APIRouter(prefix="/api/public/trust/parent", tags=["trust"])

LINK_DAYS = 7
SEND_RULES = [(3, timedelta(days=1))]
ADULT = 18


def adult_from(dob: date) -> datetime:
    try:
        d = dob.replace(year=dob.year + ADULT)
    except ValueError:  # 29 February
        d = dob.replace(year=dob.year + ADULT, month=3, day=1)
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _mask(email: str) -> str:
    name, _, domain = (email or "").partition("@")
    return f"{name[:1]}{'•' * max(1, min(6, len(name) - 1))}@{domain}" if domain else ""


async def state(db, uid: str) -> dict[str, Any]:
    p = await db[TRUST_PROFILES].find_one({"_id": uid}) or {}
    if not p.get("age_checked_at"):
        return {"checked": False, "minor": False, "parent": None}
    minor = bool(p.get("adult_from") and p["adult_from"] > now())
    req = await db[TRUST_PARENTS].find_one({"user_id": uid}, sort=[("sent_at", -1)]) if minor else None
    parent = None
    if req:
        st = req["status"]
        if st == "pending" and req["expires_at"] < now():
            st = "expired"
        parent = {"status": st, "sentTo": _mask(req.get("email", "")), "sentAt": ms(req.get("sent_at")),
                  "confirmedAt": ms(req.get("confirmed_at")), "expiresAt": ms(req.get("expires_at"))}  # fmt: skip
    return {"checked": True, "minor": minor, "parent": parent, "parentOk": bool(p.get("parent_confirmed_at"))}


async def require_ok(db, uid: str) -> None:
    p = await db[TRUST_PROFILES].find_one({"_id": uid}) or {}
    if not p.get("age_checked_at"):
        raise ApiError(
            428, "age_check", "Please confirm your date of birth first (Profile & settings > Privacy & consent)."
        )
    if p.get("adult_from") and p["adult_from"] > now() and not p.get("parent_confirmed_at"):
        raise ApiError(
            403, "parent_needed", "You are under 18, so a parent or guardian must agree first. We sent them a link."
        )


class AgeIn(CamelModel):
    dob: date


@me.post("/age")
async def set_age(body: AgeIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    t = now()
    today = t.date()
    if body.dob >= today or body.dob < today.replace(year=today.year - 100):
        raise ApiError(400, "dob", "Please check your date of birth.")
    if (await db[TRUST_PROFILES].find_one({"_id": uid}, {"age_checked_at": 1}) or {}).get("age_checked_at"):
        raise ApiError(409, "already", "Your age is already confirmed. To correct it, write to info@nm7.si.")
    af = adult_from(body.dob)
    await db[TRUST_PROFILES].update_one({"_id": uid}, {"$set": {"adult_from": af, "age_checked_at": t, "age_method": "dob"},
                                                       "$setOnInsert": {"created_at": t}, "$unset": {"erased_at": ""}}, upsert=True)  # fmt: skip
    await audit(db, uid, "trust.age_checked", target=uid, data={"minor": af > t})  # never the date itself
    return await state(db, uid)


class ParentIn(CamelModel):
    email: EmailStr
    name: str = Field("", max_length=80)


def parent_email(to: str, parent_name: str, child: str, link: str) -> Email:
    hi = f"Hi {parent_name}," if parent_name else "Hello,"
    lines = [hi, "", f"{child} (under 18) wants to use Nm7's skill verification on nm7.si, a job site in India.",
             "Because they are under 18, the law asks a parent or guardian to agree first.", "",
             f"Read what we do and answer here (the link works once, for {LINK_DAYS} days): {link}", "",
             "If you don't know this person, ignore this email; nothing happens.", "", "Nm7 · nm7.si"]  # fmt: skip
    html = (f"<p>{escape(hi)}</p><p>{escape(child)} (under 18) wants to use Nm7’s skill verification on nm7.si, a job site in India. "
            "Because they are under 18, the law asks a parent or guardian to agree first.</p>"
            f'<p><a href="{escape(link)}">Read what we do and answer</a> (the link works once, for {LINK_DAYS} days).</p>'
            "<p style=\"color:#666;font-size:13px\">If you don’t know this person, ignore this email; nothing happens.</p>")  # fmt: skip
    return Email(
        to=to, to_name=parent_name, subject=f"{child} asks for your consent on Nm7", text="\n".join(lines), html=html
    )


@me.post("/parent")
async def ask_parent(body: ParentIn, db: DB, mailer: MailerDep, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    st = await state(db, uid)
    if not st["checked"] or not st["minor"]:
        raise ApiError(409, "not_minor", "A parent’s consent is only needed for people under 18.")
    if st.get("parentOk"):
        return st
    if str(body.email).lower() == (auth.user.email or "").lower():
        raise ApiError(400, "own_email", "Please give your parent’s or guardian’s email, not your own.")
    key = f"trust-parent:{uid}"
    await rate_limit.check(db, key, SEND_RULES, "You sent 3 links today. Try again tomorrow.")
    await rate_limit.record(db, key)
    token = new_token()
    t = now()
    await db[TRUST_PARENTS].update_many(
        {"user_id": uid, "status": "pending"}, {"$set": {"status": "replaced"}, "$unset": {"token_hash": ""}}
    )
    await db[TRUST_PARENTS].insert_one({"user_id": uid, "email": str(body.email).lower(), "name": body.name.strip(), "token_hash": hash_token(token),
                                        "status": "pending", "sent_at": t, "expires_at": t + timedelta(days=LINK_DAYS)})  # fmt: skip
    link = f"{get_settings().site_url.rstrip('/')}/stop-alerts#k=parent&t={token}"
    child = (auth.user.name or "Your child").split(" ")[0]
    await send_safely(mailer, parent_email(str(body.email), body.name.strip(), child, link))
    await audit(db, uid, "trust.parent_link_sent", target=uid)
    return await state(db, uid)


# --- the parent's one-time link --------------------------------------------------------------------------------------


class TokenIn(CamelModel):
    token: str = Field(min_length=20, max_length=200)


class ConfirmIn(TokenIn):
    parent_name: str = Field(min_length=2, max_length=80)
    relation: Literal["mother", "father", "guardian", "other"]
    agree: bool


async def _req(db, request: Request, token: str) -> dict[str, Any]:
    key = f"trust-parent-link:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, [(30, timedelta(hours=1))])
    await rate_limit.record(db, key)
    r = await db[TRUST_PARENTS].find_one({"token_hash": hash_token(token), "status": "pending"})
    if not r or r["expires_at"] < now():
        raise ApiError(404, "invalid_link", "This link has been used, has expired or was replaced by a newer one.")
    return r


@public.post("/check")
async def check(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    from app.trust.consent import PURPOSES

    r = await _req(db, request, body.token)
    u = await db[USERS].find_one({"_id": r["user_id"]}, {"name": 1}) or {}
    return {"child": (u.get("name") or "Your child").split(" ")[0], "expiresAt": ms(r["expires_at"]),
            "purposes": [{"title": p.title, "text": p.text.replace("{days}", "a limited number of")} for p in PURPOSES.values()]}  # fmt: skip


@public.post("/confirm")
async def confirm(body: ConfirmIn, request: Request, db: DB) -> dict[str, Any]:
    if not body.agree:
        raise ApiError(400, "agree", "Tick the box to agree, or choose “I don’t agree”.")
    r = await _req(db, request, body.token)
    t = now()
    claimed = await db[TRUST_PARENTS].update_one(
        {"_id": r["_id"], "status": "pending"},
        {
            "$set": {
                "status": "confirmed",
                "confirmed_at": t,
                "parent_name": body.parent_name.strip(),
                "relation": body.relation,
            },
            "$unset": {"token_hash": ""},
        },
    )
    if not claimed.modified_count:
        raise ApiError(404, "invalid_link", "This link has been used already.")
    await db[TRUST_PROFILES].update_one(
        {"_id": r["user_id"]}, {"$set": {"parent_confirmed_at": t, "parent_request": r["_id"]}}
    )
    await audit(db, None, "trust.parent_confirmed", target=r["user_id"], data={"relation": body.relation})
    return {"ok": True}


@public.post("/decline")
async def decline(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    r = await _req(db, request, body.token)
    await db[TRUST_PARENTS].update_one(
        {"_id": r["_id"]}, {"$set": {"status": "declined", "declined_at": now()}, "$unset": {"token_hash": ""}}
    )
    await audit(db, None, "trust.parent_declined", target=r["user_id"])
    return {"ok": True}
