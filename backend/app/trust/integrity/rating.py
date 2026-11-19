# ruff: noqa: E501  (the weights table is easier to read on one line per signal)
"""The integrity rating, as pure functions (no database): one plain rating per candidate from every signal Nm7 already
collects, with a weighting anyone can read. No black box, no AI, no score from who the person is.

    rating   Low risk · Medium risk · High risk · Not enough data

How a rating is worked out (also shown to Admin and, in plain words, to the candidate):
  1. Every signal has a WEIGHT (points) and a CAP (the most one kind of signal can ever add, however often it happens).
  2. Old signals count less: the weight halves every HALF_LIFE_DAYS (60) days (a signal from 60 days ago counts half,
     from 120 days ago a quarter); signals older than MAX_AGE_DAYS (365) are not counted at all.
  3. A signal a person at Nm7 CLEARED counts 0. A signal a person CONFIRMED counts CONFIRMED_FACTOR (1.5) × its weight
     and does not fade (a person looked at it), still within its cap.
  4. Points of one kind are added, then capped; the kinds are added for the score.
  5. Score < 3 → Low · 3 to < 6 → Medium · 6 or more → High. No signals and nothing done yet (no skill check, interview,
     document or ID check) → Not enough data.
High never rejects or hides anyone: it sends the person to a human review queue (service.py).
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

HALF_LIFE_DAYS = 60
MAX_AGE_DAYS = 365
CONFIRMED_FACTOR = 1.5
MEDIUM_AT = 3.0
HIGH_AT = 6.0

LEVELS = ("low", "medium", "high", "not_enough_data")
LABELS = {"low": "Low risk", "medium": "Medium risk", "high": "High risk", "not_enough_data": "Not enough data"}
PLAIN = {
    "low": "Nothing in your tests or checks needs a closer look.",
    "medium": "A few things were noticed. Nothing is decided by this, and it fades with time.",
    "high": "A few things were noticed, so a person at Nm7 is looking at them. Nothing is decided automatically, and you can explain.",
    "not_enough_data": "You haven’t taken a skill check, an interview or an ID check yet, so there is nothing to rate.",
}
STATUSES = ("open", "cleared", "confirmed")
STATUS_TEXT = {"open": "Open", "cleared": "Cleared by a person", "confirmed": "Confirmed by a person"}


@dataclass(frozen=True)
class Kind:
    weight: float
    cap: float
    label: str  # for Admin
    plain: str  # for the candidate (never names another person, a device or an address)
    source: str  # where it comes from (V2 test, V3 interview, V5 fraud scan, T2 documents, T3 face, T8 snapshots)


KINDS: dict[str, Kind] = {
    # V2 skill check: integrity events on the test and its practical task
    "tab_away": Kind(1.0, 2.0, "Left the test page often", "You left the test page many times.", "V2 test"),
    "time_away": Kind(
        1.0,
        2.0,
        "Away from the test page for long (focus lost)",
        "You were away from the test page for a long time.",
        "V2 test",
    ),
    "copy": Kind(0.5, 1.0, "Copied text from the test", "Text was copied from the test.", "V2 test"),
    "paste": Kind(1.5, 3.0, "Pasted text into an answer", "Text was pasted into an answer.", "V2 test"),
    "devtools": Kind(
        0.5,
        1.0,
        "Opened developer tools or right-click menus",
        "Developer tools or right-click menus were opened.",
        "V2 test",
    ),
    "too_fast": Kind(
        1.5,
        3.0,
        "Impossible speed: answered faster than the questions can be read",
        "Some answers came faster than the questions can be read.",
        "V2 test",
    ),
    "same_position": Kind(
        1.0,
        2.0,
        "Picked the same answer position almost every time",
        "The same answer position was picked almost every time.",
        "V2 test",
    ),
    "pattern_match": Kind(
        3.0,
        4.0,
        "Answer similarity: same wrong answers in the same order as another account",
        "Your answers were very similar to another person’s.",
        "V2 test",
    ),
    "text_match": Kind(
        3.0,
        4.0,
        "Practical task text nearly the same as another account's",
        "Your practical task text was nearly the same as another person’s.",
        "V2 test",
    ),
    "shared_device": Kind(
        2.0,
        4.0,
        "Same device or network as another account taking this test",
        "The test was taken on a device another account also used.",
        "V2 test",
    ),
    "resume_mismatch": Kind(
        0.5,
        1.0,
        "Experience claimed doesn't match easy-question results",
        "The easy questions went differently from the experience on your resume.",
        "V2 test",
    ),
    "pauses": Kind(0.5, 1.0, "Paused the test more than allowed", "The test was paused more than allowed.", "V2 test"),
    # V3 AI interview
    "iv_paste": Kind(
        1.5,
        3.0,
        "Tried to paste answers in the AI interview (3+ times)",
        "Pasting was tried several times in the AI interview.",
        "V3 interview",
    ),
    "iv_away": Kind(
        1.0,
        2.0,
        "Left the AI interview page often or for long",
        "You left the AI interview page often or for a long time.",
        "V3 interview",
    ),
    # T9 "Explain your answer" in the AI interview: the answer about their own practical task didn't match it
    "explain_weak": Kind(
        1.0,
        2.0,
        "Explained own work: weak (the interview answer about their own practical task didn't match it)",
        "In the AI interview, your answer about your own practical task didn’t match what you sent.",
        "T9 interview",
    ),
    # V5 daily fraud scan
    "fraud_phone": Kind(
        2.0,
        2.0,
        "Same phone number on several accounts",
        "Your phone number is on more than one account.",
        "V5 fraud scan",
    ),
    "fraud_device": Kind(
        2.5,
        4.0,
        "Same device on several accounts",
        "Skill checks on more than one account were taken on the same device.",
        "V5 fraud scan",
    ),
    "fraud_resume": Kind(
        3.0,
        3.0,
        "Duplicate resume: nearly identical resumes on different accounts",
        "Your resume is nearly the same as one on another account.",
        "V5 fraud scan",
    ),
    "fraud_dates": Kind(
        1.0, 1.0, "Resume dates that can't be true", "Some dates on your resume can’t all be true.", "V5 fraud scan"
    ),
    "fraud_copied": Kind(
        3.0, 4.0, "Copied answers across accounts", "Answers were copied between accounts.", "V5 fraud scan"
    ),
    "fraud_other": Kind(1.0, 2.0, "Other account check", "An account check needs a closer look.", "V5 fraud scan"),
    # T2 DigiLocker documents
    "doc_name": Kind(
        1.0,
        2.0,
        "Name on a DigiLocker document differs from the profile",
        "The name on a document is different from your profile name.",
        "T2 documents",
    ),
    "doc_pan_dup": Kind(
        4.0,
        4.0,
        "Duplicate PAN: the same PAN is verified on another account",
        "This PAN is already verified on another Nm7 account.",
        "T2 documents",
    ),
    # T3 ID + selfie
    "selfie_failed": Kind(
        2.5,
        2.5,
        "ID + selfie check didn't pass after all tries (liveness or ID match)",
        "The ID + selfie check didn’t pass after all tries.",
        "T3 face",
    ),
    "joining_not_same": Kind(
        5.0,
        5.0,
        "Joining-day selfie: not the same person as the earlier check",
        "The joining-day selfie didn’t match your earlier check.",
        "T3 face",
    ),
    # T8 webcam snapshots (only with the separate consent)
    "snap_no_face": Kind(
        0.5, 1.5, "Webcam snapshot: no face in the photo", "No face could be seen in a webcam photo.", "T8 snapshots"
    ),
    "snap_many_faces": Kind(
        1.5, 3.0, "Webcam snapshot: more than one face", "More than one face was in a webcam photo.", "T8 snapshots"
    ),
    "snap_other_person": Kind(
        3.0,
        4.0,
        "Webcam snapshot: not the same person as the ID + selfie check",
        "A webcam photo didn’t look like the person from your ID check.",
        "T8 snapshots",
    ),
    # T14 coding tasks (from the editor's counters / replay; a person watches the replay before deciding anything)
    "code_big_paste": Kind(
        1.5,
        3.0,
        "Coding task: a large block of code was pasted into the editor",
        "A large block of code was pasted into the code editor in your coding task.",
        "T14 coding",
    ),
    "code_no_typing": Kind(
        2.0,
        2.0,
        "Coding task: the solution appeared with almost no typing",
        "Your coding task’s solution was written with almost no typing in the editor.",
        "T14 coding",
    ),
}


@dataclass
class Signal:
    key: str  # stable id (the human decision is stored under it)
    kind: str  # a KINDS key
    at: datetime
    where: str  # "Skill check: SQL", "AI interview: SQL", "DigiLocker: PAN card", …
    source_status: str = "open"  # from the source (a V5 decision, a T2 / T3 review, an upheld appeal)
    status: str = "open"  # after a T8 human decision (open / cleared / confirmed)
    detail: str = ""  # Admin only (may mention other accounts); never shown to the candidate or a company
    ref: dict[str, Any] = field(default_factory=dict)  # e.g. {"attempt": id} for the V5 appeal link
    by: str = ""  # who decided ("Nm7 review", "V5 fraud review", "appeal", …)
    weight: float = 0.0  # the counted points (filled by score())
    base: float = 0.0  # the kind's weight


def _aware(v: datetime) -> datetime:
    return v if v.tzinfo else v.replace(tzinfo=UTC)


def decay(age_days: float) -> float:
    """1 today, ½ after HALF_LIFE_DAYS, ¼ after twice that; 0 past MAX_AGE_DAYS."""
    if age_days > MAX_AGE_DAYS:
        return 0.0
    return 0.5 ** (max(0.0, age_days) / HALF_LIFE_DAYS)


def points(s: Signal, t: datetime) -> float:
    k = KINDS.get(s.kind)
    if not k or s.status == "cleared":
        return 0.0
    if s.status == "confirmed":
        return k.weight * CONFIRMED_FACTOR
    return k.weight * decay((_aware(t) - _aware(s.at)).total_seconds() / 86400)


def level_of(score: float, observations: int, n_signals: int) -> str:
    if observations <= 0 and n_signals == 0:
        return "not_enough_data"
    if score >= HIGH_AT:
        return "high"
    if score >= MEDIUM_AT:
        return "medium"
    return "low"


def score(signals: list[Signal], observations: int, t: datetime) -> dict[str, Any]:
    """{level, label, score, byKind}; fills each signal's `weight` with what it counts after decay and the cap."""
    raw: dict[str, list[tuple[Signal, float]]] = {}
    for s in signals:
        k = KINDS.get(s.kind)
        s.base = k.weight if k else 0.0
        raw.setdefault(s.kind, []).append((s, points(s, t)))
    total = 0.0
    by_kind: dict[str, float] = {}
    for kind, rows in raw.items():
        got = sum(p for _, p in rows)
        cap = KINDS[kind].cap if kind in KINDS else 0.0
        counted = min(got, cap)
        ratio = counted / got if got else 0.0
        for s, p in rows:
            s.weight = round(p * ratio, 2)
        by_kind[kind] = round(counted, 2)
        total += counted
    total = round(total, 2)
    lvl = level_of(total, observations, len([s for s in signals if s.status != "cleared"]))
    return {"level": lvl, "label": LABELS[lvl], "score": total, "byKind": by_kind}


def method() -> dict[str, Any]:
    """The weighting, for the Admin page and the candidate's "How it works" (the same numbers as the code)."""
    return {
        "halfLifeDays": HALF_LIFE_DAYS, "maxAgeDays": MAX_AGE_DAYS, "confirmedFactor": CONFIRMED_FACTOR,
        "mediumAt": MEDIUM_AT, "highAt": HIGH_AT,
        "kinds": [{"kind": k, "label": v.label, "plain": v.plain, "weight": v.weight, "cap": v.cap, "source": v.source} for k, v in KINDS.items()],
    }  # fmt: skip
