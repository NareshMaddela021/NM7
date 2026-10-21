"""First-party counters for the home page (no third-party trackers, no cookies, no user ids, no IP addresses stored):
which hero buttons, "Start from" cards, demo, language switch and /for-orgs · /partners links people tap.

  POST /api/public/events {name}     one tap; only the names below count, anything else is ignored
  GET  /api/admin/home-clicks?days=  daily counts per name (admin dashboard)

Each tap only increments a per-day counter ({day, name, n}). The rate limit keeps a salted hash of the address for
a day, like every other public form.
"""

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Query, Request
from pydantic import Field

from app.admin.deps import AdminAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import DB, HOME_EVENTS
from app.core.schemas import CamelModel
from app.core.time import ist_day, now

public = APIRouter(prefix="/api/public", tags=["home"])
admin = APIRouter(prefix="/api/admin", tags=["home"])

EVENTS = {
    "hero_build": "Hero · Build my resume",
    "hero_snap": "Hero · Snap my papers",
    "hero_import": "Hero · Import my resume",
    "hero_org_plans": "Hero · See plans for organizations",
    "hero_org_start": "Hero · Start free (organization)",
    "start_resume": "Start from · I have a resume",
    "start_papers": "Start from · I have papers",
    "start_nothing": "Start from · I have nothing",
    "start_linkedin": "Start from · I have a LinkedIn",
    "demo_summary": "Summary writer demo · Try it",
    "to_for_orgs": "Link to /for-orgs",
    "to_partners": "Link to /partners",
    "lang_en": "Language · English",
    "lang_te": "Language · Telugu",
    "lang_hi": "Language · Hindi",
}
RULES = [(120, timedelta(hours=1))]


class EventIn(CamelModel):
    name: str = Field(max_length=40)


@public.post("/events", status_code=204)
async def count_event(body: EventIn, request: Request, db: DB) -> None:
    if body.name not in EVENTS:
        return None
    key = f"home-event:{client_ip(request) or '-'}"
    try:
        await rate_limit.check(db, key, RULES)
    except Exception:  # over the limit: just don't count it (a counter never shows an error)
        return None
    await rate_limit.record(db, key)
    day = ist_day()
    await db[HOME_EVENTS].update_one(
        {"_id": f"{day}:{body.name}"}, {"$inc": {"n": 1}, "$setOnInsert": {"day": day, "name": body.name}}, upsert=True
    )
    return None


@admin.get("/home-clicks")
async def home_clicks(db: DB, _: AdminAuth("dashboard"), days: int = Query(14, ge=1, le=90)) -> dict[str, Any]:
    since = ist_day(now() - timedelta(days=days - 1))
    rows = await db[HOME_EVENTS].find({"day": {"$gte": since}}).to_list(None)
    dayset = sorted({r["day"] for r in rows}, reverse=True)
    by = {(r["day"], r["name"]): r["n"] for r in rows}
    return {
        "days": dayset,
        "events": [
            {
                "name": k,
                "label": label,
                "total": sum(by.get((d, k), 0) for d in dayset),
                "byDay": {d: by.get((d, k), 0) for d in dayset},
            }  # fmt: skip
            for k, label in EVENTS.items()
        ],
    }
