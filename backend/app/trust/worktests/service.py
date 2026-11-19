# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T15: the typing, situational-judgement (SJT) and aptitude tests, built on the V2 test engine's rules.

What it reuses:
  - the V2 integrity signals (app/hire/vetting/engine.integrity: leaving the page, copy / paste, developer tools,
    answers faster than they can be read, the same answer position) on the SJT and aptitude tests, and the typing
    test's own paste and timing signals; all of them go to the T8 integrity rating as signals for a person (never a
    rejection, never a changed score);
  - the T9 honesty pledge before every start (409 "pledge" without it) and the T9 retake limits (Admin → Honesty and
    retakes: the skill check numbers, 1 every 30 days by default); typing counts per language, SJT and aptitude per test;
  - T12 blind grading: every grade here is deterministic (scoring.py), no AI and nothing about the person is used;
    the results are in T12's pass-rate gap checks by language / region / city tier.
Forms rotate: a person's first attempt gets a form picked from their account, the next one the other form, and so on.
Items and options are shuffled per attempt; the key never leaves the server.

Results become badges companies can filter on in Hire now (hire.py): "Typing 35 wpm+ (Hindi)", "SJT: strong",
"Aptitude: top 30%". Only good news is shown to a company: below the lowest step nothing is shown. A badge counts for
VALID days (365). Results are kept 730 days (retention type "work_tests", Admin 180–1095).

Stored (additive): trust_worktests (one row per attempt: test, language, form, the shown order, saved answers, the
pledge, the result, integrity and flags; never the keystrokes).
"""

import random
from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId

from app.core.db import TRUST_WORKTESTS
from app.core.errors import ApiError
from app.core.security import keyed_hash
from app.core.time import now
from app.hire.vetting import engine as E
from app.me.service import ms
from app.trust import retention as R
from app.trust.worktests import banks as B
from app.trust.worktests import scoring as S

VALID = timedelta(days=365)
GRACE = timedelta(seconds=60)  # a submit this late after the deadline still counts (a slow network)
READ_SECONDS = 30  # typing: time to read the passage before the first key
EXTRA_TIME = 1.5
NAMES = {"typing": "Typing test", "sjt": "Situational judgement", "aptitude": "Aptitude test"}
ABOUT = {
    "typing": "Type a short work passage as fast and as correctly as you can. 90 seconds. Paste is switched off.",
    "sjt": "10 short work situations. For each, pick the most and the least effective thing to do. About 20 minutes.",
    "aptitude": "15 questions: numbers, words and reasoning. One minute each, 15 minutes in all.",
}
PLAIN_FLAGS = {
    "typing_paste": "Some text arrived in one go (a paste or a long autocomplete), so it didn’t count toward your speed.",
    "typing_timing": "The timing looked unusual (faster than people type, or the clock didn’t match), so a person may look at it.",
}

R.register(R.DataType("work_tests", "Typing, situational-judgement and aptitude test results", 730, 180, 1095,
                      TRUST_WORKTESTS, field="started_at", note="Deleted by the daily job (the badges last 365 days)"))  # fmt: skip


def key_of(test: str, lang: str) -> str:
    """What the retake limit counts: typing per language, SJT and aptitude per test (any language)."""
    return f"typing:{lang}" if test == "typing" else test


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That test isn’t here.") from None


def pick_form(uid: str, test: str, before: int) -> str:
    """The person's own first form, then the next one each attempt (so a retake gets other questions)."""
    forms = [f["id"] for f in B.load(test)["forms"]]
    first = int(keyed_hash("trust-t15-form", uid, test)[:8], 16) % len(forms)
    return forms[(first + before) % len(forms)]


def local(item: dict[str, Any], lang: str) -> tuple[str, list[str]]:
    tr = item.get(lang) if lang != "en" else None
    return (tr or item)["q"], (tr or item)["options"]


def seconds_for(test: str, n: int, extra: bool) -> int:
    bank = B.load(test)
    if test == "typing":
        return int(bank["seconds"])
    base = int(bank["minutes"]) * 60 if test == "sjt" else int(bank["seconds_per_item"]) * n
    return int(base * (EXTRA_TIME if extra else 1))


def items_of(doc: dict[str, Any]) -> list[dict[str, Any]]:
    f = B.form(doc["test"], doc["form"])
    by = {it["id"]: it for it in f["items"]}
    return [by[i] for i in doc["items"] if i in by]


def paper_out(doc: dict[str, Any]) -> dict[str, Any]:
    """The test as the candidate sees it: never the key."""
    out: dict[str, Any] = {"id": str(doc["_id"]), "test": doc["test"], "lang": doc["lang"], "form": doc["form"], "status": doc["status"],
                           "startedAt": ms(doc["started_at"]), "deadline": ms(doc["deadline"]), "seconds": doc["seconds"]}  # fmt: skip
    if doc["test"] == "typing":
        out["passage"] = B.form("typing", doc["form"])["passages"][doc["lang"]]
        out["typed"] = (doc.get("saved") or {}).get("typed", "")
        return out
    shown = []
    for it in items_of(doc):
        q, opts = local(it, doc["lang"])
        shown.append({"id": it["id"], "q": q, "options": [opts[i] for i in doc["order"][it["id"]]],
                      **({"section": it["section"]} if doc["test"] == "aptitude" else {})})  # fmt: skip
    out["items"] = shown
    out["answers"] = (doc.get("saved") or {}).get("answers") or {}
    return out


def result_out(doc: dict[str, Any], top: str | None = None, provisional: bool | None = None) -> dict[str, Any] | None:
    res = doc.get("result")
    if not res:
        return None
    out = {
        "id": str(doc["_id"]),
        "test": doc["test"],
        "lang": doc["lang"],
        "at": ms(doc.get("submitted_at")),
        **badge_of(doc, top, provisional),
    }
    if doc["test"] == "typing":
        out.update({k: res[k] for k in ("wpm", "accuracy", "chars", "errors", "seconds", "completed")})
    else:
        out.update(
            {
                "score": res["score"],
                **({"sections": res["sections"]} if doc["test"] == "aptitude" else {"level": res["level"]}),
            }
        )
    out["flags"] = [PLAIN_FLAGS.get(f, f) for f in doc.get("flags") or [] if f in PLAIN_FLAGS]
    out["integrity"] = (doc.get("integrity") or {}).get("level")
    return out


def badge_of(doc: dict[str, Any], top: str | None = None, provisional: bool | None = None) -> dict[str, Any]:
    """{badge: label or None, level} (None = nothing shown to companies). Aptitude: `top` / `provisional` from the
    norms as they are now (else as they were when it was marked)."""
    res = doc.get("result") or {}
    if doc["test"] == "typing":
        step = S.typing_level(res.get("wpm", 0), res.get("accuracy", 0))
        return {"badge": S.typing_label(step, doc["lang"]) if step else None, "step": step}
    if doc["test"] == "sjt":
        lv = res.get("level")
        return {"badge": S.SJT_LABEL[lv] if lv in ("strong", "good") else None, "level": lv}
    top = top if top is not None else res.get("top")
    prov = provisional if provisional is not None else bool(res.get("provisional"))
    return {
        "badge": (S.TOP_LABEL[top] + (" (provisional)" if prov else "")) if top else None,
        "top": top,
        "provisional": prov,
    }


# --- norms (aptitude "top X%") -----------------------------------------------------------------------------------------

_NORMS: dict[str, Any] = {"at": None, "scores": []}
NORMS_TTL = timedelta(minutes=10)


async def norms(db, t: datetime | None = None, fresh: bool = False) -> list[int]:
    """Everyone's latest aptitude score in the last 365 days (cached for 10 minutes; at most 20,000 rows)."""
    t = t or now()
    if not fresh and _NORMS["at"] and t - _NORMS["at"] < NORMS_TTL:
        return _NORMS["scores"]
    latest: dict[str, int] = {}
    async for d in (
        db[TRUST_WORKTESTS]
        .find(
            {"test": "aptitude", "status": "submitted", "submitted_at": {"$gt": t - VALID}},
            {"user_id": 1, "result.score": 1},
        )
        .sort("submitted_at", 1)
        .limit(20000)
    ):
        latest[d["user_id"]] = int((d.get("result") or {}).get("score") or 0)
    _NORMS.update(at=t, scores=list(latest.values()))
    return _NORMS["scores"]


def reset_norms() -> None:
    _NORMS.update(at=None, scores=[])


# --- the candidate side ------------------------------------------------------------------------------------------------


async def starts_of(db, uid: str, key: str, t: datetime, days: int) -> list[datetime]:
    q: dict[str, Any] = {"user_id": uid, "key": key, "started_at": {"$gt": t - timedelta(days=days)}}
    return [d["started_at"] async for d in db[TRUST_WORKTESTS].find(q, {"started_at": 1})]


async def retake_status(db, uid: str, key: str, t: datetime, running: bool = False) -> dict[str, Any]:
    from app.trust.honesty import retake as RK

    pol = await RK.policy(db, uid, "skill")
    w = RK.window(await starts_of(db, uid, key, t, pol["days"]), t, pol["attempts"], pol["days"])
    out = RK.out("skill", pol, w, running=running)
    out["counts"] = (
        "Your latest result counts (for 365 days). A later one that is lower replaces it, so take it when you’re ready."
    )
    out.pop("refreshDays", None)
    return out


async def _finish_expired(db, uid: str, t: datetime) -> None:
    """A test left running past its time is marked with what was saved (nothing is lost, nothing extra is added)."""
    async for d in db[TRUST_WORKTESTS].find({"user_id": uid, "status": "running", "deadline": {"$lt": t - GRACE}}):
        await finalize(db, d, t, None)


async def catalogue(db, uid: str, t: datetime | None = None) -> dict[str, Any]:
    from app.trust.honesty import pledge as PL

    t = t or now()
    await _finish_expired(db, uid, t)
    docs = await db[TRUST_WORKTESTS].find({"user_id": uid}).sort("started_at", -1).limit(60).to_list(60)
    scores = await norms(db, t)
    tests = []
    for test in B.TESTS:
        mine = [d for d in docs if d["test"] == test]
        running = next((d for d in mine if d["status"] == "running"), None)
        done = [d for d in mine if d["status"] == "submitted"]
        latest = {}
        for d in done:  # newest first: the latest per language
            latest.setdefault(d["lang"], d)
        retakes = {lang: await retake_status(db, uid, key_of(test, lang), t, running=bool(running and running["lang"] == lang)) for lang in B.LANGS} \
            if test == "typing" else {"any": await retake_status(db, uid, test, t, running=bool(running))}  # fmt: skip
        tests.append({"test": test, "name": NAMES[test], "about": ABOUT[test], "running": paper_out(running) if running else None,
                      "results": [result_out(d, *_top_now(d, scores)) for d in latest.values()], "retake": retakes})  # fmt: skip
    return {"tests": tests, "langs": [{"key": k, "name": B.LANG_NAMES[k]} for k in B.LANGS], "pledge": PL.texts(),
            "typingRule": "Speed is 5 characters a minute = 1 word, in every language; in Hindi and Telugu each letter, vowel sign and virama counts as a character. Speeds are compared only within a language."}  # fmt: skip


def _top_now(doc: dict[str, Any], scores: list[int]) -> tuple[str | None, bool | None]:
    """(top, provisional) for an aptitude result against today's norms; (None, None) for the other tests."""
    if doc["test"] != "aptitude" or not doc.get("result"):
        return None, None
    pct = S.percentile(doc["result"]["score"], scores)
    return S.aptitude_top(doc["result"]["score"], pct), pct is None


async def start(
    db, uid: str, test: str, lang: str, pledge: int | None, extra: bool, t: datetime | None = None
) -> dict[str, Any]:
    from app.trust.honesty import pledge as PL

    t = t or now()
    if test not in B.TESTS or lang not in B.LANGS:
        raise ApiError(400, "bad_test", "Choose a test and a language.")
    await _finish_expired(db, uid, t)
    running = await db[TRUST_WORKTESTS].find_one({"user_id": uid, "test": test, "status": "running"})
    if running and (test != "typing" or running["lang"] == lang):
        return paper_out(running)  # carry on with it (a reload, a dropped connection)
    key = key_of(test, lang)
    rk = await retake_status(db, uid, key, t)
    if not rk["canStart"]:
        raise ApiError(
            409,
            "retake",
            f"You have used your tries for now ({rk['rule']}). The date you can try again is on the page.",
            extra={"retake": rk},
        )
    pledged = await PL.check(db, uid, pledge, lang, t)
    before = await db[TRUST_WORKTESTS].count_documents({"user_id": uid, "test": test})
    form_id = pick_form(uid, test, before)
    f = B.form(test, form_id)
    rng = random.SystemRandom()
    doc: dict[str, Any] = {"_id": ObjectId(), "user_id": uid, "test": test, "lang": lang, "key": key, "form": form_id, "status": "running",
                           "started_at": t, "extra_time": bool(extra), "pledge": pledged, "v": 1}  # fmt: skip
    if test == "typing":
        doc["seconds"] = seconds_for(test, 0, False)
        doc["deadline"] = t + timedelta(seconds=doc["seconds"] + READ_SECONDS)
    else:
        items = list(f["items"])
        rng.shuffle(items)
        doc["items"] = [it["id"] for it in items]
        doc["order"] = {it["id"]: E.option_order(it, rng) for it in items}
        doc["seconds"] = seconds_for(test, len(items), extra)
        doc["deadline"] = t + timedelta(seconds=doc["seconds"])
    await db[TRUST_WORKTESTS].insert_one(doc)
    return paper_out(doc)


async def _mine(db, uid: str, aid: str) -> dict[str, Any]:
    d = await db[TRUST_WORKTESTS].find_one({"_id": _oid(aid), "user_id": uid})
    if not d:
        raise ApiError(404, "not_found", "That test isn’t here.")
    return d


def _clean_answers(doc: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    """Only known items, shown positions 0–3 (sjt: {most, least})."""
    out: dict[str, Any] = {}
    ids = set(doc.get("items") or [])
    for k, v in (answers or {}).items():
        if k not in ids:
            continue
        if doc["test"] == "sjt" and isinstance(v, dict):
            pk = {x: int(v[x]) for x in ("most", "least") if isinstance(v.get(x), int) and 0 <= v[x] < 4}
            if pk:
                out[k] = pk
        elif doc["test"] == "aptitude" and isinstance(v, int) and 0 <= v < 4:
            out[k] = v
    return out


async def progress(db, uid: str, aid: str, body: dict[str, Any], t: datetime | None = None) -> dict[str, Any]:
    t = t or now()
    d = await _mine(db, uid, aid)
    if d["status"] != "running":
        raise ApiError(409, "done", "This test is already finished.")
    if t > d["deadline"] + GRACE:
        await finalize(db, d, t, None)
        raise ApiError(409, "time_over", "Time is over. Your saved answers were marked.")
    saved = {"at": t}
    if d["test"] == "typing":
        saved["typed"] = str(body.get("typed") or "")[:2000]
    else:
        saved["answers"] = _clean_answers(d, body.get("answers") or {})
        saved["times"] = {
            k: int(v)
            for k, v in (body.get("times") or {}).items()
            if k in set(d["items"]) and isinstance(v, int | float)
        }
    await db[TRUST_WORKTESTS].update_one({"_id": d["_id"], "status": "running"}, {"$set": {"saved": saved}})
    return {"saved": True, "deadline": ms(d["deadline"])}


async def submit(db, uid: str, aid: str, body: dict[str, Any], t: datetime | None = None) -> dict[str, Any]:
    t = t or now()
    d = await _mine(db, uid, aid)
    if d["status"] != "running":
        return result_out(d, *_top_now(d, await norms(db, t))) or {}
    late = t > d["deadline"] + GRACE
    return await finalize(db, d, t, None if late else body)


async def finalize(db, d: dict[str, Any], t: datetime, body: dict[str, Any] | None) -> dict[str, Any]:
    """Marks the attempt. `body` None: the saved answers only (time ran out). Never rejects anyone: signals are kept for
    a person (T8) and the result stands."""
    saved = d.get("saved") or {}
    flags: list[str] = []
    integ: dict[str, Any] = {}
    counters: dict[str, int] = {}
    if d["test"] == "typing":
        b = body or {}
        typed = str(b.get("typed") if body is not None else saved.get("typed") or "")[:2000]
        server_ms = int((min(t, d["deadline"] + GRACE) - d["started_at"]).total_seconds() * 1000)
        page_ms = int(b.get("ms") or 0) if body is not None else server_ms
        # pasted: what the page saw arrive in big inserts, and at least what its count of input events can't explain
        inputs = int(b.get("inputs") or 0) if body is not None else 10**6
        pasted = max(int(b.get("insertedChars") or 0), len(S.norm(typed)) - inputs * S.BIG_INSERT)
        res = S.typing(B.form("typing", d["form"])["passages"][d["lang"]], typed, page_ms, server_ms, pasted)
        flags = res.pop("flags")
        counters = {"inputs": int(b.get("inputs") or 0), "pasteAttempts": int(b.get("pasteAttempts") or 0), "insertedChars": int(b.get("insertedChars") or 0),
                    "blurs": int((b.get("signals") or {}).get("blurs") or 0)}  # fmt: skip
        if counters["pasteAttempts"] and "typing_paste" not in flags:
            flags.append("typing_paste")  # the page blocked a paste: still a signal for a person, not a penalty
    else:
        raw = (body or {}).get("answers") if body is not None else saved.get("answers")
        shown = _clean_answers(d, raw or {})
        times = (body or {}).get("times") if body is not None else saved.get("times")
        items = items_of(d)
        if d["test"] == "sjt":
            picks = {k: {x: d["order"][k][v[x]] for x in ("most", "least") if x in v} for k, v in shown.items()}
            res = S.sjt(items, picks)
            positions = [v["most"] for v in shown.values() if "most" in v]
        else:
            res = S.aptitude(items, {k: d["order"][k][v] for k, v in shown.items()})
            positions = list(shown.values())
        qs = []
        for it in items:
            q, opts = local(it, d["lang"])
            qs.append({"_id": it["id"], "question": q, "options": opts})
        sig = dict((body or {}).get("signals") or {})
        sig = {k: sig.get(k) for k in ("blurs", "blurMs", "copies", "devtools", "contextMenus")}
        sig["fastAnswers"] = E.fast_answers(
            qs, {k: int(v) for k, v in (times or {}).items() if isinstance(v, int | float)}
        )
        sig["samePosition"] = E.same_position(positions)
        integ = E.integrity(sig)
        if d["test"] == "aptitude":
            scores = await norms(db, t, fresh=True)
            pct = S.percentile(res["score"], scores)
            res["percentile"] = pct
            res["provisional"] = pct is None
            res["top"] = S.aptitude_top(res["score"], pct)
    sets = {"status": "submitted", "submitted_at": t, "result": res, "flags": sorted(set(flags)), "integrity": integ, "counters": counters,
            "late": body is None}  # fmt: skip
    r = await db[TRUST_WORKTESTS].update_one({"_id": d["_id"], "status": "running"}, {"$set": sets})
    if not r.modified_count:  # two submits at once: the first one counted
        d = await db[TRUST_WORKTESTS].find_one({"_id": d["_id"]})
    else:
        d = {**d, **sets}
        reset_norms()
    return result_out(d, *_top_now(d, await norms(db, t))) or {}


async def result(db, uid: str, aid: str) -> dict[str, Any]:
    d = await _mine(db, uid, aid)
    if d["status"] == "running":
        if now() > d["deadline"] + GRACE:
            return await finalize(db, d, now(), None)
        return {"running": paper_out(d)}
    return result_out(d, *_top_now(d, await norms(db))) or {}


# --- for companies (Hire now), T8 and T12 ---------------------------------------------------------------------------------


async def badges_for(db, uids: list[str], t: datetime | None = None) -> dict[str, dict[str, Any]]:
    """{uid: {typing, sjt, aptitude}}: the company-visible badges (good news only) from the last 365 days.
    typing: the best step over the languages; sjt / aptitude: the latest result."""
    t = t or now()
    out: dict[str, dict[str, Any]] = {u: {} for u in uids}
    if not uids:
        return out
    scores = await norms(db, t)
    async for d in (
        db[TRUST_WORKTESTS]
        .find({"user_id": {"$in": uids}, "status": "submitted", "submitted_at": {"$gt": t - VALID}},
              {"user_id": 1, "test": 1, "lang": 1, "result": 1, "submitted_at": 1})
        .sort("submitted_at", 1)
    ):  # fmt: skip
        mine = out[d["user_id"]]
        if d["test"] == "typing":
            b = badge_of(d)
            cur = mine.get("typing")
            latest = mine.setdefault("_typing_latest", {})
            latest[d["lang"]] = (b, d)  # the latest result per language counts
            best = max(
                (x for x in latest.values() if x[0]["step"]),
                key=lambda x: (x[0]["step"], x[1]["result"]["wpm"]),
                default=None,
            )
            if best:
                mine["typing"] = {"label": best[0]["badge"], "step": best[0]["step"], "wpm": best[1]["result"]["wpm"],
                                  "accuracy": best[1]["result"]["accuracy"], "lang": best[1]["lang"], "source": "Nm7 typing test"}  # fmt: skip
            elif cur:
                mine.pop("typing", None)
        else:
            b = badge_of(d, *_top_now(d, scores))
            if b["badge"]:
                mine[d["test"]] = {"label": b["badge"], **({"level": b["level"]} if d["test"] == "sjt" else {"top": b["top"]}),
                                   "source": f"Nm7 {NAMES[d['test']].lower()}"}  # fmt: skip
            else:
                mine.pop(d["test"], None)  # a later lower result replaces an earlier badge
    for v in out.values():
        v.pop("_typing_latest", None)
    return out


async def outcomes(db, since: datetime, cap: int) -> dict[str, list[tuple[str, str, bool]]]:
    """For T12's pass-rate gap checks: {metric: [(user, language, ok)]}."""
    rows: dict[str, list[tuple[str, str, bool]]] = {"typing": [], "sjt": [], "aptitude": []}
    async for d in db[TRUST_WORKTESTS].find({"status": "submitted", "submitted_at": {"$gt": since}},
                                            {"user_id": 1, "test": 1, "lang": 1, "result": 1}).limit(cap):  # fmt: skip
        res = d.get("result") or {}
        if d["test"] == "typing":
            ok = bool(S.typing_level(res.get("wpm", 0), res.get("accuracy", 0)) and res.get("wpm", 0) >= 25)
        elif d["test"] == "sjt":
            ok = res.get("level") in ("strong", "good")
        else:
            ok = int(res.get("score") or 0) >= 60
        rows[d["test"]].append((d["user_id"], str(d.get("lang") or "en"), ok))
    return rows


def signals_of(d: dict[str, Any]) -> list[tuple[str, str]]:
    """[(kind, detail)] for the T8 rating: the typing flags and the V2 integrity reasons."""
    out = [(f, f"Typing test ({B.LANG_NAMES.get(d.get('lang'), '')}): {int((d.get('counters') or {}).get('insertedChars') or 0)} characters in big inserts, "
               f"{int((d.get('counters') or {}).get('pasteAttempts') or 0)} paste attempts blocked") for f in d.get("flags") or []]  # fmt: skip
    integ = d.get("integrity") or {}
    for reason in integ.get("reasons") or []:
        out.append(
            (reason, f"{NAMES[d['test']]}: V2 integrity {integ.get('level', '')} · {integ.get('points', 0)} points")
        )
    return out
