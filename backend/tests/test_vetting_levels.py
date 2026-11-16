# ruff: noqa: E501
"""Vetting V1: the level rules (L0–L4, ⚡), the explainable match readiness score and its top 3 reasons, Hire now's
new order, freshness (⚡ lost at 7 days, hidden at 21, weekly "Still looking?"), the demand watch and the cached
ready shortlists, the level history log, and Admin → Vetting overview."""

from datetime import timedelta

from app.core.db import HIRE_PROFILES, JOBS, USERS, VETTING_LEVEL_LOG, VETTING_SHORTLISTS, VETTING_VERIFIED
from app.core.time import now
from app.hire.vetting import ladder
from app.hire.vetting import levels as L
from tests.test_companies_apply import student
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401
from tests.test_hire_shortlist import READY, post_job


def facts(**kw):
    base = {"email": True, "resumeComplete": True, "ats": 72, "salary": True, "notice": True, "city": True,
            "skillVerified": [], "interviewReady": False, "nm7Verified": False, "available": True, "confirmedDays": 2}  # fmt: skip
    return {**base, **kw}


def test_levels_need_every_rung_below():
    assert L.level_of(facts(email=False))["level"] == 0
    assert L.level_of(facts(email=False))["next"] == ["Verify your email"]
    assert (
        L.level_of(facts(ats=50))["level"] == 0 and "Raise your ATS score to 60+" in L.level_of(facts(ats=50))["next"]
    )
    assert L.level_of(facts())["level"] == 1
    assert L.level_of(facts())["next"] == ["Pass a skill check and its practical task"]
    assert L.level_of(facts(skillVerified=["SQL"]))["level"] == 2
    assert L.level_of(facts(skillVerified=["SQL"], salary=False))["level"] == 0  # a badge doesn't skip L1
    assert L.level_of(facts(skillVerified=["SQL"], interviewReady=True))["level"] == 3
    assert L.level_of(facts(skillVerified=["SQL"], interviewReady=True, nm7Verified=True))["level"] == 4
    assert L.level_of(facts(interviewReady=True, nm7Verified=True))["level"] == 1  # L3/L4 need L2 first


def test_ready_now_and_hidden():
    assert L.level_of(facts(confirmedDays=6))["readyNow"] and not L.level_of(facts(confirmedDays=7))["readyNow"]
    assert L.visible(facts(confirmedDays=20)) and not L.visible(facts(confirmedDays=21))
    assert not L.level_of(facts(available=False))["readyNow"]


def test_readiness_is_explainable_and_weighted():
    top = L.readiness(skill=100, level=4, reliability=100, confirmed_days=1, salary_fit="within", same_city=True)
    assert top["score"] == 100 and sum(top["parts"].values()) == 100
    low = L.readiness(skill=0, level=0, reliability=0, confirmed_days=30, salary_fit="above", same_city=False)
    assert low["score"] == 0
    new = L.readiness(skill=80, level=2, reliability=None, confirmed_days=3, salary_fit="unknown", same_city=None)
    assert new["parts"]["reliability"] == 10.5  # no history: neutral (70%), never zero
    r = L.reasons(badge={"test": "Java", "score": 82}, ready_now=True, city="Hyderabad", same_city=True, remote=False,
                  reliability=90, level=2, skill=60)  # fmt: skip
    assert r == ["Java 82/100", "ready now", "in Hyderabad"]


def test_hire_now_order_level_first():
    from app.hire.shortlist import rank_key

    def row(key, lvl, score, rel=None):
        return {"key": key, "level": {"level": lvl}, "match": {"score": score}, "reliability": {"score": rel},
                "salary": {"fit": "within"}, "availability": {"joinDate": ""}, "where": "Hyderabad"}  # fmt: skip

    rows = [row("a", 1, 95), row("b", 2, 60), row("c", 2, 80, 40), row("d", 2, 80, 90)]
    assert [r["key"] for r in sorted(rows, key=rank_key)] == ["d", "c", "b", "a"]


def test_job_bands_and_titles():
    assert ladder.band_of_job({"experience": "3_5"}) == "3-5" and ladder.band_of_job({}) == "fresher"
    assert ladder.role_of_title("Senior Java Developer") == "Java"
    assert ladder.role_of_title("Warehouse picker (night shift)") == "Warehouse"


async def test_my_level_history_and_freshness(client, outbox, db, make_client):
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    lv = (await c.get("/api/me/level")).json()
    assert lv["level"] == 0 and lv["next"] and lv["levels"]["2"] == "Skill verified"
    await c.put("/api/me/hire", json=READY)
    u = await db[USERS].find_one({"email": "asha@example.com"})
    t = now()
    await db[VETTING_VERIFIED].insert_one({"user_id": u["_id"], "test": "SQL", "band": "1-3", "score": 80, "task_score": 80,
                                            "at": t, "expires_at": t + timedelta(days=90)})  # fmt: skip
    assert (await ladder.refresh(db, u["_id"], "test"))["readyNow"]
    stored = (await db[USERS].find_one({"_id": u["_id"]}))["vetting"]
    assert stored["ready_now"] and stored["visible"] and stored["skill_verified"] == ["SQL"]
    # 8 days without confirming: ⚡ goes (logged); 22 days: hidden from Hire now
    await db[HIRE_PROFILES].update_one({"_id": u["_id"]}, {"$set": {"confirmed_at": t - timedelta(days=8)}})
    lv = await ladder.refresh(db, u["_id"], "hourly")
    assert not lv["readyNow"] and (await db[USERS].find_one({"_id": u["_id"]}))["vetting"]["visible"]
    assert await db[VETTING_LEVEL_LOG].find_one({"user_id": u["_id"], "ready_to": False, "why": "hourly"})
    await db[HIRE_PROFILES].update_one({"_id": u["_id"]}, {"$set": {"confirmed_at": t - timedelta(days=22)}})
    await ladder.refresh(db, u["_id"], "hourly")
    assert not (await db[USERS].find_one({"_id": u["_id"]}))["vetting"]["visible"]
    # the weekly "Still looking?" email: once, not again within 7 days
    from app.hire.available import send_reminders

    await db[HIRE_PROFILES].update_one(
        {"_id": u["_id"]}, {"$set": {"confirmed_at": t - timedelta(days=9), "reminded_at": None}}
    )
    before = len(outbox.sent)
    assert await send_reminders(db, outbox) == 1 and outbox.sent[before].subject == "Still looking? Tap to confirm"
    assert await send_reminders(db, outbox) == 0


async def test_hire_now_shows_level_reasons_filters_and_cache(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    job = await post_job(client, session, cid)
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    await c.put("/api/me/hire", json=READY)
    url = f"/api/company/{cid}/hire/shortlist"
    row = (await client.get(url, params={"job": job}, headers=H(session))).json()["items"][0]
    assert row["level"]["label"] and row["readyNow"] is True and 0 <= row["readiness"]["score"] <= 100
    assert len(row["reasons"]) <= 3 and "integrity" not in str(row)
    assert not (await client.get(url, params={"job": job, "minLevel": 4}, headers=H(session))).json()["items"]
    assert (await client.get(url, params={"job": job, "readyNow": True}, headers=H(session))).json()["items"]
    assert not (
        await client.get(url, params={"job": job, "noticeMax": 0, "city": "Nowhere"}, headers=H(session))
    ).json()["items"]
    # demand watch → hot pairs → a cached shortlist; a level change marks it stale
    out = await ladder.hourly(db)
    assert out["demand"] >= 0 and out["shortlists"] >= 0
    j = await db[JOBS].find_one({"_id": job})
    if ladder.role_of_title(j["title"]):
        doc = await db[VETTING_SHORTLISTS].find_one({})
        assert doc and doc["users"]
        u = await db[USERS].find_one({"email": "asha@example.com"})
        await db[USERS].update_one({"_id": u["_id"]}, {"$set": {"vetting.level": 3}})
        await ladder.refresh(db, u["_id"], "test")
        assert (await db[VETTING_SHORTLISTS].find_one({"_id": doc["_id"]}))["stale"]


async def test_admin_overview(db, admin_client):
    owner = await admin_client()
    o = (await owner.get("/api/admin/vetting/overview")).json()
    assert (
        [x["level"] for x in o["levels"]] == [0, 1, 2, 3, 4] and "measures" in o and o["targets"]["shareL2Plus"] == 70
    )
