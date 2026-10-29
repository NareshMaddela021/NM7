from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.schemas import CamelModel
from app.orders.models import Order
from app.orders.pricing import PLANS


class CreateOrderIn(CamelModel):
    plan_id: Literal["diy", "expert", "launch", "linkedin_pack", "tailor_pack", "interview_pack", "annual_pass"]
    role: str | None = Field(default=None, max_length=100)  # the job the resume is for
    addons: list[str] = Field(default_factory=list, max_length=5)
    code: str | None = Field(default=None, max_length=40)  # a code (Admin → Codes); one per order


class Prefill(CamelModel):
    name: str
    email: str
    contact: str | None


class CreateOrderOut(CamelModel):
    """Everything the frontend passes to `new window.Razorpay({...})`."""

    order_id: str
    razorpay_order_id: str
    amount: int  # paise
    currency: str
    key_id: str
    name: str = "Nm7"
    description: str
    prefill: Prefill


class ItemOut(CamelModel):
    kind: str
    code: str
    name: str
    amount: int


class RefundOut(CamelModel):
    id: str
    amount: int
    reason: str
    status: str
    auto: bool
    created_at: datetime
    processed_at: datetime | None


class CouponOut(CamelModel):
    code: str
    type: str
    original: int
    discount: int
    final: int


class OrderOut(CamelModel):
    id: str
    plan: str
    plan_name: str
    target_role: str | None
    status: str
    amount: int  # paise
    price: float  # rupees, like the frontend's `price`
    currency: str
    items: list[ItemOut]
    invoice_no: str | None
    receipt_no: str | None = None  # a WhatsApp payment before business details are set (no GST invoice)
    method: str | None = None  # "whatsapp" or None (Razorpay)
    payment_method: str | None
    payment_id: str | None
    created_at: datetime
    paid_at: datetime | None
    deadline_at: datetime | None
    delivered_at: datetime | None
    refunds: list[RefundOut] = []
    coupon: CouponOut | None = None  # the code used: original price, discount, final price (paise)
    resume_id: str | None = None  # a free code that unlocked one resume's downloads

    @classmethod
    def of(cls, o: Order, payments: list | None = None, refunds: list | None = None) -> "OrderOut":
        paid = next((p for p in payments or [] if p.status in ("captured", "refunded")), None)
        return cls(
            id=o.id,
            plan=o.plan,
            plan_name=PLANS[o.plan][0] if o.plan in PLANS else (o.items[0].name if o.items else o.plan),
            target_role=o.target_role,
            status=o.status,
            amount=o.amount,
            price=o.amount / 100,
            currency=o.currency,
            items=[ItemOut.model_validate(i) for i in o.items],
            invoice_no=o.invoice_no,
            receipt_no=o.receipt_no,
            method=o.method,
            payment_method=paid.method if paid else None,
            payment_id=paid.razorpay_payment_id if paid else None,
            created_at=o.created_at,
            paid_at=o.paid_at,
            deadline_at=o.deadline_at,
            delivered_at=o.delivered_at,
            refunds=[RefundOut.model_validate(r) for r in refunds or []],
            coupon=CouponOut.model_validate(o.coupon) if o.coupon else None,
            resume_id=o.resume_id,
        )
