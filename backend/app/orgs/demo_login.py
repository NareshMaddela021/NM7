"""Admin → Organizations → Demo → "Reset and open as coordinator": resets the demo college and signs this browser in
as its made-up coordinator, with no email code, so drives, eligibility, offers, reminders, alumni, reviewers and the
college group can be shown in sales demos and tested.

The admin gets a one-time link (5 minutes; only a hash is stored; the token travels after # so it never reaches a
server log). Opening it starts a 3-hour session that reaches only the demo college's portal and its demo college
group (app/auth/deps.py demo_allowed): not real organizations, resumes, orders or payments. It replaces the admin
session in that browser, so use a private window to keep both.

  POST /api/admin/demo-org/coordinator     admin: reset + one-time link {path}
  POST /api/public/demo-coordinator {token}  sign in as the demo coordinator → {orgId}
"""

import secrets
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import Field

from app.audit import audit
from app.auth.models import User
from app.auth.sessions import client_ip, start_session
from app.core import rate_limit
from app.core.db import DB, ORG_STAFF, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import hash_token
from app.core.time import now
from app.orgs.demo import COORDINATOR_ID, ORG_ID, create_demo
from app.orgs.scope import AdminScope

admin = APIRouter(prefix="/api/admin/demo-org", tags=["organizations"])
public = APIRouter(prefix="/api/public/demo-coordinator", tags=["public"])
STAFF_ID = "demo-staff-coordinator"
LINK_TTL = timedelta(minutes=5)


class TokenIn(CamelModel):
    token: str = Field(min_length=20, max_length=200)


@admin.post("/coordinator")
async def coordinator_link(request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    await rate_limit.check(db, f"demo-org:{scope.actor_id}", [(10, timedelta(hours=1))])
    await rate_limit.record(db, f"demo-org:{scope.actor_id}")
    await create_demo(db, scope.actor_id)
    token = secrets.token_urlsafe(32)
    await db[ORG_STAFF].update_one(
        {"_id": STAFF_ID}, {"$set": {"demo_login_hash": hash_token(token), "demo_login_exp": now() + LINK_TTL}}
    )
    await audit(db, scope.actor_id, "demo_coordinator_open", target=ORG_ID, data={"orgs": [ORG_ID]},
                ip=client_ip(request))  # fmt: skip
    return {"path": f"/org/demo-login#t={token}"}


@public.post("")
async def coordinator_sign_in(body: TokenIn, request: Request, response: Response, db: DB) -> dict[str, str]:
    bad = ApiError(400, "link_used", "This demo link has been used or has expired. Open it again from Admin.")
    st = await db[ORG_STAFF].find_one_and_update(  # one-time: cleared in the same write that accepts it
        {"_id": STAFF_ID, "demo_login_hash": hash_token(body.token), "demo_login_exp": {"$gt": now()}},
        {"$set": {"demo_login_hash": None, "demo_login_exp": None}},
    )
    if not st:
        raise bad
    doc = await db[USERS].find_one({"_id": COORDINATOR_ID, "demo": True})
    if not doc:
        raise bad
    user = User.model_validate(doc)
    await start_session(db, request, response, user, demo_org_id=ORG_ID)
    return {"orgId": ORG_ID}
