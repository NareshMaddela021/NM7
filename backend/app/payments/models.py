import uuid
from datetime import datetime
from typing import Any

from pydantic import Field

from app.core.db import Doc
from app.core.time import now

PAYMENT_STATUSES = ("created", "captured", "failed", "refunded")


class Payment(Doc):
    """One document per Razorpay order. order_id is empty for money that arrived without a matching order."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), alias="_id")
    order_id: str | None = None
    razorpay_order_id: str | None = None
    razorpay_payment_id: str | None = None
    amount: int  # paise
    currency: str = "INR"
    status: str  # created / captured / failed / refunded
    method: str | None = None  # upi / card / netbanking / wallet …
    error: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)
    captured_at: datetime | None = None


class WebhookEvent(Doc):
    """Every Razorpay webhook we accepted, so each event is handled once."""

    id: str = Field(alias="_id")  # x-razorpay-event-id
    type: str
    payload: dict[str, Any]
    received_at: datetime = Field(default_factory=now)
    processed_at: datetime | None = None
