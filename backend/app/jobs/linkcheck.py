"""The daily dead-link check (job board J2), run by the automation pass.

Each active or paused job applied for on the company website gets its apply link checked about once a day:
  - politely: a HEAD request (a GET without reading the page when HEAD isn't allowed), 10 second timeout, our own
    User-Agent, at most one request a second to the same website, at most 60 jobs a pass;
  - a dead link is HTTP 404 / 410, a 5xx, or no answer (DNS, connection, timeout). 401 / 403 / 429 mean the site
    won't talk to robots: not counted either way;
  - two dead results in a row close the job, with the reason; one good result resets the count. An admin can
    reopen a closed job (Admin → Jobs → Expired links), and the count starts again.
Jobs past their closing date are closed in the same pass.
"""

import asyncio
import logging
from collections import defaultdict
from datetime import timedelta
from typing import Any
from urllib.parse import urlparse

import httpx
from pymongo.asynchronous.database import AsyncDatabase

from app.audit import audit
from app.core.db import JOBS
from app.core.time import now

log = logging.getLogger("nm7.jobs")

EVERY = timedelta(hours=20)  # "once a day", with slack for the pass timing
PER_PASS = 60
SAME_SITE_GAP = 1.0  # seconds between requests to one website
TIMEOUT = 10.0
FAILS_TO_CLOSE = 2
UA = "Nm7LinkCheck/1.0 (+https://nm7.si/jobs; checks that job apply links still work)"
DEAD = {404, 410}
NOT_COUNTED = {401, 403, 405, 406, 429}  # after a HEAD these get a GET; still refused: no verdict


async def _probe(client: httpx.AsyncClient, url: str) -> tuple[bool | None, int | None, str]:
    """(ok, status, error): ok None when the site gave no verdict."""
    try:
        r = await client.head(url)
        if r.status_code in NOT_COUNTED or r.status_code == 501:
            async with client.stream("GET", url) as g:  # the headers are enough; the page isn't read
                r = g
        code = r.status_code
        if code in DEAD or code >= 500:
            return False, code, ""
        if code in NOT_COUNTED:
            return None, code, ""
        return code < 400, code, ""
    except httpx.TimeoutException:
        return False, None, "no answer in 10 seconds"
    except httpx.HTTPError as e:
        return False, None, type(e).__name__


async def _check_site(db, client, jobs: list[dict[str, Any]], counts: dict[str, int]) -> None:
    for i, j in enumerate(jobs):
        if i:
            await asyncio.sleep(SAME_SITE_GAP)
        ok, code, error = await _probe(client, j["apply"]["url"])
        t = now()
        lc = j.get("link_check") or {}
        fails = 0 if ok else (lc.get("fails", 0) + 1 if ok is False else lc.get("fails", 0))
        sets: dict[str, Any] = {"link_check": {"at": t, "ok": ok, "status": code, "fails": fails, "error": error}}
        if ok is False and fails >= FAILS_TO_CLOSE and j["status"] != "closed":
            why = f"HTTP {code}" if code else error
            sets |= {"status": "closed", "closed_reason": f"apply link failed twice in a row ({why})", "updated_at": t}
            counts["closed"] += 1
            await audit(db, None, "job.link_closed", target=j["_id"], data={"title": j["title"], "why": why})
        await db[JOBS].update_one({"_id": j["_id"]}, {"$set": sets})
        counts["checked"] += 1
        counts["failed"] += ok is False


async def run(db: AsyncDatabase, transport: httpx.AsyncBaseTransport | None = None) -> dict[str, int]:
    t = now()
    counts = {"checked": 0, "failed": 0, "closed": 0, "expired": 0}
    # closing dates passed
    res = await db[JOBS].update_many(
        {"status": {"$ne": "closed"}, "closes_at": {"$ne": None, "$lt": t}},
        {"$set": {"status": "closed", "closed_reason": "the closing date has passed", "updated_at": t}},
    )
    counts["expired"] = res.modified_count
    due = await (
        db[JOBS]
        .find(
            {"status": {"$in": ["active", "paused"]}, "apply.method": "link", "demo": {"$ne": True},
             "$or": [{"link_check.at": None}, {"link_check.at": {"$lt": t - EVERY}}]},
            {"description": 0},
        )
        .sort("link_check.at", 1)
        .limit(PER_PASS)
    ).to_list(None)  # fmt: skip
    if not due:
        return counts
    sites: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for j in due:
        sites[(urlparse(j["apply"]["url"]).hostname or "").lower()].append(j)
    async with httpx.AsyncClient(
        timeout=TIMEOUT, follow_redirects=True, headers={"User-Agent": UA}, transport=transport, max_redirects=5
    ) as client:
        await asyncio.gather(*(_check_site(db, client, jobs, counts) for jobs in sites.values()))
    if counts["checked"]:
        log.info("job links: %(checked)d checked, %(failed)d failed, %(closed)d closed", counts)
    return counts
