"""/api/expert: an expert's own application (profile, submit, test task)."""

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pydantic import Field

from app.auth.deps import Auth, require_role
from app.core.db import DB, EXPERT_PROFILES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.experts.service import (
    EDITABLE,
    issues,
    load_profile,
    open_payout,
    profile_out,
    seal_payout,
    set_status,
    size_ok,
)
from app.me.service import ms

router = APIRouter(prefix="/api/expert", tags=["expert"])
ExpertAuth = Annotated[Auth, Depends(require_role("expert"))]


class TestIn(CamelModel):
    data: dict[str, Any]
    note: str = Field("", max_length=2000)


@router.get("/profile")
async def get_profile(auth: ExpertAuth, db: DB) -> dict[str, Any] | None:
    return profile_out(await load_profile(db, auth.user.id), for_admin=False)


@router.put("/profile")
async def put_profile(body: Annotated[dict[str, Any], Body()], auth: ExpertAuth, db: DB) -> dict[str, Any] | None:
    """Saves the form. Status and admin notes can't be set from here."""
    size_ok(body)
    doc = await load_profile(db, auth.user.id)
    status = doc["status"] if doc else "draft"
    if status not in EDITABLE:
        raise ApiError(409, "locked", "Your profile is being reviewed. You can edit it after we reply.")
    payout = body.get("payout") if isinstance(body.get("payout"), dict) else open_payout((doc or {}).get("payout_enc"))
    profile = {k: v for k, v in body.items() if k not in ("payout", "status", "note", "test", "userId")}
    t = now()
    await db[EXPERT_PROFILES].update_one(
        {"_id": auth.user.id},
        {
            "$set": {"profile": profile, "payout_enc": seal_payout(payout), "updated_at": t},
            "$setOnInsert": {"status": "draft", "note": "", "test": None, "created_at": t},
        },
        upsert=True,
    )
    return profile_out(await load_profile(db, auth.user.id), for_admin=False)


@router.post("/profile/submit")
async def submit_profile(auth: ExpertAuth, db: DB) -> dict[str, Any] | None:
    doc = await load_profile(db, auth.user.id)
    if not doc:
        raise ApiError(400, "no_profile", "Fill in your profile first.")
    if doc["status"] not in ("draft", "changes"):
        raise ApiError(409, "bad_status", "Your profile is already submitted.")
    problems = issues(doc.get("profile") or {}, open_payout(doc.get("payout_enc")))
    if problems:
        raise ApiError(400, "incomplete", " ".join(problems))
    await set_status(db, auth.user.id, "review", {"submitted_at": now(), "note": ""})
    return profile_out(await load_profile(db, auth.user.id), for_admin=False)


@router.post("/test")
async def submit_test(body: TestIn, auth: ExpertAuth, db: DB) -> dict[str, Any] | None:
    doc = await load_profile(db, auth.user.id)
    if not doc or doc["status"] != "test" or not doc.get("test"):
        raise ApiError(409, "bad_status", "There’s no test task waiting for you.")
    size_ok(body.data, 300_000)
    test = {**doc["test"], "submitted": ms(now()), "data": body.data, "note": body.note}
    await set_status(db, auth.user.id, "testReview", {"test": test})
    return profile_out(await load_profile(db, auth.user.id), for_admin=False)
