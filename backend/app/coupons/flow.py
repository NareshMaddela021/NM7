"""Using a code at the pay step: checking it (with a limit on wrong tries), quoting the new price, unlocking at once
with a free code (an order at Rs 0, no WhatsApp step), and taking the discount off a WhatsApp / Razorpay order or
an organization's plan.

Payment modes: Off → only free codes work (nothing can be paid); WhatsApp → free codes unlock, a discount lowers
the WhatsApp order; Razorpay → a discount lowers the amount charged (the same order hook)."""

from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from pymongo.asynchronous.database import AsyncDatabase

from app.audit import audit
from app.core import rate_limit
from app.core.db import COUPON_USES, COUPONS, ORDERS, PAYMENTS, RESUMES, next_number
from app.core.errors import ApiError
from app.coupons.service import ITEMS, ORG_ITEMS, TOO_MANY_WRONG, WRONG_RULES, check, claim, discount_of, label_of
from app.orders.models import ORDER_NO_START, Order, OrderItem
from app.orders.pricing import CURRENCY, price
from app.payments.models import Payment
from app.site import get_site
from app.wapay.settings import payment_mode

T = TypeVar("T")
OFF_ONLY_FREE = ApiError(409, "code_needs_payment", "Payments are off right now, so only codes that make it free work.")


def rs(paise: int) -> str:
    r = paise / 100
    return f"{r:,.0f}" if r == int(r) else f"{r:,.2f}"


async def guarded[T](db: AsyncDatabase, who: str, ip: str | None, fn: Callable[[], Awaitable[T]]) -> T:
    """Runs a code check; a wrong code counts against the person and the address (10 an hour, then a wait)."""
    keys = [f"coupon-wrong:{who}", f"coupon-wrong-ip:{ip or '-'}"]
    for k in keys:
        await rate_limit.check(db, k, WRONG_RULES, TOO_MANY_WRONG)
    try:
        return await fn()
    except ApiError as e:
        if e.code.startswith("code_") and e.code != "code_needs_payment":
            await rate_limit.record(db, *keys)
        raise


def coupon_doc(c: dict[str, Any], original: int, discount: int) -> dict[str, Any]:
    return {
        "code": c["_id"],
        "type": c["type"],
        "value": c["value"],
        "original": original,
        "discount": discount,
        "final": original - discount,
    }


def quote_view(c: dict[str, Any], item: str, original: int, discount: int) -> dict[str, Any]:
    final = original - discount
    return {
        "code": c["_id"],
        "item": item,
        "itemName": ITEMS[item][0],
        "type": c["type"],
        "label": label_of(c),
        "original": original,
        "discount": discount,
        "final": final,
        "free": final <= 0,
        "text": "Code applied - unlocked" if final <= 0 else f"Rs {rs(original)} -> Rs {rs(final)} with {c['_id']}",
    }


# ---------- a person (resume download, packs, Career Launch, expert rewrite) ----------


async def resume_key(db: AsyncDatabase, user_id: str, resume_id: str | None) -> str:
    """The resume a free download code unlocks: the one named, else the builder's (active) resume."""
    q = {"user_id": user_id}
    r = await db[RESUMES].find_one({**q, "key": resume_id}) if resume_id else None
    r = r or await db[RESUMES].find_one({**q, "active": True}) or await db[RESUMES].find_one(q)
    if not r:
        raise ApiError(409, "no_resume", "Make your resume first, then use the code to unlock its download.")
    return r["key"]


async def already_has(db: AsyncDatabase, user_id: str, item: str, rkey: str | None) -> str | None:
    """A message when the account already has what the code would unlock (so a code isn't wasted)."""
    if item == "resume":
        from app.downloads.router import account_entitlement, resume_unlocked

        ok, why = await account_entitlement(db, user_id)
        if ok and why != "payments_off":
            return "Downloads are already unlocked on your account."
        if rkey and await resume_unlocked(db, user_id, rkey):
            return "This resume is already unlocked."
    elif item in ("tailor_pack", "interview_pack"):
        from app.jobsearch.access import has

        if await has(db, user_id, "tailor" if item == "tailor_pack" else "interview"):
            return f"You already have the {ITEMS[item][0]}."
    elif item == "linkedin_pack":
        from app.linkedin.pack import pack_status

        if await pack_status(db, user_id):
            return "You already have the LinkedIn pack."
    return None


async def customer_quote(db: AsyncDatabase, user_id: str, code: str, item: str) -> tuple[dict, int, int]:
    """(code, original price, discount) for `item` at the owner's current price (no add-ons)."""
    c = await check(db, code, item, user_id=user_id)
    plan = ITEMS[item][1]
    original = sum(i[3] for i in price(plan, [], await get_site(db)))
    return c, original, discount_of(c, original)


async def redeem_customer(
    db: AsyncDatabase,
    user_id: str,
    c: dict[str, Any],
    item: str,
    rkey: str | None,
    *,
    addons: list[str] | None = None,
    role: str | None = None,
) -> Order:
    """A free code: an order at Rs 0 is recorded and paid at once (no WhatsApp, in any payment mode); the feature
    unlocks the same way a paid order does (a resume download: this resume only, for good)."""
    from app.orders.service import mark_paid

    plan = ITEMS[item][1]
    items = price(plan, addons or [], await get_site(db))
    original = sum(i[3] for i in items)
    n = await next_number(db, "order_no", ORDER_NO_START)
    order = Order(
        _id=f"RS-{n}",
        customer_id=user_id,
        plan=plan,
        status="pending_payment",
        method="coupon",
        amount=0,
        target_role=(role or "").strip() or None,
        currency=CURRENCY,
        coupon=coupon_doc(c, original, original),
        resume_id=rkey if item == "resume" else None,
        items=[OrderItem(position=i, kind=k, code=cd, name=nm, amount=a) for i, (k, cd, nm, a) in enumerate(items)]
        + [OrderItem(position=len(items), kind="discount", code="coupon", name=f"Code {c['_id']}", amount=-original)],
    )
    await claim(
        db,
        c,
        item,
        user_id=user_id,
        org_id=None,
        order_id=order.id,
        original=original,
        discount=original,
        status="used",
    )
    try:
        await db[ORDERS].insert_one(order.to_mongo())
        payment = Payment(order_id=order.id, amount=0, status="created", method="coupon")
        await db[PAYMENTS].insert_one(payment.to_mongo())
        order, _ = await mark_paid(db, payment.id, None, method="coupon", source="coupon", invoice=False)
    except Exception:
        await _undo(db, order.id, c["_id"])
        raise
    await audit(
        db,
        user_id,
        "coupon.redeemed",
        target=c["_id"],
        data={"code": c["_id"], "item": item, "order_id": order.id, "original": original, "final": 0},
    )
    return order


async def _undo(db: AsyncDatabase, order_id: str, code: str) -> None:
    r = await db[COUPON_USES].delete_many({"order_id": order_id})
    if r.deleted_count:
        await db[COUPONS].update_one({"_id": code}, {"$inc": {"uses": -r.deleted_count}})
    await db[PAYMENTS].delete_many({"order_id": order_id, "status": "created"})
    await db[ORDERS].delete_one({"_id": order_id, "paid_at": None})


def discounted(items: list[tuple[str, str, str, int]], c: dict[str, Any]) -> tuple[list, int, int]:
    """Line items with the code's discount line, the original and the discount (on the whole order)."""
    original = sum(i[3] for i in items)
    d = discount_of(c, original)
    return [*items, ("discount", "coupon", f"Code {c['_id']}", -d)] if d else items, original, d


async def order_code(db: AsyncDatabase, user_id: str, code: str | None, plan: str, ip: str | None) -> dict | None:
    """The code for a new WhatsApp / Razorpay order (checked; None without one)."""
    if not code or not code.strip():
        return None
    item = next(k for k, (_, p) in ITEMS.items() if p == plan)
    return await guarded(db, f"user:{user_id}", ip, lambda: check(db, code, item, user_id=user_id))


async def free_order(
    db: AsyncDatabase, user_id: str, c: dict | None, plan: str, addons: list[str], role: str | None
) -> Order | None:
    """A code that makes this order free: unlocked at once, no payment step (None when there's something to pay)."""
    if not c:
        return None
    items = price(plan, addons, await get_site(db))
    total = sum(i[3] for i in items)
    if discount_of(c, total) < total:
        return None
    item = next(k for k, (_, p) in ITEMS.items() if p == plan)
    rkey = await resume_key(db, user_id, None) if item == "resume" else None
    msg = await already_has(db, user_id, item, rkey)
    if msg:
        raise ApiError(409, "already_unlocked", msg)
    return await redeem_customer(db, user_id, c, item, rkey, addons=addons, role=role)


def free_out(order: Order) -> dict[str, Any]:
    return {
        "orderId": order.id,
        "unlocked": True,
        "amount": 0,
        "code": (order.coupon or {}).get("code"),
        "text": "Code applied - unlocked",
    }


async def reserve_for(db: AsyncDatabase, order: Order, c: dict[str, Any]) -> None:
    """Takes the code's use for an order waiting for payment (given back if it is cancelled). The order is
    removed again when the use can't be taken (the last one just went)."""
    item = next(k for k, (_, p) in ITEMS.items() if p == order.plan)
    try:
        await claim(
            db,
            c,
            item,
            user_id=order.customer_id,
            org_id=order.org_id,
            order_id=order.id,
            original=order.coupon["original"],
            discount=order.coupon["discount"],
            status="reserved",
        )
    except ApiError:
        await db[PAYMENTS].delete_many({"order_id": order.id, "status": "created"})
        await db[ORDERS].delete_one({"_id": order.id})
        raise
    await audit(
        db,
        order.customer_id,
        "coupon.applied",
        target=c["_id"],
        data={
            "code": c["_id"],
            "item": item,
            "order_id": order.id,
            **{k: order.coupon[k] for k in ("original", "discount", "final")},
            **({"orgs": [order.org_id]} if order.org_id else {}),
        },
    )


# ---------- an organization's plan ----------


async def redeem_org(
    db: AsyncDatabase, o: dict[str, Any], payer_id: str, c: dict[str, Any], q: dict[str, Any], **extra
) -> Order:
    """A code that makes the plan free: the plan turns on at once like a paid order (an order at Rs 0)."""
    from app.billing.checkout import new_org_order
    from app.orders.service import mark_paid

    order = await new_org_order(db, o, payer_id, q, **extra)
    order.method = "coupon"
    order.coupon = coupon_doc(c, q["list_price"] - q["discount"], q["coupon"]["discount"])
    item = q["terms"]["plan_id"]
    await claim(
        db,
        c,
        item,
        user_id=payer_id,
        org_id=o["_id"],
        order_id=order.id,
        original=order.coupon["original"],
        discount=order.coupon["discount"],
        status="used",
    )
    try:
        await db[ORDERS].insert_one(order.to_mongo())
        payment = Payment(order_id=order.id, amount=0, status="created", method="coupon")
        await db[PAYMENTS].insert_one(payment.to_mongo())
        order, _ = await mark_paid(db, payment.id, None, method="coupon", source="coupon", invoice=False)
    except Exception:
        await _undo(db, order.id, c["_id"])
        raise
    await audit(
        db,
        payer_id,
        "coupon.redeemed",
        target=c["_id"],
        data={
            "code": c["_id"],
            "item": item,
            "order_id": order.id,
            "original": order.coupon["original"],
            "final": 0,
            "orgs": [o["_id"]],
        },
    )
    return order


async def org_code(
    db: AsyncDatabase, o: dict[str, Any], user_id: str, code: str | None, plan_id: str, ip: str | None
) -> dict | None:
    if not code or not code.strip():
        return None
    if plan_id not in ORG_ITEMS:
        raise ApiError(400, "code_wrong_item", "Codes work for the Drive and Campus plans.")
    return await guarded(db, f"user:{user_id}", ip, lambda: check(db, code, plan_id, user_id=user_id, org_id=o["_id"]))


async def mode_allows(db: AsyncDatabase, free: bool) -> None:
    """Off: only free codes (nothing can be paid)."""
    if not free and await payment_mode(db) == "off":
        raise OFF_ONLY_FREE
