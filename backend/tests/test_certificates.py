"""Certificate wallet: upload limits, real file types only, no ID documents, owner-only files, sharing with the
college / invited recruiters only when "Share certificates" is on and the certificate is ticked, erased with the
account."""

import base64

from app.core.db import CERTIFICATES
from app.me.erase import erase_user_data
from tests.conftest import signup
from tests.test_org_recruiter_portal import campus, invite, owner, resume, sign_in  # noqa: F401 — fixtures
from tests.test_orgs_recruiter import opted_in

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
PDF = b"%PDF-1.4\n" + b"0" * 300


def cert(title="Python for Data Science", raw=PNG, mime="image/png", **extra):
    return {"title": title, "issuer": "NPTEL", "date": "2024-05", "mime": mime, "name": "cert.png",
            "data": base64.b64encode(raw).decode(), **extra}  # fmt: skip


async def test_upload_list_edit_delete_and_the_limits(client, outbox, db):
    await signup(client, outbox)
    r = await client.post("/api/me/certificates", json=cert(link="coursera.org/verify/ABC"))
    assert r.status_code == 201, r.text
    one = r.json()
    assert one["share"] is False and one["size"] == len(PNG) and "data" not in one and "file" not in one
    r = await client.get("/api/me/certificates")
    j = r.json()
    assert j["share"] is False and j["limits"] == {"files": 10, "bytes": 2 * 1024 * 1024} and j["used"] == len(PNG)
    assert j["items"][0]["link"] == "https://coursera.org/verify/ABC"
    # the file, to its owner: shown, never run
    f = await client.get(f"/api/me/certificates/{one['id']}/file")
    assert f.status_code == 200 and f.content == PNG and f.headers["content-type"] == "image/png"
    assert f.headers["x-content-type-options"] == "nosniff" and "sandbox" in f.headers["content-security-policy"]
    # edit, tick
    r = await client.patch(f"/api/me/certificates/{one['id']}", json={"title": "Python (NPTEL)", "share": True})
    assert r.json()["title"] == "Python (NPTEL)" and r.json()["share"] is True
    # not a real PNG / an unknown type / over 2 MB
    assert (await client.post("/api/me/certificates", json=cert(raw=b"GIF89a" + b"0" * 50))).status_code == 400
    bad = await client.post("/api/me/certificates", json=cert(mime="image/gif"))
    assert bad.status_code in (400, 422)
    big = await client.post(
        "/api/me/certificates", json=cert(raw=PDF + b"0" * (2 * 1024 * 1024), mime="application/pdf")
    )
    assert big.status_code == 413
    # at most 10
    for n in range(9):
        assert (
            await client.post("/api/me/certificates", json=cert(f"Course {n}", PDF, "application/pdf"))
        ).status_code == 201
    r = await client.post("/api/me/certificates", json=cert("One more"))
    assert r.status_code == 409 and "up to 10" in r.json()["error"]["message"]
    # delete
    assert (await client.delete(f"/api/me/certificates/{one['id']}")).status_code == 204
    assert len((await client.get("/api/me/certificates")).json()["items"]) == 9


async def test_no_id_documents(client, outbox, db):
    await signup(client, outbox)
    for title in ("Aadhaar card", "My PAN card", "Passport front page", "Voter ID"):
        r = await client.post("/api/me/certificates", json=cert(title))
        assert r.status_code == 400 and "Aadhaar, PAN" in r.json()["error"]["message"], title
    r = await client.post("/api/me/certificates", json=cert(name="aadhar.png"))
    assert r.status_code == 400
    # an ID number typed into a field is removed, not stored
    r = await client.post("/api/me/certificates", json=cert("AWS Cloud Practitioner ABCDE1234F"))
    assert r.status_code == 201 and "ABCDE1234F" not in r.json()["title"]
    assert await db[CERTIFICATES].count_documents({"title": {"$regex": "ABCDE1234F"}}) == 0


async def test_files_are_private_to_the_owner(make_client, outbox):
    a, b = make_client(), make_client()
    await signup(a, outbox, "asha@example.com")
    await signup(b, outbox, "ravi@example.com")
    c = (await a.post("/api/me/certificates", json=cert())).json()
    assert (await b.get(f"/api/me/certificates/{c['id']}/file")).status_code == 404
    assert (await b.patch(f"/api/me/certificates/{c['id']}", json={"share": True})).status_code == 404
    assert (await b.delete(f"/api/me/certificates/{c['id']}")).status_code == 404
    assert (await b.get("/api/me/certificates")).json()["items"] == []
    assert (await make_client().get(f"/api/me/certificates/{c['id']}/file")).status_code == 401


async def test_college_and_recruiters_see_only_ticked_certificates_with_sharing_on(campus, owner, make_client, outbox):  # noqa: F811
    org, g = campus
    student, joined = await opted_in(
        make_client, outbox, "asha@example.com", "Asha Rao", data=resume("Asha Rao", "asha@example.com")
    )
    mid = joined["id"]
    ticked = (await student.post("/api/me/certificates", json=cert("Python for Data Science"))).json()
    private = (await student.post("/api/me/certificates", json=cert("Personal one", PDF, "application/pdf"))).json()
    await student.patch(f"/api/me/certificates/{ticked['id']}", json={"share": True})
    rec = make_client()
    _, tok = await invite(owner, org["id"], [g["id"]])
    h = await sign_in(rec, outbox, tok)
    cid = (await rec.get(f"/api/recruiter/{tok}/candidates", headers=h)).json()["candidates"][0]["id"]

    async def seen():
        staff = (await owner.get(f"/api/admin/shared-resumes/{mid}")).json()["certificates"]
        recr = (await rec.get(f"/api/recruiter/{tok}/candidates/{cid}", headers=h)).json()["certificates"]
        return [x["title"] for x in staff], [x["title"] for x in recr]

    async def files(cert_id):
        s = await owner.get(f"/api/admin/shared-resumes/{mid}/certificates/{cert_id}")
        r = await rec.get(f"/api/recruiter/{tok}/candidates/{cid}/certificates/{cert_id}", headers=h)
        return s.status_code, r.status_code

    # "Share certificates" is off by default: nothing, even the ticked one
    assert await seen() == ([], [])
    assert await files(ticked["id"]) == (404, 404)
    # on: only the ticked one
    assert (await student.put("/api/me/certificates/sharing", json={"on": True})).json() == {"share": True}
    assert await seen() == (["Python for Data Science"], ["Python for Data Science"])
    assert await files(ticked["id"]) == (200, 200)
    assert await files(private["id"]) == (404, 404)
    r = await rec.get(f"/api/recruiter/{tok}/candidates/{cid}/certificates/{ticked['id']}", headers=h)
    assert r.content == PNG and r.headers["cache-control"] == "no-store"
    # no session: nothing
    assert (
        await make_client().get(f"/api/recruiter/{tok}/candidates/{cid}/certificates/{ticked['id']}")
    ).status_code == 401
    # off again: gone
    await student.put("/api/me/certificates/sharing", json={"on": False})
    assert await seen() == ([], [])
    assert await files(ticked["id"]) == (404, 404)


async def test_erased_with_the_account(client, outbox, db):
    me = await signup(client, outbox)
    await client.post("/api/me/certificates", json=cert())
    await client.post("/api/me/certificates", json=cert("Another", PDF, "application/pdf"))
    out = await erase_user_data(db, me["id"])
    assert out["certificates"] == 2
    assert await db[CERTIFICATES].count_documents({"user_id": me["id"]}) == 0
