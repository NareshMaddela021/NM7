# ruff: noqa: E501
"""18 Nov: (1) Auto Apply A1's deploy timed out on Render - the first automation pass ran before the server opened its
port; (2) the server ran out of memory (512 MB) during a 1,650-job collector intake - every Claude call built a new
client (connection pool + TLS context) and never closed it. Now the port opens at once (indexes, migrations and the
first pass run after), one shared Claude client is reused, and an intake is handled one upload and one small group at
a time."""

import asyncio
import time
import tracemalloc

import pytest

from app import automation, main
from app.core import claude
from app.core.config import get_settings
from app.jobs import collector as col
from tests.test_jobs_collector import JOB, KEY, SUMMARY, post


def test_one_shared_claude_client_not_one_per_call(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-test-a")
    a, b = claude.client(40, 1), claude.client(20, 2)
    assert a._client is b._client  # one connection pool for the whole server
    assert a.timeout == 40 and b.max_retries == 2  # each call keeps its own timeout / retries
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-ant-test-b")
    c = claude.client(40, 1)
    assert c._client is not a._client and c.api_key == "sk-ant-test-b"  # a new key on Render: a fresh client
    assert claude.client(40, 1)._client is c._client


async def test_the_port_opens_before_startup_work_and_the_first_pass(monkeypatch):
    started = {"work": 0, "passes": 0}

    async def slow_work(db):
        started["work"] += 1
        await asyncio.sleep(5)

    async def one_pass(db):
        started["passes"] += 1

    monkeypatch.setattr(get_settings(), "app_env", "prod")
    monkeypatch.setattr(main, "startup_work", slow_work)
    monkeypatch.setattr(automation, "run_rules", one_pass)
    monkeypatch.setattr(automation, "START_DELAY", 0.3)
    t = time.monotonic()
    async with main.lifespan(main.create_app()):
        assert time.monotonic() - t < 1  # ready for requests at once, slow start-up work or not
        await asyncio.sleep(0.05)
        assert started["work"] == 1 and started["passes"] == 0  # indexes run in the background; no pass yet
    # the context closed: the background task was cancelled cleanly


async def test_the_first_pass_waits_its_delay(monkeypatch):
    n = {"passes": 0}

    async def one_pass(db):
        n["passes"] += 1

    monkeypatch.setattr(automation, "run_rules", one_pass)
    task = asyncio.create_task(automation.loop(lambda: None, first_delay=0.2))
    await asyncio.sleep(0.1)
    assert n["passes"] == 0
    await asyncio.sleep(0.25)
    assert n["passes"] == 1
    task.cancel()


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(get_settings(), "job_ingest_key", KEY)
    return {"Authorization": f"Bearer {KEY}"}


async def test_an_intake_is_handled_in_small_groups_with_few_summaries_at_once(client, db, key, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    live = {"now": 0, "most": 0}

    async def fake(feature, content, schema, check, **kw):
        live["now"] += 1
        live["most"] = max(live["most"], live["now"])
        await asyncio.sleep(0.002)
        live["now"] -= 1
        return check({"summary": SUMMARY, "skills": ["SAP"], "work_type": "onsite", "salary": None})

    monkeypatch.setattr(claude, "ask_models", fake)
    jobs = [
        {**JOB, "title": f"Trainee {i}", "apply_url": f"https://careers.acme-industries.com/jobs/m{i}"}
        for i in range(60)
    ]
    out = await post(client, key, jobs)
    assert out["created"] == 60
    assert live["most"] <= col.PARALLEL


async def test_intake_memory_stays_flat(client, db, key, monkeypatch):
    """A full upload (just under the server's 2 MB body limit: 70 jobs with 25 KB page texts): the extra memory stays small."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")

    async def fake(feature, content, schema, check, **kw):
        return check({"summary": SUMMARY, "skills": ["SAP"], "work_type": "onsite", "salary": None})

    monkeypatch.setattr(claude, "ask_models", fake)
    page = (JOB["page_text"] + " ") * 44  # ~25 KB
    jobs = [
        {
            **JOB,
            "title": f"Engineer {i}",
            "page_text": page,
            "apply_url": f"https://careers.acme-industries.com/jobs/z{i}",
        }
        for i in range(70)
    ]
    tracemalloc.start()
    try:
        out = await post(client, key, jobs)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert out["created"] == 70
    assert peak < 60 * 1024 * 1024, peak  # the whole request (body, parsing, 70 jobs) far under the 512 MB server
