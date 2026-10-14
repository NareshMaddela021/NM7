from html import escape

from app.core.email import Email
from app.orders.emails import _inr

REFUND_DAYS = "3–5 business days"  # PROMISES.refundDays in pricing.js


def _wrap(name: str, paras: list[str]) -> str:
    body = "".join(f"<p>{escape(p)}</p>" for p in paras)
    return (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        f"<p>Hi {escape(name)},</p>{body}"
        '<p style="color:#666">Nm7 · nm7.si · info@nm7.si</p></div>'
    )


def refund_started(to: str, name: str, order_id: str, amount: int) -> Email:
    paras = [
        f"Your refund of {_inr(amount)} for order {order_id} is on its way.",
        f"It reaches your account in {REFUND_DAYS}, to the same UPI / card you paid with.",
    ]
    return Email(
        to, name, f"Refund started — order {order_id}", f"Hi {name},\n\n" + "\n".join(paras), _wrap(name, paras)
    )


def refund_under_review(to: str, name: str, order_id: str) -> Email:
    paras = [f"We got your refund request for order {order_id}. Our team replies within 24 hours."]
    return Email(
        to, name, f"Refund request received — order {order_id}", f"Hi {name},\n\n" + paras[0], _wrap(name, paras)
    )


def refund_rejected(to: str, name: str, order_id: str, note: str) -> Email:
    paras = [
        f"We looked at your refund request for order {order_id} and can’t approve it.",
        f"Why: {note}",
        "Reply to this email or write to info@nm7.si if you’d like us to look again.",
    ]
    return Email(
        to,
        name,
        f"About your refund request — order {order_id}",
        f"Hi {name},\n\n" + "\n".join(paras),
        _wrap(name, paras),
    )
