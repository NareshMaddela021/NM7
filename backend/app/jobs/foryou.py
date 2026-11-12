"""The "Jobs for you" card on My dashboard (job board J6).

  GET /api/me/jobs-for-you → {state, items (top 3 matches with their scores), saved, applications}

state: "on" (scores shown), "no_resume". The top 3 come from the same list as the easy dashboard's Jobs screen
(app.simple.jobs.top_jobs): the newest open jobs (the same match score as the job
board, rules only) that the person hasn't applied to yet. The counts are for the Saved jobs and My applications
shortcuts. Never an "AI matches" total: only the three jobs and real counts.
"""

from typing import Any

from fastapi import APIRouter

from app.auth.deps import CustomerAuth
from app.core.db import APPLICATIONS, DB, SAVED_JOBS, USERS
from app.jobs import fit as fitmod
from app.jobs.public import public_out

router = APIRouter(prefix="/api/me", tags=["job board"])


@router.get("/jobs-for-you")
async def jobs_for_you(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    saved = await db[SAVED_JOBS].count_documents({"user_id": uid})
    apps = await db[APPLICATIONS].count_documents({"user_id": uid})
    from app.simple.jobs import top_jobs  # here: app.simple imports the job board at load

    u = await db[USERS].find_one({"_id": uid}, {"demo": 1}) or {}
    # one source with the easy dashboard's Jobs screen (re-test N3): the same jobs, the same scores, the same rules,
    # the demo company's jobs for a demo student
    state, top = await top_jobs(db, uid, demo=bool(u.get("demo")))
    out: dict[str, Any] = {"state": state, "items": [], "saved": saved, "applications": apps}
    if state != "on":
        return out
    person = await fitmod.person_for(db, uid)
    jobs = [x["job"] for x in top]
    kept = await fitmod.fits(db, uid, person, jobs)  # the three shown are cached like any card
    out["items"] = [{**public_out(j), "match": kept[j["_id"]], "demo": bool(j.get("demo"))} for j in jobs]
    return out
