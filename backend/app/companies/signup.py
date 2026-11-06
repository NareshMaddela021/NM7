"""Company sign-up and the company's own account pages (Phase 2, C1).

Sign-up (nm7.si/for-companies), five steps; the browser keeps steps 1–2 as a draft until the admin's email is proven:
  POST /api/company/signup/check   {details, registration?, individual?, phone}  → field problems (nothing saved)
  POST /api/company/signup/code    {email, name}           a code to the admin's own email (any real address)
  POST /api/company/signup/start   {email, code, name, company}  → {session, company}: the company exists (Unverified)
Signed in (header X-Recruiter-Account: the same email-code account recruiters use):
  GET  /api/company/mine                          the companies this person is on (an invite becomes active here)
  GET  /api/company/{id}                           one company
  PUT  /api/company/{id}                           steps 1–2 again (main / full admins; locked once verified)
  POST /api/company/{id}/company-email/code {email}    the company email: on the website's domain, not free / throwaway
  POST /api/company/{id}/company-email/verify {code}   → trust Basic when both emails are proven
  POST /api/company/{id}/team {email, name, role}      invite a team admin (full / posting / view)
  PUT  /api/company/{id}/team/{email} {role}           change a role; DELETE removes. Nobody touches the main admin.
  POST /api/company/{id}/submit {acceptTerms}           → Admin → Companies review queue
Every change is in the activity log. No SMS, no ID numbers or photos.
"""

import secrets
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Header, Request
from pydantic import Field

from app.audit import audit
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.companies import checks
from app.companies.model import (
    MANAGE,
    CompanyIn,
    company_out,
    flags_for,
    member,
    reg_key,
    trust_of,
)  # fmt: skip
from app.core import rate_limit
from app.core.db import COMPANIES, DB, RECRUITERS
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, new_code, same
from app.core.time import now
from app.jobs.model import _fold
from app.orgs.recruiter_account import EmailIn, _hash, account_for, issue_session
from app.site import get_site

router = APIRouter(prefix="/api/company", tags=["companies"])

CODE_MINUTES = 10
CODE_SEND_RULES = [(5, timedelta(days=1))]
CODE_IP_RULES = [(20, timedelta(hours=1))]
CODE_TRY_RULES = [(8, timedelta(minutes=15))]
SIGNUP_IP_RULES = [(10, timedelta(days=1))]
MAX_MEMBERS = 20
STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"


def _iphash(request: Request) -> str:
    return keyed_hash("ip", client_ip(request) or "-")[:24]


async def _code_email(mailer, to: str, name: str, code: str, what: str) -> None:
    text = (
        f"Your Nm7 code: {code}\n\nIt {what} and works for {CODE_MINUTES} minutes. If you didn't ask for it, "
        "ignore this email.\n\nNm7 · nm7.si"
    )
    html = (f'<div style="{STYLE}"><p>Your Nm7 code:</p><p style="font-size:26px;font-weight:700;letter-spacing:4px">'
            f"{code}</p><p>It {what} and works for {CODE_MINUTES} minutes.</p></div>")  # fmt: skip
    await send_safely(mailer, Email(to, name, f"Your Nm7 code: {code}", text, html))


# ---------- sign-up ----------


class CheckIn(CompanyIn):
    pass


@router.post("/signup/check")
async def check(body: CheckIn) -> dict[str, Any]:
    """Steps 1–2 pass the format checks (the form shows each field's problem before this)."""
    return {"ok": True}


class SignupCodeIn(EmailIn):
    name: str = Field(min_length=2, max_length=80)


@router.post("/signup/code")
async def signup_code(body: SignupCodeIn, request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    if problem := checks.email_problem(body.email, company=False):
        raise ApiError(400, "bad_email", problem)
    ip_key = f"company-code-ip:{_iphash(request)}"
    await rate_limit.check(db, ip_key, CODE_IP_RULES, "Too many codes. Please try again later.")
    key = f"company-code:{_hash('email', body.email)[:24]}"
    await rate_limit.check(db, key, CODE_SEND_RULES, "Too many codes today. Please try again tomorrow.")
    await rate_limit.record(db, ip_key, key)
    code = new_code()
    await db[RECRUITERS].update_one(
        {"email_lc": body.email},
        {"$set": {"code_hash": _hash("code", body.email, code), "code_exp": now() + timedelta(minutes=CODE_MINUTES)},
         "$setOnInsert": {"_id": new_id(), "name": body.name.strip(), "sessions": [], "created_at": now()}},
        upsert=True,
    )  # fmt: skip
    await _code_email(mailer, body.email, body.name, code, "confirms your email for your company account on Nm7")
    return {"sent": True}


class StartIn(SignupCodeIn):
    code: str = Field(min_length=4, max_length=10)
    company: CompanyIn


async def _check_code(db, email: str, code: str) -> dict[str, Any]:
    key = f"company-try:{_hash('email', email)[:24]}"
    await rate_limit.check(db, key, CODE_TRY_RULES, "Too many wrong codes. Please wait 15 minutes.")
    acc = await db[RECRUITERS].find_one({"email_lc": email})
    ok = (acc and acc.get("code_hash") and acc.get("code_exp") and acc["code_exp"] > now()
          and same(_hash("code", email, code.strip()), acc["code_hash"]))  # fmt: skip
    if not ok:
        await rate_limit.record(db, key)
        raise ApiError(401, "wrong_code", "That code is wrong or has expired. Ask for a new one.")
    await db[RECRUITERS].update_one({"_id": acc["_id"]}, {"$set": {"code_hash": None, "code_exp": None}})
    return acc


def _slug(name: str) -> str:
    base = "-".join(_fold(name).split())[:50].strip("-") or "company"
    return f"{base}-{secrets.token_hex(2)}"


def _apply(c: dict[str, Any], body: CompanyIn) -> None:
    d = body.details
    c["kind"] = "individual" if d.category == "individual" else "company"
    c["details"] = {"legal_name": d.legal_name, "website": d.website, "category": d.category, "structure": d.structure,
                    "industry": d.industry, "size": d.size, "about": d.about.strip()}  # fmt: skip
    c["reg"] = {"kind": body.registration.kind, "number": body.registration.number} if body.registration else None
    c["reg_key"] = reg_key(c)
    c["individual"] = ({"linkedin": body.individual.linkedin, "declared": body.individual.declared}
                       if body.individual else None)  # fmt: skip
    c["phone"] = body.phone
    c["phone_key"] = keyed_hash("company-phone", body.phone)[:32] if body.phone else None


async def _domain_facts(website: str) -> dict[str, Any]:
    d = checks.site_domain(website)
    if not d:
        return {}
    return {"name": checks.registrable(d), "mx": await checks.has_mx(checks.registrable(d)),
            "age_days": await checks.domain_age_days(d)}  # fmt: skip


async def _save(db, c: dict[str, Any]) -> dict[str, Any]:
    settings = (await get_site(db))["companies"]
    c["flags"] = await flags_for(db, c, settings)
    c["trust"] = trust_of(c)
    c["updated_at"] = now()
    await db[COMPANIES].replace_one({"_id": c["_id"]}, c, upsert=True)
    return c


@router.post("/signup/start", status_code=201)
async def start(body: StartIn, request: Request, db: DB) -> dict[str, Any]:
    if problem := checks.email_problem(body.email, company=False):
        raise ApiError(400, "bad_email", problem)
    ip = _iphash(request)
    await rate_limit.check(db, f"company-signup:{ip}", SIGNUP_IP_RULES, "Too many sign-ups from here today.")
    await _check_code(db, body.email, body.code)
    await rate_limit.record(db, f"company-signup:{ip}")
    t = now()
    c: dict[str, Any] = {
        "_id": new_id(), "slug": _slug(body.company.details.legal_name),
        "admin_email": body.email, "company_email": "", "emails": {"admin": t},
        "members": [{"email_lc": body.email, "name": body.name.strip(), "role": "main", "status": "active", "at": t}],
        "review": {"state": "draft"}, "verified_until": None, "signup": {"ip_hash": ip, "at": t},
        "created_at": t, "demo": False,
    }  # fmt: skip
    _apply(c, body.company)
    c["domain"] = await _domain_facts(c["details"]["website"]) if c["kind"] == "company" else {}
    await _save(db, c)
    session = await issue_session(db, body.email, body.name.strip())
    await audit(db, None, "company.signup", target=c["_id"], data={"by": body.email, "kind": c["kind"]})
    return {"session": session, "company": company_out(c, body.email)}


# ---------- signed in ----------


async def _me(db, session: str | None) -> dict[str, Any]:
    acc = await account_for(db, session)
    if not acc:
        raise ApiError(401, "session_required", "Please sign in with the code we email you.")
    return acc


async def company_for(db, cid: str, session: str | None, roles: set[str] | None = None) -> tuple[dict, dict, dict]:
    """(account, company, my member entry); 404 for someone not on the team, 403 without the role."""
    acc = await _me(db, session)
    c = await db[COMPANIES].find_one({"_id": cid})
    m = member(c, acc["email_lc"]) if c else None
    if not c or not m:
        raise ApiError(404, "not_found", "This company isn’t on your account.")
    if (c.get("review") or {}).get("state") == "blocked":
        raise ApiError(403, "blocked", "This company account is blocked. Contact Nm7 support.")
    if roles and m["role"] not in roles:
        raise ApiError(403, "not_allowed", "Your role on this team can’t do that.")
    return acc, c, m


@router.get("/mine")
async def mine(db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc = await _me(db, x_recruiter_account)
    email = acc["email_lc"]
    await db[COMPANIES].update_many(
        {"members": {"$elemMatch": {"email_lc": email, "status": "invited"}}},
        {"$set": {"members.$[m].status": "active", "members.$[m].at": now()}},
        array_filters=[{"m.email_lc": email, "m.status": "invited"}],
    )  # first sign-in accepts an invite
    rows = await db[COMPANIES].find({"members": {"$elemMatch": {"email_lc": email, "status": "active"}}}).to_list(50)
    return {"email": email, "companies": [company_out(c, email) for c in rows]}


@router.get("/{cid}")
async def get_company(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account)
    return company_out(c, acc["email_lc"])


@router.put("/{cid}")
async def edit(cid: str, body: CompanyIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account, MANAGE)
    if c.get("trust") == "verified" or (c.get("review") or {}).get("state") == "approved":
        raise ApiError(
            409, "locked", "Your legal details are locked after verification. Changing them needs a new check."
        )
    old_site = (c.get("details") or {}).get("website")
    was_kind = c.get("kind")
    _apply(c, body)
    if c["kind"] != was_kind:
        raise ApiError(400, "kind_change", "A company can’t become an individual recruiter account (or back).")
    if c["details"]["website"] != old_site:
        c["domain"] = await _domain_facts(c["details"]["website"]) if c["kind"] == "company" else {}
        if c.get("company_email") and checks.email_problem(
            c["company_email"], company=True, website=c["details"]["website"]
        ):
            c["company_email"], c["emails"] = (
                "",
                {**c["emails"], "company": None},
            )  # a new website needs its email again
    if (c.get("review") or {}).get("state") == "rejected":
        c["review"] = {"state": "draft"}
    await _save(db, c)
    await audit(db, None, "company.edit", target=cid, data={"by": acc["email_lc"]})
    return company_out(c, acc["email_lc"])


class CompanyEmailIn(EmailIn):
    pass


@router.post("/{cid}/company-email/code")
async def company_email_code(cid: str, body: CompanyEmailIn, request: Request, db: DB, mailer: MailerDep,
                             x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:  # fmt: skip
    acc, c, _ = await company_for(db, cid, x_recruiter_account, MANAGE)
    if c.get("kind") == "individual":
        raise ApiError(400, "not_needed", "Individual recruiters don’t add a company email.")
    if problem := checks.email_problem(body.email, company=True, website=c["details"]["website"]):
        raise ApiError(400, "bad_email", problem)
    if not await checks.has_mx(checks.email_domain(body.email)):
        raise ApiError(400, "no_mail", "This email domain can’t receive email (no mail server found).")
    ip_key = f"company-code-ip:{_iphash(request)}"
    key = f"company-code:{_hash('email', body.email)[:24]}"
    await rate_limit.check(db, ip_key, CODE_IP_RULES, "Too many codes. Please try again later.")
    await rate_limit.check(db, key, CODE_SEND_RULES, "Too many codes today. Please try again tomorrow.")
    await rate_limit.record(db, ip_key, key)
    code = new_code()
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"company_code": {
        "email": body.email, "hash": _hash("company-email", cid, body.email, code),
        "exp": now() + timedelta(minutes=CODE_MINUTES)}}})  # fmt: skip
    await _code_email(mailer, body.email, c["details"]["legal_name"], code,
                      f"confirms {body.email} as the company email of {c['details']['legal_name']} on Nm7")  # fmt: skip
    return {"sent": True}


class CodeIn(CamelModel):
    code: str = Field(min_length=4, max_length=10)


@router.post("/{cid}/company-email/verify")
async def company_email_verify(cid: str, body: CodeIn, db: DB,
                               x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:  # fmt: skip
    acc, c, _ = await company_for(db, cid, x_recruiter_account, MANAGE)
    key = f"company-email-try:{cid}"
    await rate_limit.check(db, key, CODE_TRY_RULES, "Too many wrong codes. Please wait 15 minutes.")
    pending = c.get("company_code") or {}
    ok = (pending.get("exp") and pending["exp"] > now()
          and same(_hash("company-email", cid, pending.get("email", ""), body.code.strip()),
                   pending.get("hash", "")))  # fmt: skip
    if not ok:
        await rate_limit.record(db, key)
        raise ApiError(401, "wrong_code", "That code is wrong or has expired. Ask for a new one.")
    c["company_email"] = pending["email"]
    c["emails"] = {**(c.get("emails") or {}), "company": now()}
    c.pop("company_code", None)
    await _save(db, c)
    await audit(
        db, None, "company.email_verified", target=cid, data={"by": acc["email_lc"], "email": c["company_email"]}
    )
    return company_out(c, acc["email_lc"])


# ---------- team ----------


class TeamIn(EmailIn):
    name: str = Field("", max_length=80)
    role: Literal["full", "posting", "view"]


class RoleIn(CamelModel):
    role: Literal["full", "posting", "view"]


def _invite_email(to: str, name: str, company: str, by: str, role: str) -> Email:
    from app.core.config import get_settings

    site = get_settings().site_url.rstrip("/")
    what = {"full": "full access", "posting": "posting jobs", "view": "view only"}[role]
    text = (f"Hi {name or 'there'},\n\n{by} added you to {company}'s team on Nm7 ({what}).\n\nSign in with this email "
            f"address at {site}/company; we email you a code, no password.\n\nNm7 · nm7.si")  # fmt: skip
    html = (f'<div style="{STYLE}"><p>Hi {name or "there"},</p><p>{by} added you to <b>{company}</b>’s team on Nm7 '
            f'({what}).</p><p><a href="{site}/company">Sign in with this email address</a>: we email you a code, '
            "no password.</p></div>")  # fmt: skip
    return Email(to, name, f"You’re on {company}’s team on Nm7", text, html)


@router.post("/{cid}/team", status_code=201)
async def add_member(cid: str, body: TeamIn, db: DB, mailer: MailerDep,
                     x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:  # fmt: skip
    acc, c, _ = await company_for(db, cid, x_recruiter_account, MANAGE)
    if problem := checks.email_problem(body.email, company=False):
        raise ApiError(400, "bad_email", problem)
    if any(m["email_lc"] == body.email for m in c["members"]):
        raise ApiError(409, "exists", "This person is already on the team.")
    if len(c["members"]) >= MAX_MEMBERS:
        raise ApiError(400, "too_many", f"A team can have up to {MAX_MEMBERS} admins.")
    c["members"].append({"email_lc": body.email, "name": body.name.strip(), "role": body.role, "status": "invited",
                         "at": now(), "added_by": acc["email_lc"]})  # fmt: skip
    await _save(db, c)
    await send_safely(
        mailer, _invite_email(body.email, body.name, c["details"]["legal_name"], acc["email_lc"], body.role)
    )
    await audit(
        db, None, "company.team_add", target=cid, data={"by": acc["email_lc"], "email": body.email, "role": body.role}
    )
    return company_out(c, acc["email_lc"])


def _target(c: dict[str, Any], email: str) -> dict[str, Any]:
    m = next((m for m in c["members"] if m["email_lc"] == email.lower()), None)
    if not m:
        raise ApiError(404, "not_found", "This person isn’t on the team.")
    if m["role"] == "main":
        raise ApiError(403, "main_admin", "The main admin can’t be changed or removed.")
    return m


@router.put("/{cid}/team/{email}")
async def set_role(cid: str, email: str, body: RoleIn, db: DB,
                   x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:  # fmt: skip
    acc, c, _ = await company_for(db, cid, x_recruiter_account, MANAGE)
    m = _target(c, email)
    old, m["role"] = m["role"], body.role
    await _save(db, c)
    await audit(db, None, "company.team_role", target=cid, data={"by": acc["email_lc"], "email": m["email_lc"],
                                                                 "from": old, "to": body.role})  # fmt: skip
    return company_out(c, acc["email_lc"])


@router.delete("/{cid}/team/{email}")
async def remove_member(cid: str, email: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account, MANAGE)
    m = _target(c, email)
    c["members"] = [x for x in c["members"] if x is not m]
    await _save(db, c)
    await audit(db, None, "company.team_remove", target=cid, data={"by": acc["email_lc"], "email": m["email_lc"]})
    return company_out(c, acc["email_lc"])


# ---------- submit for review ----------


class SubmitIn(CamelModel):
    accept_terms: bool


@router.post("/{cid}/submit")
async def submit(cid: str, body: SubmitIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account, MANAGE)
    if not body.accept_terms:
        raise ApiError(400, "terms", "Please accept the terms to send your company for review.")
    if trust_of(c) == "unverified":
        raise ApiError(400, "emails", "Confirm your company email first (step 3).")
    state = (c.get("review") or {}).get("state")
    if state in ("pending", "approved"):
        raise ApiError(
            409, "already", "Your company is already with our team." if state == "pending" else "Already verified."
        )
    t = now()
    c["terms_at"] = t
    c["review"] = {"state": "pending", "submitted_at": t}
    await _save(db, c)
    await audit(
        db, None, "company.submit", target=cid, data={"by": acc["email_lc"], "flags": [f["code"] for f in c["flags"]]}
    )
    return company_out(c, acc["email_lc"])


@router.get("/{cid}/room")
async def room(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    """What this company may post now (trust level and limits)."""
    from app.companies.limits import posting_room

    _, c, _ = await company_for(db, cid, x_recruiter_account)
    return await posting_room(db, c)
