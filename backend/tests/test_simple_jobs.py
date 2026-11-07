"""Phase 4 E6: jobs made simple. The top 3 as big cards (match with one plain reason, place, ₹ a month, the company's
trust badge, saved), Manual Apply from there, and "Let Nm7 apply for me": the normal Auto Apply settings, so the
consent tick and the resume-score gate still apply."""

from app.core.db import JOBS, USERS
from app.simple.jobs import per_month, reason
from tests.conftest import signup
from tests.jobs_helpers import add_resume, resume, strong_resume
from tests.test_auto_apply_engine import company_job, no_ai  # noqa: F401
from tests.test_companies_posting import verified
from tests.test_companies_signup import no_network  # noqa: F401
from tests.test_jobs_public import add

URL = "/api/me/simple/jobs"


def test_plain_reason_and_salary_a_month():
    assert reason({"found": ["SQL", "Power BI", "Excel"]}) == {"key": "skills", "vars": {"skills": "SQL, Power BI"}}
    assert reason({"found": [], "place": "remote"}) == {"key": "remote", "vars": {}}
    assert reason({"found": [], "place": "city", "city": "Pune"}) == {"key": "place", "vars": {"city": "Pune"}}
    assert reason({"found": [], "place": "other"}) == {"key": "level", "vars": {}}
    assert per_month({"min": 300000, "max": 450000, "period": "yearly"}) == {"min": 25000, "max": 37500}
    assert per_month({"min": 15000, "max": None, "period": "monthly"}) == {"min": 15000}
    assert per_month(None) is None and per_month({"min": None, "max": None}) is None


async def test_top_three_cards(client, outbox, db):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    assert (await client.get(URL)).json()["state"] == "no_resume"
    await add_resume(client, data=resume())
    for t in ("Junior Data Analyst", "Data Analyst Intern", "SQL Analyst", "Chef"):
        await add(db, title=t, applyUrl=f"https://acme.example/{t[:3]}")
    await add(db, title="Remote Support", workType="remote", skills=["Communication"], applyUrl="https://a.example/r",
              salary={"min": 15000, "max": 20000, "period": "monthly"})  # fmt: skip
    r = (await client.get(URL)).json()
    assert r["state"] == "on" and len(r["items"]) == 3
    top = r["items"][0]
    assert top["match"] >= r["items"][1]["match"] >= r["items"][2]["match"]
    assert top["reason"]["key"] == "skills" and "SQL" in top["reason"]["vars"]["skills"]
    assert top["salaryMonth"] == {"min": 25000, "max": 37500}  # the sample job: 3-4.5 L a year
    assert top["method"] == "link" and top["url"].startswith("https://") and top["saved"] is False
    assert top["trust"] is None  # not a company on Nm7
    # Save, then the card says so; applied jobs leave the top 3
    await client.put(f"/api/me/saved-jobs/{top['id']}")
    assert (await client.get(URL)).json()["items"][0]["saved"] is True
    await client.post(f"/api/jobs/{top['id']}/apply", json={})
    assert top["id"] not in {x["id"] for x in (await client.get(URL)).json()["items"]}


async def test_company_job_card_and_manual_apply_with_consent(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    j = await company_job(client, session, cid, "Junior Data Analyst",
                          questions=[{"text": "Notice period in days?", "kind": "number"}])  # fmt: skip
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    await add_resume(client, data=resume())
    card = next(x for x in (await client.get(URL)).json()["items"] if x["id"] == j["id"])
    assert card["method"] == "nm7" and card["consent"] is True and card["trust"]["level"]
    assert card["questions"] == [{"id": "q1", "text": "Notice period in days?", "kind": "number", "options": []}]
    r = await client.post(f"/api/jobs/{j['id']}/apply", json={"answers": {"q1": 30}})
    assert r.json()["error"]["code"] == "consent"  # the consent tick is still needed
    r = await client.post(f"/api/jobs/{j['id']}/apply", json={"consent": True, "answers": {"q1": 30}})
    assert r.status_code == 201


async def test_let_nm7_apply_needs_consent_and_the_gate(client, outbox, db):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    await add_resume(client, data=resume(summary="", skillGroups=[], proj=[], exp=[], certs=[]))
    r = (await client.get(URL)).json()
    assert r["autoOn"] is False and r["gate"]["ok"] is False and r["defaults"]["dailyLimit"] == 5
    one_tap = {"roles": ["Data Analyst"], "cities": ["Hyderabad"], "remote": True, "dailyLimit": 3, "consent": True}
    assert (await client.put("/api/me/auto-apply", json=one_tap)).json()["error"]["code"] == "gate"
    await add_resume(client, key="r2", data=strong_resume(), active=True)
    assert (await client.put("/api/me/auto-apply", json={**one_tap, "consent": False})).json()["error"][
        "code"
    ] == "consent"
    assert (await client.put("/api/me/auto-apply", json=one_tap)).status_code == 200
    r = (await client.get(URL)).json()
    assert r["autoOn"] is True and r["setUp"] is True
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    assert (await db[USERS].find_one({"_id": uid}))["auto_apply"]["daily_limit"] == 3


async def test_demo_students_get_the_demo_jobs(client, outbox, db):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    await add_resume(client, data=resume())
    demo = await add(db, title="Junior Data Analyst", applyUrl="https://acme.example/d")
    await db[JOBS].update_one({"_id": demo["_id"]}, {"$set": {"demo": True}})
    assert demo["_id"] not in {x["id"] for x in (await client.get(URL)).json()["items"]}
    await db[USERS].update_one({"email": "sai@example.com"}, {"$set": {"demo": True}})
    assert [x["id"] for x in (await client.get(URL)).json()["items"]] == [demo["_id"]]
