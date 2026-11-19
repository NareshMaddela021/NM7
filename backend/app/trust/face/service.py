# ruff: noqa: E501  (dense response lines and plain-language texts)
"""ID + live selfie: settings, the gate before the AI interview and a skill check, one check, the joining-day check,
retries and the human review, company badges, retention.

State per person in `trust_face` (_id = user id; never a photo):
  status        none → verified, or retry (tries left) → review (a person checks) → verified / not_cleared
  tries         failed checks since the last reset (Admin's "max tries", default 3; then a person checks)
  doc_type      dl / pan (never Aadhaar: an Aadhaar card is refused and nothing about it is kept)
  liveness, match   {pass, score} of the last check
  vendor, vendor_ref, test, verified_at, verified_by (check / review)
  reference_enc the provider's face reference for the joining-day check, encrypted (deleted with the state)
  challenge     the movement asked for in the next check (turn left / right / smile) and when it was given
  review        {status: open / cleared / not_cleared, kind: tries / manual, reason, note, requested_at, decided_*,
                 method (video_call / documents / other), decision_note}
  continuity    {status: same / retry / review / not_same, tries, score, at, offer_id, review {...}}
  process_at    the last step of this person's hiring (a check, an open offer): retention counts from here
Each check also leaves one row in `trust_selfies` (results and scores only) for the history and the counts.

Never an automatic rejection: a failed check can be tried again; after the last try a person looks at it, the candidate
is told plainly, and can ask for a manual check (a video call with the Nm7 team) at any time, also when they have no
camera or a disability makes the camera check hard. The person's decision is recorded.
"""

import base64
import binascii
import logging
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.audit import audit
from app.core.config import get_settings
from app.core.db import HIRE_OFFERS, TRUST_FACE, TRUST_SELFIES, USERS
from app.core.errors import ApiError
from app.core.security import decrypt, encrypt
from app.core.time import IST, now
from app.me.service import ms
from app.trust import retention as R
from app.trust.face import providers as P

log = logging.getLogger("nm7.trust.face")

DEFAULTS: dict[str, Any] = {
    "provider": "mock",
    "require": {
        "interview": True,
        "skill_check": True,
    },  # which steps need the check (only while Trust allows the person)
    "liveness_min": 90,
    "match_min": 90,
    "same_min": 90,
    "max_tries": 3,
}
STEPS = ("interview", "skill_check")
CHALLENGE_MINUTES = 15
FRAME_MAX = 1_500_000  # bytes per selfie frame (the page sends ~50 KB JPEGs)
ID_MAX = 4_000_000  # bytes for the ID card photo
JOIN_BEFORE_DAYS = 7  # the joining check opens with the 7-day check-in …
JOIN_AFTER_DAYS = 30  # … and stays open a month after the join date
DOC_TYPES = {"dl": "Driving licence", "pan": "PAN card"}
MANUAL_REASONS = {
    "no_camera": "I don’t have a working camera",
    "disability": "A disability makes the camera check hard for me",
    "failed": "The camera check keeps failing",
    "other": "Something else",
}
METHODS = {"video_call": "Video call with the Nm7 team", "documents": "Documents checked by a person", "other": "Other"}
STATUS_TEXT = {
    "none": "Not done yet",
    "retry": "Didn’t pass yet: you can try again",
    "review": "A person at Nm7 is checking this",
    "verified": "ID + selfie verified",
    "not_cleared": "Not verified after a check by a person",
}
SAME_TEXT = {
    "same": "Same person at joining: confirmed",
    "retry": "Didn’t match yet: you can try again",
    "review": "A person at Nm7 is checking this",
    "not_same": "Not confirmed after a check by a person",
}
GATE_TEXT = {
    "review": "A person at Nm7 is checking your ID and selfie (usually within one working day). You can start once it’s done; we’ll email you.",
    "not_cleared": "We couldn’t verify your ID and selfie. Please ask for a manual check (a short video call with the Nm7 team).",
}


# --- settings and the provider -------------------------------------------------------------------------------------------


def face_settings(site: dict[str, Any]) -> dict[str, Any]:
    st = (site.get("trust") or {}).get("face") or {}
    return {**DEFAULTS, **st, "require": {**DEFAULTS["require"], **(st.get("require") or {})}}


async def provider_for(db, user: dict[str, Any] | None, site: dict[str, Any], testers: set[str]) -> P.Provider | None:
    """The chosen provider when it has its keys. The test provider: anywhere but production, and on production only for
    admins, demo accounts and testers (its results are not real, so nobody else may get its badge)."""
    p = P.get(face_settings(site)["provider"]) or P.Mock()
    if not p.test:
        return p if p.ready() else None
    if not get_settings().is_prod:
        return p
    u = user or {}
    email = (u.get("email_lc") or u.get("email") or "").lower()
    return p if u.get("demo") or u.get("role") == "admin" or (email and email in testers) else None


async def _context(db, uid: str) -> tuple[dict[str, Any], dict[str, Any], P.Provider | None]:
    from app.site import get_site
    from app.trust import access

    site = await get_site(db)
    u = await db[USERS].find_one({"_id": uid}, {"name": 1, "demo": 1, "role": 1, "email": 1, "email_lc": 1}) or {}
    return site, u, await provider_for(db, u, site, await access.testers(db))


# --- photos (memory only) ------------------------------------------------------------------------------------------------


def image(b64: str, limit: int, what: str) -> bytes:
    """Base64 (or a data: URL) → bytes, only a JPEG or PNG under the limit. Held in memory, never saved."""
    s = (b64 or "").strip()
    if s.startswith("data:"):
        s = s.split(",", 1)[-1]
    try:
        b = base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(400, "bad_image", f"The {what} didn’t come through. Please take it again.") from None
    if not b or len(b) > limit:
        raise ApiError(400, "bad_image", f"The {what} is too large or empty. Please take it again.")
    if not (b.startswith(b"\xff\xd8\xff") or b.startswith(b"\x89PNG\r\n\x1a\n")):
        raise ApiError(400, "bad_image", f"The {what} must be a photo (JPEG or PNG).")
    return b


def doc_type_of(v: str) -> str:
    t = (v or "").strip().lower()
    if "aadh" in t or "uid" in t:
        raise ApiError(400, "aadhaar_refused", "We never take Aadhaar. Please use your driving licence or PAN card.")
    if t not in DOC_TYPES:
        raise ApiError(400, "doc_type", "Choose your driving licence or PAN card.")
    return t


# --- state ---------------------------------------------------------------------------------------------------------------


async def get_state(db, uid: str) -> dict[str, Any] | None:
    return await db[TRUST_FACE].find_one({"_id": uid})


async def challenge(db, uid: str) -> str:
    """A fresh movement for the next check (random, so a recording made earlier doesn't fit)."""
    key = secrets.choice(list(P.CHALLENGES))
    t = now()
    await db[TRUST_FACE].update_one({"_id": uid}, {"$set": {"challenge": key, "challenge_at": t, "updated_at": t},
                                    "$setOnInsert": {"user_id": uid, "status": "none", "tries": 0, "created_at": t, "process_at": t}},
                                    upsert=True)  # fmt: skip
    return key


def _aware(v: datetime | None) -> datetime | None:
    return v.replace(tzinfo=v.tzinfo or UTC) if v else None


def _check_challenge(st: dict[str, Any] | None, got: str) -> str:
    at = _aware((st or {}).get("challenge_at"))
    if (
        not st
        or not st.get("challenge")
        or st["challenge"] != got
        or not at
        or at < now() - timedelta(minutes=CHALLENGE_MINUTES)
    ):
        raise ApiError(409, "challenge_old", "That took a little long. Please start the camera check again.")
    return got


def review_out(rv: dict[str, Any] | None, tries: int = 0) -> dict[str, Any] | None:
    if not rv:
        return None
    reason = (f"The check didn’t pass after {tries} tries." if rv.get("kind") == "tries"
              else f"You asked for a manual check: {MANUAL_REASONS.get(rv.get('reason'), 'something else')}.")  # fmt: skip
    return {"status": rv.get("status"), "kind": rv.get("kind"), "reasonText": reason, "reason": rv.get("reason"),
            "note": rv.get("note") or "", "requestedAt": ms(rv.get("requested_at")), "decidedAt": ms(rv.get("decided_at")),
            "method": rv.get("method"), "methodText": METHODS.get(rv.get("method"), ""), "decisionNote": rv.get("decision_note") or "",
            "lastReason": rv.get("last_reason") or ""}  # fmt: skip


def state_out(st: dict[str, Any] | None, fs: dict[str, Any]) -> dict[str, Any]:
    st = st or {}
    status = st.get("status") or "none"
    c = st.get("continuity") or None
    return {
        "status": status, "statusText": STATUS_TEXT[status], "tries": int(st.get("tries") or 0),
        "triesLeft": max(0, int(fs["max_tries"]) - int(st.get("tries") or 0)), "maxTries": int(fs["max_tries"]),
        "verifiedAt": ms(st.get("verified_at")), "verifiedBy": st.get("verified_by"), "docType": st.get("doc_type"),
        "liveness": st.get("liveness"), "match": st.get("match"), "lastReason": st.get("last_reason") or "",
        "review": review_out(st.get("review"), int(st.get("tries") or 0)), "test": bool(st.get("test")),
        "hasReference": bool(st.get("reference_enc")),
        "continuity": None if not c else {
            "status": c.get("status"), "statusText": SAME_TEXT.get(c.get("status"), ""), "at": ms(c.get("at")),
            "offerId": c.get("offer_id"), "triesLeft": max(0, int(fs["max_tries"]) - int(c.get("tries") or 0)),
            "lastReason": c.get("last_reason") or "", "review": review_out(c.get("review"), int(c.get("tries") or 0)),
        },
    }  # fmt: skip


# --- the gate ------------------------------------------------------------------------------------------------------------


async def gate(db, uid: str, step: str) -> None:
    """Before the AI interview / a new skill check: 409 face_check_needed unless this person's ID + selfie is verified.
    Nothing happens while Vetting Trust is hidden from them, when Admin turned the step off, or with no provider."""
    from app.trust import access

    if not await access.for_user(db, uid):
        return
    site, _, p = await _context(db, uid)
    fs = face_settings(site)
    if not fs["require"].get(step) or not p:
        return
    st = await get_state(db, uid)
    status = (st or {}).get("status") or "none"
    if status == "verified":
        await db[TRUST_FACE].update_one({"_id": uid}, {"$set": {"process_at": now()}})
        return
    what = "the AI interview" if step == "interview" else "the skill check"
    msg = (
        GATE_TEXT.get(status)
        or f"Before {what}: a quick check that it’s really you (a photo of your driving licence or PAN card and a live selfie). It takes about a minute."
    )
    raise ApiError(409, "face_check_needed", msg, extra={"face": {"status": status, "step": step}})


# --- one check -----------------------------------------------------------------------------------------------------------


async def _row(db, uid: str, kind: str, p: P.Provider, **data: Any) -> None:
    t = now()
    await db[TRUST_SELFIES].insert_one(
        {"user_id": uid, "kind": kind, "vendor": p.key, "test": p.test, "created_at": t, **data}
    )


async def run_check(
    db, uid: str, *, step: str, doc_type: str, id_image: bytes, frames: list[bytes], challenge_key: str
) -> dict[str, Any]:
    site, u, p = await _context(db, uid)
    fs = face_settings(site)
    if not p:
        raise ApiError(503, "provider_off", "The face check isn’t connected yet. Please try again later.")
    st = await get_state(db, uid)
    status = (st or {}).get("status") or "none"
    if status == "verified":
        return state_out(st, fs)
    if status in ("review", "not_cleared"):
        raise ApiError(409, "with_a_person", GATE_TEXT[status])
    _check_challenge(st, challenge_key)
    hint = u.get("name") or ""
    t = now()
    try:
        idr = await p.read_id(id_image, hint=hint)
        if idr.kind == "aadhaar":
            await audit(
                db, uid, "trust.face_aadhaar_refused", target=uid, data={"vendor": p.key}
            )  # nothing about the card is kept
            raise ApiError(
                400,
                "aadhaar_refused",
                "This looks like an Aadhaar card. We never take Aadhaar: please use your driving licence or PAN card.",
            )
        live = await p.liveness(frames, challenge_key, hint=hint)
        match = (
            await p.match(frames[0], id_image, hint=hint)
            if idr.has_face
            else P.Score(
                0, "We couldn’t find a face on the card photo. Please take the photo again, flat and in good light."
            )
        )
    except ApiError:
        raise
    except Exception as e:  # noqa: BLE001  (the vendor is down: say so; this try doesn't count)
        log.warning("face check failed at the provider: %s", type(e).__name__)
        raise ApiError(
            502, "vendor_error", "The face check couldn’t be reached just now. Please try again in a few minutes."
        ) from None
    live_ok = live.score >= float(fs["liveness_min"])
    match_ok = match.score >= float(fs["match_min"])
    passed = live_ok and match_ok
    reason = "" if passed else (live.reason if not live_ok else match.reason) or "The check didn’t pass."
    ref_enc = None
    if passed:
        try:
            ref_enc = encrypt(await p.enroll(uid, frames[0], hint=hint))
        except Exception as e:  # noqa: BLE001  (verified all the same; the joining check then asks a person)
            log.warning("face enroll failed: %s", type(e).__name__)
    vendor_ref = "/".join(x for x in (idr.vendor_ref, live.vendor_ref, match.vendor_ref) if x)[:300]
    await _row(db, uid, "identity", p, step=step, doc_type=doc_type, liveness={"pass": live_ok, "score": round(live.score, 1)},
               match={"pass": match_ok, "score": round(match.score, 1)}, passed=passed, vendor_ref=vendor_ref)  # fmt: skip
    tries = int((st or {}).get("tries") or 0) + (0 if passed else 1)
    sets: dict[str, Any] = {"doc_type": doc_type, "liveness": {"pass": live_ok, "score": round(live.score, 1)},
                            "match": {"pass": match_ok, "score": round(match.score, 1)}, "vendor": p.key, "vendor_ref": vendor_ref,
                            "test": p.test, "tries": tries, "last_reason": reason, "updated_at": t, "process_at": t,
                            "challenge": None}  # fmt: skip
    if passed:
        sets |= {"status": "verified", "verified_at": t, "verified_by": "check", "reference_enc": ref_enc}
    elif tries >= int(fs["max_tries"]):
        sets |= {
            "status": "review",
            "review": {"status": "open", "kind": "tries", "requested_at": t, "last_reason": reason, "step": step},
        }
    else:
        sets["status"] = "retry"
    await db[TRUST_FACE].update_one(
        {"_id": uid}, {"$set": sets, "$setOnInsert": {"user_id": uid, "created_at": t}}, upsert=True
    )
    await audit(
        db,
        uid,
        "trust.face_check",
        target=uid,
        data={"vendor": p.key, "passed": passed, "status": sets["status"], "step": step},
    )
    return state_out(await get_state(db, uid), fs)


# --- the joining day -----------------------------------------------------------------------------------------------------


def _join_open(o: dict[str, Any], today: date) -> bool:
    try:
        d = date.fromisoformat(o["join_date"])
    except (KeyError, ValueError):
        return False
    return d - timedelta(days=JOIN_BEFORE_DAYS) <= today <= d + timedelta(days=JOIN_AFTER_DAYS)


async def joining_offers(db, uid: str) -> list[dict[str, Any]]:
    today = now().astimezone(IST).date()
    out = []
    async for o in (
        db[HIRE_OFFERS].find({"user_id": uid, "status": {"$in": ["accepted", "joined"]}}).sort("join_date", 1)
    ):
        if _join_open(o, today):
            out.append(
                {
                    "offerId": str(o["_id"]),
                    "company": o.get("company_name", ""),
                    "joinDate": o["join_date"],
                    "title": o.get("title", ""),
                }
            )
    return out


async def run_joining(db, uid: str, *, offer_id: str, frames: list[bytes], challenge_key: str) -> dict[str, Any]:
    site, u, p = await _context(db, uid)
    fs = face_settings(site)
    if not p:
        raise ApiError(503, "provider_off", "The face check isn’t connected yet. Please try again later.")
    if offer_id not in {o["offerId"] for o in await joining_offers(db, uid)}:
        raise ApiError(
            409, "not_joining", "The joining check opens a week before your join date (for an accepted offer)."
        )
    st = await get_state(db, uid)
    if not st or st.get("status") != "verified" or not st.get("reference_enc"):
        raise ApiError(
            409, "no_reference", "There is no earlier ID + selfie check to compare with. Please ask for a manual check."
        )
    c = st.get("continuity") or {}
    if c.get("status") == "same" and c.get("offer_id") == offer_id:
        return state_out(st, fs)
    if c.get("status") in ("review", "not_same") and c.get("offer_id") == offer_id:
        raise ApiError(409, "with_a_person", "A person at Nm7 is checking your joining-day selfie.")
    if st.get("vendor") != p.key:
        raise ApiError(409, "no_reference", "Your earlier check was made another way. Please ask for a manual check.")
    _check_challenge(st, challenge_key)
    hint = u.get("name") or ""
    t = now()
    try:
        live = await p.liveness(frames, challenge_key, hint=hint)
        same = await p.same_person(uid, decrypt(st["reference_enc"]), frames[0], hint=hint)
    except Exception as e:  # noqa: BLE001
        log.warning("joining check failed at the provider: %s", type(e).__name__)
        raise ApiError(
            502, "vendor_error", "The face check couldn’t be reached just now. Please try again in a few minutes."
        ) from None
    live_ok = live.score >= float(fs["liveness_min"])
    same_ok = same.score >= float(fs["same_min"])
    passed = live_ok and same_ok
    reason = "" if passed else (live.reason if not live_ok else same.reason) or "The check didn’t pass."
    await _row(db, uid, "joining", p, offer_id=offer_id, liveness={"pass": live_ok, "score": round(live.score, 1)},
               match={"pass": same_ok, "score": round(same.score, 1)}, passed=passed,
               vendor_ref="/".join(x for x in (live.vendor_ref, same.vendor_ref) if x)[:300])  # fmt: skip
    tries = (int(c.get("tries") or 0) if c.get("offer_id") == offer_id else 0) + (0 if passed else 1)
    new = {"offer_id": offer_id, "tries": tries, "score": round(same.score, 1), "at": t, "last_reason": reason,
           "status": "same" if passed else "review" if tries >= int(fs["max_tries"]) else "retry"}  # fmt: skip
    if new["status"] == "review":
        new["review"] = {"status": "open", "kind": "tries", "requested_at": t, "last_reason": reason}
    await db[TRUST_FACE].update_one(
        {"_id": uid}, {"$set": {"continuity": new, "challenge": None, "updated_at": t, "process_at": t}}
    )
    await audit(
        db,
        uid,
        "trust.face_joining",
        target=uid,
        data={"vendor": p.key, "passed": passed, "status": new["status"], "offer": offer_id},
    )
    return state_out(await get_state(db, uid), fs)


# --- asking for a person -------------------------------------------------------------------------------------------------


async def request_manual(
    db, uid: str, *, reason: str, note: str, which: str, offer_id: str | None = None
) -> dict[str, Any]:
    """No camera, a disability, or the check keeps failing: a person at Nm7 verifies (a video call). Never blocks."""
    site, _, _ = await _context(db, uid)
    fs = face_settings(site)
    t = now()
    rv = {"status": "open", "kind": "manual", "reason": reason, "note": " ".join(note.split())[:600], "requested_at": t}
    if which == "joining":
        offers = {o["offerId"] for o in await joining_offers(db, uid)}
        if offer_id not in offers:
            raise ApiError(
                409, "not_joining", "The joining check opens a week before your join date (for an accepted offer)."
            )
        st = await get_state(db, uid) or {}
        c = st.get("continuity") or {}
        if c.get("status") == "same" and c.get("offer_id") == offer_id:
            raise ApiError(409, "done", "Your joining check is already done.")
        cont = {
            **(c if c.get("offer_id") == offer_id else {}),
            "offer_id": offer_id,
            "status": "review",
            "review": rv,
            "at": t,
        }
        await db[TRUST_FACE].update_one({"_id": uid}, {"$set": {"continuity": cont, "updated_at": t, "process_at": t},
                                        "$setOnInsert": {"user_id": uid, "status": "none", "tries": 0, "created_at": t}}, upsert=True)  # fmt: skip
    else:
        st = await get_state(db, uid) or {}
        if st.get("status") == "verified":
            raise ApiError(409, "done", "Your ID + selfie is already verified.")
        await db[TRUST_FACE].update_one({"_id": uid}, {"$set": {"status": "review", "review": rv, "updated_at": t, "process_at": t},
                                        "$setOnInsert": {"user_id": uid, "tries": 0, "created_at": t}}, upsert=True)  # fmt: skip
    await audit(db, uid, "trust.face_manual_request", target=uid, data={"reason": reason, "which": which})
    return state_out(await get_state(db, uid), fs)


async def decide(db, uid: str, admin_id: str, *, which: str, decision: str, method: str, note: str) -> dict[str, Any]:
    """A person's decision. identity: verified / not_cleared / reset (tries again); joining: same / not_same / reset."""
    st = await get_state(db, uid)
    if not st:
        raise ApiError(404, "not_found", "There is no face check for this person.")
    t = now()
    done = {"decided_at": t, "decided_by": admin_id, "method": method, "decision_note": note.strip()[:600]}
    if which == "identity":
        rv = {
            **(st.get("review") or {"kind": "admin"}),
            **done,
            "status": {"verified": "cleared", "not_cleared": "not_cleared", "reset": "reset"}[decision],
        }
        sets: dict[str, Any] = {"review": rv, "updated_at": t}
        if decision == "verified":
            sets |= {
                "status": "verified",
                "verified_at": t,
                "verified_by": "review",
            }  # no face reference: the joining check goes to a person
        elif decision == "not_cleared":
            sets["status"] = "not_cleared"
        else:
            sets |= {"status": "none", "tries": 0}
    else:
        c = st.get("continuity") or {}
        if not c:
            raise ApiError(409, "no_joining", "This person has no joining check.")
        rv = {
            **(c.get("review") or {"kind": "admin"}),
            **done,
            "status": {"same": "cleared", "not_same": "not_cleared", "reset": "reset"}[decision],
        }
        new = {**c, "review": rv, "at": t}
        new["status"] = {"same": "same", "not_same": "not_same", "reset": "retry"}[decision]
        if decision == "reset":
            new["tries"] = 0
        sets = {"continuity": new, "updated_at": t}
    await db[TRUST_FACE].update_one({"_id": uid}, {"$set": sets})
    await audit(
        db, admin_id, "trust.face_review", target=uid, data={"which": which, "decision": decision, "method": method}
    )
    return sets


# --- company badges ------------------------------------------------------------------------------------------------------


async def badges(
    db, uids: list[str], company: dict[str, Any], account: dict[str, Any] | None
) -> dict[str, dict[str, Any]] | None:
    """{uid: {verifiedAt, samePersonAt, test}} for people whose ID + selfie is verified; None when Vetting Trust is
    hidden from this company. Never a photo, a score or a reason. Test-provider results only on a demo company or
    outside production."""
    from app.trust import access

    if not await access.for_company(db, company, account):
        return None
    show_test = bool(company.get("demo")) or not get_settings().is_prod
    q: dict[str, Any] = {"_id": {"$in": list(uids)}, "status": "verified"}
    if not show_test:
        q["test"] = {"$ne": True}
    out: dict[str, dict[str, Any]] = {}
    async for s in db[TRUST_FACE].find(q, {"verified_at": 1, "continuity": 1, "test": 1}):
        c = s.get("continuity") or {}
        out[s["_id"]] = {"verifiedAt": ms(s.get("verified_at")), "samePersonAt": ms(c.get("at")) if c.get("status") == "same" else None,
                         "test": bool(s.get("test"))}  # fmt: skip
    return out


async def counts(db) -> dict[str, int]:
    start = now().astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    return {
        "checksToday": await db[TRUST_SELFIES].count_documents({"kind": "identity", "created_at": {"$gte": start}}),
        "passedToday": await db[TRUST_SELFIES].count_documents(
            {"kind": "identity", "passed": True, "created_at": {"$gte": start}}
        ),
        "failedToday": await db[TRUST_SELFIES].count_documents(
            {"kind": {"$in": ["identity", "joining"]}, "passed": False, "created_at": {"$gte": start}}
        ),
        "verified": await db[TRUST_FACE].count_documents({"status": "verified"}),
        "samePerson": await db[TRUST_FACE].count_documents({"continuity.status": "same"}),
        "review": await db[TRUST_FACE].count_documents(
            {"$or": [{"review.status": "open"}, {"continuity.review.status": "open"}]}
        ),
    }


# --- retention (T1 framework) --------------------------------------------------------------------------------------------


async def _forget(db, st: dict[str, Any]) -> None:
    if not st.get("reference_enc"):
        return
    p = P.get(st.get("vendor") or "")
    if not p:
        return
    try:
        await p.forget(decrypt(st["reference_enc"]))
    except Exception as e:  # noqa: BLE001  (the row goes all the same; logged for a manual clean-up at the vendor)
        log.warning("face forget failed at %s: %s", p.key, type(e).__name__)


async def erase_state(db, uid: str) -> int:
    st = await get_state(db, uid)
    if not st:
        return 0
    await _forget(db, st)
    return (await db[TRUST_FACE].delete_one({"_id": uid})).deleted_count


async def _clean(db, cutoff: datetime, cap: int) -> int:
    """States whose hiring process ended more than N days ago. Someone with an open offer is still in a hiring process:
    their time starts again instead."""
    n = 0
    async for st in db[TRUST_FACE].find({"process_at": {"$lt": cutoff}}).limit(cap):
        if await db[HIRE_OFFERS].find_one({"user_id": st["_id"], "status": {"$in": ["sent", "accepted"]}}, {"_id": 1}):
            await db[TRUST_FACE].update_one({"_id": st["_id"]}, {"$set": {"process_at": now()}})
            continue
        await _forget(db, st)
        n += (await db[TRUST_FACE].delete_one({"_id": st["_id"], "process_at": {"$lt": cutoff}})).deleted_count
    return n


R.register(R.DataType("face_check", "ID + selfie check: result, retries, review and the face-check partner’s face reference (never the photos)",
                      30, 7, 90, TRUST_FACE, field="process_at", purpose="selfie_face", clean=_clean, erase=erase_state,
                      note="Deleted by the daily job this many days after the hiring process ends (no open offer); the partner’s face data with it"))  # fmt: skip
