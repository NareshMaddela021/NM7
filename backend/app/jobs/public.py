"""The public job board (J3): nm7.si/jobs and nm7.si/jobs/<slug>.

  GET /api/jobs                 search + filters, newest first, 20 a page (active jobs only, never demo jobs)
  GET /api/jobs/sitemap.xml     every active job, for search engines (nm7.si/sitemap-jobs.xml points here)
  GET /api/jobs/{slug}          one job (closed jobs too, with similar active jobs); demo jobs are not found
  GET/PUT/DELETE /api/me/saved-jobs[/{id}]   a signed-in person's saved jobs

An email-apply job's address is not in the public answer: it is given to a signed-in person when they apply.
"""

import re
from datetime import timedelta
from typing import Any
from xml.sax.saxutils import escape

from fastapi import APIRouter, Query, Response

from app.auth.deps import CustomerAuth, MaybeAuth
from app.core.config import get_settings
from app.core.db import APPLICATIONS, COMPANIES, DB, JOBS, SAVED_JOBS
from app.core.errors import ApiError
from app.core.time import now
from app.jobs import fit as fitmod
from app.jobs.model import EXPERIENCE, JOB_TYPES, WORK_TYPES, with_older
from app.me.service import ms

router = APIRouter(prefix="/api/jobs", tags=["job board"])
me_router = APIRouter(prefix="/api/me/saved-jobs", tags=["job board"])

PAGE = 20
POSTED = {"6h": timedelta(hours=6), "24h": timedelta(hours=24), "7d": timedelta(days=7)}
SIMILAR = 4
MAX_SAVED = 200


def live_filter() -> dict[str, Any]:
    """Jobs anyone may see: active, not a demo job, closing date (if any) not passed."""
    return {"status": "active", "demo": {"$ne": True}, "$or": [{"closes_at": None}, {"closes_at": {"$gt": now()}}]}


async def badges(db, jobs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """company id → its trust badge, for the company jobs among these (C4)."""
    from app.companies.trust import badge
    from app.core.db import COMPANIES

    ids = list({j["company_id"] for j in jobs if j.get("company_id")})
    if not ids:
        return {}
    return {c["_id"]: b async for c in db[COMPANIES].find({"_id": {"$in": ids}}) if (b := badge(c))}


def with_badge(out: dict[str, Any], j: dict[str, Any], marks: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if j.get("company_id") in marks:
        out["companyTrust"] = marks[j["company_id"]]
    return out


def public_out(j: dict[str, Any], full: bool = False) -> dict[str, Any]:
    apply = j["apply"]
    out = {
        "id": j["_id"],
        "slug": j["slug"],
        "title": j["title"],
        # round J: a collector job never shows a company logo (and is never called a partner)
        "company": {**j["company"], "logo": ""} if j.get("source") == "collector" else j["company"],
        "fromCareersPage": j.get("source") == "collector",  # "Source: company careers page" + Request removal
        "locations": j.get("locations") or [],
        "remote": bool(j.get("remote")),
        "workType": j["work_type"],
        "jobType": j["job_type"],
        "experience": j["experience"],
        "salary": j.get("salary"),
        "education": j.get("education") or "",
        "skills": j.get("skills") or [],
        "status": j["status"],
        "postedAt": ms(j.get("posted_at")),
        "closesAt": ms(j.get("closes_at")),
        "updatedAt": ms(j.get("updated_at") or j.get("created_at")),
        # the link is public (it is on the company's site); an email address is given only when someone applies
        "apply": {"method": apply["method"], "url": (apply.get("url") or "") if apply["method"] == "link" else ""},
    }
    if full:
        from app.companies.questions import public as questions

        out["description"] = j["description"]
        if j.get("company_id") and apply["method"] == "nm7":  # applying shares the resume with the company (C5)
            out["questions"] = questions(j.get("questions"))
            out["consent"] = True
    return out


def _yearly_at_least(rupees: int) -> dict[str, Any]:
    """Salary filter: the top of the range (or its only number) is at least this much a year."""
    parts = []
    for period, n in (("yearly", rupees), ("monthly", -(-rupees // 12))):
        parts.append({"salary.period": period, "$or": [{"salary.max": {"$gte": n}},
                                                      {"salary.max": None, "salary.min": {"$gte": n}}]})  # fmt: skip
    return {"$or": parts}


def _csv(v: str | None, allowed: set[str] | frozenset[str] | tuple[str, ...]) -> list[str]:
    return [x for x in (v or "").split(",") if x in allowed]


async def _person(db, auth) -> tuple[str, fitmod.Person | None]:
    """(signed_out / no_resume / on, the person's resume)."""
    if not auth or auth.user.role != "customer":
        return "signed_out", None
    p = await fitmod.person_for(db, auth.user.id)
    return ("on", p) if p else ("no_resume", None)


@router.get("")
async def search(
    db: DB,
    auth: MaybeAuth,
    sort: str = Query("", max_length=8),
    q: str = Query("", max_length=80),
    experience: str = Query("", max_length=80),
    city: str = Query("", max_length=60),
    remote: bool = False,
    job_type: str = Query("", alias="jobType", max_length=80),
    work_type: str = Query("", alias="workType", max_length=60),
    salary: int = Query(0, ge=0, le=100_000_000),
    posted: str = Query("", max_length=4),
    page: int = Query(1, ge=1, le=500),
    support: str = Query("", max_length=60),  # Phase 6 S9: returners,immediate,inclusive,accessible
) -> dict[str, Any]:
    and_: list[dict[str, Any]] = [live_filter()]
    if support:
        from app.seek.support import job_filters

        and_ += await job_filters(db, support)
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        and_.append({"$or": [{"title": rx}, {"company.name": rx}, {"skills": rx}]})
    if ex := _csv(experience.replace("8_plus", "8_12,12_15,15_plus"), EXPERIENCE):  # the "8+ years" chip
        and_.append({"experience": {"$in": with_older(ex)}})
    if remote and city.strip():
        rx = {"$regex": f"^{re.escape(city.strip())}$", "$options": "i"}
        and_.append({"$or": [{"remote": True}, {"locations": rx}]})
    elif remote:
        and_.append({"remote": True})
    elif city.strip():
        and_.append({"locations": {"$regex": f"^{re.escape(city.strip())}$", "$options": "i"}})
    if jt := _csv(job_type, JOB_TYPES):
        and_.append({"job_type": {"$in": jt}})
    if wt := _csv(work_type, WORK_TYPES):
        and_.append({"work_type": {"$in": wt}})
    if salary:
        and_.append(_yearly_at_least(salary))
    if posted in POSTED:
        and_.append({"posted_at": {"$gte": now() - POSTED[posted]}})
    query = {"$and": and_}
    state, person = await _person(db, auth)
    newest = [("posted_at", -1), ("_id", 1)]
    fits: dict[str, dict] = {}
    if person and sort == "match":  # rank the newest jobs that pass the filters by their score
        pool = await db[JOBS].find(query, {"description": 0}).sort(newest).limit(fitmod.MAX_RANKED).to_list(None)
        scored = await fitmod.fits(db, auth.user.id, person, pool, save=False)
        pool.sort(key=lambda j: -scored[j["_id"]]["score"])  # stable: newest first within a score
        total = len(pool)
        rows = pool[(page - 1) * PAGE : page * PAGE]
    else:
        total = await db[JOBS].count_documents(query)
        rows = await (
            db[JOBS].find(query, {"description": 0}).sort(newest).skip((page - 1) * PAGE).limit(PAGE)
        ).to_list(None)
    if person:
        fits = await fitmod.fits(db, auth.user.id, person, rows)
    cities = await db[JOBS].aggregate(
        [
            {"$match": live_filter()},
            {"$unwind": "$locations"},
            {"$group": {"_id": "$locations", "n": {"$sum": 1}}},
            {"$sort": {"n": -1, "_id": 1}},
            {"$limit": 30},
        ]  # fmt: skip
    )
    marks = await badges(db, rows)
    return {
        "items": [
            with_badge({**public_out(j), **({"match": fits[j["_id"]]} if j["_id"] in fits else {})}, j, marks)
            for j in rows
        ],
        "match": state,
        "total": total,
        "page": page,
        "pages": max(1, -(-total // PAGE)),
        "cities": [c["_id"] async for c in cities],
    }


@router.get("/sitemap.xml")
async def sitemap(db: DB) -> Response:
    site = get_settings().site_url.rstrip("/")
    urls = []
    async for j in db[JOBS].find(live_filter(), {"slug": 1, "updated_at": 1, "created_at": 1}).limit(45_000):
        t = j.get("updated_at") or j.get("created_at")
        lastmod = f"<lastmod>{t.date().isoformat()}</lastmod>" if t else ""
        loc = escape(f"{site}/jobs/{j['slug']}")
        urls.append(f"<url><loc>{loc}</loc>{lastmod}</url>")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(urls)
        + "</urlset>\n"
    )
    return Response(xml, media_type="application/xml", headers={"Cache-Control": "public, max-age=3600"})


async def similar(db, j: dict[str, Any], n: int = SIMILAR) -> list[dict[str, Any]]:
    """Active jobs most like this one: shared skills first, then the same experience level; newest wins ties."""
    base = {"$and": [live_filter(), {"_id": {"$ne": j["_id"]}}]}
    skills = j.get("skills") or []
    pool = await (
        db[JOBS]
        .find({"$and": [base, {"$or": [{"skills": {"$in": skills}}, {"experience": j["experience"]}]}]},
              {"description": 0})
        .sort("posted_at", -1)
        .limit(100)
    ).to_list(None)  # fmt: skip
    have = {s.lower() for s in skills}

    def rank(x):
        shared = len(have & {s.lower() for s in x.get("skills") or []})
        return (-shared, x["experience"] != j["experience"])

    pool.sort(key=rank)  # stable: newest first within a rank
    marks = await badges(db, pool[:n])
    return [with_badge(public_out(x), x, marks) for x in pool[:n]]


@router.get("/{slug}")
async def one(slug: str, db: DB, auth: MaybeAuth) -> dict[str, Any]:
    j = await db[JOBS].find_one({"slug": slug[:120], "demo": {"$ne": True}})
    if j and j.get("source") == "collector" and (j["status"] == "review" or j.get("closed_reason") == "outside India"):
        # no summary yet (round J) or found to be abroad (round M): never public
        raise ApiError(404, "not_found", "This job isn’t on Nm7 any more.")
    if not j:
        raise ApiError(404, "not_found", "This job isn’t on Nm7 any more.")
    if j["status"] == "active" and j.get("closes_at") and j["closes_at"] <= now():
        j["status"] = "closed"  # the daily pass hasn't run yet
    out = public_out(j, full=True)
    out["similar"] = await similar(db, j)
    if j.get("company_id"):  # Phase 6 S9: what the company declares, in its own words
        from app.seek.support import policies_out

        out["policies"] = policies_out(await db[COMPANIES].find_one({"_id": j["company_id"]}, {"policies": 1}))
    with_badge(out, j, await badges(db, [j]))
    state, person = await _person(db, auth)
    out["matchState"] = state
    if auth and auth.user.role == "customer":  # already applied? (J5)
        mine = await db[APPLICATIONS].find_one(
            {"user_id": auth.user.id, "job_id": j["_id"]}, {"status": 1, "created_at": 1}
        )
        out["application"] = {"status": mine["status"], "at": ms(mine["created_at"])} if mine else None
    if person:
        out["match"] = (await fitmod.fits(db, auth.user.id, person, [j]))[j["_id"]]
    return out


# ---------- saved jobs ----------


@me_router.get("")
async def saved(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    rows = await db[SAVED_JOBS].find({"user_id": auth.user.id}).sort("created_at", -1).to_list(MAX_SAVED)
    ids = [r["job_id"] for r in rows]
    jobs = {j["_id"]: j async for j in db[JOBS].find({"_id": {"$in": ids}, "demo": {"$ne": True}}, {"description": 0})}
    return {
        "items": [{**public_out(jobs[i]), "savedAt": ms(r["created_at"])} for r in rows if (i := r["job_id"]) in jobs]
    }


@me_router.put("/{job_id}")
async def save_job(job_id: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    if not await db[JOBS].find_one({"_id": job_id, "demo": {"$ne": True}}, {"_id": 1}):
        raise ApiError(404, "not_found", "This job isn’t on Nm7 any more.")
    if await db[SAVED_JOBS].count_documents({"user_id": auth.user.id}) >= MAX_SAVED:
        raise ApiError(409, "too_many", f"You can save up to {MAX_SAVED} jobs. Remove some first.")
    await db[SAVED_JOBS].update_one(
        {"_id": f"{auth.user.id}:{job_id}"},
        {"$setOnInsert": {"user_id": auth.user.id, "job_id": job_id, "created_at": now()}},
        upsert=True,
    )
    return {"saved": True}


@me_router.delete("/{job_id}")
async def unsave_job(job_id: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await db[SAVED_JOBS].delete_one({"_id": f"{auth.user.id}:{job_id}"})
    return {"saved": False}
