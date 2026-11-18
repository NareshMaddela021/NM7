# ruff: noqa: E501  (dense response lines and plain-language texts)
"""Vetting Trust T8: one integrity rating per candidate, the evidence view, the human review and optional webcam
snapshots. Behind the Trust switch; V2 / V3 / V5 keep working exactly as before (nothing here writes to them).

State per person in `trust_integrity` (_id = user id):
  level, score, at          the last rating worked out (rating.py), and when
  decisions                 {signal key: {status cleared / confirmed / open, note, by, at}}: a person's decision on one
                            signal (a cleared signal counts 0, a confirmed one counts 1.5× and does not fade)
  review                    {status open / asked / closed, why high / explained / admin, opened_at, ask_note, asked_at,
                            explanation, explained_at, closed_at, closed_by, note}
  reviewed_at               when a person last finished a review ("Reviewed by Nm7" for companies)
High risk opens a review (the Admin queue); a review is never a rejection: nobody is hidden, moved down or turned
away because of the rating. Companies see only the label ("Low risk", …) and "Reviewed by Nm7", or "Under review by
Nm7" while a review is open; never the signals, never "fraud", never a device or a network.

Webcam snapshots (`trust_snapshots`): only with the separate "webcam_snapshots" consent, never needed to take a test.
A session row (kind "session", _id "uid:kind:ref") holds the plan: N (3–5) random moments; each photo row (kind
"photo") holds the JPEG encrypted (Fernet), the face check (faces seen, same person as the ID + selfie check) and who
looked at it. Deleted by the T1 retention job after the "webcam_snapshots" days (30 by default, 1–60), at once when the
consent is taken back, and with the account.
"""

import base64
import binascii
import logging
import secrets
from datetime import UTC, datetime, timedelta
from html import escape
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId

from app.audit import audit
from app.core.config import get_settings
from app.core.db import (
    SKILL_ATTEMPTS,
    TRUST_FACE,
    TRUST_INTEGRITY,
    TRUST_RUNS,
    TRUST_SNAPSHOTS,
    USERS,
    VETTING_INTERVIEWS,
)
from app.core.email import Email, send_safely
from app.core.errors import ApiError
from app.core.security import decrypt, encrypt
from app.core.time import now
from app.me.service import ms
from app.trust import consent as C
from app.trust import retention as R
from app.trust.integrity import rating as RT
from app.trust.integrity.signals import apply_decisions, collect

log = logging.getLogger("nm7.trust.integrity")

PURPOSE = "webcam_snapshots"
DEFAULTS: dict[str, Any] = {"snapshots": True, "per_session": 4, "check_faces": True, "window_minutes": 12}
SNAP_MAX = 400_000  # bytes per still photo (the page sends ~20–40 KB JPEGs at 320 px)
SNAP_GAP = timedelta(seconds=3)  # between two photos of one session
SNAP_LATE = timedelta(minutes=2)  # a photo may arrive this long after the test or interview ended
PASS_EVERY = timedelta(hours=6)
PASS_CAP = 400  # people re-rated per automation pass
REVIEW_OPEN = ("open", "asked")
REVIEW_TEXT = {
    "open": "A person at Nm7 is looking at this. Nothing is decided automatically, and nobody is turned away because of it.",
    "asked": "A person at Nm7 asked you to explain. Please write a few words below.",
    "closed": "A person at Nm7 has looked at this.",
}
WHY = {"high": "High risk rating", "explained": "The person wrote an explanation", "admin": "Opened by Nm7"}

C.add_purpose(C.Purpose(PURPOSE, "Webcam snapshots during tests (optional)",
    "Only if you say yes: during a skill check or the AI interview, your camera takes a few still photos (3 to 5) at random times. "
    "No video and no sound, nothing in between the photos. Why: so results are fair for everyone, we check that the person taking the test is the person from your "
    "ID + selfie check and that nobody else is in the photo. Who sees them: only a few reviewers at Nm7, and every look is recorded. Companies never see them. "
    "We keep them for {days} days, then delete them automatically, or now if you take this back. Saying no is fine: your tests work exactly the same and nothing counts against you.",
    1, "webcam_snapshots"))  # fmt: skip


def settings_of(site: dict[str, Any]) -> dict[str, Any]:
    st = (site.get("trust") or {}).get("integrity") or {}
    out = {**DEFAULTS, **{k: v for k, v in st.items() if k in DEFAULTS}}
    out["per_session"] = max(3, min(5, int(out["per_session"])))
    out["window_minutes"] = max(2, min(30, int(out["window_minutes"])))
    return out


def _aware(v: datetime | None) -> datetime | None:
    return v.replace(tzinfo=v.tzinfo or UTC) if v else None


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That isn’t here.") from None


def dkey(key: str) -> str:
    return key.replace(".", "_")


# --- the rating ----------------------------------------------------------------------------------------------------------


async def ratings(db, uids: list[str], t: datetime | None = None) -> dict[str, dict[str, Any]]:
    """{uid: {level, label, score, byKind, signals, observations, snapshots, review, reviewedAt}} for many people at once."""
    t = t or now()
    uids = list(dict.fromkeys(u for u in uids if u))
    got = await collect(db, uids, t)
    docs = {
        d["_id"]: d
        async for d in db[TRUST_INTEGRITY].find({"_id": {"$in": uids}}, {"decisions": 1, "review": 1, "reviewed_at": 1})
    }
    out = {}
    for uid, g in got.items():
        doc = docs.get(uid) or {}
        apply_decisions(g["signals"], doc.get("decisions") or {})
        r = RT.score(g["signals"], g["observations"], t)
        out[uid] = {**r, "signals": sorted(g["signals"], key=lambda s: _aware(s.at), reverse=True), "observations": g["observations"],
                    "snapshots": g["snapshots"], "review": doc.get("review"), "reviewedAt": doc.get("reviewed_at")}  # fmt: skip
    return out


async def refresh(db, uid: str, t: datetime | None = None) -> dict[str, Any]:
    """Works out the rating again, stores it, and opens a review when it is High (never a rejection)."""
    t = t or now()
    r = (await ratings(db, [uid], t))[uid]
    sets: dict[str, Any] = {
        "level": r["level"],
        "score": r["score"],
        "at": t,
        "open_signals": sum(1 for s in r["signals"] if s.status == "open"),
    }
    rv = r.get("review") or {}
    if r["level"] == "high" and rv.get("status") not in REVIEW_OPEN:
        closed = _aware(rv.get("closed_at"))
        newer = [s for s in r["signals"] if s.status == "open" and (not closed or _aware(s.at) > closed)]
        if not closed or newer:
            sets["review"] = {"status": "open", "why": "high", "opened_at": t, "score": r["score"]}
            r["review"] = sets["review"]
            await audit(
                db, "system", "trust.integrity_review_opened", target=uid, data={"why": "high", "score": r["score"]}
            )
    await db[TRUST_INTEGRITY].update_one(
        {"_id": uid}, {"$set": sets, "$setOnInsert": {"user_id": uid, "created_at": t}}, upsert=True
    )
    return r


def _sig_admin(s) -> dict[str, Any]:
    k = RT.KINDS.get(s.kind)
    return {"key": s.key, "kind": s.kind, "label": k.label if k else s.kind, "plain": k.plain if k else "", "source": k.source if k else "",
            "where": s.where, "at": ms(s.at), "baseWeight": s.base, "weight": s.weight, "cap": k.cap if k else 0, "status": s.status,
            "statusText": RT.STATUS_TEXT.get(s.status, s.status), "sourceStatus": s.source_status, "by": s.by, "detail": s.detail,
            "snapshot": (s.ref or {}).get("snapshot")}  # fmt: skip


def _sig_plain(s) -> dict[str, Any]:
    """For the candidate: plain words, where and when, its weight and status. Never another person, a device or an IP."""
    k = RT.KINDS.get(s.kind)
    return {"key": s.key, "what": k.plain if k else "", "where": s.where, "at": ms(s.at), "weight": s.weight, "status": s.status,
            "statusText": RT.STATUS_TEXT.get(s.status, s.status), "appeal": (s.ref or {}).get("appeal")}  # fmt: skip


def review_out(rv: dict[str, Any] | None, for_admin: bool = False) -> dict[str, Any] | None:
    if not rv:
        return None
    out = {"status": rv.get("status"), "text": REVIEW_TEXT.get(rv.get("status") or "", ""), "openedAt": ms(rv.get("opened_at")),
           "askNote": rv.get("ask_note") or "", "askedAt": ms(rv.get("asked_at")), "explanation": rv.get("explanation") or "",
           "explainedAt": ms(rv.get("explained_at")), "closedAt": ms(rv.get("closed_at")), "note": rv.get("note") or ""}  # fmt: skip
    if for_admin:
        out |= {"why": rv.get("why"), "whyText": WHY.get(rv.get("why") or "", ""), "closedBy": rv.get("closed_by")}
    return out


def snapshots_note(r: dict[str, Any], consent: bool) -> str:
    n = r.get("snapshots") or 0
    if n:
        return f"{n} webcam snapshot{'' if n == 1 else 's'} kept for now (deleted automatically)."
    return "No webcam snapshots (they are optional)." if not consent else "No webcam snapshots yet."


async def mine(db, uid: str) -> dict[str, Any]:
    from app.site import get_site

    site = await get_site(db)
    r = await refresh(db, uid)
    consent = await C.has(db, uid, PURPOSE)
    return {
        "level": r["level"], "label": RT.LABELS[r["level"]], "plain": RT.PLAIN[r["level"]], "score": r["score"],
        "signals": [_sig_plain(s) for s in r["signals"]], "review": review_out(r.get("review")),
        "reviewedAt": ms(r.get("reviewedAt")), "snapshots": {"consent": consent, "count": r["snapshots"], "note": snapshots_note(r, consent),
                                                          "offered": settings_of(site)["snapshots"]},
        "method": {k: v for k, v in RT.method().items() if k != "kinds"},
        "never": "This rating never rejects you, hides you from companies or moves you down a list. Companies only see the label, never what was noticed.",
    }  # fmt: skip


async def evidence(db, uid: str) -> dict[str, Any]:
    """The Admin evidence view (reviewers only): every signal with its weight, decay, cap and status, the review, the
    snapshots (no image here: each photo is opened on its own and that look is recorded)."""
    u = await db[USERS].find_one({"_id": uid}, {"name": 1, "email": 1})
    if not u:
        raise ApiError(404, "not_found", "There is no such person.")
    r = await refresh(db, uid)
    doc = await db[TRUST_INTEGRITY].find_one({"_id": uid}) or {}
    snaps = []
    async for p in (
        db[TRUST_SNAPSHOTS].find({"user_id": uid, "kind": "photo"}, {"img_enc": 0}).sort("created_at", -1).limit(50)
    ):
        w = p.get("where") or {}
        snaps.append({"id": str(p["_id"]), "at": ms(p["created_at"]), "where": f"{'AI interview' if w.get('kind') == 'interview' else 'Skill check'}: {w.get('skill', '')}",
                      "check": p.get("check") or {}, "views": len(p.get("views") or [])})  # fmt: skip
    return {
        "userId": uid, "name": u.get("name", ""), "email": u.get("email", ""), "level": r["level"], "label": RT.LABELS[r["level"]],
        "score": r["score"], "byKind": r["byKind"], "observations": r["observations"], "signals": [_sig_admin(s) for s in r["signals"]],
        "decisions": {k: {"status": v.get("status"), "note": v.get("note", ""), "at": ms(v.get("at"))} for k, v in (doc.get("decisions") or {}).items()},
        "review": review_out(r.get("review"), True), "reviewedAt": ms(r.get("reviewedAt")), "snapshots": snaps,
        "snapshotConsent": await C.has(db, uid, PURPOSE), "method": RT.method(), "pledges": await _pledges(db, uid),
    }  # fmt: skip


async def _pledges(db, uid: str) -> list[dict[str, Any]]:
    from app.trust.honesty.pledge import records  # Vetting Trust T9: the honesty pledges agreed to (version, when)

    return await records(db, uid)


# --- company view: the label only ------------------------------------------------------------------------------------------


def company_out(r: dict[str, Any]) -> dict[str, Any]:
    """Only the label and whether a person reviewed it. While a review is open: "Under review by Nm7" and nothing else."""
    rv = r.get("review") or {}
    if rv.get("status") in REVIEW_OPEN:
        return {"label": "Under review by Nm7", "level": None, "underReview": True, "reviewed": False}
    return {
        "label": RT.LABELS[r["level"]],
        "level": r["level"],
        "underReview": False,
        "reviewed": bool(r.get("reviewedAt")),
    }


async def labels(
    db, uids: list[str], company: dict[str, Any], account: dict[str, Any] | None
) -> dict[str, dict[str, Any]] | None:
    from app.trust import access

    if not await access.for_company(db, company, account):
        return None
    return {u: company_out(r) for u, r in (await ratings(db, uids)).items()}


# --- the human review ------------------------------------------------------------------------------------------------------


async def decide_signal(db, uid: str, key: str, admin_id: str, decision: str, note: str) -> dict[str, Any]:
    r = (await ratings(db, [uid]))[uid]
    if key not in {s.key for s in r["signals"]}:
        raise ApiError(404, "not_found", "That signal isn’t on this person any more.")
    t = now()
    status = {"clear": "cleared", "confirm": "confirmed", "reopen": "open"}[decision]
    await db[TRUST_INTEGRITY].update_one({"_id": uid}, {"$set": {f"decisions.{dkey(key)}": {"status": status, "note": note.strip()[:500], "by": admin_id, "at": t},
                                                                 "updated_at": t}, "$setOnInsert": {"user_id": uid, "created_at": t}}, upsert=True)  # fmt: skip
    await audit(db, admin_id, "trust.integrity_signal", target=uid, data={"key": key, "decision": status})
    return await evidence(db, uid)


async def open_review(db, uid: str, admin_id: str) -> dict[str, Any]:
    t = now()
    await db[TRUST_INTEGRITY].update_one({"_id": uid}, {"$set": {"review": {"status": "open", "why": "admin", "opened_at": t}, "updated_at": t},
                                                        "$setOnInsert": {"user_id": uid, "created_at": t}}, upsert=True)  # fmt: skip
    await audit(db, admin_id, "trust.integrity_review_opened", target=uid, data={"why": "admin"})
    return await evidence(db, uid)


async def _may_email(db, uid: str) -> dict[str, Any] | None:
    from app.trust import access

    f = await access.mail_filter(db)
    if f is None:
        return None
    return await db[USERS].find_one({"_id": uid, "deleted_at": None, **f}, {"email": 1, "name": 1})


def ask_email(u: dict[str, Any], note: str) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (u.get("name") or "").split(" ")[0] or "there"
    link = f"{site}/me/settings#s-integrity"
    lines = [f"Hi {first},", "", "A person at Nm7 is looking at your recent skill checks and interview, and would like a few words from you.",
             *([f"They wrote: “{note}”", ""] if note else [""]), "Nothing has been decided, and nobody is turned away because of this.",
             f"Reply here: {link}"]  # fmt: skip
    html = (f'<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p>Hi {escape(first)},</p>'
            "<p>A person at Nm7 is looking at your recent skill checks and interview, and would like a few words from you.</p>"
            + (f"<p>They wrote: “{escape(note)}”</p>" if note else "")
            + f'<p>Nothing has been decided, and nobody is turned away because of this.</p><p><a href="{escape(link)}">Write your answer</a></p></div>')  # fmt: skip
    return Email(
        to=u["email"],
        to_name=u.get("name", ""),
        subject="Nm7: a few words about your recent tests",
        text="\n".join(lines),
        html=html,
    )


async def ask(db, mailer, uid: str, admin_id: str, note: str) -> dict[str, Any]:
    doc = await db[TRUST_INTEGRITY].find_one({"_id": uid}) or {}
    rv = doc.get("review") or {}
    t = now()
    new = {
        **(rv if rv.get("status") in REVIEW_OPEN else {"why": "admin", "opened_at": t}),
        "status": "asked",
        "ask_note": " ".join(note.split())[:600],
        "asked_at": t,
    }
    await db[TRUST_INTEGRITY].update_one(
        {"_id": uid},
        {"$set": {"review": new, "updated_at": t}, "$setOnInsert": {"user_id": uid, "created_at": t}},
        upsert=True,
    )
    await audit(db, admin_id, "trust.integrity_asked", target=uid)
    u = await _may_email(db, uid)  # while the switch is off: only the testers get an email
    if u and mailer:
        await send_safely(mailer, ask_email(u, new["ask_note"]))
    return await evidence(db, uid)


async def close_review(db, uid: str, admin_id: str, note: str) -> dict[str, Any]:
    doc = await db[TRUST_INTEGRITY].find_one({"_id": uid}) or {}
    rv = doc.get("review") or {}
    if rv.get("status") not in REVIEW_OPEN:
        raise ApiError(409, "not_open", "There is no open review for this person.")
    t = now()
    await db[TRUST_INTEGRITY].update_one({"_id": uid}, {"$set": {"review": {**rv, "status": "closed", "closed_at": t, "closed_by": admin_id,
                                                                            "note": " ".join(note.split())[:600]}, "reviewed_at": t, "updated_at": t}})  # fmt: skip
    await audit(db, admin_id, "trust.integrity_review_closed", target=uid)
    return await evidence(db, uid)


async def explain(db, uid: str, note: str, key: str | None = None) -> dict[str, Any]:
    """The candidate explains (always possible): the review opens (or goes back to the reviewer) with their words."""
    doc = await db[TRUST_INTEGRITY].find_one({"_id": uid}) or {}
    rv = doc.get("review") or {}
    t = now()
    text = " ".join(note.split())[:1500]
    new = {**(rv if rv.get("status") in REVIEW_OPEN else {"why": "explained", "opened_at": t}), "status": "open", "explanation": text,
           "explained_at": t, "explained_key": key}  # fmt: skip
    await db[TRUST_INTEGRITY].update_one(
        {"_id": uid},
        {"$set": {"review": new, "updated_at": t}, "$setOnInsert": {"user_id": uid, "created_at": t}},
        upsert=True,
    )
    await audit(db, uid, "trust.integrity_explained", target=uid, data={"key": key})
    return await mine(db, uid)


async def queue(db, limit: int = 100) -> list[dict[str, Any]]:
    rows = (
        await db[TRUST_INTEGRITY]
        .find({"review.status": {"$in": list(REVIEW_OPEN)}})
        .sort("review.opened_at", 1)
        .to_list(limit)
    )
    users = {
        u["_id"]: u async for u in db[USERS].find({"_id": {"$in": [r["_id"] for r in rows]}}, {"name": 1, "email": 1})
    }
    return [{"userId": r["_id"], "name": (users.get(r["_id"]) or {}).get("name", ""), "email": (users.get(r["_id"]) or {}).get("email", ""),
             "level": r.get("level"), "label": RT.LABELS.get(r.get("level") or "", ""), "score": r.get("score"), "openSignals": r.get("open_signals", 0),
             "review": review_out(r.get("review"), True)} for r in rows]  # fmt: skip


async def counts(db) -> dict[str, int]:
    out = {lvl: await db[TRUST_INTEGRITY].count_documents({"level": lvl}) for lvl in RT.LEVELS}
    out["review"] = await db[TRUST_INTEGRITY].count_documents({"review.status": {"$in": list(REVIEW_OPEN)}})
    out["asked"] = await db[TRUST_INTEGRITY].count_documents({"review.status": "asked"})
    out["snapshots"] = await db[TRUST_SNAPSHOTS].count_documents({"kind": "photo"})
    return out


# --- the automation pass ---------------------------------------------------------------------------------------------------


async def _candidates(db, t: datetime) -> list[str]:
    since = t - timedelta(days=RT.MAX_AGE_DAYS)
    seen: dict[str, None] = {}

    def add(xs):
        for x in xs:
            if x and len(seen) < PASS_CAP * 3:
                seen.setdefault(x, None)

    add(await db[TRUST_INTEGRITY].distinct("_id", {"review.status": {"$in": list(REVIEW_OPEN)}}))
    add(
        await db[SKILL_ATTEMPTS].distinct(
            "user_id", {"v": 2, "submitted_at": {"$gt": since}, "integrity.reasons.0": {"$exists": True}}
        )
    )
    add(
        await db[VETTING_INTERVIEWS].distinct(
            "user_id",
            {
                "started_at": {"$gt": since},
                "$or": [{"signals.pasteAttempts": {"$gte": 3}}, {"signals.blurs": {"$gt": 8}}],
            },
        )
    )
    from app.core.db import TRUST_DOCUMENTS, VETTING_QUEUE

    add(await db[VETTING_QUEUE].distinct("users", {"kind": "fraud", "updated_at": {"$gt": since}}))
    add(await db[TRUST_DOCUMENTS].distinct("user_id", {"review.reasons.0": {"$exists": True}}))
    add(
        await db[TRUST_FACE].distinct(
            "_id",
            {"$or": [{"review.kind": "tries"}, {"continuity.review.kind": "tries"}, {"continuity.status": "not_same"}]},
        )
    )
    add(
        await db[TRUST_SNAPSHOTS].distinct(
            "user_id", {"kind": "photo", "$or": [{"check.faces": {"$ne": 1, "$exists": True}}, {"check.same": False}]}
        )
    )
    return list(seen)


async def pass_(db, t: datetime | None = None, force: bool = False) -> dict[str, int]:
    """Every 6 hours (Admin: "Check now"): re-rates people with signals (capped), opens reviews for High. While the
    Trust switch is off only the people it is on for (admins, demo accounts, testers) are rated."""
    from app.core.heavy import heavy_or_skip
    from app.trust import access

    t = t or now()
    if not force:
        last = await db[TRUST_RUNS].find_one({"_id": "integrity"}, {"ran_at": 1}) or {}
        if last.get("ran_at") and _aware(last["ran_at"]) > t - PASS_EVERY:
            return {}
    out = {"rated": 0, "high": 0, "opened": 0}

    async def work():
        uids = await _candidates(db, t)
        if not await access.is_public(db):
            uids = [u for u in uids if await access.for_user(db, u)]
        for u in uids[:PASS_CAP]:
            before = (await db[TRUST_INTEGRITY].find_one({"_id": u}, {"review": 1}) or {}).get("review") or {}
            r = await refresh(db, u, t)
            out["rated"] += 1
            out["high"] += r["level"] == "high"
            out["opened"] += (r.get("review") or {}).get("opened_at") == t and before.get("opened_at") != t

    if force:
        await work()
    else:
        async with heavy_or_skip(db) as ok:
            if not ok:
                return {}
            await work()
    await db[TRUST_RUNS].update_one({"_id": "integrity"}, {"$set": {"ran_at": t, "last": out}}, upsert=True)
    return out


# --- webcam snapshots ------------------------------------------------------------------------------------------------------


async def offer(db, uid: str) -> dict[str, Any]:
    from app.site import get_site

    site = await get_site(db)
    s = settings_of(site)
    p = C.PURPOSES[PURPOSE]
    return {"offer": bool(s["snapshots"]), "consent": await C.has(db, uid, PURPOSE), "title": p.title, "text": C.text_of(p, site),
            "perSession": s["per_session"]}  # fmt: skip


async def _session_target(db, uid: str, kind: str, ref: str) -> dict[str, Any]:
    """The running test or interview (or one that ended a moment ago) this photo belongs to."""
    t = now()
    if kind == "skill":
        a = await db[SKILL_ATTEMPTS].find_one(
            {"_id": _oid(ref), "user_id": uid, "v": 2}, {"skill": 1, "submitted_at": 1, "remaining_ms": 1}
        )
        if not a or (a.get("submitted_at") and _aware(a["submitted_at"]) < t - SNAP_LATE):
            raise ApiError(404, "not_found", "That test isn’t running.")
        return {
            "skill": a.get("skill", ""),
            "remaining_ms": int(a.get("remaining_ms") or 0),
            "done": bool(a.get("submitted_at")),
        }
    iv = await db[VETTING_INTERVIEWS].find_one(
        {"_id": _oid(ref), "user_id": uid}, {"test": 1, "status": 1, "answered_at": 1}
    )
    if not iv or (
        iv.get("status") != "running" and not (iv.get("answered_at") and _aware(iv["answered_at"]) > t - SNAP_LATE)
    ):
        raise ApiError(404, "not_found", "That interview isn’t running.")
    return {"skill": iv.get("test", ""), "remaining_ms": 0, "done": iv.get("status") != "running"}


def _plan(n: int, window_ms: int) -> list[int]:
    """N random moments: the first in the first half-minute, the rest spread over the window (never a pattern)."""
    r = secrets.SystemRandom()
    first = r.randint(5_000, 25_000)
    rest = sorted(r.randint(30_000, max(31_000, window_ms)) for _ in range(n - 1))
    return [first, *rest]


async def plan(db, uid: str, kind: str, ref: str) -> dict[str, Any]:
    """{on, dueInMs[], taken, left}; off (and why) without the consent or when Admin turned snapshots off."""
    from app.site import get_site

    s = settings_of(await get_site(db))
    if not s["snapshots"]:
        return {"on": False, "note": "Webcam snapshots are off."}
    if not await C.has(db, uid, PURPOSE):
        return {"on": False, "note": "No webcam snapshots (you didn’t turn them on; that’s fine)."}
    tgt = await _session_target(db, uid, kind, ref)
    t = now()
    sid = f"{uid}:{kind}:{ref}"
    window = s["window_minutes"] * 60_000
    if kind == "skill" and tgt["remaining_ms"]:
        window = max(40_000, min(window, int(tgt["remaining_ms"] * 0.9)))
    await db[TRUST_SNAPSHOTS].update_one({"_id": sid}, {"$setOnInsert": {"kind": "session", "user_id": uid, "where": {"kind": kind, "ref": ref, "skill": tgt["skill"]},
                                                                         "n": s["per_session"], "plan": _plan(s["per_session"], window), "taken": 0, "created_at": t}}, upsert=True)  # fmt: skip
    ses = await db[TRUST_SNAPSHOTS].find_one({"_id": sid})
    start = _aware(ses["created_at"])
    left = max(0, int(ses["n"]) - int(ses.get("taken") or 0))
    due = [
        max(1000, int((start + timedelta(milliseconds=at) - t).total_seconds() * 1000))
        for at in ses["plan"][int(ses.get("taken") or 0) :]
    ]
    return {
        "on": not tgt["done"] and left > 0,
        "dueInMs": due,
        "taken": int(ses.get("taken") or 0),
        "left": left,
        "n": int(ses["n"]),
    }


def image(b64: str) -> bytes:
    s = (b64 or "").strip()
    if s.startswith("data:"):
        s = s.split(",", 1)[-1]
    try:
        b = base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(400, "bad_image", "The photo didn’t come through.") from None
    if not b or len(b) > SNAP_MAX or not b.startswith(b"\xff\xd8\xff"):
        raise ApiError(400, "bad_image", "The photo must be a small JPEG.")
    return b


async def _check(db, uid: str, img: bytes) -> dict[str, Any]:
    """Faces in the photo, and the same person as the ID + selfie check (T3's provider). Never a decision by itself."""
    from app.site import get_site
    from app.trust import access
    from app.trust.face import service as F

    site = await get_site(db)
    if not settings_of(site)["check_faces"]:
        return {}
    u = await db[USERS].find_one({"_id": uid}, {"name": 1, "demo": 1, "role": 1, "email": 1, "email_lc": 1}) or {}
    p = await F.provider_for(db, u, site, await access.testers(db))
    if not p or not hasattr(p, "count_faces"):
        return {}
    out: dict[str, Any] = {"provider": p.key, "test": p.test}
    try:
        out["faces"] = int(await p.count_faces(img, hint=u.get("name") or ""))
        st = await db[TRUST_FACE].find_one({"_id": uid}, {"reference_enc": 1, "vendor": 1, "status": 1})
        if out["faces"] == 1 and st and st.get("reference_enc") and st.get("vendor") == p.key:
            sc = await p.same_person(uid, decrypt(st["reference_enc"]), img, hint=u.get("name") or "")
            out["score"] = round(sc.score, 1)
            out["same"] = sc.score >= float(F.face_settings(site)["same_min"])
    except Exception as e:  # noqa: BLE001  (the photo is kept; no signal from a check that didn't run)
        log.warning("snapshot face check failed: %s", type(e).__name__)
        out["error"] = True
    return out


async def take(db, uid: str, kind: str, ref: str, img: bytes) -> dict[str, Any]:
    if not await C.has(db, uid, PURPOSE):
        raise ApiError(403, "consent_needed", "Webcam snapshots are off.")
    await _session_target(db, uid, kind, ref)
    t = now()
    sid = f"{uid}:{kind}:{ref}"
    ses = await db[TRUST_SNAPSHOTS].find_one_and_update(
        {"_id": sid, "user_id": uid, "$expr": {"$lt": ["$taken", "$n"]}, "$or": [{"last_at": None}, {"last_at": {"$lt": t - SNAP_GAP}}]},
        {"$inc": {"taken": 1}, "$set": {"last_at": t}}, return_document=True,
    )  # fmt: skip
    if not ses:
        raise ApiError(409, "enough", "No more photos for this test.")
    chk = await _check(db, uid, img)
    row = {"_id": ObjectId(), "kind": "photo", "user_id": uid, "session": sid, "where": ses.get("where") or {}, "created_at": t,
           "img_enc": encrypt(base64.b64encode(img).decode()), "bytes": len(img), "check": chk, "views": []}  # fmt: skip
    await db[TRUST_SNAPSHOTS].insert_one(row)
    del img
    await audit(
        db,
        uid,
        "trust.snapshot_taken",
        target=uid,
        data={"kind": kind, "faces": chk.get("faces"), "same": chk.get("same")},
    )
    if chk.get("faces") not in (None, 1) or chk.get("same") is False:
        await refresh(db, uid, t)  # a signal for a person to look at, never a rejection
    return {"taken": int(ses["taken"]), "left": max(0, int(ses["n"]) - int(ses["taken"]))}


async def view_snapshot(db, uid: str, sid: str, admin_id: str) -> dict[str, Any]:
    p = await db[TRUST_SNAPSHOTS].find_one({"_id": _oid(sid), "user_id": uid, "kind": "photo"})
    if not p:
        raise ApiError(404, "not_found", "That photo has been deleted.")
    t = now()
    await db[TRUST_SNAPSHOTS].update_one({"_id": p["_id"]}, {"$push": {"views": {"by": admin_id, "at": t}}})
    await audit(db, admin_id, "trust.snapshot_viewed", target=uid, data={"snapshot": sid})
    return {"id": sid, "at": ms(p["created_at"]), "image": "data:image/jpeg;base64," + decrypt(p["img_enc"]), "check": p.get("check") or {},
            "views": [{"by": v.get("by"), "at": ms(v.get("at"))} for v in [*(p.get("views") or []), {"by": admin_id, "at": t}]]}  # fmt: skip


# --- retention (T1 framework) ----------------------------------------------------------------------------------------------

R.register(R.DataType("integrity", "Integrity rating: decisions by a person, your explanations and the review (never the photos)", 365, 90, 730,
                      TRUST_INTEGRITY, field="at", user_field="_id",
                      note="Deleted by the daily job this many days after the rating was last worked out (it is worked out again while there are signals)"))  # fmt: skip
