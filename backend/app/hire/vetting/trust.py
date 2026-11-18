# ruff: noqa: E501  (dense response shapes)
"""Vetting V5: keeping the badges honest and fair.

- Daily fraud scan → Admin → Integrity (kind "fraud"), with the evidence; a person decides, nothing is banned
  automatically. Finds: one phone number or one device on several accounts, nearly identical resumes on different
  accounts, impossible resume dates, and copied answers / task text across accounts (V2's signals).
- Re-verify: reminders at day 75 and day 85 of a 90-day badge; a short 8-question refresher (not the full test, the
  same band) renews it for 90 days; skipped, the badge expires and ranks as unverified. (L3 lasts 180 days; L4
  references a year.)
- Appeals: one tap "I think this is wrong" on a skill check, a practical task or an interview → a person reviews it
  within 72 hours → a free retest, a corrected score, or kept as it is, with a reason. Every appeal and its outcome is
  logged; the appeal rate per role points at bad questions.
- Monthly fairness report: pass rates by language, city tier and experience band (no caste, religion or similar is
  ever collected).
- DPDP: download everything we hold about you (GET /api/me/data-export); delete stays in Settings (7-day undo).
  Retention: audio is never stored, photos 30 days, transcripts 180 days, raw IPs 30 days (scheduled cleanup).
"""

import hashlib
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from html import escape
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.core.config import get_settings
from app.core.db import (
    DB,
    HIRE_PROFILES,
    RESUMES,
    SKILL_ATTEMPTS,
    TRUST_CONSENTS,
    USERS,
    VETTING_INTERVIEWS,
    VETTING_LEVEL_LOG,
    VETTING_QUEUE,
    VETTING_VERIFIED,
)
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.hire.available import wants_email
from app.hire.vetting import engine as E
from app.hire.vetting.roles import BY_TEST
from app.me.service import ms


async def _on(auth: CustomerAuth, db: DB) -> None:
    """404 while the vetting engine is hidden from this person (Admin → Skill checks → Launch)."""
    from app.hire.vetting import access

    if not await access.for_user(db, auth.user.id):
        raise ApiError(404, "not_found", "Not found.")


me = APIRouter(prefix="/api/me", tags=["vetting"], dependencies=[Depends(_on)])
admin = APIRouter(prefix="/api/admin/vetting", tags=["vetting"])

REFRESH_QUESTIONS = 8
REMIND_DAYS = (75, 85)
APPEAL_HOURS = 72
TIER1 = {
    "mumbai",
    "delhi",
    "new delhi",
    "bengaluru",
    "bangalore",
    "hyderabad",
    "chennai",
    "kolkata",
    "pune",
    "ahmedabad",
}
TIER2 = {"jaipur", "lucknow", "kochi", "coimbatore", "indore", "nagpur", "visakhapatnam", "vijayawada", "bhopal", "chandigarh", "surat",
         "vadodara", "mysuru", "mysore", "madurai", "guntur", "warangal", "thiruvananthapuram", "bhubaneswar", "patna", "noida", "gurugram"}  # fmt: skip


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That item isn’t here.") from None


def city_tier(city: str | None) -> str:
    c = (city or "").split(",")[0].strip().lower()
    return "tier 1" if c in TIER1 else "tier 2" if c in TIER2 else "tier 3 / other" if c else "not given"


# --- fraud scan ---------------------------------------------------------------------------------------------------


def digits(phone: str) -> str:
    d = re.sub(r"\D", "", phone or "")
    return d[-10:] if len(d) >= 10 else ""


def resume_words(d: dict[str, Any]) -> str:
    from app.orgs.ats import resume_text

    try:
        return " ".join(re.findall(r"[a-z0-9]+", resume_text(d).lower()))
    except Exception:
        return ""


def impossible_dates(d: dict[str, Any], t: datetime) -> list[str]:
    """Resume dates that can't be true: an end before its start, a start in the future, or 3+ jobs at once."""
    out = []
    current = 0

    def year_month(s: Any) -> tuple[int, int] | None:
        m = re.search(r"(19|20)\d{2}", str(s or ""))
        if not m:
            return None
        mm = re.search(r"(?:^|\D)(0?[1-9]|1[0-2])(?:\D|$)", str(s).replace(m.group(0), ""))
        return int(m.group(0)), int(mm.group(1)) if mm else 1

    for kind in ("exp", "edu"):
        for e in d.get(kind) or []:
            if not isinstance(e, dict):
                continue
            a, b = year_month(e.get("from")), year_month(e.get("to"))
            label = e.get("company") or e.get("role") or e.get("institution") or e.get("degree") or kind
            if a and b and b < a:
                out.append(f"{label}: ends before it starts")
            if a and a > (t.year, t.month):
                out.append(f"{label}: starts in the future")
            if kind == "exp" and e.get("current") and not e.get("off"):
                current += 1
    if current >= 3:
        out.append(f"{current} jobs marked as current at the same time")
    return out


DEMO_PREFIXES = ("hire-demo-", "demo-")  # made-up people (their resumes are skipped without a lookup)


async def _finding(db, key: str, kind: str, users: list[str], evidence: list[str]) -> bool:
    """One open fraud item per key (a phone, a device, a pair of resumes...); evidence refreshed, never duplicated."""
    t = now()
    r = await db[VETTING_QUEUE].update_one(
        {"kind": "fraud", "key": key},
        {"$set": {"what": kind, "users": users, "evidence": evidence[:10], "updated_at": t},
         "$setOnInsert": {"status": "open", "created_at": t, "user_id": users[0] if users else None, "skill": ""}},
        upsert=True,
    )  # fmt: skip
    return bool(r.upserted_id)


async def fraud_scan(db, t: datetime | None = None) -> dict[str, int]:
    """Memory-safe on the 512 MB server: resumes are streamed in small batches and only small values are kept (the
    phone digits and a short fingerprint per resume); the few resumes whose fingerprints match are fetched again to
    compare their text. Never the whole collection in memory at once."""
    t = t or now()
    found: Counter[str] = Counter()
    phones: dict[str, set[str]] = defaultdict(set)
    buckets: dict[str, list[str]] = defaultdict(list)  # fingerprint → resume ids
    owner: dict[Any, str] = {}  # resume id → user id, only for resumes that share a fingerprint (filled below)
    async for r in db[RESUMES].find({"active": True}, {"user_id": 1, "data": 1}, batch_size=200).limit(20000):
        uid = r["user_id"]
        if str(uid).startswith(DEMO_PREFIXES):
            continue
        d = r.get("data") or {}
        p = digits(str((d.get("personal") or {}).get("phone") or ""))
        if p:
            phones[p].add(uid)
        bad = impossible_dates(d, t)
        if bad:
            found["dates"] += await _finding(db, f"dates:{uid}", "Resume dates that can't be true", [uid], bad)
        w = resume_words(d)
        if len(w.split()) >= 60:
            top = " ".join(sorted(x for x, _ in Counter(w.split()).most_common(12)))
            buckets[hashlib.sha1(top.encode()).hexdigest()[:20]].append(r["_id"])
        del r, d, w
    demo = {u["_id"] async for u in db[USERS].find({"demo": True}, {"_id": 1})}
    # one phone on several accounts
    for p, uids in phones.items():
        uids = uids - demo
        if len(uids) > 1:
            found["phone"] += await _finding(db, f"phone:{hashlib.sha256(p.encode()).hexdigest()[:16]}", "Same phone number on several accounts",
                                             sorted(uids), [f"Phone ending …{p[-4:]} is on {len(uids)} accounts"])  # fmt: skip
    phones.clear()
    # nearly identical resumes on different accounts: only buckets with 2+ resumes are fetched again
    for ids in buckets.values():
        if len(ids) < 2:
            continue
        group = []
        async for r in db[RESUMES].find({"_id": {"$in": ids[:60]}}, {"user_id": 1, "data": 1}):
            if r["user_id"] not in demo:
                group.append((r["user_id"], resume_words(r.get("data") or {})))
        for i in range(len(group)):
            for j in range(i + 1, min(len(group), i + 30)):
                (u1, w1), (u2, w2) = group[i], group[j]
                if u1 != u2 and E.text_similarity(w1, w2) >= 0.9:
                    found["resume"] += await _finding(db, f"resume:{min(u1, u2)}:{max(u1, u2)}", "Nearly identical resumes", sorted({u1, u2}),
                                                      ["Two accounts have resumes that are more than 90% the same text"])  # fmt: skip
    del owner
    # one device on several accounts (V2's salted device hash, kept 30 days)
    devices: dict[str, set[str]] = defaultdict(set)
    async for a in db[SKILL_ATTEMPTS].find(
        {"fp.device": {"$exists": True}, "started_at": {"$gt": t - timedelta(days=30)}}, {"user_id": 1, "fp": 1}
    ):
        devices[a["fp"]["device"]].add(a["user_id"])
    for dv, uids in devices.items():
        if len(uids) > 1:
            found["device"] += await _finding(db, f"device:{dv[:16]}", "Same device on several accounts", sorted(uids),
                                              [f"The same device took skill checks on {len(uids)} accounts in 30 days"])  # fmt: skip
    # copied answers / task text (V2 flags them per attempt)
    async for a in db[SKILL_ATTEMPTS].find({"submitted_at": {"$gt": t - timedelta(days=2)}, "$or": [{"signals.patternMatch": True}, {"signals.textMatch": True}]},
                                           {"user_id": 1, "skill": 1, "signals": 1}):  # fmt: skip
        why = (
            "Same wrong answers in the same order as another account"
            if a["signals"].get("patternMatch")
            else "Practical task text nearly the same as another account's"
        )
        found["copied"] += await _finding(
            db, f"copied:{a['_id']}", "Copied answers", [a["user_id"]], [f"{a['skill']}: {why}"]
        )
    return dict(found)


# --- re-verify ------------------------------------------------------------------------------------------------------


def reverify_email(u: dict[str, Any], v: dict[str, Any], days_left: int) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (u.get("name") or "").split(" ")[0] or "there"
    link = f"{site}/me/skill-checks?refresh={v['test']}"
    lines = [f"Hi {first},", "", f"Your “Skill verified · {v['test']}” badge ends in {days_left} days.",
             f"Keep it with a short refresher: {REFRESH_QUESTIONS} questions, about 5 minutes. Pass it and the badge "
             "lasts another 90 days.", "", f"Refresh now: {link}", "",
             "If you skip it, the badge shows as expired and companies rank you as unverified."]  # fmt: skip
    html = (f'<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p>Hi {escape(first)},</p>'
            f"<p>Your “Skill verified · {escape(v['test'])}” badge ends in {days_left} days.</p>"
            f"<p>Keep it with a short refresher: {REFRESH_QUESTIONS} questions, about 5 minutes. Pass it and the badge "
            f'lasts another 90 days.</p><p><a href="{escape(link)}">Refresh now</a></p>'
            '<p style="color:#666;font-size:13px">If you skip it, the badge shows as expired and companies rank you as '
            "unverified.</p></div>")  # fmt: skip
    return Email(
        to=u["email"],
        to_name=u.get("name", ""),
        subject=f"Your {v['test']} badge ends in {days_left} days",
        text="\n".join(lines),
        html=html,
    )


async def reverify_reminders(db, mailer: Mailer, t: datetime | None = None) -> int:
    """Day 75 and day 85 of the 90 days: one email each, never twice. While the vetting engine is hidden (Admin →
    Skill checks → Launch) only the testers get them; nobody else is marked as reminded, so they still get theirs
    after the launch."""
    from app.hire.vetting import access

    t = t or now()
    sent = 0
    hidden = not await access.is_public(db)
    testers = await access.testers(db)
    if hidden and not testers:
        return 0
    for day in REMIND_DAYS:
        q = {"at": {"$lte": t - timedelta(days=day)}, "expires_at": {"$gt": t}, f"reminded.d{day}": {"$exists": False}}
        async for v in db[VETTING_VERIFIED].find(q).limit(500):
            if hidden:
                who = await db[USERS].find_one({"_id": v["user_id"]}, {"email_lc": 1, "email": 1}) or {}
                if (who.get("email_lc") or who.get("email") or "").lower() not in testers:
                    continue
            claimed = await db[VETTING_VERIFIED].update_one(
                {"_id": v["_id"], f"reminded.d{day}": {"$exists": False}}, {"$set": {f"reminded.d{day}": t}}
            )
            if not claimed.modified_count:
                continue
            u = await db[USERS].find_one({"_id": v["user_id"]})
            if wants_email(u):
                sent += await send_safely(mailer, reverify_email(u, v, max(1, (v["expires_at"] - t).days)))
    return sent


async def renew(db, a: dict[str, Any]) -> dict[str, Any] | None:
    """A passed refresher (score ≥ 70, integrity not "needs retest"): the badge lasts another 90 days."""
    if (
        a.get("kind") != "refresh"
        or (a.get("score") or 0) < E.PASS_MCQ
        or (a.get("integrity") or {}).get("level") == "retest"
    ):
        return None
    t = now()
    until = t + E.VALID
    await db[VETTING_VERIFIED].update_one({"user_id": a["user_id"], "test": a["skill"]},
                                          {"$set": {"expires_at": until, "renewed_at": t, "expired": False}, "$unset": {"reminded": ""}})  # fmt: skip
    await db[USERS].update_one({"_id": a["user_id"], "verified_skills.skill": a["skill"], "verified_skills.source": "v2"},
                               {"$set": {"verified_skills.$.expires_at": until, "verified_skills.$.expired": False}})  # fmt: skip
    from app.hire.vetting.ladder import refresh

    await refresh(db, a["user_id"], f"badge renewed: {a['skill']}")
    await audit(db, a["user_id"], "vetting.renewed", data={"skill": a["skill"]})
    return await db[VETTING_VERIFIED].find_one({"user_id": a["user_id"], "test": a["skill"]})


# --- appeals --------------------------------------------------------------------------------------------------------


class AppealIn(CamelModel):
    kind: Literal["skill", "task", "interview"]
    ref: str = Field(min_length=10, max_length=40)  # the attempt or interview id
    reason: str = Field(min_length=10, max_length=1000)


@me.post("/appeals")
async def appeal(body: AppealIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    coll = VETTING_INTERVIEWS if body.kind == "interview" else SKILL_ATTEMPTS
    doc = await db[coll].find_one({"_id": _oid(body.ref), "user_id": uid})
    if (
        not doc
        or (body.kind != "interview" and not doc.get("submitted_at"))
        or (body.kind == "interview" and doc.get("status") not in ("graded",))
    ):
        raise ApiError(404, "not_found", "Finish it first; then you can ask us to look again.")
    if await db[VETTING_QUEUE].find_one({"kind": "appeal", "ref": doc["_id"], "what": body.kind}):
        raise ApiError(409, "already", "You have asked about this one already. Our team replies within 72 hours.")
    t = now()
    item = {"kind": "appeal", "what": body.kind, "ref": doc["_id"], "user_id": uid, "skill": doc.get("skill") or doc.get("test"),
            "reason": " ".join(body.reason.split()), "status": "open", "created_at": t, "due_at": t + timedelta(hours=APPEAL_HOURS)}  # fmt: skip
    await db[VETTING_QUEUE].insert_one(item)
    await audit(db, uid, "vetting.appeal", data={"kind": body.kind, "skill": item["skill"]})
    return {"ok": True, "dueAt": ms(item["due_at"])}


@me.get("/appeals")
async def my_appeals(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    rows = await db[VETTING_QUEUE].find({"kind": "appeal", "user_id": auth.user.id}).sort("created_at", -1).to_list(50)
    return {"items": [{"id": str(r["_id"]), "what": r["what"], "ref": str(r["ref"]), "skill": r["skill"], "status": r["status"],
                       "outcome": r.get("outcome"), "note": r.get("note", ""), "createdAt": ms(r["created_at"]), "dueAt": ms(r["due_at"])} for r in rows]}  # fmt: skip


class DecideIn(CamelModel):
    outcome: Literal["retest", "corrected", "kept"]
    score: int | None = Field(None, ge=0, le=100)  # for "corrected": the new test or task score (0–100)
    note: str = Field(min_length=3, max_length=500)


@admin.post("/appeals/{iid}")
async def decide_appeal(iid: str, body: DecideIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    x = await db[VETTING_QUEUE].find_one({"_id": _oid(iid), "kind": "appeal", "status": "open"})
    if not x:
        raise ApiError(404, "not_found", "That appeal isn’t open.")
    if body.outcome == "corrected" and body.score is None:
        raise ApiError(400, "score", "Give the corrected score.")
    if body.outcome == "retest":
        if x["what"] == "interview":
            await db[VETTING_INTERVIEWS].update_one(
                {"_id": x["ref"]}, {"$set": {"started_at": now() - timedelta(days=31)}}
            )
        else:
            await db[SKILL_ATTEMPTS].update_one(
                {"_id": x["ref"]}, {"$set": {"retest_offered": True, "retest_used": False}}
            )
    elif body.outcome == "corrected" and x["what"] in ("skill", "task"):
        a = await db[SKILL_ATTEMPTS].find_one({"_id": x["ref"]})
        sets = {"score": body.score} if x["what"] == "skill" else {"task.score": body.score, "task.status": "graded"}
        await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": {**sets, "corrected_by": auth.user.id}})
        from app.hire.vetting.router import award

        await award(db, await db[SKILL_ATTEMPTS].find_one({"_id": a["_id"]}))
    await db[VETTING_QUEUE].update_one({"_id": x["_id"]}, {"$set": {"status": "done", "outcome": body.outcome, "note": body.note,
                                                                    "by": auth.user.id, "done_at": now()}})  # fmt: skip
    await audit(db, auth.user.id, "vetting.appeal_decided", target=str(x["_id"]), data={"outcome": body.outcome})
    return {"outcome": body.outcome}


@admin.get("/appeals")
async def appeals(db: DB, _: AdminAuth("jobs"), status: Literal["open", "done"] = "open") -> dict[str, Any]:
    t = now()
    rows = (
        await db[VETTING_QUEUE]
        .find({"kind": "appeal", "status": status})
        .sort("created_at", 1 if status == "open" else -1)
        .to_list(200)
    )
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": [r["user_id"] for r in rows]}}, {"name": 1})}
    per: dict[str, dict[str, int]] = defaultdict(lambda: {"appeals": 0, "upheld": 0})
    async for r in db[VETTING_QUEUE].find(
        {"kind": "appeal", "created_at": {"$gt": t - timedelta(days=90)}}, {"skill": 1, "outcome": 1}
    ):
        per[r["skill"]]["appeals"] += 1
        per[r["skill"]]["upheld"] += r.get("outcome") in ("retest", "corrected")
    attempts = Counter()
    async for g in await db[SKILL_ATTEMPTS].aggregate(
        [{"$match": {"submitted_at": {"$gt": t - timedelta(days=90)}}}, {"$group": {"_id": "$skill", "n": {"$sum": 1}}}]
    ):
        attempts[g["_id"]] = g["n"]
    return {
        "items": [{"id": str(r["_id"]), "what": r["what"], "ref": str(r["ref"]), "skill": r["skill"], "reason": r["reason"],
                   "person": (users.get(r["user_id"]) or {}).get("name", ""), "createdAt": ms(r["created_at"]), "dueAt": ms(r["due_at"]),
                   "overdue": r["status"] == "open" and r["due_at"] < t, "outcome": r.get("outcome"), "note": r.get("note", "")} for r in rows],
        "perRole": [{"skill": k, **v, "rate": round(100 * v["appeals"] / attempts[k]) if attempts[k] else None} for k, v in sorted(per.items(), key=lambda kv: -kv[1]["appeals"])],
    }  # fmt: skip


# --- fraud items (Admin → Integrity, kind "fraud") ---------------------------------------------------------------


@admin.get("/fraud")
async def fraud_items(db: DB, _: AdminAuth("jobs"), status: Literal["open", "done"] = "open") -> dict[str, Any]:
    rows = await db[VETTING_QUEUE].find({"kind": "fraud", "status": status}).sort("updated_at", -1).to_list(200)
    ids = {u for r in rows for u in r.get("users") or []}
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": list(ids)}}, {"name": 1, "email": 1})}
    return {"items": [{"id": str(r["_id"]), "what": r["what"], "evidence": r.get("evidence") or [], "status": r["status"],
                       "people": [{"id": u, "name": (users.get(u) or {}).get("name", ""), "email": (users.get(u) or {}).get("email", "")} for u in r.get("users") or []],
                       "decision": r.get("decision"), "note": r.get("note", ""), "updatedAt": ms(r["updated_at"])} for r in rows]}  # fmt: skip


class FraudIn(CamelModel):
    decision: Literal["clear", "confirmed"]
    note: str = Field(min_length=3, max_length=500)


@admin.post("/fraud/{iid}")
async def decide_fraud(iid: str, body: FraudIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    """A person's decision is recorded; "confirmed" holds the people's badges back (no ban; Admin can act on accounts
    separately through the usual tools)."""
    x = await db[VETTING_QUEUE].find_one({"_id": _oid(iid), "kind": "fraud", "status": "open"})
    if not x:
        raise ApiError(404, "not_found", "That item isn’t open.")
    if body.decision == "confirmed":
        await db[VETTING_VERIFIED].update_many(
            {"user_id": {"$in": x.get("users") or []}}, {"$set": {"held": True, "expires_at": now()}}
        )
        for u in x.get("users") or []:
            from app.hire.vetting.ladder import refresh

            await refresh(db, u, "integrity: badge held")
    await db[VETTING_QUEUE].update_one({"_id": x["_id"]}, {"$set": {"status": "done", "decision": body.decision, "note": body.note,
                                                                    "by": auth.user.id, "done_at": now()}})  # fmt: skip
    await audit(db, auth.user.id, "vetting.fraud_decided", target=str(x["_id"]), data={"decision": body.decision})
    return {"decision": body.decision}


# --- fairness report ------------------------------------------------------------------------------------------------


@admin.get("/fairness")
async def fairness(db: DB, _: AdminAuth("jobs"), days: int = 30) -> dict[str, Any]:
    t = now()
    groups: dict[str, dict[str, list[int]]] = {"language": defaultdict(lambda: [0, 0]), "cityTier": defaultdict(lambda: [0, 0]),
                                               "band": defaultdict(lambda: [0, 0])}  # fmt: skip
    rows = await db[SKILL_ATTEMPTS].find({"v": 2, "submitted_at": {"$gt": t - timedelta(days=max(1, min(days, 365)))}},
                                         {"user_id": 1, "lang": 1, "band": 1, "score": 1}).to_list(50000)  # fmt: skip
    cities = {
        p["_id"]: (p.get("cities") or [None])[0]
        async for p in db[HIRE_PROFILES].find({"_id": {"$in": list({r["user_id"] for r in rows})}}, {"cities": 1})
    }
    for r in rows:
        ok = (r.get("score") or 0) >= E.PASS_MCQ
        for g, k in (
            ("language", {"en": "English", "te": "Telugu", "hi": "Hindi"}.get(r.get("lang", "en"), "English")),
            ("cityTier", city_tier(cities.get(r["user_id"]))),
            ("band", E.BANDS.get(r.get("band", "fresher"), E.BANDS["fresher"])["label"]),
        ):
            groups[g][k][0] += 1
            groups[g][k][1] += ok
    out = {
        g: [
            {"group": k, "attempts": v[0], "passRate": round(100 * v[1] / v[0]) if v[0] else None}
            for k, v in sorted(d.items())
        ]
        for g, d in groups.items()
    }
    return {"days": days, **out, "note": "Never collected: caste, religion, gender or anything similar."}


# --- DPDP: export and retention cleanup ---------------------------------------------------------------------------


def _clean(doc: dict[str, Any] | None, drop: tuple[str, ...] = ()) -> Any:
    if doc is None:
        return None
    out = {}
    for k, v in doc.items():
        if k in drop:
            continue
        if isinstance(v, ObjectId):
            v = str(v)
        elif isinstance(v, datetime):
            v = v.isoformat()
        elif isinstance(v, dict):
            v = _clean(v)
        elif isinstance(v, list):
            v = [
                _clean(x)
                if isinstance(x, dict)
                else (str(x) if isinstance(x, ObjectId) else x.isoformat() if isinstance(x, datetime) else x)
                for x in v
            ]
        out[k] = v
    return out


@me.get("/data-export")
async def data_export(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """Everything Nm7 holds about you, as one JSON file (DPDP). Internal security fields (password hash, session and
    secret keys, device hashes) are left out; they are not data about you a person can read."""
    uid = auth.user.id
    u = await db[USERS].find_one({"_id": uid})
    secret = ("password_hash", "totp_secret", "tokens", "sessions", "recovery_codes")
    return {
        "exportedAt": now().isoformat(),
        "account": _clean(u, secret),
        "resumes": [_clean(r) async for r in db[RESUMES].find({"user_id": uid})],
        "readyToJoin": _clean(await db[HIRE_PROFILES].find_one({"_id": uid})),
        "skillChecks": [
            _clean(a, ("order", "question_ids", "wrong", "fp")) async for a in db[SKILL_ATTEMPTS].find({"user_id": uid})
        ],
        "skillVerified": [_clean(v) async for v in db[VETTING_VERIFIED].find({"user_id": uid})],
        "interviews": [_clean(i) async for i in db[VETTING_INTERVIEWS].find({"user_id": uid})],
        "levelHistory": [_clean(x) async for x in db[VETTING_LEVEL_LOG].find({"user_id": uid})],
        "appeals": [_clean(x) async for x in db[VETTING_QUEUE].find({"user_id": uid, "kind": "appeal"})],
        "consents": [
            _clean(x, ("_id", "user_id")) async for x in db[TRUST_CONSENTS].find({"user_id": uid})
        ],  # Vetting Trust T1
    }


async def retention(db, t: datetime | None = None) -> dict[str, int]:
    """Daily: raw IPs in the audit log and device hashes after 30 days (Admin can shorten both). Both types live in the
    Vetting Trust retention schedule (app/trust/retention.py, runner "vetting"); photos and transcripts expire by
    themselves (30 and 180 days) and through the Trust job; audio is never stored."""
    from app.trust import retention as R

    out = await R.run_types(db, "vetting", t)
    return {"ips": out.get("audit_ips", 0), "devices": out.get("device_hashes", 0)}


async def daily_if_due(db, mailer: Mailer) -> dict[str, int]:
    from app.core.db import VETTING_DEMAND

    d = await db[VETTING_DEMAND].find_one({"_id": "trust"}) or {}
    if d.get("at") and d["at"] > now() - timedelta(hours=23):
        return {}
    # the retention clean-up rewrites existing records (raw IPs in the audit log): only once the engine is public
    from app.core.heavy import heavy_or_skip
    from app.hire.vetting import access

    async with heavy_or_skip(db) as ok:  # another heavy job running: try again on the next pass
        if not ok:
            return {}
        clean = await retention(db) if await access.is_public(db) else {"retention_waits": 1}
        out = {**(await fraud_scan(db)), **clean, "reverify": await reverify_reminders(db, mailer)}
    await db[VETTING_DEMAND].update_one({"_id": "trust"}, {"$set": {"at": now(), "last": out}}, upsert=True)
    return out


__all__ = ["BY_TEST"]
