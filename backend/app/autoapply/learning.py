"""Auto Apply 2.0 learning: repeated rejections for one kind of role lower its priority.

The rule, in one sentence the candidate sees: "2 or more rejections for the same kind of role in the last 90 days
lower that role's match score by 5 points for each rejection after the first (at most 15)". A role kind is the job
title without level words ("Junior Data Analyst" and "Data Analyst Trainee" are both "data analyst"). Nothing else
is learned, and nothing about the person (only their own application results) is used.
"""

import re
from datetime import timedelta
from typing import Any

from app.core.db import APPLICATIONS
from app.core.time import now

WINDOW = timedelta(days=90)
FROM = 2  # rejections before the priority goes down
STEP = 5  # points per rejection from the second one
MAX = 15
LEVEL_WORDS = {
    "junior", "jr", "senior", "sr", "lead", "trainee", "intern", "internship", "fresher", "freshers", "associate",
    "entry", "level", "graduate", "i", "ii", "iii", "iv", "remote", "hybrid", "onsite", "urgent", "hiring", "the",
    "a", "an", "for", "and", "of", "with", "in", "at",
}  # fmt: skip


def role_type(title: str) -> str:
    """'Junior Data Analyst (Remote)' → 'data analyst'."""
    words = re.findall(r"[a-z0-9+#.]+", str(title or "").lower())
    kept = [w.strip(".") for w in words if w.strip(".") and w.strip(".") not in LEVEL_WORDS and not w.isdigit()]
    return " ".join(kept[:4]) or str(title or "").strip().lower()[:40]


def penalty_for(n: int) -> int:
    return 0 if n < FROM else min(MAX, STEP * (n - FROM + 1))


async def penalties(db, uid: str) -> dict[str, dict[str, Any]]:
    """role kind → {rejections, penalty} for the kinds that lost priority (only those)."""
    counts: dict[str, int] = {}
    q = {"user_id": uid, "status": "rejected", "updated_at": {"$gte": now() - WINDOW}}
    async for a in db[APPLICATIONS].find(q, {"role": 1}):
        k = role_type(a.get("role") or "")
        counts[k] = counts.get(k, 0) + 1
    return {k: {"rejections": n, "penalty": penalty_for(n)} for k, n in counts.items() if penalty_for(n)}


def explain(pen: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """For the candidate page: one plain line per role kind with lower priority."""
    return [
        {
            "role": k,
            "rejections": v["rejections"],
            "penalty": v["penalty"],
            "text": f"{k.capitalize()}: {v['rejections']} rejections in 90 days, so these jobs rank "
            f"{v['penalty']} points lower.",
        }
        for k, v in sorted(pen.items(), key=lambda x: -x[1]["penalty"])
    ]
