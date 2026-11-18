# ruff: noqa: E501
"""Vetting Trust T12: fairness upgrades.

- Blind grading: one anonymiser (app/trust/fairness/blind.py) before every AI call that grades or evaluates a person.
  BLIND lists those call sites; with NOT_GRADING it covers every Claude call site (tests/test_claude_schemas.py SENT),
  and each BLIND site has a probe here that feeds it a profile full of identifying data and checks none reaches the
  prompt. While the switch is OFF, real users' V2 / V3 prompts stay exactly as before.
- Discriminatory filters: direct ones refused (job post, questions, requirements), proxies warned with why and a neutral
  alternative (also Hire now filters), every warning shown / overridden / refused logged without candidate data.
- Re-grades: ~5% of AI-graded V2 / V3 / T9 items, capped per week, a second independent AI pass, disagreements recorded,
  material ones to a person (never changed by themselves), an Admin alert per role when too many disagree.
- Pass-rate gaps: four-fifths rule with a minimum sample, by interview language, region and city tier, aggregated only.
- Switch OFF isolation.
"""

import json
import random
import re
from datetime import timedelta

import pytest
from bson import ObjectId

from app.core import claude
from app.core.config import get_settings
from app.core.db import (
    AUDIT_LOG,
    HIRE_PROFILES,
    SKILL_ATTEMPTS,
    TRUST_FAIRNESS,
    TRUST_FAIRNESS_EVENTS,
    TRUST_REGRADES,
    TRUST_RUNS,
    USERS,
    VETTING_INTERVIEWS,
    VETTING_QUEUE,
)
from app.core.time import now
from app.hire.vetting import grade as G
from app.hire.vetting import interview as V3
from app.hire.vetting.roles import BY_TEST
from app.hire.vetting.store import bank_meta, ensure_banks
from app.trust.fairness import blind as B
from app.trust.fairness import filters as F
from app.trust.fairness import regrade as RG
from app.trust.fairness import report as RP
from app.trust.honesty import explain as X
from app.trust.honesty import pledge as PL
from tests.conftest import signup
from tests.jobs_helpers import add_resume, resume
from tests.test_claude_schemas import SENT
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_trust_t9 import vetting_public  # noqa: F401  (the vetting engine is public; Trust per person)

NAME = "Lakshmi Venkata Reddy"
EMAIL = "lakshmi.reddy@example.com"
PHONE = "9848022338"
PII_TALK = (
    "I am Lakshmi Reddy from Kukatpally, mail lakshmi.reddy@example.com, phone 98480 22338, a married Hindu woman, "
    "24 years old, DOB: 12/03/1999, Brahmin family, studied at JNTU College of Engineering and IIT Bombay, "
    "Aadhaar 2345 6789 0123, PAN ABCDE1234F, linkedin.com/in/lakshmi-reddy. "
    "I built a monthly sales report with SQL joins on orders and customers, grouped by city, and checked NULL cities."
)
PII_RESUME = resume(
    personal={"name": NAME, "headline": "Data analyst · SQL", "email": EMAIL, "phone": "+91 98480 22338",
              "location": "Plot No 14, Kukatpally, Hyderabad 500072", "dob": "12/03/1999", "gender": "female", "photo": "x"},
    summary="Lakshmi Reddy, 24 years old, married, from Kukatpally. Graduate of Osmania University. Builds SQL reports.",
    exp=[{"company": "Orbit Retail", "role": "Data analyst", "from": "2023-01", "to": "", "current": True,
          "description": "Built monthly sales reports with SQL joins on orders and customers\nShared dashboards every Monday"}],
    edu=[{"institution": "Osmania University College for Women", "degree": "B.Com", "field": "Commerce", "to": "2021"},
         {"institution": "St. Ann's Junior College", "degree": "12th", "to": "2018"}],
    skillGroups=[{"id": "core", "label": "Core", "value": "SQL, Excel, Power BI"}],
    proj=[], certs=[], langs=[{"name": "Telugu"}, {"name": "English"}],
)  # fmt: skip
FORBIDDEN = ("Lakshmi", "Venkata", "Reddy", "lakshmi.reddy", PHONE, "98480 22338", "Kukatpally", "500072", "12/03/1999",
             "Osmania", "St. Ann", "JNTU", "IIT Bombay", "24 years old", "married", "Hindu", "Brahmin", "woman",
             "2345 6789 0123", "ABCDE1234F", "linkedin.com", "female")  # fmt: skip


def leaks(text: str) -> list[str]:
    return [f for f in FORBIDDEN if f.lower() in text.lower()]


def capture(monkeypatch, v2_score=4, v3_score=4, label="strong"):
    """Every Claude call, recorded: (feature, schema, prompt text, has_image)."""
    seen: list[tuple[str, object, str, bool]] = []
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")

    async def fake(feature, content, schema, check, *, stats=None, **opts):
        text = "\n".join(b.get("text", "") for b in content if b.get("type") == "text")
        seen.append((feature, schema, text, any(b.get("type") == "image" for b in content)))
        props = schema.get("properties", {}) if isinstance(schema, dict) else {}
        if "scores" in props and "confidence" in props:
            keys = props["scores"]["items"]["properties"]["key"]["enum"]
            return check(
                {"scores": [{"key": k, "score": v2_score, "reason": "ok"} for k in keys], "confidence": "high"}
            )
        if "scores" in props and "strengths" in props:
            return check({"scores": [{"key": k, "score": v3_score, "reason": "ok", "quote": ""} for k, *_ in V3.CRITERIA],
                          "strengths": ["a"], "concern": ""})  # fmt: skip
        if schema is V3.FOLLOW_SCHEMA:
            return check({"ask": False, "follow_up": ""})
        if schema is X.GRADE_SCHEMA:
            ids = re.findall(r"<<<(explain\d+)", text)
            return check({"results": [{"id": i, "label": label, "reason": "r", "quote": ""} for i in ids]})
        if schema is G.PHOTO_SCHEMA:
            return check({"genuine": "yes", "relevant": True, "faces": False, "reason": "ok"})
        raise claude.Unusable("probe")

    monkeypatch.setattr(claude, "ask_models", fake)
    return seen


async def pii_person(make_client, outbox, db, email=EMAIL, name=NAME, tester=True):
    c = make_client()
    me = await signup(c, outbox, email=email, name=name)
    await add_resume(c, data=PII_RESUME)
    await db[USERS].update_one({"_id": me["id"]}, {"$set": {"phone": PHONE}})
    if tester:
        await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email.lower()}}, upsert=True)
    return c, me["id"]


async def sql_meta(db):
    meta = await bank_meta(db, "SQL")
    if not meta:
        await ensure_banks(db)
        meta = await bank_meta(db, "SQL")
    return meta


async def v2_attempt(db, uid, answer=PII_TALK, score=80, days=1, rubric_version=None):
    meta = await sql_meta(db)
    t = now() - timedelta(days=days)
    aid = ObjectId()
    await db[SKILL_ATTEMPTS].insert_one({"_id": aid, "v": 2, "user_id": uid, "skill": "SQL", "kind": "full", "started_at": t, "submitted_at": t,
                                         "score": 80, "lang": "en", "task": {"status": "graded", "type": "tech", "answer": answer, "score": score,
                                         "model": "m", "confidence": "high", "submitted_at": t,
                                         "rubric_version": rubric_version or meta.get("rubric_version", 1)}})  # fmt: skip
    return aid


async def v3_interview(db, uid, aid=None, days=1, explain_label="strong", lang="en", passed=True):
    t = now() - timedelta(days=days)
    turns = [
        {
            "id": f"q{i}",
            "kind": "experience",
            "q": "Tell me about a report you built.",
            "looks_for": "specifics",
            "answer": PII_TALK,
        }
        for i in range(3)
    ]
    turns.append(
        {
            "id": "explain1",
            "kind": "explain",
            "q": "Why did you group by city?",
            "looks_for": X.LOOKS_FOR,
            "answer": "Because " + PII_TALK,
        }
    )
    doc = {"_id": ObjectId(), "user_id": uid, "test": "SQL", "lang": lang, "status": "graded", "graded_at": t, "started_at": t, "turns": turns,
           "grade": {"by": "ai", "scores": [{"key": k, "label": lab, "score": 4, "reason": "", "quote": ""} for k, lab, _ in V3.CRITERIA]},
           "passed": passed, "explain": {"label": explain_label, "by": "ai", "reason": "r"}, "explain_source": {"attempt_id": aid}}  # fmt: skip
    await db[VETTING_INTERVIEWS].insert_one(doc)
    return doc


# --- 1. blind grading: the registry and one probe per call site ---------------------------------------------------------


async def probe_v2(db, uid, make_client, outbox, monkeypatch):
    seen = capture(monkeypatch)
    meta = await sql_meta(db)
    await G.grade_text(db, uid, BY_TEST["SQL"], meta["task"], meta["rubric"], PII_TALK)
    await G.check_photo(db, uid, BY_TEST["SQL"], "image/png", "iVBORw0KGgo" * 20)
    photo = [s for s in seen if s[1] is G.PHOTO_SCHEMA]
    assert len(photo) == 1 and photo[0][3]  # the work photo itself, and only the role in words
    return seen


async def probe_v3(db, uid, make_client, outbox, monkeypatch, c=None):
    """The real interview flow: follow-ups, the grade, T9's questions and check (via HTTP), then the weekly second grader."""
    from app.core.db import TRUST_FACE

    seen = capture(monkeypatch)
    await db[TRUST_FACE].insert_one({"_id": uid, "status": "verified"})
    aid = await v2_attempt(db, uid)
    from app.core.db import VETTING_VERIFIED

    await db[VETTING_VERIFIED].insert_one({"user_id": uid, "test": "SQL", "band": "1-3", "score": 80, "task_score": 80, "at": now(),
                                           "expires_at": now() + timedelta(days=90), "attempt_id": aid})  # fmt: skip
    iv = (await c.post("/api/me/interviews/start", json={"test": "SQL", "consent": True, "pledge": PL.VERSION})).json()
    assert iv.get("status") == "running", iv
    while iv["status"] == "running":
        iv = (await c.post(f"/api/me/interviews/{iv['id']}/answer", json={"text": PII_TALK, "seconds": 30})).json()
    await c.post(f"/api/me/interviews/{iv['id']}/finish")
    monkeypatch.setattr(V3, "BIAS_SAMPLE", 1.0)  # the old weekly check samples 5% at random: make this pick certain
    await V3.bias_check(db, random.Random(1))
    kinds = {(s[0], id(s[1])) for s in seen}
    assert ("interview", id(V3.FOLLOW_SCHEMA)) in kinds and ("interview", id(V3.GRADE_SCHEMA)) in kinds
    assert ("explain", id(X.SCHEMA)) in kinds and ("explain", id(X.GRADE_SCHEMA)) in kinds
    assert sum(1 for s in seen if s[1] is V3.GRADE_SCHEMA and "independent second reviewer" in s[2]) == 1
    return seen


async def probe_t9(db, uid, make_client, outbox, monkeypatch, c=None):
    return await probe_v3(db, uid, make_client, outbox, monkeypatch, c)


async def probe_t10(db, uid, make_client, outbox, monkeypatch):
    from app.trust.spoken import service as SP

    seen = capture(monkeypatch)
    answers = [{"id": "a0a", "turn": 0, "part": "answer", "q": "Tell me about your work, Lakshmi.", "looks_for": "", "text": PII_TALK,
                "seconds": 40, "speech_ms": 30000, "pauses": 2}]  # fmt: skip
    await SP.rate(db, uid, answers)
    return seen


async def probe_t7(db, uid, make_client, outbox, monkeypatch):
    from app.trust.criteria import evaluate as EV
    from app.trust.criteria import evidence as E

    seen = capture(monkeypatch)
    b = (await E.bundles(db, [uid]))[uid]
    with pytest.raises(claude.Unusable):
        await EV.call_model([{"key": "c1", "kind": "skill", "text": "SQL", "must": True}], b)
    return seen


async def probe_tailoring(db, uid, make_client, outbox, monkeypatch):
    from app.autoapply import tailoring
    from app.autoapply.engine import parsed_for

    seen = capture(monkeypatch)
    job = {"_id": "j", "title": "Data Analyst", "description": "SQL reports for our stores", "company": {"name": "Acme"},
           "locations": ["Hyderabad"], "skills": ["SQL"]}  # fmt: skip
    assert await tailoring._ai(db, uid, parsed_for(job), PII_RESUME, {"notice_period": "30_days"}, {}) is None
    return seen


async def probe_regrade(db, uid, make_client, outbox, monkeypatch):
    seen = capture(monkeypatch)
    aid = await v2_attempt(db, uid)
    st = RG.settings_of({})
    assert await RG.regrade_one(db, "v2", await db[SKILL_ATTEMPTS].find_one({"_id": aid}), st, now()) == "agree"
    iv = await v3_interview(db, uid, aid)
    assert await RG.regrade_one(db, "t9", iv, st, now()) == "agree"
    assert await RG.regrade_one(db, "v3", iv, st, now()) == "agree"
    assert {s[0] for s in seen} == {"regrade"} and len(seen) == 3
    return seen


PROBES = {
    "app.hire.vetting.grade": probe_v2,
    "app.hire.vetting.interview": probe_v3,
    "app.trust.honesty.explain": probe_t9,
    "app.trust.spoken.service": probe_t10,
    "app.trust.criteria.evaluate": probe_t7,
    "app.autoapply.tailoring": probe_tailoring,
    "app.trust.fairness.regrade": probe_regrade,
}


def test_blind_registry_covers_every_ai_call_site():
    assert set(B.BLIND) | set(B.NOT_GRADING) == set(SENT), (set(B.BLIND) | set(B.NOT_GRADING)) ^ set(SENT)
    assert not set(B.BLIND) & set(B.NOT_GRADING)
    assert set(PROBES) == set(B.BLIND)  # every grading call site is probed below
    import importlib

    for mod, v in B.BLIND.items():  # the prompt builders named exist
        m = importlib.import_module(mod)
        assert all(callable(getattr(m, b)) for b in v["builders"]), mod


@pytest.mark.parametrize("site", sorted(PROBES))
async def test_no_identifying_data_reaches_any_grading_prompt(site, outbox, db, make_client, monkeypatch):
    c, uid = await pii_person(make_client, outbox, db)
    probe = PROBES[site]
    seen = await (probe(db, uid, make_client, outbox, monkeypatch, c) if site in ("app.hire.vetting.interview", "app.trust.honesty.explain")
                  else probe(db, uid, make_client, outbox, monkeypatch))  # fmt: skip
    texts = [s[2] for s in seen]
    assert texts, site
    for t in texts:
        assert not leaks(t), (site, leaks(t), t[:600])
    # the work itself still reaches the grader
    assert any(re.search(r"SQL|sales report|NULL cities", t) for t in texts), site


def test_anonymiser_unit():
    one = B.anonymiser(NAME, EMAIL, PHONE, ["Osmania University", "Kukatpally"])
    s = B.long_text(one)(PII_TALK + "\nShe is a homemaker, Reddy candidates. Uses MS Excel.")
    assert not leaks(s), s
    assert "MS Excel" in s and "GROUP" not in s and "SQL joins" in s
    # the resume for a prompt: no personal block, no colleges
    br = B.blind_resume(PII_RESUME)
    assert "personal" not in br and all("institution" not in e for e in br["edu"]) and br["edu"][0]["degree"] == "B.Com"
    # the T7 name still works (re-exported)
    from app.trust.criteria import evidence as E

    assert E.anonymiser is B.anonymiser


async def test_switch_off_real_users_grading_prompt_unchanged(outbox, db, make_client, monkeypatch):
    """While the switch is OFF, a real (non-tester) user's V2 / V3 prompts are exactly as before (no blind)."""
    c, uid = await pii_person(make_client, outbox, db, email="real.person@example.com", tester=False)
    seen = capture(monkeypatch)
    meta = await sql_meta(db)
    g = await G.grade_text(db, uid, BY_TEST["SQL"], meta["task"], meta["rubric"], PII_TALK)
    assert g["blind"] is False and "Lakshmi Reddy" in seen[-1][2]
    assert G.prompt(BY_TEST["SQL"], meta["task"], meta["rubric"], PII_TALK, None) == seen[-1][2]
    turns = [{"kind": "experience", "q": "Q?", "looks_for": "x", "answer": PII_TALK}]
    await V3.grade_turns(db, uid, BY_TEST["SQL"], turns, "en")
    assert seen[-1][2] == V3.grade_prompt(BY_TEST["SQL"], turns, "en")
    # turned on for everyone: blind
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": True}}, upsert=True)
    g = await G.grade_text(db, uid, BY_TEST["SQL"], meta["task"], meta["rubric"], PII_TALK)
    assert g["blind"] is True and not leaks(seen[-1][2])


# --- 2. discriminatory filters -----------------------------------------------------------------------------------------

DIRECT = ["Male candidates only", "Girls preferred for the front desk", "Age below 28", "Freshers under 25", "Unmarried only",
          "No married women", "Hindus only", "No disabled persons", "Fair complexion required", "Send your photo with the resume",
          "Local boys only"]  # fmt: skip
PROXY = ["Only from IIT or NIT", "2023 pass-outs only", "Young and energetic team", "Locals only", "Telugu people only",
         "No family commitments", "Physically fit", "Pleasing personality", "Salesgirl needed", "Reddy candidates preferred",
         "Only from a top college", "No career gap"]  # fmt: skip
FINE = ["Attractive salary and incentives", "Both male and female candidates can apply", "Speaks Telugu with customers",
        "Lifts boxes up to 20 kg", "Candidates below 18 years cannot apply", "Maximum 10 years of experience",
        "Deliveries in under 30 minutes", "Equal opportunity employer", "Join within 15 days", "Night shifts, cab provided"]  # fmt: skip


def test_direct_refused_proxies_warned_neutral_text_fine():
    for t in DIRECT:
        fs = F.check_text(t)
        assert F.refused(fs), t
        f = F.refused(fs)[0]
        assert f.why and f.suggest and f.phrase.lower() in t.lower()
    for t in PROXY:
        fs = F.check_text(t)
        assert F.warned(fs) and not F.refused(fs), (t, fs)
        assert all(f.why and f.suggest for f in fs)
    for t in FINE:
        assert F.check_text(t) == [], (t, F.check_text(t))
    # Hire now filters as proxies
    job = {
        "title": "Data analyst",
        "description": "SQL reports. Speaks Telugu with store managers.",
        "locations": ["Hyderabad"],
    }
    assert [f.topic for f in F.hire_filters({"lang": "Tamil"}, job)] == ["language"]
    assert F.hire_filters({"lang": "Telugu"}, job) == []
    assert [f.topic for f in F.hire_filters({"city": "Delhi"}, job)] == ["region"]
    assert (
        F.hire_filters({"city": "Hyderabad"}, job) == []
        and F.hire_filters({"city": "Delhi"}, {**job, "remote": True}) == []
    )


async def tester_company(client, outbox, db, email="founder@gmail.com", site="acme.com", tester=True):
    session, cid = await verified(client, outbox, db, email=email, site=site)
    if tester:
        await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email}}, upsert=True)
    return session, cid


async def test_job_post_and_questions_refuse_direct_warn_proxies_logged(client, outbox, db):
    session, cid = await tester_company(client, outbox, db)
    url = f"/api/company/{cid}/jobs"
    chk = (
        await client.post(
            f"{url}/check",
            json={
                "job": {
                    **JOB,
                    "description": JOB["description"] + " Freshers under 25 preferred. Only from IIT or NIT.",
                }
            },
            headers=H(session),
        )
    ).json()
    topics = {(f["level"], f["topic"]) for f in chk["fairness"]}
    assert ("refuse", "age") in topics and ("warn", "college") in topics
    assert "Freshers under 25" in chk["blocked"]  # the Post button stays off
    f = next(x for x in chk["fairness"] if x["topic"] == "college")
    assert "college" in f["why"].lower() and "skill" in f["suggest"].lower()
    assert await db[TRUST_FAIRNESS_EVENTS].count_documents({"company_id": cid, "action": "shown"}) == 2
    # direct: refused on post (and logged)
    r = await client.post(
        url,
        json={"job": {**JOB, "description": JOB["description"] + " Girls preferred for the front desk."}},
        headers=H(session),
    )
    assert err(r) == "unfair_wording" and r.json()["error"]["fairness"][0]["topic"] == "gender", r.text
    assert (
        await db[TRUST_FAIRNESS_EVENTS].count_documents({"company_id": cid, "action": "refused", "topic": "gender"})
        == 1
    )
    # a proxy in a knock-out question: posted, warned, logged as an override (where = question)
    q = {"text": "Locals only: do you live in Hyderabad?", "kind": "yesno", "want": "yes"}
    r = await client.post(url, json={"job": {**JOB, "questions": [q]}}, headers=H(session))
    assert r.status_code == 201, r.text
    assert [x["topic"] for x in r.json()["fairness"]] == ["region"]
    ev = await db[TRUST_FAIRNESS_EVENTS].find_one({"company_id": cid, "action": "override"})
    assert (
        ev["where"] == "question"
        and ev["topic"] == "region"
        and set(ev) == {"_id", "company_id", "where", "topic", "level", "action", "phrase", "at"}
    )
    # edit with a direct one: refused
    r2 = await client.put(
        f"{url}/{r.json()['id']}",
        json={"job": {**JOB, "description": JOB["description"] + " Unmarried only."}},
        headers=H(session),
    )
    assert err(r2) == "unfair_wording"
    # the live check endpoint and "keep it anyway"
    got = (
        await client.post(
            f"/api/company/{cid}/trust/fairness/check",
            json={"text": "Physically fit, pleasing personality", "where": "criteria"},
            headers=H(session),
        )
    ).json()
    assert {f["topic"] for f in got["findings"]} == {"disability", "looks"} and got["refused"] is False
    a = await client.post(
        f"/api/company/{cid}/trust/fairness/ack",
        json={"where": "hire_filter", "findings": [{"topic": "language", "level": "warn", "phrase": "Speaks Tamil"}]},
        headers=H(session),
    )
    assert a.json() == {"logged": 1}


async def test_criteria_refuse_direct_warn_proxies(client, outbox, db):
    session, cid = await tester_company(client, outbox, db)
    jid = (await client.post(f"/api/company/{cid}/jobs", json={"job": JOB}, headers=H(session))).json()["id"]
    url = f"/api/company/{cid}/trust/criteria/{jid}"
    r = await client.put(
        url, json={"items": [{"kind": "other", "text": "Freshers under 25 only", "must": True}]}, headers=H(session)
    )
    assert err(r) == "unfair" and "experience" in r.json()["error"]["message"].lower(), r.text
    r = await client.put(
        url,
        json={
            "items": [
                {"kind": "skill", "text": "SQL reports", "must": True},
                {"kind": "other", "text": "No family commitments", "must": False},
            ]
        },
        headers=H(session),
    )
    assert r.status_code == 200, r.text
    assert [f["topic"] for f in r.json()["fairness"]] == ["marital"]
    assert (
        await db[TRUST_FAIRNESS_EVENTS].count_documents({"company_id": cid, "where": "criteria", "action": "override"})
        == 1
    )
    assert (
        await db[TRUST_FAIRNESS_EVENTS].count_documents({"company_id": cid, "where": "criteria", "action": "refused"})
        == 1
    )


async def test_hire_now_filters_warned(client, outbox, db):
    session, cid = await tester_company(client, outbox, db)
    jid = (
        await client.post(
            f"/api/company/{cid}/jobs",
            json={"job": {**JOB, "description": JOB["description"] + " Speaks Telugu with store managers."}},
            headers=H(session),
        )
    ).json()["id"]

    async def get(**q):
        r = await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": jid, **q}, headers=H(session))
        assert r.status_code == 200, r.text
        return r.json()

    assert (await get())["nonTech"]["fairness"] == []
    assert (await get(lang="Telugu"))["nonTech"]["fairness"] == []
    out = await get(lang="Tamil", city="Delhi")
    assert {f["topic"] for f in out["nonTech"]["fairness"]} == {"language", "region"}
    assert (
        await db[TRUST_FAIRNESS_EVENTS].count_documents({"company_id": cid, "where": "hire_filter", "action": "shown"})
        == 2
    )


# --- 3. re-grades ------------------------------------------------------------------------------------------------------


async def bulk_people(db, n, prefix="p", city="Hyderabad", lang="en"):
    uids = []
    docs = []
    for i in range(n):
        uid = f"{prefix}{i}"
        uids.append(uid)
        docs.append({"_id": uid, "name": f"Person {prefix}{i}", "email": f"{prefix}{i}@example.com", "email_lc": f"{prefix}{i}@example.com",
                     "simple": {"lang": lang}})  # fmt: skip
    await db[USERS].insert_many(docs)
    await db[HIRE_PROFILES].insert_many([{"_id": u, "cities": [city], "on": True, "consent_at": now()} for u in uids])
    return uids


async def test_regrade_samples_about_5_percent_with_caps_and_never_changes_a_grade(db, monkeypatch, admin_client):
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": True}}, upsert=True)
    uids = await bulk_people(db, 300)
    for u in uids:
        await v2_attempt(db, u, answer="I joined orders and customers with SQL and grouped by city for the owner.")
    capture(monkeypatch, v2_score=1)  # the second reviewer disagrees strongly: 20 vs 80
    got = await RG.run(db, rng=random.Random(12), force=True)
    assert got["pool"] == 300 and 5 <= got["picked"] <= 30, got  # ~5% (15)
    assert got["review"] == got["picked"] and got["agree"] == 0
    rows = await db[TRUST_REGRADES].find({}).to_list(100)
    assert len(rows) == got["picked"] and all(
        r["material"] and r["status"] == "review" and r["first"] == 80 and r["second"] == 20 for r in rows
    )
    # never silently changed: the grade stays; a person grades it in the Review queue
    for r in rows:
        a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(r["ref"])})
        assert a["task"]["score"] == 80 and a["task"]["status"] == "graded"
        q = await db[VETTING_QUEUE].find_one({"kind": "review", "attempt_id": a["_id"], "status": "open"})
        assert q["data"]["why"] == "regrade" and q["data"]["second"] == 20
    # an alert for the role: enough re-grades and most disagree
    al = await RG.alerts(db)
    assert [(a["kind"], a["key"], a["alert"]) for a in al] == [("v2", "SQL", True)]
    # the weekly cap: Admin sets 5 a week, already used → nothing more this week
    await db["settings"].update_one(
        {"_id": "site"},
        {"$set": {"trust.fairness.regrade": {"sample": 20, "cap": 5, "gap": 15, "alert_share": 25, "alert_min": 5}}},
    )
    got2 = await RG.run(db, rng=random.Random(3), force=True)
    assert got2["picked"] == 0
    # a new week: at most 5, even at 20%
    await db[TRUST_RUNS].update_one({"_id": "fairness_regrade"}, {"$set": {"week_start": now() - timedelta(days=8)}})
    got3 = await RG.run(db, rng=random.Random(3), force=True)
    assert got3["picked"] == 5
    # not due again within the week (the automation pass)
    assert await RG.run(db) == {}
    # agreement: no review
    capture(monkeypatch, v2_score=4)
    await db[TRUST_RUNS].update_one({"_id": "fairness_regrade"}, {"$set": {"week_start": now() - timedelta(days=8)}})
    got4 = await RG.run(db, rng=random.Random(5), force=True)
    assert got4["agree"] == got4["picked"] > 0 and got4["review"] == 0


def test_material_rules():
    assert RG.material_v2(80, 64, 15) and not RG.material_v2(80, 70, 15)
    assert RG.material_v2(62, 58, 15)  # across the pass mark (60)
    a = [{"key": k, "score": 4} for k, *_ in V3.CRITERIA]
    assert RG.material_v3(a, [{"key": k, "score": 5} for k, *_ in V3.CRITERIA]) == (1, False)
    assert RG.material_v3(a, [{"key": k, "score": 3} for k, *_ in V3.CRITERIA]) == (
        1,
        True,
    )  # 3.0 is under the 3.2 pass
    assert RG.material_v3(a, [{"key": k, "score": 2} for k, *_ in V3.CRITERIA])[1] is True
    assert (
        RG.material_t9("strong", "weak")[1]
        and RG.material_t9("partial", "weak")[1]
        and not RG.material_t9("strong", "partial")[1]
    )
    assert RG.material_t9("weak", "not_answered") == (1, False)
    rng = random.Random(1)
    pool = [("v2", {"user_id": str(i)}) for i in range(2000)]
    assert 70 <= len(RG.pick(pool, 5, 1000, rng)) <= 130 and len(RG.pick(pool, 5, 7, rng)) == 7


async def test_regrade_v3_and_t9_go_to_a_person_and_admin_decides(db, monkeypatch, admin_client):
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": True}}, upsert=True)
    [uid] = await bulk_people(db, 1, "iv")
    aid = await v2_attempt(db, uid)
    await db[SKILL_ATTEMPTS].update_one({"_id": aid}, {"$unset": {"task.model": ""}})  # this one is not in the pool
    iv = await v3_interview(db, uid, aid, explain_label="strong")
    capture(monkeypatch, v3_score=1, label="weak")
    st = RG.settings_of({})
    assert await RG.regrade_one(db, "v3", iv, st, now()) == "review"
    doc = await db[VETTING_INTERVIEWS].find_one({"_id": iv["_id"]})
    assert (
        doc["bias"]["alert"] is True and doc["bias"]["by"] == "t12" and doc["passed"] is True
    )  # the existing Bias checks queue; grade unchanged
    assert await RG.regrade_one(db, "t9", iv, st, now()) == "review"
    adm = await admin_client()
    d = (await adm.get("/api/admin/trust/fairness")).json()
    t9 = next(x for x in d["regrade"]["review"] if x["kind"] == "t9")
    assert t9["first"] == "strong" and t9["second"] == "weak" and t9["open"] is True
    assert "Lakshmi" not in json.dumps(d) and uid not in json.dumps(d["regrade"]["review"])  # no person's details
    assert (await db[VETTING_INTERVIEWS].find_one({"_id": iv["_id"]}))["explain"]["label"] == "strong"  # not by itself
    r = await adm.post(f"/api/admin/trust/fairness/regrades/{t9['id']}/decide", json={"decision": "second"})
    assert r.status_code == 200, r.text
    e = (await db[VETTING_INTERVIEWS].find_one({"_id": iv["_id"]}))["explain"]
    assert e["label"] == "weak" and e["by"] == "admin" and e["first_label"] == "strong"
    assert await db[AUDIT_LOG].find_one({"action": "trust.fairness_regrade_decide"})
    # the old weekly check skips an interview T12 already re-graded
    assert await V3.bias_check(db, random.Random(1)) == 0


async def test_regrade_switch_off_only_testers_sampled(db, monkeypatch):
    real = await bulk_people(db, 50, "real")
    testers = await bulk_people(db, 3, "tst")
    await db["settings"].update_one(
        {"_id": "site"},
        {"$set": {"trust.public": False, "trust.testers": [f"{u}@example.com" for u in testers]}},
        upsert=True,
    )
    for u in real + testers:
        await v2_attempt(db, u, answer="I joined orders and customers with SQL and grouped by city for the owner.")
    capture(monkeypatch)
    got = await RG.run(db, rng=random.Random(1), force=True)
    assert got["pool"] == 3
    assert not await db[TRUST_REGRADES].find_one({"user_id": {"$in": real}})


# --- 4. pass-rate gaps -------------------------------------------------------------------------------------------------


async def test_pass_rate_gaps_four_fifths_min_sample_aggregated_only(db, admin_client):
    t = now() - timedelta(days=2)
    hyd = await bulk_people(db, 40, "h", city="Hyderabad")
    pat = await bulk_people(db, 40, "b", city="Patna")
    few = await bulk_people(db, 5, "g", city="Guwahati")
    rows = []
    for i, u in enumerate(hyd):
        rows.append(
            {"v": 2, "user_id": u, "skill": "SQL", "submitted_at": t, "score": 80 if i < 30 else 40, "lang": "en"}
        )  # 75%
    for i, u in enumerate(pat):
        rows.append(
            {"v": 2, "user_id": u, "skill": "SQL", "submitted_at": t, "score": 80 if i < 16 else 40, "lang": "hi"}
        )  # 40%
    for u in few:
        rows.append({"v": 2, "user_id": u, "skill": "SQL", "submitted_at": t, "score": 20, "lang": "en"})
    await db[SKILL_ATTEMPTS].insert_many(rows)
    rep = await RP.compute(db)
    skill = next(m for m in rep["metrics"] if m["key"] == "skill")
    tier = {g["group"]: g for g in skill["dimensions"]["tier"]}
    assert tier["Tier 1"]["rate"] == 75 and not tier["Tier 1"]["flag"]
    assert tier["Tier 2"]["rate"] == 40 and tier["Tier 2"]["flag"] and "80%" in tier["Tier 2"]["why"]  # Patna: tier 2
    assert tier["Tier 3"] == {"group": "Tier 3", "small": True, "flag": False}  # 5 people: no numbers at all
    region = {g["group"]: g for g in skill["dimensions"]["region"]}
    assert region["East"]["flag"] and region["South"]["rate"] == 75 and region["North-East"]["small"]
    lang = {g["group"]: g for g in skill["dimensions"]["language"]}
    assert lang["Hindi"]["flag"] and not lang["English"]["flag"]
    assert {(f["metric"], f["dimension"], f["group"]) for f in rep["flags"]} == {
        ("skill", "tier", "Tier 2"),
        ("skill", "region", "East"),
        ("skill", "language", "Hindi"),
    }
    # the four-fifths rule exactly: 60 vs 75 is 0.8 → not flagged
    assert (
        not RP.gaps({"a": [100, 75], "b": [100, 60]}, 30)[1]["flag"]
        and RP.gaps({"a": [100, 75], "b": [100, 59]}, 30)[1]["flag"]
    )
    assert RP.gaps({"a": [100, 75], "b": [20, 0]}, 30)[1] == {"group": "b", "small": True, "flag": False}
    # Admin: the weekly snapshot and the card never carry a person
    adm = await admin_client()
    r = await adm.post("/api/admin/trust/fairness/report/run")
    assert r.status_code == 200, r.text
    d = r.json()
    blob = json.dumps(d)
    for u in hyd[:3] + pat[:3] + few:
        assert f'"{u}"' not in blob
    assert "Person " not in blob and "@example.com" not in blob
    assert d["report"]["snapshot"]["flags"] and await db[TRUST_FAIRNESS].count_documents({}) == 1
    assert await RP.weekly_if_due(db) == 0  # this week's snapshot exists


def test_regions_and_tiers():
    assert RP.region_of("Hyderabad") == "South" and RP.region_of("Kukatpally, Hyderabad") == "South"
    assert (
        RP.region_of("Patna, Bihar") == "East"
        and RP.region_of("") == "Not given"
        and RP.region_of("Atlantis") == "Other / not known"
    )
    assert (
        RP.tier_of("Pune") == "Tier 1"
        and RP.tier_of("Guntur") == "Tier 2"
        and RP.tier_of("Ongole") == "Tier 3"
        and RP.tier_of(None) == "Not given"
    )


# --- 5. Admin card, settings, switch OFF -------------------------------------------------------------------------------


async def test_admin_card_settings_bounds_audited(db, admin_client):
    adm = await admin_client()
    d = (await adm.get("/api/admin/trust/fairness")).json()
    assert d["regrade"]["settings"] == RG.DEFAULTS and d["report"]["settings"] == RP.DEFAULTS
    assert {b["site"] for b in d["blind"]} == set(B.BLIND)
    body = {
        "regrade": {"sample": 10, "cap": 30, "gap": 20, "alertShare": 30, "alertMin": 8},
        "report": {"minN": 50, "days": 60},
    }
    r = await adm.put("/api/admin/trust/fairness", json=body)
    assert (
        r.status_code == 200
        and r.json()["regrade"]["settings"]["alert_share"] == 30
        and r.json()["report"]["settings"]["min_n"] == 50
    )
    assert await db[AUDIT_LOG].find_one({"action": "trust.fairness_settings"})
    bad = await adm.put("/api/admin/trust/fairness", json={**body, "regrade": {**body["regrade"], "sample": 50}})
    assert bad.status_code in (400, 422)


async def test_switch_off_companies_see_nothing_new(client, outbox, db):
    session, cid = await tester_company(client, outbox, db, tester=False)
    url = f"/api/company/{cid}/jobs"
    chk = (
        await client.post(
            f"{url}/check",
            json={"job": {**JOB, "description": JOB["description"] + " Only from IIT or NIT. Locals only."}},
            headers=H(session),
        )
    ).json()
    assert "fairness" not in chk and chk["blocked"] == []
    r = await client.post(
        url, json={"job": {**JOB, "description": JOB["description"] + " Only from IIT or NIT."}}, headers=H(session)
    )
    assert r.status_code == 201 and "fairness" not in r.json()
    out = (
        await client.get(
            f"/api/company/{cid}/hire/shortlist", params={"job": r.json()["id"], "lang": "Tamil"}, headers=H(session)
        )
    ).json()
    assert "nonTech" not in out
    assert (
        await client.post(f"/api/company/{cid}/trust/fairness/check", json={"text": "Locals only"}, headers=H(session))
    ).status_code == 404
    assert await db[TRUST_FAIRNESS_EVENTS].count_documents({}) == 0
