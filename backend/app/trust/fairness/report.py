# ruff: noqa: E501  (dense tables)
"""Vetting Trust T12: pass-rate gap checks for the Admin fairness report (counts per group only, never a person).

For each outcome — skill checks (V2 test passed), AI interviews (passed), spoken English (T10 band B1 or higher), Auto
Apply (a company replied) and Hire now (invited by a company) — the rate is computed per group of three coarse
dimensions:
  language   the interview / skill check language (English, Hindi, Telugu); for Auto Apply and Hire now the person's
             chosen site language
  region     an accent proxy: the region of the person's city (South, West, North, East, North-East, Central), coarse
             on purpose and only ever shown aggregated
  city tier  tier 1 / 2 / 3 from a small city list (app/hire/vetting/trust.city_tier)
A group is flagged by the four-fifths rule: its rate is below 80% of the best group's rate in that dimension, when both
have at least `min_n` people (Admin, default 30). Groups smaller than that show "too few to compare" and no numbers, so
nobody can be picked out. Nothing about gender, religion, caste or age is ever collected or used.

A snapshot is saved once a week (`trust_fairness`, _id = ISO week) by the automation pass under the heavy lease, and
Admin can run one now. Each outcome reads at most CAP rows (memory-safe on the 512 MB server).
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from app.core.db import (
    AUTO_ITEMS,
    HIRE_INVITES,
    HIRE_PROFILES,
    RESUMES,
    SKILL_ATTEMPTS,
    TRUST_FAIRNESS,
    TRUST_FAIRNESS_EVENTS,
    TRUST_SPOKEN,
    USERS,
    VETTING_INTERVIEWS,
)
from app.core.time import IST, now
from app.hire.vetting import engine as E
from app.hire.vetting.trust import city_tier

log = logging.getLogger("nm7.trust.fairness")

CAP = 20000
FOUR_FIFTHS = 0.8
DEFAULTS = {"min_n": 30, "days": 90}
BOUNDS = {"min_n": (10, 500), "days": (14, 365)}
DIMENSIONS = {"language": "Interview language", "region": "Region (accent proxy)", "tier": "City tier"}
METRICS = {
    "skill": ("Skill checks", "passed the skill check test"),
    "interview": ("AI interviews", "passed the interview"),
    "spoken": ("Spoken English (T10)", "got B1 or higher"),
    "autoapply": ("Auto Apply", "got a reply from the company"),
    "hire": ("Hire now", "were invited by a company"),
}
LANG = {"en": "English", "hi": "Hindi", "te": "Telugu"}
SPOKEN_OK = {"B1", "B2", "C1", "C2"}
REGIONS: dict[str, tuple[str, ...]] = {
    "South": ("hyderabad", "secunderabad", "bengaluru", "bangalore", "chennai", "kochi", "cochin", "coimbatore", "madurai", "mysuru", "mysore",
              "visakhapatnam", "vizag", "vijayawada", "guntur", "warangal", "tirupati", "nellore", "kurnool", "karimnagar", "thiruvananthapuram",
              "trivandrum", "kozhikode", "calicut", "mangaluru", "mangalore", "hubli", "salem", "tiruchirappalli", "trichy", "puducherry",
              "telangana", "andhra pradesh", "karnataka", "tamil nadu", "kerala"),
    "West": ("mumbai", "pune", "ahmedabad", "surat", "vadodara", "rajkot", "nagpur", "nashik", "thane", "navi mumbai", "goa", "panaji",
             "aurangabad", "jaipur", "jodhpur", "udaipur", "kota", "maharashtra", "gujarat", "rajasthan"),
    "North": ("delhi", "new delhi", "noida", "gurugram", "gurgaon", "faridabad", "ghaziabad", "chandigarh", "lucknow", "kanpur", "agra",
              "varanasi", "prayagraj", "allahabad", "meerut", "dehradun", "amritsar", "ludhiana", "jalandhar", "jammu", "srinagar", "shimla",
              "uttar pradesh", "punjab", "haryana", "uttarakhand", "himachal pradesh"),
    "East": ("kolkata", "howrah", "bhubaneswar", "cuttack", "patna", "ranchi", "jamshedpur", "dhanbad", "gaya", "west bengal", "odisha",
             "bihar", "jharkhand"),
    "North-East": ("guwahati", "shillong", "imphal", "agartala", "aizawl", "kohima", "itanagar", "gangtok", "assam", "meghalaya", "manipur",
                   "tripura", "mizoram", "nagaland", "arunachal pradesh", "sikkim"),
    "Central": ("bhopal", "indore", "gwalior", "jabalpur", "raipur", "bilaspur", "madhya pradesh", "chhattisgarh"),
}  # fmt: skip
_CITY_REGION = {c: r for r, cs in REGIONS.items() for c in cs}


def settings_of(site: dict[str, Any]) -> dict[str, int]:
    st = ((site.get("trust") or {}).get("fairness") or {}).get("report") or {}
    out = {}
    for k, d in DEFAULTS.items():
        lo, hi = BOUNDS[k]
        try:
            out[k] = max(lo, min(hi, int(st.get(k, d))))
        except (TypeError, ValueError):
            out[k] = d
    return out


def region_of(place: str | None) -> str:
    s = (place or "").lower()
    if not s.strip():
        return "Not given"
    for part in [p.strip() for p in s.split(",")][::-1] + [s.strip()]:
        if part in _CITY_REGION:
            return _CITY_REGION[part]
    for name, r in _CITY_REGION.items():
        if f" {name} " in f" {s} ":
            return r
    return "Other / not known"


def tier_of(place: str | None) -> str:
    t = city_tier(place)
    return {"tier 1": "Tier 1", "tier 2": "Tier 2", "tier 3 / other": "Tier 3", "not given": "Not given"}[t]


async def places(db, uids: list[str]) -> dict[str, dict[str, str]]:
    """{uid: {place, lang}}: the first Ready-to-join city, else the resume's city / location; the site language."""
    uids = list(set(uids))
    out: dict[str, dict[str, str]] = {u: {"place": "", "lang": "en"} for u in uids}
    for i in range(0, len(uids), 2000):
        chunk = uids[i : i + 2000]
        async for p in db[HIRE_PROFILES].find({"_id": {"$in": chunk}}, {"cities": 1}):
            if p.get("cities"):
                out[p["_id"]]["place"] = str(p["cities"][0])
        async for r in db[RESUMES].find(
            {"user_id": {"$in": chunk}, "active": True},
            {"user_id": 1, "data.personal.location": 1, "data.personal.city": 1},
        ):
            pers = (r.get("data") or {}).get("personal") or {}
            if not out[r["user_id"]]["place"]:
                out[r["user_id"]]["place"] = str(pers.get("city") or pers.get("location") or "")
        async for u in db[USERS].find({"_id": {"$in": chunk}}, {"simple.lang": 1}):
            out[u["_id"]]["lang"] = str((u.get("simple") or {}).get("lang") or "en")
    return out


async def outcomes(db, since: datetime) -> dict[str, list[tuple[str, str, bool]]]:
    """{metric: [(user_id, lang, ok)]} (at most CAP rows each; no other data leaves this function)."""
    rows: dict[str, list[tuple[str, str, bool]]] = defaultdict(list)
    async for a in (
        db[SKILL_ATTEMPTS]
        .find({"v": 2, "submitted_at": {"$gt": since}}, {"user_id": 1, "lang": 1, "score": 1})
        .limit(CAP)
    ):
        rows["skill"].append((a["user_id"], str(a.get("lang") or "en"), (a.get("score") or 0) >= E.PASS_MCQ))
    async for iv in (
        db[VETTING_INTERVIEWS]
        .find({"status": "graded", "graded_at": {"$gt": since}}, {"user_id": 1, "lang": 1, "passed": 1})
        .limit(CAP)
    ):
        rows["interview"].append((iv["user_id"], str(iv.get("lang") or "en"), bool(iv.get("passed"))))
    async for s in (
        db[TRUST_SPOKEN]
        .find({"at": {"$gt": since}, "band": {"$ne": None}}, {"user_id": 1, "lang": 1, "band": 1})
        .limit(CAP)
    ):
        if s.get("user_id"):
            rows["spoken"].append((s["user_id"], str(s.get("lang") or ""), s.get("band") in SPOKEN_OK))
    async for it in db[AUTO_ITEMS].find({"state": {"$in": ["applied", "sent"]}, "updated_at": {"$gt": since}},
                                        {"user_id": 1, "replied_at": 1, "notice.status": 1}).limit(CAP):  # fmt: skip
        ok = bool(it.get("replied_at")) or (it.get("notice") or {}).get("status") in (
            "viewed",
            "shortlisted",
            "interview",
            "offer",
            "replied",
        )
        rows["autoapply"].append((it["user_id"], "", ok))
    invited = {
        i["user_id"] async for i in db[HIRE_INVITES].find({"created_at": {"$gt": since}}, {"user_id": 1}).limit(CAP)
    }
    async for p in db[HIRE_PROFILES].find({"on": True, "consent_at": {"$ne": None}}, {"_id": 1}).limit(CAP):
        rows["hire"].append((p["_id"], "", p["_id"] in invited))
    return rows


def gaps(groups: dict[str, list[int]], min_n: int) -> list[dict[str, Any]]:
    """[{group, n?, rate?, flag, small}] with the four-fifths rule against the best group that has enough people."""
    big = {g: (n, ok) for g, (n, ok) in groups.items() if n >= min_n}
    best = max((ok / n for n, ok in big.values()), default=0)
    out = []
    for g in sorted(groups):
        n, ok = groups[g]
        if n < min_n:
            out.append({"group": g, "small": True, "flag": False})
            continue
        rate = ok / n
        out.append({"group": g, "small": False, "n": n, "rate": round(100 * rate), "ratio": round(rate / best, 2) if best else None,
                    "flag": bool(best) and len(big) > 1 and rate < FOUR_FIFTHS * best - 1e-9})  # fmt: skip
    return out


def explain(metric: str, dim: str, row: dict[str, Any], best: str) -> str:
    label, what = METRICS[metric]
    return (f"{label}: {row['rate']}% of people in “{row['group']}” {what}, under 80% of the best group (“{best}”). "
            f"Check the questions, rubric and AI grading for {DIMENSIONS[dim].lower()} bias before trusting this step for them.")  # fmt: skip


async def compute(db, t: datetime | None = None, st: dict[str, int] | None = None) -> dict[str, Any]:
    from app.site import get_site

    t = t or now()
    st = st or settings_of(await get_site(db))
    rows = await outcomes(db, t - timedelta(days=st["days"]))
    who = await places(db, [u for rs in rows.values() for u, _, _ in rs])
    metrics = []
    flags = []
    for m, rs in rows.items():
        dims: dict[str, dict[str, list[int]]] = {d: defaultdict(lambda: [0, 0]) for d in DIMENSIONS}
        for uid, lang, ok in rs:
            w = who.get(uid) or {}
            keys = {
                "language": LANG.get(lang or w.get("lang") or "en", "English"),
                "region": region_of(w.get("place")),
                "tier": tier_of(w.get("place")),
            }
            for d, k in keys.items():
                dims[d][k][0] += 1
                dims[d][k][1] += int(ok)
        out_dims = {}
        for d, groups in dims.items():
            g = gaps(groups, st["min_n"])
            big = [x for x in g if not x["small"]]
            best = max(big, key=lambda x: x["rate"])["group"] if big else ""
            for x in g:
                if x["flag"]:
                    x["why"] = explain(m, d, x, best)
                    flags.append({"metric": m, "dimension": d, "group": x["group"], "rate": x["rate"], "why": x["why"]})
            out_dims[d] = g
        metrics.append(
            {
                "key": m,
                "label": METRICS[m][0],
                "what": METRICS[m][1],
                "total": len(rs) if len(rs) >= st["min_n"] else None,
                "dimensions": out_dims,
            }
        )
    return {"at": t, "days": st["days"], "minN": st["min_n"], "metrics": metrics, "flags": flags}


async def filter_counts(db, t: datetime | None = None, days: int = 30) -> dict[str, Any]:
    """Unfair-filter warnings shown / overridden / refused, by where and topic (companies; no candidates)."""
    t = t or now()
    by: dict[str, dict[str, int]] = defaultdict(lambda: {"shown": 0, "override": 0, "refused": 0})
    topics: dict[str, int] = defaultdict(int)
    async for e in (
        db[TRUST_FAIRNESS_EVENTS]
        .find({"at": {"$gt": t - timedelta(days=days)}}, {"where": 1, "topic": 1, "action": 1})
        .limit(CAP)
    ):
        by[e.get("where") or "job"][e.get("action") or "shown"] += 1
        topics[e.get("topic") or "other"] += 1
    return {
        "days": days,
        "byWhere": {k: dict(v) for k, v in by.items()},
        "byTopic": dict(sorted(topics.items(), key=lambda x: -x[1])),
    }


def week_id(t: datetime) -> str:
    y, w, _ = t.astimezone(IST).isocalendar()
    return f"{y}-W{w:02d}"


async def snapshot(db, t: datetime | None = None) -> dict[str, Any]:
    t = t or now()
    rep = await compute(db, t)
    doc = {**rep, "filters": await filter_counts(db, t)}
    await db[TRUST_FAIRNESS].update_one({"_id": week_id(t)}, {"$set": doc}, upsert=True)
    return doc


async def weekly_if_due(db) -> int:
    """Once a week (heavy lease): the snapshot. Returns the number of flagged gaps (0 when not due / skipped)."""
    from app.core.heavy import heavy_or_skip

    t = now()
    if await db[TRUST_FAIRNESS].find_one({"_id": week_id(t)}, {"_id": 1}):
        return 0
    async with heavy_or_skip(db) as ok:
        if not ok:
            return 0
        doc = await snapshot(db, t)
        # no personal data in either, but nothing is kept for ever: warnings 1 year, snapshots 2 years
        await db[TRUST_FAIRNESS_EVENTS].delete_many({"at": {"$lt": t - timedelta(days=365)}})
        await db[TRUST_FAIRNESS].delete_many({"at": {"$lt": t - timedelta(days=730)}})
    return len(doc["flags"])
