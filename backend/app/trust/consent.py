# ruff: noqa: E501  (plain-language consent texts)
"""Consents, one per purpose (DPDP): the person reads a short plain-language text and says yes to each purpose on its
own, and can take any of them back at any time.

Purposes are a registry (`PURPOSES`); T1 adds five and later items add theirs with `add_purpose(Purpose(...))`
(calls_whatsapp, webcam_snapshots, …). Each purpose has a text version: changing what a text says means a new version,
and a consent given to an older version no longer counts (the person is asked again).

Every consent given is one row in `trust_consents` (purpose, text version, granted_at, channel); withdrawing sets
withdrawn_at and the channel on that row. Rows are never deleted while the account exists, so the history is the
record of consent. Withdrawing deletes that purpose's data at once through the retention framework
(retention.erase_purpose: the data types tied to the purpose, then the hooks other items register).

The withdraw page works two ways: from Profile & settings → Privacy & consent (signed in), and from a signed link
(`withdraw_link`, valid 30 days) that later items put in their emails; the link opens /stop-alerts#k=consent&t=… and
works without signing in. Under-18s can't give a consent until a parent has confirmed (age.py).

  GET    /api/me/trust/access                    {on}
  GET    /api/me/trust/privacy                   age gate state, consents with their texts, retention, links
  POST   /api/me/trust/consents/{purpose}        give it (the current text version)
  DELETE /api/me/trust/consents/{purpose}        take it back (deletes that purpose's data)
  GET    /api/me/trust/consents/export           my consent history (JSON)
  POST   /api/public/trust/withdraw/check {token}          what the link can withdraw
  POST   /api/public/trust/withdraw {token, purposes?}     withdraw (all on the link when purposes is left out)
"""

import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import Field

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, TRUST_CONSENTS, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import now
from app.me.service import ms
from app.trust import access
from app.trust import retention as R

me = APIRouter(prefix="/api/me/trust", tags=["trust"])
public = APIRouter(prefix="/api/public/trust", tags=["trust"])

LINK_DAYS = 30
Channel = Literal["settings", "link", "flow", "admin", "inactivity", "parent"]


@dataclass(frozen=True)
class Purpose:
    key: str
    title: str
    text: str  # plain language; {days} is the retention limit of the purpose's main data type
    version: int
    data_type: str | None = None  # the retention type whose days fill {days}
    te: str | None = None  # Telugu / Hindi texts once a native speaker has written them (TODO, see the PR)
    hi: str | None = None


PURPOSES: dict[str, Purpose] = {}


def add_purpose(p: Purpose) -> Purpose:
    PURPOSES[p.key] = p
    return p


add_purpose(Purpose("profile_sharing", "Share my profile with employers",
    "We show your profile (name, skills, levels, test scores and resume) to companies that hire on Nm7, so they can invite you to interviews. "
    "Companies never see your phone number until you accept an invite. If you take this back, companies can no longer find or open your profile.", 1))  # fmt: skip
add_purpose(Purpose("ai_interview", "AI interview",
    "An AI asks you interview questions and scores your answers. A person checks any score you question, and nobody is rejected by the AI alone. "
    "We keep the interview text for {days} days, then delete it. If you take this back, your interview texts are deleted now.", 1, "interview_transcripts"))  # fmt: skip
add_purpose(Purpose("voice", "Voice recordings and transcripts",
    "When you answer by speaking, we record your voice and turn it into text. Recordings are kept for {days} days, then deleted. "
    "Your voice is never used to guess your caste, religion, region or anything about you. If you take this back, your recordings are deleted now.", 1, "voice"))  # fmt: skip
add_purpose(Purpose("selfie_face", "Selfie and face match",
    "Before your AI interview or a skill check, and again on your joining day, we check that it is really you. Your camera takes 2–3 quick photos of your face "
    "while you turn your head or smile, and you take one photo of your driving licence or PAN card (never Aadhaar). The photos go straight to our face-check partner, "
    "Amazon Web Services (Rekognition, servers in Mumbai, India), which checks that a live person is in front of the camera and that the face matches the card. "
    "We don't save the photos. We keep only the result (yes or no, with scores), the partner's reference number and the time, and the partner keeps a face reference "
    "(not a photo) so we can check it's you on your joining day. All of it is deleted {days} days after your hiring process ends, or now if you take this back. "
    "It is never used for scoring and companies never see your photos: they only see \u201cID + selfie verified\u201d.", 2, "face_check"))  # fmt: skip
add_purpose(Purpose("documents", "Documents (DigiLocker / KYC)",
    "To verify your identity, certificates or experience, we fetch only the documents you choose from DigiLocker or a KYC partner. "
    "We never store your Aadhaar number or an Aadhaar image. Documents are kept for {days} days at most, then deleted, or now if you take this back.", 1, "documents"))  # fmt: skip


def text_of(p: Purpose, site: dict[str, Any]) -> str:
    days = R.days_for(site, p.data_type) if p.data_type in R.TYPES else None
    return p.text.replace("{days}", str(days)) if days else p.text


def _purpose(key: str) -> Purpose:
    p = PURPOSES.get(key)
    if not p:
        raise ApiError(404, "not_found", "There is no such consent.")
    return p


# --- state ----------------------------------------------------------------------------------------------------------


async def current(db, uid: str) -> dict[str, dict[str, Any]]:
    """The latest row per purpose for this person."""
    out: dict[str, dict[str, Any]] = {}
    async for r in db[TRUST_CONSENTS].find({"user_id": uid}).sort("granted_at", -1):
        out.setdefault(r["purpose"], r)
    return out


def status_of(row: dict[str, Any] | None, p: Purpose) -> str:
    if not row:
        return "not_given"
    if row.get("withdrawn_at"):
        return "withdrawn"
    if int(row.get("version") or 0) < p.version:
        return "outdated"  # the text changed since: ask again
    return "granted"


async def has(db, uid: str, purpose: str) -> bool:
    p = PURPOSES.get(purpose)
    if not p:
        return False
    row = await db[TRUST_CONSENTS].find_one({"user_id": uid, "purpose": purpose}, sort=[("granted_at", -1)])
    return status_of(row, p) == "granted"


async def require(db, uid: str, purpose: str) -> None:
    """For later items: the person passed the age gate (or a parent confirmed) and gave this consent; else 403."""
    from app.trust import age

    await age.require_ok(db, uid)
    if not await has(db, uid, purpose):
        raise ApiError(
            403, "consent_needed", f"Please agree to “{_purpose(purpose).title}” in Privacy & consent first."
        )


async def grant(db, uid: str, purpose: str, channel: str = "settings") -> dict[str, Any]:
    from app.trust import age

    p = _purpose(purpose)
    await age.require_ok(db, uid)
    if await has(db, uid, purpose):
        return {"purpose": purpose, "status": "granted"}
    t = now()
    await db[TRUST_CONSENTS].update_many(
        {"user_id": uid, "purpose": purpose, "withdrawn_at": None},
        {"$set": {"withdrawn_at": t, "withdraw_channel": "replaced"}},
    )  # fmt: skip  (an outdated version)
    await db[TRUST_CONSENTS].insert_one({"user_id": uid, "purpose": purpose, "version": p.version, "granted_at": t,
                                         "withdrawn_at": None, "channel": channel})  # fmt: skip
    await audit(
        db,
        uid,
        "trust.consent_granted",
        target=uid,
        data={"purpose": purpose, "version": p.version, "channel": channel},
    )
    return {"purpose": purpose, "status": "granted"}


async def withdraw(db, uid: str, purpose: str, channel: str = "settings", actor: str | None = None) -> dict[str, Any]:
    """Takes the consent back and deletes that purpose's data now (retention.erase_purpose)."""
    t = now()
    r = await db[TRUST_CONSENTS].update_many({"user_id": uid, "purpose": purpose, "withdrawn_at": None},
                                             {"$set": {"withdrawn_at": t, "withdraw_channel": channel}})  # fmt: skip
    deleted = await R.erase_purpose(db, uid, purpose)
    if r.modified_count:
        await db[TRUST_CONSENTS].update_one({"user_id": uid, "purpose": purpose, "withdrawn_at": t},
                                            {"$set": {"deleted": sum(deleted.values())}})  # fmt: skip
    await audit(db, actor or uid, "trust.consent_withdrawn", target=uid,
                data={"purpose": purpose, "channel": channel, "deleted": sum(deleted.values())})  # fmt: skip
    return {"purpose": purpose, "status": "withdrawn", "deleted": sum(deleted.values())}


# --- the signed withdraw link -----------------------------------------------------------------------------------------


def withdraw_token(uid: str, purpose: str = "all", days: int = LINK_DAYS, at: float | None = None) -> str:
    exp = int((at or time.time()) + days * 86400)
    return f"{uid}.{purpose}.{exp}.{keyed_hash('trust-withdraw', uid, purpose, str(exp))[:32]}"


def read_token(token: str, at: float | None = None) -> tuple[str, str] | None:
    """(user id, purpose or "all"), or None when the link was changed or has expired."""
    rest, _, sig = (token or "").rpartition(".")
    rest, _, exp = rest.rpartition(".")
    uid, _, purpose = rest.rpartition(".")
    if not (uid and purpose and exp.isdigit() and sig):
        return None
    if not same(sig, keyed_hash("trust-withdraw", uid, purpose, exp)[:32]) or int(exp) < (at or time.time()):
        return None
    return uid, purpose


def withdraw_link(uid: str, purpose: str = "all") -> str:
    return f"{get_settings().site_url.rstrip('/')}/stop-alerts#k=consent&t={withdraw_token(uid, purpose)}"


# --- the candidate's page ---------------------------------------------------------------------------------------------


def _row_out(p: Purpose, row: dict[str, Any] | None, site: dict[str, Any]) -> dict[str, Any]:
    return {"purpose": p.key, "title": p.title, "text": text_of(p, site), "version": p.version, "status": status_of(row, p),
            "grantedAt": ms((row or {}).get("granted_at")), "withdrawnAt": ms((row or {}).get("withdrawn_at")),
            "channel": (row or {}).get("channel")}  # fmt: skip


@me.get("/access")
async def my_access(db: DB, auth: CustomerAuth) -> dict[str, bool]:
    return {"on": await access.for_user(db, auth.user.id)}


@me.get("/privacy", dependencies=[access.ON])
async def privacy(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    from app.site import get_site
    from app.trust import age

    site = await get_site(db)
    rows = await current(db, auth.user.id)
    return {
        "age": await age.state(db, auth.user.id),
        "consents": [_row_out(p, rows.get(k), site) for k, p in PURPOSES.items()],
        "keep": [{"label": x["label"], "days": x["days"]} for x in await R.schedule(db) if x["runner"] == "trust"],
    }


@me.post("/consents/{purpose}", dependencies=[access.ON])
async def give(purpose: str, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await grant(db, auth.user.id, purpose, "settings")


@me.delete("/consents/{purpose}", dependencies=[access.ON])
async def take_back(purpose: str, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    _purpose(purpose)
    return await withdraw(db, auth.user.id, purpose, "settings")


def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime) else v


@me.get("/consents/export", dependencies=[access.ON])
async def export(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    from app.trust import age

    rows = (
        await db[TRUST_CONSENTS]
        .find({"user_id": auth.user.id}, {"_id": 0, "user_id": 0})
        .sort("granted_at", 1)
        .to_list(1000)
    )
    return {"exportedAt": now().isoformat(), "age": await age.state(db, auth.user.id),
            "consents": [{k: _iso(v) for k, v in r.items()} for r in rows]}  # fmt: skip


# --- the public link --------------------------------------------------------------------------------------------------


class TokenIn(CamelModel):
    token: str = Field(min_length=20, max_length=300)


class WithdrawIn(TokenIn):
    purposes: list[str] | None = Field(None, max_length=30)


LINK_RULES = [(30, timedelta(hours=1))]


async def _link_user(db, request: Request, token: str) -> tuple[str, str]:
    key = f"trust-withdraw:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, LINK_RULES)
    await rate_limit.record(db, key)
    got = read_token(token)
    if not got or not await db[USERS].find_one({"_id": got[0], "deleted_at": None}, {"_id": 1}):
        raise ApiError(
            404,
            "invalid_link",
            "This link doesn’t work or has expired. Sign in and open Profile & settings > Privacy & consent.",
        )
    return got


@public.post("/withdraw/check")
async def link_check(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    from app.site import get_site

    uid, purpose = await _link_user(db, request, body.token)
    site = await get_site(db)
    rows = await current(db, uid)
    keys = list(PURPOSES) if purpose == "all" else [purpose]
    return {"items": [_row_out(PURPOSES[k], rows.get(k), site) for k in keys if k in PURPOSES]}


@public.post("/withdraw")
async def link_withdraw(body: WithdrawIn, request: Request, db: DB) -> dict[str, Any]:
    uid, purpose = await _link_user(db, request, body.token)
    allowed = list(PURPOSES) if purpose == "all" else [purpose]
    keys = [k for k in (body.purposes or allowed) if k in allowed]
    if not keys:
        raise ApiError(400, "nothing", "Choose what to take back.")
    rows = await current(db, uid)
    done = []
    for k in keys:
        if k in PURPOSES and status_of(rows.get(k), PURPOSES[k]) in ("granted", "outdated"):
            done.append(await withdraw(db, uid, k, "link"))
    return {"withdrawn": [d["purpose"] for d in done], "deleted": sum(d["deleted"] for d in done)}
