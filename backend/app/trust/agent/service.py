# ruff: noqa: E501  (dense response lines)
"""The calling agent: when a company posts a job (and turned on "Call / message matching candidates" for it), Nm7
picks the best-matching people who said yes to calls / WhatsApp, messages them on WhatsApp first, calls them with an AI
voice agent if they don't reply within X hours (only if they allowed calls), asks their interest and the job's yes/no
knock-out questions, and books an interview time from the company's slots. Answers land on the candidate's
application (the company's dashboard and the candidate's tracker).

Who is picked: Auto Apply 2.0's match score (app/autoapply/score.parts on the job board's fit for their resume; never
gender, religion, caste, age, photo, name or college), at least `min_score`, best first, at most `per_job` people a job
(Admin, default 30). Only people with the T1 consent "calls_whatsapp", a channel on, a phone number, not opted out of
that channel, not hiding from the company and not blocking it.

Limits, checked again right before every contact: no message or call in the quiet hours (Admin, default 9 PM–9 AM IST)
or on the person's quiet days (the contact waits for the next allowed time); at most `per_person_day` new contacts a
day per person (default 2; replies inside a conversation the person answered don't count); Stop in any language →
that channel is off at once, confirmed, and never used again until the person turns it back on. These are transactional
messages about jobs to people who opted in (not promotional; see docs/trust/T5-vendors.md on DND / DLT).

Behind the Vetting Trust switch: while it is OFF a real person is contacted only when they are a tester (or an admin)
and the company is a test company (the demo company or one with a tester on its team): Auto Apply 2.0's pairing rule.
Demo accounts only ever meet the demo company, and only through the test providers. On production the test providers
work only for testers and demo accounts, so nobody is told they were "contacted" when nothing was sent.

Stored (additive collections):
  trust_agent_prefs   _id = user id: whatsapp, call (on / off), lang (en / hi / te), quiet_days [0 = Monday … 6],
                      opt_out {whatsapp, call: when}, wa_id (the phone's digits with 91, to match replies)
  trust_agent_convos  one per job × person: state, the answers, offered slots, the booked slot, WhatsApp / call refs,
                      next_at (when the next step is due)
  trust_agent_events  one row per contact, reply, call, booking, opt-out (counts, the daily cap, the Admin log)
  trust_agent_logs    "What we said": each message's text and the call transcript, only with the consent, deleted
                      after the T1 schedule (default 90 days) or at once when the consent is taken back. No audio.
States: queued → asked → knockout → slots → booked | applied (no times yet) | not_fit | declined | stopped | no_reply
| closed (the job closed or the company turned it off) | skipped (no allowed channel) | withdrawn (consent taken back).
"""

import logging
import re
from datetime import datetime, time, timedelta
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.core.config import get_settings
from app.core.db import (
    APPLICATIONS,
    COMPANIES,
    HIRE_PROFILES,
    HIRE_SLOTS,
    JOBS,
    TRUST_AGENT_CONVOS,
    TRUST_AGENT_EVENTS,
    TRUST_AGENT_LOGS,
    TRUST_AGENT_PREFS,
    USERS,
)
from app.core.time import IST, ist_day, now
from app.me.service import ms
from app.trust import consent as C
from app.trust import knockout as K
from app.trust import retention as R
from app.trust.agent import providers as P
from app.trust.agent import texts as T

log = logging.getLogger("nm7.trust.agent")

PURPOSE = "calls_whatsapp"
DEFAULTS: dict[str, Any] = {
    "whatsapp_provider": "mock", "voice_provider": "mock", "per_job": 30, "per_person_day": 2, "quiet_from": "21:00",
    "quiet_to": "09:00", "call_after_hours": 4, "close_after_hours": 72, "min_score": 50,
    "templates": {"en": {"approved": False}, "hi": {"approved": False}, "te": {"approved": False}},
}  # fmt: skip
JOBS_PER_PASS = 5
SCAN_PER_PASS = 400
CONTACTS_PER_PASS = 60
BATCH = 50
SLOTS_OFFERED = 3
REASKS = 2
CALL_WAIT = timedelta(hours=2)  # no call result by then: no reply
OPEN = ("queued", "asked", "knockout", "slots", "calling")
WAITING = ("asked", "knockout", "slots")
STATE_TEXT = {
    "queued": "Waiting for an allowed time to message you", "asked": "We messaged you; waiting for your reply",
    "knockout": "Answering the company's questions", "slots": "Choosing an interview time", "calling": "Calling you",
    "booked": "Interview booked", "applied": "Your answers are with the company", "not_fit": "Answers sent; the company decides",
    "declined": "You said not now", "stopped": "You said stop", "no_reply": "No reply", "closed": "The job closed",
    "skipped": "Not contacted", "withdrawn": "Consent taken back",
}  # fmt: skip
USER_FIELDS = {"email": 1, "email_lc": 1, "name": 1, "role": 1, "demo": 1, "phone": 1, "disabled_at": 1, "deleted_at": 1,
               "vetting": 1, "auto_apply": 1, "simple": 1}  # fmt: skip

C.add_purpose(C.Purpose(PURPOSE, "Calls and WhatsApp about matching jobs",
    "When a company posts a job that fits you, Nm7 may message you on WhatsApp and, only if you allow calls and don't reply, call you with an AI voice assistant "
    "(it always says it is an AI from Nm7). It asks if you are interested, the company's yes/no questions, and offers interview times to book. "
    "You choose WhatsApp and / or calls, your language (English, Hindi or Telugu) and quiet days; we never contact you between 9 PM and 9 AM, and at most twice a day. "
    "Reply STOP (or “band karo” / “aapu”) any time and that channel stops at once. We keep the text of the messages and of the call for {days} days so you can read it under "
    "“What we said”; we don't keep call recordings. The company sees only your answers and the time you booked. If you take this back, those texts are deleted now and we stop contacting you.",
    1, "agent_logs"))  # fmt: skip


async def _no_clean(_db, _cutoff, _cap) -> int:
    return 0


R.register(R.DataType("agent_logs", "WhatsApp messages and AI call transcripts (“What we said”)", 90, 7, 180,
                      TRUST_AGENT_LOGS, purpose=PURPOSE, note="Deleted by the daily job; at once when the consent is taken back"))  # fmt: skip
R.register(R.DataType("agent_contacts", "Who was contacted about which job (state, answers, booked time)", 365, 90, 730,
                      TRUST_AGENT_CONVOS, note="Deleted by the daily job"))  # fmt: skip
R.register(R.DataType("agent_events", "Contact counts (messages, calls, replies, opt-outs; no text)", 365, 90, 730,
                      TRUST_AGENT_EVENTS, field="at", note="Deleted by the daily job"))  # fmt: skip
R.register(R.DataType("agent_prefs", "Calls & WhatsApp choices and opt-outs", 3650, 3650, 3650, TRUST_AGENT_PREFS,
                      user_field="_id", clean=_no_clean, note="Kept while the account exists, so a Stop is never forgotten; deleted with the account"))  # fmt: skip


@R.on_withdraw(PURPOSE)
async def _withdrawn(db, uid: str) -> int:
    """Consent taken back: the texts go (the data type above), every open conversation ends, both channels go off."""
    t = now()
    r = await db[TRUST_AGENT_CONVOS].update_many({"user_id": uid, "state": {"$in": list(OPEN)}},
                                                 {"$set": {"state": "withdrawn", "next_at": None, "updated_at": t}})  # fmt: skip
    await db[TRUST_AGENT_PREFS].update_one({"_id": uid}, {"$set": {"whatsapp": False, "call": False, "updated_at": t}})
    return r.modified_count


# --- settings, providers, the switch -------------------------------------------------------------------------------------


def agent_settings(site: dict[str, Any]) -> dict[str, Any]:
    st = (site.get("trust") or {}).get("agent") or {}
    out = {**DEFAULTS, **st}
    out["templates"] = {k: {**DEFAULTS["templates"][k], **((st.get("templates") or {}).get(k) or {})} for k in T.LANGS}
    return out


def _testers(site: dict[str, Any]) -> set[str]:
    return {str(e).lower() for e in (site.get("trust") or {}).get("testers") or []}


def _email(u: dict[str, Any] | None) -> str:
    return ((u or {}).get("email_lc") or (u or {}).get("email") or "").lower()


def pair_ok(u: dict[str, Any] | None, c: dict[str, Any] | None, site: dict[str, Any]) -> bool:
    """May the agent contact this person about this company's job? Demo accounts only ever meet the demo company. While
    Vetting Trust is OFF: a tester (or an admin) and a test company only (Auto Apply 2.0's pairing rule)."""
    from app.autoapply.access import test_company

    if not u or not c:
        return False
    if u.get("demo") or c.get("demo"):
        return bool(u.get("demo")) and bool(c.get("demo"))
    tr = site.get("trust") or {}
    if tr.get("public"):
        return True
    allowed = u.get("role") == "admin" or _email(u) in _testers(site)
    return allowed and test_company(c, _testers(site))


def _pick(reg: dict[str, Any], key: str, u: dict[str, Any], site: dict[str, Any]):
    p = reg.get(key) or reg["mock"]
    if not p.test:
        return p if p.ready() and not u.get("demo") else None
    if not get_settings().is_prod or u.get("demo") or _email(u) in _testers(site):
        return p
    return None


def whatsapp_for(site: dict[str, Any], u: dict[str, Any]) -> P.WhatsApp | None:
    """The chosen WhatsApp provider for this person, or None (no keys; a demo account and a real provider; the test
    provider on production for someone who isn't a tester)."""
    return _pick(P.whatsapp_providers(), agent_settings(site)["whatsapp_provider"], u, site)


def voice_for(site: dict[str, Any], u: dict[str, Any]) -> P.Voice | None:
    return _pick(P.voice_providers(), agent_settings(site)["voice_provider"], u, site)


# --- the person's choices ----------------------------------------------------------------------------------------------


def wa_id(phone: str | None) -> str:
    d = re.sub(r"\D", "", phone or "")
    if len(d) == 10 and d[0] in "6789":
        d = "91" + d
    return d if len(d) == 12 and d.startswith("91") else ""


def default_lang(u: dict[str, Any]) -> str:
    lang = ((u.get("simple") or {}).get("lang")) or "en"
    return lang if lang in T.LANGS else "en"


async def prefs(db, u: dict[str, Any]) -> dict[str, Any]:
    p = await db[TRUST_AGENT_PREFS].find_one({"_id": u["_id"]}) or {}
    return {"whatsapp": bool(p.get("whatsapp")), "call": bool(p.get("call")), "lang": p.get("lang") or default_lang(u),
            "quiet_days": list(p.get("quiet_days") or []), "opt_out": dict(p.get("opt_out") or {}), "wa_id": p.get("wa_id") or wa_id(u.get("phone"))}  # fmt: skip


async def save_prefs(
    db, u: dict[str, Any], *, whatsapp: bool, call: bool, lang: str, quiet_days: list[int]
) -> dict[str, Any]:
    """Turning a channel on is also how someone opts back in after a Stop (it clears that channel's opt-out)."""
    t = now()
    before = await prefs(db, u)
    sets: dict[str, Any] = {"whatsapp": whatsapp, "call": call, "lang": lang, "quiet_days": sorted(set(quiet_days)),
                            "wa_id": wa_id(u.get("phone")), "updated_at": t}  # fmt: skip
    for ch, on in (("whatsapp", whatsapp), ("call", call)):
        if on and before["opt_out"].get(ch):
            sets[f"opt_out.{ch}"] = None
    await db[TRUST_AGENT_PREFS].update_one(
        {"_id": u["_id"]}, {"$set": sets, "$setOnInsert": {"created_at": t}}, upsert=True
    )
    await audit(
        db,
        u["_id"],
        "trust.agent_prefs",
        target=u["_id"],
        data={"whatsapp": whatsapp, "call": call, "lang": lang, "quiet_days": sets["quiet_days"]},
    )
    return await prefs(db, u)


async def opt_out(db, uid: str, channel: str, how: str) -> None:
    t = now()
    await db[TRUST_AGENT_PREFS].update_one(
        {"_id": uid}, {"$set": {channel: False, f"opt_out.{channel}": t, "updated_at": t}}, upsert=True
    )
    await event(db, f"optout_{channel}", uid, None, how=how)
    await audit(db, uid, "trust.agent_opt_out", target=uid, data={"channel": channel, "how": how})


# --- time rules ----------------------------------------------------------------------------------------------------------


def _hm(s: str) -> time:
    h, m = (int(x) for x in str(s).split(":"))
    return time(h, m)


def quiet_now(t: datetime, st: dict[str, Any]) -> bool:
    """Inside the quiet hours (IST)? A window that crosses midnight (21:00–09:00) is handled."""
    x = t.astimezone(IST).time()
    a, b = _hm(st["quiet_from"]), _hm(st["quiet_to"])
    return (x >= a or x < b) if a > b else (a <= x < b)


def next_allowed(t: datetime, st: dict[str, Any], quiet_days: list[int]) -> datetime:
    """The first moment from t that is outside the quiet hours and not on one of the person's quiet days."""
    at = t.astimezone(IST)
    for _ in range(9 * 24 * 4):
        if not quiet_now(at, st) and at.weekday() not in quiet_days:
            return at
        if quiet_now(at, st):
            end = datetime.combine(at.date(), _hm(st["quiet_to"]), IST)
            at = end if end > at else end + timedelta(days=1)
        else:  # a quiet day: the start of the next day's allowed time
            at = datetime.combine(at.date() + timedelta(days=1), _hm(st["quiet_to"]), IST)
    return at


async def contacts_today(db, uid: str, t: datetime) -> int:
    return await db[TRUST_AGENT_EVENTS].count_documents(
        {"user_id": uid, "day": ist_day(t), "kind": {"$in": ["wa_template", "call"]}}
    )


async def blocker(
    db,
    u: dict[str, Any],
    p: dict[str, Any],
    channel: str,
    t: datetime,
    st: dict[str, Any],
    site: dict[str, Any],
    *,
    new_contact: bool = True,
) -> str | None:
    """Why this person can't be contacted on this channel right now (None = go). quiet_* / daily_cap mean later."""
    if u.get("disabled_at") or u.get("deleted_at"):
        return "account"
    if not await C.has(db, u["_id"], PURPOSE):
        return "no_consent"
    if p["opt_out"].get(channel):
        return "opted_out"
    if not p.get(channel):
        return "channel_off"
    if not p.get("wa_id"):
        return "no_phone"
    if (whatsapp_for if channel == "whatsapp" else voice_for)(site, u) is None:
        return "no_provider"
    if quiet_now(t, st):
        return "quiet_hours"
    if t.astimezone(IST).weekday() in p["quiet_days"]:
        return "quiet_day"
    if new_contact and await contacts_today(db, u["_id"], t) >= int(st["per_person_day"]):
        return "daily_cap"
    return None


# --- records -------------------------------------------------------------------------------------------------------------


async def event(db, kind: str, uid: str, convo: dict[str, Any] | None, t: datetime | None = None, **data: Any) -> None:
    t = t or now()
    await db[TRUST_AGENT_EVENTS].insert_one({"kind": kind, "user_id": uid, "convo_id": (convo or {}).get("_id"), "job_id": (convo or {}).get("job_id"),
                                            "company_id": (convo or {}).get("company_id"), "day": ist_day(t), "at": t, **data})  # fmt: skip


async def say(db, convo: dict[str, Any], who: str, channel: str, text: str, t: datetime | None = None) -> None:
    """One line of "What we said" (only while the person's consent stands; nothing is kept without it)."""
    if text and await C.has(db, convo["user_id"], PURPOSE):
        await db[TRUST_AGENT_LOGS].insert_one({"user_id": convo["user_id"], "convo_id": convo["_id"], "job_id": convo["job_id"],
                                              "who": who, "channel": channel, "text": text[:2000], "created_at": t or now()})  # fmt: skip


async def _set(db, convo: dict[str, Any], **sets: Any) -> dict[str, Any]:
    sets["updated_at"] = now()
    await db[TRUST_AGENT_CONVOS].update_one({"_id": convo["_id"]}, {"$set": sets})
    convo.update(sets)
    return convo


# --- the job: the company's toggle and picking people -------------------------------------------------------------------


def job_on(j: dict[str, Any]) -> bool:
    return bool((j.get("agent") or {}).get("on"))


def eligible(j: dict[str, Any]) -> bool:
    return bool(j.get("company_id")) and (j.get("apply") or {}).get("method") == "nm7"


async def set_job(db, j: dict[str, Any], on: bool, knockouts: list[dict[str, Any]] | None, by: str) -> dict[str, Any]:
    t = now()
    sets: dict[str, Any] = {"agent.on": on, "agent.by": by, "agent.at": t, "updated_at": t}
    if knockouts is not None:
        sets["knockouts"] = knockouts
    if on and not job_on(j):
        sets |= {"agent.state": "pending", "agent.queued_at": t, "agent.after": None, "agent.pool": []}
    await db[JOBS].update_one({"_id": j["_id"]}, {"$set": sets})
    if not on:
        await db[TRUST_AGENT_CONVOS].update_many(
            {"job_id": j["_id"], "state": "queued"}, {"$set": {"state": "closed", "next_at": None, "updated_at": t}}
        )
    return await db[JOBS].find_one({"_id": j["_id"]})


async def _score(db, u: dict[str, Any], j: dict[str, Any]) -> int | None:
    from app.autoapply import score
    from app.jobs import fit as fitmod

    p = await fitmod.person_for(db, u["_id"])
    if not p or not p.usable():
        return None
    f = (await fitmod.fits(db, u["_id"], p, [j], save=False))[j["_id"]]
    level = int(((u.get("vetting") or {}).get("level")) or 0)
    return int(score.parts(j, f, u.get("auto_apply") or {}, level)["score"])


async def _candidate(
    db, u: dict[str, Any], j: dict[str, Any], c: dict[str, Any], site: dict[str, Any], st: dict[str, Any]
) -> int | None:
    from app.seek.support import hidden_from

    if u.get("disabled_at") or u.get("deleted_at") or not pair_ok(u, c, site):
        return None
    if j["company_id"] in set((u.get("auto_apply") or {}).get("blocked_companies") or []):
        return None
    if hidden_from(await db[HIRE_PROFILES].find_one({"_id": u["_id"]}, {"hide_from": 1}), c):
        return None
    if not await C.has(db, u["_id"], PURPOSE) or not wa_id(u.get("phone")):
        return None
    if await db[APPLICATIONS].find_one({"user_id": u["_id"], "job_id": j["_id"]}, {"_id": 1}):
        return None  # already applied: nothing to ask
    s = await _score(db, u, j)
    return s if s is not None and s >= int(st["min_score"]) else None


async def select(db, j: dict[str, Any], site: dict[str, Any], budget: dict[str, int], t: datetime | None = None) -> int:
    """Look at people who allowed calls / WhatsApp (in batches, remembering where it stopped); once everyone has been
    looked at, the best `per_job` become conversations. → conversations created now."""
    t = t or now()
    st = agent_settings(site)
    ag = j.get("agent") or {}
    c = await db[COMPANIES].find_one({"_id": j.get("company_id")}, {"members": 1, "demo": 1, "details": 1})
    if not c or not job_on(j) or j.get("status") != "active" or not eligible(j):
        await db[JOBS].update_one({"_id": j["_id"]}, {"$set": {"agent.state": "done", "agent.done_at": t}})
        return 0
    pool: dict[str, int] = {uid: s for s, uid in (ag.get("pool") or [])}
    q: dict[str, Any] = {"$or": [{"whatsapp": True}, {"call": True}]}
    if ag.get("after"):
        q["_id"] = {"$gt": ag["after"]}
    limit = max(0, budget["scan"])
    seen, last = 0, ag.get("after")
    async for p in db[TRUST_AGENT_PREFS].find(q, {"_id": 1}).sort("_id", 1).limit(limit).batch_size(BATCH):
        seen += 1
        last = p["_id"]
        u = await db[USERS].find_one({"_id": p["_id"]}, USER_FIELDS)
        if not u:
            continue
        try:
            s = await _candidate(db, u, j, c, site, st)
        except Exception:  # noqa: BLE001 — one person's problem never stops the pick
            log.exception("calling agent: scoring one person failed")
            s = None
        if s is not None:
            pool[u["_id"]] = s
    budget["scan"] -= seen
    room = max(0, int(st["per_job"]) - await db[TRUST_AGENT_CONVOS].count_documents({"job_id": j["_id"]}))
    best = sorted(pool.items(), key=lambda kv: (-kv[1], kv[0]))[: max(room, 0)]
    if seen >= limit and limit > 0:  # more to look at: keep the best so far for the next pass
        await db[JOBS].update_one(
            {"_id": j["_id"]}, {"$set": {"agent.after": last, "agent.pool": [[s, uid] for uid, s in best]}}
        )
        return 0
    made = 0
    for uid, s in best:
        u = await db[USERS].find_one({"_id": uid}, {"simple": 1})
        p = await db[TRUST_AGENT_PREFS].find_one({"_id": uid}, {"lang": 1}) or {}
        doc = {"_id": str(ObjectId()), "job_id": j["_id"], "company_id": j["company_id"], "user_id": uid, "score": s,
               "lang": p.get("lang") or default_lang(u or {}), "state": "queued", "step": 0, "answers": {}, "interest": "",
               "offered": [], "slot_id": None, "wa": {}, "call": {}, "reasks": 0, "next_at": t, "replied_at": None,
               "demo": bool(c.get("demo")), "created_at": t, "updated_at": t}  # fmt: skip
        try:
            await db[TRUST_AGENT_CONVOS].insert_one(doc)
            made += 1
        except DuplicateKeyError:
            pass
    await db[JOBS].update_one({"_id": j["_id"]}, {"$set": {"agent.state": "done", "agent.done_at": t, "agent.after": None, "agent.pool": [],
                                                           "agent.selected": await db[TRUST_AGENT_CONVOS].count_documents({"job_id": j["_id"]})}})  # fmt: skip
    return made


# --- the conversation ----------------------------------------------------------------------------------------------------


async def _ctx(db, convo: dict[str, Any]) -> tuple[dict | None, dict | None, dict | None]:
    j = await db[JOBS].find_one({"_id": convo["job_id"]})
    u = await db[USERS].find_one({"_id": convo["user_id"]}, USER_FIELDS)
    c = await db[COMPANIES].find_one({"_id": convo["company_id"]}, {"members": 1, "demo": 1, "details": 1})
    return j, u, c


def _company_name(c: dict[str, Any] | None, j: dict[str, Any]) -> str:
    return ((c or {}).get("details") or {}).get("legal_name") or (j.get("company") or {}).get("name") or "The company"


def _city(j: dict[str, Any]) -> str:
    return "Remote" if j.get("remote") else ", ".join((j.get("locations") or [])[:2]) or "India"


def _first(u: dict[str, Any]) -> str:
    return (u.get("name") or "").split(" ")[0] or "there"


def when_text(at: datetime) -> str:
    return at.astimezone(IST).strftime("%a %-d %b, %-I:%M %p")


async def open_slots(db, job_id: str, t: datetime, limit: int = SLOTS_OFFERED) -> list[dict[str, Any]]:
    return (
        await db[HIRE_SLOTS]
        .find({"job_id": job_id, "status": "open", "user_id": None, "starts_at": {"$gt": t + timedelta(hours=2)}})
        .sort("starts_at", 1)
        .to_list(limit)
    )


def _slot_list(slots: list[dict[str, Any]]) -> str:
    return "\n".join(f"{i}. {when_text(s['starts_at'])}" for i, s in enumerate(slots, 1))


async def _wa_send(
    db,
    convo: dict[str, Any],
    u: dict[str, Any],
    site: dict[str, Any],
    text: str,
    buttons: list[tuple[str, str]] | None = None,
) -> bool:
    """A reply inside the conversation (the person wrote to us within 24 hours, so no template is needed)."""
    wa = whatsapp_for(site, u)
    p = await prefs(db, u)
    if not wa or p["opt_out"].get("whatsapp") or not p["wa_id"]:
        return False
    try:
        await wa.send_text(p["wa_id"], text, buttons)
    except P.SendError:
        log.warning("calling agent: a WhatsApp reply failed")
        return False
    await say(db, convo, "nm7", "whatsapp", text + ("".join(f"\n[{b[1]}]" for b in buttons) if buttons else ""))
    await event(db, "wa_text", u["_id"], convo)
    return True


def _yes_no(convo: dict[str, Any]) -> list[tuple[str, str]]:
    yes, no = T.YES_NO_BUTTONS.get(convo["lang"], T.YES_NO_BUTTONS["en"])
    return [(f"nm7:{convo['_id']}:yes", yes), (f"nm7:{convo['_id']}:no", no)]


async def _ask_next(db, convo, j, u, c, site, mailer=None) -> None:
    """The next knock-out question, or (all answered) the application and the interview times."""
    kos = K.for_job(j)
    step = int(convo.get("step") or 0)
    if step < len(kos):
        await _set(db, convo, state="knockout", step=step)
        q = T.msg(convo["lang"], "question", n=step + 1, of=len(kos), q=kos[step].text_in(convo["lang"]))
        await _wa_send(db, convo, u, site, q, _yes_no(convo))
        return
    await finish_questions(db, convo, j, u, c, site, "whatsapp", mailer)


async def apply_for(db, convo, j, u, channel: str) -> None:
    """The person said Interested and answered: their application to the job (with the answers and the fit label), as
    if they had applied on Nm7. Never a rejection: answers that don't fit are a "Not a fit" label for the company."""
    from app.autoapply.settings import resume_for
    from app.jobs.apply import FOLLOW_AFTER, app_key, job_page

    t = now()
    kos = K.for_job(j)
    answers = {k: v for k, v in (convo.get("answers") or {}).items() if k in {x.id for x in kos}}
    why = K.reasons(kos, answers)
    key = app_key(j["_id"])
    agent = {"convo_id": convo["_id"], "channel": channel, "at": t}
    if await db[APPLICATIONS].find_one({"user_id": u["_id"], "key": key}, {"_id": 1}):
        await db[APPLICATIONS].update_one(
            {"user_id": u["_id"], "key": key}, {"$set": {"agent": agent, "updated_at": t}}
        )
        return
    r = await resume_for(db, u["_id"])
    doc = {"key": key, "user_id": u["_id"], "company": j["company"]["name"][:120], "role": j["title"][:120], "status": "applied",
           "date": int(t.timestamp() * 1000), "resume_id": r["key"] if r else None, "resume_name": (r or {}).get("name", ""),
           "url": job_page(j), "notes": "", "next": int((t + FOLLOW_AFTER).timestamp() * 1000), "job_id": j["_id"], "channel": "nm7",
           "timeline": [{"status": "applied", "at": t}], "created_at": t, "updated_at": t, "origin": "agent", "consent_at": t,
           "answers": answers, "company_id": j["company_id"], "fit": {"ok": not why, "reasons": why}, "agent": agent}  # fmt: skip
    try:
        await db[APPLICATIONS].insert_one(doc)
        await audit(
            db,
            u["_id"],
            "job.apply",
            target=j["_id"],
            data={"method": "nm7", "title": j["title"], "via": f"agent_{channel}"},
        )
    except DuplicateKeyError:
        pass


async def finish_questions(db, convo, j, u, c, site, channel: str, mailer=None) -> None:
    await apply_for(db, convo, j, u, channel)
    why = K.reasons(K.for_job(j), convo.get("answers") or {})
    company = _company_name(c, j)
    if why:
        await _set(db, convo, state="not_fit", next_at=None)
        if channel == "whatsapp":
            await _wa_send(db, convo, u, site, T.msg(convo["lang"], "not_fit", company=company))
        return
    slots = await open_slots(db, j["_id"], now())
    if not slots:
        await _set(db, convo, state="applied", next_at=None)
        if channel == "whatsapp":
            await _wa_send(db, convo, u, site, T.msg(convo["lang"], "no_slots", company=company))
        return
    st = agent_settings(site)
    await _set(
        db,
        convo,
        state="slots",
        offered=[str(s["_id"]) for s in slots],
        next_at=now() + timedelta(hours=int(st["close_after_hours"])),
    )
    if channel == "whatsapp":
        btn = [(f"nm7:{convo['_id']}:slot:{i}", when_text(s["starts_at"])[:20]) for i, s in enumerate(slots, 1)]
        await _wa_send(db, convo, u, site, T.msg(convo["lang"], "slots", company=company, list=_slot_list(slots)), btn)


async def book(db, convo, j, u, c, site, n: int, channel: str, mailer=None) -> bool:
    """Book the n-th offered time (atomic: two people can't take one time). Moves the application to Interview and
    emails both sides the calendar file (the H5 one-tap slots flow)."""
    from app.hire import slots as H

    offered = convo.get("offered") or []
    if not 1 <= n <= len(offered):
        return False
    t = now()
    got = await db[HIRE_SLOTS].find_one_and_update(
        {"_id": ObjectId(offered[n - 1]), "status": "open", "user_id": None, "starts_at": {"$gt": t + timedelta(minutes=10)}},
        {"$set": {"status": "booked", "user_id": u["_id"], "booked_at": t, "updated_at": t, "via": f"agent_{channel}"}, "$inc": {"seq": 1}},
        return_document=True,
    )  # fmt: skip
    company = _company_name(c, j)
    if not got:
        slots = await open_slots(db, j["_id"], t)
        if channel == "whatsapp" and slots:
            await _set(db, convo, offered=[str(s["_id"]) for s in slots])
            btn = [(f"nm7:{convo['_id']}:slot:{i}", when_text(s["starts_at"])[:20]) for i, s in enumerate(slots, 1)]
            await _wa_send(db, convo, u, site, T.msg(convo["lang"], "taken", list=_slot_list(slots)), btn)
        elif not slots:
            await _set(db, convo, state="applied", next_at=None)
            if channel == "whatsapp":
                await _wa_send(db, convo, u, site, T.msg(convo["lang"], "no_slots", company=company))
        return False
    await H._set_interview(db, got, u["_id"])
    await _set(db, convo, state="booked", slot_id=str(got["_id"]), next_at=None)
    await event(db, "booked", u["_id"], convo, channel=channel)
    await audit(
        db,
        u["_id"],
        "hire.slot_book",
        target=got["company_id"],
        data={"slot": str(got["_id"]), "via": f"agent_{channel}"},
    )
    if mailer is not None:
        try:
            await H.notify(db, mailer, got, "booked")
        except Exception:  # noqa: BLE001 — the booking stands without the email
            log.warning("calling agent: the booking email failed")
    if channel == "whatsapp":
        await _wa_send(
            db,
            convo,
            u,
            site,
            T.msg(convo["lang"], "booked", role=j["title"], company=company, when=when_text(got["starts_at"])),
        )
    return True


async def _close(db, convo, state: str) -> None:
    await _set(db, convo, state=state, next_at=None)


async def start_whatsapp(db, convo, j, u, c, site, p, t) -> bool:
    wa = whatsapp_for(site, u)
    st = agent_settings(site)
    lang = convo["lang"]
    if not wa.test and not st["templates"][lang]["approved"]:
        lang = "en" if st["templates"]["en"]["approved"] else ""
    if not lang:
        return False
    params = [_first(u), j["title"][:60], _company_name(c, j)[:60], _city(j)[:40]]
    payloads = [f"nm7:{convo['_id']}:{k}" for k in T.BUTTON_KEYS]
    try:
        mid = await wa.send_template(p["wa_id"], lang, params, payloads)
    except P.SendError:
        log.warning("calling agent: a WhatsApp template failed")
        await _set(db, convo, next_at=t + timedelta(hours=1))
        return True  # try again next hour (nothing counted)
    await event(db, "wa_template", u["_id"], convo, t, lang=lang)
    await say(
        db,
        convo,
        "nm7",
        "whatsapp",
        T.template_text(lang, params) + "\n[" + "] [".join(T.TEMPLATES[lang]["buttons"]) + "]",
    )
    call_due = (
        t + timedelta(hours=int(st["call_after_hours"])) if p.get("call") and not p["opt_out"].get("call") else None
    )
    await _set(db, convo, state="asked", wa={"template_at": t, "msg_id": mid, "lang": lang}, call_due_at=call_due,
               next_at=call_due or t + timedelta(hours=int(st["close_after_hours"])))  # fmt: skip
    return True


def call_script(convo, j, u, c, slots: list[dict[str, Any]]) -> dict[str, Any]:
    lang = convo["lang"]
    s = T.CALL.get(lang) or T.CALL["en"]
    company = _company_name(c, j)
    return {
        "intro": T.fill(s["intro"], name=_first(u), role=j["title"], company=company, city=_city(j)),
        "interest": s["interest"],
        "questions": [T.fill(s["question"], q=k.text_in(lang)) for k in K.for_job(j)],
        "question_ids": [k.id for k in K.for_job(j)],
        "slots": [when_text(x["starts_at"]) for x in slots],
        "slots_line": T.fill(s["slots"], company=company, list="; ".join(f"{i}: {when_text(x['starts_at'])}" for i, x in enumerate(slots, 1))) if slots else "",
        "booked": s["booked"], "bye": s["bye"], "stopped": s["stopped"],
    }  # fmt: skip


async def start_call(db, convo, j, u, c, site, p, t) -> bool:
    vo = voice_for(site, u)
    slots = await open_slots(db, j["_id"], t)
    script = call_script(convo, j, u, c, slots)
    try:
        ref = await vo.start_call(p["wa_id"], convo["lang"], script, convo["_id"])
    except P.SendError:
        log.warning("calling agent: starting a call failed")
        await _set(db, convo, next_at=t + timedelta(hours=1))
        return True
    await event(db, "call", u["_id"], convo, t, lang=convo["lang"])
    await _set(db, convo, state="calling", call={"ref": ref, "at": t, "status": "started", "prev": convo["state"]},
               offered=[str(x["_id"]) for x in slots], next_at=t + CALL_WAIT)  # fmt: skip
    return True


async def advance(db, convo: dict[str, Any], site: dict[str, Any], t: datetime, mailer=None) -> str:
    """One due step of one conversation. → what happened (a counts key)."""
    st = agent_settings(site)
    j, u, c = await _ctx(db, convo)
    if not j or not u or j.get("status") != "active" or not job_on(j):
        await _close(db, convo, "closed")
        return "closed"
    if not pair_ok(u, c, site):
        await _close(db, convo, "skipped")
        return "switch_off"
    p = await prefs(db, u)
    if convo["state"] == "queued":
        tried = []
        for ch in ("whatsapp", "call"):
            why = await blocker(db, u, p, ch, t, st, site)
            if why is None:
                ok = await (start_whatsapp if ch == "whatsapp" else start_call)(db, convo, j, u, c, site, p, t)
                if ok:
                    return f"started_{ch}"
                why = "no_template"
            tried.append(why)
        later = [w for w in tried if w in ("quiet_hours", "quiet_day", "daily_cap")]
        if later:
            nxt = next_allowed(
                t
                if "daily_cap" not in later
                else datetime.combine((t.astimezone(IST) + timedelta(days=1)).date(), time(0, 0), IST),
                st,
                p["quiet_days"],
            )
            await _set(db, convo, next_at=nxt)
            return f"later_{later[0]}"
        await _set(db, convo, state="skipped", next_at=None, reason=tried[0] if tried else "")
        return "skipped"
    if (
        convo["state"] == "asked"
        and convo.get("call_due_at")
        and not convo.get("replied_at")
        and not (convo.get("call") or {}).get("ref")
    ):
        why = await blocker(db, u, p, "call", t, st, site)
        if why is None:
            await start_call(db, convo, j, u, c, site, p, t)
            return "started_call"
        if why in ("quiet_hours", "quiet_day", "daily_cap") and t < convo["created_at"] + timedelta(
            hours=int(st["close_after_hours"])
        ):
            nxt = next_allowed(
                t
                if why != "daily_cap"
                else datetime.combine((t.astimezone(IST) + timedelta(days=1)).date(), time(0, 0), IST),
                st,
                p["quiet_days"],
            )
            await _set(db, convo, next_at=nxt)
            return f"later_{why}"
        await _set(
            db,
            convo,
            call_due_at=None,
            next_at=(convo.get("wa") or {}).get("template_at", t) + timedelta(hours=int(st["close_after_hours"])),
        )
        return "no_call"
    await _close(db, convo, "no_reply")  # waited long enough (or the call never reported back)
    return "no_reply"


# --- replies -----------------------------------------------------------------------------------------------------------


async def _user_by_wa(db, phone: str) -> dict[str, Any] | None:
    p = await db[TRUST_AGENT_PREFS].find_one({"wa_id": wa_id(phone)}, {"_id": 1})
    return await db[USERS].find_one({"_id": p["_id"]}, USER_FIELDS) if p else None


async def on_whatsapp(db, inb: P.Inbound, mailer=None) -> str:
    """One message the person sent us on WhatsApp. → what happened."""
    from app.site import get_site
    from app.trust.agent import understand

    if inb.msg_id and await db[TRUST_AGENT_EVENTS].find_one({"msg_id": inb.msg_id}, {"_id": 1}):
        return "duplicate"  # Meta retries webhooks
    u = await _user_by_wa(db, inb.phone)
    if not u:
        return "unknown_number"
    site = await get_site(db)
    t = now()
    m = re.fullmatch(r"nm7:([0-9a-f]{24}):(\w+)(?::(\d))?", inb.payload or "")
    convo = None
    if m:
        convo = await db[TRUST_AGENT_CONVOS].find_one({"_id": m.group(1), "user_id": u["_id"]})
    if not convo:
        convo = await db[TRUST_AGENT_CONVOS].find_one(
            {"user_id": u["_id"], "state": {"$in": list(WAITING)}}, sort=[("updated_at", -1)]
        )
    await event(db, "reply", u["_id"], convo, t, msg_id=inb.msg_id or None)
    if convo:
        await say(
            db, convo, "candidate", "whatsapp", inb.text or (" ".join(x for x in m.groups()[1:] if x) if m else ""), t
        )
    action = m.group(2) if m else ""
    if action == "stop" or T.is_stop(inb.text):
        return await _stop_whatsapp(db, u, site, convo, "button" if action == "stop" else "words")
    if not convo or convo["state"] not in WAITING:
        return "no_open_conversation"
    if not convo.get("replied_at"):
        await _set(db, convo, replied_at=t)
    j, _, c = await _ctx(db, convo)
    if not j or j.get("status") != "active":
        await _close(db, convo, "closed")
        await _wa_send(db, convo, u, site, T.msg(convo["lang"], "closed"))
        return "closed"
    expecting = {"asked": "interest", "knockout": "yesno", "slots": "slot"}[convo["state"]]
    slot = int(m.group(3)) if m and m.group(3) else 0
    if action in ("interested", "not_now", "yes", "no"):
        intent = action
    elif action == "slot":
        intent = "slot"
    else:
        intent, slot, _by = await understand.intent(db, u["_id"], inb.text, expecting)
    if intent == "stop":
        return await _stop_whatsapp(db, u, site, convo, "ai")
    st = agent_settings(site)
    if convo["state"] == "asked":
        if intent in ("interested", "yes"):
            await _set(
                db,
                convo,
                interest="interested",
                call_due_at=None,
                next_at=t + timedelta(hours=int(st["close_after_hours"])),
                reasks=0,
            )
            await _ask_next(db, convo, j, u, c, site, mailer)
            return "interested"
        if intent in ("not_now", "no"):
            await _set(db, convo, interest="not_now", state="declined", next_at=None)
            await _wa_send(db, convo, u, site, T.msg(convo["lang"], "not_now"))
            return "declined"
        return await _unclear(
            db,
            convo,
            u,
            site,
            "interest",
            [
                (f"nm7:{convo['_id']}:interested", "Interested"),
                (f"nm7:{convo['_id']}:not_now", T.TEMPLATES[convo["lang"]]["buttons"][1]),
            ],
        )
    if convo["state"] == "knockout":
        if intent in ("yes", "no", "interested", "not_now"):
            kos = K.for_job(j)
            step = int(convo.get("step") or 0)
            if step < len(kos):
                ans = "yes" if intent in ("yes", "interested") else "no"
                await _set(db, convo, **{f"answers.{kos[step].id}": ans}, step=step + 1, reasks=0)
                convo["answers"] = {**(convo.get("answers") or {}), kos[step].id: ans}
            await _ask_next(db, convo, j, u, c, site, mailer)
            return "answered"
        return await _unclear(db, convo, u, site, "yes_no", _yes_no(convo))
    if intent == "slot" and slot:
        return "booked" if await book(db, convo, j, u, c, site, slot, "whatsapp", mailer) else "slot_not_booked"
    if intent in ("none", "no", "not_now"):
        await _set(db, convo, state="applied", next_at=None)
        await _wa_send(db, convo, u, site, T.msg(convo["lang"], "none_suits", company=_company_name(c, j)))
        return "no_slot"
    return await _unclear(db, convo, u, site, "slot_pick", None)


async def _unclear(db, convo, u, site, options_key: str, buttons) -> str:
    if int(convo.get("reasks") or 0) >= REASKS:
        return "unclear_ignored"  # no endless loop: the conversation times out
    await _set(db, convo, reasks=int(convo.get("reasks") or 0) + 1)
    await _wa_send(
        db, convo, u, site, T.msg(convo["lang"], "unclear", options=T.msg(convo["lang"], options_key)), buttons
    )
    return "unclear"


async def _stop_whatsapp(db, u, site, convo, how: str) -> str:
    """Stop: WhatsApp off for every job at once, confirmed in one last message, never messaged again until they turn it
    back on. Their open conversations end (a call that was due is cancelled too)."""
    lang = (convo or {}).get("lang") or (await prefs(db, u))["lang"]
    wa = whatsapp_for(site, u)
    p = await prefs(db, u)
    await opt_out(db, u["_id"], "whatsapp", how)
    t = now()
    await db[TRUST_AGENT_CONVOS].update_many(
        {"user_id": u["_id"], "state": {"$in": list(OPEN)}},
        {"$set": {"state": "stopped", "next_at": None, "updated_at": t}},
    )
    if wa and p["wa_id"]:
        text = T.msg(lang, "stopped")
        try:
            await wa.send_text(p["wa_id"], text)
            if convo:
                await say(db, convo, "nm7", "whatsapp", text)
        except P.SendError:
            log.warning("calling agent: the stop confirmation failed (the stop stands)")
    return "stopped"


async def on_call(db, res: P.CallResult, ref_hint: str = "", mailer=None) -> str:
    """The voice provider's result for one call."""
    from app.site import get_site

    convo = await db[TRUST_AGENT_CONVOS].find_one({"call.ref": res.ref}) if res.ref else None
    if not convo and ref_hint:
        convo = await db[TRUST_AGENT_CONVOS].find_one({"_id": ref_hint, "state": "calling"})
    if not convo:
        return "unknown_call"
    if (convo.get("call") or {}).get("status") not in (None, "started"):
        return "duplicate"
    site = await get_site(db)
    j, u, c = await _ctx(db, convo)
    if not u:
        return "unknown_call"
    t = now()
    await db[TRUST_AGENT_CONVOS].update_one(
        {"_id": convo["_id"]}, {"$set": {"call.status": res.status, "call.minutes": res.minutes, "call.done_at": t}}
    )
    convo["call"] = {**(convo.get("call") or {}), "status": res.status}
    await event(db, "call_done", u["_id"], convo, t, status=res.status, minutes=res.minutes)
    for turn in res.transcript:
        await say(db, convo, "nm7" if turn["who"] == "agent" else "candidate", "call", turn["text"], t)
    said_stop = res.interest == "stop" or any(
        turn["who"] == "candidate" and T.is_stop(turn["text"]) for turn in res.transcript
    )
    if said_stop:
        await opt_out(db, u["_id"], "call", "call")
        await db[TRUST_AGENT_CONVOS].update_many(
            {"user_id": u["_id"], "state": {"$in": list(OPEN)}}, {"$set": {"call_due_at": None}}
        )  # no more calls
        await _close(db, convo, "stopped")
        return "stopped"
    if res.status != "completed" or not res.interest:
        await _close(db, convo, "no_reply")
        return "no_reply"
    if not j or j.get("status") != "active":
        await _close(db, convo, "closed")
        return "closed"
    if res.interest != "interested":
        await _set(db, convo, interest="not_now", state="declined", next_at=None)
        return "declined"
    kos = K.for_job(j)
    answers = {k.id: res.answers[k.id] for k in kos if k.id in res.answers}
    await _set(db, convo, interest="interested", answers=answers, replied_at=t, step=len(answers))
    await apply_for(db, convo, j, u, "call")
    if K.reasons(kos, answers):
        await _close(db, convo, "not_fit")
        return "not_fit"
    if res.slot and await book(db, convo, j, u, c, site, res.slot, "call", mailer):
        return "booked"
    await _close(db, convo, "applied")
    return "applied"


# --- the pass ------------------------------------------------------------------------------------------------------------


async def run(db, mailer=None, t: datetime | None = None, force: bool = False) -> dict[str, int]:
    """Every automation pass (and right after a company turns it on): pick people for waiting jobs, then the due steps
    (memory-safe: heavy lease, caps per pass, small batches)."""
    from app.core.heavy import heavy_or_skip
    from app.site import get_site

    t = t or now()
    counts: dict[str, int] = {}
    if not force:
        has_work = await db[JOBS].find_one({"agent.state": "pending"}, {"_id": 1}) or await db[
            TRUST_AGENT_CONVOS
        ].find_one({"state": {"$in": list(OPEN)}, "next_at": {"$lte": t}}, {"_id": 1})
        if not has_work:
            return counts
    async with heavy_or_skip(db) as ok:
        if not ok and not force:
            return {"waiting_heavy": 1}
        site = await get_site(db)
        budget = {"scan": SCAN_PER_PASS}
        await db[JOBS].update_many({"agent.state": "pending", "status": "closed"}, {"$set": {"agent.state": "done"}})
        async for j in (
            db[JOBS]
            .find({"agent.state": "pending", "status": "active"})
            .sort("agent.queued_at", 1)
            .limit(JOBS_PER_PASS)
        ):
            if budget["scan"] <= 0:
                break
            counts["selected"] = counts.get("selected", 0) + await select(db, j, site, budget, t)
        due = (
            await db[TRUST_AGENT_CONVOS]
            .find({"state": {"$in": list(OPEN)}, "next_at": {"$lte": t}})
            .sort("next_at", 1)
            .limit(CONTACTS_PER_PASS)
            .to_list(CONTACTS_PER_PASS)
        )
        for convo in due:
            try:
                k = await advance(db, convo, site, t, mailer)
            except Exception:  # noqa: BLE001 — one conversation's problem never stops the pass
                log.exception("calling agent: one step failed")
                k = "error"
            counts[k] = counts.get(k, 0) + 1
    return counts


async def kick(db, mailer=None) -> dict[str, int]:
    """The background task after a company turns it on (never inside the company's request)."""
    try:
        return await run(db, mailer)
    except Exception:  # noqa: BLE001
        log.exception("calling agent: the pass after a toggle failed")
        return {"error": 1}


# --- views ---------------------------------------------------------------------------------------------------------------


async def job_status(db, j: dict[str, Any]) -> dict[str, Any]:
    """The company's live status for one job: counts, and for people who said Interested their answers and booked time.
    Never transcripts, never audio, never anyone's phone."""
    counts: dict[str, int] = {}
    people = []
    rows = await db[TRUST_AGENT_CONVOS].find({"job_id": j["_id"]}).sort("updated_at", -1).to_list(500)
    kos = K.for_job(j)
    slot_ids = [ObjectId(r["slot_id"]) for r in rows if r.get("slot_id")]
    slots = {str(s["_id"]): s async for s in db[HIRE_SLOTS].find({"_id": {"$in": slot_ids}}, {"starts_at": 1})}
    names = {
        u["_id"]: u.get("name") or ""
        async for u in db[USERS].find(
            {"_id": {"$in": [r["user_id"] for r in rows if r.get("interest") == "interested"]}}, {"name": 1}
        )
    }
    for r in rows:
        counts[r["state"]] = counts.get(r["state"], 0) + 1
        if r.get("interest") == "interested":
            s = slots.get(r.get("slot_id") or "")
            people.append({"name": names.get(r["user_id"], ""), "state": r["state"], "stateText": STATE_TEXT.get(r["state"], r["state"]),
                           "answers": K.company_out(kos, r.get("answers") or {}), "slotAt": ms(s["starts_at"]) if s else None,
                           "fit": not K.reasons(kos, r.get("answers") or {}), "updatedAt": ms(r["updated_at"])})  # fmt: skip
    contacted = sum(n for k, n in counts.items() if k not in ("queued", "skipped", "closed"))
    ag = j.get("agent") or {}
    return {
        "on": job_on(j), "picking": ag.get("state") == "pending", "selected": len(rows), "contacted": contacted,
        "interested": len(people), "booked": counts.get("booked", 0), "declined": counts.get("declined", 0),
        "stopped": counts.get("stopped", 0), "waiting": sum(counts.get(k, 0) for k in OPEN), "people": people,
        "knockouts": [{"id": k.id, "text": k.text, "want": k.want, "source": k.source} for k in kos],
        "extra": [{"text": q["text"], "want": q["want"]} for q in j.get("knockouts") or []],
    }  # fmt: skip


async def what_we_said(db, uid: str) -> list[dict[str, Any]]:
    rows = (
        await db[TRUST_AGENT_CONVOS]
        .find({"user_id": uid, "state": {"$ne": "skipped"}})
        .sort("updated_at", -1)
        .to_list(50)
    )
    jobs = {
        j["_id"]: j
        async for j in db[JOBS].find({"_id": {"$in": [r["job_id"] for r in rows]}}, {"title": 1, "company.name": 1})
    }
    out = []
    for r in rows:
        lines = await db[TRUST_AGENT_LOGS].find({"convo_id": r["_id"]}).sort("created_at", 1).to_list(200)
        j = jobs.get(r["job_id"]) or {}
        out.append({"id": r["_id"], "role": j.get("title", ""), "company": (j.get("company") or {}).get("name", ""), "state": r["state"],
                    "stateText": STATE_TEXT.get(r["state"], r["state"]), "at": ms(r["updated_at"]),
                    "lines": [{"who": x["who"], "channel": x["channel"], "text": x["text"], "at": ms(x["created_at"])} for x in lines]})  # fmt: skip
    return out


async def counts(db, since: datetime) -> dict[str, Any]:
    out: dict[str, Any] = {}
    async for r in await db[TRUST_AGENT_EVENTS].aggregate(
        [
            {"$match": {"at": {"$gte": since}}},
            {"$group": {"_id": "$kind", "n": {"$sum": 1}, "min": {"$sum": {"$ifNull": ["$minutes", 0]}}}},
        ]
    ):
        out[r["_id"]] = r["n"]
        if r["_id"] == "call_done":
            out["call_minutes"] = round(r["min"], 1)
    replied = len(await db[TRUST_AGENT_CONVOS].distinct("_id", {"replied_at": {"$gte": since}}))
    return {"sent": out.get("wa_template", 0), "replied": replied, "calls": out.get("call", 0), "callMinutes": out.get("call_minutes", 0),
            "booked": out.get("booked", 0), "optOuts": out.get("optout_whatsapp", 0) + out.get("optout_call", 0)}  # fmt: skip
