# ruff: noqa: E501  (dense response shapes, one field group a line)
"""Vetting V2, the candidate side (replaces the H3 start / submit; same address, same collections).

  GET  /api/me/skill-checks                       the 50 roles: my last result, my badge, when I may start, suggested
                                                  roles (from my profile and from live-job demand)
  POST /api/me/skill-checks/consent               "I understand what is monitored" (once, before the first test)
  POST /api/me/skill-checks/start {skill, band, lang, extraTime}     a new paper (or the running one, to resume)
  PUT  /api/me/skill-checks/{id}/progress {answers, times, signals, fp}   saved as they go; the clock is server-side
  POST /api/me/skill-checks/{id}/submit {answers, times, signals, fp}     marked: score, topic scores, integrity
  GET  /api/me/skill-checks/{id}                  the result (and the practical task's state)
  POST /api/me/skill-checks/{id}/task/start       the practical task (after a pass at 70+)
  POST /api/me/skill-checks/{id}/task/submit {text | transcript+seconds | situations, photo?, signals}
  PUT  /api/me/skill-checks/{id}/share {share}    companies may see it (the badge is always shown once earned)

Monitoring (told up front, consent first): leaving the page (how often, how long), copy / paste, right-click and
developer tools, answer timing, a salted hash of the device and network. No camera; the microphone only in voice
tasks, and the browser turns speech into text, so no audio ever reaches the server. Companies never see integrity
signals, only the badge and scores.
"""

import hashlib
import logging
import random
import re
from datetime import datetime, timedelta
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Request
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core.config import get_settings
from app.core.db import DB, SKILL_ATTEMPTS, SKILL_QUESTIONS, USERS, VETTING_PHOTOS, VETTING_QUEUE, VETTING_VERIFIED
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.hire.vetting import engine as E
from app.hire.vetting import grade
from app.hire.vetting.roles import BY_TEST, ROLES
from app.hire.vetting.store import bank_meta, ensure_banks, localized
from app.me.service import ms

log = logging.getLogger(__name__)
me = APIRouter(prefix="/api/me/skill-checks", tags=["vetting"])

FILLERS = re.compile(r"\b(um+|uh+|er+|ah+|like|basically|actually|you know|i mean)\b", re.I)


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That test isn’t here.") from None


def salted(value: str) -> str:
    return hashlib.sha256(f"{get_settings().secret_key}|vetting|{value}".encode()).hexdigest()[:32]


def network_of(ip: str) -> str:
    """The /24 (IPv4) or /48 (IPv6) the request came from: only its salted hash is stored."""
    if ":" in ip:
        return ":".join(ip.split(":")[:3])
    return ".".join(ip.split(".")[:3])


async def active_pool(db, test: str) -> list[dict[str, Any]]:
    return await db[SKILL_QUESTIONS].find({"skill": test, "active": True}).to_list(1000)


def verified_out(v: dict[str, Any] | None, t: datetime | None = None) -> dict[str, Any] | None:
    if not v:
        return None
    t = t or now()
    return {
        "test": v["test"], "role": v.get("role", ""), "band": v["band"], "bandLabel": E.BANDS[v["band"]]["label"],
        "score": v["score"], "taskScore": v["task_score"], "taskStars": E.stars(v["task_score"]),
        "at": ms(v["at"]), "expiresAt": ms(v["expires_at"]), "expired": E.is_expired(v["expires_at"], t),
    }  # fmt: skip


def task_out(a: dict[str, Any], lang: str = "en") -> dict[str, Any]:
    tk = a.get("task") or {}
    st = tk.get("status") or ("open" if a.get("score", 0) >= E.PASS_MCQ and a.get("submitted_at") else "locked")
    out: dict[str, Any] = {
        "status": st,
        "type": tk.get("type"),
        "score": tk.get("score"),
        "stars": E.stars(tk.get("score")),
    }
    if tk.get("feedback"):
        out["feedback"] = [{"label": f["label"], "score": f["score"], "reason": f["reason"]} for f in tk["feedback"]]
    if tk.get("photo"):
        out["photo"] = {"checked": tk["photo"].get("genuine") in ("yes", "unsure"), "faces": tk["photo"].get("faces")}
    if st == "started":
        out["endsAt"] = ms(tk.get("ends_at"))
    return out


def result_out(a: dict[str, Any], v: dict[str, Any] | None = None, t: datetime | None = None) -> dict[str, Any]:
    t = t or now()
    done = bool(a.get("submitted_at"))
    integ = (a.get("integrity") or {}).get("level", "clean")
    role = BY_TEST.get(a["skill"]) or {}
    topics = a.get("topics") or {}
    return {
        "id": str(a["_id"]), "skill": a["skill"], "slug": role.get("slug", ""), "role": role.get("role", ""),
        "v": a.get("v", 1), "band": a.get("band", "fresher"), "bandLabel": E.BANDS.get(a.get("band", "fresher"), E.BANDS["fresher"])["label"],
        "lang": a.get("lang", "en"), "startedAt": ms(a["started_at"]), "done": done,
        "score": a.get("score") if done else None, "right": a.get("right") if done else None, "total": a.get("total"),
        "topics": topics if done else {}, **(E.strengths(topics) if done else {"strong": [], "improve": []}),
        "pass": done and (a.get("score") or 0) >= E.PASS_MCQ, "late": bool(a.get("late")),
        "retest": done and integ == "retest",  # shown to the candidate politely; the reasons never are
        "freeRetest": bool(a.get("retest_offered")) and not a.get("retest_used"),
        "task": task_out(a, a.get("lang", "en")) if a.get("v") == 2 else None,
        "verified": verified_out(v, t), "share": bool(a.get("share")), "tabSwitches": int(a.get("tab_switches") or 0),
        "againAt": ms(a["started_at"] + E.RETAKE), "canRetry": a["started_at"] + E.RETAKE <= t,
        "strict": bool(a.get("strict")),
    }  # fmt: skip


# --- catalogue --------------------------------------------------------------------------------------------------

_DEMAND: dict[str, Any] = {"at": None, "counts": {}}


async def demand(db) -> dict[str, int]:
    """Live jobs per role (title words), counted at most once an hour."""
    from app.core.db import JOBS

    t = now()
    if _DEMAND["at"] and t - _DEMAND["at"] < timedelta(hours=1):
        return _DEMAND["counts"]
    titles = [
        j.get("title", "")
        async for j in db[JOBS].find({"status": "active", "demo": {"$ne": True}}, {"title": 1}).limit(5000)
    ]
    counts = {}
    for r in ROLES:
        words = [
            w for w in re.findall(r"[a-z]{3,}", r["role"].lower()) if w not in {"and", "executive", "staff", "junior"}
        ]
        counts[r["test"]] = sum(1 for x in titles if words and words[0] in x.lower())
    _DEMAND.update(at=t, counts=counts)
    return counts


async def suggested_for(db, uid: str) -> list[str]:
    """Roles that fit the person's resume (headline, skills) — up to 4."""
    from app.core.db import RESUMES

    r = await db[RESUMES].find_one({"user_id": uid, "active": True}) or await db[RESUMES].find_one(
        {"user_id": uid}, sort=[("updated_at", -1)]
    )
    d = (r or {}).get("data") or {}
    text = " ".join(
        [
            str((d.get("personal") or {}).get("headline") or ""),
            str(d.get("skillGroups") or ""),
            str(d.get("summary") or ""),
        ]
    ).lower()
    out = []
    for role in ROLES:
        keys = {role["test"].lower(), *re.findall(r"[a-z]{4,}", role["role"].lower())} - {
            "executive",
            "developer",
            "staff",
            "junior",
            "basics",
        }
        if any(k and k in text for k in keys):
            out.append(role["test"])
    return out[:4]


@me.get("")
async def catalog(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    from app.hire.skillcheck import ensure_bank

    await ensure_bank(db)
    await ensure_banks(db)
    uid, t = auth.user.id, now()
    counts = {g["_id"]: g["n"] async for g in await db[SKILL_QUESTIONS].aggregate(
        [{"$match": {"active": True}}, {"$group": {"_id": "$skill", "n": {"$sum": 1}}}])}  # fmt: skip
    last: dict[str, dict[str, Any]] = {}
    async for a in db[SKILL_ATTEMPTS].find({"user_id": uid}).sort("started_at", -1):
        last.setdefault(a["skill"], a)
    badges = {v["test"]: v async for v in db[VETTING_VERIFIED].find({"user_id": uid})}
    want = await demand(db)
    mine = await suggested_for(db, uid)
    u = await db[USERS].find_one({"_id": uid}, {"vetting_consent_at": 1}) or {}
    roles = []
    for r in ROLES:
        n = counts.get(r["test"], 0)
        if n < E.MIN_PAPER:
            continue
        a = last.get(r["test"])
        free = bool(a and a.get("retest_offered") and not a.get("retest_used"))
        roles.append({
            "test": r["test"], "slug": r["slug"], "role": r["role"], "group": r["group"], "langs": list(r["langs"]),
            "task": r["task"], "questions": n, "demand": want.get(r["test"], 0), "suggested": r["test"] in mine,
            "last": result_out(a, badges.get(r["test"]), t) if a else None, "verified": verified_out(badges.get(r["test"]), t),
            "canStart": E.can_start(a["started_at"] if a else None, t, free) or bool(a and not a.get("submitted_at")),
        })  # fmt: skip
    return {
        "pass": E.PASS_MCQ, "taskPass": E.PASS_TASK, "minutes": E.MINUTES, "questions": E.QUESTIONS,
        "retakeDays": E.RETAKE.days, "validDays": E.VALID.days, "consentAt": ms(u.get("vetting_consent_at")),
        "bands": [{"id": k, "label": v["label"]} for k, v in E.BANDS.items()], "roles": roles,
        "topDemand": sorted((r["test"] for r in roles), key=lambda x: -want.get(x, 0))[:5],
    }  # fmt: skip


@me.post("/consent")
async def consent(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    t = now()
    await db[USERS].update_one({"_id": auth.user.id}, {"$set": {"vetting_consent_at": t}})
    await audit(db, auth.user.id, "vetting.consent")
    return {"consentAt": ms(t)}


# --- the paper --------------------------------------------------------------------------------------------------


class StartIn(CamelModel):
    skill: str = Field(min_length=1, max_length=80)
    band: Literal["fresher", "1-3", "3-5", "5-8", "8+"] = "fresher"
    lang: Literal["en", "te", "hi"] = "en"
    extra_time: bool = False


def paper_out(a: dict[str, Any], picked: list[dict[str, Any]], t: datetime) -> dict[str, Any]:
    by = {q["_id"]: q for q in picked}
    qs = []
    for qid in a["question_ids"]:
        q = by.get(qid)
        if not q:
            continue
        text, opts = localized(q, a.get("lang", "en"))
        qs.append({"id": str(qid), "question": text, "options": [opts[i] for i in a["order"][str(qid)]],
                   "seconds": E.question_seconds(q, a.get("extra_time", False))})  # fmt: skip
    remaining, _ = E.tick(a["remaining_ms"], a["last_seen"], t) if not a.get("submitted_at") else (0, False)
    role = BY_TEST.get(a["skill"]) or {}
    return {
        "id": str(a["_id"]), "skill": a["skill"], "role": role.get("role", ""), "band": a["band"],
        "bandLabel": E.BANDS[a["band"]]["label"], "lang": a.get("lang", "en"), "strict": bool(a.get("strict")),
        "extraTime": bool(a.get("extra_time")), "totalMs": a["total_ms"], "remainingMs": remaining,
        "questions": qs, "answers": a.get("answers") or {}, "pass": E.PASS_MCQ,
    }  # fmt: skip


@me.post("/start")
async def start(body: StartIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    from app.hire.skillcheck import ensure_bank

    await ensure_bank(db)
    await ensure_banks(db)
    uid, t = auth.user.id, now()
    role = BY_TEST.get(body.skill)
    if not role:
        raise ApiError(404, "no_test", "There is no test for this skill yet.")
    u = await db[USERS].find_one({"_id": uid}, {"vetting_consent_at": 1}) or {}
    if not u.get("vetting_consent_at"):
        raise ApiError(409, "consent", "Please read what the test checks and tick “I understand” first.")
    lang = body.lang if body.lang in role["langs"] else "en"
    last = await db[SKILL_ATTEMPTS].find_one({"user_id": uid, "skill": body.skill}, sort=[("started_at", -1)])
    if last and not last.get("submitted_at") and last.get("v") == 2:
        if t - last["last_seen"] <= E.RESUME_WITHIN and last["remaining_ms"] > 0:
            picked = await db[SKILL_QUESTIONS].find({"_id": {"$in": last["question_ids"]}}).to_list(100)
            return paper_out(last, picked, t)  # the same paper, the time that was left
        await _finish(db, last, last.get("answers") or {}, last.get("times") or {}, {}, t, expired=True)
        last = await db[SKILL_ATTEMPTS].find_one({"_id": last["_id"]})
    free = bool(last and last.get("retest_offered") and not last.get("retest_used"))
    if last and not E.can_start(last["started_at"], t, free):
        again = last["started_at"] + E.RETAKE
        raise ApiError(409, "too_soon", f"You can take the {body.skill} check again from {again:%d %b}.",
                       extra={"againAt": ms(again)})  # fmt: skip
    pool = await active_pool(db, body.skill)
    if len(pool) < E.MIN_PAPER:
        raise ApiError(404, "no_test", "There is no test for this skill yet.")
    rng = random.SystemRandom()
    avoid = set(last["question_ids"]) if free else set()
    picked = E.build_paper(pool, body.band, avoid=avoid, rng=rng)
    total = E.total_seconds(picked, body.extra_time) * 1000
    a = {
        "_id": ObjectId(), "v": 2, "user_id": uid, "skill": body.skill, "slug": role["slug"], "band": body.band,
        "lang": lang, "extra_time": body.extra_time, "strict": free, "question_ids": [q["_id"] for q in picked],
        "order": {str(q["_id"]): E.option_order(q, rng) for q in picked}, "started_at": t, "last_seen": t,
        "ends_at": t + timedelta(milliseconds=total) + E.RESUME_WITHIN, "total_ms": total, "remaining_ms": total,
        "pauses": 0, "answers": {}, "times": {}, "signals": {}, "total": len(picked), "share": False,
        "submitted_at": None,
    }  # fmt: skip
    if free:
        await db[SKILL_ATTEMPTS].update_one({"_id": last["_id"]}, {"$set": {"retest_used": True}})
    await db[SKILL_ATTEMPTS].insert_one(a)
    await audit(
        db, uid, "hire.skill_check_start", data={"skill": body.skill, "band": body.band, "v": 2, "retest": free}
    )
    return paper_out(a, picked, t)


class Signals(CamelModel):
    blurs: int = Field(0, ge=0, le=10000)
    blur_ms: int = Field(0, ge=0, le=86_400_000)
    copies: int = Field(0, ge=0, le=10000)
    pastes: int = Field(0, ge=0, le=10000)
    context_menus: int = Field(0, ge=0, le=10000)
    devtools: int = Field(0, ge=0, le=100)


class ProgressIn(CamelModel):
    answers: dict[str, int] = Field(default_factory=dict)
    times: dict[str, int] = Field(default_factory=dict)  # ms spent on each question
    signals: Signals = Field(default_factory=Signals)
    fp: str = Field("", max_length=128)  # the page's device fingerprint (hashed again with a secret before storing)

    @field_validator("answers", "times")
    @classmethod
    def _few(cls, v: dict[str, int]) -> dict[str, int]:
        if len(v) > 25 or any(not isinstance(x, int) or x < 0 or x > 3_600_000 for x in v.values()):
            raise ValueError("Bad answers.")
        return v


async def _mine(db, aid: str, uid: str) -> dict[str, Any]:
    a = await db[SKILL_ATTEMPTS].find_one({"_id": _oid(aid), "user_id": uid})
    if not a or a.get("v") != 2:
        raise ApiError(404, "not_found", "That test isn’t here.")
    return a


def _merge_signals(old: dict[str, Any], new: Signals) -> dict[str, int]:
    n = new.model_dump(by_alias=True)  # blurMs, contextMenus: the names integrity() reads
    return {k: max(int(old.get(k) or 0), int(n.get(k) or 0)) for k in n}  # the page sends running totals


@me.put("/{aid}/progress")
async def progress(aid: str, body: ProgressIn, request: Request, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await _mine(db, aid, auth.user.id)
    t = now()
    if a.get("submitted_at"):
        return {"remainingMs": 0, "done": True}
    if t - a["last_seen"] > E.RESUME_WITHIN:
        await _finish(db, a, a.get("answers") or {}, a.get("times") or {}, {}, t, expired=True)
        return {"remainingMs": 0, "done": True}
    remaining, pause = E.tick(a["remaining_ms"], a["last_seen"], t)
    valid = {str(q) for q in a["question_ids"]}
    answers = {**(a.get("answers") or {}), **{k: v for k, v in body.answers.items() if k in valid}}
    times = {**(a.get("times") or {}), **{k: v for k, v in body.times.items() if k in valid}}
    sets = {"answers": answers, "times": times, "remaining_ms": remaining, "last_seen": t,
            "signals": _merge_signals(a.get("signals") or {}, body.signals)}  # fmt: skip
    if body.fp and not a.get("fp"):
        sets["fp"] = {"device": salted(body.fp), "net": salted(network_of(client_ip(request) or ""))}
    await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": sets, "$inc": {"pauses": int(pause)}})
    return {"remainingMs": remaining, "done": False}


@me.post("/{aid}/submit")
async def submit(aid: str, body: ProgressIn, request: Request, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await _mine(db, aid, auth.user.id)
    if a.get("submitted_at"):
        raise ApiError(409, "done", "This test is finished already.")
    t = now()
    remaining, pause = E.tick(a["remaining_ms"], a["last_seen"], t)
    late = remaining <= 0 and t - a["last_seen"] > timedelta(seconds=45)
    valid = {str(q) for q in a["question_ids"]}
    answers = {**(a.get("answers") or {}), **({} if late else {k: v for k, v in body.answers.items() if k in valid})}
    times = {**(a.get("times") or {}), **{k: v for k, v in body.times.items() if k in valid}}
    sig = _merge_signals(a.get("signals") or {}, body.signals)
    if body.fp and not a.get("fp"):
        a["fp"] = {"device": salted(body.fp), "net": salted(network_of(client_ip(request) or ""))}
        await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": {"fp": a["fp"]}})
    a["pauses"] = int(a.get("pauses") or 0) + int(pause)
    out = await _finish(db, {**a, "signals": sig}, answers, times, sig, t, late=late)
    return out


async def _finish(db, a: dict[str, Any], answers: dict[str, int], times: dict[str, int], sig: dict[str, Any],
                  t: datetime, *, late: bool = False, expired: bool = False) -> dict[str, Any]:  # fmt: skip
    """Marks the paper, scores integrity, updates question stats; a pass opens the practical task."""
    picked = await db[SKILL_QUESTIONS].find({"_id": {"$in": a["question_ids"]}}).to_list(100)
    picked.sort(key=lambda q: a["question_ids"].index(q["_id"]))
    m = E.mark(picked, a["order"], answers)
    wrong = E.wrong_pattern(picked, a["order"], answers)
    shown = [answers[str(q["_id"])] for q in picked if str(q["_id"]) in answers]
    since = t - E.RETAKE
    match = False
    if len(wrong) >= 6:
        async for o in db[SKILL_ATTEMPTS].find(
            {"skill": a["skill"], "user_id": {"$ne": a["user_id"]}, "submitted_at": {"$gte": since}, "wrong": {"$exists": True}},
            {"wrong": 1},
        ).limit(500):  # fmt: skip
            if E.patterns_match(wrong, o.get("wrong") or {}):
                match = True
                break
    shared = False
    if (a.get("fp") or {}).get("device"):
        shared = bool(await db[SKILL_ATTEMPTS].find_one(
            {"skill": a["skill"], "user_id": {"$ne": a["user_id"]}, "started_at": {"$gte": since},
             "$or": [{"fp.device": a["fp"]["device"]}]}, {"_id": 1}))  # fmt: skip
    signals = {
        **(a.get("signals") or {}), **sig, "fastAnswers": E.fast_answers(picked, times),
        "samePosition": E.same_position(shown), "patternMatch": match, "sharedDevice": shared,
        "resumeMismatch": E.resume_mismatch(a["band"], m["byDifficulty"]), "strict": bool(a.get("strict")),
        "pauses": int(a.get("pauses") or 0),
    }  # fmt: skip
    integ = E.integrity(signals)
    sets = {
        "submitted_at": t, "late": late or expired, "answers": answers, "times": times, "right": m["right"],
        "total": m["total"], "score": m["score"], "topics": m["topics"], "by_difficulty": m["byDifficulty"],
        "wrong": wrong, "signals": signals, "integrity": integ, "tab_switches": int(signals.get("blurs") or 0),
        "pauses": int(a.get("pauses") or 0),
    }  # fmt: skip
    if integ["level"] == "retest":
        sets["retest_offered"] = not a.get("strict")  # one free retest; a second "needs retest" goes to a person
    r = await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"], "submitted_at": None}, {"$set": sets})
    if not r.modified_count:
        raise ApiError(409, "done", "This test is finished already.")
    for q in picked:  # per-question stats for Admin (percentage right, average time)
        qid = str(q["_id"])
        ok = (
            qid in answers and a["order"][qid][answers[qid]] == q["answer"]
            if 0 <= answers.get(qid, -1) < len(a["order"][qid])
            else False
        )
        inc = {"stats.shown": 1, "stats.right": int(ok)}
        if qid in times:
            inc |= {"stats.time_ms": min(int(times[qid]), 600_000), "stats.timed": 1}
        if m["score"] >= 80:
            inc |= {"stats.top_shown": 1, "stats.top_right": int(ok)}
        await db[SKILL_QUESTIONS].update_one({"_id": q["_id"]}, {"$inc": inc})
    if integ["level"] == "retest" and (a.get("strict") or integ["serious"]):
        await _queue(db, "integrity", a, {"reasons": integ["reasons"], "points": integ["points"], "stage": "test"})
    await audit(db, a["user_id"], "hire.skill_check_done",
                data={"skill": a["skill"], "score": m["score"], "late": late, "v": 2, "integrity": integ["level"]})  # fmt: skip
    from app.seek.paths import on_skill_check

    await on_skill_check(db, a["user_id"], a["skill"])
    done = {**a, **sets}
    return result_out(done, await db[VETTING_VERIFIED].find_one({"user_id": a["user_id"], "test": a["skill"]}), t)


async def _queue(db, kind: str, a: dict[str, Any], data: dict[str, Any]) -> None:
    await db[VETTING_QUEUE].update_one(
        {"kind": kind, "attempt_id": a["_id"], "status": "open"},
        {"$set": {"data": data, "updated_at": now()},
         "$setOnInsert": {"user_id": a["user_id"], "skill": a["skill"], "created_at": now()}},
        upsert=True,
    )  # fmt: skip


@me.get("/{aid}")
async def result(aid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await _mine(db, aid, auth.user.id)
    return result_out(a, await db[VETTING_VERIFIED].find_one({"user_id": a["user_id"], "test": a["skill"]}))


# --- the practical task -----------------------------------------------------------------------------------------


@me.post("/{aid}/task/start")
async def task_start(aid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await _mine(db, aid, auth.user.id)
    if not a.get("submitted_at") or (a.get("score") or 0) < E.PASS_MCQ:
        raise ApiError(409, "locked", f"The practical task opens after scoring {E.PASS_MCQ} or more in the test.")
    if (a.get("integrity") or {}).get("level") == "retest":
        raise ApiError(409, "retest", "Please take your free retest first.")
    meta = await bank_meta(db, a["skill"])
    if not meta:
        raise ApiError(404, "no_task", "This role has no practical task yet.")
    tk = a.get("task") or {}
    t = now()
    if tk.get("status") in ("grading", "review", "graded"):
        raise ApiError(409, "done", "You have sent this task already.")
    task = meta["task"]
    if not tk.get("started_at"):
        tk = {"status": "started", "type": task["type"], "started_at": t,
              "ends_at": t + timedelta(minutes=task["minutes"] * (E.EXTRA_TIME if a.get("extra_time") else 1) + 2)}  # fmt: skip
        await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": {"task": tk}})
    lang = a.get("lang", "en")
    situations = []
    for i, s in enumerate(task.get("situations") or []):
        tr = s.get(lang) if lang != "en" else None
        q, opts = (tr["q"], tr["options"]) if tr else (s["q"], s["options"])
        situations.append({"i": i, "q": q, "options": opts})
    return {
        "type": task["type"], "title": task["title"], "brief": task["brief"], "material": task.get("material", ""),
        "minutes": task["minutes"], "situations": situations, "endsAt": ms(tk["ends_at"]),
        "rubric": [{"label": c["label"]} for c in meta.get("rubric") or []],
        "photo": task["type"] == "proof",
    }  # fmt: skip


class Photo(CamelModel):
    type: Literal["image/jpeg", "image/png", "image/webp"]
    data: str = Field(min_length=100, max_length=2_800_000)  # base64, about 2 MB


class TaskIn(CamelModel):
    text: str = Field("", max_length=8000)
    transcript: str = Field("", max_length=6000)
    seconds: float | None = Field(None, ge=0, le=600)
    situations: dict[str, int] = Field(default_factory=dict)
    photo: Photo | None = None
    pasted_chars: int = Field(0, ge=0, le=100_000)
    blurs: int = Field(0, ge=0, le=10000)
    blur_ms: int = Field(0, ge=0, le=86_400_000)


def speech_measures(transcript: str, seconds: float | None) -> dict[str, Any]:
    n = len(transcript.split())
    return {
        "wpm": round(n / (seconds / 60)) if seconds else None,
        "fillers": len(FILLERS.findall(transcript)),
        "words": n,
    }


@me.post("/{aid}/task/submit")
async def task_submit(aid: str, body: TaskIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await _mine(db, aid, auth.user.id)
    tk = a.get("task") or {}
    if tk.get("status") != "started":
        raise ApiError(409, "not_started", "Open the task first." if not tk else "You have sent this task already.")
    t = now()
    meta = await bank_meta(db, a["skill"])
    role = BY_TEST[a["skill"]]
    task, rubric = meta["task"], meta.get("rubric") or []
    late = t > tk["ends_at"] + timedelta(minutes=1)
    answer = (body.transcript if task["type"] == "voice" and body.transcript.strip() else body.text).strip()
    speech = (
        speech_measures(body.transcript, body.seconds) if task["type"] == "voice" and body.transcript.strip() else None
    )
    tk = {**tk, "submitted_at": t, "late": late, "rubric_version": meta.get("rubric_version", 1)}
    if task["type"] == "proof":
        sit = task.get("situations") or []
        right = sum(1 for i, s in enumerate(sit) if body.situations.get(str(i)) == s["answer"])
        tk.update(score=round(100 * right / len(sit)) if sit else 0, status="graded",
                  feedback=[{"label": "Practical situations", "score": round(5 * right / len(sit)) if sit else 0,
                             "reason": f"{right} of {len(sit)} right"}])  # fmt: skip
        if body.photo:
            pid = ObjectId()
            await db[VETTING_PHOTOS].insert_one({"_id": pid, "user_id": a["user_id"], "attempt_id": a["_id"],
                                                 "type": body.photo.type, "data": body.photo.data,
                                                 "delete_at": t + timedelta(days=30), "created_at": t})  # fmt: skip
            try:
                tk["photo"] = {
                    "id": pid,
                    **await grade.check_photo(db, a["user_id"], role, body.photo.type, body.photo.data),
                }
            except grade.Pending as e:
                tk["photo"] = {"id": pid, "genuine": "pending", "why": e.why}
    else:
        if len(answer.split()) < 5:
            raise ApiError(400, "too_short", "Please write (or say) a little more before sending.")
        tk["answer"] = answer
        if speech:
            tk["speech"] = speech
        try:
            g = await grade.grade_text(db, a["user_id"], role, task, rubric, answer, speech)
            labels = {c["key"]: c["label"] for c in rubric}
            score = E.task_score(g["scores"])
            tk.update(score=score, confidence=g["confidence"], model=g["model"],
                      feedback=[{**s, "label": labels[s["key"]]} for s in g["scores"]],
                      status="review" if E.needs_review(score, g["confidence"]) else "graded")  # fmt: skip
        except grade.Pending as e:
            tk.update(status="review", pending=e.why)
    # integrity: the task's own signals, and the same text as another account
    sig = dict(a.get("signals") or {})
    sig.update(pastedChars=body.pasted_chars, taskChars=len(answer), blurs=int(sig.get("blurs") or 0) + body.blurs,
               blurMs=int(sig.get("blurMs") or 0) + body.blur_ms)  # fmt: skip
    if len(answer.split()) >= 30:
        async for o in db[SKILL_ATTEMPTS].find(
            {"skill": a["skill"], "user_id": {"$ne": a["user_id"]}, "task.answer": {"$exists": True},
             "task.submitted_at": {"$gte": t - timedelta(days=180)}}, {"task.answer": 1},
        ).limit(300):  # fmt: skip
            if E.text_similarity(answer, o["task"]["answer"]) >= 0.8:
                sig["textMatch"] = True
                break
    integ = E.integrity(sig)
    sets = {"task": tk, "signals": sig, "integrity": integ}
    if integ["level"] == "retest" and not a.get("strict"):
        sets["retest_offered"] = True
    await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": sets})
    a = {**a, **sets}
    if tk["status"] == "review":
        await _queue(db, "review", a, {"why": tk.get("pending") or ("borderline" if tk.get("score") is not None else "ai"),
                                         "score": tk.get("score"), "confidence": tk.get("confidence")})  # fmt: skip
    if integ["level"] == "retest" and (a.get("strict") or integ["serious"]):
        await _queue(db, "integrity", a, {"reasons": integ["reasons"], "points": integ["points"], "stage": "task"})
    v = await award(db, a)
    await audit(
        db,
        a["user_id"],
        "vetting.task_done",
        data={"skill": a["skill"], "status": tk["status"], "score": tk.get("score")},
    )
    return result_out(a, v)


async def award(db, a: dict[str, Any]) -> dict[str, Any] | None:
    """Writes "Skill verified" (L2) when the test and the task both pass and integrity allows; returns the record."""
    tk = a.get("task") or {}
    level = (a.get("integrity") or {}).get("level", "clean")
    if tk.get("status") != "graded" or not E.verified(a.get("score"), tk.get("score"), level):
        return await db[VETTING_VERIFIED].find_one({"user_id": a["user_id"], "test": a["skill"]})
    t = now()
    role = BY_TEST[a["skill"]]
    rec = {"user_id": a["user_id"], "test": a["skill"], "slug": role["slug"], "role": role["role"], "band": a["band"],
           "score": a["score"], "task_score": tk["score"], "at": t, "expires_at": t + E.VALID, "attempt_id": a["_id"]}  # fmt: skip
    await db[VETTING_VERIFIED].update_one({"user_id": a["user_id"], "test": a["skill"]}, {"$set": rec}, upsert=True)
    badge = {"skill": a["skill"], "role": role["slug"], "at": t, "band": a["band"], "score": a["score"],
             "task": tk["score"], "expires_at": rec["expires_at"], "source": "v2"}  # fmt: skip
    await db[USERS].update_one({"_id": a["user_id"]}, {"$pull": {"verified_skills": {"skill": a["skill"]}}})
    await db[USERS].update_one({"_id": a["user_id"]}, {"$push": {"verified_skills": badge}})
    await audit(db, a["user_id"], "vetting.verified", data={"skill": a["skill"], "band": a["band"]})
    from app.hire.vetting.ladder import refresh

    await refresh(db, a["user_id"], f"skill verified: {a['skill']}")  # V1: the level may go up to L2
    return rec


class ShareIn(CamelModel):
    share: bool


@me.put("/{aid}/share")
async def share(aid: str, body: ShareIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await db[SKILL_ATTEMPTS].find_one({"_id": _oid(aid), "user_id": auth.user.id})
    if not a or not a.get("submitted_at"):
        raise ApiError(404, "not_found", "Finish the test first.")
    await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": {"share": body.share}})
    return result_out(
        {**a, "share": body.share}, await db[VETTING_VERIFIED].find_one({"user_id": a["user_id"], "test": a["skill"]})
    )
