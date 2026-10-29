"""One-time cleanup of the example person's values from saved resumes.

`scan` only reads; `clean` changes only the resumes `scan` finds, and in them only the exact sample values
(sample_data.strip_sample). Resume versions, names, titles and everything else stay as they are.

Dry run from a shell with a read-only connection string (prints resume ids and field names only, never names,
emails or any resume text):
    SCAN_URI="mongodb+srv://…" python -m app.maintenance.cleanup
"""

import asyncio
import os
import sys
from typing import Any

from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import RESUMES
from app.core.time import now
from app.maintenance.sample_data import S, sample_markers, strip_sample

# A cheap first filter in Mongo (any one marker value); sample_markers() then decides exactly.
_CANDIDATES = {
    "$or": [
        {"data.links.linkedin": S["links"]["linkedin"]},
        {"data.links.github": S["links"]["github"]},
        {"data.pinfo.father": S["pinfo"]["father"]},
        {"data.personal.email": S["personal"]["email"]},
        {"data.edu.institution": S["edu"]["institution"]},
        {"data.exp.company": S["exp"]["company"]},
    ]
}


async def scan(db: AsyncDatabase) -> list[dict[str, Any]]:
    """[{id, userId, markers, fields}] for every resume holding the example's values; reads only."""
    out = []
    async for r in db[RESUMES].find(_CANDIDATES, {"data": 1, "user_id": 1, "key": 1}).sort("_id", 1):
        data = r.get("data") or {}
        if not sample_markers(data):
            continue
        _, fields = strip_sample(data)
        out.append({"id": str(r["_id"]), "userId": r["user_id"], "markers": sample_markers(data), "fields": fields})
    return out


async def clean(db: AsyncDatabase, ids: list[str] | None = None) -> list[dict[str, Any]]:
    """Removes the example's exact values from the resumes `scan` finds (only `ids` when given)."""
    found = await scan(db)
    done = []
    for row in found:
        if ids is not None and row["id"] not in ids:
            continue
        r = await db[RESUMES].find_one({"_id": _oid(row["id"])}, {"data": 1})
        if not r:
            continue
        data, fields = strip_sample(r.get("data") or {})
        if not fields:
            continue
        # updated_at moves on, so a builder tab still holding the old copy reloads instead of saving it back
        await db[RESUMES].update_one({"_id": r["_id"]}, {"$set": {"data": data, "updated_at": now()}})
        done.append({**row, "fields": fields})
    return done


def _oid(s: str) -> Any:
    return ObjectId(s) if ObjectId.is_valid(s) else s


def report(rows: list[dict[str, Any]]) -> str:
    lines = [f"Resumes holding sample data: {len(rows)}"]
    lines += [f"{r['id']}  markers={','.join(r['markers'])}  fields={','.join(r['fields'])}" for r in rows]
    return "\n".join(lines)


async def _main() -> int:
    uri = os.environ.get("SCAN_URI", "")
    if not uri:
        print("Set SCAN_URI to a read-only connection string.")
        return 2
    client = AsyncMongoClient(uri, serverSelectionTimeoutMS=20000)
    try:
        db = client.get_default_database(default=os.environ.get("SCAN_DB", "nm7"))
        print(report(await scan(db)))  # dry run only: this script never writes
    finally:
        await client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
