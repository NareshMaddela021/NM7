# ruff: noqa: E501
"""Phase 6 S4: the salary guide. Ranges by role, city and experience from Nm7's own jobs only: shown only with at
least N jobs (Admin → Settings, 20) that are live or from the last 90 days, never from demo jobs, with "based on X jobs"; otherwise
nothing (the page says "Not enough data yet"). Also for job pages (lookup by title) and Ready to join (the hint)."""

from datetime import timedelta

import pytest

from app.core.db import JOBS, USERS
from app.core.time import now
from app.seek import salary
from app.site import get_site, save_site
from tests.conftest import signup


@pytest.fixture(autouse=True)
def _fresh_cache():
    salary._cache.clear()
    yield
    salary._cache.clear()


async def min_jobs(db, n):
    """Tests of the range maths use their own N (the default is 20, Admin can change it)."""
    site = await get_site(db)
    await save_site(db, {"seek": {**site["seek"], "salary_min_jobs": n}})
    salary._cache.clear()


async def _jobs(
    db,
    n,
    title="Junior Data Analyst",
    city="Hyderabad",
    exp="fresher",
    monthly=20000,
    days=1,
    demo=False,
    tag="a",
    status="active",
):
    t = now()
    await db[JOBS].insert_many([
        {"_id": f"{tag}{i}", "title": title, "slug": f"{tag}-{i}", "dedupe_key": f"{tag}-{i}", "status": status,
         "company": {"name": "Acme"}, "locations": [city], "remote": False, "experience": exp, "demo": demo,
         "salary": {"min": monthly + 1000 * i, "max": monthly + 1000 * i, "period": "monthly"},
         "created_at": t - timedelta(days=days), "posted_at": t - timedelta(days=days), "source": "admin",
         "apply": {"method": "link", "url": "https://x.example"}}
        for i in range(n)
    ])  # fmt: skip


def _role(d, rid):
    return next(r for r in d["roles"] if r["id"] == rid)


async def test_hidden_below_n_and_never_invented(client, db):
    await _jobs(db, 19)
    await _jobs(db, 5, demo=True, tag="d")  # demo jobs never count
    await _jobs(db, 5, days=120, tag="o", status="closed")  # closed and older than 90 days never count
    d = (await client.get("/api/public/salaries")).json()
    assert d["minJobs"] == 20 and d["days"] == 90
    assert all(v is None for r in d["roles"] for v in r["levels"].values())
    r = (
        await client.get("/api/public/salaries/lookup", params={"title": "Data Analyst Trainee", "city": "Hyderabad"})
    ).json()
    assert r["role"]["id"] == "data-analyst" and r["range"] is None


async def test_shown_at_n_with_the_real_range(client, db):
    await min_jobs(db, 10)
    await _jobs(db, 10)  # 20,000 … 29,000 a month
    await _jobs(db, 12, title="Sales Executive", city="Pune", exp="1_3", tag="s")
    d = (await client.get("/api/public/salaries")).json()
    da = _role(d, "data-analyst")["levels"]
    assert da["start"] == {"min": 22500, "max": 27000, "jobs": 10, "days": 90, "city": ""}
    assert da["1_3"] is None and da["3_5"] is None and da["5_8"] is None and da["8_plus"] is None
    assert set(da) == {"start", "1_3", "3_5", "5_8", "8_plus"}  # round J2: the guide's columns
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
    assert h["role"]["id"] == "data-analyst" and h["range"] is None  # 6 < 20
    owner = await admin_client("owner")
    s = (await owner.get("/api/admin/settings")).json()
    assert s["seek"] == {"salaryMinJobs": 20, "salariesMinRoles": 15, "salariesMode": "auto", "passScore": 60,
                         "collectorAiDaily": 3000}  # fmt: skip
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


# --- D1: /salaries stays hidden until enough roles have enough data ------------------------------------------------


async def ready_roles(db, n, per=20):
    """`n` catalogue roles with `per` live jobs with pay each (role titles from the catalogue)."""
    from app.seek.catalogue import ROLES

    for i, r in enumerate(ROLES[:n]):
        await _jobs(db, per, title=r["title"], tag=f"r{i}-")


async def test_hidden_under_the_threshold_shown_at_it(client, db):
    await ready_roles(db, 14)
    await _jobs(db, 19, title="CNC operator", tag="e")  # the 15th role is one job short: not ready
    st = (await client.get("/api/public/salaries/status")).json()
    assert st["visible"] is False and len(st["readyRoles"]) == 14
    assert "<url>" not in (await client.get("/api/public/salaries/sitemap.xml")).text  # empty while hidden
    g = (await client.get("/api/public/salaries")).json()
    assert g["visible"] is False and sum(r["ready"] for r in g["roles"]) == 14
    await _jobs(db, 1, title="CNC operator", tag="e2")  # the 15th role reaches 20 jobs
    salary._cache.clear()
    st = (await client.get("/api/public/salaries/status")).json()
    assert st["visible"] is True and len(st["readyRoles"]) == 15 and "cnc-operator" in st["readyRoles"]
    xml = (await client.get("/api/public/salaries/sitemap.xml")).text
    assert "<loc>https://nm7.si/salaries</loc>" in xml or "/salaries</loc>" in xml
    assert "/salaries/cnc-operator</loc>" in xml and xml.count("<url>") == 16  # the guide + 15 ready roles
    assert "/salaries/staff-nurse</loc>" not in xml  # not enough data: never in the sitemap


async def test_live_or_recent_jobs_count(client, db):
    await _jobs(db, 10, title="Junior Data Analyst", days=200, tag="live")  # live, posted long ago: counts
    await _jobs(db, 10, title="Junior Data Analyst", days=30, status="closed", tag="rec")  # recent, closed: counts
    await _jobs(db, 10, title="Junior Data Analyst", days=200, status="closed", tag="old")  # old and closed: no
    st = (await client.get("/api/public/salaries/status")).json()
    assert st["readyRoles"] == ["data-analyst"]


async def test_admin_override_and_status(client, db, admin_client):
    owner = await admin_client("owner")
    s = (await owner.get("/api/admin/settings")).json()
    assert s["salariesStatus"]["visible"] is False and s["salariesStatus"]["ready"] == 0
    assert s["salariesStatus"]["needRoles"] == 15 and s["salariesStatus"]["minJobs"] == 20
    r = await owner.put("/api/admin/settings", json={"seek": {"salariesMode": "show"}})
    assert r.status_code == 200 and r.json()["salariesStatus"]["visible"] is True
    assert (await client.get("/api/public/salaries/status")).json()["visible"] is True  # cache cleared on save
    assert "/salaries</loc>" in (await client.get("/api/public/salaries/sitemap.xml")).text
    # "Always hide" wins even with every role ready
    await ready_roles(db, 15)
    r = await owner.put("/api/admin/settings", json={"seek": {"salariesMode": "hide"}})
    assert r.json()["salariesStatus"] == {**r.json()["salariesStatus"], "visible": False, "auto": True, "ready": 15}
    assert (await client.get("/api/public/salaries/status")).json()["visible"] is False
    # back to Auto, and the numbers are settings: 15 roles ready → shown; ask for 16 → hidden again
    r = await owner.put("/api/admin/settings", json={"seek": {"salariesMode": "auto"}})
    assert r.json()["salariesStatus"]["visible"] is True
    r = await owner.put("/api/admin/settings", json={"seek": {"salariesMinRoles": 16}})
    assert r.json()["salariesStatus"]["visible"] is False and r.json()["seek"]["salariesMinRoles"] == 16
    assert (await owner.put("/api/admin/settings", json={"seek": {"salariesMode": "sometimes"}})).status_code == 422


async def test_guide_groups_every_level(client, db):
    """Round J2: 3–5 years (older "3+ years" jobs count there), 5–8, and 8+ (8–12, 12–15, 15+) each have a column; a
    job page whose experience isn't stated gets no range rather than the starting one."""
    await min_jobs(db, 4)
    await _jobs(db, 2, exp="3_5", tag="a")
    await _jobs(db, 2, exp="3_plus", tag="b")
    await _jobs(db, 2, exp="8_12", tag="c")
    await _jobs(db, 2, exp="15_plus", tag="e")
    da = _role((await client.get("/api/public/salaries")).json(), "data-analyst")["levels"]
    assert da["3_5"]["jobs"] == 4 and da["8_plus"]["jobs"] == 4 and da["5_8"] is None and da["start"] is None
    look = lambda exp: client.get("/api/public/salaries/lookup", params={"title": "Data Analyst", "experience": exp})  # noqa: E731
    assert (await look("12_15")).json()["level"] == "8_plus" and (await look("12_15")).json()["range"]["jobs"] == 4
    assert (await look("3_plus")).json()["level"] == "3_5"
    assert (await look("not_stated")).json()["range"] is None
