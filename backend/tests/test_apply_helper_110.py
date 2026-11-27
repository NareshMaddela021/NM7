# ruff: noqa: E501  (long request bodies and expected rows)
"""The Nm7 Apply helper 1.1.0 on the server (app/autoapply/helper.py): smart answers (from the candidate's own profile
only, never for sensitive questions, the truth check, plain text, saved answers reused without an AI call, the
review / demo accounts never use the AI, the per-person cap and the site's daily spending limit with the "paused"
message, the cost logged like the skill-check AI), the opt-in miss report (consent first, labels and counts only, no
user, no value, no address, 180-day retention), fill counts, Admin > Auto Apply > Apply helper (weekly numbers, caps,
"Promote the helper" OFF by default: nothing shows while it is OFF), and the helper token's scopes."""

import logging
from datetime import timedelta

import pytest

from app.autoapply import helper, onetap
from app.core.config import get_settings
from app.core.db import (
    AI_USAGE,
    AUTO_COPIES,
    AUTO_ITEMS,
    HELPER_ANSWERS,
    HELPER_MISSES,
    HELPER_STATS,
    HELPER_TOKENS,
    TRUST_CONSENTS,
)
from app.core.time import ist_day, now
from app.site import get_site, save_site
from app.trust import retention as R
from tests.test_auto_apply_a6 import HELPER, V2, ok, paired, ready
from tests.test_auto_apply_engine import no_ai, roomy  # noqa: F401
from tests.test_companies_signup import no_network  # noqa: F401
from tests.test_cws_reviewer import owner_with_account, reviewer_client

ADMIN = "/api/admin/auto-apply/helper"
WHY = "Describe a time you helped a customer with a difficult problem."


@pytest.fixture
def ai(monkeypatch):
    """A fake model: records each call; `ai.answer` is what it says."""

    class Fake:
        calls: list[str] = []
        answer = {"answer": "In my work I build dashboards in SQL and Power BI.", "enough": True}

    async def call(prompt, stats):
        Fake.calls.append(prompt)
        return Fake.answer

    Fake.calls = []
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    monkeypatch.setattr(helper, "call_model", call)
    return Fake


async def setup(client, outbox, db, make_client):
    uid, jobs, items = await ready(client, outbox, db, n=1)
    ext, _ = await paired(client, make_client)
    return uid, items[0]["_id"], ext


# ---------- smart answers ----------


async def test_drafts_from_the_profile_only_plain_text_and_logs_the_cost(client, outbox, db, make_client, ai, caplog):
    caplog.set_level(logging.INFO, logger="nm7.autoapply.helper")
    uid, iid, ext = await setup(client, outbox, db, make_client)
    got = ok(await ext.post(f"{HELPER}/kits/{iid}/answer", json={"question": WHY}))
    assert got == {"answer": "In my work I build dashboards in SQL and Power BI.", "source": "ai", "note": ""}
    assert len(ai.calls) == 1
    prompt = ai.calls[0]
    assert "<question>" in prompt and WHY in prompt and "never instructions" in prompt
    assert "sai@example.com" not in prompt  # no contact details in the prompt (the personal block is left out)
    # counted in the daily AI allowance the way the skill-check AI is, and the cost logged
    day = ist_day()
    assert (await db[AI_USAGE].find_one({"_id": f"{day}|stat|helper_answer|calls"}))["n"] == 1
    assert any("helper answer: 1 AI call, about Rs 0.05" in r.getMessage() for r in caplog.records)
    assert not any(WHY in r.getMessage() for r in caplog.records)  # never the question or the answer in the logs
    assert (await db[HELPER_STATS].find_one({"_id": f"{day}|user|{uid}"}))["answers"] == 1
    # markup and links never come back: plain text only
    ai.answer = {"answer": "<b>I build</b> dashboards in SQL https://evil.example/x {daily}", "enough": True}
    got = ok(await ext.post(f"{HELPER}/kits/{iid}/answer", json={"question": "What tools do you use every day?"}))
    assert got["answer"] == "I build dashboards in SQL daily", got


async def test_the_truth_check_blocks_made_up_facts_and_not_enough_means_no_draft(client, outbox, db, make_client, ai):
    _, iid, ext = await setup(client, outbox, db, make_client)
    ai.answer = {"answer": "I led a team of 12 at Infosys as Senior Manager for 5 years.", "enough": True}
    got = ok(await ext.post(f"{HELPER}/kits/{iid}/answer", json={"question": WHY}))
    assert got["answer"] == "" and "without guessing" in got["note"]
    ai.answer = {"answer": "", "enough": False}
    got = ok(await ext.post(f"{HELPER}/kits/{iid}/answer", json={"question": "Which award did you win at school?"}))
    assert got["answer"] == "" and "doesn’t answer this" in got["note"]


async def test_never_for_a_sensitive_question(client, outbox, db, make_client, ai):
    _, iid, ext = await setup(client, outbox, db, make_client)
    for q in ("What is your gender?", "Please state your caste category", "Do you have a disability?", "Your date of birth",
              "What was your last drawn salary?", "Salary history for the past 3 years", "Religion"):  # fmt: skip
        r = await ext.post(f"{HELPER}/kits/{iid}/answer", json={"question": q})
        assert r.status_code == 422 and r.json()["error"]["code"] == "sensitive", q
        r = await ext.post(f"{HELPER}/kits/{iid}/answers", json={"question": q, "answer": "x"})
        assert r.status_code == 422, q
    assert ai.calls == []


async def test_a_saved_answer_is_reused_for_a_similar_question_without_an_ai_call(client, outbox, db, make_client, ai):
    uid, iid, ext = await setup(client, outbox, db, make_client)
    ok(
        await ext.post(
            f"{HELPER}/kits/{iid}/answers",
            json={"question": WHY, "answer": "I fixed a billing mix-up for a store in one day.", "how": "edited"},
        )
    )
    row = await db[HELPER_ANSWERS].find_one({"user_id": uid})
    assert row["answer"] == "I fixed a billing mix-up for a store in one day." and row["how"] == "edited"
    # back in the kit's ready answers too (the helper fills it next time without asking)
    kit = ok(await ext.get(f"{HELPER}/kits/{iid}"))
    assert {"question": WHY, "answer": "I fixed a billing mix-up for a store in one day."} in kit["answers"]
    got = ok(
        await ext.post(
            f"{HELPER}/kits/{iid}/answer",
            json={"question": "Describe a time when you helped a customer with a difficult problem"},
        )
    )
    assert got["source"] == "saved" and got["answer"] == "I fixed a billing mix-up for a store in one day."
    assert ai.calls == []  # the cache hit made no AI call
    assert (await db[HELPER_STATS].find_one({"_id": ist_day()}))["answers_cached"] == 1
    assert await db[AI_USAGE].find_one({"_id": f"{ist_day()}|stat|helper_answer|calls"}) is None


async def test_the_per_person_cap_and_the_daily_spending_limit_pause_smart_answers(client, outbox, db, make_client, ai):
    _, iid, ext = await setup(client, outbox, db, make_client)
    await save_site(db, {"auto_apply_v2.helper_per_user": 2})
    for i in range(2):
        assert (
            ok(
                await ext.post(
                    f"{HELPER}/kits/{iid}/answer",
                    json={"question": f"Question number {'abc'[i]} about teamwork and tools"},
                )
            )["source"]
            == "ai"
        )
    r = await ext.post(f"{HELPER}/kits/{iid}/answer", json={"question": "Another question about your goals here"})
    assert r.status_code == 429 and r.json()["error"] == {
        **r.json()["error"],
        "code": "answers_paused",
        "message": "Smart answers are paused for today, type this one yourself.",
    }
    assert len(ai.calls) == 2
    # the site's spending limit: Rs 0.10 is two calls at Rs 0.05 (both used above)
    await save_site(db, {"auto_apply_v2.helper_per_user": 50, "auto_apply_v2.helper_rupees_day": 0.1})
    r = await ext.post(f"{HELPER}/kits/{iid}/answer", json={"question": "Another question about your goals here"})
    assert r.status_code == 429 and r.json()["error"]["message"] == helper.PAUSED
    assert len(ai.calls) == 2
    # the helper still fills everything else: the kit is there
    assert ok(await ext.get(f"{HELPER}/kits/{iid}"))["fields"]


async def test_the_review_account_gets_a_canned_answer_and_never_the_ai(admin_client, make_client, db, ai):
    _, pw = await owner_with_account(admin_client)
    c = await reviewer_client(make_client, pw)
    code = ok(await c.post(f"{V2}/helper/code"))["code"]
    ext = make_client()
    ext.headers.pop("Origin", None)
    ext.headers["Authorization"] = f"Bearer {ok(await ext.post(f'{HELPER}/pair', json={'code': code}))['token']}"
    kits = ok(await ext.get(f"{HELPER}/kits"))["items"]
    got = ok(await ext.post(f"{HELPER}/kits/{kits[0]['id']}/answer", json={"question": WHY}))
    assert got["source"] == "demo" and "Demo Retail (demo)" in got["answer"] and "Practice answer" in got["answer"]
    assert ai.calls == []
    assert await db[AI_USAGE].find_one({"_id": f"{ist_day()}|stat|helper_answer|calls"}) is None


async def test_only_a_helper_token_with_the_scope_can_ask(client, outbox, db, make_client, ai):
    _, iid, ext = await setup(client, outbox, db, make_client)
    bare = make_client()
    assert (await bare.post(f"{HELPER}/kits/{iid}/answer", json={"question": WHY})).status_code == 401
    assert (
        await client.post(f"{HELPER}/kits/{iid}/answer", json={"question": WHY})
    ).status_code == 401  # a session is not a helper token
    await db[HELPER_TOKENS].update_one({}, {"$set": {"scope": ["kits:read", "applied:write"]}})  # a 1.0.0 token
    assert (await ext.post(f"{HELPER}/kits/{iid}/answer", json={"question": WHY})).status_code == 403
    assert (await ext.post(f"{HELPER}/misses", json={"host": "x.example.com", "items": []})).status_code == 403
    assert (await ext.post(f"{HELPER}/kits/someone-elses/answer", json={"question": WHY})).status_code in (403, 404)
    assert ai.calls == []


# ---------- the miss report ----------


async def test_miss_report_needs_the_consent_and_keeps_only_labels_and_counts(client, outbox, db, make_client):
    uid, _, ext = await setup(client, outbox, db, make_client)
    body = {"host": "acme.wd3.myworkdayjobs.com", "adapter": "workday", "items": [
        {"label": "How did you hear about us?", "type": "combobox"},
        {"label": "Call me on 98765 43210 or sai@example.com", "type": "text"},
        {"label": "Referral code ABC123456", "type": "weird"},
    ]}  # fmt: skip
    r = await ext.post(f"{HELPER}/misses", json=body)
    assert r.status_code == 403 and r.json()["error"]["code"] == "consent_needed"  # off until switched on
    assert ok(await ext.get(f"{HELPER}/me"))["missReports"] is False
    assert ok(await ext.post(f"{HELPER}/settings", json={"missReports": True}))["missReports"] is True
    row = await db[TRUST_CONSENTS].find_one({"user_id": uid, "purpose": "helper_improvement"})
    assert row["channel"] == "flow" and row["withdrawn_at"] is None
    assert ok(await ext.post(f"{HELPER}/misses", json=body))["stored"] == 3
    ok(await ext.post(f"{HELPER}/misses", json=body))
    rows = await db[HELPER_MISSES].find({}).to_list(10)
    for x in rows:
        assert set(x) == {"_id", "host", "adapter", "label", "type", "count", "first_at", "last_at"}  # nothing else
        assert x["count"] == 2 and x["host"] == "acme.wd3.myworkdayjobs.com"
    labels = {x["label"]: x["type"] for x in rows}
    assert labels == {"How did you hear about us?": "combobox", "Call me on or": "text", "Referral code ABC": "text"}
    text = str(rows)
    for bad in ("sai@example.com", "98765", "43210", uid, "123456"):
        assert bad not in text
    # only a site's name: never a page address
    for host in ("acme.com/careers/job?id=1", "https://acme.com", "acme.com:443"):
        assert (await ext.post(f"{HELPER}/misses", json={**body, "host": host})).status_code == 400, host
    # switched off: nothing more is accepted
    assert ok(await ext.post(f"{HELPER}/settings", json={"missReports": False}))["missReports"] is False
    assert (await ext.post(f"{HELPER}/misses", json=body)).status_code == 403


async def test_miss_labels_are_deleted_after_180_days(db):
    t = now()
    await db[HELPER_MISSES].insert_many([
        {"_id": "old", "host": "a.example.com", "adapter": "", "label": "Old", "type": "text", "count": 1, "first_at": t - timedelta(days=400), "last_at": t - timedelta(days=181)},
        {"_id": "new", "host": "a.example.com", "adapter": "", "label": "New", "type": "text", "count": 1, "first_at": t - timedelta(days=400), "last_at": t - timedelta(days=10)},
    ])  # fmt: skip
    assert R.TYPES["helper_misses"].days == 180 and R.TYPES["helper_misses"].purpose == "helper_improvement"
    assert "helper_misses" in {x["key"] for x in await R.schedule(db)}
    await R.run(db, force=True)
    assert [x["_id"] async for x in db[HELPER_MISSES].find({})] == ["new"]


async def test_the_admin_view_lists_top_labels_and_is_admin_only(client, outbox, db, make_client, admin_client):
    _, _, ext = await setup(client, outbox, db, make_client)
    ok(await ext.post(f"{HELPER}/settings", json={"missReports": True}))
    for host, n in (("acme.wd3.myworkdayjobs.com", 3), ("zeta.taleo.net", 1)):
        for _ in range(n):
            ok(await ext.post(f"{HELPER}/misses", json={"host": host, "adapter": host.split(".")[1] if "taleo" in host else "workday",
                                                         "items": [{"label": "Preferred shift", "type": "select"}]}))  # fmt: skip
    for c in (make_client(), client, ext):
        assert (await c.get(ADMIN)).status_code in (401, 403)
    support = await admin_client("support", "support@nm7.si")
    assert (await support.get(ADMIN)).status_code == 403
    ops = await admin_client("ops", "ops@nm7.si")
    d = ok(await ops.get(ADMIN))
    assert d["topMisses"][0] == {
        "label": "Preferred shift",
        "type": "select",
        "host": "acme.wd3.myworkdayjobs.com",
        "adapter": "workday",
        "count": 3,
    }
    assert {(x["host"], x["count"]) for x in d["bySite"]} == {("acme.wd3.myworkdayjobs.com", 3), ("zeta.taleo.net", 1)}
    only = ok(await ops.get(ADMIN, params={"adapter": "taleo"}))
    assert [x["host"] for x in only["topMisses"]] == ["zeta.taleo.net"]


# ---------- counts, weekly numbers, settings, promote ----------


async def test_fill_counts_only_and_the_weekly_numbers(client, outbox, db, make_client, admin_client, ai):
    uid, iid, _ = await setup(client, outbox, db, make_client)
    # a second browser installed an hour before it connected
    code = ok(await client.post(f"{V2}/helper/code"))["code"]
    ext = make_client()
    ext.headers.pop("Origin", None)
    installed = int((now() - timedelta(hours=1)).timestamp() * 1000)
    ext.headers["Authorization"] = (
        f"Bearer {ok(await ext.post(f'{HELPER}/pair', json={'code': code, 'installedAt': installed, 'version': '1.1.0'}))['token']}"
    )
    ok(await ext.post(f"{HELPER}/kits/{iid}/filled", json={"filled": 9, "total": 12, "adapter": "workday"}))
    it = await db[AUTO_ITEMS].find_one({"_id": iid})
    assert set(it["helper_fill"]) == {"filled", "total", "adapter", "at"} and it["helper_fill"]["filled"] == 9
    day = await db[HELPER_STATS].find_one({"_id": ist_day()})
    assert {k: day[k] for k in ("fills", "fields_filled", "fields_total")} == {
        "fills": 1,
        "fields_filled": 9,
        "fields_total": 12,
    }
    assert set(day) <= {
        "_id",
        "day",
        "fills",
        "fields_filled",
        "fields_total",
        "answers_answers",
        "answers_cached",
        "answers_demo",
    }
    ok(await ext.post(f"{HELPER}/kits/{iid}/answer", json={"question": WHY}))
    ok(await ext.post(f"{HELPER}/kits/{iid}/applied"))
    ok(await ext.post(f"{HELPER}/unpair"))  # a disconnect in the first week
    owner = await admin_client("owner")
    d = ok(await owner.get(ADMIN))
    w = d["week"]
    assert w["paired"] == 2 and w["pairedWithInstall"] == 1 and w["connectWithinDay"] == 1
    assert w["fillRate"] == 75.0 and w["kitsFilled"] == 1 and w["appliedAfterFill"] == 1
    assert w["firstWeekDisconnects"] == 1 and w["aiCalls"] == 1 and w["spendRupees"] == 0.05
    assert d["today"] == {"aiCalls": 1, "spendRupees": 0.05, "answers": 1, "cached": 0, "paused": False}
    assert d["settings"] == {
        "rupeesDay": 200.0,
        "perUser": 20,
        "promote": False,
        "storeUrl": "https://chromewebstore.google.com/search/Nm7%20Apply%20helper",
        "rupeesPerCall": 0.05,
    }
    tok = await db[HELPER_TOKENS].find_one({"install_at": {"$exists": True}})
    assert tok["version"] == "1.1.0"


async def test_admin_edits_the_caps_and_the_store_link(admin_client, db):
    owner = await admin_client("owner")
    body = {
        "rupeesDay": 350,
        "perUser": 5,
        "promote": False,
        "storeUrl": "https://chromewebstore.google.com/detail/abc",
    }
    d = ok(await owner.put(f"{ADMIN}/settings", json=body))
    assert d["settings"]["rupeesDay"] == 350 and d["settings"]["perUser"] == 5
    assert (await owner.put(f"{ADMIN}/settings", json={**body, "storeUrl": "http://x.example"})).status_code == 400
    assert (await owner.put(f"{ADMIN}/settings", json={**body, "perUser": -1})).status_code == 422
    support = await admin_client("support", "support2@nm7.si")
    assert (await support.put(f"{ADMIN}/settings", json=body)).status_code == 403


async def test_promote_the_helper_shows_nothing_while_off(client, outbox, db, make_client, admin_client):
    uid, iid, ext = await setup(client, outbox, db, make_client)
    site = await get_site(db)
    assert site["auto_apply_v2"]["helper_promote"] is False  # OFF until the store listing is approved
    assert "helper" not in ok(await client.get(f"{V2}/onetap"))
    assert ok(await ext.get(f"{HELPER}/me"))["storeUrl"] == ""
    assert await onetap.helper_lines(db, site, [iid]) == []
    owner = await admin_client("owner")
    ok(
        await owner.put(
            f"{ADMIN}/settings",
            json={
                "rupeesDay": 200,
                "perUser": 20,
                "promote": True,
                "storeUrl": "https://chromewebstore.google.com/detail/abc",
            },
        )
    )
    d = ok(await client.get(f"{V2}/onetap"))
    assert d["helper"] == {
        "storeUrl": "https://chromewebstore.google.com/detail/abc",
        "text": "Fill it in one tap: add the Nm7 Apply helper",
    }
    assert ok(await ext.get(f"{HELPER}/me"))["storeUrl"] == "https://chromewebstore.google.com/detail/abc"
    lines = await onetap.helper_lines(db, await get_site(db), [iid])
    assert "Ready for the Nm7 Apply helper" in lines[0] and "Junior Data Analyst" in lines[0]
    assert lines[1] == "Add the helper: https://chromewebstore.google.com/detail/abc"


async def test_the_kit_carries_work_and_education_from_the_tailored_resume(client, outbox, db, make_client):
    _, iid, ext = await setup(client, outbox, db, make_client)
    k = ok(await ext.get(f"{HELPER}/kits/{iid}"))
    it = await db[AUTO_ITEMS].find_one({"_id": iid})
    data = (await db[AUTO_COPIES].find_one({"_id": it["copy_id"]}))["data"]
    assert [e["company"] for e in k["experience"]] == [
        e["company"] for e in data.get("exp") or [] if e.get("company") or e.get("role")
    ]
    assert all(set(e) == {"company", "title", "from", "to", "current", "description"} for e in k["experience"])
    assert all(set(e) == {"school", "degree", "field", "from", "to", "grade"} for e in k["education"])
