# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T11: one-tap interview booking, reminders and joining-day confirmations.

When a company wants to interview someone (they accepted a Hire invite, the company moved their application to
Shortlisted / Interview, or the T5 calling agent made their application) and the job has free interview times
(Hire → Interview times), Nm7 sends the person a signed one-tap link on WhatsApp (T5's provider, only with the
"calls_whatsapp" consent, WhatsApp on, not opted out, outside quiet hours and quiet days, within a daily cap) and by
email. The link opens a page with the free times: one tap books (no sign-in). The same link moves or cancels the
booking until `change_hours` (2) before it starts, and after that tells the company "I can't make it". It is scoped to
that person and that job, makes one booking at a time (a second tap moves it, two taps at once can't book two times),
and expires after `link_days` (14).

Reminders: the evening before (`eve_at`, 7 PM IST) and `soon_hours` (2) before, by WhatsApp (the same rules: a quiet-
hours message waits, and is dropped once it would be too late) and by email, with the place and a map link or the
online link, and the link to move or cancel. People this flow is for no longer get the old H5 reminders (1 day / 1 hour
before) or the old "joining tomorrow" check-in: one set of reminders, never two.

Joining day (an accepted Hire offer): the evening before "See you tomorrow at <time> at <place>" with Yes / Need to
reschedule; the morning of (`morning_at`) "Good luck today" with directions; at `checkin_at` "Did you join?" with a
one-tap "I've joined" (and the T3 joining-day selfie when it is set up and not done yet). The company gets a one-tap
"Joined / Didn't join" email at `company_at`. Every answer is stored in `trust_join_events` (for T15's reliability) and
goes through the existing H6 "Joined" rules (so H4 reliability is unchanged).

Behind the Vetting Trust switch: the flow is used only where T5's pairing rule allows (while the switch is OFF: a
tester or admin with a test company; demo accounts with the demo company), and background email goes only to testers
while it is OFF (mail_filter). Everyone else keeps today's Hire flows exactly.

Stored (additive): trust_book_links (the links: who, which job / offer, the expiry, the current booking; never a token,
only its parts are signed), trust_join_events, slot.t11 / offer.t11 flags (what was sent when), offer.t11_join (the
company's reporting time, place and map link), events in trust_agent_events (kind t11_*; counts and the company's live
view; never message text).
"""

import logging
import re
import time as _time
from datetime import date, datetime, time, timedelta
from html import escape
from typing import Any
from urllib.parse import quote_plus

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.core.config import get_settings
from app.core.db import (
    APPLICATIONS,
    COMPANIES,
    HIRE_OFFERS,
    HIRE_SLOTS,
    JOBS,
    TRUST_AGENT_CONVOS,
    TRUST_AGENT_EVENTS,
    TRUST_BOOK_LINKS,
    TRUST_FACE,
    TRUST_JOIN_EVENTS,
    USERS,
)
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.security import keyed_hash, same
from app.core.time import IST, ist_day, now
from app.me.service import ms
from app.trust import retention as R
from app.trust.agent import providers as P
from app.trust.agent import service as A
from app.trust.booking import texts as TX

log = logging.getLogger("nm7.trust.booking")

DEFAULTS: dict[str, Any] = {
    "on": True, "link_days": 14, "change_hours": 2, "eve_at": "19:00", "soon_hours": 2, "morning_at": "09:00",
    "checkin_at": "13:00", "company_at": "17:00", "per_person_day": 4, "approved": {"en": False, "hi": False, "te": False},
}  # fmt: skip
LETTER = {"interview": "b", "join": "j", "company_join": "c"}
KIND_OF = {v: k for k, v in LETTER.items()}
LOOKBACK = timedelta(days=14)  # applications moved to Shortlisted / Interview this recently get a link
PAIRS_PER_PASS = 100
SCAN_PER_SOURCE = 400
REMIND_PER_PASS = 300
WA_RETRY = timedelta(hours=48)  # an invite that waited for quiet hours / the cap is tried this long
TRANSIENT = {"quiet_hours", "quiet_day", "daily_cap", "send_failed"}
FACE_LINK = "/me/hire#offers"

R.register(R.DataType("book_links", "One-tap interview and joining-day links (who, which job, when it expires; no message text)", 120, 30, 365,
                      TRUST_BOOK_LINKS, note="Deleted by the daily job; a link stops working when it expires"))  # fmt: skip
R.register(R.DataType("join_events", "Joining-day answers (still coming, reschedule, joined, didn’t join)", 730, 365, 1095,
                      TRUST_JOIN_EVENTS, field="at", note="Kept for the reliability score; deleted by the daily job"))  # fmt: skip


# --- settings and who it is for ------------------------------------------------------------------------------------------


def booking_settings(site: dict[str, Any]) -> dict[str, Any]:
    st = (site.get("trust") or {}).get("booking") or {}
    return {**DEFAULTS, **st, "approved": {**DEFAULTS["approved"], **(st.get("approved") or {})}}


def takes_over(site: dict[str, Any], u: dict[str, Any] | None, c: dict[str, Any] | None) -> bool:
    """Is this person × company on the new flow? (T5's pairing rule; OFF → today's Hire flows exactly.)"""
    return bool(booking_settings(site)["on"]) and A.pair_ok(u, c, site)


async def _uc(db, uid: str, cid: str | None) -> tuple[dict | None, dict | None]:
    u = await db[USERS].find_one({"_id": uid}, A.USER_FIELDS)
    c = await db[COMPANIES].find_one({"_id": cid}, {"members": 1, "demo": 1, "details": 1}) if cid else None
    return u, c


async def handled(db, site: dict[str, Any], uid: str | None, cid: str | None) -> bool:
    """For the old reminder passes: True when T11 sends this person's reminders instead (so nobody gets two)."""
    if not uid or not cid or not booking_settings(site)["on"]:
        return False
    tr = site.get("trust") or {}
    if not tr.get("public") and not tr.get("testers"):
        u = await db[USERS].find_one({"_id": uid}, {"demo": 1, "role": 1})
        if not u or not (u.get("demo") or u.get("role") == "admin"):
            return False  # the common case while the switch is OFF: one small read, no change
    u, c = await _uc(db, uid, cid)
    return takes_over(site, u, c)


# --- the signed links ----------------------------------------------------------------------------------------------------


def _sig(letter: str, lid: str, exp: int) -> str:
    return keyed_hash("trust-t11-link", letter, lid, str(exp))[:32]


def token_for(link: dict[str, Any]) -> str:
    letter = LETTER[link["kind"]]
    exp = int(link["expires_at"].timestamp())
    return f"{letter}.{link['_id']}.{exp}.{_sig(letter, link['_id'], exp)}"


def url_for(link: dict[str, Any]) -> str:
    """The token rides in the address fragment, so it never reaches server logs."""
    k = {"interview": "book", "join": "join", "company_join": "cjoin"}[link["kind"]]
    return f"{get_settings().site_url.rstrip('/')}/stop-alerts#k={k}&t={token_for(link)}"


def read_token(token: str, at: float | None = None) -> tuple[str, str] | None:
    """(kind, link id) when the signature is right and the link hasn't expired; None otherwise."""
    parts = (token or "").split(".")
    if (
        len(parts) != 4
        or parts[0] not in KIND_OF
        or not parts[2].isdigit()
        or not re.fullmatch(r"[0-9a-f]{24}", parts[1])
    ):
        return None
    letter, lid, exp, sig = parts
    if not same(sig, _sig(letter, lid, int(exp))) or int(exp) < (at or _time.time()):
        return None
    return KIND_OF[letter], lid


async def link_for(db, kind: str, *, user_id: str, company_id: str, job_id: str = "", offer_id: str = "", source: str,
                   until: datetime) -> dict[str, Any]:  # fmt: skip
    """The one link for this person × job (or offer, or company × offer); a later message extends its expiry."""
    key = f"{kind}:{company_id if kind == 'company_join' else user_id}:{job_id or offer_id}"
    t = now()
    for _ in range(2):
        try:
            return await db[TRUST_BOOK_LINKS].find_one_and_update(
                {"key": key},
                {"$max": {"expires_at": until}, "$set": {"updated_at": t},
                 "$setOnInsert": {"_id": str(ObjectId()), "kind": kind, "user_id": user_id, "company_id": company_id, "job_id": job_id,
                                  "offer_id": offer_id, "source": source, "seq": 0, "bookings": 0, "created_at": t}},
                upsert=True, return_document=ReturnDocument.AFTER,
            )  # fmt: skip
        except DuplicateKeyError:  # two passes at once: the other one made it
            continue
    return await db[TRUST_BOOK_LINKS].find_one({"key": key})


async def open_link(db, token: str, kind: str) -> dict[str, Any]:
    got = read_token(token)
    if not got or got[0] != kind:
        raise ApiError(
            404, "invalid_link", "This link has expired or isn’t complete. Ask for a new one, or sign in to Nm7."
        )
    link = await db[TRUST_BOOK_LINKS].find_one({"_id": got[1]})
    if not link or link["expires_at"] < now() or link.get("revoked_at"):
        raise ApiError(
            404, "invalid_link", "This link has expired or isn’t complete. Ask for a new one, or sign in to Nm7."
        )
    return link


# --- sending -------------------------------------------------------------------------------------------------------------


def _testers(site: dict[str, Any]) -> set[str]:
    return {str(e).lower() for e in (site.get("trust") or {}).get("testers") or []}


def mail_ok(site: dict[str, Any], email: str | None, *, demo: bool = False) -> bool:
    """Background email: anyone once the switch is public; only the testers while it is OFF (never demo accounts)."""
    if demo or not email:
        return False
    return bool((site.get("trust") or {}).get("public")) or email.lower() in _testers(site)


def _html(text: str) -> str:
    body = escape(text).replace("\n", "<br>")
    body = re.sub(r"(https://[^\s<]+)", r'<a href="\1">\1</a>', body)
    return f'<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"><p>{body}</p><p>Nm7 · nm7.si</p></div>'


async def _mail(db, mailer: Mailer | None, site: dict[str, Any], to: str, name: str, subject: str, text: str,
                uid: str | None, what: str, *, demo: bool = False, background: bool = True) -> str:  # fmt: skip
    if mailer is None:
        return "no_mailer"
    if background and not mail_ok(site, to, demo=demo):
        return "not_allowed"
    if demo or not to:
        return "not_allowed"
    ok = await send_safely(
        mailer, Email(to=to, to_name=name, subject=subject, text=text + "\n\nNm7 · nm7.si", html=_html(text))
    )
    if ok:
        await A.event(db, "t11_email", uid or "", None, what=what)
    return "sent" if ok else "send_failed"


async def _wa(db, site: dict[str, Any], u: dict[str, Any], kind: str, params: list[str], t: datetime) -> str:
    """One T11 WhatsApp template → "sent", or why not (quiet_hours / quiet_day / daily_cap / send_failed mean later)."""
    st = booking_settings(site)
    p = await A.prefs(db, u)
    why = await A.blocker(db, u, p, "whatsapp", t, A.agent_settings(site), site, new_contact=False)
    if why:
        return why
    n = await db[TRUST_AGENT_EVENTS].count_documents({"user_id": u["_id"], "day": ist_day(t), "kind": "t11_wa"})
    if n >= int(st["per_person_day"]):
        return "daily_cap"
    wa = A.whatsapp_for(site, u)
    if wa is None:
        return "no_provider"
    if not wa.test and not st["approved"].get(p["lang"]):
        return "not_approved"
    try:
        await wa.send_template(p["wa_id"], p["lang"], [x[:200] for x in params], [], name=TX.NAMES[kind])
    except P.SendError:
        log.warning("t11: a WhatsApp message failed")
        return "send_failed"
    await A.event(db, "t11_wa", u["_id"], None, t, what=kind)
    return "sent"


async def _lang(db, u: dict[str, Any]) -> str:
    return (await A.prefs(db, u))["lang"]


# --- small formatting ----------------------------------------------------------------------------------------------------


def maps_url(place: str) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={quote_plus(place)}" if place else ""


def when_text(at: datetime) -> str:
    return at.astimezone(IST).strftime("%a %-d %b, %-I:%M %p")


def _hm(s: str) -> time:
    h, m = (int(x) for x in str(s).split(":"))
    return time(h, m)


def _time12(hhmm: str) -> str:
    return datetime.combine(date(2026, 1, 1), _hm(hhmm)).strftime("%-I:%M %p") if hhmm else ""


def where_text(lang: str, s: dict[str, Any]) -> str:
    bits = []
    if s.get("place"):
        bits.append(TX.bit(lang, "where", place=s["place"], map=maps_url(s["place"])))
    if s.get("link"):
        bits.append(TX.bit(lang, "online", link=s["link"]))
    return " · ".join(bits) or "-"


async def _names(db, company_id: str, job_id: str) -> tuple[str, str]:
    c = await db[COMPANIES].find_one({"_id": company_id}, {"details.legal_name": 1})
    j = await db[JOBS].find_one({"_id": job_id}, {"title": 1, "company.name": 1}) or {}
    return ((c or {}).get("details") or {}).get("legal_name") or (j.get("company") or {}).get(
        "name"
    ) or "The company", j.get("title", "")


def slot_view(s: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(s["_id"]), "at": ms(s["starts_at"]), "minutes": s["minutes"], "place": s.get("place", ""), "map": maps_url(s.get("place", "")),
            "link": s.get("link", ""), "round": s.get("round", ""), "interviewer": s.get("interviewer", "")}  # fmt: skip


async def event(db, kind: str, uid: str, job_id: str | None, company_id: str | None, **data: Any) -> None:
    await A.event(db, kind, uid, None, job_id=job_id, company_id=company_id, **data)


# --- the interview link: the page and its actions ------------------------------------------------------------------------


async def _may(db, link: dict[str, Any]) -> bool:
    from app.hire.slots import may_book

    if await may_book(db, link["user_id"], link["job_id"]):
        return True
    return bool(await db[TRUST_AGENT_CONVOS].find_one(
        {"user_id": link["user_id"], "job_id": link["job_id"], "state": {"$in": ["booked", "applied", "not_fit"]}}, {"_id": 1}))  # fmt: skip


async def _check_scope(db, link: dict[str, Any]) -> tuple[dict, dict]:
    from app.site import get_site

    site = await get_site(db)
    u, c = await _uc(db, link["user_id"], link["company_id"])
    if not u or u.get("disabled_at") or u.get("deleted_at") or not takes_over(site, u, c):
        raise ApiError(
            404, "invalid_link", "This link has expired or isn’t complete. Ask for a new one, or sign in to Nm7."
        )
    return site, u


async def _mine(db, link: dict[str, Any]) -> dict[str, Any] | None:
    return await db[HIRE_SLOTS].find_one({"job_id": link["job_id"], "user_id": link["user_id"], "status": "booked"})


async def interview_view(db, link: dict[str, Any], t: datetime | None = None) -> dict[str, Any]:
    site, u = await _check_scope(db, link)
    st = booking_settings(site)
    t = t or now()
    ch = timedelta(hours=int(st["change_hours"]))
    company, role = await _names(db, link["company_id"], link["job_id"])
    mine = await _mine(db, link)
    allowed = await _may(db, link)
    j = await db[JOBS].find_one({"_id": link["job_id"]}, {"status": 1}) or {}
    free = []
    if allowed and j.get("status") == "active":
        free = (
            await db[HIRE_SLOTS]
            .find({"job_id": link["job_id"], "status": "open", "user_id": None, "starts_at": {"$gt": t + ch}})
            .sort("starts_at", 1)
            .to_list(30)
        )
    out = {"kind": "interview", "first": A._first(u), "company": company, "role": role, "lang": await _lang(db, u), "allowed": allowed,
           "open": [slot_view(s) for s in free], "mine": None, "changeHours": int(st["change_hours"]), "expiresAt": ms(link["expires_at"])}  # fmt: skip
    if mine:
        out["mine"] = {**slot_view(mine), "canChange": mine["starts_at"] > t + ch, "changeUntil": ms(mine["starts_at"] - ch),
                       "cantSent": bool(mine.get("cant_make_it")), "past": mine["starts_at"] <= t}  # fmt: skip
    return out


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That time isn’t open any more. Pick another.") from None


async def _free(db, s: dict[str, Any], t: datetime) -> None:
    await db[HIRE_SLOTS].update_one({"_id": s["_id"]}, {"$set": {"status": "open", "user_id": None, "updated_at": t},
                                                        "$unset": {"t11": "", "t11_flow": "", "cant_make_it": "", "reminded_day": "", "reminded_hour": ""},
                                                        "$inc": {"seq": 1}})  # fmt: skip


async def pick(db, link: dict[str, Any], slot_id: str, reason: str, mailer: Mailer | None) -> dict[str, Any]:
    """One tap books; on a link that already has a booking it moves it (until change_hours before). Atomic: two people
    can't take one time, and two taps on one link can't book two times."""
    from app.hire import slots as H

    site, u = await _check_scope(db, link)
    st = booking_settings(site)
    t = now()
    ch = timedelta(hours=int(st["change_hours"]))
    if not await _may(db, link):
        raise ApiError(409, "closed", "The company is no longer inviting interviews for this job.")
    j = await db[JOBS].find_one({"_id": link["job_id"]}, {"status": 1}) or {}
    if j.get("status") != "active":
        raise ApiError(409, "closed", "This job is no longer open.")
    s = await db[HIRE_SLOTS].find_one({"_id": _oid(slot_id), "job_id": link["job_id"]})
    if not s:
        raise ApiError(404, "not_found", "That time isn’t open any more. Pick another.")
    mine = await _mine(db, link)
    if mine and mine["_id"] == s["_id"]:
        return await interview_view(db, link, t)
    if mine and mine["starts_at"] <= t + ch:
        raise ApiError(
            409,
            "too_late",
            f"Your interview is less than {st['change_hours']} hours away, so it can’t be moved here. Tap “I can’t make it” to tell the company.",
        )
    if s["starts_at"] <= t + ch:
        raise ApiError(409, "too_soon", "That time is too soon. Pick another.")
    seq = int(link.get("seq") or 0)
    got = await db[HIRE_SLOTS].find_one_and_update(
        {"_id": s["_id"], "status": "open", "user_id": None, "starts_at": {"$gt": t + ch}},
        {"$set": {"status": "booked", "user_id": u["_id"], "booked_at": t, "updated_at": t, "via": "trust_link", "t11_flow": True}, "$inc": {"seq": 1}},
        return_document=ReturnDocument.AFTER,
    )  # fmt: skip
    if not got:
        raise ApiError(409, "taken", "Someone just took that time. Pick another.")
    held = await db[TRUST_BOOK_LINKS].update_one({"_id": link["_id"], "seq": seq},
                                                 {"$set": {"slot_id": str(got["_id"]), "updated_at": t}, "$inc": {"seq": 1, "bookings": 1}})  # fmt: skip
    if not held.modified_count:  # another tap on the same link got there first: give this time back
        await _free(db, got, t)
        raise ApiError(409, "busy", "Your other tap is being handled. Refresh the page.")
    if mine:
        await _free(db, mine, t)
    await H._set_interview(db, got, u["_id"])
    why = reason.strip() or ("Moved with the one-tap link" if mine else "")
    if mailer is not None:
        await H.notify(db, mailer, got, "moved" if mine else "booked", why)
    await event(
        db,
        "t11_moved" if mine else "t11_booked",
        u["_id"],
        link["job_id"],
        link["company_id"],
        slot=str(got["_id"]),
        reason=why[:300],
    )
    await audit(
        db,
        u["_id"],
        "hire.slot_book",
        target=got["company_id"],
        data={"slot": str(got["_id"]), "moved": bool(mine), "via": "trust_link"},
    )
    return await interview_view(db, link, t)


async def cancel(db, link: dict[str, Any], reason: str, mailer: Mailer | None) -> dict[str, Any]:
    from app.hire import slots as H

    site, u = await _check_scope(db, link)
    st = booking_settings(site)
    t = now()
    mine = await _mine(db, link)
    if not mine:
        raise ApiError(404, "not_found", "You have no booking for this interview.")
    if mine["starts_at"] <= t + timedelta(hours=int(st["change_hours"])):
        raise ApiError(
            409,
            "too_late",
            f"Your interview is less than {st['change_hours']} hours away, so it can’t be cancelled here. Tap “I can’t make it” to tell the company.",
        )
    if len(reason.strip()) < 3:
        raise ApiError(400, "reason", "Say why, so the company knows.")
    await _free(db, mine, t)
    await db[TRUST_BOOK_LINKS].update_one(
        {"_id": link["_id"]}, {"$set": {"slot_id": None, "updated_at": t}, "$inc": {"seq": 1}}
    )
    await H._set_interview(db, mine, u["_id"], clear=True)
    if mailer is not None:
        await H.notify(db, mailer, {**mine, "seq": int(mine.get("seq", 0)) + 1}, "cancelled", reason.strip())
    await event(
        db,
        "t11_cancelled",
        u["_id"],
        link["job_id"],
        link["company_id"],
        slot=str(mine["_id"]),
        reason=reason.strip()[:300],
    )
    await audit(
        db,
        u["_id"],
        "hire.slot_cancel",
        target=mine["company_id"],
        data={"slot": str(mine["_id"]), "via": "trust_link"},
    )
    return await interview_view(db, link, t)


async def cant_make_it(db, link: dict[str, Any], reason: str, mailer: Mailer | None) -> dict[str, Any]:
    """Too late to move it here: tell the company (the time stays booked; the company decides)."""
    site, u = await _check_scope(db, link)
    t = now()
    mine = await _mine(db, link)
    if not mine or mine["starts_at"] <= t - timedelta(hours=1):
        raise ApiError(404, "not_found", "You have no booking for this interview.")
    if len(reason.strip()) < 3:
        raise ApiError(400, "reason", "Say why, so the company knows.")
    if mine.get("cant_make_it"):
        return await interview_view(db, link, t)
    await db[HIRE_SLOTS].update_one(
        {"_id": mine["_id"]}, {"$set": {"cant_make_it": {"at": t, "reason": reason.strip()[:300]}, "updated_at": t}}
    )
    company, role = await _names(db, link["company_id"], link["job_id"])
    if mine.get("by"):
        text = (f"{u.get('name') or 'The candidate'} says they can’t make it to the interview for {role} on {when_text(mine['starts_at'])} IST.\n"
                f"Reason: {reason.strip()}\n\nThe time is still booked: cancel it or agree a new time with them on Nm7 (Hire → Interview times).")  # fmt: skip
        await _mail(
            db,
            mailer,
            site,
            mine["by"],
            "",
            f"Can’t make it: {u.get('name') or 'a candidate'} · {role}",
            text,
            u["_id"],
            "cant",
            background=False,
        )
    await event(
        db, "t11_cant", u["_id"], link["job_id"], link["company_id"], slot=str(mine["_id"]), reason=reason.strip()[:300]
    )
    return await interview_view(db, link, t)


# --- the joining-day links -------------------------------------------------------------------------------------------------


def join_details(o: dict[str, Any]) -> dict[str, str]:
    j = o.get("t11_join") or {}
    place = j.get("place") or o.get("place") or ""
    return {"time": j.get("time") or "", "place": place, "map": j.get("map") or maps_url(place)}


async def face_needed(db, site: dict[str, Any], u: dict[str, Any], o: dict[str, Any]) -> bool:
    """T3's joining-day selfie: set up (a provider for this person) and not confirmed yet for this offer."""
    from app.trust.face import service as F

    if await F.provider_for(db, u, site, _testers(site)) is None:
        return False
    st = await db[TRUST_FACE].find_one({"_id": u["_id"]}, {"continuity": 1, "verified_at": 1}) or {}
    if not st.get("verified_at"):
        return False  # no ID + selfie on file to compare with
    c = st.get("continuity") or {}
    return not (c.get("offer_id") == str(o["_id"]) and c.get("status") == "same")


async def join_event(db, o: dict[str, Any], side: str, kind: str, via: str, reason: str = "") -> None:
    await db[TRUST_JOIN_EVENTS].insert_one({"offer_id": str(o["_id"]), "user_id": o["user_id"], "company_id": o.get("company_id"),
                                            "job_id": o.get("job_id"), "side": side, "kind": kind, "via": via, "reason": reason[:300],
                                            "join_date": o.get("join_date"), "at": now()})  # fmt: skip


async def on_joined(db, o: dict[str, Any], side: str, joined: bool, reason: str, via: str) -> None:
    """Called by H6 "Joined" (any path): keep the event for T15 when the person is on the new flow."""
    from app.site import get_site

    site = await get_site(db)
    if await handled(db, site, o.get("user_id"), o.get("company_id")):
        await join_event(db, o, side, "joined" if joined else "not_joined", via, reason)


async def _offer(db, link: dict[str, Any]) -> dict[str, Any]:
    try:
        o = await db[HIRE_OFFERS].find_one({"_id": ObjectId(link["offer_id"])})
    except (InvalidId, TypeError):
        o = None
    if not o or o.get("status") == "withdrawn":
        raise ApiError(404, "invalid_link", "This offer isn’t here any more.")
    return o


async def join_view(db, link: dict[str, Any]) -> dict[str, Any]:
    from app.hire.offers import state

    o = await _offer(db, link)
    site, u = await _check_scope(db, link)
    today = now().astimezone(IST).date()
    d = date.fromisoformat(o["join_date"])
    evs = await db[TRUST_JOIN_EVENTS].find({"offer_id": str(o["_id"]), "side": "candidate"}).sort("at", 1).to_list(20)
    last = {e["kind"]: ms(e["at"]) for e in evs}
    face = await face_needed(db, site, u, o) if d - timedelta(days=1) <= today else False
    return {"kind": "join", "first": A._first(u), "company": o["company_name"], "role": o["title"], "lang": await _lang(db, u),
            "joinDate": o["join_date"], **join_details(o), "status": state(o), "stage": "before" if today < d else "day" if today == d else "after",
            "joined": bool((o.get("joined") or {}).get("candidate")), "answered": last,
            "face": {"needed": face, "url": f"{get_settings().site_url.rstrip('/')}{FACE_LINK}"}}  # fmt: skip


async def join_act(db, link: dict[str, Any], action: str, reason: str, mailer: Mailer | None) -> dict[str, Any]:
    from app.hire.offers import JoinedIn, _joined, state

    o = await _offer(db, link)
    site, u = await _check_scope(db, link)
    t = now()
    today = t.astimezone(IST).date()
    d = date.fromisoformat(o["join_date"])
    if action == "joined":
        if today < d:
            raise ApiError(409, "not_yet", "You can say you joined on your joining day.")
        if state(o) not in ("accepted", "joined"):
            raise ApiError(409, "not_accepted", "This offer isn’t waiting for a joining answer.")
        if not (o.get("joined") or {}).get("candidate"):
            await _joined(db, o, "candidate", JoinedIn(joined=True), via="link")
        return await join_view(db, link)
    if state(o) != "accepted" or today > d:
        raise ApiError(409, "not_accepted", "This joining day has passed or the offer isn’t waiting for an answer.")
    if action == "yes":
        await db[HIRE_OFFERS].update_one({"_id": o["_id"]}, {"$set": {"still_joining_at": t, "updated_at": t}})
        await join_event(db, o, "candidate", "coming", "link")
        return await join_view(db, link)
    if len(reason.strip()) < 3:
        raise ApiError(400, "reason", "Say what you need, so the company knows (for example: “Can I join on Monday?”).")
    await db[HIRE_OFFERS].update_one(
        {"_id": o["_id"]}, {"$set": {"t11_join.reschedule": {"at": t, "reason": reason.strip()[:300]}, "updated_at": t}}
    )
    await join_event(db, o, "candidate", "reschedule", "link", reason.strip())
    if o.get("by"):
        text = (f"{o.get('candidate_name') or 'Your new hire'} asks to move their joining day ({date.fromisoformat(o['join_date']).strftime('%-d %b')}) for {o['title']}.\n"
                f"What they said: {reason.strip()}\n\nPlease reply to them on Nm7 (Hire → Offers).")  # fmt: skip
        await _mail(
            db,
            mailer,
            site,
            o["by"],
            "",
            f"Joining day: {o.get('candidate_name') or 'a new hire'} asks to reschedule",
            text,
            u["_id"],
            "join_reschedule",
            background=False,
        )
    return await join_view(db, link)


async def company_join_view(db, link: dict[str, Any]) -> dict[str, Any]:
    from app.hire.offers import state

    o = await _offer(db, link)
    await _check_scope(db, link)
    today = now().astimezone(IST).date()
    return {"kind": "company_join", "candidate": o.get("candidate_name") or "", "company": o["company_name"], "role": o["title"], "joinDate": o["join_date"],
            "status": state(o), "joined": o.get("joined") or {}, "canAnswer": date.fromisoformat(o["join_date"]) <= today and state(o) in ("accepted", "joined", "dropped"),
            "dropReason": o.get("drop_reason", "")}  # fmt: skip


async def company_join_act(db, link: dict[str, Any], joined: bool, reason: str) -> dict[str, Any]:
    from app.hire.offers import JoinedIn, _joined

    o = await _offer(db, link)
    await _check_scope(db, link)
    await _joined(db, o, "company", JoinedIn(joined=joined, reason=reason), via="link")
    await audit(
        db,
        None,
        "hire.offer_joined",
        target=o["company_id"],
        data={"by": "one-tap link", "offer": str(o["_id"]), "joined": joined},
    )
    return await company_join_view(db, link)


# --- the pass: invites, reminders, joining day -----------------------------------------------------------------------------


async def _scope(db, site: dict[str, Any]) -> dict[str, Any] | None:
    """Who the pass may look at: everyone once public; admins, demo accounts and testers while the switch is OFF."""
    if (site.get("trust") or {}).get("public"):
        return {}
    ids = [u["_id"] async for u in db[USERS].find({"$or": [{"email_lc": {"$in": sorted(_testers(site))}}, {"role": "admin"}, {"demo": True}]},
                                                  {"_id": 1}).limit(5000)]  # fmt: skip
    return {"user_id": {"$in": ids}} if ids else None


async def _flag(db, coll: str, doc: dict[str, Any], path: str, value: Any) -> bool:
    """Claim a "sent" flag (once each, even with two passes at once)."""
    r = await db[coll].update_one({"_id": doc["_id"], path: {"$exists": False}}, {"$set": {path: value}})
    return bool(r.modified_count)


async def _send_invite(db, site, mailer, link, u, t) -> dict[str, str]:
    company, role = await _names(db, link["company_id"], link["job_id"])
    lang = await _lang(db, u)
    params = [A._first(u), role, company, url_for(link)]
    wa = await _wa(db, site, u, "book", params, t)
    email = await _mail(db, mailer, site, u.get("email", ""), u.get("name", ""), TX.subject(lang, "book", role=role, company=company),
                        TX.render(lang, "book", params), u["_id"], "book", demo=bool(u.get("demo")))  # fmt: skip
    return {"wa": wa, "email": email}


async def invites(db, site: dict[str, Any], mailer, t: datetime, scope: dict[str, Any]) -> dict[str, int]:
    st = booking_settings(site)
    out: dict[str, int] = {}
    ch = timedelta(hours=int(st["change_hours"]))
    # 1. WhatsApp invites that waited for the quiet hours / the cap
    async for link in db[TRUST_BOOK_LINKS].find({"kind": "interview", "invite.wa_pending": True}).limit(PAIRS_PER_PASS):
        u, c = await _uc(db, link["user_id"], link["company_id"])
        if not takes_over(site, u, c) or await _mine(db, link) or t > link["invite"]["at"] + WA_RETRY:
            await db[TRUST_BOOK_LINKS].update_one({"_id": link["_id"]}, {"$set": {"invite.wa_pending": False}})
            continue
        company, role = await _names(db, link["company_id"], link["job_id"])
        got = await _wa(db, site, u, "book", [A._first(u), role, company, url_for(link)], t)
        if got not in TRANSIENT:
            await db[TRUST_BOOK_LINKS].update_one(
                {"_id": link["_id"]}, {"$set": {"invite.wa_pending": False, "invite.wa": got}}
            )
            out["invite_wa_" + ("sent" if got == "sent" else "skipped")] = (
                out.get("invite_wa_" + ("sent" if got == "sent" else "skipped"), 0) + 1
            )
    # 2. new people to invite
    since = t - LOOKBACK
    pairs: dict[tuple[str, str], tuple[str, str]] = {}
    async for a in db[APPLICATIONS].find({**scope, "status": {"$in": ["shortlisted", "interview"]}, "updated_at": {"$gte": since},
                                          "company_removed_at": None, "job_id": {"$nin": [None, ""]}, "company_id": {"$nin": [None, ""]}},
                                         {"user_id": 1, "job_id": 1, "company_id": 1}).sort("updated_at", -1).limit(SCAN_PER_SOURCE):  # fmt: skip
        pairs.setdefault((a["user_id"], a["job_id"]), (a["company_id"], "application"))
    async for cv in db[TRUST_AGENT_CONVOS].find({**scope, "state": {"$in": ["applied", "not_fit"]}, "updated_at": {"$gte": since}},
                                                {"user_id": 1, "job_id": 1, "company_id": 1}).limit(SCAN_PER_SOURCE):  # fmt: skip
        pairs.setdefault((cv["user_id"], cv["job_id"]), (cv["company_id"], "agent"))
    if not pairs:
        return out
    keys = [f"interview:{uid}:{jid}" for uid, jid in pairs]
    done = {
        x["key"]
        for x in await db[TRUST_BOOK_LINKS]
        .find({"key": {"$in": keys}, "invite.at": {"$exists": True}}, {"key": 1})
        .to_list(len(keys))
    }
    n = 0
    for (uid, jid), (cid, source) in pairs.items():
        if n >= PAIRS_PER_PASS:
            break
        if f"interview:{uid}:{jid}" in done:
            continue
        if await db[HIRE_SLOTS].find_one({"job_id": jid, "user_id": uid, "status": "booked"}, {"_id": 1}):
            continue  # booked already (the reminders carry the link)
        if not await db[HIRE_SLOTS].find_one(
            {"job_id": jid, "status": "open", "user_id": None, "starts_at": {"$gt": t + ch}}, {"_id": 1}
        ):
            continue  # no free times yet: tried again on a later pass
        j = await db[JOBS].find_one({"_id": jid}, {"status": 1})
        if not j or j.get("status") != "active":
            continue
        u, c = await _uc(db, uid, cid)
        if not takes_over(site, u, c) or u.get("disabled_at") or u.get("deleted_at"):
            continue
        n += 1
        link = await link_for(
            db,
            "interview",
            user_id=uid,
            company_id=cid,
            job_id=jid,
            source=source,
            until=t + timedelta(days=int(st["link_days"])),
        )
        if not await _flag(db, TRUST_BOOK_LINKS, link, "invite.at", t):
            continue
        sent = await _send_invite(db, site, mailer, link, u, t)
        await db[TRUST_BOOK_LINKS].update_one({"_id": link["_id"]}, {"$set": {"invite.wa": sent["wa"], "invite.email": sent["email"],
                                                                              "invite.wa_pending": sent["wa"] in TRANSIENT}})  # fmt: skip
        await event(db, "t11_invite", uid, jid, cid, wa=sent["wa"], email=sent["email"])
        out["invited"] = out.get("invited", 0) + 1
    return out


async def _channel(db, site, mailer, coll, doc, key, ch, due, deadline, t, send) -> str | None:
    """One message of one reminder on one channel: wait / send once / drop when it would be too late."""
    path = f"t11.{key}.{ch}"
    if ((doc.get("t11") or {}).get(key) or {}).get(ch) or t < due:
        return None
    if t >= deadline:
        await _flag(db, coll, doc, path, {"status": "missed", "at": t})
        return "missed"
    if not await _flag(db, coll, doc, path, {"status": "sending", "at": t}):
        return None
    got = await send()
    if got in TRANSIENT:
        await db[coll].update_one({"_id": doc["_id"]}, {"$unset": {path: ""}})  # tried again on the next pass
        return "waiting"
    await db[coll].update_one({"_id": doc["_id"]}, {"$set": {path: {"status": got, "at": t}}})
    return got


async def interview_reminders(
    db, site: dict[str, Any], mailer, t: datetime, scope: dict[str, Any] | None = None
) -> dict[str, int]:
    st = booking_settings(site)
    out: dict[str, int] = {}
    soon = timedelta(hours=int(st["soon_hours"]))
    q = {
        "status": "booked",
        "user_id": {"$ne": None},
        "starts_at": {"$gt": t, "$lte": t + timedelta(hours=40)},
        **(scope or {}),
    }
    async for s in db[HIRE_SLOTS].find(q).sort("starts_at", 1).limit(REMIND_PER_PASS):
        u, c = await _uc(db, s["user_id"], s["company_id"])
        if not takes_over(site, u, c):
            continue
        if not s.get("t11_flow"):
            await db[HIRE_SLOTS].update_one({"_id": s["_id"]}, {"$set": {"t11_flow": True}})
        start = s["starts_at"]
        day_due = datetime.combine(start.astimezone(IST).date() - timedelta(days=1), _hm(st["eve_at"]), IST)
        soon_due = start - soon
        plan = [("soon", soon_due, start)]
        if (s.get("booked_at") or t) < day_due:
            plan.insert(0, ("day", day_due, soon_due))
        if not any(t >= due for _, due, _ in plan):
            continue
        company, role = await _names(db, s["company_id"], s["job_id"])
        lang = await _lang(db, u)
        link = await link_for(db, "interview", user_id=u["_id"], company_id=s["company_id"], job_id=s["job_id"], source="reminder",
                              until=max(t + timedelta(days=int(st["link_days"])), start + timedelta(days=1)))  # fmt: skip
        for key, due, deadline in plan:
            when = TX.bit(lang, "tomorrow" if key == "day" else "soon", when=when_text(start))
            params = [A._first(u), role, company, when, where_text(lang, s), url_for(link)]
            subj = TX.subject(lang, f"reminder_{key}", role=role, company=company)

            async def by_mail(params=params, subj=subj, u=u, lang=lang):
                return await _mail(db, mailer, site, u.get("email", ""), u.get("name", ""), subj, TX.render(lang, "reminder", params), u["_id"],
                                   "reminder", demo=bool(u.get("demo")))  # fmt: skip

            async def by_wa(params=params, u=u):
                return await _wa(db, site, u, "reminder", params, t)

            for ch, send in (("email", by_mail), ("wa", by_wa)):
                got = await _channel(db, site, mailer, HIRE_SLOTS, s, key, ch, due, deadline, t, send)
                if got:
                    out[f"{key}_{ch}_{got}"] = out.get(f"{key}_{ch}_{got}", 0) + 1
    return out


async def joining(db, site: dict[str, Any], mailer, t: datetime, scope: dict[str, Any]) -> dict[str, int]:
    st = booking_settings(site)
    out: dict[str, int] = {}
    today = t.astimezone(IST).date()
    tomorrow = today + timedelta(days=1)
    q = {
        **scope,
        "status": {"$in": ["accepted", "joined"]},
        "join_date": {"$in": [today.isoformat(), tomorrow.isoformat()]},
    }
    async for o in db[HIRE_OFFERS].find(q).limit(REMIND_PER_PASS):
        u, c = await _uc(db, o["user_id"], o.get("company_id"))
        if not takes_over(site, u, c):
            continue
        if not o.get("t11_flow"):
            await db[HIRE_OFFERS].update_one(
                {"_id": o["_id"]}, {"$set": {"t11_flow": True, "checkin1": True}}
            )  # the old "tomorrow" email: not too
        d = date.fromisoformat(o["join_date"])
        at = lambda hm, day=d: datetime.combine(day, _hm(hm), IST)  # noqa: E731
        midnight = datetime.combine(d + timedelta(days=1), time(0, 0), IST)
        lang = await _lang(db, u)
        jd = join_details(o)
        tp = (TX.bit(lang, "at_time", time=_time12(jd["time"])) if jd["time"] else "") + (
            TX.bit(lang, "at_place", place=jd["place"]) if jd["place"] else ""
        )
        link = await link_for(db, "join", user_id=o["user_id"], company_id=o.get("company_id") or "", offer_id=str(o["_id"]), source="offer",
                              until=midnight + timedelta(days=3))  # fmt: skip
        first, company = A._first(u), o["company_name"]
        plan: list[tuple[str, datetime, datetime, str, list[str]]] = []
        if d == tomorrow and o["status"] == "accepted":
            plan.append(
                (
                    "eve",
                    at(st["eve_at"], today),
                    datetime.combine(d, time(0, 0), IST),
                    "join_eve",
                    [first, company, tp, url_for(link)],
                )
            )
        if d == today:
            plan.append(
                (
                    "morning",
                    at(st["morning_at"]),
                    at(st["checkin_at"]),
                    "join_morning",
                    [first, company, tp, jd["map"] or url_for(link)],
                )
            )
            if not (o.get("joined") or {}).get("candidate"):
                plan.append(
                    ("checkin", at(st["checkin_at"]), midnight, "join_checkin", [first, company, url_for(link)])
                )
        for key, due, deadline, kind, params in plan:
            text = TX.render(lang, kind, params)
            if kind == "join_checkin" and await face_needed(db, site, u, o):
                text += "\n" + TX.bit(lang, "selfie", link=f"{get_settings().site_url.rstrip('/')}{FACE_LINK}")
            subj = TX.subject(lang, kind, company=company)

            async def by_mail(text=text, subj=subj, kind=kind, u=u):
                return await _mail(
                    db,
                    mailer,
                    site,
                    u.get("email", ""),
                    u.get("name", ""),
                    subj,
                    text,
                    u["_id"],
                    kind,
                    demo=bool(u.get("demo")),
                )

            async def by_wa(kind=kind, params=params, u=u):
                return await _wa(db, site, u, kind, params, t)

            for ch, send in (("email", by_mail), ("wa", by_wa)):
                got = await _channel(db, site, mailer, HIRE_OFFERS, o, key, ch, due, deadline, t, send)
                if got:
                    out[f"{key}_{ch}_{got}"] = out.get(f"{key}_{ch}_{got}", 0) + 1
        if d == today and o.get("by") and (o.get("joined") or {}).get("company") is None:
            clink = await link_for(db, "company_join", user_id=o["user_id"], company_id=o.get("company_id") or "", offer_id=str(o["_id"]),
                                   source="offer", until=midnight + timedelta(days=14))  # fmt: skip
            text = (f"Today is {o.get('candidate_name') or 'your new hire'}’s joining day ({o['title']}).\n"
                    f"Did they join? One tap, no sign-in: {url_for(clink)}")  # fmt: skip

            async def co_mail(text=text, o=o, c=c):
                return await _mail(db, mailer, site, o["by"], "", f"Did {o.get('candidate_name') or 'your new hire'} join today?", text, o["user_id"],
                                   "company_join", demo=bool((c or {}).get("demo")))  # fmt: skip

            got = await _channel(
                db,
                site,
                mailer,
                HIRE_OFFERS,
                o,
                "company",
                "email",
                at(st["company_at"]),
                midnight + timedelta(days=2),
                t,
                co_mail,
            )
            if got:
                out[f"company_email_{got}"] = out.get(f"company_email_{got}", 0) + 1
    return out


async def run(db, mailer=None, t: datetime | None = None, force: bool = False) -> dict[str, int]:
    """Every automation pass: invites with a booking link, interview reminders, joining-day messages (capped, small)."""
    from app.core.heavy import heavy_or_skip
    from app.site import get_site

    t = t or now()
    site = await get_site(db)
    if not booking_settings(site)["on"]:
        return {}
    scope = await _scope(db, site)
    if scope is None:
        return {}
    out: dict[str, int] = {}
    async with heavy_or_skip(db) as ok:
        if not ok and not force:
            return {"waiting_heavy": 1}
        for part in (
            invites(db, site, mailer, t, scope),
            interview_reminders(db, site, mailer, t, scope),
            joining(db, site, mailer, t, scope),
        ):
            try:
                out.update(await part)
            except Exception:  # noqa: BLE001 — one part's problem never stops the others
                log.exception("t11: one part of the pass failed")
                out["error"] = out.get("error", 0) + 1
    return out


# --- views -------------------------------------------------------------------------------------------------------------------

EVENT_TEXT = {"t11_invite": "Booking link sent", "t11_booked": "Booked a time", "t11_moved": "Moved their time", "t11_cancelled": "Cancelled",
              "t11_cant": "Can’t make it"}  # fmt: skip
JOIN_TEXT = {
    "coming": "Confirmed they’re coming",
    "reschedule": "Asked to reschedule",
    "joined": "Joined",
    "not_joined": "Didn’t join",
}


async def company_view(db, cid: str, job: str = "") -> dict[str, Any]:
    """The company's live list: bookings made, moved or cancelled with the link, "can't make it", and the joining days
    coming up with the candidate's answers (never phone numbers or messages)."""
    q: dict[str, Any] = {"company_id": cid, "kind": {"$in": list(EVENT_TEXT)}} | ({"job_id": job} if job else {})
    ev = await db[TRUST_AGENT_EVENTS].find(q).sort("at", -1).to_list(40)
    uids = {e["user_id"] for e in ev}
    slots = {
        s["_id"]: s
        async for s in db[HIRE_SLOTS].find(
            {"_id": {"$in": [ObjectId(e["slot"]) for e in ev if e.get("slot")]}}, {"starts_at": 1}
        )
    }
    today = now().astimezone(IST).date()
    offers = await db[HIRE_OFFERS].find({"company_id": cid, "status": {"$in": ["accepted", "joined", "dropped"]},
                                          "join_date": {"$gte": (today - timedelta(days=3)).isoformat(), "$lte": (today + timedelta(days=30)).isoformat()}}
                                         ).sort("join_date", 1).to_list(50)  # fmt: skip
    uids |= {o["user_id"] for o in offers}
    names = {u["_id"]: u.get("name", "") async for u in db[USERS].find({"_id": {"$in": list(uids)}}, {"name": 1})}
    jev: dict[str, list] = {}
    async for e in db[TRUST_JOIN_EVENTS].find({"offer_id": {"$in": [str(o["_id"]) for o in offers]}}).sort("at", 1):
        jev.setdefault(e["offer_id"], []).append(
            {
                "side": e["side"],
                "kind": e["kind"],
                "text": JOIN_TEXT.get(e["kind"], e["kind"]),
                "reason": e.get("reason", ""),
                "at": ms(e["at"]),
            }
        )
    return {
        "events": [{"kind": e["kind"], "text": EVENT_TEXT[e["kind"]], "name": names.get(e["user_id"], ""), "jobId": e.get("job_id"), "at": ms(e["at"]),
                    "slotAt": ms((slots.get(ObjectId(e["slot"])) or {}).get("starts_at")) if e.get("slot") else None, "reason": e.get("reason", "")} for e in ev],
        "joinings": [{"id": str(o["_id"]), "name": names.get(o["user_id"], o.get("candidate_name", "")), "role": o["title"], "joinDate": o["join_date"],
                      "status": o["status"], **join_details(o), "joined": o.get("joined") or {}, "answers": jev.get(str(o["_id"]), [])} for o in offers],
    }  # fmt: skip


async def set_join_details(db, cid: str, oid: str, hhmm: str, place: str, map_link: str) -> dict[str, Any]:
    try:
        o = await db[HIRE_OFFERS].find_one({"_id": ObjectId(oid), "company_id": cid})
    except (InvalidId, TypeError):
        o = None
    if not o or o["status"] not in ("accepted", "joined"):
        raise ApiError(404, "not_found", "That accepted offer isn’t here.")
    sets = {
        "t11_join.time": hhmm,
        "t11_join.place": place.strip(),
        "t11_join.map": map_link.strip(),
        "updated_at": now(),
    }
    await db[HIRE_OFFERS].update_one({"_id": o["_id"]}, {"$set": sets})
    return {
        "id": oid,
        **join_details(
            {
                **o,
                "t11_join": {
                    **(o.get("t11_join") or {}),
                    "time": hhmm,
                    "place": place.strip(),
                    "map": map_link.strip(),
                },
            }
        ),
    }


async def counts(db, since: datetime) -> dict[str, int]:
    out: dict[str, int] = {}
    async for r in await db[TRUST_AGENT_EVENTS].aggregate([{"$match": {"at": {"$gte": since}, "kind": {"$regex": "^t11_"}}},
                                                          {"$group": {"_id": "$kind", "n": {"$sum": 1}}}]):  # fmt: skip
        out[r["_id"].removeprefix("t11_")] = r["n"]
    async for r in await db[TRUST_JOIN_EVENTS].aggregate(
        [{"$match": {"at": {"$gte": since}}}, {"$group": {"_id": "$kind", "n": {"$sum": 1}}}]
    ):
        out[f"join_{r['_id']}"] = r["n"]
    return out
