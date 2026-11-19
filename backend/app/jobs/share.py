"""One Share button for every app (job links and the public resume link), and the preview card a shared job link shows.

  POST /api/public/shares {channel}   one tap on Share: only the channels below count, anything else is refused (422).
                                      It only increments a per-day counter per channel ({day, channel, n}): no user id,
                                      no IP address, no cookie, no link. The rate limit keeps a salted hash of the
                                      address for a day, like every other public form; over the limit it is not counted.
  GET  /api/jobs/{slug}/preview       a small HTML page with the job's Open Graph and Twitter tags (title, company,
                                      city, the Nm7 logo) for the link-preview robots of WhatsApp, LinkedIn, Telegram,
                                      Facebook, X … nm7.si/jobs/<slug> is sent here by vercel.json only for those robots
                                      (by their user agent); people get the normal page. Someone who opens this address
                                      directly is sent on to nm7.si/jobs/<slug>. Every job text is HTML-escaped.

Admin → Daily report shows yesterday's shares by channel ("Shares yesterday: 12 (WhatsApp 7, Copy link 3, …)").
"""

from datetime import timedelta
from html import escape
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Request, Response

from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, JOBS, SHARE_EVENTS
from app.core.schemas import CamelModel
from app.core.time import ist_day, now
from app.jobs.model import EXPERIENCE, JOB_TYPES

public = APIRouter(prefix="/api/public", tags=["share"])
preview_router = APIRouter(prefix="/api/jobs", tags=["share"])

CHANNELS = {
    "native": "Phone share",
    "whatsapp": "WhatsApp",
    "linkedin": "LinkedIn",
    "telegram": "Telegram",
    "facebook": "Facebook",
    "x": "X",
    "email": "Email",
    "copy": "Copy link",
}
RULES = [(120, timedelta(hours=1))]
LOGO = "/og-image.png"  # frontend/public/og-image.png (1200 × 630)


class ShareIn(CamelModel):
    channel: Literal["native", "whatsapp", "linkedin", "telegram", "facebook", "x", "email", "copy"]


@public.post("/shares", status_code=204)
async def count_share(body: ShareIn, request: Request, db: DB) -> None:
    key = f"share:{client_ip(request) or '-'}"
    try:
        await rate_limit.check(db, key, RULES)
    except Exception:  # over the limit: just don't count it (a counter never shows an error)
        return None
    await rate_limit.record(db, key)
    day = ist_day()
    await db[SHARE_EVENTS].update_one(
        {"_id": f"{day}:{body.channel}"},
        {"$inc": {"n": 1}, "$setOnInsert": {"day": day, "channel": body.channel}},
        upsert=True,
    )
    return None


async def shares_on(db, day: str) -> dict[str, Any]:
    """One day's shares: {day, total, byChannel, text} — the Daily report's line."""
    by = {r["channel"]: int(r.get("n") or 0) async for r in db[SHARE_EVENTS].find({"day": day})}
    total = sum(by.values())
    parts = [f"{CHANNELS[c]} {by[c]:,}" for c in sorted(by, key=lambda c: (-by[c], list(CHANNELS).index(c))) if by[c]]
    text = f"Shares yesterday: {total:,}" + (f" ({', '.join(parts)})." if parts else ".")
    return {"day": day, "total": total, "byChannel": by, "text": text}


async def shares_yesterday(db) -> dict[str, Any]:
    return await shares_on(db, ist_day(now() - timedelta(days=1)))


# ---------- the preview card ----------


def _clip(s: Any, n: int) -> str:
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _page(*, title: str, desc: str, url: str, image: str, status: int, body: str) -> Response:
    t, d, u, i = (escape(x, quote=True) for x in (title, desc, url, image))
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{t}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{d}">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="{u}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nm7">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{u}">
<meta property="og:image" content="{i}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Nm7">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
<meta name="twitter:image" content="{i}">
</head><body>
{body}
<p><a href="{u}">Open on Nm7</a></p>
<script>location.replace({_js_string(url)})</script>
</body></html>
"""
    return Response(html, status_code=status, media_type="text/html; charset=utf-8",
                    headers={"Cache-Control": "public, max-age=600"})  # fmt: skip


def _js_string(s: str) -> str:
    """A JavaScript string literal that is safe inside a <script> element (the URL is ours, but escape anyway)."""
    out = s.replace("\\", "\\\\").replace('"', '\\"').replace("<", "\\u003c").replace(">", "\\u003e")
    out = out.replace("&", "\\u0026")
    return '"' + out + '"'


@preview_router.get("/{slug}/preview", include_in_schema=False)
async def preview(slug: str, db: DB) -> Response:
    site = get_settings().site_url.rstrip("/")
    image = site + LOGO
    j = await db[JOBS].find_one({"slug": slug[:120], "demo": {"$ne": True}})
    hidden = (
        j and j.get("source") == "collector" and (j["status"] == "review" or j.get("closed_reason") == "outside India")
    )
    if not j or hidden:
        return _page(title="This job isn’t on Nm7 any more · Nm7", desc="See the newest real jobs on Nm7.",
                     url=f"{site}/jobs", image=image, status=404,
                     body="<h1>This job isn’t on Nm7 any more</h1>")  # fmt: skip
    title, company = _clip(j["title"], 90), _clip((j.get("company") or {}).get("name"), 60)
    places = [_clip(x, 30) for x in (j.get("locations") or [])[:3]]
    where = (
        ", ".join(places) + (" or remote" if j.get("remote") and places else "")
        if places
        else ("Remote" if j.get("remote") else "")
    )
    closed = j["status"] != "active" or (j.get("closes_at") and j["closes_at"] <= now())
    facts = [x for x in (where, EXPERIENCE.get(j.get("experience"), ""), JOB_TYPES.get(j.get("job_type"), "")) if x]
    head = f"{'Closed: ' if closed else ''}{title} · {company}" + (f" · {places[0]}" if places else "")
    desc = (
        f"{company} is hiring: {title}."
        + (f" {' · '.join(facts)}." if facts else "")
        + " See the details and apply free on Nm7."
    )
    url = f"{site}/jobs/{quote(j['slug'], safe='')}"
    body = f"<h1>{escape(title)}</h1><p>{escape(company)}{(' · ' + escape(' · '.join(facts))) if facts else ''}</p>"
    return _page(title=head, desc=_clip(desc, 200), url=url, image=image, status=200, body=body)
