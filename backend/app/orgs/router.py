"""Nm7 for Organizations — Phase 1 API.

Public:  GET  /api/public/join/{code}                 what a join link opens (organization + group)
Member:  /api/me/groups …                             join (with consent), list, change shared resume, leave
Admin:   /api/admin/orgs …, /api/admin/groups/{id}     organizations and groups (super-admin = "owner" role)
         /api/admin/shared-resumes …                   the shared resumes table, one resume, CSV, export jobs

Bulk print / ZIP: the admin's browser draws the PDFs with the same code members download with (so every page
matches the member's template exactly) and asks the server for the data in small batches of one export job:
POST …/exports (audited, returns the ordered list) → GET …/exports/{job}/data?offset=&limit= → POST …/exports/{job}/done
(marks the memberships printed). Nothing heavy runs on the API server, so the Render free plan never times out.
"""

import csv
import io
import secrets
from datetime import date, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import AUDIT_LOG, DB, EXPORT_JOBS, MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS, RESUMES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.me.service import ms
from app.orgs.service import (
    CODE,
    ID_FIELD,
    ORG_TYPE_NAMES,
    clean_field_values,
    consent_text,
    file_name,
    filter_rows,
    group_problem,
    new_code,
    normalize_code,
    printable,
    row_out,
    shared_rows,
    sort_rows,
    unique_names,
)

admin = APIRouter(prefix="/api/admin", tags=["organizations"])
me = APIRouter(prefix="/api/me/groups", tags=["organizations"])
public = APIRouter(prefix="/api/public/join", tags=["organizations"])

Admin = AdminAuth("organizations")  # super-admin (owner) only in Phase 1
OrgType = Literal["college", "institute", "job_fair", "skill_centre", "ngo", "agency", "company", "other"]
JOIN_RULES = [(10, timedelta(hours=1))]
LOOKUP_RULES = [(60, timedelta(hours=1))]
EXPORT_RULES = [(30, timedelta(hours=1))]
BATCH = 25


def _ip(request: Request) -> str | None:
    return client_ip(request)


NOT_FOUND = ApiError(404, "not_found", "We couldn’t find that.")
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
    settings: GroupSettings | None = None


class JoinIn(CamelModel):
    code: str = Field(max_length=20)
    consent: bool = False
    fields: dict[str, Any] = Field(default_factory=dict)
    resume_id: str = Field(max_length=64)


class MembershipPatch(CamelModel):
    resume_id: str = Field(max_length=64)


class Filters(CamelModel):
    org: str | None = None
    group: str | None = None
    q: str | None = Field(None, max_length=100)
    joined_from: str | None = None
    joined_to: str | None = None
    updated_from: str | None = None
    updated_to: str | None = None
    field_key: str | None = Field(None, max_length=30)
    field_value: str | None = Field(None, max_length=120)
    incomplete: bool = False
    not_printed: bool = False


ExportKind = Literal["print_bulk", "export_zip", "download", "print"]


class ExportIn(CamelModel):
    kind: ExportKind
    ids: list[str] | None = Field(None, max_length=2000)  # a selection; else everything matching `filters`
    filters: Filters = Field(default_factory=Filters)
    sort: str = Field("name", max_length=40)
    direction: Literal["asc", "desc"] = "asc"


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
            "membersDownloadFree": g.get("settings", {}).get("members_download_free", False),
            "active": g.get("settings", {}).get("active", True),
        },
        "members": members,
        "createdAt": ms(g["created_at"]),
    }


async def _active_members(db, group_id: str) -> int:
    return await db[MEMBERSHIPS].count_documents({"group_id": group_id, "left_at": None})


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


def _filters_match(f: Filters) -> dict[str, Any]:
    m: dict[str, Any] = {}
    if f.org:
        m["org_id"] = f.org
    if f.group:
        m["group_id"] = f.group
    return m


async def _rows(db, f: Filters, sort: str, direction: str) -> list[dict[str, Any]]:
    rows = await shared_rows(db, _filters_match(f))
    return sort_rows(filter_rows(rows, f.model_dump()), sort, direction)


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
        "group": {"name": g["name"], "customFields": g.get("custom_fields", []), "endsOn": g.get("ends_on")},
        "consentText": consent_text(o["name"]),
    }


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
    if mine:  # joining again after leaving (or updating answers): one membership per user and group
        await db[MEMBERSHIPS].update_one(
            {"_id": mine["_id"]}, {"$set": {**doc, **({} if already else {"joined_at": t})}}
        )
    else:
        await db[MEMBERSHIPS].insert_one(
            {"_id": new_id(), **doc, "joined_at": t, "printed_at": None, "printed_count": 0}
        )
    return next(x for x in await _my(db, uid) if x["code"] == g["code"])


@me.patch("/{membership_id}")
async def change_shared_resume(membership_id: str, body: MembershipPatch, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    if not await db[RESUMES].find_one({"user_id": uid, "key": body.resume_id}):
        raise ApiError(404, "resume_not_found", "Please choose one of your resumes to share.")
    r = await db[MEMBERSHIPS].update_one(
        {"_id": membership_id, "user_id": uid, "left_at": None},
        {"$set": {"resume_id": body.resume_id, "updated_at": now()}},
    )
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
@admin.get("/orgs")
async def list_orgs(db: DB, _: Admin) -> list[dict[str, Any]]:
    out = []
    async for o in db[ORGANIZATIONS].find({}).sort("created_at", -1):
        groups = await db[ORG_GROUPS].count_documents({"org_id": o["_id"]})
        members = await db[MEMBERSHIPS].count_documents({"org_id": o["_id"], "left_at": None})
        out.append(org_out(o, groups, members))
    return out


@admin.post("/orgs", status_code=201)
async def create_org(body: OrgIn, request: Request, db: DB, auth: Admin) -> dict[str, Any]:
    t = now()
    o = {
        "_id": new_id(),
        **body.model_dump(),
        "status": "active",
        "roles": [],  # reserved: owner / coordinator / viewer logins (later phases)
        "created_by": auth.user.id,
        "created_at": t,
        "updated_at": t,
    }
    await db[ORGANIZATIONS].insert_one(o)
    await audit(db, auth.user.id, "org_create", target=o["_id"], data={"name": o["name"]}, ip=_ip(request))
    return org_out(o)


async def _org(db, org_id: str) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    if not o:
        raise NOT_FOUND
    return o


@admin.get("/orgs/{org_id}")
async def get_org(org_id: str, db: DB, _: Admin) -> dict[str, Any]:
    o = await _org(db, org_id)
    groups = [
        group_out(g, await _active_members(db, g["_id"]))
        async for g in db[ORG_GROUPS].find({"org_id": org_id}).sort("created_at", -1)
    ]
    return {**org_out(o, len(groups), sum(g["members"] for g in groups)), "groupList": groups}


@admin.patch("/orgs/{org_id}")
async def update_org(org_id: str, body: OrgPatch, request: Request, db: DB, auth: Admin) -> dict[str, Any]:
    await _org(db, org_id)
    sets = body.model_dump(exclude_unset=True, exclude_none=True)
    await db[ORGANIZATIONS].update_one({"_id": org_id}, {"$set": {**sets, "updated_at": now()}})
    await audit(db, auth.user.id, "org_update", target=org_id, data=sets, ip=_ip(request))
    return await get_org(org_id, db, auth)


@admin.post("/orgs/{org_id}/groups", status_code=201)
async def create_group(org_id: str, body: GroupIn, request: Request, db: DB, auth: Admin) -> dict[str, Any]:
    o = await _org(db, org_id)
    code = await _code_free(db, body.code) if body.code else await new_code(db, o["name"])
    starts, ends = _dates(body.starts_on, body.ends_on)
    t = now()
    g = {
        "_id": new_id(),
        "org_id": org_id,
        "name": body.name,
        "code": code,
        "starts_on": starts,
        "ends_on": ends,
        "member_limit": body.member_limit,
        "custom_fields": _check_fields(body.custom_fields),
        "settings": body.settings.model_dump(),
        "created_by": auth.user.id,
        "created_at": t,
        "updated_at": t,
    }
    await db[ORG_GROUPS].insert_one(g)
    await audit(
        db,
        auth.user.id,
        "group_create",
        target=g["_id"],
        data={"org": org_id, "name": g["name"], "code": code},
        ip=_ip(request),
    )
    return group_out(g)


@admin.patch("/groups/{group_id}")
async def update_group(group_id: str, body: GroupPatch, request: Request, db: DB, auth: Admin) -> dict[str, Any]:
    g = await db[ORG_GROUPS].find_one({"_id": group_id})
    if not g:
        raise NOT_FOUND
    given = body.model_dump(exclude_unset=True)
    sets: dict[str, Any] = {}
    if "name" in given and body.name:
        sets["name"] = body.name
    if "code" in given and body.code:
        sets["code"] = await _code_free(db, body.code, but=group_id)
    if "starts_on" in given or "ends_on" in given:
        s = (
            body.starts_on
            if "starts_on" in given
            else (date.fromisoformat(g["starts_on"]) if g.get("starts_on") else None)
        )
        e = body.ends_on if "ends_on" in given else (date.fromisoformat(g["ends_on"]) if g.get("ends_on") else None)
        sets["starts_on"], sets["ends_on"] = _dates(s, e)
    if "member_limit" in given:
        sets["member_limit"] = body.member_limit
    if body.custom_fields is not None:
        sets["custom_fields"] = _check_fields(body.custom_fields)
    if body.settings is not None:
        sets["settings"] = body.settings.model_dump()
    await db[ORG_GROUPS].update_one({"_id": group_id}, {"$set": {**sets, "updated_at": now()}})
    await audit(
        db,
        auth.user.id,
        "group_update",
        target=group_id,
        data={k: v for k, v in sets.items() if k != "custom_fields"},
        ip=_ip(request),
    )
    g = await db[ORG_GROUPS].find_one({"_id": group_id})
    return group_out(g, await _active_members(db, group_id))


# ---------- admin: shared resumes ----------
@admin.get("/shared-resumes")
async def shared_resumes(
    db: DB,
    _: Admin,
    org: str | None = None,
    group: str | None = None,
    q: str | None = Query(None, max_length=100),
    joined_from: str | None = Query(None, alias="joinedFrom"),
    joined_to: str | None = Query(None, alias="joinedTo"),
    updated_from: str | None = Query(None, alias="updatedFrom"),
    updated_to: str | None = Query(None, alias="updatedTo"),
    field_key: str | None = Query(None, alias="fieldKey"),
    field_value: str | None = Query(None, alias="fieldValue"),
    incomplete: bool = False,
    not_printed: bool = Query(False, alias="notPrinted"),
    sort: str = "joined",
    direction: Literal["asc", "desc"] = Query("desc", alias="dir"),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100, alias="perPage"),
) -> dict[str, Any]:
    f = Filters(
        org=org,
        group=group,
        q=q,
        joined_from=joined_from,
        joined_to=joined_to,
        updated_from=updated_from,
        updated_to=updated_to,
        field_key=field_key,
        field_value=field_value,
        incomplete=incomplete,
        not_printed=not_printed,
    )
    try:
        rows = await _rows(db, f, sort, direction)
    except ValueError:
        raise ApiError(400, "bad_date", "Dates must look like 2026-10-16.") from None
    start = (page - 1) * per_page
    fields: dict[str, dict[str, Any]] = {}
    for g in (
        await db[ORG_GROUPS]
        .find({**({"org_id": org} if org else {}), **({"_id": group} if group else {})})
        .to_list(None)
    ):
        for d in g.get("custom_fields", []):
            fields.setdefault(d["key"], d)
    return {
        "total": len(rows),
        "page": page,
        "perPage": per_page,
        "rows": [row_out(r) for r in rows[start : start + per_page]],
        "fields": list(fields.values()),
    }


@admin.get("/shared-resumes/{membership_id}")
async def shared_resume(membership_id: str, request: Request, db: DB, auth: Admin) -> dict[str, Any]:
    rows = await shared_rows(db, {"_id": membership_id})
    if not rows:
        raise NOT_FOUND
    await audit(db, auth.user.id, "view", target=membership_id, data={"count": 1}, ip=_ip(request))
    return {**row_out(rows[0]), "data": printable(rows[0])}


CSV_HEAD = ["Name", "Email", "Phone", "Organization", "Group"]


@admin.post("/shared-resumes/export.csv")
async def export_csv(
    body: Filters,
    request: Request,
    db: DB,
    auth: Admin,
    sort: str = "name",
    direction: Literal["asc", "desc"] = Query("asc", alias="dir"),
) -> Response:
    key = f"org-export:{auth.user.id}"
    await rate_limit.check(db, key, EXPORT_RULES)
    await rate_limit.record(db, key)
    rows = await _rows(db, body, sort, direction)
    defs: dict[str, str] = {}
    for r in rows:
        for d in r["field_defs"]:
            defs.setdefault(d["key"], d["label"])
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([*CSV_HEAD, *defs.values(), "Completeness %", "Last updated", "Printed"])
    safe = lambda v: ("'" + v) if isinstance(v, str) and v[:1] in "=+-@" else v  # noqa: E731 — no spreadsheet formulas
    for r in rows:
        w.writerow(
            [
                safe(x)
                for x in (
                    r["name"],
                    r["email"],
                    r["phone"],
                    r["org_name"],
                    r["group_name"],
                    *[r["fields"].get(k, "") for k in defs],
                )
            ]
            + [
                r["completeness"],
                r["updated_at"].astimezone(IST).strftime("%Y-%m-%d %H:%M") if r["updated_at"] else "",
                r["printed_at"].astimezone(IST).strftime("%Y-%m-%d") if r["printed_at"] else "No",
            ]
        )
    await audit(
        db,
        auth.user.id,
        "export_csv",
        data={"count": len(rows), "filters": body.model_dump(exclude_defaults=True)},
        ip=_ip(request),
    )
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="nm7-shared-resumes.csv"'},
    )


@admin.post("/shared-resumes/exports", status_code=201)
async def start_export(body: ExportIn, request: Request, db: DB, auth: Admin) -> dict[str, Any]:
    """Starts a print / ZIP / single download: the ordered list of resumes and the file names (audited)."""
    key = f"org-export:{auth.user.id}"
    await rate_limit.check(db, key, EXPORT_RULES)
    await rate_limit.record(db, key)
    rows = await _rows(db, body.filters, body.sort, body.direction)
    if body.ids is not None:
        wanted = set(body.ids)
        rows = [r for r in rows if r["membership_id"] in wanted]
    if not rows:
        raise ApiError(400, "nothing_selected", "No shared resumes match. Change the filters or the selection.")
    names = unique_names([file_name(r["roll"], r["name"]) for r in rows])
    job = {
        "_id": secrets.token_urlsafe(12),
        "kind": body.kind,
        "actor_id": auth.user.id,
        "membership_ids": [r["membership_id"] for r in rows],
        "created_at": now(),
        "done_at": None,
    }
    await db[EXPORT_JOBS].insert_one(job)
    await audit(
        db,
        auth.user.id,
        body.kind,
        target=job["_id"],
        data={"count": len(rows), "memberships": job["membership_ids"][:200]},
        ip=_ip(request),
    )
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


async def _job(db, job_id: str, actor: str) -> dict[str, Any]:
    j = await db[EXPORT_JOBS].find_one({"_id": job_id, "actor_id": actor})
    if not j:
        raise ApiError(404, "not_found", "This export has expired. Please start it again.")
    return j


@admin.get("/shared-resumes/exports/{job_id}/data")
async def export_data(
    job_id: str, db: DB, auth: Admin, offset: int = Query(0, ge=0), limit: int = Query(BATCH, ge=1, le=BATCH)
) -> list[dict[str, Any]]:
    """One batch of the job's resumes, as the member prints them (hidden entries and private details removed)."""
    j = await _job(db, job_id, auth.user.id)
    ids = j["membership_ids"][offset : offset + limit]
    rows = {r["membership_id"]: r for r in await shared_rows(db, {"_id": {"$in": ids}})}
    return [{"membershipId": i, "data": printable(rows[i]) if i in rows else None} for i in ids]


@admin.post("/shared-resumes/exports/{job_id}/done")
async def export_done(job_id: str, db: DB, auth: Admin) -> dict[str, Any]:
    """The browser finished the file: printed / ZIP'd resumes are marked printed (once per job)."""
    j = await _job(db, job_id, auth.user.id)
    marked = 0
    if j["kind"] in ("print_bulk", "export_zip", "print") and not j.get("done_at"):
        t = now()
        r = await db[MEMBERSHIPS].update_many(
            {"_id": {"$in": j["membership_ids"]}}, {"$set": {"printed_at": t}, "$inc": {"printed_count": 1}}
        )
        marked = r.modified_count
    await db[EXPORT_JOBS].update_one({"_id": job_id}, {"$set": {"done_at": j.get("done_at") or now()}})
    return {"ok": True, "marked": marked}


@admin.get("/org-audit")
async def org_audit(db: DB, _: Admin, limit: int = Query(100, ge=1, le=500)) -> list[dict[str, Any]]:
    """The audit log entries for organizations, groups and shared resumes."""
    actions = [
        "view",
        "download",
        "print",
        "print_bulk",
        "export_zip",
        "export_csv",
        "group_create",
        "group_update",
        "org_create",
        "org_update",
    ]
    out = []
    async for e in db[AUDIT_LOG].find({"action": {"$in": actions}}).sort("at", -1).limit(limit):
        out.append(
            {
                "id": e["_id"],
                "actorId": e.get("actor_id"),
                "action": e["action"],
                "target": e.get("target"),
                "count": (e.get("data") or {}).get("count"),
                "at": ms(e["at"]),
            }
        )
    return out
