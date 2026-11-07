"""Jobs made simple (Phase 4, E6): the top 3 jobs as big cards, with one plain reason for the match.

  GET /api/me/simple/jobs   {state, items: [{id, slug, title, company, place, match, reason, salaryMonth, trust,
                            saved, method, url, questions, consent}], autoOn, setUp, gate, needs, ready}

The three come from the same match score as "Jobs for you" (rules only, newest open jobs the person hasn't applied
to). reason: one plain reason as words to translate: {key: skills | place | remote | level, vars}. salaryMonth: ₹ a
month when the job gives a salary (a yearly salary divided by 12). trust: the company's trust level when it is a
company on Nm7. Apply uses the normal Manual Apply (POST /api/jobs/{id}/apply, with the consent tick and the
company's questions); Save uses the saved jobs (PUT /api/me/saved-jobs/{id}); "Let Nm7 apply for me" turns Auto Apply
on with the normal settings (PUT /api/me/auto-apply: consent tick and the resume-score gate still apply).
Demo students (never public) get the demo company's jobs.
"""

from typing import Any

from fastapi import APIRouter

from app.auth.deps import CustomerAuth
from app.autoapply.settings import gate, settings_of
from app.core.db import APPLICATIONS, AUTO_ITEMS, DB, JOBS, SAVED_JOBS, USERS
from app.jobs import fit as fitmod
from app.jobs.public import badges, live_filter, public_out
from app.site import get_site

router = APIRouter(prefix="/api/me/simple/jobs", tags=["easy dashboard"])
TOP = 3
POOL = 100


def reason(m: dict[str, Any]) -> dict[str, Any]:
    """One plain reason for the match, as a key and values (the words are translated in the browser)."""
    if m.get("found"):
        return {"key": "skills", "vars": {"skills": ", ".join(m["found"][:2])}}
    if m.get("place") == "remote":
        return {"key": "remote", "vars": {}}
    if m.get("place") == "city":
        return {"key": "place", "vars": {"city": m.get("city") or ""}}
    return {"key": "level", "vars": {}}


def per_month(s: dict[str, Any] | None) -> dict[str, int] | None:
    if not s or (s.get("min") is None and s.get("max") is None):
        return None
    div = 12 if s.get("period", "yearly") == "yearly" else 1
    return {k: round(s[k] / div) for k in ("min", "max") if s.get(k) is not None}


async def top_jobs(db, uid: str, demo: bool = False) -> tuple[str, list[dict[str, Any]]]:
    person = await fitmod.person_for(db, uid)
    if not person:
        return "no_resume", []
    applied = [a["job_id"] async for a in db[APPLICATIONS].find({"user_id": uid, "job_id": {"$exists": True}})]
    base = {"status": "active", "demo": True} if demo else live_filter()
    pool = await (
        db[JOBS]
        .find({"$and": [base, {"_id": {"$nin": applied}}]})
        .sort([("posted_at", -1), ("_id", 1)])
        .limit(POOL)
        .to_list(None)
    )
    scored = await fitmod.fits(db, uid, person, pool, save=False)
    pool.sort(key=lambda j: -scored[j["_id"]]["score"])
    return "on", [{"job": j, "match": scored[j["_id"]]} for j in pool[:TOP]]


@router.get("")
async def simple_jobs(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    site = await get_site(db)
    u = await db[USERS].find_one({"_id": uid}, {"auto_apply": 1, "demo": 1}) or {}
    state, top = await top_jobs(db, uid, demo=bool(u.get("demo")))
    jobs = [x["job"] for x in top]
    marks = await badges(db, jobs)
    saved = {
        s["job_id"] async for s in db[SAVED_JOBS].find({"user_id": uid, "job_id": {"$in": [j["_id"] for j in jobs]}})
    }
    items = []
    for x in top:
        j, m = x["job"], x["match"]
        full = public_out(j, full=True)
        trust = marks.get(j.get("company_id")) if j.get("company_id") else None
        items.append(
            {
                "id": j["_id"],
                "slug": j["slug"],
                "title": j["title"],
                "company": j["company"]["name"],
                "place": "remote" if j.get("remote") else ", ".join((j.get("locations") or [])[:2]),
                "match": m["score"],
                "reason": reason(m),
                "salaryMonth": per_month(j.get("salary")),
                "trust": {"level": trust["level"], "score": trust.get("score")} if trust else None,
                "saved": j["_id"] in saved,
                "method": j["apply"]["method"],
                "url": full["apply"]["url"],
                "questions": full.get("questions") or [],
                "consent": bool(full.get("consent")),
                "demo": bool(j.get("demo")),
            }
        )
    counts = {
        k: await db[AUTO_ITEMS].count_documents({"user_id": uid, "state": s})
        for k, s in (("needs", "needs_answer"), ("ready", "ready"))
    }
    aa = settings_of(u, site)
    return {
        "state": state,
        "items": items,
        "autoOn": aa["on"],
        "setUp": aa["setUp"],
        "siteAutoOn": bool(site["auto_apply"]["on"]),
        "gate": await gate(db, uid, site),
        "defaults": {"dailyLimit": aa["dailyLimit"], "max": int(site["auto_apply"]["max_daily_limit"])},
        **counts,
    }
