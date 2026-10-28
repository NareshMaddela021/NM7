"""Drive days and QR check-in: plan gating, organization isolation, consent, check-in only for students in that
slot (with the room's current code, on the day, in time), late / absent, hand marking, CSV, Activity log."""

from datetime import datetime

import pytest

from app.college import drives
from app.core.db import AUDIT_LOG, MEMBERSHIPS
from app.core.time import IST
from tests.test_orgs import setup_group
from tests.test_orgs_phase2 import coordinator, second_org

DAY = "2026-11-03"
AT = datetime(2026, 11, 3, 10, 0, tzinfo=IST)


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    state = {"t": AT}
    monkeypatch.setattr(drives, "now", lambda: state["t"])
    return state


async def campus(owner):
    org, g = await setup_group(owner)
    r = await owner.put(f"/api/admin/orgs/{org['id']}/billing/plan", json={"planId": "campus"})
    assert r.status_code == 200, r.text
    return org, g


async def students(make_client, outbox, n=3, code="JNTUA26", prefix="s"):
    """n members who joined (consented); returns [(client, membership id)]."""
    from tests.test_orgs import member

    out = []
    for i in range(n):
        c, _ = await member(make_client, outbox, f"{prefix}{i}@example.com", f"Student {prefix}{i}")
        r = await c.post(
            "/api/me/groups/join",
            json={"code": code, "consent": True, "fields": {"roll": f"21A0{i}", "branch": "CSE"}, "resumeId": "r1"},
        )
        assert r.status_code == 201, r.text
        out.append((c, r.json()["id"]))
    return out


async def a_drive(c, org_id, group_id):
    r = await c.post(
        f"/api/org/{org_id}/drives",
        json={"name": "Campus drive", "date": DAY, "groupIds": [group_id], "companies": ["Infosys", "TCS"]},
    )
    assert r.status_code == 201, r.text
    d = r.json()
    base = f"/api/org/{org_id}/drives/{d['id']}"
    infosys = d["companies"][0]["id"]
    for room, start, end in (("Lab 1", "09:55", "11:00"), ("Lab 2", "09:55", "11:00")):
        r = await c.post(
            f"{base}/slots", json={"companyId": infosys, "round": "test", "room": room, "start": start, "end": end}
        )
        assert r.status_code == 201, r.text
    return base, (await c.post(f"{base}/auto-assign")).json()


async def test_off_on_free_and_drive_plans_get_it(owner, make_client, outbox):
    org, g = await setup_group(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    assert (await c.get(f"/api/org/{org['id']}/drives")).status_code == 404  # Free: the feature doesn't exist
    await owner.put(f"/api/admin/orgs/{org['id']}/billing/plan", json={"planId": "drive"})
    assert (await c.get(f"/api/org/{org['id']}/drives")).status_code == 200


async def test_schedule_auto_assign_and_my_drive_day(owner, make_client, outbox, db):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    people = await students(make_client, outbox, 3)
    # one leaves the group: never scheduled
    leaver, leaver_mid = people[2]
    await db[MEMBERSHIPS].update_one({"_id": leaver_mid}, {"$set": {"left_at": AT}})
    base, d = await a_drive(c, org["id"], g["id"])
    assert [s["students"] for s in d["slots"]] == [1, 1]  # 2 active students over 2 rooms
    assert d["slots"][0]["roundName"] == "Test" and d["slots"][0]["company"] == "Infosys"
    # the students see their own slot only
    s0 = people[0][0]
    mine = (await s0.get("/api/me/drives")).json()
    assert len(mine) == 1 and len(mine[0]["slots"]) == 1
    slot = mine[0]["slots"][0]
    assert (slot["company"], slot["round"], slot["room"], slot["status"]) == ("Infosys", "Test", "Lab 1", "waiting")
    assert (await leaver.get("/api/me/drives")).json() == []


async def test_check_in_only_your_slot_with_the_current_code(owner, make_client, outbox, db, clock):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    (s0, m0), (s1, m1) = await students(make_client, outbox, 2)
    base, d = await a_drive(c, org["id"], g["id"])
    lab1, lab2 = d["slots"]
    code1 = (await c.get(f"{base}/slots/{lab1['id']}/code")).json()
    assert code1["url"].endswith(f"/checkin?s={lab1['id']}&c={code1['code']}") and len(code1["code"]) == 6
    code2 = (await c.get(f"{base}/slots/{lab2['id']}/code")).json()["code"]
    # s1 sits in Lab 2: Lab 1's QR doesn't check them in
    r = await s1.post("/api/me/checkin", json={"slotId": lab1["id"], "code": code1["code"]})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_your_slot"
    # a wrong code
    bad = "000000" if code1["code"] != "000000" else "111111"
    assert (await s0.post("/api/me/checkin", json={"code": bad})).json()["error"]["code"] == "wrong_code"
    # scanned (slot + code) and typed (code only)
    r = await s0.post("/api/me/checkin", json={"slotId": lab1["id"], "code": code1["code"]})
    assert r.status_code == 200 and r.json()["status"] == "present" and r.json()["room"] == "Lab 1"
    clock["t"] = datetime(2026, 11, 3, 10, 10, tzinfo=IST)  # 15 minutes after the start: late
    r = await s1.post("/api/me/checkin", json={"code": code2})
    assert r.status_code == 200 and r.json()["status"] == "late"
    att = (await c.get(f"{base}/slots/{lab1['id']}/attendance")).json()
    assert att["counts"] == {"present": 1, "late": 0, "absent": 0, "waiting": 0}
    assert att["rows"][0]["by"] == "self"
    # a student from another organization can't use the code
    o2, g2 = await second_org(owner)
    outsider, _ = (await students(make_client, outbox, 1, code="WELD26", prefix="o"))[0]
    assert (
        await outsider.post("/api/me/checkin", json={"slotId": lab1["id"], "code": code1["code"]})
    ).status_code == 404
    # after the slot: absent for those who never came; the check-in window is closed
    await c.post(f"{base}/slots/{lab1['id']}/mark", json={"membershipId": m0, "present": False})
    clock["t"] = datetime(2026, 11, 3, 11, 30, tzinfo=IST)
    att = (await c.get(f"{base}/slots/{lab1['id']}/attendance")).json()
    assert att["counts"]["absent"] == 1
    # marked by hand
    att = (await c.post(f"{base}/slots/{lab1['id']}/mark", json={"membershipId": m0, "present": True})).json()
    assert att["rows"][0]["by"] == "staff" and att["counts"]["absent"] == 0
    # can't mark someone who isn't in the slot
    assert (
        await c.post(f"{base}/slots/{lab1['id']}/mark", json={"membershipId": m1, "present": True})
    ).status_code == 404
    csv = (await c.get(f"{base}/attendance.csv")).text
    assert "Lab 1" in csv and "21A00" in csv and "Coordinator" in csv and "QR / code" in csv
    acts = {a["action"] async for a in db[AUDIT_LOG].find({"data.orgs": org["id"]})}
    assert {"drive_create", "drive_slot", "drive_assign", "drive_mark", "drive_export", "drive_checkin"} <= acts


async def test_too_early_and_another_day(owner, make_client, outbox, clock):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    (s0, _), _ = await students(make_client, outbox, 2)
    base, d = await a_drive(c, org["id"], g["id"])
    clock["t"] = datetime(2026, 11, 3, 8, 0, tzinfo=IST)
    code = (await c.get(f"{base}/slots/{d['slots'][0]['id']}/code")).json()["code"]
    r = await s0.post("/api/me/checkin", json={"code": code})
    assert r.status_code == 400 and "opens at 08:55" in r.json()["error"]["message"]
    clock["t"] = datetime(2026, 11, 2, 10, 0, tzinfo=IST)  # the day before
    assert (await s0.post("/api/me/checkin", json={"code": code})).status_code == 404


async def test_other_organizations_and_viewers(owner, make_client, outbox):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    await students(make_client, outbox, 2)
    base, d = await a_drive(c, org["id"], g["id"])
    o2, _ = await second_org(owner)
    await owner.put(f"/api/admin/orgs/{o2['id']}/billing/plan", json={"planId": "campus"})
    other, _ = await coordinator(owner, make_client, outbox, o2["id"], email="other@example.com")
    assert (await other.get(base)).status_code == 404
    assert (await other.get(f"/api/org/{o2['id']}/drives/{d['id']}")).status_code == 404
    assert (await other.get(f"/api/org/{o2['id']}/drives")).json() == []
    viewer, _ = await coordinator(owner, make_client, outbox, org["id"], email="viewer@example.com", role="viewer")
    assert (await viewer.get(base)).status_code == 200
    assert (await viewer.post(f"{base}/auto-assign")).status_code == 403
