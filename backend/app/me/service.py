"""Reading and writing the dashboard documents. Every query is scoped to the owner (user_id)."""

import re
import secrets
from datetime import UTC, datetime
from typing import Any

from pymongo import DESCENDING
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.auth.models import User
from app.core.db import ATS_CHECKS, ORDERS, SHARES, USERS
from app.core.time import now
from app.me.schemas import ShareOut

MAX_CHECKS = 100


def ms(dt: datetime | None) -> int | None:
    return int(dt.timestamp() * 1000) if dt else None


def from_ms(v: int) -> datetime:
    return datetime.fromtimestamp(v / 1000, UTC)


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40].strip("-")
    return s if len(s) >= 3 else f"{s or 'me'}-{secrets.randbelow(900) + 100}"


async def referral_code(db: AsyncDatabase, user: User) -> str:
    """The user's code, made on first use: 4 letters of the name + 4 random characters."""
    if user.referral_code:
        return user.referral_code
    letters = (re.sub(r"[^A-Za-z]", "", user.name)[:4] or "NMSV").upper()
    for _ in range(10):
        code = letters + "".join(secrets.choice("23456789ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(4))
        try:
            r = await db[USERS].update_one({"_id": user.id, "referral_code": None}, {"$set": {"referral_code": code}})
        except DuplicateKeyError:
            continue
        if r.modified_count:
            user.referral_code = code
            return code
        fresh = await db[USERS].find_one({"_id": user.id}, {"referral_code": 1})
        user.referral_code = fresh["referral_code"]
        return user.referral_code
    raise RuntimeError("could not make a referral code")


async def referrals(db: AsyncDatabase, user_id: str) -> list[dict[str, Any]]:
    out = []
    async for u in db[USERS].find({"referred_by": user_id}, {"name": 1, "created_at": 1}).sort("created_at", -1):
        paid = {"customer_id": u["_id"], "paid_at": {"$ne": None}}
        bought = await db[ORDERS].find_one(paid)
        status = "bought" if bought else "joined"
        out.append({"name": u["name"].split()[0], "at": ms(u["created_at"]), "status": status})
    return out


async def share_of(db: AsyncDatabase, user: User) -> ShareOut:
    s = await db[SHARES].find_one({"_id": user.id})
    if not s:
        return ShareOut(on=False, slug=slugify(user.name), resume_id=None, hide_phone=False, views=[], view_count=0)
    return ShareOut(
        on=s["on"],
        slug=s["slug"],
        resume_id=s.get("resume_id"),
        hide_phone=s.get("hide_phone", False),
        views=[ms(v) for v in s.get("views", [])],
        view_count=s.get("view_count", 0),
    )


async def add_check(db: AsyncDatabase, user_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    doc = {**fields, "user_id": user_id, "at": now()}
    await db[ATS_CHECKS].insert_one(doc)
    # keep the latest MAX_CHECKS
    old = await db[ATS_CHECKS].find({"user_id": user_id}, {"_id": 1}).sort("at", DESCENDING).skip(MAX_CHECKS).to_list()
    if old:
        await db[ATS_CHECKS].delete_many({"_id": {"$in": [o["_id"] for o in old]}})
    return doc


ENTRY_LISTS = ("exp", "edu", "proj", "certs", "ach", "langs", "skillGroups", "linkExtras")
LINE_SECTIONS = ("hobbies", "strengths")


def _lines(text: Any) -> list[str]:
    if not isinstance(text, str):
        return []
    return [x.strip() for x in re.split(r"\n|,", text) if x.strip()]


def visible_resume(data: dict[str, Any]) -> dict[str, Any]:
    """The resume as printed: entries the owner switched off (`off: true`, or lines listed in `offLines`) are
    removed, so a public link never sends them (same rule as frontend/src/pages/builder/entries.js)."""
    out = dict(data)
    for k in ENTRY_LISTS:
        if isinstance(data.get(k), list):
            out[k] = [x for x in data[k] if not (isinstance(x, dict) and x.get("off") is True)]
    if isinstance(data.get("custom"), list):
        out["custom"] = [
            {**c, "items": [x for x in c.get("items") or [] if not (isinstance(x, dict) and x.get("off") is True)]}
            if isinstance(c, dict)
            else c
            for c in data["custom"]
        ]
    off_lines = data.get("offLines") if isinstance(data.get("offLines"), dict) else {}
    for k in LINE_SECTIONS:
        hidden = {str(x).strip().lower() for x in off_lines.get(k) or []}
        if hidden:
            out[k] = "\n".join(x for x in _lines(data.get(k)) if x.lower() not in hidden)
    out.pop("offLines", None)
    out.pop("prefs", None)  # job preferences (incl. salary) are never printed or shared
    hidden = data.get("hidden") if isinstance(data.get("hidden"), dict) else {}
    if hidden.get("pinfo"):
        out.pop("pinfo", None)  # personal information only when the owner prints it
    return out
