# ruff: noqa: E501
"""Vetting Trust T15: typing, situational-judgement and aptitude tests in English / Hindi / Telugu, and the reliability
record (bank validation incl. the EN / HI / TE forms; typing WPM / accuracy maths incl. Indic scripts; paste and timing
flagged as T8 signals; the SJT scoring key; aptitude graded deterministically, timed by the server; form rotation and
the T9 pledge + retake limits; badges and the Hire now filters; reliability events from attendance, joining and the
day 30 / 90 questions; the 48-hour window before a no-show counts; disputes → Admin review; the consent required;
"No history yet" never negative and never filterable-out; switch OFF isolation)."""

import copy
import json
import re
from datetime import timedelta

import pytest
from bson import ObjectId

from app.core.db import HIRE_OFFERS, HIRE_SLOTS, TRUST_RELIABILITY, TRUST_WORKTESTS
from app.core.time import IST, now
from app.trust import consent as C
from app.trust import retention as R
from app.trust.honesty import pledge as PL
from app.trust.integrity import signals as SG
from app.trust.reliability import service as REL
from app.trust.worktests import banks as B
from app.trust.worktests import hire as WH
from app.trust.worktests import scoring as S
from app.trust.worktests import service as WS
from tests.jobs_helpers import add_resume
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_hire_shortlist import READY
from tests.test_trust_t9 import person, vetting_public  # noqa: F401

W = "/api/me/trust/worktests"
ME_REL = "/api/me/trust/reliability"
PUB = "/api/public/trust/rel"
ADMIN = "/api/admin/trust/worktests"


@pytest.fixture(autouse=True)
def fresh_norms():
    WS.reset_norms()
    yield
    WS.reset_norms()


def token_in(text: str, k: str) -> str:
    m = re.search(rf"/stop-alerts#k={k}&t=([A-Za-z0-9._-]+)", text)
    assert m, text
    return m.group(1)


async def consent(c, purpose="reliability_record"):
    assert (await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})).status_code == 200
    assert (await c.post(f"/api/me/trust/consents/{purpose}")).json()["status"] == "granted"


# --- 1. the banks ----------------------------------------------------------------------------------------------------


def test_banks_valid_two_forms_each_in_english_hindi_and_telugu():
    for t in B.TESTS:
        bank = B.load(t)
        assert B.validate(t, bank) == []
        assert len(bank["forms"]) >= 2
        for f in bank["forms"]:
            if t == "typing":
                assert set(f["passages"]) == {"en", "hi", "te"}
                assert B.SCRIPT["hi"].search(f["passages"]["hi"]) and B.SCRIPT["te"].search(f["passages"]["te"])
            else:
                lo, hi = B.SJT_ITEMS if t == "sjt" else B.APT_ITEMS
                assert lo <= len(f["items"]) <= hi
                for it in f["items"]:
                    assert B.SCRIPT["hi"].search(it["hi"]["q"]) and B.SCRIPT["te"].search(it["te"]["q"])
    sjt = B.load("sjt")
    assert {it["role"] for f in sjt["forms"] for it in f["items"]} >= {
        "customer_support",
        "retail",
        "delivery",
        "front_office",
        "sales",
        "field_work",
        "warehouse",
    }
    # the two forms of each test share no item (rotation gives other questions)
    for t in ("sjt", "aptitude"):
        a, b = (set(it["id"] for it in f["items"]) for f in B.load(t)["forms"][:2])
        assert not a & b
    assert all(s["ok"] for s in B.summary())


def test_validator_catches_problems():
    sjt = copy.deepcopy(B.read("sjt"))
    it = sjt["forms"][0]["items"][0]
    it["worst"] = it["best"]
    it["te"]["q"] = "An English sentence only"
    del sjt["forms"][1]["items"][0]["hi"]
    sjt["forms"][1]["items"][1]["options"] = ["a", "b", "c"]
    sjt["forms"][1]["items"][2]["options"][3] = "None of the above"
    p = " | ".join(B.validate("sjt", sjt))
    assert (
        "must be different" in p
        and "not in Telugu script" in p
        and "missing the Hindi version" in p
        and "needs 4 options" in p
        and "all / none" in p
    )
    one = copy.deepcopy(B.read("aptitude"))
    one["forms"] = one["forms"][:1]
    one["forms"][0]["items"] = one["forms"][0]["items"][:12]
    verbal = next(x for x in one["forms"][0]["items"] if x["section"] == "verbal")
    verbal["hi"]["options"] = ["late", "fast", "soon", "quick"]
    p = " | ".join(B.validate("aptitude", one))
    assert "at least 2 forms" in p and "needs 15–20 items" in p and "verbal options must be in Hindi" in p
    ty = copy.deepcopy(B.read("typing"))
    ty["forms"][0]["passages"]["te"] = (
        "Telugu passage typed in English letters by mistake, which is not allowed in this bank at all, no."
    )
    ty["forms"][1]["passages"].pop("hi")
    p = " | ".join(B.validate("typing", ty))
    assert "Telugu script only" in p and "missing the Hindi passage" in p


# --- 2. typing maths ---------------------------------------------------------------------------------------------------


def test_typing_wpm_and_accuracy_maths():
    passage = "The van leaves at seven. Scan each code."
    exact = S.typing(passage, passage, 30_000, 31_000)
    n = len(passage)
    assert exact["chars"] == n and exact["errors"] == 0 and exact["accuracy"] == 100.0 and exact["completed"]
    assert exact["wpm"] == round(n / 5 / 0.5) and exact["flags"] == []
    # two wrong characters: accuracy and the net speed drop; stopping early is not an error
    typo = S.typing(passage, "The vam leaves at sevn", 30_000, 31_000)
    assert typo["errors"] == 2 and typo["accuracy"] == round(100 * (22 - 2) / 22, 1) and not typo["completed"]
    assert typo["wpm"] == round(22 / 5 / 0.5 * (20 / 22))
    assert S.typing(passage, "The van", 10_000, 11_000)["errors"] == 0
    assert S.prefix_distance("", passage) == 0 and S.prefix_distance("Teh", "The van") == 1  # "Th" + one extra letter
    # levels: 90% accuracy needed; steps 45 / 35 / 25 / 15
    assert S.typing_level(38, 96) == 35 and S.typing_level(50, 89.9) is None and S.typing_level(12, 99) is None
    assert S.typing_label(35, "hi") == "Typing 35 wpm+ (Hindi)"


def test_typing_indic_scripts_count_code_points_after_nfc_and_without_zero_width_joiners():
    hi = "नमस्ते दुनिया"  # न म स ् त े · द ु न ि य ा = 13 code points with the space
    assert len(S.norm(hi)) == 13
    r = S.typing(hi, hi, 6_000, 7_000)
    assert r["chars"] == 13 and r["wpm"] == round(13 / 5 / 0.1) and r["accuracy"] == 100.0
    te = "మేనేజర్‌కి చెప్పండి"  # with a zero-width non-joiner, as many Telugu keyboards type it
    plain = te.replace("‌", "")
    assert S.norm(te) == S.norm(plain) and S.typing(te, plain, 10_000, 11_000)["errors"] == 0
    # a decomposed vowel sign is the same character after NFC
    decomposed = "क़"  # क + nukta → क़
    assert S.norm(decomposed) == S.norm("क़") or len(S.norm(decomposed)) == 2
    # one missing vowel sign is one error
    assert S.typing("चालू करें", "चाल करें", 5_000, 6_000)["errors"] == 1


def test_typing_paste_and_timing_flags():
    passage = B.form("typing", "typing-a")["passages"]["en"]
    pasted = S.typing(passage, passage, 60_000, 61_000, pasted=100)
    full = S.typing(passage, passage, 60_000, 61_000)
    assert "typing_paste" in pasted["flags"] and pasted["wpm"] == round((len(passage) - 100) / 5)
    assert full["wpm"] == round(len(passage) / 5)
    longer = S.typing(passage, passage[:60], 90_000, 20_000)  # the page claims more time than the server saw
    assert "typing_timing" in longer["flags"] and longer["seconds"] == 20.0
    fast = S.typing(passage, passage, 15_000, 16_000)  # 4× the passage a minute: nobody types 200 wpm
    assert "typing_timing" in fast["flags"]


async def test_typing_flow_hindi_with_pledge_paste_signal_and_t8(outbox, db, make_client):
    c, uid = await person(make_client, outbox, db, "ty.t15@example.com", "Asha Rao")
    assert err(await c.post(f"{W}/start", json={"test": "typing", "lang": "hi"})) == "pledge"  # T9
    p = (await c.post(f"{W}/start", json={"test": "typing", "lang": "hi", "pledge": PL.VERSION})).json()
    assert B.SCRIPT["hi"].search(p["passage"]) and p["seconds"] == 90
    assert (await c.post(f"{W}/start", json={"test": "typing", "lang": "hi", "pledge": PL.VERSION})).json()["id"] == p[
        "id"
    ]  # carry on
    await db[TRUST_WORKTESTS].update_one(
        {"_id": ObjectId(p["id"])}, {"$set": {"started_at": now() - timedelta(seconds=70)}}
    )
    r = (
        await c.post(
            f"{W}/{p['id']}/submit",
            json={"typed": p["passage"], "ms": 60_000, "inputs": len(p["passage"]), "pasteAttempts": 2},
        )
    ).json()
    n = len(S.norm(p["passage"]))
    assert r["wpm"] == round(n / 5) and r["accuracy"] == 100.0 and r["lang"] == "hi"
    assert (
        r["badge"] == S.typing_label(S.typing_level(round(n / 5), 100), "hi") and r["flags"]
    )  # a blocked paste: a plain line, still graded
    stored = await db[TRUST_WORKTESTS].find_one({"_id": ObjectId(p["id"])})
    assert stored["flags"] == ["typing_paste"] and stored["pledge"]["version"] == PL.VERSION and "typed" not in stored
    sig = (await SG.collect(db, [uid], now()))[uid]
    assert [s.kind for s in sig["signals"]] == ["typing_paste"] and sig["observations"] >= 1
    assert any(x["kind"] == "worktest" for x in await PL.records(db, uid))  # the pledge in the T8 evidence view
    # a whole passage with very few input events = pasted: it doesn't count toward the speed
    c2, _ = await person(make_client, outbox, db, "ty2.t15@example.com", "Bala K")
    p2 = (await c2.post(f"{W}/start", json={"test": "typing", "lang": "en", "pledge": PL.VERSION})).json()
    await db[TRUST_WORKTESTS].update_one(
        {"_id": ObjectId(p2["id"])}, {"$set": {"started_at": now() - timedelta(seconds=70)}}
    )
    r2 = (await c2.post(f"{W}/{p2['id']}/submit", json={"typed": p2["passage"], "ms": 60_000, "inputs": 2})).json()
    assert r2["wpm"] <= 5 and r2["badge"] is None and r2["flags"]


# --- 3. SJT --------------------------------------------------------------------------------------------------------------


def test_sjt_scoring_key():
    items = B.form("sjt", "sjt-a")["items"]
    best = {it["id"]: {"most": it["best"], "least": it["worst"]} for it in items}
    assert S.sjt(items, best) == {
        "score": 100,
        "points": 20,
        "of": 20,
        "answered": 10,
        "level": "strong",
        "label": "SJT: strong",
    }
    half = {
        it["id"]: {"most": it["best"], "least": next(i for i in range(4) if i not in (it["best"], it["worst"]))}
        for it in items
    }
    assert S.sjt(items, half)["score"] == 50 and S.sjt(items, half)["level"] == "developing"
    reversed_ = {it["id"]: {"most": it["worst"], "least": it["best"]} for it in items}
    assert S.sjt(items, reversed_)["score"] == 0
    same = {it["id"]: {"most": it["best"], "least": it["best"]} for it in items}  # one option for both: not answered
    assert S.sjt(items, same)["answered"] == 0
    mixed = dict(best)
    for it in items[:4]:
        mixed[it["id"]] = half[it["id"]]
    assert S.sjt(items, mixed)["score"] == 80 and S.sjt(items, mixed)["level"] == "strong"
    for it in items[:6]:
        mixed[it["id"]] = half[it["id"]]
    assert S.sjt(items, mixed)["score"] == 70 and S.sjt(items, mixed)["level"] == "good"


def right_answers(doc: dict, test: str) -> dict:
    f = {it["id"]: it for it in B.form(test, doc["form"])["items"]}
    if test == "sjt":
        return {
            i: {"most": doc["order"][i].index(f[i]["best"]), "least": doc["order"][i].index(f[i]["worst"])}
            for i in doc["items"]
        }
    return {i: doc["order"][i].index(f[i]["answer"]) for i in doc["items"]}


async def test_sjt_flow_key_never_sent_badge_and_retake_rotation(outbox, db, make_client):
    c, uid = await person(make_client, outbox, db, "sjt.t15@example.com", "Chitra M")
    p = (await c.post(f"{W}/start", json={"test": "sjt", "lang": "te", "pledge": PL.VERSION})).json()
    blob = json.dumps(p)
    assert (
        len(p["items"]) == 10
        and '"best"' not in blob
        and '"worst"' not in blob
        and B.SCRIPT["te"].search(p["items"][0]["q"])
    )
    doc = await db[TRUST_WORKTESTS].find_one({"_id": ObjectId(p["id"])})
    assert [it["id"] for it in p["items"]] == doc["items"]
    first_form = doc["form"]
    ans = right_answers(doc, "sjt")
    r = (await c.post(f"{W}/{p['id']}/submit", json={"answers": ans, "times": {k: 20_000 for k in ans}})).json()
    assert r["score"] == 100 and r["level"] == "strong" and r["badge"] == "SJT: strong" and r["integrity"] == "clean"
    assert (await c.get(f"{W}/{p['id']}")).json()["score"] == 100
    again = await c.post(f"{W}/{p['id']}/submit", json={"answers": {}})
    assert again.json()["score"] == 100  # a second submit changes nothing
    # T9 retake limits: one every 30 days (Admin numbers), then the other form
    cat = (await c.get(W)).json()
    sjt = next(x for x in cat["tests"] if x["test"] == "sjt")
    assert sjt["retake"]["any"]["canStart"] is False and sjt["results"][0]["badge"] == "SJT: strong"
    assert err(await c.post(f"{W}/start", json={"test": "sjt", "lang": "en", "pledge": PL.VERSION})) == "retake"
    await db[TRUST_WORKTESTS].update_one(
        {"_id": ObjectId(p["id"])}, {"$set": {"started_at": now() - timedelta(days=31)}}
    )
    p2 = (await c.post(f"{W}/start", json={"test": "sjt", "lang": "en", "pledge": PL.VERSION})).json()
    assert p2["form"] != first_form and not set(x["id"] for x in p2["items"]) & set(doc["items"])
    # fast answers on the same position: V2 integrity signals for a person (the result stands)
    d2 = await db[TRUST_WORKTESTS].find_one({"_id": ObjectId(p2["id"])})
    same = {i: {"most": 0, "least": 1} for i in d2["items"]}
    r2 = (
        await c.post(
            f"{W}/{p2['id']}/submit",
            json={"answers": same, "times": {i: 300 for i in d2["items"]}, "signals": {"blurs": 9}},
        )
    ).json()
    assert r2["integrity"] == "retest" and "score" in r2
    kinds = {s.kind for s in (await SG.collect(db, [uid], now()))[uid]["signals"]}
    assert {"too_fast", "same_position", "tab_away"} <= kinds


# --- 4. aptitude ----------------------------------------------------------------------------------------------------------


def test_aptitude_deterministic_grading_and_percentiles():
    items = B.form("aptitude", "apt-a")["items"]
    right = {it["id"]: it["answer"] for it in items}
    assert S.aptitude(items, right) == S.aptitude(items, dict(right)) and S.aptitude(items, right)["score"] == 100
    some = {it["id"]: it["answer"] for it in items if it["section"] == "numerical"}
    got = S.aptitude(items, some)
    assert (
        got["right"] == 6
        and got["score"] == 40
        and got["sections"] == {"numerical": 100, "verbal": 0, "logical": 0}
        and got["answered"] == 6
    )
    # "top X%": provisional cut scores until 50 people, then real percentiles
    assert (
        S.percentile(80, [50] * 49) is None and S.aptitude_top(87, None) == "top30" and S.aptitude_top(66, None) is None
    )
    scores = list(range(0, 100, 2))  # 50 people
    assert S.percentile(80, scores) == 81.0 and S.aptitude_top(80, S.percentile(80, scores)) == "top30"
    assert (
        S.aptitude_top(98, S.percentile(98, scores)) == "top10" and S.aptitude_top(40, S.percentile(40, scores)) is None
    )


async def test_aptitude_timed_by_the_server_saved_answers_when_late(outbox, db, make_client):
    c, uid = await person(make_client, outbox, db, "apt.t15@example.com", "Dev P")
    p = (await c.post(f"{W}/start", json={"test": "aptitude", "lang": "te", "pledge": PL.VERSION})).json()
    assert p["seconds"] == 15 * 60 and len(p["items"]) == 15 and '"answer"' not in json.dumps(p["items"])
    doc = await db[TRUST_WORKTESTS].find_one({"_id": ObjectId(p["id"])})
    ans = right_answers(doc, "aptitude")
    five = dict(list(ans.items())[:5])
    assert (await c.put(f"{W}/{p['id']}/progress", json={"answers": five})).json()["saved"]
    # the time ran out (plus the grace): the submit's answers are ignored, the saved ones are marked
    await db[TRUST_WORKTESTS].update_one({"_id": doc["_id"]}, {"$set": {"deadline": now() - timedelta(minutes=2)}})
    r = (await c.post(f"{W}/{p['id']}/submit", json={"answers": ans})).json()
    assert r["score"] == round(100 * 5 / 15) and r["badge"] is None
    assert (await db[TRUST_WORKTESTS].find_one({"_id": doc["_id"]}))["late"] is True
    assert err(await c.put(f"{W}/{p['id']}/progress", json={"answers": ans})) == "done"
    # extra time (accessibility): 1.5×; on time, everything right: 100 and a provisional "top 10%"
    c2, _ = await person(make_client, outbox, db, "apt2.t15@example.com", "Esha N")
    p2 = (
        await c2.post(f"{W}/start", json={"test": "aptitude", "lang": "hi", "pledge": PL.VERSION, "extraTime": True})
    ).json()
    assert p2["seconds"] == int(15 * 60 * 1.5)
    d2 = await db[TRUST_WORKTESTS].find_one({"_id": ObjectId(p2["id"])})
    r2 = (
        await c2.post(
            f"{W}/{p2['id']}/submit",
            json={"answers": right_answers(d2, "aptitude"), "times": {i: 30_000 for i in d2["items"]}},
        )
    ).json()
    assert r2["score"] == 100 and r2["badge"] == "Aptitude: top 10% (provisional)"
    # a running test left past its time is marked from what was saved when the page is opened again
    c3, uid3 = await person(make_client, outbox, db, "apt3.t15@example.com", "Farah Q")
    p3 = (await c3.post(f"{W}/start", json={"test": "aptitude", "lang": "en", "pledge": PL.VERSION})).json()
    await db[TRUST_WORKTESTS].update_one(
        {"_id": ObjectId(p3["id"])}, {"$set": {"deadline": now() - timedelta(minutes=5)}}
    )
    cat = (await c3.get(W)).json()
    apt = next(x for x in cat["tests"] if x["test"] == "aptitude")
    assert apt["running"] is None and apt["results"][0]["score"] == 0


# --- 5. Hire now: badges, filters, the reliability record -----------------------------------------------------------------


async def result_row(db, uid, test, lang="en", **res):
    t = now()
    await db[TRUST_WORKTESTS].insert_one({"user_id": uid, "test": test, "lang": lang, "key": WS.key_of(test, lang), "form": "x", "status": "submitted",
                                          "started_at": t, "submitted_at": t, "result": res, "flags": [], "integrity": {}})  # fmt: skip


async def hire_person(make_client, outbox, db, email, name, tester=True):
    c, uid = await person(make_client, outbox, db, email, name, tester=tester)
    await add_resume(c)
    assert (await c.put("/api/me/hire", json=READY)).status_code == 200
    return c, uid


async def test_hire_now_badges_filters_and_reliability_never_a_filter(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "founder@gmail.com"}}, upsert=True)
    job = (
        await client.post(
            f"/api/company/{cid}/jobs", json={"job": {**JOB, "title": "Customer Support Executive"}}, headers=H(session)
        )
    ).json()["id"]
    ca, asha = await hire_person(make_client, outbox, db, "asha.h15@example.com", "Asha Rao")
    _, bala = await hire_person(make_client, outbox, db, "bala.h15@example.com", "Bala K")
    cc, chitra = await hire_person(make_client, outbox, db, "chitra.h15@example.com", "Chitra M")
    await result_row(db, asha, "typing", "hi", wpm=38, accuracy=96.0)
    await result_row(db, asha, "sjt", score=85, level="strong")
    await result_row(db, asha, "aptitude", score=87)
    await result_row(db, bala, "typing", "en", wpm=27, accuracy=95.0)
    await result_row(db, bala, "typing", "te", wpm=12, accuracy=99.0)
    await result_row(db, bala, "sjt", score=60, level="good")
    await result_row(db, bala, "aptitude", score=70)
    await consent(ca)
    await consent(cc)
    await REL.put(
        db, "interview", "slot-a1", user_id=asha, company_id=cid, job_id=job, outcome="yes", source="employer"
    )
    await REL.put(db, "join", "offer-a1", user_id=asha, company_id=cid, job_id=job, outcome="yes", source="employer")

    async def get(**q):
        r = await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job, **q}, headers=H(session))
        assert r.status_code == 200, r.text
        return r.json()

    keys = lambda o: sorted(x["key"] for x in o["items"])  # noqa: E731
    out = await get()
    assert out["available"] == 3 and out["workTests"]["counts"] == {"typing": 2, "sjt": 2, "aptitude": 2}
    rows = {x["key"]: x for x in out["items"]}
    wa = rows[asha]["workTests"]
    assert (
        wa["typing"]["label"] == "Typing 35 wpm+ (Hindi)"
        and wa["typing"]["wpm"] == 38
        and wa["typing"]["source"] == "Nm7 typing test"
    )
    assert wa["sjt"]["label"] == "SJT: strong" and wa["aptitude"]["label"] == "Aptitude: top 30% (provisional)"
    assert (
        rows[bala]["workTests"]["typing"]["label"] == "Typing 25 wpm+ (English)"
        and rows[bala]["workTests"]["aptitude"]["label"] == "Aptitude: top 50% (provisional)"
    )
    assert rows[chitra]["workTests"] == {}
    # the record: only with consent; "No history yet" is plain and never a negative
    assert rows[asha]["reliabilityRecord"] == {
        "text": "Showed up 1/1 · Joined 1/1",
        "lines": ["Showed up 1/1", "Joined 1/1"],
        "source": "confirmed by employers",
        "empty": False,
    }
    assert rows[chitra]["reliabilityRecord"]["text"] == "No history yet" and rows[chitra]["reliabilityRecord"]["empty"]
    assert rows[bala]["reliabilityRecord"] is None  # no consent: nothing at all
    assert keys(await get(typing=35)) == [asha] and keys(await get(typing=25)) == sorted([asha, bala])
    assert keys(await get(sjt="strong")) == [asha] and keys(await get(sjt="good")) == sorted([asha, bala])
    assert keys(await get(aptitude="top30")) == [asha] and keys(await get(aptitude="top10")) == []
    assert keys(await get(typing=25, aptitude="top30")) == [asha]
    # no reliability filter exists: anything like it is ignored, nobody is hidden for "No history yet"
    assert keys(await get(reliability="confirmed", noHistory="false", minReliability=90)) == sorted(
        [asha, bala, chitra]
    )
    assert set(WH.FILTER_KEYS) == {"typing", "sjt", "aptitude"}
    assert (
        await client.get(
            f"/api/company/{cid}/hire/shortlist", params={"job": job, "sjt": "developing"}, headers=H(session)
        )
    ).status_code == 422
    # a later lower result replaces the badge
    await result_row(db, asha, "sjt", score=40, level="developing")
    assert keys(await get(sjt="good")) == [bala]
    assert "sjt" not in {x["key"]: x for x in (await get())["items"]}[asha]["workTests"]


# --- 6. the reliability record ----------------------------------------------------------------------------------------------


async def slot(db, cid, uid, job, hours_ago=3, by="founder@gmail.com"):
    sid = ObjectId()
    t = now() - timedelta(hours=hours_ago)
    await db[HIRE_SLOTS].insert_one({"_id": sid, "company_id": cid, "job_id": job, "starts_at": t, "minutes": 30, "place": "Office", "link": "",
                                     "interviewer": "", "round": "", "status": "booked", "user_id": uid, "seq": 1, "by": by, "created_at": t, "updated_at": t})  # fmt: skip
    return str(sid)


async def offer(db, cid, uid, job, days_ago=0, status="accepted", joined=None):
    oid = ObjectId()
    day = (now().astimezone(IST).date() - timedelta(days=days_ago)).isoformat()
    await db[HIRE_OFFERS].insert_one({"_id": oid, "user_id": uid, "job_id": job, "company_id": cid, "company_name": "Acme Foods", "candidate_name": "Asha Rao",
                                      "title": "Support executive", "salary": {"amount": 20000, "unit": "month"}, "join_date": day, "place": "Hyderabad",
                                      "status": status, "joined": joined or {}, "by": "founder@gmail.com", "respond_by": now() + timedelta(days=3), "answered_at": now(), "created_at": now(), "updated_at": now()})  # fmt: skip
    return str(oid)


async def test_reliability_window_disputes_admin_review_join_and_stays(client, outbox, db, make_client, admin_client):
    session, cid = await verified(client, outbox, db)
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "founder@gmail.com"}}, upsert=True)
    job = (
        await client.post(
            f"/api/company/{cid}/jobs", json={"job": {**JOB, "title": "Delivery Associate"}}, headers=H(session)
        )
    ).json()["id"]
    c, uid = await person(make_client, outbox, db, "rel.t15@example.com", "Asha Rao")
    await consent(c)

    def mark(sid, res):
        return client.post(f"/api/company/{cid}/hire/slots/{sid}/mark", json={"result": res}, headers=H(session))

    # a no-show waits 48 hours for the candidate's side: not counted, the candidate is told with a one-tap link
    s1 = await slot(db, cid, uid, job)
    n0 = len(outbox.sent)
    assert (await mark(s1, "no_show")).status_code == 200
    rec = await db[TRUST_RELIABILITY].find_one({"_id": f"interview:{s1}"})
    assert rec["state"] == "waiting" and rec["source"] == "employer" and rec["respond_by"] > now() + timedelta(hours=47)
    told = [m for m in outbox.sent[n0:] if m.to == "rel.t15@example.com"]
    assert len(told) == 1 and "48 hours" in told[0].text
    me = (await c.get(ME_REL)).json()
    assert (
        me["summary"]["text"] == "No history yet"
        and me["items"][0]["canExplain"]
        and me["items"][0]["state"] == "waiting"
    )
    # "I had an emergency" within the window: excused, never counted
    me = (await c.post(f"{ME_REL}/interview:{s1}/answer", json={"why": "emergency"})).json()
    assert me["items"][0]["state"] == "excused" and me["summary"]["empty"]
    # attended counts at once
    s2 = await slot(db, cid, uid, job)
    await mark(s2, "attended")
    assert (await c.get(ME_REL)).json()["summary"]["text"] == "Showed up 1/1"
    # a no-show nobody explained counts after 48 hours; then too late to excuse, but it can be disputed → Admin
    s3 = await slot(db, cid, uid, job)
    await mark(s3, "no_show")
    assert await REL.settle(db, now()) == 0
    assert await REL.settle(db, now() + timedelta(hours=49)) == 1
    me = (await c.get(ME_REL)).json()
    assert me["summary"]["text"] == "Showed up 1/2" and me["summary"]["source"] == "confirmed by employers"
    assert err(await c.post(f"{ME_REL}/interview:{s3}/answer", json={"why": "emergency"})) == "too_late"
    assert err(await c.post(f"{ME_REL}/interview:{s3}/answer", json={"why": "other", "text": "no"})) == "reason"
    me = (await c.post(f"{ME_REL}/interview:{s3}/answer", json={"why": "company_cancelled"})).json()
    assert me["summary"]["text"] == "Showed up 1/1"  # disputed: not shown while a person checks
    adm = await admin_client()
    d = (await adm.get(ADMIN)).json()
    assert [x["id"] for x in d["reliability"]["disputes"]] == [f"interview:{s3}"] and d["reliability"]["disputes"][0][
        "dispute"
    ] == REL.WHY["company_cancelled"][1]
    assert all(b["ok"] for b in d["banks"])
    assert (
        await adm.post(
            f"{ADMIN}/disputes/interview:{s3}", json={"decision": "remove", "note": "Company confirmed they moved it"}
        )
    ).json()["state"] == "removed"
    assert (await c.get(ME_REL)).json()["summary"]["text"] == "Showed up 1/1"
    assert (await adm.post(f"{ADMIN}/disputes/interview:{s3}", json={"decision": "count"})).status_code == 404
    # a cleared mark removes the record
    await mark(s2, "clear")
    assert await db[TRUST_RELIABILITY].find_one({"_id": f"interview:{s2}"}) is None
    await mark(s2, "attended")

    # joining: the company's "Joined" counts; the candidate's own "I've joined" until then
    o1 = await offer(db, cid, uid, job)
    assert (await c.post(f"/api/me/hire/offers/{o1}/joined", json={"joined": True})).status_code == 200
    assert (await c.get(ME_REL)).json()["summary"]["source"] == "confirmed by employers and the candidate"
    assert (
        await client.post(f"/api/company/{cid}/hire/offers/{o1}/joined", json={"joined": True}, headers=H(session))
    ).status_code == 200
    me = (await c.get(ME_REL)).json()
    assert me["summary"]["text"] == "Showed up 1/1 · Joined 1/1" and me["summary"]["source"] == "confirmed by employers"

    # day 30: the pass asks the company (one-tap) and the candidate; the company's answer counts
    await db[HIRE_OFFERS].update_one(
        {"_id": ObjectId(o1)}, {"$set": {"join_date": (now().astimezone(IST).date() - timedelta(days=31)).isoformat()}}
    )
    n0 = len(outbox.sent)
    got = await REL.run(db, outbox, force=True)
    assert got.get("stay30_company_sent") == 1 and got.get("stay30_candidate_email_sent") == 1
    co = next(m for m in outbox.sent[n0:] if m.to == "founder@gmail.com")
    mine = next(m for m in outbox.sent[n0:] if m.to == "rel.t15@example.com")
    assert "still working with you" in co.text and token_in(mine.text, "rme")
    assert (await REL.run(db, outbox, force=True)).get("stay30_company_sent") is None  # once
    anon = make_client()
    tok = token_in(co.text, "rstay")
    v = (await anon.post(f"{PUB}/stay/check", json={"token": tok})).json()
    assert v["due"] == [30] and v["answers"] == {}
    assert err(await anon.post(f"{PUB}/stay/act", json={"token": tok, "days": 90, "working": True})) == "not_yet"
    v = (await anon.post(f"{PUB}/stay/act", json={"token": tok, "days": 30, "working": True})).json()
    assert v["answers"] == {"30": "yes"}
    assert (await c.get(ME_REL)).json()["summary"]["text"] == "Showed up 1/1 · Joined 1/1 · Stayed 30 days 1/1"
    # the candidate can confirm themselves (day 90 not reached yet: refused)
    assert err(await c.post(f"{ME_REL}/stay", json={"offer": o1, "days": 90})) == "not_yet"
    await db[HIRE_OFFERS].update_one(
        {"_id": ObjectId(o1)}, {"$set": {"join_date": (now().astimezone(IST).date() - timedelta(days=91)).isoformat()}}
    )
    me = (await c.post(f"{ME_REL}/stay", json={"offer": o1, "days": 90})).json()
    assert (
        me["summary"]["lines"][-1] == "Stayed 90 days 1/1"
        and me["summary"]["source"] == "confirmed by employers and the candidate"
    )
    # the candidate's link works without signing in
    lt = token_in(mine.text, "rme")
    lv = (await anon.post(f"{PUB}/me/check", json={"token": lt})).json()
    assert lv["first"] == "Asha" and lv["summary"]["text"].startswith("Showed up 1/1")

    # after the interview time the company gets a one-tap "Did they come?" (once)
    s4 = await slot(db, cid, uid, job, hours_ago=2)
    n0 = len(outbox.sent)
    got = await REL.run(db, outbox, force=True)
    assert got.get("attendance_sent") == 1
    att = next(m for m in outbox.sent[n0:] if m.to == "founder@gmail.com" and "k=ratt" in m.text)
    at = token_in(att.text, "ratt")
    assert (await anon.post(f"{PUB}/att/check", json={"token": at})).json()["first"] == "Asha"
    assert (await anon.post(f"{PUB}/att/act", json={"token": at, "result": "attended"})).json()["mark"] == "attended"
    assert (await db[HIRE_SLOTS].find_one({"_id": ObjectId(s4)}))["mark"] == "attended"
    assert (await c.get(ME_REL)).json()["summary"]["lines"][0] == "Showed up 2/2"
    assert (await REL.run(db, outbox, force=True)).get("attendance_sent") is None
    # a candidate's own "not joining" counts in their own words (no window needed)
    o2 = await offer(db, cid, uid, job, days_ago=-5)
    assert (
        await c.post(f"/api/me/hire/offers/{o2}/joining", json={"joining": False, "reason": "Joined a job nearer home"})
    ).status_code == 200
    rec = await db[TRUST_RELIABILITY].find_one({"_id": f"join:{o2}"})
    assert rec["state"] == "counted" and rec["source"] == "candidate" and rec["note"] == "Joined a job nearer home"


async def test_consent_required_withdraw_deletes_and_retention(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    c, uid = await person(make_client, outbox, db, "noc.t15@example.com", "Gita S")
    s1 = await slot(db, cid, uid, "job-x")
    assert (
        await client.post(f"/api/company/{cid}/hire/slots/{s1}/mark", json={"result": "no_show"}, headers=H(session))
    ).status_code == 200
    assert await db[TRUST_RELIABILITY].count_documents({}) == 0  # no consent: nothing stored
    me = (await c.get(ME_REL)).json()
    assert (
        me["consent"]["status"] == "not_given"
        and "48 hours" in me["consent"]["text"]
        and "730 days" in me["consent"]["text"]
    )
    await consent(c)
    s2 = await slot(db, cid, uid, "job-x")
    await client.post(f"/api/company/{cid}/hire/slots/{s2}/mark", json={"result": "attended"}, headers=H(session))
    assert await db[TRUST_RELIABILITY].count_documents({"user_id": uid}) == 1
    assert (await c.delete("/api/me/trust/consents/reliability_record")).json()["deleted"] == 1
    assert await db[TRUST_RELIABILITY].count_documents({"user_id": uid}) == 0
    assert (await REL.for_hire(db, [uid])) == {}
    assert R.TYPES["reliability"].purpose == "reliability_record" and R.TYPES["reliability"].days == 730
    assert R.TYPES["work_tests"].collection == TRUST_WORKTESTS and "reliability_record" in C.PURPOSES
    # the daily deletion job removes records past the retention time
    await db[TRUST_RELIABILITY].insert_one({"_id": "interview:old", "user_id": uid, "kind": "interview", "outcome": "yes", "state": "counted",
                                            "source": "employer", "at": now() - timedelta(days=800)})  # fmt: skip
    got = await R.run(db, force=True)
    assert got.get("reliability", 0) >= 1 and await db[TRUST_RELIABILITY].find_one({"_id": "interview:old"}) is None


def test_summary_no_history_is_plain_and_only_counted_rows_show():
    assert REL.summary([]) == {"text": "No history yet", "lines": [], "source": "", "empty": True}
    rows = [
        {"kind": "interview", "outcome": "no", "state": s, "source": "employer"}
        for s in ("waiting", "excused", "disputed", "removed")
    ]
    assert REL.summary(rows)["empty"]
    rows.append({"kind": "interview", "outcome": "yes", "state": "counted", "source": "employer"})
    rows.append({"kind": "stay90", "outcome": "yes", "state": "counted", "source": "employer"})
    assert REL.summary(rows)["text"] == "Showed up 1/1 · Stayed 90 days 1/1"


# --- 7. switch OFF ---------------------------------------------------------------------------------------------------------


async def test_switch_off_nothing_new(client, outbox, db, make_client):
    c, uid = await person(make_client, outbox, db, "zara.t15@example.com", "Zara Off", tester=False)
    for r in (
        await c.get(W),
        await c.get(ME_REL),
        await c.post(f"{W}/start", json={"test": "typing", "lang": "en", "pledge": PL.VERSION}),
    ):
        assert r.status_code == 404
    assert await db[TRUST_WORKTESTS].count_documents({}) == 0
    session, cid = await verified(client, outbox, db, email="priya@gmail.com")
    s1 = await slot(db, cid, uid, "job-z", by="priya@gmail.com")
    n0 = len(outbox.sent)
    assert (
        await client.post(f"/api/company/{cid}/hire/slots/{s1}/mark", json={"result": "no_show"}, headers=H(session))
    ).status_code == 200
    assert await db[TRUST_RELIABILITY].count_documents({}) == 0 and len(outbox.sent) == n0
    # the pass asks nobody while the switch is off (no testers)
    s2 = await slot(db, cid, uid, "job-z", hours_ago=2, by="priya@gmail.com")
    got = await REL.run(db, outbox, force=True)
    assert (
        not any(k.startswith("attendance") for k in got)
        and (await db[HIRE_SLOTS].find_one({"_id": ObjectId(s2)})).get("t15") is None
    )
    # a company the switch is off for: no workTests block, the filters are ignored
    job = (await client.post(f"/api/company/{cid}/jobs", json={"job": JOB}, headers=H(session))).json()["id"]
    out = (
        await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job, "typing": 35}, headers=H(session))
    ).json()
    assert "workTests" not in out and all("workTests" not in x for x in out["items"])
