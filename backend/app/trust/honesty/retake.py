# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T9: retake limits people can see, enforced the same way on the server.

The rule (the existing V2 / V3 cooldown, generalised): at most ATTEMPTS starts per role in any DAYS-day window. A start
is any attempt started for that role (a full test, a refresher, a free retest; for the interview, any interview). When
the window is full, the next attempt opens DAYS days after the ATTEMPTS-th most recent start. With the defaults (1 every
30 days) this is exactly the old rule "one try per role every 30 days, from when the last one started".

  - a free retest offered after "needs retest" can always be started (as before);
  - a test or interview that is still running can always be carried on (as before);
  - the V5 badge refresher (8 questions) bypassed the cooldown and could be retried at once after a fail, again and
    again; for people Vetting Trust is on for it now waits REFRESH_DAYS days after the last refresher (gap fixed).
What counts: the skill check badge comes from the latest passed attempt (a later attempt that doesn't pass doesn't take
it away; it lasts until its end date); for the interview the latest passed one counts for 180 days, same idea.

Admin → Skill checks → Vetting Trust → Honesty and retakes can change the numbers within BOUNDS. They apply to people
Vetting Trust is on for; everyone else keeps the engine's own rule (1 every 30 days) while the switch is off.
"""

from datetime import datetime, timedelta
from typing import Any

from app.core.db import SKILL_ATTEMPTS, VETTING_INTERVIEWS
from app.me.service import ms

DEFAULTS: dict[str, Any] = {
    "skill_attempts": 1,
    "skill_days": 30,
    "interview_attempts": 1,
    "interview_days": 30,
    "refresh_days": 7,
    "explain_on": True,
    "explain_questions": 1,
}
BOUNDS: dict[str, tuple[int, int]] = {
    "skill_attempts": (1, 3),
    "skill_days": (7, 90),
    "interview_attempts": (1, 3),
    "interview_days": (7, 90),
    "refresh_days": (1, 30),
    "explain_questions": (1, 2),
}
COUNTS = {
    "skill": "Your badge comes from your latest passed attempt (the test and its practical task). A later attempt that doesn’t pass doesn’t take it away: it lasts until its end date.",
    "interview": "Your latest passed interview counts, for 180 days. A later one that doesn’t pass doesn’t take it away.",
}


def settings_of(site: dict[str, Any]) -> dict[str, Any]:
    st = (site.get("trust") or {}).get("honesty") or {}
    out = {**DEFAULTS, **{k: v for k, v in st.items() if k in DEFAULTS}}
    for k, (lo, hi) in BOUNDS.items():
        try:
            out[k] = max(lo, min(hi, int(out[k])))
        except (TypeError, ValueError):
            out[k] = DEFAULTS[k]
    out["explain_on"] = bool(out["explain_on"])
    return out


def engine_rule(kind: str) -> tuple[int, int]:
    """The engine's own rule (everyone while the switch is off)."""
    if kind == "interview":
        from app.hire.vetting.interview import RETAKE
    else:
        from app.hire.vetting.engine import RETAKE
    return 1, RETAKE.days


async def policy(db, uid: str, kind: str) -> dict[str, Any]:
    """{attempts, days, refreshDays, trust}: the Admin numbers for people Vetting Trust is on for, else the engine's rule."""
    from app.site import get_site
    from app.trust import access

    if await access.for_user(db, uid):
        s = settings_of(await get_site(db))
        return {
            "attempts": s[f"{kind}_attempts"],
            "days": s[f"{kind}_days"],
            "refreshDays": s["refresh_days"],
            "trust": True,
        }
    n, d = engine_rule(kind)
    return {"attempts": n, "days": d, "refreshDays": None, "trust": False}


def window(starts: list[datetime], t: datetime, attempts: int, days: int) -> dict[str, Any]:
    """Pure: {used, allowed, nextAt}. `starts` are the role's start times (any order, older ones are ignored)."""
    since = t - timedelta(days=days)
    recent = sorted((s for s in starts if s > since), reverse=True)
    allowed = len(recent) < attempts
    nxt = None if allowed else recent[attempts - 1] + timedelta(days=days)
    return {"used": len(recent), "allowed": allowed, "nextAt": nxt}


def rule_text(attempts: int, days: int) -> str:
    return f"{attempts} attempt{'' if attempts == 1 else 's'} every {days} days"


def out(
    kind: str, pol: dict[str, Any], w: dict[str, Any], *, free: bool = False, running: bool = False
) -> dict[str, Any]:
    can = running or free or w["allowed"]
    return {
        "attempts": pol["attempts"], "days": pol["days"], "rule": rule_text(pol["attempts"], pol["days"]),
        "used": min(w["used"], pol["attempts"]), "left": max(0, pol["attempts"] - w["used"]), "canStart": can,
        "nextAt": None if can else ms(w["nextAt"]), "freeRetest": free, "running": running, "counts": COUNTS[kind],
        **({"refreshDays": pol["refreshDays"]} if kind == "skill" and pol.get("refreshDays") else {}),
    }  # fmt: skip


async def skill_starts(db, uid: str, t: datetime, days: int, skill: str | None = None) -> dict[str, list[datetime]]:
    q: dict[str, Any] = {"user_id": uid, "started_at": {"$gt": t - timedelta(days=days)}}
    if skill:
        q["skill"] = skill
    got: dict[str, list[datetime]] = {}
    async for a in db[SKILL_ATTEMPTS].find(q, {"skill": 1, "started_at": 1}):
        got.setdefault(a["skill"], []).append(a["started_at"])
    return got


async def interview_starts(db, uid: str, t: datetime, days: int, test: str | None = None) -> dict[str, list[datetime]]:
    q: dict[str, Any] = {"user_id": uid, "started_at": {"$gt": t - timedelta(days=days)}}
    if test:
        q["test"] = test
    got: dict[str, list[datetime]] = {}
    async for iv in db[VETTING_INTERVIEWS].find(q, {"test": 1, "started_at": 1}):
        got.setdefault(iv["test"], []).append(iv["started_at"])
    return got


async def skill_status(
    db, uid: str, skill: str, t: datetime, last: dict[str, Any] | None = None, pol: dict[str, Any] | None = None
) -> dict[str, Any]:
    pol = pol or await policy(db, uid, "skill")
    w = window((await skill_starts(db, uid, t, pol["days"], skill)).get(skill, []), t, pol["attempts"], pol["days"])
    free = bool(last and last.get("retest_offered") and not last.get("retest_used"))
    running = bool(last and not last.get("submitted_at"))
    return out("skill", pol, w, free=free, running=running)


async def interview_status(
    db, uid: str, test: str, t: datetime, last: dict[str, Any] | None = None, pol: dict[str, Any] | None = None
) -> dict[str, Any]:
    pol = pol or await policy(db, uid, "interview")
    w = window((await interview_starts(db, uid, t, pol["days"], test)).get(test, []), t, pol["attempts"], pol["days"])
    return out("interview", pol, w, running=bool(last and last.get("status") == "running"))


async def refresh_wait(db, uid: str, skill: str, t: datetime, pol: dict[str, Any]) -> datetime | None:
    """When the next refresher opens (Trust only; None = now): REFRESH_DAYS after the last refresher started."""
    if not pol.get("trust") or not pol.get("refreshDays"):
        return None
    last = await db[SKILL_ATTEMPTS].find_one(
        {"user_id": uid, "skill": skill, "kind": "refresh"}, {"started_at": 1}, sort=[("started_at", -1)]
    )
    if not last:
        return None
    nxt = last["started_at"] + timedelta(days=pol["refreshDays"])
    return nxt if nxt > t else None
