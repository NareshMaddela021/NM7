"""Referral rewards. When `needed` friends (default 3) who signed up with someone's invite link have confirmed
their email and built a resume with a name, that person's downloads unlock for free: the same account-wide unlock
as paying for the resume plan, without an order or invoice. One reward per account, ever.

Friends don't count when they signed up from the inviter's device (the inviter's session cookie, or the same
network address and browser as one of the inviter's sign-ins), from the inviter's network address, or with a
disposable email address. The flags are worked out once at sign-up (no address is stored for this).

Admin > Settings turns rewards on/off and sets the number; Admin > Settings > Referral rewards lists the rewards and
can revoke one (the downloads lock again; it isn't given again). Turning rewards off stops new rewards; the ones
already given stay.

  GET  /api/admin/referral-rewards
  POST /api/admin/referral-rewards/{user_id}/revoke   {note}
"""

from typing import Any

from fastapi import APIRouter, Request
from pydantic import Field
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import SESSION_COOKIE, client_ip
from app.core.db import DB, REFERRAL_REWARDS, RESUMES, SESSIONS, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import hash_token
from app.core.time import now
from app.me.service import ms
from app.site import get_site

admin = APIRouter(prefix="/api/admin/referral-rewards", tags=["admin"])

# Common throwaway-inbox services. Not complete; it stops the easy cases.
DISPOSABLE = frozenset(
    """
    10minutemail.com 10minutemail.net 20minutemail.com 33mail.com burnermail.io discard.email dispostable.com
    emailondeck.com fakeinbox.com getairmail.com getnada.com guerrillamail.com guerrillamail.net guerrillamail.org
    guerrillamailblock.com grr.la inboxkitten.com mailcatch.com maildrop.cc mailinator.com mailinator.net
    mailnesia.com mintemail.com mohmal.com mytemp.email nada.email sharklasers.com spamgourmet.com temp-mail.io
    temp-mail.org tempail.com tempmail.com tempmail.dev tempmail.net tempmailo.com tempr.email throwawaymail.com
    trashmail.com trashmail.de trashmail.net yopmail.com yopmail.fr yopmail.net emailfake.com fakemail.net
    """.split()
)


def disposable(email: str) -> bool:
    domain = email.rsplit("@", 1)[-1].strip().lower()
    return domain in DISPOSABLE or any(domain.endswith(f".{d}") for d in DISPOSABLE)


async def signup_flags(db: AsyncDatabase, request: Request, inviter_id: str, email: str) -> list[str]:
    """Why this sign-up won't count towards the inviter's reward ([] = it can)."""
    flags = ["disposable_email"] if disposable(email) else []
    token = request.cookies.get(SESSION_COOKIE)
    ip, ua = client_ip(request), (request.headers.get("user-agent") or "")[:300] or None
    mine = {"user_id": inviter_id}
    if token and await db[SESSIONS].find_one({**mine, "token_hash": hash_token(token)}, {"_id": 1}):
        flags.append("same_device")
    elif ip and ua and await db[SESSIONS].find_one({**mine, "ip": ip, "user_agent": ua}, {"_id": 1}):
        flags.append("same_device")
    elif ip and await db[SESSIONS].find_one({**mine, "ip": ip}, {"_id": 1}):
        flags.append("same_network")
    return flags


async def settings(db: AsyncDatabase) -> dict[str, Any]:
    return (await get_site(db))["referral"]


async def _has_named_resume(db: AsyncDatabase, user_id: str) -> bool:
    q = {"user_id": user_id, "data.personal.name": {"$regex": r"\S"}}
    return await db[RESUMES].find_one(q, {"_id": 1}) is not None


async def friends(db: AsyncDatabase, user_id: str) -> list[dict[str, Any]]:
    """The people who signed up with this invite, and whether each counts (and if not, why)."""
    out = []
    fields = {"name": 1, "email": 1, "email_verified_at": 1, "ref_flags": 1, "disabled_at": 1, "created_at": 1}
    async for u in db[USERS].find({"referred_by": user_id}, fields).sort("created_at", 1):
        why = None
        if u.get("ref_flags") or disposable(u.get("email") or ""):
            why = "not_eligible"
        elif u.get("disabled_at"):
            why = "not_eligible"
        elif not u.get("email_verified_at"):
            why = "email_not_confirmed"
        elif not await _has_named_resume(db, u["_id"]):
            why = "no_resume"
        out.append({"id": u["_id"], "name": u["name"], "at": u["created_at"], "counts": why is None, "why": why})
    return out


async def ensure_reward(db: AsyncDatabase, user_id: str) -> dict[str, Any] | None:
    """The account's reward, given now if enough friends count (and rewards are on). None when there's none."""
    r = await db[REFERRAL_REWARDS].find_one({"_id": user_id})
    if r:
        return r
    s = await settings(db)
    if not s["on"]:
        return None
    counted = [f["id"] for f in await friends(db, user_id) if f["counts"]]
    if len(counted) < s["needed"]:
        return None
    doc = {"_id": user_id, "at": now(), "friend_ids": counted[: s["needed"]], "needed": s["needed"], "revoked_at": None}
    try:
        await db[REFERRAL_REWARDS].insert_one(doc)
    except DuplicateKeyError:  # given by a request a moment ago
        return await db[REFERRAL_REWARDS].find_one({"_id": user_id})
    await audit(db, user_id, "referral.reward_given", target=user_id, data={"friends": len(doc["friend_ids"])})
    return doc


async def reward_unlocks(db: AsyncDatabase, user_id: str) -> bool:
    r = await ensure_reward(db, user_id)
    return bool(r and not r.get("revoked_at"))


async def progress(db: AsyncDatabase, user_id: str) -> dict[str, Any]:
    """What Help & referral shows: "2 of 3", unlocked or revoked."""
    s = await settings(db)
    r = await ensure_reward(db, user_id)
    counted = sum(1 for f in await friends(db, user_id) if f["counts"])
    needed = r["needed"] if r else s["needed"]
    return {
        "on": s["on"],
        "needed": needed,
        "counted": min(counted, needed),
        "unlocked": bool(r and not r.get("revoked_at")),
        "revoked": bool(r and r.get("revoked_at")),
        "at": ms(r["at"]) if r else None,
    }


# ---------- admin ----------


@admin.get("")
async def list_rewards(db: DB, _: AdminAuth("customers")) -> list[dict[str, Any]]:
    out = []
    async for r in db[REFERRAL_REWARDS].find({}).sort("at", -1).limit(500):
        u = await db[USERS].find_one({"_id": r["_id"]}, {"name": 1, "email": 1}) or {}
        out.append(
            {
                "userId": r["_id"],
                "name": u.get("name", "(deleted)"),
                "email": u.get("email", ""),
                "at": ms(r["at"]),
                "friends": len(r.get("friend_ids", [])),
                "revokedAt": ms(r.get("revoked_at")),
                "note": r.get("revoke_note", ""),
            }
        )
    return out


class RevokeIn(CamelModel):
    note: str = Field("", max_length=300)


@admin.post("/{user_id}/revoke")
async def revoke(user_id: str, body: RevokeIn, request: Request, db: DB, auth: AdminAuth("customers")) -> dict:
    r = await db[REFERRAL_REWARDS].find_one_and_update(
        {"_id": user_id, "revoked_at": None},
        {"$set": {"revoked_at": now(), "revoked_by": auth.user.id, "revoke_note": body.note.strip()}},
    )
    if not r:
        raise ApiError(404, "not_found", "No active reward for this account.")
    await audit(
        db, auth.user.id, "referral.reward_revoked", target=user_id, data={"note": body.note}, ip=client_ip(request)
    )
    return {"revoked": True}
