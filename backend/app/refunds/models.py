from datetime import datetime

from pydantic import Field

from app.core.db import Doc
from app.core.time import now

REFUND_NO_START = 2001  # RF-2001, …
REASONS = ("late", "cancel", "quality", "other")
# review → approved (sent to Razorpay) → processed (money on its way back) · or rejected · or failed (Razorpay said no)
STATUSES = ("review", "approved", "processed", "rejected", "failed")
# Still in flight: a unique index allows one open refund per order. A processed refund is closed, so the rest of a
# partly refunded order can be refunded later; what was already returned is counted in `refunded_amount`.
OPEN = ("review", "approved")
SETTLED = ("approved", "processed")  # money sent, or on its way back: counts against the order's total


class Refund(Doc):
    id: str = Field(alias="_id")
    order_id: str
    payment_id: str
    razorpay_refund_id: str | None = None
    amount: int  # paise
    reason: str
    details: str | None = None
    status: str
    open: bool = True  # status in OPEN (review / approved); a unique index allows one open refund per order
    auto: bool = False
    requested_by: str | None = None
    decided_by: str | None = None
    decision_note: str | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=now)
    decided_at: datetime | None = None
    processed_at: datetime | None = None
