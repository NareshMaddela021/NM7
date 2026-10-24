from html import escape

from app.core.email import Email
from app.orders.models import Order
from app.orders.pricing import PLANS


def _inr(paise: int) -> str:
    rupees = paise / 100
    return f"₹{rupees:,.0f}" if rupees == int(rupees) else f"₹{rupees:,.2f}"


def payment_receipt(to: str, name: str, order: Order) -> Email:
    plan = PLANS[order.plan][0]
    lines = [f"{i.name}: {_inr(i.amount)}" for i in order.items]
    next_step = {
        "diy": "Your exports are unlocked in the builder.",
        "linkedin_pack": "Your LinkedIn pack is unlocked: open nm7.si/linkedin to see it.",
        "tailor_pack": "Your Tailor pack is unlocked: open nm7.si/me/ats to match and tailor your resume.",
        "interview_pack": "Your Interview pack is unlocked: open nm7.si/me/interview to start.",
    }.get(
        order.plan,
        "Your expert will be assigned shortly. Answer the 4 quick questions in your dashboard so they can start.",
    )
    text = (
        f"Hi {name},\n\nThanks for your payment. Order {order.id} — {plan}.\n\n"
        + "\n".join(lines)
        + f"\nTotal paid: {_inr(order.amount)} (incl. GST)\nInvoice no.: {order.invoice_no}\n\n{next_step}\n\n"
        "Nm7 · nm7.si · info@nm7.si"
    )
    rows = "".join(f"<tr><td>{escape(i.name)}</td><td align='right'>{_inr(i.amount)}</td></tr>" for i in order.items)
    html = (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        f"<p>Hi {escape(name)},</p><p>Thanks for your payment. Order <b>{order.id}</b> — {escape(plan)}.</p>"
        f'<table cellpadding="4">{rows}<tr><td><b>Total paid (incl. GST)</b></td>'
        f"<td align='right'><b>{_inr(order.amount)}</b></td></tr></table>"
        f"<p>Invoice no.: {order.invoice_no}</p><p>{escape(next_step)}</p>"
        '<p style="color:#666">Nm7 · nm7.si · info@nm7.si</p></div>'
    )
    return Email(to, name, f"Payment received — order {order.id}", text, html)
