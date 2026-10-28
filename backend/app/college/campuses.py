"""Multiple campuses under one college group (feature `multi_campus`: Campus plan; Nm7's admin sets groups up).

A parent "college group" owns several campus organizations. Each campus keeps its own coordinators, plan and data:
campus coordinators never see other campuses (nothing here changes their scope). The group's owners see roll-up
numbers only — joined, ready, placed, packages per campus — never a student's resume or contact details. They can
set one college format (branding / placement template) for every campus, and share a drive day's schedule or a
recruiter invite with other campuses (each campus gets its own copy, with its own students).

Billing: each campus keeps its own plan (one Campus plan per campus), unless Nm7 agrees a group price; that price is
recorded on the group for the admin's billing and applied to each campus as a custom plan by the admin.

Admin (/api/admin/college-groups; Organizations permission):
  GET "" · POST "" {name} · PUT /{id} {name, orgIds, ownerEmails, groupPrice, priceNote} · DELETE /{id}
Group owners (/api/college-group/{id}):
  GET ""                      roll-up dashboard by campus
  PUT /format                 {fromOrgId}: copy that campus's college format to every campus in the group
  POST /share-drive           {orgId, driveId, toOrgIds}: copy a drive day's schedule (companies, rooms, times)
  POST /share-invite          {orgId, inviteId, toOrgIds}: the same recruiter invited to other campuses
Members: GET /api/me/college-groups — the groups I own.
"""

import secrets
import statistics
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Request
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.deps import Auth, CustomerAuth, get_auth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.core.config import get_settings
from app.core.db import (
    COLLEGE_GROUPS,
    DB,
    DRIVES,
    MEMBERSHIPS,
    OFFERS,
    ORG_GROUPS,
    ORGANIZATIONS,
    RECRUITER_INVITES,
    USERS,
)
from app.core.email import MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.orgs.scope import NOT_FOUND, AdminScope, features_of

admin = APIRouter(prefix="/api/admin/college-groups", tags=["campuses"])
owner = APIRouter(prefix="/api/college-group/{group_id}", tags=["campuses"])
me = APIRouter(prefix="/api/me/college-groups", tags=["campuses"])


class GroupIn(CamelModel):
    name: str = Field(min_length=2, max_length=100)

    @field_validator("name")
    @classmethod
    def _tidy(cls, v):
        return " ".join(v.split())


class GroupPut(GroupIn):
    org_ids: list[str] = Field(default_factory=list, max_length=50)
    owner_emails: list[str] = Field(default_factory=list, max_length=10)
    group_price: int | None = Field(None, ge=0, le=100_000_000_00)  # paise, per year, for the whole group
    price_note: str = Field("", max_length=200)


class FormatIn(CamelModel):
    from_org_id: str = Field(max_length=64)


class ShareIn(CamelModel):
    org_id: str = Field(max_length=64)
    item_id: str = Field(max_length=64, alias="driveId")
    to_org_ids: list[str] = Field(min_length=1, max_length=50)


class ShareInviteIn(CamelModel):
    org_id: str = Field(max_length=64)
    invite_id: str = Field(max_length=64)
    to_org_ids: list[str] = Field(min_length=1, max_length=50)


async def _orgs(db, ids: list[str]) -> dict[str, dict[str, Any]]:
    return {o["_id"]: o async for o in db[ORGANIZATIONS].find({"_id": {"$in": ids}})}


def group_out(
    g: dict[str, Any], orgs: dict[str, dict[str, Any]], owners: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    return {
        "id": g["_id"],
        "name": g["name"],
        "campuses": [
            {"id": oid, "name": orgs[oid]["name"], "multiCampus": features_of(orgs[oid])["multi_campus"]}
            for oid in g.get("org_ids", [])
            if oid in orgs
        ],
        "owners": [{"email": u["email"], "name": u.get("name", "")} for u in owners or []],
        "groupPrice": g.get("group_price"),
        "priceNote": g.get("price_note", ""),
        "createdAt": ms(g["created_at"]),
    }


# ---------- admin ----------
@admin.get("")
async def list_groups(db: DB, scope: AdminScope) -> list[dict[str, Any]]:
    rows = await db[COLLEGE_GROUPS].find().sort("created_at", -1).to_list(200)
    orgs = await _orgs(db, list({o for g in rows for o in g.get("org_ids", [])}))
    users = {
        u["_id"]: u
        async for u in db[USERS].find(
            {"_id": {"$in": list({u for g in rows for u in g.get("owner_ids", [])})}}, {"email": 1, "name": 1}
        )
    }
    return [group_out(g, orgs, [users[u] for u in g.get("owner_ids", []) if u in users]) for g in rows]


@admin.post("", status_code=201)
async def create_group(body: GroupIn, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    g = {
        "_id": new_id(),
        "name": body.name,
        "org_ids": [],
        "owner_ids": [],
        "created_at": now(),
        "created_by": scope.actor_id,
    }
    await db[COLLEGE_GROUPS].insert_one(g)
    await audit(
        db, scope.actor_id, "college_group_create", target=g["_id"], data={"name": body.name}, ip=client_ip(request)
    )
    return group_out(g, {})


@admin.put("/{group_id}")
async def edit_group(group_id: str, body: GroupPut, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    g = await db[COLLEGE_GROUPS].find_one({"_id": group_id})
    if not g:
        raise NOT_FOUND
    orgs = await _orgs(db, body.org_ids)
    if len(orgs) != len(set(body.org_ids)):
        raise ApiError(400, "unknown_org", "One of those organizations doesn't exist.")
    other = await db[COLLEGE_GROUPS].find_one({"_id": {"$ne": group_id}, "org_ids": {"$in": body.org_ids}})
    if other:
        raise ApiError(
            409, "already_in_group", f"A campus can be in one college group only (already in “{other['name']}”)."
        )
    owners = []
    for e in body.owner_emails:
        u = await db[USERS].find_one({"email_lc": e.strip().lower()}, {"email": 1, "name": 1})
        if not u:
            raise ApiError(400, "no_account", f"{e} has no Nm7 account yet. Ask them to sign up first.")
        owners.append(u)
    sets = {
        "name": body.name,
        "org_ids": list(dict.fromkeys(body.org_ids)),
        "owner_ids": [u["_id"] for u in owners],
        "group_price": body.group_price,
        "price_note": body.price_note.strip(),
    }
    await db[COLLEGE_GROUPS].update_one({"_id": group_id}, {"$set": sets})
    await audit(
        db,
        scope.actor_id,
        "college_group_update",
        target=group_id,
        data={"orgs": sets["org_ids"], "owners": len(owners)},
        ip=client_ip(request),
    )
    return group_out({**g, **sets}, orgs, owners)


@admin.delete("/{group_id}")
async def delete_group(group_id: str, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    r = await db[COLLEGE_GROUPS].delete_one({"_id": group_id})
    if not r.deleted_count:
        raise NOT_FOUND
    await audit(db, scope.actor_id, "college_group_delete", target=group_id, ip=client_ip(request))
    return {"deleted": True}


# ---------- group owners ----------
async def group_scope(
    db: DB, auth: Annotated[Auth, Depends(get_auth)], group_id: str = Path(max_length=64)
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    g = await db[COLLEGE_GROUPS].find_one({"_id": group_id, "owner_ids": auth.user.id})
    if not g:
        raise NOT_FOUND
    orgs = {
        k: v
        for k, v in (await _orgs(db, g.get("org_ids", []))).items()
        if features_of(v)["multi_campus"] and v.get("status") != "archived"
    }
    if not orgs:
        raise NOT_FOUND
    return g, orgs


GroupScope = Annotated[tuple, Depends(group_scope)]


async def _campus_numbers(db, org: dict[str, Any]) -> dict[str, Any]:
    q = {"org_id": org["_id"], "left_at": None, "consent.given": True}
    joined = await db[MEMBERSHIPS].count_documents(q)
    ready = await db[MEMBERSHIPS].count_documents({**q, "review_status": "ready"})
    live = (
        await db[OFFERS]
        .find({"org_id": org["_id"], "status": {"$ne": "declined"}}, {"membership_id": 1, "type": 1, "ctc_lpa": 1})
        .to_list(None)
    )
    placing = [o for o in live if o["type"] in ("full_time", "ppo")]
    pk = sorted(o["ctc_lpa"] for o in placing if o.get("ctc_lpa") is not None)
    return {
        "id": org["_id"],
        "name": org["name"],
        "joined": joined,
        "ready": ready,
        "placed": len({o["membership_id"] for o in placing}),
        "offers": len(live),
        "highest": round(pk[-1], 2) if pk else None,
        "median": round(statistics.median(pk), 2) if pk else None,
        "average": round(sum(pk) / len(pk), 2) if pk else None,
        "_pk": pk,
    }


@owner.get("")
async def dashboard(db: DB, gs: GroupScope) -> dict[str, Any]:
    """Counts by campus — never a student's name, resume or contact details."""
    g, orgs = gs
    rows = [await _campus_numbers(db, orgs[oid]) for oid in g["org_ids"] if oid in orgs]
    pk = sorted(x for r in rows for x in r.pop("_pk"))
    total = {k: sum(r[k] for r in rows) for k in ("joined", "ready", "placed", "offers")}
    total.update(
        highest=round(pk[-1], 2) if pk else None,
        median=round(statistics.median(pk), 2) if pk else None,
        average=round(sum(pk) / len(pk), 2) if pk else None,
    )
    return {"id": g["_id"], "name": g["name"], "campuses": rows, "total": total}


async def _log_each(db, actor: str, request: Request, action: str, org_ids: list[str], **data: Any) -> None:
    for oid in org_ids:
        await audit(
            db, actor, action, target=oid, data={"orgs": [oid], "by": "college_group", **data}, ip=client_ip(request)
        )


@owner.get("/items")
async def items(db: DB, gs: GroupScope) -> list[dict[str, Any]]:
    """What can be shared, by campus: drive days (name, date) and live recruiter invites (company). No student data."""
    g, orgs = gs
    out = []
    for oid in g["org_ids"]:
        if oid not in orgs:
            continue
        drives = [
            {"id": d["_id"], "name": d["name"], "date": d["date"]}
            async for d in db[DRIVES].find({"org_id": oid}, {"name": 1, "date": 1}).sort("date", -1).limit(30)
        ]
        invs = [
            {"id": i["_id"], "company": i["company"]}
            async for i in db[RECRUITER_INVITES]
            .find({"org_id": oid, "revoked_at": None, "expires_at": {"$gt": now()}}, {"company": 1})
            .limit(30)
        ]
        out.append({"id": oid, "name": orgs[oid]["name"], "drives": drives, "invites": invs})
    return out


@owner.put("/format")
async def share_format(body: FormatIn, request: Request, db: DB, gs: GroupScope, auth: CustomerAuth) -> dict[str, Any]:
    g, orgs = gs
    src = orgs.get(body.from_org_id)
    if not src:
        raise NOT_FOUND
    fmt = src.get("branding") or {}
    to = [oid for oid in orgs if oid != src["_id"]]
    await db[ORGANIZATIONS].update_many({"_id": {"$in": to}}, {"$set": {"branding": {**fmt, "updated_at": now()}}})
    await _log_each(db, auth.user.id, request, "college_format_shared", to, group=g["_id"], source=src["_id"])
    return {"updated": len(to)}


@owner.post("/share-drive")
async def share_drive(body: ShareIn, request: Request, db: DB, gs: GroupScope, auth: CustomerAuth) -> dict[str, Any]:
    """Each chosen campus gets its own copy of the schedule (companies, rounds, rooms, times) for all its groups;
    students are placed by that campus's coordinators."""
    g, orgs = gs
    if body.org_id not in orgs or any(o not in orgs for o in body.to_org_ids):
        raise NOT_FOUND
    d = await db[DRIVES].find_one({"_id": body.item_id, "org_id": body.org_id})
    if not d:
        raise NOT_FOUND
    made = 0
    for oid in body.to_org_ids:
        if oid == body.org_id or not features_of(orgs[oid])["drives"]:
            continue
        gids = [x["_id"] async for x in db[ORG_GROUPS].find({"org_id": oid}, {"_id": 1})]
        comp = {c["id"]: new_id() for c in d["companies"]}
        await db[DRIVES].insert_one(
            {
                "_id": new_id(),
                "org_id": oid,
                "name": d["name"],
                "date": d["date"],
                "group_ids": gids,
                "companies": [
                    {"id": comp[c["id"]], "name": c["name"], **({"rules": c["rules"]} if c.get("rules") else {})}
                    for c in d["companies"]
                ],
                "slots": [
                    {
                        **{k: v for k, v in s.items() if k not in ("id", "company_id", "members")},
                        "id": new_id(),
                        "company_id": comp[s["company_id"]],
                        "members": [],
                    }
                    for s in d.get("slots", [])
                ],
                "shared_from": {"org": body.org_id, "drive": d["_id"], "group": g["_id"]},
                "created_by": auth.user.id,
                "created_at": now(),
            }  # fmt: skip
        )
        made += 1
    await _log_each(db, auth.user.id, request, "college_drive_shared", body.to_org_ids, group=g["_id"], drive=d["_id"])
    return {"copied": made}


@owner.post("/share-invite")
async def share_invite(
    body: ShareInviteIn, request: Request, db: DB, gs: GroupScope, auth: CustomerAuth, mailer: MailerDep
) -> dict[str, Any]:
    """The same recruiter is invited to other campuses: one invite per campus (its groups that share with
    recruiters), each emailed to the recruiter with its own link, like any invite. Students still appear only if
    they allowed recruiter sharing."""
    from app.orgs.recruiter_portal import _email, _hash

    g, orgs = gs
    if body.org_id not in orgs or any(o not in orgs for o in body.to_org_ids):
        raise NOT_FOUND
    inv = await db[RECRUITER_INVITES].find_one({"_id": body.invite_id, "org_id": body.org_id, "revoked_at": None})
    if not inv:
        raise NOT_FOUND
    made = 0
    for oid in body.to_org_ids:
        if oid == body.org_id or not features_of(orgs[oid])["recruiter_links"]:
            continue
        gids = [
            x["_id"]
            async for x in db[ORG_GROUPS].find({"org_id": oid, "settings.share_with_recruiters": True}, {"_id": 1})
        ]
        if not gids:
            continue
        token = secrets.token_urlsafe(32)
        copy = {
            k: inv[k]
            for k in ("company", "recruiter_name", "email", "email_lc", "branches", "allow_pdf", "contact")
            if k in inv
        }
        new = {
            **copy,
            "_id": new_id(),
            "org_id": oid,
            "group_ids": sorted(gids),
            "expires_at": max(inv["expires_at"], now() + timedelta(days=1)),
            "revoked_at": None,
            "token_hash": _hash("token", token),
            "board": {},
            "views": 0,
            "downloads": 0,
            "sessions": [],
            "shared_from": {"org": body.org_id, "invite": inv["_id"], "group": g["_id"]},
            "created_by": auth.user.id,
            "created_at": now(),
        }
        await db[RECRUITER_INVITES].insert_one(new)
        await send_safely(mailer, _email(new, orgs[oid]["name"], f"{get_settings().site_url}/recruiter/{token}"))
        made += 1
    await _log_each(
        db, auth.user.id, request, "college_invite_shared", body.to_org_ids, group=g["_id"], invite=inv["_id"]
    )
    return {"copied": made}


@me.get("")
async def my_groups(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    return [
        {"id": g["_id"], "name": g["name"], "campuses": len(g.get("org_ids", []))}
        async for g in db[COLLEGE_GROUPS].find({"owner_ids": auth.user.id})
    ]
