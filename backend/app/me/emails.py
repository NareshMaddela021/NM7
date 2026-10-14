"""Emails about support tickets."""

from html import escape
from typing import Any

from app.auth.models import User
from app.core.config import get_settings
from app.core.email import Email


def new_ticket(inbox: str, user: User, t: dict[str, Any]) -> Email:
    """To our support inbox; replying goes straight to the customer."""
    order = f" · order {t['order_id']}" if t.get("order_id") else ""
    subject = f"[{t['_id']}] {t['topic']}{order} — {user.name}"
    text = (
        f"New support request {t['_id']}\n\nFrom: {user.name} <{user.email}>\nTopic: {t['topic']}{order}\n\n"
        f"{t['text']}\n\nReply to this email to answer the customer, then mark it resolved in the admin console:"
        f" {get_settings().site_url}/admin/customers?tab=tickets"
    )
    html = (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        f"<p><b>New support request {escape(t['_id'])}</b></p>"
        f"<p>From: {escape(user.name)} &lt;{escape(user.email)}&gt;<br>Topic: {escape(t['topic'] + order)}</p>"
        f'<p style="white-space:pre-wrap">{escape(t["text"])}</p>'
        '<p style="color:#666">Reply to this email to answer the customer.</p></div>'
    )
    return Email(inbox, "Nm7 support", subject, text, html, reply_to=user.email)


def ticket_reply(user: User, t: dict[str, Any], reply: str) -> Email:
    subject = f"Re: your Nm7 request {t['_id']}"
    text = f"Hi {user.name},\n\n{reply}\n\nYour message: {t['text']}\n\nNm7 · nm7.si · info@nm7.si"
    html = (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        f'<p>Hi {escape(user.name)},</p><p style="white-space:pre-wrap">{escape(reply)}</p>'
        f'<p style="color:#666">Your message: {escape(t["text"])}</p><p style="color:#666">Nm7 · nm7.si</p></div>'
    )
    return Email(user.email, user.name, subject, text, html)
