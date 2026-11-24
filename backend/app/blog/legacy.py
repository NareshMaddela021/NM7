"""The older blog articles (Hygraph project "Team Nm7", model BlogPost), read-only, for nm7.si/blog.

Read with HYGRAPH_TOKEN (a read-only Permanent Auth Token, kept on this server; never in the browser, a log or an
answer) from the PUBLISHED stage only. Each post is turned into the shape the site's own posts have (Rich Text AST in
`content`), rebranded for nm7.si (app/blog/rebrand.py), and duplicates (same slug or same title) are dropped, keeping
the newer one. The result is kept in memory for BLOG_CACHE_MINUTES: the site build (frontend/scripts/
prerender-blog.mjs) reads it and pre-renders every article; a failed refresh keeps serving the last good copy.

  GET /api/blog/legacy             the articles, newest first (?page, ?per_page, ?q, ?category, ?content=1)
  GET /api/blog/legacy/{slug}      one article (an old slug that moved answers with the article it moved to)
  GET /api/admin/blog/flags        asuraa.ai / "Asuraa AI" mentions left as they are, for a person to check
  python -m app.blog.flags         the same list on the command line
"""

import asyncio
import json
import logging
import math
import re
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, Query, Response

from app.admin.deps import AdminAuth
from app.blog.markdown import markdown_to_ast
from app.blog.rebrand import RENAMED_SLUGS, Linker, find_mentions, norm_title, scrub, walk_strings
from app.core.config import get_settings
from app.core.errors import ApiError

log = logging.getLogger("nm7.blog")

router = APIRouter(prefix="/api/blog", tags=["blog"])
admin = APIRouter(prefix="/api/admin/blog", tags=["blog"])

HTTP_CLIENT: httpx.AsyncClient | None = None  # tests put a mock transport here
PAGE_SIZE = 100  # Hygraph's largest page
RETRY_AFTER = 300  # seconds: a failed first load is tried again after this long
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$", re.IGNORECASE)

FIELDS = "id title slug excerpt seoTitle metaDescription category body faq publishedAt updatedAt createdAt"
POSTS_QUERY = (
    "query LegacyPosts($first: Int!, $skip: Int!) { "
    f"blogPosts(stage: PUBLISHED, orderBy: publishedAt_DESC, first: $first, skip: $skip) {{ {FIELDS} }} }}"
)


class HygraphError(Exception):
    pass


async def _query(client: httpx.AsyncClient, query: str, variables: dict[str, Any]) -> dict[str, Any]:
    s = get_settings()
    headers = {"Authorization": f"Bearer {s.hygraph_token}", "Content-Type": "application/json"}
    try:
        r = await client.post(s.hygraph_endpoint, json={"query": query, "variables": variables}, headers=headers)
    except httpx.HTTPError as e:
        raise HygraphError(f"network error ({type(e).__name__})") from None
    try:
        body = r.json()
    except ValueError:
        body = None
    errors = [str(e.get("message", "")) for e in (body or {}).get("errors") or [] if isinstance(e, dict)]
    if r.status_code != 200 or errors or not isinstance(body, dict) or not body.get("data"):
        raise HygraphError(f"HTTP {r.status_code}" + (f": {'; '.join(errors)[:300]}" if errors else ""))
    return body["data"]


async def fetch_raw() -> list[dict[str, Any]]:
    """Every published BlogPost, as Hygraph stores it."""
    posts: list[dict[str, Any]] = []
    client = HTTP_CLIENT or httpx.AsyncClient(timeout=30)
    try:
        for skip in range(0, 20_000, PAGE_SIZE):
            d = await _query(client, POSTS_QUERY, {"first": PAGE_SIZE, "skip": skip})
            page = d.get("blogPosts")
            if not isinstance(page, list):
                raise HygraphError("the answer has no blogPosts list")
            posts.extend(p for p in page if isinstance(p, dict))
            if len(page) < PAGE_SIZE:
                break
    finally:
        if client is not HTTP_CLIENT:
            await client.aclose()
    return posts


def _slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("&", " and ")).strip("-")


def _clean_body(body: str | None) -> str:
    """The stored Markdown without its first "Last updated · By the Asuraa Team" line (the site prints its own)."""
    lines = re.sub(r"\r\n?", "\n", body or "").split("\n")
    first = next((i for i, line in enumerate(lines) if line.strip()), None)
    if first is not None and re.match(r"^\*?\s*Last updated:.*\*?\s*$", lines[first].strip(), re.IGNORECASE):
        del lines[first]
    return "\n".join(lines)


def _when(p: dict[str, Any]) -> str:
    return str(p.get("updatedAt") or p.get("publishedAt") or "")


def _size(p: dict[str, Any]) -> int:
    return len(str(p.get("body") or ""))


def dedupe(raw: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """One post per slug and per title (rebranded): the newer one stays (then the longer one). Returns the posts and
    {dropped slug: kept slug}. The old About Asuraa slugs that were rewritten for Nm7 are dropped too."""
    aliases: dict[str, str] = {}
    keep: dict[str, dict[str, Any]] = {}  # by title key
    order = sorted(raw, key=lambda p: (_when(p), _size(p)), reverse=True)
    seen_slugs: dict[str, str] = {}
    for p in order:
        slug = str(p.get("slug") or "").strip().lower()
        if not slug or not SLUG.match(slug):
            continue
        if slug in RENAMED_SLUGS:
            aliases[slug] = RENAMED_SLUGS[slug]
            continue
        if slug in seen_slugs:
            continue  # an older copy of a slug we already have
        key = norm_title(p.get("title")) or slug
        if key in keep:
            aliases[slug] = keep[key]["slug"].lower()
            continue
        keep[key] = p
        seen_slugs[slug] = slug
    return list(keep.values()), aliases


def normalize(p: dict[str, Any], linker: Linker) -> dict[str, Any]:
    """A Team Nm7 BlogPost -> the post shape the site uses, rebranded."""
    content = linker.ast(markdown_to_ast(_clean_body(p.get("body"))))
    faq = [
        {"question": linker.text(str(q["question"])), "answer": linker.text(str(q["answer"]))}
        for q in (p.get("faq") if isinstance(p.get("faq"), list) else [])
        if isinstance(q, dict) and q.get("question") and q.get("answer")
    ]
    cat = linker.text(str(p.get("category") or "").strip())
    post = {
        "id": p.get("id"),
        "slug": str(p["slug"]).strip().lower(),
        "title": linker.text(p.get("title")),
        "excerpt": linker.text(p.get("excerpt")),
        "seoTitle": linker.text(p.get("seoTitle")),
        "seoDescription": linker.text(p.get("metaDescription")),
        "cover": None,
        "category": {"name": cat, "slug": _slugify(cat)} if cat and _slugify(cat) else None,
        "author": None,  # shown and marked up as the Nm7 Team
        "publishedAt": p.get("publishedAt") or p.get("createdAt"),
        "updatedAt": p.get("updatedAt") or p.get("publishedAt") or p.get("createdAt"),
        "content": content,
        "faq": faq,
        "source": "legacy",
    }
    return scrub(post)


def flags(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every asuraa.ai / "Asuraa AI" / "AsuraaX" mention in the published posts (left unchanged on nm7.si)."""
    out = []
    for p in raw:
        slug = str(p.get("slug") or "").lower()
        found: list[dict[str, str]] = []

        def visit(key: str, value: str, found: list[dict[str, str]] = found) -> None:
            for snip in find_mentions(value):
                found.append({"field": key or "text", "text": snip})

        for field in ("title", "excerpt", "seoTitle", "metaDescription", "category", "body", "faq"):
            walk_strings(p.get(field), visit, field)
        for f in found:
            out.append(
                {"slug": slug, "title": Linker().text(p.get("title")), "url": f"https://nm7.si/blog/{slug}", **f}
            )
    return out


def build(raw: list[dict[str, Any]]) -> dict[str, Any]:
    kept, aliases = dedupe(raw)
    linker = Linker((str(p["slug"]).lower() for p in kept), aliases)
    posts = sorted((normalize(p, linker) for p in kept), key=lambda p: str(p.get("publishedAt") or ""), reverse=True)
    return {"posts": posts, "aliases": aliases, "flags": flags(raw), "found": len(raw)}


class _Cache:
    def __init__(self) -> None:
        self.data: dict[str, Any] | None = None
        self.at = 0.0
        self.error: str | None = None
        self.fetched_at: str | None = None
        self.lock = asyncio.Lock()

    def reset(self) -> None:
        self.__init__()


CACHE = _Cache()


async def blog() -> dict[str, Any]:
    """The rebranded, deduplicated older articles (cached). Never raises: a failure keeps the last good copy."""
    s = get_settings()
    if not s.hygraph_token:
        return {"configured": False, "posts": [], "aliases": {}, "flags": [], "found": 0, "error": None}
    ttl = max(1, s.blog_cache_minutes) * 60
    if CACHE.data is None or time.monotonic() - CACHE.at >= ttl:
        async with CACHE.lock:
            if CACHE.data is None or time.monotonic() - CACHE.at >= ttl:
                try:
                    CACHE.data = build(await fetch_raw())
                    CACHE.at = time.monotonic()
                    CACHE.error = None
                    CACHE.fetched_at = datetime.now(UTC).isoformat()
                    log.info("blog: read %s older articles from Hygraph", len(CACHE.data["posts"]))
                except Exception as e:  # noqa: BLE001  (Hygraph down or the token refused: keep what we have)
                    CACHE.error = str(e) if isinstance(e, HygraphError) else type(e).__name__
                    log.warning("blog: reading the older articles failed: %s", CACHE.error)
                    # try again in a few minutes, not on every request
                    CACHE.at = time.monotonic() - ttl + min(RETRY_AFTER, ttl)
                    if CACHE.data is None:
                        CACHE.data = {"posts": [], "aliases": {}, "flags": [], "found": 0}
    return {"configured": True, **CACHE.data, "error": CACHE.error, "fetchedAt": CACHE.fetched_at}


def _summary(p: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in p.items() if k not in ("content", "faq")}


def _matches(p: dict[str, Any], q: str) -> bool:
    hay = " ".join(str(p.get(k) or "") for k in ("title", "excerpt")) + " " + str((p.get("category") or {}).get("name"))
    return all(w in hay.lower() for w in q.lower().split())


@router.get("/legacy")
async def legacy_posts(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    q: str = Query("", max_length=100),
    category: str = Query("", max_length=80),
    content: bool = False,
) -> Response:
    b = await blog()
    posts = [p for p in b["posts"] if (not category or (p.get("category") or {}).get("slug") == category)]
    if q.strip():
        posts = [p for p in posts if _matches(p, q)]
    cats = {c["slug"]: c for p in b["posts"] if (c := p.get("category"))}
    start = (page - 1) * per_page
    body = {
        "configured": b["configured"],
        "error": b["error"],
        "total": len(posts),
        "page": page,
        "pages": max(1, math.ceil(len(posts) / per_page)),
        "posts": [p if content else _summary(p) for p in posts[start : start + per_page]],
        "categories": sorted(cats.values(), key=lambda c: c["name"].lower()),
        "aliases": b["aliases"],
    }
    return Response(
        json.dumps(body, ensure_ascii=False),
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.get("/legacy/{slug}")
async def legacy_post(slug: str) -> dict[str, Any]:
    b = await blog()
    s = slug.lower()
    s = b["aliases"].get(s, s)
    post = next((p for p in b["posts"] if p["slug"] == s), None)
    if not post:
        raise ApiError(404, "not_found", "There is no such article.")
    return post


@admin.get("/flags")
async def legacy_flags(_: AdminAuth("dashboard")) -> dict[str, Any]:
    b = await blog()
    return {"configured": b["configured"], "error": b["error"], "count": len(b["flags"]), "flags": b["flags"]}
