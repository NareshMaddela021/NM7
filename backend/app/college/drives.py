"""Drive days and QR check-in (feature `drives`: Drive and Campus plans).

Staff (/api/org/{org_id}/drives; coordinators manage, viewers only look):
  GET  ""                          the organization's drive days
  POST ""                          {name, date, groupIds, companies: [names]}
  GET  /{id}                       the drive: companies, slots (company, round, room, time, students), counts
  PUT  /{id} · DELETE /{id}
  POST /{id}/slots                 {companyId, round: test | gd | interview, room, start "09:30", end "10:30"}
  PUT  /{id}/slots/{sid} · DELETE /{id}/slots/{sid}
  PUT  /{id}/slots/{sid}/students  {membershipIds}: who sits in this slot
  POST /{id}/auto-assign           everyone in the drive's groups, spread over each company-and-round's rooms
  GET  /{id}/slots/{sid}/code      the check-in QR / code for the room screen (changes every minute)
  GET  /{id}/slots/{sid}/attendance  present / late / absent / waiting, per student
  POST /{id}/slots/{sid}/mark      {membershipId, present}: marking by hand
  GET  /{id}/attendance.csv

Students (/api/me):
  GET  /drives                     "My drive day": upcoming drive days with my slots
  POST /checkin                    {slotId?, code}: scanned (the QR's link carries both) or typed (code only)

A student can check in only to a slot they are in, only on the day, from an hour before it starts until it ends,
with the code shown in that room right now (it changes every minute; the last minute's still works). There is no
location tracking. Coordinators can mark anyone in the slot present by hand. Everything is in the Activity log.
"""

import csv
import io
import time as _time
from datetime import date, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Request, Response
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.college.common import HHMM, at_ist, log, members_of, org_with, public, scoped_groups
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, DRIVE_CHECKINS, DRIVES, MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS
from app.core.errors import ApiError
from app.core.exports import csv_safe
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import IST, now
from app.me.service import ms
from app.orgs.scope import NOT_FOUND, OrgScope, features_of

staff = APIRouter(prefix="/api/org/{org_id}/drives", tags=["drives"])
me = APIRouter(prefix="/api/me", tags=["drives"])

ROUNDS = {"test": "Test", "gd": "Group discussion", "interview": "Interview"}
LATE_AFTER = timedelta(minutes=10)
OPENS_BEFORE = timedelta(hours=1)
CODE_STEP = 60  # seconds: the room code changes every minute
CHECKIN_RULES = [(10, timedelta(minutes=10))]  # typed codes per student
MAX_SLOTS = 200


# ---------- models ----------
def _name(v: str) -> str:
    v = " ".join(v.split())
    if not v:
        raise ValueError("required")
    return v


class DriveIn(CamelModel):
    name: str = Field(min_length=2, max_length=80)
    date: date
    group_ids: list[str] = Field(min_length=1, max_length=50)
    companies: list[str] = Field(min_length=1, max_length=30)

    _n = field_validator("name")(classmethod(lambda cls, v: _name(v)))

    @field_validator("companies")
    @classmethod
    def _companies(cls, v):
        out = list(dict.fromkeys(_name(c)[:80] for c in v if c.strip()))
        if not out:
            raise ValueError("Add at least one company.")
        return out


class SlotIn(CamelModel):
    company_id: str = Field(max_length=64)
    round: Literal["test", "gd", "interview"]
    room: str = Field(min_length=1, max_length=40)
    start: str = Field(pattern=HHMM.pattern)
    end: str = Field(pattern=HHMM.pattern)

    _r = field_validator("room")(classmethod(lambda cls, v: _name(v)))


class StudentsIn(CamelModel):
    membership_ids: list[str] = Field(max_length=3000)


class MarkIn(CamelModel):
    membership_id: str = Field(max_length=64)
    present: bool


class CheckinIn(CamelModel):
    slot_id: str | None = Field(None, max_length=64)
    code: str = Field(pattern=r"^\d{6}$")


# ---------- codes ----------
def _window(t: float | None = None) -> int:
    return int((t if t is not None else _time.time()) // CODE_STEP)


def room_code(slot_id: str, window: int) -> str:
    return f"{int(keyed_hash('drive-checkin', slot_id, str(window))[:12], 16) % 1_000_000:06d}"


def code_ok(slot_id: str, code: str) -> bool:
    w = _window()
    return any(same(room_code(slot_id, x), code) for x in (w, w - 1))


# ---------- helpers ----------
async def _drive(db, scope, drive_id: str) -> dict[str, Any]:
    d = await db[DRIVES].find_one({"_id": drive_id, "org_id": scope.org_id})
    if not d:
        raise NOT_FOUND
    if scope.group_ids is not None and not set(d["group_ids"]) & set(scope.group_ids):
        raise NOT_FOUND
    return d


def _slot(d: dict[str, Any], sid: str) -> dict[str, Any]:
    for s in d.get("slots", []):
        if s["id"] == sid:
            return s
    raise NOT_FOUND


def _writable(scope, d: dict[str, Any]) -> None:
    scope.require("manage")
    if scope.group_ids is not None and not set(d["group_ids"]) <= set(scope.group_ids):
        raise ApiError(403, "some_groups", "This drive includes groups you don’t manage. Ask your Owner to change it.")


def _status(s: dict[str, Any], day: str, c: dict[str, Any] | None, t=None) -> str:
    t = t or now()
    if c:
        return "late" if c["at"] > at_ist(day, s["start"]) + LATE_AFTER else "present"
    return "absent" if t > at_ist(day, s["end"]) else "waiting"


def drive_out(
    d: dict[str, Any], counts: dict[str, int] | None = None, names: dict[str, str] | None = None
) -> dict[str, Any]:
    comp = {c["id"]: c["name"] for c in d["companies"]}
    return {
        "id": d["_id"],
        "name": d["name"],
        "date": d["date"],
        "groupIds": d["group_ids"],
        "groups": [(names or {}).get(g, "") for g in d["group_ids"]],
        "companies": d["companies"],
        "slots": [
            {
                "id": s["id"],
                "companyId": s["company_id"],
                "company": comp.get(s["company_id"], ""),
                "round": s["round"],
                "roundName": ROUNDS[s["round"]],
                "room": s["room"],
                "start": s["start"],
                "end": s["end"],
                "students": len(s.get("members", [])),
                "present": (counts or {}).get(s["id"], 0),
            }
            for s in sorted(d.get("slots", []), key=lambda s: (s["start"], s["room"]))
        ],
        "createdAt": ms(d["created_at"]),
    }


async def _counts(db, drive_id: str) -> dict[str, int]:
    rows = await (
        await db[DRIVE_CHECKINS].aggregate(
            [{"$match": {"drive_id": drive_id}}, {"$group": {"_id": "$slot_id", "n": {"$sum": 1}}}]
        )
    ).to_list(None)
    return {r["_id"]: r["n"] for r in rows}


async def _group_names(db, ids: list[str]) -> dict[str, str]:
    return {g["_id"]: g["name"] async for g in db[ORG_GROUPS].find({"_id": {"$in": ids}}, {"name": 1})}


# ---------- staff ----------
@staff.get("")
async def list_drives(db: DB, scope: OrgScope) -> list[dict[str, Any]]:
    await org_with(db, scope, "drives")
    q: dict[str, Any] = {"org_id": scope.org_id}
    if scope.group_ids is not None:
        q["group_ids"] = {"$in": scope.group_ids}
    rows = await db[DRIVES].find(q).sort("date", -1).limit(200).to_list(None)
    names = await _group_names(db, list({g for d in rows for g in d["group_ids"]}))
    return [drive_out(d, names=names) for d in rows]


@staff.post("", status_code=201)
async def create_drive(body: DriveIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "drives")
    scope.require("manage")
    groups = await scoped_groups(db, scope, body.group_ids)
    d = {
        "_id": new_id(),
        "org_id": scope.org_id,
        "name": body.name,
        "date": body.date.isoformat(),
        "group_ids": [g["_id"] for g in groups],
        "companies": [{"id": new_id(), "name": c} for c in body.companies],
        "slots": [],
        "created_by": scope.actor_id,
        "created_at": now(),
    }
    await db[DRIVES].insert_one(d)
    await log(db, scope, request, "drive_create", d["_id"], name=d["name"], date=d["date"])
    return drive_out(d, names={g["_id"]: g["name"] for g in groups})


@staff.get("/{drive_id}")
async def get_drive(drive_id: str, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    return drive_out(d, await _counts(db, drive_id), await _group_names(db, d["group_ids"]))


@staff.put("/{drive_id}")
async def edit_drive(drive_id: str, body: DriveIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    _writable(scope, d)
    groups = await scoped_groups(db, scope, body.group_ids)
    keep = {c["name"].lower(): c for c in d["companies"]}
    companies = [keep.get(c.lower()) or {"id": new_id(), "name": c} for c in body.companies]
    ids = {c["id"] for c in companies}
    slots = [s for s in d.get("slots", []) if s["company_id"] in ids]  # a removed company takes its slots along
    sets = {
        "name": body.name,
        "date": body.date.isoformat(),
        "group_ids": [g["_id"] for g in groups],
        "companies": companies,
        "slots": slots,
    }
    await db[DRIVES].update_one({"_id": drive_id}, {"$set": sets})
    await log(db, scope, request, "drive_update", drive_id, name=body.name, date=sets["date"])
    return drive_out({**d, **sets}, await _counts(db, drive_id), {g["_id"]: g["name"] for g in groups})


@staff.delete("/{drive_id}", status_code=204)
async def delete_drive(drive_id: str, request: Request, db: DB, scope: OrgScope) -> Response:
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    _writable(scope, d)
    await db[DRIVES].delete_one({"_id": drive_id})
    await db[DRIVE_CHECKINS].delete_many({"drive_id": drive_id})
    await log(db, scope, request, "drive_delete", drive_id, name=d["name"])
    return Response(status_code=204)


def _check_slot(d: dict[str, Any], body: SlotIn) -> None:
    if body.company_id not in {c["id"] for c in d["companies"]}:
        raise NOT_FOUND
    if body.end <= body.start:
        raise ApiError(400, "bad_time", "The slot must end after it starts.")


@staff.post("/{drive_id}/slots", status_code=201)
async def add_slot(drive_id: str, body: SlotIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    _writable(scope, d)
    _check_slot(d, body)
    if len(d.get("slots", [])) >= MAX_SLOTS:
        raise ApiError(409, "too_many", f"A drive day can have up to {MAX_SLOTS} slots.")
    s = {"id": new_id(), **body.model_dump(), "members": []}
    await db[DRIVES].update_one({"_id": drive_id}, {"$push": {"slots": s}})
    await log(db, scope, request, "drive_slot", drive_id, slot=s["id"], room=s["room"], start=s["start"])
    return await get_drive(drive_id, db, scope)


@staff.put("/{drive_id}/slots/{slot_id}")
async def edit_slot(
    drive_id: str, slot_id: str, body: SlotIn, request: Request, db: DB, scope: OrgScope
) -> dict[str, Any]:
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    _writable(scope, d)
    _slot(d, slot_id)
    _check_slot(d, body)
    sets = {f"slots.$.{k}": v for k, v in body.model_dump().items()}
    await db[DRIVES].update_one({"_id": drive_id, "slots.id": slot_id}, {"$set": sets})
    await log(db, scope, request, "drive_slot", drive_id, slot=slot_id, room=body.room, start=body.start)
    return await get_drive(drive_id, db, scope)


@staff.delete("/{drive_id}/slots/{slot_id}")
async def delete_slot(drive_id: str, slot_id: str, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    _writable(scope, d)
    _slot(d, slot_id)
    await db[DRIVES].update_one({"_id": drive_id}, {"$pull": {"slots": {"id": slot_id}}})
    await db[DRIVE_CHECKINS].delete_many({"slot_id": slot_id})
    await log(db, scope, request, "drive_slot_delete", drive_id, slot=slot_id)
    return await get_drive(drive_id, db, scope)


async def _audience(db, scope, d: dict[str, Any]) -> list[dict[str, Any]]:
    return await members_of(
        db,
        await scoped_groups(db, scope, [g for g in d["group_ids"] if scope.group_ids is None or g in scope.group_ids]),
    )


async def audience_for(db, scope, d: dict[str, Any], company_id: str) -> list[dict[str, Any]]:
    """Who may sit a company's rounds: the eligible list when the company has one (Eligibility), else everyone."""
    people = await _audience(db, scope, d)
    comp = next((c for c in d["companies"] if c["id"] == company_id), None)
    allowed = (comp or {}).get("eligible_ids")
    return [p for p in people if allowed is None or p["id"] in set(allowed)]


@staff.get("/{drive_id}/slots/{slot_id}/students")
async def slot_students(drive_id: str, slot_id: str, db: DB, scope: OrgScope) -> dict[str, Any]:
    """Who may sit this slot (the drive's groups, or the company's eligible list) and who is in it now."""
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    s = _slot(d, slot_id)
    people = await audience_for(db, scope, d, s["company_id"])
    return {
        "people": [public(p) for p in people],
        "chosen": [i for i in s.get("members", []) if i in {p["id"] for p in people}],
    }


@staff.put("/{drive_id}/slots/{slot_id}/students")
async def set_students(
    drive_id: str, slot_id: str, body: StudentsIn, request: Request, db: DB, scope: OrgScope
) -> dict[str, Any]:
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    _writable(scope, d)
    s = _slot(d, slot_id)
    ok = {p["id"] for p in await audience_for(db, scope, d, s["company_id"])}
    ids = [i for i in dict.fromkeys(body.membership_ids) if i in ok]
    await db[DRIVES].update_one({"_id": drive_id, "slots.id": slot_id}, {"$set": {"slots.$.members": ids}})
    await log(db, scope, request, "drive_assign", drive_id, slot=slot_id, count=len(ids))
    return await get_drive(drive_id, db, scope)


@staff.post("/{drive_id}/auto-assign")
async def auto_assign(drive_id: str, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    """For each company and round: everyone who may sit it, spread evenly over its rooms (in roll-number order)."""
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    _writable(scope, d)
    slots = d.get("slots", [])
    buckets: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for s in sorted(slots, key=lambda s: (s["start"], s["room"])):
        buckets.setdefault((s["company_id"], s["round"]), []).append(s)
    total = 0
    for (cid, _), group in buckets.items():
        people = await audience_for(db, scope, d, cid)
        per = -(-len(people) // len(group)) if people else 0
        for i, s in enumerate(group):
            s["members"] = [p["id"] for p in people[i * per : (i + 1) * per]]
            total += len(s["members"])
    await db[DRIVES].update_one({"_id": drive_id}, {"$set": {"slots": slots}})
    await log(db, scope, request, "drive_assign", drive_id, auto=True, count=total)
    return await get_drive(drive_id, db, scope)


@staff.get("/{drive_id}/slots/{slot_id}/code")
async def slot_code(drive_id: str, slot_id: str, db: DB, scope: OrgScope) -> dict[str, Any]:
    """For the room's screen (a laptop or a kiosk tablet): the QR link and the 6-digit code, both for this minute."""
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    s = _slot(d, slot_id)
    w = _window()
    code = room_code(slot_id, w)
    return {
        "code": code,
        "url": f"{get_settings().site_url}/checkin?s={slot_id}&c={code}",
        "refreshIn": CODE_STEP - int(_time.time()) % CODE_STEP,
        "slot": drive_out({**d, "slots": [s]}, await _counts(db, drive_id))["slots"][0],
        "drive": d["name"],
        "date": d["date"],
    }


async def _attendance(db, scope, d: dict[str, Any], s: dict[str, Any]) -> list[dict[str, Any]]:
    people = {p["id"]: p for p in await _audience(db, scope, d)}
    cs = {c["membership_id"]: c async for c in db[DRIVE_CHECKINS].find({"slot_id": s["id"]})}
    t = now()
    rows = []
    for mid in s.get("members", []):
        p = people.get(mid)
        if not p:
            continue  # left the group, withdrew consent, or outside this coordinator's groups
        c = cs.get(mid)
        rows.append(
            {
                **public(p),
                "status": _status(s, d["date"], c, t),
                "at": ms(c["at"]) if c else None,
                "by": (c or {}).get("by"),
            }
        )
    return rows


@staff.get("/{drive_id}/slots/{slot_id}/attendance")
async def attendance(drive_id: str, slot_id: str, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    s = _slot(d, slot_id)
    rows = await _attendance(db, scope, d, s)
    count = {k: sum(1 for r in rows if r["status"] == k) for k in ("present", "late", "absent", "waiting")}
    return {"slot": drive_out({**d, "slots": [s]})["slots"][0], "rows": rows, "counts": count}


@staff.post("/{drive_id}/slots/{slot_id}/mark")
async def mark(drive_id: str, slot_id: str, body: MarkIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    scope.require("manage")
    s = _slot(d, slot_id)
    if body.membership_id not in s.get("members", []) or body.membership_id not in {
        p["id"] for p in await _audience(db, scope, d)
    }:
        raise NOT_FOUND
    key = f"{slot_id}:{body.membership_id}"
    if body.present:
        await db[DRIVE_CHECKINS].update_one(
            {"_id": key},
            {
                "$setOnInsert": {
                    "drive_id": drive_id,
                    "slot_id": slot_id,
                    "membership_id": body.membership_id,
                    "org_id": scope.org_id,
                    "at": now(),
                    "by": "staff",
                    "actor_id": scope.actor_id,
                }
            },
            upsert=True,
        )
    else:
        await db[DRIVE_CHECKINS].delete_one({"_id": key})
    await log(db, scope, request, "drive_mark", drive_id, slot=slot_id, member=body.membership_id, present=body.present)
    return await attendance(drive_id, slot_id, db, scope)


@staff.get("/{drive_id}/attendance.csv")
async def attendance_csv(drive_id: str, request: Request, db: DB, scope: OrgScope) -> Response:
    await org_with(db, scope, "drives")
    d = await _drive(db, scope, drive_id)
    scope.require("export")
    comp = {c["id"]: c["name"] for c in d["companies"]}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "Company",
            "Round",
            "Room",
            "Start",
            "End",
            "Roll number",
            "Name",
            "Branch",
            "Group",
            "Status",
            "Checked in at",
            "Marked by",
        ]
    )
    for s in sorted(d.get("slots", []), key=lambda s: (s["start"], s["room"])):
        for r in await _attendance(db, scope, d, s):
            at = r["at"] and _time.strftime("%H:%M", _time.gmtime(r["at"] / 1000 + 19800))
            w.writerow(
                [
                    csv_safe(x)
                    for x in (
                        comp.get(s["company_id"], ""),
                        ROUNDS[s["round"]],
                        s["room"],
                        s["start"],
                        s["end"],
                        r["roll"],
                        r["name"],
                        r["branch"],
                        r["group"],
                        r["status"],
                        at or "",
                        {"self": "QR / code", "staff": "Coordinator"}.get(r["by"] or "", ""),
                    )
                ]
            )
    await log(db, scope, request, "drive_export", drive_id)
    name = "".join(ch if ch.isalnum() else "_" for ch in d["name"])[:40] or "drive"
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{name}_{d["date"]}_attendance.csv"',
            "Cache-Control": "no-store",
        },
    )


# ---------- students ----------
async def _my_slots(db, user_id: str, today: str | None = None) -> list[tuple[dict, dict, dict]]:
    """(drive, slot, membership) for every slot I'm in, on drives from today on, in organizations with drives on."""
    today = today or now().astimezone(IST).date().isoformat()
    mids = {
        m["_id"]: m async for m in db[MEMBERSHIPS].find({"user_id": user_id, "left_at": None, "consent.given": True})
    }
    if not mids:
        return []
    out = []
    orgs: dict[str, bool] = {}
    async for d in db[DRIVES].find({"slots.members": {"$in": list(mids)}, "date": {"$gte": today}}).sort("date", 1):
        if d["org_id"] not in orgs:
            orgs[d["org_id"]] = features_of(await db[ORGANIZATIONS].find_one({"_id": d["org_id"]}))["drives"]
        if not orgs[d["org_id"]]:
            continue
        for s in d.get("slots", []):
            for mid in s.get("members", []):
                if mid in mids and mids[mid]["group_id"] in d["group_ids"]:
                    out.append((d, s, mids[mid]))
    return out


@me.get("/drives")
async def my_drives(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    rows = await _my_slots(db, auth.user.id)
    days: dict[str, dict[str, Any]] = {}
    org_names = {
        o["_id"]: o["name"]
        async for o in db[ORGANIZATIONS].find({"_id": {"$in": list({d["org_id"] for d, _, _ in rows})}}, {"name": 1})
    }
    for d, s, m in rows:
        c = await db[DRIVE_CHECKINS].find_one({"_id": f"{s['id']}:{m['_id']}"})
        comp = {x["id"]: x["name"] for x in d["companies"]}
        day = days.setdefault(
            d["_id"],
            {"id": d["_id"], "name": d["name"], "date": d["date"], "org": org_names.get(d["org_id"], ""), "slots": []},
        )
        day["slots"].append(
            {
                "id": s["id"],
                "company": comp.get(s["company_id"], ""),
                "round": ROUNDS[s["round"]],
                "room": s["room"],
                "start": s["start"],
                "end": s["end"],
                "status": _status(s, d["date"], c),
                "checkedAt": ms(c["at"]) if c else None,
            }
        )
    for day in days.values():
        day["slots"].sort(key=lambda s: s["start"])
    return list(days.values())


@me.post("/checkin")
async def checkin(body: CheckinIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    key = f"checkin:{auth.user.id}"
    await rate_limit.check(
        db, key, CHECKIN_RULES, "Too many tries. Ask the coordinator in the room to mark you present."
    )
    await rate_limit.record(db, key)
    t = now()
    today = t.astimezone(IST).date().isoformat()
    mine = [
        (d, s, m)
        for d, s, m in await _my_slots(db, auth.user.id, today)
        if d["date"] == today and (body.slot_id is None or s["id"] == body.slot_id)
    ]
    if not mine:
        raise ApiError(
            404, "not_your_slot", "You aren’t in this slot today. Check “My drive day” for your room and time."
        )
    for d, s, m in mine:
        if code_ok(s["id"], body.code):
            if t < at_ist(d["date"], s["start"]) - OPENS_BEFORE:
                raise ApiError(
                    400,
                    "too_early",
                    f"Check-in for this slot opens at {(at_ist(d['date'], s['start']) - OPENS_BEFORE):%H:%M}.",
                )
            if t > at_ist(d["date"], s["end"]):
                raise ApiError(400, "too_late", "This slot has ended. Ask the coordinator to mark you present.")
            ck = f"{s['id']}:{m['_id']}"
            await db[DRIVE_CHECKINS].update_one(
                {"_id": ck},
                {
                    "$setOnInsert": {
                        "drive_id": d["_id"],
                        "slot_id": s["id"],
                        "membership_id": m["_id"],
                        "org_id": d["org_id"],
                        "at": t,
                        "by": "self",
                        "actor_id": auth.user.id,
                    }
                },
                upsert=True,
            )
            c = await db[DRIVE_CHECKINS].find_one({"_id": ck})
            await audit(
                db, auth.user.id, "drive_checkin", target=d["_id"], data={"orgs": [d["org_id"]], "slot": s["id"]}
            )
            comp = {x["id"]: x["name"] for x in d["companies"]}
            return {
                "ok": True,
                "status": _status(s, d["date"], c, t),
                "company": comp.get(s["company_id"], ""),
                "round": ROUNDS[s["round"]],
                "room": s["room"],
                "start": s["start"],
            }
    raise ApiError(
        400,
        "wrong_code",
        "That code isn’t right for your slot. Scan the QR in your room again, or type the code shown now.",
    )
