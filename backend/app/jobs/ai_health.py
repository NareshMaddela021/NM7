"""Is the collector's AI working? (the 17 Nov outage: every summary failed and Admin only saw "the summary failed a
check", while the real reason, an error from the Anthropic API, was only in the server log).

- every collector summary attempt is recorded: the last success, and the last API error with its kind and Anthropic's
  own message (never the key, the prompt or the page: claude.error_detail);
- after FAIL_STREAK API errors in a row the server stops calling for PAUSE (the rest of the batch waits for review
  with the reason "ai_error" and is sent back to the collector, so the next run writes them) instead of failing a
  thousand calls;
- Admin → Daily report shows it ("Needs attention" when jobs arrived and no summary was written) and has a
  "Test the AI now" button (probe(): one short summary of a made-up job page).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from app.core import claude
from app.core.db import SETTINGS
from app.core.time import IST, now

log = logging.getLogger("nm7.jobs")
DOC = "collector_ai"
FAIL_STREAK = 5
PAUSE = timedelta(minutes=10)
_state: dict[str, Any] = {"streak": 0, "until": None, "kind": ""}


def _day() -> str:
    return now().astimezone(IST).strftime("%Y-%m-%d")


def paused() -> str:
    """The error kind while calls are paused after a run of API errors, else ""."""
    until = _state["until"]
    if until and now() < until:
        return _state["kind"] or "api_error"
    return ""


def reset() -> None:  # tests
    _state.update(streak=0, until=None, kind="")


async def record_ok(db) -> None:
    _state.update(streak=0, until=None, kind="", probe="ok")
    day = _day()
    await db[SETTINGS].update_one({"_id": DOC}, {"$set": {"last_ok_at": now()}, "$inc": {f"ok.{day}": 1}}, upsert=True)


async def record_error(db, e: BaseException) -> str:
    """Remember an API error (kind + Anthropic's message); pause calls after a streak. Returns the kind."""
    kind = claude.error_kind(e)
    detail = claude.error_detail(e).strip()
    _state["streak"] += 1
    _state["kind"] = kind
    if _state["streak"] >= FAIL_STREAK and not paused():
        _state["until"] = now() + PAUSE
        log.warning("collector AI paused for %s after %s errors in a row (%s)", PAUSE, _state["streak"], kind)
    day = _day()
    await db[SETTINGS].update_one(
        {"_id": DOC},
        {"$set": {"last_error_at": now(), "last_error_kind": kind, "last_error_detail": detail[:400]},
         "$inc": {f"errors.{day}": 1}},
        upsert=True,
    )  # fmt: skip
    return kind


async def status(db) -> dict[str, Any]:
    """For Admin (Daily report): today's successes and API errors, the last error and the last success."""
    d = await db[SETTINGS].find_one({"_id": DOC}) or {}
    day = _day()

    def ms(t: datetime | None) -> int | None:
        return int(t.timestamp() * 1000) if t else None

    return {
        "okToday": int((d.get("ok") or {}).get(day) or 0),
        "errorsToday": int((d.get("errors") or {}).get(day) or 0),
        "lastOkAt": ms(d.get("last_ok_at")),
        "lastErrorAt": ms(d.get("last_error_at")),
        "lastErrorKind": d.get("last_error_kind") or "",
        "lastError": d.get("last_error_detail") or "",
        "paused": bool(paused()),
    }


PROBE_PAGE = (
    "Data Analyst (Fresher) - Hyderabad. We are hiring a Data Analyst to join our analytics team in Hyderabad. "
    "You will clean and analyse sales data, build weekly dashboards in Excel and Power BI, write SQL queries to "
    "answer business questions and present findings to managers. Requirements: a bachelor's degree in any "
    "discipline, good knowledge of Excel and SQL, basic statistics, clear communication in English. Freshers and "
    "candidates with up to one year of experience can apply. Work from our Hyderabad office, five days a week."
)


async def probe(db) -> dict[str, Any]:
    """One real summary of a made-up job page (a few paise), with the same model, schema and checks as the collector.
    {"ok": True, "model": …} or {"ok": False, "kind": …, "error": Anthropic's message}. Not counted in the
    collector's daily allowance."""
    from app.core.config import get_settings
    from app.jobs import collector

    if not get_settings().anthropic_api_key:
        return {"ok": False, "kind": "no_key", "error": "ANTHROPIC_API_KEY isn't set on the server."}
    j = collector.CollectorJob.model_validate({
        "company": "Example Analytics", "title": "Data Analyst (Fresher)", "apply_url": "https://example.com/jobs/1",
        "location": "Hyderabad", "page_text": PROBE_PAGE,
    })  # fmt: skip
    page = collector.scrub(j.page_text)
    stats: dict[str, Any] = {}
    try:
        await claude.ask_models("jobs", collector.prompt(j, page), collector.SCHEMA, collector.check_summary(page),
                                stats=stats, **collector.ASK, http_client=collector.HTTP_CLIENT)  # fmt: skip
    except claude.Unusable as e:
        return {"ok": False, "kind": e.reason, "error": "The AI answered, but the answer failed the summary checks."}
    except Exception as e:  # noqa: BLE001
        kind = await record_error(db, e)
        return {"ok": False, "kind": kind, "error": claude.error_detail(e).strip() or type(e).__name__}
    await record_ok(db)
    return {"ok": True, "model": stats.get("model") or get_settings().anthropic_model}


_probed = {"done": False}


async def probe_once(db) -> int:
    """After each deploy or restart: one probe, so a broken key / credit / model shows on /version and the Daily
    report within minutes instead of at the next morning run. Returns 1 when it ran."""
    from app.core.config import get_settings

    if _probed["done"] or get_settings().app_env == "test":
        return 0
    _probed["done"] = True
    out = await probe(db)
    _state["probe"] = "ok" if out.get("ok") else f"error:{out.get('kind') or 'unknown'}"
    log.info("collector AI check after start: %s", _state["probe"])
    return 1


def coarse() -> str:
    """For /version: "ok", "error:<kind>" or "unknown" (never Anthropic's message or anything else)."""
    if _state.get("until") and paused():
        return f"error:{_state.get('kind') or 'api_error'}"
    return _state.get("probe") or "unknown"
