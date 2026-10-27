"""Codes (coupons) for every paid step: a resume download, the packs, Career Launch, the expert rewrite and the
organization plans. Managed in Admin → Codes; typed by a customer (or an organization's Owner) at the pay step.

- A code is stored upper case without spaces (`_id`), so "save 50" and "SAVE50" are the same code.
- Types: free (unlocks at once, an order at Rs 0, no WhatsApp), percent off, flat Rs off. One code per order.
- Limits: total uses (or unlimited) and uses per person (per organization for the organization plans). Both are
  taken atomically: the total with a conditional increment, the per-person one with unique use ids
  ("<code>:<who>:<n>", n up to the per-person limit), so two people can never take the last use.
- A use is "reserved" by an order waiting for payment and becomes "used" when it is paid; a cancelled order gives
  its use back. A free code is used at once.
- Only for: anyone, or the members of one organization or one group (for an organization plan: that organization).
"""

import re
import secrets
from datetime import datetime, time, timedelta
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.core.db import COUPON_USES, COUPONS, MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS, Session
from app.core.errors import ApiError
from app.core.time import IST, now

# what a code can be for: key → (label, the order's plan)
ITEMS: dict[str, tuple[str, str]] = {
    "resume": ("Resume download", "diy"),
    "tailor_pack": ("Tailor pack", "tailor_pack"),
    "interview_pack": ("Interview pack", "interview_pack"),
    "launch": ("Career Launch", "launch"),
    "expert": ("Expert rewrite", "expert"),
    "linkedin_pack": ("LinkedIn pack", "linkedin_pack"),
    "drive": ("Drive plan", "org:drive"),
    "campus": ("Campus plan", "org:campus"),
}
ORG_ITEMS = ("drive", "campus")
TYPES = ("free", "percent", "flat")
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,31}$")
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I: easy to read out and type
WRONG_RULES = [(10, timedelta(hours=1))]  # wrong codes a person / an address may try in an hour
TOO_MANY_WRONG = "Too many wrong codes. Please wait an hour and try again."


def norm(code: str | None) -> str:
    """Case and spaces don't matter: ' save 50 ' → 'SAVE50'."""
    return "".join(str(code or "").split()).upper()


def item_of_plan(plan: str) -> str | None:
    return next((k for k, (_, p) in ITEMS.items() if p == plan), None)


def _day_start(day: str) -> datetime:
    return datetime.combine(datetime.strptime(day, "%Y-%m-%d").date(), time.min, IST)


def _day_end(day: str) -> datetime:
    return datetime.combine(datetime.strptime(day, "%Y-%m-%d").date(), time(23, 59, 59), IST)


def day_of(at: datetime | None) -> str | None:
    return at.astimezone(IST).date().isoformat() if at else None


def status_of(c: dict[str, Any], at: datetime | None = None) -> str:
    """active | paused | expired | scheduled | used_up"""
    at = at or now()
    if c.get("paused"):
        return "paused"
    if c.get("valid_until") and c["valid_until"] < at:
        return "expired"
    if c.get("valid_from") and c["valid_from"] > at:
        return "scheduled"
    if c.get("total_limit") is not None and c.get("uses", 0) >= c["total_limit"]:
        return "used_up"
    return "active"


def err(code: str, message: str, status: int = 400) -> ApiError:
    return ApiError(status, code, message)


def rejected(c: dict[str, Any] | None, *, at: datetime | None = None) -> ApiError | None:
    """Why this code can't be used at all right now (whoever types it), else None."""
    if c is None:
        return err("code_not_found", "We couldn’t find that code. Check the spelling and try again.")
    s = status_of(c, at)
    if s == "paused":
        return err("code_paused", "This code isn’t active right now.")
    if s == "expired":
        return err("code_expired", "This code has expired.")
    if s == "scheduled":
        return err("code_not_started", f"This code works from {c['valid_from'].astimezone(IST).strftime('%-d %b %Y')}.")
    if s == "used_up":
        return err("code_used_up", "This code has been fully used.")
    return None


def discount_of(c: dict[str, Any], amount: int) -> int:
    """The discount on `amount` (paise): free → all of it; percent → rounded down to a paisa; flat → at most it."""
    if amount <= 0:
        return 0
    if c["type"] == "free":
        return amount
    if c["type"] == "percent":
        return min(amount, amount * int(c["value"]) // 100)
    return min(amount, int(c["value"]))


def label_of(c: dict[str, Any]) -> str:
    if c["type"] == "free":
        return "Free"
    if c["type"] == "percent":
        return f"{c['value']}% off"
    return f"Rs {int(c['value']) // 100:,} off"


async def get(db: AsyncDatabase, code: str, session: Session = None) -> dict[str, Any] | None:
    k = norm(code)
    return await db[COUPONS].find_one({"_id": k}, session=session) if k else None


async def _member_of(db: AsyncDatabase, user_id: str, only: dict[str, Any]) -> bool:
    q = {"user_id": user_id, "left_at": None, "consent.given": True, "approval": {"$ne": "rejected"}}
    q["org_id" if only["kind"] == "org" else "group_id"] = only["id"]
    return await db[MEMBERSHIPS].find_one(q, {"_id": 1}) is not None


async def _used_by(db: AsyncDatabase, code: str, who: str) -> int:
    return await db[COUPON_USES].count_documents({"code": code, "who": who})


async def check(db: AsyncDatabase, code: str, item: str, *, user_id: str, org_id: str | None = None) -> dict[str, Any]:
    """The code, if `user_id` (or, for an organization plan, the organization `org_id`) may use it for `item`
    now; else an ApiError with the reason (not found, paused, expired, not started, used up, used before, not for
    this item, not for this organization)."""
    c = await get(db, code)
    bad = rejected(c)
    if bad:
        raise bad
    if "all" not in c["items"] and item not in c["items"]:
        raise err("code_wrong_item", f"This code isn’t valid for the {ITEMS[item][0]}.")
    only = c.get("only")
    if only:
        if item in ORG_ITEMS:
            ok = org_id is not None and (
                only["id"] == org_id
                if only["kind"] == "org"
                else await db[ORG_GROUPS].find_one({"_id": only["id"], "org_id": org_id}, {"_id": 1}) is not None
            )
        else:
            ok = await _member_of(db, user_id, only)
        if not ok:
            raise err("code_wrong_org", "This code isn’t valid for your organization.")
    who = f"org:{org_id}" if item in ORG_ITEMS else f"user:{user_id}"
    if await _used_by(db, c["_id"], who) >= int(c.get("per_limit") or 1):
        mine = "Your organization has" if item in ORG_ITEMS else "You’ve"
        raise err("code_used_before", f"{mine} already used this code.")
    return c


async def claim(
    db: AsyncDatabase,
    c: dict[str, Any],
    item: str,
    *,
    user_id: str,
    org_id: str | None,
    order_id: str,
    original: int,
    discount: int,
    status: str,
    session: Session = None,
) -> dict[str, Any]:
    """Takes one use of the code for this order, atomically (status "reserved" while the order waits for payment,
    "used" once it is paid or when the code is free). Raises when the last use was just taken by someone else, or
    this person / organization already used up their uses."""
    t = now()
    cond = {"_id": c["_id"], "paused": {"$ne": True}}
    cond["$or"] = [{"total_limit": None}, {"$expr": {"$lt": ["$uses", "$total_limit"]}}]
    took = await db[COUPONS].find_one_and_update(
        cond, {"$inc": {"uses": 1}, "$set": {"last_used_at": t}}, session=session
    )
    if took is None:
        raise rejected(await get(db, c["_id"], session=session)) or err(
            "code_used_up", "This code has been fully used."
        )
    who = f"org:{org_id}" if item in ORG_ITEMS else f"user:{user_id}"
    row = {
        "code": c["_id"],
        "who": who,
        "user_id": user_id,
        "org_id": org_id,
        "item": item,
        "order_id": order_id,
        "original": original,
        "discount": discount,
        "final": original - discount,
        "status": status,
        "at": t,
    }
    for n in range(1, int(c.get("per_limit") or 1) + 1):
        try:
            await db[COUPON_USES].insert_one({"_id": f"{c['_id']}:{who}:{n}", **row}, session=session)
            return row
        except DuplicateKeyError:
            continue
    await db[COUPONS].update_one({"_id": c["_id"]}, {"$inc": {"uses": -1}}, session=session)
    mine = "Your organization has" if item in ORG_ITEMS else "You’ve"
    raise err("code_used_before", f"{mine} already used this code.")


async def mark_used(db: AsyncDatabase, order_id: str, session: Session = None) -> None:
    """The order was paid: its reserved use counts for good."""
    await db[COUPON_USES].update_many(
        {"order_id": order_id, "status": "reserved"}, {"$set": {"status": "used", "used_at": now()}}, session=session
    )


async def release(db: AsyncDatabase, order_ids: list[str]) -> int:
    """Orders cancelled before payment give their uses back (the use row goes, the count goes down)."""
    n = 0
    async for u in db[COUPON_USES].find({"order_id": {"$in": order_ids}, "status": "reserved"}):
        r = await db[COUPON_USES].delete_one({"_id": u["_id"], "status": "reserved"})
        if r.deleted_count:
            await db[COUPONS].update_one({"_id": u["code"]}, {"$inc": {"uses": -1}})
            n += 1
    return n


async def forget_user(db: AsyncDatabase, user_id: str) -> int:
    """For deleting an account: the uses stay counted (the code's limits and the money records need them) but no
    longer point to the person."""
    r = await db[COUPON_USES].update_many(
        {"user_id": user_id}, {"$set": {"user_id": None, "forgotten": True}, "$unset": {"who_label": ""}}
    )
    await db[COUPON_USES].update_many({"who": f"user:{user_id}"}, {"$set": {"who": "user:forgotten"}})
    return r.modified_count


def new_code(prefix: str = "") -> str:
    tail = "".join(secrets.choice(ALPHABET) for _ in range(4 if prefix else 8))
    return f"{prefix}-{tail}" if prefix else tail


async def only_out(db: AsyncDatabase, only: dict[str, Any] | None) -> dict[str, Any] | None:
    if not only:
        return None
    coll = ORGANIZATIONS if only["kind"] == "org" else ORG_GROUPS
    doc = await db[coll].find_one({"_id": only["id"]}, {"name": 1})
    return {"kind": only["kind"], "id": only["id"], "name": (doc or {}).get("name", "(deleted)")}
