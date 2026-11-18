# ruff: noqa: E501
"""Vetting Trust T9: "Explain your answer" (interview questions generated from the candidate's own practical task by the
AI with an exact quote, or a rules template citing a sentence of it; anonymised prompts; counted in the AI allowance;
graded strong / partial / weak / not answered with a reason, separately from the rubric; weak → a T8 signal, never a
rejection; the company sees the plain label), the honesty pledge (required to start a skill check, a practical task
and the interview; recorded with version, time and language; in the evidence view), visible retake limits that match
what the server enforces (cooldown boundaries, Admin numbers within bounds, the refresher gap), and switch OFF
isolation (people Vetting Trust is off for get exactly the old flows)."""

import re
from datetime import timedelta

import pytest
from bson import ObjectId

from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import AI_USAGE, AUDIT_LOG, SKILL_ATTEMPTS, TRUST_FACE, USERS, VETTING_INTERVIEWS, VETTING_VERIFIED
from app.core.time import now
from app.hire.vetting import interview as V3
from app.trust.honesty import explain as X
from app.trust.honesty import pledge as PL
from app.trust.honesty import retake as RK
from app.trust.integrity import service as S
from tests.conftest import signup
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_vetting import _paper, _right, _slow

SK = "/api/me/skill-checks"
IV = "/api/me/interviews"
TASK = ("I am Asha Rao from Osmania University College, mail asha.t9@example.com, phone 9876543210. "
        "SELECT c.city, SUM(o.amount) FROM orders o JOIN customers c ON c.id = o.customer_id GROUP BY c.city. "
        "I join on the key, filter the month and group by city so the owner sees sales per city. "
        "Before sharing I would check NULL cities and refunds.")  # fmt: skip
LONG = "I built a monthly sales report for a shop with SQL joins on orders and customers and shared it every Monday."


@pytest.fixture(autouse=True)
def vetting_public(monkeypatch):
    """The vetting engine itself is public here; Vetting Trust (the T9 features) is still per person."""
    from app.hire.vetting import access

    async def public(db):
        return {"public": True, "testers": []}

    monkeypatch.setattr(access, "settings", public)


async def person(make_client, outbox, db, email, name="Asha Rao", tester=True):
    c = make_client()
    me = await signup(c, outbox, email=email, name=name)
    if tester:
        await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email.lower()}}, upsert=True)
        await db[TRUST_FACE].insert_one({"_id": me["id"], "status": "verified"})  # the T3 check is done
    return c, me["id"]


async def badge(db, uid, test="SQL", answer=TASK, days=0, task_type="tech"):
    """A V2 attempt with a practical task answer and the badge it earned."""
    t = now() - timedelta(days=days)
    aid = ObjectId()
    await db[SKILL_ATTEMPTS].insert_one({"_id": aid, "v": 2, "user_id": uid, "skill": test, "kind": "full", "started_at": t, "last_seen": t, "submitted_at": t,
                                         "score": 80, "task": {"status": "graded", "type": task_type, "answer": answer, "score": 80, "submitted_at": t}})  # fmt: skip
    await db[VETTING_VERIFIED].insert_one({"user_id": uid, "test": test, "band": "1-3", "score": 80, "task_score": 80, "at": t,
                                           "expires_at": t + timedelta(days=90), "attempt_id": aid})  # fmt: skip
    return aid


def fake_claude(monkeypatch, question=None, label="weak", fail_questions=False):
    """Every Claude call (explain questions / explain check / interview follow-up / interview grade), recorded."""
    seen = []
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")

    async def fake(feature, content, schema, check, *, stats=None, **opts):
        text = content[0]["text"]
        seen.append((feature, schema, text))
        if feature == "explain" and schema is X.SCHEMA:
            if fail_questions:
                raise claude.Unusable("no_valid_question")
            return check({"questions": [question or {"question": "You wrote that you join on the key and filter the month: why that order, and what would change for refunds?",
                                                     "quote": "I join on the key, filter the month"}]})  # fmt: skip
        if feature == "explain":
            ids = re.findall(r"<<<(explain\d)", text)
            return check(
                {
                    "results": [
                        {
                            "id": i,
                            "label": label,
                            "reason": "Said a LEFT JOIN was used, but the task used an inner JOIN.",
                            "quote": "left join",
                        }
                        for i in ids
                    ]
                }
            )
        if schema is V3.FOLLOW_SCHEMA:
            return check({"ask": False, "follow_up": ""})
        return check({"scores": [{"key": k, "score": 4, "reason": "Specific.", "quote": "monthly sales report"} for k, *_ in V3.CRITERIA],
                      "strengths": ["a", "b", "c"], "concern": "None."})  # fmt: skip

    monkeypatch.setattr(claude, "ask_models", fake)
    return seen


async def answer_all(c, iv, text=LONG, explain_text=None):
    while iv["status"] == "running":
        q = iv["asking"]["q"]
        t = explain_text if explain_text is not None and ("task" in q or "टास्क" in q) else text
        iv = (await c.post(f"{IV}/{iv['id']}/answer", json={"text": t, "seconds": 30})).json()
    return iv


# --- pure rules ---------------------------------------------------------------------------------------------------------


def test_window_rule_boundaries_and_engine_default():
    t = now()
    d = timedelta(days=1)
    # the default (1 every 30 days) is the old rule: open again exactly 30 days after the last start
    w = RK.window([t - 10 * d], t, 1, 30)
    assert not w["allowed"] and w["used"] == 1 and w["nextAt"] == t + 20 * d
    assert RK.window([t - 30 * d], t, 1, 30)["allowed"]  # the boundary: exactly 30 days later is open
    assert not RK.window([t - 30 * d + timedelta(seconds=1)], t, 1, 30)["allowed"]
    # 2 every 30 days: the second is open; the third waits for the oldest of the two
    assert RK.window([t - 5 * d], t, 2, 30)["allowed"]
    w = RK.window([t - 5 * d, t - 20 * d, t - 40 * d], t, 2, 30)
    assert not w["allowed"] and w["used"] == 2 and w["nextAt"] == t + 10 * d
    # Admin lowered the limit below what was already used: open when enough have aged out
    w = RK.window([t - d, t - 2 * d, t - 3 * d], t, 1, 30)
    assert w["nextAt"] == t + 29 * d
    assert RK.engine_rule("skill") == (1, 30) and RK.engine_rule("interview") == (1, 30)
    # Admin numbers are clamped to their bounds
    s = RK.settings_of(
        {"trust": {"honesty": {"skill_attempts": 9, "skill_days": 1, "refresh_days": 99, "explain_questions": 0}}}
    )
    assert s["skill_attempts"] == 3 and s["skill_days"] == 7 and s["refresh_days"] == 30 and s["explain_questions"] == 1


def test_explain_rules_questions_grading_and_schemas():
    assert claude.schema_problems(X.SCHEMA) == [] and claude.schema_problems(X.GRADE_SCHEMA) == []
    text = (
        "Short line. I join on the key, filter the month and group by city so the owner sees sales per city. Ok then."
    )
    q = X.rules_questions(text, "en", 1)[0]
    assert (
        q["source"] == "rules"
        and "I join on the key, filter the month" in q["question"]
        and q["question"].endswith("?")
    )
    hi = X.rules_questions(text, "hi", 2)
    assert (
        "टास्क" in hi[0]["question"] and len(hi) == 1
    )  # only one sentence long enough: one question, not a made-up second
    te = X.rules_questions(text, "te", 1)[0]
    assert "టాస్క్" in te["question"]
    # an AI question must quote the answer word for word, and never a removed personal detail
    check = X.check_questions("I join on the key, filter the month.", 2)
    assert (
        check({"questions": [{"question": "Why join on the key?", "quote": "join on the key"}]})[0]["quote"]
        == "join on the key"
    )
    with pytest.raises(claude.Unusable):
        check(
            {"questions": [{"question": "Why use a LEFT JOIN here?", "quote": "LEFT JOIN on orders"}]}
        )  # not in their answer
    with pytest.raises(claude.Unusable):
        check({"questions": [{"question": "Tell me about it", "quote": "join on the key"}]})  # not a question
    # rules grading: never "strong"
    sub = "I join on the key, filter the month and group by city"
    assert X.rules_label("", sub)[0] == "not_answered" and X.rules_label("ok sure", sub)[0] == "not_answered"
    assert (
        X.rules_label(
            "Because grouping by city gives the owner one number per city and the month filter keeps it current", sub
        )[0]
        == "partial"
    )
    assert X.rules_label("I like football and cricket on weekends very much", sub)[0] == "weak"
    assert (
        X.rules_label("मैंने शहर के हिसाब से जोड़ा ताकि मालिक को हर शहर की बिक्री दिखे", sub)[0] == "partial"
    )  # another script: can't compare
    assert X.combine([{"label": "strong"}, {"label": "partial"}]) == "strong"
    assert X.combine([{"label": "weak"}, {"label": "partial"}]) == "weak"
    assert X.combine([{"label": "partial"}]) == "partial"
    assert X.combine([{"label": "not_answered"}, {"label": "not_answered"}]) == "not_answered"
    assert X.out({"label": "weak", "reason": "r"})["label"] == "Explained own work: Weak"
    assert X.insert([{"id": 1}, {"id": 2}, {"id": 3}], [{"id": "e"}]) == [{"id": 1}, {"id": 2}, {"id": "e"}, {"id": 3}]


# --- the pledge ---------------------------------------------------------------------------------------------------------


async def test_pledge_required_recorded_versioned_for_test_and_task(outbox, db, make_client, admin_client):
    c, uid = await person(make_client, outbox, db, "asha@example.com")
    await c.post(f"{SK}/consent")
    d = (await c.get("/api/me/trust/honesty")).json()
    assert d["pledge"]["version"] == PL.VERSION and set(d["pledge"]["text"]) == {"en", "hi", "te"}
    assert (
        "without help from other people or AI tools" in d["pledge"]["text"]["en"]
        and "Nothing is decided automatically" in d["pledge"]["text"]["en"]
    )
    r = await _paper(c)
    assert err(r) == "pledge" and r.json()["error"]["pledge"]["version"] == PL.VERSION  # the page gets the text to show
    assert err(await _paper(c, pledge=PL.VERSION + 5)) == "pledge"  # an old / unknown version: shown again
    p = (await _paper(c, pledge=PL.VERSION)).json()
    a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(p["id"])})
    assert (
        a["pledge"]["version"] == PL.VERSION
        and a["pledge"]["lang"] == "en"
        and abs((a["pledge"]["at"] - now()).total_seconds()) < 60
    )
    r = (await c.post(f"{SK}/{p['id']}/submit", json={"answers": await _right(db, p), "times": _slow(p)})).json()
    assert r["pass"]
    assert err(await c.post(f"{SK}/{p['id']}/task/start")) == "pledge"
    assert err(await c.post(f"{SK}/{p['id']}/task/start", json={})) == "pledge"
    t = (await c.post(f"{SK}/{p['id']}/task/start", json={"pledge": PL.VERSION})).json()
    assert t["title"]
    assert (await c.post(f"{SK}/{p['id']}/task/start")).status_code == 200  # reopening a started task asks nothing more
    a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(p["id"])})
    assert a["task"]["pledge"]["version"] == PL.VERSION
    res = (await c.get(f"{SK}/{p['id']}")).json()
    assert res["pledge"]["version"] == PL.VERSION and res["taskPledge"]["version"] == PL.VERSION
    # the evidence view (reviewers) lists both, with version and time
    owner = await admin_client()
    ev = (await owner.get(f"/api/admin/trust/integrity/{uid}")).json()
    whats = [x["what"] for x in ev["pledges"]]
    assert (
        "Skill check: SQL" in whats
        and "Practical task: SQL" in whats
        and all(x["version"] == PL.VERSION and x["at"] for x in ev["pledges"])
    )


# --- retake limits ------------------------------------------------------------------------------------------------------


async def test_limits_shown_match_the_server_admin_numbers_and_the_refresher_gap(outbox, db, make_client, admin_client):
    c, uid = await person(make_client, outbox, db, "ravi@example.com", "Ravi K")
    await c.post(f"{SK}/consent")
    p = (await _paper(c, skill="Excel", pledge=PL.VERSION)).json()
    await c.post(f"{SK}/{p['id']}/submit", json={"answers": {}, "times": _slow(p)})
    cat = (await c.get(SK)).json()
    role = next(r for r in cat["roles"] if r["test"] == "Excel")
    rk = role["retake"]
    assert (
        rk["attempts"] == 1
        and rk["days"] == 30
        and rk["used"] == 1
        and rk["left"] == 0
        and not rk["canStart"]
        and not role["canStart"]
    )
    assert "latest passed attempt" in rk["counts"] and rk["rule"] == "1 attempt every 30 days"
    r = await _paper(c, skill="Excel", pledge=PL.VERSION)
    assert (
        err(r) == "too_soon" and r.json()["error"]["againAt"] == rk["nextAt"] == role["last"]["againAt"]
    )  # shown = enforced
    assert (await c.get("/api/me/trust/honesty", params={"kind": "skill", "test": "Excel"})).json()["retake"][
        "nextAt"
    ] == rk["nextAt"]
    res = (await c.get(f"{SK}/{p['id']}")).json()
    assert res["retake"]["nextAt"] == rk["nextAt"] and res["againAt"] == rk["nextAt"] and not res["canRetry"]

    # Admin: 2 attempts every 30 days (within bounds; out of bounds refused; audited)
    owner = await admin_client()
    assert (await owner.put("/api/admin/trust/honesty", json={"skillAttempts": 5})).status_code == 422
    assert (await owner.put("/api/admin/trust/honesty", json={"skillDays": 3})).status_code == 422
    s = (await owner.put("/api/admin/trust/honesty", json={"skillAttempts": 2, "skillDays": 30, "interviewAttempts": 1, "interviewDays": 30,
                                                         "refreshDays": 7, "explainOn": True, "explainQuestions": 1})).json()  # fmt: skip
    assert s["skillAttempts"] == 2 and s["bounds"]["attempts"] == [1, 3]
    assert await db[AUDIT_LOG].count_documents({"action": "trust.honesty_settings"}) == 1
    role = next(r for r in (await c.get(SK)).json()["roles"] if r["test"] == "Excel")
    assert role["canStart"] and role["retake"]["left"] == 1 and role["retake"]["nextAt"] is None
    p2 = (await _paper(c, skill="Excel", pledge=PL.VERSION)).json()
    await c.post(f"{SK}/{p2['id']}/submit", json={"answers": {}, "times": _slow(p2)})
    role = next(r for r in (await c.get(SK)).json()["roles"] if r["test"] == "Excel")
    r = await _paper(c, skill="Excel", pledge=PL.VERSION)
    assert err(r) == "too_soon" and r.json()["error"]["againAt"] == role["retake"]["nextAt"]
    first = (await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(p["id"])}))["started_at"]
    assert (
        abs(role["retake"]["nextAt"] - int((first + timedelta(days=30)).timestamp() * 1000)) < 1000
    )  # the oldest of the two + 30 days
    # the cooldown boundary: exactly 30 days after the oldest start, one attempt is open again
    await db[SKILL_ATTEMPTS].update_one(
        {"_id": ObjectId(p["id"])}, {"$set": {"started_at": now() - timedelta(days=30, seconds=1)}}
    )
    assert (await _paper(c, skill="Excel", pledge=PL.VERSION)).status_code == 200

    # the V5 refresher could be retried at once after a fail; for Trust people it now waits refreshDays
    await badge(db, uid, test="SQL", days=80)
    r1 = (await c.post(f"{SK}/start", json={"skill": "SQL", "refresh": True, "pledge": PL.VERSION})).json()
    await c.post(f"{SK}/{r1['id']}/submit", json={"answers": {}, "times": _slow(r1)})  # not renewed
    r = await c.post(f"{SK}/start", json={"skill": "SQL", "refresh": True, "pledge": PL.VERSION})
    assert err(r) == "too_soon" and "refresher" in r.json()["error"]["message"]
    await db[SKILL_ATTEMPTS].update_one(
        {"_id": ObjectId(r1["id"])}, {"$set": {"started_at": now() - timedelta(days=7)}}
    )
    assert (
        await c.post(f"{SK}/start", json={"skill": "SQL", "refresh": True, "pledge": PL.VERSION})
    ).status_code == 200


async def test_interview_limits_and_pledge(outbox, db, make_client, admin_client):
    c, uid = await person(make_client, outbox, db, "meena@example.com", "Meena S")
    await badge(db, uid, test="SQL", answer="")  # no task answer: no explain questions
    assert err(await c.post(f"{IV}/start", json={"test": "SQL", "consent": True})) == "pledge"
    iv = (await c.post(f"{IV}/start", json={"test": "SQL", "consent": True, "pledge": PL.VERSION})).json()
    assert iv["asking"]["of"] == 7  # nothing to explain without a written / spoken task
    assert (await c.post(f"{IV}/start", json={"test": "SQL", "consent": True})).json()["id"] == iv[
        "id"
    ]  # carrying on: no new pledge
    doc = await db[VETTING_INTERVIEWS].find_one({"_id": ObjectId(iv["id"])})
    assert doc["pledge"]["version"] == PL.VERSION
    iv = await answer_all(c, iv)
    await c.post(f"{IV}/{iv['id']}/finish")
    d = (await c.get(f"{IV}/roles")).json()
    rk = d["roles"][0]["retake"]
    assert not d["roles"][0]["canStart"] and rk["used"] == 1 and "latest passed interview" in rk["counts"]
    r = await c.post(f"{IV}/start", json={"test": "SQL", "consent": True, "pledge": PL.VERSION})
    assert err(r) == "too_soon" and r.json()["error"]["againAt"] == rk["nextAt"]
    res = (await c.get(f"{IV}/{iv['id']}")).json()
    assert res["retake"]["nextAt"] == rk["nextAt"] and res["pledge"]["version"] == PL.VERSION
    await db[VETTING_INTERVIEWS].update_one(
        {"_id": ObjectId(iv["id"])}, {"$set": {"started_at": now() - timedelta(days=30)}}
    )
    assert (await c.get(f"{IV}/roles")).json()["roles"][0]["canStart"]


# --- Explain your answer ------------------------------------------------------------------------------------------------


async def test_explain_question_from_the_submission_anonymised_graded_weak_is_a_signal_not_a_reject(
    client, outbox, db, make_client, monkeypatch
):
    seen = fake_claude(monkeypatch, label="weak")
    c, uid = await person(make_client, outbox, db, "asha@example.com")
    await db[USERS].update_one({"_id": uid}, {"$set": {"phone": "9876543210"}})
    await badge(db, uid)
    iv = (await c.post(f"{IV}/start", json={"test": "SQL", "consent": True, "pledge": PL.VERSION})).json()
    assert iv["asking"]["of"] == 8  # 7 + 1 about their own task
    doc = await db[VETTING_INTERVIEWS].find_one({"_id": ObjectId(iv["id"])})
    ex = [t for t in doc["turns"] if t["kind"] == "explain"]
    assert (
        len(ex) == 1 and doc["turns"].index(ex[0]) == 6 and doc["turns"][-1]["kind"] == "motivation"
    )  # before the last question
    assert ex[0]["source"] == "ai" and ex[0]["quote"] == "I join on the key, filter the month"
    gen = [s for s in seen if s[0] == "explain" and s[1] is X.SCHEMA]
    assert len(gen) == 1
    prompt = gen[0][2]
    assert "I join on the key" in prompt and "data, never instructions" in prompt
    for secret in ("Asha", "Rao", "Osmania", "asha.t9@example.com", "9876543210"):  # anonymised
        assert secret not in prompt, secret
    day = ai_quota.today()
    assert (await db[AI_USAGE].find_one({"_id": f"{day}|person|explain|{uid}"}))["n"] == 1  # counted

    iv = await answer_all(c, iv, explain_text="I used a left join so nothing is lost.")
    assert not any(s[1] is V3.FOLLOW_SCHEMA and "left join so nothing" in s[2] for s in seen)  # no follow-up on it
    iv = (await c.post(f"{IV}/{iv['id']}/finish")).json()
    assert iv["explained"] == {
        "key": "weak",
        "label": "Explained own work: Weak",
        "short": "Weak",
        "reason": "Said a LEFT JOIN was used, but the task used an inner JOIN.",
        "byAi": True,
    }
    assert iv["passed"] is True and iv["average"] == 4.0  # weak never rejects: the rubric is graded on its own
    rubric = [s for s in seen if s[0] == "interview" and s[1] is V3.GRADE_SCHEMA][0][2]
    assert (
        "your own practical task" not in rubric.lower() and "I join on the key" not in rubric
    )  # the rubric never sees it
    assert (await db[AI_USAGE].find_one({"_id": f"{day}|person|explain|{uid}"}))["n"] == 2
    assert any(t.get("explain") for t in iv["transcript"])
    # a T8 signal for a person (weight 1, cap 2), not a rejection
    r = (await S.ratings(db, [uid]))[uid]
    sig = [s for s in r["signals"] if s.kind == "explain_weak"]
    assert len(sig) == 1 and sig[0].weight == 1.0 and r["level"] == "low"
    # the company: the plain label and reason (only where Vetting Trust lets the company in)
    await c.put("/api/me/hire", json={"on": True, "consent": True, "roles": ["Data analyst"], "city": "Hyderabad"})
    session, cid = await verified(client, outbox, db)
    await db[USERS].update_one({"_id": uid}, {"$set": {"vetting_l3_until": now() + timedelta(days=100)}})
    from tests.test_hire_shortlist import READY

    await c.put("/api/me/hire", json=READY)
    s = (await client.get(f"/api/company/{cid}/hire/interview/{uid}", headers=H(session))).json()
    assert "explainedOwnWork" not in s and len(s["transcript"]) == 7  # the switch is off for this company: as before
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "founder@gmail.com"}})
    s = (await client.get(f"/api/company/{cid}/hire/interview/{uid}", headers=H(session))).json()
    assert (
        s["explainedOwnWork"]["label"] == "Explained own work: Weak" and "inner JOIN" in s["explainedOwnWork"]["reason"]
    )
    assert "integrity" not in str(s).lower() and "signal" not in str(s).lower()


async def test_rules_fallback_question_in_hindi_voice_and_rules_grading(outbox, db, make_client, monkeypatch):
    c, uid = await person(make_client, outbox, db, "kiran@example.com", "Kiran P")
    spoken = "First I greet the customer and ask what they need. Then I show two phones in their budget and explain the battery and camera."
    await badge(db, uid, test="Sales", answer=spoken, task_type="voice")
    iv = (
        await c.post(
            f"{IV}/start", json={"test": "Sales", "consent": True, "pledge": PL.VERSION, "lang": "hi", "mode": "voice"}
        )
    ).json()
    doc = await db[VETTING_INTERVIEWS].find_one({"_id": ObjectId(iv["id"])})
    ex = [t for t in doc["turns"] if t["kind"] == "explain"][0]
    assert (
        ex["source"] == "rules"
        and ex["hi"] == ex["q"]
        and "टास्क" in ex["q"]
        and "two phones in their budget" in ex["q"]
    )
    assert doc["mode"] == "voice" and doc["lang"] == "hi"
    assert not await db[AI_USAGE].find_one({"_id": {"$regex": "\\|explain\\|"}})  # no key: nothing counted
    iv = await answer_all(c, iv, text="मैं ग्राहक से बात करता हूँ और उनकी ज़रूरत समझता हूँ, फिर सही फ़ोन दिखाता हूँ।",
                          explain_text="Two phones in the budget so the customer can compare the battery and the camera easily.")  # fmt: skip
    iv = (await c.post(f"{IV}/{iv['id']}/finish")).json()
    assert iv["status"] == "review"  # no AI for the rubric: a person grades it, as before
    assert (
        iv["explained"]["key"] == "partial" and not iv["explained"]["byAi"] and "battery" in iv["explained"]["reason"]
    )


async def test_ai_question_unusable_falls_back_to_rules_and_admin_can_turn_it_off(
    outbox, db, make_client, monkeypatch, admin_client
):
    fake_claude(monkeypatch, fail_questions=True)
    c, uid = await person(make_client, outbox, db, "lata@example.com", "Lata M")
    await badge(db, uid)
    iv = (await c.post(f"{IV}/start", json={"test": "SQL", "consent": True, "pledge": PL.VERSION})).json()
    doc = await db[VETTING_INTERVIEWS].find_one({"_id": ObjectId(iv["id"])})
    ex = [t for t in doc["turns"] if t["kind"] == "explain"]
    assert (
        ex[0]["source"] == "rules"
        and "Asha" not in ex[0]["q"]
        and "Osmania" not in ex[0]["q"]
        and ex[0]["q"].endswith("?")
    )
    # Admin: two questions, or none
    owner = await admin_client()
    body = {
        "skillAttempts": 1,
        "skillDays": 30,
        "interviewAttempts": 1,
        "interviewDays": 30,
        "refreshDays": 7,
        "explainOn": True,
        "explainQuestions": 2,
    }
    assert (await owner.put("/api/admin/trust/honesty", json=body)).json()["explainQuestions"] == 2
    _, uid2 = await person(make_client, outbox, db, "lata2@example.com", "Lata N")
    await badge(db, uid2)
    turns, src = await X.turns_for(db, uid2, "SQL", {"role": "Data analyst"}, "en", 2)
    assert len(turns) == 2 and src["questions"] == 2 and turns[0]["quote"] != turns[1]["quote"]
    await owner.put("/api/admin/trust/honesty", json={**body, "explainOn": False})
    c3, uid3 = await person(make_client, outbox, db, "lata3@example.com", "Lata O")
    await badge(db, uid3)
    iv = (await c3.post(f"{IV}/start", json={"test": "SQL", "consent": True, "pledge": PL.VERSION})).json()
    assert iv["asking"]["of"] == 7


# --- switch OFF ----------------------------------------------------------------------------------------------------------


async def test_switch_off_everything_as_before(client, outbox, db, make_client, monkeypatch):
    seen = fake_claude(monkeypatch)
    c, uid = await person(make_client, outbox, db, "ravi@example.com", "Ravi K", tester=False)
    assert (await c.get("/api/me/trust/honesty")).status_code == 404
    await c.post(f"{SK}/consent")
    cat = (await c.get(SK)).json()
    assert all("retake" not in r for r in cat["roles"]) and "retakeAttempts" not in cat and cat["retakeDays"] == 30
    p = (await _paper(c)).json()  # no pledge asked
    a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(p["id"])})
    assert "pledge" not in a
    await c.post(f"{SK}/{p['id']}/submit", json={"answers": await _right(db, p), "times": _slow(p)})
    assert (await c.post(f"{SK}/{p['id']}/task/start")).status_code == 200
    res = (await c.get(f"{SK}/{p['id']}")).json()
    assert "retake" not in res and "pledge" not in res
    assert err(await _paper(c)) == "too_soon"  # the old 30-day rule
    # the old refresher rule too (no T9 wait)
    await badge(db, uid, test="Excel", days=80)
    r1 = (await c.post(f"{SK}/start", json={"skill": "Excel", "refresh": True})).json()
    await c.post(f"{SK}/{r1['id']}/submit", json={"answers": {}, "times": _slow(r1)})
    assert (await c.post(f"{SK}/start", json={"skill": "Excel", "refresh": True})).status_code == 200
    # the interview: 7 questions even with a practical task answer, no pledge, no explain call, no label
    await db[VETTING_VERIFIED].delete_many({"user_id": uid, "test": "SQL"})
    await badge(db, uid, test="SQL")
    iv = (await c.post(f"{IV}/start", json={"test": "SQL", "consent": True})).json()
    assert iv["asking"]["of"] == 7
    iv = await answer_all(c, iv)
    iv = (await c.post(f"{IV}/{iv['id']}/finish")).json()
    assert "explained" not in iv and "retake" not in (await c.get(f"{IV}/{iv['id']}")).json()
    assert not [s for s in seen if s[0] == "explain"]
    assert all("retake" not in r for r in (await c.get(f"{IV}/roles")).json()["roles"])
    # the T8 rating knows nothing new for them
    doc = await db[VETTING_INTERVIEWS].find_one({"_id": ObjectId(iv["id"])})
    assert "explain" not in doc and "pledge" not in doc and "explain_source" not in doc
