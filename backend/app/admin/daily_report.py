# ruff: noqa: E501  (dense response shapes)
"""Admin → Daily report: one page with the whole business, updated every day (docs/admin/daily-report.md).

- A snapshot per IST day in `daily_reports` (_id "YYYY-MM-DD"): the day's counts (sign-ups, jobs, applications,
  orders, skill checks …) and, for today, the state of things (live jobs, review queue, people per level …). The
  automation pass writes it once a day from 06:30 IST (`daily_if_due`, marker in settings "daily_report"); admins
  can press "Refresh now". Each run also finalises yesterday's counts and backfills the last 30 days that have no
  snapshot yet (from created_at days; state numbers stay empty there). The work is a heavy job (app/core/heavy.py):
  one at a time, counted in MongoDB (count_documents / aggregation), never whole collections in memory.
- The job collector reports each run (POST /api/jobs/collector/run-report, the same key as POST /api/jobs/collector)
  into `collector_runs`, idempotent by runId. Until reports arrive the collector numbers come from nm7.si's own
  records: the collector's jobs (source "collector": created / updated / closed / waiting for review) and the audit
  log of its uploads (sent, rejected with reasons).
- GET /api/admin/daily-report: everything in one call — today's snapshot (computed now when it doesn't exist yet),
  yesterday's, the 30-day series per metric, the collector run status, site health, five plain lines written by
  code (no AI) and the "Needs attention" list.

  GET  /api/admin/daily-report             the report
  POST /api/admin/daily-report/refresh     recompute today (and yesterday, and missing days) now → the report
  POST /api/jobs/collector/run-report      the collector's run report (Bearer JOB_INGEST_KEY)
"""

import logging
import os
import time as clock
from datetime import date, datetime, time, timedelta
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from pydantic.alias_generators import to_camel
from pymongo.asynchronous.database import AsyncDatabase

from app.admin.deps import AdminAuth
from app.audit import audit
from app.core import ai_quota
from app.core.config import get_settings
from app.core.db import (
    AI_USAGE,
    APPLICATIONS,
    AUDIT_LOG,
    AUTO_RUNS,
    COLLECTOR_RUNS,
    COMPANIES,
    DAILY_REPORTS,
    DB,
    HIRE_SLOTS,
    JOBS,
    MEMBERSHIPS,
    OPS_DAILY,
    ORDERS,
    ORGANIZATIONS,
    PAYMENTS,
    REFUNDS,
    SESSIONS,
    SETTINGS,
    SKILL_ATTEMPTS,
    USERS,
    VETTING_INTERVIEWS,
    VETTING_L4,
    VETTING_QUEUE,
)
from app.core.errors import ApiError
from app.core.time import IST, now
from app.jobs.public import live_filter

log = logging.getLogger("nm7.daily_report")
router = APIRouter(prefix="/api/admin/daily-report", tags=["admin"])
collector_router = APIRouter(prefix="/api/jobs/collector", tags=["job board"])

RUN_AT = time(6, 30)  # the daily snapshot, IST
COLLECTOR_BY = time(7, 0)  # no collector run by then: "needs attention"
DAYS = 30
REVIEW_LIMIT = 20  # more jobs than this waiting for review: "needs attention"
SLOW_MS = 1000  # a database ping slower than this: "needs attention"
MARK = "daily_report"
STARTED = now()  # when this server process started (shown next to the deploy commit)
NE = {"$ne": True}
HTTP_CLIENT: httpx.AsyncClient | None = None  # tests put a mock transport here
WORKFLOWS = (("nightly", "e2e.yml"), ("smoke-live", "smoke-live.yml"))

# every number with a 30-day series. "state" numbers describe the moment of the snapshot (only today's run knows
# them; backfilled days leave them empty)
COUNTS = (
    "colSent", "colCreated", "colUpdated", "colReview", "colRejected", "colClosed",
    "errors", "aiUsed", "aiCollector",
    "signupSeekers", "signupStudents", "signupCompanies", "signupColleges", "signups",
    "applications", "autoApplyUsers", "autoApplications", "companyJobs", "interviewsBooked",
    "paidOrders", "revenue", "refunds", "refundAmount",
    "checksStarted", "checksSubmitted", "checksPassed", "passRate", "aiInterviews", "l4Checks",
)  # fmt: skip
STATE = (
    "liveJobs", "reviewQueue", "activeUsers", "apiMs",
    "readyNow", "visible", "l0", "l1", "l2", "l3", "l4", "appealsOpen", "fraudOpen",
)  # fmt: skip
METRICS = COUNTS + STATE

MEASURE_LABELS = {
    "firstInterviewMinutes": ("Time from a job going live to the first interview booked", True),
    "shareL2Plus": ("People visible in Hire now at L2 or higher", False),
    "pairs5Plus": ("Role × city shortlists with 5 or more ready people", False),
    "showUp": ("Interview show-up rate", False),
    "shortlistRating": ("Companies’ rating of the shortlists", False),
    "appealsUpheld": ("Appeals upheld", True),
    "aiPerVetted": ("AI cost per vetted person", True),
}


def ist_today(t: datetime | None = None) -> date:
    return (t or now()).astimezone(IST).date()


def span(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, IST)
    return start, start + timedelta(days=1)


def ms(dt: datetime | None) -> int | None:
    return int(dt.timestamp() * 1000) if dt else None


async def _sum(db: AsyncDatabase, coll: str, match: dict[str, Any], field: str) -> int:
    rows = await (
        await db[coll].aggregate([{"$match": match}, {"$group": {"_id": None, "n": {"$sum": f"${field}"}}}])
    ).to_list()
    return int(rows[0]["n"]) if rows else 0


async def _top(
    db: AsyncDatabase, match: dict[str, Any], field: str, unwind: bool = False, n: int = 10
) -> list[dict[str, Any]]:
    pipe: list[dict[str, Any]] = [{"$match": match}]
    if unwind:
        pipe.append({"$unwind": f"${field}"})
    pipe += [{"$group": {"_id": f"${field}", "n": {"$sum": 1}}}, {"$sort": {"n": -1, "_id": 1}}, {"$limit": n}]
    return [{"name": str(r["_id"]) if r["_id"] not in (None, "") else "not stated", "n": int(r["n"])}
            async for r in await db[JOBS].aggregate(pipe)]  # fmt: skip


def _merge(into: dict[str, int], more: dict[str, Any] | None) -> None:
    for k, v in (more or {}).items():
        if isinstance(v, int | float):
            into[str(k)] = into.get(str(k), 0) + int(v)


# --- the job collector -------------------------------------------------------------------------------------------


async def collector_day(db: AsyncDatabase, day: date) -> tuple[dict[str, Any], dict[str, Any]]:
    """(numbers, details) for one IST day: from the collector's run reports when it sent any that day, else from
    nm7.si's own records (its jobs and the audit log of its uploads)."""
    start, end = span(day)
    w = {"$gte": start, "$lt": end}
    mine = {"source": "collector", "demo": NE}
    runs = await db[COLLECTOR_RUNS].find({"day": day.isoformat()}).sort("started_at", 1).to_list(200)
    posts = [r for r in runs if r.get("kind") == "post"]
    links = [r for r in runs if r.get("kind") == "links"]
    review_reasons: dict[str, int] = {}
    rejected_reasons: dict[str, int] = {}
    link = {"checked": 0, "dead": 0, "closed": 0}
    for r in links:
        for k in link:
            link[k] += int((r.get("counts") or {}).get(k) or 0)
    if posts:
        c: dict[str, int] = {}
        for r in posts:
            _merge(c, r.get("counts"))
            _merge(review_reasons, r.get("review_reasons"))
            _merge(rejected_reasons, r.get("rejected_reasons"))
        m = {"colSent": c.get("sent", 0), "colCreated": c.get("created", 0), "colUpdated": c.get("updated", 0),
             "colReview": c.get("review", 0), "colRejected": c.get("rejected", 0), "colClosed": c.get("closed", 0) + link["closed"]}  # fmt: skip
    else:
        # nm7.si's own records: the uploads in the audit log (sent, rejected with reasons) and the jobs themselves
        sent = rejected = 0
        async for a in db[AUDIT_LOG].find({"action": "job.collector", "at": w}, {"data": 1}).limit(2000):
            d = a.get("data") or {}
            sent += sum(int(d.get(k) or 0) for k in ("created", "updated", "skipped", "review", "closed", "rejected"))
            rejected += int(d.get("rejected") or 0)
            _merge(rejected_reasons, d.get("rejectedBy"))
        m = {
            "colSent": sent,
            "colCreated": await db[JOBS].count_documents({**mine, "created_at": w}),
            "colUpdated": await db[JOBS].count_documents(
                {**mine, "updated_at": w, "created_at": {"$lt": start}, "status": {"$ne": "closed"}}
            ),
            "colReview": await db[JOBS].count_documents({**mine, "created_at": w, "status": "review"}),
            "colRejected": rejected,
            "colClosed": await db[JOBS].count_documents({**mine, "updated_at": w, "status": "closed"}),
        }
        link["closed"] = await _sum(db, AUDIT_LOG, {"action": "job.collector_close", "at": w}, "data.closed")
    if not review_reasons:  # the jobs created that day that wait for review, by reason
        for r in await _top(db, {**mine, "created_at": w, "status": "review"}, "review.reasons", unwind=True, n=50):
            review_reasons[r["name"]] = r["n"]
    details = {
        "fromRuns": bool(posts),
        "reviewReasons": dict(sorted(review_reasons.items(), key=lambda kv: -kv[1])),
        "rejectedReasons": dict(sorted(rejected_reasons.items(), key=lambda kv: -kv[1])),
        "linkCheck": link,
        "byCity": await _top(db, {**mine, "created_at": w}, "locations", unwind=True),
        "byBand": await _top(db, {**mine, "created_at": w}, "experience"),
    }
    return m, details


async def run_status(db: AsyncDatabase, t: datetime | None = None) -> dict[str, Any]:
    """Did today's collector run arrive (time, ok / failed)? From its run reports, else from its uploads today."""
    t = t or now()
    day = ist_today(t)
    start, _ = span(day)
    late = t.astimezone(IST).time() >= COLLECTOR_BY
    runs = await db[COLLECTOR_RUNS].find({"day": day.isoformat()}).sort("started_at", 1).to_list(200)
    posts = [r for r in runs if r.get("kind") == "post"]
    items = [{"runId": r["_id"], "kind": r.get("kind"), "startedAt": ms(r.get("started_at")), "finishedAt": ms(r.get("finished_at")),
              "ok": bool(r.get("ok")), "error": r.get("error") or "", "counts": r.get("counts") or {}} for r in runs]  # fmt: skip
    if posts:
        last = posts[-1]
        ok = bool(last.get("ok"))
        return {"arrived": True, "source": "report", "at": ms(last.get("finished_at") or last.get("started_at")), "ok": ok,
                "error": last.get("error") or "", "needsAttention": not ok, "late": late, "runs": items}  # fmt: skip
    first = await db[AUDIT_LOG].find_one({"action": "job.collector", "at": {"$gte": start}}, sort=[("at", 1)])
    if first:
        return {"arrived": True, "source": "records", "at": ms(first["at"]), "ok": True, "error": "", "needsAttention": False,
                "late": late, "runs": items}  # fmt: skip
    return {
        "arrived": False,
        "source": None,
        "at": None,
        "ok": None,
        "error": "",
        "needsAttention": late,
        "late": late,
        "runs": items,
    }


# --- one day's counts and today's state ------------------------------------------------------------------------


async def counts(db: AsyncDatabase, day: date) -> tuple[dict[str, Any], dict[str, Any]]:
    """The numbers of one IST day that can be counted from created_at-style dates (backfill works for these).
    Demo records are never counted."""
    start, end = span(day)
    w = {"$gte": start, "$lt": end}
    d = day.isoformat()
    col, details = await collector_day(db, day)
    demo_orgs = [o["_id"] async for o in db[ORGANIZATIONS].find({"demo": True}, {"_id": 1}).limit(5000)]
    m: dict[str, Any] = dict(col)
    m["errors"] = int((await db[OPS_DAILY].find_one({"_id": f"errors:{d}"}) or {}).get("n") or 0)
    m["aiUsed"] = int((await db[AI_USAGE].find_one({"_id": f"{d}|all"}) or {}).get("n") or 0)
    m["aiCollector"] = int((await db[AI_USAGE].find_one({"_id": f"{d}|collector"}) or {}).get("n") or 0)
    m["signupSeekers"] = await db[USERS].count_documents({"role": "customer", "created_at": w, "demo": NE})
    m["signupStudents"] = await db[MEMBERSHIPS].count_documents(
        {"joined_at": w, "org_id": {"$nin": demo_orgs}, "demo": NE}
    )
    m["signupCompanies"] = await db[COMPANIES].count_documents({"created_at": w, "demo": NE})
    m["signupColleges"] = await db[ORGANIZATIONS].count_documents({"created_at": w, "demo": NE})
    m["signups"] = m["signupSeekers"] + m["signupCompanies"] + m["signupColleges"]
    m["applications"] = await db[APPLICATIONS].count_documents(
        {"created_at": w, "job_id": {"$exists": True}, "demo": NE}
    )
    m["autoApplications"] = await db[APPLICATIONS].count_documents({"created_at": w, "origin": "auto", "demo": NE})
    m["autoApplyUsers"] = int((await db[AUTO_RUNS].find_one({"_id": d}, {"users": 1}) or {}).get("users") or 0)
    m["companyJobs"] = await db[JOBS].count_documents({"source": "company", "created_at": w, "demo": NE})
    m["interviewsBooked"] = await db[HIRE_SLOTS].count_documents({"booked_at": w, "status": "booked", "demo": NE})
    m["paidOrders"] = await db[ORDERS].count_documents({"paid_at": w, "demo": NE})
    m["revenue"] = await _sum(
        db, PAYMENTS, {"status": {"$in": ["captured", "refunded"]}, "captured_at": w}, "amount"
    )  # paise
    m["refunds"] = await db[REFUNDS].count_documents({"status": "processed", "processed_at": w})
    m["refundAmount"] = await _sum(db, REFUNDS, {"status": "processed", "processed_at": w}, "amount")  # paise
    from app.hire.vetting.engine import PASS_MCQ

    m["checksStarted"] = await db[SKILL_ATTEMPTS].count_documents({"v": 2, "started_at": w, "demo": NE})
    m["checksSubmitted"] = await db[SKILL_ATTEMPTS].count_documents({"v": 2, "submitted_at": w, "demo": NE})
    m["checksPassed"] = await db[SKILL_ATTEMPTS].count_documents(
        {"v": 2, "submitted_at": w, "score": {"$gte": PASS_MCQ}, "demo": NE}
    )
    m["passRate"] = round(100 * m["checksPassed"] / m["checksSubmitted"]) if m["checksSubmitted"] else None
    m["aiInterviews"] = await db[VETTING_INTERVIEWS].count_documents({"started_at": w, "demo": NE})
    m["l4Checks"] = await db[VETTING_L4].count_documents({"requested_at": w, "demo": NE})
    return m, {"collector": details}


async def _active_users(db: AsyncDatabase, day: date) -> int:
    """People (not admins, not demo accounts) whose signed-in session was used that day (sessions note use hourly)."""
    start, end = span(day)
    w = {"$gte": start, "$lt": end}
    pipe = [
        {"$match": {"$or": [{"last_seen_at": w}, {"created_at": w}]}},
        {"$group": {"_id": "$user_id"}},
        {"$limit": 50_000},
    ]
    ids = [r["_id"] async for r in await db[SESSIONS].aggregate(pipe)]
    if not ids:
        return 0
    return await db[USERS].count_documents({"_id": {"$in": ids}, "role": {"$ne": "admin"}, "demo": NE})


async def ping_ms(db: AsyncDatabase) -> int | None:
    """A cheap database round trip, timed (None: the database didn't answer)."""
    t0 = clock.perf_counter()
    try:
        await db.command("ping")
    except Exception:  # noqa: BLE001
        log.warning("daily report: database ping failed")
        return None
    return round((clock.perf_counter() - t0) * 1000)


async def github_status() -> dict[str, Any]:
    """The latest nightly (e2e) and smoke-live runs, when GITHUB_STATUS_TOKEN is set; else "not connected"."""
    s = get_settings()
    if not s.github_status_token:
        return {"connected": False, "runs": []}
    runs = []
    headers = {"Authorization": f"Bearer {s.github_status_token}", "Accept": "application/vnd.github+json"}
    client = HTTP_CLIENT or httpx.AsyncClient(timeout=6)
    try:
        for label, wf in WORKFLOWS:
            url = f"https://api.github.com/repos/{s.github_status_repo}/actions/workflows/{wf}/runs?per_page=1"
            try:
                r = await client.get(url, headers=headers)
                r.raise_for_status()
                last = (r.json().get("workflow_runs") or [None])[0]
            except Exception as e:  # noqa: BLE001  (a GitHub hiccup never stops the report)
                log.warning("daily report: GitHub status failed for %s: %s", wf, type(e).__name__)
                runs.append({"name": label, "conclusion": "unknown", "at": None, "url": ""})
                continue
            if last:
                runs.append({"name": label, "conclusion": last.get("conclusion") or last.get("status") or "unknown",
                             "at": last.get("updated_at"), "url": last.get("html_url") or ""})  # fmt: skip
    finally:
        if HTTP_CLIENT is None:
            await client.aclose()
    return {"connected": True, "runs": runs}


async def state(db: AsyncDatabase, day: date) -> tuple[dict[str, Any], dict[str, Any]]:
    """The state of things right now (only the snapshot taken today knows these)."""
    from app.hire.vetting import access
    from app.hire.vetting.ladder import overview
    from app.jobs.collector import daily_limit
    from app.wapay.settings import razorpay_ready

    ov = await overview(db, None)
    lv = {f"l{x['level']}": x["people"] for x in ov["levels"]}
    m = {
        "liveJobs": await db[JOBS].count_documents(live_filter()),
        "reviewQueue": await db[JOBS].count_documents({"source": "collector", "status": "review", "demo": NE}),
        "activeUsers": await _active_users(db, day),
        "apiMs": await ping_ms(db),
        "readyNow": ov["readyNow"], "visible": ov["visible"], **lv,
        "appealsOpen": await db[VETTING_QUEUE].count_documents({"kind": "appeal", "status": "open"}),
        "fraudOpen": await db[VETTING_QUEUE].count_documents({"kind": "fraud", "status": "open"}),
    }  # fmt: skip
    measures = []
    for k, (label, lower) in MEASURE_LABELS.items():
        v, target = ov["measures"].get(k), ov["targets"].get(k)
        st = "none" if v is None else ("met" if (v <= target if lower else v >= target) else "miss")
        measures.append({"key": k, "label": label, "value": v, "target": target, "lowerIsBetter": lower, "state": st})
    extra = {
        "vetting": {"switchOn": await access.is_public(db), "measures": measures,
                    "levels": [{"level": x["level"], "label": x["label"], "people": x["people"]} for x in ov["levels"]]},
        "payments": {"ready": razorpay_ready()},
        "ai": {"cap": ai_quota.DAILY_CAP, "collectorLimit": await daily_limit(db)},
        "github": await github_status(),
        "autoApply": await _auto_apply(db),
    }  # fmt: skip
    return m, extra


async def _auto_apply(db: AsyncDatabase) -> dict[str, Any] | None:
    """Auto Apply 2.0 (A7): sent / delivered / failed, reply and interview rates per channel for the last 7 days, and
    the success measures with their targets (app/autoapply/stats.py: aggregations only). A problem here never stops
    the rest of the snapshot."""
    from app.autoapply import stats as aa_stats

    try:
        return await aa_stats.section(db)
    except Exception:  # noqa: BLE001
        log.exception("daily report: the Auto Apply numbers failed")
        return None


# --- snapshots -----------------------------------------------------------------------------------------------------


async def snapshot(db: AsyncDatabase, day: date, with_state: bool, t: datetime | None = None) -> dict[str, Any]:
    """Compute and store one day's snapshot. Without state (yesterday, backfill) the stored state numbers stay."""
    t = t or now()
    m, extra = await counts(db, day)
    sets: dict[str, Any] = {"day": day.isoformat(), "at": t, **{f"m.{k}": v for k, v in m.items()}, **extra}
    if with_state:
        sm, sextra = await state(db, day)
        sets.update({f"m.{k}": v for k, v in sm.items()}, **sextra)
    else:
        old = await db[DAILY_REPORTS].find_one({"_id": day.isoformat()}, {"m.activeUsers": 1}) or {}
        prev = (old.get("m") or {}).get("activeUsers")
        active = await _active_users(db, day)  # sessions move on: never lower than what the day's own snapshot saw
        sets["m.activeUsers"] = max(active, prev or 0)
    await db[DAILY_REPORTS].update_one(
        {"_id": day.isoformat()}, {"$set": sets, "$setOnInsert": {"created_at": t}}, upsert=True
    )
    return await db[DAILY_REPORTS].find_one({"_id": day.isoformat()})


async def run(db: AsyncDatabase, t: datetime | None = None) -> int:
    """Today (with state), yesterday's final counts, and any of the last 30 days without a snapshot. → docs written."""
    t = t or now()
    today = ist_today(t)
    await snapshot(db, today, True, t)
    y = today - timedelta(days=1)
    existed = await db[DAILY_REPORTS].find_one({"_id": y.isoformat()}, {"_id": 1})
    await snapshot(db, y, False, t)  # yesterday's whole day, now that it is over
    await db[DAILY_REPORTS].update_one(
        {"_id": y.isoformat()}, {"$set": {"final": True, **({} if existed else {"backfilled": True})}}
    )
    written = 2
    have = {
        d["_id"]
        async for d in db[DAILY_REPORTS].find({"_id": {"$gte": (today - timedelta(days=DAYS)).isoformat()}}, {"_id": 1})
    }
    for i in range(2, DAYS):
        d = today - timedelta(days=i)
        if d.isoformat() in have:
            continue
        await snapshot(db, d, False, t)
        await db[DAILY_REPORTS].update_one({"_id": d.isoformat()}, {"$set": {"backfilled": True, "final": True}})
        written += 1
    return written


async def daily_if_due(db: AsyncDatabase, t: datetime | None = None) -> int:
    """Automation: once a day from 06:30 IST. → snapshots written (0: not due, or another heavy job is running)."""
    from app.core.heavy import heavy_or_skip

    t = t or now()
    local = t.astimezone(IST)
    if local.time() < RUN_AT:
        return 0
    today = local.date().isoformat()
    mark = await db[SETTINGS].find_one({"_id": MARK}) or {}
    if mark.get("day") == today:
        return 0
    async with heavy_or_skip(db) as ok:  # another heavy job running: try again on the next pass
        if not ok:
            return 0
        await db[SETTINGS].update_one(
            {"_id": MARK}, {"$set": {"day": today, "at": t}}, upsert=True
        )  # first: never twice
        try:
            return await run(db, t)
        except Exception:  # noqa: BLE001  (the next day's run tries again; Refresh now works meanwhile)
            log.exception("daily report snapshot failed")
            return 0


# --- the words and the "Needs attention" list --------------------------------------------------------------------


def _n(v: Any) -> int:
    return int(v or 0)


def rupees(paise: int | None) -> str:
    return f"₹{round(_n(paise) / 100):,}"


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n:,} {one if n == 1 else (many or one + 's')}"


def attention(
    m: dict[str, Any], extra: dict[str, Any], run_: dict[str, Any], db_ms: int | None
) -> list[dict[str, Any]]:
    """What an admin should look at today. The vetting switch being off is information, never an issue."""
    out: list[dict[str, Any]] = []
    if run_.get("arrived") and run_.get("ok") is False:
        out.append(
            {
                "key": "collector_failed",
                "level": "bad",
                "text": f"Today's collector run failed{': ' + run_['error'] if run_.get('error') else ''}.",
                "link": "/admin/jobs?tab=collector",
            }
        )
    elif not run_.get("arrived") and run_.get("late"):
        out.append(
            {
                "key": "collector_missing",
                "level": "bad",
                "text": "No job collector run arrived by 7:00 AM IST today.",
                "link": "/admin/jobs?tab=collector",
            }
        )
    q = m.get("reviewQueue")
    if q is not None and q > REVIEW_LIMIT:
        out.append(
            {
                "key": "review_queue",
                "level": "warn",
                "text": f"{_plural(q, 'job')} wait for review (more than {REVIEW_LIMIT}).",
                "link": "/admin/jobs?tab=collector",
            }
        )
    if db_ms is None:
        out.append(
            {"key": "api_down", "level": "bad", "text": "The database didn't answer the health check.", "link": None}
        )
    elif db_ms > SLOW_MS:
        out.append(
            {
                "key": "api_slow",
                "level": "warn",
                "text": f"The site is slow: the database took {db_ms:,} ms to answer.",
                "link": None,
            }
        )
    f = _n(m.get("fraudOpen"))
    if f:
        out.append(
            {
                "key": "fraud_open",
                "level": "warn",
                "text": f"{_plural(f, 'fraud flag')} open.",
                "link": "/admin/skill-tests?tab=fraud",
            }
        )
    if extra.get("payments", {}).get("ready") is False:
        out.append(
            {
                "key": "razorpay_missing",
                "level": "warn",
                "text": "Razorpay keys missing: payments show “Payments coming soon”.",
                "link": "/admin/settings",
            }
        )
    arrived = _n(m.get("colSent")) or _n(m.get("colCreated"))  # "created" already counts the ones sent to review
    ai = extra.get("collectorAi") or {}
    if arrived and not _n(m.get("aiCollector")) and not _n(ai.get("okToday")):
        why = (
            f" Last AI error: {ai['lastErrorKind']}{' — ' + ai['lastError'] if ai.get('lastError') else ''}."
            if ai.get("lastErrorKind")
            else ""
        )
        out.append(
            {
                "key": "collector_ai_zero",
                "level": "bad",
                "text": f"No collector AI summaries today, but {_plural(arrived, 'job')} arrived: they wait for review "
                f"until a summary is written.{why} Press “Test the AI now”; jobs held for an AI error are sent back "
                "to the collector on their own.",
                "link": "/admin/jobs?tab=collector",
            }
        )  # fmt: skip
    cap = (extra.get("ai") or {}).get("cap")
    if cap and _n(m.get("aiUsed")) >= cap:
        out.append({"key": "ai_cap", "level": "warn", "text": "Today's AI allowance is used up.", "link": None})
    return out


def summary(m: dict[str, Any], extra: dict[str, Any], run_: dict[str, Any], issues: list[dict[str, Any]]) -> list[str]:
    """Five plain lines written from the numbers (no AI)."""
    created, review = _n(m.get("colCreated")), _n(m.get("colReview"))
    if run_.get("arrived") and run_.get("ok") is False:
        line1 = "Collector run failed today. " + (
            f"It still added {_plural(created, 'job')}." if created else "No jobs added."
        )
    elif not run_.get("arrived") and not created:
        line1 = "No collector run yet today." + (" It is late (after 7:00 AM)." if run_.get("late") else "")
    else:
        line1 = (
            f"Collector added {_plural(created, 'job')}, {review:,} {'waits' if review == 1 else 'wait'} for review."
        )
        if m.get("reviewQueue") is not None:
            line1 += f" Review queue: {_n(m['reviewQueue']):,}."
    s = _n(m.get("signups"))
    parts = [f"{_n(m.get('signupSeekers'))} job seekers", f"{_n(m.get('signupStudents'))} students joined colleges",
             f"{_n(m.get('signupCompanies'))} companies", f"{_n(m.get('signupColleges'))} colleges"]  # fmt: skip
    line2 = f"{_plural(s, 'new sign-up')} ({', '.join(parts)})."
    apps = _n(m.get("applications"))
    if extra.get("payments", {}).get("ready") is False:
        line3 = f"{_plural(apps, 'application')}. Payments coming soon (Razorpay keys not set)."
    else:
        line3 = f"{_plural(apps, 'application')}, {_plural(_n(m.get('paidOrders')), 'paid order')} ({rupees(m.get('revenue'))})."
    sw = (extra.get("vetting") or {}).get("switchOn")
    line4 = (f"{_plural(_n(m.get('checksStarted')), 'skill check')} started, {_n(m.get('checksPassed')):,} passed; "
             f"{_n(m.get('readyNow')):,} ready now. Vetting is {'ON' if sw else 'OFF'}.")  # fmt: skip
    if not issues:
        line5 = "Site healthy. Nothing needs attention."
    else:
        bad = sum(1 for i in issues if i["level"] == "bad")
        line5 = f"{_plural(len(issues), 'thing')} {'needs' if len(issues) == 1 else 'need'} attention" + (
            f" ({bad} urgent)." if bad else "."
        )
    return [line1, line2, line3, line4, line5]


# --- the report ------------------------------------------------------------------------------------------------------


def _doc_out(d: dict[str, Any] | None) -> dict[str, Any] | None:
    if not d:
        return None
    out = {k: v for k, v in d.items() if k not in ("_id", "at", "created_at")}
    out["day"] = d["_id"]
    out["at"] = ms(d.get("at"))
    out["m"] = {k: (d.get("m") or {}).get(k) for k in METRICS}
    return out


async def report(db: AsyncDatabase, t: datetime | None = None) -> dict[str, Any]:
    t = t or now()
    today = ist_today(t)
    busy = False
    doc = await db[DAILY_REPORTS].find_one({"_id": today.isoformat()})
    if not doc:  # first look today: compute it now (one heavy job at a time)
        from app.core.heavy import heavy_or_skip

        async with heavy_or_skip(db) as ok:
            if ok:
                doc = await snapshot(db, today, True, t)
            else:
                busy = True
    y = await db[DAILY_REPORTS].find_one({"_id": (today - timedelta(days=1)).isoformat()})
    days = [(today - timedelta(days=i)).isoformat() for i in range(DAYS - 1, -1, -1)]
    by_day = {d["_id"]: d.get("m") or {} async for d in db[DAILY_REPORTS].find({"_id": {"$in": days}}, {"m": 1})}
    m = (doc or {}).get("m") or {}
    ym = (y or {}).get("m") or {}
    metrics = {}
    for k in METRICS:
        v, p = m.get(k), ym.get(k)
        metrics[k] = {"value": v, "prev": p, "delta": (v - p) if isinstance(v, int | float) and isinstance(p, int | float) else None,
                      "series": [by_day.get(d, {}).get(k) for d in days]}  # fmt: skip
    db_ms = await ping_ms(db)
    run_ = await run_status(db, t)
    from app.jobs import ai_health

    collector_ai = await ai_health.status(db)
    extra = {**(doc or {}), "collectorAi": collector_ai}
    issues = attention({**m, "apiMs": db_ms}, extra, run_, db_ms)
    errs = await db[OPS_DAILY].find_one({"_id": f"errors:{today.isoformat()}"}, {"recent": 1}) or {}
    recent_errors = [{**{k: e.get(k) for k in ("method", "path", "error", "message", "rid")}, "at": ms(e.get("at"))}
                     for e in reversed(errs.get("recent") or [])]  # fmt: skip
    s = get_settings()
    health = {
        "up": db_ms is not None, "dbMs": db_ms, "slowMs": SLOW_MS,
        "commit": os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("GIT_COMMIT") or "unknown",
        "startedAt": ms(STARTED), "env": s.app_env,
        "github": extra.get("github") or {"connected": bool(s.github_status_token), "runs": []},
    }  # fmt: skip
    return {
        "day": today.isoformat(), "generatedAt": ms(t), "busy": busy, "days": days,
        "today": _doc_out(doc), "yesterday": _doc_out(y), "metrics": metrics,
        "collectorRun": run_, "health": health, "attention": issues, "collectorAi": collector_ai,
        "recentErrors": recent_errors,
        "summary": summary(m, extra, run_, issues) if doc else ["Another big job is running on the server. The numbers appear in a minute."],
        "limits": {"reviewQueue": REVIEW_LIMIT, "collectorBy": "07:00", "runAt": "06:30"},
    }  # fmt: skip


@router.get("")
async def get_report(db: DB, _: AdminAuth("dashboard")) -> dict[str, Any]:
    return await report(db)


@router.post("/refresh")
async def refresh(db: DB, auth: AdminAuth("dashboard")) -> dict[str, Any]:
    from app.core.heavy import heavy_or_busy

    async with heavy_or_busy(db):
        n = await run(db)
    await audit(db, auth.user.id, "daily_report.refresh", data={"written": n})
    return await report(db)


_last_check: dict[str, Any] = {"at": None}


@router.post("/ai-check")
async def ai_check(db: DB, auth: AdminAuth("dashboard")) -> dict[str, Any]:
    """ "Test the AI now": one short real summary of a made-up job page, with the collector's model, schema and checks.
    Says what Anthropic answered (the error kind and its own message), never the key. At most once per 20 seconds."""
    from app.jobs import ai_health

    if _last_check["at"] and (now() - _last_check["at"]).total_seconds() < 20:
        raise ApiError(429, "too_soon", "The AI was tested a moment ago. Try again in 20 seconds.")
    _last_check["at"] = now()
    out = await ai_health.probe(db)
    await audit(db, auth.user.id, "daily_report.ai_check", data={"ok": out.get("ok"), "kind": out.get("kind", "")})
    return out


# --- the collector's run report ------------------------------------------------------------------------------------

REASONS_MAX = 50


class RunCounts(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sent: int = Field(0, ge=0, le=1_000_000)
    created: int = Field(0, ge=0, le=1_000_000)
    updated: int = Field(0, ge=0, le=1_000_000)
    review: int = Field(0, ge=0, le=1_000_000)
    rejected: int = Field(0, ge=0, le=1_000_000)
    closed: int = Field(0, ge=0, le=1_000_000)
    checked: int = Field(0, ge=0, le=1_000_000)
    dead: int = Field(0, ge=0, le=1_000_000)


def _reasons(v: Any) -> dict[str, int]:
    if v is None:
        return {}
    if not isinstance(v, dict) or len(v) > REASONS_MAX:
        raise ValueError(f"at most {REASONS_MAX} reasons")
    out = {}
    for k, n in v.items():
        k = " ".join(str(k).split())
        if not k or len(k) > 80 or "." in k or k.startswith("$"):
            raise ValueError("a reason is 1–80 characters, without dots or $")
        if not isinstance(n, int) or isinstance(n, bool) or not 0 <= n <= 1_000_000:
            raise ValueError("a reason's count is a whole number")
        out[k] = n
    return out


class RunReport(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")
    run_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._:\-]+$")
    kind: Literal["post", "links"]
    started_at: datetime
    finished_at: datetime | None = None
    ok: bool
    error: str = Field("", max_length=500)
    counts: RunCounts = Field(default_factory=RunCounts)
    review_reasons: dict[str, int] = Field(default_factory=dict)
    rejected_reasons: dict[str, int] = Field(default_factory=dict)
    source: str = Field("", max_length=100)

    @field_validator("review_reasons", "rejected_reasons", mode="before")
    @classmethod
    def _r(cls, v: Any) -> dict[str, int]:
        return _reasons(v)

    @field_validator("started_at", "finished_at")
    @classmethod
    def _tz(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            from datetime import UTC

            v = v.replace(tzinfo=UTC)
        return v


@collector_router.post("/run-report")
async def run_report(request: Request, db: DB, authorization: str | None = Header(None)) -> dict[str, Any]:
    """The job collector says how a run went (the morning post or the link check). Sending the same runId again
    replaces that run's report (one document per run)."""
    from app.jobs.collector import _auth, _body

    await _auth(request, db, authorization)
    data = await _body(request)
    try:
        body = RunReport.model_validate(data)
    except ValidationError as e:
        raise ApiError(
            400,
            "bad_body",
            "Send the run report: " + "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()[:3]),
        ) from None
    t = now()
    doc = {
        "kind": body.kind, "started_at": body.started_at, "finished_at": body.finished_at, "ok": body.ok,
        "error": " ".join(body.error.split())[:500], "counts": body.counts.model_dump(),
        "review_reasons": body.review_reasons, "rejected_reasons": body.rejected_reasons, "source": body.source[:100],
        "day": ist_today(body.started_at).isoformat(), "received_at": t,
    }  # fmt: skip
    r = await db[COLLECTOR_RUNS].update_one(
        {"_id": body.run_id}, {"$set": doc, "$setOnInsert": {"created_at": t}}, upsert=True
    )
    return {"ok": True, "runId": body.run_id, "stored": "created" if r.upserted_id else "updated", "day": doc["day"]}
