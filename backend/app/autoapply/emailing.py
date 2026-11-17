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

Auto Apply 2.0, phase A3 (the second half of this file) extends the same channel for people on 2.0:
- Only addresses the company published itself: a job the company posted on Nm7 from its own account, or an address
  with the link of the company's own posting / careers page it came from (`apply.email_source`), on the company's own
  domain. Never guessed, never from a job board, a form or a people page. The source is recorded with each email.
- From and Reply-To the candidate's own apply address (firstname.x7k2@apply.nm7.si), so replies come back to Nm7: they
  are stored, shown in the tracker ("Replied") and forwarded to the candidate (app/autoapply/inbound.py).
- The message: the cover note (5–6 lines, truth-checked), the tailored resume PDF, the candidate's Nm7 profile link, a
  plain line that Nm7 Auto Apply sent it on their behalf, and the employer's one-click opt-out link. No open tracking,
  no pixels, no tracked links.
- Limits: one email per job ever per candidate; one opt-in follow-up after 7 days when nobody replied; 10 a day per
  candidate; 20 a day per company domain (all candidates together).
- While the Auto Apply 2.0 switch is OFF a company address is never emailed: the email goes to Admin's test inbox or
  the tester's own inbox. Demo accounts never send real email.
- The channel is off without the Resend key or the webhook secret (RESEND_INBOUND_SECRET): email jobs are "Ready"
  for one tap instead.
"""

import base64
import logging
import re
import secrets
import unicodedata
from datetime import timedelta
from html import escape
from typing import Any
from urllib.parse import urlparse

import httpx
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.config import get_settings
from app.core.db import AUTO_ALIASES, AUTO_ITEMS, AUTO_MAIL, EMAIL_BLOCKS, SHARES, USERS
from app.core.email import Email, send_safely
from app.core.security import keyed_hash, same
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


# ======================================================================================================================
# Auto Apply 2.0, phase A3: email applications from the candidate's own apply address
# ======================================================================================================================

PER_CANDIDATE_DAY = 10  # Auto Apply 2.0 emails a day per candidate (first emails and follow-ups)
PER_DOMAIN_DAY = 20  # … per company domain, all candidates together
FOLLOW_AFTER = timedelta(days=7)
FOLLOW_UNTIL = timedelta(days=21)  # a first email older than this never gets a follow-up
FOLLOW_BATCH = 50
NO_REPLY_FROM = re.compile(r"^(no-?reply|mailer-daemon|postmaster)@", re.I)
FREE_MAIL = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "ymail.com", "outlook.com", "hotmail.com", "live.com",
    "msn.com", "rediffmail.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "zoho.com",
    "zohomail.in", "gmx.com", "mail.com",
}  # fmt: skip
# a page about people (a team page, a profile) is never where a company publishes how to apply
PEOPLE_PAGE = re.compile(r"/(people|person|team|our-team|leadership|management|staff|employees?|profiles?|in|pub|"
                         r"authors?|members?|directory|contact-person)(/|$)", re.I)  # fmt: skip
SECOND_LEVEL = {"co", "com", "org", "net", "ac", "gov", "edu", "res", "gen", "firm", "ind", "nic"}
ALIAS_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"
REASONS = {
    "no_resend_key": "Email sending isn't set up on the server yet.",
    "no_domain": "The apply address domain isn't set up yet.",
    "no_inbound_secret": "Replies can't come back to Nm7 yet, so the email channel is off.",
    "demo": "Demo accounts never send real email.",
    "candidate_off": "You turned the email channel off.",
    "candidate_paused": "Your email channel is paused for review.",
    "blocked": "This company asked not to get Auto Apply emails (or the address bounced).",
    "switch_off": "Auto Apply 2.0 is in testing: company addresses are never emailed yet.",
    "address_no_address": "The job has no apply email.",
    "address_source_unknown": "Nm7 doesn't know where the company published this address.",
    "address_job_board": "The address came from a job board, which Nm7 never uses.",
    "address_people_page": "The address came from a page about people, not from the company's job posting.",
    "address_free_mail": "Nm7 can't tell that this address belongs to the company.",
    "address_domain_mismatch": "The address isn't on the company's own domain.",
}


def channel_off() -> str | None:
    """Why the 2.0 email channel is off on this server (None = it is on)."""
    s = get_settings()
    if s.email_provider != "resend" or not s.resend_api_key:
        return "no_resend_key"
    if not s.autoapply_email_domain.strip():
        return "no_domain"
    if not s.resend_inbound_secret.strip():
        return "no_inbound_secret"
    return None


def _host(url: str) -> str:
    try:
        h = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return h.removeprefix("www.")


def base_domain(host: str) -> str:
    """acme.co.in → acme.co.in, careers.acme.com → acme.com (a simple registrable-domain guess, good for India)."""
    parts = [p for p in host.lower().strip(".").split(".") if p]
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in SECOND_LEVEL:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def domain_of(addr: str) -> str:
    return addr.rsplit("@", 1)[-1].lower() if "@" in addr else ""


def address_source(j: dict[str, Any]) -> dict[str, Any]:
    """Did the company publish this job's apply email itself? → {ok, kind, url, reason}. Never guessed: a job board,
    a form, a people page, a free-mail address from a page or an address off the company's domain are refused."""
    from app.jobs.collector import BOARDS, FORMS

    ap = j.get("apply") or {}
    email = str(ap.get("email") or "").strip().lower()
    out = {"ok": False, "kind": "", "url": "", "reason": ""}
    if not email or "@" not in email:
        return {**out, "reason": "no_address"}
    dom = domain_of(email)
    if any(b in dom for b in BOARDS):
        return {**out, "reason": "job_board"}
    if j.get("source") == "company" and j.get("company_id"):
        from app.jobs.apply import job_page

        return {**out, "ok": True, "kind": "company_account", "url": job_page(j)}  # the company's own Nm7 post
    src = str(ap.get("email_source") or "").strip()
    host = _host(src)
    if not src or not host:
        return {**out, "reason": "source_unknown"}
    if any(b in host for b in BOARDS) or any(f in src.lower() for f in FORMS):
        return {**out, "url": src, "reason": "job_board"}
    if PEOPLE_PAGE.search(urlparse(src).path or ""):
        return {**out, "url": src, "reason": "people_page"}
    if dom in FREE_MAIL:
        return {**out, "url": src, "reason": "free_mail"}
    site = _host((j.get("company") or {}).get("website") or "")
    if base_domain(dom) not in {base_domain(host), base_domain(site) if site else ""}:
        return {**out, "url": src, "reason": "domain_mismatch"}
    return {**out, "ok": True, "kind": "careers_page", "url": src}


# ---------- the candidate's apply address ----------


def _first_name(name: str) -> str:
    first = (name or "").strip().split(" ")[0] if (name or "").strip() else ""
    ascii_ = unicodedata.normalize("NFKD", first).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", ascii_)[:16] or "candidate"


async def apply_address(db, u: dict[str, Any]) -> str:
    """The candidate's own apply address (made once, kept): firstname.x7k2@apply.nm7.si."""
    domain = get_settings().autoapply_email_domain.strip().lower()
    got = await db[AUTO_ALIASES].find_one({"user_id": u["_id"]})
    if got:
        return f"{got['_id']}@{domain}"
    first = _first_name(u.get("name") or "")
    for _ in range(8):
        code = "".join(secrets.choice(ALIAS_CHARS) for _ in range(3)) + secrets.choice("23456789")
        local = f"{first}.{code}"
        try:
            await db[AUTO_ALIASES].insert_one({"_id": local, "user_id": u["_id"], "created_at": now()})
            return f"{local}@{domain}"
        except DuplicateKeyError:
            got = await db[AUTO_ALIASES].find_one({"user_id": u["_id"]})  # made at the same moment elsewhere
            if got:
                return f"{got['_id']}@{domain}"
    raise RuntimeError("could not make an apply address")


async def user_of_address(db, addr: str) -> dict[str, Any] | None:
    domain = get_settings().autoapply_email_domain.strip().lower()
    local, _, dom = addr.strip().lower().rpartition("@")
    if not local or dom != domain:
        return None
    return await db[AUTO_ALIASES].find_one({"_id": local})


async def profile_link(db, uid: str) -> str:
    s = await db[SHARES].find_one({"_id": uid, "on": True}, {"slug": 1})
    return f"{get_settings().site_url.rstrip('/')}/r/{s['slug']}" if s and s.get("slug") else ""


# ---------- the employer's one-click opt-out ----------


def _b64(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def _unb64(s: str) -> str:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)).decode()


def optout_token(address: str, test: bool = False) -> str:
    """A signed token for the opt-out link (HMAC with the app's secret key). A test email's token blocks nothing."""
    payload = _b64(f"{address.lower()}|{'t' if test else 'r'}")
    return f"{payload}.{keyed_hash('autoapply-optout', payload)[:32]}"


def optout_read(token: str) -> dict[str, Any] | None:
    payload, _, sig = (token or "").strip().rpartition(".")
    if not payload or not sig or not same(sig, keyed_hash("autoapply-optout", payload)[:32]):
        return None
    try:
        address, _, flag = _unb64(payload).rpartition("|")
    except (ValueError, UnicodeDecodeError):
        return None
    if "@" not in address:
        return None
    return {"address": address, "domain": domain_of(address), "test": flag == "t"}


def optout_url(token: str) -> str:
    return f"{get_settings().site_url.rstrip('/')}/stop-alerts#k=employer&t={token}"  # the fragment: not in logs


async def block(db, key: str, reason: str, **extra) -> None:
    """No Auto Apply email (today's or 2.0) to this address / "@domain" again (kept until Admin undoes it)."""
    await db[EMAIL_BLOCKS].update_one(
        {"_id": key.lower()}, {"$setOnInsert": {"reason": reason, "at": now(), **extra}}, upsert=True
    )


# ---------- limits ----------


async def limit_reason(db, uid: str, domain: str, day: str) -> str | None:
    if await db[AUTO_MAIL].count_documents({"user_id": uid, "day": day}) >= PER_CANDIDATE_DAY:
        return "candidate_daily"
    if await db[AUTO_MAIL].count_documents({"domain": domain, "day": day}) >= PER_DOMAIN_DAY:
        return "domain_daily"
    return None


def recipient(u: dict[str, Any], company_addr: str, v2: dict[str, Any]) -> tuple[str, bool] | None:
    """(who really gets it, is it a test). Public: the company. While the switch is OFF: Admin's test inbox, else the
    tester's own inbox. A company address is never the answer while OFF (None)."""
    company_addr = company_addr.lower()
    if v2.get("public"):
        return company_addr, False
    inbox = str(v2.get("test_inbox") or "").strip().lower() or str(u.get("email_lc") or u.get("email") or "").lower()
    if not inbox or inbox == company_addr:
        return None
    return inbox, True


async def ready_reason(db, u: dict[str, Any], j: dict[str, Any], site: dict[str, Any]) -> str | None:
    """Why this email job can't go by email for this candidate (None = it can): then it is "Ready" for one tap."""
    if why := channel_off():
        return why
    if u.get("demo") or j.get("demo"):
        return "demo"
    a = u.get("auto_apply") or {}
    if a.get("email_on") is False:
        return "candidate_off"
    if a.get("email_paused_at"):
        return "candidate_paused"
    src = address_source(j)
    if not src["ok"]:
        return f"address_{src['reason']}"
    to = (j.get("apply") or {}).get("email") or ""
    if await blocked(db, to):
        return "blocked"
    from app.autoapply import access

    v2 = site["auto_apply_v2"]
    if not v2.get("public") and (not access.may_mail(u, v2) or not recipient(u, to, v2)):
        return "switch_off"
    return None


# ---------- the message ----------


def _html(lines: list[str]) -> str:
    def para(x: str) -> str:
        t = escape(x)
        return re.sub(r"(https://[^\s<]+)", r'<a href="\1">\1</a>', t)  # the same plain links, never redirected

    return f'<div style="{STYLE}">' + "".join(f"<p>{para(x)}</p>" if x else "" for x in lines) + "</div>"


def footer(name: str, first: str, optout: str) -> list[str]:
    return [
        "--",
        f"Sent via Nm7 Auto Apply on {name}'s behalf: {first} chose to apply to this job, and replies to this email "
        f"go to {first}.",
        f"Don't want Auto Apply emails from Nm7? One click and you won't get them again: {optout}",
    ]


def application_letter(
    name: str, company: str, title: str, cover: list[str], profile: str, optout: str
) -> tuple[str, str, str]:
    """(subject, text, html): the cover note, the resume attached, the profile link, the honest footer."""
    first = name.split(" ")[0] if name else name
    lines = [
        f"Dear Hiring Team at {company}," if company else "Dear Hiring Team,",
        "",
        *[x for x in cover if x.strip()][:6],
        "",
        f"My resume, tailored for the {title} role, is attached." + (f" My Nm7 profile: {profile}" if profile else ""),
        "",
        "Kind regards,",
        name,
        "",
        *footer(name, first, optout),
    ]
    return f"Application for {title} – {name}", "\n".join(lines), _html(lines)


def follow_up_letter(name: str, company: str, title: str, profile: str, optout: str) -> tuple[str, str, str]:
    first = name.split(" ")[0] if name else name
    lines = [
        f"Dear Hiring Team at {company}," if company else "Dear Hiring Team,",
        "",
        f"I applied for the {title} role a week ago and wanted to check whether you had a chance to look at my "
        "application. I am still interested.",
        "My resume is attached to my first email." + (f" My Nm7 profile: {profile}" if profile else ""),
        "",
        "Kind regards,",
        name,
        "",
        *footer(name, first, optout),
    ]
    return f"Following up: {title} – {name}", "\n".join(lines), _html(lines)


# ---------- sending ----------


async def _send_one(
    db, mailer, *, u, j, item_id, kind, to, test, subject, text, html, attachments, source
) -> dict[str, Any] | None:
    """One 2.0 email from the candidate's apply address, logged in auto_mail (the unique index: once per kind)."""
    name = (u.get("name") or "").strip() or "A candidate"
    sender = await apply_address(db, u)
    company_addr = (j.get("apply") or {}).get("email", "").lower()
    t = now()
    from app.autoapply.engine import today

    log_doc = {
        "_id": str(ObjectId()),
        "user_id": u["_id"],
        "item_id": item_id,
        "job_id": j["_id"],
        "kind": kind,
        "to": company_addr,
        "sent_to": to,
        "test": test,
        "domain": domain_of(company_addr),
        "from": sender,
        "subject": subject,
        "day": today(t),
        "at": t,
        "source": source,
        "provider_id": None,
    }
    try:
        await db[AUTO_MAIL].insert_one(log_doc)  # claims the slot first: never twice, even from two passes at once
    except DuplicateKeyError:
        return None
    optout = optout_url(optout_token(company_addr, test))
    msg = Email(
        to=to,
        to_name=(j.get("company") or {}).get("name", ""),
        subject=(f"[Test: would go to {company_addr}] " if test else "") + subject,
        text=text,
        html=html,
        reply_to=sender,
        from_addr=f"{name.replace('"', '').replace('<', '').replace('>', '')} via Nm7 <{sender}>",
        headers={"List-Unsubscribe": f"<{optout}>"},
        attachments=attachments,
    )
    if not await send_safely(mailer, msg):
        await db[AUTO_MAIL].delete_one({"_id": log_doc["_id"]})  # not sent: the slot is free again
        return None
    await db[AUTO_MAIL].update_one({"_id": log_doc["_id"]}, {"$set": {"provider_id": msg.provider_id}})
    return {
        "to": company_addr,
        "sent_to": to,
        "test": test,
        "from": sender,
        "subject": msg.subject,
        "text": text,
        "at": t,
        "provider_id": msg.provider_id,
        "mail_id": log_doc["_id"],
        "source": source,
    }


async def send_v2(db, mailer, item: dict[str, Any], j: dict[str, Any], u: dict[str, Any], copy: dict[str, Any],
                  site: dict[str, Any]) -> dict[str, Any]:  # fmt: skip
    """The 2.0 email for one job. → the item's new fields: sent (with what was sent), queued (a limit: the next run),
    ready (no email channel for this one: one tap by the candidate) or skipped (already emailed)."""
    from app.autoapply import pdf
    from app.autoapply.engine import today

    to_company = (j.get("apply") or {}).get("email") or ""
    if why := await ready_reason(db, u, j, site):
        return {"state": "ready", "reason": why, "apply_to": to_company, "ready_day": today()}
    if await db[AUTO_MAIL].find_one({"user_id": u["_id"], "job_id": j["_id"], "kind": "first"}, {"_id": 1}):
        return {"state": "skipped", "reason": "already_emailed"}
    day = today()
    if await sent_today(db, day) >= int(site["auto_apply"]["email_daily_cap"]):
        return {"state": "queued", "reason": "email_cap"}  # the site's daily cap (the Resend plan): the next run
    if lim := await limit_reason(db, u["_id"], domain_of(to_company), day):
        return {"state": "queued", "reason": lim}
    v2 = site["auto_apply_v2"]
    to, test = recipient(u, to_company, v2) or ("", False)
    if not to or (not v2.get("public") and to == to_company.lower()):
        return {"state": "ready", "reason": "switch_off", "apply_to": to_company, "ready_day": day}
    src = address_source(j)
    data = copy.get("data") or {}
    name = (u.get("name") or "").strip() or (data.get("personal") or {}).get("name") or "A candidate"
    profile = await profile_link(db, u["_id"])
    optout = optout_url(optout_token(to_company, test))
    subject, text, html = application_letter(
        name, (j.get("company") or {}).get("name", ""), j["title"], copy.get("cover_note") or [], profile, optout
    )
    attachment = pdf.file_name(data)
    sent = await _send_one(
        db, mailer, u={**u, "name": name}, j=j, item_id=item["_id"], kind="first", to=to, test=test, subject=subject,
        text=text, html=html, attachments=[(attachment, "application/pdf", pdf.render(data))],
        source={"kind": src["kind"], "url": src["url"]},
    )  # fmt: skip
    if not sent:
        return {"state": "queued", "reason": "email_failed"}
    sent["attachment"] = attachment
    return {"state": "sent", "sent": sent, "sent_day": day, "applied_at": sent["at"]}


async def follow_ups(db, mailer, site: dict[str, Any], limit: int = FOLLOW_BATCH) -> int:
    """One follow-up, 7 days after the first email, for candidates who opted in, only when nobody replied, within the
    same limits and blocks, to the same inbox (a test email's follow-up is a test too). Returns how many went out."""
    from app.autoapply import access
    from app.autoapply.engine import today
    from app.core.db import APPLICATIONS, JOBS

    if channel_off():
        return 0
    t = now()
    v2 = site["auto_apply_v2"]
    rows = (
        await db[AUTO_MAIL]
        .find(
            {
                "kind": "first",
                "at": {"$lte": t - FOLLOW_AFTER, "$gte": t - FOLLOW_UNTIL},
                "follow_up": None,
                "replied_at": None,
                "bounced_at": None,
                "complained_at": None,
            }
        )
        .limit(limit)
        .to_list(None)
    )
    n = 0
    for m in rows:

        async def mark(what: str, _m=m) -> None:
            await db[AUTO_MAIL].update_one({"_id": _m["_id"]}, {"$set": {"follow_up": what}})

        u = await db[USERS].find_one(
            {"_id": m["user_id"]}, {"name": 1, "email": 1, "email_lc": 1, "demo": 1, "role": 1, "auto_apply": 1}
        )
        a = (u or {}).get("auto_apply") or {}
        if not u or not a.get("email_follow_up"):
            continue  # not opted in (yet): looked at again next pass while the 21 days last
        if u.get("demo") or a.get("email_on") is False or a.get("email_paused_at") or not a.get("v2_consent_at"):
            await mark("skipped")
            continue
        app = await db[APPLICATIONS].find_one({"user_id": u["_id"], "job_id": m["job_id"]}, {"status": 1})
        j = await db[JOBS].find_one({"_id": m["job_id"]})
        if not app or app.get("status") not in ("applied", "viewed") or not j or j.get("status") != "active":
            await mark("skipped")
            continue
        if await blocked(db, m["to"]) or await blocked(db, m["sent_to"]):
            await mark("skipped")
            continue
        # the same inbox as the first email, under today's switch: a company is never emailed while OFF
        if bool(m.get("test")) == bool(v2.get("public")) or (not v2.get("public") and not access.may_mail(u, v2)):
            await mark("skipped")
            continue
        if await limit_reason(db, u["_id"], m["domain"], today(t)):
            continue  # today's limits: tomorrow
        name = (u.get("name") or "").strip() or "A candidate"
        optout = optout_url(optout_token(m["to"], bool(m.get("test"))))
        subject, text, html = follow_up_letter(
            name, (j.get("company") or {}).get("name", ""), j["title"], await profile_link(db, u["_id"]), optout
        )
        sent = await _send_one(
            db, mailer, u=u, j=j, item_id=m["item_id"], kind="follow_up", to=m["sent_to"], test=bool(m.get("test")),
            subject=subject, text=text, html=html, attachments=[], source=m.get("source") or {},
        )  # fmt: skip
        if sent:
            n += 1
            await mark("sent")
            await db[AUTO_ITEMS].update_one({"_id": m["item_id"]}, {"$set": {"follow_up": sent}})
        else:
            existing = await db[AUTO_MAIL].find_one({"user_id": u["_id"], "job_id": m["job_id"], "kind": "follow_up"})
            if existing:
                await mark("sent")
    return n
