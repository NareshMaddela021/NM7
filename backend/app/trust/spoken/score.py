# ruff: noqa: E501  (plain texts and tables)
"""Vetting Trust T10: the spoken-English score maths (pure functions, no database, no network).

Four sub-scores, each 0–100, from the candidate's ENGLISH spoken answers in the AI interview (V3, "Speak my answers"):
  pronunciation   from a speech-assessment provider (providers.py), as INTELLIGIBILITY only: the provider's accuracy
                  score is divided by 0.8 and capped at 100, so every answer the provider rates 80 or more counts as
                  fully clear. Above "easily understood" an accent earns nothing and costs nothing (a regional Indian
                  accent is never a penalty); the provider runs on its Indian-English model (en-IN). No provider, no
                  key or no audio → None ("not measured") and the band uses the other three, with a note.
  fluency         from timing only: words per minute over the time actually spent speaking (from the browser's speech
                  events; else the whole answer time), long pauses (3 s or more without a recognised word) per minute,
                  and filler words ("um", "uh", "erm", "hmm") per 100 words. 110–160 words a minute is full marks.
  grammar         Claude (strict schema) from the anonymised transcript; without AI, simple rules that only count a few
                  unambiguous slips (never above 75). Indian-English usage ("do the needful", "prepone", "kindly
                  revert", "itself", "only" for emphasis) is never counted as an error.
  comprehension   did the answer address the question: Claude relative to the question; without AI, shared content
                  words with the question (never above 75).
Overall = the mean of the sub-scores that were measured (rounded). Band: A1 0–29, A2 30–44, B1 45–59, B2 60–74,
C1 75–89, C2 90–100. "CEFR-style" means the bands follow the CEFR descriptions; it is not an official CEFR certificate.
Not enough English speech (fewer than 2 English answers or 40 English words) → no band ("not enough English speech").
"""

import re
from typing import Any

SUBS = ("pronunciation", "fluency", "grammar", "comprehension")
SUB_LABEL = {
    "pronunciation": "Pronunciation (how clearly you are understood)",
    "fluency": "Fluency (pace, pauses, fillers)",
    "grammar": "Grammar",
    "comprehension": "Comprehension (did the answer address the question)",
}
BANDS: tuple[tuple[str, int], ...] = (("A1", 0), ("A2", 30), ("B1", 45), ("B2", 60), ("C1", 75), ("C2", 90))
BAND_KEYS = tuple(b for b, _ in BANDS)
BAND_TEXT = {
    "A1": "Beginner: uses a few familiar words and very short phrases; the listener has to help a lot.",
    "A2": "Elementary: gives short, simple answers about familiar things; often stops to search for words.",
    "B1": "Intermediate: can describe experience and handle a simple customer conversation; some pauses and mistakes, but the meaning is clear.",
    "B2": "Upper intermediate: speaks clearly and fairly fluently about work; mistakes rarely get in the way of the meaning.",
    "C1": "Advanced: speaks fluently and precisely, and handles unexpected questions easily.",
    "C2": "Proficient: speaks effortlessly and accurately, with fine shades of meaning.",
}
INTELLIGIBLE = 80  # a provider accuracy at or above this counts as fully clear (100)
MIN_ANSWERS, MIN_WORDS = 2, 40
LONG_PAUSE_MS = 3000
MAX_WPM = 400  # faster than anyone speaks: the speech timing is not usable
RULES_MAX = 75  # rules alone never give more than this for grammar or comprehension
NOT_MEASURED = "Pronunciation was not measured (no speech-assessment provider), so the band uses fluency, grammar and comprehension."

FILLERS = re.compile(r"\b(?:u+m+|u+h+m*|e+r+m*|h+m+|a+h+)\b", re.I)
FUNCTION_WORDS = set(
    "the a an is are was were am be been i you he she it we they my your our their me him her us them to of in on at for "
    "with and or but so because if when that this these those have has had do does did not no can will would could should "
    "there what which who how very also then from by as".split()
)
# a few slips that are wrong in any variety of English (Indian-English usage is not in this list on purpose)
SLIPS = [re.compile(p, re.I) for p in (
    r"\bi is\b", r"\bi has\b", r"\b(?:he|she|it) (?:have|do not|don't)\b", r"\b(?:they|we|you) was\b", r"\b(?:he|she) are\b",
    r"\bmore (?:better|easier|faster|bigger|good)\b", r"\bmost (?:best|easiest)\b", r"\bdid (?:went|came|saw|did|told|gave)\b",
    r"\bdidn't (?:went|came|saw|told|gave)\b", r"\bcan able to\b", r"\bpeoples are\b",
)]  # fmt: skip
STOP = set(
    "that this with from have your what when then they them their there were will would could should about which while "
    "into also only just more most some such than very each other been being does done make made using used like over "
    "after before because here where these those first need want know think much many well good really tell describe "
    "explain give example time role work".split()
)


def clamp(v: float, lo: int = 0, hi: int = 100) -> int:
    return int(max(lo, min(hi, round(v))))


def words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z']+|\d+", text or "")


def is_english(text: str) -> bool:
    """Latin letters (85 % or more) and enough English function words: a Hindi / Telugu answer (in its script or
    romanised) is left out of the score, never marked down."""
    letters = re.findall(r"[^\W\d_]", text or "")
    if len(letters) < 8:
        return False
    if sum(1 for c in letters if c.isascii()) < 0.85 * len(letters):
        return False
    w = [x.lower() for x in words(text)]
    return len(w) >= 3 and sum(1 for x in w if x in FUNCTION_WORDS) >= 0.15 * len(w)


# --- band ------------------------------------------------------------------------------------------------------------


def band_of(overall: int | None) -> str | None:
    if overall is None:
        return None
    got = BANDS[0][0]
    for b, lo in BANDS:
        if overall >= lo:
            got = b
    return got


def band_rank(b: str | None) -> int:
    return BAND_KEYS.index(b) if b in BAND_KEYS else -1


def at_least(b: str | None, minimum: str) -> bool:
    return band_rank(b) >= band_rank(minimum) >= 0


def overall_of(subs: dict[str, int | None]) -> int | None:
    vals = [v for k, v in subs.items() if k in SUBS and v is not None]
    if any(subs.get(k) is None for k in ("fluency", "grammar", "comprehension")):
        return None
    return clamp(sum(vals) / len(vals)) if vals else None


# --- fluency (timing) --------------------------------------------------------------------------------------------------

WPM_POINTS = ((0, 0), (40, 20), (80, 60), (110, 100), (160, 100), (200, 80), (260, 60), (10_000, 60))


def wpm_score(wpm: float) -> int:
    for (x0, y0), (x1, y1) in zip(WPM_POINTS, WPM_POINTS[1:], strict=False):
        if x0 <= wpm <= x1:
            return clamp(y0 + (y1 - y0) * (wpm - x0) / (x1 - x0))
    return 60


def fluency(answers: list[dict[str, Any]]) -> dict[str, Any]:
    """answers: [{text, seconds, speech_ms?, pauses?}] (English ones). → {score, wpm, pausesPerMin, fillersPer100,
    minutes, timing: "speech" (browser speech events) | "answer" (the whole answer time)}."""
    n_words = sum(len(words(a["text"])) for a in answers)
    ms = 0.0
    from_speech = True
    for a in answers:
        sp = float(a.get("speech_ms") or 0)
        if sp > 0 and len(words(a["text"])) / (sp / 60_000) > MAX_WPM:
            sp = 0  # speech events that came in one burst can't be timed: use the whole answer time
        if sp <= 0:
            from_speech = False
            sp = float(a.get("seconds") or 0) * 1000
        ms += max(sp, 1000.0)
    minutes = ms / 60_000 if ms else 0
    wpm = n_words / minutes if minutes else 0
    pauses = sum(int(a.get("pauses") or 0) for a in answers)
    fillers = sum(len(FILLERS.findall(a["text"])) for a in answers)
    ppm = pauses / minutes if minutes else 0
    f100 = fillers * 100 / n_words if n_words else 0
    pen = min(40, max(0.0, ppm - 2) * 6) + min(30, max(0.0, f100 - 2) * 4)
    return {"score": clamp(wpm_score(wpm) - pen), "wpm": round(wpm), "pausesPerMin": round(ppm, 1),
            "fillersPer100": round(f100, 1), "minutes": round(minutes, 1), "timing": "speech" if from_speech else "answer"}  # fmt: skip


# --- rules fallbacks (no AI) -------------------------------------------------------------------------------------------


def slips(text: str) -> int:
    return sum(len(p.findall(text or "")) for p in SLIPS) + len(re.findall(r"\b(\w{3,}) \1\b", text or "", re.I))


def rules_grammar(answers: list[dict[str, Any]]) -> int:
    n = sum(len(words(a["text"])) for a in answers)
    if not n:
        return 0
    per100 = sum(slips(a["text"]) for a in answers) * 100 / n
    avg = n / len(answers)
    short = 15 if avg < 12 else 0
    return clamp(85 - per100 * 12 - short, 0, RULES_MAX)


def content(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{4,}", (text or "").lower()) if w not in STOP}


def rules_comprehension_one(question: str, looks_for: str, answer: str) -> int:
    n = len(words(answer))
    if n < 5:
        return 10
    shared = content(question + " " + looks_for) & content(answer)
    if shared:
        return clamp(55 + 10 * min(len(shared), 2), 0, RULES_MAX)
    return 45 if n >= 15 else 30


def rules_comprehension(answers: list[dict[str, Any]]) -> int:
    vals = [rules_comprehension_one(a.get("q", ""), a.get("looks_for", ""), a["text"]) for a in answers]
    return clamp(sum(vals) / len(vals)) if vals else 0


# --- pronunciation (provider) -----------------------------------------------------------------------------------------


def pronunciation(accuracies: list[float]) -> int | None:
    """Intelligibility from the provider's accuracy scores (0–100 each): 80 or more counts as fully clear."""
    vals = [float(a) for a in accuracies if a is not None]
    if not vals:
        return None
    return clamp(sum(vals) / len(vals) * 100 / INTELLIGIBLE)


def enough(answers: list[dict[str, Any]]) -> bool:
    return len(answers) >= MIN_ANSWERS and sum(len(words(a["text"])) for a in answers) >= MIN_WORDS
