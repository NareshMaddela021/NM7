# ruff: noqa: E501  (dense constants)
"""Vetting Trust T15: the maths of the three work tests, as pure functions (no database, no AI: every grade is
deterministic, so the same answers always get the same result, and nothing about the person is ever used).

Typing
  Text is compared after Unicode NFC normalisation, with zero-width joiners / non-joiners (U+200C / U+200D) removed and
  runs of spaces made one (keyboards and phonetic input tools for Hindi and Telugu differ in these, the reader can't
  see them). A "character" is a Unicode code point: in Hindi and Telugu every consonant, vowel sign (matra) and virama
  counts as one, which is close to one key on an InScript keyboard. A "word" is 5 characters in every language
  (the usual typing-test rule), so
      gross WPM = characters typed (not pasted) / 5 / minutes
      errors    = the edit distance (insert / delete / change one character) between the typed text and the best
                  matching start of the passage (so stopping early is not an error)
      accuracy  = (characters typed − errors) / characters typed
      WPM       = gross WPM × accuracy  (the "net" speed shown and filtered on)
  Speeds are compared only within a language (a Telugu character is not an English character); the badge says which.
  Text that arrived in one big insert (a paste, or a long autocomplete) does not count toward the speed.
  Timing: the page's own clock (first key to the last) is used, never more than the server saw between start and
  submit (+3 s for the network); a page clock longer than that, or a speed no person types (over 150 WPM), is a
  "timing" signal for a person to look at.

Situational judgement (SJT)
  For each scenario the person picks the MOST and the LEAST effective response. 1 point for the expert's best as
  most effective, 1 for the expert's worst as least effective (0–2 a scenario). Score = points / (2 × scenarios), 0–100.
  Strong 75+, Good 55+, otherwise "Developing" (not shown to companies).

Aptitude
  One point per right answer, 0–100, with numerical / verbal / logical part scores. "Top X%" compares the score with
  everyone who took an aptitude test (latest result each, last 365 days) once there are NORM_MIN of them; until then
  provisional cut scores stand in (and the badge says "provisional"). Below the top half nothing is shown to companies.
"""

import unicodedata
from typing import Any

ZW = dict.fromkeys(map(ord, "‌‍﻿"))
WORD = 5
MAX_WPM = 150  # nobody types faster than this in a short test
CLOCK_SLACK_MS = 3000
BIG_INSERT = 12  # one input event adding more than this many characters = pasted (a long autocomplete counts too)
TYPING_STEPS = (45, 35, 25, 15)
TYPING_ACCURACY = 90.0  # a speed badge needs at least this accuracy
SJT_LEVELS = (("strong", 75), ("good", 55))
SJT_LABEL = {"strong": "SJT: strong", "good": "SJT: good", "developing": "SJT: developing"}
TOP = (("top10", 90), ("top30", 70), ("top50", 50))  # percentile at least
TOP_LABEL = {"top10": "Aptitude: top 10%", "top30": "Aptitude: top 30%", "top50": "Aptitude: top 50%"}
PROVISIONAL = {"top10": 93, "top30": 80, "top50": 67}  # score at least, until NORM_MIN people took it
NORM_MIN = 50


# --- typing ----------------------------------------------------------------------------------------------------------


def norm(s: str) -> str:
    return " ".join(unicodedata.normalize("NFC", s or "").translate(ZW).split())


def prefix_distance(typed: str, passage: str) -> int:
    """The edit distance between `typed` and the closest start of `passage` (any length)."""
    n = len(typed)
    if not n:
        return 0
    p = passage[: n + 40]
    prev = list(range(len(p) + 1))  # row for typed[:0]
    for i in range(1, n + 1):
        cur = [i] + [0] * len(p)
        a = typed[i - 1]
        for j in range(1, len(p) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a != p[j - 1]))
        prev = cur
    return min(prev)


def typing(passage: str, typed: str, page_ms: int, server_ms: int, pasted: int = 0) -> dict[str, Any]:
    """{chars, errors, accuracy (%), grossWpm, wpm (net), seconds, completed, flags}."""
    t, p = norm(typed), norm(passage)
    flags: list[str] = []
    ms = int(page_ms or 0)
    if ms > server_ms + CLOCK_SLACK_MS:
        flags.append("typing_timing")  # the page says it took longer than the server could have seen
        ms = server_ms
    ms = max(ms, 1000)
    n = len(t)
    pasted = max(0, min(int(pasted or 0), n))
    if pasted:
        flags.append("typing_paste")
    err = prefix_distance(t, p)
    acc = (n - err) / n if n else 0.0
    minutes = ms / 60000
    gross = (n - pasted) / WORD / minutes
    if n and n / WORD / minutes > MAX_WPM:
        flags.append("typing_timing")
    return {"chars": n, "errors": err, "accuracy": round(100 * max(0.0, acc), 1), "grossWpm": round(gross, 1),
            "wpm": round(max(0.0, gross * acc)), "seconds": round(ms / 1000, 1), "completed": n > 0 and t == p,
            "flags": sorted(set(flags))}  # fmt: skip


def typing_level(wpm: int, accuracy: float) -> int | None:
    """The highest step reached (45 / 35 / 25 / 15 WPM with 90%+ accuracy), else None (not shown to companies)."""
    if accuracy < TYPING_ACCURACY:
        return None
    return next((s for s in TYPING_STEPS if wpm >= s), None)


def typing_label(step: int, lang: str) -> str:
    from app.trust.worktests.banks import LANG_NAMES

    return f"Typing {step} wpm+ ({LANG_NAMES.get(lang, lang)})"


# --- situational judgement -------------------------------------------------------------------------------------------


def sjt(items: list[dict[str, Any]], picks: dict[str, dict[str, int]]) -> dict[str, Any]:
    """`picks` {item id: {most, least}} as bank option indexes. {score, points, of, answered, level, label}."""
    pts = 0
    answered = 0
    for it in items:
        pk = picks.get(it["id"]) or {}
        most, least = pk.get("most"), pk.get("least")
        if most is None or least is None or most == least:
            continue
        answered += 1
        pts += int(most == it["best"]) + int(least == it["worst"])
    of = 2 * len(items)
    score = round(100 * pts / of) if of else 0
    level = next((k for k, lo in SJT_LEVELS if score >= lo), "developing")
    return {"score": score, "points": pts, "of": of, "answered": answered, "level": level, "label": SJT_LABEL[level]}


# --- aptitude --------------------------------------------------------------------------------------------------------


def aptitude(items: list[dict[str, Any]], answers: dict[str, int]) -> dict[str, Any]:
    """`answers` {item id: bank option index}. {score, right, of, answered, sections {name: score}}."""
    right = 0
    by: dict[str, list[int]] = {}
    for it in items:
        a = answers.get(it["id"])
        ok = a is not None and a == it["answer"]
        right += int(ok)
        s = by.setdefault(it["section"], [0, 0])
        s[0] += int(ok)
        s[1] += 1
    n = len(items)
    return {"score": round(100 * right / n) if n else 0, "right": right, "of": n,
            "answered": sum(1 for it in items if answers.get(it["id"]) is not None),
            "sections": {k: round(100 * v[0] / v[1]) for k, v in by.items()}}  # fmt: skip


def percentile(score: int, scores: list[int]) -> float | None:
    """The share of people (in %) who scored lower, ties counting half. None without enough people to compare."""
    if len(scores) < NORM_MIN:
        return None
    below = sum(1 for s in scores if s < score)
    same = sum(1 for s in scores if s == score)
    return round(100 * (below + same / 2) / len(scores), 1)


def aptitude_top(score: int, pct: float | None) -> str | None:
    if pct is not None:
        return next((k for k, lo in TOP if pct >= lo), None)
    return next((k for k, _ in TOP if score >= PROVISIONAL[k]), None)
