"""Round W: Admin → Jobs → Collector review, in bulk (permission "jobs"; every action is in the audit log).

  GET  /api/admin/jobs/review?reason=&q=&page=        the collector's waiting jobs, 50 a page, each with the city
                                                      that can be filled ({cityGuess, cityFrom}) and whether it has
                                                      a summary; cityReady: how many "Approve all that have a city"
                                                      would put live
  POST /api/admin/jobs/review/bulk {ids | all, reason?, q?, action: approve|close, note?}
                                                      approve or close the chosen jobs (at most 200 ids), or all that
                                                      match the filter (one heavy job at a time, at most 5,000, in
                                                      chunks of 200). Approve fills a missing city when one can be
                                                      found and skips jobs without a summary (Admin writes one first).
  POST /api/admin/jobs/review/approve-with-city       put live every waiting job whose only issue is a missing city
                                                      that can be filled (from the stored location, the summary or
                                                      the title), with that city

No page is fetched here: the collector's page text is never stored, so a city comes from what is kept. The collector
itself fills the city from the page when a job arrives (app/jobs/collector.py), so these jobs stop piling up.
"""

import re
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import Field, model_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.core.db import DB, JOBS
from app.core.heavy import heavy_or_busy
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobs.admin import job_out
from app.jobs.collector import PLACEHOLDER, cities_of, city_from

router = APIRouter(prefix="/api/admin/jobs/review", tags=["admin jobs"])
WAITING = {"source": "collector", "status": "review"}
PAGE = 50
MAX_IDS = 200  # ids in one request
CHUNK = 200  # jobs read and written at a time
MAX_ALL = 5000  # jobs one "all matching" action touches
CITY_ONLY = ("city_not_stated", "experience_not_stated")  # the only issues "Approve all that have a city" accepts
NO_SUMMARY = re.compile("^" + re.escape(PLACEHOLDER[:23]))
FIELDS = {"description": 1, "locations": 1, "title": 1, "collector.location": 1, "review.reasons": 1, "work_type": 1}


def has_summary(j: dict[str, Any]) -> bool:
    return not NO_SUMMARY.match(j.get("description") or "")


def city_guess(j: dict[str, Any]) -> tuple[list[str], str]:
    """(cities, where from: job · location · summary · title) or ([], "") — never a guess from nowhere."""
    real = [c for c in j.get("locations") or [] if c.strip().lower() != "india"]
    if real:
        return real, "job"
    found, _ = cities_of((j.get("collector") or {}).get("location") or "")
    if found:
        return found, "location"
    if has_summary(j) and (found := city_from(j.get("description") or "")):
        return found, "summary"
    if found := city_from(j.get("title") or "", 1):
        return found, "title"
    return [], ""


def _match(reason: str = "", q: str = "") -> dict[str, Any]:
    m: dict[str, Any] = dict(WAITING)
    if reason:
        m["review.reasons"] = reason
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        m["$or"] = [{"title": rx}, {"company.name": rx}, {"collector.location": rx}]
    return m


READY = {
    **WAITING,
    "review.reasons": {"$not": {"$elemMatch": {"$nin": list(CITY_ONLY)}}},
    "description": {"$not": NO_SUMMARY},
}


async def _city_ready(db) -> int:
    n = 0
    async for j in db[JOBS].find(READY, FIELDS).batch_size(CHUNK).limit(MAX_ALL):
        n += bool(city_guess(j)[0])
    return n


@router.get("")
async def waiting(
    db: DB,
    _: AdminAuth("jobs"),
    reason: str = Query("", max_length=40),
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1, le=1000),
) -> dict[str, Any]:
    m = _match(reason, q)
    total = await db[JOBS].count_documents(m)
    rows = db[JOBS].find(m).sort("created_at", -1).skip((page - 1) * PAGE).limit(PAGE)
    items = []
    async for j in rows:
        cities, src = city_guess(j)
        items.append({**job_out(j), "cityGuess": cities, "cityFrom": src, "hasSummary": has_summary(j)})
    return {"items": items, "total": total, "page": page, "pages": max(1, -(-total // PAGE)),
            "cityReady": await _city_ready(db)}  # fmt: skip


class BulkIn(CamelModel):
    action: Literal["approve", "close"]
    ids: list[str] = Field(default_factory=list, max_length=MAX_IDS)
    all: bool = False  # every waiting job that matches reason / q (Select all matching)
    reason: str = Field("", max_length=40)
    q: str = Field("", max_length=100)
    note: str = Field("", max_length=300)

    @model_validator(mode="after")
    def _some(self):
        if not self.all and not self.ids:
            raise ValueError("Choose at least one job.")
        return self


def _approve_sets(j: dict[str, Any], t, by: str) -> dict[str, Any] | None:
    """The change that puts a waiting job live, or None when it can't go live yet (no summary)."""
    if not has_summary(j):
        return None
    sets: dict[str, Any] = {"status": "active", "updated_at": t, "review.decided_at": t, "review.by": by,
                            "review.note": "approved in bulk"}  # fmt: skip
    cities, src = city_guess(j)
    if cities and src != "job":
        sets |= {"locations": cities, "collector.city_from": src}
    return sets


async def _apply(db, rows, action: str, note: str, by: str) -> dict[str, int]:
    """Approve or close jobs (an async cursor or a list), CHUNK at a time; only jobs still waiting change."""
    done = skipped = 0
    t = now()
    closed = {"status": "closed", "closed_reason": f"not approved: {note or 'closed in Collector review'}",
              "updated_at": t, "review.decided_at": t, "review.by": by, "review.note": note}  # fmt: skip

    async def flush(batch: list[dict[str, Any]]) -> None:
        nonlocal done, skipped
        if action == "close":
            r = await db[JOBS].update_many({"_id": {"$in": [j["_id"] for j in batch]}, **WAITING}, {"$set": closed})
            done += r.modified_count
            skipped += len(batch) - r.modified_count
            return
        for j in batch:
            sets = _approve_sets(j, t, by)
            if sets is None:
                skipped += 1
                continue
            r = await db[JOBS].update_one({"_id": j["_id"], **WAITING}, {"$set": sets})
            done += r.modified_count
            skipped += 1 - r.modified_count

    batch: list[dict[str, Any]] = []
    async for j in _aiter(rows):
        batch.append(j)
        if len(batch) >= CHUNK:
            await flush(batch)
            batch = []
    if batch:
        await flush(batch)
    return {"done": done, "skipped": skipped}


async def _aiter(rows):
    if isinstance(rows, list):
        for r in rows:
            yield r
    else:
        async for r in rows:
            yield r


@router.post("/bulk")
async def bulk(body: BulkIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    note = body.note.strip()
    if body.all:
        async with heavy_or_busy(db):
            cur = db[JOBS].find(_match(body.reason, body.q), FIELDS).batch_size(CHUNK).limit(MAX_ALL)
            out = await _apply(db, cur, body.action, note, auth.user.id)
    else:
        ids = list(dict.fromkeys(body.ids))
        rows = [j async for j in db[JOBS].find({"_id": {"$in": ids}, **WAITING}, FIELDS)]
        out = await _apply(db, rows, body.action, note, auth.user.id)
        out["skipped"] += len(ids) - len(rows)  # gone, or no longer waiting
    data = {"action": body.action, "all": body.all, "ids": len(body.ids), "reason": body.reason, "q": body.q,
            "note": note, **out}  # fmt: skip
    await audit(db, auth.user.id, "job.review_bulk", target=None, data=data, ip=client_ip(request))
    return out


@router.post("/approve-with-city")
async def approve_with_city(request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    """Every waiting job held only for its city (it has a summary) whose city can be found: live, with that city."""
    done = no_city = 0
    t = now()
    async with heavy_or_busy(db):
        batch: list[dict[str, Any]] = []

        async def flush() -> None:
            nonlocal done, no_city
            for j in batch:
                cities, src = city_guess(j)
                if not cities:
                    no_city += 1
                    continue
                sets = {"status": "active", "updated_at": t, "review.decided_at": t, "review.by": auth.user.id,
                        "review.note": "approved: city found", "review.reasons": []}  # fmt: skip
                if src != "job":
                    sets |= {"locations": cities, "collector.city_from": src}
                r = await db[JOBS].update_one({"_id": j["_id"], **WAITING}, {"$set": sets})
                done += r.modified_count

        async for j in db[JOBS].find(READY, FIELDS).batch_size(CHUNK).limit(MAX_ALL):
            batch.append(j)
            if len(batch) >= CHUNK:
                await flush()
                batch = []
        if batch:
            await flush()
    await audit(db, auth.user.id, "job.review_city", target=None, data={"approved": done, "noCity": no_city},
                ip=client_ip(request))  # fmt: skip
    return {"approved": done, "noCity": no_city}
