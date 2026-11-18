"""Auto Apply 2.0, phase A3: what comes back from email applications.

  POST /api/webhooks/resend                        Resend's webhook (signed with Svix; RESEND_INBOUND_SECRET)
       email.received   a company's reply to a candidate's apply address: stored, shown in the tracker ("Replied")
                        and forwarded to the candidate's own email (while the 2.0 switch is OFF only to testers)
       email.bounced    that address gets no Auto Apply email again
       email.complained that domain gets no Auto Apply email again, and the candidate's email channel is paused for
                        Admin to look at
  GET  /api/public/auto-apply/opt-out?t=           the employer's one-click opt-out link: which address / domain
  POST /api/public/auto-apply/opt-out {token, scope: domain | address}   no Auto Apply email from Nm7 again

Without RESEND_INBOUND_SECRET the webhook answers 404 and the email channel stays off (app/autoapply/emailing.py).
Every event is handled once (its Svix message id); a bad or old signature is refused. Nothing here opens or tracks
anything in the emails themselves.
"""

import base64
import hashlib
import hmac
import json
import logging
import re
import time
from email.utils import parseaddr
from html import unescape
from typing import Any, Literal

import httpx
from bson import ObjectId
from fastapi import APIRouter, Request
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.autoapply import emailing
from app.core.config import get_settings
from app.core.db import (
    AUTO_ITEMS,
    AUTO_MAIL,
    AUTO_MAIL_EVENTS,
    AUTO_REPLIES,
    DB,
    EMAIL_BLOCKS,
    USERS,
)
from app.core.email import Email, MailerDep, get_mailer, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.site import get_site

log = logging.getLogger("nm7.autoapply")

router = APIRouter(prefix="/api/webhooks", tags=["auto apply 2.0 email"])
public = APIRouter(prefix="/api/public/auto-apply", tags=["auto apply 2.0 email"])

TOLERANCE = 5 * 60  # seconds: an older signed event is refused (replays)
MAX_BODY = 2_000_000
MAX_TEXT = 20_000
HTTP_CLIENT = None  # tests put a mock transport here


def signature_ok(secret: str, headers: dict[str, str], body: bytes, at: float | None = None) -> bool:
    """Svix's signature (what Resend uses): base64(HMAC-SHA256(key, "<id>.<timestamp>.<body>")), key = the secret
    after "whsec_" (base64), in "v1,<signature>" entries separated by spaces; the timestamp within 5 minutes."""
    sid, ts, sig = headers.get("svix-id"), headers.get("svix-timestamp"), headers.get("svix-signature")
    if not secret or not sid or not ts or not sig:
        return False
    try:
        if abs((at or time.time()) - int(ts)) > TOLERANCE:
            return False
        key = base64.b64decode(secret.strip().removeprefix("whsec_"))
    except ValueError:
        return False
    expected = base64.b64encode(hmac.new(key, f"{sid}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    for part in sig.split():
        version, _, value = part.partition(",")
        if version == "v1" and hmac.compare_digest(value.encode(), expected.encode()):
            return True
    return False


def sign(secret: str, sid: str, ts: int, body: bytes) -> str:
    """The signature header value for a body (tests and local checks)."""
    key = base64.b64decode(secret.removeprefix("whsec_"))
    return "v1," + base64.b64encode(hmac.new(key, f"{sid}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()


@router.post("/resend")
async def resend_webhook(request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    secret = get_settings().resend_inbound_secret.strip()
    if not secret:
        raise ApiError(404, "not_found", "Not found.")
    body = await request.body()
    if len(body) > MAX_BODY:
        raise ApiError(413, "too_big", "Too big.")
    headers = {k.lower(): v for k, v in request.headers.items()}
    if not signature_ok(secret, headers, body):
        raise ApiError(401, "bad_signature", "Bad signature.")
    try:
        event = json.loads(body or b"{}")
    except ValueError:
        raise ApiError(400, "bad_json", "Bad JSON.") from None
    kind = str(event.get("type") or "")
    try:
        await db[AUTO_MAIL_EVENTS].insert_one({"_id": headers["svix-id"], "type": kind, "at": now()})
    except DuplicateKeyError:
        return {"ok": True, "duplicate": True}  # Resend retries: each event once
    data = event.get("data") or {}
    if kind == "email.received":
        return {"ok": True, **(await on_reply(db, data, mailer))}
    if kind == "email.bounced":
        return {"ok": True, "blocked": await on_bounce(db, data)}
    if kind == "email.complained":
        return {"ok": True, "blocked": await on_complaint(db, data)}
    return {"ok": True, "ignored": kind}


# ---------- bounces and complaints ----------


async def _mail_of(db, data: dict[str, Any]) -> dict[str, Any] | None:
    eid = data.get("email_id") or data.get("id")
    return await db[AUTO_MAIL].find_one({"provider_id": eid}) if eid else None


async def on_bounce(db, data: dict[str, Any]) -> str | None:
    """A bounce: no Auto Apply email to that address again (2.0 and today's)."""
    m = await _mail_of(db, data)
    if m:
        await db[AUTO_MAIL].update_one({"_id": m["_id"]}, {"$set": {"bounced_at": now()}})
        await emailing.block(db, m["sent_to"], "bounce", user_id=m["user_id"], job_id=m["job_id"])
        return m["sent_to"]
    it = await db[AUTO_ITEMS].find_one({"sent.provider_id": data.get("email_id") or "-"}, {"sent": 1})
    if it:  # today's Auto Apply email (Nm7's own address)
        await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"delivery": "bounced", "delivery_at": now()}})
        await emailing.block(db, it["sent"]["to"], "bounce")
        return it["sent"]["to"].lower()
    return None


async def on_complaint(db, data: dict[str, Any]) -> str | None:
    """A complaint ("this is spam"): that domain gets no Auto Apply email again (a free-mail domain: only that address),
    and the candidate's email channel is paused until Admin looks at it."""
    m = await _mail_of(db, data)
    if not m:
        it = await db[AUTO_ITEMS].find_one({"sent.provider_id": data.get("email_id") or "-"}, {"sent": 1})
        if not it:
            return None
        to = it["sent"]["to"].lower()
        key = to if emailing.domain_of(to) in emailing.FREE_MAIL else "@" + emailing.domain_of(to)
        await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"delivery": "complained", "delivery_at": now()}})
        await emailing.block(db, key, "complaint")
        return key
    t = now()
    to = m["sent_to"]
    key = to if emailing.domain_of(to) in emailing.FREE_MAIL else "@" + emailing.domain_of(to)
    await db[AUTO_MAIL].update_one({"_id": m["_id"]}, {"$set": {"complained_at": t}})
    await emailing.block(db, key, "complaint", user_id=m["user_id"], job_id=m["job_id"])
    await db[USERS].update_one(
        {"_id": m["user_id"]},
        {"$set": {"auto_apply.email_paused_at": t, "auto_apply.email_paused_reason": "complaint"}},
    )
    await audit(db, m["user_id"], "auto_apply.v2_email_complaint", target=m["job_id"], data={"blocked": key})
    return key


# ---------- replies ----------


def _plain(html: str) -> str:
    t = re.sub(r"(?is)<(script|style).*?</\1>", "", html or "")
    t = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    return re.sub(r"\n{3,}", "\n\n", unescape(t)).strip()


async def _body(data: dict[str, Any]) -> tuple[str, str]:
    """(text, subject): from the event, else from Resend's receiving API with the same key."""
    text = data.get("text") or _plain(data.get("html") or "")
    subject = data.get("subject") or ""
    eid = data.get("email_id")
    s = get_settings()
    if not text and eid and s.resend_api_key:
        url = f"{s.resend_url.rstrip('/')}/receiving/{eid}"
        try:
            async with httpx.AsyncClient(timeout=10, transport=HTTP_CLIENT) as client:
                r = await client.get(url, headers={"Authorization": f"Bearer {s.resend_api_key}"})
                r.raise_for_status()
                got = r.json() or {}
            text = got.get("text") or _plain(got.get("html") or "")
            subject = subject or got.get("subject") or ""
        except (httpx.HTTPError, ValueError):
            log.warning("auto apply email: could not fetch a received email's body")
    return str(text or "")[:MAX_TEXT], str(subject or "")[:300]


def _addresses(v: Any) -> list[str]:
    items = v if isinstance(v, list) else [v] if v else []
    out = []
    for x in items:
        if isinstance(x, dict):
            x = x.get("email") or x.get("address") or ""
        addr = parseaddr(str(x))[1].lower()
        if "@" in addr:
            out.append(addr)
    return out


async def _which_mail(db, uid: str, sender: str, subject: str) -> dict[str, Any] | None:
    """The application this reply answers: the newest email to the sender's domain (the company's or the test inbox's),
    else one whose job title is in the subject, else the newest."""
    dom = emailing.domain_of(sender)
    rows = await db[AUTO_MAIL].find({"user_id": uid, "kind": "first"}).sort("at", -1).to_list(200)
    for m in rows:
        if dom and (m["domain"] == dom or emailing.domain_of(m["sent_to"]) == dom):
            return m
    low = subject.lower()
    for m in rows:
        if (m.get("subject") or "").lower().split("–")[0].replace("application for", "").strip() in low:
            return m
    return rows[0] if rows else None


async def on_reply(db, data: dict[str, Any], mailer=None) -> dict[str, Any]:
    """A reply to a candidate's apply address: stored, the tracker says "Replied", forwarded to the candidate."""
    from app.autoapply import access

    domain = get_settings().autoapply_email_domain.strip().lower()
    alias = None
    for addr in _addresses(data.get("to")):
        alias = await emailing.user_of_address(db, addr)
        if alias:
            break
    if not alias:
        return {"stored": False, "reason": "unknown_address"}
    sender_name, sender = parseaddr(str(data.get("from") or ""))
    sender = sender.lower()
    if not sender or emailing.domain_of(sender) == domain:
        return {"stored": False, "reason": "own_domain"}  # never a loop between two apply addresses
    uid = alias["user_id"]
    u = await db[USERS].find_one(
        {"_id": uid}, {"name": 1, "email": 1, "email_lc": 1, "demo": 1, "role": 1, "disabled_at": 1}
    )
    if not u:
        return {"stored": False, "reason": "no_user"}
    text, subject = await _body(data)
    m = await _which_mail(db, uid, sender, subject)
    it = await db[AUTO_ITEMS].find_one({"_id": m["item_id"]}) if m else None
    t = now()
    doc = {
        "_id": str(ObjectId()),
        "user_id": uid,
        "alias": alias["_id"],
        "item_id": (it or {}).get("_id"),
        "job_id": (m or {}).get("job_id"),
        "mail_id": (m or {}).get("_id"),
        "company": (it or {}).get("company") or "",
        "title": (it or {}).get("title") or "",
        "from": sender,
        "from_name": sender_name[:120],
        "subject": subject,
        "text": text,
        "provider_id": data.get("email_id"),
        "received_at": t,
        "forwarded": False,
    }
    await db[AUTO_REPLIES].insert_one(doc)
    if m:
        await db[AUTO_MAIL].update_one({"_id": m["_id"], "replied_at": None}, {"$set": {"replied_at": t}})
    if it:
        notice = {"status": "replied", "text": f"{it.get('company') or 'The company'} replied by email.", "at": t,
                  "seen": False}  # fmt: skip
        await db[AUTO_ITEMS].update_one(
            {"_id": it["_id"]},
            {"$set": {"replied_at": t, "notice": notice, "updated_at": t}, "$inc": {"replies": 1}},
        )
    # forwarded to the candidate's own inbox, by the 2.0 email rule (while OFF: testers only; demo: never)
    v2 = (await get_site(db))["auto_apply_v2"]
    why = "ok"
    if u.get("disabled_at") or not u.get("email"):
        why = "no_inbox"
    elif not access.may_mail(u, v2):
        why = "switch_off"
    else:
        sent = await send_safely(mailer or get_mailer(), forward_email(u, doc, f"{alias['_id']}@{domain}"))
        why = "ok" if sent else "failed"
    await db[AUTO_REPLIES].update_one({"_id": doc["_id"]}, {"$set": {"forwarded": why == "ok", "forward": why}})
    return {"stored": True, "reply": doc["_id"], "item": doc["item_id"], "forwarded": why == "ok"}


def forward_email(u: dict[str, Any], r: dict[str, Any], apply_addr: str) -> Email:
    site = get_settings().site_url.rstrip("/")
    who = f"{r['from_name']} <{r['from']}>" if r["from_name"] else r["from"]
    about = f"{r['title']} at {r['company']}" if r["title"] else "one of your Auto Apply emails"
    lines = [
        f"A reply to your application for {about} came to your Nm7 apply address ({apply_addr}).",
        f"From: {who}",
        f"Subject: {r['subject']}",
        "",
        r["text"] or "(no text)",
        "",
        "--",
        f"Reply to this email to answer them directly. You can also see it in Nm7: {site}/me/auto-apply/v2",
    ]
    text = "\n".join(lines)
    from html import escape

    html = (
        '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">'
        + "".join(f"<p>{escape(x)}</p>" if x else "" for x in "\n".join(lines).split("\n"))
        + "</div>"
    )
    return Email(
        to=u["email"],
        to_name=u.get("name", ""),
        subject=f"Reply from {r['company'] or r['from']}: {r['subject']}"[:200],
        text=text,
        html=html,
        reply_to=r["from"],
    )


# ---------- the employer's one-click opt-out ----------


class OptOutIn(CamelModel):
    token: str
    scope: Literal["domain", "address"] = "domain"


def _read(token: str) -> dict[str, Any]:
    got = emailing.optout_read(token)
    if not got:
        raise ApiError(400, "bad_link", "This link isn't valid. Copy the whole link from the email.")
    return got


@public.get("/opt-out")
async def optout_info(t: str, db: DB) -> dict[str, Any]:
    got = _read(t)
    blocks = await db[EMAIL_BLOCKS].count_documents({"_id": {"$in": [got["address"], "@" + got["domain"]]}})
    return {**got, "blocked": bool(blocks)}


@public.post("/opt-out")
async def optout(body: OptOutIn, request: Request, db: DB) -> dict[str, Any]:
    """No Auto Apply email from Nm7 to this domain (the default) or only this address. A test email's link (sent while
    Auto Apply 2.0 is being tested) blocks nothing. Admin can see and undo the list."""
    from app.auth.sessions import client_ip

    got = _read(body.token)
    key = "@" + got["domain"] if body.scope == "domain" else got["address"]
    if got["test"]:
        return {**got, "scope": body.scope, "blocked": key, "test": True}
    other = got["address"] if body.scope == "domain" else "@" + got["domain"]
    # switching scope on the same page: the block this link made the other way goes
    await db[EMAIL_BLOCKS].delete_one({"_id": other, "reason": "opt_out", "via": "link"})
    await emailing.block(db, key, "opt_out", via="link", address=got["address"])
    await audit(db, None, "auto_apply.v2_opt_out", target=key, ip=client_ip(request))
    return {**got, "scope": body.scope, "blocked": key, "test": False}
