"""Shared pieces of the college features (drives, eligibility, offers, reminders, alumni, reviewers, campuses).

Every staff endpoint starts from the server-side Scope (app/orgs/scope.py): a coordinator sees only their
organization (and, when limited, their groups); anything else is 404. Students appear only while they are active
members who gave consent (left members and members without consent are never listed). Every staff action is written
to the organization's Activity log through `log()`.
"""

import re
from datetime import date, datetime, time
from typing import Any

from fastapi import Request

from app.audit import audit
from app.auth.sessions import client_ip
from app.core.db import MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS, USERS
from app.core.time import IST
from app.orgs.placement import BRANCH_FIELD
from app.orgs.scope import NOT_FOUND, Scope, require_feature
from app.orgs.service import roll_key

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


async def org_with(db, scope: Scope, feature: str) -> dict[str, Any]:
    """The scope's organization, with this feature on (else 404, like anything outside the scope)."""
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    require_feature(o, feature)
    return o


async def scoped_groups(db, scope: Scope, group_ids: list[str] | None = None) -> list[dict[str, Any]]:
    """Groups of the scope's organization the scope may see (optionally only these ids; unknown ids: 404)."""
    q: dict[str, Any] = {"org_id": scope.org_id}
    if scope.group_ids is not None:
        q["_id"] = {"$in": scope.group_ids}
    groups = await db[ORG_GROUPS].find(q).to_list(None)
    if group_ids is None:
        return groups
    by = {g["_id"]: g for g in groups}
    if any(i not in by for i in group_ids):
        raise NOT_FOUND
    return [by[i] for i in dict.fromkeys(group_ids)]


def branch_key(defs: list[dict[str, Any]]) -> str | None:
    for f in defs:
        if BRANCH_FIELD.search(f"{f['key']} {f['label']}"):
            return f["key"]
    return None


async def members_of(db, groups: list[dict[str, Any]], ids: list[str] | None = None) -> list[dict[str, Any]]:
    """Active, consenting members of these groups: id, name, roll, branch, group. Sorted by roll, then name."""
    if not groups:
        return []
    gby = {g["_id"]: g for g in groups}
    q: dict[str, Any] = {"group_id": {"$in": list(gby)}, "left_at": None, "consent.given": True}
    if ids is not None:
        q["_id"] = {"$in": ids}
    ms_ = await db[MEMBERSHIPS].find(q).to_list(None)
    users = {
        u["_id"]: u
        async for u in db[USERS].find({"_id": {"$in": list({m["user_id"] for m in ms_})}}, {"name": 1, "phone": 1})
    }
    out = []
    for m in ms_:
        g = gby[m["group_id"]]
        defs = g.get("custom_fields", [])
        vals = m.get("field_values") or {}
        rk, bk = roll_key(defs), branch_key(defs)
        out.append(
            {
                "id": m["_id"],
                "user_id": m["user_id"],
                "group_id": g["_id"],
                "group": g["name"],
                "name": (users.get(m["user_id"]) or {}).get("name", ""),
                "roll": vals.get(rk, "") if rk else "",
                "branch": vals.get(bk, "") if bk else "",
                "_m": m,
                "_u": users.get(m["user_id"]) or {},
            }
        )
    out.sort(key=lambda r: (r["roll"] or "~", r["name"].lower()))
    return out


def public(r: dict[str, Any]) -> dict[str, Any]:
    return {k: r[k] for k in ("id", "name", "roll", "branch", "group")} | {"groupId": r["group_id"]}


async def log(db, scope: Scope, request: Request | None, action: str, target: str | None = None, **data: Any) -> None:
    await audit(
        db, scope.actor_id, action, target=target, data=scope.audit_data(**data), ip=request and client_ip(request)
    )


def at_ist(day: str, hhmm: str) -> datetime:
    return datetime.combine(date.fromisoformat(day), time.fromisoformat(hhmm), tzinfo=IST)
