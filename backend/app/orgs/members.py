"""Organizations, member side: the public join page, one-click "stop reminders", and /api/me/groups (join with
consent, list, change the shared resume, opt out, leave)."""

import logging
from typing import Any

from fastapi import APIRouter, Request, Response
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.billing.subscription import check_limit
from app.core import rate_limit
from app.core.db import DB, MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS, RESUMES
from app.core.errors import ApiError
from app.core.time import now
from app.orgs.scope import NOT_FOUND, features_of
from app.orgs.service import (
    ORG_TYPE_NAMES,
    active_members,
    clean_field_values,
    consent_text,
    group_problem,
    normalize_code,
    opt_out_membership,
    shortlists,
)
from app.orgs.shapes import (
    BAD_CODE,
    JOIN_RULES,
    LOOKUP_RULES,
    JoinIn,
    MembershipPatch,
    StopIn,
    _ip,
    membership_out,
    recruiters_on,
)

log = logging.getLogger("nm7.orgs")

me = APIRouter(prefix="/api/me/groups", tags=["organizations"])
public = APIRouter(prefix="/api/public/join", tags=["organizations"])
public_stop = APIRouter(prefix="/api/public/reminders", tags=["organizations"])


@public.get("/{code}")
async def join_info(code: str, request: Request, db: DB) -> dict[str, Any]:
    key = f"join-lookup:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, LOOKUP_RULES)
    await rate_limit.record(db, key)
    g = await db[ORG_GROUPS].find_one({"code": normalize_code(code)})
    if not g:
        raise BAD_CODE
    o = await db[ORGANIZATIONS].find_one({"_id": g["org_id"]})
    problem = group_problem(g, o, await active_members(db, g["_id"]))
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
            "shareWithRecruiters": recruiters_on(g, o),
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


async def _my(db, uid: str) -> list[dict[str, Any]]:
    ms_ = [m async for m in db[MEMBERSHIPS].find({"user_id": uid, "left_at": None}).sort("joined_at", -1)]
    gs = {g["_id"]: g async for g in db[ORG_GROUPS].find({"_id": {"$in": [m["group_id"] for m in ms_]}})}
    os_ = {o["_id"]: o async for o in db[ORGANIZATIONS].find({"_id": {"$in": [m["org_id"] for m in ms_]}})}
    # "Shortlisted by <Company>": only when the organization shows it, and only while the member shares with recruiters
    show = [oid for oid, o in os_.items() if (o.get("recruiter_settings") or {}).get("show_shortlist")]
    by = await shortlists(db, show)
    out = []
    for m in ms_:
        g, o = gs.get(m["group_id"]), os_.get(m["org_id"])
        row = membership_out(m, g, o)
        on = m["org_id"] in show and row["shareWithRecruiters"] and row["recruiterOptIn"]
        row["shortlistedBy"] = sorted({x["company"] for x in by.get(m["_id"], [])}) if on else []
        if o and features_of(o)["eligibility"]:  # "My marks for placements" (self-declared; the college may verify)
            from app.college.eligibility import academic_out

            row["academic"] = academic_out(m.get("academic"))
        out.append(row)
    return out


@me.get("")
async def my_groups(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    return await _my(db, auth.user.id)


@me.post("/join", status_code=201)
async def join(body: JoinIn, request: Request, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    try:
        return await _join(body, request, auth, db)
    except ApiError as e:  # a refused join is visible in the server log (no personal details)
        log.warning("join refused: %s (code %s, user %s)", e.code, normalize_code(body.code), auth.user.id)
        raise


async def _join(body: JoinIn, request: Request, auth: CustomerAuth, db: DB, via: dict | None = None) -> dict[str, Any]:
    """`via`: extra audit details, e.g. {"kiosk": id} for a join made at an event kiosk."""
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
    problem = group_problem(g, o, await active_members(db, g["_id"]) - (1 if already else 0))
    if problem:
        raise ApiError(410 if problem[0] != "group_full" else 409, problem[0], problem[1])
    if not body.consent:
        raise ApiError(
            400, "consent_required", "Please tick the box to agree to share your resume with this organization."
        )
    if not already:  # a new member (or someone coming back) counts against the organization's plan
        await check_limit(db, o, "members", member_side=True)
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
        "recruiter_opt_in": bool(body.recruiter_opt_in and recruiters_on(g, o)),
        "left_at": None,
        "updated_at": t,
    }
    # a group that approves members: everyone (re)joining waits for approval; answers updated in place keep theirs
    fresh = {"joined_at": t, "approval": "pending" if g.get("settings", {}).get("require_approval") else "approved"}
    if mine:  # joining again after leaving (or updating answers): one membership per user and group
        await db[MEMBERSHIPS].update_one({"_id": mine["_id"]}, {"$set": {**doc, **({} if already else fresh)}})
        mid = mine["_id"]
    else:
        mid = new_id()
        new = {"_id": mid, **doc, **fresh, "review_status": "none", "printed_at": None, "printed_count": 0}
        try:
            await db[MEMBERSHIPS].insert_one(new)
        except DuplicateKeyError:  # the same person joining twice at the same moment (a double tap)
            raise ApiError(409, "already_joined", "You’ve already joined this group.") from None
    action = "member_update" if already else "member_join"
    data = {
        "orgs": [o["_id"]],
        "group": g["_id"],
        "code": g["code"],
        **({"rejoin": True} if mine and not already else {}),
        **(via or {}),
    }
    await audit(db, uid, action, target=mid, data=data, ip=_ip(request))
    log.info("%s: membership %s in group %s", action, mid, g["_id"])
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
    if body.recruiter_opt_in is not None:
        sets["recruiter_opt_in"] = body.recruiter_opt_in  # opting out removes them from every link at once
    m = await db[MEMBERSHIPS].find_one_and_update(
        {"_id": membership_id, "user_id": uid, "left_at": None}, {"$set": sets}
    )
    if not m:
        raise NOT_FOUND
    if body.recruiter_opt_in is not None and bool(m.get("recruiter_opt_in")) != body.recruiter_opt_in:
        data = {"orgs": [m["org_id"]], "group": m["group_id"], "recruiterOptIn": body.recruiter_opt_in}
        await audit(db, uid, "member_update", target=membership_id, data=data)
    return next(x for x in await _my(db, uid) if x["id"] == membership_id)


@me.post("/{membership_id}/leave", status_code=204)
async def leave(membership_id: str, request: Request, auth: CustomerAuth, db: DB) -> Response:
    t = now()
    m = await db[MEMBERSHIPS].find_one_and_update(
        {"_id": membership_id, "user_id": auth.user.id, "left_at": None}, {"$set": {"left_at": t, "updated_at": t}}
    )
    if not m:
        raise NOT_FOUND
    data = {"orgs": [m["org_id"]], "group": m["group_id"]}
    await audit(db, auth.user.id, "member_leave", target=membership_id, data=data, ip=_ip(request))
    return Response(status_code=204)


# ---------- admin: organizations and groups ----------
