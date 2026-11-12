# ruff: noqa: E501
"""Phase 6 S4: the salary guide. Ranges by role, city and experience from Nm7's own jobs only: shown only with at
least N jobs (Admin → Settings, 10) from the last 90 days, never from demo jobs, with "based on X jobs"; otherwise
nothing (the page says "Not enough data yet"). Also for job pages (lookup by title) and Ready to join (the hint)."""

from datetime import timedelta

import pytest

from app.core.db import JOBS, USERS
from app.core.time import now
from app.seek import salary
from tests.conftest import signup


@pytest.fixture(autouse=True)
def _fresh_cache():
    salary._cache.clear()
    yield
    salary._cache.clear()


async def _jobs(
    db, n, title="Junior Data Analyst", city="Hyderabad", exp="fresher", monthly=20000, days=1, demo=False, tag="a"
):
    t = now()
    await db[JOBS].insert_many([
        {"_id": f"{tag}{i}", "title": title, "slug": f"{tag}-{i}", "dedupe_key": f"{tag}-{i}", "status": "active",
         "company": {"name": "Acme"}, "locations": [city], "remote": False, "experience": exp, "demo": demo,
         "salary": {"min": monthly + 1000 * i, "max": monthly + 1000 * i, "period": "monthly"},
         "created_at": t - timedelta(days=days), "posted_at": t - timedelta(days=days), "source": "admin",
         "apply": {"method": "link", "url": "https://x.example"}}
        for i in range(n)
    ])  # fmt: skip


def _role(d, rid):
    return next(r for r in d["roles"] if r["id"] == rid)


async def test_hidden_below_n_and_never_invented(client, db):
    await _jobs(db, 9)
    await _jobs(db, 5, demo=True, tag="d")  # demo jobs never count
    await _jobs(db, 5, days=120, tag="o")  # older than 90 days never count
    d = (await client.get("/api/public/salaries")).json()
    assert d["minJobs"] == 10 and d["days"] == 90
    assert all(v is None for r in d["roles"] for v in r["levels"].values())
    r = (
        await client.get("/api/public/salaries/lookup", params={"title": "Data Analyst Trainee", "city": "Hyderabad"})
    ).json()
    assert r["role"]["id"] == "data-analyst" and r["range"] is None


async def test_shown_at_n_with_the_real_range(client, db):
    await _jobs(db, 10)  # 20,000 … 29,000 a month
    await _jobs(db, 12, title="Sales Executive", city="Pune", exp="1_3", tag="s")
    d = (await client.get("/api/public/salaries")).json()
    da = _role(d, "data-analyst")["levels"]
    assert da["start"] == {"min": 22500, "max": 27000, "jobs": 10, "days": 90, "city": ""}
    assert da["1_3"] is None and da["3_plus"] is None
    assert _role(d, "sales-executive")["levels"]["1_3"]["jobs"] == 12
    # by city: Pune has no data analyst jobs
    p = (await client.get("/api/public/salaries", params={"city": "pune"})).json()
    assert (
        _role(p, "data-analyst")["levels"]["start"] is None
        and _role(p, "sales-executive")["levels"]["1_3"]["city"] == "Pune"
    )
    # job pages: by title; the city first, else all of India; no role → nothing
    r = (
        await client.get("/api/public/salaries/lookup", params={"title": "Data Analyst (fresher)", "city": "Pune"})
    ).json()
    assert r["range"]["jobs"] == 10 and r["range"]["city"] == ""
    r = (await client.get("/api/public/salaries/lookup", params={"title": "Data Analyst", "city": "Hyderabad"})).json()
    assert r["range"]["city"] == "Hyderabad"
    assert (await client.get("/api/public/salaries/lookup", params={"title": "Astronaut"})).json() == {
        "role": None,
        "level": "start",
        "range": None,
    }


async def test_ready_to_join_hint_and_admin_setting(client, outbox, admin_client, db):
    await _jobs(db, 6)
    await signup(client, outbox)
    await db[USERS].update_one({"email": "sai@example.com"}, {"$set": {"target_role": "Data analyst"}})
    h = (await client.get("/api/me/salary-hint", params={"city": "Hyderabad"})).json()
    assert h["role"]["id"] == "data-analyst" and h["range"] is None  # 6 < 10
    owner = await admin_client("owner")
    s = (await owner.get("/api/admin/settings")).json()
    assert s["seek"] == {"salaryMinJobs": 10, "passScore": 60}
    assert (await owner.put("/api/admin/settings", json={"seek": {"salaryMinJobs": 5}})).status_code == 200
    assert (
        await owner.put("/api/admin/settings", json={"seek": {"salaryMinJobs": 1}})
    ).status_code == 422  # at least 3
    salary._cache.clear()
    h = (await client.get("/api/me/salary-hint", params={"city": "Hyderabad"})).json()
    assert h["range"]["jobs"] == 6 and h["range"]["city"] == "Hyderabad"
    assert (await owner.get("/api/admin/settings")).json()["seek"]["passScore"] == 60  # untouched


def test_role_for_title():
    assert salary.role_for_title("Senior Python Developer")["id"] == "python-developer"
    assert salary.role_for_title("Field Sales Executive")["id"] == "sales-executive"
    assert salary.role_for_title("ITI Electrician")["id"] == "electrician"
    assert salary.role_for_title("Chef") is None
