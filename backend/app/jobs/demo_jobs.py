"""30 made-up jobs for trying the job board in the demo college and the test environment. Each is marked demo: True
and "(demo)" in the company name, uses example.com links, and is never shown on the public job pages or sitemap.
They are made with the demo college and removed with it (app/orgs/demo.py). The 30 are written in two round trips
(one look-up for the dedupe keys, one insert_many), not two per job: the demo college reset waits on them."""

import random
from datetime import timedelta
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import BulkWriteError

from app.auth.models import new_id
from app.core.db import JOBS
from app.core.time import now
from app.jobs.model import JobIn, slug_for, to_doc

ROLES = [
    ("Data Analyst", ["SQL", "Python", "Power BI", "Excel"], "fresher"),
    ("Junior Python Developer", ["Python", "Django", "Git", "SQL"], "0_1"),
    ("Frontend Developer Intern", ["HTML", "CSS", "JavaScript", "React"], "internship"),
    ("Java Backend Developer", ["Java", "Spring Boot", "SQL", "REST APIs"], "1_3"),
    ("QA Engineer (Manual + Automation)", ["Selenium", "Java", "Manual Testing"], "fresher"),
    ("Business Analyst Trainee", ["Excel", "SQL", "Communication"], "fresher"),
    ("Cloud Support Associate", ["AWS", "Linux", "Networking"], "0_1"),
    ("Machine Learning Intern", ["Python", "Machine Learning", "Pandas"], "internship"),
    ("Customer Success Executive", ["Communication", "CRM", "Excel"], "fresher"),
    ("Full Stack Developer", ["Node.js", "React", "MongoDB", "JavaScript"], "1_3"),
]
COMPANIES = ["Acme Analytics", "Bluepeak Tech", "Cobalt Systems", "Deccan Softworks", "Everline Labs"]
CITIES = [["Hyderabad"], ["Bengaluru"], ["Chennai"], ["Hyderabad", "Pune"], ["Visakhapatnam"], []]


async def seed(db: AsyncDatabase) -> int:
    rng = random.Random(4207)  # its own sequence: the rest of the demo data stays the same
    t = now()
    rows: list[dict[str, Any]] = []
    for i in range(30):
        title, skills, exp = ROLES[i % len(ROLES)]
        company = COMPANIES[i % len(COMPANIES)]
        cities = CITIES[i % len(CITIES)]
        remote = not cities
        work = "remote" if remote else ("hybrid" if i % 4 == 0 else "onsite")
        jtype = "internship" if exp == "internship" else ("contract" if i % 9 == 0 else "full_time")
        lo = rng.choice([2, 3, 3.5, 4, 5, 6]) * 100_000
        salary = None if i % 5 == 4 else {"min": int(lo), "max": int(lo * 1.5), "period": "yearly"}
        if jtype == "internship" and salary:
            salary = {"min": 10_000, "max": 20_000, "period": "monthly"}
        method = "email" if i % 7 == 3 else ("nm7" if i % 6 == 5 else "link")
        job = JobIn.model_validate({
            "title": title,
            "company": {"name": f"{company} (demo)", "website": "https://example.com"},
            "locations": cities,
            "workType": work,
            "jobType": jtype,
            "experience": exp,
            "salary": salary,
            "skills": skills,
            "description": (
                f"Demo job (made up for trying Nm7). {company} is hiring a {title}. You will work with "
                f"{', '.join(skills[:-1])} and {skills[-1]} on real projects with a small team. Freshers who have "
                "built projects are welcome. This post is demo data and not a real opening."
            ),
            "applyMethod": method,
            "applyUrl": f"https://example.com/demo-jobs/{i + 1}" if method == "link" else "",
            "applyEmail": f"jobs{i + 1}@example.com" if method == "email" else "",
            "postedAt": (t - timedelta(hours=3 + i * 9)).isoformat(),
        })  # fmt: skip
        # the same record app/jobs/service.py save() makes for a new job
        rows.append({"_id": new_id(), "slug": slug_for(job.title, job.company.name), **to_doc(job),
                     "status": job.status, "closed_reason": "" if job.status != "closed" else "closed by the source",
                     "posted_at": job.posted_at or t, "source": "admin",
                     "link_check": {"at": None, "ok": None, "status": None, "fails": 0, "error": ""}, "demo": True,
                     "created_by": None, "created_at": t, "updated_at": t})  # fmt: skip
    # one already there (the same job saved another way, rare): left as it is, never overwritten with demo text
    there = {j["dedupe_key"] async for j in db[JOBS].find({"dedupe_key": {"$in": [j["dedupe_key"] for j in rows]}},
                                                           {"dedupe_key": 1})}  # fmt: skip
    rows = [j for j in rows if j["dedupe_key"] not in there]
    if not rows:
        return 0
    try:
        return len((await db[JOBS].insert_many(rows, ordered=False)).inserted_ids)
    except BulkWriteError as e:  # made at the same moment by another reset: those are skipped
        return int(e.details.get("nInserted", 0))


async def remove(db: AsyncDatabase) -> int:
    return (await db[JOBS].delete_many({"demo": True, "company_id": None})).deleted_count  # not the demo company's


def is_public(j: dict[str, Any]) -> bool:
    return not j.get("demo")
