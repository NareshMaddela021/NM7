import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Sequence, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

REFUND_NO = Sequence("refund_no_seq", start=2001)  # RF-2001, …
REASONS = ("late", "cancel", "quality", "other")
# review → approved (sent to Razorpay) → processed (money on its way back) · or rejected · or failed (Razorpay said no)
STATUSES = ("review", "approved", "processed", "rejected", "failed")
OPEN = ("review", "approved", "processed")


class Refund(Base):
    __tablename__ = "refunds"
    __table_args__ = (
        CheckConstraint(f"reason IN {REASONS!r}", name="reason"),
        CheckConstraint(f"status IN {STATUSES!r}", name="status"),
        # At most one refund per order that isn't rejected or failed.
        Index("uq_refunds_open_order", "order_id", unique=True, postgresql_where=text(f"status IN {OPEN!r}")),
    )

    id: Mapped[str] = mapped_column(String(12), primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id", ondelete="RESTRICT"))
    razorpay_refund_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    amount: Mapped[int] = mapped_column(Integer)  # paise
    reason: Mapped[str] = mapped_column(String(10))
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), index=True)
    auto: Mapped[bool] = mapped_column(default=False)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decision_note: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
