"""Organization staff (Phase 2): coordinators and viewers who run their own resume drives.

Admin:   /api/admin/orgs/{org_id}/staff (list, invite), /api/admin/staff/{id} (change, remove), …/resend
Invite:  GET /api/org-invites/{token} (what the link is for), POST …/accept (signed in, same verified email)
Member:  GET /api/me/orgs (organizations this account helps run)
Portal:  /api/org/{org_id} (summary), …/groups (coordinators create / edit), …/audit, and every shared-resumes
         endpoint from app.orgs.router.register_shared — all scoped by app.orgs.scope.org_scope.

Invite links are one-time: the token is stored hashed, cleared when accepted and replaced when resent; they expire
after 7 days. Only an account whose verified email is the invited address can accept.
"""

from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import Field, field_validator
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.billing.subscription import billing_summary, check_limit
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, ORG_GROUPS, ORG_STAFF, ORGANIZATIONS, USERS
from app.core.email import MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import hash_token, new_token
from app.core.time import now
from app.me.service import ms
from app.orgs import emails
from app.orgs.placement import register_placement
from app.orgs.router import audit_list, create_group_in, groups_with_counts, update_group_in
from app.orgs.scope import NOT_FOUND, AdminScope, OrgScope, Scope
from app.orgs.shapes import LOOKUP_RULES, GroupIn, GroupPatch, org_out
from app.orgs.shared import register_shared

admin_staff = APIRouter(prefix="/api/admin", tags=["organizations"])
invites = APIRouter(prefix="/api/org-invites", tags=["organizations"])
my_orgs = APIRouter(prefix="/api/me/orgs", tags=["organizations"])
portal = APIRouter(prefix="/api/org/{org_id}", tags=["organizations"])

INVITE_DAYS = 7
INVITE_RULES = [(50, timedelta(hours=1))]
ACCEPT_RULES = [(20, timedelta(hours=1))]
StaffRole = Literal["owner", "coordinator", "viewer"]  # Owner: Phase 4 (billing), invited by Nm7 only


class StaffIn(CamelModel):
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
    role: StaffRole = "coordinator"
    group_ids: list[str] | None = Field(None, max_length=200)  # None: every group of the organization

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        return v.strip()


class StaffPatch(CamelModel):
    role: StaffRole | None = None
    group_ids: list[str] | None = Field(None, max_length=200)


def staff_out(s: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": s["_id"],
        "email": s["email"],
        "name": (user or {}).get("name", ""),
        "role": s["role"],
        "groupIds": s.get("group_ids"),
        "status": s["status"],
        "invitedAt": ms(s.get("invited_at") or s["created_at"]),
        "expiresAt": ms(s.get("expires_at")) if s["status"] == "invited" else None,
        "acceptedAt": ms(s.get("accepted_at")),
    }


async def _check_groups(db, org_id: str, group_ids: list[str] | None) -> list[str] | None:
    if group_ids is None:
        return None
    ids = list(dict.fromkeys(group_ids))
    if not ids:
        raise ApiError(400, "groups_required", "Choose at least one group, or give access to all groups.")
    if await db[ORG_GROUPS].count_documents({"_id": {"$in": ids}, "org_id": org_id}) != len(ids):
        raise ApiError(400, "bad_groups", "Some of those groups aren’t in this organization.")
    return ids


async def _send_invite(db, mailer, s: dict[str, Any], org: dict[str, Any], inviter: str) -> dict[str, Any]:
    """A fresh one-time link (any older link stops working) valid for 7 days, emailed to the invited address."""
    token = new_token()
    t = now()
    sets = {"invite_token_hash": hash_token(token), "expires_at": t + timedelta(days=INVITE_DAYS), "invited_at": t}
    await db[ORG_STAFF].update_one({"_id": s["_id"]}, {"$set": sets})
    sent = await send_safely(mailer, emails.staff_invite(s["email"], org["name"], s["role"], token, inviter))
    url = f"{get_settings().site_url}/org/invite/{token}"
    return {**staff_out({**s, **sets}), "emailSent": sent, "inviteUrl": url}  # the link, for the admin to pass on


# ---------- admin: who runs each organization ----------
@admin_staff.get("/orgs/{org_id}/staff")
async def list_staff(org_id: str, db: DB, _: AdminScope) -> list[dict[str, Any]]:
    rows = (
        await db[ORG_STAFF].find({"org_id": org_id, "status": {"$ne": "removed"}}).sort("created_at", 1).to_list(None)
    )
    users = {
        u["_id"]: u async for u in db[USERS].find({"_id": {"$in": [s["user_id"] for s in rows if s.get("user_id")]}})
    }
    return [staff_out(s, users.get(s.get("user_id"))) for s in rows]


@admin_staff.post("/orgs/{org_id}/staff", status_code=201)
async def invite_staff(
    org_id: str, body: StaffIn, request: Request, db: DB, mailer: MailerDep, scope: AdminScope
) -> dict[str, Any]:
    org = await db[ORGANIZATIONS].find_one({"_id": org_id})
    if not org:
        raise NOT_FOUND
    return await _invite_staff(db, mailer, org, body, scope, request)


async def _invite_staff(db, mailer, org: dict[str, Any], body: StaffIn, scope: Scope, request: Request):
    """Nm7's admins invite anyone (an Owner included) and may go over the plan's coordinator limit on purpose; an
    Owner invites coordinators and viewers within the plan."""
    org_id = org["_id"]
    key = f"staff-invite:{scope.actor_id}"
    await rate_limit.check(db, key, INVITE_RULES)
    await rate_limit.record(db, key)
    group_ids = await _check_groups(db, org_id, body.group_ids)
    email_lc = body.email.lower()
    old = await db[ORG_STAFF].find_one({"org_id": org_id, "email_lc": email_lc})
    if old and old["status"] == "active":
        raise ApiError(409, "already_staff", f"{body.email} already helps run this organization.")
    if body.role != "owner" and not (old and old["status"] == "invited"):
        await check_limit(db, org, "coordinators", bypass=not scope.is_staff)
    t = now()
    s = {
        "org_id": org_id,
        "email": body.email,
        "email_lc": email_lc,
        "user_id": None,
        "role": body.role,
        "group_ids": group_ids,
        "status": "invited",
        "invited_by": scope.actor_id,
        "created_at": t,
    }
    if old:  # invited again after being removed (or a pending invite re-sent with new access)
        s = {**old, **{k: v for k, v in s.items() if k != "created_at"}}
        await db[ORG_STAFF].replace_one({"_id": old["_id"]}, s)
    else:
        s["_id"] = new_id()
        try:
            await db[ORG_STAFF].insert_one(s)
        except DuplicateKeyError:  # the same address invited twice at the same moment
            raise ApiError(409, "invite_exists", f"{body.email} was just invited to this organization.") from None
    inviter = (await db[USERS].find_one({"_id": scope.actor_id}, {"name": 1}) or {}).get("name") or "Nm7"
    out = await _send_invite(db, mailer, s, org, inviter)
    data = scope.audit_data([org_id], role=body.role, groups=len(group_ids) if group_ids else "all")
    await audit(db, scope.actor_id, "staff_invite", target=s["_id"], data=data, ip=client_ip(request))
    return out


async def _staff(db, staff_id: str) -> dict[str, Any]:
    s = await db[ORG_STAFF].find_one({"_id": staff_id, "status": {"$ne": "removed"}})
    if not s:
        raise NOT_FOUND
    return s


@admin_staff.patch("/staff/{staff_id}")
async def update_staff(staff_id: str, body: StaffPatch, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    s = await _staff(db, staff_id)
    given = body.model_dump(exclude_unset=True)
    sets: dict[str, Any] = {}
    if body.role:
        sets["role"] = body.role
    if "group_ids" in given:
        sets["group_ids"] = await _check_groups(db, s["org_id"], body.group_ids)
    if sets:
        await db[ORG_STAFF].update_one({"_id": staff_id}, {"$set": sets})
    data = scope.audit_data([s["org_id"]], role=sets.get("role", s["role"]), groups_changed="group_ids" in sets)
    await audit(db, scope.actor_id, "staff_update", target=staff_id, data=data, ip=client_ip(request))
    return staff_out({**s, **sets})


@admin_staff.post("/staff/{staff_id}/resend")
async def resend_invite(
    staff_id: str, request: Request, db: DB, mailer: MailerDep, scope: AdminScope
) -> dict[str, Any]:
    s = await _staff(db, staff_id)
    if s["status"] != "invited":
        raise ApiError(400, "not_invited", "This person already accepted the invite.")
    key = f"staff-invite:{scope.actor_id}"
    await rate_limit.check(db, key, INVITE_RULES)
    await rate_limit.record(db, key)
    org = await db[ORGANIZATIONS].find_one({"_id": s["org_id"]})
    inviter = (await db[USERS].find_one({"_id": scope.actor_id}, {"name": 1}) or {}).get("name") or "Nm7"
    out = await _send_invite(db, mailer, s, org, inviter)
    await audit(
        db, scope.actor_id, "staff_resend", target=staff_id, data=scope.audit_data([s["org_id"]]), ip=client_ip(request)
    )
    return out


@admin_staff.delete("/staff/{staff_id}", status_code=204)
async def remove_staff(staff_id: str, request: Request, db: DB, scope: AdminScope) -> Response:
    """Access ends at once: every portal request re-reads org_staff."""
    s = await _staff(db, staff_id)
    await db[ORG_STAFF].update_one(
        {"_id": staff_id}, {"$set": {"status": "removed", "invite_token_hash": None, "removed_at": now()}}
    )
    await audit(
        db, scope.actor_id, "staff_remove", target=staff_id, data=scope.audit_data([s["org_id"]]), ip=client_ip(request)
    )
    return Response(status_code=204)


# ---------- the invite link ----------
INVALID = ApiError(404, "invite_invalid", "This invite link was already used or replaced. Ask Nm7 for a new one.")


async def _invite(db, token: str) -> dict[str, Any]:
    s = await db[ORG_STAFF].find_one({"invite_token_hash": hash_token(token), "status": "invited"})
    if not s:
        raise INVALID
    if s["expires_at"] < now():
        raise ApiError(410, "invite_expired", "This invite has expired. Ask Nm7 to send a new one.")
    return s


@invites.get("/{token}")
async def invite_info(token: str, request: Request, db: DB) -> dict[str, Any]:
    key = f"invite-lookup:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, LOOKUP_RULES)
    await rate_limit.record(db, key)
    s = await _invite(db, token)
    org = await db[ORGANIZATIONS].find_one({"_id": s["org_id"]}, {"name": 1})
    return {"orgName": (org or {}).get("name", ""), "email": s["email"], "role": s["role"]}


@invites.post("/{token}/accept")
async def accept_invite(token: str, request: Request, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    key = f"invite-accept:{auth.user.id}"
    await rate_limit.check(db, key, ACCEPT_RULES)
    await rate_limit.record(db, key)
    s = await _invite(db, token)
    u = auth.user
    if not u.email_verified_at:
        raise ApiError(403, "email_unverified", "Please confirm your email address first.")
    if u.email.strip().lower() != s["email_lc"]:
        raise ApiError(
            403, "email_mismatch", f"This invite is for {s['email']}. Sign in with that email address to accept it."
        )
    r = await db[ORG_STAFF].update_one(  # the token works once: cleared in the same write that accepts it
        {"_id": s["_id"], "invite_token_hash": s["invite_token_hash"], "status": "invited"},
        {"$set": {"status": "active", "user_id": u.id, "invite_token_hash": None, "accepted_at": now()}},
    )
    if not r.modified_count:
        raise INVALID
    data = {"orgs": [s["org_id"]], "by": "staff", "role": s["role"]}
    await audit(db, u.id, "staff_accept", target=s["_id"], data=data, ip=client_ip(request))
    return {"orgId": s["org_id"], "role": s["role"]}


# ---------- the coordinator's own organizations ----------
@my_orgs.get("")
async def mine(db: DB, auth: CustomerAuth) -> list[dict[str, Any]]:
    rows = await db[ORG_STAFF].find({"user_id": auth.user.id, "status": "active"}).to_list(None)
    orgs = {
        o["_id"]: o
        async for o in db[ORGANIZATIONS].find(
            {"_id": {"$in": [s["org_id"] for s in rows]}, "status": {"$ne": "archived"}}
        )
    }
    return [
        {
            "orgId": s["org_id"],
            "orgName": orgs[s["org_id"]]["name"],
            "role": s["role"],
            "allGroups": s.get("group_ids") is None,
        }
        for s in rows
        if s["org_id"] in orgs
    ]


# ---------- the portal ----------
@portal.get("")
async def portal_home(db: DB, scope: OrgScope) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    match: dict[str, Any] = {"org_id": scope.org_id}
    if scope.group_ids is not None:
        match["_id"] = {"$in": scope.group_ids}
    groups = await groups_with_counts(db, match)
    return {
        **org_out(o, len(groups), sum(g["members"] for g in groups)),
        "groupList": groups,
        "role": scope.role,
        "allGroups": scope.group_ids is None,
        "canManage": scope.role != "viewer",
        "canCreateGroups": scope.role != "viewer" and scope.group_ids is None,
        "isOwner": scope.role in ("owner", "admin"),
        "billing": await billing_summary(db, o),  # plan, usage and banners (80% used, ends soon, grace)
    }


@portal.post("/groups", status_code=201)
async def portal_create_group(body: GroupIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    scope.require("manage")
    if scope.group_ids is not None:
        raise ApiError(403, "groups_limited", "Your access covers some groups only — ask Nm7 to add a new group.")
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    return await create_group_in(db, scope, o, body, client_ip(request))


@portal.patch("/groups/{group_id}")
async def portal_update_group(
    group_id: str, body: GroupPatch, request: Request, db: DB, scope: OrgScope
) -> dict[str, Any]:
    g = await scope.group(db, group_id)
    scope.require("manage")
    return await update_group_in(db, scope, g, body, client_ip(request))


class TeamIn(StaffIn):
    role: Literal["coordinator", "viewer"] = "coordinator"


@portal.get("/team")
async def portal_team(db: DB, scope: OrgScope) -> list[dict[str, Any]]:
    """Owner: who helps run the organization (Owners, coordinators, viewers)."""
    scope.require("team")
    return await list_staff(scope.org_id, db, scope)


@portal.post("/team", status_code=201)
async def portal_invite(body: TeamIn, request: Request, db: DB, mailer: MailerDep, scope: OrgScope) -> dict[str, Any]:
    scope.require("team")
    org = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    return await _invite_staff(db, mailer, org, body, scope, request)


@portal.delete("/team/{staff_id}", status_code=204)
async def portal_remove(staff_id: str, request: Request, db: DB, scope: OrgScope) -> Response:
    scope.require("team")
    s = await _staff(db, staff_id)
    if s["org_id"] != scope.org_id:
        raise NOT_FOUND
    if s["role"] == "owner":
        raise ApiError(403, "owner_stays", "An Owner can only be removed by Nm7.")
    await db[ORG_STAFF].update_one(
        {"_id": staff_id}, {"$set": {"status": "removed", "invite_token_hash": None, "removed_at": now()}}
    )
    data = scope.audit_data([s["org_id"]], role=s["role"])
    await audit(db, scope.actor_id, "staff_remove", target=staff_id, data=data, ip=client_ip(request))
    return Response(status_code=204)


@portal.get("/audit")
async def portal_audit(db: DB, scope: OrgScope, limit: int = Query(100, ge=1, le=500)) -> list[dict[str, Any]]:
    """This organization's audit log (everyone's actions on it, admins included)."""
    scope.require("audit")
    return await audit_list(db, {"data.orgs": scope.org_id}, limit)


register_shared(portal, OrgScope)
register_placement(portal, OrgScope)
