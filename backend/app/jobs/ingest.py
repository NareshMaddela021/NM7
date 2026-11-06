"""The morning job-collector's upload (job board J2): POST /api/jobs/ingest.

  Authorization: Bearer <JOB_INGEST_KEY>      (set in Render by the owner; never logged or shown)
  Body: {"jobs": [ {...}, ... ]}  or the array alone; at most 500 jobs a request
  → {created, updated, skipped, rejected, results: [{index, result, id?, title, errors}]}

Each job is checked like any other (app/jobs/model.py); duplicates are recognised by the dedupe key, so sending the
same job every morning updates it (or skips it when nothing changed). One bad job never stops the others. Rate
limited per caller; a wrong key is counted too. The exact JSON shape is in docs/job-ingest-api.md.
"""

import json
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from app.audit import audit
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB
from app.core.errors import ApiError
from app.core.security import keyed_hash, same
from app.jobs import service

router = APIRouter(prefix="/api/jobs", tags=["job board"])

BATCH_RULES = [(60, timedelta(hours=1)), (300, timedelta(days=1))]  # upload requests per caller
BAD_KEY_RULES = [(10, timedelta(hours=1))]  # wrong keys per address
MAX_BODY = 8_000_000  # bytes


def _key_ok(header: str | None) -> bool:
    expected = get_settings().job_ingest_key
    if not header or not header.lower().startswith("bearer "):
        return False
    return same(header[7:].strip(), expected)


@router.post("/ingest")
async def ingest(request: Request, db: DB, authorization: str | None = Header(None)) -> JSONResponse:
    if len(get_settings().job_ingest_key) < 32:
        raise ApiError(503, "ingest_off", "Job upload isn’t set up yet (JOB_INGEST_KEY on the server).")
    ip_key = f"jobs-ingest-bad:{keyed_hash('ip', client_ip(request) or '-')[:24]}"
    if not _key_ok(authorization):
        await rate_limit.check(db, ip_key, BAD_KEY_RULES, "Too many wrong keys. Try again later.")
        await rate_limit.record(db, ip_key)
        raise ApiError(401, "bad_key", "Send the upload key as: Authorization: Bearer <key>.")
    key = "jobs-ingest"
    await rate_limit.check(db, key, BATCH_RULES, "Too many uploads. Send bigger batches less often.")
    await rate_limit.record(db, key)
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise ApiError(413, "too_big", "The upload is too big: send at most 500 jobs (8 MB) at a time.")
    try:
        data: Any = json.loads(raw or b"null")
    except ValueError:
        raise ApiError(400, "bad_json", 'The body must be JSON: {"jobs": [ ... ]}.') from None
    if isinstance(data, dict):
        data = data.get("jobs")
    if not isinstance(data, list) or not data:
        raise ApiError(400, "no_jobs", 'Send {"jobs": [ ... ]} with at least one job.')
    if len(data) > service.MAX_BATCH:
        raise ApiError(400, "too_many", f"At most {service.MAX_BATCH} jobs a request; split the batch.")
    out = await service.save_batch(db, data, "collector")
    results = [
        {"index": r["row"] - 1, "result": r["result"], **({"id": r["id"]} if r.get("id") else {}),
         "title": r["title"], "errors": r["errors"]}
        for r in out["rows"]
    ]  # fmt: skip
    counts = {k: out[k] for k in ("created", "updated", "skipped", "rejected")}
    await audit(db, None, "job.ingest", target=None, data=counts, ip=None)
    return JSONResponse({**counts, "results": results})
