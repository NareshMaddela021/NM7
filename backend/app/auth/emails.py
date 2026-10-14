"""Texts of the account emails."""

from html import escape

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


def reset_password(to: str, name: str, code: str) -> Email:
    intro = "Here is your code to set a new Nm7 password:"
    text = f"Hi {name},\n\n{intro}\n\n{code}\n\nIt works for 10 minutes. If you didn’t ask, ignore this email."
    return Email(to, name, f"{code} is your Nm7 password reset code", text, _html(name, intro, code))
