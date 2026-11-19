# ruff: noqa: E501
"""Vetting Trust T5: the calling agent. A job posted with "Call / message matching candidates" picks the best matches
within the caps; consent, channels and opt-outs are respected; quiet hours / quiet days / the daily cap make contacts
wait; Stop in English, Hindi and Telugu opts out at once (confirmed); WhatsApp → knock-out questions → slots → booking
updates the application; an AI call follows when there is no reply; webhooks are signature-checked; transcripts are
kept only with consent, deleted by retention and on withdrawal; while the switch is OFF nobody real is contacted; no
payment text anywhere."""

import hashlib
import hmac
import json
from datetime import datetime, time, timedelta

import httpx
import pytest

from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import (
    AI_USAGE,
    APPLICATIONS,
    HIRE_SLOTS,
    JOBS,
    TRUST_AGENT_CONVOS,
    TRUST_AGENT_EVENTS,
    TRUST_AGENT_LOGS,
    TRUST_AGENT_PREFS,
)
from app.core.time import IST, now
from app.trust import knockout as K
from app.trust import retention as R
from app.trust.agent import bolna, meta, understand
from app.trust.agent import providers as P
from app.trust.agent import service as S
from app.trust.agent import texts as T
from tests.conftest import signup
from tests.jobs_helpers import add_resume
from tests.test_companies_apply import company_job
from tests.test_companies_posting import no_ai  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401

WA = "/api/public/trust/agent/whatsapp"
ME = "/api/me/trust/agent"
EXTRA = [{"text": "Can you start within 2 weeks?", "want": "yes"}]


@pytest.fixture(autouse=True)
def no_kick(monkeypatch):
    """The pass after a toggle runs at the real clock; tests run it themselves at a fixed time."""
    kicks = []

    async def fake(db, mailer=None):
        kicks.append(1)
        return {}

    monkeypatch.setattr(S, "kick", fake)
    P.SENT.clear()
    return kicks


def at(days: int = 1, hour: int = 11, minute: int = 0) -> datetime:
    d = (now().astimezone(IST) + timedelta(days=days)).date()
    return datetime.combine(d, time(hour, minute), IST)


async def make_tester(db, email: str) -> None:
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email.lower()}}, upsert=True)


async def agent_settings(db, **kw) -> None:
    await db["settings"].update_one(
        {"_id": "site"}, {"$set": {f"trust.agent.{k}": v for k, v in kw.items()}}, upsert=True
    )


async def co(client, outbox, db, test=True):
    session, cid, job = await company_job(client, outbox, db)
    if test:
        await make_tester(db, "founder@gmail.com")
    await agent_settings(db, min_score=0)
    return session, cid, job


async def add_slots(client, session, cid, jid, n=2):
    d = (now().astimezone(IST) + timedelta(days=3)).date().isoformat()
    r = await client.post(f"/api/company/{cid}/hire/slots", headers=H(session),
                          json={"job": jid, "slots": [{"date": d, "time": f"{10 + i}:00", "minutes": 30, "place": "Hitech City office"} for i in range(n)]})  # fmt: skip
    assert r.status_code == 201, r.text
    return r.json()["items"]


async def person(
    make_client, outbox, db, email, phone, *, test=True, consent=True, whatsapp=True, call=False, lang="en", quiet=None
):
    c = make_client()
    me = await signup(c, outbox, email=email, name="Asha Rao")
    await add_resume(c)
    assert (await c.patch("/api/me/profile", json={"phone": phone})).status_code == 200
    if test:
        await make_tester(db, email)
        assert (await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})).status_code == 200
        if consent:
            assert (await c.post(f"/api/me/trust/consents/{S.PURPOSE}")).json()["status"] == "granted"
            r = await c.put(ME, json={"whatsapp": whatsapp, "call": call, "lang": lang, "quietDays": quiet or []})
            assert r.status_code == 200, r.text
    return c, me["id"]


async def toggle(client, session, cid, jid, on=True, knockouts=None):
    body = {"on": on} | ({"knockouts": knockouts} if knockouts is not None else {})
    r = await client.put(f"/api/company/{cid}/trust/agent/jobs/{jid}", json=body, headers=H(session))
    assert r.status_code == 200, r.text
    return r.json()


def signed(body: dict, secret: str = P.MOCK_WA_SECRET) -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    sig = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return raw, {"X-Hub-Signature-256": sig, "Content-Type": "application/json"}


def wa_msg(phone: str, *, text: str = "", payload: str = "", mid: str | None = None) -> dict:
    m: dict = {
        "from": phone,
        "id": mid or f"wamid.in.{hashlib.sha1(f'{phone}{text}{payload}{now().timestamp()}'.encode()).hexdigest()[:12]}",
        "timestamp": str(int(now().timestamp())),
    }
    if payload:
        m |= {"type": "button", "button": {"payload": payload, "text": text or payload}}
    else:
        m |= {"type": "text", "text": {"body": text}}
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": "1", "changes": [{"field": "messages", "value": {"messages": [m]}}]}],
    }


async def reply(client, phone, **kw):
    raw, h = signed(wa_msg(phone, **kw))
    r = await client.post(WA, content=raw, headers=h)
    assert r.status_code == 200, r.text
    return r.json()["handled"]


async def convo_of(db, uid, jid):
    return await db[TRUST_AGENT_CONVOS].find_one({"user_id": uid, "job_id": jid})


# --- rules: words, knock-outs, time ---------------------------------------------------------------------------------------


def test_stop_words_in_english_hindi_and_telugu():
    for s in ("STOP", "stop", "Stop.", "please stop", "Unsubscribe", "band karo", "Band kar do", "बंद करो", "मत भेजो",
              "aapu", "Aapandi", "ఆపు", "ఆపండి", "don't call", "stop messaging me"):  # fmt: skip
        assert T.is_stop(s), s
    for s in ("yes", "Interested", "haan", "my bus stop is near the office", "nonstop work is fine", "1", ""):
        assert not T.is_stop(s), s
    assert T.rules_intent("haan", "interest") == ("interested", 0) and T.rules_intent("avunu", "yesno") == ("yes", 0)
    assert T.rules_intent("नहीं", "yesno") == ("no", 0) and T.rules_intent("ledu", "yesno") == ("no", 0)
    assert T.rules_intent("abhi nahi", "interest") == ("not_now", 0) and T.rules_intent("వద్దు", "interest") == (
        "not_now",
        0,
    )
    assert T.rules_intent("2", "slot") == ("slot", 2) and T.rules_intent("0", "slot") == ("none", 0)
    assert T.rules_intent("aapu", "slot") == ("stop", 0) and T.rules_intent("maybe tuesday?", "yesno") == ("unclear", 0)


def test_no_whatsapp_payment_text_anywhere():
    """WhatsApp payments were removed and never come back: nothing the agent sends talks about paying."""
    import pathlib
    import re

    words = re.compile(r"\b(pay|payment|paid|upi|razorpay|rupees?|₹|fee|refund|bank)\b|भुगतान|पैसे|చెల్లింపు|డబ్బు", re.I)
    for s in T.all_texts():
        assert not words.search(s), s
    for d in T.CALL.values():
        assert "AI" in d["intro"]  # it always says it is an AI
    src = "\n".join(p.read_text() for p in (pathlib.Path(S.__file__).parent).glob("*.py"))
    assert not re.search(r"whatsapp[_ ]?pay|wapay|pay on whatsapp|payment link", src, re.I)


def test_knockout_model():
    j = {"questions": [{"id": "q1", "text": "Can you work from Hyderabad?", "kind": "yesno", "want": "yes"},
                       {"id": "q2", "text": "Months of SQL?", "kind": "number", "min": 3},
                       {"id": "q3", "text": "Any shift?", "kind": "yesno", "want": ""}],
         "knockouts": K.parse_extra(EXTRA + [{"text": "Do you need a visa sponsor?", "want": "no", "texts": {"hi": "क्या आपको वीज़ा चाहिए?", "xx": "?"}}])}  # fmt: skip
    kos = K.for_job(j)
    assert [k.id for k in kos] == ["q1", "k1", "k2"] and [k.source for k in kos] == ["job", "extra", "extra"]
    assert kos[2].text_in("hi") == "क्या आपको वीज़ा चाहिए?" and kos[2].text_in("te") == "Do you need a visa sponsor?"
    assert K.reasons(kos, {"q1": "yes", "k1": "yes", "k2": "no"}) == []
    assert K.reasons(kos, {"q1": "no", "k1": "yes"}) == ["Can you work from Hyderabad? – answered no"]
    with pytest.raises(ValueError):
        K.parse_extra(EXTRA * 6)
    with pytest.raises(ValueError):
        K.parse_extra([{"text": "Hi", "want": "yes"}])


def test_quiet_hours_and_quiet_days():
    st = S.agent_settings({})
    assert (
        S.quiet_now(at(hour=21, minute=0), st)
        and S.quiet_now(at(hour=3), st)
        and S.quiet_now(at(hour=8, minute=59), st)
    )
    assert not S.quiet_now(at(hour=9), st) and not S.quiet_now(at(hour=20, minute=59), st)
    assert S.next_allowed(at(hour=22), st, []) == at(days=2, hour=9)
    assert S.next_allowed(at(hour=2), st, []) == at(hour=9)
    t = at(hour=11)
    assert S.next_allowed(t, st, [t.weekday()]) == at(days=2, hour=9)  # a quiet day: the next day's 9 AM
    assert S.next_allowed(t, st, [t.weekday(), (t.weekday() + 1) % 7]) == at(days=3, hour=9)
    day = {**st, "quiet_from": "13:00", "quiet_to": "14:00"}  # Admin can move them (a window inside one day too)
    assert S.quiet_now(at(hour=13, minute=30), day) and not S.quiet_now(at(hour=21), day)


# --- picking people ------------------------------------------------------------------------------------------------------


async def test_job_post_triggers_selection_within_caps(client, outbox, db, make_client, no_kick):
    session, cid, _ = await co(client, outbox, db)
    people = [await person(make_client, outbox, db, f"p{i}@example.com", f"98765{i}1234") for i in range(3)]
    await person(make_client, outbox, db, "noconsent@example.com", "9876511111", consent=False)
    await person(make_client, outbox, db, "real@example.com", "9876522222", test=False)  # not a tester: never while OFF
    await agent_settings(db, per_job=2)
    from tests.test_companies_posting import JOB

    r = await client.post(
        f"/api/company/{cid}/jobs",
        json={"job": {**JOB, "title": "Store Data Analyst", "agent": {"on": True}}},
        headers=H(session),
    )
    assert r.status_code == 201, r.text
    jid = r.json()["id"]
    j = await db[JOBS].find_one({"_id": jid})
    assert (
        j["agent"]["on"] and j["agent"]["state"] == "pending" and no_kick
    )  # picked after the answer, in the background
    got = await S.run(db, t=at(), force=True)
    assert got["selected"] == 2
    rows = await db[TRUST_AGENT_CONVOS].find({"job_id": jid}).to_list(10)
    ids = {r["user_id"] for r in rows}
    assert len(rows) == 2 and ids <= {uid for _, uid in people}  # within the cap, only consented testers
    left = next(uid for _, uid in people if uid not in ids)
    left_score = await S._score(db, await db["users"].find_one({"_id": left}), j)
    assert all(r["score"] >= left_score for r in rows)  # best first
    assert all(r["state"] == "asked" for r in rows)  # messaged in the same pass (11 AM IST)
    assert sum(1 for x in P.SENT if x["kind"] == "template") == 2
    assert (await db[JOBS].find_one({"_id": jid}))["agent"]["state"] == "done"
    status = (await client.get(f"/api/company/{cid}/trust/agent", headers=H(session))).json()
    row = next(x for x in status["jobs"] if x["id"] == jid)
    assert row["on"] and row["selected"] == 2 and row["contacted"] == 2 and row["people"] == []  # nobody said yes yet


async def test_company_toggle_hidden_while_off_and_only_nm7_jobs(client, outbox, db):
    session, cid, job = await co(client, outbox, db, test=False)
    assert (await client.get(f"/api/company/{cid}/trust/agent", headers=H(session))).status_code == 404
    await make_tester(db, "founder@gmail.com")
    r = await client.put(
        f"/api/company/{cid}/trust/agent/jobs/{job['id']}",
        json={"on": True, "knockouts": [{"text": "Hi", "want": "yes"}]},
        headers=H(session),
    )
    assert r.status_code == 400
    out = await toggle(client, session, cid, job["id"], knockouts=EXTRA)
    assert out["on"] and [k["id"] for k in out["knockouts"]] == ["q1", "k1"] and out["extra"] == EXTRA


# --- the WhatsApp flow ---------------------------------------------------------------------------------------------------


async def test_whatsapp_flow_questions_slots_booking(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db)
    jid = job["id"]
    await add_slots(client, session, cid, jid, 2)
    c, uid = await person(make_client, outbox, db, "asha@example.com", "98765 43210", lang="hi")
    await toggle(client, session, cid, jid, knockouts=EXTRA)
    await S.run(db, t=at(), force=True)
    cv = await convo_of(db, uid, jid)
    tpl = next(x for x in P.SENT if x["kind"] == "template")
    assert (
        tpl["to"] == "919876543210"
        and tpl["lang"] == "hi"
        and tpl["payloads"] == [f"nm7:{cv['_id']}:{k}" for k in ("interested", "not_now", "stop")]
    )
    assert tpl["params"][0] == "Asha" and tpl["params"][1] == "Junior Data Analyst"
    phone = "919876543210"
    assert await reply(client, phone, payload=f"nm7:{cv['_id']}:interested", text="Interested") == ["interested"]
    q1 = P.SENT[-1]
    assert (
        q1["kind"] == "text"
        and "1/2" in q1["text"]
        and "Hyderabad" in q1["text"]
        and q1["buttons"][0][0].endswith(":yes")
    )
    assert await reply(client, phone, text="haan") == ["answered"]  # typed in Hindi, read by the rules
    assert await reply(client, phone, text="what?") == ["unclear"]  # asked again (no AI key)
    assert await reply(client, phone, payload=f"nm7:{cv['_id']}:yes") == ["answered"]
    slots_msg = P.SENT[-1]
    assert "1." in slots_msg["text"] and len(slots_msg["buttons"]) == 2
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": jid})
    assert (
        app["origin"] == "agent"
        and app["answers"] == {"q1": "yes", "k1": "yes"}
        and app["fit"] == {"ok": True, "reasons": []}
    )
    n = len(outbox.sent)
    assert await reply(client, phone, text="2") == ["booked"]
    cv = await convo_of(db, uid, jid)
    slot = await db[HIRE_SLOTS].find_one({"user_id": uid})
    assert cv["state"] == "booked" and slot["status"] == "booked" and str(slot["_id"]) == cv["slot_id"]
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": jid})
    assert app["status"] == "interview" and app["interview"]["slot_id"] == slot["_id"]  # the tracker moves on
    assert len(outbox.sent) > n and any("Interview booked" in m.subject for m in outbox.sent[n:])  # calendar emails
    # the company: answers + the booked time, never transcripts or phone numbers
    status = (await client.get(f"/api/company/{cid}/trust/agent", headers=H(session))).json()
    row = next(x for x in status["jobs"] if x["id"] == jid)
    assert row["booked"] == 1 and row["interested"] == 1
    p = row["people"][0]
    assert p["name"] == "Asha Rao" and p["slotAt"] and [a["answer"] for a in p["answers"]] == ["yes", "yes"]
    blob = json.dumps(status)
    assert "9876543210" not in blob and "haan" not in blob and "transcript" not in blob
    # the candidate: "What we said", the whole conversation
    mine = (await c.get(ME)).json()
    lines = mine["conversations"][0]["lines"]
    assert mine["conversations"][0]["state"] == "booked" and any(
        x["who"] == "candidate" and x["text"] == "haan" for x in lines
    )
    assert (
        lines[0]["who"] == "nm7"
        and "Nm7" in lines[0]["text"]
        and mine["phone"].endswith("43210")
        and "98765" not in mine["phone"]
    )
    # counts for Admin
    ev = {e["kind"] async for e in db[TRUST_AGENT_EVENTS].find({})}
    assert {"wa_template", "reply", "booked"} <= ev


async def test_not_a_fit_is_a_label_never_a_rejection_and_not_now(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db)
    jid = job["id"]
    await add_slots(client, session, cid, jid, 1)
    _, a = await person(make_client, outbox, db, "a@example.com", "9876500001")
    _, b = await person(make_client, outbox, db, "b@example.com", "9876500002")
    await toggle(client, session, cid, jid)
    await S.run(db, t=at(), force=True)
    await reply(client, "919876500001", text="yes")
    assert await reply(client, "919876500001", text="no") == ["answered"]  # "Can you work from Hyderabad?" no
    cv = await convo_of(db, a, jid)
    app = await db[APPLICATIONS].find_one({"user_id": a, "job_id": jid})
    assert cv["state"] == "not_fit" and app["status"] == "applied" and not app["fit"]["ok"]  # applied, labelled
    assert "decide" in P.SENT[-1]["text"]
    assert await reply(client, "919876500002", text="Not now") == ["declined"]
    assert (await convo_of(db, b, jid))["state"] == "declined" and not await db[APPLICATIONS].find_one({"user_id": b})


# --- Stop / opt-outs -----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("word", ["STOP", "band karo", "ఆపు", "aapu", "बंद करो"])
async def test_stop_opts_out_at_once_and_is_never_contacted_again(client, outbox, db, make_client, word):
    session, cid, job = await co(client, outbox, db)
    c, uid = await person(make_client, outbox, db, "asha@example.com", "98765 43210", call=True)
    await toggle(client, session, cid, job["id"])
    await S.run(db, t=at(), force=True)
    assert await reply(client, "919876543210", text=word) == ["stopped"]
    p = await db[TRUST_AGENT_PREFS].find_one({"_id": uid})
    assert p["whatsapp"] is False and p["opt_out"]["whatsapp"] and p["call"] is True  # only that channel
    assert "won't get WhatsApp" in P.SENT[-1]["text"] and (await convo_of(db, uid, job["id"]))["state"] == "stopped"
    # a second job: WhatsApp is never used again; the call channel the person kept is used instead
    from tests.test_companies_posting import JOB

    j2 = (
        await client.post(
            f"/api/company/{cid}/jobs", json={"job": {**JOB, "title": "Retail Data Analyst"}}, headers=H(session)
        )
    ).json()["id"]
    await toggle(client, session, cid, j2)
    P.SENT.clear()
    await S.run(db, t=at(), force=True)
    assert [x["channel"] for x in P.SENT] == ["call"]
    # opting back in from settings clears the stop
    mine = (await c.get(ME)).json()
    assert mine["optedOut"]["whatsapp"] and not mine["whatsapp"]
    back = (await c.put(ME, json={"whatsapp": True, "call": True, "lang": "en", "quietDays": []})).json()
    assert back["whatsapp"] and back["optedOut"]["whatsapp"] is None


async def test_stop_said_on_a_call_stops_calls(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db)
    _, uid = await person(
        make_client, outbox, db, "asha@example.com", "98765 43210", whatsapp=False, call=True, lang="te"
    )
    await toggle(client, session, cid, job["id"])
    await S.run(db, t=at(), force=True)
    call = P.SENT[-1]
    assert (
        call["channel"] == "call"
        and call["lang"] == "te"
        and "AI" in call["script"]["intro"]
        and "Asha" in call["script"]["intro"]
    )
    cv = await convo_of(db, uid, job["id"])
    body = {
        "ref": cv["call"]["ref"],
        "status": "completed",
        "transcript": [{"who": "agent", "text": "Namaste"}, {"who": "candidate", "text": "ఆపండి"}],
    }
    raw = json.dumps(body).encode()
    r = await client.post(
        "/api/public/trust/agent/voice/mock",
        content=raw,
        headers={"X-Nm7-Signature": P.hmac_hex(P.MOCK_VOICE_SECRET, raw)},
    )
    assert r.json()["handled"] == "stopped"
    p = await db[TRUST_AGENT_PREFS].find_one({"_id": uid})
    assert p["call"] is False and p["opt_out"]["call"]


# --- the call after no reply ------------------------------------------------------------------------------------------------


async def test_ai_call_when_no_whatsapp_reply_books_a_slot(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db)
    jid = job["id"]
    await add_slots(client, session, cid, jid, 2)
    _, uid = await person(make_client, outbox, db, "asha@example.com", "98765 43210", call=True)
    await toggle(client, session, cid, jid)
    await S.run(db, t=at(hour=11), force=True)
    assert [x["channel"] for x in P.SENT] == ["whatsapp"]
    await S.run(db, t=at(hour=13), force=True)  # 2 hours: not yet
    assert len(P.SENT) == 1
    await S.run(db, t=at(hour=15, minute=5), force=True)  # 4 hours without a reply → the AI call
    call = P.SENT[-1]
    assert call["channel"] == "call" and call["script"]["question_ids"] == ["q1"] and len(call["script"]["slots"]) == 2
    cv = await convo_of(db, uid, jid)
    assert cv["state"] == "calling"
    body = {
        "ref": cv["call"]["ref"],
        "status": "completed",
        "minutes": 2.5,
        "answers": {"interest": "interested", "knockouts": {"q1": "yes"}, "slot": 1},
        "transcript": [
            {"who": "agent", "text": "Hello Asha, this is Nm7's AI assistant"},
            {"who": "candidate", "text": "Yes, interested"},
        ],
    }
    raw = json.dumps(body).encode()
    url = "/api/public/trust/agent/voice/mock"
    assert (await client.post(url, content=raw, headers={"X-Nm7-Signature": "0" * 64})).status_code == 401
    r = await client.post(url, content=raw, headers={"X-Nm7-Signature": P.hmac_hex(P.MOCK_VOICE_SECRET, raw)})
    assert r.json()["handled"] == "booked"
    again = await client.post(url, content=raw, headers={"X-Nm7-Signature": P.hmac_hex(P.MOCK_VOICE_SECRET, raw)})
    assert again.json()["handled"] == "duplicate"
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": jid})
    assert app["status"] == "interview" and app["agent"]["channel"] == "call"
    logs = await db[TRUST_AGENT_LOGS].find({"user_id": uid, "channel": "call"}).to_list(10)
    assert [x["who"] for x in logs] == ["nm7", "candidate"]
    assert "recording" not in json.dumps(await db[TRUST_AGENT_CONVOS].find_one({"_id": cv["_id"]}), default=str)


async def test_no_call_without_permission_then_no_reply(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db)
    _, uid = await person(make_client, outbox, db, "asha@example.com", "98765 43210", call=False)
    await toggle(client, session, cid, job["id"])
    await S.run(db, t=at(hour=11), force=True)
    await S.run(db, t=at(hour=16), force=True)
    assert [x["channel"] for x in P.SENT] == ["whatsapp"]  # never a call the person didn't allow
    await S.run(db, t=at(days=4), force=True)
    assert (await convo_of(db, uid, job["id"]))["state"] == "no_reply"


# --- quiet hours, quiet days, the daily cap ---------------------------------------------------------------------------------


async def test_quiet_hours_quiet_days_and_daily_cap(client, outbox, db, make_client):
    from tests.test_companies_posting import JOB

    session, cid, job = await co(client, outbox, db)
    night = at(hour=22)
    quiet_day = at(days=2).weekday()
    _, uid = await person(make_client, outbox, db, "asha@example.com", "98765 43210", quiet=[quiet_day])
    jobs = [job["id"]] + [
        (
            await client.post(
                f"/api/company/{cid}/jobs", json={"job": {**JOB, "title": f"Data Analyst {i}"}}, headers=H(session)
            )
        ).json()["id"]
        for i in range(2)
    ]
    for jid in jobs:
        await toggle(client, session, cid, jid)
    await S.run(db, t=night, force=True)
    assert len(P.SENT) == 0  # 10 PM IST: nothing
    rows = await db[TRUST_AGENT_CONVOS].find({"user_id": uid}).to_list(10)
    assert len(rows) == 3 and all(r["state"] == "queued" for r in rows)
    nxt = {r["next_at"].replace(tzinfo=IST) if r["next_at"].tzinfo is None else r["next_at"] for r in rows}
    assert nxt == {at(days=3, hour=9)}  # 9 AM, skipping tomorrow (a quiet day for this person)
    await S.run(db, t=at(days=2, hour=11), force=True)  # the quiet day itself
    assert len(P.SENT) == 0
    await S.run(db, t=at(days=3, hour=9, minute=5), force=True)
    assert len(P.SENT) == 2  # the daily cap (2 new contacts a day)
    third = await db[TRUST_AGENT_CONVOS].find_one({"user_id": uid, "state": "queued"})
    assert third and third["next_at"].astimezone(IST) == at(days=4, hour=9)
    await S.run(db, t=at(days=4, hour=9, minute=5), force=True)
    assert len(P.SENT) == 3


# --- webhooks ---------------------------------------------------------------------------------------------------------------


async def test_webhook_signatures_and_setup_check(client, outbox, db, make_client, monkeypatch):
    raw, h = signed(wa_msg("919876543210", text="hi"))
    assert (
        await client.post(WA, content=raw, headers={**h, "X-Hub-Signature-256": "sha256=" + "0" * 64})
    ).status_code == 401
    assert (await client.post(WA, content=raw, headers={"Content-Type": "application/json"})).status_code == 401
    assert (await client.post(WA, content=raw, headers=h)).json()["handled"] == ["unknown_number"]
    ok = await client.get(
        WA, params={"hub.mode": "subscribe", "hub.verify_token": "nm7-test-verify", "hub.challenge": "12345"}
    )
    assert ok.status_code == 200 and ok.text == "12345"
    assert (
        await client.get(WA, params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1"})
    ).status_code == 403
    # the real app secret signs Meta's webhooks; on production the test secret is refused
    monkeypatch.setattr(get_settings(), "whatsapp_app_secret", "app-secret-value")
    monkeypatch.setattr(get_settings(), "app_env", "prod")
    assert (await client.post(WA, content=raw, headers=h)).status_code == 401
    raw2, h2 = signed(wa_msg("919876543210", text="hi"), "app-secret-value")
    assert (await client.post(WA, content=raw2, headers=h2)).status_code == 200
    vraw = json.dumps({"ref": "x", "status": "completed"}).encode()
    assert (
        await client.post(
            "/api/public/trust/agent/voice/mock",
            content=vraw,
            headers={"X-Nm7-Signature": P.hmac_hex(P.MOCK_VOICE_SECRET, vraw)},
        )
    ).status_code == 401
    monkeypatch.setattr(get_settings(), "voice_webhook_secret", "voice-secret")
    assert (await client.post("/api/public/trust/agent/voice/bolna?token=nope", content=vraw)).status_code == 401
    assert (await client.post("/api/public/trust/agent/voice/bolna?token=voice-secret", content=vraw)).json()[
        "handled"
    ] == "unknown_call"


async def test_duplicate_webhook_messages_are_handled_once(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db)
    _, uid = await person(make_client, outbox, db, "asha@example.com", "98765 43210")
    await toggle(client, session, cid, job["id"])
    await S.run(db, t=at(), force=True)
    raw, h = signed(wa_msg("919876543210", text="yes", mid="wamid.same"))
    assert (await client.post(WA, content=raw, headers=h)).json()["handled"] == ["interested"]
    assert (await client.post(WA, content=raw, headers=h)).json()["handled"] == ["duplicate"]


# --- consent, transcripts, retention --------------------------------------------------------------------------------------


async def test_consent_needed_and_withdrawal_deletes_transcripts(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db)
    c, uid = await person(make_client, outbox, db, "asha@example.com", "98765 43210", consent=False)
    r = await c.put(ME, json={"whatsapp": True, "call": False, "lang": "en", "quietDays": []})
    assert r.status_code == 403 and r.json()["error"]["code"] == "consent_needed"
    card = (await c.get(ME)).json()
    assert (
        card["consent"] == "not_given"
        and "90 days" in card["consentText"]
        and "don't keep call recordings" in card["consentText"]
    )
    await c.post(f"/api/me/trust/consents/{S.PURPOSE}")
    await c.put(ME, json={"whatsapp": True, "call": False, "lang": "en", "quietDays": []})
    await toggle(client, session, cid, job["id"])
    await S.run(db, t=at(), force=True)
    await reply(client, "919876543210", text="yes")
    assert await db[TRUST_AGENT_LOGS].count_documents({"user_id": uid}) >= 3
    out = (await c.delete(f"/api/me/trust/consents/{S.PURPOSE}")).json()
    assert out["status"] == "withdrawn" and out["deleted"] >= 3
    assert await db[TRUST_AGENT_LOGS].count_documents({"user_id": uid}) == 0
    assert (await convo_of(db, uid, job["id"]))["state"] == "withdrawn"
    p = await db[TRUST_AGENT_PREFS].find_one({"_id": uid})
    assert p["whatsapp"] is False and p["call"] is False
    # nothing more is written or sent without the consent
    n = len(P.SENT)
    assert await reply(client, "919876543210", text="yes") == ["no_open_conversation"]
    assert await db[TRUST_AGENT_LOGS].count_documents({"user_id": uid}) == 0 and len(P.SENT) == n


async def test_retention_deletes_old_transcripts(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db)
    _, uid = await person(make_client, outbox, db, "asha@example.com", "98765 43210")
    await toggle(client, session, cid, job["id"])
    await S.run(db, t=at(), force=True)
    assert await db[TRUST_AGENT_LOGS].count_documents({"user_id": uid}) == 1
    keys = {x["key"]: x for x in await R.schedule(db)}
    assert keys["agent_logs"]["days"] == 90 and keys["agent_logs"]["purpose"] == S.PURPOSE and "agent_prefs" in keys
    await R.run(db, t=now() + timedelta(days=89), force=True)
    assert await db[TRUST_AGENT_LOGS].count_documents({"user_id": uid}) == 1
    await R.run(db, t=now() + timedelta(days=91), force=True)
    assert await db[TRUST_AGENT_LOGS].count_documents({"user_id": uid}) == 0
    assert await db[TRUST_AGENT_PREFS].find_one({"_id": uid})  # a Stop is never forgotten while the account exists
    erased = await R.erase_user(db, uid)
    assert erased["agent_prefs"] == 1 and erased["agent_contacts"] == 1


# --- the switch ----------------------------------------------------------------------------------------------------------------


async def test_switch_off_never_contacts_real_people(client, outbox, db, make_client):
    session, cid, job = await co(client, outbox, db, test=False)
    await agent_settings(db, min_score=0)
    # a real person who agreed (the switch went public for a moment), then the switch is hidden again
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": True}}, upsert=True)
    c, uid = await person(make_client, outbox, db, "real@example.com", "98765 43210", test=False)
    await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})
    await c.post(f"/api/me/trust/consents/{S.PURPOSE}")
    await c.put(ME, json={"whatsapp": True, "call": True, "lang": "en", "quietDays": []})
    await toggle(client, session, cid, job["id"])
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": False}})
    await S.run(db, t=at(), force=True)
    assert len(P.SENT) == 0 and await db[TRUST_AGENT_CONVOS].count_documents({}) == 0
    # a tester candidate still doesn't reach a real (non-test) company
    await make_tester(db, "real@example.com")
    await db[JOBS].update_one({"_id": job["id"]}, {"$set": {"agent.state": "pending"}})
    await S.run(db, t=at(), force=True)
    assert len(P.SENT) == 0
    # a test company (a tester on its team): now yes
    await make_tester(db, "founder@gmail.com")
    await db[JOBS].update_one({"_id": job["id"]}, {"$set": {"agent.state": "pending"}})
    await S.run(db, t=at(), force=True)
    assert len(P.SENT) == 1
    # an already-queued conversation is checked again before contact (the pairing changed): skipped, not contacted
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.testers": []}})
    await db[TRUST_AGENT_CONVOS].update_one({"user_id": uid}, {"$set": {"state": "queued", "next_at": at()}})
    await S.run(db, t=at(), force=True)
    assert len(P.SENT) == 1 and (await convo_of(db, uid, job["id"]))["state"] == "skipped"


async def test_test_providers_on_production_only_for_testers_and_real_providers_never_for_demo(monkeypatch):
    site = {"trust": {"testers": ["t@example.com"], "agent": {"whatsapp_provider": "mock"}}}
    monkeypatch.setattr(get_settings(), "app_env", "prod")
    assert S.whatsapp_for(site, {"email_lc": "x@example.com"}) is None and S.whatsapp_for(
        site, {"email_lc": "t@example.com"}
    )
    site["trust"]["agent"]["whatsapp_provider"] = "meta"
    assert S.whatsapp_for(site, {"email_lc": "t@example.com"}) is None  # no keys
    for k in ("whatsapp_access_token", "whatsapp_phone_number_id", "whatsapp_app_secret", "whatsapp_verify_token"):
        monkeypatch.setattr(get_settings(), k, "set")
    assert (
        S.whatsapp_for(site, {"email_lc": "x@example.com"}).key == "meta"
        and S.whatsapp_for(site, {"demo": True}) is None
    )


# --- reading replies with the AI ---------------------------------------------------------------------------------------------


async def test_ai_reads_unclear_replies_counted_and_rules_first(db, monkeypatch):
    with pytest.raises(claude.Unusable):
        understand.check({"intent": "maybe", "slot": 0})
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    assert await understand.intent(db, "u1", "theek hai kal baat karte", "interest") == ("unclear", 0, "none")
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    calls = []

    async def fake(text, expecting):
        calls.append(text)
        return "interested", 0

    monkeypatch.setattr(understand, "call_model", fake)
    assert await understand.intent(db, "u1", "band karo", "interest") == ("stop", 0, "rules") and calls == []
    assert await understand.intent(db, "u1", "theek hai, bataiye", "interest") == ("interested", 0, "ai")
    day = ai_quota.today()
    assert (await db[AI_USAGE].find_one({"_id": f"{day}|person|agent_reply|u1"}))["n"] == 1
    assert "name" not in understand.prompt("x", "interest").lower().split("reply:")[1]
    monkeypatch.setitem(ai_quota.PER_PERSON, "agent_reply", 0)
    assert await understand.intent(db, "u2", "theek hai, bataiye", "interest") == ("unclear", 0, "none")


# --- Admin ---------------------------------------------------------------------------------------------------------------


async def test_admin_keys_set_not_set_settings_counts_and_console(
    client, outbox, db, make_client, admin_client, monkeypatch
):
    owner = await admin_client()
    monkeypatch.setattr(get_settings(), "whatsapp_access_token", "EAAG_SECRET_TOKEN_VALUE")
    monkeypatch.setattr(get_settings(), "bolna_api_key", "bn-SECRET-KEY")
    d = (await owner.get("/api/admin/trust/agent")).json()
    blob = json.dumps(d)
    assert "EAAG_SECRET" not in blob and "bn-SECRET" not in blob
    meta_row = next(p for p in d["providers"]["whatsapp"] if p["key"] == "meta")
    assert meta_row["keys"] == {
        "WHATSAPP_ACCESS_TOKEN": True,
        "WHATSAPP_PHONE_NUMBER_ID": False,
        "WHATSAPP_APP_SECRET": False,
        "WHATSAPP_VERIFY_TOKEN": False,
    }
    assert meta_row["ready"] is False and d["settings"]["perJob"] == 30 and d["settings"]["quietFrom"] == "21:00"
    assert [t["lang"] for t in d["templates"]] == ["en", "hi", "te"] and all(
        t["category"] == "UTILITY" and t["buttons"][2] == "Stop" for t in d["templates"]
    )
    bad = await owner.put("/api/admin/trust/agent", json={**d["settings"], "quietFrom": "25:00"})
    assert bad.status_code == 422
    new = {**d["settings"], "perJob": 10, "perPersonDay": 1, "quietFrom": "20:30", "approved": {"en": True}}
    d = (await owner.put("/api/admin/trust/agent", json=new)).json()
    assert (
        d["settings"]["perJob"] == 10
        and d["settings"]["quietFrom"] == "20:30"
        and d["settings"]["approved"] == {"en": True, "hi": False, "te": False}
    )
    assert await db["audit_log"].find_one({"action": "trust.agent_settings"})
    # the test console plays the candidate's side
    session, cid, job = await co(client, outbox, db)
    await agent_settings(db, min_score=0)
    _, uid = await person(make_client, outbox, db, "asha@example.com", "98765 43210")
    await toggle(client, session, cid, job["id"])
    await S.run(db, t=at(), force=True)
    cv = await convo_of(db, uid, job["id"])
    r = (
        await owner.post("/api/admin/trust/agent/simulate", json={"convoId": cv["_id"], "button": "interested"})
    ).json()
    assert r["handled"] == "interested" and r["counts"]["d30"]["sent"] == 1 and r["counts"]["d30"]["replied"] == 1
    assert r["log"][0]["user"] == "asha@example.com" and any(x["id"] == cv["_id"] for x in r["conversations"])
    r = (await owner.post("/api/admin/trust/agent/simulate", json={"convoId": cv["_id"], "text": "STOP"})).json()
    assert r["handled"] == "stopped" and r["counts"]["d30"]["optOuts"] == 1
    await owner.put("/api/admin/trust/agent", json={**new, "whatsappProvider": "meta"})
    assert (
        await owner.post("/api/admin/trust/agent/simulate", json={"convoId": cv["_id"], "text": "yes"})
    ).status_code == 409


# --- the real adapters, against fake vendors ------------------------------------------------------------------------------


async def test_meta_adapter_request_shapes(monkeypatch):
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((str(req.url), req.headers.get("authorization"), json.loads(req.content)))
        return httpx.Response(200, json={"messages": [{"id": "wamid.REAL"}]})

    monkeypatch.setattr(meta, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(get_settings(), "whatsapp_access_token", "tok")
    monkeypatch.setattr(get_settings(), "whatsapp_phone_number_id", "12345")
    m = meta.MetaCloud()
    assert (
        await m.send_template(
            "919876543210",
            "te",
            ["Asha", "Analyst", "Acme", "Hyderabad"],
            ["nm7:a:interested", "nm7:a:not_now", "nm7:a:stop"],
        )
        == "wamid.REAL"
    )
    url, auth, body = seen[-1]
    assert url == "https://graph.facebook.com/v21.0/12345/messages" and auth == "Bearer tok"
    assert body["template"]["name"] == T.TEMPLATE_NAME and body["template"]["language"] == {"code": "te"}
    comps = body["template"]["components"]
    assert (
        comps[0]["parameters"][0] == {"type": "text", "text": "Asha"}
        and comps[3]["parameters"][0]["payload"] == "nm7:a:stop"
    )
    await m.send_text("919876543210", "Question 1", [("nm7:a:yes", "Yes"), ("nm7:a:no", "No")])
    assert seen[-1][2]["interactive"]["action"]["buttons"][1]["reply"] == {"id": "nm7:a:no", "title": "No"}

    def refuse(req):
        return httpx.Response(400, json={"error": {"code": 132001, "message": "template not approved"}})

    monkeypatch.setattr(meta, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(refuse)))
    with pytest.raises(P.SendError):
        await m.send_text("919876543210", "x")
    msgs, st = P.parse_meta({"entry": [{"changes": [{"value": {"messages": [{"from": "91", "id": "w1", "type": "interactive", "interactive": {"button_reply": {"id": "nm7:a:yes", "title": "Yes"}}}],
                                                                "statuses": [{"id": "w0", "status": "read"}]}}]}]})  # fmt: skip
    assert msgs[0].payload == "nm7:a:yes" and st[0].status == "read"


async def test_bolna_adapter(monkeypatch):
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(json.loads(req.content))
        return httpx.Response(200, json={"execution_id": "exec-1", "status": "queued"})

    monkeypatch.setattr(bolna, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(get_settings(), "bolna_agent_id", "agent-1")
    b = bolna.Bolna()
    assert await b.start_call("919876543210", "hi", {"intro": "Namaste", "questions": ["Q1?", "Q2?"]}, "c1") == "exec-1"
    assert (
        seen[0]["recipient_phone_number"] == "+919876543210" and seen[0]["user_data"]["questions"] == "1. Q1?\n2. Q2?"
    )
    res = b.parse({"id": "exec-1", "status": "completed", "conversation_duration": 90, "transcript": "assistant: Namaste\nuser: haan ji",
                   "extracted_data": {"interest": "Interested", "knockouts": {"q1": "Yes"}, "slot": "2"},
                   "telephony_data": {"recording_url": "https://x/rec.mp3"}})  # fmt: skip
    assert (
        res.status == "completed"
        and res.interest == "interested"
        and res.answers == {"q1": "yes"}
        and res.slot == 2
        and res.minutes == 1.5
    )
    assert res.transcript == [{"who": "agent", "text": "Namaste"}, {"who": "candidate", "text": "haan ji"}]
    assert "recording" not in json.dumps(res.__dict__)
    assert b.parse({"id": "e", "status": "no-answer"}).status == "no_answer"
