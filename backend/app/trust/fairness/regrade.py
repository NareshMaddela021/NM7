# ruff: noqa: E501  (dense lines)
"""Vetting Trust T12: re-grade a random 5% of AI-graded answers with a second, independent AI pass.

Generalises V3's weekly interview bias check (app/hire/vetting/interview.bias_check, which keeps running for every
interview as before) to every AI-graded item:
  v2   V2 practical tasks (written / tech / spoken) graded by the AI: the same rubric, a differently worded "independent
       second reviewer" prompt, on the anonymised answer (blind.py). Material: the task score moves by `gap` points or
       more (Admin, default 15 of 100), or across the pass mark.
  v3   V3 interviews graded by the AI (only those the old weekly check hasn't re-graded): V3's own second grader.
       Material: a rubric line more than 1 point apart, or pass ↔ not pass.
  t9   T9 "Explained own work" labels given by the AI: a second wording of the check. Material: two steps apart
       (strong ↔ weak), or into / out of "weak" (weak is an integrity signal).
Each pick is recorded in `trust_regrades` (kind, item, role, the two grades, the gap, material or not). A material
disagreement is NEVER applied by itself: the item goes to a person — V2 to Admin → Skill checks → Review queue (as a
borderline grade is), V3 to Interviews → Bias checks (the existing queue), T9 to the T12 card (keep the first label or
use the second). Admin is alerted when, for one role × kind over the last 8 weeks, at least `alert_min` re-grades were
made and `alert_share` % or more of them disagreed materially (the rubric or the role's questions need a look).

Once a week (or Admin → Run now), under the heavy lease (heavy_or_skip), at most `cap` second passes a week (Admin,
default 60), each counted in the daily AI allowance (feature "regrade"). While the Trust switch is OFF only items of
testers, admins and demo accounts are sampled (nobody else's grade can be sent to a review); once it is public, all.
"""

import logging
import random
from datetime import datetime, timedelta
from typing import Any

import anthropic
from pymongo.errors import DuplicateKeyError

from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import SKILL_ATTEMPTS, TRUST_REGRADES, TRUST_RUNS, USERS, VETTING_INTERVIEWS
from app.core.errors import ApiError
from app.core.time import now
from app.hire.vetting import engine as E
from app.hire.vetting import grade as V2
from app.hire.vetting import interview as V3
from app.hire.vetting.grade import rubric_schema
from app.hire.vetting.interview import GRADE_SCHEMA as IV_SCHEMA
from app.trust.honesty import explain as X
from app.trust.honesty.explain import GRADE_SCHEMA as EXPLAIN_SCHEMA

log = logging.getLogger("nm7.trust.regrade")

FEATURE = "regrade"
KINDS = ("v2", "v3", "t9")
KIND_LABEL = {"v2": "Practical task", "v3": "AI interview", "t9": "Explained own work"}
DEFAULTS = {"sample": 5, "cap": 60, "gap": 15, "alert_share": 25, "alert_min": 5}
BOUNDS = {"sample": (1, 20), "cap": (0, 500), "gap": (5, 50), "alert_share": (5, 100), "alert_min": (3, 100)}
WINDOW = timedelta(days=7)
ALERT_WINDOW = timedelta(days=56)
EVERY = timedelta(days=7)
RANK = {"strong": 3, "partial": 2, "weak": 1, "not_answered": 0}


def settings_of(site: dict[str, Any]) -> dict[str, int]:
    st = ((site.get("trust") or {}).get("fairness") or {}).get("regrade") or {}
    out = {}
    for k, d in DEFAULTS.items():
        lo, hi = BOUNDS[k]
        try:
            out[k] = max(lo, min(hi, int(st.get(k, d))))
        except (TypeError, ValueError):
            out[k] = d
    return out


# --- the second, independent prompts (anonymised input) ----------------------------------------------------------------


def v2_prompt(
    role: dict[str, Any], task: dict[str, Any], rubric: list[dict[str, Any]], answer: str, speech: dict | None
) -> str:
    return V2.prompt(role, task, rubric, answer, speech).replace(
        "You grade a practical task", "As an independent second reviewer, grade this practical task afresh"
    )


def explain_prompt(role: dict[str, Any], submission: str, turns: list[dict[str, Any]]) -> str:
    return X.grade_prompt(role, submission, turns).replace(
        "You check whether a candidate understands",
        "As an independent second reviewer, check afresh whether a candidate understands",
    )


async def _take(db, uid: str) -> bool:
    if not get_settings().anthropic_api_key:
        return False
    try:
        await ai_quota.take(db, FEATURE, uid)
    except (ApiError, ai_quota.CapReached):
        return False
    return True


async def second_v2(db, a: dict[str, Any]) -> dict[str, Any] | None:
    from app.hire.vetting.roles import BY_TEST
    from app.hire.vetting.store import bank_meta
    from app.trust.fairness import blind

    tk = a.get("task") or {}
    meta = await bank_meta(db, a["skill"])
    rubric = meta.get("rubric") or []
    if (
        not rubric
        or int(meta.get("rubric_version", 1)) != int(tk.get("rubric_version", 1))
        or a["skill"] not in BY_TEST
    ):
        return None  # the rubric changed since: a second grade would not be comparable
    answer = (await blind.scrubber_for(db, a["user_id"], V2.MAX_ANSWER))(tk.get("answer") or "")
    if not await _take(db, a["user_id"]):
        return None
    try:
        out = await claude.ask_models(FEATURE, [{"type": "text", "text": v2_prompt(BY_TEST[a["skill"]], meta["task"], rubric, answer, tk.get("speech"))}],
                                      rubric_schema(rubric), V2.check_scores(rubric), max_tokens=1200, effort="low", timeout_s=40, retries=1)  # fmt: skip
    except (claude.Unusable, anthropic.APIError):
        await ai_quota.note(db, FEATURE, "failed")
        return None
    return {"score": E.task_score(out["scores"]), "scores": out["scores"]}


async def second_v3(db, iv: dict[str, Any]) -> dict[str, Any] | None:
    from app.hire.vetting.roles import BY_TEST

    if iv["test"] not in BY_TEST:
        return None
    turns = await V3.blind_turns(db, iv["user_id"], V3.rubric_turns(iv["turns"]))
    if not await _take(db, iv["user_id"]):
        return None
    try:
        out = await claude.ask_models(FEATURE, [{"type": "text", "text": V3.second_prompt(BY_TEST[iv["test"]], turns, iv["lang"])}], IV_SCHEMA,
                                      V3.check_grade, max_tokens=1500, effort="low", timeout_s=40, retries=1)  # fmt: skip
    except (claude.Unusable, anthropic.APIError):
        await ai_quota.note(db, FEATURE, "failed")
        return None
    return {"scores": out["scores"]}


async def second_t9(db, iv: dict[str, Any]) -> dict[str, Any] | None:
    from app.hire.vetting.roles import BY_TEST

    turns = [t for t in iv.get("turns") or [] if t.get("kind") == "explain"]
    if not turns:
        return None
    a = (
        await db[SKILL_ATTEMPTS].find_one(
            {"_id": (iv.get("explain_source") or {}).get("attempt_id")}, {"task.answer": 1}
        )
        or {}
    )
    scrub = await X.scrubber(db, iv["user_id"])
    submission = scrub(str((a.get("task") or {}).get("answer") or ""))
    if not submission:
        return None
    clean = [{**t, "answer": scrub(t.get("answer") or "")} for t in turns]
    role = BY_TEST.get(iv["test"]) or {"role": iv["test"]}
    if not await _take(db, iv["user_id"]):
        return None
    try:
        items = await claude.ask_models(FEATURE, [{"type": "text", "text": explain_prompt(role, submission, clean)}], EXPLAIN_SCHEMA,
                                        X.check_grade([t["id"] for t in turns]), max_tokens=600, effort="low", timeout_s=30, retries=1)  # fmt: skip
    except (claude.Unusable, anthropic.APIError):
        await ai_quota.note(db, FEATURE, "failed")
        return None
    return {"label": X.combine(items), "items": items}


# --- material or not ---------------------------------------------------------------------------------------------------


def material_v2(first: int, second: int, gap: int) -> bool:
    return abs(first - second) >= gap or (first >= E.PASS_TASK) != (second >= E.PASS_TASK)


def material_v3(a: list[dict[str, Any]], b: list[dict[str, Any]]) -> tuple[int, bool]:
    x = {s["key"]: s["score"] for s in a}
    y = {s["key"]: s["score"] for s in b}
    gap = max((abs(x[k] - y[k]) for k in x if k in y), default=0)
    return gap, gap > 1 or V3.passed(a) != V3.passed(b)


def material_t9(a: str, b: str) -> tuple[int, bool]:
    gap = abs(RANK.get(a, 0) - RANK.get(b, 0))
    weak = {"weak", "not_answered"}
    return gap, gap >= 2 or ((a == "weak") != (b == "weak") and (a in weak) != (b in weak))


# --- who may be sampled ------------------------------------------------------------------------------------------------


async def eligible_users(db, uids: list[str]) -> set[str]:
    """Everyone once the Trust switch is public; else only testers, admins and demo accounts."""
    from app.trust import access

    v = await access.settings(db)
    if v.get("public"):
        return set(uids)
    testers = {str(e).lower() for e in v.get("testers") or []}
    out = set()
    async for u in db[USERS].find({"_id": {"$in": list(set(uids))}}, {"demo": 1, "role": 1, "email_lc": 1, "email": 1}):
        if (
            u.get("demo")
            or u.get("role") == "admin"
            or (u.get("email_lc") or str(u.get("email") or "").lower()) in testers
        ):
            out.add(u["_id"])
    return out


async def _pool(db, t: datetime) -> list[tuple[str, dict[str, Any]]]:
    since = t - WINDOW
    done = {
        (r["kind"], r["ref"])
        async for r in db[TRUST_REGRADES].find({"at": {"$gt": t - ALERT_WINDOW}}, {"kind": 1, "ref": 1})
    }
    rows: list[tuple[str, dict[str, Any]]] = []
    async for a in db[SKILL_ATTEMPTS].find(
        {"v": 2, "task.submitted_at": {"$gt": since}, "task.model": {"$exists": True}, "task.score": {"$ne": None}, "task.graded_by": {"$exists": False}, "task.status": "graded"},
        {"user_id": 1, "skill": 1, "task": 1},
    ).limit(5000):  # fmt: skip
        if (a.get("task") or {}).get("answer") and ("v2", str(a["_id"])) not in done:
            rows.append(("v2", a))
    async for iv in db[VETTING_INTERVIEWS].find(
        {"status": "graded", "graded_at": {"$gt": since}, "$or": [{"grade.by": "ai"}, {"explain.by": "ai"}]},
        {"user_id": 1, "test": 1, "lang": 1, "turns": 1, "grade": 1, "bias": 1, "explain": 1, "explain_source": 1, "passed": 1},
    ).limit(5000):  # fmt: skip
        if (iv.get("grade") or {}).get("by") == "ai" and "bias" not in iv and ("v3", str(iv["_id"])) not in done:
            rows.append(("v3", iv))
        if (iv.get("explain") or {}).get("by") == "ai" and ("t9", str(iv["_id"])) not in done:
            rows.append(("t9", iv))
    ok = await eligible_users(db, [r["user_id"] for _, r in rows])
    return [(k, r) for k, r in rows if r["user_id"] in ok]


def pick(
    pool: list[tuple[str, dict[str, Any]]], pct: int, cap: int, rng: random.Random
) -> list[tuple[str, dict[str, Any]]]:
    """About `pct` % of the pool at random, at most `cap`."""
    return [x for x in pool if rng.random() < pct / 100][:cap]


async def _record(
    db,
    kind: str,
    doc: dict[str, Any],
    first: Any,
    second: Any,
    gap: int,
    material: bool,
    t: datetime,
    extra: dict | None = None,
) -> bool:
    row = {"kind": kind, "ref": str(doc["_id"]), "user_id": doc["user_id"], "key": doc.get("skill") or doc.get("test") or "",
           "first": first, "second": second, "gap": gap, "material": material,
           "status": "review" if material else "agree", "at": t, **(extra or {})}  # fmt: skip
    try:
        await db[TRUST_REGRADES].insert_one(row)
        return True
    except DuplicateKeyError:
        return False


async def regrade_one(db, kind: str, doc: dict[str, Any], st: dict[str, int], t: datetime) -> str:
    """'agree' | 'review' | 'skipped'."""
    if kind == "v2":
        g = await second_v2(db, doc)
        if not g:
            return "skipped"
        first = int(doc["task"]["score"])
        material = material_v2(first, g["score"], st["gap"])
        if not await _record(
            db, "v2", doc, first, g["score"], abs(first - g["score"]), material, t, {"second_scores": g["scores"]}
        ):
            return "skipped"
        if material:  # a person grades it in Admin → Skill checks → Review queue; nothing changes until then
            from app.hire.vetting.router import _queue

            await _queue(
                db,
                "review",
                doc,
                {"why": "regrade", "score": first, "second": g["score"], "confidence": doc["task"].get("confidence")},
            )
    elif kind == "v3":
        g = await second_v3(db, doc)
        if not g:
            return "skipped"
        gap, material = material_v3(doc["grade"]["scores"], g["scores"])
        avg1, avg2 = V3.average(doc["grade"]["scores"]), V3.average(g["scores"])
        if not await _record(db, "v3", doc, avg1, avg2, gap, material, t, {"second_scores": g["scores"]}):
            return "skipped"
        # the existing Interviews → Bias checks queue (alert = a person re-grades it); the old weekly check skips it
        await db[VETTING_INTERVIEWS].update_one(
            {"_id": doc["_id"]},
            {"$set": {"bias": {"second": g["scores"], "gap": gap, "alert": material, "at": t, "by": "t12"}}},
        )
    else:
        g = await second_t9(db, doc)
        if not g:
            return "skipped"
        first = doc["explain"]["label"]
        gap, material = material_t9(first, g["label"])
        if not await _record(db, "t9", doc, first, g["label"], gap, material, t, {"second_items": g["items"]}):
            return "skipped"
    return "review" if material else "agree"


async def alerts(db, t: datetime | None = None, st: dict[str, int] | None = None) -> list[dict[str, Any]]:
    """Role × kind with too many material disagreements over the last 8 weeks (T12 re-grades and the old V3 weekly
    check). Counts only."""
    from app.site import get_site

    t = t or now()
    st = st or settings_of(await get_site(db))
    by: dict[tuple[str, str], list[int]] = {}
    async for r in db[TRUST_REGRADES].find({"at": {"$gt": t - ALERT_WINDOW}}, {"kind": 1, "key": 1, "material": 1}):
        c = by.setdefault((r["kind"], r.get("key") or ""), [0, 0])
        c[0] += 1
        c[1] += int(bool(r.get("material")))
    async for iv in db[VETTING_INTERVIEWS].find(
        {"bias.at": {"$gt": t - ALERT_WINDOW}, "bias.by": {"$ne": "t12"}}, {"test": 1, "bias.alert": 1}
    ):
        c = by.setdefault(("v3", iv.get("test") or ""), [0, 0])
        c[0] += 1
        c[1] += int(bool((iv.get("bias") or {}).get("alert")))
    out = []
    for (kind, key), (n, m) in sorted(by.items()):
        share = round(100 * m / n) if n else 0
        out.append({"kind": kind, "kindLabel": KIND_LABEL[kind], "key": key, "n": n, "material": m, "share": share,
                    "alert": n >= st["alert_min"] and share >= st["alert_share"]})  # fmt: skip
    return out


async def run(db, rng: random.Random | None = None, force: bool = False) -> dict[str, int]:
    """One weekly pass (heavy lease, capped). `force`: Admin → Run now (ignores the week)."""
    from app.core.heavy import heavy_or_skip
    from app.site import get_site

    t = now()
    last = await db[TRUST_RUNS].find_one({"_id": "fairness_regrade"}) or {}
    if not force and last.get("at") and last["at"] > t - EVERY:
        return {}
    st = settings_of(await get_site(db))
    counts = {"pool": 0, "picked": 0, "agree": 0, "review": 0, "skipped": 0, "alerts": 0}
    async with heavy_or_skip(db) as ok:
        if not ok:
            return {}
        pool = await _pool(db, t)
        same_week = bool(last.get("week_start") and last["week_start"] > t - EVERY)
        week_start = last["week_start"] if same_week else t
        week_used = int(last.get("used", 0)) if same_week else 0
        picked = pick(pool, st["sample"], max(0, st["cap"] - week_used), rng or random.SystemRandom())
        counts.update(pool=len(pool), picked=len(picked))
        for kind, doc in picked:
            try:
                counts[await regrade_one(db, kind, doc, st, t)] += 1
            except Exception:  # noqa: BLE001  (one bad item never stops the pass)
                log.exception("re-grade failed")
                counts["skipped"] += 1
        al = [a for a in await alerts(db, t, st) if a["alert"]]
        counts["alerts"] = len(al)
    used = week_used + counts["agree"] + counts["review"]
    await db[TRUST_RUNS].update_one(
        {"_id": "fairness_regrade"},
        {"$set": {"at": t, "last": counts, "alerts": al, "used": used, "week_start": week_start}},
        upsert=True,
    )
    return counts


def item_out(r: dict[str, Any], queue_open: bool | None = None) -> dict[str, Any]:
    """For Admin: the two grades and where it waits (never the answer text or the person's details)."""
    from app.me.service import ms

    return {"id": str(r["_id"]), "kind": r["kind"], "kindLabel": KIND_LABEL[r["kind"]], "key": r.get("key") or "",
            "first": r.get("first"), "second": r.get("second"), "gap": r.get("gap"), "material": bool(r.get("material")),
            "status": r.get("status"), "at": ms(r.get("at")),
            "where": {"v2": "Skill checks → Review queue", "v3": "Interviews → Bias checks", "t9": "here"}[r["kind"]],
            "open": queue_open}  # fmt: skip
