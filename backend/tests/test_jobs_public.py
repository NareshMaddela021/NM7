"""Job board J3: the public list (filters: search, experience, city / remote, job type, work type, salary, posted
within), the job page (closed jobs with similar jobs, demo jobs never shown, email addresses not public), the jobs
sitemap and saved jobs."""

from datetime import timedelta

from app.core.db import JOBS, SAVED_JOBS
from app.core.time import now
from app.jobs import demo_jobs, service
from app.jobs.model import JobIn
from tests.conftest import signup
from tests.test_jobs_admin import JOB


async def add(db, **over):
    job = JobIn.model_validate({**JOB, **over})
    outcome, doc = await service.save(db, job, "admin")
    assert outcome == "created"
    return doc


def titles(r):
    assert r.status_code == 200, r.text
    return sorted(j["title"] for j in r.json()["items"])


async def board(db):
    await add(db)  # Junior Data Analyst: fresher, Hyderabad + Pune, hybrid, full time, 3-4.5 L a year
    await add(db, title="Java Developer", experience="1_3", skills=["Java", "Spring"], locations=["Chennai"],
              workType="onsite", salary={"min": 50000, "max": 70000, "period": "monthly"},
              applyUrl="https://acme.example/c/2")  # fmt: skip
    await add(db, title="Support Intern", experience="internship", jobType="internship", locations=[],
              workType="remote", salary=None, company={"name": "Bluepeak"}, skills=["Communication"],
              applyMethod="email", applyUrl="",              applyEmail="hr@bluepeak.example")  # fmt: skip
    old = await add(
        db, title="Old Tester", experience="0_1", skills=["Selenium", "SQL"], applyUrl="https://a.example/t"
    )
    await db[JOBS].update_one({"_id": old["_id"]}, {"$set": {"posted_at": now() - timedelta(days=3)}})
    shut = await add(db, title="Closed SQL Analyst", applyUrl="https://a.example/x", status="closed")
    paused = await add(db, title="Paused Job", applyUrl="https://a.example/p", status="paused")
    await demo_jobs.seed(db)
    return shut, paused


async def test_list_and_filters(client, db):
    await board(db)
    r = await client.get("/api/jobs")
    assert titles(r) == ["Java Developer", "Junior Data Analyst", "Old Tester", "Support Intern"]  # no demo/closed
    body = r.json()
    assert body["total"] == 4 and body["pages"] == 1 and "Hyderabad" in body["cities"]
    assert body["items"][-1]["title"] == "Old Tester"  # newest first
    intern = next(j for j in body["items"] if j["title"] == "Support Intern")
    assert intern["apply"] == {"method": "email", "url": ""}  # the address isn't public
    assert "source" not in intern and "linkCheck" not in intern and "description" not in intern

    async def f(**params):
        return titles(await client.get("/api/jobs", params=params))

    assert await f(q="power bi") == ["Junior Data Analyst"]  # a skill
    assert await f(q="bluepeak") == ["Support Intern"]  # a company
    assert await f(q="developer") == ["Java Developer"]  # a role
    assert await f(q="(") == []  # not a broken pattern
    assert await f(experience="fresher,internship") == ["Junior Data Analyst", "Support Intern"]
    assert await f(city="chennai") == ["Java Developer"]
    assert await f(city="Hyderabad") == ["Junior Data Analyst", "Old Tester"]
    assert await f(remote="true") == ["Support Intern"]
    assert await f(remote="true", city="Chennai") == ["Java Developer", "Support Intern"]
    assert await f(jobType="internship") == ["Support Intern"]
    assert await f(workType="onsite,remote") == ["Java Developer", "Support Intern"]
    assert await f(salary=600000) == ["Java Developer"]  # 70,000 a month = 8.4 L a year
    assert await f(salary=400000) == ["Java Developer", "Junior Data Analyst", "Old Tester"]
    assert await f(posted="24h") == ["Java Developer", "Junior Data Analyst", "Support Intern"]
    assert await f(posted="7d", experience="0_1") == ["Old Tester"]
    assert await f(experience="nonsense") == ["Java Developer", "Junior Data Analyst", "Old Tester", "Support Intern"]
    # a job past its closing date drops off straight away
    await db[JOBS].update_one({"title": "Java Developer"}, {"$set": {"closes_at": now() - timedelta(minutes=1)}})
    assert "Java Developer" not in await f()


async def test_job_page_closed_similar_demo_and_sitemap(client, db):
    shut, paused = await board(db)
    analyst = await db[JOBS].find_one({"title": "Junior Data Analyst"})
    r = await client.get(f"/api/jobs/{analyst['slug']}")
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "active" and j["description"].startswith("We need a fresher")
    assert j["apply"] == {"method": "link", "url": "https://acme.example/careers/123"}
    assert j["skills"] == ["SQL", "Power BI", "Storytelling"]
    assert j["similar"][0]["title"] == "Old Tester"  # shares SQL
    assert all(s["status"] == "active" for s in j["similar"])
    # closed: still shown, marked closed, with similar active jobs
    r = await client.get(f"/api/jobs/{shut['slug']}")
    assert r.json()["status"] == "closed" and r.json()["similar"]
    assert {s["title"] for s in r.json()["similar"]} >= {"Junior Data Analyst", "Old Tester"}
    # demo jobs never show publicly
    demo = await db[JOBS].find_one({"demo": True})
    assert (await client.get(f"/api/jobs/{demo['slug']}")).status_code == 404
    assert (await client.get("/api/jobs/no-such-job")).status_code == 404
    # past the closing date but the daily pass hasn't run: shown as closed
    await db[JOBS].update_one({"_id": analyst["_id"]}, {"$set": {"closes_at": now() - timedelta(minutes=1)}})
    assert (await client.get(f"/api/jobs/{analyst['slug']}")).json()["status"] == "closed"
    # the sitemap: active, public jobs only
    r = await client.get("/api/jobs/sitemap.xml")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/xml")
    xml = r.text
    old = await db[JOBS].find_one({"title": "Old Tester"})
    assert f"<loc>https://nm7.si/jobs/{old['slug']}</loc>" in xml
    for gone in (shut, paused, analyst, demo):
        assert gone["slug"] not in xml
    assert xml.count("<url>") == 3


async def test_saved_jobs(client, db, outbox):
    await board(db)
    analyst = await db[JOBS].find_one({"title": "Junior Data Analyst"})
    assert (await client.put(f"/api/me/saved-jobs/{analyst['_id']}")).status_code == 401
    await signup(client, outbox)
    for _ in range(2):  # saving twice is fine
        assert (await client.put(f"/api/me/saved-jobs/{analyst['_id']}")).json() == {"saved": True}
    demo = await db[JOBS].find_one({"demo": True})
    assert (await client.put(f"/api/me/saved-jobs/{demo['_id']}")).status_code == 404
    items = (await client.get("/api/me/saved-jobs")).json()["items"]
    assert [i["title"] for i in items] == ["Junior Data Analyst"] and items[0]["savedAt"]
    assert await db[SAVED_JOBS].count_documents({}) == 1
    assert (await client.delete(f"/api/me/saved-jobs/{analyst['_id']}")).json() == {"saved": False}
    assert (await client.get("/api/me/saved-jobs")).json()["items"] == []
