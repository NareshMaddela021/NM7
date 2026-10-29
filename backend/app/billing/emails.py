"""Billing emails to an organization's Owner: plan active, plan ending soon / ended / back on Free."""

from datetime import date
from html import escape
from typing import Any

from app.core.config import get_settings
from app.core.email import Email

STYLE = "font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5"


def rupees(paise: int | None) -> str:
    p = int(paise or 0)
    r, f = divmod(p, 100)
    s = f"{r:,}"
    # Indian grouping: 12,34,567
    if r >= 1000:
        head, tail = str(r)[:-3], str(r)[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return f"Rs {s}" + (f".{f:02d}" if f else "")


def nice_day(iso: str | None) -> str:
    return date.fromisoformat(iso).strftime("%d %b %Y") if iso else ""


def _billing_url(org_id: str) -> str:
    return f"{get_settings().site_url}/org/{org_id}/billing"


def _wrap(paras: list[str], url: str, label: str) -> str:
    body = "".join(f"<p>{p}</p>" for p in paras)
    button = (
        f'<p><a href="{escape(url)}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;'
        f'text-decoration:none;display:inline-block">{escape(label)}</a></p>'
    )
    return f'<div style="{STYLE}">{body}{button}<p style="color:#666;font-size:13px">Nm7 · nm7.si</p></div>'


def plan_active(
    to: str,
    name: str,
    org: dict[str, Any],
    sub: dict[str, Any],
    amount: int,
    invoice: tuple[str, str, bytes] | None = None,
) -> Email:
    """`invoice`: (number, file name, PDF) — attached, so the Owner has it without signing in."""
    url = _billing_url(org["_id"])
    hi = f"Hi {name}," if name else "Hello,"
    line = (
        f"Thank you — we received {rupees(amount)} for {org['name']}. The {sub['plan_name']} plan is active from "
        f"{nice_day(sub['starts_on'])} to {nice_day(sub['ends_on'])}."
    )
    lines = [hi, line]
    if invoice:
        lines.append(f"Invoice {invoice[0]} is attached. You can download it again any time from Billing → Invoices.")
    text = "\n\n".join(lines) + f"\n\nBilling and invoices: {url}\n\nNm7 · nm7.si"
    html = _wrap([escape(x) for x in lines], url, "Open billing")
    files = [(invoice[1], "application/pdf", invoice[2])] if invoice else []
    return Email(to, name or to, f"{sub['plan_name']} plan active for {org['name']}", text, html, attachments=files)


def plan_reminder(to: str, name: str, org: dict[str, Any], due: str) -> Email:
    sub = org.get("subscription") or {}
    url = _billing_url(org["_id"])
    hi = f"Hi {name}," if name else "Hello,"
    plan, end = sub.get("plan_name", "paid"), nice_day(sub.get("ends_on"))
    if due == "grace":
        subject = f"{org['name']}: your {plan} plan has ended"
        line = (
            f"The {plan} plan for {org['name']} ended on {end}. Everything keeps working until "
            f"{nice_day(sub.get('grace_until'))}; after that the Free limits apply. Nothing is deleted. "
            "Renew to keep your groups open to new members."
        )
    elif due == "expired":
        subject = f"{org['name']} is on the Free plan now"
        line = (
            f"The {plan} plan for {org['name']} ended on {end} and the grace period is over, so the Free limits "
            "apply now. All your groups and shared resumes are still there and readable; new joins, groups, "
            "coordinators and kiosks over the Free limits are paused until you renew."
        )
    else:
        n = int(due[1:])
        subject = f"{org['name']}: your {plan} plan ends in {n} day{'s' if n != 1 else ''}"
        line = f"The {plan} plan for {org['name']} ends on {end}. Renew now to keep everything running."
    text = f"{hi}\n\n{line}\n\nRenew or change the plan: {url}\n\nNm7 · nm7.si"
    html = _wrap([escape(hi), escape(line)], url, "Renew the plan")
    return Email(to, name or to, subject, text, html)
