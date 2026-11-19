"""Profile setup P1: the quick start of each individual role (job seeker, student, expert).

  GET  /api/me/setup                       every role of mine: steps, answers (pre-filled from existing data),
                                           where to pick up, done
  GET  /api/me/setup/{role}                one role
  PUT  /api/me/setup/{role} {answers?, skip?, step?, done?}   save one answer (or a skip) at once
  POST /api/me/setup/nearest-city {lat, lng}   "Use my location": the nearest city nm7.si knows (nothing stored)
  GET  /api/me/setup/suggest?kind=job|college&q=   suggestions while typing

Only name, contact and role are required (sign-up and the picker); every quick-start answer is optional. A view's
read-only mode refuses the PUT (app/auth/deps.py); an admin's personas (demo people) walk through it like anyone.
"""

import json
import math
import re
from typing import Any, Literal

from fastapi import APIRouter, Query
from pydantic import ConfigDict, Field

from app.auth.deps import CurrentAuth
from app.core.db import DB, JOBS, ORGANIZATIONS, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.setup import steps as S
from app.setup import store

router = APIRouter(prefix="/api/me/setup", tags=["profile setup"])

MAX_BODY = 4_000  # bytes of JSON: a quick-start answer is a few words
NOT_INDIVIDUAL = ApiError(403, "not_individual", "Quick start is for personal accounts.")


class SetupIn(CamelModel):
    model_config = ConfigDict(extra="forbid")
    answers: S.Answers | None = None
    skip: list[str] = Field(default_factory=list, max_length=6)
    step: str | None = Field(None, max_length=20)
    done: bool = False


class PointIn(CamelModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


def _individual(auth) -> None:
    if auth.user.role == "admin" or auth.session.kiosk_id or auth.session.demo_org_id:
        raise NOT_INDIVIDUAL


def _role(auth, role: str) -> str:
    _individual(auth)
    if role not in S.ROLES:
        raise ApiError(404, "no_such_role", "There is no such role.")
    if role not in auth.user.individual_roles:
        raise ApiError(400, "no_such_role", "Add this role first (account menu → Add another role).")
    return role


async def _state(db, uid: str, role: str) -> dict[str, Any]:
    u = await db[USERS].find_one({"_id": uid}) or {}
    switches = await store.switches_for(db, uid)
    found = await store.existing(db, u, role, switches)
    return store.state_out(role, (u.get("setup") or {}).get(role) or {}, found, switches)


@router.get("")
async def get_all(auth: CurrentAuth, db: DB) -> dict[str, Any]:
    _individual(auth)
    mine = auth.user.individual_roles
    return {
        "roles": mine,
        "active": auth.user.current_role,
        "setup": {r: await _state(db, auth.user.id, r) for r in mine},
    }


@router.get("/suggest")
async def suggest(
    auth: CurrentAuth, db: DB, kind: Literal["job", "college"] = "job", q: str = Query("", max_length=60)
) -> dict[str, Any]:
    _individual(auth)
    q = " ".join(q.split())
    rx = {"$regex": re.escape(q), "$options": "i"} if q else None
    out: list[str] = []
    if kind == "job":
        from app.jobs.public import live_filter
        from app.seek.catalogue import ROLES

        out = [r["title"] for r in ROLES if not q or q.lower() in r["title"].lower()][:8]
        if q and len(out) < 8:
            rows = await db[JOBS].aggregate(
                [
                    {"$match": {"$and": [live_filter(), {"title": rx}]}},
                    {"$group": {"_id": "$title", "n": {"$sum": 1}}},
                    {"$sort": {"n": -1, "_id": 1}},
                    {"$limit": 8},
                ]  # fmt: skip
            )
            seen = {x.lower() for x in out}
            async for r in rows:
                t = " ".join(str(r["_id"]).split())[:80]
                if t and t.lower() not in seen and len(out) < 8:
                    out.append(t)
                    seen.add(t.lower())
    elif q:  # colleges on Nm7 (never the demo college); anything else can be typed as it is
        cur = db[ORGANIZATIONS].find(
            {"type": {"$in": ["college", "institute"]}, "status": "active", "demo": {"$ne": True}, "name": rx},
            {"name": 1},
        )
        out = sorted({o["name"] async for o in cur.limit(20)})[:8]
    return {"items": out}


@router.post("/nearest-city")
async def nearest_city(body: PointIn, auth: CurrentAuth) -> dict[str, Any]:
    """The nearest city to a point the browser gave. Nothing is stored: the person sees the city and picks it."""
    _individual(auth)
    from app.jobsearch.parse import canonical_city
    from app.trust.workprefs import CITY_COORDS, INDIA

    lat_lo, lat_hi, lng_lo, lng_hi = INDIA
    if not (lat_lo <= body.lat <= lat_hi and lng_lo <= body.lng <= lng_hi):
        raise ApiError(400, "outside_india", "We couldn’t find a city near you. Please pick your city.")

    def km(c: tuple[float, float]) -> float:
        p1, p2 = math.radians(body.lat), math.radians(c[0])
        dp, dl = p2 - p1, math.radians(c[1] - body.lng)
        h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 12742 * math.asin(math.sqrt(h))

    name, where = min(CITY_COORDS.items(), key=lambda kv: km(kv[1]))
    return {"city": canonical_city(name), "km": round(km(where))}


@router.get("/{role}")
async def get_one(role: str, auth: CurrentAuth, db: DB) -> dict[str, Any]:
    return await _state(db, auth.user.id, _role(auth, role))


@router.put("/{role}")
async def put_one(role: str, body: SetupIn, auth: CurrentAuth, db: DB) -> dict[str, Any]:
    role = _role(auth, role)
    new = body.answers.model_dump(exclude_unset=True) if body.answers else {}
    if bad := [k for k in new if k not in S.KEYS[role]]:
        raise ApiError(400, "not_for_role", f"Not a {role} question: {', '.join(bad)}.")
    if len(json.dumps(new, ensure_ascii=False).encode()) > MAX_BODY:
        raise ApiError(413, "too_large", "That’s too long.")
    if bad := [s for s in body.skip if s not in S.ALL_STEPS[role]]:
        raise ApiError(400, "no_such_step", f"No such step: {', '.join(bad)}.")
    if body.step and body.step not in (*S.ALL_STEPS[role], "results"):
        raise ApiError(400, "no_such_step", "No such step.")
    if "l4_reviewer" in (new.get("services") or []) and not (await store.switches_for(db, auth.user.id))["vetting"]:
        new["services"] = [x for x in new["services"] if x != "l4_reviewer"]  # hidden while its switch is off
    u = await db[USERS].find_one({"_id": auth.user.id}) or {}
    await store.save(db, u, role, new, body.skip, body.step, body.done)
    return await _state(db, auth.user.id, role)
