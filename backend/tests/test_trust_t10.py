# ruff: noqa: E501
"""Vetting Trust T10: the spoken-English score from the voice interview (score maths and band thresholds, the
pronunciation provider interface with the test provider and the "not measured" path, Azure's request and answer, audio
never stored unless Admin turns keeping on (then encrypted, with its retention), the voice consent required and its
withdrawal, the Hire now filter only on tagged role categories, English "verified (B2)" in the languages, anonymised AI
prompts, the AI allowance and the rules fallback, never an automatic rejection, and switch OFF isolation)."""

import base64
import json
import re
from datetime import timedelta

import httpx
import pytest
from bson import ObjectId

from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import AI_USAGE, AUDIT_LOG, JOBS, TRUST_SPOKEN, TRUST_SPOKEN_AUDIO, VETTING_INTERVIEWS
from app.core.security import decrypt
from app.core.time import now
from app.hire.vetting import interview as V3
from app.trust import retention as R
from app.trust.honesty import pledge as PL
from app.trust.spoken import azure as AZ
from app.trust.spoken import providers as P
from app.trust.spoken import score as S
from app.trust.spoken import service as SP
from tests.jobs_helpers import add_resume
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_hire_shortlist import READY
from tests.test_trust_t9 import badge, person, vetting_public  # noqa: F401

IV = "/api/me/interviews"
ME = "/api/me/trust/spoken"
ADMIN = "/api/admin/trust/spoken"
ANSWER = "I built a monthly sales report for a shop with SQL joins on orders and customers and shared it every Monday."
WAV = b"RIFF" + b"\x00" * 40 + b"WAVEfmt fake-pcm-audio" * 50


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def fake_claude(monkeypatch, grammar=70, comprehension=80):
    """Every Claude call: the spoken-English rating, the interview follow-up (none) and the interview grade."""
    seen = []
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")

    async def fake(feature, content, schema, check, *, stats=None, **opts):
        text = content[0]["text"]
        seen.append((feature, schema, text))
        if feature == "spoken":
            ids = re.findall(r"<<<(a\d+[af])\n", text)
            return check(
                {
                    "answers": [
                        {"id": i, "grammar": grammar, "comprehension": comprehension, "note": "Clear."} for i in ids
                    ]
                }
            )
        if schema is V3.FOLLOW_SCHEMA:
            return check({"ask": False, "follow_up": ""})
        return check({"scores": [{"key": k, "score": 4, "reason": "Specific.", "quote": "monthly sales report"} for k, *_ in V3.CRITERIA],
                      "strengths": ["a", "b", "c"], "concern": "None."})  # fmt: skip

    monkeypatch.setattr(claude, "ask_models", fake)
    return seen


async def ready(make_client, outbox, db, email, name="Asha Rao", consent=True, tester=True):
    c, uid = await person(make_client, outbox, db, email, name, tester=tester)
    await badge(db, uid, "SQL", answer="ok")  # a badge without a usable task answer: no T9 explain questions
    if tester:
        assert (await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})).status_code == 200
        if consent:
            assert (await c.post("/api/me/trust/consents/voice")).json()["status"] == "granted"
    return c, uid


async def start(c, **over):
    body = {"test": "SQL", "consent": True, "pledge": PL.VERSION, "mode": "voice", "lang": "en", "spoken": True, **over}
    return await c.post(f"{IV}/start", json=body)


async def run_interview(c, iv, text=ANSWER, clips=True, audio=WAV, first=None, typed=False):
    while iv["status"] == "running":
        turn = iv["asking"]["n"] - 1
        part = "follow" if iv["asking"]["followUp"] else "answer"
        say = first if (first and turn == 0) else text
        if clips:
            r = await c.post(
                f"{ME}/{iv['id']}/clip", json={"turn": turn, "part": part, "audio": b64(audio), "text": say}
            )
            assert r.status_code == 200, r.text
        iv = (
            await c.post(
                f"{IV}/{iv['id']}/answer",
                json={"text": say, "seconds": 20, "speechMs": 9000, "pauses": 0, "typed": typed},
            )
        ).json()
    return (await c.post(f"{IV}/{iv['id']}/finish")).json()


# --- the maths ---------------------------------------------------------------------------------------------------------


def test_bands_thresholds_overall_and_descriptions():
    for v, b in [(0, "A1"), (29, "A1"), (30, "A2"), (44, "A2"), (45, "B1"), (59, "B1"), (60, "B2"), (74, "B2"),
                 (75, "C1"), (89, "C1"), (90, "C2"), (100, "C2")]:  # fmt: skip
        assert S.band_of(v) == b, v
    assert S.band_of(None) is None and set(S.BAND_TEXT) == set(S.BAND_KEYS)
    assert (
        S.at_least("B2", "B1") and S.at_least("B1", "B1") and not S.at_least("A2", "B1") and not S.at_least(None, "A1")
    )
    # pronunciation not measured: the mean of the other three; any of the other three missing: no overall
    assert S.overall_of({"pronunciation": None, "fluency": 90, "grammar": 60, "comprehension": 75}) == 75
    assert S.overall_of({"pronunciation": 100, "fluency": 90, "grammar": 60, "comprehension": 75}) == 81
    assert S.overall_of({"pronunciation": 100, "fluency": None, "grammar": 60, "comprehension": 75}) is None


def test_fluency_from_timing_pauses_and_fillers():
    a = lambda text, ms, pauses=0: {"text": text, "seconds": 60, "speech_ms": ms, "pauses": pauses}  # noqa: E731
    words_130 = " ".join(["word"] * 130)
    f = S.fluency([a(words_130, 60_000)])
    assert f["wpm"] == 130 and f["score"] == 100 and f["timing"] == "speech"
    assert S.fluency([a(" ".join(["word"] * 40), 60_000)])["score"] == 20  # 40 a minute
    assert S.fluency([a(" ".join(["word"] * 80), 60_000)])["score"] == 60
    assert S.fluency([a(" ".join(["word"] * 300), 60_000)])["score"] == 60  # very fast is not punished below 60
    # long pauses: 2 a minute are free, then 6 points each
    assert S.fluency([a(words_130, 60_000, pauses=2)])["score"] == 100
    assert S.fluency([a(words_130, 60_000, pauses=5)])["score"] == 82
    # fillers: 2 per 100 words are free, then 4 points each
    um = " ".join(["word"] * 120 + ["um"] * 10)
    assert S.fluency([a(um, 60_000)])["fillersPer100"] == 7.7 and S.fluency([a(um, 60_000)])["score"] == 77
    # without speech timing, the whole answer time
    assert S.fluency([{"text": words_130, "seconds": 120}])["timing"] == "answer"


def test_pronunciation_is_intelligibility_and_english_only():
    assert S.pronunciation([]) is None
    assert (
        S.pronunciation([80]) == 100 and S.pronunciation([88, 95]) == 100
    )  # clear is clear: an accent earns nothing and costs nothing
    assert S.pronunciation([40]) == 50 and S.pronunciation([60, 70]) == 81
    assert S.is_english(ANSWER) and S.is_english("I am having experience in customer care, I will do the needful.")
    assert not S.is_english("मैं ग्राहक से बात करता हूँ और उनकी ज़रूरत समझता हूँ")  # Hindi: left out, never marked down
    assert not S.is_english("nenu customer tho matladatanu, valla avasaram ardham chesukuntanu")  # romanised Telugu
    assert not S.is_english("ok")


def test_rules_fallback_never_above_75_and_indian_english_is_not_an_error():
    good = [{"text": ANSWER, "q": "Tell us about a report you made.", "looks_for": "SQL reporting"}] * 3
    assert S.rules_grammar(good) == 75 and S.rules_comprehension(good) <= 75
    indian = [
        {
            "text": "Kindly do the needful, I will prepone the meeting itself and revert only after checking the orders.",
            "q": "",
            "looks_for": "",
        }
    ] * 3
    assert S.slips(indian[0]["text"]) == 0 and S.rules_grammar(indian) == 75
    bad = [
        {
            "text": "I is working here and he have many customer, they was happy and it more better now for the shop.",
            "q": "",
            "looks_for": "",
        }
    ] * 3
    assert S.slips(bad[0]["text"]) == 4 and S.rules_grammar(bad) < 40
    assert S.rules_comprehension_one("Tell us about a report you made.", "", "ok") == 10
    assert S.rules_comprehension_one("Describe a monthly report.", "reporting", ANSWER) >= 55


# --- providers ------------------------------------------------------------------------------------------------------------


async def test_mock_provider_and_azure_request_and_answer(monkeypatch):
    m = P.Mock()
    a = await m.assess(WAV, "hello there")
    assert a.accuracy == 88 and a.ref.startswith("mock-") and a.ref == (await m.assess(WAV, "x")).ref  # deterministic
    assert (await m.assess(WAV + b"MOCK:UNCLEAR", "x")).accuracy == 45
    with pytest.raises(P.ProviderError):
        await m.assess(b"MOCK:FAIL", "x")
    with pytest.raises(P.ProviderError):
        await P.NoProvider().assess(WAV, "x")
    assert set(P.registry()) == {"none", "mock", "azure"} and not P.get("azure").ready()

    monkeypatch.setattr(get_settings(), "azure_speech_key", "AZ-SECRET-KEY-123")
    monkeypatch.setattr(get_settings(), "azure_speech_region", "centralindia")
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(url=str(req.url), headers=dict(req.headers), body=req.content)
        return httpx.Response(200, json={"RecognitionStatus": "Success", "Offset": 1, "Duration": 2, "Id": "az-ref-1",
                                         "NBest": [{"Lexical": "hello there", "PronunciationAssessment": {"AccuracyScore": 91.5, "FluencyScore": 80, "CompletenessScore": 100, "PronScore": 88}}]})  # fmt: skip

    monkeypatch.setattr(AZ, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    got = await AZ.Azure().assess(WAV, "hello there")
    assert got.accuracy == 91.5 and got.ref == "az-ref-1" and got.words == 2
    assert seen["url"].startswith("https://centralindia.stt.speech.microsoft.com/") and "language=en-IN" in seen["url"]
    assert seen["headers"]["ocp-apim-subscription-key"] == "AZ-SECRET-KEY-123" and seen["body"] == WAV
    cfg = json.loads(base64.b64decode(seen["headers"]["pronunciation-assessment"]))
    assert cfg["ReferenceText"] == "hello there" and cfg["GradingSystem"] == "HundredMark"
    # the older flat answer shape, and failures
    assert AZ.parse({"RecognitionStatus": "Success", "NBest": [{"AccuracyScore": 70}]}).accuracy == 70
    for bad in ({"RecognitionStatus": "NoMatch"}, {"RecognitionStatus": "Success", "NBest": [{}]}):
        with pytest.raises(P.ProviderError):
            AZ.parse(bad)
    monkeypatch.setattr(
        AZ, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401)))
    )
    with pytest.raises(P.ProviderError):
        await AZ.Azure().assess(WAV, "x")


# --- the voice interview → the score --------------------------------------------------------------------------------------


async def test_voice_interview_gives_a_band_with_four_sub_scores_and_stores_no_audio(
    outbox, db, make_client, monkeypatch
):
    seen = fake_claude(monkeypatch)
    c, uid = await ready(make_client, outbox, db, "asha.t10@example.com", "Asha Rao")
    iv = (await start(c)).json()
    assert iv["spoken"] == {"on": True, "audio": True}
    res = await run_interview(c, iv, first=f"I am Asha Rao, mail asha.t10@example.com. {ANSWER}")
    # the interview itself is graded exactly as before: the band never changes the score or the pass
    assert res["status"] == "graded" and res["passed"] is True and res["average"] == 4.0
    row = await db[TRUST_SPOKEN].find_one({"_id": ObjectId(iv["id"])})
    assert row["band"] == "C1" and row["subs"] == {
        "pronunciation": 100,
        "fluency": 100,
        "grammar": 70,
        "comprehension": 80,
    }
    assert row["overall"] == 88 and row["by"] == "ai" and row["provider"] == "mock" and len(row["provider_refs"]) == 7
    assert 140 <= row["fluency"]["wpm"] <= 160 and row["fluency"]["timing"] == "speech"
    assert await db[TRUST_SPOKEN_AUDIO].count_documents({}) == 0  # the clips went to the provider and were dropped
    stored = await db[VETTING_INTERVIEWS].find_one({"user_id": uid})
    assert stored["turns"][0]["timing"] == {"speech_ms": 9000, "pauses": 0, "typed": False}
    # the AI saw anonymised answers and the questions only, and it was counted
    prompts = [t for f, s, t in seen if f == "spoken"]
    assert (
        len(prompts) == 1
        and "Asha" not in prompts[0]
        and "asha.t10@example.com" not in prompts[0]
        and "[removed]" in prompts[0]
    )
    assert "Indian-English usage is correct English" in prompts[0]
    day = ai_quota.today()
    assert (await db[AI_USAGE].find_one({"_id": f"{day}|person|spoken|{uid}"}))["n"] == 1
    # the candidate: the band, the sub-scores, how it was measured, the retake path (the interview's T9 limits)
    me = (await c.get(ME)).json()
    s = me["score"]
    assert (
        s["band"] == "C1" and s["bandText"].startswith("Advanced") and s["source"] == "Measured by Nm7 voice interview"
    )
    assert [x["key"] for x in s["subs"]] == list(S.SUBS) and all(x["measured"] for x in s["subs"]) and s["note"] == ""
    assert (
        "words a minute" in s["subs"][1]["detail"]
        and me["consent"] is True
        and any("accent never lowers" in h for h in me["how"])
    )
    assert me["retake"]["rule"] and me["retake"]["canStart"] is False and me["retake"]["nextAt"]
    one = (await c.get(f"{IV}/{iv['id']}")).json()
    assert one["spokenEnglish"]["band"] == "C1"
    # T6 languages: English verified (C1)
    work = (await c.get("/api/me/trust/work")).json()
    assert work["verified"]["English"] == {
        "band": "C1",
        "label": "verified (C1)",
        "source": "Measured by Nm7 voice interview",
    }


async def test_pronunciation_not_measured_without_a_provider(outbox, db, make_client, monkeypatch, admin_client):
    fake_claude(monkeypatch)
    owner = await admin_client()
    r = await owner.put(ADMIN, json={"provider": "none", "categories": SP.DEFAULT_TAGGED, "keepAudio": False})
    assert r.status_code == 200 and r.json()["provider"] == "none"
    c, uid = await ready(make_client, outbox, db, "ravi.t10@example.com", "Ravi Kumar")
    iv = (await start(c)).json()
    assert iv["spoken"] == {"on": True, "audio": False}  # the page doesn't record
    r = await c.post(f"{ME}/{iv['id']}/clip", json={"turn": 0, "part": "answer", "audio": b64(WAV), "text": ANSWER})
    assert r.json() == {"measured": False}
    await run_interview(c, iv, clips=False)
    s = (await c.get(ME)).json()["score"]
    assert s["subs"][0] == {
        "key": "pronunciation",
        "label": S.SUB_LABEL["pronunciation"],
        "score": None,
        "measured": False,
        "detail": "Not measured",
    }
    assert s["band"] == "C1" and s["overall"] == 83 and s["note"] == S.NOT_MEASURED  # (100 + 70 + 80) / 3
    # the Azure adapter without a key counts as not configured too
    await owner.put(ADMIN, json={"provider": "azure", "categories": SP.DEFAULT_TAGGED})
    from app.site import get_site

    assert await SP.provider_for(db, uid, await get_site(db)) is None


async def test_provider_failure_and_unclear_speech(outbox, db, make_client, monkeypatch):
    fake_claude(monkeypatch)
    c, uid = await ready(make_client, outbox, db, "meena.t10@example.com", "Meena S")
    iv = (await start(c)).json()
    r = await c.post(
        f"{ME}/{iv['id']}/clip", json={"turn": 0, "part": "answer", "audio": b64(WAV + b"MOCK:FAIL"), "text": ANSWER}
    )
    assert r.json() == {"measured": False}
    # a clip for a question not reached yet, and the same answer twice
    assert (
        err(await c.post(f"{ME}/{iv['id']}/clip", json={"turn": 5, "part": "answer", "audio": b64(WAV), "text": ""}))
        == "bad_turn"
    )
    assert (
        await c.post(f"{ME}/{iv['id']}/clip", json={"turn": 0, "part": "answer", "audio": b64(WAV), "text": ""})
    ).json() == {"measured": False}
    assert (
        err(
            await c.post(
                f"{ME}/{iv['id']}/clip", json={"turn": 0, "part": "answer", "audio": "@@not-base64@@", "text": ""}
            )
        )
        == "bad_audio"
    )
    await run_interview(c, iv, clips=False)
    row = await db[TRUST_SPOKEN].find_one({"user_id": uid})
    assert row["clips"][0]["error"] == "provider" and row["subs"]["pronunciation"] is None
    # unclear speech lowers pronunciation (intelligibility), on another interview
    c2, uid2 = await ready(make_client, outbox, db, "kiran.t10@example.com", "Kiran P")
    iv2 = (await start(c2)).json()
    await run_interview(c2, iv2, audio=WAV + b"MOCK:UNCLEAR")
    assert (await db[TRUST_SPOKEN].find_one({"user_id": uid2}))["subs"]["pronunciation"] == 56  # 45 / 0.8


async def test_keeping_clips_is_off_by_default_then_encrypted_with_retention_and_withdrawal_deletes(
    outbox, db, make_client, monkeypatch, admin_client
):
    fake_claude(monkeypatch)
    owner = await admin_client()
    d = (await owner.get(ADMIN)).json()
    assert d["keepAudio"] is False and d["keepDays"] == 7 and d["provider"] == "mock"
    sched = {x["key"]: x for x in (await owner.get("/api/admin/trust")).json()["retention"]}
    assert sched["spoken_audio"]["days"] == 7 and (
        sched["spoken_audio"]["minDays"],
        sched["spoken_audio"]["maxDays"],
    ) == (1, 30)
    assert sched["spoken_scores"]["purpose"] == "voice" and sched["spoken_audio"]["purpose"] == "voice"
    await owner.put(ADMIN, json={"provider": "mock", "categories": SP.DEFAULT_TAGGED, "keepAudio": True})
    assert await db[AUDIT_LOG].find_one({"action": "trust.spoken_settings"})
    c, uid = await ready(make_client, outbox, db, "lata.t10@example.com", "Lata R")
    iv = (await start(c)).json()
    await run_interview(c, iv)
    kept = await db[TRUST_SPOKEN_AUDIO].find({"user_id": uid}).to_list(20)
    assert (
        len(kept) == 7 and "audio" not in kept[0] and base64.b64decode(decrypt(kept[0]["audio_enc"])) == WAV
    )  # encrypted
    # the retention job deletes clips older than the Admin days (7)
    await db[TRUST_SPOKEN_AUDIO].update_many({"user_id": uid}, {"$set": {"created_at": now() - timedelta(days=8)}})
    counts = await R.run(db, force=True)
    assert counts["spoken_audio"] == 7 and await db[TRUST_SPOKEN_AUDIO].count_documents({}) == 0
    # taking the voice consent back deletes the scores (and any clips) now
    assert await db[TRUST_SPOKEN].count_documents({"user_id": uid}) == 1
    r = (await c.delete("/api/me/trust/consents/voice")).json()
    assert r["status"] == "withdrawn" and await db[TRUST_SPOKEN].count_documents({"user_id": uid}) == 0
    assert (await c.get(ME)).json()["score"] is None


async def test_voice_consent_required_and_only_english_voice_interviews(outbox, db, make_client, monkeypatch):
    fake_claude(monkeypatch)
    c, uid = await ready(make_client, outbox, db, "nisha.t10@example.com", "Nisha T", consent=False)
    r = await start(c)
    assert r.status_code == 403 and err(r) == "consent_needed"
    assert (await c.post("/api/me/trust/consents/voice")).json()["status"] == "granted"
    # typed, or in Hindi: nothing measured (no flag, no timing kept)
    iv = (await start(c, mode="text")).json()
    assert "spoken" not in iv
    await db[VETTING_INTERVIEWS].delete_many({"user_id": uid})
    # a voice interview where most answers are not English: not enough English speech, no band
    iv = (await start(c)).json()
    hindi = "मैं ग्राहक से बात करता हूँ और उनकी ज़रूरत समझता हूँ, फिर सही फ़ोन दिखाता हूँ"
    await run_interview(c, iv, text=hindi, first=ANSWER, clips=False)
    s = (await c.get(ME)).json()["score"]
    assert s["band"] is None and "Not enough English speech" in s["reason"]
    assert (await c.get("/api/me/trust/work")).json()["verified"] == {}
    # answers typed on a browser without speech don't count either
    row = await db[TRUST_SPOKEN].find_one({"user_id": uid})
    assert row["answers"] == 1


async def test_rules_fallback_without_ai_and_when_the_allowance_is_used_up(outbox, db, make_client, monkeypatch):
    c, uid = await ready(make_client, outbox, db, "omar.t10@example.com", "Omar K")
    iv = (await start(c)).json()
    await run_interview(c, iv)  # no AI key: the interview goes to review, the score uses rules
    row = await db[TRUST_SPOKEN].find_one({"user_id": uid})
    assert row["by"] == "rules" and row["subs"]["grammar"] <= 75 and row["subs"]["comprehension"] <= 75 and row["band"]
    assert (await db[VETTING_INTERVIEWS].find_one({"user_id": uid}))["status"] == "review"
    # with a key but the allowance used up: rules, and the AI is not called for it
    seen = fake_claude(monkeypatch)
    monkeypatch.setitem(ai_quota.PER_PERSON, "spoken", 0)
    c2, uid2 = await ready(make_client, outbox, db, "priya.t10@example.com", "Priya N")
    iv2 = (await start(c2)).json()
    await run_interview(c2, iv2)
    assert (await db[TRUST_SPOKEN].find_one({"user_id": uid2}))["by"] == "rules" and not [
        1 for f, *_ in seen if f == "spoken"
    ]


# --- Hire now ----------------------------------------------------------------------------------------------------------------


async def scored(db, uid, band, overall, pron=90):
    t = now()
    await db[TRUST_SPOKEN].insert_one({"user_id": uid, "test": "SQL", "created_at": t, "at": t, "band": band, "overall": overall, "by": "ai",
                                       "subs": {"pronunciation": pron, "fluency": overall, "grammar": overall, "comprehension": overall},
                                       "fluency": {"wpm": 120, "pausesPerMin": 1, "fillersPer100": 0}, "provider": "mock"})  # fmt: skip


async def hire_person(make_client, outbox, db, email, name, langs):
    c, uid = await person(make_client, outbox, db, email, name)
    await add_resume(c)
    assert (await c.put("/api/me/hire", json=READY)).status_code == 200
    assert (await c.put("/api/me/trust/work", json={"languages": langs})).status_code == 200
    return uid


async def test_hire_now_filter_only_on_tagged_roles_never_a_gate(client, outbox, db, make_client, admin_client):
    session, cid = await verified(client, outbox, db)
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "founder@gmail.com"}}, upsert=True)
    support = (
        await client.post(
            f"/api/company/{cid}/jobs", json={"job": {**JOB, "title": "Customer Support Executive"}}, headers=H(session)
        )
    ).json()["id"]
    analyst = (
        await client.post(
            f"/api/company/{cid}/jobs",
            json={"job": {**JOB, "title": "Junior Data Analyst", "locations": ["Hyderabad", "Pune"]}},
            headers=H(session),
        )
    ).json()["id"]
    assert SP.categories_of(await db[JOBS].find_one({"_id": support})) == ["customer_support"]
    assert SP.categories_of({"title": "Telecaller (voice process)"}) == ["call_centre"] and SP.categories_of(
        {"title": "Retail Store Associate"}
    ) == ["retail"]
    asha = await hire_person(make_client, outbox, db, "asha.h10@example.com", "Asha Rao", ["Telugu", "English"])
    bala = await hire_person(make_client, outbox, db, "bala.h10@example.com", "Bala K", ["Hindi"])
    chitra = await hire_person(make_client, outbox, db, "chitra.h10@example.com", "Chitra M", ["English"])
    await scored(db, asha, "B2", 70)
    await scored(db, bala, "A2", 40, pron=None)

    async def get(job, **q):
        r = await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job, **q}, headers=H(session))
        assert r.status_code == 200, r.text
        return r.json()

    keys = lambda o: sorted(x["key"] for x in o["items"])  # noqa: E731
    out = await get(support)
    # nobody is hidden unless the company chooses the filter
    assert (
        out["available"] == 3 and out["nonTech"]["englishFilter"] is True and out["nonTech"]["counts"]["english"] == 1
    )
    rows = {x["key"]: x["nonTech"] for x in out["items"]}
    e = rows[asha]["english"]
    assert (
        e["band"] == "B2"
        and e["source"] == "Measured by Nm7 voice interview"
        and [s["key"] for s in e["subs"]] == list(S.SUBS)
    )
    assert "by" not in json.dumps(e["subs"]) and "provider" not in e
    assert rows[asha]["languages"][0] == {
        "name": "English",
        "source": "verified",
        "band": "B2",
        "label": "verified (B2)",
    }
    assert [x["name"] for x in rows[asha]["languages"]] == [
        "English",
        "Telugu",
    ]  # declared English is replaced, not doubled
    assert rows[bala]["languages"][0]["label"] == "verified (A2)" and rows[bala]["english"]["note"] == S.NOT_MEASURED
    assert rows[chitra]["english"] is None and rows[chitra]["languages"] == [
        {"name": "English", "source": "self-declared"}
    ]
    assert keys(await get(support, english="B1")) == [asha]
    assert keys(await get(support, english="A2")) == sorted([asha, bala])
    assert keys(await get(support, english="C1")) == []
    # the filter on an untagged role is ignored (and not offered), the facts are still there
    an = await get(analyst, english="C1")
    assert (
        an["available"] == 3 and an["nonTech"]["englishFilter"] is False and an["nonTech"]["counts"]["english"] is None
    )
    assert an["nonTech"]["filters"]["english"] == ""
    # Admin decides which categories get the filter
    owner = await admin_client()
    await owner.put(ADMIN, json={"provider": "mock", "categories": ["it"]})
    assert (await get(analyst, english="C1"))["available"] == 0
    assert (await get(support, english="C1"))["available"] == 3
    assert (await owner.put(ADMIN, json={"provider": "mock", "categories": ["astrology"]})).status_code == 422


# --- admin, switch OFF -----------------------------------------------------------------------------------------------------


async def test_admin_keys_set_not_set_counts_and_unknown_provider(db, admin_client, monkeypatch):
    owner = await admin_client()
    monkeypatch.setattr(get_settings(), "azure_speech_key", "AZ-VERY-SECRET")
    d = (await owner.get(ADMIN)).json()
    az = next(p for p in d["providers"] if p["key"] == "azure")
    assert az["keys"] == {"AZURE_SPEECH_KEY": True, "AZURE_SPEECH_REGION": True} and az["ready"] is True
    assert "AZ-VERY-SECRET" not in json.dumps(d)
    assert set(d["categories"]) == set(SP.DEFAULT_TAGGED) and len(d["allCategories"]) == len(SP.CATEGORIES)
    assert d["counts"]["scored"] == 0 and set(d["counts"]["bands"]) == set(S.BAND_KEYS)
    await scored(db, "u1", "B1", 50, pron=None)
    d = (await owner.get(ADMIN)).json()
    assert (
        d["counts"]["scored"] == 1 and d["counts"]["bands"]["B1"] == 1 and d["counts"]["pronunciationNotMeasured"] == 1
    )
    assert (await owner.put(ADMIN, json={"provider": "elevenlabs"})).status_code == 422


async def test_switch_off_nothing_new(outbox, db, make_client, monkeypatch, client):
    seen = fake_claude(monkeypatch)
    c, uid = await ready(make_client, outbox, db, "zara.t10@example.com", "Zara Off", tester=False)
    assert (await c.get(ME)).status_code == 404
    assert "spoken" not in (await c.get(f"{IV}/roles")).json()
    iv = (
        await c.post(
            f"{IV}/start", json={"test": "SQL", "consent": True, "mode": "voice", "lang": "en", "spoken": True}
        )
    ).json()
    assert "spoken" not in iv
    r = await c.post(f"{ME}/{iv['id']}/clip", json={"turn": 0, "part": "answer", "audio": b64(WAV), "text": ""})
    assert r.status_code == 404
    res = await run_interview(c, iv, clips=False)
    assert res["status"] == "graded" and "spokenEnglish" not in (await c.get(f"{IV}/{iv['id']}")).json()
    stored = await db[VETTING_INTERVIEWS].find_one({"user_id": uid})
    assert "timing" not in stored["turns"][0] and "spoken" not in stored
    assert await db[TRUST_SPOKEN].count_documents({}) == 0 and not [1 for f, *_ in seen if f == "spoken"]
    # a company the switch is off for: no non-tech block at all (as in T6)
    session, cid = await verified(client, outbox, db)
    job = (
        await client.post(
            f"/api/company/{cid}/jobs", json={"job": {**JOB, "title": "Customer Support Executive"}}, headers=H(session)
        )
    ).json()["id"]
    out = (
        await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job, "english": "B1"}, headers=H(session))
    ).json()
    assert "nonTech" not in out
