"""Order documents. `_id` is the order number (RS-1001, RS-1002, …) from an atomic counter."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.core.db import Doc
from app.core.time import now

ORDER_NO_START = 1001

# pending_payment → offer (paid, finding an expert) → in_progress → waiting → revision → delivered → approved.
# DIY orders go pending_payment → done. Side exits: expired (unpaid 24 h), cancelled, refunded.
STATUSES = (
    "pending_payment",
    "offer",
    "in_progress",
    "waiting",
    "revision",
    "delivered",
    "approved",
    "done",
    "expired",
    "cancelled",
    "refunded",
)


class OrderItem(BaseModel):
    position: int
    kind: str  # plan / addon / upgrade
    code: str
    name: str
    amount: int  # paise


class Order(Doc):
    id: str = Field(alias="_id")
    # "customer": a resume order (the plans in orders/pricing.py). "org": an organization buying or renewing a plan
    # (Phase 4); `org_id` is the organization and `billing` holds the frozen terms, price, discount and GST lines.
    kind: str = "customer"
    org_id: str | None = None
    billing: dict[str, Any] | None = None
    customer_id: str
    plan: str
    target_role: str | None = None
    status: str
    amount: int  # paise
    currency: str = "INR"
    items: list[OrderItem] = Field(default_factory=list)
    invoice_no: str | None = None  # NM7/26-27/0001, unique
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)
    paid_at: datetime | None = None
    deadline_at: datetime | None = None
    delivered_at: datetime | None = None
