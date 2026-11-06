"""Email applications (Phase 3, A4): for jobs that take applications by email, Nm7 sends one proper email with the
tailored resume attached, through the existing Resend setup and Nm7's sending address (no new keys).

- To the job's address; Reply-To is the student's own email, so the company answers them directly.
- Short, in English, built only from the student's own facts (their name, headline, the first sentence of their
  summary, the job's skills their resume shows); the "about me" lines pass the fact check or are left out.
- One email per job (the Auto Apply item is unique), within the student's daily limit and the site's daily email cap
  (Admin → Auto Apply; the Resend free plan sends 100 a day). Near the cap the rest wait for the next run, counted in
  the run log so Admin sees it.
- Bounces and complaints: the delivery of each sent email is checked through Resend's own API with the same key;
  a bounce stops every Auto Apply email to that address, a complaint to that whole domain (email_blocks).
- My applications records it as "Sent by email" with a copy of exactly what was sent.
"""

import logging
from datetime import timedelta
from html import escape
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.db import AUTO_ITEMS, EMAIL_BLOCKS
from app.core.email import Email, send_safely
from app.core.time import now

log = logging.getLogger("nm7.autoapply")

HTTP_CLIENT = None  # tests put a mock transport here
CHECK_BATCH = 50
CHECK_FOR = timedelta(days=3)
STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"


def _domain(addr: str) -> str:
    return "@" + addr.rsplit("@", 1)[-1].lower() if "@" in addr else ""


async def blocked(db, addr: str) -> bool:
    return bool(await db[EMAIL_BLOCKS].find_one({"_id": {"$in": [addr.lower(), _domain(addr)]}}))


async def sent_today(db, day: str) -> int:
    return await db[AUTO_ITEMS].count_documents({"sent_day": day})


def _first_sentence(text: str) -> str:
    t = " ".join(str(text or "").split())
    for end in (". ", "! ", "? "):
        if end in t:
            return t.split(end, 1)[0] + end.strip()
    return t[:240]


def letter(name: str, data: dict[str, Any], j: dict[str, Any], found: list[str], link: str) -> tuple[str, str, str]:
    """(subject, text, html) from the student's own facts; any "about me" line failing the fact check is dropped."""
    from app.jobsearch import facts

    p = data.get("personal") or {}
    title, company = j["title"], (j.get("company") or {}).get("name", "")
    resume = facts.resume_text(data)
    allowed = " ".join([title, company, ", ".join(j.get("locations") or [])])
    about = []
    summary = _first_sentence(data.get("summary") or "")
    if summary and facts.ok(summary, resume, allowed):
        about.append(summary)
    if found:
        skills = f"My resume shows {', '.join(found[:6])}, which this role asks for."
        if facts.ok(skills, resume, allowed):
            about.append(skills)
    contact = [x for x in (p.get("phone"), p.get("email")) if x]
    lines = [
        "Dear Hiring Team,",
        "",
        f"I would like to apply for the {title} role at {company}" + (f" ({link})." if link else "."),
        *([""] + about if about else []),
        "",
        "My resume is attached. You can reply to this email to reach me directly.",
        "",
        "Thank you for your time,",
        name,
        *contact,
        "",
        f"Sent through Nm7 (nm7.si) at {name}'s request.",
    ]
    text = "\n".join(lines)
    html = f'<div style="{STYLE}">' + "".join(f"<p>{escape(x)}</p>" if x else "" for x in lines) + "</div>"
    return f"Application for {title} – {name}", text, html


async def send(
    db, mailer, item: dict[str, Any], j: dict[str, Any], u: dict[str, Any], copy: dict[str, Any], found: list[str]
) -> dict[str, Any] | None:
    """Send the application email. Returns what was sent ({to, subject, text, at, providerId}) or None."""
    from app.autoapply import pdf
    from app.jobs.apply import job_page

    to = (j.get("apply") or {}).get("email") or ""
    if not to or await blocked(db, to):
        return None
    data = copy["data"]
    name = (data.get("personal") or {}).get("name") or u.get("name") or "A candidate"
    subject, text, html = letter(name, data, j, found, job_page(j))
    msg = Email(
        to=to,
        to_name=(j.get("company") or {}).get("name", ""),
        subject=subject,
        text=text,
        html=html,
        reply_to=u.get("email"),
        attachments=[(pdf.file_name(data), "application/pdf", pdf.render(data))],
    )
    if not await send_safely(mailer, msg):
        return None
    return {
        "to": to,
        "subject": subject,
        "text": text,
        "at": now(),
        "provider_id": msg.provider_id,
        "attachment": pdf.file_name(data),
    }


async def check_deliveries(db, limit: int = CHECK_BATCH) -> dict[str, int]:
    """Resend's delivery status for recent Auto Apply emails: bounced → stop that address, complained → that domain."""
    s = get_settings()
    out = {"checked": 0, "bounced": 0, "complained": 0}
    if s.email_provider != "resend" or not s.resend_api_key:
        return out
    rows = (
        await db[AUTO_ITEMS]
        .find(
            {
                "state": "sent",
                "delivery": None,
                "sent.provider_id": {"$ne": None},
                "sent.at": {"$gte": now() - CHECK_FOR},
            }
        )
        .limit(limit)
        .to_list(None)
    )
    if not rows:
        return out
    base = s.resend_url.rstrip("/")
    headers = {"Authorization": f"Bearer {s.resend_api_key}", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=10, transport=HTTP_CLIENT) as client:
        for it in rows:
            try:
                r = await client.get(f"{base}/{it['sent']['provider_id']}", headers=headers)
                r.raise_for_status()
                event = str((r.json() or {}).get("last_event") or "")
            except (httpx.HTTPError, ValueError):
                continue
            out["checked"] += 1
            if event not in ("delivered", "bounced", "complained"):
                continue
            await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"delivery": event, "delivery_at": now()}})
            to = it["sent"]["to"]
            if event == "bounced":
                out["bounced"] += 1
                await db[EMAIL_BLOCKS].update_one(
                    {"_id": to.lower()}, {"$setOnInsert": {"reason": "bounce", "at": now()}}, upsert=True
                )
            elif event == "complained":
                out["complained"] += 1
                await db[EMAIL_BLOCKS].update_one(
                    {"_id": _domain(to)}, {"$setOnInsert": {"reason": "complaint", "at": now()}}, upsert=True
                )
    return out
