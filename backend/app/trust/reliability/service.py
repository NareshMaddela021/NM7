# ruff: noqa: E501  (dense texts and response lines)
"""Vetting Trust T15: the reliability record — did the person show up to interviews, join, and stay 30 and 90 days,
as confirmed by employers. Only with its own consent ("reliability_record"): without it nothing is stored and
companies see nothing. A signal, never a gate: it never ranks, hides or rejects anyone, Hire now has no filter on it,
and "No history yet" is never a negative.

Where the records come from (each is one row in trust_reliability, _id = kind:ref, so a corrected mark replaces it):
  interview  the company's Attended / No-show on a booked interview time (H5 Hire → Interview times, or the one-tap
             email the company gets after the interview time: "Did <first name> come?")
  join       H6 "Joined" (Hire → Offers, the T11 joining-day links): the company's answer; the candidate's own "I've
             joined" until the company answers; a candidate who says they won't join (with a reason) in their own words
  stay30 / stay90   30 and 90 days after an employer-confirmed join, the company gets a one-tap "Still working here?"
             email (and the candidate a WhatsApp / email to confirm it themselves); the company's answer wins
A "no" from a company is not counted at once: the candidate gets WINDOW (48 h) to say what happened, by WhatsApp /
email with a one-tap link and on My hiring. "I had an emergency" (or for staying: "the company let me go / the job
ended") → excused, not counted; "the company cancelled" / "I was there" / "I'm still working there" → disputed, and a
person at Nm7 decides (Admin → Vetting Trust → Work tests & reliability). After the window a "no" counts, and can
still be disputed within DISPUTE_DAYS. Companies see only the summary ("Showed up 4/4 · Joined 2/2 · Stayed 90 days
1/1", "confirmed by employers"), never which company said what.

Behind the Vetting Trust switch: the hooks and the pass only act for people the switch lets in who gave the consent;
background messages follow T11's rules (testers only while the switch is OFF, never demo accounts; WhatsApp only with
the calls_whatsapp consent, outside quiet hours).
"""

import logging
from datetime import date, datetime, timedelta
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId

from app.audit import audit
from app.core.db import COMPANIES, HIRE_OFFERS, HIRE_SLOTS, JOBS, TRUST_CONSENTS, TRUST_RELIABILITY, USERS
from app.core.errors import ApiError
from app.core.time import IST, now
from app.me.service import ms
from app.trust import access
from app.trust import consent as C
from app.trust import retention as R

log = logging.getLogger("nm7.trust.reliability")

PURPOSE = "reliability_record"
WINDOW = timedelta(hours=48)
DISPUTE_DAYS = 30
ASK_DAYS = 3  # the company's one-tap attendance email goes out up to this long after the interview time
STAY_DAYS = (30, 90)
PER_PASS = 100
KINDS = {"interview": "Showed up", "join": "Joined", "stay30": "Stayed 30 days", "stay90": "Stayed 90 days"}
NO_HISTORY = "No history yet"
STATES = ("counted", "waiting", "excused", "disputed", "removed")
WHY = {  # the candidate's answer → what happens
    "emergency": ("excused", "I had an emergency"),
    "job_ended": ("excused", "The company let me go / the job ended"),
    "company_cancelled": ("disputed", "The company cancelled or moved it"),
    "was_there": ("disputed", "I was there / I did join"),
    "still_working": ("disputed", "I’m still working there"),
    "other": ("disputed", "Something else"),
}
SAID_NO = {"interview": "you didn’t come to the interview", "join": "you didn’t join", "stay30": "you are no longer working there",
           "stay90": "you are no longer working there"}  # fmt: skip

C.add_purpose(C.Purpose(PURPOSE, "Reliability record (interviews, joining, staying)",
    "When you go to an interview or join a job through Nm7, the company tells us in one tap whether you came, whether you joined, and whether you are still "
    "working there after 30 and 90 days. Companies hiring on Nm7 then see a short summary such as “Showed up 4/4 · Joined 2/2”, never which company said what. "
    "If a company says you didn’t come, you get 48 hours to tell us why first (for example an emergency, or the company cancelled), and you can dispute any "
    "record: a person at Nm7 checks it. Having no history is never held against you, and nobody is turned down because of this. We keep it for {days} days. "
    "If you take this back, your record is deleted now and companies see nothing.", 1, "reliability"))  # fmt: skip
R.register(R.DataType("reliability", "Reliability record (showed up, joined, stayed 30 / 90 days; employers’ and your answers)", 730, 365, 1095,
                      TRUST_RELIABILITY, field="at", purpose=PURPOSE, note="Deleted by the daily job, or now when the consent is taken back"))  # fmt: skip


async def allowed(db, uid: str | None) -> bool:
    return bool(uid) and await access.for_user(db, uid) and await C.has(db, uid, PURPOSE)


def _rid(kind: str, ref: str) -> str:
    return f"{kind}:{ref}"


# --- writing records ---------------------------------------------------------------------------------------------------


async def put(db, kind: str, ref: str, *, user_id: str, company_id: str | None, job_id: str | None, outcome: str, source: str,
              note: str = "", t: datetime | None = None, mailer=None) -> dict[str, Any] | None:  # fmt: skip
    """One record (kind:ref). An employer's answer replaces the candidate's; the candidate's never replaces an employer's.
    An employer's "no" waits WINDOW for the candidate's side. Nothing is stored without the consent."""
    assert kind in KINDS and outcome in ("yes", "no") and source in ("employer", "candidate")
    if not await allowed(db, user_id):
        return None
    t = t or now()
    rid = _rid(kind, ref)
    old = await db[TRUST_RELIABILITY].find_one({"_id": rid})
    if old and old.get("source") == "employer" and source == "candidate":
        return old
    if old and old.get("outcome") == outcome and old.get("source") == source:
        return old  # the same answer again
    waiting = outcome == "no" and source == "employer"
    doc = {"user_id": user_id, "company_id": company_id, "job_id": job_id, "kind": kind, "ref": ref, "outcome": outcome, "source": source,
           "state": "waiting" if waiting else "counted", "respond_by": t + WINDOW if waiting else None, "reply": None, "dispute": None,
           "review": None, "note": note[:300], "at": t, "updated_at": t}  # fmt: skip
    await db[TRUST_RELIABILITY].update_one({"_id": rid}, {"$set": doc}, upsert=True)
    doc["_id"] = rid
    if waiting:
        await _tell_candidate(db, doc, mailer, t)
    return doc


async def clear(db, kind: str, ref: str) -> None:
    await db[TRUST_RELIABILITY].delete_one({"_id": _rid(kind, ref)})


async def on_attendance(db, s: dict[str, Any], result: str, cid: str, mailer=None) -> None:
    """H5 Attended / No-show (any path)."""
    uid = s.get("user_id")
    if not uid:
        return
    if result == "clear":
        await clear(db, "interview", str(s["_id"]))
        return
    await put(db, "interview", str(s["_id"]), user_id=uid, company_id=cid, job_id=s.get("job_id"),
              outcome="yes" if result == "attended" else "no", source="employer", mailer=mailer)  # fmt: skip


async def on_join(db, o: dict[str, Any], side: str, joined: bool, reason: str = "", mailer=None) -> None:
    """H6 Joined / didn't join (any path, either side)."""
    await put(db, "join", str(o["_id"]), user_id=o["user_id"], company_id=o.get("company_id"), job_id=o.get("job_id"),
              outcome="yes" if joined else "no", source="employer" if side == "company" else "candidate", note=reason, mailer=mailer)  # fmt: skip


async def on_stay(
    db, o: dict[str, Any], days: int, working: bool, side: str, reason: str = "", mailer=None
) -> dict[str, Any] | None:
    return await put(db, f"stay{days}", str(o["_id"]), user_id=o["user_id"], company_id=o.get("company_id"), job_id=o.get("job_id"),
                     outcome="yes" if working else "no", source="employer" if side == "company" else "candidate", note=reason, mailer=mailer)  # fmt: skip


# --- the candidate's side ------------------------------------------------------------------------------------------------


async def _record(db, uid: str, rid: str) -> dict[str, Any]:
    r = await db[TRUST_RELIABILITY].find_one({"_id": rid, "user_id": uid})
    if not r:
        raise ApiError(404, "not_found", "That record isn’t here.")
    return r


def can_explain(r: dict[str, Any], t: datetime) -> bool:
    return r["state"] == "waiting" and bool(r.get("respond_by")) and _aware(r["respond_by"]) > t


def can_dispute(r: dict[str, Any], t: datetime) -> bool:
    return r["outcome"] == "no" and (
        r["state"] == "waiting"
        or (r["state"] == "counted" and _aware(r["updated_at"]) > t - timedelta(days=DISPUTE_DAYS))
    )


def _aware(v: datetime) -> datetime:
    from datetime import UTC

    return v if v.tzinfo else v.replace(tzinfo=UTC)


async def answer(
    db, uid: str, rid: str, why: str, text: str = "", via: str = "settings", t: datetime | None = None
) -> dict[str, Any]:
    """The candidate's side of a "no": an excuse (within the 48 hours) or a dispute (a person at Nm7 decides)."""
    t = t or now()
    if why not in WHY:
        raise ApiError(400, "why", "Choose what happened.")
    r = await _record(db, uid, rid)
    state, label = WHY[why]
    if state == "excused" and not can_explain(r, t):
        raise ApiError(
            409,
            "too_late",
            "The 48 hours to explain have passed. You can still dispute it, and a person at Nm7 will check.",
        )
    if state == "disputed" and not can_dispute(r, t):
        raise ApiError(409, "closed", "This record can’t be disputed any more.")
    if why == "other" and len(text.strip()) < 5:
        raise ApiError(400, "reason", "Tell us in a few words what happened.")
    reply = {"why": why, "label": label, "text": text.strip()[:500], "at": t, "via": via}
    sets: dict[str, Any] = {"state": state, "updated_at": t, "reply" if state == "excused" else "dispute": reply}
    await db[TRUST_RELIABILITY].update_one({"_id": rid}, {"$set": sets})
    await audit(db, uid, f"trust.reliability_{state}", target=uid, data={"record": rid, "why": why, "via": via})
    return {**r, **sets}


async def confirm_stay(db, uid: str, oid: str, days: int, t: datetime | None = None) -> dict[str, Any]:
    """The candidate confirms "I'm still working there" (an employer's answer, when it comes, replaces it)."""
    t = t or now()
    o = await _offer(db, oid)
    if o["user_id"] != uid:
        raise ApiError(404, "not_found", "That job isn’t here.")
    if days not in STAY_DAYS or not stay_due(o, days, t):
        raise ApiError(409, "not_yet", f"You can confirm this {days} days after you joined.")
    r = await on_stay(db, o, days, True, "candidate")
    if r is None:
        raise ApiError(403, "consent_needed", "Please agree to “Reliability record” first.")
    return r


async def _offer(db, oid: str) -> dict[str, Any]:
    try:
        o = await db[HIRE_OFFERS].find_one({"_id": ObjectId(oid)})
    except (InvalidId, TypeError):
        o = None
    if not o:
        raise ApiError(404, "not_found", "That job isn’t here.")
    return o


def stay_due(o: dict[str, Any], days: int, t: datetime) -> bool:
    if o.get("status") != "joined" or not o.get("join_date"):
        return False
    return date.fromisoformat(o["join_date"]) + timedelta(days=days) <= t.astimezone(IST).date()


# --- reading: the summary for companies, the candidate's own page ----------------------------------------------------------


def summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """{text, lines, source, empty}: only counted records; waiting, excused, disputed and removed ones never show."""
    n: dict[str, list[int]] = {k: [0, 0] for k in KINDS}
    sources = set()
    for r in rows:
        if r.get("state") != "counted":
            continue
        n[r["kind"]][1] += 1
        n[r["kind"]][0] += int(r["outcome"] == "yes")
        sources.add(r["source"])
    lines = [f"{KINDS[k]} {y}/{of}" for k, (y, of) in n.items() if of]
    if not lines:
        return {"text": NO_HISTORY, "lines": [], "source": "", "empty": True}
    src = ("confirmed by employers" if sources == {"employer"} else "confirmed by employers and the candidate" if "employer" in sources
           else "told by the candidate")  # fmt: skip
    return {"text": " · ".join(lines), "lines": lines, "source": src, "empty": False}


async def consented(db, uids: list[str]) -> set[str]:
    """Who of these gave the reliability consent (the current text version, not taken back): one query."""
    p = C.PURPOSES[PURPOSE]
    latest: dict[str, dict[str, Any]] = {}
    async for r in db[TRUST_CONSENTS].find({"user_id": {"$in": uids}, "purpose": PURPOSE}).sort("granted_at", 1):
        latest[r["user_id"]] = r
    return {u for u, r in latest.items() if C.status_of(r, p) == "granted"}


async def for_hire(db, uids: list[str]) -> dict[str, dict[str, Any]]:
    """{uid: summary} for the people who agreed; nobody else is in it (the company sees nothing for them)."""
    ok = await consented(db, uids) if uids else set()
    rows: dict[str, list[dict[str, Any]]] = {u: [] for u in ok}
    if ok:
        async for r in db[TRUST_RELIABILITY].find(
            {"user_id": {"$in": list(ok)}}, {"user_id": 1, "kind": 1, "outcome": 1, "state": 1, "source": 1}
        ):
            rows[r["user_id"]].append(r)
    return {u: summary(rs) for u, rs in rows.items()}


async def _names(db, company_id: str | None, job_id: str | None) -> tuple[str, str]:
    c = await db[COMPANIES].find_one({"_id": company_id}, {"details.legal_name": 1}) if company_id else None
    j = await db[JOBS].find_one({"_id": job_id}, {"title": 1}) if job_id else None
    return ((c or {}).get("details") or {}).get("legal_name") or "The company", (j or {}).get("title") or ""


async def item_out(db, r: dict[str, Any], t: datetime) -> dict[str, Any]:
    company, role = await _names(db, r.get("company_id"), r.get("job_id"))
    return {"id": r["_id"], "kind": r["kind"], "what": KINDS[r["kind"]], "outcome": r["outcome"], "source": r["source"], "state": r["state"],
            "company": company, "role": role, "at": ms(r["at"]), "respondBy": ms(r.get("respond_by")), "canExplain": can_explain(r, t),
            "canDispute": can_dispute(r, t) and r["state"] != "disputed", "reply": (r.get("reply") or {}).get("label"),
            "dispute": (r.get("dispute") or {}).get("label"), "review": (r.get("review") or {}).get("decision")}  # fmt: skip


async def stays_to_confirm(db, uid: str, t: datetime) -> list[dict[str, Any]]:
    out = []
    async for o in (
        db[HIRE_OFFERS]
        .find({"user_id": uid, "status": "joined"}, {"company_name": 1, "title": 1, "join_date": 1, "status": 1})
        .limit(20)
    ):
        for d in STAY_DAYS:
            if stay_due(o, d, t) and not await db[TRUST_RELIABILITY].find_one(
                {"_id": _rid(f"stay{d}", str(o["_id"]))}, {"_id": 1}
            ):
                out.append(
                    {
                        "offer": str(o["_id"]),
                        "days": d,
                        "company": o.get("company_name") or "",
                        "role": o.get("title") or "",
                        "joinDate": o["join_date"],
                    }
                )
    return out


async def mine(db, uid: str, t: datetime | None = None) -> dict[str, Any]:
    t = t or now()
    from app.site import get_site

    site = await get_site(db)
    rows = await C.current(db, uid)
    p = C.PURPOSES[PURPOSE]
    status = C.status_of(rows.get(PURPOSE), p)
    recs = await db[TRUST_RELIABILITY].find({"user_id": uid}).sort("at", -1).to_list(200) if status == "granted" else []
    return {"consent": {"purpose": PURPOSE, "title": p.title, "text": C.text_of(p, site), "status": status},
            "summary": summary(recs), "items": [await item_out(db, r, t) for r in recs],
            "stays": await stays_to_confirm(db, uid, t) if status == "granted" else [],
            "why": {k: v[1] for k, v in WHY.items()}, "windowHours": int(WINDOW.total_seconds() // 3600)}  # fmt: skip


# --- messages -------------------------------------------------------------------------------------------------------------


async def _tell_candidate(db, r: dict[str, Any], mailer, t: datetime) -> dict[str, str]:
    """The 48-hour chance to say what happened: WhatsApp (T11 rules) and email, with the one-tap link."""
    from app.site import get_site
    from app.trust.agent import service as A
    from app.trust.booking import service as BK
    from app.trust.booking import texts as TX

    site = await get_site(db)
    u = await db[USERS].find_one({"_id": r["user_id"]}, A.USER_FIELDS)
    if not u:
        return {}
    company, _ = await _names(db, r.get("company_id"), r.get("job_id"))
    link = await BK.link_for(
        db,
        "rel_me",
        user_id=u["_id"],
        company_id=r.get("company_id") or "",
        offer_id="record",
        source="t15",
        until=t + timedelta(days=14),
    )
    lang = (await A.prefs(db, u))["lang"]
    params = [A._first(u), SAID_NO[r["kind"]], company, BK.url_for(link)]
    out = {"wa": await BK._wa(db, site, u, "rel_reply", params, t)}
    out["email"] = await BK._mail(db, mailer, site, u.get("email", ""), u.get("name", ""), TX.subject(lang, "rel_reply", company=company),
                                  TX.render(lang, "rel_reply", params), u["_id"], "rel_reply", demo=bool(u.get("demo")))  # fmt: skip
    await db[TRUST_RELIABILITY].update_one({"_id": r["_id"]}, {"$set": {"told": {**out, "at": t}}})
    return out


# --- the pass: waiting "no"s that were not answered, the company's one-tap questions ------------------------------------------


async def settle(db, t: datetime) -> int:
    """A "no" whose 48 hours passed without an answer counts now."""
    r = await db[TRUST_RELIABILITY].update_many(
        {"state": "waiting", "respond_by": {"$lt": t}}, {"$set": {"state": "counted", "updated_at": t, "settled": True}}
    )
    return r.modified_count


async def _company_mail(db, mailer, site, to: str, subject: str, text: str, uid: str, what: str, demo: bool) -> str:
    from app.trust.booking import service as BK

    return await BK._mail(db, mailer, site, to, "", subject, text, uid, what, demo=demo)


async def ask_attendance(db, site: dict[str, Any], mailer, t: datetime, scope: dict[str, Any]) -> dict[str, int]:
    """After a booked interview's time: the company gets one email with a one-tap Attended / No-show (once)."""
    from app.trust.agent import service as A
    from app.trust.booking import service as BK

    out: dict[str, int] = {}
    q = {**scope, "status": "booked", "mark": {"$in": [None, ""]}, "t15.asked": {"$exists": False}, "by": {"$nin": [None, ""]},
         "starts_at": {"$lt": t, "$gt": t - timedelta(days=ASK_DAYS)}}  # fmt: skip
    async for s in db[HIRE_SLOTS].find(q).limit(PER_PASS):
        if s["starts_at"] + timedelta(minutes=int(s.get("minutes") or 30)) > t or not await allowed(db, s["user_id"]):
            continue
        if not (
            await db[HIRE_SLOTS].update_one(
                {"_id": s["_id"], "t15.asked": {"$exists": False}}, {"$set": {"t15.asked": t}}
            )
        ).modified_count:
            continue
        u = await db[USERS].find_one({"_id": s["user_id"]}, {"name": 1})
        c = await db[COMPANIES].find_one({"_id": s["company_id"]}, {"demo": 1})
        _, role = await _names(db, s["company_id"], s.get("job_id"))
        link = await BK.link_for(db, "attendance", user_id=s["user_id"], company_id=s["company_id"], offer_id=str(s["_id"]), source="t15",
                                 until=t + timedelta(days=14))  # fmt: skip
        first = A._first(u or {})
        text = (f"Did {first} come to the interview{f' for {role}' if role else ''} on {A.when_text(s['starts_at'])}?\n"
                f"One tap, no sign-in: {BK.url_for(link)}\n\nThis goes on their reliability record on Nm7 (only the totals are shown, never which company said what). "
                "If you say they didn’t come, they get 48 hours to tell us why first.")  # fmt: skip
        got = await _company_mail(
            db,
            mailer,
            site,
            s["by"],
            f"Did {first} come to the interview?",
            text,
            s["user_id"],
            "rel_attendance",
            bool((c or {}).get("demo")),
        )
        out[f"attendance_{got}"] = out.get(f"attendance_{got}", 0) + 1
    return out


async def ask_stays(db, site: dict[str, Any], mailer, t: datetime, scope: dict[str, Any]) -> dict[str, int]:
    """30 and 90 days after an employer-confirmed join: "Still working here?" to the company, and the candidate may confirm."""
    from app.trust.agent import service as A
    from app.trust.booking import service as BK
    from app.trust.booking import texts as TX

    out: dict[str, int] = {}
    today = t.astimezone(IST).date()
    since = (today - timedelta(days=120)).isoformat()
    q = {
        **scope,
        "status": "joined",
        "joined.company": True,
        "join_date": {"$gte": since, "$lte": (today - timedelta(days=30)).isoformat()},
    }
    async for o in db[HIRE_OFFERS].find(q).limit(PER_PASS):
        if not await allowed(db, o["user_id"]):
            continue
        for d in STAY_DAYS:
            if not stay_due(o, d, t) or (o.get("t15") or {}).get(f"stay{d}"):
                continue
            if d == 90:
                r30 = await db[TRUST_RELIABILITY].find_one({"_id": _rid("stay30", str(o["_id"]))}, {"outcome": 1})
                if r30 and r30["outcome"] == "no":
                    continue  # they left before 30 days: no 90-day question
            if await db[TRUST_RELIABILITY].find_one(
                {"_id": _rid(f"stay{d}", str(o["_id"])), "source": "employer"}, {"_id": 1}
            ):
                continue
            if not (
                await db[HIRE_OFFERS].update_one(
                    {"_id": o["_id"], f"t15.stay{d}": {"$exists": False}}, {"$set": {f"t15.stay{d}": t}}
                )
            ).modified_count:
                continue
            c = await db[COMPANIES].find_one({"_id": o.get("company_id")}, {"demo": 1})
            if o.get("by"):
                link = await BK.link_for(db, "stay", user_id=o["user_id"], company_id=o.get("company_id") or "", offer_id=str(o["_id"]), source="t15",
                                         until=t + timedelta(days=30))  # fmt: skip
                name = o.get("candidate_name") or "your new hire"
                text = (f"Is {name} still working with you ({o.get('title', '')}, joined {date.fromisoformat(o['join_date']).strftime('%-d %b %Y')}, {d} days ago)?\n"
                        f"One tap, no sign-in: {BK.url_for(link)}\n\nThis goes on their reliability record on Nm7 (only the totals are shown, never which company said what).")  # fmt: skip
                got = await _company_mail(db, mailer, site, o["by"], f"{d} days on: is {name} still working with you?", text, o["user_id"], f"rel_stay{d}",
                                          bool((c or {}).get("demo")))  # fmt: skip
                out[f"stay{d}_company_{got}"] = out.get(f"stay{d}_company_{got}", 0) + 1
            u = await db[USERS].find_one({"_id": o["user_id"]}, A.USER_FIELDS)
            if u:
                ml = await BK.link_for(db, "rel_me", user_id=u["_id"], company_id=o.get("company_id") or "", offer_id="record", source="t15",
                                       until=t + timedelta(days=30))  # fmt: skip
                lang = (await A.prefs(db, u))["lang"]
                params = [A._first(u), o.get("company_name") or "", str(d), BK.url_for(ml)]
                wa = await BK._wa(db, site, u, "rel_stay", params, t)
                em = await BK._mail(db, mailer, site, u.get("email", ""), u.get("name", ""), TX.subject(lang, "rel_stay", company=o.get("company_name") or ""),
                                    TX.render(lang, "rel_stay", params), u["_id"], "rel_stay", demo=bool(u.get("demo")))  # fmt: skip
                out[f"stay{d}_candidate_wa_{wa}"] = out.get(f"stay{d}_candidate_wa_{wa}", 0) + 1
                out[f"stay{d}_candidate_email_{em}"] = out.get(f"stay{d}_candidate_email_{em}", 0) + 1
    return out


async def run(db, mailer=None, t: datetime | None = None, force: bool = False) -> dict[str, int]:
    """Every automation pass (heavy lease, capped): settle unanswered "no"s, ask companies (attendance, 30 / 90 days)."""
    from app.core.heavy import heavy_or_skip
    from app.site import get_site
    from app.trust.booking import service as BK

    t = t or now()
    site = await get_site(db)
    out: dict[str, int] = {}
    async with heavy_or_skip(db) as ok:
        if not ok and not force:
            return {"waiting_heavy": 1}
        out["settled"] = await settle(db, t)
        scope = await BK._scope(db, site)
        if scope is None:
            return out
        for part in (ask_attendance(db, site, mailer, t, scope), ask_stays(db, site, mailer, t, scope)):
            try:
                out.update(await part)
            except Exception:  # noqa: BLE001 — one part's problem never stops the other
                log.exception("t15: one part of the reliability pass failed")
                out["error"] = out.get("error", 0) + 1
    return out


# --- Admin: disputes -------------------------------------------------------------------------------------------------------


async def queue(db, limit: int = 100) -> list[dict[str, Any]]:
    t = now()
    out = []
    async for r in db[TRUST_RELIABILITY].find({"state": "disputed"}).sort("updated_at", 1).limit(limit):
        u = await db[USERS].find_one({"_id": r["user_id"]}, {"name": 1, "email": 1})
        it = await item_out(db, r, t)
        out.append({**it, "user": {"id": r["user_id"], "name": (u or {}).get("name", ""), "email": (u or {}).get("email", "")},
                    "disputeText": (r.get("dispute") or {}).get("text", ""), "note": r.get("note", "")})  # fmt: skip
    return out


async def decide(db, rid: str, decision: str, note: str, admin_id: str) -> dict[str, Any]:
    """A person at Nm7: "count" (the company's answer stands) or "remove" (it never shows)."""
    r = await db[TRUST_RELIABILITY].find_one({"_id": rid})
    if not r or r["state"] != "disputed":
        raise ApiError(404, "not_found", "That dispute isn’t open.")
    t = now()
    sets = {"state": "counted" if decision == "count" else "removed", "updated_at": t,
            "review": {"decision": decision, "note": note.strip()[:500], "by": admin_id, "at": t}}  # fmt: skip
    await db[TRUST_RELIABILITY].update_one({"_id": rid}, {"$set": sets})
    await audit(
        db, admin_id, "trust.reliability_decided", target=r["user_id"], data={"record": rid, "decision": decision}
    )
    return {"id": rid, "state": sets["state"]}


async def counts(db) -> dict[str, Any]:
    by: dict[str, int] = {}
    async for x in await db[TRUST_RELIABILITY].aggregate(
        [{"$group": {"_id": {"k": "$kind", "s": "$state"}, "n": {"$sum": 1}}}]
    ):
        by[f"{x['_id']['k']}_{x['_id']['s']}"] = x["n"]
    return by
