# ruff: noqa: E501  (dense response shapes)
"""Vetting Trust T15 in Hire now (app/hire/shortlist.py calls `attach` and `apply_filters` only where the Trust switch
lets the company in):

  workTests            the person's work-test badges, good news only: {"typing": {label: "Typing 35 wpm+ (Hindi)", wpm,
                       accuracy, lang}, "sjt": {label: "SJT: strong"}, "aptitude": {label: "Aptitude: top 30%"}}, each
                       "source": "Nm7 … test"
  reliabilityRecord    "Showed up 4/4 · Joined 2/2 · Stayed 90 days 1/1" with "confirmed by employers", or "No history
                       yet", only for people who agreed to show it (others: nothing at all)

Filters (combined with AND, like T6): typing (25 / 35 / 45 wpm+ with 90% accuracy, any language), sjt (good = good or
strong; strong), aptitude (top 50 / 30 / 10%). `counts` says how many people each would leave. There is no filter on the
reliability record: it can't hide anyone, and "No history yet" can never be filtered out.
"""

from typing import Any

from app.trust.reliability import service as REL
from app.trust.worktests import service as WT

FILTER_KEYS = ("typing", "sjt", "aptitude")
TYPING_STEPS = (25, 35, 45)
SJT_RANK = {"good": 1, "strong": 2}
TOP_RANK = {"top50": 1, "top30": 2, "top10": 3}
PROBE = {"typing": 25, "sjt": "good", "aptitude": "top50"}


async def attach(db, rows: list[dict[str, Any]]) -> None:
    uids = [r["key"] for r in rows]
    if not uids:
        return
    badges = await WT.badges_for(db, uids)
    rel = await REL.for_hire(db, uids)
    for r in rows:
        r["workTests"] = badges.get(r["key"]) or {}
        r["reliabilityRecord"] = rel.get(r["key"])  # None: the person didn't agree to show it


def keep(w: dict[str, Any], f: dict[str, Any], skip: str = "") -> bool:
    for k in FILTER_KEYS:
        v = f.get(k)
        if k == skip or v in (None, "", 0):
            continue
        if k == "typing" and int((w.get("typing") or {}).get("step") or 0) < int(v):
            return False
        if k == "sjt" and SJT_RANK.get((w.get("sjt") or {}).get("level"), 0) < SJT_RANK.get(str(v), 9):
            return False
        if k == "aptitude" and TOP_RANK.get((w.get("aptitude") or {}).get("top"), 0) < TOP_RANK.get(str(v), 9):
            return False
    return True


def apply_filters(rows: list[dict[str, Any]], f: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    counts = {
        k: sum(1 for r in rows if keep(r.get("workTests") or {}, {**f, k: f.get(k) or PROBE[k]})) for k in FILTER_KEYS
    }
    return [r for r in rows if keep(r.get("workTests") or {}, f)], counts
