# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T3: ID + live selfie (behind the Trust switch; needs the "selfie_face" consent from T1).

  GET  /api/me/trust/face                           state, provider, consent text, which steps need it, joining offers
  POST /api/me/trust/face/challenge                 a fresh movement to ask for (turn left / right / smile)
  POST /api/me/trust/face/check {step, docType, idImage, frames[2–3], challenge}   the ID + selfie check
  POST /api/me/trust/face/joining/{offerId} {frames, challenge}                    same person on the joining day
  POST /api/me/trust/face/manual {reason, note, which, offerId?}                   ask for a person (video call)
  GET  /api/admin/trust/face                        provider, keys set / not set, thresholds, switches, counts, review queue
  PUT  /api/admin/trust/face {provider, require, livenessMin, matchMin, sameMin, maxTries}
  POST /api/admin/trust/face/{userId}/review {which, decision, method, note}

Photos arrive as base64 in the JSON body, are decoded in memory, sent to the provider from this request and dropped.
They are never written to disk, to the database or to a log.
"""

from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import DB, TRUST_FACE, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.me.service import ms
from app.site import get_site, save_site
from app.trust import access, consent
from app.trust.face import providers as P
from app.trust.face import service as S

me = APIRouter(prefix="/api/me/trust/face", tags=["trust"], dependencies=[access.ON])
admin = APIRouter(prefix="/api/admin/trust/face", tags=["trust"])

CHECK_RULES = [(12, timedelta(days=1))]


def _settings_out(fs: dict[str, Any]) -> dict[str, Any]:
    return {"provider": fs["provider"], "require": {"interview": bool(fs["require"].get("interview")), "skillCheck": bool(fs["require"].get("skill_check"))},
            "livenessMin": fs["liveness_min"], "matchMin": fs["match_min"], "sameMin": fs["same_min"], "maxTries": fs["max_tries"]}  # fmt: skip


async def _mine(db, uid: str) -> dict[str, Any]:
    site, _, p = await S._context(db, uid)
    fs = S.face_settings(site)
    pur = consent.PURPOSES["selfie_face"]
    return {
        "provider": {"ready": p is not None, "test": bool(p and p.test), "label": p.label if p else ""},
        "consent": await consent.has(db, uid, "selfie_face"),
        "consentTitle": pur.title,
        "consentText": consent.text_of(pur, site),
        "required": _settings_out(fs)["require"],
        "state": S.state_out(await S.get_state(db, uid), fs),
        "joining": await S.joining_offers(db, uid),
        "docTypes": [{"key": k, "title": v} for k, v in S.DOC_TYPES.items()],
        "manualReasons": [{"key": k, "title": v} for k, v in S.MANUAL_REASONS.items()],
    }


@me.get("")
async def mine(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await _mine(db, auth.user.id)


@me.post("/challenge")
async def new_challenge(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    await consent.require(db, auth.user.id, "selfie_face")
    key = await S.challenge(db, auth.user.id)
    return {"key": key, "text": P.CHALLENGES[key]}


class FramesIn(CamelModel):
    frames: list[str] = Field(min_length=2, max_length=3)
    challenge: str = Field(min_length=1, max_length=20)

    @field_validator("frames")
    @classmethod
    def _size(cls, v: list[str]) -> list[str]:
        if any(len(f) > S.FRAME_MAX * 4 // 3 + 100 for f in v):
            raise ValueError("A photo is too large.")
        return v


class CheckIn(FramesIn):
    step: Literal["interview", "skill_check", "settings"] = "settings"
    doc_type: str = Field(min_length=1, max_length=20)
    id_image: str = Field(min_length=10, max_length=S.ID_MAX * 4 // 3 + 100)


async def _limit(db, uid: str) -> None:
    key = f"trust-face:{uid}"
    await rate_limit.check(
        db,
        key,
        CHECK_RULES,
        "You tried the camera check many times today. Please try again tomorrow, or ask for a manual check.",
    )
    await rate_limit.record(db, key)


@me.post("/check")
async def check(body: CheckIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    await consent.require(db, uid, "selfie_face")  # T1: the age gate (or a parent) and the selfie consent
    doc_type = S.doc_type_of(body.doc_type)  # never Aadhaar
    id_image = S.image(body.id_image, S.ID_MAX, "card photo")
    frames = [S.image(f, S.FRAME_MAX, "selfie") for f in body.frames]
    await _limit(db, uid)
    try:
        state = await S.run_check(
            db, uid, step=body.step, doc_type=doc_type, id_image=id_image, frames=frames, challenge_key=body.challenge
        )
    finally:
        del id_image, frames  # memory only: nothing about the photos outlives this request
    out = await _mine(db, uid)
    out["state"] = state
    return out


@me.post("/joining/{offer_id}")
async def joining(offer_id: str, body: FramesIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    await consent.require(db, uid, "selfie_face")
    frames = [S.image(f, S.FRAME_MAX, "selfie") for f in body.frames]
    await _limit(db, uid)
    try:
        state = await S.run_joining(db, uid, offer_id=offer_id, frames=frames, challenge_key=body.challenge)
    finally:
        del frames
    out = await _mine(db, uid)
    out["state"] = state
    return out


class ManualIn(CamelModel):
    reason: Literal["no_camera", "disability", "failed", "other"]
    note: str = Field("", max_length=600)
    which: Literal["identity", "joining"] = "identity"
    offer_id: str | None = Field(None, max_length=40)


@me.post("/manual")
async def manual(body: ManualIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    await consent.require(db, auth.user.id, "selfie_face")
    await S.request_manual(
        db, auth.user.id, reason=body.reason, note=body.note, which=body.which, offer_id=body.offer_id
    )
    return await _mine(db, auth.user.id)


# --- Admin -------------------------------------------------------------------------------------------------------------


async def _admin_out(db) -> dict[str, Any]:
    fs = S.face_settings(await get_site(db))
    items = []
    q = {"$or": [{"review.status": "open"}, {"continuity.review.status": "open"}]}
    async for st in db[TRUST_FACE].find(q).sort("updated_at", -1).limit(50):
        u = await db[USERS].find_one({"_id": st["_id"]}, {"name": 1, "email": 1}) or {}
        which = "identity" if (st.get("review") or {}).get("status") == "open" else "joining"
        items.append({"userId": st["_id"], "userName": u.get("name", ""), "email": u.get("email", ""), "which": which,
                      "updatedAt": ms(st.get("updated_at")), **S.state_out(st, fs)})  # fmt: skip
    return {
        **_settings_out(fs),
        "providers": [
            {"key": p.key, "label": p.label, "test": p.test, "ready": p.ready(), "keys": p.keys()}
            for p in P.registry().values()
        ],
        "counts": await S.counts(db),
        "review": items,
        "methods": [{"key": k, "title": v} for k, v in S.METHODS.items()],
    }


@admin.get("")
async def admin_overview(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return await _admin_out(db)


class RequireIn(CamelModel):
    interview: bool = True
    skill_check: bool = True


class SettingsIn(CamelModel):
    provider: str
    require: RequireIn = Field(default_factory=RequireIn)
    liveness_min: int = Field(90, ge=50, le=99)
    match_min: int = Field(90, ge=50, le=99)
    same_min: int = Field(90, ge=50, le=99)
    max_tries: int = Field(3, ge=1, le=5)

    @field_validator("provider")
    @classmethod
    def _known(cls, v: str) -> str:
        if v not in P.registry():
            raise ValueError("unknown provider")
        return v


@admin.put("")
async def admin_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    before = S.face_settings(await get_site(db))
    new = {"provider": body.provider, "require": {"interview": body.require.interview, "skill_check": body.require.skill_check},
           "liveness_min": body.liveness_min, "match_min": body.match_min, "same_min": body.same_min, "max_tries": body.max_tries}  # fmt: skip
    if new != before:
        await save_site(db, {"trust.face": new})
        await audit(
            db,
            auth.user.id,
            "trust.face_settings",
            target="site",
            data={"from": before, "to": new},
            ip=client_ip(request),
        )
    return await _admin_out(db)


class DecideIn(CamelModel):
    which: Literal["identity", "joining"] = "identity"
    decision: Literal["verified", "not_cleared", "same", "not_same", "reset"]
    method: Literal["video_call", "documents", "other"] = "video_call"
    note: str = Field("", max_length=600)


@admin.post("/{uid}/review")
async def admin_review(uid: str, body: DecideIn, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    ok = {"identity": ("verified", "not_cleared", "reset"), "joining": ("same", "not_same", "reset")}[body.which]
    if body.decision not in ok:
        raise ApiError(400, "decision", f"Choose one of: {', '.join(ok)}.")
    await S.decide(db, uid, auth.user.id, which=body.which, decision=body.decision, method=body.method, note=body.note)
    return await _admin_out(db)
