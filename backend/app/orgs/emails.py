"""Organization emails: coordinator invites, resume reminders and "needs changes" notes. Fixed templates: the only
free text is the coordinator's note, which is plain text, capped and HTML-escaped."""

from html import escape

from app.core.config import get_settings
from app.core.email import Email

STYLE = "font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5"
MISSING_TEXT = {
    "contact": "your email or phone number",
    "education": "your education",
    "skills": "your skills",
    "experience": "at least one job, internship or project",
}


def _button(url: str, label: str) -> str:
    return (
        f'<p><a href="{escape(url)}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;'
        f'text-decoration:none;display:inline-block">{escape(label)}</a></p>'
    )


def staff_invite(to: str, org_name: str, role: str, token: str, inviter: str) -> Email:
    url = f"{get_settings().site_url}/org/invite/{token}"
    what = "manage groups, approve members, send reminders and print" if role == "coordinator" else "view and print"
    text = (
        f"Hello,\n\n{inviter} invited you to help run resume drives for {org_name} on Nm7.\n"
        f"As a {role} you can {what} your organization's shared resumes.\n\n"
        f"Accept the invite (sign in or create a free account with this email address, {to}):\n{url}\n\n"
        "The link works once and expires in 7 days.\n\nNm7 · nm7.si"
    )
    html = (
        f'<div style="{STYLE}"><p>Hello,</p><p>{escape(inviter)} invited you to help run resume drives for '
        f"<b>{escape(org_name)}</b> on Nm7. As a {escape(role)} you can {escape(what)} your organization’s shared "
        f"resumes.</p>{_button(url, 'Accept the invite')}"
        f'<p style="color:#666">Sign in or create a free account with this email address ({escape(to)}). '
        "The link works once and expires in 7 days.</p></div>"
    )
    return Email(to, to, f"You’re invited to {org_name} on Nm7", text, html)


def _stop(url: str) -> str:
    return f'<p style="color:#888;font-size:12px"><a href="{escape(url)}">Stop reminders from this group</a></p></div>'


def _missing_lines(missing: list[str]) -> list[str]:
    return [MISSING_TEXT.get(m, m) for m in missing]


def reminder(to: str, name: str, org_name: str, group_name: str, missing: list[str], note: str, stop_url: str) -> Email:
    s = get_settings()
    builder = f"{s.site_url}/builder"
    lines = _missing_lines(missing)
    todo = ("Still missing: " + ", ".join(lines) + ".") if lines else "Please check it’s up to date."
    text = (
        f"Hi {name},\n\n{org_name} ({group_name}) is waiting for your resume on Nm7. {todo}\n\n"
        + (f"Note from {org_name}: {note}\n\n" if note else "")
        + f"Open your resume: {builder}\n\nStop reminders from this group: {stop_url}\n\nNm7 · nm7.si"
    )
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(name)},</p><p><b>{escape(org_name)}</b> ({escape(group_name)}) is '
        f"waiting for your resume on Nm7.</p>"
        + (
            f"<p>Still missing:</p><ul>{''.join(f'<li>{escape(x)}</li>' for x in lines)}</ul>"
            if lines
            else f"<p>{todo}</p>"
        )
        + (
            f'<p style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:10px">'
            f"Note from {escape(org_name)}: {escape(note)}</p>"
            if note
            else ""
        )
        + _button(builder, "Open my resume")
        + _stop(stop_url)
    )
    return Email(to, name, f"Reminder from {org_name}: finish your resume", text, html)


def needs_changes(to: str, name: str, org_name: str, group_name: str, note: str, stop_url: str) -> Email:
    builder = f"{get_settings().site_url}/builder"
    text = (
        f"Hi {name},\n\n{org_name} ({group_name}) looked at your resume and asked for a few changes:\n\n{note}\n\n"
        f"Open your resume: {builder}\n\nStop reminders from this group: {stop_url}\n\nNm7 · nm7.si"
    )
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(name)},</p><p><b>{escape(org_name)}</b> ({escape(group_name)}) looked at '
        f"your resume and asked for a few changes:</p>"
        f'<p style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:10px">{escape(note)}</p>'
        + _button(builder, "Open my resume")
        + _stop(stop_url)
    )
    return Email(to, name, f"{org_name} asked for changes to your resume", text, html)
