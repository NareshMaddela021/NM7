# ruff: noqa: E501  (dense response shapes)
"""Vetting V1: the level ladder, in ONE rule module. Every place that shows or ranks by level reads it from here.

  L0 Signed up        email verified
  L1 Profile ready    a complete resume (contact, education, skills, a job or project), ATS 60+, and "Ready to join"
                      with expected salary, notice period and a city (or remote)
  L2 Skill verified   a current V2 badge (skill check 70+ AND practical task 60+, not expired)
  L3 Interview-ready  a passed AI screening interview, still valid (V3 adds the input)
  L4 Nm7 verified     a human check + a confirmed reference (V4 adds the input)
  ⚡ Ready to join now  "Ready to join" confirmed in the last 7 days (shown next to any level)

A level needs every level below it (an L2 badge without a ready profile is still L1 until the profile is ready).
Nothing here guesses: missing data means the step isn't done, and the candidate is told exactly what to do next.

The match readiness score (0–100) for one candidate and one job, explainable: skill match 35, level 25,
reliability 15, freshness 10, salary fit 10, distance 5; companies see the top 3 reasons.
"""

from datetime import datetime, timedelta
from typing import Any

LEVELS = {0: "Signed up", 1: "Profile ready", 2: "Skill verified", 3: "Interview-ready", 4: "Nm7 verified"}
READY_DAYS = 7  # ⚡ ready now: confirmed within this
HIDE_DAYS = 21  # not confirmed for this long: hidden from Hire now until they come back
ATS_MIN = 60
WEIGHTS = {"skill": 35, "level": 25, "reliability": 15, "freshness": 10, "salary": 10, "distance": 5}


def inputs_from(user: dict[str, Any], profile: dict[str, Any] | None, resume_score: dict[str, Any] | None,
                badges: list[dict[str, Any]], t: datetime) -> dict[str, Any]:  # fmt: skip
    """The facts the rules use, from stored data only."""
    p = profile or {}
    live = [b for b in badges if b.get("expires_at") and b["expires_at"] > t]
    confirmed = p.get("confirmed_at")
    return {
        "email": bool(user.get("email_verified_at")),
        "resumeComplete": bool(resume_score and resume_score.get("complete")),
        "ats": (resume_score or {}).get("ats"),
        "salary": bool((p.get("salary") or {}).get("amount")),
        "notice": p.get("notice_days") is not None and p.get("on") is not None,
        "city": bool(p.get("cities")) or bool(p.get("remote")),
        "skillVerified": [b["test"] for b in live],
        "interviewReady": bool(user.get("vetting_l3_until") and user["vetting_l3_until"] > t),
        "nm7Verified": bool(user.get("vetting_l4_until") and user["vetting_l4_until"] > t),
        "available": bool(p.get("on") and p.get("consent_at") and not p.get("paused_at")),
        "confirmedDays": (t - confirmed).days if confirmed else None,
    }


def level_of(f: dict[str, Any]) -> dict[str, Any]:
    """{level, label, readyNow, next: [what to do to reach the next level], steps: {name: done}}."""
    steps = {
        "Verify your email": f["email"],
        "Complete your resume (contact, education, skills, a job or project)": f["resumeComplete"],
        f"Raise your ATS score to {ATS_MIN}+": (f["ats"] or 0) >= ATS_MIN,
        "Add your expected salary in Ready to join": f["salary"],
        "Add your notice period in Ready to join": f["notice"],
        "Add a city (or remote) in Ready to join": f["city"],
        "Pass a skill check and its practical task": bool(f["skillVerified"]),
        "Pass the AI screening interview": f["interviewReady"],
        "Get the Nm7 human check and a reference": f["nm7Verified"],
    }
    keys = list(steps)
    rungs = [keys[:1], keys[1:6], keys[6:7], keys[7:8], keys[8:9]]  # what each level from L0 to L4 needs
    level, nxt = -1, []
    for i, need in enumerate(rungs):
        missing = [k for k in need if not steps[k]]
        if missing:
            nxt = missing
            break
        level = i
    level = max(level, 0)  # an account exists: at least "Signed up" (L0 shows "verify your email" as the next step)
    ready = bool(f["available"] and f["confirmedDays"] is not None and f["confirmedDays"] < READY_DAYS)
    return {"level": level, "label": LEVELS[level], "readyNow": ready, "next": nxt, "steps": steps}


def visible(f: dict[str, Any]) -> bool:
    """Shown in Hire now at all: available and confirmed within HIDE_DAYS."""
    return bool(f["available"] and f["confirmedDays"] is not None and f["confirmedDays"] < HIDE_DAYS)


def readiness(*, skill: int, level: int, reliability: int | None, confirmed_days: int | None, salary_fit: str,
              same_city: bool | None, remote: bool = False) -> dict[str, Any]:  # fmt: skip
    """Match readiness 0–100 with its parts. `skill` 0–100 (the job match), `reliability` 0–100 or None (no history:
    counted as neutral, never lower), `salary_fit` within / below / above / unknown, `same_city` True / False / None."""
    parts = {
        "skill": WEIGHTS["skill"] * max(0, min(100, skill)) / 100,
        "level": WEIGHTS["level"] * level / 4,
        "reliability": WEIGHTS["reliability"] * ((reliability if reliability is not None else 70) / 100),
        "freshness": WEIGHTS["freshness"] * (1.0 if confirmed_days is not None and confirmed_days < READY_DAYS
                                             else 0.5 if confirmed_days is not None and confirmed_days < HIDE_DAYS else 0.0),
        "salary": WEIGHTS["salary"] * {"within": 1.0, "below": 1.0, "unknown": 0.5, "above": 0.0}.get(salary_fit, 0.5),
        "distance": WEIGHTS["distance"] * (1.0 if remote or same_city else 0.5 if same_city is None else 0.0),
    }  # fmt: skip
    return {"score": round(sum(parts.values())), "parts": {k: round(v, 1) for k, v in parts.items()}}


def reasons(*, badge: dict[str, Any] | None, ready_now: bool, city: str | None, same_city: bool | None,
            remote: bool, reliability: int | None, level: int, skill: int) -> list[str]:  # fmt: skip
    """The top 3 short reasons a company sees ("Java 82/100 · ready now · in Hyderabad")."""
    out = []
    if badge and not badge.get("expired"):
        out.append(f"{badge['test']} {badge['score']}/100")
    elif skill >= 70:
        out.append(f"{skill}% skill match")
    if ready_now:
        out.append("ready now")
    if same_city and city:
        out.append(f"in {city}")
    elif remote:
        out.append("works remotely")
    if reliability is not None and reliability >= 80:
        out.append(f"reliability {reliability}%")
    if level >= 1 and len(out) < 3:
        out.append(f"L{level} {LEVELS[level]}")
    return out[:3]


def hidden_after(confirmed: datetime | None) -> datetime | None:
    return confirmed + timedelta(days=HIDE_DAYS) if confirmed else None
