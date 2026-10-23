"""The LinkedIn pack (Phase 2, Rs 149): who owns it, and its contents (pack_rules.py, pack_writer.py).

GET /api/me/linkedin/pack/status: owned or not, how (order, Career Launch, admin grant), the price from the owner's
settings and whether payments are switched on. While payments are off (no Razorpay keys) nothing can be bought:
POST /api/orders answers 503 and the page keeps showing "Coming soon"; an admin can still grant the pack.

GET / POST generate / POST regenerate / PUT edit: the pack itself, for owners only (403 `pack_locked` for anyone
else). It is written once (AI when on and within the daily limits, counted before the call; the rules otherwise
or for any piece that fails a check), saved on the account and shown as often as the person likes. Each written
section can be regenerated once; the person's own edits are kept and only replaced when they confirm.
"""

import json
import logging
import time
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import CustomerAuth, MaybeAuth
from app.core import ai_quota
from app.core.config import get_settings
from app.core.db import DB, LINKEDIN, SHARES
from app.core.errors import ApiError
from app.core.pii import scrub_id_numbers
from app.core.schemas import CamelModel
from app.core.time import now
from app.downloads.router import payments_on
from app.linkedin import pack_rules, pack_writer
from app.linkedin.pack import pack_status
from app.photos.scrub import looks_like_id
from app.site import get_site

router = APIRouter(prefix="/api/me/linkedin/pack", tags=["linkedin"])
log = logging.getLogger("nm7.linkedin")


class PackStatusOut(CamelModel):
    owned: bool
    source: Literal["order", "launch", "grant", ""] = ""
    order_id: str | None = None
    purchased_at: int | None = None  # ms
    payments_on: bool
    on_sale: bool  # payments on and the plan active in Admin > Settings & prices
    price: float  # rupees


def _ms(dt: datetime | None) -> int | None:
    return int(dt.timestamp() * 1000) if dt else None


@router.get("/status")
async def status(auth: MaybeAuth, db: DB) -> PackStatusOut:
    plan = (await get_site(db))["plans"]["linkedin_pack"]
    on = payments_on()
    st = await pack_status(db, auth.user.id) if auth and auth.user.role == "customer" else None
    return PackStatusOut(
        owned=st is not None,
        source=st["source"] if st else "",
        order_id=st["order_id"] if st else None,
        purchased_at=_ms(st["purchased_at"]) if st else None,
        payments_on=on,
        on_sale=on and plan["active"],
        price=plan["amount"] / 100,
    )


# ---------- the pack's contents (owners only; enforced here, not just hidden in the page) ----------

SECTIONS = ("headline", "about", "experience", "education", "skills", "featured", "urls", "banner")
REGEN = ("headline", "about", "experience", "education")  # the written sections: one free regenerate each
MAX_INPUT = 60_000
LOCKED = ApiError(403, "pack_locked", "The LinkedIn pack is not unlocked on this account.")


class GenerateIn(CamelModel):
    path: Literal["fix", "create"]
    target_role: str = Field("", max_length=100)
    profile: dict[str, Any] = Field(default_factory=dict)  # sections: headline, about, experience, skills, ...
    details: dict[str, Any] = Field(default_factory=dict)  # the "create" details
    note: str = Field("", max_length=1000)


class RegenerateIn(CamelModel):
    section: Literal["headline", "about", "experience", "education"]
    confirm: bool = False  # replace the person's own edits (asked first)


class EditIn(CamelModel):
    section: Literal["headline", "about", "experience", "education", "skills", "featured", "urls"]
    value: Any


async def _owner(db, auth) -> None:
    if auth.user.role != "customer" or await pack_status(db, auth.user.id) is None:
        raise LOCKED


def _clean(obj: Any) -> Any:
    """Contact details and links out of every string the person sent (ID numbers too)."""
    if isinstance(obj, dict):
        return {str(k)[:40]: _clean(v) for k, v in list(obj.items())[:60]}
    if isinstance(obj, list):
        return [_clean(v) for v in obj[:60]]
    if isinstance(obj, str):
        return pack_writer.CONTACT.sub("", obj)[:5000]
    return obj if isinstance(obj, int | float | bool) or obj is None else str(obj)[:200]


async def _share_link(db, user_id: str) -> str:
    s = await db[SHARES].find_one({"_id": user_id, "on": True}, {"slug": 1})
    return f"nm7.si/r/{s['slug']}" if s and s.get("slug") else ""


def _pack_out(doc: dict[str, Any] | None) -> dict[str, Any]:
    p = (doc or {}).get("pack")
    if not p:
        return {"pack": None}
    return {
        "pack": p["content"],
        "path": p["path"],
        "regenerated": p.get("regen", {}),
        "edited": p.get("edited", {}),
        "ai": p.get("ai", False),
        "notice": p.get("notice", ""),
        "generatedAt": int(p["generated_at"].timestamp() * 1000),
    }


async def _write(db, auth, f: dict[str, Any], note: str, path: str, share: str, only: str = "", seed: int = 0):
    """(pack, ai_used, notice): AI when it is on and allowed, the rules for everything else. Never raises for AI."""
    base = pack_rules.pack(f, path, share)
    if seed:
        base["headline"]["options"] = pack_rules.headlines(f, seed=seed)
        base["about"].update(pack_rules.about(f, seed=seed))
    if not get_settings().anthropic_api_key:
        return base, False, ""
    try:
        await ai_quota.take(db, "linkedin", str(auth.user.id), auth.session.kiosk_id)
    except ai_quota.CapReached:
        return base, False, "AI is busy today. Here is the quick version."
    except ApiError as e:
        return base, False, e.message if e.status == 429 else "AI is busy. Here is the quick version."
    rewrite = [i for i, e in enumerate(base["experience"]) if e["kind"] == "job" and not e["keep"]]
    stats: dict[str, Any] = {}
    t0 = time.monotonic()
    try:
        raw = await pack_writer.call_model(f, note, rewrite, only, stats)
    except Exception as e:  # unusable, API error, timeout: the rules' version, never an error page
        await ai_quota.note(db, "linkedin", "failed")
        log.warning("linkedin pack ai: %s", type(e).__name__)
        return base, False, "AI is busy. Here is the quick version."
    if stats.get("fallback"):
        await ai_quota.note(db, "linkedin", "fallback")
    out, dropped = pack_writer.merge(base, raw, f, note)
    if dropped:
        await ai_quota.note(db, "linkedin", "dropped", by=dropped)
    log.info(
        "linkedin pack ai: ok model=%s ms=%d dropped=%d",
        stats.get("model", ""),
        int((time.monotonic() - t0) * 1000),
        dropped,
    )
    return out, True, ""


@router.get("")
async def get_pack(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _owner(db, auth)
    return _pack_out(await db[LINKEDIN].find_one({"_id": auth.user.id}, {"pack": 1}))


@router.post("/generate")
async def generate(body: GenerateIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """Writes the pack once; after that it is shown as saved (sections are regenerated one at a time)."""
    await _owner(db, auth)
    have = await db[LINKEDIN].find_one({"_id": auth.user.id}, {"pack": 1})
    if have and have.get("pack"):
        return _pack_out(have)
    profile, details = _clean(body.profile), _clean(body.details)
    if len(json.dumps([profile, details], default=str)) > MAX_INPUT:
        raise ApiError(413, "too_large", "That is more text than a LinkedIn profile holds. Please shorten it.")
    (profile, details), _ = scrub_id_numbers([profile, details])
    note = scrub_id_numbers(pack_writer.CONTACT.sub("", body.note))[0]
    f = pack_rules.facts_of(profile, details, body.target_role)
    if not (f["target"] or f["skills"] or f["education"] or f["experience"]):
        raise ApiError(400, "need_details", "Add the job you want, a few skills or your degree first.")
    share = await _share_link(db, auth.user.id)
    content, ai, notice = await _write(db, auth, f, note, body.path, share)
    pack = {
        "content": content,
        "facts": f,
        "note": note,
        "path": body.path,
        "share": share,
        "ai": ai,
        "notice": notice,
        "regen": {},
        "edited": {},
        "generated_at": now(),
    }
    await db[LINKEDIN].update_one({"_id": auth.user.id}, {"$set": {"pack": pack}}, upsert=True)
    return _pack_out({"pack": pack})


@router.post("/regenerate")
async def regenerate(body: RegenerateIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """One free regenerate per written section. A section the person edited is replaced only with `confirm`."""
    await _owner(db, auth)
    doc = await db[LINKEDIN].find_one({"_id": auth.user.id}, {"pack": 1})
    p = (doc or {}).get("pack")
    if not p:
        raise ApiError(404, "no_pack", "Make your pack first.")
    if p.get("regen", {}).get(body.section):
        raise ApiError(409, "regenerated", "You have already regenerated this section once.")
    if p.get("edited", {}).get(body.section) and not body.confirm:
        raise ApiError(409, "edited", "You changed this section. Replace your changes with a new version?")
    new, ai, notice = await _write(db, auth, p["facts"], p["note"], p["path"], p["share"], body.section, seed=1)
    content = p["content"]
    content[body.section] = new[body.section]
    sets = {
        "pack.content": content,
        f"pack.regen.{body.section}": True,
        f"pack.edited.{body.section}": False,
        "pack.notice": notice,
    }
    # only if nobody else regenerated it in the meantime
    r = await db[LINKEDIN].update_one(
        {"_id": auth.user.id, f"pack.regen.{body.section}": {"$ne": True}}, {"$set": sets}
    )
    if not r.modified_count:
        raise ApiError(409, "regenerated", "You have already regenerated this section once.")
    return _pack_out(await db[LINKEDIN].find_one({"_id": auth.user.id}, {"pack": 1}))


LIMITS = {"headline": pack_rules.HEADLINE_MAX, "about": pack_rules.ABOUT_MAX, "experience": pack_rules.EXP_MAX}


def _check_edit(section: str, value: Any) -> Any:
    """The person's own text: LinkedIn's limits, and no phone / email / ID number in public profile text."""
    texts: list[tuple[str, int]] = []
    if section == "headline":
        if not isinstance(value, dict) or not isinstance(value.get("options"), list):
            raise ApiError(400, "bad_value", "That isn't a headline list.")
        texts = [(str(h), LIMITS["headline"]) for h in value["options"]]
    elif section == "about":
        if not isinstance(value, dict):
            raise ApiError(400, "bad_value", "That isn't an About section.")
        texts = [(str(value.get(k) or ""), LIMITS["about"]) for k in ("simple", "professional", "story")]
    elif section == "experience":
        if not isinstance(value, list):
            raise ApiError(400, "bad_value", "That isn't an experience list.")
        texts = [(str((e or {}).get("text") or ""), LIMITS["experience"]) for e in value]
    elif section == "skills":
        if not isinstance(value, dict) or not isinstance(value.get("ranked"), list):
            raise ApiError(400, "bad_value", "That isn't a skills list.")
        value["ranked"] = [pack_rules.tidy(s)[:60] for s in value["ranked"] if pack_rules.tidy(s)][
            : pack_rules.SKILLS_MAX
        ]
        texts = [(s, 60) for s in value["ranked"]]
    else:
        texts = [(json.dumps(value)[:5000], 5000)]
    for t, limit in texts:
        if len(t) > limit:
            raise ApiError(400, "too_long", f"LinkedIn allows {limit:,} characters here.")
        if (section != "featured" and pack_writer.CONTACT.search(t)) or looks_like_id(t):
            raise ApiError(400, "private", "Remove phone numbers, emails, links and ID numbers from profile text.")
    return value


@router.put("/edit")
async def edit(body: EditIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """Saves the person's own changes to a section; a regenerate never overwrites them without asking."""
    await _owner(db, auth)
    value = _check_edit(body.section, body.value)
    r = await db[LINKEDIN].update_one(
        {"_id": auth.user.id, "pack": {"$type": "object"}},
        {"$set": {f"pack.content.{body.section}": value, f"pack.edited.{body.section}": True}},
    )
    if not r.matched_count:
        raise ApiError(404, "no_pack", "Make your pack first.")
    return _pack_out(await db[LINKEDIN].find_one({"_id": auth.user.id}, {"pack": 1}))
