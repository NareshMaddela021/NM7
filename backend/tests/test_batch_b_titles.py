"""Batch B: human job titles for careers-site jobs (search keeps the full title), clean role suggestions, the level
filter for the quick start's results, companies spread out on the board, and the city filled from the title or the
page's "Location:" line."""

import pytest

from app.core.db import JOBS
from app.jobs import titles as T
from app.jobs.collector import city_fill, city_labelled
from app.jobs.public import spread
from tests.conftest import signup
from tests.jobs_helpers import add_resume
from tests.test_jobs_public import add


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("Manager - SaT - National - CBS - MGT - Hyderabad", "Manager"),
        (
            "Associate - Business Consulting Risk - CNS - Risk - Process & Controls - Hyderabad",
            "Associate - Business Consulting Risk",
        ),
        ("Assistant Manager - Tax - GDS - Kolkata", "Assistant Manager - Tax"),
        ("Senior Data Analyst | Payments Team | Bangalore", "Senior Data Analyst"),
        ("HR Recruiter | Talent Acquisition", "HR Recruiter"),
        ("Machine Learning Engineer - Search Team - Bengaluru, India", "Machine Learning Engineer"),
        ("Software Engineer II (R-123456)", "Software Engineer II"),
        ("Req 12345 - Python Developer", "Python Developer"),
        ("Data Analyst (Hyderabad)", "Data Analyst"),
        ("Business Analyst, Pune, Maharashtra", "Business Analyst"),
        ("Java Developer - Hyderabad / Bengaluru", "Java Developer"),
        ("Sales Executive - India", "Sales Executive"),
        ("Data Engineer – Azure – Chennai", "Data Engineer - Azure"),
        # already clean: kept as they are (never over-stripped)
        ("Senior Data Analyst", "Senior Data Analyst"),
        ("Front-end web developer", "Front-end web developer"),
        ("Customer Support Executive (Telugu)", "Customer Support Executive (Telugu)"),
        ("Service technician (AC, mobile, appliances)", "Service technician (AC, mobile, appliances)"),
        ("Staff Nurse", "Staff Nurse"),
    ],
)
def test_clean_title(raw, clean):
    assert T.clean_title(raw) == clean


def test_display_title_only_for_careers_site_jobs():
    raw = "Manager - SaT - National - CBS - MGT - Hyderabad"
    assert T.display_title({"title": raw, "source": "collector"}) == "Manager"
    assert T.display_title({"title": raw, "source": "company"}) == raw  # a company's own title as typed
    assert T.clean_title("") == "" and T.clean_title("Hyderabad") == "Hyderabad"  # never empty


def test_role_suggestions_are_clean_names():
    names = T.role_names()
    assert "Data analyst" in names and "Data scientist" in names
    assert len(names) == len({n.lower() for n in names})
    assert T.suggest_roles("data")[0].lower().startswith("data")
    assert T.suggest_roles("") == names[:8]
    assert T.suggest_roles("zzzz") == []
    fit = T.roles_for_resume({"Python", "SQL", "Power BI", "Microsoft Excel"}, "Data Scientist at Acme")
    assert fit[0] == "Data scientist" and "Data analyst" in fit and "IT support executive" not in fit


def test_spread_companies_without_hiding_jobs():
    rows = [{"_id": i, "company": {"name": "EY" if i < 10 else f"C{i}"}} for i in range(30)]
    out = spread(rows, per=2, size=10)
    assert sorted(j["_id"] for j in out) == list(range(30))  # nothing hidden
    first = out[:10]
    assert sum(j["company"]["name"] == "EY" for j in first) == 2 and [j["_id"] for j in first[:2]] == [0, 1]
    alone = [{"_id": i, "company": {"name": "EY"}} for i in range(5)]
    assert [j["_id"] for j in spread(alone, per=2, size=10)] == [0, 1, 2, 3, 4]  # one company alone still fills


def test_city_from_title_and_location_line():
    assert city_fill("Manager - SaT - National - CBS - Hyderabad", "", "") == (["Hyderabad"], "title")
    page = "Location: Pune, Maharashtra\nAbout us: offices in Mumbai, Delhi, Chennai, Kolkata, Bengaluru, Noida"
    assert city_labelled(page) == ["Pune"]
    assert city_fill("Data Analyst", "", page) == (["Pune"], "page_label")
    assert city_fill("Data Analyst", "", "We are a global company.") == ([], "")


async def test_board_shows_clean_titles_and_search_uses_the_full_title(client, db):
    j = await add(db, title="Manager - SaT - National - CBS - MGT - Hyderabad", applyUrl="https://ey.example/1")
    await db[JOBS].update_one({"_id": j["_id"]}, {"$set": {"source": "collector"}})
    r = (await client.get("/api/jobs", params={"q": "CBS"})).json()  # the code still finds it
    assert [x["title"] for x in r["items"]] == ["Manager"]
    assert r["items"][0]["fullTitle"] == "Manager - SaT - National - CBS - MGT - Hyderabad"
    one = (await client.get(f"/api/jobs/{j['slug']}")).json()
    assert one["title"] == "Manager"


async def test_level_hides_senior_jobs_for_a_junior_person(client, db):
    await add(db, title="Junior Data Analyst", experience="1_3", applyUrl="https://a.example/1")
    await add(db, title="Lead Data Analyst", experience="1_3", applyUrl="https://a.example/2")
    await add(db, title="Data Analyst Manager", experience="not_stated", applyUrl="https://a.example/3")
    await add(db, title="Data Analyst", experience="8_12", applyUrl="https://a.example/4")
    await add(db, title="Data Analyst II", experience="3_5", applyUrl="https://a.example/5")

    async def seen(**p):
        return sorted(
            x["title"] for x in (await client.get("/api/jobs", params={"q": "Data Analyst", **p})).json()["items"]
        )

    assert len(await seen()) == 5  # the board itself hides nothing
    assert await seen(level="1_3") == ["Data Analyst II", "Junior Data Analyst"]
    assert await seen(level="1_3", experience="0_1,1_3,3_5,not_stated") == ["Data Analyst II", "Junior Data Analyst"]
    assert "Data Analyst Manager" in await seen(level="3_5")
    assert "Data Analyst" not in await seen(level="3_5")  # the 8-12 year job


async def test_signed_in_default_is_best_match_and_companies_spread(client, db, outbox):
    for i in range(6):
        await add(db, title=f"Data Analyst {i}", company={"name": "EY"}, skills=["SQL", "Power BI"],
                  applyUrl=f"https://ey.example/{i}")  # fmt: skip
    await add(db, title="Office helper", company={"name": "Other"}, skills=["Cleaning"], applyUrl="https://o.example/1")
    await signup(client, outbox)
    await add_resume(client)
    r = (await client.get("/api/jobs")).json()
    names = [x["company"]["name"] for x in r["items"]]
    assert len(names) == 7 and names[:3] == ["EY", "EY", "Other"]  # 2 of EY, then another company, then the rest


def test_find_my_role_uses_the_resume():
    """A 4-year data science profile answering "computers" gets the data and Python roles, not IT support, data entry
    or tester; without a resume the answers alone decide, as before."""
    from app.seek import roles as rf

    a = {"studies": "graduate", "branch": "", "likes": [], "strengths": [], "style": "computers", "second_style": "",
         "city": "", "salary_need": 0, "languages": ["English"], "laptop": True, "hours_week": 10}  # fmt: skip
    cv = {"skills": {"Python", "SQL", "Power BI", "Microsoft Excel", "Machine learning"},
          "text": "Data Scientist. Senior data scientist building models", "years": 4.0}  # fmt: skip
    cv["strong"] = True
    got = [r["role"]["id"] for r in rf.pick(a, cv=cv)]
    assert set(got[:2]) == {"data-analyst", "python-developer"}
    assert not {"it-support", "data-entry"} & set(got)
    top = rf.pick(a, cv=cv)[0]
    assert "your resume shows" in rf.rule_why(top).lower()
    assert [r["role"]["id"] for r in rf.pick(a)] == [r["role"]["id"] for r in rf.pick(a, cv=None)]


async def test_find_my_role_reads_the_saved_resume(client, db, outbox):
    from app.seek import roles as rf

    await signup(client, outbox)
    await add_resume(client)
    me = (await client.get("/api/auth/me")).json()
    cv = await rf.resume_facts(db, me.get("id") or me["user"]["id"])
    assert {"SQL", "Power BI"} <= cv["skills"] and cv["strong"] and cv["years"] > 0
