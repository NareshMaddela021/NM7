# ruff: noqa: E501
"""Round J: the morning job-collector posts to nm7.si with one key. Auth, dedupe / update, refused jobs (job boards,
forms, staffing, outside India), original summaries only (page_text never stored, no emails or phone numbers kept),
review instead of guessing, close by link, dry runs, and removal requests. Round J2: every experience level is
accepted (senior jobs too), years map to the bands, and the daily AI allowance is an Admin setting."""

import pytest

from app.core import claude
from app.core.config import get_settings
from app.core.db import JOB_REMOVALS, JOBS
from app.jobs import collector as col

KEY = "c" * 48
PAGE = (
    "About the role. We are hiring Graduate Engineer Trainees for our Pune plant. You will support production planning, "
    "maintain quality records in SAP and work with shift teams on safety audits. Eligibility: B.E. or B.Tech in "
    "Mechanical or Production, 2025 or 2026 pass-outs, 0 to 1 years of experience. Skills: AutoCAD, MS Excel, basic "
    "SAP, good communication. Contact our recruiter Priya at priya.hr@acme-industries.com or +91 98765 43210. "
    "Location: Pune, Maharashtra (onsite). Stipend during training followed by a full-time role."
)
JOB = {"company": "Acme Industries", "title": "Graduate Engineer Trainee", "apply_url": "https://careers.acme-industries.com/jobs/GET-2026?src=x",
       "location": "Pune, Maharashtra, India", "posted": "2026-11-12", "exp_min": 0, "exp_max": 1, "exp_text": "0-1 years",
       "system": "workday", "page_text": PAGE}  # fmt: skip
SUMMARY = (
    "Acme Industries is taking on graduate engineer trainees at its Pune plant. Trainees help plan production, keep "
    "quality records up to date in SAP and join shift teams for safety audits. It suits 2025 and 2026 B.E./B.Tech "
    "graduates in Mechanical or Production with up to a year of experience. Useful skills are AutoCAD, Excel, basic "
    "SAP and clear communication. The role is onsite in Pune, starting with paid training."
)


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(get_settings(), "job_ingest_key", KEY)
    return {"Authorization": f"Bearer {KEY}"}


@pytest.fixture
def ai(monkeypatch):
    """Claude answers with an original summary (the real check runs on it); `calls` counts the requests."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    calls = []

    async def fake(feature, content, schema, check, **kw):
        calls.append(content)
        return check({"summary": SUMMARY, "skills": ["AutoCAD", "excel", "SAP"],
                      "work_type": "onsite", "salary": None})  # fmt: skip

    monkeypatch.setattr(claude, "ask_models", fake)
    return calls


def err(r):
    return r.json()["error"]["code"]


async def post(client, h, jobs, **extra):
    r = await client.post("/api/jobs/collector", json={"jobs": jobs, **extra}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_rules():
    assert col.url_key("HTTPS://www.Careers.Acme.com/jobs/1/?utm=x#top") == "careers.acme.com/jobs/1"
    lvl = lambda lo, hi, title, text="": col.experience(lo, hi, title, text)[0]  # noqa: E731
    assert lvl(0, 0, "Analyst") == "fresher" and lvl(0, 1, "Analyst") == "0_1" and lvl(1, 3, "Analyst") == "1_3"
    assert (
        lvl(None, None, "Data Intern") == "internship" and lvl(None, None, "Analyst", "Freshers welcome") == "fresher"
    )
    assert lvl(None, None, "Analyst") is None  # not stated: shown as "Experience not stated"
    # round J2: years map by exp_min, every level
    assert [lvl(lo, hi, "Engineer") for lo, hi in [(3, 5), (4, None), (5, 8), (7, 10), (8, 12), (11, 14), (12, 15), (15, 20), (20, None)]] == [
        "3_5", "3_5", "5_8", "5_8", "8_12", "8_12", "12_15", "15_plus", "15_plus"]  # fmt: skip
    assert lvl(2, 6, "Senior Engineer") == "1_3"  # the years decide, not the title
    # no years: the title is only a hint
    assert lvl(None, None, "Senior Software Engineer") == "5_8" and lvl(None, None, "Engineering Manager") == "8_12"
    assert lvl(None, None, "Staff Engineer") == "8_12" and lvl(None, None, "Head of Sales") == "12_15"
    assert lvl(None, None, "Assistant Manager - Accounts") is None and lvl(None, None, "Staff Nurse") is None
    assert lvl(None, None, "Management Trainee") == "fresher"
    assert (
        col.experience(None, None, "Senior Analyst", "")[1] == "title" and col.experience(4, 6, "x", "")[1] == "years"
    )
    assert col.scrub("Mail a.b@x.co or call +91 98765 43210 / 080-41234567 today") == "Mail or call / today"
    assert col.copied("we are hiring graduate engineer trainees for our pune plant you will support", PAGE)
    assert not col.copied(SUMMARY, PAGE)


async def test_auth(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "job_ingest_key", "")
    r = await client.post("/api/jobs/collector", json={"jobs": [JOB]})
    assert r.status_code == 503 and err(r) == "ingest_off"
    monkeypatch.setattr(get_settings(), "job_ingest_key", KEY)
    for h in ({}, {"Authorization": "Bearer wrong"}, {"Authorization": KEY}):
        r = await client.post("/api/jobs/collector", json={"jobs": [JOB]}, headers=h)
        assert r.status_code == 401 and err(r) == "bad_key"
        assert KEY not in r.text  # never echoed
    h = {"Authorization": f"Bearer {KEY}"}
    assert err(await client.post("/api/jobs/collector", json={"jobs": [JOB] * 201}, headers=h)) == "too_many"
    assert err(await client.post("/api/jobs/collector", json={"jobs": []}, headers=h)) == "no_jobs"


async def test_new_job_summary_and_no_page_text_stored(client, db, key, ai):
    out = await post(client, key, [JOB])
    assert out["created"] == 1 and out["results"][0]["result"] == "created" and len(ai) == 1
    j = await db[JOBS].find_one({"source": "collector"})
    assert (
        j["status"] == "active"
        and j["experience"] == "0_1"
        and j["locations"] == ["Pune"]
        and j["work_type"] == "onsite"
    )
    assert j["description"] == SUMMARY and SUMMARY_MIN_OK(j["description"])
    assert j["skills"] == ["AutoCAD", "Microsoft Excel", "SAP"] and j["company"]["logo"] in ("", None)
    blob = str(j)
    assert (
        "page_text" not in blob and "We are hiring Graduate Engineer Trainees" not in blob
    )  # never the company's words
    assert "priya" not in blob.lower() and "98765" not in blob  # no recruiter names, emails or phones
    assert j["apply"]["url"] == JOB["apply_url"]
    # the public page: no logo, "Source: company careers page", never a partner badge
    pub = (await client.get(f"/api/jobs/{j['slug']}")).json()
    assert pub["fromCareersPage"] is True and pub["company"]["logo"] == "" and "partner" not in str(pub).lower()
    # the AI was asked without the contact details
    assert "priya.hr@" not in ai[0] and "98765" not in ai[0]


def SUMMARY_MIN_OK(s):
    return col.SUMMARY_MIN <= len(s) <= col.SUMMARY_MAX + 100


async def test_dedupe_and_update(client, db, key, ai):
    await post(client, key, [JOB])
    # the same link written differently: updated, not a copy; no second AI call (it has its summary)
    again = {
        **JOB,
        "apply_url": "http://careers.acme-industries.com/jobs/GET-2026/",
        "location": "Pune, India",
        "page_text": "",
    }
    out = await post(client, key, [again])
    assert out["updated"] == 1 and len(ai) == 1 and await db[JOBS].count_documents({}) == 1
    # a different link but the same company + title: still the same job
    out = await post(client, key, [{**JOB, "apply_url": "https://careers.acme-industries.com/jobs/GET-2026-b"}])
    assert out["updated"] == 1 and await db[JOBS].count_documents({}) == 1


async def test_refused_jobs(client, db, key, ai):
    bad = [
        {**JOB, "apply_url": "https://www.linkedin.com/jobs/view/123"},
        {**JOB, "title": "Trainee 2", "apply_url": "https://www.naukri.com/job-listings-x"},
        {**JOB, "title": "Trainee 3", "apply_url": "https://forms.gle/abc123xyz"},
        {**JOB, "title": "Trainee 4", "apply_url": "https://acme.notion.site/jobs"},
        {**JOB, "company": "TeamLease Services", "title": "Trainee 5", "apply_url": "https://teamlease.com/j/5"},
        {
            **JOB,
            "title": "Engineer 9",
            "location": "Austin, Texas, United States",
            "apply_url": "https://careers.acme-industries.com/jobs/9",
        },
        {**JOB, "apply_url": "not a link"},
    ]
    out = await post(client, key, bad)
    assert out["rejected"] == 7 and await db[JOBS].count_documents({}) == 0 and not ai
    assert out["rejectedBy"] == {"job_board_or_form": 4, "staffing_agency": 1, "not_india": 1, "invalid": 1}
    ok = await post(
        client,
        key,
        [{**JOB, "title": "Assistant Manager - Quality", "apply_url": "https://careers.acme-industries.com/jobs/10"}],
    )
    assert ok["created"] == 1  # Assistant Manager is an early-career role


async def test_review_instead_of_guessing(client, db, key, ai, monkeypatch):
    out = await post(client, key, [{**JOB, "page_text": "Apply now."}])  # too thin to summarise honestly
    assert out["review"] == 1 and out["results"][0]["reasons"] == ["no_page_text"] and not ai
    j = await db[JOBS].find_one({})
    assert j["status"] == "review" and j["review"]["reasons"] == ["no_page_text"]
    assert (await client.get(f"/api/jobs/{j['slug']}")).status_code == 404  # not live
    # later the page text arrives: summarised and live
    out = await post(client, key, [JOB])
    assert out["updated"] == 1 and (await db[JOBS].find_one({}))["status"] == "active"
    # city unknown: review (experience not stated is no reason to wait, round J2); a summary that copies the page: review
    out = await post(client, key, [{**JOB, "title": "Plant Operator", "exp_min": None, "exp_max": None, "exp_text": "", "location": "",
                                    "apply_url": "https://careers.acme-industries.com/jobs/11"}])  # fmt: skip
    assert out["results"][0]["reasons"] == ["city_not_stated"]

    async def copy_cat(feature, content, schema, check, **kw):
        return check({"summary": PAGE[:600], "skills": [], "work_type": "onsite"})

    monkeypatch.setattr(claude, "ask_models", copy_cat)
    out = await post(
        client, key, [{**JOB, "title": "Quality Trainee", "apply_url": "https://careers.acme-industries.com/jobs/12"}]
    )
    assert out["results"][0]["result"] == "review" and out["results"][0]["reasons"] == ["summary_failed"]
    assert PAGE[:100] not in str(await db[JOBS].find_one({"title": "Quality Trainee"}))


async def test_admin_count(client, db, key, ai, admin_client):
    await post(client, key, [{**JOB, "page_text": ""}])
    owner = await admin_client("owner")
    d = (await owner.get("/api/admin/jobs")).json()
    assert d["counts"]["collectorReview"] == 1 and d["counts"]["source"]["collector"] == 1
    # the placeholder never goes live: Admin writes a summary first
    j = await db[JOBS].find_one({})
    r = await owner.post(f"/api/admin/jobs/{j['_id']}/review", json={"approve": True, "reason": ""})
    assert r.status_code == 409 and err(r) == "no_summary"


async def test_close_by_link_and_status(client, db, key, ai):
    await post(
        client,
        key,
        [JOB, {**JOB, "title": "Design Trainee", "apply_url": "https://careers.acme-industries.com/jobs/20"}],
    )
    r = await client.post(
        "/api/jobs/collector/close", json={"urls": ["https://careers.acme-industries.com/jobs/GET-2026"]}, headers=key
    )
    assert r.json() == {"closed": 1, "sent": 1}
    j = await db[JOBS].find_one({"title": "Graduate Engineer Trainee"})
    assert j["status"] == "closed" and "link no longer works" in j["closed_reason"]  # never deleted
    out = await post(
        client,
        key,
        [
            {
                **JOB,
                "title": "Design Trainee",
                "apply_url": "https://careers.acme-industries.com/jobs/20",
                "status": "closed",
            }
        ],
    )
    assert out["closed"] == 1 and (await db[JOBS].find_one({"title": "Design Trainee"}))["status"] == "closed"
    assert (await client.post("/api/jobs/collector/close", json={"urls": ["x"]})).status_code == 401


async def test_dry_run_writes_nothing(client, db, key, ai):
    out = await post(client, key, [JOB, {**JOB, "apply_url": "https://www.indeed.com/viewjob?jk=1"}], dryRun=True)
    assert out["dryRun"] is True and out["created"] == 1 and out["rejected"] == 1
    assert await db[JOBS].count_documents({}) == 0 and not ai


async def test_removal_request_closes_the_job(client, db, key, ai, admin_client):
    await post(client, key, [JOB])
    j = await db[JOBS].find_one({})
    body = {"company": "Acme Industries", "jobLink": f"https://nm7.si/jobs/{j['slug']}", "email": "hr@acme-industries.com",
            "reason": "This opening is filled."}  # fmt: skip
    r = await client.post("/api/public/job-removal", json=body)
    assert r.status_code == 201 and r.json()["found"] is True
    owner = await admin_client("owner")
    rows = (await owner.get("/api/admin/jobs/removals")).json()
    assert rows[0]["jobId"] == j["_id"] and rows[0]["company"] == "Acme Industries"
    assert (await owner.get("/api/admin/jobs")).json()["counts"]["removalRequests"] == 1
    r = await owner.post(f"/api/admin/jobs/removals/{rows[0]['id']}/close-job")
    assert r.json()["status"] == "done"
    j = await db[JOBS].find_one({})
    assert j["status"] == "closed" and j["closed_reason"] == "removed on request" and j["collector"]["removed"]
    # the collector sending it again never brings it back
    out = await post(client, key, [JOB])
    assert out["skipped"] == 1 and (await db[JOBS].find_one({}))["status"] == "closed"
    # also found by the official link; a link to nothing can be dismissed
    r = await client.post(
        "/api/public/job-removal", json={**body, "jobLink": "https://careers.acme-industries.com/jobs/GET-2026"}
    )
    assert r.json()["found"] is True
    r = await client.post("/api/public/job-removal", json={**body, "jobLink": "https://elsewhere.example/x"})
    assert r.json()["found"] is False
    rid = (await db[JOB_REMOVALS].find_one({"job_id": None}))["_id"]
    assert err(await owner.post(f"/api/admin/jobs/removals/{rid}/close-job")) == "no_job"
    assert (await owner.post(f"/api/admin/jobs/removals/{rid}/dismiss", json={"note": "not ours"})).json()[
        "status"
    ] == "dismissed"
    assert (await client.post("/api/public/job-removal", json={**body, "email": "nope"})).status_code == 422


# --- round J2: every experience level ----------------------------------------------------------------------------------


async def test_senior_jobs_accepted_with_their_level(client, db, key, ai):
    """Senior, Lead, Manager, Director … and jobs over 3 years go live like any other, with their own level."""
    jobs = [
        {**JOB, "title": "Senior Software Engineer", "exp_min": 6, "exp_max": 10, "apply_url": "https://careers.acme-industries.com/jobs/s1"},
        {**JOB, "title": "Production Manager", "exp_min": None, "exp_max": None, "exp_text": "", "apply_url": "https://careers.acme-industries.com/jobs/s2"},
        {**JOB, "title": "Director of Engineering", "exp_min": 15, "exp_max": None, "apply_url": "https://careers.acme-industries.com/jobs/s3"},
        {**JOB, "title": "Plant Operator", "exp_min": None, "exp_max": None, "exp_text": "", "apply_url": "https://careers.acme-industries.com/jobs/s4"},
    ]  # fmt: skip
    out = await post(client, key, jobs)
    assert out["created"] == 4 and out["rejected"] == 0 and out["review"] == 0
    got = {j["title"]: j async for j in db[JOBS].find({})}
    assert got["Senior Software Engineer"]["experience"] == "5_8"
    assert (
        got["Production Manager"]["experience"] == "8_12"
        and got["Production Manager"]["collector"]["exp_from"] == "title"
    )
    assert got["Director of Engineering"]["experience"] == "15_plus"
    # no years and no hint: live, shown as "Experience not stated"
    j = got["Plant Operator"]
    assert j["status"] == "active" and j["experience"] == "not_stated"
    pub = (await client.get(f"/api/jobs/{j['slug']}")).json()
    assert pub["experience"] == "not_stated"
    # the board's filters find them by band; "3–5 years" also finds older "3+ years" jobs
    await db[JOBS].update_one({"title": "Senior Software Engineer"}, {"$set": {"experience": "3_plus"}})
    titles = lambda r: sorted(x["title"] for x in r.json()["items"])  # noqa: E731
    assert titles(await client.get("/api/jobs?experience=3_5")) == ["Senior Software Engineer"]
    assert titles(await client.get("/api/jobs?experience=8_plus")) == ["Director of Engineering", "Production Manager"]


async def test_ai_allowance_is_an_admin_setting(client, db, key, ai, admin_client):
    owner = await admin_client("owner")
    s = (await owner.get("/api/admin/settings")).json()
    assert s["seek"]["collectorAiDaily"] == 3000 and s["collectorAiToday"] == 0
    r = await owner.put("/api/admin/settings", json={"seek": {"collectorAiDaily": 1}})
    assert r.status_code == 200 and r.json()["seek"]["collectorAiDaily"] == 1
    out = await post(
        client,
        key,
        [JOB, {**JOB, "title": "Design Trainee", "apply_url": "https://careers.acme-industries.com/jobs/a2"}],
    )
    assert sorted(x["result"] for x in out["results"]) == ["created", "review"] and len(ai) == 1
    assert [x for x in out["results"] if x["result"] == "review"][0]["reasons"] == [
        "ai_daily_limit"
    ]  # waits, as before
    s = (await owner.get("/api/admin/settings")).json()
    assert s["collectorAiToday"] == 1  # "Used today: 1 of 1"
    assert (await owner.put("/api/admin/settings", json={"seek": {"collectorAiDaily": -1}})).status_code == 422
