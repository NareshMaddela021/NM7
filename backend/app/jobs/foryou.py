"""The "Jobs for you" card on My dashboard (job board J6).

  GET /api/me/jobs-for-you → {state, items (top 3 matches with their scores), saved, applications}

state: "on" (scores shown), "no_resume". The top 3 come from the newest open jobs (the same match score as the job
board, rules only) that the person hasn't applied to yet. The counts are for the Saved jobs and My applications
shortcuts. Never an "AI matches" total: only the three jobs and real counts.
"""

from typing import Any

from fastapi import APIRouter

from app.auth.deps import CustomerAuth
from app.core.db import APPLICATIONS, DB, JOBS, SAVED_JOBS
from app.jobs import fit as fitmod
from app.jobs.public import live_filter, public_out

router = APIRouter(prefix="/api/me", tags=["job board"])
TOP = 3
POOL = 100  # the newest open jobs ranked for the card (the full board ranks 300)


@router.get("/jobs-for-you")
async def jobs_for_you(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    saved = await db[SAVED_JOBS].count_documents({"user_id": uid})
    apps = await db[APPLICATIONS].count_documents({"user_id": uid})
    applied = [
        a["job_id"] async for a in db[APPLICATIONS].find({"user_id": uid, "job_id": {"$exists": True}}, {"job_id": 1})
    ]
    person = await fitmod.person_for(db, uid)
    out: dict[str, Any] = {"state": "on" if person else "no_resume", "items": [], "saved": saved, "applications": apps}
    if not person:
        return out
    pool = await (
        db[JOBS]
        .find({"$and": [live_filter(), {"_id": {"$nin": applied}}]}, {"description": 0})
        .sort([("posted_at", -1), ("_id", 1)])
        .limit(POOL)
    ).to_list(None)
    scored = await fitmod.fits(db, uid, person, pool, save=False)
    pool.sort(key=lambda j: -scored[j["_id"]]["score"])
    top = pool[:TOP]
    kept = await fitmod.fits(db, uid, person, top)  # the three shown are cached like any card
    out["items"] = [{**public_out(j), "match": kept[j["_id"]]} for j in top]
    return out
