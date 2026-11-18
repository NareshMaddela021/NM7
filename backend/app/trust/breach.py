# ruff: noqa: E501  (dense response shapes)
"""The 72-hour breach log (Admin → Skill checks → Vetting Trust → Breach log; owner only, every change audited).

An incident records when it was found, what data, how many people, its status and the notifications sent. Two
countdowns follow from "detected at": CERT-In within 6 hours (CERT-In Directions, 28 April 2022) and the Data Protection
Board's detailed report within 72 hours (DPDP Rules 2025, rule 7); affected people are told without delay. The plain
steps are in docs/trust/breach-runbook.md.

  GET  /api/admin/trust/breaches
  POST /api/admin/trust/breaches                         {title, detectedAt, dataTypes, people, summary}
  PUT  /api/admin/trust/breaches/{id}                    {status?, people?, summary?, dataTypes?}
  POST /api/admin/trust/breaches/{id}/notifications      {to, note}
"""

from datetime import datetime, timedelta
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.core.db import DB, TRUST_BREACHES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import from_ms, ms

admin = APIRouter(prefix="/api/admin/trust/breaches", tags=["trust"])

DPB_HOURS = 72
CERTIN_HOURS = 6
Status = Literal["open", "contained", "notified", "closed"]
To = Literal["dpb", "certin", "people", "police", "vendor", "other"]
TO_LABEL = {"dpb": "Data Protection Board", "certin": "CERT-In", "people": "Affected people", "police": "Police / cyber cell",
            "vendor": "Vendor / processor", "other": "Other"}  # fmt: skip


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That incident isn’t here.") from None


def out(b: dict[str, Any], t: datetime | None = None) -> dict[str, Any]:
    t = t or now()
    sent = {n["to"] for n in b.get("notifications") or []}
    left = (b["deadline_at"] - t).total_seconds()
    return {"id": str(b["_id"]), "title": b["title"], "summary": b.get("summary", ""), "dataTypes": b.get("data_types") or [],
            "people": b.get("people", 0), "status": b["status"], "detectedAt": ms(b["detected_at"]), "deadlineAt": ms(b["deadline_at"]),
            "certinDueAt": ms(b["certin_due_at"]), "secondsLeft": int(left), "overdue": left < 0 and "dpb" not in sent,
            "certinOverdue": b["certin_due_at"] < t and "certin" not in sent,
            "notifications": [{"to": n["to"], "label": TO_LABEL.get(n["to"], n["to"]), "at": ms(n["at"]), "note": n.get("note", "")} for n in b.get("notifications") or []],
            "createdAt": ms(b["created_at"]), "updatedAt": ms(b.get("updated_at"))}  # fmt: skip


class BreachIn(CamelModel):
    title: str = Field(min_length=3, max_length=200)
    detected_at: int | None = None  # ms; default now
    data_types: list[str] = Field(default_factory=list, max_length=20)
    people: int = Field(0, ge=0, le=100_000_000)
    summary: str = Field("", max_length=4000)


class BreachEdit(CamelModel):
    status: Status | None = None
    people: int | None = Field(None, ge=0, le=100_000_000)
    summary: str | None = Field(None, max_length=4000)
    data_types: list[str] | None = Field(None, max_length=20)


class NoteIn(CamelModel):
    to: To
    note: str = Field("", max_length=1000)


@admin.get("")
async def breaches(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    t = now()
    rows = await db[TRUST_BREACHES].find({}).sort("detected_at", -1).to_list(200)
    return {"items": [out(b, t) for b in rows], "dpbHours": DPB_HOURS, "certinHours": CERTIN_HOURS}


@admin.post("")
async def create(body: BreachIn, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    t = now()
    found = from_ms(body.detected_at) if body.detected_at else t
    if found > t + timedelta(minutes=5):
        raise ApiError(400, "detected_at", "“Detected at” can’t be in the future.")
    b = {"title": body.title.strip(), "summary": body.summary.strip(), "data_types": [x.strip() for x in body.data_types if x.strip()],
         "people": body.people, "status": "open", "detected_at": found, "deadline_at": found + timedelta(hours=DPB_HOURS),
         "certin_due_at": found + timedelta(hours=CERTIN_HOURS), "notifications": [], "created_at": t, "updated_at": t,
         "created_by": auth.user.id}  # fmt: skip
    r = await db[TRUST_BREACHES].insert_one(b)
    await audit(
        db,
        auth.user.id,
        "trust.breach_created",
        target=str(r.inserted_id),
        data={"people": body.people, "types": b["data_types"]},
    )
    return out({**b, "_id": r.inserted_id}, t)


@admin.put("/{bid}")
async def edit(bid: str, body: BreachEdit, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    b = await db[TRUST_BREACHES].find_one({"_id": _oid(bid)})
    if not b:
        raise ApiError(404, "not_found", "That incident isn’t here.")
    sets = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not sets:
        return out(b)
    await db[TRUST_BREACHES].update_one({"_id": b["_id"]}, {"$set": {**sets, "updated_at": now()}})
    await audit(
        db,
        auth.user.id,
        "trust.breach_updated",
        target=bid,
        data={k: (v if k != "summary" else "…") for k, v in sets.items()},
    )
    return out(await db[TRUST_BREACHES].find_one({"_id": b["_id"]}))


@admin.post("/{bid}/notifications")
async def notified(bid: str, body: NoteIn, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    b = await db[TRUST_BREACHES].find_one({"_id": _oid(bid)})
    if not b:
        raise ApiError(404, "not_found", "That incident isn’t here.")
    t = now()
    await db[TRUST_BREACHES].update_one({"_id": b["_id"]}, {"$push": {"notifications": {"to": body.to, "note": body.note.strip(), "at": t, "by": auth.user.id}},
                                                            "$set": {"updated_at": t}})  # fmt: skip
    await audit(db, auth.user.id, "trust.breach_notified", target=bid, data={"to": body.to})
    return out(await db[TRUST_BREACHES].find_one({"_id": b["_id"]}))
