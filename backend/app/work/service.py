"""Order fulfilment shared by the customer, the assigned expert and admins: intake answers, the original resume,
drafts (versions), comments, chat, LinkedIn text, the Career Launch call and the rating.

Stored in `order_work` (one document per paid expert order, `_id` = order number). The browser sends whole
fields; the server decides who may change which field and which status moves are allowed."""

import json
from datetime import datetime, timedelta
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.auth.models import User
from app.core.db import JOB_PROFILES, ORDER_WORK, ORDERS, USERS
from app.core.errors import ApiError
from app.core.time import now
from app.me.service import ms
from app.orders.models import Order
from app.profile.service import privacy_of, strip_private
from app.site import get_site

# What each side may change (whole-field replace). Messages are append-only and handled separately.
CUSTOMER_FIELDS = {"intake", "jd", "original", "role", "level", "domain", "comments", "call", "rating", "review"}
EXPERT_FIELDS = {"versions", "comments", "linkedin", "call"}
LIMITS = {"versions": 30, "comments": 300, "messages": 1000}
MAX_PATCH = 3_000_000  # bytes of JSON (30 drafts of a resume fit easily)

# order.status ↔ the status the screens use
TO_ORDER = {"progress": "in_progress", "declined": "offer"}
FROM_ORDER = {"in_progress": "progress"}
EXPERT_MOVES = {
    ("offer", "progress"),
    ("offer", "declined"),
    ("progress", "waiting"),
    ("revision", "waiting"),
    ("progress", "delivered"),
    ("revision", "delivered"),
    ("waiting", "delivered"),
}
CUSTOMER_MOVES = {
    ("waiting", "revision"),
    ("delivered", "revision"),
    ("waiting", "approved"),
    ("delivered", "approved"),
}
CLOSED = ("refunded", "cancelled", "expired", "pending_payment", "done", "approved")

NOT_FOUND = ApiError(404, "not_found", "We couldn’t find that order.")


def work_status(order: Order) -> str:
    return FROM_ORDER.get(order.status, order.status)


async def load_work(db: AsyncDatabase, order_id: str) -> dict[str, Any]:
    return await db[ORDER_WORK].find_one({"_id": order_id}) or {"_id": order_id, "data": {}}


def side_of(user: User, order: Order, work: dict[str, Any], admin_ok: bool) -> str:
    """customer / expert / admin, or 404 for anyone else."""
    if user.role == "customer" and order.customer_id == user.id:
        return "customer"
    if user.role == "expert" and work.get("expert_id") == user.id:
        return "expert"
    if admin_ok:
        return "admin"
    raise NOT_FOUND


async def view(db: AsyncDatabase, order: Order, work: dict[str, Any], side: str) -> dict[str, Any]:
    customer = await db[USERS].find_one({"_id": order.customer_id}, {"name": 1})
    expert = await db[USERS].find_one({"_id": work["expert_id"]}, {"name": 1}) if work.get("expert_id") else None
    d = work.get("data", {})
    addons = [i.code for i in order.items if i.kind == "addon"]
    out = {
        "id": order.id,
        "customer": (customer or {}).get("name", "Customer"),
        "customerId": order.customer_id,
        "plan": order.plan,
        "price": order.amount / 100,
        "role": d.get("role") or order.target_role or "Not set",
        "domain": d.get("domain", ""),
        "level": d.get("level", ""),
        "createdAt": ms(order.paid_at or order.created_at),
        "deadline": ms(order.deadline_at),
        "deliveredAt": ms(order.delivered_at),
        "status": work_status(order),
        "accepted": ms(work.get("accepted_at")),
        "offerExpires": ms(work.get("offer_expires_at")),
        "expertId": work.get("expert_id"),
        "expertName": (expert or {}).get("name", "").split(" ")[0] or None,
        "addons": addons,
        "extraRevisions": addons.count("revision"),
        "intake": d.get("intake", {}),
        "jd": d.get("jd", ""),
        "original": d.get("original"),
        "versions": d.get("versions", []),
        "comments": d.get("comments", []),
        "messages": d.get("messages", []),
        "linkedin": d.get("linkedin"),
        "call": d.get("call"),
        "rating": d.get("rating"),
        "review": d.get("review"),
    }
    if side == "expert" and isinstance(out["original"], dict):  # salary / personal info only with consent
        p = privacy_of(await db[JOB_PROFILES].find_one({"_id": order.customer_id}, {"privacy": 1}))
        printed = not (out["original"].get("hidden") or {}).get("pinfo")  # on the resume itself: the expert needs it
        out["original"] = strip_private(out["original"], salary=p["salary"], personal=p["personal"] or printed)
    if side == "customer":  # drafts the expert hasn't sent yet stay private
        out["versions"] = [v for v in out["versions"] if isinstance(v, dict) and v.get("sent")]
    return out


def _check_shape(field: str, value: Any) -> None:
    lists = {"versions", "comments", "messages"}
    dicts = {"intake", "original", "call", "linkedin"}
    strs = {"jd": 20_000, "role": 100, "level": 40, "domain": 80, "review": 2_000}
    ok = (
        (field in lists and isinstance(value, list) and len(value) <= LIMITS[field])
        or (field in dicts and (value is None or isinstance(value, dict)))
        or (field in strs and (value is None or (isinstance(value, str) and len(value) <= strs[field])))
        or (field == "rating" and (value is None or (isinstance(value, int) and 1 <= value <= 5)))
    )
    if not ok:
        raise ApiError(422, "invalid_input", f"“{field}” isn’t valid.")


def merge_messages(old: list[dict], new: list[Any], side: str) -> list[dict]:
    """Only new messages at the end count, and only as the sender's own (time set by the server)."""
    added = []
    for m in new[len(old) :]:
        if isinstance(m, dict) and isinstance(m.get("text"), str) and m["text"].strip():
            added.append({"from": side, "text": m["text"].strip()[:2000], "at": ms(now())})
    return [*old, *added]


async def apply_patch(
    db: AsyncDatabase, order: Order, work: dict[str, Any], side: str, user: User, patch: dict[str, Any]
) -> None:
    if len(json.dumps(patch, ensure_ascii=False).encode()) > MAX_PATCH:
        raise ApiError(413, "too_large", "That’s too much data in one save.")
    if order.status in ("refunded", "cancelled"):
        raise ApiError(409, "order_closed", "This order is closed.")
    allowed = CUSTOMER_FIELDS if side == "customer" else EXPERT_FIELDS if side == "expert" else set()
    data = dict(work.get("data", {}))
    sets: dict[str, Any] = {}
    order_sets: dict[str, Any] = {}
    t = now()

    for field, value in patch.items():
        if field in ("status", "messages"):
            continue
        if field not in allowed:
            raise ApiError(403, "not_allowed", f"You can’t change “{field}” on this order.")
        _check_shape(field, value)
        data[field] = value
    if "messages" in patch:
        _check_shape("messages", patch["messages"])
        if side == "admin":
            raise ApiError(403, "not_allowed", "Admins can’t write in the customer chat.")
        data["messages"] = merge_messages(data.get("messages", []), patch["messages"], side)

    current = work_status(order)
    to = patch.get("status")
    if to and to != current:
        moves = EXPERT_MOVES if side == "expert" else CUSTOMER_MOVES if side == "customer" else set()
        if (current, to) not in moves or order.status in CLOSED:
            raise ApiError(409, "bad_status", f"This order can’t go from “{current}” to “{to}”.")
        if to == "declined":
            sets.update({"expert_id": None, "accepted_at": None, "offer_expires_at": None})
            data["messages"] = [
                *data.get("messages", []),
                {"from": "system", "text": "The expert passed on this order; we’re assigning another.", "at": ms(t)},
            ]
        if to == "progress":
            if work.get("offer_expires_at") and work["offer_expires_at"] < t:
                raise ApiError(409, "offer_expired", "This offer has expired.")
            sets["accepted_at"] = t
        if to == "delivered":
            order_sets["delivered_at"] = t
        order_sets["status"] = TO_ORDER.get(to, to)
    if ("rating" in patch or "review" in patch) and (to or current) != "approved":
        raise ApiError(409, "bad_status", "You can rate the order when you approve it.")

    sets["data"] = data
    sets["updated_at"] = t
    await db[ORDER_WORK].update_one({"_id": order.id}, {"$set": sets, "$setOnInsert": {"created_at": t}}, upsert=True)
    if order_sets:
        await db[ORDERS].update_one({"_id": order.id}, {"$set": {**order_sets, "updated_at": t}})


async def assign(db: AsyncDatabase, order: Order, expert_id: str | None) -> datetime | None:
    """Admin: offer the order to an expert (they must accept in time, see the offer_timeout rule), or take it back
    (None)."""
    t = now()
    rule = (await get_site(db))["rules"]["offer_timeout"]
    minutes = int(rule["value"]) if rule["on"] else 7 * 24 * 60
    expires = t + timedelta(minutes=minutes) if expert_id else None
    await db[ORDER_WORK].update_one(
        {"_id": order.id},
        {
            "$set": {"expert_id": expert_id, "offer_expires_at": expires, "accepted_at": None, "updated_at": t},
            "$setOnInsert": {"data": {}, "created_at": t},
        },
        upsert=True,
    )
    if order.status in ("in_progress",):
        await db[ORDERS].update_one({"_id": order.id}, {"$set": {"status": "offer", "updated_at": t}})
    return expires
