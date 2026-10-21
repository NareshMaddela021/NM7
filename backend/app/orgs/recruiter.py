"""Recruiter share links (Nm7 for Organizations, Phase 3C): a coordinator sends chosen resumes to a recruiter as a
safe link — no account needed, expiring, revocable, optionally behind a 6-digit access code.

Consent first: a group must use "Share with recruiters", and each member must have ticked "Allow <Org> to share my
resume with recruiters" (members who joined earlier are left out until they opt in). Only approved, opted-in members
can be added, and every request re-checks them, so someone who leaves, opts out or is rejected vanishes from every
link at once.

Staff:     POST /api/org/{org_id}/recruiter-links (from a selection or the current filters), GET …/recruiter-links,
           POST …/recruiter-links/{id}/extend, …/{id}/revoke. Needs the `recruiter_links` feature (else 404).
Recruiter: GET /api/recruit/{token} (the list), GET …/candidates/{cid} (one resume, to view), POST …/downloads
           (allowed links only), POST …/candidates/{cid}/interest (Interested). The access code goes in the
           X-Access-Code header. Responses are no-store; the page is noindex.

Contact details (email, phone, location and the whole Personal Information section: address, date of birth,
parents…) are hidden unless the coordinator chose to include them; group answers are only the ones chosen; ID numbers
are never included. Branded groups use the organization's template. The audit log
records the link id only — never the recruiter's IP address.
"""

import secrets
from datetime import datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, Header, Request, Response
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, ORG_GROUPS, ORGANIZATIONS, RECRUITER_LINKS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, new_code, same
from app.core.time import IST, now
from app.me.service import ms
from app.orgs.branding import brands_for
from app.orgs.router import Filters, _rows
from app.orgs.scope import NOT_FOUND, OrgScope, features_of, require_feature
from app.orgs.service import holds_id_number, printable, shared_rows

staff = APIRouter(prefix="/api/org/{org_id}/recruiter-links", tags=["recruiter links"])
public = APIRouter(prefix="/api/recruit/{token}", tags=["recruiter links"])

MAX_DAYS = 90
MAX_MEMBERS = 500
LINK_RULES = [(600, timedelta(hours=1))]  # every request to one link
IP_RULES = [(300, timedelta(hours=1))]  # per (hashed) address, across links
CODE_RULES = [(10, timedelta(minutes=15))]  # wrong access codes per link
CREATE_RULES = [(30, timedelta(hours=1))]
EXPIRED = ApiError(410, "link_expired", "This link has expired. Ask the organization for a new one.")
NO_STORE = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


# ---------- models ----------
class LinkIn(CamelModel):
    company: str = Field(min_length=1, max_length=80)
    label: str = Field("", max_length=60)
    days: int = Field(14, ge=1, le=MAX_DAYS)
    allow_downloads: bool = True
    include_contact: bool = False
    answer_keys: list[str] = Field(default_factory=list, max_length=20)
    access_code: bool = False
    ids: list[str] | None = Field(None, max_length=2000)  # a selection; else everything matching `filters`
    filters: Filters = Field(default_factory=Filters)

    @field_validator("company", "label")
    @classmethod
    def _tidy(cls, v):
        return " ".join(v.split())


class ExtendIn(CamelModel):
    days: int = Field(14, ge=1, le=MAX_DAYS)  # from today


class IdsIn(CamelModel):
    ids: list[str] | None = Field(None, max_length=MAX_MEMBERS)  # None: every candidate on the link


class InterestIn(CamelModel):
    interested: bool = True


# ---------- helpers ----------
def _token_hash(token: str) -> str:
    return keyed_hash("recruiter", token)


def _code_hash(link_id: str, code: str) -> str:
    return keyed_hash("recruiter-code", link_id, code)


def _cid(link_id: str, membership_id: str) -> str:
    """The id a recruiter sees for a candidate: stable on one link, unrelated across links (no membership ids)."""
    return keyed_hash("recruiter-candidate", link_id, membership_id)[:20]


def _until(days: int) -> datetime:
    return datetime.combine(now().astimezone(IST).date() + timedelta(days=days), time(23, 59, 59), IST)


def _state(link: dict[str, Any]) -> str:
    if link.get("revoked_at"):
        return "revoked"
    return "expired" if link["expires_at"] <= now() else "active"


def eligible(row: dict[str, Any], groups: dict[str, dict[str, Any]], orgs: dict[str, dict[str, Any]]) -> bool:
    """May this member be on a recruiter link right now? Approved, opted in, group shares, feature on."""
    g, o = groups.get(row["group_id"]), orgs.get(row["org_id"])
    return bool(
        row["approval"] == "approved"
        and row["recruiter_opt_in"]
        and g
        and g.get("settings", {}).get("share_with_recruiters")
        and o
        and features_of(o)["recruiter_links"]
        and o.get("status") != "archived"
    )


async def _context(db, rows: list[dict[str, Any]]) -> tuple[dict, dict]:
    groups = {g["_id"]: g async for g in db[ORG_GROUPS].find({"_id": {"$in": list({r["group_id"] for r in rows})}})}
    orgs = {o["_id"]: o async for o in db[ORGANIZATIONS].find({"_id": {"$in": list({r["org_id"] for r in rows})}})}
    return groups, orgs


async def live_rows(db, link: dict[str, Any], *, with_data: bool = False) -> list[dict[str, Any]]:
    """The link's candidates as of now: whoever left, opted out or was rejected since is gone.
    `with_data`: with the resumes (viewing / downloading); the list only needs the row fields."""
    q = {"_id": {"$in": link["membership_ids"]}, "org_id": link["org_id"]}
    rows = await shared_rows(db, q, with_data=with_data)
    groups, orgs = await _context(db, rows)
    order = {m: i for i, m in enumerate(link["membership_ids"])}
    return sorted((r for r in rows if eligible(r, groups, orgs)), key=lambda r: order.get(r["membership_id"], 0))


async def live_counts(db, links: list[dict[str, Any]]) -> dict[str, int]:
    """How many candidates each link shows right now (0 for expired / revoked links), the same as
    `len(live_rows(link))` for each, but from one set of queries for all the links instead of one set per link."""
    active = [lk for lk in links if _state(lk) == "active"]
    ids = sorted({m for lk in active for m in lk["membership_ids"]})
    if not ids:
        return {lk["_id"]: 0 for lk in links}
    q = {"_id": {"$in": ids}, "org_id": {"$in": sorted({lk["org_id"] for lk in active})}}
    rows = await shared_rows(db, q)
    groups, orgs = await _context(db, rows)
    live = {r["membership_id"]: r["org_id"] for r in rows if eligible(r, groups, orgs)}
    active_ids = {lk["_id"] for lk in active}
    return {
        lk["_id"]: sum(1 for m in lk["membership_ids"] if live.get(m) == lk["org_id"]) if lk["_id"] in active_ids else 0
        for lk in links
    }


def _clean(v: Any) -> str:
    s = str(v or "")
    return "" if holds_id_number(s) else s


CONTACT_KEYS = ("email", "phone", "location", "address")  # in `personal`


def recruiter_data(r: dict[str, Any], include_contact: bool) -> dict[str, Any]:
    """The resume as the member prints it, without contact details unless included, and never an ID number.
    Without contact details the Personal Information section (date of birth, parents, address…) is left out whole."""
    d = printable(r)  # already without ID numbers (the second lock); the fields below are checked once more
    personal = {k: _clean(v) for k, v in (d.get("personal") or {}).items()}
    pinfo = {k: _clean(v) for k, v in (d.get("pinfo") or {}).items()} if isinstance(d.get("pinfo"), dict) else {}
    if not include_contact:
        personal.update({k: "" for k in CONTACT_KEYS if k in personal})
        pinfo = {}
    out = {**d, "personal": personal}
    out.pop("pinfo", None)
    return {**out, **({"pinfo": pinfo} if pinfo else {})}


def _answers(r: dict[str, Any], keys: list[str]) -> dict[str, str]:
    labels = {d["key"]: d["label"] for d in r["field_defs"]}
    return {labels[k]: _clean(r["fields"].get(k)) for k in keys if k in labels and r["fields"].get(k)}


def link_out(link: dict[str, Any], visible: int | None = None) -> dict[str, Any]:
    return {
        "id": link["_id"],
        "company": link["company"],
        "label": link.get("label") or "",
        "expiresAt": ms(link["expires_at"]),
        "createdAt": ms(link["created_at"]),
        "state": _state(link),
        "allowDownloads": link["allow_downloads"],
        "includeContact": link["include_contact"],
        "answerKeys": link.get("answer_keys") or [],
        "hasCode": bool(link.get("code_hash")),
        "added": len(link["membership_ids"]),
        "candidates": visible,  # still on the link now (opted-out / left members drop out)
        "views": link.get("views", 0),
        "downloads": link.get("downloads", 0),
        "shortlisted": len(link.get("shortlist") or {}),
        "lastViewedAt": ms(link.get("last_viewed_at")),
    }


# ---------- staff ----------
async def _org(db, scope) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    require_feature(o, "recruiter_links")
    return o


async def _link(db, scope, link_id: str) -> dict[str, Any]:
    link = await db[RECRUITER_LINKS].find_one({"_id": link_id, "org_id": scope.org_id})
    if not link:
        raise NOT_FOUND
    if scope.group_ids is not None and not set(link.get("group_ids") or []) <= set(scope.group_ids):
        raise NOT_FOUND  # a link with groups outside a limited coordinator's access
    return link


@staff.post("", status_code=201)
async def create_link(body: LinkIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    """From the chosen resumes (or everything matching the filters): only approved members who opted in are added.
    The link (and the access code, if asked for) is shown once, here."""
    await _org(db, scope)
    scope.require("manage")
    key = f"recruiter-create:{scope.actor_id}"
    await rate_limit.check(db, key, CREATE_RULES)
    await rate_limit.record(db, key)
    rows = await _rows(db, scope, body.filters, "name", "asc", export=True)
    if body.ids is not None:
        wanted = set(body.ids)
        rows = [r for r in rows if r["membership_id"] in wanted]
    groups, orgs = await _context(db, rows)
    ok = [r for r in rows if eligible(r, groups, orgs)]
    if not ok:
        raise ApiError(
            400,
            "nobody_eligible",
            "None of these members can be shared: only approved members who allowed sharing with recruiters "
            "(in groups that use it) can be added.",
        )
    if len(ok) > MAX_MEMBERS:
        raise ApiError(400, "too_many", f"A link can hold up to {MAX_MEMBERS} resumes. Narrow the filters.")
    keys = {d["key"] for r in ok for d in r["field_defs"]}
    token = secrets.token_urlsafe(32)  # 43 characters: never mistaken for a resume link name
    lid = new_id()
    code = new_code() if body.access_code else None
    link = {
        "_id": lid,
        "org_id": scope.org_id,
        "group_ids": sorted({r["group_id"] for r in ok}),
        "company": body.company,
        "label": body.label,
        "token_hash": _token_hash(token),
        "code_hash": _code_hash(lid, code) if code else None,
        "expires_at": _until(body.days),
        "revoked_at": None,
        "allow_downloads": body.allow_downloads,
        "include_contact": body.include_contact,
        "answer_keys": [k for k in body.answer_keys if k in keys],
        "membership_ids": [r["membership_id"] for r in ok],
        "shortlist": {},
        "views": 0,
        "downloads": 0,
        "created_by": scope.actor_id,
        "created_at": now(),
    }
    await db[RECRUITER_LINKS].insert_one(link)
    data = scope.audit_data(company=body.company, count=len(ok), days=body.days, downloads=body.allow_downloads)
    await audit(db, scope.actor_id, "share_create", target=lid, data=data, ip=client_ip(request))
    url = f"{get_settings().site_url}/r/{token}"
    return {**link_out(link, len(ok)), "url": url, "accessCode": code, "skipped": len(rows) - len(ok)}


@staff.get("")
async def list_links(db: DB, scope: OrgScope) -> list[dict[str, Any]]:
    await _org(db, scope)
    links = await db[RECRUITER_LINKS].find({"org_id": scope.org_id}).sort("created_at", -1).limit(200).to_list(None)
    if scope.group_ids is not None:
        links = [lk for lk in links if set(lk.get("group_ids") or []) <= set(scope.group_ids)]
    counts = await live_counts(db, links)
    return [link_out(lk, counts[lk["_id"]]) for lk in links]


@staff.post("/{link_id}/extend")
async def extend_link(link_id: str, body: ExtendIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await _org(db, scope)
    link = await _link(db, scope, link_id)
    scope.require("manage")
    if link.get("revoked_at"):
        raise ApiError(400, "revoked", "This link was revoked. Make a new one instead.")
    link["expires_at"] = _until(body.days)
    await db[RECRUITER_LINKS].update_one({"_id": link_id}, {"$set": {"expires_at": link["expires_at"]}})
    await audit(db, scope.actor_id, "share_extend", target=link_id, data=scope.audit_data(days=body.days), ip=None)
    return link_out(link, len(await live_rows(db, link)))


@staff.post("/{link_id}/revoke")
async def revoke_link(link_id: str, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await _org(db, scope)
    link = await _link(db, scope, link_id)
    scope.require("manage")
    if not link.get("revoked_at"):
        link["revoked_at"] = now()
        await db[RECRUITER_LINKS].update_one({"_id": link_id}, {"$set": {"revoked_at": link["revoked_at"]}})
        await audit(db, scope.actor_id, "share_revoke", target=link_id, data=scope.audit_data(), ip=client_ip(request))
    return link_out(link, 0)


# ---------- the recruiter ----------
async def _open(db, token: str, request: Request, code: str | None) -> dict[str, Any]:
    """The link behind a token, after the rate limits and the access code. Unknown: 404; ended: 410."""
    if len(token) > 100:
        raise NOT_FOUND
    th = _token_hash(token)
    ip_key = f"recruit-ip:{keyed_hash('ip', client_ip(request) or '-')[:24]}"  # the address itself isn't kept
    for key, rules in ((f"recruit:{th[:24]}", LINK_RULES), (ip_key, IP_RULES)):
        await rate_limit.check(db, key, rules)
        await rate_limit.record(db, key)
    link = await db[RECRUITER_LINKS].find_one({"token_hash": th})
    if not link:
        raise NOT_FOUND
    o = await db[ORGANIZATIONS].find_one({"_id": link["org_id"]})
    require_feature(o, "recruiter_links")
    if _state(link) != "active" or o.get("status") == "archived":
        raise EXPIRED
    if link.get("code_hash"):
        key = f"recruit-code:{link['_id']}"
        await rate_limit.check(db, key, CODE_RULES, "Too many wrong codes. Please wait 15 minutes.")
        if not code:
            raise ApiError(401, "code_required", "Enter the 6-digit access code you were given with this link.")
        if not same(_code_hash(link["_id"], code.strip()), link["code_hash"]):
            await rate_limit.record(db, key)
            raise ApiError(401, "wrong_code", "That access code is wrong.")
    link["_org"] = o
    return link


def _audit_data(link: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {"orgs": [link["org_id"]], "link": link["_id"], "company": link["company"], **extra}


def _stamp(link: dict[str, Any]) -> str:
    until = link["expires_at"].astimezone(IST).strftime("%-d %b %Y")
    return f"Shared with {link['company']} via Nm7 · expires {until}"


@public.get("")
async def recruiter_list(
    token: str, request: Request, response: Response, db: DB, x_access_code: str | None = Header(None)
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    link = await _open(db, token, request, x_access_code)
    rows = await live_rows(db, link)
    shortlist = link.get("shortlist") or {}
    await db[RECRUITER_LINKS].update_one(
        {"_id": link["_id"]}, {"$inc": {"views": 1}, "$set": {"last_viewed_at": now()}}
    )
    await audit(db, None, "share_view", target=link["_id"], data=_audit_data(link, count=len(rows)), ip=None)
    labels: list[str] = []
    for r in rows:
        for d in r["field_defs"]:
            if d["key"] in link["answer_keys"] and d["label"] not in labels:
                labels.append(d["label"])
    return {
        "company": link["company"],
        "label": link.get("label") or "",
        "orgName": link["_org"]["name"],
        "expiresAt": ms(link["expires_at"]),
        "allowDownloads": link["allow_downloads"],
        "includeContact": link["include_contact"],
        "answerLabels": labels,
        "stamp": _stamp(link),
        "candidates": [
            {
                "id": _cid(link["_id"], r["membership_id"]),
                "name": r["name"],
                "headline": _clean(r["headline"]),
                **({"email": r["email"], "phone": r["phone"]} if link["include_contact"] else {}),
                "answers": _answers(r, link["answer_keys"]),
                "completeness": r["completeness"],
                "interested": r["membership_id"] in shortlist,
            }
            for r in rows
        ],
    }


async def _candidates(
    db, link: dict[str, Any], cids: list[str] | None, *, with_data: bool = False
) -> list[dict[str, Any]]:
    rows = await live_rows(db, link, with_data=with_data)
    if cids is None:
        return rows
    want = set(cids)
    return [r for r in rows if _cid(link["_id"], r["membership_id"]) in want]


async def _payload(db, link: dict[str, Any], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    brands = await brands_for(db, [r["group_id"] for r in rows])
    return [
        {
            "id": _cid(link["_id"], r["membership_id"]),
            "name": r["name"],
            "data": recruiter_data(r, link["include_contact"]),
            "brand": brands.get(r["group_id"]),
        }
        for r in rows
    ]


@public.get("/candidates/{cid}")
async def recruiter_view(
    token: str, cid: str, request: Request, response: Response, db: DB, x_access_code: str | None = Header(None)
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    link = await _open(db, token, request, x_access_code)
    rows = await _candidates(db, link, [cid], with_data=True)
    if not rows:
        raise NOT_FOUND
    return {**(await _payload(db, link, rows))[0], "stamp": _stamp(link)}


@public.post("/downloads")
async def recruiter_download(
    token: str, body: IdsIn, request: Request, response: Response, db: DB, x_access_code: str | None = Header(None)
) -> dict[str, Any]:
    """The data for PDFs (one, some or all candidates), drawn in the recruiter's browser. Only when allowed."""
    response.headers.update(NO_STORE)
    link = await _open(db, token, request, x_access_code)
    if not link["allow_downloads"]:
        raise ApiError(403, "downloads_off", "Downloads are switched off for this link. You can view the resumes.")
    rows = await _candidates(db, link, body.ids, with_data=True)
    if not rows:
        raise NOT_FOUND
    await db[RECRUITER_LINKS].update_one({"_id": link["_id"]}, {"$inc": {"downloads": 1}})
    await audit(db, None, "share_download", target=link["_id"], data=_audit_data(link, count=len(rows)), ip=None)
    return {"stamp": _stamp(link), "items": await _payload(db, link, rows)}


@public.post("/candidates/{cid}/interest")
async def recruiter_interest(
    token: str,
    cid: str,
    body: InterestIn,
    request: Request,
    response: Response,
    db: DB,
    x_access_code: str | None = Header(None),
) -> dict[str, Any]:
    """Interested: the coordinator sees "Shortlisted by <Company>"."""
    response.headers.update(NO_STORE)
    link = await _open(db, token, request, x_access_code)
    rows = await _candidates(db, link, [cid])
    if not rows:
        raise NOT_FOUND
    mid = rows[0]["membership_id"]
    if body.interested:
        await db[RECRUITER_LINKS].update_one({"_id": link["_id"]}, {"$set": {f"shortlist.{mid}": now()}})
    else:
        await db[RECRUITER_LINKS].update_one({"_id": link["_id"]}, {"$unset": {f"shortlist.{mid}": ""}})
    data = _audit_data(link, interested=body.interested)
    await audit(db, None, "share_shortlist", target=link["_id"], data=data, ip=None)
    return {"id": cid, "interested": body.interested}
