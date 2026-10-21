"""Partner emails: application received, approved (with the code and link)."""

from html import escape
from typing import Any

from app.billing.emails import _wrap
from app.core.config import get_settings
from app.core.email import Email


def applied(p: dict[str, Any]) -> Email:
    url = f"{get_settings().site_url}/partners"
    hi = f"Hi {p['name']},"
    line = (
        "Thank you for applying to the Nm7 partner programme. We'll check your application and email you your "
        "partner code and link once it is approved. We never ask for bank or PAN details before your first payout."
    )
    return Email(p["email"], p["name"], "Your Nm7 partner application", f"{hi}\n\n{line}\n\nNm7 · nm7.si",
                 _wrap([escape(hi), escape(line)], url, "About the programme"))  # fmt: skip


def approved(p: dict[str, Any], link: str) -> Email:
    url = f"{get_settings().site_url}/partner"
    hi = f"Hi {p['name']},"
    lines = [
        hi,
        f"You're an Nm7 partner. Your code is {p['code']} and your link is {link}.",
        "Share the link with colleges, training centres and job-fair organisers. When an organization you referred "
        "pays for a plan, you earn commission; you can follow it on your partner page. Sign in with this email "
        "address to open it.",
    ]
    text = "\n\n".join(lines) + f"\n\nYour partner page: {url}\n\nNm7 · nm7.si"
    return Email(p["email"], p["name"], f"You're an Nm7 partner — code {p['code']}", text,
                 _wrap([escape(x) for x in lines], url, "Open your partner page"))  # fmt: skip
