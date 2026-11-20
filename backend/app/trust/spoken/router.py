# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T10 endpoints (behind the Trust switch: 404 for people it is off for).

GET  /api/me/trust/spoken                      my spoken-English score (band, sub-scores, how it was measured), the
                                               voice consent, the bands, and how to retake it (the interview's T9
                                               retake limits)
POST /api/me/trust/spoken/{iid}/clip {turn, part, audio, text}   one spoken answer's clip (base64 WAV, ≤ 20 s) →
                                               the provider; the audio is not kept (unless Admin turned keeping on)
Admin (settings permission to change; audited):
GET  /api/admin/trust/spoken                   provider, keys set / not set, role categories with the filter, keeping
                                               clips on / off and its days, counts
PUT  /api/admin/trust/spoken {provider, categories, keepAudio}
"""

from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Request
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core.db import DB, TRUST_SPOKEN, TRUST_SPOKEN_AUDIO, VETTING_INTERVIEWS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.site import get_site, save_site
from app.trust import access
from app.trust import consent as C
from app.trust import retention as R
from app.trust.spoken import providers as P
from app.trust.spoken import score as Sc
from app.trust.spoken import service as S

me = APIRouter(prefix="/api/me/trust/spoken", tags=["trust"], dependencies=[access.ON])
admin = APIRouter(prefix="/api/admin/trust/spoken", tags=["trust"])


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That interview isn’t here.") from None


async def mine_out(db, uid: str) -> dict[str, Any]:
    from app.trust.honesty import retake as RK

    t = now()
    site = await get_site(db)
    row = await S.latest(db, uid, t, with_band=False)
    rk = None
    if row and row.get("test"):
        last = await db[VETTING_INTERVIEWS].find_one({"user_id": uid, "test": row["test"]}, sort=[("started_at", -1)])
        rk = await RK.interview_status(db, uid, row["test"], t, last)
    return {
        "score": S.out(row), "consent": await C.has(db, uid, S.PURPOSE), "consentText": C.text_of(C.PURPOSES[S.PURPOSE], site),
        "consentTitle": C.PURPOSES[S.PURPOSE].title, "how": S.HOW, "bands": S.bands_out(), "retake": rk,
        "pronunciation": bool(await S.provider_for(db, uid, site)),
    }  # fmt: skip


@me.get("")
async def mine(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await mine_out(db, auth.user.id)


class ClipIn(CamelModel):
    turn: int = Field(ge=0, le=40)
    part: Literal["answer", "follow"] = "answer"
    audio: str = Field(min_length=10, max_length=1_000_000)  # base64 of ≤ 700 KB
    text: str = Field("", max_length=2500)


@me.post("/{iid}/clip")
async def clip(iid: str, body: ClipIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.add_clip(db, auth.user.id, _oid(iid), body.turn, body.part, body.audio, body.text)


# --- admin -------------------------------------------------------------------------------------------------------------


async def admin_out(db) -> dict[str, Any]:
    site = await get_site(db)
    st = S.settings_of(site)
    bands = {b: 0 for b in Sc.BAND_KEYS}
    scored = not_enough = no_pron = 0
    clips = clip_errors = 0
    async for r in db[TRUST_SPOKEN].find(
        {}, {"band": 1, "reason": 1, "subs.pronunciation": 1, "clips.error": 1, "clips.accuracy": 1, "at": 1}
    ):
        for c in r.get("clips") or []:
            clips += 1
            clip_errors += int(bool(c.get("error")))
        if not r.get("at"):
            continue
        if r.get("band"):
            scored += 1
            bands[r["band"]] += 1
            no_pron += int((r.get("subs") or {}).get("pronunciation") is None)
        else:
            not_enough += 1
    return {
        "provider": st["provider"], "categories": st["categories"], "keepAudio": st["keep_audio"],
        "keepDays": R.days_for(site, "spoken_audio"), "scoreDays": R.days_for(site, "spoken_scores"),
        "providers": [{"key": p.key, "label": p.label, "test": p.test, "keys": p.keys(), "ready": p.ready()} for p in P.registry().values()],
        "allCategories": [{"key": k, "label": lab} for k, (lab, _) in S.CATEGORIES.items()],
        "counts": {"scored": scored, "bands": bands, "notEnough": not_enough, "pronunciationNotMeasured": no_pron, "clips": clips,
                   "clipErrors": clip_errors, "clipsKept": await db[TRUST_SPOKEN_AUDIO].count_documents({})},
        "bands": S.bands_out(), "how": S.HOW,
    }  # fmt: skip


@admin.get("")
async def overview(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    return await admin_out(db)


class SettingsIn(CamelModel):
    provider: str
    categories: list[str] = Field(default_factory=list, max_length=len(S.CATEGORIES))
    keep_audio: bool = False

    @field_validator("provider")
    @classmethod
    def _known(cls, v: str) -> str:
        if v not in P.registry():
            raise ValueError("unknown provider")
        return v

    @field_validator("categories")
    @classmethod
    def _cats(cls, v: list[str]) -> list[str]:
        bad = [c for c in v if c not in S.CATEGORIES]
        if bad:
            raise ValueError("unknown category")
        return [c for c in S.CATEGORIES if c in v]


@admin.put("")
async def put_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    before = S.settings_of(await get_site(db))
    new = {"provider": body.provider, "categories": body.categories, "keep_audio": body.keep_audio}
    if new != before:
        await save_site(db, {"trust.spoken": new})
        await audit(
            db,
            auth.user.id,
            "trust.spoken_settings",
            target="site",
            data={"from": before, "to": new},
            ip=client_ip(request),
        )
    return await admin_out(db)
