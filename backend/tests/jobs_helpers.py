"""Shared bits for the job-search tests (Phases 1-3): a resume, the sample job posts, a mocked Claude."""

import copy
import json
from pathlib import Path

import httpx2

from app.core import claude
from app.core.config import get_settings

POSTS = {p.stem: p.read_text() for p in sorted((Path(__file__).parent / "job_posts").glob("*.txt"))}

RESUME = {
    "personal": {
        "name": "Sai Varsha",
        "headline": "Data Analyst · SQL · Power BI",
        "email": "sai@example.com",
        "phone": "+91 98765 43210",
        "location": "Chennai, Tamil Nadu",
    },
    "summary": "Data Analyst Intern at Northwind Retail, skilled in Python, SQL and Statistics.",
    "exp": [
        {
            "company": "Northwind Retail",
            "role": "Data Analyst Intern",
            "employmentType": "Internship",
            "from": "2025-01",
            "to": "2025-07",
            "current": False,
            "description": "Made dashboards in Power BI for the sales team\nCleaned CSV files in Python every week",
        }
    ],
    "edu": [
        {
            "institution": "Lakeview Institute of Technology",
            "degree": "B.Tech",
            "field": "Computer Science",
            "from": "2021-08",
            "to": "2025-05",
            "grade": "8.2 CGPA",
        },
    ],  # fmt: skip
    "skillGroups": [
        {"id": "core", "label": "Core", "value": "Python, SQL, Statistics"},
        {"id": "tools", "label": "Tools", "value": "Power BI, Excel, Git, Tableau"},
    ],
    "proj": [
        {
            "title": "Sales Dashboard Revamp",
            "tagline": "Power BI dashboards for a college fest's sponsor sales",
            "description": "",
            "tech": "Power BI, SQL, Excel",
        },
    ],  # fmt: skip
    "certs": [{"name": "Google Data Analytics Certificate", "issuer": "Google", "issueDate": "2024-11"}],
    "langs": [{"name": "English", "level": "Fluent"}, {"name": "Tamil", "level": "Native"}],
}


def resume(**patch):
    d = copy.deepcopy(RESUME)
    d.update(patch)
    return d


async def add_resume(client, key="r1", data=None, name="Main", active=True):
    r = await client.post("/api/me/resumes", json={"id": key, "name": name, "data": data or resume(), "active": active})
    assert r.status_code in (200, 201), r.text
    return r.json()


def reply(obj, model="claude-haiku-5-5"):
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": json.dumps(obj)}],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 10},
    }


def mock_claude(monkeypatch, *modules):
    """The real modules with Anthropic's HTTP API mocked. `api.replies[model]`: a reply dict, an int (HTTP status), or
    a function of the request body."""
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    monkeypatch.setattr(get_settings(), "anthropic_model", "claude-haiku-5-5")
    monkeypatch.setattr(claude, "NO_GRAMMAR", set())

    class A:
        replies: dict = {}
        sent: list = []

        @staticmethod
        def bodies():
            return [json.loads(r.content) for r in A.sent]

    def handler(request):
        A.sent.append(request)
        body = json.loads(request.content)
        r = A.replies.get(body["model"], 500)
        if callable(r):
            r = r(body)
        if isinstance(r, int):
            return httpx2.Response(r, json={"type": "error", "error": {"type": "x", "message": "no"}})
        return httpx2.Response(200, json=r)

    A.sent = []
    A.replies = {}
    transport = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    for m in modules:
        monkeypatch.setattr(m, "HTTP_CLIENT", transport)
    return A
