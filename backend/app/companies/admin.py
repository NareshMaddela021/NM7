"""Admin → Companies: the trust queue (Phase 2, C1).

  GET  /api/admin/companies?state=pending|approved|rejected|blocked|draft|all&q=   newest first, flags up front
  GET  /api/admin/companies/{id}                     the company, its flags, team and its activity log
  POST /api/admin/companies/{id}/approve             Verified for verified_months (default 12); emails the main admin
  POST /api/admin/companies/{id}/reject {reason}     the reason is emailed; they can fix and send again
  POST /api/admin/companies/{id}/reverify {reason}   back to the queue (Basic until checked again); emailed
  POST /api/admin/companies/{id}/block {reason}      can't sign in to it or post; emailed
  POST /api/admin/companies/{id}/unblock
Permission "companies" (Owner, Operations). Every decision is in the activity log. The registration number is checked by
hand on the government site (the screen links to the GST portal); nothing here calls a paid registry.

The automation pass also emails the main admin 30 days before Verified ends (once), and Verified simply ends at
verified_until (the company is Basic again until an admin re-checks it).
"""

import re
from datetime import timedelta
from html import escape
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.companies.checks import GST_PORTAL, MCA_PORTAL
from app.companies.model import company_out, flags_for, trust_of
from app.core.config import get_settings
from app.core.db import AUDIT_LOG, COMPANIES, DB
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.site import get_site

router = APIRouter(prefix="/api/admin/companies", tags=["admin companies"])
STATES = ("pending", "approved", "rejected", "blocked", "draft")
STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"
RECHECK_BEFORE = timedelta(days=30)


def admin_out(c: dict[str, Any]) -> dict[str, Any]:
    out = company_out(c)
    reg = c.get("reg") or {}
    out |= {
        "flags": (c.get("flags") or []) + [f for f in c.get("login_flags") or [] if f not in (c.get("flags") or [])],
        "createdAt": ms(c.get("created_at")),
        "updatedAt": ms(c.get("updated_at")),
        "domain": {
            "name": (c.get("domain") or {}).get("name", ""),
            "ageDays": (c.get("domain") or {}).get("age_days"),
            "mail": (c.get("domain") or {}).get("mx"),
        },
        "checkAt": GST_PORTAL if reg.get("kind") == "gstin" else MCA_PORTAL if reg else "",
        "signupIp": bool((c.get("signup") or {}).get("ip_hash")),
    }
    return out


@router.get("")
async def queue(
    db: DB, _: AdminAuth("companies"), state: str = Query("pending", max_length=10), q: str = Query("", max_length=80)
) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if state in STATES:
        query["review.state"] = state
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"details.legal_name": rx}, {"members.email_lc": rx}, {"reg.number": rx}, {"company_email": rx}]
    rows = await db[COMPANIES].find(query).sort([("updated_at", -1)]).limit(200).to_list(None)
    counts = {s: await db[COMPANIES].count_documents({"review.state": s}) for s in STATES}
    return {"items": [admin_out(c) for c in rows], "counts": counts}


async def _company(db, cid: str) -> dict[str, Any]:
    c = await db[COMPANIES].find_one({"_id": cid})
    if not c:
        raise ApiError(404, "not_found", "No such company.")
    return c


@router.get("/{cid}")
async def one(cid: str, db: DB, _: AdminAuth("companies")) -> dict[str, Any]:
    c = await _company(db, cid)
    log = await db[AUDIT_LOG].find({"target": cid}).sort("at", -1).limit(100).to_list(None)
    out = admin_out(c)
    out["log"] = [{"action": a["action"], "at": ms(a.get("at")), "data": a.get("data") or {}} for a in log]
    return out


class ReasonIn(CamelModel):
    reason: str = Field(min_length=5, max_length=500)


def _mail(to: str, name: str, subject: str, lines: list[str], link: tuple[str, str] | None = None) -> Email:
    site = get_settings().site_url.rstrip("/")
    text = "\n\n".join(
        [f"Hi {name or 'there'},", *lines] + ([f"{link[0]}: {site}{link[1]}"] if link else []) + ["Nm7 · nm7.si"]
    )
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(name or "there")},</p>'
        + "".join(f"<p>{escape(x)}</p>" for x in lines)
        + (f'<p><a href="{site}{link[1]}">{escape(link[0])}</a></p>' if link else "")
        + "</div>"
    )
    return Email(to, name, subject, text, html)


def _main_admin(c: dict[str, Any]) -> tuple[str, str]:
    m = next((m for m in c.get("members") or [] if m["role"] == "main"), None) or {}
    return m.get("email_lc") or c.get("admin_email", ""), m.get("name", "")


async def _decide(
    db,
    mailer,
    c: dict[str, Any],
    state: str,
    actor: str,
    request: Request,
    reason: str = "",
    email: tuple[str, list[str]] | None = None,
) -> dict[str, Any]:
    t = now()
    before = (c.get("review") or {}).get("state")
    c["review"] = {**(c.get("review") or {}), "state": state, "reason": reason, "at": t, "by": actor}
    if state == "approved":
        months = int((await get_site(db))["companies"]["verified_months"])
        c["verified_until"] = t + timedelta(days=30 * months)
        c.pop("recheck_sent_at", None)
    elif state in ("pending", "rejected", "blocked"):
        c["verified_until"] = None
    c["flags"] = await flags_for(db, c, (await get_site(db))["companies"])
    c["trust"] = trust_of(c)
    c["updated_at"] = t
    await db[COMPANIES].replace_one({"_id": c["_id"]}, c)
    from app.companies.trust import refresh

    c["score"] = await refresh(db, c["_id"])
    await audit(
        db,
        actor,
        f"company.{state if state != 'pending' else 'reverify'}",
        target=c["_id"],
        data={"from": before, "to": state, "reason": reason, "name": c["details"]["legal_name"]},
        ip=client_ip(request),
    )
    if email:
        to, name = _main_admin(c)
        if to:
            await send_safely(mailer, _mail(to, name, email[0], email[1], ("Open your company account", "/company")))
    return admin_out(c)


@router.post("/{cid}/approve")
async def approve(
    cid: str, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("companies")
) -> dict[str, Any]:
    c = await _company(db, cid)
    if trust_of(c) == "unverified":
        raise ApiError(400, "emails", "The company email isn’t confirmed yet.")
    if (c.get("review") or {}).get("state") == "blocked":
        raise ApiError(409, "blocked", "Unblock the company first.")
    name = c["details"]["legal_name"]
    return await _decide(
        db,
        mailer,
        c,
        "approved",
        auth.user.id,
        request,
        email=(
            f"{name} is verified on Nm7",
            [
                f"Good news: our team has verified {name}. You can now post more jobs, "
                "and students see the Verified badge.",
                "Verification lasts 12 months; we'll remind you before it's due again.",
            ],
        ),
    )


@router.post("/{cid}/reject")
async def reject(
    cid: str, body: ReasonIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("companies")
) -> dict[str, Any]:
    c = await _company(db, cid)
    name = c["details"]["legal_name"]
    return await _decide(
        db,
        mailer,
        c,
        "rejected",
        auth.user.id,
        request,
        body.reason,
        email=(
            f"We couldn't verify {name} yet",
            [
                f"Our team couldn't verify {name}.",
                f"Reason: {body.reason}",
                "Please correct your details on Nm7 and send them again.",
            ],
        ),
    )


@router.post("/{cid}/reverify")
async def reverify(
    cid: str, body: ReasonIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("companies")
) -> dict[str, Any]:
    c = await _company(db, cid)
    name = c["details"]["legal_name"]
    return await _decide(
        db,
        mailer,
        c,
        "pending",
        auth.user.id,
        request,
        body.reason,
        email=(
            f"{name}: a new check on Nm7",
            [
                f"Our team is checking {name} again: {body.reason}",
                "Until then your company is Basic (1 job a week). We'll email you the result.",
            ],
        ),
    )


@router.post("/{cid}/block")
async def block(
    cid: str, body: ReasonIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("companies")
) -> dict[str, Any]:
    c = await _company(db, cid)
    name = c["details"]["legal_name"]
    out = await _decide(
        db,
        mailer,
        c,
        "blocked",
        auth.user.id,
        request,
        body.reason,
        email=(
            f"{name} is blocked on Nm7",
            [
                f"Our team has blocked {name}: {body.reason}",
                "Its jobs are no longer shown. Reply to this email if this is a mistake.",
            ],
        ),
    )
    from app.core.db import JOBS

    await db[JOBS].update_many(
        {"company_id": cid, "status": {"$ne": "closed"}}, {"$set": {"status": "paused", "updated_at": now()}}
    )
    return out


class UnblockIn(CamelModel):
    to: Literal["pending", "draft"] = "pending"


@router.post("/{cid}/unblock")
async def unblock(
    cid: str, body: UnblockIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("companies")
) -> dict[str, Any]:
    c = await _company(db, cid)
    if (c.get("review") or {}).get("state") != "blocked":
        raise ApiError(409, "not_blocked", "This company isn’t blocked.")
    return await _decide(db, mailer, c, body.to, auth.user.id, request, "unblocked")


# ---------- re-check reminders (automation pass) ----------


async def recheck_reminders(db, mailer) -> int:
    """Main admins whose Verified ends within 30 days get one reminder; once it has ended the company goes back to the
    queue (pending, Basic until an admin re-checks it)."""
    t = now()
    await db[COMPANIES].update_many(
        {"review.state": "approved", "verified_until": {"$ne": None, "$lte": t}},
        {
            "$set": {
                "review.state": "pending",
                "review.reason": "12-month re-check",
                "review.at": t,
                "verified_until": None,
                "trust": "basic",
                "updated_at": t,
            }
        },
    )
    rows = (
        await db[COMPANIES]
        .find(
            {
                "review.state": "approved",
                "demo": {"$ne": True},
                "recheck_sent_at": None,
                "verified_until": {"$ne": None, "$lte": t + RECHECK_BEFORE},
            }
        )
        .to_list(200)
    )
    sent = 0
    for c in rows:
        to, name = _main_admin(c)
        until = c["verified_until"].strftime("%d %b %Y")
        ok = to and await send_safely(
            mailer,
            _mail(
                to,
                name,
                f"{c['details']['legal_name']}: verification due {until}",
                [
                    f"{c['details']['legal_name']} is verified on Nm7 until {until}.",
                    "Please check that your company details are still correct. Our team will re-check them; "
                    "until then your "
                    "company stays Basic (1 job a week) after that date.",
                ],
                ("Open your company account", "/company"),
            ),
        )
        await db[COMPANIES].update_one({"_id": c["_id"]}, {"$set": {"recheck_sent_at": t}})
        sent += bool(ok)
    return sent
