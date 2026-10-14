from fastapi import APIRouter
from sqlalchemy import select

from app.admin.roles import can
from app.auth.deps import CurrentAuth, CustomerAuth
from app.core.db import DB
from app.core.errors import ApiError
from app.orders.models import Order
from app.orders.pricing import PLANS
from app.orders.schemas import CreateOrderIn, CreateOrderOut, OrderOut, Prefill
from app.orders.service import new_order
from app.payments.models import Payment
from app.payments.razorpay import RazorpayError, get_razorpay

router = APIRouter(prefix="/api/orders", tags=["orders"])

NOT_FOUND = ApiError(404, "not_found", "We couldn’t find that order.")


async def refunds_for(db, order_id: str) -> list:
    """Refunds arrive in milestone 5; until then an order has none."""
    return []


@router.post("", status_code=201)
async def create_order(body: CreateOrderIn, auth: CustomerAuth, db: DB) -> CreateOrderOut:
    rzp = get_razorpay()  # 503 until keys are set
    user = auth.user
    order = await new_order(db, user, body.plan_id, body.role, body.addons)
    try:
        r = await rzp.create_order(
            order.amount, order.currency, receipt=order.id, notes={"order_id": order.id, "customer_id": str(user.id)}
        )
    except RazorpayError:
        await db.rollback()
        raise ApiError(502, "payment_provider_error", "We couldn’t start the payment. Please try again.") from None
    payment = Payment(
        order_id=order.id,
        razorpay_order_id=r["id"],
        amount=order.amount,
        currency=order.currency,
        status="created",
        raw={"order": r},
    )
    db.add(payment)
    await db.commit()
    return CreateOrderOut(
        order_id=order.id,
        razorpay_order_id=r["id"],
        amount=order.amount,
        currency=order.currency,
        key_id=rzp.key_id,
        description=f"{PLANS[order.plan][0]} · {order.id}",
        prefill=Prefill(name=user.name, email=user.email, contact=user.phone),
    )


@router.get("")
async def my_orders(auth: CustomerAuth, db: DB) -> list[OrderOut]:
    rows = await db.execute(select(Order).where(Order.customer_id == auth.user.id).order_by(Order.created_at.desc()))
    return [OrderOut.of(o, await refunds_for(db, o.id)) for o in rows.scalars()]


@router.get("/{order_id}")
async def get_order(order_id: str, auth: CurrentAuth, db: DB) -> OrderOut:
    order = await db.get(Order, order_id)
    if order is None:
        raise NOT_FOUND
    is_admin = auth.user.role == "admin" and auth.session.two_step and can(auth.user.admin_role, "orders")
    if order.customer_id != auth.user.id and not is_admin:
        raise NOT_FOUND  # don't reveal other people's order numbers
    return OrderOut.of(order, await refunds_for(db, order.id))
