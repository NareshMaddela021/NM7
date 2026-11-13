"""Phase 6 S1: the role finder. Rules decide (qualification gate with ITI and 12th side by side, work style, likes,
strengths, branch, laptop, languages, hours); three roles with plain reasons; the AI sentence is checked and the
rules' words are used otherwise; live jobs per role; the salary only with enough real jobs; saved, retaken, fed to
the target role and Auto Apply; removed with the account."""

from datetime import timedelta

from app.core import claude
from app.core.db import JOBS, USERS
from app.core.time import now
from app.seek import roles as rf
from app.seek.catalogue import ROLES
from app.seek.salary import monthly_mid, summarise
from tests.conftest import signup
from tests.test_companies_posting import no_ai  # noqa: F401

BASE = {"studies": "graduate", "branch": "", "likes": [], "strengths": [], "style": "computers", "second_style": "",
        "city": "", "salary_need": 0, "languages": ["English"], "laptop": True, "hours_week": 10}  # fmt: skip


def ids(a):
    return [r["role"]["id"] for r in rf.pick({**BASE, **a})]


def test_rules_qualification_and_style():
    # 10th pass: no graduate roles at all, whatever the style
    tenth = ids({"studies": "10th", "style": "computers"})
    by = {r["id"]: r for r in ROLES}
    assert all(rf.eligible("10th", by[i]["edu"]) for i in tenth) and "python-developer" not in tenth
    assert rf.eligible("iti", "12th") and rf.eligible("12th", "iti") and not rf.eligible("10th", "iti")
    # ITI + machines + electrical branch → electrician first
    assert (
        ids({"studies": "iti", "style": "machines", "branch": "ITI Electrician", "likes": ["fixing things"]})[0]
        == "electrician"
    )
    # B.Com, numbers → accounts first
    assert ids({"style": "numbers", "branch": "B.Com", "likes": ["commerce", "maths"]})[0] == "accounts-assistant"
    # people + talking → customer-facing roles
    assert set(ids({"studies": "12th", "style": "people", "likes": ["talking", "helping people"]})) & {
        "customer-support",
        "sales-executive",
        "retail-associate",
    }
    # computers but no laptop and 2 hours a week: laptop-heavy roles pushed down, with a note
    rows = rf.pick({**BASE, "laptop": False, "hours_week": 2})
    notes = [n for r in rows for n in r["note"]]
    assert any("laptop" in n for n in notes) or all(not r["role"]["laptop"] for r in rows)


def test_ai_why_is_checked():
    check = rf.check_why(["Data analyst", "Software tester"])
    assert check({"why": ["You like numbers and reports.", "You enjoy finding small mistakes."]})
    for bad in (
        {"why": ["Earn 30000 a month!", "ok"]},  # a number
        {"why": ["You will get placement for sure.", "ok"]},  # a promise
        {"why": ["Great like a Python developer.", "ok"]},  # another role
        {"why": ["only one"]},
    ):
        try:
            check(bad)
            raise AssertionError(bad)
        except claude.Unusable:
            pass


def test_salary_helpers():
    assert monthly_mid({"min": 240000, "max": 360000, "period": "yearly"}) == 25000
    assert monthly_mid({"min": 20000, "max": None, "period": "monthly"}) == 20000
    assert summarise([20000] * 9, 10) is None  # below N: never shown
    s = summarise([15000, 18000, 20000, 22000, 25000, 18000, 19000, 21000, 23000, 30000], 10)
    assert s["jobs"] == 10 and s["min"] <= s["max"] and s["min"] % 500 == 0


async def test_find_save_retake_and_feeds(client, outbox, db):
    from tests.test_seek_salary import min_jobs

    await min_jobs(db, 10)  # this test's 10 jobs are enough for a typical salary (the default is 20)
    await signup(client, outbox)
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    t = now()
    jobs = [{"_id": f"j{i}", "title": "Junior Data Analyst", "slug": f"jda-{i}", "dedupe_key": f"s1-{i}",
             "status": "active",
             "company": {"name": "Acme"}, "locations": ["Hyderabad"], "remote": False, "experience": "fresher",
             "salary": {"min": 240000, "max": 300000, "period": "yearly"}, "created_at": t - timedelta(days=i),
             "posted_at": t - timedelta(days=i), "source": "admin", "apply": {"method": "link", "url": "https://x.example"}}
            for i in range(10)]  # fmt: skip
    await db[JOBS].insert_many(jobs)
    q = (await client.get("/api/me/roles")).json()
    assert q["roles"] == [] and "computers" in q["questions"]["styles"]
    a = {**BASE, "style": "numbers", "secondStyle": "computers", "likes": ["maths", "reports"], "city": "Hyderabad",
         "salaryNeed": 20000, "hoursWeek": 8}  # fmt: skip
    a.pop("second_style")
    a.pop("salary_need")
    a.pop("hours_week")  # noqa: E702
    out = (await client.post("/api/me/roles", json=a)).json()
    assert len(out["roles"]) == 3
    top = out["roles"][0]
    assert top["id"] == "data-analyst" and top["why"].startswith("You like working with numbers")
    assert top["jobs"] and top["jobs"][0]["title"] == "Junior Data Analyst"
    assert top["salary"] == {"min": 22500, "max": 22500, "jobs": 10, "days": 90, "city": "Hyderabad"}
    assert top["learn"] and top["test"] == "SQL"
    assert not any("pay less" in n for n in top["notes"])  # needs 20,000; most pay 22,500
    others = [r for r in out["roles"][1:] if r["salary"]]
    assert not others  # no data for them: no number
    u = await db[USERS].find_one({"_id": uid})
    assert u["role_finder"]["picks"][0] == "data-analyst" and u["target_role"] == "Data analyst"
    sug = (await client.get("/api/me/auto-apply/suggest")).json()
    assert sug["fromRoleFinder"][0] == "Data analyst" and sug["roles"][0] == "Data analyst"
    hi = (await client.post("/api/me/roles", json={**a, "salaryNeed": 40000})).json()["roles"][0]
    assert any("pay less than you need" in n for n in hi["notes"])
    # retake: new answers, new roles; the target role the person set stays
    await db[USERS].update_one({"_id": uid}, {"$set": {"target_role": "My own choice"}})
    b = {
        **a,
        "studies": "iti",
        "style": "machines",
        "secondStyle": "",
        "likes": ["fixing things"],
        "branch": "Electrician",
    }
    out = (await client.post("/api/me/roles", json=b)).json()
    assert out["roles"][0]["id"] == "electrician"
    assert (await db[USERS].find_one({"_id": uid}))["target_role"] == "My own choice"
    assert (await client.get("/api/me/roles")).json()["roles"][0]["id"] == "electrician"


async def test_erase_removes_it(client, outbox, db):
    from app.me.erase import erase_account

    await signup(client, outbox)
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    await client.post(
        "/api/me/roles",
        json={**{k: v for k, v in BASE.items() if k not in ("second_style", "salary_need", "hours_week")}},
    )
    await erase_account(db, uid)
    assert "role_finder" not in await db[USERS].find_one({"_id": uid})
