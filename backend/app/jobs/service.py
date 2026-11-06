"""Saving jobs: one at a time or a batch, with duplicates recognised by the dedupe key (app/jobs/model.py).

  created   a new job
  updated   the same job sent again with something changed (it keeps its id, link, status and posted date)
  skipped   the same job sent again with nothing changed
  rejected  failed the checks (the reasons say which field)

The collector, a bulk import and the admin form all use this, so they behave the same.
"""

import csv
import io
import json
from typing import Any, Literal

from pydantic import ValidationError
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.auth.models import new_id
from app.core.db import JOBS
from app.core.time import now
from app.jobs.model import CONTENT, JobIn, errors_of, slug_for, to_doc

Outcome = Literal["created", "updated", "skipped"]
MAX_BATCH = 500


async def save(
    db: AsyncDatabase, job: JobIn, source: str, actor: str | None = None, demo: bool = False
) -> tuple[Outcome, dict]:
    t = now()
    fields = to_doc(job)
    old = await db[JOBS].find_one({"dedupe_key": fields["dedupe_key"]})
    if old:
        changed = {k: fields[k] for k in CONTENT if old.get(k) != fields[k]}
        if not changed:
            return "skipped", old
        await db[JOBS].update_one({"_id": old["_id"]}, {"$set": {**changed, "updated_at": t}})
        return "updated", {**old, **changed, "updated_at": t}
    doc = {
        "_id": new_id(),
        "slug": slug_for(job.title, job.company.name),
        **fields,
        "status": job.status,
        "closed_reason": "" if job.status != "closed" else "closed by the source",
        "posted_at": job.posted_at or t,
        "source": source,
        "link_check": {"at": None, "ok": None, "status": None, "fails": 0, "error": ""},
        "demo": demo,
        "created_by": actor,
        "created_at": t,
        "updated_at": t,
    }
    try:
        await db[JOBS].insert_one(doc)
    except DuplicateKeyError:  # the same job arrived twice at the same moment
        return "skipped", await db[JOBS].find_one({"dedupe_key": fields["dedupe_key"]}) or doc
    return "created", doc


async def save_batch(
    db: AsyncDatabase, rows: list[Any], source: str, actor: str | None = None, *, commit: bool = True
) -> dict[str, Any]:
    """Every row checked; valid ones saved (or, with commit=False, only what would happen: a preview)."""
    out: dict[str, Any] = {"created": 0, "updated": 0, "skipped": 0, "rejected": 0, "rows": []}
    for i, raw in enumerate(rows[:MAX_BATCH], start=1):
        row: dict[str, Any] = {"row": i, "title": "", "company": ""}
        if isinstance(raw, dict):
            row["title"] = str(raw.get("title") or "")[:120]
            row["company"] = str((raw.get("company") or {}).get("name") if isinstance(raw.get("company"), dict)
                                 else raw.get("company") or "")[:100]  # fmt: skip
        try:
            if not isinstance(raw, dict):
                raise ValueError("Each job must be an object with its fields.")
            job = JobIn.model_validate(raw)
        except (ValidationError, ValueError) as e:
            out["rejected"] += 1
            out["rows"].append({**row, "result": "rejected", "errors": errors_of(e)})
            continue
        if commit:
            result, doc = await save(db, job, source, actor)
            row["id"] = doc["_id"]
        else:
            fields = to_doc(job)
            old = await db[JOBS].find_one({"dedupe_key": fields["dedupe_key"]})
            result = "created" if not old else "skipped" if all(old.get(k) == fields[k] for k in CONTENT) else "updated"
            if old:
                row["id"] = old["_id"]
        out[result] += 1
        out["rows"].append({**row, "result": result, "errors": []})
    if len(rows) > MAX_BATCH:
        more = f"Only {MAX_BATCH} jobs at a time; send the rest in another batch."
        out["rows"].append({"row": MAX_BATCH + 1, "title": "", "company": "", "result": "rejected", "errors": [more]})
        out["rejected"] += len(rows) - MAX_BATCH
    return out


CSV_COLUMNS = (
    "title", "company", "company_website", "company_logo", "locations", "work_type", "job_type", "experience",
    "salary_min", "salary_max", "salary_period", "skills", "description", "apply_method", "apply_url", "apply_email",
    "posted_at", "closes_at", "status",
)  # fmt: skip


def _split(v: str) -> list[str]:
    return [x.strip() for x in str(v or "").replace(";", "|").split("|") if x.strip()]


def csv_rows(text: str) -> list[dict[str, Any]]:
    """A CSV with the columns in CSV_COLUMNS (header row first) → job objects. Lists use ; or | between items."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    out = []
    for r in reader:
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        job: dict[str, Any] = {
            "title": r.get("title", ""),
            "company": {"name": r.get("company", ""), "website": r.get("company_website", ""),
                        "logo": r.get("company_logo", "")},
            "locations": _split(r.get("locations", "")),
            "skills": [x.strip() for x in str(r.get("skills", "")).replace(";", ",").replace("|", ",").split(",")
                       if x.strip()],
            "description": r.get("description", ""),
        }  # fmt: skip
        for k in ("work_type", "job_type", "experience", "apply_method", "apply_url", "apply_email", "status",
                  "posted_at", "closes_at"):  # fmt: skip
            if r.get(k):
                job[k] = r[k]
        if r.get("salary_min") or r.get("salary_max"):
            job["salary"] = {
                "min": int(float(r["salary_min"])) if r.get("salary_min") else None,
                "max": int(float(r["salary_max"])) if r.get("salary_max") else None,
                "period": r.get("salary_period") or "yearly",
            }
        out.append(job)
    return out


def parse_rows(fmt: str, text: str) -> list[Any]:
    """The rows of a pasted / uploaded file: a JSON array (or {"jobs": [...]}) or a CSV."""
    if fmt == "json":
        data = json.loads(text)
        if isinstance(data, dict) and isinstance(data.get("jobs"), list):
            data = data["jobs"]
        if not isinstance(data, list):
            raise ValueError("Paste a JSON array of jobs: [ {...}, {...} ].")
        return data
    return csv_rows(text)
