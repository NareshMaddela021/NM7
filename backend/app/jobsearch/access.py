"""Who may use the paid parts of job search, and the free daily allowance.

    tailor     the Tailor pack (Rs 49): unlimited job matches, tailored resume copies, AI rewrites, cover letters.
               Included in the Rs 99 plan ("Fix it yourself") and in the expert plans.
    interview  the Interview pack (Rs 99): the full interview prep pack and practice mode. Included in Career Launch.

An account has a feature when it paid for an order of one of those plans that is not refunded or cancelled (checked
against the order itself, so a refund takes access away at once), or when an admin granted it by hand (Admin >
Customers, written to the audit log) to test it before payments are on.

Free without the pack: 3 job matches a day (score + missing keywords), 1 cover letter a day, the first 3 interview
questions.
"""

from datetime import timedelta
from typing import Any, Literal

from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.core.ai_quota import today
from app.core.db import AI_USAGE, FEATURE_GRANTS, ORDERS
from app.core.time import now

Feature = Literal["tailor", "interview"]
PLANS_FOR: dict[str, tuple[str, ...]] = {
    "tailor": ("tailor_pack", "diy", "expert", "launch"),
    "interview": ("interview_pack", "launch"),
}
PACK_PLAN = {"tailor": "tailor_pack", "interview": "interview_pack"}
LOST = ("refunded", "cancelled")
FREE = {"match": 3, "cover": 1}  # a day, without the Tailor pack
FREE_QUESTIONS = 3  # interview questions shown without the Interview pack


async def status(db: AsyncDatabase, user_id: str, feature: Feature) -> dict[str, Any] | None:
    """{source: order | plan | grant, order_id, plan} when the account has the feature, else None."""
    o = await db[ORDERS].find_one(
        {
            "customer_id": user_id,
            "kind": {"$ne": "org"},
            "plan": {"$in": list(PLANS_FOR[feature])},
            "paid_at": {"$ne": None},
            "status": {"$nin": list(LOST)},
            "resume_id": None,  # a free code for one resume's download isn't a plan
        },
        {"plan": 1, "paid_at": 1},
        sort=[("paid_at", ASCENDING)],
    )
    if o:
        source = "order" if o["plan"] == PACK_PLAN[feature] else "plan"
        return {"source": source, "order_id": o["_id"], "plan": o["plan"]}
    g = await db[FEATURE_GRANTS].find_one({"_id": f"{feature}:{user_id}"})
    if g:
        return {"source": "grant", "order_id": None, "plan": None}
    return None


async def has(db: AsyncDatabase, user_id: str, feature: Feature) -> bool:
    return await status(db, user_id, feature) is not None


async def grant(db: AsyncDatabase, user_id: str, feature: Feature, admin_id: str, note: str = "") -> None:
    await db[FEATURE_GRANTS].update_one(
        {"_id": f"{feature}:{user_id}"},
        {"$set": {"user_id": user_id, "feature": feature, "granted_by": admin_id, "note": note, "at": now()}},
        upsert=True,
    )


async def revoke(db: AsyncDatabase, user_id: str, feature: Feature) -> None:
    """Takes back an admin grant only (a paid order keeps its access until it is refunded)."""
    await db[FEATURE_GRANTS].delete_one({"_id": f"{feature}:{user_id}"})


def _key(kind: str, user_id: str, day: str) -> str:
    return f"{day}|free|{kind}|{user_id}"


async def used_today(db: AsyncDatabase, user_id: str, kind: str) -> int:
    doc = await db[AI_USAGE].find_one({"_id": _key(kind, user_id, today())}, {"n": 1})
    return int(doc["n"]) if doc else 0


async def take_free(db: AsyncDatabase, user_id: str, kind: str) -> bool:
    """Counts one free use (match / cover); False (and nothing counted) when today's allowance is used up."""
    d = today()
    doc = await db[AI_USAGE].find_one_and_update(
        {"_id": _key(kind, user_id, d)},
        {"$inc": {"n": 1}, "$setOnInsert": {"day": d, "expires_at": now() + timedelta(days=2)}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if int(doc["n"]) > FREE[kind]:
        await db[AI_USAGE].update_one({"_id": _key(kind, user_id, d)}, {"$inc": {"n": -1}})
        return False
    return True


async def give_back(db: AsyncDatabase, user_id: str, kind: str) -> None:
    """A free use that didn't produce anything (e.g. the post couldn't be read) is given back."""
    await db[AI_USAGE].update_one({"_id": _key(kind, user_id, today()), "n": {"$gt": 0}}, {"$inc": {"n": -1}})
