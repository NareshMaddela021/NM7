"""Nm7 for Organizations (Phase 2): coordinator logins and their server-side scope, invites, group dashboards,
reminders (throttle and opt-out), approval, review and "mark as not printed"."""

import csv
import io
from datetime import timedelta

import pytest

from app.core.db import AUDIT_LOG, MEMBERSHIPS, ORG_STAFF
from app.core.time import now
from app.orgs import router as orgs_router
from tests.conftest import signup
from tests.test_orgs import RESUME, join, member, setup_group


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def invite(owner, org_id, email, role="coordinator", group_ids=None):
    r = await owner.post(f"/api/admin/orgs/{org_id}/staff", json={"email": email, "role": role, "groupIds": group_ids})
    assert r.status_code == 201, r.text
    return r.json()


async def coordinator(owner, make_client, outbox, org_id, email="coord@example.com", **kw):
    """A signed-in coordinator (or viewer) of org_id. Returns (client, staff row)."""
    s = await invite(owner, org_id, email, **kw)
    c = make_client()
    await signup(c, outbox, email, name="Coord Inator")
    token = s["inviteUrl"].rsplit("/", 1)[1]
    r = await c.post(f"/api/org-invites/{token}/accept")
    assert r.status_code == 200, r.text
    return c, s


async def second_org(owner):
    o = (await owner.post("/api/admin/orgs", json={"name": "Skill Hub Kurnool", "type": "skill_centre"})).json()
    g = (await owner.post(f"/api/admin/orgs/{o['id']}/groups", json={"name": "Welders 2026", "code": "WELD26"})).json()
    return o, g


async def joined(make_client, outbox, code, n=2, prefix="m", data=None):
    """n members in the group with code; returns their membership ids."""
    ids = []
    for i in range(n):
        c, _ = await member(make_client, outbox, f"{prefix}{i}@example.com", f"Member {prefix}{i}", data)
        r = await c.post(
            "/api/me/groups/join",
            json={
                "code": code,
                "consent": True,
                "fields": {"roll": f"R{prefix}{i}", "branch": "CSE"},
                "resumeId": "r1",
            },
        )
        if r.status_code != 201:  # groups without questions
            r = await c.post("/api/me/groups/join", json={"code": code, "consent": True, "resumeId": "r1"})
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    return ids


# ---------- invites ----------


async def test_invite_link_is_one_time_expires_and_needs_the_same_verified_email(owner, make_client, outbox, db):
    org, _ = await setup_group(owner)
    s = await invite(owner, org["id"], "Coord@Example.com")
    assert s["status"] == "invited" and s["emailSent"] is True
    mail = next(m for m in outbox.sent if m.to == "Coord@Example.com")
    assert "/org/invite/" in mail.text and org["name"] in mail.subject
    token = s["inviteUrl"].rsplit("/", 1)[1]

    anon = make_client()
    info = (await anon.get(f"/api/org-invites/{token}")).json()
    assert info == {"orgName": "JNTU Anantapur", "email": "Coord@Example.com", "role": "coordinator"}
    assert (await anon.post(f"/api/org-invites/{token}/accept")).status_code == 401

    other = make_client()
    await signup(other, outbox, "someone@example.com")
    r = await other.post(f"/api/org-invites/{token}/accept")
    assert r.status_code == 403 and err(r) == "email_mismatch"

    c = make_client()
    await signup(c, outbox, "coord@example.com")  # same address, other case
    r = await c.post(f"/api/org-invites/{token}/accept")
    assert r.status_code == 200 and r.json()["orgId"] == org["id"]
    assert (await c.get("/api/me/orgs")).json() == [
        {"orgId": org["id"], "orgName": "JNTU Anantapur", "role": "coordinator"}
    ]
    # used: never again
    assert err(await c.post(f"/api/org-invites/{token}/accept")) == "invite_invalid"
    assert (await anon.get(f"/api/org-invites/{token}")).status_code == 404
    assert (await db[ORG_STAFF].find_one({}))["invite_token_hash"] is None
    # already staff
    r = await owner.post(f"/api/admin/orgs/{org['id']}/staff", json={"email": "coord@example.com"})
    assert r.status_code == 409


async def test_expired_and_resent_invites(owner, make_client, outbox, db):
    org, _ = await setup_group(owner)
    s = await invite(owner, org["id"], "late@example.com", role="viewer")
    old = s["inviteUrl"].rsplit("/", 1)[1]
    await db[ORG_STAFF].update_one({"_id": s["id"]}, {"$set": {"expires_at": now() - timedelta(minutes=1)}})
    c = make_client()
    await signup(c, outbox, "late@example.com")
    r = await c.post(f"/api/org-invites/{old}/accept")
    assert r.status_code == 410 and err(r) == "invite_expired"
    again = (await owner.post(f"/api/admin/staff/{s['id']}/resend")).json()
    new = again["inviteUrl"].rsplit("/", 1)[1]
    assert new != old
    assert err(await c.post(f"/api/org-invites/{old}/accept")) == "invite_invalid"  # the old link is replaced
    assert (await c.post(f"/api/org-invites/{new}/accept")).json()["role"] == "viewer"
    assert (await owner.post(f"/api/admin/staff/{s['id']}/resend")).status_code == 400  # accepted already


async def test_staff_management_is_super_admin_only(owner, admin_client, make_client, outbox):
    org, _ = await setup_group(owner)
    c, s = await coordinator(owner, make_client, outbox, org["id"])
    ops = await admin_client("ops")
    for who in (c, ops):
        assert (await who.get(f"/api/admin/orgs/{org['id']}/staff")).status_code == 403
        assert (
            await who.post(f"/api/admin/orgs/{org['id']}/staff", json={"email": "x@example.com"})
        ).status_code == 403
        assert (await who.delete(f"/api/admin/staff/{s['id']}")).status_code == 403
    staff = (await owner.get(f"/api/admin/orgs/{org['id']}/staff")).json()
    assert staff[0]["status"] == "active" and staff[0]["name"] == "Coord Inator"


# ---------- scope ----------


async def test_a_coordinator_gets_404_for_everything_of_another_org(owner, make_client, outbox, db):
    org_a, g_a = await setup_group(owner)
    org_b, g_b = await second_org(owner)
    [m_a] = await joined(make_client, outbox, g_a["code"], 1, "a")
    [m_b] = await joined(make_client, outbox, g_b["code"], 1, "b")
    c, _ = await coordinator(owner, make_client, outbox, org_a["id"])

    A, B = f"/api/org/{org_a['id']}", f"/api/org/{org_b['id']}"
    assert (await c.get(A)).status_code == 200
    assert [r["membershipId"] for r in (await c.get(f"{A}/shared-resumes")).json()["rows"]] == [m_a]
    calls = [
        ("get", B, None),
        ("get", f"{B}/shared-resumes", None),
        ("get", f"{B}/shared-resumes/{m_b}", None),
        ("post", f"{B}/shared-resumes/export.csv", {}),
        ("post", f"{B}/shared-resumes/exports", {"kind": "print_bulk"}),
        ("get", f"{B}/groups/{g_b['id']}/dashboard", None),
        ("post", f"{B}/shared-resumes/remind", {"segment": "incomplete", "group": g_b["id"]}),
        ("post", f"{B}/shared-resumes/approval", {"ids": [m_b], "action": "approve"}),
        ("post", f"{B}/shared-resumes/review", {"ids": [m_b], "status": "ready"}),
        ("post", f"{B}/shared-resumes/unprint", {"ids": [m_b]}),
        ("post", f"{B}/groups", {"name": "Sneaky"}),
        ("patch", f"{B}/groups/{g_b['id']}", {"name": "Sneaky"}),
        ("get", f"{B}/audit", None),
        # org B's things through org A's own path
        ("get", f"{A}/shared-resumes/{m_b}", None),
        ("get", f"{A}/shared-resumes?group={g_b['id']}", None),
        ("get", f"{A}/shared-resumes?org={org_b['id']}", None),
        ("post", f"{A}/shared-resumes/export.csv", {"group": g_b["id"]}),
        ("post", f"{A}/shared-resumes/exports", {"kind": "print_bulk", "filters": {"group": g_b["id"]}}),
        ("get", f"{A}/groups/{g_b['id']}/dashboard", None),
        ("post", f"{A}/shared-resumes/remind", {"segment": "incomplete", "group": g_b["id"]}),
        ("patch", f"{A}/groups/{g_b['id']}", {"name": "Sneaky"}),
    ]
    for method, url, body in calls:
        r = await getattr(c, method)(url, **({"json": body} if body is not None else {}))
        assert r.status_code == 404, (method, url, r.status_code)
    # selections that mix in org B's members only ever touch org A's
    r = await c.post(f"{A}/shared-resumes/exports", json={"kind": "print_bulk", "ids": [m_a, m_b]})
    assert [i["membershipId"] for i in r.json()["items"]] == [m_a]
    assert (await c.post(f"{A}/shared-resumes/approval", json={"ids": [m_b], "action": "reject"})).json()[
        "updated"
    ] == 0
    assert (await db[MEMBERSHIPS].find_one({"_id": m_b}))["approval"] == "approved"
    # and the admin console stays closed
    assert (await c.get("/api/admin/shared-resumes")).status_code == 403
    assert (await c.get("/api/admin/orgs")).status_code == 403


async def test_group_restricted_coordinator_sees_only_their_groups(owner, make_client, outbox):
    org, g1 = await setup_group(owner)
    g2 = (await owner.post(f"/api/admin/orgs/{org['id']}/groups", json={"name": "MBA 2026", "code": "MBA2026"})).json()
    [m1] = await joined(make_client, outbox, g1["code"], 1, "x")
    [m2] = await joined(make_client, outbox, g2["code"], 1, "y")
    c, _ = await coordinator(owner, make_client, outbox, org["id"], group_ids=[g1["id"]])
    base = f"/api/org/{org['id']}"
    home = (await c.get(base)).json()
    assert [g["id"] for g in home["groupList"]] == [g1["id"]] and home["canCreateGroups"] is False
    assert [r["membershipId"] for r in (await c.get(f"{base}/shared-resumes")).json()["rows"]] == [m1]
    assert (await c.get(f"{base}/shared-resumes/{m2}")).status_code == 404
    assert (await c.get(f"{base}/groups/{g2['id']}/dashboard")).status_code == 404
    assert (await c.get(f"{base}/shared-resumes?group={g2['id']}")).status_code == 404
    assert (await c.patch(f"{base}/groups/{g2['id']}", json={"name": "Renamed"})).status_code == 404
    assert (await c.post(f"{base}/groups", json={"name": "New one"})).status_code == 403
    csv_rows = list(csv.reader(io.StringIO((await c.post(f"{base}/shared-resumes/export.csv", json={})).text)))
    assert len(csv_rows) == 2
    # their own group: open / close joining
    r = await c.patch(f"{base}/groups/{g1['id']}", json={"settings": {"active": False}})
    assert r.status_code == 200 and r.json()["settings"]["active"] is False
    assert r.json()["settings"]["membersDownloadFree"] is False  # other settings kept
    # free downloads cost Nm7: only the super-admin decides
    r = await c.patch(f"{base}/groups/{g1['id']}", json={"settings": {"membersDownloadFree": True}})
    assert r.status_code == 403 and err(r) == "nm7_only"
    r = await c.patch(f"{base}/groups/{g1['id']}", json={"settings": {"membersDownloadFree": False, "active": True}})
    assert r.status_code == 200


async def test_viewer_can_view_and_print_only(owner, make_client, outbox):
    org, g = await setup_group(owner)
    [m] = await joined(make_client, outbox, g["code"], 1, "v")
    c, _ = await coordinator(owner, make_client, outbox, org["id"], email="viewer@example.com", role="viewer")
    base = f"/api/org/{org['id']}"
    assert (await c.get(f"{base}/shared-resumes")).json()["total"] == 1
    assert (await c.get(f"{base}/shared-resumes/{m}")).status_code == 200
    assert (await c.get(f"{base}/groups/{g['id']}/dashboard")).status_code == 200
    job = await c.post(f"{base}/shared-resumes/exports", json={"kind": "print_bulk"})
    assert job.status_code == 201
    denied = [
        ("post", f"{base}/shared-resumes/approval", {"ids": [m], "action": "approve"}),
        ("post", f"{base}/shared-resumes/remind", {"segment": "incomplete", "group": g["id"]}),
        ("post", f"{base}/shared-resumes/review", {"ids": [m], "status": "ready"}),
        ("post", f"{base}/shared-resumes/unprint", {"ids": [m]}),
        ("post", f"{base}/shared-resumes/export.csv", {}),
        ("post", f"{base}/shared-resumes/exports", {"kind": "export_zip"}),
        ("patch", f"{base}/groups/{g['id']}", {"name": "Renamed"}),
        ("post", f"{base}/groups", {"name": "New group"}),
    ]
    for method, url, body in denied:
        r = await getattr(c, method)(url, json=body)
        assert r.status_code == 403 and err(r) == "viewer_only", (url, r.status_code)


async def test_removed_staff_lose_access_at_once(owner, make_client, outbox):
    org, _ = await setup_group(owner)
    c, s = await coordinator(owner, make_client, outbox, org["id"])
    base = f"/api/org/{org['id']}"
    assert (await c.get(base)).status_code == 200
    assert (await owner.delete(f"/api/admin/staff/{s['id']}")).status_code == 204
    for url in (base, f"{base}/shared-resumes", f"{base}/audit"):
        assert (await c.get(url)).status_code == 404
    assert (await c.get("/api/me/orgs")).json() == []
    # a role change applies at once too
    c2, s2 = await coordinator(owner, make_client, outbox, org["id"], email="c2@example.com")
    await owner.patch(f"/api/admin/staff/{s2['id']}", json={"role": "viewer"})
    assert (await c2.post(f"{base}/groups", json={"name": "Nope"})).status_code == 403


async def test_staff_actions_are_audited_and_coordinators_see_their_org_only(owner, make_client, outbox, db):
    org_a, g_a = await setup_group(owner)
    org_b, _ = await second_org(owner)
    [m] = await joined(make_client, outbox, g_a["code"], 1, "au")
    c, _ = await coordinator(owner, make_client, outbox, org_a["id"])
    base = f"/api/org/{org_a['id']}"
    await c.get(f"{base}/shared-resumes/{m}")
    await c.post(f"{base}/shared-resumes/review", json={"ids": [m], "status": "ready"})
    e = await db[AUDIT_LOG].find_one({"action": "review"})
    assert e["data"]["by"] == "staff" and e["data"]["role"] == "coordinator" and e["data"]["orgs"] == [org_a["id"]]
    mine = (await c.get(f"{base}/audit")).json()
    actions = {a["action"] for a in mine}
    assert {"view", "review", "staff_accept", "group_create"} <= actions
    assert all(a["action"] != "org_create" or a["target"] == org_a["id"] for a in mine)
    assert not any(a["target"] == org_b["id"] for a in mine)
    assert any(a["byStaff"] for a in (await owner.get("/api/admin/org-audit")).json())


# ---------- approval ----------


async def test_pending_and_rejected_members_never_reach_exports(owner, make_client, outbox, db):
    org, g = await setup_group(owner, settings={"requireApproval": True, "active": True})
    ids = await joined(make_client, outbox, g["code"], 3, "p")
    assert {m["approval"] async for m in db[MEMBERSHIPS].find()} == {"pending"}
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    base = f"/api/org/{org['id']}/shared-resumes"
    assert (await c.get(base)).json()["total"] == 0  # pending hidden by default
    assert (await c.get(base, params={"approval": "pending"})).json()["total"] == 3
    r = await c.post(f"{base}/exports", json={"kind": "print_bulk", "ids": ids})
    assert r.status_code == 400 and err(r) == "nothing_selected"
    assert len(list(csv.reader(io.StringIO((await c.post(f"{base}/export.csv", json={"approval": "all"})).text)))) == 1

    assert (await c.post(f"{base}/approval", json={"ids": ids[:2], "action": "approve"})).json()["updated"] == 2
    assert (await c.post(f"{base}/approval", json={"ids": ids[2:], "action": "reject"})).json()["updated"] == 1
    assert (await c.get(base, params={"approval": "rejected"})).json()["total"] == 1
    job = (await c.post(f"{base}/exports", json={"kind": "export_zip", "ids": ids})).json()
    assert sorted(i["membershipId"] for i in job["items"]) == sorted(ids[:2])
    lines = list(
        csv.reader(
            io.StringIO((await owner.post("/api/admin/shared-resumes/export.csv", json={"approval": "all"})).text)
        )
    )
    assert len(lines) == 3 and all(line[8] == "Approved" for line in lines[1:])
    # rejected later: dropped from a running job's data too
    await c.post(f"{base}/approval", json={"ids": [ids[0]], "action": "reject"})
    data = (await c.get(f"{base}/exports/{job['job']}/data")).json()
    assert [d["data"] is None for d in data].count(True) == 1
    # the member sees their status
    assert (await db[MEMBERSHIPS].find_one({"_id": ids[1]}))["approval"] == "approved"


async def test_pending_members_dont_get_free_downloads(owner, make_client, outbox):
    org, g = await setup_group(owner, settings={"requireApproval": True, "active": True, "membersDownloadFree": True})
    c, _ = await member(make_client, outbox)
    m = (await join(c)).json()
    assert m["approval"] == "pending"
    assert (await c.get("/api/me/entitlements")).json()["reason"] == "unpaid"
    await owner.post("/api/admin/shared-resumes/approval", json={"ids": [m["id"]], "action": "approve"})
    assert (await c.get("/api/me/entitlements")).json()["reason"] == "group"


# ---------- review ----------


async def test_needs_changes_emails_the_member_and_an_edit_resets_it(owner, make_client, outbox, db):
    org, g = await setup_group(owner)
    c, _ = await member(make_client, outbox)
    m = (await join(c)).json()
    co, _ = await coordinator(owner, make_client, outbox, org["id"])
    base = f"/api/org/{org['id']}/shared-resumes"
    r = await co.post(f"{base}/review", json={"ids": [m["id"]], "status": "needs_changes"})
    assert r.status_code == 400 and err(r) == "note_required"
    note = "Add your internship <b>dates</b>"
    r = (await co.post(f"{base}/review", json={"ids": [m["id"]], "status": "needs_changes", "note": note})).json()
    assert r == {
        "updated": 1,
        "emailed": 1,
        "skipped": 0,
        "reasons": {"optedOut": 0, "recent": 0, "overLimit": 0, "failed": 0},
    }
    mail = outbox.sent[-1]
    assert mail.to == "asha@example.com" and note in mail.text and "&lt;b&gt;dates&lt;/b&gt;" in mail.html
    mine = (await c.get("/api/me/groups")).json()[0]
    assert mine["reviewStatus"] == "needs_changes" and mine["reviewNote"] == note
    assert (await co.get(base, params={"review": "needs_changes"})).json()["total"] == 1

    # saving the same data again changes nothing; a real edit sends it back for another look
    await c.patch("/api/me/resumes/r1", json={"data": RESUME})
    assert (await c.get("/api/me/groups")).json()[0]["reviewStatus"] == "needs_changes"
    await c.patch("/api/me/resumes/r1", json={"data": {**RESUME, "summary": "Added dates"}})
    assert (await c.get("/api/me/groups")).json()[0]["reviewStatus"] == "none"

    await co.post(f"{base}/review", json={"ids": [m["id"]], "status": "ready"})
    rows = (await co.get(base, params={"readyNotPrinted": "true"})).json()
    assert rows["total"] == 1 and rows["rows"][0]["reviewStatus"] == "ready"


async def test_export_only_ready_and_ready_not_printed(owner, make_client, outbox):
    org, g = await setup_group(owner)
    ids = await joined(make_client, outbox, g["code"], 3, "rd")
    base = "/api/admin/shared-resumes"
    await owner.post(f"{base}/review", json={"ids": ids[:2], "status": "ready"})
    job = (await owner.post(f"{base}/exports", json={"kind": "print_bulk", "filters": {"onlyReady": True}})).json()
    assert sorted(i["membershipId"] for i in job["items"]) == sorted(ids[:2])
    lines = list(csv.reader(io.StringIO((await owner.post(f"{base}/export.csv", json={"onlyReady": True})).text)))
    assert len(lines) == 3
    await owner.post(f"{base}/exports/{job['job']}/done")
    assert (await owner.get(base, params={"readyNotPrinted": "true"})).json()["total"] == 0
    # mark as not printed (reprint): back in the list, the count stays
    assert (await owner.post(f"{base}/unprint", json={"ids": ids[:1]})).json()["updated"] == 1
    rows = (await owner.get(base, params={"readyNotPrinted": "true"})).json()["rows"]
    assert [r["membershipId"] for r in rows] == ids[:1] and rows[0]["printedCount"] == 1


# ---------- reminders ----------


async def test_reminders_throttle_opt_out_cap_and_audit(owner, make_client, outbox, db, monkeypatch):
    org, g = await setup_group(owner)
    thin = {"personal": {"name": "Thin"}}
    ids = await joined(make_client, outbox, g["code"], 4, "rm", data=thin)
    await joined(make_client, outbox, g["code"], 1, "full")  # complete: not "incomplete"
    co, _ = await coordinator(owner, make_client, outbox, org["id"])
    base = f"/api/org/{org['id']}/shared-resumes"

    # one opts out with the link from an email
    from app.orgs.service import opt_out_token

    r = await make_client().post("/api/public/reminders/stop", json={"token": opt_out_token(ids[3])})
    assert r.json()["groupName"] == "B.Tech 2026 placements"
    assert (
        await make_client().post("/api/public/reminders/stop", json={"token": ids[3] + ".forged"})
    ).status_code == 404

    before = len(outbox.sent)
    monkeypatch.setattr(orgs_router, "MAX_EMAILS", 2)
    note = "Bring a printout <script>"
    r = (await co.post(f"{base}/remind", json={"segment": "incomplete", "group": g["id"], "note": note})).json()
    assert r["sent"] == 2 and r["reasons"] == {"optedOut": 1, "recent": 0, "overLimit": 1, "failed": 0}
    sent = outbox.sent[before:]
    assert len(sent) == 2 and all("/builder" in m.text and "/groups/stop?t=" in m.text for m in sent)
    assert all("&lt;script&gt;" in m.html and "<script>" not in m.html for m in sent)
    assert "Still missing" in sent[0].html and "education" in sent[0].text

    monkeypatch.setattr(orgs_router, "MAX_EMAILS", 500)
    r = (await co.post(f"{base}/remind", json={"segment": "selected", "ids": ids})).json()
    assert r["sent"] == 1 and r["reasons"]["recent"] == 2 and r["reasons"]["optedOut"] == 1  # 24 h per member
    r = await co.post(f"{base}/remind", json={"segment": "stale", "group": g["id"]})
    assert r.status_code == 400 and err(r) == "since_required"
    r = (await co.post(f"{base}/remind", json={"segment": "incomplete", "group": g["id"]})).json()
    assert r["sent"] == 0 and r["reasons"]["recent"] == 3  # the 3rd send of the day (the bad request didn't count)
    r = await co.post(f"{base}/remind", json={"segment": "incomplete", "group": g["id"]})
    assert r.status_code == 429  # at most 3 sends per group per day

    entries = await db[AUDIT_LOG].find({"action": "remind"}).to_list(None)
    assert len(entries) == 3 and entries[0]["data"]["sent"] == 2
    assert not any("@" in str(e["data"]) for e in entries)  # no member emails in the log
    # the member can switch reminders back on (or off) from their dashboard
    m = await db[MEMBERSHIPS].find_one({"_id": ids[3]})
    assert m["reminders_opt_out"] is True


# ---------- dashboard ----------


async def test_group_dashboard_counts_from_one_endpoint(owner, make_client, outbox):
    org, g = await setup_group(owner)
    thin = {"personal": {"name": "Thin", "email": "t@example.com"}}
    ids = await joined(make_client, outbox, g["code"], 2, "d") + await joined(
        make_client, outbox, g["code"], 2, "e", thin
    )
    base = "/api/admin/shared-resumes"
    await owner.post(f"{base}/review", json={"ids": ids[:1], "status": "ready"})
    await owner.post(f"{base}/review", json={"ids": ids[2:3], "status": "needs_changes", "note": "Add skills"})
    await owner.post(f"{base}/approval", json={"ids": ids[3:], "action": "reject"})
    d = (await owner.get(f"/api/admin/groups/{g['id']}/dashboard")).json()
    assert d["counts"] == {
        "joined": 4, "pending": 0, "approved": 3, "rejected": 1, "complete": 2, "incomplete": 1,
        "needsChanges": 1, "ready": 1, "printed": 0, "readyNotPrinted": 1,
    }  # fmt: skip
    assert d["buckets"] == {"low": 1, "mid": 0, "high": 2}
    assert len(d["joinsPerDay"]) == 30 and d["joinsPerDay"][-1]["n"] == 4
    assert [x["membershipId"] for x in d["incompleteMembers"]] == [ids[2]]
    assert set(d["incompleteMembers"][0]["missing"]) == {"education", "skills", "experience"}
    co, _ = await coordinator(owner, make_client, outbox, org["id"])
    assert (await co.get(f"/api/org/{org['id']}/groups/{g['id']}/dashboard")).json()["counts"] == d["counts"]


async def test_member_sees_status_and_switches_reminders(owner, make_client, outbox):
    await setup_group(owner, settings={"requireApproval": True, "active": True})
    c, _ = await member(make_client, outbox)
    m = (await join(c)).json()
    assert m["approval"] == "pending" and m["remindersOptOut"] is False
    r = await c.patch(f"/api/me/groups/{m['id']}", json={"remindersOptOut": True})
    assert r.json()["remindersOptOut"] is True and r.json()["resumeId"] == "r1"
    info = (await make_client().get("/api/public/join/JNTUA26")).json()
    assert info["group"]["requireApproval"] is True


# ---------- regression: production after Phase 2 showed 0 members ----------


async def test_phase1_memberships_and_a_fresh_join_show_everywhere(owner, make_client, outbox, db):
    """A membership written by Phase 1 (no approval / review / reminder fields) and a Phase 2 join both appear in the
    member counts, the dashboard, the table and every export — also after the old member becomes a coordinator."""
    org, g = await setup_group(owner)
    old, old_me = await member(make_client, outbox, "angelin@example.com", "Angelin Elizabeth")
    t = now()
    await db[MEMBERSHIPS].insert_one(  # exactly what Phase 1 stored
        {
            "_id": "phase1-membership",
            "user_id": old_me["id"],
            "group_id": g["id"],
            "org_id": org["id"],
            "resume_id": "r1",
            "field_values": {"roll": "123456", "branch": "CSE"},
            "consent": {"given": True, "text": "My resume will be shared with JNTU Anantapur …", "at": t},
            "left_at": None,
            "updated_at": t,
            "joined_at": t,
            "printed_at": None,
            "printed_count": 0,
        }
    )
    new, _ = await member(make_client, outbox, "tamil@example.com", "Tamil Selvan")
    assert (await join(new, roll="654321")).status_code == 201

    # the old member accepts a coordinator invite: their own membership stays
    s = await invite(owner, org["id"], "angelin@example.com")
    assert (await old.post(f"/api/org-invites/{s['inviteUrl'].rsplit('/', 1)[1]}/accept")).status_code == 200
    assert [x["code"] for x in (await old.get("/api/me/groups")).json()] == ["JNTUA26"]

    detail = (await owner.get(f"/api/admin/orgs/{org['id']}")).json()
    assert detail["members"] == 2 and detail["groupList"][0]["members"] == 2
    assert (await owner.get("/api/admin/orgs")).json()[0]["members"] == 2
    for base in ("/api/admin", f"/api/org/{org['id']}"):
        client = owner if base == "/api/admin" else old
        d = (await client.get(f"{base}/groups/{g['id']}/dashboard")).json()
        assert d["counts"]["joined"] == 2 and d["counts"]["approved"] == 2 and d["group"]["members"] == 2, base
        for approval in ("approved", "all"):
            rows = (await client.get(f"{base}/shared-resumes", params={"approval": approval})).json()
            assert sorted(r["fields"]["roll"] for r in rows["rows"]) == ["123456", "654321"], (base, approval)
        lines = list(csv.reader(io.StringIO((await client.post(f"{base}/shared-resumes/export.csv", json={})).text)))
        assert len(lines) == 3, base
        job = (await client.post(f"{base}/shared-resumes/exports", json={"kind": "print_bulk"})).json()
        assert job["total"] == 2, base
        data = (await client.get(f"{base}/shared-resumes/exports/{job['job']}/data")).json()
        assert all(x["data"] for x in data), base

    # joins and leaves are in the audit log now (no emails in it)
    entries = {e["action"] async for e in db[AUDIT_LOG].find({"action": {"$in": ["member_join", "member_leave"]}})}
    assert entries == {"member_join"}
    check = (await owner.get(f"/api/admin/groups/{g['id']}/membership-check")).json()
    assert check["counts"] == {"inGroup": 2, "activeInGroup": 2}
    assert all(m["shown"] for m in check["memberships"]) and {m["initials"] for m in check["memberships"]} == {
        "AE",
        "TS",
    }
    assert "@" not in str(check)


async def test_membership_check_explains_why_someone_is_hidden(owner, make_client, outbox, db):
    org, g = await setup_group(owner)
    c, me = await member(make_client, outbox)
    m = (await join(c)).json()
    assert (await c.post(f"/api/me/groups/{m['id']}/leave")).status_code == 204
    e = await db[AUDIT_LOG].find_one({"action": "member_leave"})
    assert e["actor_id"] == me["id"] and e["data"]["orgs"] == [org["id"]] and "@" not in str(e["data"])
    check = (await owner.get(f"/api/admin/groups/{g['id']}/membership-check")).json()
    assert check["counts"] == {"inGroup": 1, "activeInGroup": 0}
    assert check["memberships"][0]["reasons"] == ["left"] and check["memberships"][0]["leftAt"]
    assert (await c.get(f"/api/admin/groups/{g['id']}/membership-check")).status_code == 403
