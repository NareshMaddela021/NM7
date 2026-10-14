import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Sequence, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.payments.models import Payment

ORDER_NO = Sequence("order_no_seq", start=1001)  # RS-1001, RS-1002, …

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


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (CheckConstraint(f"status IN {STATUSES!r}", name="status"),)

    id: Mapped[str] = mapped_column(String(12), primary_key=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    plan: Mapped[str] = mapped_column(String(20))
    target_role: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), index=True)
    amount: Mapped[int] = mapped_column(Integer)  # paise
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    invoice_no: Mapped[str | None] = mapped_column(String(30), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    items: Mapped[list["OrderItem"]] = relationship(lazy="selectin", order_by="OrderItem.position")
    payments: Mapped[list["Payment"]] = relationship(lazy="selectin", order_by="Payment.created_at")


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("kind IN ('plan', 'addon', 'upgrade')", name="kind"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(80))
    amount: Mapped[int] = mapped_column(Integer)  # paise


class InvoiceCounter(Base):
    """Invoice numbers run per Indian financial year (April–March): NM7/26-27/0001, …"""

    __tablename__ = "invoice_counters"

    financial_year: Mapped[str] = mapped_column(String(5), primary_key=True)  # "26-27"
    last_no: Mapped[int] = mapped_column(Integer)
