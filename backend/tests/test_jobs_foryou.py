"""Job board J6: the "Jobs for you" dashboard card: the top 3 matches with their scores (jobs already applied to
left out), real counts for the Saved jobs and My applications shortcuts, and what someone without a resume gets."""

from app.core.db import JOBS
from tests.conftest import signup
from tests.jobs_helpers import add_resume
from tests.test_jobs_public import add


async def test_jobs_for_you(client, db, outbox):
    assert (await client.get("/api/me/jobs-for-you")).status_code == 401
    await add(
        db, title="Data Analyst", skills=["SQL", "Power BI"], locations=["Chennai"], applyUrl="https://a.example/1"
    )
    await add(db, title="BI Intern", skills=["Power BI", "Tableau"], experience="internship", jobType="internship",
              workType="remote", locations=[], applyMethod="nm7", applyUrl="")  # fmt: skip
    await add(db, title="Java Developer", skills=["Java"], experience="3_plus", locations=["Pune"],
              applyUrl="https://a.example/3")  # fmt: skip
    await add(db, title="Closed Analyst", skills=["SQL"], status="closed", applyUrl="https://a.example/4")
    await add(
        db, title="Python Analyst", skills=["Python", "SQL"], locations=["Chennai"], applyUrl="https://a.example/5"
    )
    await signup(client, outbox)
    r = (await client.get("/api/me/jobs-for-you")).json()
    assert r == {"state": "no_resume", "items": [], "saved": 0, "applications": 0}
    await add_resume(client)
    r = (await client.get("/api/me/jobs-for-you")).json()
    assert r["state"] == "on" and len(r["items"]) == 3
    titles = [j["title"] for j in r["items"]]
    assert "Java Developer" not in titles and "Closed Analyst" not in titles
    scores = [j["match"]["score"] for j in r["items"]]
    assert scores == sorted(scores, reverse=True) and scores[0] == 100
    # applied and saved: counted; an applied job leaves the top 3
    intern = await db[JOBS].find_one({"title": "BI Intern"})
    await client.post(f"/api/jobs/{intern['_id']}/apply", json={})
    analyst = await db[JOBS].find_one({"title": "Data Analyst"})
    await client.put(f"/api/me/saved-jobs/{analyst['_id']}")
    r = (await client.get("/api/me/jobs-for-you")).json()
    assert (r["saved"], r["applications"]) == (1, 1)
    assert "BI Intern" not in [j["title"] for j in r["items"]]
