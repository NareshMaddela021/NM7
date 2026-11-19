# ruff: noqa: E501
"""Vetting Trust T13: time to hire in minutes.

Each step's minutes from fixture events (and the T13 event writes at the sources), "2 h 15 m" / "3 d 4 h" words,
medians and p75, the funnel, the 7 / 30 / 90-day periods against the period before, demo companies / jobs / accounts
left out, the slowest companies (minimum jobs), the "Needs attention" thresholds, aggregations that stay memory-safe,
a company sees only its own data (and the Nm7 median only over enough jobs and companies), switch OFF isolation for the
company view, and the Daily report snapshot additive."""

import inspect
import re
from datetime import timedelta

from bson import ObjectId

from app.admin import daily_report as dr
from app.core.db import (
    APPLICATIONS,
    AUDIT_LOG,
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
from app.hire import slots as HS
from app.trust.tth import service as S
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401
from tests.test_trust_t5 import co, make_tester

T0 = now().replace(microsecond=0)
M = timedelta(minutes=1)


async def company(db, cid, name="Acme Foods Pvt Ltd", demo=False):
    await db[COMPANIES].insert_one(
        {
            "_id": cid,
            "slug": f"slug-{cid}",
            "details": {"legal_name": name},
            "members": [],
            **({"demo": True} if demo else {}),
        }
    )


async def job(db, jid, cid, posted, status="active", demo=False):
    await db[JOBS].insert_one({"_id": jid, "dedupe_key": f"k-{jid}", "slug": f"s-{jid}", "title": f"Job {jid}", "status": status,
                               "source": "company", "company_id": cid, "demo": demo, "posted_at": posted, "created_at": posted})  # fmt: skip


async def user(db, uid, demo=False):
    await db[USERS].insert_one({"_id": uid, "role": "customer", "email": f"{uid}@example.com", "email_lc": f"{uid}@example.com",
                                "name": uid, "created_at": T0, **({"demo": True, "test_user": True} if demo else {})})  # fmt: skip


async def invite(db, jid, cid, at, uid="u1"):
    await db[HIRE_INVITES].insert_one(
        {"_id": ObjectId(), "company_id": cid, "job_id": jid, "user_id": uid, "status": "sent", "created_at": at}
    )


async def contacted(db, jid, cid, at, uid="u1", kind="wa_template"):
    await db[TRUST_AGENT_EVENTS].insert_one({"kind": kind, "user_id": uid, "job_id": jid, "company_id": cid, "at": at})


async def booked(db, jid, cid, at, uid="u1"):
    await db[HIRE_SLOTS].insert_one(
        {
            "company_id": cid,
            "job_id": jid,
            "status": "booked",
            "user_id": uid,
            "booked_at": at,
            "starts_at": at + timedelta(days=2),
        }
    )


async def offer(db, jid, cid, at, uid="u1", status="sent", answered=None):
    oid = ObjectId()
    await db[HIRE_OFFERS].insert_one({"_id": oid, "company_id": cid, "job_id": jid, "user_id": uid, "status": status, "created_at": at,
                                      "answered_at": answered, "updated_at": answered or at})  # fmt: skip
    return oid


async def app_row(db, jid, cid, uid, timeline=(), **extra):
    await db[APPLICATIONS].insert_one({"key": f"job:{jid}", "user_id": uid, "job_id": jid, "company_id": cid, "status": "applied",
                                       "timeline": [{"status": s, "at": a} for s, a in timeline], "created_at": T0 - timedelta(days=60), **extra})  # fmt: skip


async def times_of(db, jid):
    j = await db[JOBS].find_one({"_id": jid})
    t = await S.job_times(db, [j])
    return S.minutes_for(j, t[jid])


# --- words and maths ---------------------------------------------------------------------------------------------------


def test_duration_words():
    assert S.dur_text(0) == "0 m"
    assert S.dur_text(45) == "45 m"
    assert S.dur_text(120) == "2 h"
    assert S.dur_text(135) == "2 h 15 m"
    assert S.dur_text(1440) == "1 d"
    assert S.dur_text(3 * 1440 + 4 * 60 + 59) == "3 d 4 h"
    assert S.dur_text(None) == "—"


def test_median_and_p75():
    assert S.pct([], 50) is None
    assert S.pct([30], 50) == 30 and S.pct([30], 75) == 30
    assert S.pct([180, 0, 120, 60], 50) == 90
    assert S.pct([0, 60, 120, 180], 75) == 135
    assert S.pct([10, 20, 30, 40, 50], 50) == 30 and S.pct([10, 20, 30, 40, 50], 75) == 40
    c = S.change(150, 90)
    assert c["dir"] == "up" and c["text"].startswith("1 h slower")
    assert S.change(60, 90)["dir"] == "down" and "30 m faster" in S.change(60, 90)["text"]
    assert S.change(60, None)["dir"] == "none"


# --- each step from fixture events ------------------------------------------------------------------------------------


async def test_each_step_minutes_from_events(db):
    p = T0 - timedelta(days=12)
    await company(db, "c1")
    await job(db, "j1", "c1", p)
    await invite(db, "j1", "c1", p + 30 * M)  # shortlist + contact at 30 m …
    await contacted(db, "j1", "c1", p + 20 * M)  # … a T5 WhatsApp came first: contact 20 m
    await booked(db, "j1", "c1", p + 3 * 60 * M)  # booked_at was overwritten by a later re-booking …
    await S.mark(db, "j1", "interview", company_id="c1", at=p + 135 * M)  # … the first booking was kept here
    oid = await offer(db, "j1", "c1", p + (3 * 1440 + 240) * M, status="joined", answered=p + (3 * 1440 + 300) * M)
    await db[HIRE_EVENTS].insert_one(
        {"user_id": "u1", "kind": "joined", "ref": str(oid), "company_id": "c1", "at": p + 10 * 1440 * M}
    )
    m = await times_of(db, "j1")
    assert m == {
        "shortlist": 30,
        "contact": 20,
        "interview": 135,
        "offer": 3 * 1440 + 240,
        "accepted": 3 * 1440 + 300,
        "joined": 10 * 1440,
    }
    rows = S.rows_for(
        [await db[JOBS].find_one({"_id": "j1"})], await S.job_times(db, [await db[JOBS].find_one({"_id": "j1"})])
    )
    out = S.job_out(rows[0])
    assert out["text"]["interview"] == "2 h 15 m" and out["text"]["offer"] == "3 d 4 h"

    # a company moving someone straight to Interview: shortlisted and contacted by then at the latest
    await job(db, "j2", "c1", p)
    await app_row(db, "j2", "c1", "u2", [("applied", p + 5 * M), ("interview", p + 90 * M)])
    m2 = await times_of(db, "j2")
    assert m2["shortlist"] == m2["contact"] == m2["interview"] == 90 and m2["offer"] is None and m2["joined"] is None

    # the T5 agent marked someone interested and a fit (no message recorded yet): a shortlist, not a contact
    await job(db, "j3", "c1", p)
    await app_row(
        db, "j3", "c1", "u3", [("applied", p + 45 * M)], origin="agent", fit={"ok": True}, agent={"at": p + 45 * M}
    )
    await app_row(
        db, "j3", "c1", "u4", [("applied", p + 10 * M)], origin="agent", fit={"ok": False}, agent={"at": p + 10 * M}
    )
    m3 = await times_of(db, "j3")
    assert m3["shortlist"] == 45 and m3["contact"] is None

    # a shortlisted timeline and a T11 booking-link invite
    await job(db, "j4", "c1", p)
    await app_row(db, "j4", "c1", "u5", [("applied", p), ("shortlisted", p + 61 * M)])
    await contacted(db, "j4", "c1", p + 75 * M, uid="u5", kind="t11_invite")
    await contacted(db, "j4", "c1", p + 5 * M, uid="u5", kind="optout_whatsapp")  # not a contact
    m4 = await times_of(db, "j4")
    assert m4["shortlist"] == 61 and m4["contact"] == 75


async def test_mark_keeps_the_first_time_and_skips_demo(db):
    await user(db, "demo1", demo=True)
    await user(db, "real1")
    await S.mark(db, "jx", "contact", company_id="c1", user_id="real1", at=T0)
    await S.mark(db, "jx", "contact", company_id="c1", user_id="real1", at=T0 + 60 * M)  # later: never moves
    d = await db[TRUST_HIRE_EVENTS].find_one({"_id": "jx:contact"})
    assert d["at"] == T0 and d["n"] == 2 and d["company_id"] == "c1"
    await S.mark(db, "jx", "contact", user_id="real1", at=T0 - 60 * M)  # earlier: kept
    assert (await db[TRUST_HIRE_EVENTS].find_one({"_id": "jx:contact"}))["at"] == T0 - 60 * M
    await S.mark(db, "jy", "contact", user_id="demo1")
    await S.mark(db, "jy", "nonsense")
    await S.mark(db, None, "contact")
    assert await db[TRUST_HIRE_EVENTS].count_documents({"job_id": "jy"}) == 0
    # the Hire booking path writes the first booking
    await HS._set_interview(db, {"job_id": "jz", "company_id": "c1", "via": "agent_whatsapp"}, "real1")
    ev = await db[TRUST_HIRE_EVENTS].find_one({"_id": "jz:interview"})
    assert ev and ev["via"] == "agent_whatsapp"
    await HS._set_interview(db, {"job_id": "jq", "company_id": "c1"}, "real1", clear=True)  # a cancel writes nothing
    assert not await db[TRUST_HIRE_EVENTS].find_one({"_id": "jq:interview"})


# --- stats, periods, funnel, demo -------------------------------------------------------------------------------------


async def test_periods_medians_funnel_and_previous(db):
    await company(db, "c1")
    for jid, days, contact_m in (
        ("a", 3, 60),
        ("b", 5, 180),
        ("c", 10, 600),
        ("d", 20, 120),
        ("e", 50, 30),
        ("f", 120, 999),
    ):
        p = T0 - timedelta(days=days)
        await job(db, jid, "c1", p)
        await invite(db, jid, "c1", p + contact_m * M)
    await job(db, "g", "c1", T0 - timedelta(days=2))  # nothing happened yet
    await offer(db, "a", "c1", T0 - timedelta(days=3) + 600 * M)
    sec = await S.section(db, {})
    p7, p30, p90 = sec["periods"]["7"], sec["periods"]["30"], sec["periods"]["90"]
    assert p7["jobs"] == 3 and p30["jobs"] == 5 and p90["jobs"] == 6
    assert p7["steps"]["contact"]["n"] == 2 and p7["steps"]["contact"]["median"] == 120
    assert p7["steps"]["contact"]["p75"] == 150
    assert p7["steps"]["contact"]["prevN"] == 1 and p7["steps"]["contact"]["prevMedian"] == 600
    assert p7["steps"]["contact"]["change"]["dir"] == "down"
    assert p30["steps"]["contact"]["median"] == 150  # 60, 120, 180, 600
    assert p30["steps"]["contact"]["prevMedian"] == 30  # "e" (50 days ago)
    assert p30["steps"]["contact"]["change"]["dir"] == "up"
    assert p90["steps"]["contact"]["prevMedian"] == 999
    funnel = {f["key"]: f["n"] for f in p7["funnel"]}
    assert funnel == {"posted": 3, "shortlist": 2, "contact": 2, "interview": 0, "offer": 1, "accepted": 0, "joined": 0}
    assert sec["measured"] == 7 and sec["capped"] is False


async def test_demo_companies_jobs_and_accounts_left_out(db):
    p = T0 - timedelta(days=2)
    await company(db, "real")
    await company(db, "demo", demo=True)
    await user(db, "tester-user", demo=True)
    await job(db, "r1", "real", p)
    await job(db, "r2", "real", p, demo=True)  # a demo job of a real company
    await job(db, "d1", "demo", p)
    for jid, cid in (("r1", "real"), ("r2", "real"), ("d1", "demo")):
        await invite(db, jid, cid, p + 10 * M)
    await job(db, "r3", "real", p)
    await invite(db, "r3", "real", p + 5 * M, uid="tester-user")  # a test account's invite: not counted
    sec = await S.section(db, {})
    assert sec["periods"]["7"]["jobs"] == 2  # r1, r3
    assert sec["periods"]["7"]["steps"]["contact"]["n"] == 1
    assert sec["periods"]["7"]["companies"] == 1
    assert [c["companyId"] for c in sec["companies"]] == ["real"]


async def test_slowest_companies_need_min_jobs(db):
    p = T0 - timedelta(days=5)
    for cid, name, mins in (
        ("slow", "Slow Ltd", [600, 700, 800]),
        ("fast", "Fast Ltd", [10, 20, 30]),
        ("few", "Few Ltd", [5000, 6000]),
    ):
        await company(db, cid, name)
        for i, m in enumerate(mins):
            await job(db, f"{cid}{i}", cid, p)
            await invite(db, f"{cid}{i}", cid, p + m * M)
    await job(db, "slow9", "slow", p)  # no contact yet
    sec = await S.section(db, {})
    assert [(s["name"], s["median"], s["jobs"], s["noContact"]) for s in sec["slowest"]] == [
        ("Slow Ltd", 700, 4, 1),
        ("Fast Ltd", 20, 3, 0),
    ]
    assert sec["slowest"][0]["medianText"] == "11 h 40 m"
    sec2 = await S.section(db, {"trust": {"tth": {"min_jobs": 2}}})
    assert sec2["slowest"][0]["name"] == "Few Ltd"


def tth(med7=None, n7=0, med30=None, n30=0, stale=0):
    return {"periods": {"7": {"steps": {"contact": {"median": med7, "n": n7}}}, "30": {"steps": {"contact": {"median": med30, "n": n30}}}},
            "stale": {"n": stale, "hours": 48}}  # fmt: skip


def test_attention_thresholds():
    st = dict(S.DEFAULTS)
    assert S.attention(None, st) == []
    assert S.attention(tth(med30=23 * 60, n30=5), st) == []
    items = S.attention(tth(med30=25 * 60, n30=5), st)
    assert (
        [i["key"] for i in items] == ["tth_contact_slow"]
        and "1 d 1 h" in items[0]["text"]
        and "30 days" in items[0]["text"]
    )
    assert S.attention(tth(med30=25 * 60, n30=5), {**st, "contact_hours": 26}) == []
    # the last 7 days count when at least 3 jobs were contacted in them
    items = S.attention(tth(med7=30 * 60, n7=3, med30=60, n30=9), st)
    assert items and "7 days" in items[0]["text"]
    assert S.attention(tth(med7=30 * 60, n7=2, med30=60, n30=9), st) == []
    items = S.attention(tth(stale=2), st)
    assert [i["key"] for i in items] == [
        "tth_no_contact"
    ] and "2 live jobs posted more than 48 h ago have no contact" in items[0]["text"]


async def test_stale_jobs_use_the_hours_setting(db):
    await company(db, "c1")
    await job(db, "old", "c1", T0 - timedelta(hours=50))
    await job(db, "new", "c1", T0 - timedelta(hours=10))
    await job(db, "shut", "c1", T0 - timedelta(hours=60), status="closed")
    await job(db, "done", "c1", T0 - timedelta(hours=70))
    await invite(db, "done", "c1", T0 - timedelta(hours=69))
    sec = await S.section(db, {})
    assert (
        sec["stale"]["n"] == 1
        and sec["stale"]["jobs"][0]["title"] == "Job old"
        and sec["stale"]["jobs"][0]["company"] == "Acme Foods Pvt Ltd"
    )
    sec = await S.section(db, {"trust": {"tth": {"stale_hours": 8}}})
    assert sec["stale"]["n"] == 2


# --- memory-safe ------------------------------------------------------------------------------------------------------


def test_aggregations_stay_memory_safe():
    src = inspect.getsource(S)
    assert ".to_list()" not in src  # never an unbounded list
    for m in re.finditer(r"\.to_list\(([^)]*)\)", src):
        assert m.group(1).strip(), m.group(0)
    assert src.count(".aggregate(") == 1 and '{"$limit": cap}' in src  # every pipeline goes through _rows (capped)
    for m in re.finditer(r"\.find\(", src):
        tail = src[m.end() : m.end() + 400]
        assert ".limit(" in tail or "find_one" in src[m.start() - 5 : m.start() + 6], tail[:120]
    dsrc = inspect.getsource(dr._time_to_hire)
    assert "tth.section" in dsrc and "except Exception" in dsrc


async def test_batches_and_cap(db, monkeypatch):
    monkeypatch.setattr(S, "BATCH", 2)
    monkeypatch.setattr(S, "JOB_CAP", 4)
    await company(db, "c1")
    for i in range(6):
        p = T0 - timedelta(days=1, minutes=i)
        await job(db, f"b{i}", "c1", p)
        await invite(db, f"b{i}", "c1", p + (i + 1) * M)
    sec = await S.section(db, {})
    assert sec["measured"] == 4 and sec["capped"] is True
    assert sec["periods"]["7"]["steps"]["contact"]["n"] == 4  # every batch was read


# --- the company view and the switch ----------------------------------------------------------------------------------


async def test_company_sees_only_own_data_and_nm7_median(client, outbox, db):
    session, cid, j = await co(client, outbox, db)  # founder@gmail.com is a Trust tester
    s2, cid2 = await verified(client, outbox, db, email="priya@gmail.com")
    await make_tester(db, "priya@gmail.com")
    p = T0 - timedelta(days=4)
    await db[JOBS].update_one({"_id": j["id"]}, {"$set": {"posted_at": p, "created_at": p}})
    await invite(db, j["id"], cid, p + 135 * M)
    await job(db, "theirs", cid2, p)
    await invite(db, "theirs", cid2, p + 5 * M)
    r = await client.get(f"/api/company/{cid}/trust/tth", headers=H(session))
    assert r.status_code == 200, r.text
    d = r.json()
    assert [x["id"] for x in d["jobs"]] == [j["id"]]
    assert d["jobs"][0]["text"]["contact"] == "2 h 15 m" and d["jobs"][0]["text"]["offer"] == "Not yet"
    assert d["periods"]["7"]["steps"]["contact"]["median"] == 135 and "companies" not in d["periods"]["7"]
    assert "theirs" not in r.text and "slowest" not in d
    assert d["nm7"]["periods"] == {}  # no Daily report yet
    # another company's view never includes ours
    r2 = (await client.get(f"/api/company/{cid2}/trust/tth", headers=H(s2))).json()
    assert [x["id"] for x in r2["jobs"]] == ["theirs"]
    assert (
        await client.get(f"/api/company/{cid2}/trust/tth", headers=H(session))
    ).status_code == 404  # not on its team
    # the Nm7 median from the snapshot only over enough jobs and companies
    snap = {"periods": {"30": {"jobs": 12, "companies": 3, "steps": {"contact": {"n": 9, "median": 300, "medianText": "5 h"}, "offer": {"n": 0, "median": None}}},
                        "7": {"jobs": 4, "companies": 3, "steps": {"contact": {"n": 4, "median": 30, "medianText": "30 m"}}}}, "at": 1}  # fmt: skip
    await db[DAILY_REPORTS].insert_one({"_id": dr.ist_today().isoformat(), "timeToHire": snap})
    n = (await client.get(f"/api/company/{cid}/trust/tth", headers=H(session))).json()["nm7"]["periods"]
    assert n["30"]["contact"] == {"median": 300, "medianText": "5 h"} and n["30"]["offer"] is None
    assert n["7"]["contact"] is None  # 4 jobs: too few to show


async def test_switch_off_company_view_is_hidden(client, outbox, db):
    session, cid, j = await co(client, outbox, db, test=False)  # not a tester, switch OFF
    assert (await client.get(f"/api/company/{cid}/trust/tth", headers=H(session))).status_code == 404
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"demo": True}})  # the demo company sees it
    assert (await client.get(f"/api/company/{cid}/trust/tth", headers=H(session))).status_code == 200
    await db[COMPANIES].update_one({"_id": cid}, {"$unset": {"demo": ""}})
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": True}}, upsert=True)
    assert (await client.get(f"/api/company/{cid}/trust/tth", headers=H(session))).status_code == 200


async def test_stage_and_offer_write_events(client, outbox, db):
    session, cid, j = await co(client, outbox, db)
    await user(db, "cand1")
    aid = ObjectId()
    await db[APPLICATIONS].insert_one({"_id": aid, "key": f"job:{j['id']}", "user_id": "cand1", "job_id": j["id"], "company_id": cid,
                                       "status": "applied", "channel": "nm7", "timeline": [], "company_removed_at": None, "created_at": T0})  # fmt: skip
    r = await client.post(
        f"/api/company/{cid}/applicants/{aid}/status", json={"status": "shortlisted"}, headers=H(session)
    )
    assert r.status_code == 200, r.text
    ev = await db[TRUST_HIRE_EVENTS].find_one({"_id": f"{j['id']}:shortlist"})
    assert ev and ev["via"] == "stage" and ev["company_id"] == cid


# --- Admin: the Daily report section, the thresholds ------------------------------------------------------------------


async def test_daily_report_section_additive_and_attention(db, admin_client):
    await company(db, "c1", "Slowpoke Pvt Ltd")
    await job(db, "late", "c1", T0 - timedelta(hours=72))  # live, nobody contacted
    for i in range(3):
        p = T0 - timedelta(days=2, minutes=i)
        await job(db, f"s{i}", "c1", p)
        await invite(db, f"s{i}", "c1", p + 30 * 60 * M)
    owner = await admin_client("owner")
    r = await owner.post("/api/admin/daily-report/refresh")
    assert r.status_code == 200, r.text
    d = r.json()
    t = d["today"]
    for k in ("vetting", "payments", "ai", "github", "autoApply", "collector"):  # the existing sections stay
        assert k in t, k
    assert set(d["metrics"]) == set(dr.METRICS)
    tt = t["timeToHire"]
    assert tt["periods"]["7"]["steps"]["contact"]["medianText"] == "1 d 6 h"
    assert tt["slowest"][0]["name"] == "Slowpoke Pvt Ltd"
    keys = [a["key"] for a in d["attention"]]
    assert "tth_contact_slow" in keys and "tth_no_contact" in keys
    # a higher threshold (Admin) clears the median item at once
    r = await owner.put("/api/admin/trust/tth", json={"contactHours": 48, "staleHours": 96, "minJobs": 3})
    assert r.status_code == 200 and r.json()["contactHours"] == 48
    keys = [a["key"] for a in (await owner.get("/api/admin/daily-report")).json()["attention"]]
    assert "tth_contact_slow" not in keys
    assert await db[AUDIT_LOG].find_one({"action": "trust.tth_settings"})


async def test_snapshot_survives_a_failure(db, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("x")

    monkeypatch.setattr(S, "section", boom)
    assert await dr._time_to_hire(db) is None
    doc = await dr.snapshot(db, dr.ist_today(), True)
    assert doc["timeToHire"] is None and "autoApply" in doc


async def test_admin_settings_bounds(admin_client):
    owner = await admin_client("owner")
    g = (await owner.get("/api/admin/trust/tth")).json()
    assert (
        g["contactHours"] == 24
        and g["staleHours"] == 48
        and g["minJobs"] == 3
        and g["bounds"]["contactHours"] == [1, 336]
    )
    assert (
        await owner.put("/api/admin/trust/tth", json={"contactHours": 0, "staleHours": 48, "minJobs": 3})
    ).status_code == 422
    assert (
        await owner.put("/api/admin/trust/tth", json={"contactHours": 24, "staleHours": 48, "minJobs": 51})
    ).status_code == 422
    support = await admin_client("support", "support@nm7.si")
    assert (
        await support.put("/api/admin/trust/tth", json={"contactHours": 24, "staleHours": 48, "minJobs": 3})
    ).status_code == 403
