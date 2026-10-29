"""Texts of the account emails."""

from html import escape

from app.core.config import get_settings
from app.core.email import Email

SUPPORT = "info@nm7.si"


def _html(name: str, intro: str, code: str) -> str:
    return (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        f"<p>Hi {escape(name)},</p><p>{intro}</p>"
        f'<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{code}</p>'
        "<p>It works for 10 minutes. If you didn’t ask for it, you can ignore this email.</p>"
        f'<p style="color:#666">Nm7 · nm7.si · {SUPPORT}</p></div>'
    )


def verify_email(to: str, name: str, code: str) -> Email:
    intro = "Here is your code to confirm your email for Nm7:"
    text = f"Hi {name},\n\n{intro}\n\n{code}\n\nIt works for 10 minutes.\n\nNm7 · nm7.si"
    return Email(to, name, f"{code} is your Nm7 code", text, _html(name, intro, code))


def account_exists(to: str, name: str) -> Email:
    """Sent instead of a code when someone signs up with an email that already has an account."""
    url = f"{get_settings().site_url}/login"
    intro = "Someone (probably you) tried to create an Nm7 account with this email. You already have one — sign in:"
    tail = "Forgot your password? Use “Forgot password?” on that page. If this wasn’t you, you can ignore this email."
    text = f"Hi {name},\n\n{intro}\n\n{url}\n\n{tail}\n\nNm7 · nm7.si"
    html = (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        f"<p>Hi {escape(name)},</p><p>{intro}</p>"
        f'<p><a href="{url}" style="font-weight:bold">{url}</a></p>'
        f"<p>{tail}</p>"
        f'<p style="color:#666">Nm7 · nm7.si · {SUPPORT}</p></div>'
    )
    return Email(to, name, "You already have an Nm7 account", text, html)


def reset_password(to: str, name: str, code: str) -> Email:
    intro = "Here is your code to set a new Nm7 password:"
    text = f"Hi {name},\n\n{intro}\n\n{code}\n\nIt works for 10 minutes. If you didn’t ask, ignore this email."
    return Email(to, name, f"{code} is your Nm7 password reset code", text, _html(name, intro, code))
