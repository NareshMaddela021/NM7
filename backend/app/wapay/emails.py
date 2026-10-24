from html import escape

from app.core.email import Email
from app.orders.models import Order
from app.wapay.service import item_text, rupees

METHOD = {"upi": "UPI", "bank": "Bank transfer", "cash": "Cash"}


def payment_received(to: str, name: str, order: Order, method: str, reference: str, amount: int) -> Email:
    """From "Nm7" only (no company legal name until business details are set). A receipt, not a tax invoice, when
    no GST invoice was issued."""
    doc = f"Invoice no.: {order.invoice_no}" if order.invoice_no else f"Receipt no.: {order.receipt_no}"
    next_step = {
        "diy": "Your downloads are unlocked in the builder.",
        "linkedin_pack": "Your LinkedIn pack is unlocked: open nm7.si/linkedin to see it.",
    }.get(order.plan, "Your order has started. Delivery time is counted from now.")
    if order.kind == "org":
        next_step = "Your organization's plan is on."
    lines = [
        f"Hi {name},",
        "",
        f"Payment received for {order.id}: {item_text(order)}.",
        f"Amount: Rs {rupees(amount)} · {METHOD.get(method, method)} · reference {reference}",
        doc,
        "",
        next_step,
        "",
        "Nm7 · nm7.si",
    ]
    text = "\n".join(lines)
    html = (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        + "".join(f"<p>{escape(x)}</p>" for x in lines if x)
        + "</div>"
    )
    return Email(to, name, f"Payment received for {order.id}", text, html)
