"""The fresher project helper ("Make this project stronger"): bullets only from the answers, AI fact-checked, 3 free AI
uses a day then rules, never an error."""

import json

import httpx2
import pytest

from app.core import claude
from app.core.config import get_settings
from app.projects import helper
from tests.conftest import signup

ANSWERS = {
    "built": "a college attendance app",
    "tools": "Flutter, Firebase",
    "part": "the login and attendance screens",
    "team": "3",
    "does": "lets teachers mark attendance from their phone",
    "result": "",
}


def reply(bullets, model="claude-haiku-5-5"):
    return {"id": "m", "type": "message", "role": "assistant", "model": model,
            "content": [{"type": "text", "text": json.dumps({"bullets": bullets})}], "stop_reason": "end_turn",
            "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1}}  # fmt: skip


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    monkeypatch.setattr(get_settings(), "anthropic_model", "claude-haiku-5-5")
    monkeypatch.setattr(claude, "NO_GRAMMAR", set())

    class A:
        replies: dict = {}
        sent: list = []

    def handler(request):
        A.sent.append(json.loads(request.content))
        r = A.replies[A.sent[-1]["model"]]
        if isinstance(r, int):
            return httpx2.Response(r, json={"type": "error", "error": {"type": "x", "message": "no"}})
        return httpx2.Response(200, json=r)

    A.sent = []
    monkeypatch.setattr(helper, "HTTP_CLIENT", httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))
    return A


async def post(c, answers=None, title="Attendance app"):
    return await c.post("/api/me/projects/strengthen", json={"title": title, "answers": answers or ANSWERS})


GOOD = [
    "Built a college attendance app using Flutter and Firebase",
    "Developed the login and attendance screens in a team of 3",
    "Let teachers mark attendance from their phone",
]


def test_fact_check():
    a = helper.clean(ANSWERS)
    assert helper.grounded(GOOD[0], a)
    assert helper.grounded(GOOD[1], a)
    assert not helper.grounded("Built the app using Flutter, Firebase and React", a)  # a tool not in the answers
    assert not helper.grounded("Used by 500 teachers across 3 colleges", a)  # a number not in the answers
    assert not helper.grounded("Won first prize for a college attendance app", a)  # a claim not in the answers
    assert not helper.grounded("Improved attendance tracking for teachers", a)
    assert helper.grounded(
        "Improved marking time from 10 minutes to 2",
        helper.clean({**ANSWERS, "result": "improved marking time from 10 minutes to 2"}),
    )


def test_rules_bullets_use_only_the_answers():
    b = helper.rules_bullets(helper.clean(ANSWERS), "Attendance app")
    assert b == [
        "Built a college attendance app using Flutter and Firebase",
        "Project lets teachers mark attendance from their phone",
        "Handled the login and attendance screens in a team of 3",
    ]
    assert all(helper.grounded(x, helper.clean(ANSWERS), "Attendance app") for x in b)
    b2 = helper.rules_bullets(helper.clean({**ANSWERS, "result": "cut marking time from 10 minutes to 2"}))
    assert b2[-1] == "Result: cut marking time from 10 minutes to 2"


async def test_needs_sign_in(client):
    assert (await post(client)).status_code == 401


async def test_ai_bullets_are_fact_checked_and_no_number_means_a_tip(client, outbox, api):
    await signup(client, outbox)
    api.replies = {"claude-haiku-5-5": reply([*GOOD, "Used by 500 teachers in Andhra Pradesh"])}
    r = await post(client)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "ai" and d["bullets"] == GOOD  # the invented one is dropped
    assert d["tip"] == "Add a number if you have one (users, accuracy, time saved)."
    assert d["aiLeft"] == 2
    sent = api.sent[0]["messages"][0]["content"][0]["text"]
    assert "<answers>" in sent and "Flutter, Firebase" in sent


async def test_ai_that_invents_falls_back_to_rules(client, outbox, api):
    await signup(client, outbox)
    api.replies = {"claude-haiku-5-5": reply(["Built an app used by 1,000 students with React", "Won the hackathon"])}
    d = (await post(client)).json()
    assert d["source"] == "rules" and d["bullets"][0] == "Built a college attendance app using Flutter and Firebase"
    assert "only your words" in d["note"]


async def test_three_free_ai_uses_then_rules_never_an_error(client, outbox, api):
    await signup(client, outbox)
    api.replies = {"claude-haiku-5-5": reply(GOOD)}
    for left in (2, 1, 0):
        d = (await post(client)).json()
        assert d["source"] == "ai" and d["aiLeft"] == left
    d = (await post(client)).json()
    assert d["source"] == "rules" and d["aiLeft"] == 0 and "3 free AI project rewrites" in d["note"]
    assert len(api.sent) == 3
    api.replies = {"claude-haiku-5-5": 500, "claude-sonnet-5-5": 500}


async def test_api_down_or_ai_off_still_gives_bullets(client, outbox, api, monkeypatch):
    await signup(client, outbox)
    api.replies = {m: 529 for m in ("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5")}
    monkeypatch.setattr(claude, "models", lambda: ["claude-haiku-5-5"])
    d = (await post(client)).json()
    assert d["source"] == "rules" and len(d["bullets"]) >= 2
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    d = (await post(client)).json()
    assert d["source"] == "rules" and d["aiLeft"] == 0


async def test_any_language_and_no_personal_data(client, outbox, api):
    await signup(client, outbox)
    api.replies = {
        "claude-haiku-5-5": reply(["Built a farmer price app using Python", "Shows daily crop prices to farmers"])
    }
    answers = {"built": "రైతుల కోసం ధరల యాప్ (farmer price app)", "tools": "Python", "part": "అన్నీ నేనే చేశాను",
               "team": "1", "does": "రోజువారీ పంట ధరలు చూపిస్తుంది, shows daily crop prices to farmers  call 98765 43210",
               "result": ""}  # fmt: skip
    r = await post(client, answers, title="Farmer prices")
    assert r.status_code == 200
    assert "98765" not in json.dumps(api.sent)
    assert r.json()["source"] == "ai"
    assert (await post(client, {"built": ""}, title="")).status_code == 400
