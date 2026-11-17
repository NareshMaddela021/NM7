"""Auto Apply 2.0, phase A7: one Replies inbox for the candidate, and the interview alert.

  GET  /api/me/auto-apply/v2/inbox              every reply across channels, newest first, with unread markers:
                                                companies' emails to the apply address (A3), Nm7 companies' moves
                                                (A2: viewed, shortlisted, interview, offer, not selected, closed) and
                                                the statuses of companies' hiring systems (A4, the same moves)
  POST /api/me/auto-apply/v2/inbox/read {ids}   these entries were read (no ids: all of them)

Each entry links to its tracker row (itemId). An interview invite is either an "interview" status, or an email reply
the rules (first) read as an invitation. Only when the rules can't tell, and there is an AI key and today's allowance,
the configured cheap model reads it with a strict JSON schema (counted in the daily AI allowance as
`autoapply_reply`); with no AI it stays "other". Nothing in a reply is changed or added.

A3's webhook (app/autoapply/inbound.py) reads each reply as it arrives; on an interview invite the forwarded email
says "Interview invitation". The interview alert goes once per tracker row: an email, and a WhatsApp message only
when the candidate opted in to WhatsApp job messages, has a phone number and a WhatsApp sender is configured
(app/college/reminders.GATEWAY; none is connected today, so it is skipped and noted). Both follow access.may_mail:
while the 2.0 switch is OFF only listed testers get them (never admins or demo accounts).
"""

import logging
import re
from typing import Any

from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.autoapply import access
from app.core import claude
from app.core.config import get_settings
from app.core.db import AUTO_ITEMS, AUTO_REPLIES, DB, USERS
from app.core.email import Email, get_mailer, send_safely
from app.core.schemas import CamelModel
from app.core.time import now
from app.site import get_site

log = logging.getLogger("nm7.autoapply")

router = APIRouter(prefix="/api/me/auto-apply/v2", tags=["auto apply 2.0"])

FEATURE = "autoapply_reply"
TIMEOUT = 8  # seconds: it runs inside Resend's webhook call
RETRIES = 0
HTTP_CLIENT = None  # tests put a mock transport here
MAX_ENTRIES = 100
READ_KEEP = 300
STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"

# the companies' moves that are replies (A2 / A4 notices); "replied" is the email itself (listed from auto_replies),
# "remind" is Nm7's own one-tap reminder (A6), not a reply
STATUSES = ("viewed", "shortlisted", "interview", "offer", "rejected", "closed", "no_reply")
KINDS = ("interview", "rejection", "question", "acknowledgement", "other")
KIND_TEXT = {
    "interview": "Interview invite",
    "rejection": "Not selected",
    "question": "A question for you",
    "acknowledgement": "Received",
    "other": "Reply",
}

# ---------- reading an email reply: rules first ----------

_REJECT = re.compile(
    r"\b(unfortunately|regret to|we regret|not (be )?moving forward|move forward with other|other candidates|"
    r"not (been )?shortlisted|position has been filled|will not be proceeding|decided not to|not selected)\b",
    re.I,
)
_INVITE = re.compile(
    r"\b(interview|invite you|invitation to|next round|technical round|hr round|schedule (a|an|your) (call|meeting|"
    r"chat|discussion)|(available|free) for a (quick )?(call|chat|discussion)|book a (slot|time)|pick a (slot|time))\b|"
    r"calendly\.com|zoom\.us/|meet\.google\.com|teams\.microsoft\.com",
    re.I,
)
_IF = re.compile(
    r"\b(if (you are |you're )?(shortlisted|selected|suitable)|will (contact|reach out to) you if)\b", re.I
)
_ACK = re.compile(
    r"\b(out of (the )?office|auto(matic)?[- ]?reply|received your application|thank you for (applying|your "
    r"application|your interest)|we will review)\b",
    re.I,
)
_QUESTION = re.compile(
    r"\b(could you (please )?(share|send|confirm|tell)|please (share|send|confirm|let us know)|what is your|"
    r"when can you join|your (current|expected) (ctc|salary)|notice period)\b",
    re.I,
)


def rules_kind(subject: str, text: str) -> str | None:
    """The rules' reading of a reply, or None when they can't tell."""
    s = f"{subject}\n{text}"
    if _REJECT.search(s):
        return "rejection"
    if _INVITE.search(s) and not _IF.search(s):
        return "interview"
    if _QUESTION.search(s):
        return "question"
    if _ACK.search(s):
        return "acknowledgement"
    return None


SCHEMA = {
    "type": "object",
    "properties": {"kind": {"type": "string", "enum": list(KINDS)}},
    "required": ["kind"],
    "additionalProperties": False,
}


def check(raw: Any) -> str:
    kind = raw.get("kind") if isinstance(raw, dict) else None
    if kind not in KINDS:
        raise claude.Unusable("bad_kind")
    return kind


def prompt(subject: str, text: str) -> str:
    return (
        "A company replied to a job application. Say which kind of reply it is: interview (they invite the "
        "applicant to an interview, a call or a next round), rejection, question (they ask the applicant something), "
        "acknowledgement (an automatic or 'we received it' reply) or other. Answer only from the text below.\n\n"
        f"Subject: {subject[:300]}\n\n{text[:3000]}"
    )


async def call_model(subject: str, text: str) -> str:
    return await claude.ask_models(
        FEATURE,
        [{"type": "text", "text": prompt(subject, text)}],
        SCHEMA,
        check,
        max_tokens=50,
        effort="low",
        timeout_s=TIMEOUT,
        retries=RETRIES,
        http_client=HTTP_CLIENT,
        thinking={"type": "disabled"},
    )


async def classify(db, uid: str, subject: str, text: str) -> tuple[str, str]:
    """(kind, by): by = "rules", "ai" or "none" (no key, the allowance used up, or the AI failed → "other")."""
    from app.core import ai_quota

    got = rules_kind(subject, text)
    if got:
        return got, "rules"
    if not get_settings().anthropic_api_key or not (subject or text).strip():
        return "other", "none"
    try:
        await ai_quota.take(db, FEATURE, uid)
    except Exception:  # noqa: BLE001 — the person's or the site's daily AI limit
        return "other", "none"
    try:
        return await call_model(subject, text), "ai"
    except Exception:  # noqa: BLE001 — unusable or an API error: no guess
        log.warning("auto apply 2.0: reading a reply with AI failed")
        await ai_quota.note(db, FEATURE, "failed")
        return "other", "none"


# ---------- the interview alert ----------


def _phone(v: str | None) -> str:
    d = re.sub(r"\D", "", v or "")
    if len(d) == 10:
        d = "91" + d
    return d if 11 <= len(d) <= 15 else ""


def whatsapp_on(u: dict[str, Any]) -> bool:
    """WhatsApp job messages are opt-in (Profile → Notifications → WhatsApp → Jobs), never on by default."""
    return ((u.get("notify") or {}).get("whatsapp") or {}).get("jobs") is True


def _gateway():
    from app.college import reminders

    return reminders.GATEWAY


async def alert_interview(db, item_id: str, text: str, mailer=None, emailed: bool = False) -> dict[str, Any]:
    """Once per tracker row. → {email, whatsapp, why}."""
    from app.jobs.apply import followups_on

    t = now()
    it = await db[AUTO_ITEMS].find_one_and_update(
        {"_id": item_id, "interview_alert_at": None}, {"$set": {"interview_alert_at": t, "updated_at": t}}
    )
    if not it:
        return {"email": False, "whatsapp": False, "why": "already"}
    if not it.get("interview_at"):
        await db[AUTO_ITEMS].update_one({"_id": item_id}, {"$set": {"interview_at": t}})
    v2 = (await get_site(db))["auto_apply_v2"]
    u = await db[USERS].find_one(
        {"_id": it["user_id"]},
        {"email": 1, "email_lc": 1, "name": 1, "demo": 1, "role": 1, "notify": 1, "phone": 1, "email_bounced": 1,
         "disabled_at": 1},
    )  # fmt: skip
    out: dict[str, Any] = {"email": False, "whatsapp": False, "why": "ok"}
    if not u or u.get("disabled_at") or u.get("demo") or not access.may_mail(u, v2):
        out["why"] = "switch_off"  # while hidden: testers only (admins never); demo accounts never at all
    else:
        link = f"{get_settings().site_url.rstrip('/')}/me/auto-apply/v2?tab=replies"
        if not emailed and u.get("email") and not u.get("email_bounced") and followups_on(u):
            out["email"] = await send_safely(mailer or get_mailer(), _alert_email(u, text, link))
        gw = _gateway()
        phone = _phone(u.get("phone"))
        if not whatsapp_on(u):
            out["whatsapp_why"] = "not_opted_in"
        elif not phone:
            out["whatsapp_why"] = "no_phone"
        elif not getattr(gw, "available", False):
            out["whatsapp_why"] = "no_sender"
        else:
            try:
                out["whatsapp"] = bool(await gw.send(phone, f"Nm7: {text} See it: {link}"))
            except Exception:  # noqa: BLE001 — a messaging problem never stops the email
                log.warning("auto apply 2.0: the WhatsApp interview alert failed")
                out["whatsapp_why"] = "failed"
    await db[AUTO_ITEMS].update_one({"_id": item_id}, {"$set": {"interview_alert": out}})
    return out


def _alert_email(u: dict[str, Any], text: str, link: str) -> Email:
    from html import escape

    first = (u.get("name") or "").split(" ")[0] or "there"
    body = "\n".join([f"Hi {first},", "", text, "", f"See it in your Auto Apply replies: {link}", "", "Nm7 · nm7.si"])
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(first)},</p><p>{escape(text)}</p>'
        f'<p><a href="{escape(link)}">See it in your Auto Apply replies</a></p></div>'
    )
    return Email(to=u["email"], to_name=u.get("name", ""), subject="Interview invitation"[:150], text=body, html=html)


# ---------- the inbox ----------


def _source(it: dict[str, Any]) -> tuple[str, str]:
    """(channel, label) of a company's move: the company's hiring system (A4) or Nm7 (A2)."""
    p = it.get("partner") or {}
    if it.get("channel_v2") == "partner" or p:
        return "partner", f"Hiring system{(' · ' + p['name']) if p.get('name') else ''}"
    return "internal", "On Nm7"


async def entries(db, uid: str) -> list[dict[str, Any]]:
    from app.me.service import ms

    out: list[dict[str, Any]] = []
    async for r in db[AUTO_REPLIES].find({"user_id": uid}).sort("received_at", -1).limit(MAX_ENTRIES):
        kind = r.get("kind") or "other"
        out.append({
            "id": f"r:{r['_id']}", "source": "email", "channel": "email", "label": "Email to your apply address",
            "itemId": r.get("item_id"), "company": r.get("company") or "", "title": r.get("title") or "",
            "from": r.get("from") or "", "fromName": r.get("from_name") or "", "subject": r.get("subject") or "",
            "text": r.get("text") or "", "at": ms(r.get("received_at")), "kind": kind, "kindText": KIND_TEXT[kind],
            "interview": kind == "interview", "forwarded": bool(r.get("forwarded")), "demo": bool(r.get("demo")),
        })  # fmt: skip
    q = {"user_id": uid, "v2": True, "notices.status": {"$in": list(STATUSES)}}
    proj = {"notices": 1, "company": 1, "title": 1, "channel_v2": 1, "partner": 1, "demo": 1}
    async for it in db[AUTO_ITEMS].find(q, proj).sort("updated_at", -1).limit(200):
        channel, label = _source(it)
        for n in it.get("notices") or []:
            st = n.get("status")
            if st not in STATUSES or not n.get("at"):
                continue
            at = ms(n["at"])
            out.append({
                "id": f"n:{it['_id']}:{at}:{st}", "source": "status", "channel": channel, "label": label,
                "itemId": it["_id"], "company": it.get("company") or "", "title": it.get("title") or "",
                "from": "", "fromName": "", "subject": "", "text": n.get("text") or "", "at": at, "status": st,
                "kind": "interview" if st == "interview" else "rejection" if st == "rejected" else "status",
                "kindText": "Interview invite" if st == "interview" else "", "interview": st == "interview",
                "forwarded": False, "demo": bool(it.get("demo")),
            })  # fmt: skip
    out.sort(key=lambda e: -(e["at"] or 0))
    return out[:MAX_ENTRIES]


async def inbox(db, uid: str) -> dict[str, Any]:
    from app.me.service import ms

    u = await db[USERS].find_one({"_id": uid}, {"auto_apply.inbox_seen_at": 1, "auto_apply.inbox_read": 1}) or {}
    a = u.get("auto_apply") or {}
    seen = ms(a.get("inbox_seen_at")) or 0
    read = set(a.get("inbox_read") or [])
    rows = await entries(db, uid)
    for e in rows:
        e["unread"] = (e["at"] or 0) > seen and e["id"] not in read
    return {
        "items": rows,
        "unread": sum(1 for e in rows if e["unread"]),
        "interviews": sum(1 for e in rows if e["interview"]),
    }


async def unread(db, uid: str) -> int:
    return (await inbox(db, uid))["unread"]


class ReadIn(CamelModel):
    ids: list[str] = Field(default_factory=list, max_length=100)


@router.get("/inbox")
async def get_inbox(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    from app.autoapply.v2 import _allowed

    await _allowed(db, auth.user.id)
    return await inbox(db, auth.user.id)


@router.post("/inbox/read")
async def mark_read(body: ReadIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    from app.autoapply.v2 import _allowed

    uid = auth.user.id
    await _allowed(db, uid)
    if body.ids:
        ids = [str(x)[:200] for x in body.ids]
        await db[USERS].update_one(
            {"_id": uid}, {"$push": {"auto_apply.inbox_read": {"$each": ids, "$slice": -READ_KEEP}}}
        )
    else:
        await db[USERS].update_one(
            {"_id": uid}, {"$set": {"auto_apply.inbox_seen_at": now(), "auto_apply.inbox_read": []}}
        )
    return await inbox(db, uid)
