"""H4 Reliability (Phase 5): how dependable a candidate has been, from real events only, in plain words.

  GET /api/me/hire/reliability      my own score, what it is made of, and how to improve it

What counts (nothing else, and never a guess):
  invites      answered within `reply_hours` (Admin → Settings, 24): good · answered later: a little less good ·
               not answered before it expired (7 days): counts against. Saying "Not interested" is fine: replying is
               what counts, not the answer.
  interviews   came (marked Attended by the company): good · No-show: counts against (H5)
  offers       accepted then joined: good · accepted then dropped out: counts against · declining is fine (H6)
Someone with no events is "New - no history yet": no score and never ranked lower for it. Companies see the label, the
score and the plain lines, never which company marked a no-show (events keep the company only for the audit trail).
"""

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter

from app.auth.deps import CustomerAuth
from app.core.db import DB, HIRE_EVENTS, HIRE_INVITES
from app.core.time import now
from app.site import get_site

router = APIRouter(prefix="/api/me/hire", tags=["hire in 30 minutes"])

INVITE_DAYS = 7  # the same as an invite's life (shortlist.INVITE_DAYS)
# event kind → (points for, points against)
WEIGHTS = {
    "reply_fast": (1.0, 0.0),
    "reply_slow": (0.5, 0.0),
    "no_reply": (0.0, 1.0),
    "attended": (2.0, 0.0),
    "no_show": (0.0, 3.0),
    "joined": (3.0, 0.0),
    "dropped": (0.0, 3.0),
}
NEW = "New - no history yet"


async def record(db, user_id: str, kind: str, company_id: str, ref: str, t: datetime | None = None) -> None:
    """One real event (H5 attended / no_show, H6 joined / dropped). Once per (kind, ref): marking twice is one event."""
    assert kind in WEIGHTS, kind
    await db[HIRE_EVENTS].update_one(
        {"user_id": user_id, "kind": kind, "ref": ref},
        {"$setOnInsert": {"company_id": company_id, "at": t or now()}},
        upsert=True,
    )


async def forget(db, user_id: str, kind: str, ref: str) -> None:
    """A mark taken back (the company corrected Attended / No-show)."""
    await db[HIRE_EVENTS].delete_one({"user_id": user_id, "kind": kind, "ref": ref})


def invite_kinds(invites: list[dict[str, Any]], reply_hours: int, t: datetime) -> list[str]:
    out = []
    for i in invites:
        if i.get("answered_at"):
            fast = i["answered_at"] - i["created_at"] <= timedelta(hours=reply_hours)
            out.append("reply_fast" if fast else "reply_slow")
        elif i.get("status") == "sent" and i["created_at"] < t - timedelta(days=INVITE_DAYS):
            out.append("no_reply")
    return out


def score(kinds: list[str], reply_hours: int = 24) -> dict[str, Any]:
    """{label, score (0-100 or None), lines (plain words), tips}."""
    if not kinds:
        return {"label": NEW, "score": None, "lines": [], "tips": [
            "Reply to invites within a day, even to say Not interested.",
            "Go to every interview you pick, or reschedule early.",
        ]}  # fmt: skip
    good = sum(WEIGHTS[k][0] for k in kinds)
    bad = sum(WEIGHTS[k][1] for k in kinds)
    pct = round(100 * good / (good + bad)) if good + bad else 100
    label = "Very reliable" if pct >= 85 else "Reliable" if pct >= 65 else "Mixed record"
    n = {k: kinds.count(k) for k in WEIGHTS}
    lines, tips = [], []
    invites = n["reply_fast"] + n["reply_slow"] + n["no_reply"]
    if invites:
        lines.append(f"Replied to {n['reply_fast']} of {invites} invites within {reply_hours} hours")
        if n["no_reply"]:
            tips.append("Answer every invite, even with Not interested: an unanswered invite counts against you.")
        elif n["reply_slow"]:
            tips.append(f"Reply within {reply_hours} hours to score higher.")
    interviews = n["attended"] + n["no_show"]
    if interviews:
        lines.append(f"Came to {n['attended']} of {interviews} interviews")
        if n["no_show"]:
            tips.append("Can't make an interview? Reschedule or cancel it with a reason before it starts.")
    offers = n["joined"] + n["dropped"]
    if offers:
        lines.append(f"Joined {n['joined']} of {offers} accepted offers")
        if n["dropped"]:
            tips.append("Accept an offer only when you mean to join; if plans change, tell the company early.")
    if not tips:
        tips.append("Keep it up: reply quickly and keep the interviews you pick.")
    return {"label": label, "score": pct, "lines": lines, "tips": tips}


async def reliability_for(db, user_ids: list[str], t: datetime | None = None) -> dict[str, dict[str, Any]]:
    """{user: score(...)} for many people at once (the shortlist)."""
    t = t or now()
    hours = int((await get_site(db))["hire"].get("reply_hours", 24))
    kinds: dict[str, list[str]] = {u: [] for u in user_ids}
    invites: dict[str, list[dict[str, Any]]] = {}
    async for i in db[HIRE_INVITES].find({"user_id": {"$in": user_ids}}, {"user_id": 1, "status": 1, "created_at": 1,
                                                                          "answered_at": 1}):  # fmt: skip
        invites.setdefault(i["user_id"], []).append(i)
    for u, rows in invites.items():
        kinds[u] += invite_kinds(rows, hours, t)
    async for e in db[HIRE_EVENTS].find({"user_id": {"$in": user_ids}}, {"user_id": 1, "kind": 1}):
        if e["kind"] in WEIGHTS:
            kinds[e["user_id"]].append(e["kind"])
    return {u: score(k, hours) for u, k in kinds.items()}


@router.get("/reliability")
async def mine(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return (await reliability_for(db, [auth.user.id]))[auth.user.id]
