"""Nm7 for Organizations — API.

Public:  GET  /api/public/join/{code}                 what a join link opens (organization + group)
         POST /api/public/reminders/stop               one-click "stop reminders from this group" (signed link)
Member:  /api/me/groups …                             join (with consent), list, change shared resume, opt out, leave
Admin:   /api/admin/orgs …, /api/admin/groups/{id}     organizations and groups (super-admin = "owner" role)
Shared:  {base}/shared-resumes …, {base}/groups/{id}/dashboard
         mounted twice by `register_shared`: base /api/admin (every organization) and /api/org/{org_id} (one
         organization, for its coordinators and viewers — see app/orgs/staff.py and app/orgs/scope.py).

Bulk print / ZIP: the browser draws the PDFs with the same code members download with (so every page matches the
member's template exactly) and asks the server for the data in small batches of one export job:
POST …/exports (audited, returns the ordered list) → GET …/exports/{job}/data?offset=&limit= → POST …/exports/{job}/done
(marks the memberships printed). Nothing heavy runs on the API server, so the Render free plan never times out.
Exports only ever contain approved members.
"""

import csv
import io
import secrets
from datetime import date, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import AUDIT_LOG, DB, EXPORT_JOBS, MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS, RESUMES, USERS
from app.core.email import MailerDep, send_batch
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.me.service import ms
from app.orgs import emails
from app.orgs.scope import NOT_FOUND, AdminScope, Scope
from app.orgs.service import (
    CODE,
    COMPLETE,
    ID_FIELD,
    ORG_TYPE_NAMES,
    _day,
    clean_field_values,
    consent_text,
    dashboard,
    file_name,
    filter_rows,
    group_problem,
    new_code,
    normalize_code,
    opt_out_membership,
    opt_out_token,
    printable,
    row_out,
    shared_rows,
    sort_rows,
    unique_names,
)

admin = APIRouter(prefix="/api/admin", tags=["organizations"])
me = APIRouter(prefix="/api/me/groups", tags=["organizations"])
public = APIRouter(prefix="/api/public/join", tags=["organizations"])
public_stop = APIRouter(prefix="/api/public/reminders", tags=["organizations"])

OrgType = Literal["college", "institute", "job_fair", "skill_centre", "ngo", "agency", "company", "other"]
JOIN_RULES = [(10, timedelta(hours=1))]
LOOKUP_RULES = [(60, timedelta(hours=1))]
EXPORT_RULES = [(30, timedelta(hours=1))]
ACTION_RULES = [(120, timedelta(hours=1))]  # approve / review / unprint clicks per person
GROUP_REMIND_RULES = [(3, timedelta(days=1))]  # reminder sends per group per day
REMIND_GAP = timedelta(hours=24)  # one reminder (or "needs changes" email) per member per day
MAX_EMAILS = 500  # per send
BATCH = 25


def _ip(request: Request) -> str | None:
    return client_ip(request)


BAD_CODE = ApiError(404, "invalid_code", "This join code doesn’t exist. Please check it with your organizer.")


# ---------- models ----------
class FieldDef(CamelModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,29}$")
    label: str = Field(min_length=1, max_length=60)
    type: Literal["text", "select"] = "text"
    options: list[str] = Field(default_factory=list, max_length=50)
    required: bool = False

    @field_validator("options")
    @classmethod
    def _opts(cls, v):
        return [o.strip()[:60] for o in v if o.strip()]


def _check_fields(defs: list[FieldDef]) -> list[dict[str, Any]]:
    keys = [f.key for f in defs]
    if len(set(keys)) != len(keys):
        raise ApiError(400, "duplicate_field", "Each question needs its own key.")
    for f in defs:
        if ID_FIELD.search(f"{f.key} {f.label}"):
            raise ApiError(400, "id_field", f"“{f.label}” asks for an ID or bank number. Nm7 never stores those.")
        if f.type == "select" and not f.options:
            raise ApiError(400, "options_required", f"“{f.label}” needs at least one option.")
    return [f.model_dump() for f in defs]


class OrgIn(CamelModel):
    name: str = Field(min_length=2, max_length=120)
    type: OrgType
    city: str = Field("", max_length=60)
    logo_url: str = Field("", max_length=500, pattern=r"^(https://.*)?$")


class OrgPatch(CamelModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    type: OrgType | None = None
    city: str | None = Field(None, max_length=60)
    logo_url: str | None = Field(None, max_length=500, pattern=r"^(https://.*)?$")
    status: Literal["active", "archived"] | None = None


class GroupSettings(CamelModel):
    members_download_free: bool = False
    active: bool = True
    require_approval: bool = False


class GroupSettingsPatch(CamelModel):  # only what's sent changes (e.g. a coordinator's open / close switch)
    members_download_free: bool | None = None
    active: bool | None = None
    require_approval: bool | None = None


class GroupIn(CamelModel):
    name: str = Field(min_length=2, max_length=120)
    code: str | None = Field(None, max_length=20)
    starts_on: date | None = None
    ends_on: date | None = None
    member_limit: int | None = Field(None, ge=1, le=100_000)
    custom_fields: list[FieldDef] = Field(default_factory=list, max_length=20)
    settings: GroupSettings = Field(default_factory=GroupSettings)


class GroupPatch(CamelModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    code: str | None = Field(None, max_length=20)
    starts_on: date | None = None
    ends_on: date | None = None
    member_limit: int | None = Field(None, ge=1, le=100_000)
    custom_fields: list[FieldDef] | None = Field(None, max_length=20)
    settings: GroupSettingsPatch | None = None


class JoinIn(CamelModel):
    code: str = Field(max_length=20)
    consent: bool = False
    fields: dict[str, Any] = Field(default_factory=dict)
    resume_id: str = Field(max_length=64)


class MembershipPatch(CamelModel):
    resume_id: str | None = Field(None, max_length=64)
    reminders_opt_out: bool | None = None


Approval = Literal["approved", "pending", "rejected", "all"]
Review = Literal["none", "needs_changes", "ready"]


class Filters(CamelModel):
    org: str | None = Field(None, max_length=64)
    group: str | None = Field(None, max_length=64)
    q: str | None = Field(None, max_length=100)
    joined_from: str | None = None
    joined_to: str | None = None
    updated_from: str | None = None
    updated_to: str | None = None
    field_key: str | None = Field(None, max_length=30)
    field_value: str | None = Field(None, max_length=120)
    incomplete: bool = False
    not_printed: bool = False
    ready_not_printed: bool = False
    approval: Approval = "approved"
    review: Review | None = None
    only_ready: bool = False  # exports: only resumes marked Ready


ExportKind = Literal["print_bulk", "export_zip", "download", "print"]


class ExportIn(CamelModel):
    kind: ExportKind
    ids: list[str] | None = Field(None, max_length=2000)  # a selection; else everything matching `filters`
    filters: Filters = Field(default_factory=Filters)
    sort: str = Field("name", max_length=40)
    direction: Literal["asc", "desc"] = "asc"


class IdsIn(CamelModel):
    ids: list[str] = Field(min_length=1, max_length=2000)


class ApprovalIn(IdsIn):
    action: Literal["approve", "reject"]


class ReviewIn(IdsIn):
    status: Review
    note: str = Field("", max_length=500)


class RemindIn(CamelModel):
    segment: Literal["incomplete", "needs_changes", "stale", "selected"]
    group: str | None = Field(None, max_length=64)
    ids: list[str] | None = Field(None, max_length=2000)
    since: date | None = None  # "stale": not updated since this day
    note: str = Field("", max_length=300)


class StopIn(CamelModel):
    token: str = Field(max_length=200)


# ---------- helpers ----------
def org_out(o: dict[str, Any], groups: int = 0, members: int = 0) -> dict[str, Any]:
    return {
        "id": o["_id"],
        "name": o["name"],
        "type": o["type"],
        "typeName": ORG_TYPE_NAMES.get(o["type"], o["type"]),
        "city": o.get("city", ""),
        "logoUrl": o.get("logo_url", ""),
        "status": o.get("status", "active"),
        "createdAt": ms(o["created_at"]),
        "groups": groups,
        "members": members,
    }


def group_out(g: dict[str, Any], members: int = 0) -> dict[str, Any]:
    st = g.get("settings", {})
    return {
        "id": g["_id"],
        "orgId": g["org_id"],
        "name": g["name"],
        "code": g["code"],
        "startsOn": g.get("starts_on"),
        "endsOn": g.get("ends_on"),
        "memberLimit": g.get("member_limit"),
        "customFields": g.get("custom_fields", []),
        "settings": {
            "membersDownloadFree": st.get("members_download_free", False),
            "active": st.get("active", True),
            "requireApproval": st.get("require_approval", False),
        },
        "members": members,
        "createdAt": ms(g["created_at"]),
    }


async def _active_members(db, group_id: str) -> int:
    return await db[MEMBERSHIPS].count_documents({"group_id": group_id, "left_at": None})


async def groups_with_counts(db, match: dict[str, Any]) -> list[dict[str, Any]]:
    """Groups and their member counts in two queries (one count per group would be N+1)."""
    groups = await db[ORG_GROUPS].find(match).sort("created_at", -1).to_list(None)
    counts = {
        c["_id"]: c["n"]
        async for c in await db[MEMBERSHIPS].aggregate(
            [
                {"$match": {"group_id": {"$in": [g["_id"] for g in groups]}, "left_at": None}},
                {"$group": {"_id": "$group_id", "n": {"$sum": 1}}},
            ]
        )
    }
    return [group_out(g, counts.get(g["_id"], 0)) for g in groups]


async def _code_free(db, code: str, but: str | None = None) -> str:
    code = normalize_code(code)
    if not CODE.match(code):
        raise ApiError(400, "bad_code", "Join codes are 4 to 12 letters and digits, e.g. JNTUA26.")
    other = await db[ORG_GROUPS].find_one({"code": code})
    if other and other["_id"] != but:
        raise ApiError(409, "code_taken", f"The code {code} is already used by another group.")
    return code


def _dates(starts, ends) -> tuple[str | None, str | None]:
    s, e = (starts.isoformat() if starts else None), (ends.isoformat() if ends else None)
    if s and e and e < s:
        raise ApiError(400, "bad_dates", "The end date is before the start date.")
    return s, e


async def create_group_in(db, scope: Scope, o: dict[str, Any], body: GroupIn, ip: str | None) -> dict[str, Any]:
    code = await _code_free(db, body.code) if body.code else await new_code(db, o["name"])
    starts, ends = _dates(body.starts_on, body.ends_on)
    t = now()
    g = {
        "_id": new_id(),
        "org_id": o["_id"],
        "name": body.name,
        "code": code,
        "starts_on": starts,
        "ends_on": ends,
        "member_limit": body.member_limit,
        "custom_fields": _check_fields(body.custom_fields),
        "settings": body.settings.model_dump(),
        "created_by": scope.actor_id,
        "created_at": t,
        "updated_at": t,
    }
    await db[ORG_GROUPS].insert_one(g)
    data = scope.audit_data([o["_id"]], name=g["name"], code=code)
    await audit(db, scope.actor_id, "group_create", target=g["_id"], data=data, ip=ip)
    return group_out(g)


async def update_group_in(db, scope: Scope, g: dict[str, Any], body: GroupPatch, ip: str | None) -> dict[str, Any]:
    given = body.model_dump(exclude_unset=True)
    sets: dict[str, Any] = {}
    if "name" in given and body.name:
        sets["name"] = body.name
    if "code" in given and body.code:
        sets["code"] = await _code_free(db, body.code, but=g["_id"])
    if "starts_on" in given or "ends_on" in given:
        old = lambda k: date.fromisoformat(g[k]) if g.get(k) else None  # noqa: E731
        s = body.starts_on if "starts_on" in given else old("starts_on")
        e = body.ends_on if "ends_on" in given else old("ends_on")
        sets["starts_on"], sets["ends_on"] = _dates(s, e)
    if "member_limit" in given:
        sets["member_limit"] = body.member_limit
    if body.custom_fields is not None:
        sets["custom_fields"] = _check_fields(body.custom_fields)
    if body.settings is not None:
        sets["settings"] = {
            **GroupSettings().model_dump(),
            **g.get("settings", {}),
            **body.settings.model_dump(exclude_none=True),
        }
    await db[ORG_GROUPS].update_one({"_id": g["_id"]}, {"$set": {**sets, "updated_at": now()}})
    data = scope.audit_data([g["org_id"]], **{k: v for k, v in sets.items() if k != "custom_fields"})
    await audit(db, scope.actor_id, "group_update", target=g["_id"], data=data, ip=ip)
    g = await db[ORG_GROUPS].find_one({"_id": g["_id"]})
    return group_out(g, await _active_members(db, g["_id"]))


ORG_ACTIONS = [
    "view", "download", "print", "print_bulk", "export_zip", "export_csv", "group_create", "group_update",
    "org_create", "org_update", "remind", "approve", "reject", "review", "unprint",
    "staff_invite", "staff_update", "staff_remove", "staff_accept", "staff_resend",
]  # fmt: skip


async def audit_list(db, match: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    q = {"action": {"$in": ORG_ACTIONS}, **match}
    entries = await db[AUDIT_LOG].find(q).sort("_id", -1).limit(limit).to_list(None)
    names = {
        u["_id"]: u.get("name", "")
        async for u in db[USERS].find({"_id": {"$in": list({e.get("actor_id") for e in entries})}}, {"name": 1})
    }
    out = []
    for e in entries:
        data = e.get("data") or {}
        out.append(
            {
                "id": e["_id"],
                "actorName": names.get(e.get("actor_id"), ""),
                "byStaff": data.get("by") == "staff",
                "action": e["action"],
                "target": e.get("target"),
                "count": data.get("count", data.get("sent")),
                "details": {k: v for k, v in data.items() if k not in ("memberships", "count", "orgs", "by")},
                "at": ms(e["at"]),
            }
        )
    return out


# ---------- public: what a join link opens ----------
@public.get("/{code}")
async def join_info(code: str, request: Request, db: DB) -> dict[str, Any]:
    key = f"join-lookup:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, LOOKUP_RULES)
    await rate_limit.record(db, key)
    g = await db[ORG_GROUPS].find_one({"code": normalize_code(code)})
    if not g:
        raise BAD_CODE
    o = await db[ORGANIZATIONS].find_one({"_id": g["org_id"]})
    problem = group_problem(g, o, await _active_members(db, g["_id"]))
    if problem:
        raise ApiError(410 if problem[0] != "group_full" else 409, problem[0], problem[1])
    return {
        "code": g["code"],
        "org": {
            "name": o["name"],
            "type": o["type"],
            "typeName": ORG_TYPE_NAMES.get(o["type"], ""),
            "city": o.get("city", ""),
            "logoUrl": o.get("logo_url", ""),
        },
        "group": {
            "name": g["name"],
            "customFields": g.get("custom_fields", []),
            "endsOn": g.get("ends_on"),
            "requireApproval": g.get("settings", {}).get("require_approval", False),
        },
        "consentText": consent_text(o["name"]),
    }


@public_stop.post("/stop")
async def stop_reminders(body: StopIn, request: Request, db: DB) -> dict[str, Any]:
    """The "Stop reminders from this group" link in every reminder email (signed, no sign-in needed)."""
    key = f"reminder-stop:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, LOOKUP_RULES)
    await rate_limit.record(db, key)
    mid = opt_out_membership(body.token)
    m = mid and await db[MEMBERSHIPS].find_one({"_id": mid})
    if not m:
        raise ApiError(404, "invalid_link", "This link doesn’t work. You can switch reminders off in your dashboard.")
    await db[MEMBERSHIPS].update_one({"_id": mid}, {"$set": {"reminders_opt_out": True, "updated_at": now()}})
    g = await db[ORG_GROUPS].find_one({"_id": m["group_id"]}, {"name": 1})
    o = await db[ORGANIZATIONS].find_one({"_id": m["org_id"]}, {"name": 1})
    return {"ok": True, "groupName": (g or {}).get("name", ""), "orgName": (o or {}).get("name", "")}


# ---------- members ----------
def membership_out(m: dict[str, Any], g: dict[str, Any] | None, o: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "id": m["_id"],
        "code": g["code"] if g else "",
        "groupName": g["name"] if g else "",
        "orgName": o["name"] if o else "",
        "resumeId": m.get("resume_id"),
        "fields": m.get("field_values", {}),
        "customFields": g.get("custom_fields", []) if g else [],
        "joinedAt": ms(m["joined_at"]),
        "downloadsFree": bool(g and g.get("settings", {}).get("members_download_free")),
        "approval": m.get("approval") or "approved",
        "reviewStatus": m.get("review_status") or "none",
        "reviewNote": m.get("review_note") or "",
        "remindersOptOut": bool(m.get("reminders_opt_out")),
    }


async def _my(db, uid: str) -> list[dict[str, Any]]:
    ms_ = [m async for m in db[MEMBERSHIPS].find({"user_id": uid, "left_at": None}).sort("joined_at", -1)]
    gs = {g["_id"]: g async for g in db[ORG_GROUPS].find({"_id": {"$in": [m["group_id"] for m in ms_]}})}
    os_ = {o["_id"]: o async for o in db[ORGANIZATIONS].find({"_id": {"$in": [m["org_id"] for m in ms_]}})}
    return [membership_out(m, gs.get(m["group_id"]), os_.get(m["org_id"])) for m in ms_]


@me.get("")
async def my_groups(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    return await _my(db, auth.user.id)


@me.post("/join", status_code=201)
async def join(body: JoinIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    key = f"join:{uid}"
    await rate_limit.check(db, key, JOIN_RULES)
    await rate_limit.record(db, key)
    g = await db[ORG_GROUPS].find_one({"code": normalize_code(body.code)})
    if not g:
        raise BAD_CODE
    o = await db[ORGANIZATIONS].find_one({"_id": g["org_id"]})
    mine = await db[MEMBERSHIPS].find_one({"user_id": uid, "group_id": g["_id"]})
    already = bool(mine and mine.get("left_at") is None)
    problem = group_problem(g, o, await _active_members(db, g["_id"]) - (1 if already else 0))
    if problem:
        raise ApiError(410 if problem[0] != "group_full" else 409, problem[0], problem[1])
    if not body.consent:
        raise ApiError(
            400, "consent_required", "Please tick the box to agree to share your resume with this organization."
        )
    if not await db[RESUMES].find_one({"user_id": uid, "key": body.resume_id}):
        raise ApiError(404, "resume_not_found", "Please choose one of your resumes to share.")
    values = clean_field_values(g.get("custom_fields", []), body.fields)
    t = now()
    doc = {
        "user_id": uid,
        "group_id": g["_id"],
        "org_id": o["_id"],
        "resume_id": body.resume_id,
        "field_values": values,
        "consent": {"given": True, "text": consent_text(o["name"]), "at": t},  # no IP stored
        "left_at": None,
        "updated_at": t,
    }
    # a group that approves members: everyone (re)joining waits for approval; answers updated in place keep theirs
    fresh = {"joined_at": t, "approval": "pending" if g.get("settings", {}).get("require_approval") else "approved"}
    if mine:  # joining again after leaving (or updating answers): one membership per user and group
        await db[MEMBERSHIPS].update_one({"_id": mine["_id"]}, {"$set": {**doc, **({} if already else fresh)}})
    else:
        new = {"_id": new_id(), **doc, **fresh, "review_status": "none", "printed_at": None, "printed_count": 0}
        await db[MEMBERSHIPS].insert_one(new)
    return next(x for x in await _my(db, uid) if x["code"] == g["code"])


@me.patch("/{membership_id}")
async def change_membership(membership_id: str, body: MembershipPatch, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    sets: dict[str, Any] = {"updated_at": now()}
    if body.resume_id is not None:
        if not await db[RESUMES].find_one({"user_id": uid, "key": body.resume_id}):
            raise ApiError(404, "resume_not_found", "Please choose one of your resumes to share.")
        sets["resume_id"] = body.resume_id
    if body.reminders_opt_out is not None:
        sets["reminders_opt_out"] = body.reminders_opt_out
    r = await db[MEMBERSHIPS].update_one({"_id": membership_id, "user_id": uid, "left_at": None}, {"$set": sets})
    if not r.matched_count:
        raise NOT_FOUND
    return next(x for x in await _my(db, uid) if x["id"] == membership_id)


@me.post("/{membership_id}/leave", status_code=204)
async def leave(membership_id: str, auth: CustomerAuth, db: DB) -> Response:
    t = now()
    r = await db[MEMBERSHIPS].update_one(
        {"_id": membership_id, "user_id": auth.user.id, "left_at": None}, {"$set": {"left_at": t, "updated_at": t}}
    )
    if not r.matched_count:
        raise NOT_FOUND
    return Response(status_code=204)


# ---------- admin: organizations and groups ----------
async def _org(db, org_id: str) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    if not o:
        raise NOT_FOUND
    return o


@admin.get("/orgs")
async def list_orgs(db: DB, _: AdminScope) -> list[dict[str, Any]]:
    orgs = await db[ORGANIZATIONS].find({}).sort("created_at", -1).to_list(None)
    groups = {
        c["_id"]: c["n"]
        async for c in await db[ORG_GROUPS].aggregate([{"$group": {"_id": "$org_id", "n": {"$sum": 1}}}])
    }
    members = {
        c["_id"]: c["n"]
        async for c in await db[MEMBERSHIPS].aggregate(
            [{"$match": {"left_at": None}}, {"$group": {"_id": "$org_id", "n": {"$sum": 1}}}]
        )
    }
    return [org_out(o, groups.get(o["_id"], 0), members.get(o["_id"], 0)) for o in orgs]


@admin.post("/orgs", status_code=201)
async def create_org(body: OrgIn, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    t = now()
    o = {
        "_id": new_id(),
        **body.model_dump(),
        "status": "active",
        "roles": [],  # unused: staff logins live in org_staff
        "created_by": scope.actor_id,
        "created_at": t,
        "updated_at": t,
    }
    await db[ORGANIZATIONS].insert_one(o)
    data = scope.audit_data([o["_id"]], name=o["name"])
    await audit(db, scope.actor_id, "org_create", target=o["_id"], data=data, ip=_ip(request))
    return org_out(o)


@admin.get("/orgs/{org_id}")
async def get_org(org_id: str, db: DB, _: AdminScope) -> dict[str, Any]:
    o = await _org(db, org_id)
    groups = await groups_with_counts(db, {"org_id": org_id})
    return {**org_out(o, len(groups), sum(g["members"] for g in groups)), "groupList": groups}


@admin.patch("/orgs/{org_id}")
async def update_org(org_id: str, body: OrgPatch, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    await _org(db, org_id)
    sets = body.model_dump(exclude_unset=True, exclude_none=True)
    await db[ORGANIZATIONS].update_one({"_id": org_id}, {"$set": {**sets, "updated_at": now()}})
    await audit(
        db, scope.actor_id, "org_update", target=org_id, data=scope.audit_data([org_id], **sets), ip=_ip(request)
    )
    return await get_org(org_id, db, scope)


@admin.post("/orgs/{org_id}/groups", status_code=201)
async def create_group(org_id: str, body: GroupIn, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    return await create_group_in(db, scope, await _org(db, org_id), body, _ip(request))


@admin.patch("/groups/{group_id}")
async def update_group(group_id: str, body: GroupPatch, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    return await update_group_in(db, scope, await scope.group(db, group_id), body, _ip(request))


@admin.get("/org-audit")
async def org_audit(db: DB, _: AdminScope, limit: int = Query(100, ge=1, le=500)) -> list[dict[str, Any]]:
    """Every organization audit entry (admins and coordinators)."""
    return await audit_list(db, {}, limit)


# ---------- shared resumes: one implementation, mounted for the admin and for each organization's staff ----------
CSV_HEAD = ["Name", "Email", "Phone", "Organization", "Group"]
CSV_TAIL = ["Completeness %", "Approval", "Review", "Last updated", "Printed"]
APPROVAL_TEXT = {"approved": "Approved", "pending": "Pending", "rejected": "Rejected"}
REVIEW_TEXT = {"none": "", "needs_changes": "Needs changes", "ready": "Ready"}


async def _rows(db, scope: Scope, f: Filters, sort: str = "joined", direction: str = "desc", *, export: bool = False):
    """Rows in the scope that match the filters. Org / group filters are intersected with the scope (404 outside).
    Exports: approved members only, and only Ready resumes when asked."""
    match = scope.match()
    if f.org:
        if scope.org_id and f.org != scope.org_id:
            raise NOT_FOUND
        match["org_id"] = f.org
    if f.group:
        await scope.group(db, f.group)
        match["group_id"] = f.group
    fd = f.model_dump()
    if export:
        fd["approval"] = "approved"
        if f.only_ready:
            fd["review"] = "ready"
    try:
        return sort_rows(filter_rows(await shared_rows(db, match), fd), sort, direction)
    except ValueError:
        raise ApiError(400, "bad_date", "Dates must look like 2026-10-16.") from None


async def _selected(db, scope: Scope, ids: list[str], *, approved_only: bool = False) -> list[dict[str, Any]]:
    """The chosen memberships that are in the scope (others are silently left out)."""
    rows = await shared_rows(db, {**scope.match(), "_id": {"$in": list(set(ids))}})
    return [r for r in rows if r["approval"] == "approved"] if approved_only else rows


def _orgs(rows: list[dict[str, Any]]) -> list[str]:
    return sorted({r["org_id"] for r in rows})


async def _limit(db, key: str, rules) -> None:
    await rate_limit.check(db, key, rules)
    await rate_limit.record(db, key)


def _stop_url(membership_id: str) -> str:
    return f"{get_settings().site_url}/groups/stop?t={opt_out_token(membership_id)}"


def _recent(r: dict[str, Any], t) -> bool:
    return bool(r["last_reminded_at"] and t - r["last_reminded_at"] < REMIND_GAP)


async def _email_members(db, mailer, rows, make) -> tuple[int, dict[str, int]]:
    """Emails `rows` (skipping opted-out, reminded in the last 24 h and anything over 500); marks who was emailed."""
    t = now()
    skipped = {"optedOut": 0, "recent": 0, "overLimit": 0, "failed": 0}
    todo = []
    for r in rows:
        if r["reminders_opt_out"]:
            skipped["optedOut"] += 1
        elif _recent(r, t):
            skipped["recent"] += 1
        elif len(todo) >= MAX_EMAILS:
            skipped["overLimit"] += 1
        else:
            todo.append(r)
    results = await send_batch(mailer, [make(r) for r in todo]) if todo else []
    sent = [r["membership_id"] for r, ok in zip(todo, results, strict=True) if ok]
    skipped["failed"] = len(todo) - len(sent)
    if sent:
        await db[MEMBERSHIPS].update_many({"_id": {"$in": sent}}, {"$set": {"last_reminded_at": t}})
    return len(sent), skipped


def register_shared(router: APIRouter, ScopeDep) -> None:  # noqa: N803 — a dependency type, like AdminScope
    """The shared-resumes table, exports, approvals, reviews, reminders and group dashboards, on `router`.
    Every handler starts from the resolved Scope, so the same code serves /api/admin and /api/org/{org_id}."""

    @router.get("/shared-resumes")
    async def shared_resumes(
        db: DB,
        scope: ScopeDep,
        org: str | None = Query(None, max_length=64),
        group: str | None = Query(None, max_length=64),
        q: str | None = Query(None, max_length=100),
        joined_from: str | None = Query(None, alias="joinedFrom"),
        joined_to: str | None = Query(None, alias="joinedTo"),
        updated_from: str | None = Query(None, alias="updatedFrom"),
        updated_to: str | None = Query(None, alias="updatedTo"),
        field_key: str | None = Query(None, alias="fieldKey"),
        field_value: str | None = Query(None, alias="fieldValue"),
        incomplete: bool = False,
        not_printed: bool = Query(False, alias="notPrinted"),
        ready_not_printed: bool = Query(False, alias="readyNotPrinted"),
        approval: Approval = "approved",
        review: Review | None = None,
        sort: str = "joined",
        direction: Literal["asc", "desc"] = Query("desc", alias="dir"),
        page: int = Query(1, ge=1),
        per_page: int = Query(25, ge=1, le=100, alias="perPage"),
    ) -> dict[str, Any]:
        f = Filters(
            org=org, group=group, q=q, joined_from=joined_from, joined_to=joined_to, updated_from=updated_from,
            updated_to=updated_to, field_key=field_key, field_value=field_value, incomplete=incomplete,
            not_printed=not_printed, ready_not_printed=ready_not_printed, approval=approval, review=review,
        )  # fmt: skip
        rows = await _rows(db, scope, f, sort, direction)
        start = (page - 1) * per_page
        gmatch: dict[str, Any] = {"org_id": scope.org_id} if scope.org_id else {}
        if scope.group_ids is not None:
            gmatch["_id"] = {"$in": scope.group_ids}
        if org:
            gmatch["org_id"] = org
        if group:
            gmatch["_id"] = group
        fields: dict[str, dict[str, Any]] = {}
        for g in await db[ORG_GROUPS].find(gmatch, {"custom_fields": 1}).to_list(None):
            for d in g.get("custom_fields", []):
                fields.setdefault(d["key"], d)
        return {
            "total": len(rows),
            "page": page,
            "perPage": per_page,
            "rows": [row_out(r) for r in rows[start : start + per_page]],
            "fields": list(fields.values()),
            "role": scope.role,
        }

    @router.get("/shared-resumes/{membership_id}")
    async def shared_resume(membership_id: str, request: Request, db: DB, scope: ScopeDep) -> dict[str, Any]:
        rows = await _selected(db, scope, [membership_id])
        if not rows:
            raise NOT_FOUND
        data = scope.audit_data(_orgs(rows), count=1)
        await audit(db, scope.actor_id, "view", target=membership_id, data=data, ip=_ip(request))
        return {**row_out(rows[0]), "data": printable(rows[0])}

    @router.post("/shared-resumes/export.csv")
    async def export_csv(
        body: Filters,
        request: Request,
        db: DB,
        scope: ScopeDep,
        sort: str = "name",
        direction: Literal["asc", "desc"] = Query("asc", alias="dir"),
    ) -> Response:
        scope.require("export")
        await _limit(db, f"org-export:{scope.actor_id}", EXPORT_RULES)
        rows = await _rows(db, scope, body, sort, direction, export=True)
        defs: dict[str, str] = {}
        for r in rows:
            for d in r["field_defs"]:
                defs.setdefault(d["key"], d["label"])
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([*CSV_HEAD, *defs.values(), *CSV_TAIL])
        safe = lambda v: ("'" + v) if isinstance(v, str) and v[:1] in "=+-@" else v  # noqa: E731 — no spreadsheet formulas
        for r in rows:
            head = (
                r["name"],
                r["email"],
                r["phone"],
                r["org_name"],
                r["group_name"],
                *[r["fields"].get(k, "") for k in defs],
            )
            w.writerow(
                [safe(x) for x in head]
                + [
                    r["completeness"],
                    APPROVAL_TEXT[r["approval"]],
                    REVIEW_TEXT[r["review_status"]],
                    r["updated_at"].astimezone(IST).strftime("%Y-%m-%d %H:%M") if r["updated_at"] else "",
                    r["printed_at"].astimezone(IST).strftime("%Y-%m-%d") if r["printed_at"] else "No",
                ]
            )
        filters = body.model_dump(exclude_defaults=True, exclude={"q"})
        data = scope.audit_data(_orgs(rows), count=len(rows), filters=filters)
        await audit(db, scope.actor_id, "export_csv", data=data, ip=_ip(request))
        return Response(
            buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="nm7-shared-resumes.csv"'},
        )

    @router.post("/shared-resumes/exports", status_code=201)
    async def start_export(body: ExportIn, request: Request, db: DB, scope: ScopeDep) -> dict[str, Any]:
        """Starts a print / ZIP / single download: the ordered list of resumes and the file names (audited)."""
        scope.require("export" if body.kind == "export_zip" else "print")
        await _limit(db, f"org-export:{scope.actor_id}", EXPORT_RULES)
        rows = await _rows(db, scope, body.filters, body.sort, body.direction, export=True)
        if body.ids is not None:
            wanted = set(body.ids)
            rows = [r for r in rows if r["membership_id"] in wanted]
        if not rows:
            raise ApiError(400, "nothing_selected", "No shared resumes match. Change the filters or the selection.")
        names = unique_names([file_name(r["roll"], r["name"]) for r in rows])
        job = {
            "_id": secrets.token_urlsafe(12),
            "kind": body.kind,
            "actor_id": scope.actor_id,
            "membership_ids": [r["membership_id"] for r in rows],
            "created_at": now(),
            "done_at": None,
        }
        await db[EXPORT_JOBS].insert_one(job)
        data = scope.audit_data(_orgs(rows), count=len(rows), memberships=job["membership_ids"][:200])
        await audit(db, scope.actor_id, body.kind, target=job["_id"], data=data, ip=_ip(request))
        groups = sorted({(r["org_name"], r["group_name"]) for r in rows})
        return {
            "job": job["_id"],
            "kind": body.kind,
            "total": len(rows),
            "items": [
                {"membershipId": r["membership_id"], "name": r["name"], "roll": r["roll"], "fileName": n}
                for r, n in zip(rows, names, strict=True)
            ],
            "cover": {
                "orgs": sorted({g[0] for g in groups}),
                "groups": [f"{o} · {g}" for o, g in groups],
                "count": len(rows),
            },
        }

    async def _job(db, job_id: str, scope: Scope) -> dict[str, Any]:
        j = await db[EXPORT_JOBS].find_one({"_id": job_id, "actor_id": scope.actor_id})
        if not j:
            raise ApiError(404, "not_found", "This export has expired. Please start it again.")
        return j

    @router.get("/shared-resumes/exports/{job_id}/data")
    async def export_data(
        job_id: str, db: DB, scope: ScopeDep, offset: int = Query(0, ge=0), limit: int = Query(BATCH, ge=1, le=BATCH)
    ) -> list[dict[str, Any]]:
        """One batch of the job's resumes, as the member prints them (hidden entries and private details removed).
        Re-checked against the scope and approval now: someone who left or was rejected since comes back empty."""
        j = await _job(db, job_id, scope)
        ids = j["membership_ids"][offset : offset + limit]
        rows = {r["membership_id"]: r for r in await _selected(db, scope, ids, approved_only=True)}
        return [{"membershipId": i, "data": printable(rows[i]) if i in rows else None} for i in ids]

    @router.post("/shared-resumes/exports/{job_id}/done")
    async def export_done(job_id: str, db: DB, scope: ScopeDep) -> dict[str, Any]:
        """The browser finished the file: printed / ZIP'd resumes are marked printed (once per job)."""
        j = await _job(db, job_id, scope)
        marked = 0
        if j["kind"] in ("print_bulk", "export_zip", "print") and not j.get("done_at"):
            r = await db[MEMBERSHIPS].update_many(
                {**scope.match(), "_id": {"$in": j["membership_ids"]}},
                {"$set": {"printed_at": now()}, "$inc": {"printed_count": 1}},
            )
            marked = r.modified_count
        await db[EXPORT_JOBS].update_one({"_id": job_id}, {"$set": {"done_at": j.get("done_at") or now()}})
        return {"ok": True, "marked": marked}

    @router.post("/shared-resumes/unprint")
    async def unprint(body: IdsIn, request: Request, db: DB, scope: ScopeDep) -> dict[str, Any]:
        """Mark as not printed (for a reprint). The print count stays."""
        scope.require("unprint")
        await _limit(db, f"org-action:{scope.actor_id}", ACTION_RULES)
        rows = await _selected(db, scope, body.ids)
        ids = [r["membership_id"] for r in rows]
        if ids:
            await db[MEMBERSHIPS].update_many({"_id": {"$in": ids}}, {"$set": {"printed_at": None}})
        await audit(db, scope.actor_id, "unprint", data=scope.audit_data(_orgs(rows), count=len(ids)), ip=_ip(request))
        return {"updated": len(ids)}

    @router.post("/shared-resumes/approval")
    async def approval(body: ApprovalIn, request: Request, db: DB, scope: ScopeDep) -> dict[str, Any]:
        scope.require("approve")
        await _limit(db, f"org-action:{scope.actor_id}", ACTION_RULES)
        rows = await _selected(db, scope, body.ids)
        ids = [r["membership_id"] for r in rows]
        state = "approved" if body.action == "approve" else "rejected"
        if ids:
            t = now()
            await db[MEMBERSHIPS].update_many(
                {"_id": {"$in": ids}}, {"$set": {"approval": state, "approved_by": scope.actor_id, "approved_at": t}}
            )
        data = scope.audit_data(_orgs(rows), count=len(ids))
        await audit(db, scope.actor_id, body.action, data=data, ip=_ip(request))
        return {"updated": len(ids)}

    @router.post("/shared-resumes/review")
    async def review(body: ReviewIn, request: Request, db: DB, mailer: MailerDep, scope: ScopeDep) -> dict[str, Any]:
        """None → Needs changes (with a note; the member is emailed) → Ready."""
        scope.require("review")
        note = body.note.strip()
        if body.status == "needs_changes" and not note:
            raise ApiError(400, "note_required", "Please write what needs to change (the member sees this note).")
        await _limit(db, f"org-action:{scope.actor_id}", ACTION_RULES)
        rows = [r for r in await _selected(db, scope, body.ids) if r["approval"] != "rejected"]
        ids = [r["membership_id"] for r in rows]
        if ids:
            sets = {"review_status": body.status, "review_note": note if body.status == "needs_changes" else ""}
            await db[MEMBERSHIPS].update_many(
                {"_id": {"$in": ids}}, {"$set": {**sets, "reviewed_by": scope.actor_id, "reviewed_at": now()}}
            )
        emailed, skipped = 0, {}
        if body.status == "needs_changes" and rows:
            make = lambda r: emails.needs_changes(  # noqa: E731
                r["email"], r["name"] or "there", r["org_name"], r["group_name"], note, _stop_url(r["membership_id"])
            )
            emailed, skipped = await _email_members(db, mailer, rows, make)
        data = scope.audit_data(_orgs(rows), count=len(ids), status=body.status, emailed=emailed)
        await audit(db, scope.actor_id, "review", data=data, ip=_ip(request))
        return {"updated": len(ids), "emailed": emailed, "skipped": sum(skipped.values()), "reasons": skipped}

    @router.post("/shared-resumes/remind")
    async def remind(body: RemindIn, request: Request, db: DB, mailer: MailerDep, scope: ScopeDep) -> dict[str, Any]:
        """Email a segment of one group (incomplete / needs changes / not updated since a day) or chosen members.
        At most one reminder per member per 24 h, 3 sends per group per day and 500 emails per send."""
        scope.require("remind")
        if body.segment == "selected":
            if not body.ids:
                raise ApiError(400, "nothing_selected", "Choose the members to remind.")
            rows = await _selected(db, scope, body.ids)
        else:
            if not body.group:
                raise ApiError(400, "group_required", "Choose a group to remind.")
            await scope.group(db, body.group)
            rows = await shared_rows(db, {**scope.match(), "group_id": body.group})
            if body.segment == "incomplete":
                rows = [r for r in rows if r["completeness"] < COMPLETE]
            elif body.segment == "needs_changes":
                rows = [r for r in rows if r["review_status"] == "needs_changes"]
            else:
                if not body.since:
                    raise ApiError(400, "since_required", "Choose the date: members not updated since then.")
                since = _day(body.since.isoformat())
                rows = [r for r in rows if not r["updated_at"] or r["updated_at"] < since]
        rows = [r for r in rows if r["approval"] != "rejected"]
        groups = sorted({r["group_id"] for r in rows})
        for gid in groups:  # check every group first, then count the send against each
            await rate_limit.check(
                db, f"remind-group:{gid}", GROUP_REMIND_RULES,
                "This group already had 3 reminder sends today. Please try again tomorrow.",
            )  # fmt: skip
        for gid in groups:
            await rate_limit.record(db, f"remind-group:{gid}")
        note = body.note.strip()
        make = lambda r: emails.reminder(  # noqa: E731
            r["email"], r["name"] or "there", r["org_name"], r["group_name"], r["missing"], note,
            _stop_url(r["membership_id"]),
        )  # fmt: skip
        sent, skipped = await _email_members(db, mailer, rows, make)
        data = scope.audit_data(_orgs(rows), segment=body.segment, groups=groups, sent=sent, skipped=skipped)
        await audit(db, scope.actor_id, "remind", data=data, ip=_ip(request))
        return {"sent": sent, "skipped": sum(skipped.values()), "reasons": skipped}

    @router.get("/groups/{group_id}/dashboard")
    async def group_dashboard(group_id: str, db: DB, scope: ScopeDep) -> dict[str, Any]:
        """Everything the group dashboard shows, from one membership query (+ the users / resumes it joins)."""
        g = await scope.group(db, group_id)
        rows = await shared_rows(db, {**scope.match(), "group_id": group_id})
        return {"group": group_out(g, await _active_members(db, group_id)), "role": scope.role, **dashboard(rows)}


register_shared(admin, AdminScope)
