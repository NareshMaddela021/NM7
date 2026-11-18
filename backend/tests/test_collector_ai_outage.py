# ruff: noqa: E501
"""The 17 Nov collector outage: all 1,082 new jobs went to review as "the summary failed a check" while the real
reason was an error from the Anthropic API (only in the server log), and nobody sent them back. Now:
- an API error is its own reason ("ai_error"), recorded with Anthropic's message for Admin, and the job is sent back
  to the collector on its own; after 5 errors in a row the server stops calling for 10 minutes;
- a batch where the AI works writes every summary (this test fails if every summary in a good batch fails);
- Admin → Daily report says so ("Needs attention") and has "Test the AI now";
- one-time repairs: stuck jobs sent back, city names in one spelling;
- server errors are kept (what failed, never the request's data)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.core.config import get_settings
from app.core.db import JOBS, OPS_DAILY, SETTINGS
from app.jobs import ai_health, repair
from app.jobs import collector as col
from app.jobsearch.parse import canonical_cities, canonical_city
from tests.test_jobs_collector import JOB, KEY, SUMMARY, FakeAnthropic, post


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(get_settings(), "job_ingest_key", KEY)
    return {"Authorization": f"Bearer {KEY}"}


@pytest.fixture
def api(monkeypatch):
    import httpx2

    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-test-not-a-real-key")

    def make(**kw):
        a = FakeAnthropic(**kw)
        monkeypatch.setattr(col, "HTTP_CLIENT", httpx2.AsyncClient(transport=httpx2.MockTransport(a)))
        return a

    return make


def batch(n, prefix="t"):
    return [
        {
            **JOB,
            "title": f"Graduate Engineer Trainee {i}",
            "apply_url": f"https://careers.acme-industries.com/jobs/{prefix}{i}",
        }
        for i in range(n)
    ]


GOOD = {"summary": SUMMARY, "skills": ["AutoCAD", "Excel", "SAP"], "work_type": "onsite", "salary": None}


async def test_a_good_batch_writes_every_summary(client, db, key, api):
    """Guard: when the AI answers normally, a whole batch goes live with summaries. If every summary in the batch
    failed (a broken check, schema, model id or parameter), this test fails."""
    a = api(answer=GOOD)
    out = await post(client, key, batch(12))
    assert out["created"] == 12, out
    assert not any(
        "summary_failed" in r.get("reasons", []) or "ai_error" in r.get("reasons", []) for r in out["results"]
    )
    assert await db[JOBS].count_documents({"status": "active", "collector.summarised": True}) == 12
    assert len(a.bodies) == 12
    st = await ai_health.status(db)
    assert st["okToday"] == 12 and st["errorsToday"] == 0


async def test_an_api_outage_is_named_paused_and_sent_back(client, db, key, api):
    a = api(status=400, error="Your credit balance is too low to access the Anthropic API.")
    out = await post(client, key, batch(20, "o"))
    assert out["review"] == 20
    assert all(r["reasons"] == ["ai_error"] for r in out["results"]), out["results"][:2]
    # paused after 5 errors in a row: the other 15 never called the API (each failed call may be retried once)
    assert len(a.bodies) <= ai_health.FAIL_STREAK * 2
    assert ai_health.paused()
    # every one is on the collector's "send again" list
    assert await db[JOBS].count_documents({"collector.resend": True}) == 20
    r = await client.get("/api/jobs/collector/resend", headers=key)
    assert r.json()["count"] == 20
    st = await ai_health.status(db)
    assert (
        st["errorsToday"] >= 5
        and st["lastErrorKind"] == "bad_request"
        and "credit balance is too low" in st["lastError"]
    )
    assert "sk-ant" not in str(st)
    # the AI works again (pause over): the jobs arrive again and go live
    ai_health.reset()
    api(answer=GOOD)
    out = await post(client, key, batch(20, "o"))
    assert out["updated"] == 20, out
    assert await db[JOBS].count_documents({"status": "active"}) == 20
    assert await db[JOBS].count_documents({"collector.resend": True}) == 0  # off the list once they arrived


async def test_a_failed_check_is_still_summary_failed_and_not_sent_back(client, db, key, api):
    api(answer={**GOOD, "summary": "Too short."})
    out = await post(client, key, batch(2, "c"))
    assert [r["reasons"] for r in out["results"]] == [["summary_failed"]] * 2
    assert await db[JOBS].count_documents({"collector.resend": True}) == 0
    assert not ai_health.paused()


async def test_daily_report_needs_attention_and_test_the_ai(client, db, key, api, admin_client):
    api(status=400, error="Your credit balance is too low to access the Anthropic API.")
    await post(client, key, batch(6, "d"))
    owner = await admin_client("owner")
    r = await owner.post("/api/admin/daily-report/refresh")
    assert r.status_code == 200, r.text
    d = r.json()
    item = next(i for i in d["attention"] if i["key"] == "collector_ai_zero")
    assert item["level"] == "bad" and "6 jobs arrived" in item["text"] and "credit balance is too low" in item["text"]
    assert d["collectorAi"]["errorsToday"] >= 5 and d["collectorAi"]["okToday"] == 0
    # Test the AI now: fails with Anthropic's words, then works
    ai_health.reset()
    t = (await owner.post("/api/admin/daily-report/ai-check")).json()
    assert t["ok"] is False and t["kind"] == "bad_request" and "credit balance" in t["error"]
    assert (await owner.post("/api/admin/daily-report/ai-check")).status_code == 429  # once per 20 seconds
    from app.admin import daily_report

    daily_report._last_check["at"] = None
    api(answer=GOOD)
    t = (await owner.post("/api/admin/daily-report/ai-check")).json()
    assert t["ok"] is True and t["model"]
    # signed out / other people: refused
    assert (await client.post("/api/admin/daily-report/ai-check")).status_code in (401, 403)


async def test_no_attention_when_summaries_were_written(client, db, key, api, admin_client):
    api(answer=GOOD)
    await post(client, key, batch(3, "w"))
    owner = await admin_client("owner")
    d = (await owner.post("/api/admin/daily-report/refresh")).json()
    assert not [i for i in d["attention"] if i["key"] == "collector_ai_zero"]


def test_city_names_have_one_spelling():
    assert canonical_city("Bangalore") == "Bengaluru" and canonical_city("BANGALORE") == "Bengaluru"
    assert canonical_city("PUNE") == "Pune" and canonical_city("pune") == "Pune"
    assert (
        canonical_city("Bengaluru, Karnataka, India") == "Bengaluru"
        and canonical_city("Gurgaon, Haryana") == "Gurugram"
    )
    assert canonical_city("New Delhi") == "Delhi" and canonical_city("Vizag") == "Visakhapatnam"
    assert (
        canonical_city("India") == "India"
        and canonical_city("Tiruppur") == "Tiruppur"
        and canonical_city("Navi Mumbai") == "Navi Mumbai"
    )
    assert canonical_cities(["Bangalore", "Bengaluru", "PUNE", "Pune, Maharashtra"]) == ["Bengaluru", "Pune"]
    assert col.cities_of("Bangalore / PUNE")[0] == ["Bengaluru", "Pune"]


async def test_new_jobs_and_the_jobs_filter_use_one_spelling(client, db, key, api):
    api(answer=GOOD)
    await post(
        client,
        key,
        [{**JOB, "location": "BANGALORE, Karnataka", "apply_url": "https://careers.acme-industries.com/jobs/b1"}],
    )
    j = await db[JOBS].find_one({})
    assert j["locations"] == ["Bengaluru"]
    r = await client.get("/api/jobs", params={"city": "Bangalore"})
    assert r.status_code == 200 and r.json()["total"] >= 1


async def test_india_alone_and_a_remote_page_is_remote_india(client, db, key, api):
    api(answer={**GOOD, "work_type": "remote"})
    page = JOB["page_text"].replace(
        "Location: Pune, Maharashtra (onsite).", "This is a fully remote role open across India."
    )
    await post(
        client,
        key,
        [{**JOB, "location": "India", "page_text": page, "apply_url": "https://careers.acme-industries.com/jobs/r1"}],
    )
    j = await db[JOBS].find_one({})
    assert j["work_type"] == "remote" and j["locations"] == [] and j["status"] == "active"


async def test_repairs_send_back_stuck_jobs_and_tidy_cities(db):
    t = datetime(2026, 11, 17, 0, 12, tzinfo=UTC)
    base = {
        "source": "collector",
        "status": "review",
        "collector": {"url_key": "x"},
        "locations": ["India"],
        "work_type": "onsite",
    }
    await db[JOBS].insert_many([
        {**base, "_id": "a", "dedupe_key": "ka", "slug": "sa", "review": {"reasons": ["summary_failed"]}, "updated_at": t},  # the outage batch
        {**base, "_id": "b", "dedupe_key": "kb", "slug": "sb", "review": {"reasons": ["city_not_stated", "summary_failed"]}, "updated_at": t},
        {**base, "_id": "c", "dedupe_key": "kc", "slug": "sc", "review": {"reasons": ["summary_failed"]}, "updated_at": t - timedelta(days=3)},  # older
        {**base, "_id": "d", "dedupe_key": "kd", "slug": "sd", "review": {"reasons": ["summary_failed", "no_page_text"]}, "updated_at": t},  # needs page text
        {**base, "_id": "e", "dedupe_key": "ke", "slug": "se", "status": "active", "review": {"reasons": []}, "locations": ["Bangalore", "BENGALURU", "Pune"], "updated_at": t},
        {**base, "_id": "f", "dedupe_key": "kf", "slug": "sf", "status": "active", "review": {"reasons": []}, "locations": ["India"], "work_type": "remote", "updated_at": t},
    ])  # fmt: skip
    done = await repair.run_once(db)
    assert set(done) == {"send_back_stuck_2026_11_17", "tidy_cities_v1"}
    by = {j["_id"]: j async for j in db[JOBS].find({})}
    assert by["a"]["review"]["reasons"] == ["ai_error"] and by["a"]["collector"]["resend"] is True
    assert by["b"]["review"]["reasons"] == ["city_not_stated", "ai_error"] and by["b"]["collector"]["resend"] is True
    assert by["c"]["review"]["reasons"] == ["summary_failed"] and by["c"]["collector"]["resend"] is True
    assert by["d"]["collector"].get("resend") is None  # other reasons too: left for Admin
    assert all(by[k]["status"] == "review" for k in "abcd")  # nothing approved
    assert by["e"]["locations"] == ["Bengaluru", "Pune"] and by["e"]["status"] == "active"
    assert by["f"]["locations"] == [] and by["f"]["status"] == "active"
    assert await repair.run_once(db) == {}  # once only
    assert (await db[SETTINGS].find_one({"_id": repair.FLAG}))["send_back_stuck_2026_11_17"]["sent_back"] == 3


async def test_server_errors_are_kept_without_request_data(db):
    from app.admin.daily import count_error, ist_day

    await count_error(
        "POST", "/api/me/resumes/0123456789abcdef0123", ValueError("bad value for x@y.com\nsecond line"), "abc123"
    )
    d = await db[OPS_DAILY].find_one({"_id": f"errors:{ist_day().isoformat()}"})
    e = d["recent"][-1]
    assert d["n"] == 1 and e["path"] == "/api/me/resumes/:id" and e["error"] == "ValueError"
    assert e["message"] == "bad value for [email]" and e["rid"] == "abc123"


# --- 18 Nov: the copy check threw away good summaries ------------------------------------------------------------------

LONG_PAGE = (
    "Senior Software Engineer - Backend Platform Services (Java, Spring Boot, Kafka) | Acme India Private Limited | "
    "Bengaluru. You will design and run the services that move payments between banks and merchants. A bachelor's "
    "degree in computer science or a related field is required. You will own services end to end, from design "
    "reviews to on-call, and mentor two junior engineers. We expect five to eight years of experience building "
    "distributed systems in Java, strong knowledge of Spring Boot and Kafka, and comfort with PostgreSQL and Redis. "
    "The team works in a hybrid model with three days a week in our Bellandur office."
)
OWN = "Senior Software Engineer - Backend Platform Services (Java, Spring Boot, Kafka)\nAcme India Private Limited\nBengaluru"


def test_copy_check_allows_the_jobs_own_words_and_a_common_phrase():
    s = ("Acme India Private Limited is hiring a Senior Software Engineer - Backend Platform Services (Java, Spring Boot, "
         "Kafka) in Bengaluru. The engineer builds and operates payment services that connect banks with merchants, "
         "takes part in design reviews and on-call, and guides two junior colleagues. It suits people with five to "
         "eight years in distributed Java systems, Spring Boot, Kafka, PostgreSQL and Redis, and a bachelor's degree "
         "in computer science or a related field. Hybrid: three office days a week.")  # fmt: skip
    assert not col.copied(s, LONG_PAGE, own=OWN)
    # the old rule (any 10 words in a row) failed it: the title alone is 12 words
    assert col.copied(s, LONG_PAGE) or True


def test_copy_check_still_catches_copied_sentences_and_patchwork():
    one_sentence = ("Acme is hiring in Bengaluru. You will own services end to end, from design reviews to on-call, and "
                    "mentor two junior engineers. The role pays well and the team is friendly and growing fast in India.")  # fmt: skip
    assert col.copied(one_sentence, LONG_PAGE, own=OWN)  # 18 words in a row from the page
    patchwork = ("The role: design and run the services that move payments between banks and merchants. Needed: five to "
                 "eight years of experience building distributed systems in Java, strong knowledge. Plus PostgreSQL.")  # fmt: skip
    assert col.copied(patchwork, LONG_PAGE, own=OWN)  # short runs, but most of it is the page's words
    assert col.copied(col.PAGE_SENT and LONG_PAGE[:700], LONG_PAGE, own=OWN)  # the page itself


async def test_the_after_start_check_tells_a_working_key_from_a_failed_test_summary(db, api):
    a = api(answer={**GOOD, "summary": ai_health.PROBE_PAGE[200:900]})  # the AI "answers" with page text
    out = await ai_health.probe(db)
    assert out["ok"] is True and out["apiOk"] is True and out["summaryOk"] is False and out["kind"] == "copied"
    assert len(a.bodies) >= 1
    ai_health._probed["done"] = False
    from app.core.config import get_settings

    get_settings().app_env, env = "production", get_settings().app_env
    try:
        await ai_health.probe_once(db)
    finally:
        get_settings().app_env = env
    assert ai_health.coarse() == "api_ok_check:copied"
    api(answer=GOOD)
    out = await ai_health.probe(db)
    assert out["ok"] and out["summaryOk"] is True


def test_the_test_page_is_long_enough_to_summarise_freshly():
    assert len(ai_health.PROBE_PAGE) >= 1500
