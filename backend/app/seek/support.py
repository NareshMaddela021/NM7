"""Phase 6 S9: special filters, "hide me from my current employer", and the policies companies declare.

Companies may describe, in their own words, three policies on their page (Company dashboard → Company page):
inclusive (women-friendly / inclusive employer), accessible (accessible workplace) and returners (welcomes people
returning after a break). They are shown as the company's text, never as Nm7's claim; Admin can remove one.

  /jobs filters (support=returners,immediate,inclusive,accessible) and Hire now filters (immediate, returners)
  POST /api/admin/companies/{cid}/policies/{key}/remove        Admin removes a declared policy

A candidate's "hide me from" list (company names or website domains) keeps them out of those companies' Hire now
shortlist and applicant views.
"""

import re
from typing import Any

from fastapi import APIRouter

from app.admin.deps import AdminAuth
from app.audit import audit
from app.core.db import COMPANIES, DB, HIRE_PROFILES
from app.core.errors import ApiError
from app.core.time import IST, now

admin = APIRouter(prefix="/api/admin/companies", tags=["job seekers"])

POLICIES = ("inclusive", "accessible", "returners")
SUPPORT = ("returners", "immediate", "inclusive", "accessible")
IMMEDIATE = re.compile(r"immediate(ly)?\s+join", re.I)


def policies_out(c: dict[str, Any] | None) -> dict[str, str]:
    """The declared policies still shown ({key: text})."""
    out = {}
    for k, v in ((c or {}).get("policies") or {}).items():
        if k in POLICIES and v.get("text") and not v.get("removed"):
            out[k] = v["text"]
    return out


def set_policies(c: dict[str, Any], given: dict[str, str] | None) -> None:
    """Save what the company typed; a policy Admin removed stays removed until the company changes its text."""
    if given is None:
        return
    old = c.get("policies") or {}
    new: dict[str, Any] = {}
    for k in POLICIES:
        text = " ".join(str(given.get(k) or "").split())[:300]
        if not text:
            continue
        was = old.get(k) or {}
        new[k] = {"text": text, "removed": bool(was.get("removed")) and was.get("text") == text}
    c["policies"] = new


async def companies_with(db, key: str) -> list[str]:
    q = {f"policies.{key}.text": {"$nin": [None, ""]}, f"policies.{key}.removed": {"$ne": True}}
    return [c["_id"] async for c in db[COMPANIES].find(q, {"_id": 1})]


async def job_filters(db, support: str) -> list[dict[str, Any]]:
    """Extra conditions for /jobs."""
    wanted = [s for s in (x.strip() for x in support.split(",")) if s in SUPPORT]
    out: list[dict[str, Any]] = []
    for s in wanted:
        if s == "immediate":
            out.append({"$or": [{"immediate": True}, {"title": {"$regex": IMMEDIATE.pattern, "$options": "i"}},
                                {"description": {"$regex": IMMEDIATE.pattern, "$options": "i"}}]})  # fmt: skip
        else:
            out.append({"company_id": {"$in": await companies_with(db, s)}})
    return out


def domain(url: str) -> str:
    return re.sub(r"^https?://", "", (url or "").lower()).split("/")[0].removeprefix("www.")


def hidden_from(profile: dict[str, Any] | None, c: dict[str, Any]) -> bool:
    """True when the candidate asked to be hidden from this company (name or website domain)."""
    items = [x.lower().strip() for x in (profile or {}).get("hide_from") or [] if x.strip()]
    if not items:
        return False
    name = ((c.get("details") or {}).get("legal_name") or c.get("name") or "").lower()
    site = domain((c.get("details") or {}).get("website") or "")
    for it in items:
        d = domain(it) if "." in it else ""
        if (d and site and (site == d or site.endswith("." + d))) or (not d and len(it) >= 3 and it in name):
            return True
    return False


async def hidden_users(db, c: dict[str, Any], uids: list[str]) -> set[str]:
    """Which of these candidates hid themselves from company `c`."""
    out = set()
    async for p in db[HIRE_PROFILES].find({"_id": {"$in": uids}, "hide_from.0": {"$exists": True}}, {"hide_from": 1}):
        if hidden_from(p, c):
            out.add(p["_id"])
    return out


def immediate(p: dict[str, Any]) -> bool:
    """Can join within a week: no notice, or a join date in the next 7 days."""
    if not int(p.get("notice_days") or 0) and not p.get("join_date"):
        return True
    jd = p.get("join_date")
    if jd:
        today = now().astimezone(IST).date()
        try:
            from datetime import date

            return (date.fromisoformat(jd) - today).days <= 7
        except ValueError:
            return False
    return int(p.get("notice_days") or 0) <= 7


@admin.post("/{cid}/policies/{key}/remove")
async def remove_policy(cid: str, key: str, db: DB, auth: AdminAuth("companies")) -> dict[str, Any]:
    if key not in POLICIES:
        raise ApiError(404, "not_found", "No such policy.")
    r = await db[COMPANIES].update_one(
        {"_id": cid, f"policies.{key}.text": {"$exists": True}}, {"$set": {f"policies.{key}.removed": True}}
    )
    if not r.matched_count:
        raise ApiError(404, "not_found", "This company hasn't declared that policy.")
    await audit(db, auth.user.id, "company.policy_removed", target=cid, data={"key": key})
    return {"removed": key}
