# ruff: noqa: E501
"""Phase 6 S8: internships and live projects. Verified companies only; free-labour rules hold a program for Admin;
students apply (consent), the company accepts up to N, the student sends work, the company reviews; a completed one
gets a server-made certificate PDF with a verification link; the resume entry is suggested and added only when the
student confirms; erased with the account."""

import io

from pypdf import PdfReader

from app.core.db import COMPANIES, PROGRAM_APPS, RESUMES, USERS
from app.seek.programs import free_labour
from tests.conftest import signup
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401

PROJECT = {
    "kind": "project",
    "title": "Sales dashboard for a demo shop",
    "brief": "Build a one-page dashboard from the sample sales data we share, with three charts and short notes.",
    "deliverable": "A link to your dashboard and a short note",
    "deadline": "2026-12-20",
    "weeks": 2,
    "stipend": 0,
    "remote": True,
    "seats": 2,
}


async def test_rules_and_free_labour():
    base = {**PROJECT}
    assert free_labour(base) == []
    assert free_labour({**base, "seats": 30}) == ["Unpaid, for more than 20 students"]
    assert free_labour({**base, "seats": 30, "stipend": 5000}) == []
    assert free_labour({**base, "kind": "internship", "weeks": 20}) == ["Unpaid internship longer than 3 months"]
    assert (
        "paid work"
        in free_labour({**base, "brief": "Handle calls from our clients and meet sales targets every week for us."})[0]
    )


async def test_full_flow_certificate_and_resume(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    url = f"/api/company/{cid}/programs"
    assert (
        await client.post(url, json={**PROJECT, "weeks": 6}, headers=H(session))
    ).status_code == 422  # projects: 1–4 weeks
    assert (
        await client.post(
            url, json={**PROJECT, "brief": PROJECT["brief"] + " Pay a registration fee first."}, headers=H(session)
        )
    ).status_code == 422
    p = (await client.post(url, json=PROJECT, headers=H(session))).json()
    assert p["status"] == "open" and p["flags"] == []
    stu = make_client()
    await signup(stu, outbox, email="asha@example.com", name="Asha Rao")
    await stu.post(
        "/api/me/resumes",
        json={"id": "r1", "name": "Main", "active": True, "data": {"personal": {"name": "Asha Rao"}, "intern": []}},
    )
    assert [x["id"] for x in (await stu.get("/api/programs")).json()] == [p["id"]]
    assert (await stu.post(f"/api/programs/{p['id']}/apply", json={"consent": False})).status_code == 422
    assert (await stu.post(f"/api/programs/{p['id']}/apply", json={"consent": True, "note": "Keen"})).status_code == 201
    assert (await stu.post(f"/api/programs/{p['id']}/apply", json={"consent": True})).status_code == 409
    mine = (await stu.get("/api/me/programs")).json()
    aid = mine[0]["id"]
    assert (
        await stu.post(f"/api/me/programs/{aid}/submit", json={"link": "https://x.example/d"})
    ).status_code == 409  # not accepted yet
    rows = (await client.get(url, headers=H(session))).json()
    assert rows[0]["applicants"][0]["name"] == "Asha Rao"
    base = f"{url}/{p['id']}/applicants/{aid}"
    assert (await client.post(f"{base}/accept", headers=H(session))).status_code == 200
    assert (
        await client.post(f"{base}/review", json={"ok": True}, headers=H(session))
    ).status_code == 409  # nothing sent yet
    assert (await stu.post(f"/api/me/programs/{aid}/submit", json={"link": "dashboard"})).status_code == 422
    assert (
        await stu.post(f"/api/me/programs/{aid}/submit", json={"link": "https://x.example/dash"})
    ).status_code == 200
    r = (await client.post(f"{base}/review", json={"ok": True, "note": "Clear charts"}, headers=H(session))).json()
    assert r["status"] == "completed" and r["certificate"]
    token = r["certificate"]
    me = (await stu.get("/api/me/programs")).json()[0]
    assert me["status"] == "completed" and me["verifyUrl"].endswith(f"/verify/{token}") and not me["resumeAdded"]
    assert me["resumeEntry"]["role"] == "Sales dashboard for a demo shop (Live project)" and me["resumeEntry"]["from"]
    # nothing goes on the resume until the student confirms
    assert (
        await db[RESUMES].find_one({"user_id": me and (await db[USERS].find_one({"email": "asha@example.com"}))["_id"]})
    )["data"]["intern"] == []
    assert (await stu.post(f"/api/me/programs/{aid}/resume")).json()["added"] is True
    assert (await stu.post(f"/api/me/programs/{aid}/resume")).json()["already"] is True
    res = await db[RESUMES].find_one({"key": "r1"}) or await db[RESUMES].find_one({})
    assert len(res["data"]["intern"]) == 1 and res["data"]["intern"][0]["company"]
    # the certificate: anyone can check it; the PDF is made on the server
    anon = make_client()
    v = (await anon.get(f"/api/public/certificates/{token}")).json()
    assert v["valid"] and v["name"] == "Asha Rao" and v["title"] == PROJECT["title"] and v["verifyUrl"].endswith(token)
    pdf = await anon.get(f"/api/public/certificates/{token}.pdf")
    text = PdfReader(io.BytesIO(pdf.content)).pages[0].extract_text()
    assert pdf.headers["content-type"] == "application/pdf" and "Asha Rao" in text and token in text
    assert (await anon.get("/api/public/certificates/nope-not-real")).status_code == 404


async def test_seats_and_verified_only(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    p = (await client.post(f"/api/company/{cid}/programs", json={**PROJECT, "seats": 1}, headers=H(session))).json()
    ids = []
    for e in ("a@example.com", "b@example.com"):
        s = make_client()
        await signup(s, outbox, email=e, name=e[0].upper())
        await s.post(f"/api/programs/{p['id']}/apply", json={"consent": True})
        ids.append((await s.get("/api/me/programs")).json()[0]["id"])
    base = f"/api/company/{cid}/programs/{p['id']}/applicants"
    assert (await client.post(f"{base}/{ids[0]}/accept", headers=H(session))).status_code == 200
    r = await client.post(f"{base}/{ids[1]}/accept", headers=H(session))
    assert r.status_code == 409 and "1 places" in r.json()["error"]["message"]
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"review.state": "pending"}})
    assert (await client.post(f"/api/company/{cid}/programs", json=PROJECT, headers=H(session))).status_code == 403


async def test_free_labour_held_for_admin(client, outbox, db, admin_client):
    session, cid = await verified(client, outbox, db)
    p = (await client.post(f"/api/company/{cid}/programs", json={**PROJECT, "seats": 40}, headers=H(session))).json()
    assert p["status"] == "review" and p["flags"]
    assert (await client.get("/api/programs")).json() == []  # not shown while held
    owner = await admin_client("owner")
    q = (await owner.get("/api/admin/programs", params={"flagged": True})).json()
    assert [x["id"] for x in q] == [p["id"]]
    assert (await owner.post(f"/api/admin/programs/{p['id']}/review", json={"approve": False})).json()[
        "status"
    ] == "removed"
    assert (await client.get("/api/programs")).json() == []


async def test_erased_with_the_account(client, outbox, db, make_client):
    from app.me.erase import erase_account

    session, cid = await verified(client, outbox, db)
    p = (await client.post(f"/api/company/{cid}/programs", json=PROJECT, headers=H(session))).json()
    s = make_client()
    await signup(s, outbox, email="z@example.com", name="Zed")
    await s.post(f"/api/programs/{p['id']}/apply", json={"consent": True})
    uid = (await db[USERS].find_one({"email": "z@example.com"}))["_id"]
    await erase_account(db, uid)
    assert await db[PROGRAM_APPS].count_documents({"user_id": uid}) == 0
