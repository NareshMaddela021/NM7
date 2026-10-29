"""Recruiter feedback to the college (R4, Drive and Campus): the one-minute form in the portal and from My drives
(past drives too), validation against the skills dictionary, one answer per invite (editable), the college's
per-drive list and "What recruiters said" (average, visit again, top gaps with free courses), nothing about a student,
the plan switch, and the demo."""

from app.core.db import AUDIT_LOG, RECRUITER_FEEDBACK
from app.orgs import demo
from tests.test_org_recruiter_portal import campus, err, invite, owner, plan, resume, sign_in  # noqa: F401
from tests.test_orgs_recruiter import opted_in
from tests.test_recruiter_accounts import account

FORM = {"rating": 4, "skills": ["sql", "Power BI"], "basics": ["python"], "projectsNoResults": True,
        "communication": False, "other": "Few knew Git branching", "wentWell": "Well organised",
        "visitAgain": "yes"}  # fmt: skip


async def test_portal_form_and_college_summary(campus, owner, db, make_client, outbox):  # noqa: F811
    org, g = campus
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao", data=resume("Asha Rao", "asha@example.com"))
    inv, token = await invite(owner, org["id"], [g["id"]])
    rec = make_client()
    h = await sign_in(rec, outbox, token)
    base = f"/api/recruiter/{token}/feedback"
    got = (await rec.get(base, headers=h)).json()
    assert got["feedback"] is None and "SQL" in got["options"] and got["company"] == "Acme Analytics"
    # validation: a rating 1–5, skills from the dictionary, visit again yes / maybe / no
    assert (await rec.put(base, headers=h, json={**FORM, "rating": 6})).status_code == 422
    assert (await rec.put(base, headers=h, json={**FORM, "skills": ["Underwater basket weaving"]})).status_code == 422
    assert (await rec.put(base, headers=h, json={**FORM, "visitAgain": "never"})).status_code == 422
    r = await rec.put(base, headers=h, json=FORM)
    assert r.status_code == 200, r.text
    f = r.json()["feedback"]
    assert f["skills"] == ["SQL", "Power BI"] and f["basics"] == ["Python"]
    assert f["gaps"] == ["SQL", "Power BI", "Basics of Python", "Projects without results"]
    # changed later: still one answer
    await rec.put(base, headers=h, json={**FORM, "rating": 3, "communication": True})
    assert await db[RECRUITER_FEEDBACK].count_documents({}) == 1
    # a second drive's feedback
    inv2, token2 = await invite(owner, org["id"], [g["id"]], company="Beta Labs")
    h2 = await sign_in(make_client(), outbox, token2)
    rec2 = make_client()
    second = {**FORM, "rating": 5, "skills": ["SQL"], "basics": [], "visitAgain": "maybe"}
    await rec2.put(f"/api/recruiter/{token2}/feedback", headers=h2, json=second)
    # the college
    col = (await owner.get(f"/api/org/{org['id']}/recruiter-feedback")).json()
    s = col["summary"]
    assert s["count"] == 2 and s["rating"] == 4.0 and s["visitAgain"] == {"yes": 1, "maybe": 1, "no": 0}
    top = {t["gap"]: t for t in s["topGaps"]}
    assert top["SQL"]["count"] == 2 and top["Projects without results"]["count"] == 2
    assert top["SQL"]["courses"] and all(c["free"] for c in top["SQL"]["courses"])  # free courses linked
    assert top["Basics of Python"]["courses"]
    assert {d["company"] for d in col["drives"]} == {"Acme Analytics", "Beta Labs"}
    # nothing about a student anywhere in what the college sees
    assert "Asha" not in str(col) and "asha@example.com" not in str(col)
    assert await db[AUDIT_LOG].count_documents({"action": "recruiter_feedback"}) == 3


async def test_from_my_drives_after_the_invite_ends(campus, owner, db, make_client, outbox):  # noqa: F811
    org, g = campus
    inv, _ = await invite(owner, org["id"], [g["id"]])
    await owner.post(f"/api/org/{org['id']}/recruiter-invites/{inv['id']}/revoke")
    rec = make_client()
    h = await account(rec, outbox)
    base = f"/api/recruiter-account/drives/{inv['id']}/feedback"
    assert (await rec.get(base, headers=h)).json()["feedback"] is None
    assert (await rec.put(base, headers=h, json=FORM)).json()["feedback"]["rating"] == 4
    # another recruiter can't
    other = make_client()
    assert (await other.get(base, headers={"X-Recruiter-Account": "x" * 43})).status_code == 401
    assert (await rec.get("/api/recruiter-account/drives/nope/feedback", headers=h)).status_code == 404
    # the plan: Free has no recruiter features at all; an override switches feedback off
    r = await owner.put(f"/api/admin/orgs/{org['id']}/features", json={"recruiterFeedback": False})
    assert r.status_code == 200
    assert err(await rec.get(base, headers=h)) == "plan_feature"
    assert (await owner.get(f"/api/org/{org['id']}/recruiter-feedback")).status_code == 404


async def test_drive_plan_has_it_and_the_demo(owner, db, make_client, outbox):  # noqa: F811
    made = await demo.create_demo(db, None)
    col = (await owner.get(f"/api/org/{made['orgId']}/recruiter-feedback")).json()
    gaps = {t["gap"] for t in col["summary"]["topGaps"]}
    assert col["summary"]["count"] == 1 and gaps == {"SQL", "Power BI", "Basics of Python", "Projects without results"}
    await demo.remove_demo(db)
    assert await db[RECRUITER_FEEDBACK].count_documents({}) == 0
    from tests.test_orgs import setup_group

    org, g = await setup_group(owner)
    await plan(owner, org["id"], "drive")
    assert (await owner.get(f"/api/org/{org['id']}/recruiter-feedback")).status_code == 200
