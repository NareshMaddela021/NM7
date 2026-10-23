"""LinkedIn services, Phase 1: the LinkedIn record and the AI headline writer (Claude's HTTP API mocked)."""

import json
import logging

import httpx2
import pytest

from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import LINKEDIN
from app.linkedin import writer
from app.linkedin.router import allowed, normalize_url
from tests.conftest import signup

FACTS = {
    "target": "Data Analyst",
    "skills": ["SQL", "Excel", "Power BI"],
    "degree": "B.Tech Computer Science, 2024",
    "projects": ["Sales dashboard"],
    # never sent to the model
    "name": "Ravi Kumar",
    "phone": "98765 43210",
}
GOOD = [
    "Data Analyst | SQL · Excel · Power BI | B.Tech Computer Science (2024) | Built a sales dashboard",
    "Aspiring Data Analyst skilled in SQL, Excel and Power BI · B.Tech CSE 2024",
]


def reply(headlines, model="claude-haiku-5-5", stop="end_turn"):
    text = json.dumps({"headlines": headlines}) if headlines is not None else ""
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": text}] if headlines is not None else [],
        "stop_reason": stop,
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 10},
    }


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    monkeypatch.setattr(get_settings(), "anthropic_model", "claude-haiku-5-5")
    monkeypatch.setattr(claude, "NO_GRAMMAR", set())

    class A:
        replies: dict = {}
        sent: list = []

        @staticmethod
        def text(i=0):
            return json.loads(A.sent[i].content)["messages"][0]["content"][0]["text"]

    def handler(request):
        A.sent.append(request)
        r = A.replies[json.loads(request.content)["model"]]
        if isinstance(r, int):
            return httpx2.Response(r, json={"type": "error", "error": {"type": "x", "message": "no"}})
        return httpx2.Response(200, json=r)

    A.sent = []
    monkeypatch.setattr(writer, "HTTP_CLIENT", httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))
    return A


async def post(client, **kw):
    return await client.post("/api/me/linkedin/headlines", json={"facts": FACTS, "note": "", **kw})


# ---------- the link ----------


@pytest.mark.parametrize(
    "raw,want",
    [
        ("linkedin.com/in/ravi-kumar", "https://www.linkedin.com/in/ravi-kumar"),
        ("https://www.linkedin.com/in/ravi-kumar-123/", "https://www.linkedin.com/in/ravi-kumar-123"),
        ("http://in.linkedin.com/in/ravi_k?trk=x", "https://www.linkedin.com/in/ravi_k"),
        ("  ", ""),
    ],
)
def test_profile_links_are_normalized(raw, want):
    assert normalize_url(raw) == want


@pytest.mark.parametrize(
    "raw",
    [
        "https://www.linkedin.com/company/nm7",
        "linkedin.com/feed",
        "https://linkedin.com.evil.example/in/ravi",
        "https://example.com/in/ravi",
        "ravi kumar",
        "javascript:alert(1)",
    ],
)
def test_other_links_are_refused(raw):
    with pytest.raises(ValueError, match="linkedin.com/in/your-name"):
        normalize_url(raw)


# ---------- the record ----------


async def test_needs_a_customer(client, outbox):
    assert (await client.get("/api/me/linkedin")).status_code == 401
    assert (await client.put("/api/me/linkedin", json={})).status_code == 401


async def test_save_read_and_delete(client, outbox, db):
    await signup(client, outbox)
    r = await client.get("/api/me/linkedin")
    assert r.status_code == 200 and r.json()["url"] == "" and r.json()["updatedAt"] is None
    body = {
        "url": "linkedin.com/in/sai-varsha",
        "path": "fix",
        "targetRole": "  Data   Analyst ",
        "source": "paste",
        "sections": {"headline": "Student", "about": "I like data. Aadhaar 2345 6789 0123."},
        "result": {"score": 41, "fixes": [{"id": "headline", "title": "Headline"}]},
    }
    r = await client.put("/api/me/linkedin", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["url"] == "https://www.linkedin.com/in/sai-varsha" and d["targetRole"] == "Data Analyst"
    assert "2345" not in json.dumps(d) and d["result"]["score"] == 41
    stored = await db[LINKEDIN].find_one({})
    assert "2345" not in json.dumps(stored, default=str)
    assert (await client.get("/api/me/linkedin")).json()["sections"]["headline"] == "Student"
    assert (await client.delete("/api/me/linkedin")).status_code == 204
    assert await db[LINKEDIN].count_documents({}) == 0
    assert (await client.get("/api/me/linkedin")).json()["url"] == ""


async def test_an_invalid_link_is_rejected(client, outbox):
    await signup(client, outbox)
    r = await client.put("/api/me/linkedin", json={"url": "https://www.linkedin.com/company/x"})
    assert r.status_code == 422
    assert "linkedin.com/in/your-name" in r.text


async def test_each_person_sees_only_their_own(client, outbox):
    await signup(client, outbox, email="one@example.com")
    await client.put("/api/me/linkedin", json={"url": "linkedin.com/in/one-person"})
    await client.post("/api/auth/logout")
    await signup(client, outbox, email="two@example.com")
    assert (await client.get("/api/me/linkedin")).json()["url"] == ""


async def test_too_much_text_is_413(client, outbox):
    await signup(client, outbox)
    r = await client.put("/api/me/linkedin", json={"sections": {"about": "x" * 61_000}})
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"


# ---------- AI headlines ----------


def test_the_headline_check():
    src = "Data Analyst SQL 2024"
    assert allowed("Data Analyst | SQL | B.Tech 2024", src)
    assert not allowed("Data Analyst | SQL | 3 years of experience", src)  # invented number
    assert not allowed("Data Analyst | call 98765 43210", src + " 98765 43210")
    assert not allowed("Data Analyst | ravi@example.com", src)
    assert not allowed("Data Analyst | linkedin.com/in/ravi", src)
    assert not allowed("Data Analyst 🚀 SQL", src)
    assert not allowed("x" * 221, src)
    assert not allowed("Analyst", src)


async def test_headlines_send_no_name_or_phone_and_check_each_one(client, outbox, api, caplog):
    await signup(client, outbox)
    invented = "Data Analyst with 5 years at Infosys | SQL · Excel"
    contact = "Data Analyst | SQL | Excel | ravi@example.com"
    api.replies = {"claude-haiku-5-5": reply([*GOOD, invented, contact, GOOD[0]])}
    caplog.set_level(logging.INFO, logger="nm7.linkedin")
    note = "నేను డేటా అనలిస్ట్ కావాలనుకుంటున్నాను. call 98765 43210, ravi@example.com"
    r = await post(client, note=note, current="Student at JNTU")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["headlines"] == GOOD and d["fallback"] is False
    text = api.text()
    for private in ("Ravi Kumar", "98765", "ravi@example.com"):
        assert private not in text
    assert "- target: Data Analyst" in text and "- skills: SQL, Excel, Power BI" in text
    assert "<note>" in text and "English only" in text and "Student at JNTU" in text
    assert "Write 5 different headlines." in text
    assert "Ravi" not in caplog.text and "SQL" not in caplog.text
    assert any(m.startswith("linkedin ai: ok") and "dropped=3" in m for m in caplog.messages)


async def test_count_is_respected(client, outbox, api):
    await signup(client, outbox)
    api.replies = {"claude-haiku-5-5": reply(GOOD)}
    d = (await post(client, count=1)).json()
    assert d["headlines"] == GOOD[:1]
    assert "Write 1 different headline." in api.text()


async def test_unusable_haiku_goes_once_to_the_fallback_model(client, outbox, api):
    await signup(client, outbox)
    api.replies = {"claude-haiku-5-5": reply([]), "claude-sonnet-5-5": reply(GOOD, model="claude-sonnet-5-5")}
    d = (await post(client)).json()
    assert d["headlines"] == GOOD and d["fallback"] is True


async def test_both_models_unusable_is_422(client, outbox, api):
    await signup(client, outbox)
    api.replies = {"claude-haiku-5-5": reply([]), "claude-sonnet-5-5": reply([])}
    r = await post(client)
    assert r.status_code == 422 and r.json()["error"]["code"] == "unusable"


async def test_over_the_daily_limit_is_429_and_never_calls_the_model(client, outbox, api):
    await signup(client, outbox)
    api.replies = {"claude-haiku-5-5": reply(GOOD)}
    for _ in range(10):
        assert (await post(client)).status_code == 200
    r = await post(client)
    assert r.status_code == 429 and "10 times a day" in r.json()["error"]["message"]
    assert len(api.sent) == 10


async def test_the_site_cap_is_503_ai_busy(client, outbox, api, monkeypatch):
    await signup(client, outbox)
    monkeypatch.setattr(ai_quota, "DAILY_CAP", 1)
    api.replies = {"claude-haiku-5-5": reply(GOOD)}
    assert (await post(client)).status_code == 200
    r = await post(client)
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_busy"
    assert len(api.sent) == 1


async def test_feature_off_without_a_key(client, outbox, api, monkeypatch):
    await signup(client, outbox)
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    r = await post(client)
    assert r.status_code == 503 and r.json()["error"]["code"] == "feature_off"
    assert not api.sent


async def test_usage_counts_linkedin(client, outbox, api, db):
    await signup(client, outbox)
    api.replies = {"claude-haiku-5-5": reply(GOOD)}
    await post(client)
    assert (await ai_quota.usage(db, 1))["days"][0]["linkedin"]["calls"] == 1
