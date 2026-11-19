# ruff: noqa: E501  (dense pipelines and response lines)
"""Vetting Trust T13: time to hire, in minutes, from events that already happen.

For each company job, the minutes from the job being posted to:
  shortlist   the first candidate shortlisted: the company invited someone from Hire now, moved an applicant to
              Shortlisted (or straight to Interview / Offer), or the T5 calling agent marked someone interested and a
              fit (answers that pass the job's yes/no questions)
  contact     the first message, call or email to a candidate about this job: a Hire now invite (it emails the
              person), a T5 WhatsApp / AI call, a T11 booking-link invite, the company scheduling an interview (the
              invitation email) or an offer. An interview or an offer means the person was contacted by then at the
              latest, so they count too.
  interview   the first interview booked: a Hire interview time booked (H5, T5 or the T11 link) or the company putting
              an applicant at Interview
  offer       the first offer sent (Hire → Offers)
  accepted    the first offer accepted · joined   the first person who joined (both shown as extra columns)

Where the times come from (nothing is rewritten; old jobs are measured from the timestamps they already have):
hire_invites.created_at, applications.timeline (shortlisted / interview / offer) and the T5 fit (applications made by
the agent with fit.ok, at agent.at), trust_agent_events (wa_template, wa_text, call, t11_invite), hire_slots.booked_at,
hire_offers.created_at / answered_at, hire_events "joined" (via the offer), and one small new collection:

  trust_hire_events   _id = "<job id>:<kind>": job_id, company_id, kind, at (the FIRST time; later writes use $min,
                      so a time never moves later), via, n. Written at the sources where a first time could be lost
                      later (an invite sent again after it expired overwrites its date; a booking moved to another
                      time overwrites booked_at; the T5 fit moment; joined). No people in it: no consent or
                      retention schedule is needed (it is the company's own hiring record).

Every number is counted in MongoDB: per batch of at most BATCH jobs, one aggregation per source grouped by job (a
handful of rows per job, never the source collections in memory). At most JOB_CAP jobs (posted in the last 180 days)
are measured for the overall numbers, 200 for a company. Demo companies, demo jobs and demo / test accounts (test users
are demo accounts) are never counted in the overall numbers.

Stats per step: median and 75th percentile (p75) of the minutes, for jobs posted in the last 7 / 30 / 90 days (only jobs
that reached the step), against the period before (▲ slower / ▼ faster), the funnel (jobs posted → reaching each step),
per company and overall.
"""

import logging
from datetime import datetime, timedelta
from typing import Any

from pymongo.errors import DuplicateKeyError

from app.core.db import (
    APPLICATIONS,
    COMPANIES,
    DAILY_REPORTS,
    HIRE_EVENTS,
    HIRE_INVITES,
    HIRE_OFFERS,
    HIRE_SLOTS,
    JOBS,
    TRUST_AGENT_EVENTS,
    TRUST_HIRE_EVENTS,
    USERS,
)
from app.core.time import now

log = logging.getLogger("nm7.trust.tth")

STEPS = ("shortlist", "contact", "interview", "offer", "accepted", "joined")
MAIN = ("shortlist", "contact", "interview", "offer")
LABELS = {"shortlist": "First shortlist", "contact": "First contact", "interview": "First interview booked",
          "offer": "First offer sent", "accepted": "Offer accepted", "joined": "Joined"}  # fmt: skip
PERIODS = (7, 30, 90)
LOOKBACK = timedelta(days=180)  # two 90-day periods (this one and the one before)
JOB_CAP = 5000  # jobs measured for the overall numbers
COMPANY_JOBS = 200  # jobs measured for one company
BATCH = 500  # job ids per aggregation
DEMO_CAP = 20_000  # demo / test accounts left out (by id)
CONTACT_KINDS = ("wa_template", "wa_text", "call", "t11_invite")  # T5 messages and calls, T11 booking-link invites
SLOWEST = 5
COMPANIES_SHOWN = 20
STALE_SHOWN = 5
NM7_MIN_JOBS = 10  # the Nm7 median is shown to a company only over at least this many jobs …
NM7_MIN_COMPANIES = 3  # … from at least this many companies (no company's numbers can be read from it)

DEFAULTS = {"contact_hours": 24, "stale_hours": 48, "min_jobs": 3}
BOUNDS = {"contact_hours": (1, 336), "stale_hours": (1, 720), "min_jobs": (1, 50)}


def settings_of(site: dict[str, Any]) -> dict[str, int]:
    st = (site.get("trust") or {}).get("tth") or {}
    out = {}
    for k, d in DEFAULTS.items():
        lo, hi = BOUNDS[k]
        try:
            out[k] = max(lo, min(hi, int(st.get(k, d))))
        except (TypeError, ValueError):
            out[k] = d
    return out


# --- words -------------------------------------------------------------------------------------------------------------


def dur_text(m: int | float | None) -> str:
    """45 m · 2 h 15 m · 3 d 4 h (whole minutes; days and hours once it is a day or more)."""
    if m is None:
        return "—"
    m = max(0, round(m))
    if m < 60:
        return f"{m} m"
    if m < 24 * 60:
        h, r = divmod(m, 60)
        return f"{h} h {r} m" if r else f"{h} h"
    d, r = divmod(m, 24 * 60)
    h = r // 60
    return f"{d} d {h} h" if h else f"{d} d"


def change(cur: int | None, prev: int | None) -> dict[str, Any]:
    """Slower / faster than the period before (lower is better)."""
    if cur is None or prev is None:
        return {"dir": "none", "text": "No earlier period to compare", "delta": None}
    d = cur - prev
    if d == 0:
        return {"dir": "same", "text": "Same as the period before", "delta": 0}
    return {"dir": "up" if d > 0 else "down", "delta": d,
            "text": f"{dur_text(abs(d))} {'slower' if d > 0 else 'faster'} than the period before"}  # fmt: skip


def pct(xs: list[int], q: float) -> int | None:
    """The q-th percentile (0–100) with linear interpolation (the median of 1, 2, 3, 4 is 2.5 → 3 minutes)."""
    if not xs:
        return None
    s = sorted(xs)
    pos = (len(s) - 1) * q / 100
    lo = int(pos)
    hi = min(lo + 1, len(s) - 1)
    return round(s[lo] + (s[hi] - s[lo]) * (pos - lo))


# --- the times (aggregations per source, grouped by job) ---------------------------------------------------------------


async def demo_users(db) -> list[str]:
    """Demo and test accounts (test users are demo accounts), left out of the overall numbers."""
    return [u["_id"] async for u in db[USERS].find({"demo": True}, {"_id": 1}).limit(DEMO_CAP)]


def _first_in_timeline(statuses: list[str]) -> dict[str, Any]:
    return {"$min": {"$map": {"input": {"$filter": {"input": {"$ifNull": ["$timeline", []]}, "as": "x",
                                                    "cond": {"$in": ["$$x.status", statuses]}}},
                              "as": "x", "in": "$$x.at"}}}  # fmt: skip


async def _rows(db, coll: str, pipe: list[dict[str, Any]], cap: int) -> list[dict[str, Any]]:
    return [r async for r in await db[coll].aggregate([*pipe, {"$limit": cap}])]


async def _batch_times(db, jids: list[str], cids: list[str], skip_users: list[str]) -> dict[str, dict[str, datetime]]:
    out: dict[str, dict[str, datetime]] = {j: {} for j in jids}
    nu = {"user_id": {"$nin": skip_users}} if skip_users else {}
    cap = len(jids) + 1

    def put(jid: Any, step: str, at: Any) -> None:
        if jid in out and isinstance(at, datetime):
            cur = out[jid].get(step)
            out[jid][step] = at if cur is None or at < cur else cur

    q = {"company_id": {"$in": cids}, "job_id": {"$in": jids}, **nu}
    for r in await _rows(
        db, HIRE_INVITES, [{"$match": q}, {"$group": {"_id": "$job_id", "at": {"$min": "$created_at"}}}], cap
    ):
        put(r["_id"], "shortlist", r["at"])
        put(r["_id"], "contact", r["at"])
    apps = [
        {"$match": q},
        {"$project": {"job_id": 1, "sl": _first_in_timeline(["shortlisted", "interview", "offer"]), "iv": _first_in_timeline(["interview"]),
                      "fit": {"$cond": [{"$and": [{"$eq": ["$origin", "agent"]}, {"$eq": ["$fit.ok", True]}]},
                                        {"$ifNull": ["$agent.at", "$created_at"]}, None]}}},
        {"$group": {"_id": "$job_id", "sl": {"$min": "$sl"}, "iv": {"$min": "$iv"}, "fit": {"$min": "$fit"}}},
    ]  # fmt: skip
    for r in await _rows(db, APPLICATIONS, apps, cap):
        put(r["_id"], "shortlist", r.get("sl"))
        put(r["_id"], "shortlist", r.get("fit"))
        put(r["_id"], "interview", r.get("iv"))
    ev = {"job_id": {"$in": jids}, "kind": {"$in": list(CONTACT_KINDS)}, **nu}
    for r in await _rows(
        db, TRUST_AGENT_EVENTS, [{"$match": ev}, {"$group": {"_id": "$job_id", "at": {"$min": "$at"}}}], cap
    ):
        put(r["_id"], "contact", r["at"])
    sq = {"job_id": {"$in": jids}, "booked_at": {"$ne": None}, **nu}
    for r in await _rows(
        db, HIRE_SLOTS, [{"$match": sq}, {"$group": {"_id": "$job_id", "at": {"$min": "$booked_at"}}}], cap
    ):
        put(r["_id"], "interview", r["at"])
    offers = [
        {"$match": q},
        {"$group": {"_id": "$job_id", "offer": {"$min": "$created_at"},
                    "accepted": {"$min": {"$cond": [{"$in": ["$status", ["accepted", "joined", "dropped"]]}, "$answered_at", None]}}}},
    ]  # fmt: skip
    for r in await _rows(db, HIRE_OFFERS, offers, cap):
        put(r["_id"], "offer", r.get("offer"))
        put(r["_id"], "accepted", r.get("accepted"))
    joined = [
        {"$match": {**q, "status": "joined"}},
        {"$lookup": {"from": HIRE_EVENTS, "let": {"u": "$user_id", "r": {"$toString": "$_id"}},
                     "pipeline": [{"$match": {"$expr": {"$and": [{"$eq": ["$user_id", "$$u"]}, {"$eq": ["$ref", "$$r"]}, {"$eq": ["$kind", "joined"]}]}}},
                                  {"$project": {"at": 1}}, {"$limit": 1}], "as": "ev"}},
        {"$group": {"_id": "$job_id", "at": {"$min": {"$ifNull": [{"$first": "$ev.at"}, "$updated_at"]}}}},
    ]  # fmt: skip
    for r in await _rows(db, HIRE_OFFERS, joined, cap):
        put(r["_id"], "joined", r.get("at"))
    mine = [
        {"$match": {"job_id": {"$in": jids}}},
        {"$group": {"_id": {"j": "$job_id", "k": "$kind"}, "at": {"$min": "$at"}}},
    ]
    for r in await _rows(db, TRUST_HIRE_EVENTS, mine, cap * len(STEPS)):
        if r["_id"].get("k") in STEPS:
            put(r["_id"].get("j"), r["_id"]["k"], r["at"])
    return out


async def job_times(
    db, jobs: list[dict[str, Any]], skip_users: list[str] | None = None
) -> dict[str, dict[str, datetime]]:
    """{job id: {step: first time}} for these jobs, BATCH job ids per aggregation."""
    out: dict[str, dict[str, datetime]] = {}
    for i in range(0, len(jobs), BATCH):
        part = jobs[i : i + BATCH]
        cids = sorted({str(j.get("company_id")) for j in part if j.get("company_id")})
        out.update(await _batch_times(db, [j["_id"] for j in part], cids, skip_users or []))
    return out


def posted_of(j: dict[str, Any]) -> datetime | None:
    return j.get("posted_at") or j.get("created_at")


def minutes_for(j: dict[str, Any], times: dict[str, datetime]) -> dict[str, int | None]:
    """Minutes from posting to each step. An interview or an offer means the person was shortlisted and contacted by
    then at the latest (a company can move someone straight to Interview)."""
    t = dict(times)
    later = [x for x in (t.get("interview"), t.get("offer")) if x]
    for k in ("shortlist", "contact"):
        xs = [x for x in (t.get(k), *later) if x]
        t[k] = min(xs) if xs else None
    p = posted_of(j)
    return {k: (max(0, round((t[k] - p).total_seconds() / 60)) if p and t.get(k) else None) for k in STEPS}


def rows_for(jobs: list[dict[str, Any]], times: dict[str, dict[str, datetime]]) -> list[dict[str, Any]]:
    return [{"id": j["_id"], "company_id": j.get("company_id"), "title": j.get("title", ""), "status": j.get("status"),
             "posted": posted_of(j), "minutes": minutes_for(j, times.get(j["_id"]) or {})} for j in jobs if posted_of(j)]  # fmt: skip


def stats(rows: list[dict[str, Any]], lo: datetime, hi: datetime) -> dict[str, Any]:
    """Median / p75 per step and the funnel for jobs posted in [lo, hi)."""
    sel = [r for r in rows if lo <= r["posted"] < hi]
    steps = {}
    for k in STEPS:
        xs = [r["minutes"][k] for r in sel if r["minutes"][k] is not None]
        med, p75 = pct(xs, 50), pct(xs, 75)
        steps[k] = {
            "n": len(xs),
            "median": med,
            "p75": p75,
            "medianText": dur_text(med) if xs else "—",
            "p75Text": dur_text(p75) if xs else "—",
        }
    return {"jobs": len(sel), "companies": len({r["company_id"] for r in sel}), "steps": steps,
            "funnel": [{"key": "posted", "label": "Jobs posted", "n": len(sel)}] + [{"key": k, "label": LABELS[k], "n": steps[k]["n"]} for k in STEPS]}  # fmt: skip


def periods(rows: list[dict[str, Any]], t: datetime) -> dict[str, Any]:
    out = {}
    for d in PERIODS:
        cur = stats(rows, t - timedelta(days=d), t + timedelta(seconds=1))
        prev = stats(rows, t - timedelta(days=2 * d), t - timedelta(days=d))
        for k in STEPS:
            s, p = cur["steps"][k], prev["steps"][k]
            s["prevMedian"], s["prevN"] = p["median"], p["n"]
            s["change"] = change(s["median"], p["median"])
        cur["prevJobs"] = prev["jobs"]
        out[str(d)] = cur
    return out


def job_out(r: dict[str, Any]) -> dict[str, Any]:
    m = r["minutes"]
    return {"id": r["id"], "title": r["title"], "status": r["status"], "postedAt": int(r["posted"].timestamp() * 1000),
            "minutes": m, "text": {k: dur_text(m[k]) if m[k] is not None else "Not yet" for k in STEPS}}  # fmt: skip


# --- the overall numbers (Admin → Daily report) -----------------------------------------------------------------------


async def real_jobs(db, t: datetime) -> list[dict[str, Any]]:
    """Company jobs created in the last 180 days, not demo, not from a demo company (newest first, capped)."""
    q = {
        "source": "company",
        "created_at": {"$gte": t - LOOKBACK},
        "demo": {"$ne": True},
        "company_id": {"$nin": [None, ""]},
    }
    proj = {"_id": 1, "company_id": 1, "title": 1, "status": 1, "posted_at": 1, "created_at": 1}
    jobs = await db[JOBS].find(q, proj).sort("created_at", -1).limit(JOB_CAP).to_list(JOB_CAP)
    cids = sorted({j["company_id"] for j in jobs})
    demo = {
        c["_id"]
        async for c in db[COMPANIES].find({"_id": {"$in": cids}, "demo": True}, {"_id": 1}).limit(len(cids) + 1)
    }
    return [j for j in jobs if j["company_id"] not in demo]


async def _names(db, cids: list[str]) -> dict[str, str]:
    return {c["_id"]: ((c.get("details") or {}).get("legal_name") or "A company")
            async for c in db[COMPANIES].find({"_id": {"$in": cids}}, {"details.legal_name": 1}).limit(len(cids) + 1)}  # fmt: skip


async def section(db, site: dict[str, Any], t: datetime | None = None) -> dict[str, Any]:
    """The "Time to hire" section of the Daily report snapshot."""
    t = t or now()
    st = settings_of(site)
    jobs = await real_jobs(db, t)
    times = await job_times(db, jobs, await demo_users(db))
    rows = rows_for(jobs, times)
    per = periods(rows, t)
    month = [r for r in rows if r["posted"] >= t - timedelta(days=30)]
    by_co: dict[str, list[dict[str, Any]]] = {}
    for r in month:
        by_co.setdefault(r["company_id"], []).append(r)
    names = await _names(db, sorted(by_co))
    slow = []
    for cid, rs in by_co.items():
        xs = [r["minutes"]["contact"] for r in rs if r["minutes"]["contact"] is not None]
        if len(xs) >= st["min_jobs"]:
            med = pct(xs, 50)
            slow.append({"companyId": cid, "name": names.get(cid, "A company"), "jobs": len(rs), "contacted": len(xs),
                         "noContact": len(rs) - len(xs), "median": med, "medianText": dur_text(med)})  # fmt: skip
    slow.sort(key=lambda x: (-x["median"], x["name"]))
    companies = []
    for cid, rs in sorted(by_co.items(), key=lambda kv: (-len(kv[1]), names.get(kv[0], "")))[:COMPANIES_SHOWN]:
        s = stats(rs, t - timedelta(days=30), t + timedelta(seconds=1))
        companies.append({"companyId": cid, "name": names.get(cid, "A company"), "jobs": len(rs),
                          "steps": {k: {"n": s["steps"][k]["n"], "median": s["steps"][k]["median"], "medianText": s["steps"][k]["medianText"]} for k in STEPS}})  # fmt: skip
    stale_cut = t - timedelta(hours=st["stale_hours"])
    stale = sorted([r for r in month if r["status"] == "active" and r["posted"] <= stale_cut and r["minutes"]["contact"] is None],
                   key=lambda r: r["posted"])  # fmt: skip
    snames = await _names(db, sorted({r["company_id"] for r in stale[:STALE_SHOWN]}))
    return {
        "at": int(t.timestamp() * 1000),
        "steps": [{"key": k, "label": LABELS[k], "extra": k not in MAIN} for k in STEPS],
        "periods": per,
        "slowest": slow[:SLOWEST],
        "companies": companies,
        "stale": {
            "hours": st["stale_hours"],
            "n": len(stale),
            "jobs": [
                {
                    "title": r["title"],
                    "company": snames.get(r["company_id"], "A company"),
                    "hours": round((t - r["posted"]).total_seconds() / 3600),
                }
                for r in stale[:STALE_SHOWN]
            ],
        },  # fmt: skip
        "settings": st,
        "measured": len(rows),
        "capped": len(jobs) >= JOB_CAP,
    }


def contact_median(tth: dict[str, Any]) -> tuple[int | None, int]:
    """The median time to first contact the attention rule uses: the last 7 days when at least 3 jobs were contacted
    in them, else the last 30 days. → (minutes, days)."""
    per = tth.get("periods") or {}
    w = ((per.get("7") or {}).get("steps") or {}).get("contact") or {}
    if (w.get("n") or 0) >= 3:
        return w.get("median"), 7
    m = ((per.get("30") or {}).get("steps") or {}).get("contact") or {}
    return m.get("median"), 30


def attention(tth: dict[str, Any] | None, st: dict[str, int]) -> list[dict[str, Any]]:
    """ "Needs attention" items: the median time to first contact over the Admin threshold, and live jobs older than
    the Admin hours with no contact at all."""
    if not tth:
        return []
    out = []
    med, days = contact_median(tth)
    if med is not None and med > st["contact_hours"] * 60:
        out.append({"key": "tth_contact_slow", "level": "warn", "link": None,
                    "text": f"Time to first contact is slow: the median over the last {days} days is {dur_text(med)} "
                            f"(more than {st['contact_hours']} h)."})  # fmt: skip
    stale = tth.get("stale") or {}
    n = int(stale.get("n") or 0)
    if n:
        out.append({"key": "tth_no_contact", "level": "warn", "link": "/admin/companies",
                    "text": f"{n:,} live {'job' if n == 1 else 'jobs'} posted more than {stale.get('hours')} h ago "
                            f"{'has' if n == 1 else 'have'} no contact with any candidate yet."})  # fmt: skip
    return out


# --- one company (its own jobs only) ----------------------------------------------------------------------------------


async def nm7_medians(db) -> dict[str, Any]:
    """The overall medians from the latest Daily report snapshot, per period, only where enough jobs and companies
    are behind them (no other company's numbers can be read from it)."""
    d = await db[DAILY_REPORTS].find_one(
        {"timeToHire.periods": {"$exists": True}}, {"timeToHire.periods": 1, "timeToHire.at": 1}, sort=[("_id", -1)]
    )
    per = ((d or {}).get("timeToHire") or {}).get("periods") or {}
    out = {}
    for key, p in per.items():
        ok = int(p.get("jobs") or 0) >= NM7_MIN_JOBS and int(p.get("companies") or 0) >= NM7_MIN_COMPANIES
        out[key] = {k: ({"median": s.get("median"), "medianText": s.get("medianText")} if ok and s.get("n") else None)
                    for k, s in (p.get("steps") or {}).items()}  # fmt: skip
    return {"periods": out, "at": ((d or {}).get("timeToHire") or {}).get("at")}


async def company_view(db, cid: str, t: datetime | None = None) -> dict[str, Any]:
    t = t or now()
    jobs = (await db[JOBS].find({"company_id": cid, "source": "company"}, {"_id": 1, "company_id": 1, "title": 1, "status": 1, "posted_at": 1, "created_at": 1})
            .sort("created_at", -1).limit(COMPANY_JOBS).to_list(COMPANY_JOBS))  # fmt: skip
    rows = rows_for(jobs, await job_times(db, jobs))
    per = periods(rows, t)
    for p in per.values():
        p.pop("companies", None)
    nm7 = await nm7_medians(db)
    return {"steps": [{"key": k, "label": LABELS[k], "extra": k not in MAIN} for k in STEPS], "periods": per,
            "nm7": nm7, "jobs": [job_out(r) for r in rows]}  # fmt: skip


# --- writes at the sources --------------------------------------------------------------------------------------------


async def mark(db, job_id: str | None, kind: str, *, company_id: str | None = None, user_id: str | None = None,
               via: str = "", at: datetime | None = None) -> None:  # fmt: skip
    """Keep the first time this job reached `kind` ($min: never later). Demo / test accounts are not recorded. Never
    raises: the hiring action it follows always stands."""
    if not job_id or kind not in STEPS:
        return
    try:
        if user_id:
            u = await db[USERS].find_one({"_id": user_id}, {"demo": 1})
            if u and u.get("demo"):
                return
        t = at or now()
        for _ in range(2):
            try:
                await db[TRUST_HIRE_EVENTS].update_one(
                    {"_id": f"{job_id}:{kind}"},
                    {"$min": {"at": t}, "$inc": {"n": 1}, "$set": {"updated_at": now()},
                     "$setOnInsert": {"job_id": job_id, "company_id": company_id, "kind": kind, "via": via}},
                    upsert=True,
                )  # fmt: skip
                return
            except DuplicateKeyError:  # two writes at once: the other one made it; $min again
                continue
    except Exception:  # noqa: BLE001
        log.warning("time to hire: could not record %s for a job", kind)
