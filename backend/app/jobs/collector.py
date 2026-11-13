# ruff: noqa: E501  (lists of hosts and words, one line each)
"""Round J: the morning job-collector (GitHub Actions) posts India jobs it found on company hiring systems straight to
nm7.si. No browser, no admin sign-in: one key.

  POST /api/jobs/collector        Authorization: Bearer <JOB_INGEST_KEY>
       {"jobs": [{company, title, apply_url, location, posted, exp_min, exp_max, exp_text, system, page_text?,
                  status?}], "dryRun": false}                       at most 200 jobs a request (25 is a good batch)
       → {created, updated, skipped, review, closed, rejected, rejectedBy: {reason: n}, results: [...]}
  POST /api/jobs/collector/close  {"urls": [...]}                    the daily link check: close jobs whose link is dead
       → {closed, notFound}

Rules (each job on its own; one bad job never stops the others):
- Only India, only an official hiring system or a company's own careers site: job boards (LinkedIn, Naukri, Indeed …),
  forms (Google, Microsoft), Notion pages and staffing agencies are refused. Every experience level is welcome
  (round J2, freshers to 15+ years): exp_min maps to internship · fresher · 0_1 · 1_3 · 3_5 · 5_8 · 8_12 · 12_15 ·
  15_plus; without years the title is a hint (Senior → 5–8 …); otherwise "Experience not stated" (still goes live).
- Duplicates: the same normalised apply link (lower case, no scheme, www, query or trailing slash), else the same
  company + title. Sending a job again updates it; a job closed on a removal request is never reopened.
- Never the company's description word for word: page_text (the official page's text) is used once, to write a short
  original summary (300–900 characters) with Claude: what the role does, key skills, eligibility, place and work
  type, facts only from the page. page_text is never stored; emails and phone numbers are removed from everything
  kept. Without usable page_text, or when the summary fails a check, the job waits in Admin → Jobs for review (not
  live) rather than being made up.
- Shown as "Source: company careers page" with Apply to the official link; never a company logo, never "partner".
- Source "collector" (Admin → Jobs → Job collector). Rate limited; the key is compared in constant time and never
  logged or echoed.
"""

import asyncio
import hashlib
import json
import logging
import re
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from pydantic.alias_generators import to_camel

from app.audit import audit
from app.auth.models import new_id
from app.core import ai_quota, claude, rate_limit
from app.core.config import get_settings
from app.core.db import DB, JOBS
from app.core.errors import ApiError
from app.core.time import now
from app.jobs.ingest import BAD_KEY_RULES, _key_ok
from app.jobs.model import JobIn, _fold, band_for_years, slug_for, to_doc
from app.jobsearch import skills as dictionary
from app.jobsearch.parse import CITIES

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/jobs/collector", tags=["job board"])

MAX_JOBS = 200
MAX_BODY = 6_000_000
RULES = [(240, 3600), (1500, 86400)]  # requests per hour / per day (batches of 25 → ~40 a morning)
SUMMARY_MIN, SUMMARY_MAX = 300, 900
PAGE_MIN = 300  # page_text shorter than this is too thin to summarise honestly
PARALLEL = 6
# summaries a day for the collector, counted apart from people's AI use: Admin → Settings (seek.collector_ai_daily)

# hosts that are never a company's own hiring page
BOARDS = (
    "linkedin.",
    "naukri.",
    "indeed.",
    "glassdoor.",
    "monster.",
    "foundit.",
    "shine.com",
    "timesjobs.",
    "internshala.",
    "apna.co",
    "workindia.",
    "quikr.",
    "freshersworld.",
    "hirist.",
    "instahyre.",
    "cutshort.",
    "wellfound.",
    "angel.co",
    "iimjobs.",
    "jobhai.",
    "unstop.",
    "simplyhired.",
    "ziprecruiter.",
    "careerbuilder.",
    "jooble.",
    "talent.com",
    "adzuna.",
    "jobrapido.",
    "jobsora.",
    "whatjobs.",
    "placementindia.",
    "olx.",
    "facebook.",
    "instagram.",
    "telegram.",
    "whatsapp.",
    "t.me",
)
FORMS = (
    "forms.gle",
    "docs.google.com/forms",
    "forms.office.com",
    "forms.microsoft.com",
    "notion.site",
    "notion.so",
    "typeform.com",
    "jotform.",
    "tally.so",
    "airtable.com",
)
STAFFING = (
    "teamlease",
    "quess",
    "randstad",
    "adecco",
    "manpowergroup",
    "manpower group",
    "kelly services",
    "allegis",
    "collabera",
    "careernet",
    "abc consultants",
    "ciel hr",
    "taggd",
    "xpheno",
    "staffing",
    "placement consultant",
    "recruitment agency",
    "manpower consultan",
    "hr consultan",
)
# "Staff Nurse" and "Management Trainee" are junior roles: "staff" only before an engineering word, no "management"
JUNIOR_MANAGER = re.compile(r"\b(assistant|associate|asst)\s+manager\b", re.I)
INTERN = re.compile(r"\b(intern|internship|apprentice|apprenticeship)\b", re.I)
CITY = re.compile(rf"\b({CITIES})\b", re.I)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?(?:\d[\s-]?){10}(?!\d)|(?<!\d)\d{3,5}[\s-]\d{6,8}(?!\d)")
WORK = {"onsite": "onsite", "hybrid": "hybrid", "remote": "remote"}


def url_key(url: str) -> str:
    """The apply link without scheme, www, query, fragment or trailing slash, in lower case."""
    u = (url or "").strip().lower()
    u = re.sub(r"^[a-z]+://", "", u)
    u = u.removeprefix("www.")
    u = re.split(r"[?#]", u, maxsplit=1)[0]
    return u.rstrip("/")


def ct_key(company: str, title: str) -> str:
    return f"{_fold(company)}|{_fold(title)}"


def scrub(text: str) -> str:
    """No email addresses or phone numbers in anything kept or shown."""
    return re.sub(r"\s{2,}", " ", PHONE.sub("", EMAIL.sub("", text or ""))).strip()


TITLE_HINT = (  # only when the job gives no years (round J2): the title's level, as a hint
    (re.compile(r"\b(trainee|fresher|freshers|graduate engineer|campus)\b", re.I), "fresher"),
    (re.compile(r"\b(head|director|vp|vice president|chief|cxo|avp|evp|svp)\b", re.I), "12_15"),
    (
        re.compile(
            r"\b(lead|principal|architect|manager)\b|\bstaff\s+(engineer|software|data|scientist|designer|developer|product|machine)",
            re.I,
        ),
        "8_12",
    ),
    (re.compile(r"\b(senior|sr)\b", re.I), "5_8"),
)


def experience(exp_min: int | None, exp_max: int | None, title: str, exp_text: str) -> tuple[str | None, str]:
    """(level, where it came from: years · text · title · ""). None: not stated. Years map by exp_min (round J2)."""
    if INTERN.search(title):
        return "internship", "title"
    if exp_min is not None or exp_max is not None:
        lo = exp_min if exp_min is not None else 0
        return band_for_years(lo, exp_max if exp_max is not None else lo), "years"
    t = (exp_text or "").lower()
    if re.search(r"\bfresher|0\s*(?:-|to)\s*0\b|no experience", t):
        return "fresher", "text"
    plain = JUNIOR_MANAGER.sub("", title)  # Assistant / Associate Manager are early-career roles
    for rx, band in TITLE_HINT:
        if rx.search(plain):
            return band, "title"
    return None, ""


class CollectorJob(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")
    company: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=2, max_length=160)
    apply_url: str = Field(min_length=10, max_length=2000)
    location: str = Field("", max_length=300)
    posted: str = Field("", max_length=40)
    exp_min: int | None = Field(None, ge=0, le=50)
    exp_max: int | None = Field(None, ge=0, le=60)
    exp_text: str = Field("", max_length=200)
    system: str = Field("", max_length=40)
    page_text: str = Field("", max_length=60_000)
    status: Literal["active", "closed"] = "active"

    @field_validator("company", "title", "location", "exp_text", "system")
    @classmethod
    def _tidy(cls, v: str) -> str:
        return " ".join(str(v).split())

    @field_validator("apply_url")
    @classmethod
    def _url(cls, v: str) -> str:
        v = v.strip()
        if not re.match(r"^https?://[^\s/]+\.[^\s/]+", v, re.I):
            raise ValueError("apply_url must be a full http(s) link")
        return v


def refusal(j: CollectorJob) -> str | None:
    """Why this job is refused outright (never stored), or None."""
    u = url_key(j.apply_url)
    host = u.split("/")[0]
    if any(b in host for b in BOARDS) or any(f in u for f in FORMS):
        return "job_board_or_form"
    blob = f"{j.company} {host}".lower()
    if any(s in blob for s in STAFFING):
        return "staffing_agency"
    loc = j.location  # empty: the job waits for review ("city not stated") instead
    if loc and not re.search(r"\bindia\b", loc, re.I) and not CITY.search(loc):
        return "not_india"
    return None


def cities_of(location: str) -> tuple[list[str], str]:
    """Indian cities named in the location, and the work type it states (remote / hybrid / onsite)."""
    found: list[str] = []
    for m in CITY.finditer(location or ""):
        c = m.group(1)
        if c.lower() in ("remote", "work from home", "wfh", "hybrid", "pan india", "anywhere in india"):
            continue
        c = c.title() if c.islower() else c
        if c.lower() not in {x.lower() for x in found}:
            found.append(c)
    low = (location or "").lower()
    work = "remote" if re.search(r"\b(remote|work from home|wfh)\b", low) else "hybrid" if "hybrid" in low else "onsite"
    return found[:10], work


def posted_at(raw: str) -> datetime | None:
    try:
        d = datetime.fromisoformat(raw.replace("Z", "+00:00")) if raw else None
    except ValueError:
        return None
    if d and d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return d if d and d <= now() else None


# --- the summary: original words, facts only from the page -----------------------------------------------------------


def copied(summary: str, page: str, n: int = 10) -> bool:
    """True when the summary repeats any run of `n` words from the page (it must be written fresh)."""
    w = lambda s: re.findall(r"[a-z0-9]+", s.lower())  # noqa: E731
    sw, pw = w(summary), w(page)
    grams = {tuple(pw[i : i + n]) for i in range(len(pw) - n + 1)}
    return any(tuple(sw[i : i + n]) in grams for i in range(len(sw) - n + 1))


def check_summary(page: str):
    def check(raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise claude.Unusable("not_object")
        s = " ".join(str(raw.get("summary") or "").split())
        if not SUMMARY_MIN <= len(s) <= SUMMARY_MAX + 100:
            raise claude.Unusable("length")
        if EMAIL.search(s) or PHONE.search(s):
            raise claude.Unusable("contact_details")
        if copied(s, page):
            raise claude.Unusable("copied")
        skills = [dictionary.canonical(x) or " ".join(str(x).split())[:40] for x in (raw.get("skills") or [])[:12]]
        sal = raw.get("salary") or None
        digits = re.sub(r"\D", "", page)
        if sal and not (isinstance(sal, dict) and sal.get("min") and str(int(sal["min"])) in digits):
            sal = None  # a salary only when the page states it
        return {"summary": s[:SUMMARY_MAX + 100], "skills": [x for x in skills if x],
                "work": WORK.get(str(raw.get("work_type") or "").lower(), ""), "salary": sal}  # fmt: skip

    return check


# structured outputs: every object needs additionalProperties false (without it the API answers 400 at once, which
# sent every job of the first real batch to review: round L); salary is null unless the page states it
SALARY = {
    "type": "object",
    "properties": {
        "min": {"type": "number"},
        "max": {"type": "number"},
        "period": {"type": "string", "enum": ["monthly", "yearly"]},
    },
    "required": ["period"],
    "additionalProperties": False,
}
SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "skills": {"type": "array", "items": {"type": "string"}},
        "work_type": {"type": "string", "enum": ["onsite", "hybrid", "remote", "unknown"]},
        "salary": {"anyOf": [SALARY, {"type": "null"}]},
    },
    "required": ["summary", "skills", "work_type", "salary"],
    "additionalProperties": False,
}  # fmt: skip
PAGE_SENT = 12_000  # characters of page text sent to Claude
HTTP_CLIENT = None  # tests put a mock transport here


def _day() -> str:
    from app.core.time import IST

    return now().astimezone(IST).strftime("%Y-%m-%d")


async def used_today(db) -> int:
    """Summaries the collector asked for today (Admin → Settings shows it next to the limit)."""
    doc = await db["ai_usage"].find_one({"_id": f"{_day()}|collector"})
    return min(int((doc or {}).get("n") or 0), await daily_limit(db))


async def daily_limit(db) -> int:
    from app.site import get_site

    return int((await get_site(db))["seek"]["collector_ai_daily"])


async def take_budget(db) -> bool:
    """The collector's own daily AI budget (Admin → Settings, default 3,000), separate from people's AI use."""
    limit = await daily_limit(db)
    day = _day()
    doc = await db["ai_usage"].find_one_and_update(
        {"_id": f"{day}|collector"}, {"$inc": {"n": 1}, "$setOnInsert": {"day": day}}, upsert=True, return_document=True
    )
    return int(doc["n"]) <= limit


async def summarise(db, j: CollectorJob) -> tuple[dict[str, Any] | None, str]:
    """(facts, "") or (None, why it waits for review)."""
    page = scrub(j.page_text)
    if len(page) < PAGE_MIN:
        return None, "no_page_text"
    if not get_settings().anthropic_api_key:
        return None, "summary_unavailable"
    if not await take_budget(db):
        return None, "ai_daily_limit"
    try:
        out = await claude.ask_models("jobs", prompt(j, page), SCHEMA, check_summary(page), **ASK,
                                      http_client=HTTP_CLIENT)  # fmt: skip
    except Exception as e:  # noqa: BLE001  (any failure: the job waits for review instead)
        await ai_quota.note(db, "jobs", "fallback")
        # the kind and Anthropic's own message and request id (never the prompt, the page or the key)
        log.warning("collector summary failed: %s%s", claude.error_kind(e), claude.error_detail(e))
        return None, "summary_failed"
    return out, ""


# thinking off where the model takes it (the summary is short and fully specified; thinking tokens count toward
# max_tokens), room for a 900-character summary, 10 skills and a salary
ASK = {"max_tokens": 1500, "effort": "low", "timeout_s": 40, "retries": 1, "thinking": {"type": "disabled"}}


def prompt(j: CollectorJob, page: str) -> list[dict[str, Any]]:
    """The request's content: the instructions and the job's own (scrubbed) page text, as one text block."""
    text = (
        "Write a short, ORIGINAL summary (300 to 900 characters) of this job for job seekers in India, in plain English, "
        "in your own words: what the role does, the key skills, who can apply (education, experience), and the place "
        "and work type. Use only facts stated in the page below; if something isn't stated, leave it out. Do not copy "
        "sentences. No names of people, no email addresses, no phone numbers. Also list up to 10 key skills, the work "
        "type, and the salary only if the page states it (rupees; otherwise salary is null).\n\nJob: "
        f"{j.title} at {j.company} ({j.location or 'location not stated'})\n\nPage text:\n{page[:PAGE_SENT]}"
    )
    return [{"type": "text", "text": text}]


# --- one job ---------------------------------------------------------------------------------------------------------

PLACEHOLDER = "Summary not written yet: this job is waiting for review. Open the official page for the details."


async def handle(db, raw: Any, dry: bool, sem: asyncio.Semaphore) -> dict[str, Any]:
    try:
        j = CollectorJob.model_validate(raw)
    except ValidationError as e:
        return {"result": "rejected", "reason": "invalid", "errors": [x["msg"] for x in e.errors()][:3]}
    base = {"title": j.title, "company": j.company}
    ukey, ckey = url_key(j.apply_url), ct_key(j.company, j.title)
    old = await db[JOBS].find_one({"source": "collector", "collector.url_key": ukey}) or await db[JOBS].find_one(
        {"source": "collector", "collector.ct_key": ckey}
    )
    if j.status == "closed":
        if old and old["status"] != "closed" and not dry:
            await db[JOBS].update_one(
                {"_id": old["_id"]},
                {"$set": {"status": "closed", "closed_reason": "closed by the collector", "updated_at": now()}},
            )
        return {**base, "result": "closed" if old else "skipped", **({"id": old["_id"]} if old else {})}
    why = refusal(j)
    if why:
        return {**base, "result": "rejected", "reason": why}
    if old and (old.get("collector") or {}).get("removed"):
        return {**base, "result": "skipped", "reason": "removed_on_request", "id": old["_id"]}
    exp, exp_from = experience(j.exp_min, j.exp_max, j.title, j.exp_text)
    cities, work = cities_of(j.location)
    reasons: list[str] = []  # experience not stated is no reason to wait (round J2): "Experience not stated"
    if not cities and work != "remote":
        reasons.append("city_not_stated")
    if dry:
        thin = len(scrub(j.page_text)) < PAGE_MIN and not (old and old.get("collector", {}).get("summarised"))
        res = "review" if reasons or thin else ("updated" if old else "created")
        return {**base, "result": res, "reasons": reasons + (["no_page_text"] if thin else []), "dryRun": True}
    facts, wait = None, ""
    has_summary = bool(old and (old.get("collector") or {}).get("summarised"))
    if not has_summary:
        async with sem:
            facts, wait = await summarise(db, j)
        if wait:
            reasons.append(wait)
    desc = facts["summary"] if facts else (old["description"] if has_summary else PLACEHOLDER)
    try:
        job = JobIn.model_validate({
            "title": j.title[:120], "company": {"name": j.company}, "locations": cities or ([] if work == "remote" else ["India"]),
            "workType": (facts or {}).get("work") or work, "jobType": "internship" if exp == "internship" else "full_time",
            "experience": exp or "not_stated", "skills": (facts or {}).get("skills") or (old or {}).get("skills") or [],
            "description": desc, "applyMethod": "link", "applyUrl": j.apply_url,
            **({"salary": facts["salary"]} if facts and facts.get("salary") else {}),
        })  # fmt: skip
    except ValidationError as e:
        return {**base, "result": "rejected", "reason": "invalid", "errors": [x["msg"] for x in e.errors()][:3]}
    fields = to_doc(job)
    fields["dedupe_key"] = "collector:" + hashlib.sha256(ukey.encode()).hexdigest()[:32]
    t = now()
    meta = {"url_key": ukey, "ct_key": ckey, "system": j.system[:40], "posted_raw": j.posted[:40],
            "exp_text": scrub(j.exp_text)[:200], "exp_from": exp_from, "summarised": bool(facts) or has_summary, "removed": False}  # fmt: skip
    status = "review" if reasons else "active"
    review = {"reasons": reasons, "note": ""} if reasons else None
    if old:
        keep_status = old["status"] if old["status"] in ("closed", "paused") else status
        sets = {
            **{k: v for k, v in fields.items() if k != "dedupe_key"},
            "collector": meta,
            "status": keep_status,
            "updated_at": t,
        }
        sets["review"] = review or {"reasons": [], "note": ""}
        await db[JOBS].update_one({"_id": old["_id"]}, {"$set": sets})
        return {
            **base,
            "result": "review" if keep_status == "review" else "updated",
            "id": old["_id"],
            "reasons": reasons,
        }
    doc = {"_id": new_id(), "slug": slug_for(job.title, j.company), **fields, "status": status, "closed_reason": "",
           "posted_at": posted_at(j.posted) or t, "source": "collector", "collector": meta, "review": review or {"reasons": []},
           "link_check": {"at": None, "ok": None, "status": None, "fails": 0, "error": ""}, "demo": False,
           "created_by": None, "created_at": t, "updated_at": t}  # fmt: skip
    try:
        await db[JOBS].insert_one(doc)
    except Exception:  # noqa: BLE001  (the same link arrived twice at once)
        return {**base, "result": "skipped", "reason": "duplicate"}
    return {**base, "result": "review" if reasons else "created", "id": doc["_id"], "reasons": reasons}


# --- the endpoints ---------------------------------------------------------------------------------------------------


async def _auth(request: Request, db, authorization: str | None) -> None:
    from datetime import timedelta

    from app.auth.sessions import client_ip
    from app.core.security import keyed_hash

    if len(get_settings().job_ingest_key) < 32:
        raise ApiError(503, "ingest_off", "Job upload isn’t set up yet (JOB_INGEST_KEY on the server).")
    if not _key_ok(authorization):
        ip_key = f"jobs-ingest-bad:{keyed_hash('ip', client_ip(request) or '-')[:24]}"
        await rate_limit.check(db, ip_key, BAD_KEY_RULES, "Too many wrong keys. Try again later.")
        await rate_limit.record(db, ip_key)
        raise ApiError(401, "bad_key", "Send the upload key as: Authorization: Bearer <key>.")
    rules = [(n, timedelta(seconds=s)) for n, s in RULES]
    await rate_limit.check(db, "jobs-collector", rules, "Too many uploads. Wait a little and try again.")
    await rate_limit.record(db, "jobs-collector")


async def _body(request: Request) -> Any:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise ApiError(413, "too_big", f"The upload is too big: send at most {MAX_JOBS} jobs (6 MB) at a time.")
    try:
        return json.loads(raw or b"null")
    except ValueError:
        raise ApiError(400, "bad_json", 'The body must be JSON: {"jobs": [ ... ]}.') from None


@router.post("")
async def collect(request: Request, db: DB, authorization: str | None = Header(None)) -> JSONResponse:
    await _auth(request, db, authorization)
    data = await _body(request)
    dry = bool(isinstance(data, dict) and (data.get("dryRun") or data.get("dry_run")))
    jobs = data.get("jobs") if isinstance(data, dict) else data
    if not isinstance(jobs, list) or not jobs:
        raise ApiError(400, "no_jobs", 'Send {"jobs": [ ... ]} with at least one job.')
    if len(jobs) > MAX_JOBS:
        raise ApiError(400, "too_many", f"At most {MAX_JOBS} jobs a request; split the batch.")
    sem = asyncio.Semaphore(PARALLEL)
    results = await asyncio.gather(*(handle(db, r, dry, sem) for r in jobs))
    counts = {k: 0 for k in ("created", "updated", "skipped", "review", "closed", "rejected")}
    by: dict[str, int] = {}
    for i, r in enumerate(results):
        r["index"] = i
        counts[r["result"]] += 1
        if r["result"] == "rejected":
            by[r["reason"]] = by.get(r["reason"], 0) + 1
    if not dry:
        await audit(db, None, "job.collector", target=None, data={**counts, "rejectedBy": by}, ip=None)
    return JSONResponse({**counts, "rejectedBy": by, "dryRun": dry, "results": results})


class CloseIn(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=1000)


@router.post("/close")
async def close(request: Request, db: DB, authorization: str | None = Header(None)) -> dict[str, Any]:
    """The collector's daily link check: close the jobs whose link no longer works (never deleted)."""
    await _auth(request, db, authorization)
    data = await _body(request)
    try:
        body = CloseIn.model_validate(data)
    except ValidationError:
        raise ApiError(400, "bad_body", 'Send {"urls": ["https://…", …]} (1–1000 links).') from None
    keys = list(dict.fromkeys(url_key(u) for u in body.urls if u))
    r = await db[JOBS].update_many(
        {"source": "collector", "collector.url_key": {"$in": keys}, "status": {"$in": ["active", "review", "paused"]}},
        {
            "$set": {
                "status": "closed",
                "closed_reason": "the link no longer works (collector check)",
                "updated_at": now(),
            }
        },
    )
    await audit(
        db, None, "job.collector_close", target=None, data={"closed": r.modified_count, "sent": len(keys)}, ip=None
    )
    return {"closed": r.modified_count, "sent": len(keys)}
