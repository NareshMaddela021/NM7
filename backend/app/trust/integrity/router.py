# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T8: the integrity rating, evidence and review, and optional webcam snapshots (behind the Trust switch).

Candidate (only while Vetting Trust is on for them; 404 otherwise):
  GET  /api/me/trust/integrity                     my rating in plain words, what was noticed (when, where, weight,
                                                   status), the review, snapshots note, how it is worked out
  POST /api/me/trust/integrity/explain {note, key?}   explain (opens the review, or answers the reviewer)
  GET  /api/me/trust/integrity/snapshots           offered? my consent, its text, photos per session
  POST /api/me/trust/integrity/snapshots/plan {kind, ref}          when to take the photos ({on: false} without consent)
  POST /api/me/trust/integrity/snapshots {kind, ref, image}         one still photo (JPEG, base64)
Admin (reviewers: the "jobs" permission like the V2 / V5 integrity queues; settings: "settings"; all audited):
  GET  /api/admin/trust/integrity                  settings, counts, the review queue, the weighting
  PUT  /api/admin/trust/integrity {snapshots, perSession, checkFaces, windowMinutes}
  POST /api/admin/trust/integrity/run              re-rate everyone with signals now
  GET  /api/admin/trust/integrity/{uid}            the evidence view
  POST /api/admin/trust/integrity/{uid}/signals {key, decision clear / confirm / reopen, note}
  POST /api/admin/trust/integrity/{uid}/open | /ask {note} | /close {note}
  GET  /api/admin/trust/integrity/{uid}/snapshots/{id}   one photo (each look is recorded in the audit log)
"""

from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import DB, TRUST_RUNS
from app.core.email import MailerDep
from app.core.heavy import heavy_or_busy
from app.core.schemas import CamelModel
from app.me.service import ms
from app.site import get_site, save_site
from app.trust import access
from app.trust.integrity import rating as RT
from app.trust.integrity import service as S

me = APIRouter(prefix="/api/me/trust/integrity", tags=["trust"], dependencies=[access.ON])
admin = APIRouter(prefix="/api/admin/trust/integrity", tags=["trust"])

SNAP_RULES = [(40, timedelta(hours=1))]


@me.get("")
async def mine(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.mine(db, auth.user.id)


class ExplainIn(CamelModel):
    note: str = Field(min_length=5, max_length=1500)
    key: str | None = Field(None, max_length=120)


@me.post("/explain")
async def explain(body: ExplainIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.explain(db, auth.user.id, body.note, body.key)


@me.get("/snapshots")
async def snap_offer(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.offer(db, auth.user.id)


class PlanIn(CamelModel):
    kind: Literal["skill", "interview"]
    ref: str = Field(min_length=10, max_length=40)


@me.post("/snapshots/plan")
async def snap_plan(body: PlanIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.plan(db, auth.user.id, body.kind, body.ref)


class SnapIn(PlanIn):
    image: str = Field(min_length=10, max_length=S.SNAP_MAX * 4 // 3 + 100)


@me.post("/snapshots")
async def snap_take(body: SnapIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    key = f"trust-snap:{auth.user.id}"
    await rate_limit.check(db, key, SNAP_RULES)
    img = S.image(body.image)
    await rate_limit.record(db, key)
    return await S.take(db, auth.user.id, body.kind, body.ref, img)


# --- Admin -------------------------------------------------------------------------------------------------------------


def _settings_out(s: dict[str, Any]) -> dict[str, Any]:
    return {
        "snapshots": bool(s["snapshots"]),
        "perSession": s["per_session"],
        "checkFaces": bool(s["check_faces"]),
        "windowMinutes": s["window_minutes"],
    }


@admin.get("")
async def overview(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    from app.trust import retention as R

    site = await get_site(db)
    last = await db[TRUST_RUNS].find_one({"_id": "integrity"}) or {}
    return {**_settings_out(S.settings_of(site)), "snapshotDays": R.days_for(site, "webcam_snapshots"), "counts": await S.counts(db),
            "queue": await S.queue(db), "method": RT.method(), "lastRun": {"at": ms(last.get("ran_at")), **(last.get("last") or {})}}  # fmt: skip


class SettingsIn(CamelModel):
    snapshots: bool = True
    per_session: int = Field(4, ge=3, le=5)
    check_faces: bool = True
    window_minutes: int = Field(12, ge=2, le=30)


@admin.put("")
async def put_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    before = S.settings_of(await get_site(db))
    new = body.model_dump()
    if new != before:
        await save_site(db, {"trust.integrity": new})
        await audit(
            db,
            auth.user.id,
            "trust.integrity_settings",
            target="site",
            data={"from": before, "to": new},
            ip=client_ip(request),
        )
    return await overview(db, auth)


@admin.post("/run")
async def run_now(db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    async with heavy_or_busy(db):
        out = await S.pass_(db, force=True)
    await audit(db, auth.user.id, "trust.integrity_run", target="site", data=out)
    return {"done": out, **(await overview(db, auth))}


@admin.get("/{uid}")
async def evidence(uid: str, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    await audit(db, auth.user.id, "trust.integrity_evidence_viewed", target=uid)
    return await S.evidence(db, uid)


class SignalIn(CamelModel):
    key: str = Field(min_length=3, max_length=120)
    decision: Literal["clear", "confirm", "reopen"]
    note: str = Field("", max_length=500)


@admin.post("/{uid}/signals")
async def signal(uid: str, body: SignalIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    return await S.decide_signal(db, uid, body.key, auth.user.id, body.decision, body.note)


class NoteIn(CamelModel):
    note: str = Field("", max_length=600)


@admin.post("/{uid}/open")
async def open_review(uid: str, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    return await S.open_review(db, uid, auth.user.id)


@admin.post("/{uid}/ask")
async def ask(uid: str, body: NoteIn, db: DB, mailer: MailerDep, auth: AdminAuth("jobs")) -> dict[str, Any]:
    return await S.ask(db, mailer, uid, auth.user.id, body.note)


@admin.post("/{uid}/close")
async def close(uid: str, body: NoteIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    return await S.close_review(db, uid, auth.user.id, body.note)


@admin.get("/{uid}/snapshots/{sid}")
async def snapshot(uid: str, sid: str, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    return await S.view_snapshot(db, uid, sid, auth.user.id)
