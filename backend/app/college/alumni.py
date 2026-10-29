"""Alumni network (feature `alumni`: Campus plan).

Alumni: people from past batches of a college opt in (from My groups, when their batch has ended or their passing
year is past, or from a coordinator's email invite). They share company, role and city, and say whether they're open
to referrals and / or mentoring. They can pause or leave at any time.

Current students of the same college (active members who joined with consent) browse alumni who opted in and send a
request (referral or mentoring) with a short note: at most 5 requests per student per week. The alumnus gets an email
and replies inside Nm7. Contact details are never shown by Nm7; an alumnus may write them in a reply if they choose.

Coordinators invite alumni by email and see counts only — never the messages.

Students / alumni (/api/me/alumni):
  GET  ""                        what I can do: colleges where I can opt in, my alumni profiles, colleges I can browse
  PUT  /profile/{org_id}         {company, role, city, batch, referrals, mentoring, paused}: opt in or update
  DELETE /profile/{org_id}       leave the network
  GET  /browse/{org_id}          alumni of my college who opted in (not paused)
  POST /requests                 {alumniId, kind: referral | mentoring, note}
  GET  /requests                 my requests (sent) with replies
  GET  /inbox                    requests to me (as an alumnus)
  POST /requests/{id}/reply      {text}
  POST /join/{token}             accept a coordinator's invite (opt in afterwards)
Staff (/api/org/{org_id}/alumni):
  POST /invites                  {emails}
  GET  /summary                  counts: alumni, open to referrals / mentoring, paused, requests, replied
"""

from datetime import timedelta
from html import escape
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import Field, field_validator

from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.college.common import log, org_with
from app.core.config import get_settings
from app.core.db import ALUMNI, ALUMNI_INVITES, ALUMNI_REQUESTS, DB, MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS, USERS
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, new_token
from app.core.time import IST, now
from app.me.service import ms
from app.orgs.scope import NOT_FOUND, OrgScope, features_of

me = APIRouter(prefix="/api/me/alumni", tags=["alumni"])
staff = APIRouter(prefix="/api/org/{org_id}/alumni", tags=["alumni"])

WEEKLY_REQUESTS = 5
INVITE_DAYS = 30
STYLE = "font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111"


class ProfileIn(CamelModel):
    company: str = Field("", max_length=80)
    role: str = Field("", max_length=80)
    city: str = Field("", max_length=60)
    batch: int | None = Field(None, ge=1950, le=2100)
    referrals: bool = False
    mentoring: bool = False
    paused: bool = False

    @field_validator("company", "role", "city")
    @classmethod
    def _tidy(cls, v):
        return " ".join(v.split())


class RequestIn(CamelModel):
    alumni_id: str = Field(max_length=64)
    kind: Literal["referral", "mentoring"]
    note: str = Field(min_length=10, max_length=500)


class ReplyIn(CamelModel):
    text: str = Field(min_length=2, max_length=1000)


class InvitesIn(CamelModel):
    emails: list[str] = Field(min_length=1, max_length=100)

    @field_validator("emails")
    @classmethod
    def _emails(cls, v):
        import re

        out = list(dict.fromkeys(e.strip().lower() for e in v if e.strip()))
        bad = [e for e in out if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}", e)]
        if bad:
            raise ValueError(f"Not an email address: {bad[0]}")
        return out


# ---------- helpers ----------
async def _org_on(db, org_id: str) -> dict[str, Any] | None:
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    return o if o and features_of(o)["alumni"] and o.get("status") != "archived" else None


def _past(g: dict[str, Any] | None, m: dict[str, Any]) -> bool:
    """A past batch: the group has ended, or the member's passing year is past."""
    today = now().astimezone(IST).date()
    ended = bool(g and g.get("ends_on") and str(g["ends_on"]) < today.isoformat())
    year = (m.get("academic") or {}).get("year")
    return ended or bool(year and year < today.year)


def profile_out(a: dict[str, Any], name: str = "") -> dict[str, Any]:
    return {
        "id": a["_id"],
        "orgId": a["org_id"],
        "name": name,
        "company": a.get("company", ""),
        "role": a.get("role", ""),
        "city": a.get("city", ""),
        "batch": a.get("batch"),
        "referrals": bool(a.get("referrals")),
        "mentoring": bool(a.get("mentoring")),
        "paused": bool(a.get("paused")),
    }


async def _student_orgs(db, uid: str) -> set[str]:
    """Colleges where I am a current student (active, consented)."""
    return {m["org_id"] async for m in db[MEMBERSHIPS].find({"user_id": uid, "left_at": None, "consent.given": True})}


def request_out(r: dict[str, Any], names: dict[str, str], *, to_me: bool) -> dict[str, Any]:
    return {
        "id": r["_id"],
        "kind": r["kind"],
        "note": r["note"],
        "from": names.get(r["from_user"], "") if to_me else None,
        "to": None if to_me else names.get(r["to_user"], ""),
        "replies": [
            {"text": x["text"], "at": ms(x["at"]), "mine": (x["by"] == r["to_user"]) == to_me}
            for x in r.get("replies", [])
        ],
        "at": ms(r["created_at"]),
    }


# ---------- students and alumni ----------
@me.get("")
async def overview(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    ms_ = [m async for m in db[MEMBERSHIPS].find({"user_id": uid, "consent.given": True})]
    gs = {g["_id"]: g async for g in db[ORG_GROUPS].find({"_id": {"$in": [m["group_id"] for m in ms_]}})}
    mine = {a["org_id"]: a async for a in db[ALUMNI].find({"user_id": uid, "left_at": None})}
    orgs: dict[str, dict[str, Any]] = {}
    for oid in {m["org_id"] for m in ms_} | set(mine):
        o = await _org_on(db, oid)
        if o:
            orgs[oid] = o
    can_join = sorted(
        {
            m["org_id"]
            for m in ms_
            if m["org_id"] in orgs and m["org_id"] not in mine and _past(gs.get(m["group_id"]), m)
        }
    )
    browse = sorted({m["org_id"] for m in ms_ if m["org_id"] in orgs and m.get("left_at") is None})
    return {
        "canJoin": [{"orgId": o, "orgName": orgs[o]["name"]} for o in can_join],
        "profiles": [
            {**profile_out(a), "orgName": orgs[a["org_id"]]["name"]} for a in mine.values() if a["org_id"] in orgs
        ],
        "browse": [{"orgId": o, "orgName": orgs[o]["name"]} for o in browse],
        "weeklyLimit": WEEKLY_REQUESTS,
    }


@me.put("/profile/{org_id}")
async def set_profile(org_id: str, body: ProfileIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    if not await _org_on(db, org_id):
        raise NOT_FOUND
    a = await db[ALUMNI].find_one({"org_id": org_id, "user_id": uid, "left_at": None})
    if not a:
        invited = await db[ALUMNI_INVITES].find_one({"org_id": org_id, "accepted_by": uid})
        past = False
        async for m in db[MEMBERSHIPS].find({"user_id": uid, "org_id": org_id, "consent.given": True}):
            if _past(await db[ORG_GROUPS].find_one({"_id": m["group_id"]}), m):
                past = True
        if not (past or invited):
            raise ApiError(403, "not_alumni", "The alumni network is for past batches. Ask your college for an invite.")
        a = {"_id": new_id(), "org_id": org_id, "user_id": uid, "created_at": now(), "left_at": None}
    a.update(body.model_dump(), updated_at=now())
    await db[ALUMNI].replace_one({"_id": a["_id"]}, a, upsert=True)
    return profile_out(a)


@me.delete("/profile/{org_id}")
async def leave(org_id: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    r = await db[ALUMNI].update_one(
        {"org_id": org_id, "user_id": auth.user.id, "left_at": None}, {"$set": {"left_at": now()}}
    )
    if not r.modified_count:
        raise NOT_FOUND
    return {"left": True}


@me.get("/browse/{org_id}")
async def browse(org_id: str, auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    """Alumni of my college who opted in and aren't paused. Never an email address or phone number."""
    if org_id not in await _student_orgs(db, auth.user.id) or not await _org_on(db, org_id):
        raise NOT_FOUND
    rows = (
        await db[ALUMNI]
        .find({"org_id": org_id, "left_at": None, "paused": False, "user_id": {"$ne": auth.user.id}})
        .to_list(500)
    )
    names = {
        u["_id"]: u.get("name", "")
        async for u in db[USERS].find({"_id": {"$in": [a["user_id"] for a in rows]}}, {"name": 1})
    }
    out = [profile_out(a, names.get(a["user_id"], "")) for a in rows]
    return sorted(out, key=lambda x: (x["company"].lower(), x["name"].lower()))


def _request_email(to: str, name: str, from_name: str, org: str, kind: str, note: str) -> Email:
    site = get_settings().site_url
    first = (name or "").split(" ")[0] or "there"
    what = "a referral" if kind == "referral" else "mentoring"
    text = (
        f"Hi {first},\n\n{from_name}, a current student at {org}, asked you for {what} on Nm7:\n\n“{note}”\n\n"
        f"Reply inside Nm7: {site}/me/alumni\n\nYour email address and phone number aren't shared. "
        f"You can pause or leave the alumni network on the same page.\n\nNm7 · nm7.si"
    )
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(first)},</p><p>{escape(from_name)}, a current student at {escape(org)}, '
        f"asked you for {what} on Nm7:</p><blockquote>{escape(note)}</blockquote>"
        f'<p><a href="{escape(site)}/me/alumni">Reply inside Nm7</a></p>'
        '<p style="color:#666;font-size:13px">Your email address and phone number aren’t shared. '
        "You can pause or leave the alumni network on the same page.</p></div>"
    )
    return Email(to=to, to_name=name, subject=f"{from_name} asked you for {what}", text=text, html=html)


@me.post("/requests", status_code=201)
async def send_request(body: RequestIn, auth: CustomerAuth, db: DB, mailer: MailerDep) -> dict[str, Any]:
    uid = auth.user.id
    a = await db[ALUMNI].find_one({"_id": body.alumni_id, "left_at": None, "paused": False})
    if not a or a["user_id"] == uid or a["org_id"] not in await _student_orgs(db, uid):
        raise NOT_FOUND
    o = await _org_on(db, a["org_id"])
    if not o:
        raise NOT_FOUND
    if body.kind == "referral" and not a.get("referrals") or body.kind == "mentoring" and not a.get("mentoring"):
        raise ApiError(400, "not_open", "This alumnus isn’t open to that kind of request right now.")
    week = await db[ALUMNI_REQUESTS].count_documents(
        {"from_user": uid, "created_at": {"$gt": now() - timedelta(days=7)}}
    )
    if week >= WEEKLY_REQUESTS:
        raise ApiError(429, "weekly_limit", f"You can send {WEEKLY_REQUESTS} requests a week. Try again in a few days.")
    r = {
        "_id": new_id(),
        "org_id": a["org_id"],
        "alumni_id": a["_id"],
        "from_user": uid,
        "to_user": a["user_id"],
        "kind": body.kind,
        "note": " ".join(body.note.split()),
        "replies": [],
        "created_at": now(),
    }
    await db[ALUMNI_REQUESTS].insert_one(r)
    to = await db[USERS].find_one({"_id": a["user_id"]}, {"email": 1, "name": 1})
    if to:
        await send_safely(
            mailer, _request_email(to["email"], to.get("name", ""), auth.user.name, o["name"], body.kind, r["note"])
        )
    return request_out(r, {a["user_id"]: (to or {}).get("name", "")}, to_me=False)


async def _names(db, ids: set[str]) -> dict[str, str]:
    return {u["_id"]: u.get("name", "") async for u in db[USERS].find({"_id": {"$in": list(ids)}}, {"name": 1})}


@me.get("/requests")
async def my_requests(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    rows = await db[ALUMNI_REQUESTS].find({"from_user": auth.user.id}).sort("created_at", -1).to_list(100)
    names = await _names(db, {r["to_user"] for r in rows})
    return [request_out(r, names, to_me=False) for r in rows]


@me.get("/inbox")
async def inbox(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    rows = await db[ALUMNI_REQUESTS].find({"to_user": auth.user.id}).sort("created_at", -1).to_list(100)
    names = await _names(db, {r["from_user"] for r in rows})
    return [request_out(r, names, to_me=True) for r in rows]


@me.post("/requests/{request_id}/reply")
async def reply(request_id: str, body: ReplyIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """Either side of a request can reply; only those two ever see it."""
    uid = auth.user.id
    r = await db[ALUMNI_REQUESTS].find_one({"_id": request_id, "$or": [{"from_user": uid}, {"to_user": uid}]})
    if not r:
        raise NOT_FOUND
    item = {"by": uid, "text": body.text.strip(), "at": now()}
    await db[ALUMNI_REQUESTS].update_one(
        {"_id": request_id},
        {
            "$push": {"replies": item},
            "$set": {"replied_at": item["at"] if uid == r["to_user"] else r.get("replied_at")},
        },
    )
    r["replies"] = [*r.get("replies", []), item]
    to_me = uid == r["to_user"]
    names = await _names(db, {r["from_user"], r["to_user"]})
    return request_out(r, names, to_me=to_me)


@me.post("/join/{token}")
async def accept_invite(token: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    inv = await db[ALUMNI_INVITES].find_one({"token_hash": keyed_hash("alumni-invite", token[:100])})
    if not inv or inv["expires_at"] < now() or not await _org_on(db, inv["org_id"]):
        raise ApiError(410, "invite_ended", "This invite has ended. Ask your college for a new one.")
    if inv.get("accepted_by") and inv["accepted_by"] != auth.user.id:
        raise ApiError(410, "invite_used", "This invite was already used.")
    await db[ALUMNI_INVITES].update_one(
        {"_id": inv["_id"]}, {"$set": {"accepted_by": auth.user.id, "accepted_at": now()}}
    )
    o = await db[ORGANIZATIONS].find_one({"_id": inv["org_id"]}, {"name": 1})
    return {"orgId": inv["org_id"], "orgName": o["name"]}


# ---------- staff ----------
def _invite_email(to: str, org: str, url: str) -> Email:
    text = (
        f"Hello,\n\n{org} invites you to its alumni network on Nm7: current students can ask you for a referral or "
        f"mentoring, and you reply inside Nm7. Your email address and phone number aren't shared, and you can pause or "
        f"leave at any time.\n\nJoin: {url}\n\nThis link works for {INVITE_DAYS} days.\n\nNm7 · nm7.si"
    )
    html = (
        f'<div style="{STYLE}"><p>Hello,</p><p>{escape(org)} invites you to its alumni network on Nm7: '
        "current students can ask you for a referral or mentoring, and you reply inside Nm7. "
        "Your email address and phone number aren’t "
        f'shared, and you can pause or leave at any time.</p><p><a href="{escape(url)}">Join the alumni network</a></p>'
        f'<p style="color:#666;font-size:13px">This link works for {INVITE_DAYS} days.</p></div>'
    )
    return Email(to=to, to_name="", subject=f"{org} alumni network on Nm7", text=text, html=html)


@staff.post("/invites", status_code=201)
async def invite(body: InvitesIn, request: Request, db: DB, scope: OrgScope, mailer: MailerDep) -> dict[str, Any]:
    o = await org_with(db, scope, "alumni")
    scope.require("manage")
    sent = 0
    site = get_settings().site_url
    for e in body.emails:
        token = new_token()
        await db[ALUMNI_INVITES].insert_one(
            {
                "_id": new_id(),
                "org_id": scope.org_id,
                "email": e,
                "token_hash": keyed_hash("alumni-invite", token),
                "expires_at": now() + timedelta(days=INVITE_DAYS),
                "accepted_by": None,
                "created_by": scope.actor_id,
                "created_at": now(),
            }  # fmt: skip
        )
        sent += await send_safely(mailer, _invite_email(e, o["name"], f"{site}/alumni/join/{token}"))
    await log(db, scope, request, "alumni_invite", None, count=len(body.emails))
    return {"invited": len(body.emails), "emailed": sent}


@staff.get("/summary")
async def summary(db: DB, scope: OrgScope) -> dict[str, Any]:
    """Counts only: coordinators never see the messages."""
    await org_with(db, scope, "alumni")
    q = {"org_id": scope.org_id, "left_at": None}
    month = now() - timedelta(days=30)
    return {
        "alumni": await db[ALUMNI].count_documents(q),
        "referrals": await db[ALUMNI].count_documents({**q, "referrals": True, "paused": False}),
        "mentoring": await db[ALUMNI].count_documents({**q, "mentoring": True, "paused": False}),
        "paused": await db[ALUMNI].count_documents({**q, "paused": True}),
        "invited": await db[ALUMNI_INVITES].count_documents({"org_id": scope.org_id}),
        "joinedFromInvite": await db[ALUMNI_INVITES].count_documents(
            {"org_id": scope.org_id, "accepted_by": {"$ne": None}}
        ),
        "requests30d": await db[ALUMNI_REQUESTS].count_documents(
            {"org_id": scope.org_id, "created_at": {"$gt": month}}
        ),
        "replied30d": await db[ALUMNI_REQUESTS].count_documents(
            {"org_id": scope.org_id, "created_at": {"$gt": month}, "replied_at": {"$ne": None}}
        ),
    }
