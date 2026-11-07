"""Job board J4: the match score on every card and job page (skills, experience, place: plain parts, no AI), cached per
person and job and worked out again when the resume changes, the "Best match" sort, and what signed-out people and
people without a resume get."""

from app.core.db import JOB_FIT, JOBS
from app.jobs import fit as fitmod
from app.jobs.fit import Person
from app.me.erase import erase_user_data
from tests.conftest import signup
from tests.jobs_helpers import RESUME, add_resume, resume
from tests.test_jobs_public import add


def person(**patch) -> Person:
    return Person({"_id": "r1", "data": resume(**patch)})


def test_fit_rules():
    p = person()  # Chennai, 0.5 years, Python / SQL / Power BI / Excel / Tableau / Statistics
    job = {"skills": ["SQL", "Power BI", "Excel", "Snowflake"], "experience": "fresher", "locations": ["Chennai"],
           "remote": False, "title": "Data Analyst"}  # fmt: skip
    f = fitmod.fit(job, p)
    assert f["found"] == ["SQL", "Power BI", "Excel"] and f["missing"] == ["Snowflake"]
    assert (f["experience"], f["place"], f["city"]) == ("ok", "city", "Chennai")
    assert f["score"] == round(3 / 4 * 60 + 25 + 15)  # 85
    # remote: full marks for place; 3+ years asked with half a year: far
    f = fitmod.fit({**job, "remote": True, "locations": [], "experience": "3_plus"}, p)
    assert (f["place"], f["experience"]) == ("remote", "far") and f["score"] == round(45 + 2.5 + 15)
    # another city, 1-3 years asked with half a year: near
    f = fitmod.fit({**job, "locations": ["Pune"], "experience": "1_3"}, p)
    assert (f["place"], f["experience"]) == ("other", "near") and f["score"] == round(45 + 12.5)
    # no city on the resume: half the place marks, said as unknown
    q = Person({"_id": "r1", "data": resume(personal={**RESUME["personal"], "location": ""})})
    assert fitmod.fit(job, q)["place"] == "unknown"
    # skills that aren't in the dictionary are matched as written; a job without skills has none: words of its title
    # are never turned into skills (fix round item 7: "QA" in a title is not "Quality assurance")
    assert fitmod.fit({**job, "skills": ["Northwind tools"]}, p)["missing"] == ["Northwind tools"]
    assert fitmod.fit({**job, "skills": ["Statistics"]}, p)["found"] == ["Statistics"]
    assert fitmod.job_skills({"skills": [], "title": "Python Developer"}) == []
    # an empty resume doesn't count
    assert not Person({"_id": "r", "data": {"personal": {"name": "A"}}}).usable()


async def board(db):
    await add(db, title="Data Analyst", skills=["SQL", "Power BI", "Excel"], locations=["Chennai"],
              applyUrl="https://a.example/1")  # fmt: skip  # newest of the three? no: added first
    await add(db, title="Java Developer", skills=["Java", "Spring"], experience="1_3", locations=["Pune"],
              applyUrl="https://a.example/2")  # fmt: skip
    await add(db, title="Remote BI Intern", skills=["Power BI", "Tableau"], experience="internship", workType="remote",
              locations=[], jobType="internship", applyUrl="https://a.example/3")  # fmt: skip


async def test_scores_on_cards_and_page_best_match_and_cache(client, db, outbox):
    await board(db)
    r = (await client.get("/api/jobs")).json()
    assert r["match"] == "signed_out" and all("match" not in j for j in r["items"])
    await signup(client, outbox)
    r = (await client.get("/api/jobs")).json()
    assert r["match"] == "no_resume" and all("match" not in j for j in r["items"])
    await add_resume(client)
    r = (await client.get("/api/jobs")).json()
    assert r["match"] == "on"
    by = {j["title"]: j["match"] for j in r["items"]}
    assert by["Data Analyst"]["found"] == ["SQL", "Power BI", "Microsoft Excel"] and by["Data Analyst"]["score"] == 100
    assert by["Data Analyst"]["experience"] == "ok" and by["Data Analyst"]["city"] == "Chennai"
    assert by["Java Developer"]["missing"] == ["Java", "Spring"] and by["Java Developer"]["place"] == "other"
    assert by["Remote BI Intern"]["place"] == "remote"
    # newest first by default; best match on request
    assert [j["title"] for j in r["items"]][0] == "Remote BI Intern"
    r = (await client.get("/api/jobs", params={"sort": "match"})).json()
    # both 100 (all skills, level OK, Chennai / remote): the newer first; the Java job last
    assert [j["title"] for j in r["items"]] == ["Remote BI Intern", "Data Analyst", "Java Developer"]
    assert [j["match"]["score"] for j in r["items"]] == sorted((j["match"]["score"] for j in r["items"]), reverse=True)
    # filters still apply with best match
    r = (await client.get("/api/jobs", params={"sort": "match", "experience": "1_3"})).json()
    assert [j["title"] for j in r["items"]] == ["Java Developer"]
    # the job page has it too
    analyst = await db[JOBS].find_one({"title": "Data Analyst"})
    assert (await client.get(f"/api/jobs/{analyst['slug']}")).json()["match"]["score"] == 100
    # cached per person and job
    assert await db[JOB_FIT].count_documents({}) == 3
    # a new resume version is scored again: Excel and SQL gone, now in Pune
    new = resume(skillGroups=[{"id": "core", "label": "Core", "value": "Java"}], proj=[], exp=[],
                 summary="", certs=[], personal={**RESUME["personal"], "location": "Pune", "headline": ""})  # fmt: skip
    assert (await client.patch("/api/me/resumes/r1", json={"data": new})).status_code == 200
    m = (await client.get(f"/api/jobs/{analyst['slug']}")).json()["match"]
    assert m["found"] == [] and m["place"] == "other"
    r = (await client.get("/api/jobs", params={"sort": "match"})).json()
    assert r["items"][0]["title"] == "Java Developer"
    # erasing the person's data removes the cached scores
    me = (await client.get("/api/auth/me")).json()
    out = await erase_user_data(db, me.get("id") or me["user"]["id"])
    assert out["job_fit"] == 3 and await db[JOB_FIT].count_documents({}) == 0
