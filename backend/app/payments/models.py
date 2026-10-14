import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

PAYMENT_STATUSES = ("created", "captured", "failed", "refunded")


class Payment(Base):
    """One row per Razorpay order. order_id is empty for money that arrived without a matching order."""

    __tablename__ = "payments"
    __table_args__ = (CheckConstraint(f"status IN {PAYMENT_STATUSES!r}", name="status"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    razorpay_order_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    amount: Mapped[int] = mapped_column(Integer)  # paise
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    status: Mapped[str] = mapped_column(String(10), index=True)
    method: Mapped[str | None] = mapped_column(String(20))  # upi / card / netbanking / wallet …
    error: Mapped[str | None] = mapped_column(String(300))
    raw: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebhookEvent(Base):
    """Every Razorpay webhook we accepted, so each event is handled once."""

    __tablename__ = "webhook_events"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)  # x-razorpay-event-id
    type: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
