"""/api/work: order fulfilment for the customer who bought it, the expert it's assigned to, and admins."""

from typing import Annotated, Any

from fastapi import APIRouter, Body
from pymongo import DESCENDING

from app.admin.roles import can
from app.auth.deps import CurrentAuth
from app.core.db import DB, JOB_PROFILES, ORDER_WORK, ORDERS
from app.core.errors import ApiError
from app.orders.models import Order
from app.orders.service import get_order
from app.profile.service import privacy_of, strip_private
from app.work.service import NOT_FOUND, apply_patch, load_work, side_of, view, views

router = APIRouter(prefix="/api/work", tags=["work"])

EXPERT_PLANS = ("expert", "launch")


def _is_admin(auth) -> bool:
    return auth.user.role == "admin" and auth.session.two_step and can(auth.user.admin_role, "orders")


@router.get("")
async def my_work(auth: CurrentAuth, db: DB) -> list[dict[str, Any]]:
    """Customer: their paid expert orders. Expert: orders offered to or accepted by them."""
    user = auth.user
    if user.role == "customer":
        q = {"customer_id": user.id, "plan": {"$in": EXPERT_PLANS}, "paid_at": {"$ne": None}}
        orders = [Order.load(o) async for o in db[ORDERS].find(q).sort("paid_at", DESCENDING)]
        side = "customer"
    elif user.role == "expert":
        ids = [w["_id"] async for w in db[ORDER_WORK].find({"expert_id": user.id}, {"_id": 1})]
        orders = [Order.load(o) async for o in db[ORDERS].find({"_id": {"$in": ids}}).sort("paid_at", DESCENDING)]
        side = "expert"
    else:
        raise ApiError(403, "wrong_role", "This is for customers and experts.")
    return await views(db, orders, side)


@router.get("/{order_id}")
async def one(order_id: str, auth: CurrentAuth, db: DB) -> dict[str, Any]:
    order = await get_order(db, order_id)
    if order is None or order.plan not in EXPERT_PLANS:
        raise NOT_FOUND
    work = await load_work(db, order.id)
    side = side_of(auth.user, order, work, _is_admin(auth))
    return await view(db, order, work, side)


@router.get("/{order_id}/profile")
async def customer_profile(order_id: str, auth: CurrentAuth, db: DB) -> dict[str, Any]:
    """The assigned expert (or an admin) sees the customer's Job Profile only if the customer allowed it.
    Salary and personal information are left out unless the customer switched those on too."""
    order = await get_order(db, order_id)
    if order is None or order.plan not in EXPERT_PLANS:
        raise NOT_FOUND
    side = side_of(auth.user, order, await load_work(db, order.id), _is_admin(auth))
    if side == "customer":
        raise ApiError(403, "not_allowed", "Open your Job Profile from your dashboard.")
    doc = await db[JOB_PROFILES].find_one({"_id": order.customer_id})
    p = privacy_of(doc)
    if not doc or not p["experts"]:
        raise ApiError(404, "no_consent", "The customer hasn’t shared their Job Profile.")
    return {"data": strip_private(doc["data"], salary=p["salary"], personal=p["personal"]), "privacy": p}


@router.patch("/{order_id}")
async def patch(order_id: str, body: Annotated[dict[str, Any], Body()], auth: CurrentAuth, db: DB) -> dict[str, Any]:
    order = await get_order(db, order_id)
    if order is None or order.plan not in EXPERT_PLANS or order.paid_at is None:
        raise NOT_FOUND
    work = await load_work(db, order.id)
    side = side_of(auth.user, order, work, _is_admin(auth))
    if side == "expert" and auth.user.expert_status != "approved":
        raise ApiError(403, "not_approved", "Your expert account isn’t approved yet.")
    await apply_patch(db, order, work, side, auth.user, body)
    return await view(db, await get_order(db, order.id), await load_work(db, order.id), side)
