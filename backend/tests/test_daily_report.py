# ruff: noqa: E501  (dense test records)
"""Admin → Daily report: the daily snapshot (one doc per IST day, idempotent, 30-day backfill), the collector's run
report (same key as POST /api/jobs/collector; idempotent by runId), the report's shape with an empty database and with
data, the plain-words summary and the "Needs attention" rules, demo records left out, and the automation running the
snapshot once a day from 06:30 IST."""

from datetime import datetime, timedelta

import pytest

from app.admin import daily_report as dr
from app.automation import run_rules, take_lease
from app.core.config import get_settings
from app.core.db import (
    APPLICATIONS,
    AUDIT_LOG,
    COLLECTOR_RUNS,
    COMPANIES,
    DAILY_REPORTS,
    JOBS,
    ORGANIZATIONS,
    PAYMENTS,
    USERS,
    VETTING_QUEUE,
)
from app.core.time import IST, now

KEY = "k" * 48


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(get_settings(), "job_ingest_key", KEY)
    return {"Authorization": f"Bearer {KEY}"}


def at_ist(day, hh, mm=0):
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=IST)


def today():
    return dr.ist_today()


async def user(db, uid, created, demo=False, role="customer"):
    await db[USERS].insert_one({"_id": uid, "role": role, "email": f"{uid}@example.com", "email_lc": f"{uid}@example.com",
                                "name": uid, "created_at": created, **({"demo": True} if demo else {})})  # fmt: skip


async def job(db, jid, created, status="active", source="collector", reasons=None, demo=False, **extra):
    await db[JOBS].insert_one({"_id": jid, "dedupe_key": f"k-{jid}", "slug": f"s-{jid}", "title": f"Job {jid}", "status": status, "source": source, "demo": demo,
                               "locations": extra.pop("locations", ["Hyderabad"]), "experience": extra.pop("experience", "fresher"),
                               "review": {"reasons": reasons or []}, "closes_at": None, "created_at": created,
                               "updated_at": extra.pop("updated_at", created), **extra})  # fmt: skip


# --- the report endpoint -------------------------------------------------------------------------------------------


async def test_report_with_an_empty_database(owner, client, db):
    r = await owner.get("/api/admin/daily-report")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["day"] == today().isoformat() and len(d["days"]) == 30 and d["days"][-1] == d["day"]
    assert set(dr.METRICS) <= set(d["metrics"])
    for k, v in d["metrics"].items():
        assert set(v) == {"value", "prev", "delta", "series"} and len(v["series"]) == 30, k
    assert d["metrics"]["signups"]["value"] == 0 and d["metrics"]["signups"]["prev"] is None
    assert d["today"]["day"] == d["day"] and d["yesterday"] is None and d["busy"] is False
    assert d["collectorRun"]["arrived"] is False
    assert len(d["summary"]) == 5 and d["summary"][1].startswith("0 new sign-ups")
    assert d["health"]["up"] is True and isinstance(d["health"]["dbMs"], int)
    assert d["health"]["github"]["connected"] is False
    assert len(d["today"]["vetting"]["measures"]) == 7
    assert {x["state"] for x in d["today"]["vetting"]["measures"]} == {"none"}
    assert [x["level"] for x in d["today"]["vetting"]["levels"]] == [0, 1, 2, 3, 4]
    # computed live on the first look, then stored: one document for today
    assert await db[DAILY_REPORTS].count_documents({}) == 1
    await owner.get("/api/admin/daily-report")
    assert await db[DAILY_REPORTS].count_documents({}) == 1
    # behind admin login
    assert (await client.get("/api/admin/daily-report")).status_code in (401, 403)
    assert (await client.post("/api/admin/daily-report/refresh")).status_code in (401, 403)


async def test_report_with_data_and_demo_records_left_out(owner, db):
    t = now()
    await user(db, "u1", t)
    await user(db, "u2", t)
    await user(db, "u-demo", t, demo=True)
    await user(db, "a1", t, role="admin")
    await db[ORGANIZATIONS].insert_many([{"_id": "o1", "name": "College", "created_at": t},
                                         {"_id": "o2", "name": "Demo", "created_at": t, "demo": True}])  # fmt: skip
    await db["memberships"].insert_many([{"_id": "m1", "org_id": "o1", "user_id": "u1", "joined_at": t},
                                         {"_id": "m2", "org_id": "o2", "user_id": "u2", "joined_at": t}])  # fmt: skip
    await db[COMPANIES].insert_many(
        [{"_id": "c1", "slug": "c1", "created_at": t}, {"_id": "c2", "slug": "c2", "created_at": t, "demo": True}]
    )
    await job(db, "j1", t, locations=["Hyderabad", "Pune"], experience="1_3")
    await job(db, "j2", t, status="review", reasons=["no_page_text", "city_not_stated"], locations=[])
    await job(db, "j3", t, status="review", reasons=["no_page_text"])
    await job(db, "j-demo", t, demo=True)
    await job(db, "jc", t, source="company")
    await job(db, "old-closed", t - timedelta(days=40), status="closed", updated_at=t)
    await db[AUDIT_LOG].insert_one({"_id": 990001, "action": "job.collector", "at": t, "data": {
        "created": 3, "updated": 0, "skipped": 1, "review": 2, "closed": 0, "rejected": 2, "rejectedBy": {"not_india": 2}}})  # fmt: skip
    await db[APPLICATIONS].insert_many([{"_id": "a1", "job_id": "j1", "created_at": t, "user_id": "u1", "key": "1"},
                                        {"_id": "a2", "job_id": "j1", "created_at": t, "user_id": "u2", "key": "2", "demo": True}])  # fmt: skip
    await db[PAYMENTS].insert_one({"_id": "p1", "status": "captured", "captured_at": t, "amount": 49900})
    await db[VETTING_QUEUE].insert_one({"kind": "fraud", "status": "open", "created_at": t})
    d = (await owner.post("/api/admin/daily-report/refresh")).json()
    m = {k: v["value"] for k, v in d["metrics"].items()}
    assert (
        m["signupSeekers"] == 2 and m["signupStudents"] == 1 and m["signupCompanies"] == 1 and m["signupColleges"] == 1
    )
    assert m["signups"] == 4
    assert (
        m["colCreated"] == 3
        and m["colReview"] == 2
        and m["colClosed"] == 1
        and m["colSent"] == 8
        and m["colRejected"] == 2
    )
    assert m["companyJobs"] == 1 and m["applications"] == 1 and m["revenue"] == 49900
    assert m["reviewQueue"] == 2 and m["liveJobs"] == 2 and m["fraudOpen"] == 1  # j1 and the company job are live
    col = d["today"]["collector"]
    assert col["fromRuns"] is False and col["rejectedReasons"] == {"not_india": 2}
    assert col["reviewReasons"] == {"no_page_text": 2, "city_not_stated": 1}
    assert {"name": "Hyderabad", "n": 2} in col["byCity"] and {"name": "1_3", "n": 1} in col["byBand"]
    assert d["collectorRun"]["arrived"] is True and d["collectorRun"]["source"] == "records"
    assert "Collector added 3 jobs, 2 wait for review." in d["summary"][0]
    assert d["summary"][1].startswith("4 new sign-ups")
    keys = {a["key"] for a in d["attention"]}
    assert "fraud_open" in keys and "review_queue" not in keys
    # series: today's value is the last point
    assert d["metrics"]["signupSeekers"]["series"][-1] == 2


# --- the snapshot job ----------------------------------------------------------------------------------------------


async def test_snapshot_one_doc_per_day_idempotent_with_backfill(db):
    t = now()
    d0 = today()
    await user(db, "today", at_ist(d0, 0, 5) if t >= at_ist(d0, 0, 5) else t)
    await user(db, "y", at_ist(d0 - timedelta(days=1), 12))
    await user(db, "three", at_ist(d0 - timedelta(days=3), 12))
    await user(db, "old", at_ist(d0 - timedelta(days=45), 12))
    await job(db, "j3", at_ist(d0 - timedelta(days=3), 9))
    n = await dr.run(db, t)
    assert n == 30 and await db[DAILY_REPORTS].count_documents({}) == 30
    assert await dr.run(db, t) == 2  # again: today and yesterday recomputed, nothing new backfilled
    assert await db[DAILY_REPORTS].count_documents({}) == 30
    three = await db[DAILY_REPORTS].find_one({"_id": (d0 - timedelta(days=3)).isoformat()})
    assert three["backfilled"] is True and three["final"] is True
    assert three["m"]["signupSeekers"] == 1 and three["m"]["colCreated"] == 1
    assert "liveJobs" not in three["m"]  # state numbers only on the day's own snapshot
    y = await db[DAILY_REPORTS].find_one({"_id": (d0 - timedelta(days=1)).isoformat()})
    assert y["m"]["signupSeekers"] == 1 and y["final"] is True
    td = await db[DAILY_REPORTS].find_one({"_id": d0.isoformat()})
    assert td["m"]["signupSeekers"] == 1 and "liveJobs" in td["m"] and not td.get("final")


async def test_automation_runs_it_once_a_day_from_six_thirty(db):
    d0 = today()
    assert await dr.daily_if_due(db, at_ist(d0, 6, 29)) == 0
    assert await db[DAILY_REPORTS].count_documents({}) == 0
    assert await dr.daily_if_due(db, at_ist(d0, 6, 31)) == 30
    assert await dr.daily_if_due(db, at_ist(d0, 9)) == 0  # once a day
    assert await dr.daily_if_due(db, at_ist(d0 + timedelta(days=1), 6, 40)) >= 2  # the next day
    # another heavy job running: skipped, tried again on the next pass
    await db["settings"].delete_one({"_id": "daily_report"})
    assert await take_lease(db, "heavy", timedelta(minutes=5))
    assert await dr.daily_if_due(db, at_ist(d0 + timedelta(days=2), 7)) == 0
    # the automation pass calls it
    done = await run_rules(db)
    assert "daily_report" in done


async def test_refresh_is_busy_while_another_heavy_job_runs(owner, db):
    assert await take_lease(db, "heavy", timedelta(minutes=5))
    r = await owner.post("/api/admin/daily-report/refresh")
    assert r.status_code == 429
    # the page still loads: today's numbers wait for the heavy job
    d = (await owner.get("/api/admin/daily-report")).json()
    assert d["busy"] is True and d["today"] is None and len(d["summary"]) == 1


# --- the collector's run report ------------------------------------------------------------------------------------


def run_body(run_id="run-1", ok=True, **extra):
    return {"runId": run_id, "kind": "post", "startedAt": now().isoformat(), "finishedAt": now().isoformat(), "ok": ok,
            "error": "" if ok else "Timeout talking to Greenhouse", "source": "github-actions",
            "counts": {"sent": 50, "created": 20, "updated": 10, "review": 12, "rejected": 8, "closed": 0},
            "reviewReasons": {"no_page_text": 9, "city_not_stated": 3}, "rejectedReasons": {"job_board_or_form": 8}, **extra}  # fmt: skip


async def test_run_report_auth(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "job_ingest_key", "")
    r = await client.post("/api/jobs/collector/run-report", json=run_body(), headers={"Authorization": f"Bearer {KEY}"})
    assert r.status_code == 503
    monkeypatch.setattr(get_settings(), "job_ingest_key", KEY)
    r = await client.post(
        "/api/jobs/collector/run-report", json=run_body(), headers={"Authorization": "Bearer wrong" + "x" * 40}
    )
    assert r.status_code == 401
    r = await client.post("/api/jobs/collector/run-report", json=run_body())
    assert r.status_code == 401
    assert await db[COLLECTOR_RUNS].count_documents({}) == 0


async def test_run_report_stored_once_per_run_and_used_by_the_report(client, owner, db, key):
    r = await client.post("/api/jobs/collector/run-report", json=run_body(), headers=key)
    assert r.status_code == 200 and r.json()["stored"] == "created"
    r = await client.post("/api/jobs/collector/run-report", json=run_body(ok=False), headers=key)
    assert r.status_code == 200 and r.json()["stored"] == "updated"
    assert await db[COLLECTOR_RUNS].count_documents({}) == 1
    doc = await db[COLLECTOR_RUNS].find_one({"_id": "run-1"})
    assert doc["ok"] is False and doc["counts"]["created"] == 20 and doc["review_reasons"]["no_page_text"] == 9
    links = {"runId": "links-1", "kind": "links", "startedAt": now().isoformat(), "ok": True,
             "counts": {"checked": 300, "dead": 4, "closed": 4}}  # fmt: skip
    assert (await client.post("/api/jobs/collector/run-report", json=links, headers=key)).status_code == 200
    d = (await owner.post("/api/admin/daily-report/refresh")).json()
    m = {k: v["value"] for k, v in d["metrics"].items()}
    assert m["colSent"] == 50 and m["colCreated"] == 20 and m["colReview"] == 12 and m["colRejected"] == 8
    assert m["colClosed"] == 4
    col = d["today"]["collector"]
    assert col["fromRuns"] is True and col["rejectedReasons"] == {"job_board_or_form": 8}
    assert col["linkCheck"] == {"checked": 300, "dead": 4, "closed": 4}
    run = d["collectorRun"]
    assert run["arrived"] is True and run["ok"] is False and run["error"].startswith("Timeout")
    assert any(a["key"] == "collector_failed" for a in d["attention"])
    assert d["summary"][0].startswith("Collector run failed today.")


async def test_run_report_is_validated(client, db, key):
    bad = [
        run_body(reviewReasons={f"r{i}": 1 for i in range(51)}),  # at most 50 reasons
        run_body(rejectedReasons={"x" * 81: 1}),
        run_body(rejectedReasons={"$where": 1}),
        run_body(runId="bad id with spaces"),
        run_body(kind="other"),
        run_body(error="e" * 501),
        {**run_body(), "counts": {"sent": -1}},
    ]
    for b in bad:
        r = await client.post("/api/jobs/collector/run-report", json=b, headers=key)
        assert r.status_code == 400, b
    assert await db[COLLECTOR_RUNS].count_documents({}) == 0


# --- the words and the "Needs attention" rules -----------------------------------------------------------------------


def test_needs_attention_rules():
    ok_run = {"arrived": True, "ok": True, "late": True}
    extra = {"payments": {"ready": True}, "vetting": {"switchOn": False}, "ai": {"cap": 2000}}
    assert dr.attention({"reviewQueue": 20, "fraudOpen": 0}, extra, ok_run, 30) == []  # vetting off is no issue
    keys = lambda *a: [x["key"] for x in dr.attention(*a)]  # noqa: E731
    assert keys({"reviewQueue": 21}, extra, ok_run, 30) == ["review_queue"]
    assert keys({}, extra, {"arrived": False, "late": True}, 30) == ["collector_missing"]
    assert keys({}, extra, {"arrived": False, "late": False}, 30) == []  # before 7:00 AM: not yet
    assert keys({}, extra, {"arrived": True, "ok": False, "late": False, "error": "boom"}, 30) == ["collector_failed"]
    assert keys({}, extra, ok_run, None) == ["api_down"]
    assert keys({}, extra, ok_run, 1500) == ["api_slow"]
    assert keys({"fraudOpen": 2}, extra, ok_run, 30) == ["fraud_open"]
    assert keys({}, {**extra, "payments": {"ready": False}}, ok_run, 30) == ["razorpay_missing"]
    assert keys({"aiUsed": 2000}, extra, ok_run, 30) == ["ai_cap"]


def test_summary_lines():
    m = {"colCreated": 45, "colReview": 24, "reviewQueue": 30, "signups": 12, "signupSeekers": 9, "signupStudents": 5,
         "signupCompanies": 2, "signupColleges": 1, "applications": 7, "paidOrders": 3, "revenue": 149700,
         "checksStarted": 4, "checksPassed": 3, "readyNow": 2}  # fmt: skip
    extra = {"payments": {"ready": True}, "vetting": {"switchOn": True}}
    lines = dr.summary(m, extra, {"arrived": True, "ok": True}, [])
    assert lines == [
        "Collector added 45 jobs, 24 wait for review. Review queue: 30.",
        "12 new sign-ups (9 job seekers, 5 students joined colleges, 2 companies, 1 colleges).",
        "7 applications, 3 paid orders (₹1,497).",
        "4 skill checks started, 3 passed; 2 ready now. Vetting is ON.",
        "Site healthy. Nothing needs attention.",
    ]
    issue = [{"key": "api_down", "level": "bad"}]
    lines = dr.summary({}, {"payments": {"ready": False}}, {"arrived": False, "late": True}, issue)
    assert lines[0] == "No collector run yet today. It is late (after 7:00 AM)."
    assert lines[2] == "0 applications. Payments coming soon (Razorpay keys not set)."
    assert lines[3].endswith("Vetting is OFF.")
    assert lines[4] == "1 thing needs attention (1 urgent)."
