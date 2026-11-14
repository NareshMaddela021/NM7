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


# --- round L: the real request to Anthropic ------------------------------------------------------------------------


class FakeAnthropic:
    """api.anthropic.com/v1/messages (a mock transport: nothing leaves the machine), checking a request the way the
    API does for what broke the first real batch (a structured-output schema with an object lacking
    additionalProperties: false → 400 at once), plus the basics: a model, max_tokens, one user message whose content
    is a list of text blocks."""

    def __init__(self, answer=None, status=200, error=""):
        self.bodies = []
        self.answer, self.status, self.error = answer, status, error

    def __call__(self, request):
        import json

        import httpx2

        assert request.url.host == "api.anthropic.com" and request.url.path == "/v1/messages"
        body = json.loads(request.content)
        self.bodies.append(body)

        def bad(msg):
            return httpx2.Response(400, json={"type": "error", "error": {"type": "invalid_request_error", "message": msg},
                                              "request_id": "req_test123"})  # fmt: skip

        if self.status != 200:
            return bad(self.error)
        problems = claude.schema_problems(body["output_config"]["format"]["schema"])
        if problems:
            return bad(f"output_config.format.schema: {problems[0]}")
        msg = body["messages"][0]
        if (
            not body.get("model")
            or not body.get("max_tokens")
            or msg["role"] != "user"
            or not isinstance(msg["content"], list)
        ):
            return bad("malformed request")
        return httpx2.Response(200, json={"id": "msg_1", "type": "message", "role": "assistant", "model": body["model"],
                                          "content": [{"type": "text", "text": json.dumps(self.answer)}],
                                          "stop_reason": "end_turn", "stop_sequence": None,
                                          "usage": {"input_tokens": 900, "output_tokens": 200}})  # fmt: skip


@pytest.fixture
def anthropic_api(monkeypatch):
    import httpx2

    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-test-not-a-real-key")

    def make(**kw):
        api = FakeAnthropic(**kw)
        monkeypatch.setattr(col, "HTTP_CLIENT", httpx2.AsyncClient(transport=httpx2.MockTransport(api)))
        return api

    return make


async def test_real_prompt_and_request_reach_the_api_and_go_live(client, db, key, anthropic_api):
    """The collector's own prompt builder and the shared Claude client, end to end against the mocked API: the
    request is one a real API accepts (strict schema, text blocks, thinking off on Haiku, room for the answer),
    the page text is sent scrubbed, and the job goes live with the summary."""
    api = anthropic_api(answer={"summary": SUMMARY, "skills": ["AutoCAD", "Excel", "SAP"], "work_type": "onsite",
                                "salary": None})  # fmt: skip
    out = await post(client, key, [JOB])
    assert out["created"] == 1 and out["results"][0]["result"] == "created", out
    body = api.bodies[0]
    assert body["model"] == get_settings().anthropic_model and body["max_tokens"] >= 1200
    assert body.get("thinking") == {"type": "disabled"} or body["model"] not in claude.THINKING_OFF
    text = body["messages"][0]["content"][0]["text"]
    assert "Graduate Engineer Trainee at Acme Industries" in text and "Page text:" in text
    assert "priya.hr@" not in text and "98765" not in text  # scrubbed before it is sent
    assert claude.schema_problems(body["output_config"]["format"]["schema"]) == []
    j = await db[JOBS].find_one({})
    assert j["status"] == "active" and j["description"] == SUMMARY
    # the prompt builder on its own: one text block, the page cut at PAGE_SENT
    blocks = col.prompt(col.CollectorJob.model_validate({**JOB, "location": ""}), "x" * 20_000)
    assert len(blocks) == 1 and blocks[0]["type"] == "text" and "location not stated" in blocks[0]["text"]
    assert blocks[0]["text"].count("x") >= col.PAGE_SENT


async def test_an_api_error_is_logged_with_its_message_never_the_key(client, db, key, anthropic_api, caplog):
    anthropic_api(status=400, error="Your credit balance is too low to access the Anthropic API.")
    with caplog.at_level("WARNING"):
        out = await post(client, key, [JOB])
    assert out["results"][0]["reasons"] == ["summary_failed"]
    line = next(r.getMessage() for r in caplog.records if "collector summary failed" in r.getMessage())
    assert "bad_request" in line and "credit balance is too low" in line and "req_test123" in line
    assert "sk-ant-test" not in caplog.text


# --- round M ---------------------------------------------------------------------------------------------------------


async def test_only_successful_summaries_use_the_allowance(client, db, key, ai, admin_client, monkeypatch):
    """Failed attempts are given back: 'Used today' counts summaries written, and the allowance isn't used up by
    errors (the first real day: 3,000 of 3,000 used, almost all of them 400s)."""
    owner = await admin_client("owner")
    await owner.put("/api/admin/settings", json={"seek": {"collectorAiDaily": 10}})  # more than one batch runs at once

    async def broken(*a, **kw):
        raise RuntimeError("boom")

    monkeypatch.setattr(claude, "ask_models", broken)
    jobs = [
        {**JOB, "title": f"Trainee {i}", "apply_url": f"https://careers.acme-industries.com/jobs/f{i}"}
        for i in range(5)
    ]
    out = await post(client, key, jobs)
    assert [r["reasons"] for r in out["results"]] == [["summary_failed"]] * 5  # never "ai_daily_limit"
    assert (await owner.get("/api/admin/settings")).json()["collectorAiToday"] == 0
    # the AI works again: two succeed (the allowance), the third waits for tomorrow's
    monkeypatch.undo()
    monkeypatch.setattr(get_settings(), "job_ingest_key", KEY)
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")

    async def fake(feature, content, schema, check, **kw):
        return check({"summary": SUMMARY, "skills": ["SAP"], "work_type": "onsite", "salary": None})

    monkeypatch.setattr(claude, "ask_models", fake)
    await owner.put("/api/admin/settings", json={"seek": {"collectorAiDaily": 2}})
    out = await post(client, key, jobs[:3])
    assert sorted(r["result"] for r in out["results"]) == ["review", "updated", "updated"]
    assert [r["reasons"] for r in out["results"] if r["result"] == "review"] == [["ai_daily_limit"]]
    assert (await owner.get("/api/admin/settings")).json()["collectorAiToday"] == 2


async def test_jobs_abroad_are_never_live(client, db, key, ai):
    assert col.outside_india("Remote - United States") and col.outside_india("London, UK")
    assert col.outside_india("Singapore") and col.outside_india("Remote US")
    assert not col.outside_india("Bengaluru or London") and not col.outside_india("Remote (India)")
    assert not col.outside_india("Hyderabad, Telangana") and not col.outside_india("Remote")
    out = await post(client, key, [{**JOB, "title": "Analyst US", "location": "Remote - United States",
                                    "apply_url": "https://careers.acme-industries.com/jobs/us1"}])  # fmt: skip
    assert out["results"][0] == {**out["results"][0], "result": "rejected", "reason": "outside_india"}
    assert await db[JOBS].count_documents({}) == 0
    # stored earlier with an Indian place, now sent from abroad: closed as "outside India", and gone from the site
    await post(client, key, [JOB])
    j = await db[JOBS].find_one({})
    out = await post(client, key, [{**JOB, "location": "London, United Kingdom"}])
    assert out["results"][0]["result"] == "closed" and out["results"][0]["reason"] == "outside_india"
    j = await db[JOBS].find_one({"_id": j["_id"]})
    assert j["status"] == "closed" and j["closed_reason"] == "outside India"
    assert (await client.get(f"/api/jobs/{j['slug']}")).status_code == 404


async def test_send_back_to_the_collector_and_go_live(client, db, key, ai, admin_client, monkeypatch):
    """Admin sends the jobs held only for retryable reasons back; the collector's next run fetches the list, sends
    them again with page text, and they go live with their summary (and leave the list)."""
    waiting = [
        {**JOB, "title": "No text 1", "page_text": "", "apply_url": "https://careers.acme-industries.com/jobs/n1"},
        {**JOB, "title": "No text 2", "page_text": "", "apply_url": "https://careers.acme-industries.com/jobs/n2"},
        {**JOB, "title": "No city", "page_text": "", "location": "", "apply_url": "https://careers.acme-industries.com/jobs/n3"},
    ]  # fmt: skip
    await post(client, key, waiting)
    owner = await admin_client("owner")
    r = (await owner.get("/api/admin/jobs/collector/review")).json()
    assert r["total"] == 3 and r["byReason"] == {"no_page_text": 3, "city_not_stated": 1}
    assert r["retryable"]["no_page_text"] == 2 and r["sentBack"] == 0  # the one without a city still needs Admin
    assert (await owner.post("/api/admin/jobs/collector/resend", json={"reason": "no_page_text"})).json() == {
        "sentBack": 2
    }
    after = (await owner.get("/api/admin/jobs/collector/review")).json()
    assert after["sentBack"] == 2 and after["retryable"]["no_page_text"] == 0  # nothing left to send
    lst = (await client.get("/api/jobs/collector/resend", headers=key)).json()
    assert sorted(lst["urls"]) == [waiting[0]["apply_url"], waiting[1]["apply_url"]]
    assert (await client.get("/api/jobs/collector/resend")).status_code == 401  # the key is needed
    # the next run sends them again, now with page text: live, with the summary, and off the list
    out = await post(client, key, [{**w, "page_text": PAGE} for w in waiting[:2]])
    assert [x["result"] for x in out["results"]] == ["updated", "updated"]
    for w in waiting[:2]:
        j = await db[JOBS].find_one({"title": w["title"]})
        assert j["status"] == "active" and j["description"] == SUMMARY and j["review"]["reasons"] == []
        assert (await client.get(f"/api/jobs/{j['slug']}")).status_code == 200
    assert (await client.get("/api/jobs/collector/resend", headers=key)).json()["urls"] == []
    assert (await owner.get("/api/admin/jobs/collector/review")).json()["total"] == 1
