"""Nm7 for Organizations — admin API: organizations and their groups (super-admin = "owner" role), the
organization audit view, and the group helpers the coordinator portal reuses (app/orgs/staff.py).

The rest of the organizations API lives next to this file:
  app/orgs/members.py  public join page, one-click "stop reminders", /api/me/groups (join with consent, leave …)
  app/orgs/shared.py   shared-resumes table, exports, approvals, reviews, reminders and group dashboards, mounted
                       on /api/admin (every organization) and /api/org/{org_id} (one organization)
  app/orgs/shapes.py   limits, request bodies and the JSON shapes answered

Bulk print / ZIP: the browser draws the PDFs with the same code members download with (so every page matches the
member's template exactly) and asks the server for the data in small batches of one export job:
POST …/exports (audited, returns the ordered list) → GET …/exports/{job}/data?offset=&limit= → POST …/exports/{job}/done
(marks the memberships printed). Nothing heavy runs on the API server, so the Render free plan never times out.
Exports only ever contain approved members.
"""

import logging
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Query, Request
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.auth.models import new_id
from app.core.db import AUDIT_LOG, DB, MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS, RESUMES, USERS
from app.core.errors import ApiError
from app.core.time import now
from app.me.service import ms
from app.orgs.scope import FEATURES, NOT_FOUND, AdminScope, Scope, features_of, require_feature
from app.orgs.service import (
    CODE,
    active_members,
    new_code,
    normalize_code,
)
from app.orgs.shapes import (
    FeaturesIn,
    GroupIn,
    GroupPatch,
    GroupSettings,
    OrgIn,
    OrgPatch,
    _check_fields,
    _ip,
    group_out,
    org_out,
)

log = logging.getLogger("nm7.orgs")

admin = APIRouter(prefix="/api/admin", tags=["organizations"])


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


FREE_ONLY_NM7 = ApiError(403, "nm7_only", "Only Nm7 can make downloads free for a group’s members.")


async def create_group_in(db, scope: Scope, o: dict[str, Any], body: GroupIn, ip: str | None) -> dict[str, Any]:
    if scope.is_staff and body.settings.members_download_free:
        raise FREE_ONLY_NM7
    if body.settings.print_branded:
        require_feature(o, "branding")
    if body.settings.share_with_recruiters:
        require_feature(o, "recruiter_links")
    starts, ends = _dates(body.starts_on, body.ends_on)
    fields = _check_fields(body.custom_fields)
    for attempt in range(3):  # two groups made at the same moment: a generated code is tried again
        code = await _code_free(db, body.code) if body.code else await new_code(db, o["name"])
        t = now()
        g = {
            "_id": new_id(),
            "org_id": o["_id"],
            "name": body.name,
            "code": code,
            "starts_on": starts,
            "ends_on": ends,
            "member_limit": body.member_limit,
            "custom_fields": fields,
            "settings": body.settings.model_dump(),
            "created_by": scope.actor_id,
            "created_at": t,
            "updated_at": t,
        }
        try:
            await db[ORG_GROUPS].insert_one(g)
            break
        except DuplicateKeyError:
            if body.code or attempt == 2:
                raise ApiError(409, "code_taken", f"The code {code} was just taken by another group.") from None
    data = scope.audit_data([o["_id"]], name=g["name"], code=code)
    await audit(db, scope.actor_id, "group_create", target=g["_id"], data=data, ip=ip)
    return group_out(g)


async def update_group_in(db, scope: Scope, g: dict[str, Any], body: GroupPatch, ip: str | None) -> dict[str, Any]:
    given = body.model_dump(exclude_unset=True)
    if scope.is_staff and body.settings and body.settings.members_download_free is not None:
        if body.settings.members_download_free != g.get("settings", {}).get("members_download_free", False):
            raise FREE_ONLY_NM7
    if body.settings and (body.settings.print_branded or body.settings.share_with_recruiters):
        o = await db[ORGANIZATIONS].find_one({"_id": g["org_id"]})
        if body.settings.print_branded:
            require_feature(o, "branding")
        if body.settings.share_with_recruiters:
            require_feature(o, "recruiter_links")
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
    try:
        await db[ORG_GROUPS].update_one({"_id": g["_id"]}, {"$set": {**sets, "updated_at": now()}})
    except DuplicateKeyError:  # the code was taken between the check and the write
        raise ApiError(409, "code_taken", f"The code {sets['code']} is already used by another group.") from None
    data = scope.audit_data([g["org_id"]], **{k: v for k, v in sets.items() if k != "custom_fields"})
    await audit(db, scope.actor_id, "group_update", target=g["_id"], data=data, ip=ip)
    g = await db[ORG_GROUPS].find_one({"_id": g["_id"]})
    return group_out(g, await active_members(db, g["_id"]))


ORG_ACTIONS = [
    "view", "download", "print", "print_bulk", "export_zip", "export_csv", "group_create", "group_update",
    "org_create", "org_update", "remind", "approve", "reject", "review", "unprint",
    "staff_invite", "staff_update", "staff_remove", "staff_accept", "staff_resend",
    "member_join", "member_update", "member_leave", "org_features",
    "kiosk_create", "kiosk_revoke", "kiosk_session", "kiosk_print", "branding_update",
    "share_create", "share_view", "share_download", "share_shortlist", "share_revoke", "share_extend",
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


@admin.put("/orgs/{org_id}/features")
async def set_features(org_id: str, body: FeaturesIn, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    """Admin → Organizations → (organization) → Features. Coordinators never reach this (it's /api/admin)."""
    o = await _org(db, org_id)
    sets = {f"features.{k}": v for k, v in body.model_dump(exclude_none=True).items()}
    if sets:
        await db[ORGANIZATIONS].update_one({"_id": org_id}, {"$set": {**sets, "updated_at": now()}})
    after = features_of(await _org(db, org_id))
    changed = {k: after[k] for k in FEATURES if after[k] != features_of(o)[k]}
    await audit(
        db, scope.actor_id, "org_features", target=org_id, data=scope.audit_data([org_id], **changed), ip=_ip(request)
    )
    return await get_org(org_id, db, scope)


@admin.post("/orgs/{org_id}/groups", status_code=201)
async def create_group(org_id: str, body: GroupIn, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    return await create_group_in(db, scope, await _org(db, org_id), body, _ip(request))


@admin.patch("/groups/{group_id}")
async def update_group(group_id: str, body: GroupPatch, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    return await update_group_in(db, scope, await scope.group(db, group_id), body, _ip(request))


@admin.get("/groups/{group_id}/membership-check")
async def membership_check(group_id: str, db: DB, scope: AdminScope) -> dict[str, Any]:
    """Read-only: every membership tied to this group or its organization (plus any join in the last 7 days), each
    with the reason it is or isn't shown in the shared-resumes table. No emails; names as initials."""
    g = await scope.group(db, group_id)
    since = now() - timedelta(days=7)
    q = {"$or": [{"group_id": group_id}, {"org_id": g["org_id"]}, {"joined_at": {"$gte": since}}]}
    ms_ = await db[MEMBERSHIPS].find(q).sort("joined_at", -1).limit(200).to_list(None)
    uids = list({m.get("user_id") for m in ms_})
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": uids}}, {"name": 1, "disabled_at": 1})}
    resumes = {
        (r["user_id"], r["key"]) async for r in db[RESUMES].find({"user_id": {"$in": uids}}, {"user_id": 1, "key": 1})
    }
    gids = list({m.get("group_id") for m in ms_})
    names = {x["_id"]: x["name"] async for x in db[ORG_GROUPS].find({"_id": {"$in": gids}}, {"name": 1})}
    initials = lambda n: "".join(w[0] for w in (n or "?").split()[:3]).upper()  # noqa: E731
    out = []
    for m in ms_:
        u = users.get(m.get("user_id"))
        reasons = []
        if m.get("group_id") != group_id:
            reasons.append("other_group")
        if m.get("left_at") is not None:
            reasons.append("left")
        if not (m.get("consent") or {}).get("given"):
            reasons.append("no_consent")
        if not u:
            reasons.append("account_missing")
        elif u.get("disabled_at") is not None:
            reasons.append("account_disabled")
        if (m.get("user_id"), m.get("resume_id")) not in resumes:
            reasons.append("resume_missing")
        out.append(
            {
                "id": m["_id"],
                "initials": initials((u or {}).get("name")),
                "group": names.get(m.get("group_id"), "(deleted group)"),
                "groupId": m.get("group_id"),
                "joinedAt": ms(m.get("joined_at")),
                "leftAt": ms(m.get("left_at")),
                "approval": m.get("approval") or "approved",
                "reasons": reasons,
                "shown": not reasons,
            }
        )
    raw = {
        "inGroup": await db[MEMBERSHIPS].count_documents({"group_id": group_id}),
        "activeInGroup": await active_members(db, group_id),
    }
    return {"group": {"id": g["_id"], "name": g["name"], "code": g["code"]}, "counts": raw, "memberships": out}


@admin.get("/org-audit")
async def org_audit(db: DB, _: AdminScope, limit: int = Query(100, ge=1, le=500)) -> list[dict[str, Any]]:
    """Every organization audit entry (admins and coordinators)."""
    return await audit_list(db, {}, limit)


# ---------- shared resumes: one implementation, mounted for the admin and for each organization's staff ----------


# kept importable from here (app.main, staff, kiosk, recruiter and tests use these names)
from app.orgs.members import _join, me, public, public_stop  # noqa: E402, F401
from app.orgs.shared import _rows, register_shared  # noqa: E402, F401

register_shared(admin, AdminScope)
