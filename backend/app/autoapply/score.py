"""Auto Apply 2.0 match score (0–100), in explainable parts, built on the job board's own fit (app/jobs/fit.py: the
same skills found / missing, the same experience and place rules), never a second scorer:

    skills      40   the job's skills found on the resume (fit.found / fit.missing)
    experience  20   the job's level against the resume's years (fit's own experience rule)
    city        10   remote (when the candidate takes remote) or one of their cities
    salary      10   the job's pay against their minimum salary (no minimum: full marks; pay not stated: 6)
    vetting     10   their vetting level (users.vetting.level, the vetting engine's ladder L0–L4)
    freshness   10   how new the post is (3 days: full marks, then less)
  − learning         repeated rejections for this kind of role (app/autoapply/learning.py), at most 15

70+ may be applied to automatically, 55–69 is "Suggested for you", below is skipped (Admin can change both).
Fair matching: only the job, the resume's skills / years / city, the candidate's own rules and their vetting level go
in. Never gender, religion, caste, age, a photo or a name.
"""

from datetime import datetime
from typing import Any

from app.autoapply.learning import role_type
from app.core.time import now
from app.jobs import fit as fitmod

WEIGHTS = {"skills": 40, "experience": 20, "city": 10, "salary": 10, "vetting": 10, "freshness": 10}
VETTING_SHARE = {0: 0.3, 1: 0.5, 2: 0.8, 3: 0.9, 4: 1.0}
LABELS = {
    "skills": "Skills",
    "experience": "Experience",
    "city": "City",
    "salary": "Salary",
    "vetting": "Vetting level",
    "freshness": "Freshness",
}
# never read by the score (and never sent to the AI): the fair-matching rule
NOT_USED = ("gender", "religion", "caste", "age", "dob", "dateOfBirth", "photo", "photoUrl", "marital", "maritalStatus")


def _yearly(sal: dict[str, Any] | None) -> int | None:
    if not sal:
        return None
    best = sal.get("max") or sal.get("min")
    if not best:
        return None
    return int(best) * (12 if sal.get("period") == "monthly" else 1)


def _city(job: dict[str, Any], a: dict[str, Any], f: dict[str, Any]) -> tuple[float, str]:
    if job.get("remote") and a.get("remote", True):
        return 1.0, "Remote, as you allow"
    cities = [c.lower() for c in a.get("cities") or []]
    for loc in job.get("locations") or []:
        if any(loc.lower().startswith(c) for c in cities):
            return 1.0, f"In {loc}, one of your cities"
    if f.get("place") == "city":
        return 1.0, f"In {f.get('city') or 'your city'}"
    if f.get("place") == "unknown" or (not cities and not job.get("locations")):
        return 0.5, "City not clear"
    return 0.0, "Not in your cities"


def _salary(job: dict[str, Any], a: dict[str, Any]) -> tuple[float, str]:
    want = a.get("min_salary")
    y = _yearly(job.get("salary"))
    if not want:
        return 1.0, "No minimum salary set"
    if y is None:
        return 0.6, "Pay not stated"
    if y >= want:
        return 1.0, f"Pays ₹{y / 100000:.1f} lakh a year, above your minimum"
    return 0.0, "Pays below your minimum"


def _fresh(job: dict[str, Any], t: datetime) -> tuple[float, str]:
    posted = job.get("posted_at") or job.get("created_at")
    if not posted:
        return 0.5, "Post date not known"
    days = max(0, (t - posted).days)
    for limit, share in ((3, 1.0), (7, 0.8), (14, 0.5), (30, 0.3)):
        if days <= limit:
            return share, "Posted today" if days == 0 else f"Posted {days} day{'s' if days != 1 else ''} ago"
    return 0.1, f"Posted {days} days ago"


def parts(
    job: dict[str, Any],
    f: dict[str, Any],
    a: dict[str, Any],
    vetting_level: int = 0,
    penalties: dict[str, dict[str, Any]] | None = None,
    t: datetime | None = None,
) -> dict[str, Any]:
    """{score, parts: {name: {points, max, note}}, reasons: [top 3 plain lines], concerns: [...], penalty, roleType}.
    `f` is fit.fit(job, person) (the job board's fit for this resume)."""
    t = t or now()
    wanted = len(f.get("found") or []) + len(f.get("missing") or [])
    found = f.get("found") or []
    skills = (
        (len(found) / wanted if wanted else 0.5),
        (
            f"Matches {len(found)} of {wanted} skills" + (f" ({', '.join(found[:3])})" if found else "")
            if wanted
            else "The job lists no skills"
        ),
    )
    exp_share, exp = fitmod._experience(f.get("level") or job.get("experience") or "", float(f.get("years") or 0))
    exp_note = {
        "ok": "Your experience fits",
        "near": "Your experience is close",
        "far": "Asks for more experience",
        "over": "You have more experience than it asks",
        "unknown": "Experience not stated",
    }[exp]
    level = max(0, min(4, int(vetting_level or 0)))
    shares = {
        "skills": skills,
        "experience": (exp_share, exp_note),
        "city": _city(job, a, f),
        "salary": _salary(job, a),
        "vetting": (VETTING_SHARE[level], f"Vetting level L{level}"),
        "freshness": _fresh(job, t),
    }
    out = {k: {"points": round(s * WEIGHTS[k]), "max": WEIGHTS[k], "note": note} for k, (s, note) in shares.items()}
    rt = role_type(job.get("title") or "")
    pen = int(((penalties or {}).get(rt) or {}).get("penalty") or 0)
    total = max(0, min(100, sum(p["points"] for p in out.values()) - pen))
    ranked = sorted(out.items(), key=lambda kv: -(kv[1]["points"] / kv[1]["max"]))
    reasons = [p["note"] for _, p in ranked if p["points"] / p["max"] >= 0.75][:3]
    concerns = [p["note"] for _, p in reversed(ranked) if p["points"] / p["max"] < 0.5][:2]
    if pen:
        concerns.insert(0, f"{pen} points lower: earlier rejections for {rt} roles")
    return {"score": total, "parts": out, "reasons": reasons, "concerns": concerns, "penalty": pen, "roleType": rt}


def thresholds(site: dict[str, Any], a: dict[str, Any] | None = None) -> tuple[int, int]:
    """(auto, suggest): the candidate may ask for a stricter auto threshold (their minimum score), never looser."""
    v2 = site["auto_apply_v2"]
    auto = max(int(v2["auto_min"]), int((a or {}).get("min_score") or 0))
    return auto, min(int(v2["suggest_min"]), auto)


def band(score: int, site: dict[str, Any], a: dict[str, Any] | None = None) -> str:
    """auto (may be applied to) · suggest ("Suggested for you") · skip."""
    auto, suggest = thresholds(site, a)
    return "auto" if score >= auto else "suggest" if score >= suggest else "skip"
