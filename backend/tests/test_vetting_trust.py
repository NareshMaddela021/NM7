# ruff: noqa: E501
"""Vetting V5: the daily fraud scan finds a planted duplicate account (same phone), a shared device and impossible
resume dates, and a person decides; the badge expires at 90 days (time-shifted) and an 8-question refresher renews it;
an appeal goes through to a decision; the fairness report groups by language, city tier and band; the data export
holds the vetting data; retention clears raw IPs after 30 days."""

from datetime import datetime, timedelta

import pytest
from bson import ObjectId

from app.core.db import AUDIT_LOG, RESUMES, SKILL_ATTEMPTS, SKILL_QUESTIONS, USERS, VETTING_QUEUE, VETTING_VERIFIED
from app.core.time import now
from app.hire.vetting import trust as T
from tests.test_companies_apply import student
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import err, no_network  # noqa: F401

URL = "/api/me/skill-checks"


@pytest.fixture(autouse=True)
def vetting_public(monkeypatch):
    """V5 itself: the engine is public here (hidden mode: test_vetting_access.py)."""
    from app.hire.vetting import access

    async def public(db):
        return {"public": True, "testers": []}

    monkeypatch.setattr(access, "settings", public)


def test_helpers():
    assert T.digits("+91 98765-43210") == "9876543210" and T.digits("12") == ""
    assert (
        T.city_tier("Hyderabad") == "tier 1"
        and T.city_tier("Guntur, AP") == "tier 2"
        and T.city_tier("") == "not given"
    )
    t = datetime(2026, 11, 16)
    bad = T.impossible_dates({"exp": [{"company": "A", "from": "05/2024", "to": "01/2023"}, {"company": "B", "from": "2030"},
                                      *[{"company": f"C{i}", "current": True} for i in range(3)]]}, t)  # fmt: skip
    assert (
        "A: ends before it starts" in bad
        and "B: starts in the future" in bad
        and "3 jobs marked as current at the same time" in bad
    )
    assert T.impossible_dates({"exp": [{"company": "Ok", "from": "2020", "to": "2023"}]}, t) == []


async def test_fraud_scan_catches_a_planted_duplicate_and_a_person_decides(outbox, db, make_client, admin_client):
    for i, mail in enumerate(["one@example.com", "two@example.com"]):
        await student(make_client, outbox, mail, f"Person {i}")
        u = await db[USERS].find_one({"email": mail})
        await db[RESUMES].update_many(
            {"user_id": u["_id"]}, {"$set": {"active": True, "data.personal.phone": "+91 98765 43210"}}
        )
        if not await db[RESUMES].find_one({"user_id": u["_id"]}):
            await db[RESUMES].insert_one(
                {"user_id": u["_id"], "active": True, "data": {"personal": {"phone": "98765-43210"}}}
            )
    out = await T.fraud_scan(db)
    assert out.get("phone") == 1
    assert (await T.fraud_scan(db)).get("phone", 0) == 0  # the same finding is never added twice
    owner = await admin_client()
    items = (await owner.get("/api/admin/vetting/fraud")).json()["items"]
    item = next(x for x in items if x["what"] == "Same phone number on several accounts")
    assert len(item["people"]) == 2 and "…3210" in item["evidence"][0]
    r = (
        await owner.post(
            f"/api/admin/vetting/fraud/{item['id']}", json={"decision": "clear", "note": "Siblings sharing a phone"}
        )
    ).json()
    assert r["decision"] == "clear"


async def _badge(db, uid, days_ago, test="Excel"):
    t = now()
    await db[VETTING_VERIFIED].insert_one({"user_id": uid, "test": test, "slug": "excel", "role": "Office assistant (Excel)", "band": "1-3",
                                            "score": 80, "task_score": 80, "at": t - timedelta(days=days_ago), "expires_at": t + timedelta(days=90 - days_ago)})  # fmt: skip


async def test_expiry_reminders_and_refresher(outbox, db, make_client):
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    u = await db[USERS].find_one({"email": "asha@example.com"})
    await c.post(f"{URL}/consent")
    await _badge(db, u["_id"], 60)
    assert err(await c.post(f"{URL}/start", json={"skill": "Excel", "refresh": True})) == "no_refresh"  # too early
    await db[VETTING_VERIFIED].update_one(
        {"user_id": u["_id"]}, {"$set": {"at": now() - timedelta(days=76), "expires_at": now() + timedelta(days=14)}}
    )
    assert await T.reverify_reminders(db, outbox) == 1 and await T.reverify_reminders(db, outbox) == 0
    assert "badge ends in" in outbox.sent[-1].subject
    p = (await c.post(f"{URL}/start", json={"skill": "Excel", "refresh": True})).json()
    assert len(p["questions"]) == 8
    a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(p["id"])})
    qs = {str(q["_id"]): q for q in await db[SKILL_QUESTIONS].find({"_id": {"$in": a["question_ids"]}}).to_list(20)}
    right = {k: a["order"][k].index(q["answer"]) for k, q in qs.items()}
    r = (await c.post(f"{URL}/{p['id']}/submit", json={"answers": right, "times": {k: 20000 for k in right}})).json()
    assert r["score"] == 100 and r["kind"] == "refresh"
    v = await db[VETTING_VERIFIED].find_one({"user_id": u["_id"]})
    assert v["expires_at"] > now() + timedelta(days=89)
    # time-shifted past 90 days without a refresher: expired, and the nightly job marks it
    await db[VETTING_VERIFIED].update_one({"_id": v["_id"]}, {"$set": {"expires_at": now() - timedelta(minutes=1)}})
    from app.hire.vetting.jobs import nightly

    assert await nightly(db) == 1 and (await db[VETTING_VERIFIED].find_one({"_id": v["_id"]}))["expired"]


async def test_appeal_to_a_decision_and_explanations(outbox, db, make_client, admin_client):
    c = await student(make_client, outbox, "ravi@example.com", "Ravi K")
    await c.post(f"{URL}/consent")
    p = (await c.post(f"{URL}/start", json={"skill": "Excel", "band": "fresher"})).json()
    r = (
        await c.post(
            f"{URL}/{p['id']}/submit",
            json={"answers": {q["id"]: 0 for q in p["questions"]}, "times": {q["id"]: 20000 for q in p["questions"]}},
        )
    ).json()
    assert (
        r["integrityNote"] and len(r["improve"]) <= 3 and all(x["learn"].startswith("/me/learn") for x in r["improve"])
    )
    a = (
        await c.post(
            "/api/me/appeals", json={"kind": "skill", "ref": p["id"], "reason": "Question 4 had two right answers."}
        )
    ).json()
    assert a["ok"] and a["dueAt"]
    assert (
        err(
            await c.post(
                "/api/me/appeals", json={"kind": "skill", "ref": p["id"], "reason": "Asking again about the same one"}
            )
        )
        == "already"
    )
    owner = await admin_client()
    q = (await owner.get("/api/admin/vetting/appeals")).json()
    item = q["items"][0]
    assert item["reason"].startswith("Question 4") and not item["overdue"]
    d = (
        await owner.post(
            f"/api/admin/vetting/appeals/{item['id']}",
            json={"outcome": "retest", "note": "A bad question; free retest."},
        )
    ).json()
    assert d["outcome"] == "retest"
    mine = (await c.get("/api/me/appeals")).json()["items"][0]
    assert mine["status"] == "done" and mine["outcome"] == "retest"
    assert (await c.post(f"{URL}/start", json={"skill": "Excel"})).status_code == 200  # the free retest
    assert (await owner.get("/api/admin/vetting/appeals", params={"status": "done"})).json()["perRole"][0][
        "upheld"
    ] == 1


async def test_fairness_export_and_retention(outbox, db, make_client, admin_client):
    c = await student(make_client, outbox, "meena@example.com", "Meena S")
    await c.post(f"{URL}/consent")
    p = (await c.post(f"{URL}/start", json={"skill": "Excel", "lang": "en"})).json()
    await c.post(f"{URL}/{p['id']}/submit", json={"answers": {}, "times": {}})
    owner = await admin_client()
    f = (await owner.get("/api/admin/vetting/fairness")).json()
    assert f["language"][0]["group"] == "English" and f["band"] and f["cityTier"] and "caste" in f["note"]
    ex = (await c.get("/api/me/data-export")).json()
    assert ex["account"]["email"] == "meena@example.com" and ex["skillChecks"] and "password_hash" not in ex["account"]
    assert "order" not in ex["skillChecks"][0]
    await db[AUDIT_LOG].insert_one(
        {"_id": ObjectId(), "action": "x", "ip": "203.0.113.9", "at": now() - timedelta(days=31)}
    )
    out = await T.retention(db)
    assert out["ips"] >= 1 and not await db[AUDIT_LOG].find_one({"ip": "203.0.113.9"})
    assert await db[VETTING_QUEUE].count_documents({"kind": "fraud"}) == 0  # nothing planted here
