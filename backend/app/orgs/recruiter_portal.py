"""Recruiter portal (colleges, Phase 3): invites by group, an emailed one-time code, search, job match and a
shortlist board. It upgrades recruiter links (app/orgs/recruiter.py), which stay as they were.

Staff (coordinators; `recruiter_links` feature; limit `recruiters`: active invites, 1 on Drive, unlimited on Campus):
  GET    /api/org/{org_id}/recruiter-invites                      list (with views, downloads, shortlisted)
  POST   /api/org/{org_id}/recruiter-invites                      company, recruiter name, email, groups, branches,
                                                                  expiry, permissions → the link (shown once)
  POST   …/recruiter-invites/{id}/extend · …/{id}/revoke
  GET    …/recruiter-invites/{id}/activity                         every view, download, search and stage change
  PUT    /api/org/{org_id}/recruiter-settings {showShortlist}      students see "Shortlisted by <company>"

Recruiter (no Nm7 account: the secure link + a 6-digit code emailed to the invited address, then a 12-hour session
sent in the X-Recruiter-Session header):
  GET    /api/recruiter/{token}                      who the invite is for (company, organization), or 410
  POST   /api/recruiter/{token}/code                 email the code (5 a day)
  POST   /api/recruiter/{token}/session {code}       → {session}
  GET    /api/recruiter/{token}/candidates?…         search and filters; with ?jd= (Campus) a job match score each
  POST   /api/recruiter/{token}/match {jd}           job match mode: every visible student scored, best first
  GET    /api/recruiter/{token}/candidates/{cid}     one resume, in the college format
  PUT    /api/recruiter/{token}/board/{cid}          {stage, note}: shortlisted / interview / selected / rejected
  POST   /api/recruiter/{token}/downloads            shortlisted (or chosen) resumes for a ZIP / combined PDF
  GET    /api/recruiter/{token}/board.csv            the board as CSV

Who a recruiter sees, on every request: approved members of the invite's groups (and branches) who ticked "Allow
recruiter sharing", in groups that share with recruiters, of an organization that still has the feature. Withdrawing
consent, leaving or being rejected removes a student at once. Contact details are hidden unless allowed (or allowed
only after shortlisting); the Personal Information section and the photo go with them; ID numbers never. Every view,
download, search and stage change is in the organization's Activity log (the invite id, never an IP address).
"""

import csv
import io
import re
import secrets
from datetime import datetime, time, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Header, Query, Request, Response
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.billing.subscription import check_limit
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import AUDIT_LOG, DB, ORG_GROUPS, ORGANIZATIONS, RECRUITER_INVITES
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.exports import CSV_BOM, csv_safe
from app.core.filenames import file_name as build_file_name
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, new_code, same
from app.core.time import IST, now
from app.jobsearch import skills as dictionary
from app.jobsearch.parse import parse
from app.jobsearch.score import score as job_score
from app.me.service import ms
from app.orgs.ats import all_skills, ats_score, printed
from app.orgs.branding import brands_for
from app.orgs.placement import _branch_key
from app.orgs.recruiter import EXPIRED, NO_STORE, _clean, eligible, recruiter_data
from app.orgs.scope import NOT_FOUND, OrgScope, features_of, require_feature
from app.orgs.service import shared_rows

staff = APIRouter(prefix="/api/org/{org_id}", tags=["recruiter portal"])
public = APIRouter(prefix="/api/recruiter/{token}", tags=["recruiter portal"])

MAX_DAYS = 120
SESSION_HOURS = 12
CODE_MINUTES = 10
STAGES = ("shortlisted", "interview", "selected", "rejected")
Stage = Literal["shortlisted", "interview", "selected", "rejected", "none"]
CREATE_RULES = [(30, timedelta(hours=1))]
REQUEST_RULES = [(900, timedelta(hours=1))]  # every request to one invite
IP_RULES = [(600, timedelta(hours=1))]
CODE_SEND_RULES = [(5, timedelta(days=1))]
CODE_TRY_RULES = [(8, timedelta(minutes=15))]
DOWNLOAD_RULES = [(20, timedelta(hours=1)), (60, timedelta(days=1))]  # download requests per invite
DOWNLOAD_MAX = 200  # resumes in one download


# ---------- models ----------
class InviteIn(CamelModel):
    company: str = Field(min_length=1, max_length=80)
    recruiter_name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
    group_ids: list[str] = Field(min_length=1, max_length=100)
    branches: list[str] = Field(default_factory=list, max_length=50)  # empty: every branch
    expires_on: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    allow_pdf: bool = True
    contact: Literal["hidden", "shown", "after_shortlist"] = "hidden"

    @field_validator("company", "recruiter_name")
    @classmethod
    def _tidy(cls, v):
        return " ".join(v.split())

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        return v.strip()


class ExtendIn(CamelModel):
    expires_on: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class SettingsIn(CamelModel):
    show_shortlist: bool


class CodeIn(CamelModel):
    code: str = Field(min_length=4, max_length=10)


class MatchIn(CamelModel):
    jd: str = Field(min_length=30, max_length=20_000)


class StageIn(CamelModel):
    stage: Stage
    note: str = Field("", max_length=500)


class DownloadIn(CamelModel):
    ids: list[str] | None = Field(None, max_length=DOWNLOAD_MAX)  # None: everyone on the shortlist board


# ---------- helpers ----------
def _hash(kind: str, *parts: str) -> str:
    return keyed_hash(f"recruiter-{kind}", *parts)


def _cid(invite_id: str, membership_id: str) -> str:
    """What a recruiter sees as a student's id: stable on one invite, unrelated across invites."""
    return _hash("cid", invite_id, membership_id)[:20]


def _until(day: str) -> datetime:
    try:
        d = datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        raise ApiError(400, "bad_date", "Give the expiry date like 2026-12-31.") from None
    today = now().astimezone(IST).date()
    if d < today or d > today + timedelta(days=MAX_DAYS):
        raise ApiError(400, "bad_expiry", f"Choose an expiry date from today up to {MAX_DAYS} days ahead.")
    return datetime.combine(d, time(23, 59, 59), IST)


def _state(inv: dict[str, Any]) -> str:
    if inv.get("revoked_at"):
        return "revoked"
    return "expired" if inv["expires_at"] <= now() else "active"


def invite_out(inv: dict[str, Any], groups: dict[str, str] | None = None) -> dict[str, Any]:
    board = inv.get("board") or {}
    return {
        "id": inv["_id"],
        "company": inv["company"],
        "recruiterName": inv["recruiter_name"],
        "email": inv["email"],
        "groupIds": inv["group_ids"],
        "groups": [groups.get(g, "") for g in inv["group_ids"]] if groups else [],
        "branches": inv.get("branches") or [],
        "expiresAt": ms(inv["expires_at"]),
        "createdAt": ms(inv["created_at"]),
        "state": _state(inv),
        "allowPdf": inv["allow_pdf"],
        "contact": inv["contact"],
        "views": inv.get("views", 0),
        "downloads": inv.get("downloads", 0),
        "shortlisted": sum(1 for b in board.values() if b.get("stage") in STAGES),
        "lastSeenAt": ms(inv.get("last_seen_at")),
    }


def _grade(edu: list[dict[str, Any]]) -> tuple[float | None, float | None]:
    """(CGPA out of 10, percentage) from the education grades, best first."""
    cgpa = pct = None
    for e in edu:
        g = str(e.get("grade") or "")
        m = re.search(r"(\d+(?:\.\d+)?)\s*(%|percent)", g, re.I)
        if m and pct is None:
            pct = float(m.group(1))
            continue
        m = re.search(r"(\d+(?:\.\d+)?)(?:\s*/\s*10)?", g)
        if m and cgpa is None and float(m.group(1)) <= 10:
            cgpa = float(m.group(1))
    return cgpa, pct


def _year(edu: list[dict[str, Any]]) -> int | None:
    years = [int(m.group(0)) for e in edu for m in [re.search(r"(19|20)\d\d", str(e.get("to") or ""))] if m]
    return max(years) if years else None


def profile(r: dict[str, Any]) -> dict[str, Any]:
    """What search and the cards use, from the shared resume as it prints."""
    d = printed(r["_data"])
    edu = [e for e in d.get("edu") or [] if isinstance(e, dict) and (e.get("degree") or e.get("institution"))]
    exp = [e for e in d.get("exp") or [] if isinstance(e, dict) and (e.get("role") or e.get("company"))]
    proj = [x for x in d.get("proj") or [] if isinstance(x, dict) and x.get("title")]
    # never an ID number: a value holding one is dropped whole (as on recruiter links)
    certs = [_clean(c.get("name")) for c in d.get("certs") or [] if isinstance(c, dict) and _clean(c.get("name"))]
    langs = [_clean(x.get("name")) for x in d.get("langs") or [] if isinstance(x, dict) and _clean(x.get("name"))]
    text = "\n".join([", ".join(all_skills(d)), *(str(x.get("tech") or "") for x in proj), *certs])
    skills = dictionary.find(text)
    cgpa, pct = _grade(edu)
    fields = r["fields"]
    loc_key = next(
        (f["key"] for f in r["field_defs"] if re.search(r"locat|city|prefer", f"{f['key']} {f['label']}", re.I)), None
    )
    return {
        "branch": _clean(fields.get(_branch_key(r["field_defs"]) or "")),
        "cgpa": cgpa,
        "percentage": pct,
        "year": _year(edu),
        "location": _clean(fields.get(loc_key)) if loc_key else "",
        "ats": ats_score(r["_data"])["score"],
        "internship": bool(exp),
        "projects": bool(proj),
        "certs": certs,
        "langs": langs,
        "skills": skills,
        "headline": _clean((d.get("personal") or {}).get("headline")),
    }


async def visible(db, inv: dict[str, Any]) -> list[dict[str, Any]]:
    """The students this recruiter may see right now (with their resumes)."""
    rows = await shared_rows(db, {"org_id": inv["org_id"], "group_id": {"$in": inv["group_ids"]}}, with_data=True)
    groups = {g["_id"]: g async for g in db[ORG_GROUPS].find({"_id": {"$in": inv["group_ids"]}})}
    orgs = {o["_id"]: o async for o in db[ORGANIZATIONS].find({"_id": inv["org_id"]})}
    out = []
    for r in rows:
        if not eligible(r, groups, orgs):
            continue
        r["_profile"] = profile(r)
        if inv.get("branches") and r["_profile"]["branch"] not in inv["branches"]:
            continue
        out.append(r)
    return out


def _contact_ok(inv: dict[str, Any], r: dict[str, Any]) -> bool:
    if inv["contact"] == "shown":
        return True
    stage = ((inv.get("board") or {}).get(r["membership_id"]) or {}).get("stage")
    return inv["contact"] == "after_shortlist" and stage in STAGES


def card(inv: dict[str, Any], r: dict[str, Any], match: int | None = None) -> dict[str, Any]:
    p = r["_profile"]
    b = (inv.get("board") or {}).get(r["membership_id"]) or {}
    contact = _contact_ok(inv, r)
    return {
        "id": _cid(inv["_id"], r["membership_id"]),
        "name": r["name"],
        "headline": p["headline"],
        "group": r["group_name"],
        "branch": p["branch"],
        "cgpa": p["cgpa"],
        "percentage": p["percentage"],
        "year": p["year"],
        "ats": p["ats"],
        "internship": p["internship"],
        "projects": p["projects"],
        "skills": p["skills"][:8],
        "certs": p["certs"][:5],
        "langs": p["langs"][:5],
        "match": match,
        "stage": b.get("stage") or "none",
        "note": b.get("note") or "",
        **({"email": r["email"], "phone": r["phone"]} if contact else {}),
    }


def matches(r: dict[str, Any], f: dict[str, Any]) -> bool:
    p = r["_profile"]
    if f.get("skills"):
        have = set(p["skills"]) | {s.lower() for s in p["skills"]}
        for s in f["skills"]:
            c = dictionary.canonical(s) or s.strip()
            if c not in have and c.lower() not in have:
                return False
    if f.get("branch") and p["branch"] != f["branch"]:
        return False
    if f.get("cgpa_min") is not None and (p["cgpa"] is None or p["cgpa"] < f["cgpa_min"]):
        return False
    if f.get("cgpa_max") is not None and (p["cgpa"] is None or p["cgpa"] > f["cgpa_max"]):
        return False
    if f.get("year") and p["year"] != f["year"]:
        return False
    if f.get("location") and f["location"].lower() not in p["location"].lower():
        return False
    if f.get("ats_min") is not None and p["ats"] < f["ats_min"]:
        return False
    if f.get("internship") and not p["internship"]:
        return False
    if f.get("projects") and not p["projects"]:
        return False
    if f.get("cert") and not any(f["cert"].lower() in c.lower() for c in p["certs"]):
        return False
    if f.get("language") and not any(f["language"].lower() == x.lower() for x in p["langs"]):
        return False
    if f.get("q"):
        q = f["q"].lower()
        if q not in r["name"].lower() and q not in p["headline"].lower():
            return False
    return True


# ---------- staff ----------
async def _org(db, scope) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    require_feature(o, "recruiter_links")
    return o


async def _invite(db, scope, invite_id: str) -> dict[str, Any]:
    inv = await db[RECRUITER_INVITES].find_one({"_id": invite_id, "org_id": scope.org_id})
    if not inv or (scope.group_ids is not None and not set(inv["group_ids"]) <= set(scope.group_ids)):
        raise NOT_FOUND
    return inv


def _email(inv: dict[str, Any], org_name: str, url: str) -> Email:
    from html import escape

    until = inv["expires_at"].astimezone(IST).strftime("%-d %b %Y")
    text = (
        f"Hello {inv['recruiter_name']},\n\n{org_name} invited you to see its students' resumes on Nm7"
        f" for {inv['company']}.\n\nOpen your invite (you'll get a one-time code by email to sign in):\n{url}\n\n"
        f"The invite works until {until}. Only students who agreed to share their resume with recruiters are shown."
        "\n\nNm7 · nm7.si"
    )
    html = (
        f'<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5"><p>Hello '
        f"{escape(inv['recruiter_name'])},</p><p><b>{escape(org_name)}</b> invited you to see its students’ resumes "
        f'on Nm7 for {escape(inv["company"])}.</p><p><a href="{escape(url)}">Open your invite</a> — you’ll get a '
        f"one-time code by email to sign in.</p><p>The invite works until {escape(until)}. Only students who agreed "
        "to share their resume with recruiters are shown.</p><p>Nm7 · nm7.si</p></div>"
    )
    return Email(inv["email"], inv["recruiter_name"], f"{org_name} invited you to see student resumes", text, html)


@staff.get("/recruiter-invites")
async def list_invites(db: DB, scope: OrgScope) -> dict[str, Any]:
    o = await _org(db, scope)
    invites = await db[RECRUITER_INVITES].find({"org_id": scope.org_id}).sort("created_at", -1).to_list(200)
    if scope.group_ids is not None:
        invites = [i for i in invites if set(i["group_ids"]) <= set(scope.group_ids)]
    names = {g["_id"]: g["name"] async for g in db[ORG_GROUPS].find({"org_id": scope.org_id}, {"name": 1})}
    return {
        "invites": [invite_out(i, names) for i in invites],
        "showShortlist": bool((o.get("recruiter_settings") or {}).get("show_shortlist")),
        "jobMatch": features_of(o)["recruiter_job_match"],
    }


@staff.post("/recruiter-invites", status_code=201)
async def create_invite(body: InviteIn, request: Request, db: DB, mailer: MailerDep, scope: OrgScope) -> dict[str, Any]:
    o = await _org(db, scope)
    scope.require("manage")
    await rate_limit.check(db, f"rinvite-create:{scope.actor_id}", CREATE_RULES)
    await rate_limit.record(db, f"rinvite-create:{scope.actor_id}")
    for gid in body.group_ids:
        g = await scope.group(db, gid)
        if not g.get("settings", {}).get("share_with_recruiters"):
            raise ApiError(400, "group_not_shared", f"“{g['name']}” doesn’t share with recruiters. Turn it on first.")
    await check_limit(db, o, "recruiters", bypass=not scope.is_staff)
    token = secrets.token_urlsafe(32)
    iid = new_id()
    inv = {
        "_id": iid,
        "org_id": scope.org_id,
        "company": body.company,
        "recruiter_name": body.recruiter_name,
        "email": body.email,
        "email_lc": body.email.lower(),
        "group_ids": sorted(set(body.group_ids)),
        "branches": sorted({" ".join(b.split()) for b in body.branches if b.strip()}),
        "expires_at": _until(body.expires_on),
        "revoked_at": None,
        "allow_pdf": body.allow_pdf,
        "contact": body.contact,
        "token_hash": _hash("token", token),
        "board": {},
        "views": 0,
        "downloads": 0,
        "sessions": [],
        "created_by": scope.actor_id,
        "created_at": now(),
    }
    await db[RECRUITER_INVITES].insert_one(inv)
    url = f"{get_settings().site_url}/recruiter/{token}"
    sent = await send_safely(mailer, _email(inv, o["name"], url))
    data = scope.audit_data(company=body.company, groups=inv["group_ids"], contact=body.contact, pdf=body.allow_pdf)
    await audit(db, scope.actor_id, "recruiter_invite", target=iid, data=data, ip=client_ip(request))
    return {**invite_out(inv), "url": url, "emailSent": sent}


@staff.post("/recruiter-invites/{invite_id}/extend")
async def extend_invite(invite_id: str, body: ExtendIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await _org(db, scope)
    inv = await _invite(db, scope, invite_id)
    scope.require("manage")
    if inv.get("revoked_at"):
        raise ApiError(400, "revoked", "This invite was revoked. Make a new one instead.")
    inv["expires_at"] = _until(body.expires_on)
    await db[RECRUITER_INVITES].update_one({"_id": invite_id}, {"$set": {"expires_at": inv["expires_at"]}})
    await audit(
        db,
        scope.actor_id,
        "recruiter_invite_extend",
        target=invite_id,
        data=scope.audit_data(until=body.expires_on),
        ip=client_ip(request),
    )
    return invite_out(inv)


@staff.post("/recruiter-invites/{invite_id}/revoke")
async def revoke_invite(invite_id: str, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await _org(db, scope)
    inv = await _invite(db, scope, invite_id)
    scope.require("manage")
    if not inv.get("revoked_at"):
        inv["revoked_at"] = now()
        await db[RECRUITER_INVITES].update_one(
            {"_id": invite_id}, {"$set": {"revoked_at": inv["revoked_at"], "sessions": []}}
        )
        await audit(
            db,
            scope.actor_id,
            "recruiter_invite_revoke",
            target=invite_id,
            data=scope.audit_data(),
            ip=client_ip(request),
        )
    return invite_out(inv)


@staff.get("/recruiter-invites/{invite_id}/activity")
async def invite_activity(invite_id: str, db: DB, scope: OrgScope) -> list[dict[str, Any]]:
    await _org(db, scope)
    await _invite(db, scope, invite_id)
    out = []
    async for a in db[AUDIT_LOG].find({"target": invite_id}).sort("_id", -1).limit(300):
        d = a.get("data") or {}
        out.append(
            {
                "action": a["action"],
                "at": ms(a["at"]),
                "count": d.get("count"),
                "stage": d.get("stage"),
                "filters": d.get("filters"),
                "student": d.get("student"),
            }
        )
    return out


@staff.put("/recruiter-settings")
async def recruiter_settings(body: SettingsIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await _org(db, scope)
    scope.require("manage")
    await db[ORGANIZATIONS].update_one(
        {"_id": scope.org_id}, {"$set": {"recruiter_settings.show_shortlist": body.show_shortlist}}
    )
    await audit(
        db,
        scope.actor_id,
        "recruiter_settings",
        target=scope.org_id,
        data=scope.audit_data(show_shortlist=body.show_shortlist),
        ip=client_ip(request),
    )
    return {"showShortlist": body.show_shortlist}


# ---------- the recruiter ----------
async def _open(db, token: str, request: Request) -> dict[str, Any]:
    if len(token) > 100:
        raise NOT_FOUND
    th = _hash("token", token)
    ip_key = f"rportal-ip:{keyed_hash('ip', client_ip(request) or '-')[:24]}"
    for key, rules in ((f"rportal:{th[:24]}", REQUEST_RULES), (ip_key, IP_RULES)):
        await rate_limit.check(db, key, rules)
        await rate_limit.record(db, key)
    inv = await db[RECRUITER_INVITES].find_one({"token_hash": th})
    if not inv:
        raise NOT_FOUND
    o = await db[ORGANIZATIONS].find_one({"_id": inv["org_id"]})
    if not o or not features_of(o)["recruiter_links"] or o.get("status") == "archived" or _state(inv) != "active":
        raise EXPIRED
    inv["_org"] = o
    return inv


async def _signed_in(db, token: str, request: Request, session: str | None) -> dict[str, Any]:
    inv = await _open(db, token, request)
    sh = _hash("session", inv["_id"], session or "")
    t = now()
    if not session or not any(same(s["hash"], sh) and s["exp"] > t for s in inv.get("sessions") or []):
        raise ApiError(401, "session_required", "Please sign in with the code we email you.")
    return inv


def _audit(inv: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {"orgs": [inv["org_id"]], "invite": inv["_id"], "company": inv["company"], **extra}


@public.get("")
async def portal_info(token: str, request: Request, response: Response, db: DB) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    inv = await _open(db, token, request)
    email = inv["email"]
    user, _, domain = email.partition("@")
    return {
        "company": inv["company"],
        "recruiterName": inv["recruiter_name"],
        "orgName": inv["_org"]["name"],
        "emailHint": f"{user[:2]}{'•' * max(1, len(user) - 2)}@{domain}",
        "expiresAt": ms(inv["expires_at"]),
    }


@public.post("/code")
async def send_code(token: str, request: Request, response: Response, db: DB, mailer: MailerDep) -> dict[str, Any]:
    from html import escape

    response.headers.update(NO_STORE)
    inv = await _open(db, token, request)
    key = f"rportal-code-send:{inv['_id']}"
    await rate_limit.check(db, key, CODE_SEND_RULES, "Too many codes today. Please try again tomorrow.")
    await rate_limit.record(db, key)
    code = new_code()
    await db[RECRUITER_INVITES].update_one(
        {"_id": inv["_id"]},
        {"$set": {"code_hash": _hash("code", inv["_id"], code), "code_exp": now() + timedelta(minutes=CODE_MINUTES)}},
    )
    text = (
        f"Your Nm7 sign-in code for {inv['_org']['name']}'s student resumes: {code}\n\nIt works for "
        f"{CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.\n\nNm7 · nm7.si"
    )
    html = (
        f'<div style="font-family:Arial,sans-serif;font-size:15px"><p>Your Nm7 sign-in code for '
        f'{escape(inv["_org"]["name"])}’s student resumes:</p><p style="font-size:26px;font-weight:700;'
        f'letter-spacing:4px">{code}</p><p>It works for {CODE_MINUTES} minutes.</p></div>'
    )
    sent = await send_safely(
        mailer, Email(inv["email"], inv["recruiter_name"], f"Your sign-in code: {code}", text, html)
    )
    return {"sent": sent, "emailHint": (await portal_info(token, request, response, db))["emailHint"]}


@public.post("/session")
async def start_session(token: str, body: CodeIn, request: Request, response: Response, db: DB) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    inv = await _open(db, token, request)
    key = f"rportal-code-try:{inv['_id']}"
    await rate_limit.check(db, key, CODE_TRY_RULES, "Too many wrong codes. Please wait 15 minutes.")
    ok = (
        inv.get("code_hash")
        and inv.get("code_exp")
        and inv["code_exp"] > now()
        and same(_hash("code", inv["_id"], body.code.strip()), inv["code_hash"])
    )
    if not ok:
        await rate_limit.record(db, key)
        raise ApiError(401, "wrong_code", "That code is wrong or has expired. Ask for a new one.")
    session = secrets.token_urlsafe(32)
    t = now()
    sessions = [s for s in inv.get("sessions") or [] if s["exp"] > t][-4:]
    sessions.append({"hash": _hash("session", inv["_id"], session), "exp": t + timedelta(hours=SESSION_HOURS)})
    await db[RECRUITER_INVITES].update_one(
        {"_id": inv["_id"]}, {"$set": {"sessions": sessions, "code_hash": None, "code_exp": None}}
    )
    await audit(db, None, "recruiter_login", target=inv["_id"], data=_audit(inv), ip=None)
    return {"session": session, "expiresInHours": SESSION_HOURS}


def _filters(**kw: Any) -> dict[str, Any]:
    return {k: v for k, v in kw.items() if v not in (None, "", [], False)}


@public.get("/candidates")
async def search(
    token: str,
    request: Request,
    response: Response,
    db: DB,
    x_recruiter_session: str | None = Header(None),
    skills: str | None = Query(None, max_length=300),
    branch: str | None = Query(None, max_length=60),
    cgpa_min: float | None = Query(None, alias="cgpaMin", ge=0, le=10),
    cgpa_max: float | None = Query(None, alias="cgpaMax", ge=0, le=10),
    year: int | None = Query(None, ge=1990, le=2100),
    location: str | None = Query(None, max_length=60),
    ats_min: int | None = Query(None, alias="atsMin", ge=0, le=100),
    internship: bool = False,
    projects: bool = False,
    cert: str | None = Query(None, max_length=60),
    language: str | None = Query(None, max_length=40),
    q: str | None = Query(None, max_length=60),
    stage: str | None = Query(None, max_length=20),
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    inv = await _signed_in(db, token, request, x_recruiter_session)
    f = _filters(
        skills=[s for s in (skills or "").split(",") if s.strip()],
        branch=branch,
        cgpa_min=cgpa_min,
        cgpa_max=cgpa_max,
        year=year,
        location=location,
        ats_min=ats_min,
        internship=internship,
        projects=projects,
        cert=cert,
        language=language,
        q=q,
    )
    rows = await visible(db, inv)
    shown = [r for r in rows if matches(r, f)]
    cards = [card(inv, r) for r in shown]
    if stage:
        cards = [c for c in cards if c["stage"] == stage]
    await db[RECRUITER_INVITES].update_one({"_id": inv["_id"]}, {"$inc": {"views": 1}, "$set": {"last_seen_at": now()}})
    await audit(
        db, None, "recruiter_search", target=inv["_id"], data=_audit(inv, count=len(cards), filters=sorted(f)), ip=None
    )
    branches = sorted({r["_profile"]["branch"] for r in rows if r["_profile"]["branch"]})
    return {
        "company": inv["company"],
        "orgName": inv["_org"]["name"],
        "expiresAt": ms(inv["expires_at"]),
        "allowPdf": inv["allow_pdf"],
        "contact": inv["contact"],
        "jobMatch": features_of(inv["_org"])["recruiter_job_match"],
        "total": len(rows),
        "branches": branches,
        "candidates": sorted(cards, key=lambda c: c["name"].lower()),
    }


@public.post("/match")
async def job_match(
    token: str,
    body: MatchIn,
    request: Request,
    response: Response,
    db: DB,
    x_recruiter_session: str | None = Header(None),
) -> dict[str, Any]:
    """Job match mode (Campus): the job post is read by the same rules as the students' job match, and every visible
    student gets a score out of 100, best first."""
    response.headers.update(NO_STORE)
    inv = await _signed_in(db, token, request, x_recruiter_session)
    if not features_of(inv["_org"])["recruiter_job_match"]:
        raise ApiError(402, "plan_feature", "Job match mode is in the Campus plan.")
    p = parse(body.jd)
    if not (p.must or p.nice or p.title):
        raise ApiError(400, "jd_unreadable", "We couldn’t read skills from this job description. Paste the full post.")
    rows = await visible(db, inv)
    scored = []
    for r in rows:
        s = job_score(p, r["_data"])
        scored.append(
            card(inv, r, match=s["score"])
            | {
                "found": [i["name"] for i in s["items"] if i["status"] in ("found", "weak")][:6],
                "missing": [i["name"] for i in s["items"] if i["status"] == "missing"][:6],
                "_found": sum(1 for i in s["items"] if i["group"] == "must" and i["status"] == "found"),
                "_missing": sum(1 for i in s["items"] if i["status"] == "missing"),
            }
        )
    # best first; a tie goes to more must-haves found, then fewer missing, then the ATS score
    scored.sort(key=lambda c: (-(c["match"] or 0), -c.pop("_found"), c.pop("_missing"), -c["ats"], c["name"].lower()))
    await audit(db, None, "recruiter_match", target=inv["_id"], data=_audit(inv, count=len(scored)), ip=None)
    return {"title": p.title, "company": p.company, "must": p.must, "candidates": scored}


async def _one(db, inv: dict[str, Any], cid: str) -> dict[str, Any]:
    for r in await visible(db, inv):
        if _cid(inv["_id"], r["membership_id"]) == cid:
            return r
    raise NOT_FOUND


@public.get("/candidates/{cid}")
async def view_one(
    token: str, cid: str, request: Request, response: Response, db: DB, x_recruiter_session: str | None = Header(None)
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    inv = await _signed_in(db, token, request, x_recruiter_session)
    r = await _one(db, inv, cid)
    brand = (await brands_for(db, [r["group_id"]])).get(r["group_id"])
    await audit(db, None, "recruiter_view", target=inv["_id"], data=_audit(inv, count=1, student=cid), ip=None)
    return {
        **card(inv, r),
        "data": recruiter_data(r, _contact_ok(inv, r)),
        "brand": brand,
        "roll": r["roll"],
        "stamp": _stamp(inv),
    }


def _stamp(inv: dict[str, Any]) -> str:
    until = inv["expires_at"].astimezone(IST).strftime("%-d %b %Y")
    return f"Shared with {inv['company']} via Nm7 · expires {until}"


@public.put("/board/{cid}")
async def set_stage(
    token: str,
    cid: str,
    body: StageIn,
    request: Request,
    response: Response,
    db: DB,
    x_recruiter_session: str | None = Header(None),
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    inv = await _signed_in(db, token, request, x_recruiter_session)
    r = await _one(db, inv, cid)
    mid = r["membership_id"]
    if body.stage == "none":
        await db[RECRUITER_INVITES].update_one({"_id": inv["_id"]}, {"$unset": {f"board.{mid}": ""}})
        inv.setdefault("board", {}).pop(mid, None)
    else:
        entry = {"stage": body.stage, "note": " ".join(body.note.split()), "at": now()}
        await db[RECRUITER_INVITES].update_one({"_id": inv["_id"]}, {"$set": {f"board.{mid}": entry}})
        inv.setdefault("board", {})[mid] = entry
    await audit(
        db, None, "recruiter_stage", target=inv["_id"], data=_audit(inv, stage=body.stage, student=cid), ip=None
    )
    return card(inv, r)


@public.post("/downloads")
async def downloads(
    token: str,
    body: DownloadIn,
    request: Request,
    response: Response,
    db: DB,
    x_recruiter_session: str | None = Header(None),
) -> dict[str, Any]:
    """The resumes for a ZIP / combined PDF (drawn in the recruiter's browser, in the college format): the chosen
    students, or everyone on the board who isn't rejected. Rate-limited; only when the invite allows PDFs."""
    response.headers.update(NO_STORE)
    inv = await _signed_in(db, token, request, x_recruiter_session)
    if not inv["allow_pdf"]:
        raise ApiError(403, "downloads_off", "Downloads are switched off for this invite. You can view the resumes.")
    key = f"rportal-dl:{inv['_id']}"
    await rate_limit.check(db, key, DOWNLOAD_RULES, "Too many downloads. Please try again later.")
    board = inv.get("board") or {}
    rows = await visible(db, inv)
    if body.ids is None:  # the board, without those marked rejected
        rows = [r for r in rows if (board.get(r["membership_id"]) or {}).get("stage") in STAGES[:3]]
    else:
        want = set(body.ids)
        rows = [r for r in rows if _cid(inv["_id"], r["membership_id"]) in want]
    if not rows:
        raise ApiError(400, "nothing_to_download", "Nobody to download: shortlist students first.")
    await rate_limit.record(db, key)
    brands = await brands_for(db, [r["group_id"] for r in rows])
    await db[RECRUITER_INVITES].update_one({"_id": inv["_id"]}, {"$inc": {"downloads": 1}})
    await audit(db, None, "recruiter_download", target=inv["_id"], data=_audit(inv, count=len(rows)), ip=None)
    return {
        "stamp": _stamp(inv),
        "cover": {
            "brand": next(iter(brands), None),
            "batches": sorted({r["group_name"] for r in rows}),
            "branches": sorted({r["_profile"]["branch"] for r in rows if r["_profile"]["branch"]}),
        },
        "brands": brands,
        "items": [
            {
                "id": _cid(inv["_id"], r["membership_id"]),
                "name": r["name"],
                "roll": r["roll"],
                "data": recruiter_data(r, _contact_ok(inv, r)),
                "brand": r["group_id"] if r["group_id"] in brands else None,
            }
            for r in rows
        ],
    }


@public.get("/board.csv")
async def board_csv(token: str, request: Request, db: DB, x_recruiter_session: str | None = Header(None)) -> Response:
    inv = await _signed_in(db, token, request, x_recruiter_session)
    board = inv.get("board") or {}
    rows = [r for r in await visible(db, inv) if (board.get(r["membership_id"]) or {}).get("stage") in STAGES]
    buf = io.StringIO()
    w = csv.writer(buf)
    contact_cols = inv["contact"] != "hidden"
    w.writerow(
        ["Name", "Branch", "CGPA", "Passing year", "Stage", "Note", *(["Email", "Phone"] if contact_cols else [])]
    )
    for r in sorted(rows, key=lambda r: (STAGES.index(board[r["membership_id"]]["stage"]), r["name"].lower())):
        c = card(inv, r)
        cells = [c["name"], c["branch"], c["cgpa"] or "", c["year"] or "", c["stage"], c["note"]]
        if contact_cols:
            cells += [c.get("email", ""), c.get("phone", "")]
        w.writerow([csv_safe(str(x)) for x in cells])
    await audit(db, None, "recruiter_download", target=inv["_id"], data=_audit(inv, count=len(rows), csv=True), ip=None)
    return Response(
        CSV_BOM + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            **NO_STORE,
            "Content-Disposition": f'attachment; filename="{build_file_name([inv["company"], "shortlist"], "csv")}"',
        },
    )
