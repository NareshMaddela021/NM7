"""One-time data changes for Phase 4, run at start-up (each runs once; a marker in `settings` remembers it).

1. Organizations created before plans existed keep working as before: no plan limits for them (limit_overrides
   = no limit) until Nm7 assigns a plan in Admin → Organization → Billing. Their feature switches stay.
2. Feature switches become overrides on top of the plan: an old "off" (the Phase 3 default) is cleared so the plan
   decides; an old "on" stays on.
3. Groups where Nm7 had made downloads free keep them: the organization gets the members_download_free switch on.
"""

import logging

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.billing.plans import LIMIT_KEYS
from app.core.db import ORG_GROUPS, ORGANIZATIONS, SETTINGS
from app.core.time import now

log = logging.getLogger("nm7.billing")
MARKER_ID = "migration:phase4_plans"


async def run(db: AsyncDatabase) -> bool:
    """Returns True when it ran now (False: it already ran, or another instance is running it)."""
    try:
        await db[SETTINGS].insert_one({"_id": MARKER_ID, "started_at": now()})
    except DuplicateKeyError:
        return False
    free_groups = {
        g["org_id"] async for g in db[ORG_GROUPS].find({"settings.members_download_free": True}, {"org_id": 1})
    }
    n = 0
    async for o in db[ORGANIZATIONS].find({"subscription": {"$exists": False}}):
        sets: dict = {"limit_overrides": {k: None for k in LIMIT_KEYS}, "legacy_unlimited": True}
        unsets = {f"features.{k}": "" for k, v in (o.get("features") or {}).items() if v is False}
        if o["_id"] in free_groups:
            sets["features.members_download_free"] = True
        await db[ORGANIZATIONS].update_one({"_id": o["_id"]}, {"$set": sets, **({"$unset": unsets} if unsets else {})})
        n += 1
    await db[SETTINGS].update_one({"_id": MARKER_ID}, {"$set": {"done_at": now(), "orgs": n}})
    log.info("phase 4 migration: %s existing organizations keep working without plan limits", n)
    return True
