# ruff: noqa: E501
"""Vetting V4: a reviewer applies and passes calibration, Admin activates them; a demo company requests the Nm7 human
check for an Interview-ready candidate; the candidate books a slot and names a referee; the reviewer completes the
check; the referee answers; the badge reads "Nm7 verified" with the reference line. Plus: a referee using the
candidate's own email is flagged, price and payout are free and off by default, the SLA is 24 hours."""

from datetime import timedelta

from app.core.db import USERS, VETTING_L4, VETTING_VERIFIED
from app.core.time import now
from app.hire.vetting import verify as V4
from tests.conftest import approved_expert
from tests.test_companies_apply import student
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_hire_shortlist import READY


def test_calibration_and_defaults():
    assert V4.calibration_score({s["id"]: s["gold"] for s in V4.CALIBRATION}) == 1.0
    off = {s["id"]: {k: (v + 2) % 6 for k, v in s["gold"].items()} for s in V4.CALIBRATION}
    assert V4.calibration_score(off) < V4.CALIBRATION_PASS
    assert V4.DEFAULT_SETTINGS == {"price_inr": 0, "payout_inr": 0, "payments_on": False}
    assert V4.ref_id(V4.ref_token("abc123")) == "abc123" and V4.ref_id("abc123.wrong") is None
    assert not V4.l4_ready(
        {"check": {"passed": True}, "referees": [{"answered_at": now(), "rehire": "yes", "flags": ["x"]}]}
    )


async def test_l4_end_to_end(client, outbox, db, make_client, admin_client):
    # a reviewer: apply, calibrate, Admin activates
    rc, rid = await approved_expert(make_client, outbox, db)
    day = (now() + timedelta(days=1)).astimezone(V4.IST)
    me = (
        await rc.put(
            "/api/reviewer/me",
            json={"roles": ["SQL"], "about": "10 years in data teams", "slots": [{"day": day.weekday(), "hour": 11}]},
        )
    ).json()
    assert me["status"] == "calibrating" and me["free"]
    cal = (await rc.get("/api/reviewer/calibration")).json()
    assert len(cal["samples"]) == 5
    r = (
        await rc.post("/api/reviewer/calibration", json={"answers": {s["id"]: s["gold"] for s in V4.CALIBRATION}})
    ).json()
    assert r["passed"] and r["status"] == "approval"
    owner = await admin_client()
    assert (await owner.put(f"/api/admin/vetting/l4/reviewers/{rid}", json={"status": "active"})).status_code == 200
    # an Interview-ready candidate the company can see
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    await c.put("/api/me/hire", json=READY)
    u = await db[USERS].find_one({"email": "asha@example.com"})
    t = now()
    await db[VETTING_VERIFIED].insert_one(
        {
            "user_id": u["_id"],
            "test": "SQL",
            "band": "1-3",
            "score": 82,
            "task_score": 80,
            "at": t,
            "expires_at": t + timedelta(days=90),
        }
    )
    await db[USERS].update_one({"_id": u["_id"]}, {"$set": {"vetting.level": 3}})
    session, cid = await verified(client, outbox, db)
    req = (await client.post(f"/api/company/{cid}/hire/l4/{u['_id']}", headers=H(session))).json()
    assert (
        req["status"] == "requested"
        and req["dueAt"] - req["requestedAt"] == 24 * 3600 * 1000
        and "flags" not in str(req)
    )
    assert "human check" in outbox.sent[-1].subject
    # the candidate books a slot and names a referee (one with their own email is flagged)
    mine = (await c.get("/api/me/verification")).json()
    assert mine["slots"] and mine["free"]
    assert (await c.post("/api/me/verification/slot", json={"at": mine["slots"][0]["at"]})).json()["status"] == "booked"
    out = (await c.post("/api/me/verification/referees", json={"referees": [
        {"name": "Kiran Rao", "relation": "past manager", "company": "Sri Traders", "email": "kiran@example.com"},
        {"name": "Me Again", "relation": "senior colleague", "email": "asha@example.com"}]})).json()  # fmt: skip
    assert out["referees"][1]["flags"] and not out["referees"][0]["flags"]
    # the reviewer completes the check
    checks = (await rc.get("/api/reviewer/checks")).json()
    assert checks["active"] and checks["items"][0]["person"] == "Asha Rao"
    done = (await rc.post(f"/api/reviewer/checks/{checks['items'][0]['id']}/result", json={
        "score": 4, "passed": True, "note": "Matches profile.\nSolid on joins; window functions weaker.\nSerious, can join in 15 days.",
        "checklist": {k: True for k, _ in V4.CHECKLIST}})).json()  # fmt: skip
    assert done["status"] == "checked" and done["check"]["passed"]
    assert not (await db[USERS].find_one({"_id": u["_id"]})).get(
        "vetting_l4_until"
    )  # not yet: the reference is missing
    # the referee answers through the emailed link
    doc = await db[VETTING_L4].find_one({"user_id": u["_id"]})
    token = V4.ref_token(doc["referees"][0]["rid"])
    form = (await client.get(f"/api/public/reference/{token}")).json()
    assert form["candidate"] == "Asha" and len(form["questions"]) == 5
    r = (await client.post(f"/api/public/reference/{token}", json={"role": "Sales analyst", "dates": "2023 – 2025", "rehire": "yes",
                                                                    "strengths": "Careful with numbers"})).json()  # fmt: skip
    assert r["ok"]
    assert (
        err(
            await client.post(
                f"/api/public/reference/{token}",
                json={"role": "x" * 3, "dates": "2023", "rehire": "yes", "strengths": "ok"},
            )
        )
        == "done"
    )
    u = await db[USERS].find_one({"_id": u["_id"]})
    assert (
        u["vetting_l4_until"] > now() + timedelta(days=360)
        and u["vetting_l4_line"] == "Confirmed by a past manager at Sri Traders"
    )
    lv = (await c.get("/api/me/level")).json()
    assert lv["steps"]["Get the Nm7 human check and a reference"]  # the L4 input is in (L4 itself also needs L1–L3)
    # Admin sees it, with no money involved
    o = (await owner.get("/api/admin/vetting/l4")).json()
    assert o["requests"][0]["referenceLine"].startswith("Confirmed by") and o["settings"]["payments_on"] is False
    assert o["reviewers"][0]["completed"] == 1
    # a company rates the candidate after interviewing them: feeds the reviewer's quality
    assert (
        await client.post(f"/api/company/{cid}/hire/l4/{u['_id']}/rating", json={"stars": 5}, headers=H(session))
    ).json()["ok"]
