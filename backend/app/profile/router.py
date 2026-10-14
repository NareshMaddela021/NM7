"""/api/me/job-profile: the customer's own Job Profile (owner only, autosaved by the dashboard)."""

from typing import Any

from fastapi import APIRouter
from pydantic import Field, field_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.auth.deps import CustomerAuth
from app.core.db import DB, JOB_PROFILES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.schemas import _limit
from app.me.service import ms
from app.profile.service import privacy_of

router = APIRouter(prefix="/api/me/job-profile", tags=["job profile"])
MAX_PROFILE = 400_000  # bytes of JSON; a full profile is ~20 KB


class Privacy(CamelModel):
    experts: bool = False  # my expert may see my Job Profile
    salary: bool = False  # …including my expected salary
    personal: bool = False  # …including personal information (DOB, parents, address)


class ProfileIn(CamelModel):
    data: dict[str, Any]
    privacy: Privacy | None = None
    version: int | None = Field(None, ge=0)  # the version this browser started from; a newer one on the server → 409

    @field_validator("data")
    @classmethod
    def _size(cls, v):
        return _limit(v, MAX_PROFILE, "job profile")


class ProfileOut(CamelModel):
    data: dict[str, Any]
    privacy: Privacy
    version: int
    updated: int | None


def _out(doc: dict[str, Any] | None) -> ProfileOut:
    if not doc:
        return ProfileOut(data={}, privacy=Privacy(), version=0, updated=None)
    return ProfileOut(
        data=doc["data"], privacy=Privacy(**privacy_of(doc)), version=doc["version"], updated=ms(doc["updated_at"])
    )


@router.get("")
async def get_profile(auth: CustomerAuth, db: DB) -> ProfileOut:
    return _out(await db[JOB_PROFILES].find_one({"_id": auth.user.id}))


@router.put("")
async def put_profile(body: ProfileIn, auth: CustomerAuth, db: DB) -> ProfileOut:
    uid = auth.user.id
    cur = await db[JOB_PROFILES].find_one({"_id": uid}, {"version": 1, "privacy": 1})
    version = (cur or {}).get("version", 0)
    if body.version is not None and body.version != version:
        raise ApiError(
            409, "profile_changed", "Your Job Profile was changed in another window. Reloading the latest copy."
        )
    privacy = body.privacy.model_dump() if body.privacy else privacy_of(cur)
    try:
        doc = await db[JOB_PROFILES].find_one_and_update(
            {"_id": uid, "version": version},
            {"$set": {"data": body.data, "privacy": privacy, "version": version + 1, "updated_at": now()}},
            upsert=cur is None,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:  # two first saves at once
        doc = None
    if doc is None:  # someone saved between our read and write
        raise ApiError(
            409, "profile_changed", "Your Job Profile was changed in another window. Reloading the latest copy."
        )
    return _out(doc)
