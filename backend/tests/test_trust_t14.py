# ruff: noqa: E501
"""Vetting Trust T14: coding tasks for tech roles (the test sandbox's scoring, Judge0's request with every limit and its
answers, hidden tests never in any browser response, "X of Y hidden tests passed" + failing visible samples only, Admin
limits passed to the provider, the sandbox down → queued and retried with no lost work, run rate limits, the editor
replay only with its consent, its size cap and retention, big paste / no typing → T8 signals and never a rejection,
reviewer access rules (Admin, company only where the switch allows), Admin problems validated through the sandbox,
the anonymised AI review that never changes the score, and switch OFF isolation: the written tech task as before)."""

import json
import re
from datetime import timedelta

import httpx
import pytest
from bson import ObjectId

from app.core import claude
from app.core.config import get_settings
from app.core.db import (
    APPLICATIONS,
    AUDIT_LOG,
    SKILL_ATTEMPTS,
    TRUST_CODE,
    TRUST_CODE_PROBLEMS,
    TRUST_CODE_REPLAYS,
    VETTING_QUEUE,
    VETTING_VERIFIED,
)
from app.core.time import now
from app.trust import retention as R
from app.trust.code import judge0 as J
from app.trust.code import problems as PB
from app.trust.code import providers as P
from app.trust.code import replay as RP
from app.trust.code import service as S
from app.trust.honesty import pledge as PL
from app.trust.integrity import rating as RT
from app.trust.integrity import signals as SG
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_trust_t9 import person, vetting_public  # noqa: F401
from tests.test_vetting import _paper, _right, _slow

SK = "/api/me/skill-checks"
CODE = "/api/me/trust/code"
ADMIN = "/api/admin/trust/code"
SUM = next(p for p in PB.SEEDS if p["_id"] == "sum-even")
GOOD = "import sys\n\nd = sys.stdin.read().split()\nprint(sum(x for x in map(int, d[1:]) if x % 2 == 0))\n"
SECRETS = [
    "1000000000 1000000000 1000000000",
    "3000000000",
    "big numbers (needs 64-bit)",
    "negative numbers",
    "-2 -3 4 7",
]


def no_hidden(*responses):
    """No hidden test (input, output or name) and no reference solution in any of these response bodies."""
    for r in responses:
        text = r.text if hasattr(r, "text") else json.dumps(r)
        for s in SECRETS:
            assert s not in text, s
        assert '"hidden"' not in text and '"reference"' not in text and "sum(x for x in nums" not in text


async def coding_task(make_client, outbox, db, email, name="Asha Rao", tester=True, skill="Python", consent=False):
    c, uid = await person(make_client, outbox, db, email, name, tester=tester)
    if consent:
        assert (await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})).status_code == 200
        assert (await c.post("/api/me/trust/consents/code_replay")).json()["status"] == "granted"
    await c.post(f"{SK}/consent")
    p = (await _paper(c, skill, **({"pledge": PL.VERSION} if tester else {}))).json()
    r = (await c.post(f"{SK}/{p['id']}/submit", json={"answers": await _right(db, p), "times": _slow(p)})).json()
    assert r["pass"]
    t = await c.post(f"{SK}/{p['id']}/task/start", json={"pledge": PL.VERSION} if tester else {})
    assert t.status_code == 200, t.text
    return c, uid, p["id"], t


def replay_of(steps, start=""):
    """steps: [(kind, pos, deleted, text)] → a v1 replay that ends in the typed text."""
    return {
        "v": 1,
        "start": start,
        "lang": "python",
        "truncated": False,
        "events": [[50, k, pos, d, txt] for k, pos, d, txt in steps],
    }


def typed_replay(text, start=""):
    return replay_of([("e", len(start) + i, 0, ch) for i, ch in enumerate(text)], start)


class Switchable(P.Mock):
    """The test sandbox that can be "down", and remembers the limits it was given."""

    down = False
    seen: list = []

    async def run(self, source, language, cases, limits):
        type(self).seen.append((language, len(cases), limits))
        if type(self).down:
            raise P.ProviderDown("down for the test")
        return await super().run(source, language, cases, limits)


@pytest.fixture
def sandbox(monkeypatch):
    Switchable.down = False
    Switchable.seen = []
    sb = Switchable()
    monkeypatch.setattr(P, "registry", lambda: {"mock": sb, "judge0": J.Judge0()})
    return Switchable


# --- the sandboxes --------------------------------------------------------------------------------------------------------


async def test_mock_sandbox_markers_output_compare_and_cap():
    m, lim = P.Mock(), P.Limits(output_kb=4)
    cases = [P.Case("1\n", "a\n"), P.Case("2\n", "b\n"), P.Case("3\n", "c\n")]
    assert [r.stdout for r in await m.run("print()", "python", cases, lim)] == ["a\n", "b\n", "c\n"]
    assert [r.stdout for r in await m.run("# TODO", "python", cases, lim)] == ["", "", ""]  # starter code
    assert [r.stdout for r in await m.run("# MOCK:PASSN=2", "python", cases, lim)] == ["a\n", "b\n", ""]
    assert {r.status for r in await m.run("MOCK:TLE", "python", cases, lim)} == {"time_limit"}
    assert {r.status for r in await m.run("MOCK:CE", "java", cases, lim)} == {"compile_error"}
    big = await m.run("MOCK:BIG", "python", cases[:1], lim)
    assert big[0].truncated and len(big[0].stdout.encode()) == 4 * 1024
    with pytest.raises(P.ProviderDown):
        await m.run("MOCK:DOWN", "python", cases, lim)
    assert P.same_output("6  \n\n", "6\n") and not P.same_output("6 7", "6\n7")
    assert P.Limits().network is False


async def test_built_in_problems_are_valid_reference_passes_and_starters_fail():
    m = P.Mock()
    for s in PB.SEEDS:
        assert PB.check(s) == [], s["_id"]
        tests = [*s["samples"], *s["hidden"]]
        res = await m.run(
            s["reference"]["source"],
            s["reference"]["language"],
            [P.Case(t["stdin"], t["expected"]) for t in tests],
            P.Limits(),
        )
        assert all(P.same_output(r.stdout, t["expected"]) for r, t in zip(res, tests, strict=True))
        assert set(s["languages"]) >= {"python", "javascript", "java", "cpp"}
        for starter in s["languages"].values():
            assert "TODO" in starter  # the starter alone never passes
        pub = PB.public(PB.snapshot({**s, "version": 1}))
        assert pub["hiddenCount"] == len(s["hidden"]) and "hidden" not in pub and "reference" not in pub


def test_reference_solutions_really_work():
    """The Python reference solutions are real programs: run them here (tests only, never on the server)."""
    import subprocess
    import sys

    for s in PB.SEEDS:
        for t in [*s["samples"], *s["hidden"]]:
            out = subprocess.run(
                [sys.executable, "-c", s["reference"]["source"]],
                input=t["stdin"],
                capture_output=True,
                text=True,
                timeout=10,
            ).stdout
            assert P.same_output(out, t["expected"]), (s["_id"], t["name"])


async def test_judge0_request_carries_every_limit_and_answers_map(monkeypatch):
    monkeypatch.setattr(get_settings(), "judge0_url", "https://judge0-ce.p.rapidapi.com")
    monkeypatch.setattr(get_settings(), "judge0_rapidapi_key", "rk-test")
    monkeypatch.setattr(J, "POLL_EVERY", 0)
    calls = []
    polls = {"n": 0}
    import base64

    def b(s):
        return base64.b64encode(s.encode()).decode()

    def handler(req: httpx.Request):
        calls.append(req)
        if req.method == "POST":
            return httpx.Response(201, json=[{"token": "t1"}, {"token": "t2"}, {"token": "t3"}])
        polls["n"] += 1
        if polls["n"] == 1:
            return httpx.Response(200, json={"submissions": [{"status_id": 2}, {"status_id": 1}, {"status_id": 3}]})
        return httpx.Response(200, json={"submissions": [{"status_id": 3, "stdout": b("6\n"), "time": "0.01", "memory": 3000},
                                                         {"status_id": 5, "stdout": None, "time": "2.1"},
                                                         {"status_id": 6, "compile_output": b("error: ;")}]})  # fmt: skip

    monkeypatch.setattr(J, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    lim = P.Limits(cpu_s=3, wall_s=6, memory_mb=256, output_kb=32, processes=10)
    res = await J.Judge0().run("print(6)", "python", [P.Case("1\n", "6\n")] * 3, lim)
    assert (
        [r.status for r in res] == ["ran", "time_limit", "compile_error"]
        and res[0].stdout == "6\n"
        and "error" in res[2].stderr
    )
    post = calls[0]
    assert post.headers["X-RapidAPI-Key"] == "rk-test" and post.headers["X-RapidAPI-Host"] == "judge0-ce.p.rapidapi.com"
    assert post.url.params["base64_encoded"] == "true"
    sub = json.loads(post.content)["submissions"][0]
    assert sub["language_id"] == 71 and sub["cpu_time_limit"] == 3 and sub["wall_time_limit"] == 6
    assert (
        sub["memory_limit"] == 256 * 1024 and sub["max_file_size"] == 32 and sub["max_processes_and_or_threads"] == 10
    )
    assert sub["enable_network"] is False and base64.b64decode(sub["source_code"]).decode() == "print(6)"
    assert polls["n"] == 2  # polled until every case finished
    # self-hosted: the auth token header, no RapidAPI headers
    monkeypatch.setattr(get_settings(), "judge0_url", "https://judge0.example.org")
    monkeypatch.setattr(get_settings(), "judge0_auth_token", "tok")
    assert J.Judge0().headers()["X-Auth-Token"] == "tok" and "X-RapidAPI-Key" not in J.Judge0().headers()
    # down: 5xx, 429, internal error, network errors → ProviderDown (queued, tried again)
    for resp in (httpx.Response(503), httpx.Response(429)):
        monkeypatch.setattr(
            J, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(lambda req, resp=resp: resp))
        )
        with pytest.raises(P.ProviderDown):
            await J.Judge0().run("x", "python", [P.Case("", "1")], lim)
    with pytest.raises(P.ProviderDown):
        J.result_of({"status_id": 13}, lim)

    def boom(req):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(J, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(boom)))
    with pytest.raises(P.ProviderDown):
        await J.Judge0().run("x", "python", [P.Case("", "1")], lim)
    assert not (await J.Judge0().health()).ok
    monkeypatch.setattr(get_settings(), "judge0_auth_token", "")
    assert not J.Judge0().ready()  # self-hosted needs its token


# --- the candidate's coding task ----------------------------------------------------------------------------------------


async def test_coding_task_hidden_tests_never_reach_the_browser_and_score_from_hidden_tests(
    outbox, db, make_client, sandbox
):
    c, uid, aid, t = await coding_task(make_client, outbox, db, "asha@example.com")
    task = t.json()
    assert task["type"] == "coding" and task["coding"]["title"] == SUM["title"] and task["coding"]["hiddenCount"] == 5
    assert {x["key"] for x in task["coding"]["languages"]} >= {"python", "javascript", "java", "cpp"}
    assert [s["name"] for s in task["coding"]["samples"]] == ["Sample 1: a mix", "Sample 2: no even numbers"]
    view = await c.get(f"{CODE}/{aid}")
    res = await c.get(f"{SK}/{aid}")
    assert res.json()["task"]["type"] == "coding" and res.json()["task"]["status"] == "started"
    # the written-task submit refuses a coding task
    assert err(await c.post(f"{SK}/{aid}/task/submit", json={"text": "some words here for the task"})) == "coding"
    # draft (no lost work), then Run: samples only, with the failing sample's output
    assert (await c.put(f"{CODE}/{aid}/draft", json={"language": "python", "source": "x = 1  # MOCK:PASSN=1"})).json()[
        "saved"
    ]
    run = await c.post(f"{CODE}/{aid}/run", json={"language": "python", "source": "x = 1  # MOCK:PASSN=1"})
    rr = run.json()
    assert (
        [x["passed"] for x in rr["results"]] == [True, False]
        and rr["results"][1]["expected"] == "0\n"
        and rr["runsLeft"] == 29
    )
    assert sandbox.seen[-1][1] == 2  # Run sends only the 2 visible samples to the sandbox
    assert (await c.get(f"{CODE}/{aid}")).json()["draft"]["source"] == "x = 1  # MOCK:PASSN=1"
    assert err(await c.put(f"{CODE}/{aid}/draft", json={"language": "rust", "source": "x"})) == "language"
    # submit: samples + hidden in one go; 2 samples pass, 2 of the 5 hidden
    sub = await c.post(
        f"{CODE}/{aid}/submit",
        json={"language": "python", "source": "# MOCK:PASSN=4\n" + GOOD, "stats": {"typed": 400}},
    )
    s = sub.json()["submission"]
    assert (
        s["status"] == "done"
        and s["passed"] == 2
        and s["total"] == 5
        and s["line"] == "2 of 5 hidden tests passed"
        and s["failingSamples"] == []
    )
    assert sandbox.seen[-1][1] == 7
    after = await c.get(f"{SK}/{aid}")
    tk = after.json()["task"]
    assert tk["status"] == "graded" and tk["score"] == 40 and tk["coding"]["passed"] == 2 and tk["coding"]["total"] == 5
    assert any(f["label"] == "Hidden tests" and f["reason"] == "2 of 5 hidden tests passed" for f in tk["feedback"])
    assert not await db[VETTING_VERIFIED].find_one({"user_id": uid, "test": "Python"})  # 40 < 60: no badge
    no_hidden(t, view, res, run, sub, after, await c.get(f"{CODE}/{aid}"), await c.get(SK))
    # sent once only
    assert err(await c.post(f"{CODE}/{aid}/submit", json={"language": "python", "source": GOOD})) == "done"
    assert err(await c.post(f"{CODE}/{aid}/run", json={"language": "python", "source": GOOD})) == "done"
    # someone else can't open it
    other, _ = await person(make_client, outbox, db, "ravi@example.com", "Ravi K")
    assert (await other.get(f"{CODE}/{aid}")).status_code == 404
    # stored server-side: per-case details for reviewers
    doc = await db[TRUST_CODE].find_one({"_id": ObjectId(aid)})
    assert len(doc["submission"]["cases"]) == 7 and doc["problem"]["hidden"] == SUM["hidden"]


async def test_all_hidden_pass_earns_the_badge_and_failing_samples_are_named(outbox, db, make_client, sandbox):
    c, uid, aid, _ = await coding_task(make_client, outbox, db, "asha@example.com")
    s = (
        await c.post(f"{CODE}/{aid}/submit", json={"language": "python", "source": GOOD, "stats": {"typed": 300}})
    ).json()["submission"]
    assert s["passed"] == 5 and s["total"] == 5
    assert (await db[VETTING_VERIFIED].find_one({"user_id": uid, "test": "Python"}))["task_score"] == 100
    c2, _, aid2, _ = await coding_task(make_client, outbox, db, "ravi@example.com", "Ravi K")
    s2 = (
        await c2.post(f"{CODE}/{aid2}/submit", json={"language": "java", "source": "class Main {} // MOCK:PASSN=1"})
    ).json()["submission"]
    assert s2["failingSamples"] == ["Sample 2: no even numbers"] and s2["passed"] == 0


async def test_admin_limits_are_passed_to_the_provider_and_bounded(outbox, db, make_client, admin_client, sandbox):
    owner = await admin_client()
    d = (await owner.get(ADMIN)).json()
    assert d["settings"]["provider"] == "mock" and d["settings"]["cpuS"] == 2 and d["settings"]["memoryMb"] == 128
    keys = {p["key"]: p["keys"] for p in d["providers"]}
    assert keys["judge0"] == {"JUDGE0_URL": True, "JUDGE0_RAPIDAPI_KEY": False, "JUDGE0_AUTH_TOKEN": False}
    body = {**d["settings"], "cpuS": 3.5, "wallS": 8, "memoryMb": 256, "outputKb": 16, "processes": 12}
    assert (await owner.put(ADMIN, json=body)).status_code == 200
    assert await db[AUDIT_LOG].find_one({"action": "trust.code_settings"})
    assert err(await owner.put(ADMIN, json={**body, "memoryMb": 4096})) == "bounds"
    assert err(await owner.put(ADMIN, json={**body, "cpuS": 0.1})) == "bounds"
    c, _, aid, _ = await coding_task(make_client, outbox, db, "asha@example.com")
    await c.post(f"{CODE}/{aid}/run", json={"language": "cpp", "source": "int main(){}"})
    await c.post(f"{CODE}/{aid}/submit", json={"language": "cpp", "source": "int main(){}"})
    for lang, _n, lim in sandbox.seen:
        assert lang == "cpp" and lim == P.Limits(
            cpu_s=3.5, wall_s=8, memory_mb=256, output_kb=16, processes=12, network=False
        )
    assert (await owner.post(f"{ADMIN}/health")).json()["ok"]
    # a support admin without the settings permission can read but not change
    sup = await admin_client("support", "sup@nm7.si")
    assert (await sup.put(ADMIN, json=body)).status_code in (403, 404)


async def test_sandbox_down_queues_and_retries_with_no_lost_work(outbox, db, make_client, sandbox):
    c, uid, aid, _ = await coding_task(make_client, outbox, db, "asha@example.com")
    sandbox.down = True
    r = await c.post(f"{CODE}/{aid}/run", json={"language": "python", "source": GOOD})
    assert err(r) == "sandbox_down" and r.status_code == 503
    assert (await c.get(f"{CODE}/{aid}")).json()["draft"]["source"] == GOOD  # saved even though Run couldn't run
    s = (await c.post(f"{CODE}/{aid}/submit", json={"language": "python", "source": GOOD})).json()["submission"]
    assert s["status"] == "queued" and s["tries"] == 1 and "nothing is lost" in s["note"]
    a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(aid)})
    assert (
        a["task"]["status"] == "grading" and a["task"]["coding"]["status"] == "queued" and a["task"]["answer"] == GOOD
    )
    doc = await db[TRUST_CODE].find_one({"_id": ObjectId(aid)})
    assert doc["submission"]["source"] == GOOD and doc["submission"]["next_at"] > now()
    # not due yet: polling doesn't hammer the sandbox
    n = len(sandbox.seen)
    assert (await c.get(f"{CODE}/{aid}")).json()["submission"]["status"] == "queued" and len(sandbox.seen) == n
    # the sandbox is back; the automation pass picks it up once it is due
    sandbox.down = False
    assert await S.pass_(db, now() + timedelta(minutes=2)) == {"done": 1}
    got = (await c.get(f"{CODE}/{aid}")).json()["submission"]
    assert got["status"] == "done" and got["passed"] == 5
    assert (await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(aid)}))["task"]["score"] == 100
    # a long outage: after MAX_TRIES a person grades it (never failed by an outage)
    c2, _, aid2, _ = await coding_task(make_client, outbox, db, "ravi@example.com", "Ravi K")
    sandbox.down = True
    await c2.post(f"{CODE}/{aid2}/submit", json={"language": "python", "source": GOOD})
    t = now()
    for _ in range(S.MAX_TRIES):
        t += timedelta(hours=9)
        await S.process(db, ObjectId(aid2), t)
    d2 = (await c2.get(f"{CODE}/{aid2}")).json()["submission"]
    assert d2["status"] == "review" and "person at Nm7" in d2["note"]
    a2 = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(aid2)})
    assert a2["task"]["status"] == "review" and a2["task"]["answer"] == GOOD
    assert await db[VETTING_QUEUE].find_one(
        {"kind": "review", "attempt_id": ObjectId(aid2), "data.why": "sandbox_down"}
    )


async def test_run_rate_limits_per_minute_and_per_task(outbox, db, make_client, admin_client, sandbox):
    owner = await admin_client()
    d = (await owner.get(ADMIN)).json()["settings"]
    await owner.put(ADMIN, json={**d, "runsPerMinute": 2, "runsPerTask": 3})
    c, uid, aid, _ = await coding_task(make_client, outbox, db, "asha@example.com")
    run = lambda: c.post(f"{CODE}/{aid}/run", json={"language": "python", "source": GOOD})  # noqa: E731
    assert (await run()).status_code == 200 and (await run()).status_code == 200
    r = await run()
    assert r.status_code == 429 and err(r) == "rate_limited"
    from app.core import rate_limit

    await rate_limit.clear(db, f"code-run:{uid}")
    assert (await run()).json()["runsLeft"] == 0
    await rate_limit.clear(db, f"code-run:{uid}")
    assert err(await run()) == "runs_used"
    # submitting still works after the runs are used
    assert (await c.post(f"{CODE}/{aid}/submit", json={"language": "python", "source": GOOD})).json()["submission"][
        "status"
    ] == "done"


# --- the replay -----------------------------------------------------------------------------------------------------------


async def test_replay_needs_consent_has_a_size_cap_retention_and_withdraw(outbox, db, make_client, sandbox):
    # no consent: nothing is kept, the task works the same
    c, uid, aid, t = await coding_task(make_client, outbox, db, "asha@example.com")
    line = t.json()["coding"]["consent"]
    assert (
        line["purpose"] == "code_replay"
        and not line["given"]
        and "code editor only" in line["text"]
        and "90 days" in line["text"]
    )
    r = (
        await c.post(f"{CODE}/{aid}/submit", json={"language": "python", "source": GOOD, "replay": typed_replay(GOOD)})
    ).json()
    assert r["replay"] == "no_consent" and r["submission"]["status"] == "done"
    assert await db[TRUST_CODE_REPLAYS].count_documents({}) == 0
    # with the consent: kept, numbers worked out by the server, checked against the code sent
    c2, uid2, aid2, t2 = await coding_task(make_client, outbox, db, "ravi@example.com", "Ravi K", consent=True)
    assert t2.json()["coding"]["consent"]["given"]
    r2 = (
        await c2.post(
            f"{CODE}/{aid2}/submit",
            json={"language": "python", "source": GOOD, "replay": typed_replay(GOOD), "stats": {"typed": 1}},
        )
    ).json()
    assert r2["replay"] == "kept"
    row = await db[TRUST_CODE_REPLAYS].find_one({"attempt_id": ObjectId(aid2)})
    assert (
        row["user_id"] == uid2
        and row["stats"]["typed"] == len(GOOD)
        and row["stats"]["consistent"]
        and row["stats"]["pasted"] == 0
    )
    assert (await db[TRUST_CODE].find_one({"_id": ObjectId(aid2)}))["submission"][
        "flags"
    ] == []  # typed it all: no signal
    # over the cap: not kept, the submission still goes through
    c3, _, aid3, _ = await coding_task(make_client, outbox, db, "meena@example.com", "Meena S", consent=True)
    huge = replay_of([("e", 0, 0, "x" * 1000)] * 250)
    assert RP.size_of(huge) > RP.MAX_BYTES
    r3 = (await c3.post(f"{CODE}/{aid3}/submit", json={"language": "python", "source": GOOD, "replay": huge})).json()
    assert r3["replay"] == "too_big" and r3["submission"]["status"] == "done"
    assert not await db[TRUST_CODE_REPLAYS].find_one({"attempt_id": ObjectId(aid3)})
    with pytest.raises(RP.Bad):
        RP.clean({"v": 1, "start": "", "events": [[1, "e", 0, 0, "a"]] * (RP.MAX_EVENTS + 1)})
    with pytest.raises(RP.Bad):
        RP.clean({"v": 1, "start": "", "events": [[1, "zz", 0, 0, "a"]]})
    # retention: its own type (90 days, Admin 7–180), deleted by the daily job
    dt = R.TYPES["code_replay"]
    assert (dt.days, dt.min_days, dt.max_days, dt.purpose, dt.collection) == (
        90,
        7,
        180,
        "code_replay",
        TRUST_CODE_REPLAYS,
    )
    await db[TRUST_CODE_REPLAYS].update_one(
        {"attempt_id": ObjectId(aid2)}, {"$set": {"created_at": now() - timedelta(days=91)}}
    )
    assert await R.clean_type(db, dt, 90, now()) == 1
    # withdrawing the consent deletes the person's replays at once
    await db[TRUST_CODE_REPLAYS].insert_one(
        {"user_id": uid2, "attempt_id": ObjectId(), "replay": typed_replay("a"), "created_at": now()}
    )
    w = (await c2.delete("/api/me/trust/consents/code_replay")).json()
    assert w["status"] == "withdrawn" and await db[TRUST_CODE_REPLAYS].count_documents({"user_id": uid2}) == 0


async def test_big_paste_and_no_typing_are_t8_signals_never_a_rejection(outbox, db, make_client, sandbox):
    c, uid, aid, t = await coding_task(make_client, outbox, db, "asha@example.com", consent=True)
    starter = t.json()["coding"]["languages"][0]["starter"]
    rep = replay_of([("b", 0, 0, ""), ("f", 0, 0, ""), ("s", 0, 0, GOOD + "# pasted\n" * 30)], starter)
    rep["events"][2][1] = "p"  # one big paste of the whole solution
    rep["events"][2][2], rep["events"][2][3] = 0, len(starter)
    src = GOOD + "# pasted\n" * 30
    r = (await c.post(f"{CODE}/{aid}/submit", json={"language": "python", "source": src, "replay": rep})).json()
    assert r["replay"] == "kept" and r["submission"]["status"] == "done" and r["submission"]["passed"] == 5
    doc = await db[TRUST_CODE].find_one({"_id": ObjectId(aid)})
    assert set(doc["submission"]["flags"]) == {"code_big_paste", "code_no_typing"}
    row = await db[TRUST_CODE_REPLAYS].find_one({"attempt_id": ObjectId(aid)})
    assert row["stats"]["pastes"][0]["size"] == len(src) and row["stats"]["blurs"] == 1 and row["stats"]["consistent"]
    # never a rejection: graded on the tests, the badge is earned, nothing sent to a retest
    a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(aid)})
    assert a["task"]["status"] == "graded" and a["task"]["score"] == 100 and a["integrity"]["level"] != "retest"
    assert await db[VETTING_VERIFIED].find_one({"user_id": uid, "test": "Python"})
    got = (await SG.collect(db, [uid], now()))[uid]["signals"]
    kinds = {s.kind for s in got}
    assert {"code_big_paste", "code_no_typing"} <= kinds and all(k in RT.KINDS for k in kinds)
    assert RT.KINDS["code_no_typing"].source == "T14 coding"
    # without a replay (no consent) the page's counters give the same signals
    c2, uid2, aid2, _ = await coding_task(make_client, outbox, db, "ravi@example.com", "Ravi K")
    await c2.post(
        f"{CODE}/{aid2}/submit",
        json={"language": "python", "source": src, "stats": {"typed": 3, "pasted": 400, "largestPaste": 400}},
    )
    assert set((await db[TRUST_CODE].find_one({"_id": ObjectId(aid2)}))["submission"]["flags"]) == {
        "code_big_paste",
        "code_no_typing",
    }


async def test_reviewer_access_admin_and_company_only_where_allowed(
    client, outbox, db, make_client, admin_client, sandbox
):
    c, uid, aid, _ = await coding_task(make_client, outbox, db, "asha@example.com", consent=True)
    await c.post(f"{CODE}/{aid}/submit", json={"language": "python", "source": GOOD, "replay": typed_replay(GOOD)})
    owner = await admin_client()
    rv = (await owner.get(f"{ADMIN}/replay/{aid}")).json()
    assert (
        rv["replay"]["events"] and rv["passed"] == 5 and rv["cases"][2]["name"] == "negative numbers"
    )  # Admin sees hidden names
    assert await db[AUDIT_LOG].find_one({"action": "trust.code_replay_viewed", "data.by": "admin"})
    res = (await owner.get(f"{ADMIN}/results")).json()["items"]
    assert res[0]["hasReplay"] and res[0]["attemptId"] == aid
    # a company the switch is off for: 404
    s, cid = await verified(client, outbox, db)
    url = f"/api/company/{cid}/trust/code/{uid}"
    assert (await client.get(url, headers=H(s))).status_code == 404
    # a tester company, but the candidate isn't visible to it: 404
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "founder@gmail.com"}})
    assert err(await client.get(url, headers=H(s))) == "not_found"
    # the candidate applied to it: the result and the editor replay (no source, no hidden tests, no other activity)
    await db[APPLICATIONS].insert_one({"user_id": uid, "company_id": cid, "job_id": "j1", "created_at": now()})
    r = await client.get(url, headers=H(s))
    got = r.json()
    assert (
        got["passed"] == 5
        and got["total"] == 5
        and got["replay"]["events"]
        and "source" not in got
        and "cases" not in got
    )
    assert set(got["replay"]) == {"id", "attemptId", "language", "at", "start", "events", "truncated", "stats"}
    no_hidden(r)
    assert await db[AUDIT_LOG].find_one({"action": "trust.code_replay_viewed", "data.by": "company"})
    # the candidate takes the consent back: the replay is gone, the result stays
    await c.delete("/api/me/trust/consents/code_replay")
    assert (await client.get(url, headers=H(s))).json()["replay"] is None
    # Admin turns company replays off: 404
    d = (await owner.get(ADMIN)).json()["settings"]
    await owner.put(ADMIN, json={**d, "companyReplay": False})
    assert (await client.get(url, headers=H(s))).status_code == 404
    # candidates never reach the Admin endpoints
    assert (await c.get(f"{ADMIN}/replay/{aid}")).status_code in (401, 403)


# --- Admin problems ---------------------------------------------------------------------------------------------------------


async def test_admin_adds_problems_validated_by_running_the_reference(outbox, db, admin_client, make_client, sandbox):
    owner = await admin_client()
    items = (await owner.get(f"{ADMIN}/problems")).json()
    assert {p["id"] for p in items["items"]} >= {"sum-even", "top-word"} and items["items"][0][
        "hidden"
    ]  # admins see hidden tests
    body = {"title": "Reverse a word", "statement": "Print the word backwards.", "skills": ["SQL", "Python", "Cooking"], "minutes": 20,
            "languages": {"python": "# TODO\n", "javascript": "// TODO\n"},
            "samples": [{"name": "s1", "stdin": "abc\n", "expected": "cba\n"}],
            "hidden": [{"name": f"h{i}", "stdin": "ab\n", "expected": "ba\n"} for i in range(3)],
            "reference": {"language": "python", "source": "print(input()[::-1])  # TODO"}}  # fmt: skip
    p = (await owner.post(f"{ADMIN}/problems", json=body)).json()
    assert (
        p["id"] == "reverse-a-word"
        and p["skills"] == ["SQL", "Python"]
        and not p["validated"]["ok"]
        and p["validated"]["failing"] == ["s1", "h0", "h1", "h2"]
    )
    assert not await PB.for_skill(db, "SQL")  # not offered until its reference passes
    p = (
        await owner.put(
            f"{ADMIN}/problems/{p['id']}",
            json={**body, "reference": {"language": "python", "source": "print(input()[::-1])"}},
        )
    ).json()
    assert p["validated"]["ok"] and p["version"] == 2 and p["validated"]["passed"] == 4
    assert (await PB.for_skill(db, "SQL"))["_id"] == "reverse-a-word"
    assert await db[AUDIT_LOG].find_one({"action": "trust.code_problem_validated", "target": "reverse-a-word"})
    # rules: too few hidden tests, a reference in a language the problem doesn't offer
    assert err(await owner.post(f"{ADMIN}/problems", json={**body, "hidden": body["hidden"][:2]})) == "invalid"
    assert (
        err(await owner.post(f"{ADMIN}/problems", json={**body, "reference": {"language": "java", "source": "x"}}))
        == "invalid"
    )
    # the sandbox down while validating: saved, not offered, says so
    sandbox.down = True
    v = (await owner.post(f"{ADMIN}/problems/sum-even/validate")).json()["validated"]
    assert not v["ok"] and "couldn’t be reached" in v["error"]
    sandbox.down = False
    assert (await owner.post(f"{ADMIN}/problems/sum-even/validate")).json()["validated"]["ok"]
    # a started task keeps the tests it opened with when Admin edits the problem
    c, _, aid, _ = await coding_task(
        make_client, outbox, db, "asha@example.com", skill="Java"
    )  # Python now gets "Reverse a word"
    sum_body = {k: v for k, v in (await db[TRUST_CODE_PROBLEMS].find_one({"_id": "sum-even"})).items() if k in body}
    await owner.put(f"{ADMIN}/problems/sum-even", json={**sum_body, "hidden": SUM["hidden"][:3]})
    s = (await c.post(f"{CODE}/{aid}/submit", json={"language": "python", "source": GOOD})).json()["submission"]
    assert s["total"] == 5


async def test_ai_review_is_anonymised_feedback_and_never_changes_the_score(
    outbox, db, make_client, monkeypatch, sandbox
):
    seen = []
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")

    async def fake(feature, content, schema, check, *, stats=None, **opts):
        seen.append((feature, content[0]["text"], schema))
        return check(
            {
                "scores": [
                    {"key": "readable", "score": 1, "reason": "Short names."},
                    {"key": "correct_approach", "score": 2, "reason": "Fine."},
                ],
                "confidence": "high",
            }
        )

    monkeypatch.setattr(claude, "ask_models", fake)
    c, uid, aid, _ = await coding_task(make_client, outbox, db, "asha@example.com", "Asha Rao")
    src = "# written by Asha Rao, asha@example.com\n" + GOOD
    await c.post(f"{CODE}/{aid}/submit", json={"language": "python", "source": src})
    feat, text, schema = seen[-1]
    assert feat == "vetting" and schema["additionalProperties"] is False
    assert "Asha" not in text and "asha@example.com" not in text and "print(sum(x for x in map" in text
    for s in SUM["hidden"]:
        assert s["stdin"].strip() not in text or len(s["stdin"].strip()) < 4  # hidden tests are not sent to the AI
    tk = (await c.get(f"{SK}/{aid}")).json()["task"]
    assert tk["score"] == 100 and {f["label"] for f in tk["feedback"]} == {
        "Hidden tests",
        "Code quality: readable",
        "Code quality: approach",
    }


# --- switch OFF -----------------------------------------------------------------------------------------------------------


async def test_switch_off_the_existing_tech_task_unchanged(outbox, db, make_client, admin_client, monkeypatch, sandbox):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    c, uid, aid, t = await coding_task(make_client, outbox, db, "ravi@example.com", "Ravi K", tester=False)
    task = t.json()
    assert task["type"] == "tech" and "coding" not in task and task["brief"] and task["material"]
    res = (await c.get(f"{SK}/{aid}")).json()
    assert "coding" not in (res["task"] or {})
    assert (await c.get(f"{CODE}/{aid}")).status_code == 404
    assert await db[TRUST_CODE].count_documents({}) == 0 and not sandbox.seen
    r = (
        await c.post(
            f"{SK}/{aid}/task/submit", json={"text": "I would join orders to customers and group by city " * 3}
        )
    ).json()
    assert r["task"]["status"] == "review"  # as before without AI: waits for a person
    # a tester while Admin keeps coding tasks off: the written task too
    owner = await admin_client()
    d = (await owner.get(ADMIN)).json()["settings"]
    await owner.put(ADMIN, json={**d, "on": False})
    c2, _, _, t2 = await coding_task(make_client, outbox, db, "asha@example.com")
    assert t2.json()["type"] == "tech"
    # a non-tech role never becomes a coding task
    assert all(not re.search("Excel|Sales", s) for p in PB.SEEDS for s in p["skills"])
