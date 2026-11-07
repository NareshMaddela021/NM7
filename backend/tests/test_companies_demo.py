"""Phase 2 demo: "Demo Tech Solutions (demo)" with 2 admins, 5 jobs and applicants from the demo college; 3 sample
sign-ups in Admin → Companies (clean, duplicate GSTIN, same-address burst); never public; "Reset and open as
company" signs the browser in as the demo main admin; Remove takes it all away."""

from app.companies import demo
from app.core.db import APPLICATIONS, COMPANIES, JOBS
from tests.test_companies_signup import H, no_network  # noqa: F401


async def test_demo_company(client, db, admin_client):
    assert (await (await admin_client("support")).post("/api/admin/demo-company/open")).status_code == 403
    owner = await admin_client("owner")
    r = (await owner.post("/api/admin/demo-company/open")).json()
    assert r["jobs"] == 5 and r["live"] == 2 and r["applicants"] > 5 and r["samples"] == 3
    session = r["session"]
    # the dashboard as the demo main admin
    mine = (await client.get("/api/company/mine", headers=H(session))).json()
    cid = demo.COMPANY_ID
    assert any(c["id"] == cid for c in (mine["companies"] if isinstance(mine, dict) else mine))
    ov = (await client.get(f"/api/company/{cid}/overview", headers=H(session))).json()
    # fix round item 11: within the posting limit (3), with room to post one more
    assert ov["liveJobs"] == 2 and ov["trust"] == "verified" and ov["myRole"] == "main"
    assert ov["room"]["allowed"] is True and ov["room"]["used"] == 2 and ov["room"]["limit"] == 3
    c = await db[COMPANIES].find_one({"_id": cid})
    assert [m["role"] for m in c["members"]] == ["main", "full"]
    out = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()
    assert len(out["items"]) == r["applicants"]
    assert any(not x["fit"]["ok"] for x in out["items"])  # "Not a fit" labels show, never hidden
    assert out["items"][-1]["fit"]["ok"] is False or all(x["fit"]["ok"] for x in out["items"])
    # never public
    assert (await client.get("/api/jobs", params={"q": "Demo Tech"})).json()["total"] == 0
    job = await db[JOBS].find_one({"company_id": cid})
    assert (await client.get(f"/api/jobs/{job['slug']}")).status_code == 404
    assert (await client.get(f"/api/companies/{c['slug']}")).status_code == 404
    # the 3 sample sign-ups in the trust queue, with their flags
    q = (await owner.get("/api/admin/companies", params={"state": "pending", "q": "(demo)"})).json()["items"]
    flags = {x["id"]: [f["code"] for f in x["flags"]] for x in q}
    assert flags[demo.SAMPLES[0]] == []
    assert flags[demo.SAMPLES[1]] == ["duplicate_registration"]
    assert "ip_burst" in flags[demo.SAMPLES[2]]
    # reset is repeatable; remove takes it all away
    again = (await owner.post("/api/admin/demo-company/open")).json()
    assert (
        again["jobs"] == 5
        and await db[COMPANIES].count_documents({"demo": True, "_id": {"$in": [cid, *demo.SAMPLES]}}) == 4
    )
    assert (await owner.delete("/api/admin/demo-company")).json() == {"removed": 4}
    assert await db[JOBS].count_documents({"company_id": cid}) == 0
    assert await db[APPLICATIONS].count_documents({"company_id": cid}) == 0


async def test_demo_samples_approve_and_domain_warning(client, db, admin_client):
    """Fix round items 10 and 22: the clean sample has both emails confirmed and can be approved; the panel shows each
    email's real state; a sample whose emails aren't on its website's domain shows the warning."""
    owner = await admin_client("owner")
    await owner.post("/api/admin/demo-company/open")
    got = await owner.get("/api/admin/companies", params={"state": "pending", "q": "(demo)"})
    q = {x["id"]: x for x in got.json()["items"]}
    clean, dupe, burst = (q[s] for s in demo.SAMPLES)
    assert clean["emailsConfirmed"] == {"admin": True, "company": True} and clean["trust"] == "basic"
    assert dupe["emailsConfirmed"] == {"admin": True, "company": False} and dupe["trust"] == "unverified"
    assert "email_domain" not in [f["code"] for f in clean["flags"]]
    gap = next(f for f in burst["flags"] if f["code"] == "email_domain")
    assert "burst.demo.nm7.invalid" in gap["text"] and "burst-careers.invalid" in gap["text"]
    r = await owner.post(f"/api/admin/companies/{clean['id']}/approve")
    assert r.status_code == 200 and r.json()["trust"] == "verified"
    r = await owner.post(f"/api/admin/companies/{dupe['id']}/approve")
    assert r.status_code == 400 and r.json()["error"]["code"] == "emails"
