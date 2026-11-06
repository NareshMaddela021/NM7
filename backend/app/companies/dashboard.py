"""The company dashboard (Phase 2, C2) and the public company page.

Signed in (header X-Recruiter-Account; any team role can read, main / full admins change):
  GET  /api/company/{id}/overview          live jobs, applicants, the posting allowance, trust level and review
  PUT  /api/company/{id}/page {about, logo}   the company page: about text and logo (a small image, any time);
                                              the website is part of the checked details (locked once verified)
  GET  /api/company/{id}/activity          the company's activity log, newest first
  POST /api/company/{id}/request-change    verified details are locked; this unlocks them and starts a new check
Public:
  GET  /api/companies/{slug}               name, about, website, logo, trust badge and open jobs (Basic or Verified
                                           companies only; never demo, blocked or unconfirmed ones)
  GET  /api/companies/{slug}/logo          the logo image (for search engines; the page itself shows the inline copy)
"""

import base64
import re
from typing import Any

from fastapi import APIRouter, Header, Response
from pydantic import Field, field_validator

from app.audit import audit
from app.companies.limits import posting_room
from app.companies.model import MANAGE, trust_of
from app.companies.signup import _save, company_for
from app.core.db import APPLICATIONS, AUDIT_LOG, COMPANIES, DB, JOBS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.jobs.public import live_filter, public_out
from app.me.service import ms

router = APIRouter(prefix="/api/company", tags=["companies"])
public = APIRouter(prefix="/api/companies", tags=["companies"])

LOGO_RE = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$")
LOGO_MAX = 150_000  # characters of the data URL (the browser shrinks the image to 256 px first)


class PageIn(CamelModel):
    about: str = Field("", max_length=2000)
    logo: str | None = Field(None, max_length=LOGO_MAX)  # a data URL; "" removes it; None keeps it

    @field_validator("logo")
    @classmethod
    def _logo(cls, v: str | None) -> str | None:
        if v and not LOGO_RE.match(v):
            raise ValueError("The logo must be a PNG, JPEG or WebP image.")
        return v


@router.get("/{cid}/overview")
async def overview(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    _, c, m = await company_for(db, cid, x_recruiter_account)
    job_ids = [j["_id"] async for j in db[JOBS].find({"company_id": cid}, {"_id": 1})]
    return {
        "liveJobs": await db[JOBS].count_documents({"company_id": cid, "status": "active"}),
        "jobs": len(job_ids),
        "applicants": await db[APPLICATIONS].count_documents({"job_id": {"$in": job_ids}}) if job_ids else 0,
        "room": await posting_room(db, c),
        "trust": trust_of(c),
        "review": (c.get("review") or {}).get("state", "draft"),
        "myRole": m["role"],
    }


@router.put("/{cid}/page")
async def edit_page(cid: str, body: PageIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    from app.companies.model import company_out

    acc, c, _ = await company_for(db, cid, x_recruiter_account, MANAGE)
    c["details"]["about"] = body.about.strip()
    if body.logo is not None:
        c["logo"] = body.logo or None
    await _save(db, c)
    await audit(db, None, "company.page", target=cid, data={"by": acc["email_lc"], "logo": bool(c.get("logo"))})
    return company_out(c, acc["email_lc"]) | {"logo": c.get("logo") or ""}


@router.get("/{cid}/activity")
async def activity(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> list[dict[str, Any]]:
    await company_for(db, cid, x_recruiter_account)
    rows = await db[AUDIT_LOG].find({"target": cid}).sort("at", -1).limit(100).to_list(None)
    return [{"action": a["action"], "at": ms(a.get("at")), "by": (a.get("data") or {}).get("by", ""),
             "reason": (a.get("data") or {}).get("reason", "")} for a in rows]  # fmt: skip


@router.post("/{cid}/request-change")
async def request_change(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    from app.companies.model import company_out

    acc, c, _ = await company_for(db, cid, x_recruiter_account, MANAGE)
    if (c.get("review") or {}).get("state") != "approved":
        raise ApiError(409, "not_locked", "Your details aren’t locked; edit them in sign-up.")
    c["review"] = {"state": "draft", "reason": "Details being changed"}
    c["verified_until"] = None
    await _save(db, c)
    await audit(db, None, "company.request_change", target=cid, data={"by": acc["email_lc"]})
    return company_out(c, acc["email_lc"])


# ---------- public company page ----------


def _public_ok(c: dict[str, Any] | None) -> bool:
    return bool(c) and not c.get("demo") and trust_of(c) in ("basic", "verified")


@public.get("/{slug}")
async def company_page(slug: str, db: DB) -> dict[str, Any]:
    c = await db[COMPANIES].find_one({"slug": slug[:80]})
    if not _public_ok(c):
        raise ApiError(404, "not_found", "This company isn’t on Nm7.")
    d = c["details"]
    jobs = await db[JOBS].find({"$and": [live_filter(), {"company_id": c["_id"]}]}, {"description": 0}).sort(
        "posted_at", -1
    ).to_list(100)  # fmt: skip
    return {
        "slug": c["slug"],
        "name": d["legal_name"],
        "about": d.get("about", ""),
        "website": d.get("website", "") if c.get("kind") == "company" else "",
        "industry": d.get("industry", ""),
        "size": d.get("size", ""),
        "kind": c.get("kind", "company"),
        "logo": c.get("logo") or "",
        "trust": trust_of(c),
        "score": (c.get("score") or {}).get("value"),
        "parts": (c.get("score") or {}).get("parts") or [],
        "replyDays": (c.get("score") or {}).get("replyDays"),
        "jobs": [public_out(j) for j in jobs],
    }


@public.get("/{slug}/logo")
async def company_logo(slug: str, db: DB) -> Response:
    c = await db[COMPANIES].find_one({"slug": slug[:80]}, {"logo": 1, "demo": 1, "review": 1, "emails": 1, "kind": 1})
    m = LOGO_RE.match((c or {}).get("logo") or "") if _public_ok(c) else None
    if not m:
        raise ApiError(404, "not_found", "No logo.")
    return Response(base64.b64decode(m.group(2)), media_type=f"image/{m.group(1)}",
                    headers={"Cache-Control": "public, max-age=86400"})  # fmt: skip
