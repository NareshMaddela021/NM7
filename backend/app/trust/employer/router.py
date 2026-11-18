# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T4 endpoints (everything behind the one Trust switch; Admin pages always on for admins).

Company (header X-Recruiter-Account; 404 while Vetting Trust is hidden from this company; main / full admins change):
  GET    /api/company/{cid}/trust/employer            where the business check stands, the consent text, the kinds
  POST   /api/company/{cid}/trust/employer {kind, number, agree}   look it up (rate-limited: each lookup is paid)
  DELETE /api/company/{cid}/trust/employer            remove it (the badge and the stored facts go at once)
Candidate (signed in, while Vetting Trust is on for them):
  GET    /api/me/trust/employer                       the promise, what to do, report reasons, badges of my companies
  POST   /api/me/trust/fraud {context, id, reason, note}   report fraud (job / company / invite / offer)
Admin:
  GET    /api/admin/trust/employer                    provider, keys set / not set, settings, counts, review queue
  PUT    /api/admin/trust/employer {provider, recheckDays, pauseAt, nameMin}
  POST   /api/admin/trust/employer/{cid}/review {decision: verified | not_verified | recheck, note}
  POST   /api/admin/trust/employer/recheck            run the re-check pass now
  GET    /api/admin/trust/fraud?state=open|done       fraud reports, grouped by job / company (reporters shown to Admin only)
  POST   /api/admin/trust/fraud/action {key, action: dismiss | warn | pause_job | suspend_company, note}
The public job board and company page add their Trust items through `public_items` (jobs/public.py, companies/dashboard.py).
"""

from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Header, Query, Request
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.companies.model import MANAGE
from app.companies.signup import company_for
from app.core import rate_limit
from app.core.db import COMPANIES, DB, HIRE_INVITES, HIRE_OFFERS, TRUST_EMPLOYER
from app.core.email import MailerDep
from app.core.errors import ApiError
from app.core.heavy import heavy_or_busy
from app.core.schemas import CamelModel
from app.me.service import ms
from app.site import get_site, save_site
from app.trust import access
from app.trust.employer import formats as F
from app.trust.employer import fraud as FR
from app.trust.employer import providers as P
from app.trust.employer import service as S

company = APIRouter(prefix="/api/company/{cid}/trust/employer", tags=["trust"])
me = APIRouter(prefix="/api/me/trust", tags=["trust"], dependencies=[access.ON])
admin = APIRouter(prefix="/api/admin/trust", tags=["trust"])

LOOKUP_RULES = [(5, timedelta(days=1)), (15, timedelta(days=30))]


# --- the company ---------------------------------------------------------------------------------------------------------


async def _co(db, cid: str, session: str | None, roles: set[str] | None = None) -> tuple[dict, dict]:
    acc, c, _ = await company_for(db, cid, session, roles)
    if not await access.for_company(db, c, acc):
        raise ApiError(404, "not_found", "Not found.")
    return acc, c


async def _company_out(db, c: dict[str, Any], acc: dict[str, Any]) -> dict[str, Any]:
    site = await get_site(db)
    p = await S.provider_for(site, c, acc)
    r = c.get("reg") or {}
    return {
        "state": S.state_out(await S.get_state(db, c["_id"])),
        "provider": {"ready": p is not None, "test": bool(p and p.test)},
        "kinds": [{"key": k, "title": v} for k, v in F.KINDS.items()],
        "suggest": {"kind": r["kind"], "number": r.get("number", "")} if r.get("kind") in F.KINDS else None,
        "consentText": S.CONSENT_TEXT,
    }


@company.get("")
async def company_state(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c = await _co(db, cid, x_recruiter_account)
    return await _company_out(db, c, acc)


class VerifyIn(CamelModel):
    kind: Literal["gstin", "udyam", "cin"]
    number: str = Field(min_length=6, max_length=40)
    agree: bool

    @field_validator("number")
    @classmethod
    def _n(cls, v: str) -> str:
        return v.strip()


@company.post("")
async def company_verify(
    cid: str, body: VerifyIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, c = await _co(db, cid, x_recruiter_account, MANAGE)
    if not body.agree:
        raise ApiError(400, "agree", "Please tick that Nm7 may look this number up.")
    if prob := F.problem(body.kind, body.number):  # checked here first: a typing mistake never costs a lookup
        raise ApiError(400, "bad_number", prob)
    st = await S.get_state(db, cid) or {}
    if st.get("status") == "verified" and st.get("number_hash") == F.number_hash(body.kind, body.number):
        return await _company_out(db, c, acc)
    key = f"trust-employer:{cid}"
    await rate_limit.check(
        db,
        key,
        LOOKUP_RULES,
        "You’ve looked numbers up many times recently. Please try again tomorrow, or write to us.",
    )
    await rate_limit.record(db, key)
    await S.verify(db, c, acc, kind=body.kind, number=body.number, by="company", actor=None)
    await db[TRUST_EMPLOYER].update_one(
        {"_id": cid}, {"$set": {"consent": {"at": S.now(), "by": acc["email_lc"], "version": S.CONSENT_VERSION}}}
    )
    await audit(db, None, "company.trust_employer_check", target=cid, data={"by": acc["email_lc"], "kind": body.kind})
    return await _company_out(db, c, acc)


@company.delete("")
async def company_remove(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c = await _co(db, cid, x_recruiter_account, MANAGE)
    await S.remove(db, cid, None)
    await audit(db, None, "company.trust_employer_removed", target=cid, data={"by": acc["email_lc"]})
    return await _company_out(db, c, acc)


# --- candidates ----------------------------------------------------------------------------------------------------------


@me.get("/employer")
async def my_employers(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    """The promise and report reasons, and badges for the companies that invited me or sent me an offer."""
    uid = auth.user.id
    cids = {i["company_id"] async for i in db[HIRE_INVITES].find({"user_id": uid}, {"company_id": 1}).limit(200)}
    cids |= {o["company_id"] async for o in db[HIRE_OFFERS].find({"user_id": uid}, {"company_id": 1}).limit(200)}
    return {**FR.safety_out(), "badges": await S.badges(db, list(cids))}


class FraudIn(CamelModel):
    context: Literal["job", "company", "invite", "offer"]
    id: str = Field(min_length=1, max_length=140)
    reason: Literal["money", "fake_company", "impersonation", "misleading", "harassment", "other"]
    note: str = Field("", max_length=1000)


@me.post("/fraud", status_code=201)
async def report_fraud(body: FraudIn, request: Request, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await FR.report(
        db,
        auth.user.id,
        context=body.context,
        ident=body.id,
        reason=body.reason,
        note=body.note,
        ip=client_ip(request) or "",
    )


# --- the public pages ----------------------------------------------------------------------------------------------------


async def public_items(db, auth, company_id: str | None) -> dict[str, Any] | None:
    """For a job page / company page: None while Vetting Trust is hidden from this viewer (the page is unchanged)."""
    if not await S.viewer_allowed(db, auth):
        return None
    badge = (await S.badges(db, [company_id])).get(company_id) if company_id else None
    return {"employer": badge, **FR.safety_out()}


async def card_badges(db, auth, jobs: list[dict[str, Any]]) -> dict[str, dict[str, Any]] | None:
    if not await S.viewer_allowed(db, auth):
        return None
    return await S.badges(db, [j.get("company_id") for j in jobs if j.get("company_id")])


# --- Admin ---------------------------------------------------------------------------------------------------------------


def _settings_out(fs: dict[str, Any]) -> dict[str, Any]:
    return {
        "provider": fs["provider"],
        "recheckDays": int(fs["recheck_days"]),
        "pauseAt": int(fs["pause_at"]),
        "nameMin": int(fs["name_min"]),
    }


async def _admin_out(db) -> dict[str, Any]:
    fs = S.employer_settings(await get_site(db))
    items = []
    async for st in db[TRUST_EMPLOYER].find({"status": "review"}).sort("updated_at", -1).limit(100):
        c = (
            await db[COMPANIES].find_one(
                {"_id": st["_id"]}, {"details": 1, "slug": 1, "admin_email": 1, "company_email": 1, "review": 1}
            )
            or {}
        )
        d = c.get("details") or {}
        items.append({"companyId": st["_id"], "company": d.get("legal_name", ""), "website": d.get("website", ""), "slug": c.get("slug", ""),
                      "emails": [e for e in (c.get("admin_email"), c.get("company_email")) if e], "nm7Review": (c.get("review") or {}).get("state", ""),
                      "updatedAt": ms(st.get("updated_at")), **S.state_out(st)})  # fmt: skip
    return {
        **_settings_out(fs),
        "providers": [
            {"key": p.key, "label": p.label, "test": p.test, "ready": p.ready(), "keys": p.keys()}
            for p in P.registry().values()
        ],
        "counts": await S.counts(db),
        "review": items,
    }


@admin.get("/employer")
async def admin_overview(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return await _admin_out(db)


class SettingsIn(CamelModel):
    provider: str
    recheck_days: int = Field(90, ge=30, le=365)
    pause_at: int = Field(3, ge=2, le=10)
    name_min: int = Field(85, ge=70, le=100)

    @field_validator("provider")
    @classmethod
    def _known(cls, v: str) -> str:
        if v not in P.registry():
            raise ValueError("unknown provider")
        return v


@admin.put("/employer")
async def admin_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    before = S.employer_settings(await get_site(db))
    new = {
        "provider": body.provider,
        "recheck_days": body.recheck_days,
        "pause_at": body.pause_at,
        "name_min": body.name_min,
    }
    if new != before:
        await save_site(db, {"trust.employer": new})
        await audit(
            db,
            auth.user.id,
            "trust.employer_settings",
            target="site",
            data={"from": before, "to": new},
            ip=client_ip(request),
        )
    return await _admin_out(db)


class DecideIn(CamelModel):
    decision: Literal["verified", "not_verified", "recheck"]
    note: str = Field("", max_length=600)


@admin.post("/employer/{cid}/review")
async def admin_review(cid: str, body: DecideIn, db: DB, auth: AdminAuth("companies")) -> dict[str, Any]:
    if body.decision == "recheck":
        st = await S.get_state(db, cid)
        c = await db[COMPANIES].find_one({"_id": cid})
        if not st or not c:
            raise ApiError(404, "not_found", "There is no business check for this company.")
        number = S._number(st)
        if not number:
            raise ApiError(409, "no_number", "The number isn’t available any more; ask the company to send it again.")
        await S.verify(db, c, None, kind=st["kind"], number=number, by="admin", actor=auth.user.id)
    else:
        if body.decision == "not_verified" and len(body.note.strip()) < 5:
            raise ApiError(400, "note", "Tell the company why (they see this note).")
        await S.decide(db, cid, auth.user.id, decision=body.decision, note=body.note)
    return await _admin_out(db)


@admin.post("/employer/recheck")
async def admin_recheck(db: DB, mailer: MailerDep, auth: AdminAuth("settings")) -> dict[str, Any]:
    async with heavy_or_busy(db):
        pass
    out = await S.recheck(db, mailer)
    await audit(db, auth.user.id, "trust.employer_recheck_run", target="site", data=out)
    return {**out, **await _admin_out(db)}


@admin.get("/fraud")
async def admin_fraud(db: DB, _: AdminAuth("companies"), state: str = Query("open", max_length=6)) -> dict[str, Any]:
    st = state if state in ("open", "done") else "open"
    return {
        "items": await FR.queue(db, st),
        "reasons": [{"key": k, "title": v} for k, v in FR.REASONS.items()],
        "pauseAt": await FR.pause_at(db),
    }


class ActIn(CamelModel):
    key: str = Field(min_length=5, max_length=120)
    action: Literal["dismiss", "warn", "pause_job", "suspend_company"]
    note: str = Field("", max_length=500)


@admin.post("/fraud/action")
async def admin_fraud_act(
    body: ActIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("companies")
) -> dict[str, Any]:
    out = await FR.act(db, mailer, request, auth, key=body.key, action=body.action, note=body.note)
    return {**out, "items": await FR.queue(db, "open")}
