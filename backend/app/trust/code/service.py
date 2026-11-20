# ruff: noqa: E501  (plain texts and dense response shapes)
"""Vetting Trust T14: coding tasks for tech roles — the candidate's code runs in an external sandbox against hidden
tests, with an optional keystroke replay for reviewers.

Who gets it: people Vetting Trust is on for (T1 switch), on a tech role that has an active, validated coding problem,
while Admin keeps "Coding tasks" on and a sandbox is available (the test sandbox only for admins, demo accounts and
testers on the live site, as with every Trust test provider). Everyone else gets the existing written tech task,
exactly as before.

The flow (the practical task after a passed skill check, the T9 pledge first):
  start     the task opens as type "coding": the problem (statement, starter code per language, visible samples, the
            NUMBER of hidden tests) — a server-side snapshot keeps the tests it opened with
  draft     the editor saves as the person types (PUT draft), so a reload or a dropped connection loses nothing
  run       "Run" checks the code against the VISIBLE samples only (rate limited per person and per task)
  submit    the code is stored first (status "queued": no lost work), then run against samples + HIDDEN tests;
            sandbox down → stays queued and is retried (on the next status check and by the automation pass) with a
            growing wait; after MAX_TRIES a person grades it from the review queue (never failed by an outage)
  result    score = hidden tests passed (0–100); the candidate sees "X of Y hidden tests passed" and the names of the
            failing VISIBLE samples only. An optional AI review of code quality (existing grading, anonymised, strict
            schema, AI allowance) adds feedback lines; it never changes the score. Same tests for everyone.

Limits on every sandbox call (Admin, within bounds): CPU and wall seconds, memory, output size, processes, no network.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId

from app.audit import audit
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import (
    SKILL_ATTEMPTS,
    TRUST_CODE,
    TRUST_CODE_PROBLEMS,
    TRUST_CODE_REPLAYS,
    USERS,
)
from app.core.errors import ApiError
from app.core.time import now
from app.me.service import ms
from app.trust import consent as C
from app.trust import retention as R
from app.trust.code import problems as PB
from app.trust.code import providers as P
from app.trust.code import replay as RP

log = logging.getLogger("nm7.trust.code")

PURPOSE = "code_replay"
MAX_TRIES = 10
BACKOFF_MIN = (1, 2, 5, 10, 15, 30, 60, 120, 240, 480)
LEASE = timedelta(minutes=3)
PER_PASS = 20
CONCURRENT = 2  # sandbox calls at once from this server (each waits on the network only)
_slots = asyncio.Semaphore(CONCURRENT)
SHOW_OUT = 2000  # characters of a visible sample's output shown back

DEFAULTS: dict[str, Any] = {
    "on": True, "provider": "mock", "cpu_s": 2.0, "wall_s": 5.0, "memory_mb": 128, "output_kb": 64, "processes": 30,
    "runs_per_task": 30, "runs_per_minute": 6, "ai_review": True, "big_paste": 200, "company_replay": True,
}  # fmt: skip
BOUNDS: dict[str, tuple[float, float]] = {
    "cpu_s": (0.5, 10), "wall_s": (1, 20), "memory_mb": (32, 512), "output_kb": (4, 256), "processes": (1, 60),
    "runs_per_task": (1, 100), "runs_per_minute": (1, 30), "big_paste": (50, 5000),
}  # fmt: skip
CODE_RUBRIC = [
    {"key": "readable", "label": "Code quality: readable", "guide": "Clear names, simple structure, easy for a colleague to follow."},
    {"key": "correct_approach", "label": "Code quality: approach", "guide": "A sensible, efficient approach for the input sizes; handles edge cases."},
]  # fmt: skip

C.add_purpose(C.Purpose(PURPOSE, "Coding replay (your typing in the code editor)",
    "When you do a coding task, we record your typing in the code editor only: what was typed, deleted or pasted and when, and when you left the editor. "
    "We use it only to show reviewers (Nm7, and companies you apply to) how your solution was written. Nothing outside the editor is recorded: no camera, "
    "no microphone, no other tabs or apps. We keep it for {days} days, then delete it. Saying no is fine: the task works the same. "
    "If you take this back, your replays are deleted now.", 1, "code_replay"))  # fmt: skip
R.register(R.DataType("code_replay", "Coding replays (typing in the code editor)", 90, 7, 180, TRUST_CODE_REPLAYS, purpose=PURPOSE,
                      note="Deleted by the daily job, or now when the consent is taken back"))  # fmt: skip
R.register(R.DataType("code_tasks", "Code written in coding tasks (drafts, runs, results)", 365, 90, 730, TRUST_CODE,
                      note="Deleted by the daily job"))  # fmt: skip


# --- settings and the sandbox ----------------------------------------------------------------------------------------------


def settings_of(site: dict[str, Any]) -> dict[str, Any]:
    st = (site.get("trust") or {}).get("code") or {}
    out = {**DEFAULTS, **{k: v for k, v in st.items() if k in DEFAULTS}}
    for k, (lo, hi) in BOUNDS.items():
        try:
            v = float(out[k])
        except (TypeError, ValueError):
            v = float(DEFAULTS[k])
        v = max(lo, min(hi, v))
        out[k] = v if isinstance(DEFAULTS[k], float) else int(v)
    if out["provider"] not in P.registry():
        out["provider"] = "mock"
    for k in ("on", "ai_review", "company_replay"):
        out[k] = bool(out[k])
    return out


def limits_of(st: dict[str, Any]) -> P.Limits:
    return P.Limits(cpu_s=float(st["cpu_s"]), wall_s=float(st["wall_s"]), memory_mb=int(st["memory_mb"]),
                    output_kb=int(st["output_kb"]), processes=int(st["processes"]), network=False)  # fmt: skip


async def provider_for(db, uid: str, site: dict[str, Any]) -> P.Provider | None:
    """The chosen sandbox when it has its keys. The test sandbox: anywhere but production, and on production only for
    admins, demo accounts and testers (its results are not real)."""
    from app.trust import access

    p = P.get(settings_of(site)["provider"])
    if not p:
        return None
    if not p.test:
        return p if p.ready() else None
    if not get_settings().is_prod:
        return p
    u = await db[USERS].find_one({"_id": uid}, {"demo": 1, "role": 1, "email": 1, "email_lc": 1}) or {}
    email = (u.get("email_lc") or u.get("email") or "").lower()
    return p if u.get("demo") or u.get("role") == "admin" or (email and email in await access.testers(db)) else None


async def problem_for(db, a: dict[str, Any]) -> dict[str, Any] | None:
    """The coding problem this attempt's task becomes, or None (the existing tech task, unchanged)."""
    from app.hire.vetting.roles import BY_TEST
    from app.site import get_site
    from app.trust import access

    role = BY_TEST.get(a.get("skill") or "") or {}
    if role.get("task") != "tech" or not await access.for_user(db, a["user_id"]):
        return None
    site = await get_site(db)
    if not settings_of(site)["on"] or not await provider_for(db, a["user_id"], site):
        return None
    return await PB.for_skill(db, a["skill"])


async def consent_line(db, uid: str) -> dict[str, Any]:
    from app.site import get_site

    p = C.PURPOSES[PURPOSE]
    return {
        "purpose": PURPOSE,
        "title": p.title,
        "text": C.text_of(p, await get_site(db)),
        "given": await C.has(db, uid, PURPOSE),
    }


# --- the task ---------------------------------------------------------------------------------------------------------------


async def open_task(db, a: dict[str, Any], problem: dict[str, Any], t: datetime) -> None:
    await db[TRUST_CODE].update_one(
        {"_id": a["_id"]},
        {"$setOnInsert": {"user_id": a["user_id"], "skill": a["skill"], "problem": PB.snapshot(problem), "runs": 0,
                          "created_at": t, "draft": None}},
        upsert=True,
    )  # fmt: skip


def _sub_out(sub: dict[str, Any] | None) -> dict[str, Any] | None:
    if not sub:
        return None
    o: dict[str, Any] = {
        "status": sub["status"],
        "language": sub.get("language"),
        "queuedAt": ms(sub.get("queued_at")),
        "tries": int(sub.get("tries") or 0),
    }
    if sub["status"] == "done":
        o.update(
            passed=sub["passed"],
            total=sub["total"],
            failingSamples=sub.get("failing_samples") or [],
            line=f"{sub['passed']} of {sub['total']} hidden tests passed",
        )
    elif sub["status"] == "queued" and sub.get("tries"):
        o["note"] = (
            "The code sandbox is busy or down for a moment. Your code is saved and will be checked automatically; nothing is lost."
        )
    elif sub["status"] == "review":
        o["note"] = (
            "The code sandbox was down for a long time, so a person at Nm7 will check your code. Nothing is lost."
        )
    return o


async def view(db, aid: ObjectId, uid: str) -> dict[str, Any]:
    from app.site import get_site

    d = await db[TRUST_CODE].find_one({"_id": aid, "user_id": uid})
    if not d:
        raise ApiError(404, "not_found", "This coding task isn’t here.")
    st = settings_of(await get_site(db))
    return {
        **PB.public(d["problem"]),
        "draft": {"language": d["draft"]["language"], "source": d["draft"]["source"], "at": ms(d["draft"]["at"])} if d.get("draft") else None,
        "runsLeft": max(0, st["runs_per_task"] - int(d.get("runs") or 0)), "runsPerTask": st["runs_per_task"],
        "limits": {"cpuS": st["cpu_s"], "memoryMb": st["memory_mb"]},
        "submission": _sub_out(d.get("submission")), "consent": await consent_line(db, uid),
        "replayMax": {"events": RP.MAX_EVENTS, "bytes": RP.MAX_BYTES},
    }  # fmt: skip


async def _mine(db, aid: ObjectId, uid: str) -> tuple[dict[str, Any], dict[str, Any]]:
    a = await db[SKILL_ATTEMPTS].find_one({"_id": aid, "user_id": uid})
    d = await db[TRUST_CODE].find_one({"_id": aid, "user_id": uid})
    if not a or not d or (a.get("task") or {}).get("type") != "coding":
        raise ApiError(404, "not_found", "This coding task isn’t here.")
    return a, d


def _check_source(language: str, source: str, d: dict[str, Any]) -> None:
    if language not in d["problem"]["languages"]:
        raise ApiError(400, "language", "That language isn’t offered for this problem.")
    if len(source) > PB.MAX_SOURCE:
        raise ApiError(400, "too_long", "The code is too long.")


async def save_draft(db, uid: str, aid: ObjectId, language: str, source: str) -> dict[str, Any]:
    a, d = await _mine(db, aid, uid)
    _check_source(language, source, d)
    if (a.get("task") or {}).get("status") != "started":
        raise ApiError(409, "done", "You have sent this task already.")
    t = now()
    await db[TRUST_CODE].update_one(
        {"_id": aid}, {"$set": {"draft": {"language": language, "source": source, "at": t}}}
    )
    return {"saved": True, "at": ms(t)}


async def run_samples(db, uid: str, aid: ObjectId, language: str, source: str) -> dict[str, Any]:
    """ "Run": the visible samples only. Rate limited per person (a minute) and per task."""
    from app.site import get_site

    a, d = await _mine(db, aid, uid)
    _check_source(language, source, d)
    tk = a.get("task") or {}
    if tk.get("status") != "started":
        raise ApiError(409, "done", "You have sent this task already.")
    t = now()
    await db[TRUST_CODE].update_one(
        {"_id": aid}, {"$set": {"draft": {"language": language, "source": source, "at": t}}}
    )
    site = await get_site(db)
    st = settings_of(site)
    if int(d.get("runs") or 0) >= st["runs_per_task"]:
        raise ApiError(
            429, "runs_used", f"You have used all {st['runs_per_task']} runs for this task. You can still submit."
        )
    await rate_limit.check(db, f"code-run:{uid}", [(st["runs_per_minute"], timedelta(minutes=1))],
                           "You are running code very often. Please wait a minute and try again.")  # fmt: skip
    p = await provider_for(db, uid, site)
    samples = d["problem"]["samples"]
    if not p:
        raise ApiError(
            503,
            "sandbox_down",
            "Running code is paused for a moment. Your code is saved: try again in a minute, or submit and it will be checked when the sandbox is back.",
        )
    try:
        async with asyncio.timeout(60):
            async with _slots:
                res = await p.run(source, language, [P.Case(s["stdin"], s["expected"]) for s in samples], limits_of(st))
    except (P.ProviderDown, TimeoutError) as e:
        log.info("code run: sandbox down (%s)", e)
        raise ApiError(
            503,
            "sandbox_down",
            "Running code is paused for a moment. Your code is saved: try again in a minute, or submit and it will be checked when the sandbox is back.",
        ) from None
    await rate_limit.record(db, f"code-run:{uid}")
    await db[TRUST_CODE].update_one(
        {"_id": aid},
        {"$inc": {"runs": 1}, "$push": {"run_log": {"$each": [{"at": t, "language": language}], "$slice": -100}}},
    )
    out = []
    for s, r in zip(samples, res, strict=False):
        ok = r.status == "ran" and P.same_output(r.stdout, s["expected"])
        out.append({"name": s["name"], "passed": ok, "status": r.status, "statusText": P.STATUS_TEXT.get(r.status, r.status),
                    "stdout": r.stdout[:SHOW_OUT], "stderr": r.stderr[:SHOW_OUT], "expected": s["expected"], "truncated": r.truncated})  # fmt: skip
    return {"results": out, "runsLeft": max(0, st["runs_per_task"] - int(d.get("runs") or 0) - 1)}


async def submit(
    db,
    uid: str,
    aid: ObjectId,
    language: str,
    source: str,
    stats: dict[str, int],
    replay: Any,
    blurs: int,
    blur_ms: int,
) -> dict[str, Any]:
    """Store first (queued: no lost work), keep the replay only with the consent and under the size cap, then try to run
    the hidden tests now; a sandbox outage leaves it queued."""
    a, d = await _mine(db, aid, uid)
    _check_source(language, source, d)
    tk = a.get("task") or {}
    if tk.get("status") != "started" or d.get("submission"):
        raise ApiError(409, "done", "You have sent this task already.")
    if not source.strip():
        raise ApiError(400, "empty", "Please write some code before submitting.")
    t = now()
    from app.site import get_site

    st = settings_of(await get_site(db))
    starter = d["problem"]["languages"].get(language, "")
    rep_state, rstats = "none", None
    if replay is not None:
        if not await C.has(db, uid, PURPOSE):
            rep_state = "no_consent"  # never kept without the consent
        else:
            try:
                r = RP.clean(replay)
                rstats = RP.stats(r)
                rstats["consistent"] = RP.final_text(r) == source
                await db[TRUST_CODE_REPLAYS].update_one(
                    {"attempt_id": aid},
                    {"$set": {"user_id": uid, "attempt_id": aid, "skill": a["skill"], "language": language, "replay": r,
                              "stats": rstats, "size": RP.size_of(r), "created_at": t}},
                    upsert=True,
                )  # fmt: skip
                rep_state = "kept"
            except RP.Bad as e:
                rep_state = str(e)  # too_big / format: not kept, the submission goes on
    counters = rstats or {k: int(stats.get(k) or 0) for k in ("typed", "pasted", "largestPaste")}
    flags = RP.flags(counters, source, starter, st["big_paste"])
    sub = {"status": "queued", "language": language, "source": source, "queued_at": t, "next_at": t, "tries": 0,
           "flags": flags, "counters": {k: int(counters.get(k) or 0) for k in ("typed", "pasted", "largestPaste")}, "replay": rep_state}  # fmt: skip
    r = await db[TRUST_CODE].update_one(
        {"_id": aid, "submission": {"$exists": False}},
        {"$set": {"submission": sub, "draft": {"language": language, "source": source, "at": t}}},
    )
    if not r.modified_count:
        raise ApiError(409, "done", "You have sent this task already.")
    sig = dict(a.get("signals") or {})
    sig.update(blurs=int(sig.get("blurs") or 0) + blurs, blurMs=int(sig.get("blurMs") or 0) + blur_ms)
    tk = {**tk, "status": "grading", "submitted_at": t, "late": t > tk["ends_at"] + timedelta(minutes=1), "answer": source[:6000],
          "coding": {"language": language, "status": "queued"}}  # fmt: skip
    await db[SKILL_ATTEMPTS].update_one({"_id": aid}, {"$set": {"task": tk, "signals": sig}})
    await audit(
        db,
        uid,
        "trust.code_submitted",
        data={"skill": a["skill"], "language": language, "replay": rep_state, "flags": flags},
    )
    await process(db, aid)
    return {**await view(db, aid, uid), "replay": rep_state}


async def status(db, uid: str, aid: ObjectId) -> dict[str, Any]:
    """The task's state; a queued submission that is due is tried again now (the page polls while it waits)."""
    _, d = await _mine(db, aid, uid)
    sub = d.get("submission") or {}
    if sub.get("status") == "queued" and sub.get("next_at") and sub["next_at"] <= now():
        await process(db, aid)
    return await view(db, aid, uid)


# --- the queue ---------------------------------------------------------------------------------------------------------------


async def process(db, aid: ObjectId, t: datetime | None = None) -> str:
    """One queued submission: claimed with a lease (so two servers never run it twice), run, finished or put back."""
    from app.site import get_site

    t = t or now()
    d = await db[TRUST_CODE].find_one_and_update(
        {"_id": aid, "$or": [{"submission.status": "queued", "submission.next_at": {"$lte": t}},
                             {"submission.status": "running", "submission.lease_until": {"$lt": t}}]},
        {"$set": {"submission.status": "running", "submission.lease_until": t + LEASE}},
        return_document=True,
    )  # fmt: skip
    if not d:
        return "skipped"
    sub = d["submission"]
    site = await get_site(db)
    st = settings_of(site)
    prob = d["problem"]
    cases = [P.Case(x["stdin"], x["expected"]) for x in [*prob["samples"], *prob["hidden"]]]
    p = await provider_for(db, d["user_id"], site)
    try:
        if not p:
            raise P.ProviderDown("no sandbox")
        if _slots.locked():
            raise P.ProviderDown("busy")
        async with asyncio.timeout(90):
            async with _slots:
                res = await p.run(sub["source"], sub["language"], cases, limits_of(st))
        if len(res) != len(cases):
            raise P.ProviderDown("short answer")
    except (P.ProviderDown, TimeoutError) as e:
        tries = int(sub.get("tries") or 0) + 1
        if tries >= MAX_TRIES:
            await db[TRUST_CODE].update_one(
                {"_id": aid},
                {"$set": {"submission.status": "review", "submission.tries": tries, "submission.error": str(e)[:200]}},
            )
            await _to_review(db, aid)
            return "review"
        nxt = t + timedelta(minutes=BACKOFF_MIN[min(tries, len(BACKOFF_MIN)) - 1])
        await db[TRUST_CODE].update_one(
            {"_id": aid},
            {
                "$set": {
                    "submission.status": "queued",
                    "submission.tries": tries,
                    "submission.next_at": nxt,
                    "submission.error": str(e)[:200],
                }
            },
        )
        await db[SKILL_ATTEMPTS].update_one(
            {"_id": aid}, {"$set": {"task.coding.status": "queued", "task.coding.tries": tries}}
        )
        return "queued"
    await finish(db, d, res, st, t)
    return "done"


async def _to_review(db, aid: ObjectId) -> None:
    from app.hire.vetting.router import _queue

    a = await db[SKILL_ATTEMPTS].find_one({"_id": aid})
    await db[SKILL_ATTEMPTS].update_one(
        {"_id": aid},
        {"$set": {"task.status": "review", "task.pending": "sandbox_down", "task.coding.status": "review"}},
    )
    await _queue(db, "review", a, {"why": "sandbox_down", "score": None, "confidence": None})


async def finish(db, d: dict[str, Any], res: list[P.CaseResult], st: dict[str, Any], t: datetime) -> None:
    from app.hire.vetting import engine as E
    from app.hire.vetting import grade
    from app.hire.vetting.roles import BY_TEST
    from app.hire.vetting.router import _queue, award

    prob, sub = d["problem"], d["submission"]
    ns = len(prob["samples"])
    cases = []
    for i, (x, r) in enumerate(zip([*prob["samples"], *prob["hidden"]], res, strict=False)):
        cases.append({"i": i, "hidden": i >= ns, "name": x["name"], "status": r.status,
                      "passed": r.status == "ran" and P.same_output(r.stdout, x["expected"]), "time_s": r.time_s, "memory_kb": r.memory_kb})  # fmt: skip
    hidden = [c for c in cases if c["hidden"]]
    passed = sum(1 for c in hidden if c["passed"])
    total = len(hidden)
    failing = [c["name"] for c in cases if not c["hidden"] and not c["passed"]]
    score = round(100 * passed / total) if total else 0
    a = await db[SKILL_ATTEMPTS].find_one({"_id": d["_id"]})
    feedback = [
        {
            "key": "hidden_tests",
            "label": "Hidden tests",
            "score": round(5 * passed / total) if total else 0,
            "reason": f"{passed} of {total} hidden tests passed",
        }
    ]
    review = None
    if st["ai_review"]:
        role = BY_TEST.get(a["skill"]) or {"role": a["skill"], "slug": ""}
        task = {
            "title": f"Coding problem: {prob['title']}",
            "brief": prob["statement"]
            + f"\n\nLanguage: {P.LANGUAGES[sub['language']]['label']}. Hidden tests passed: {passed} of {total}. Review the code quality only; the tests already decide the score.",
        }
        try:
            from app.trust.fairness import blind

            scrub = await blind.scrubber_for(
                db, a["user_id"], grade.MAX_ANSWER
            )  # always anonymised (names in comments)
            g = await grade.grade_text(
                db, a["user_id"], role, task, CODE_RUBRIC, scrub(sub["source"]) if scrub else sub["source"]
            )
            labels = {c["key"]: c["label"] for c in CODE_RUBRIC}
            review = {"scores": g["scores"], "model": g.get("model", ""), "confidence": g.get("confidence")}
            feedback += [{**s, "label": labels[s["key"]]} for s in g["scores"]]
        except grade.Pending as e:
            review = {"pending": e.why}
    await db[TRUST_CODE].update_one({"_id": d["_id"]}, {"$set": {
        "submission.status": "done", "submission.passed": passed, "submission.total": total, "submission.failing_samples": failing,
        "submission.cases": cases, "submission.done_at": t, "submission.review": review}})  # fmt: skip
    tk = {**(a.get("task") or {}), "status": "graded", "score": score, "feedback": feedback,
          "coding": {"language": sub["language"], "status": "done", "passed": passed, "total": total, "failing_samples": failing}}  # fmt: skip
    integ = E.integrity(a.get("signals") or {})
    sets = {"task": tk, "integrity": integ}
    if integ["level"] == "retest" and not a.get("strict"):
        sets["retest_offered"] = True
    await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": sets})
    a = {**a, **sets}
    if integ["level"] == "retest" and (a.get("strict") or integ["serious"]):
        await _queue(db, "integrity", a, {"reasons": integ["reasons"], "points": integ["points"], "stage": "task"})
    await award(db, a)
    await audit(
        db,
        a["user_id"],
        "vetting.task_done",
        data={"skill": a["skill"], "status": "graded", "score": score, "coding": True},
    )


async def pass_(db, t: datetime | None = None) -> dict[str, int]:
    """The automation pass: queued submissions that are due (heavy lease, capped)."""
    from app.core.heavy import heavy_or_skip

    t = t or now()
    q = {
        "$or": [
            {"submission.status": "queued", "submission.next_at": {"$lte": t}},
            {"submission.status": "running", "submission.lease_until": {"$lt": t}},
        ]
    }
    if not await db[TRUST_CODE].find_one(q, {"_id": 1}):
        return {}
    counts: dict[str, int] = {}
    async with heavy_or_skip(db) as ok:
        if not ok:
            return {"waiting_heavy": 1}
        ids = [x["_id"] async for x in db[TRUST_CODE].find(q, {"_id": 1}).sort("submission.next_at", 1).limit(PER_PASS)]
        for i in ids:
            k = await process(db, i, t)
            counts[k] = counts.get(k, 0) + 1
    return counts


# --- reviewers ---------------------------------------------------------------------------------------------------------------


def replay_out(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    r = row["replay"]
    return {"id": str(row["_id"]), "attemptId": str(row["attempt_id"]), "language": row.get("language"), "at": ms(row.get("created_at")),
            "start": r["start"], "events": r["events"], "truncated": r.get("truncated", False), "stats": row.get("stats") or {}}  # fmt: skip


def result_out(d: dict[str, Any], admin: bool = False) -> dict[str, Any]:
    sub = d.get("submission") or {}
    o = {"attemptId": str(d["_id"]), "skill": d.get("skill"), "problem": d["problem"]["title"], "language": sub.get("language"), "status": sub.get("status"),
         "passed": sub.get("passed"), "total": sub.get("total"), "at": ms(sub.get("done_at") or sub.get("queued_at")), "source": sub.get("source", "")}  # fmt: skip
    if admin:
        o.update(cases=[{k: c.get(k) for k in ("name", "hidden", "status", "passed", "time_s", "memory_kb")} for c in sub.get("cases") or []],
                 flags=sub.get("flags") or [], counters=sub.get("counters") or {}, tries=sub.get("tries", 0), error=sub.get("error", ""),
                 review=sub.get("review"), userId=d["user_id"], replay=sub.get("replay"))  # fmt: skip
    return o


async def company_view(db, company: dict[str, Any], account: dict[str, Any] | None, uid: str) -> dict[str, Any]:
    """The company: only where Vetting Trust is on for it, Admin allows company replays, and the candidate is visible to
    it (Hire now with consent, or applied to it). Only the coding results and the editor replay — nothing else."""
    from app.core.db import APPLICATIONS, HIRE_PROFILES
    from app.site import get_site
    from app.trust import access

    if not await access.for_company(db, company, account) or not settings_of(await get_site(db))["company_replay"]:
        raise ApiError(404, "not_found", "Not found.")
    cid = str(company["_id"])
    seen = await db[HIRE_PROFILES].find_one(
        {"_id": uid, "on": True, "consent_at": {"$ne": None}}, {"_id": 1}
    ) or await db[APPLICATIONS].find_one({"user_id": uid, "company_id": cid}, {"_id": 1})
    if not seen:
        raise ApiError(404, "not_found", "That candidate isn’t visible to your company.")
    d = await db[TRUST_CODE].find_one({"user_id": uid, "submission.status": "done"}, sort=[("submission.done_at", -1)])
    if not d:
        raise ApiError(404, "no_code", "No coding task yet.")
    row = await db[TRUST_CODE_REPLAYS].find_one({"attempt_id": d["_id"]}) if await C.has(db, uid, PURPOSE) else None
    await audit(
        db,
        (account or {}).get("_id") or cid,
        "trust.code_replay_viewed",
        target=uid,
        data={"by": "company", "company": cid, "attempt": str(d["_id"]), "replay": bool(row)},
    )
    o = result_out(d)
    o.pop("source", None)  # the replay shows how it was written; the final code is its last frame
    return {**o, "replay": replay_out(row)}


async def admin_counts(db) -> dict[str, Any]:
    by: dict[str, int] = {}
    async for x in await db[TRUST_CODE].aggregate(
        [{"$group": {"_id": "$submission.status", "n": {"$sum": 1}}}, {"$limit": 20}]
    ):
        by[str(x["_id"] or "started")] = x["n"]
    return {"problems": await db[TRUST_CODE_PROBLEMS].count_documents({}), "active": await db[TRUST_CODE_PROBLEMS].count_documents({"active": True, "validated.ok": True}),
            "tasks": sum(by.values()), "byStatus": by, "replays": await db[TRUST_CODE_REPLAYS].count_documents({}),
            "flagged": await db[TRUST_CODE].count_documents({"submission.flags.0": {"$exists": True}})}  # fmt: skip


async def validate(db, pid: str, actor: str) -> dict[str, Any]:
    """Run the reference solution through the chosen sandbox against every sample and hidden test."""
    from app.site import get_site

    p = await db[TRUST_CODE_PROBLEMS].find_one({"_id": pid})
    if not p:
        raise ApiError(404, "not_found", "That problem isn’t here.")
    site = await get_site(db)
    st = settings_of(site)
    prov = P.get(st["provider"])
    t = now()
    tests = [*p["samples"], *p["hidden"]]
    try:
        if not prov or not prov.ready():
            raise P.ProviderDown("keys not set")
        res = await prov.run(
            p["reference"]["source"],
            p["reference"]["language"],
            [P.Case(x["stdin"], x["expected"]) for x in tests],
            limits_of(st),
        )
    except P.ProviderDown as e:
        v = {
            "ok": False,
            "at": t,
            "by": actor,
            "error": f"The sandbox couldn’t be reached ({e}). Saved; press Validate again later.",
            "provider": st["provider"],
        }
    else:
        bad = [
            x["name"]
            for x, r in zip(tests, res, strict=False)
            if not (r.status == "ran" and P.same_output(r.stdout, x["expected"]))
        ]
        v = {
            "ok": not bad and len(res) == len(tests),
            "at": t,
            "by": actor,
            "passed": len(tests) - len(bad),
            "total": len(tests),
            "failing": bad[:30],
            "provider": st["provider"],
        }
    await db[TRUST_CODE_PROBLEMS].update_one({"_id": pid}, {"$set": {"validated": v}})
    await audit(db, actor, "trust.code_problem_validated", target=pid, data={"ok": v["ok"], "provider": st["provider"]})
    return v
