"""The rules of a V2 skill check, as pure functions (no database): the paper for an experience band, timers, marking,
topic scores, the pass rules, retakes and expiry, and the integrity score. The router (router.py) stores and serves.

Paper: 18 questions (15–20 allowed) drawn at random across every topic of the role, harder for higher experience
bands, options shuffled, so no two candidates get the same paper. Each question has its own timer (by difficulty) and
the whole test has one: 15 minutes, or 22½ with the extra-time option (accessibility; declared before starting).

Pass: the test at 70 or more AND the practical task at 60 or more ⇒ "Skill verified" (vetting level L2) for 90 days,
unless the attempt's integrity level is "needs retest". One attempt per role every 30 days (a free retest under
stricter settings after "needs retest" is the one exception).
"""

import math
import random
import re
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Literal

QUESTIONS = 18
MIN_PAPER = 15
MINUTES = 15
EXTRA_TIME = 1.5
PASS_MCQ = 70
PASS_TASK = 60
REVIEW_BAND = (55, 65)  # a task score in here goes to a person, not an automatic fail or pass
RETAKE = timedelta(days=30)
VALID = timedelta(days=90)
RESUME_WITHIN = timedelta(minutes=10)  # a dropped connection: come back within this, the clock was paused
PAUSE_GAP = timedelta(seconds=30)  # no word from the page for longer than this = a pause (not charged after 30 s)
STRICT_PAUSES = 1  # a retest under stricter settings allows one pause
SECONDS = {"easy": 40, "medium": 55, "hard": 75}  # each question's own timer

Band = Literal["fresher", "1-3", "3-5", "5-8", "8+"]
BANDS: dict[str, dict[str, Any]] = {
    "fresher": {"label": "Fresher", "mix": {"easy": 0.6, "medium": 0.35, "hard": 0.05}},
    "1-3": {"label": "1–3 years", "mix": {"easy": 0.4, "medium": 0.45, "hard": 0.15}},
    "3-5": {"label": "3–5 years", "mix": {"easy": 0.2, "medium": 0.5, "hard": 0.3}},
    "5-8": {"label": "5–8 years", "mix": {"easy": 0.1, "medium": 0.4, "hard": 0.5}},
    "8+": {"label": "8+ years", "mix": {"easy": 0.05, "medium": 0.35, "hard": 0.6}},
}
LEVELS = ("clean", "watch", "retest")
LEVEL_LABEL = {"clean": "Clean", "watch": "Watch", "retest": "Needs retest"}


def band_for_years(years: float | None) -> str:
    """The band a person's experience points to (the test page suggests it; the candidate may pick another)."""
    if years is None or years < 1:
        return "fresher"
    return "1-3" if years < 3 else "3-5" if years < 5 else "5-8" if years < 8 else "8+"


def quota(n: int, mix: dict[str, float]) -> dict[str, int]:
    """How many questions of each difficulty: largest remainder, so the counts add up to n."""
    raw = {d: n * w for d, w in mix.items()}
    out = {d: math.floor(v) for d, v in raw.items()}
    for d in sorted(raw, key=lambda d: raw[d] - out[d], reverse=True)[: n - sum(out.values())]:
        out[d] += 1
    return out


def build_paper(
    pool: list[dict[str, Any]],
    band: str,
    n: int = QUESTIONS,
    *,
    avoid: set | None = None,
    rng: random.Random | None = None,
) -> list[dict[str, Any]]:
    """`n` questions from the active `pool` ({_id, topic, difficulty, ...}): the band's difficulty mix, spread over the
    topics (round robin from a shuffled topic order), never a question in `avoid` (the last paper, for a retest) when
    there are enough others. Short of one difficulty, the nearest one fills in. No repeats."""
    rng = rng or random.SystemRandom()
    avoid = avoid or set()
    fresh = [q for q in pool if q["_id"] not in avoid]
    use = fresh if len(fresh) >= n else pool
    want = quota(min(n, len(use)), BANDS.get(band, BANDS["fresher"])["mix"])
    by: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for q in use:
        by.setdefault(q.get("difficulty", "medium"), {}).setdefault(q.get("topic") or "", []).append(q)
    for groups in by.values():
        for qs in groups.values():
            rng.shuffle(qs)
    near = {"easy": ("medium", "hard"), "medium": ("easy", "hard"), "hard": ("medium", "easy")}
    picked: list[dict[str, Any]] = []
    used: Counter[str] = Counter()  # topics already on the paper, so the next pick prefers a topic used less

    def take(d: str) -> bool:
        groups = {t: qs for t, qs in by.get(d, {}).items() if qs}
        if not groups:
            return False
        low = min(used[t] for t in groups)
        t = rng.choice(sorted(t for t in groups if used[t] == low))
        picked.append(groups[t].pop())
        used[t] += 1
        return True

    for d in ("hard", "medium", "easy"):
        for _ in range(want[d]):
            if not take(d) and not any(take(x) for x in near[d]):
                break
    rng.shuffle(picked)
    return picked


def option_order(q: dict[str, Any], rng: random.Random | None = None) -> list[int]:
    """The bank's option index behind each shown option."""
    idx = list(range(len(q["options"])))
    (rng or random.SystemRandom()).shuffle(idx)
    return idx


def total_seconds(questions: list[dict[str, Any]], extra_time: bool = False) -> int:
    """The whole test's time: 15 minutes (22½ with extra time); never less than the questions' own timers allow."""
    base = max(MINUTES * 60, sum(SECONDS.get(q.get("difficulty", "medium"), 55) for q in questions))
    return int(base * (EXTRA_TIME if extra_time else 1))


def question_seconds(q: dict[str, Any], extra_time: bool = False) -> int:
    return int(SECONDS.get(q.get("difficulty", "medium"), 55) * (EXTRA_TIME if extra_time else 1))


def mark(questions: list[dict[str, Any]], order: dict[str, list[int]], answers: dict[str, int]) -> dict[str, Any]:
    """Score 0–100, right / total, per-topic scores and per-difficulty right counts. `answers`: shown index by id."""
    right = 0
    topics: dict[str, list[int]] = {}
    by_diff: dict[str, list[int]] = {}
    for q in questions:
        qid = str(q["_id"])
        shown = answers.get(qid)
        ok = shown is not None and 0 <= shown < len(order.get(qid, [])) and order[qid][shown] == q["answer"]
        right += ok
        t = topics.setdefault(q.get("topic") or "General", [0, 0])
        t[0] += ok
        t[1] += 1
        d = by_diff.setdefault(q.get("difficulty", "medium"), [0, 0])
        d[0] += ok
        d[1] += 1
    total = len(questions)
    return {
        "right": right,
        "total": total,
        "score": round(100 * right / total) if total else 0,
        "topics": {k: round(100 * v[0] / v[1]) for k, v in sorted(topics.items())},
        "byDifficulty": {k: {"right": v[0], "total": v[1]} for k, v in by_diff.items()},
    }


def strengths(topics: dict[str, int]) -> dict[str, list[str]]:
    """ "Strong: SQL joins · Improve: indexing": topics at 75+ are strong, under 60 to improve."""
    return {"strong": [t for t, s in topics.items() if s >= 75], "improve": [t for t, s in topics.items() if s < 60]}


def task_score(scores: list[dict[str, Any]]) -> int:
    """Rubric scores (0–5 each) → 0–100."""
    if not scores:
        return 0
    return round(100 * sum(int(s["score"]) for s in scores) / (5 * len(scores)))


def stars(score: int | None) -> float | None:
    """0–100 → the "4.2/5" companies see."""
    return None if score is None else round(score / 20, 1)


def needs_review(score: int, confidence: str) -> bool:
    return REVIEW_BAND[0] <= score <= REVIEW_BAND[1] or confidence == "low"


def verified(mcq: int | None, task: int | None, integrity: str) -> bool:
    return mcq is not None and task is not None and mcq >= PASS_MCQ and task >= PASS_TASK and integrity != "retest"


def can_start(last_started: datetime | None, t: datetime, free_retest: bool = False) -> bool:
    return free_retest or last_started is None or last_started + RETAKE <= t


def is_expired(expires_at: datetime | None, t: datetime) -> bool:
    return expires_at is not None and expires_at <= t


def tick(remaining_ms: int, last_seen: datetime, t: datetime) -> tuple[int, bool]:
    """The clock after a sign of life at `t`: (remaining ms, was this a pause). A gap longer than PAUSE_GAP is a
    dropped connection or a closed tab: only PAUSE_GAP of it is charged."""
    gap = t - last_seen
    pause = gap > PAUSE_GAP
    used = min(gap, PAUSE_GAP)
    return max(0, remaining_ms - int(used.total_seconds() * 1000)), pause


def reading_seconds(text: str, options: list[str]) -> float:
    """A fair minimum time to read a question and its options (about 4 words a second, at least 3 seconds)."""
    n = len(re.findall(r"\S+", text + " " + " ".join(options)))
    return max(3.0, n / 4)


# --- integrity --------------------------------------------------------------------------------------------------

POINTS = {
    "tab_away": "Left the test page often",
    "time_away": "Away from the test page for long",
    "copy": "Copied text from the test",
    "paste": "Pasted text into an answer",
    "devtools": "Opened developer tools or right-click menus",
    "too_fast": "Answered faster than the questions can be read",
    "same_position": "Picked the same answer position almost every time",
    "pattern_match": "Same answer pattern as another account",
    "text_match": "Practical task text nearly the same as another account's",
    "shared_device": "Same device or network as another account taking this test",
    "resume_mismatch": "Experience claimed doesn't match easy-question results",
    "pauses": "Paused the test more than allowed",
}


def integrity(sig: dict[str, Any]) -> dict[str, Any]:
    """{level, points, reasons}. Points, not proof: 0–2 Clean, 3–4 Watch, 5+ Needs retest. No single weak signal
    (like text that only "looks like AI") ever decides on its own."""
    pts: dict[str, int] = {}
    blur, blur_ms = int(sig.get("blurs") or 0), int(sig.get("blurMs") or 0)
    if blur > 8:
        pts["tab_away"] = 2
    elif blur > 3:
        pts["tab_away"] = 1
    if blur_ms > 180_000:
        pts["time_away"] = 2
    elif blur_ms > 60_000:
        pts["time_away"] = 1
    if int(sig.get("copies") or 0) > 2:
        pts["copy"] = 1
    pasted, typed = int(sig.get("pastedChars") or 0), int(sig.get("taskChars") or 0)
    if typed and pasted / typed > 0.3:
        pts["paste"] = 2 if sig.get("looksGenerated") else 1  # "looks generated" only adds weight to a real paste
    if int(sig.get("devtools") or 0) or int(sig.get("contextMenus") or 0) > 2:
        pts["devtools"] = 1
    fast = int(sig.get("fastAnswers") or 0)
    if fast >= 5:
        pts["too_fast"] = 2
    elif fast >= 3:
        pts["too_fast"] = 1
    if sig.get("samePosition"):
        pts["same_position"] = 2
    if sig.get("patternMatch"):
        pts["pattern_match"] = 3
    if sig.get("textMatch"):
        pts["text_match"] = 3
    if sig.get("sharedDevice"):
        pts["shared_device"] = 2
    if sig.get("resumeMismatch"):
        pts["resume_mismatch"] = 1  # for a person to look at, never an accusation
    if sig.get("strict") and int(sig.get("pauses") or 0) > STRICT_PAUSES:
        pts["pauses"] = 2
    total = sum(pts.values())
    level = "clean" if total <= 2 else "watch" if total <= 4 else "retest"
    serious = bool(pts.keys() & {"pattern_match", "text_match", "shared_device"})
    return {"level": level, "points": total, "reasons": sorted(pts, key=lambda k: -pts[k]), "serious": serious}


def same_position(shown: list[int]) -> bool:
    """The same answer position in 80%+ of 10 or more answers."""
    if len(shown) < 10:
        return False
    return Counter(shown).most_common(1)[0][1] / len(shown) >= 0.8


def fast_answers(questions: list[dict[str, Any]], times_ms: dict[str, int]) -> int:
    """Answers given in under a quarter of the reading time."""
    n = 0
    for q in questions:
        ms = times_ms.get(str(q["_id"]))
        if ms is not None and ms < 250 * reading_seconds(q["question"], q["options"]):
            n += 1
    return n


def wrong_pattern(
    questions: list[dict[str, Any]], order: dict[str, list[int]], answers: dict[str, int]
) -> dict[str, int]:
    """{question id: the bank option picked} for the wrong answers (shown positions differ per paper, so the bank
    option is what two accounts can share)."""
    out = {}
    for q in questions:
        qid = str(q["_id"])
        shown = answers.get(qid)
        if shown is None or not 0 <= shown < len(order.get(qid, [])):
            continue
        picked = order[qid][shown]
        if picked != q["answer"]:
            out[qid] = picked
    return out


def patterns_match(a: dict[str, int], b: dict[str, int]) -> bool:
    """Two papers share at least 6 identical wrong picks on the same questions, and those are most of the overlap."""
    common = set(a) & set(b)
    same = sum(a[k] == b[k] for k in common)
    return same >= 6 and same / max(1, len(common)) >= 0.8


def shingles(text: str, k: int = 5) -> set[str]:
    w = re.findall(r"[a-z0-9]+", text.lower())
    return {" ".join(w[i : i + k]) for i in range(max(0, len(w) - k + 1))}


def text_similarity(a: str, b: str) -> float:
    x, y = shingles(a), shingles(b)
    return len(x & y) / len(x | y) if x and y else 0.0


def resume_mismatch(band: str, by_difficulty: dict[str, dict[str, int]]) -> bool:
    """Claims 3+ years but gets under half of the EASY questions right."""
    if band in ("fresher", "1-3"):
        return False
    e = by_difficulty.get("easy") or {}
    return int(e.get("total") or 0) >= 2 and int(e.get("right") or 0) / int(e["total"]) < 0.5
