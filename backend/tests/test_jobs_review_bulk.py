# ruff: noqa: E501
"""Round W: Collector review in bulk. Only "jobs" admins; ids capped at 200; approve fills a city it can find and skips
jobs without a summary; close; "all matching" and "Approve all that have a city" (only jobs whose sole issue is a
missing city that can be filled); every action audited. And the collector fills a missing city from the summary or
the page when a job arrives, so a job held only for its city goes live on its own."""

from app.core.db import AUDIT_LOG as AUDIT
from app.core.db import JOBS
from app.core.time import now
from app.jobs import collector as col
from app.jobs import review_bulk as rb
from tests.test_jobs_collector import JOB, SUMMARY, ai, key, post  # noqa: F401  (fixtures)

SUM_PUNE = (
    "A short original summary of the role for job seekers: you will help the plant team in Pune with planning, records and safety audits. "
    * 3
)
SUM_NOWHERE = (
    "A short original summary of the role for job seekers: you will help the plant team with planning, quality records and safety audits. "
    * 3
)


async def waiting(
    db, n=1, *, reasons=("city_not_stated",), desc=SUM_PUNE, loc="", title="Plant Engineer", locations=("India",)
):
    ids = []
    for i in range(n):
        _id = f"rv-{title.replace(' ', '')}-{i}-{len(reasons)}-{len(desc)}"
        await db[JOBS].insert_one({
            "_id": _id, "slug": _id, "dedupe_key": f"collector:{_id}", "title": f"{title} {i}", "company": {"name": "Acme"}, "locations": list(locations), "remote": False,
            "work_type": "onsite", "job_type": "full_time", "experience": "fresher", "salary": None, "skills": [],
            "description": desc, "apply": {"method": "link", "url": f"https://acme.example/{_id}", "email": ""},
            "status": "review", "closed_reason": "", "source": "collector", "review": {"reasons": list(reasons), "note": ""},
            "collector": {"location": loc, "summarised": desc != col.PLACEHOLDER}, "link_check": {"fails": 0},
            "created_at": now(), "updated_at": now(), "posted_at": now(),
        })  # fmt: skip
        ids.append(_id)
    return ids


def test_city_guess():
    assert rb.city_guess({"locations": ["Chennai"]}) == (["Chennai"], "job")
    assert rb.city_guess({"locations": ["India"], "collector": {"location": "Hyderabad, Telangana"}}) == (
        ["Hyderabad"],
        "location",
    )
    assert rb.city_guess({"locations": ["India"], "description": SUM_PUNE}) == (["Pune"], "summary")
    assert rb.city_guess({"locations": ["India"], "description": col.PLACEHOLDER + " Pune"}) == (
        [],
        "",
    )  # never from the placeholder
    assert rb.city_guess({"locations": ["India"], "description": SUM_NOWHERE, "title": "Engineer - Kochi"}) == (
        ["Kochi"],
        "title",
    )
    many = "Offices in Pune, Chennai, Hyderabad, Mumbai and Delhi."
    assert col.city_from(many) == []  # an office list is no answer


async def test_only_jobs_admins(admin_client, db):
    ids = await waiting(db)
    support = await admin_client("support")
    assert (await support.get("/api/admin/jobs/review")).status_code == 403
    assert (
        await support.post("/api/admin/jobs/review/bulk", json={"ids": ids, "action": "approve"})
    ).status_code == 403
    assert (await support.post("/api/admin/jobs/review/approve-with-city")).status_code == 403
    ops = await admin_client("ops")
    d = (await ops.get("/api/admin/jobs/review")).json()
    assert d["total"] == 1 and d["items"][0]["cityGuess"] == ["Pune"] and d["items"][0]["cityFrom"] == "summary"
    assert d["items"][0]["hasSummary"] is True and d["cityReady"] == 1
    assert (await db[JOBS].find_one({"_id": ids[0]}))["status"] == "review"  # reading changes nothing


async def test_caps_and_validation(admin_client, db):
    owner = await admin_client("owner")
    r = await owner.post(
        "/api/admin/jobs/review/bulk", json={"ids": [f"x{i}" for i in range(201)], "action": "approve"}
    )
    assert r.status_code in (400, 422)
    assert (await owner.post("/api/admin/jobs/review/bulk", json={"ids": [], "action": "approve"})).status_code in (
        400,
        422,
    )
    assert (await owner.post("/api/admin/jobs/review/bulk", json={"ids": ["a"], "action": "delete"})).status_code in (
        400,
        422,
    )


async def test_bulk_approve_and_close(admin_client, db):
    owner = await admin_client("owner")
    good = await waiting(db, 2)
    no_sum = await waiting(db, 1, reasons=("no_page_text",), desc=col.PLACEHOLDER, title="Thin")
    r = await owner.post("/api/admin/jobs/review/bulk", json={"ids": good + no_sum + ["gone"], "action": "approve"})
    assert r.status_code == 200 and r.json() == {"done": 2, "skipped": 2}
    for i in good:
        j = await db[JOBS].find_one({"_id": i})
        assert j["status"] == "active" and j["locations"] == ["Pune"] and j["collector"]["city_from"] == "summary"
    assert (await db[JOBS].find_one({"_id": no_sum[0]}))["status"] == "review"  # no summary: never live
    r = await owner.post(
        "/api/admin/jobs/review/bulk", json={"ids": no_sum + good, "action": "close", "note": "Duplicate"}
    )
    assert r.json() == {"done": 1, "skipped": 2}  # live ones are no longer waiting
    j = await db[JOBS].find_one({"_id": no_sum[0]})
    assert j["status"] == "closed" and j["closed_reason"] == "not approved: Duplicate"
    logs = [a async for a in db[AUDIT].find({"action": "job.review_bulk"})]
    assert len(logs) == 2 and logs[0]["data"]["done"] == 2 and logs[1]["data"]["action"] == "close"


async def test_bulk_all_matching(admin_client, db):
    owner = await admin_client("owner")
    await waiting(db, 3, reasons=("no_page_text",), desc=col.PLACEHOLDER, title="Thin")
    keep = await waiting(db, 2)
    r = await owner.post("/api/admin/jobs/review/bulk", json={"all": True, "reason": "no_page_text", "action": "close"})
    assert r.json() == {"done": 3, "skipped": 0}
    assert await db[JOBS].count_documents({"status": "review"}) == 2
    assert all([(await db[JOBS].find_one({"_id": i}))["status"] == "review" for i in keep])
    d = (await owner.get("/api/admin/jobs/review?reason=city_not_stated")).json()
    assert d["total"] == 2


async def test_approve_with_city_only_city_issues(admin_client, db):
    owner = await admin_client("owner")
    ready = await waiting(db, 2)  # city in the summary
    from_loc = await waiting(db, 1, desc=SUM_NOWHERE, loc="Bangalore Urban, KA", title="Loc")
    no_city = await waiting(db, 1, desc=SUM_NOWHERE, title="Nowhere")
    other = await waiting(db, 1, reasons=("city_not_stated", "summary_failed"), desc=col.PLACEHOLDER, title="Other")
    r = await owner.post("/api/admin/jobs/review/approve-with-city")
    assert r.status_code == 200 and r.json() == {"approved": 3, "noCity": 1}
    for i in ready:
        assert (await db[JOBS].find_one({"_id": i}))["locations"] == ["Pune"]
    j = await db[JOBS].find_one({"_id": from_loc[0]})
    assert j["status"] == "active" and j["locations"] == ["Bengaluru"] and j["review"]["reasons"] == []
    assert (await db[JOBS].find_one({"_id": no_city[0]}))["status"] == "review"
    assert (await db[JOBS].find_one({"_id": other[0]}))["status"] == "review"  # other issues: still Admin's call
    a = await db[AUDIT].find_one({"action": "job.review_city"})
    assert a["data"] == {"approved": 3, "noCity": 1}


async def test_collector_fills_the_city_and_goes_live(client, db, key, ai):  # noqa: F811
    # no city in the location, but the summary names Pune: live at once, with the city
    out = await post(client, key, [{**JOB, "location": "", "apply_url": "https://careers.acme-industries.com/jobs/c1"}])
    assert out["results"][0]["result"] == "created" and out["results"][0]["reasons"] == []
    j = await db[JOBS].find_one({"collector.url_key": "careers.acme-industries.com/jobs/c1"})
    assert j["status"] == "active" and j["locations"] == ["Pune"] and j["collector"]["city_from"] == "summary"
    # a dry run says the same
    out = await post(
        client,
        key,
        [{**JOB, "title": "Line Trainee", "location": "", "apply_url": "https://careers.acme-industries.com/jobs/c2"}],
        dryRun=True,
    )
    assert out["results"][0]["result"] == "created"
    # no page text: the city can't be filled and the summary is missing too, so it waits for both
    out = await post(
        client,
        key,
        [
            {
                **JOB,
                "title": "Shift Trainee",
                "location": "",
                "page_text": "",
                "apply_url": "https://careers.acme-industries.com/jobs/c3",
            }
        ],
    )
    assert out["results"][0]["reasons"] == ["city_not_stated", "no_page_text"]
    assert SUMMARY  # the summary the fake model writes names Pune
