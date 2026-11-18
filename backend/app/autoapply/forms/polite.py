"""Polite fetching for company application forms (Auto Apply 2.0, A5). The same rules as the job collector's
polite.py (another repository), ported to async httpx for the API server:

- an honest User-Agent with a link explaining the bot (UA);
- never a job board (JOB_BOARDS, the collector's list and more), never a private / local address;
- robots.txt is read first and obeyed, for our user agent and for "*" (a forbidden robots.txt = the site is off limits);
- at least DELAY seconds between two requests to the same site, and one request at a time per site;
- a daily cap per site on requests (REQUESTS_PER_DAY) and on submitted applications (SUBMITS_PER_DAY);
- timeouts on every request, at most MAX_BYTES read from any answer, no automatic redirects (each hop is checked);
- a site that answers 403 or 429 is left alone (the caller remembers it as one-tap only).

Nothing here runs a browser, executes JavaScript, logs in, creates accounts or touches a CAPTCHA.
"""

import asyncio
import ipaddress
import socket
import time
import urllib.robotparser
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.core.db import FORM_SITES
from app.core.time import now

UA = "Nm7-AutoApply/1.0 (+https://nm7.si/bot)"
DELAY = 5.0  # seconds between two requests to the same site
TIMEOUT = httpx.Timeout(15.0, connect=10.0)
MAX_BYTES = 1_500_000
REQUESTS_PER_DAY = 30  # per site, every request counted (robots.txt, the page, the terms, the submit, redirects)
SUBMITS_PER_DAY = 10  # per site, applications submitted (all candidates together)
TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests put an httpx.MockTransport here: never the network
SLEEP = asyncio.sleep  # tests replace it to see the waits without waiting
CLOCK = time.monotonic

JOB_BOARDS = (
    "linkedin.", "naukri.", "indeed.", "glassdoor.", "monster.", "foundit.", "shine.com", "timesjobs.",
    "internshala.", "apna.co", "workindia.", "quikr.", "freshersworld.", "hirist.", "instahyre.", "cutshort.",
    "wellfound.", "angel.co", "iimjobs.", "jobhai.", "unstop.", "simplyhired.", "ziprecruiter.", "careerbuilder.",
    "jooble.", "talent.com", "adzuna.", "jobrapido.", "jobsora.", "whatjobs.", "placementindia.", "olx.",
    "facebook.", "instagram.", "telegram.", "whatsapp.", "t.me", "twitter.", "x.com", "hirect.", "jobsforher.",
    "updazz.", "fresherworld.", "careesma.", "clickindia.", "jobstreet.", "seek.com", "reed.co.uk", "dice.com",
    "stepstone.", "naukrigulf.", "bayt.",
)  # fmt: skip
# hiring systems and form builders: not the company's own site (the A4 partners go through their official APIs)
HOSTED = (
    "myworkdayjobs.", "workday.", "greenhouse.io", "lever.co", "smartrecruiters.", "zohorecruit.", "zoho.",
    "darwinbox.", "icims.", "taleo.", "successfactors.", "oraclecloud.", "freshteam.", "keka.", "ashbyhq.",
    "bamboohr.", "recruitee.", "workable.", "jobvite.", "breezy.hr", "teamtailor.", "personio.", "superset.",
    "forms.gle", "docs.google.com", "forms.office.com", "forms.microsoft.com", "typeform.", "jotform.", "tally.so",
    "airtable.", "notion.site", "notion.so", "hubspot.", "wufoo.", "cognitoforms.", "formstack.",
)  # fmt: skip

_last: dict[str, float] = {}
_locks: dict[str, asyncio.Lock] = {}


class Refused(Exception):
    """A request the rules don't allow (never sent). str() is only the kind."""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


def host_of(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""


def site_of(url_or_host: str) -> str:
    """The key a site is remembered by: its host without "www."."""
    h = host_of(url_or_host) if "/" in url_or_host else url_or_host.lower()
    return h.removeprefix("www.")


def _match(h: str, b: str) -> bool:
    """ "linkedin." matches linkedin.com and in.linkedin.com; "shine.com" matches shine.com and www.shine.com (never
    a longer name that only contains it, such as myshine.com)."""
    if b.endswith("."):
        return h.startswith(b) or ("." + b) in h
    return h == b or h.endswith("." + b)


def is_job_board(url_or_host: str) -> bool:
    h = site_of(url_or_host)
    return any(_match(h, b) for b in JOB_BOARDS)


def is_hosted(url_or_host: str) -> bool:
    h = site_of(url_or_host)
    return any(_match(h, b) for b in HOSTED) or "docs.google.com" in url_or_host.lower()


async def public_host(host: str) -> bool:
    """Only public internet addresses (no localhost, private, link-local or metadata addresses)."""
    if not host or host == "localhost" or host.endswith((".local", ".internal", ".localhost", ".invalid")):
        return False
    try:
        ipaddress.ip_address(host)
        addrs = [host]
    except ValueError:
        try:
            infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
        except OSError:
            return False
        addrs = [i[4][0] for i in infos]
    for a in addrs:
        ip = ipaddress.ip_address(a.split("%")[0])
        if not ip.is_global or ip.is_multicast:
            return False
    return bool(addrs)


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=TIMEOUT,
        transport=TRANSPORT,
        follow_redirects=False,
        headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
                 "Accept-Language": "en-IN,en;q=0.8"},
    )  # fmt: skip


def _lock(host: str) -> asyncio.Lock:
    if host not in _locks:
        _locks[host] = asyncio.Lock()
    return _locks[host]


async def _count(db, site: str, field: str, cap: int) -> bool:
    """Take one from today's allowance for this site (atomic). False when today's cap is used."""
    from app.autoapply.engine import today

    day = today()
    await db[FORM_SITES].update_one(
        {"_id": site, "day": {"$ne": day}}, {"$set": {"day": day, "requests_today": 0, "submits_today": 0}}
    )
    r = await db[FORM_SITES].update_one(
        {"_id": site, "day": day, field: {"$lt": cap}}, {"$inc": {field: 1}, "$set": {"last_request_at": now()}}
    )
    return bool(r.modified_count)


async def submits_left(db, site: str) -> bool:
    from app.autoapply.engine import today

    doc = await db[FORM_SITES].find_one({"_id": site}, {"day": 1, "submits_today": 1, "requests_today": 1}) or {}
    if doc.get("day") != today():
        return SUBMITS_PER_DAY > 0 and REQUESTS_PER_DAY > 1
    return int(doc.get("submits_today") or 0) < SUBMITS_PER_DAY and int(doc.get("requests_today") or 0) < (
        REQUESTS_PER_DAY - 1
    )


class Answer:
    """What came back: status, final URL of this hop, headers and the text (at most MAX_BYTES)."""

    def __init__(self, status: int, url: str, headers: httpx.Headers, text: str):
        self.status = status
        self.url = url
        self.headers = headers
        self.text = text

    @property
    def location(self) -> str:
        return self.headers.get("location") or ""


async def request(db, http: httpx.AsyncClient, method: str, url: str, submit: bool = False, **kw: Any) -> Answer:
    """One polite request. Raises Refused before sending anything the rules forbid."""
    host = host_of(url)
    site = site_of(host)
    if not host or urlsplit(url).scheme not in ("http", "https"):
        raise Refused("not_web")
    if is_job_board(url):
        raise Refused("job_board")
    if TRANSPORT is None and not await public_host(host):
        raise Refused("private")
    if not await _count(db, site, "requests_today", REQUESTS_PER_DAY):
        raise Refused("daily_cap")
    if submit and not await _count(db, site, "submits_today", SUBMITS_PER_DAY):
        raise Refused("daily_cap")
    async with _lock(site):  # one request at a time per site
        wait = DELAY - (CLOCK() - _last.get(site, -1e9))
        if wait > 0:
            await SLEEP(wait)
        try:
            async with http.stream(method, url, **kw) as r:
                buf = bytearray()
                async for chunk in r.aiter_bytes():
                    buf += chunk
                    if len(buf) >= MAX_BYTES:
                        break
                enc = r.charset_encoding or "utf-8"
                return Answer(r.status_code, str(r.url), r.headers, bytes(buf[:MAX_BYTES]).decode(enc, "replace"))
        finally:
            _last[site] = CLOCK()


# ---------- robots.txt ----------


def robots_parser(text: str) -> urllib.robotparser.RobotFileParser:
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(text.splitlines())
    return rp


def robots_allow(text: str | None, url: str) -> bool:
    """None = robots.txt was forbidden (401 / 403): off limits. Our own agent's group first, else "*"."""
    if text is None:
        return False
    return robots_parser(text).can_fetch(UA, url)


async def fetch_robots(db, http: httpx.AsyncClient, url: str) -> tuple[str, str | None]:
    """→ (kind, text). kind "ok" (text may be "" for no robots.txt), "forbidden" (401 / 403), "unreachable"."""
    parts = urlsplit(url)
    where = f"{parts.scheme}://{parts.netloc}/robots.txt"
    try:
        for _ in range(3):  # a redirect to https / www on the same site is followed
            r = await request(db, http, "GET", where)
            nxt = str(httpx.URL(where).join(r.location)) if 300 <= r.status < 400 and r.location else ""
            if not nxt or site_of(host_of(nxt)) != site_of(parts.hostname or ""):
                break
            where = nxt
    except httpx.HTTPError:
        return "unreachable", None
    if r.status in (401, 403):
        return "forbidden", None
    if r.status == 429 or r.status >= 500:
        return "unreachable", None
    if r.status >= 400 or 300 <= r.status < 400:  # 404 and friends: no robots.txt, everything allowed
        return "ok", ""
    return "ok", r.text[:100_000]
