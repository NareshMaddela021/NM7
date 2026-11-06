"""What a company may post now, by trust level (Admin → Settings: site "companies").

unverified / blocked   nothing
basic                  basic_jobs_per_week jobs posted in the last 7 days (default 1)
verified               verified_live_jobs live jobs at a time (default 3)
"""

from datetime import timedelta
from typing import Any

from app.companies.model import trust_of
from app.core.db import JOBS
from app.core.time import now
from app.site import get_site


async def posting_room(db, c: dict[str, Any]) -> dict[str, Any]:
    """{trust, allowed, used, limit, period, reason}: whether one more job may go live now, and why not."""
    s = (await get_site(db))["companies"]
    trust = trust_of(c)
    if trust in ("unverified", "blocked"):
        reason = "Confirm your company email first." if trust == "unverified" else "This company account is blocked."
        return {"trust": trust, "allowed": False, "used": 0, "limit": 0, "period": "", "reason": reason}
    if trust == "basic":
        limit = int(s["basic_jobs_per_week"])
        used = await db[JOBS].count_documents(
            {"company_id": c["_id"], "created_at": {"$gte": now() - timedelta(days=7)}}
        )
        period = "week"
    else:
        limit = int(s["verified_live_jobs"])
        used = await db[JOBS].count_documents({"company_id": c["_id"], "status": "active"})
        period = "live"
    ok = used < limit
    reason = "" if ok else (
        f"Basic accounts can post {limit} job a week. Get verified to post more." if trust == "basic"
        else f"You have {used} live jobs, the most for now. Close one to post another."
    )  # fmt: skip
    return {"trust": trust, "allowed": ok, "used": used, "limit": limit, "period": period, "reason": reason}
