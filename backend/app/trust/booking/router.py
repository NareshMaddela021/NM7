# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T11 endpoints: one-tap interview booking, reminders and joining-day confirmations.

One-tap links (no sign-in; the token comes from the address fragment of /stop-alerts#k=book|join|cjoin&t=…, rate-limited
per address; every answer re-checks the Trust switch for that person × company):
  POST /api/public/trust/book/check {token}                         the free times and my booking
  POST /api/public/trust/book/pick {token, slot, reason}             book, or move my booking (until 2 h before)
  POST /api/public/trust/book/cancel {token, reason}                 (until 2 h before)
  POST /api/public/trust/book/cant {token, reason}                   too late to move: tell the company
  POST /api/public/trust/join/check {token} · /join/act {token, action: yes | reschedule | joined, reason}
  POST /api/public/trust/cjoin/check {token} · /cjoin/act {token, joined, reason}     the company's Joined / Didn't join
Company (header X-Recruiter-Account; 404 while Vetting Trust is hidden from this company):
  GET  /api/company/{cid}/trust/booking?job=                         live: bookings by link, joining days and answers
  PUT  /api/company/{cid}/trust/booking/joinings/{oid} {time, place, map}   the reporting time and place for an offer
Admin:
  GET / PUT /api/admin/trust/booking                                 settings, template approvals, templates, counts
  POST /api/admin/trust/booking/run                                  one pass now
"""

from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Header, Query, Request
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.companies.model import POST
from app.companies.signup import company_for
from app.core import rate_limit
from app.core.db import DB, TRUST_BOOK_LINKS, TRUST_JOIN_EVENTS, USERS
from app.core.email import MailerDep
from app.core.errors import ApiError
from app.core.heavy import heavy_or_busy
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.site import get_site, save_site
from app.trust import access
from app.trust.booking import service as S
from app.trust.booking import texts as TX

public = APIRouter(prefix="/api/public/trust", tags=["trust"])
company = APIRouter(prefix="/api/company/{cid}/trust/booking", tags=["trust"])
admin = APIRouter(prefix="/api/admin/trust/booking", tags=["trust"])

LINK_RULES = [(300, timedelta(hours=1))]  # per address (many phones share one mobile-network address)


class TokenIn(CamelModel):
    token: str = Field(min_length=20, max_length=200)


class PickIn(TokenIn):
    slot: str = Field(min_length=24, max_length=24)
    reason: str = Field("", max_length=300)


class ReasonIn(TokenIn):
    reason: str = Field("", max_length=300)


class JoinIn(TokenIn):
    action: Literal["yes", "reschedule", "joined"]
    reason: str = Field("", max_length=300)


class CompanyJoinIn(TokenIn):
    joined: bool
    reason: str = Field("", max_length=300)


async def _link(db, request: Request, token: str, kind: str) -> dict[str, Any]:
    key = f"trust-t11-link:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, LINK_RULES)
    await rate_limit.record(db, key)
    return await S.open_link(db, token, kind)


@public.post("/book/check")
async def book_check(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    return await S.interview_view(db, await _link(db, request, body.token, "interview"))


@public.post("/book/pick")
async def book_pick(body: PickIn, request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    return await S.pick(db, await _link(db, request, body.token, "interview"), body.slot, body.reason, mailer)


@public.post("/book/cancel")
async def book_cancel(body: ReasonIn, request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    return await S.cancel(db, await _link(db, request, body.token, "interview"), body.reason, mailer)


@public.post("/book/cant")
async def book_cant(body: ReasonIn, request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    return await S.cant_make_it(db, await _link(db, request, body.token, "interview"), body.reason, mailer)


@public.post("/join/check")
async def join_check(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    return await S.join_view(db, await _link(db, request, body.token, "join"))


@public.post("/join/act")
async def join_act(body: JoinIn, request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    return await S.join_act(db, await _link(db, request, body.token, "join"), body.action, body.reason, mailer)


@public.post("/cjoin/check")
async def cjoin_check(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    return await S.company_join_view(db, await _link(db, request, body.token, "company_join"))


@public.post("/cjoin/act")
async def cjoin_act(body: CompanyJoinIn, request: Request, db: DB) -> dict[str, Any]:
    return await S.company_join_act(db, await _link(db, request, body.token, "company_join"), body.joined, body.reason)


# --- the company -----------------------------------------------------------------------------------------------------------


async def _co(db, cid: str, session: str | None, roles: set[str] | None = None) -> tuple[dict, dict]:
    acc, c, _ = await company_for(db, cid, session, roles)
    if not await access.for_company(db, c, acc):
        raise ApiError(404, "not_found", "Not found.")
    return acc, c


@company.get("")
async def company_live(
    cid: str, db: DB, job: str = Query("", max_length=40), x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    await _co(db, cid, x_recruiter_account)
    st = S.booking_settings(await get_site(db))
    return {
        **(await S.company_view(db, cid, job)),
        "changeHours": int(st["change_hours"]),
        "soonHours": int(st["soon_hours"]),
        "eveAt": st["eve_at"],
    }


class JoinDetailsIn(CamelModel):
    time: str = Field("", pattern=r"^$|^([01]\d|2[0-3]):[0-5]\d$")
    place: str = Field("", max_length=200)
    map: str = Field("", max_length=300)

    @field_validator("map")
    @classmethod
    def _map(cls, v: str) -> str:
        v = v.strip()
        if v and not v.startswith("https://"):
            raise ValueError("The map link must start with https://")
        return v


@company.put("/joinings/{oid}")
async def company_join_details(
    cid: str, oid: str, body: JoinDetailsIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, _ = await _co(db, cid, x_recruiter_account, POST)
    out = await S.set_join_details(db, cid, oid, body.time, body.place, body.map)
    await audit(db, None, "trust.join_details", target=cid, data={"by": acc["email_lc"], "offer": oid})
    return out


# --- Admin -------------------------------------------------------------------------------------------------------------------


def _settings_out(st: dict[str, Any]) -> dict[str, Any]:
    return {"on": bool(st["on"]), "linkDays": int(st["link_days"]), "changeHours": int(st["change_hours"]), "eveAt": st["eve_at"],
            "soonHours": int(st["soon_hours"]), "morningAt": st["morning_at"], "checkinAt": st["checkin_at"], "companyAt": st["company_at"],
            "perPersonDay": int(st["per_person_day"]), "approved": {k: bool(st["approved"].get(k)) for k in TX.LANGS}}  # fmt: skip


async def _admin_out(db) -> dict[str, Any]:
    site = await get_site(db)
    st = S.booking_settings(site)
    t = now()
    links = await db[TRUST_BOOK_LINKS].find({}).sort("updated_at", -1).to_list(20)
    users = {
        u["_id"]: u.get("email", "")
        async for u in db[USERS].find({"_id": {"$in": list({x["user_id"] for x in links})}}, {"email": 1})
    }
    return {
        "settings": _settings_out(st), "public": bool((site.get("trust") or {}).get("public")),
        "templates": [{"lang": lang, "name": TX.NAMES[k], "key": k, "category": "UTILITY", "body": TX.TEMPLATES[lang][k]} for lang in TX.LANGS for k in TX.NAMES],
        "counts": {"today": await S.counts(db, t - timedelta(days=1)), "d30": await S.counts(db, t - timedelta(days=30))},
        "joinEvents": await db[TRUST_JOIN_EVENTS].count_documents({}),
        "links": [{"kind": x["kind"], "user": users.get(x["user_id"], ""), "source": x.get("source", ""), "expiresAt": ms(x["expires_at"]),
                   "invite": {k: v for k, v in (x.get("invite") or {}).items() if k in ("wa", "email")}, "bookings": int(x.get("bookings") or 0)} for x in links],
    }  # fmt: skip


@admin.get("")
async def admin_overview(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return await _admin_out(db)


HM = r"^([01]\d|2[0-3]):[0-5]\d$"


class SettingsIn(CamelModel):
    on: bool = True
    link_days: int = Field(14, ge=1, le=30)
    change_hours: int = Field(2, ge=1, le=24)
    eve_at: str = Field("19:00", pattern=HM)
    soon_hours: int = Field(2, ge=1, le=6)
    morning_at: str = Field("09:00", pattern=HM)
    checkin_at: str = Field("13:00", pattern=HM)
    company_at: str = Field("17:00", pattern=HM)
    per_person_day: int = Field(4, ge=1, le=10)
    approved: dict[str, bool] = Field(default_factory=dict)


@admin.put("")
async def admin_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    if not body.morning_at < body.checkin_at:
        raise ApiError(400, "times", "The “I’ve joined” check-in must come after the morning message.")
    st = S.booking_settings(await get_site(db))
    new = {"on": body.on, "link_days": body.link_days, "change_hours": body.change_hours, "eve_at": body.eve_at, "soon_hours": body.soon_hours,
           "morning_at": body.morning_at, "checkin_at": body.checkin_at, "company_at": body.company_at, "per_person_day": body.per_person_day,
           "approved": {k: bool(body.approved.get(k, st["approved"].get(k))) for k in TX.LANGS}}  # fmt: skip
    old = {k: st[k] for k in new}
    if new != old:
        await save_site(db, {"trust.booking": new})
        await audit(
            db,
            auth.user.id,
            "trust.booking_settings",
            target="site",
            data={"from": old, "to": new},
            ip=client_ip(request),
        )
    return await _admin_out(db)


@admin.post("/run")
async def admin_run(db: DB, mailer: MailerDep, auth: AdminAuth("settings")) -> dict[str, Any]:
    async with heavy_or_busy(db):
        got = await S.run(db, mailer, force=True)
    await audit(db, auth.user.id, "trust.booking_run", target="site", data=got)
    return {"ran": got, **(await _admin_out(db))}
