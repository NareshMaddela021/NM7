"""Expert applications: the profile form, the review steps and the test task.

The profile is stored as the browser sends it, except payout details (UPI, bank account, PAN), which are encrypted
and only shown in full to the expert; admins see them masked."""

import json
import re
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import EXPERT_PROFILES, ORDER_WORK, USERS
from app.core.errors import ApiError
from app.core.security import decrypt, encrypt
from app.core.time import now

# draft → review → (changes → review) → test → testReview → approved; or rejected
STATUSES = ("draft", "review", "changes", "test", "testReview", "approved", "rejected")
EDITABLE = ("draft", "changes", "approved", "test")
MAX_PROFILE = 1_500_000  # bytes of JSON (the photo is the big part)
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


def size_ok(v: Any, limit: int = MAX_PROFILE) -> None:
    if len(json.dumps(v, ensure_ascii=False).encode()) > limit:
        raise ApiError(413, "too_large", "That’s too large. Use a smaller photo or fewer samples.")


def seal_payout(payout: dict[str, Any]) -> str:
    return encrypt(json.dumps(payout))


def open_payout(token: str | None) -> dict[str, Any]:
    return json.loads(decrypt(token)) if token else {}


def _mask(v: str) -> str:
    v = str(v or "")
    return "" if not v else ("•" * max(0, len(v) - 4)) + v[-4:]


def masked_payout(p: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in p.items() if k in ("method", "bankName", "reuseAi")}
    for k in ("upi", "account", "ifsc", "pan"):
        out[k] = _mask(p.get(k, ""))
    return out


def issues(p: dict[str, Any], payout: dict[str, Any]) -> list[str]:
    """Server-side copy of the checks that block "Submit for review" (frontend: lib/expert.js expertIssues)."""
    about, expertise, proof = p.get("about") or {}, p.get("expertise") or {}, p.get("proof") or {}
    out = []
    if not str(about.get("name", "")).strip():
        out.append("Add your full name.")
    if len(str(about.get("bio", "")).strip()) < 150:
        out.append("Bio needs at least 150 characters.")
    if not about.get("languages"):
        out.append("Pick at least one language.")
    if not expertise.get("domains"):
        out.append("Pick at least one domain.")
    if not any((e or {}).get("role") or (e or {}).get("company") for e in proof.get("experience") or []):
        out.append("Add at least one job or role.")
    if not payout.get("reuseAi"):
        if payout.get("method") == "upi" and not payout.get("upi"):
            out.append("Add your UPI ID for payouts.")
        if payout.get("method") == "bank" and not (payout.get("account") and payout.get("ifsc")):
            out.append("Add bank account number and IFSC.")
    if not PAN_RE.match(str(payout.get("pan", "")).upper()):
        out.append("Add a valid PAN.")
    if not p.get("agree"):
        out.append("Accept the expert agreement.")
    return out


async def load_profile(db: AsyncDatabase, user_id: str) -> dict[str, Any] | None:
    return await db[EXPERT_PROFILES].find_one({"_id": user_id})


async def load_profiles(db: AsyncDatabase, user_ids: list[str]) -> list[dict[str, Any]]:
    """The profiles of many experts in one query (the admin's experts page); missing ones are simply absent."""
    return await db[EXPERT_PROFILES].find({"_id": {"$in": list(user_ids)}}).to_list(None) if user_ids else []


async def active_order_counts(db: AsyncDatabase, user_ids: list[str]) -> dict[str, int]:
    """Accepted orders per expert, for many experts in one query: {expert_id: n} (experts with none are absent)."""
    if not user_ids:
        return {}
    pipeline = [
        {"$match": {"expert_id": {"$in": list(user_ids)}, "accepted_at": {"$ne": None}}},
        {"$group": {"_id": "$expert_id", "n": {"$sum": 1}}},
    ]
    return {d["_id"]: d["n"] async for d in await db[ORDER_WORK].aggregate(pipeline)}


def profile_out(doc: dict[str, Any] | None, *, for_admin: bool) -> dict[str, Any] | None:
    if not doc:
        return None
    payout = open_payout(doc.get("payout_enc"))
    p = dict(doc.get("profile") or {})
    p["payout"] = masked_payout(payout) if for_admin else payout
    p["status"] = doc["status"]
    p["note"] = doc.get("note", "")
    p["test"] = doc.get("test")
    p["userId"] = doc["_id"]
    return p


async def set_status(db: AsyncDatabase, user_id: str, status: str, extra: dict[str, Any] | None = None) -> None:
    """The application's status is mirrored on the account (it decides which expert pages open)."""
    t = now()
    await db[EXPERT_PROFILES].update_one(
        {"_id": user_id}, {"$set": {"status": status, "updated_at": t, **(extra or {})}}
    )
    await db[USERS].update_one({"_id": user_id}, {"$set": {"expert_status": status, "updated_at": t}})
