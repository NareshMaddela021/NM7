# ruff: noqa: E501
"""The LinkedIn pack's contents: owners only (checked on the server), all items present, LinkedIn's limits, nothing
invented, no phone / email, "Keep as it is" in Path 1, one regenerate per section, edits kept. Claude is mocked."""

import json
import re

import httpx2
import pytest

from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import SHARES
from app.linkedin import pack_writer
from tests.conftest import signup

FIX = {
    "path": "fix",
    "targetRole": "Data Analyst",
    "profile": {
        "headline": "Student at JNTU Hyderabad",
        "about": "I am a final year student. Call 98765 43210 or mail ravi@example.com.",
        "experience": [
            {"title": "Data Intern", "company": "Acme Analytics", "dates": "2024 - 2024", "text": "Made weekly sales reports in Excel."},
            {
                "title": "Analyst Trainee",
                "company": "Brightpath",
                "dates": "2024 - Present",
                "text": "Built a Power BI dashboard used by 12 store managers. Cut report time from 3 hours to 20 minutes with SQL. Cleaned and joined sales data from 4 sources every week.",
            },
        ],
        "skills": ["Excel", "Communication", "SQL", "Python", "Power BI"],
        "education": [{"school": "JNTU Hyderabad", "degree": "B.Tech, Computer Science", "year": "2024"}],
        "certs": ["Google Data Analytics"],
        "projects": [],
    },
    "details": {"name": "Ravi Kumar", "city": "Hyderabad"},
    "note": "",
}  # fmt: skip
CREATE = {
    "path": "create",
    "targetRole": "Web Developer",
    "profile": {},
    "details": {
        "name": "Angelin Rao",
        "city": "Vijayawada",
        "role": "Web Developer",
        "education": [{"degree": "BCA", "school": "Andhra Loyola College", "year": "2025"}],
        "skills": "HTML, CSS, JavaScript, React",
        "projects": "Portfolio website",
        "certs": "",
        "work": [],
    },
    "note": "naku web developer job kavali",
}
PRIVATE = re.compile(r"98765|ravi@example|@|https?://|www\.")


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
def no_ai(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")


@pytest.fixture
async def owner(client, outbox, admin_client, no_ai):
    me = await signup(client, outbox)
    admin = await admin_client("owner")
    r = await admin.post(f"/api/admin/customers/{me['id']}/linkedin-pack", json={"granted": True})
    assert r.status_code == 200, r.text
    return client


def numbers_from(obj) -> set[str]:
    return set(re.findall(r"\d+(?:[.,]\d+)?", json.dumps(obj, ensure_ascii=False)))


def texts(pack) -> list[str]:
    out = [*pack["headline"]["options"], pack["about"]["simple"], pack["about"]["professional"], pack["about"]["story"]]
    out += [e["text"] for e in pack["experience"]] + [e["text"] for e in pack["education"]]
    return out


# ---------- access ----------


async def test_locked_for_anyone_who_does_not_own_it(client, outbox, no_ai):
    await signup(client, outbox)
    for r in (
        await client.get("/api/me/linkedin/pack"),
        await client.post("/api/me/linkedin/pack/generate", json=FIX),
        await client.post("/api/me/linkedin/pack/regenerate", json={"section": "about"}),
        await client.put("/api/me/linkedin/pack/edit", json={"section": "urls", "value": []}),
    ):
        assert r.status_code == 403 and err(r) == "pack_locked"


async def test_guests_are_refused(client):
    assert (await client.post("/api/me/linkedin/pack/generate", json=FIX)).status_code == 401


async def test_another_account_stays_locked(owner, make_client, outbox):
    assert (await owner.post("/api/me/linkedin/pack/generate", json=FIX)).status_code == 200
    other = make_client()
    await signup(other, outbox, email="kiran@example.com", name="Kiran")
    r = await other.get("/api/me/linkedin/pack")
    assert r.status_code == 403 and err(r) == "pack_locked"


# ---------- contents ----------


async def test_path_1_all_items_limits_keep_and_nothing_invented(owner, db):
    me = await owner.get("/api/auth/me")
    await db[SHARES].insert_one({"_id": me.json()["id"], "slug": "ravi-kumar", "on": True})
    r = await owner.post("/api/me/linkedin/pack/generate", json=FIX)
    assert r.status_code == 200, r.text
    d = r.json()
    p = d["pack"]
    assert set(p) == {"headline", "about", "experience", "education", "skills", "featured", "banner", "urls"}
    # 1. headline: 5 options, at most 220, before shown
    assert len(p["headline"]["options"]) == 5 and all(len(h) <= 220 for h in p["headline"]["options"])
    assert p["headline"]["before"] == "Student at JNTU Hyderabad" and p["headline"]["keep"] is False
    assert all("Data Analyst" in h for h in p["headline"]["options"][:3])
    # 2. About: 3 styles, at most 2,600
    for k in ("simple", "professional", "story"):
        assert 30 <= len(p["about"][k]) <= 2600
    # 3. experience: rewritten (at most 2,000), the good one kept as it is
    intern, trainee = p["experience"]
    assert (
        intern["keep"] is False
        and intern["before"] == "Made weekly sales reports in Excel."
        and len(intern["text"]) <= 2000
    )
    assert trainee["keep"] is True and trainee["text"] == FIX["profile"]["experience"][1]["text"]
    # 4. education
    assert p["education"][0]["text"] == "B.Tech, Computer Science · JNTU Hyderabad · 2024"
    # 5. skills: role skills first, up to 50
    assert p["skills"]["ranked"][:4] == ["SQL", "Excel", "Power BI", "Python"] and len(p["skills"]["ranked"]) <= 50
    assert "Tableau" in p["skills"]["missing"]
    # 6. featured: the certificate and the resume link
    kinds = {f["kind"] for f in p["featured"]}
    assert {"certificate", "resume"} <= kinds
    assert next(f for f in p["featured"] if f["kind"] == "resume")["link"] == "nm7.si/r/ravi-kumar"
    # 7. banner text, 8. URL ideas
    assert p["banner"] == {"name": "Ravi Kumar", "role": "Data Analyst", "line": "SQL · Excel · Power BI"}
    assert p["urls"][0] == "linkedin.com/in/ravi-data-analyst" and len(p["urls"]) == 3
    # no phone / email anywhere in the written text, no number that wasn't given
    for t in texts(p):
        assert not PRIVATE.search(t), t
    assert numbers_from(texts(p)) <= numbers_from(FIX["profile"])
    assert d["ai"] is False and d["regenerated"] == {} and d["edited"] == {}


async def test_a_good_headline_and_about_are_kept(owner):
    body = json.loads(json.dumps(FIX))
    body["profile"]["headline"] = "Data Analyst | SQL · Excel · Power BI | B.Tech Computer Science (2024)"
    body["profile"]["about"] = "Data Analyst who turns sales data into dashboards. " * 14
    p = (await owner.post("/api/me/linkedin/pack/generate", json=body)).json()["pack"]
    assert p["headline"]["keep"] is True and p["about"]["keep"] is True


async def test_path_2_fresher_projects_become_experience_entries(owner):
    p = (await owner.post("/api/me/linkedin/pack/generate", json=CREATE)).json()["pack"]
    assert p["headline"]["before"] == "" and p["headline"]["keep"] is False
    assert len(p["headline"]["options"]) == 5
    assert p["experience"] == [
        {"kind": "project", "title": "Portfolio website", "company": "Project", "dates": "", "before": "",
         "text": "Built Portfolio website.", "keep": False}
    ]  # fmt: skip
    assert p["urls"][0] == "linkedin.com/in/angelin-web-developer"
    for t in texts(p):
        assert re.fullmatch(r"[\x20-\x7e\n·•₹–—’]*", t), t  # English output from a Telugu note


async def test_the_pack_is_saved_and_shown_again(owner):
    first = (await owner.post("/api/me/linkedin/pack/generate", json=FIX)).json()
    again = (await owner.post("/api/me/linkedin/pack/generate", json=CREATE)).json()
    assert again["pack"] == first["pack"]  # written once, then shown
    assert (await owner.get("/api/me/linkedin/pack")).json()["pack"] == first["pack"]


async def test_need_some_details(owner):
    r = await owner.post("/api/me/linkedin/pack/generate", json={"path": "create", "details": {"name": "X"}})
    assert r.status_code == 400 and err(r) == "need_details"


# ---------- regenerate and edits ----------


async def test_regenerate_once_per_section(owner):
    first = (await owner.post("/api/me/linkedin/pack/generate", json=FIX)).json()["pack"]
    r = await owner.post("/api/me/linkedin/pack/regenerate", json={"section": "headline"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["regenerated"] == {"headline": True}
    assert d["pack"]["headline"]["options"] != first["headline"]["options"]
    assert d["pack"]["about"] == first["about"]  # other sections untouched
    r = await owner.post("/api/me/linkedin/pack/regenerate", json={"section": "headline"})
    assert r.status_code == 409 and err(r) == "regenerated"
    assert (await owner.post("/api/me/linkedin/pack/regenerate", json={"section": "about"})).status_code == 200


async def test_edits_are_kept_and_never_replaced_without_asking(owner):
    p = (await owner.post("/api/me/linkedin/pack/generate", json=FIX)).json()["pack"]
    about = {**p["about"], "simple": "My own words about working with data."}
    r = await owner.put("/api/me/linkedin/pack/edit", json={"section": "about", "value": about})
    assert r.status_code == 200 and r.json()["edited"] == {"about": True}
    # regenerating another section leaves the edit alone
    await owner.post("/api/me/linkedin/pack/regenerate", json={"section": "headline"})
    assert (await owner.get("/api/me/linkedin/pack")).json()["pack"]["about"]["simple"] == about["simple"]
    # regenerating the edited section asks first
    r = await owner.post("/api/me/linkedin/pack/regenerate", json={"section": "about"})
    assert r.status_code == 409 and err(r) == "edited"
    assert (await owner.get("/api/me/linkedin/pack")).json()["pack"]["about"]["simple"] == about["simple"]
    r = await owner.post("/api/me/linkedin/pack/regenerate", json={"section": "about", "confirm": True})
    assert r.status_code == 200 and r.json()["pack"]["about"]["simple"] != about["simple"]
    assert r.json()["edited"]["about"] is False


async def test_edits_respect_limits_and_privacy(owner):
    p = (await owner.post("/api/me/linkedin/pack/generate", json=FIX)).json()["pack"]
    long = {**p["headline"], "options": ["x" * 221]}
    r = await owner.put("/api/me/linkedin/pack/edit", json={"section": "headline", "value": long})
    assert r.status_code == 400 and err(r) == "too_long"
    phone = {**p["about"], "story": "Call me on 98765 43210."}
    r = await owner.put("/api/me/linkedin/pack/edit", json={"section": "about", "value": phone})
    assert r.status_code == 400 and err(r) == "private"
    exp = [{**e, "text": "y" * 2001} for e in p["experience"]]
    r = await owner.put("/api/me/linkedin/pack/edit", json={"section": "experience", "value": exp})
    assert r.status_code == 400 and err(r) == "too_long"


async def test_refund_or_take_back_locks_it_again(owner, admin_client):
    assert (await owner.post("/api/me/linkedin/pack/generate", json=FIX)).status_code == 200
    me = (await owner.get("/api/auth/me")).json()
    admin = await admin_client("owner", email="owner2@nm7.si")
    await admin.post(f"/api/admin/customers/{me['id']}/linkedin-pack", json={"granted": False})
    assert (await owner.get("/api/me/linkedin/pack")).status_code == 403


# ---------- with AI (mocked) ----------


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


GOOD_AI = {
    "headlines": [
        "Data Analyst | SQL · Excel · Power BI | Analyst Trainee at Brightpath",
        "Data Analyst with 7 years at Infosys",  # invented: dropped
        "Data Analyst | call 98765 43210",  # contact: dropped
    ],
    "about": {
        "simple": "I want a data analyst job. I use SQL, Excel and Power BI. I made weekly sales reports in Excel as a data intern.",
        "professional": "Data Analyst who improved revenue by 40% at Google.",  # invented number and company: dropped
        "story": "I studied B.Tech in Computer Science at JNTU Hyderabad and found I enjoy working with data. Now I want a data analyst role.",
    },
    "experience": [{"index": 0, "text": "• Made weekly sales reports in Excel for the sales team."}, {"index": 1, "text": "• Rewritten"}],
    "education": ["B.Tech in Computer Science · JNTU Hyderabad · 2024"],
}  # fmt: skip


@pytest.fixture
def ai(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    monkeypatch.setattr(get_settings(), "anthropic_model", "claude-haiku-5-5")
    monkeypatch.setattr(claude, "NO_GRAMMAR", set())

    class A:
        reply: dict | int = reply(GOOD_AI)
        sent: list = []

    def handler(request):
        A.sent.append(json.loads(request.content))
        if isinstance(A.reply, int):
            return httpx2.Response(A.reply, json={"type": "error", "error": {"type": "x", "message": "no"}})
        return httpx2.Response(200, json=A.reply)

    A.sent = []
    monkeypatch.setattr(pack_writer, "HTTP_CLIENT", httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))
    return A


@pytest.fixture
async def ai_owner(client, outbox, admin_client, ai):
    me = await signup(client, outbox)
    admin = await admin_client("owner")
    await admin.post(f"/api/admin/customers/{me['id']}/linkedin-pack", json={"granted": True})
    return client


async def test_ai_pieces_are_checked_and_the_rules_fill_in(ai_owner, ai, db):
    d = (await ai_owner.post("/api/me/linkedin/pack/generate", json=FIX)).json()
    p = d["pack"]
    assert d["ai"] is True
    assert p["headline"]["options"][0] == GOOD_AI["headlines"][0] and len(p["headline"]["options"]) == 5
    assert not any("Infosys" in h or "98765" in h for h in p["headline"]["options"])
    assert p["about"]["simple"] == GOOD_AI["about"]["simple"]
    assert "at Google" not in p["about"]["professional"] and "40%" not in p["about"]["professional"]
    assert p["experience"][0]["text"] == GOOD_AI["experience"][0]["text"]
    assert p["experience"][1]["text"] == FIX["profile"]["experience"][1]["text"]  # kept as it is: AI ignored
    prompt = ai.sent[0]["messages"][0]["content"][0]["text"]
    for private in ("Ravi Kumar", "98765", "ravi@example.com"):
        assert private not in prompt
    assert (await ai_quota.usage(db, 1))["days"][0]["linkedin"]["calls"] == 1


async def test_ai_failing_or_over_the_limit_never_errors(ai_owner, ai, monkeypatch):
    ai.reply = 529
    d = (await ai_owner.post("/api/me/linkedin/pack/generate", json=FIX)).json()
    assert (
        d["ai"] is False
        and d["notice"] == "AI is busy. Here is the quick version."
        and len(d["pack"]["headline"]["options"]) == 5
    )
    monkeypatch.setattr(ai_quota, "PER_PERSON", {**ai_quota.PER_PERSON, "linkedin": 0})
    r = await ai_owner.post("/api/me/linkedin/pack/regenerate", json={"section": "about"})
    assert r.status_code == 200
    assert r.json()["notice"] == "You can use AI for LinkedIn 10 times a day. Here are quick suggestions instead."
    assert r.json()["regenerated"] == {"about": True}
