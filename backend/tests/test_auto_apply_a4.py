"""Auto Apply 2.0, phase A4 (partner integrations): a company connects its own hiring system (Zoho Recruit, Greenhouse,
Lever, Darwinbox) with its own key; the key is encrypted at rest and never comes back in a response, a log line, an
error or the activity log; only main / full admins connect, test and disconnect; an approved / full-auto 2.0
application to a linked job is delivered through the partner's official API (each adapter's request shape), retried
with a bound and never lost; 429s and 5xx back off politely; statuses read back move the tracker through the A2 status
sync (notice, email via may_mail) and rejections count in learning; the switch OFF keeps real candidates out of real
companies' systems; Admin's health panel shows no secrets; the demo never touches the network. Every HTTP call goes
to an httpx MockTransport."""

import base64
import json
import logging

import httpx
import pytest

from app.autoapply import learning
from app.autoapply.ats import base, service
from app.autoapply.ats.adapters import Greenhouse, Lever, Zoho
from app.autoapply.ats.base import PartnerError, Submission, map_status
from app.autoapply.ats.darwinbox import Darwinbox
from app.core.db import APPLICATIONS, ATS_CONNECTIONS, ATS_DELIVERIES, AUDIT_LOG, AUTO_ITEMS, COMPANIES, JOBS, USERS
from app.core.security import decrypt
from app.core.time import now
from app.site import save_site
from tests.test_auto_apply_a2 import FOUNDER, TEST_CO, setup
from tests.test_auto_apply_engine import company_job, no_ai, roomy  # noqa: F401
from tests.test_auto_apply_v2 import EMAIL, V2
from tests.test_companies_signup import H, no_network  # noqa: F401

GH_KEY = "ghJB-SECRET-9f8e7d6c5b4a"
GH_HARVEST = "ghHV-SECRET-1a2b3c4d77"
LEVER_KEY = "lvPOST-SECRET-abcdef123456"
SECRETS = (GH_KEY, GH_HARVEST, LEVER_KEY, "zoho-client-secret-XYZ", "1000.zoho-refresh-SECRET", "dbx-SECRET-key")


class Partner:
    """A fake partner: answers by (method, host + path) and remembers every request."""

    def __init__(self):
        self.calls: list[httpx.Request] = []
        self.routes: dict[tuple[str, str], list] = {}

    def on(self, method: str, url: str, *answers):
        self.routes[(method, url)] = list(answers)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        key = (request.method, f"{request.url.scheme}://{request.url.host}{request.url.path}")
        answers = self.routes.get(key)
        if not answers:
            return httpx.Response(404, json={"error": "no route"})
        a = answers.pop(0) if len(answers) > 1 else answers[0]
        if isinstance(a, int):
            return httpx.Response(a, json={"echo": request.url.query.decode()})  # a partner echoing the request
        if isinstance(a, tuple):
            return httpx.Response(a[0], headers=a[1], json={})
        return httpx.Response(200, json=a)


@pytest.fixture
def partner(monkeypatch):
    p = Partner()
    waits: list[float] = []

    async def sleep(s):
        waits.append(s)

    monkeypatch.setattr(base, "TRANSPORT", httpx.MockTransport(p))
    monkeypatch.setattr(base, "SLEEP", sleep)
    p.waits = waits
    return p


def no_secret(*texts):
    for t in texts:
        for s in SECRETS:
            assert s not in str(t), "a secret leaked"


GH = "https://boards-api.greenhouse.io/v1/boards/acme"
HV = "https://harvest.greenhouse.io/v1"


def greenhouse_ok(p: Partner):
    p.on("GET", GH, {"name": "Acme"})
    p.on("GET", f"{HV}/users", [{"id": 1}])
    p.on("GET", f"{GH}/jobs", {"jobs": [{"id": 4001, "title": "Data Analyst", "location": {"name": "Hyderabad"}}]})
    p.on("POST", f"{GH}/jobs/4001", {"success": "Candidate saved successfully"})


async def connect_gh(client, session, cid, **over):
    fields = {"board_token": "acme", "api_key": GH_KEY, "harvest_key": GH_HARVEST, **over}
    return await client.post(f"/api/company/{cid}/ats/connect", json={"partner": "greenhouse", "fields": fields},
                             headers=H(session))  # fmt: skip


async def linked_job(client, session, cid, db, title="Junior Data Analyst"):
    """A job posted with auto applications off, linked to the partner's job, then turned on (the scan runs again)."""
    j = await company_job(client, session, cid, title, autoApply={"accept": False})
    r = await client.put(f"/api/company/{cid}/jobs/{j['id']}/ats", json={"partnerJob": {"id": "4001", "title": "DA"}},
                         headers=H(session))  # fmt: skip
    assert r.status_code == 200, r.text
    r = await client.put(f"/api/company/{cid}/jobs/{j['id']}/auto-apply", json={"accept": True, "max": 50},
                         headers=H(session))  # fmt: skip
    assert r.status_code == 200, r.text
    return j


# ---------- connect, the key at rest, delivery, status read-back ----------


async def test_greenhouse_end_to_end_key_never_leaves(client, outbox, db, partner, caplog, admin_client):
    caplog.set_level(logging.INFO)
    caplog.set_level(logging.DEBUG, logger="httpx")
    caplog.set_level(logging.DEBUG, logger="nm7.autoapply.ats")
    uid, session, cid = await setup(client, outbox, db, mode="full_auto")
    greenhouse_ok(partner)
    seen = []
    r = await connect_gh(client, session, cid)
    assert r.status_code == 200, r.text
    seen.append(r.text)
    conn = r.json()["connection"]
    assert conn["partner"] == "greenhouse" and conn["last4"] == "5b4a" and conn["connectedAt"] and conn["testOk"]
    assert conn["settings"] == {"board_token": "acme"} and conn["statusReadable"] is True
    # encrypted at rest: nothing readable in the document
    doc = await db[ATS_CONNECTIONS].find_one({"_id": cid})
    no_secret(json.dumps(doc, default=str))
    assert json.loads(decrypt(doc["secret_enc"])) == {"api_key": GH_KEY, "harvest_key": GH_HARVEST}
    # the test call: the board, and Harvest with Basic auth
    hv = next(c for c in partner.calls if c.url.host == "harvest.greenhouse.io")
    assert hv.headers["authorization"] == "Basic " + base64.b64encode(f"{GH_HARVEST}:".encode()).decode()
    # the partner's jobs, to link
    r = await client.get(f"/api/company/{cid}/ats/jobs", headers=H(session))
    seen.append(r.text)
    assert r.json()["jobs"] == [{"id": "4001", "title": "Data Analyst", "location": "Hyderabad"}]
    j = await linked_job(client, session, cid, db)
    page = (await client.get(f"/api/company/{cid}/ats", headers=H(session))).json()
    seen.append(json.dumps(page))
    assert next(x for x in page["jobs"] if x["id"] == j["id"])["link"] == {"id": "4001", "title": "DA"}
    # full auto: made on Nm7 at once, queued for Greenhouse, delivered by the pass
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["id"]})
    assert app and app["channel_v2"] == "partner" and app["partner"]["name"] == "Greenhouse"
    d = await db[ATS_DELIVERIES].find_one({"app_id": app["_id"]})
    assert d["state"] in ("pending", "delivered")
    await service.deliver_due(db)
    d = await db[ATS_DELIVERIES].find_one({"app_id": app["_id"]})
    assert d["state"] == "delivered" and d["tries"] == 1
    post = next(c for c in partner.calls if c.method == "POST")
    assert str(post.url) == f"{GH}/jobs/4001"
    assert post.headers["authorization"] == "Basic " + base64.b64encode(f"{GH_KEY}:".encode()).decode()
    body = json.loads(post.content)
    assert body["first_name"] == "Sai" and body["last_name"] == "Varsha" and body["email"] == EMAIL
    assert base64.b64decode(body["resume_content"]).startswith(b"%PDF")
    assert body["resume_content_filename"].endswith(".pdf")
    assert "Sent by Nm7 Auto Apply" in body["cover_letter_text"]
    assert app["cover_note"][0] in body["cover_letter_text"]
    # the candidate's tracker: channel Partner, Greenhouse, delivered
    tr = (await client.get(f"{V2}/tracker")).json()
    row = next(i for i in tr["items"] if i["job"]["id"] == j["id"])
    assert row["channel"] == "partner" and row["partner"] == {"name": "Greenhouse", "state": "delivered",
                                                               "stateText": "Delivered"}  # fmt: skip
    # status read-back: Harvest says rejected → tracker, notice, email (tester), learning
    partner.on("GET", f"{HV}/candidates", [{"applications": [{"jobs": [{"id": 4001}], "status": "rejected"}]}])
    await db[ATS_DELIVERIES].update_one({"_id": d["_id"]}, {"$set": {"checked_at": None}})
    outbox.sent.clear()
    out = await service.sync_pass(db, outbox)
    assert out == {"checked": 1, "moved": 1}
    lookup = next(c for c in partner.calls if c.url.path == "/v1/candidates")
    assert lookup.url.params["email"] == EMAIL
    app = await db[APPLICATIONS].find_one({"_id": app["_id"]})
    assert app["status"] == "rejected"
    it = await db[AUTO_ITEMS].find_one({"_id": app["auto_item_id"]})
    assert it["notice"]["status"] == "rejected"
    assert len(outbox.sent) == 1 and outbox.sent[0].to == EMAIL
    assert (await db[ATS_DELIVERIES].find_one({"_id": d["_id"]}))["final"] is True
    assert (await db[ATS_CONNECTIONS].find_one({"_id": cid}))["last_ok_sync_at"]
    await db[APPLICATIONS].insert_one({"user_id": uid, "role": "Data Analyst Trainee", "status": "rejected",
                                       "updated_at": now(), "key": "k-a4-2"})  # fmt: skip
    assert "data analyst" in await learning.penalties(db, uid)  # rejections from the partner count
    # never twice, never backwards
    await db[ATS_DELIVERIES].update_one({"_id": d["_id"]}, {"$set": {"checked_at": None}})
    assert (await service.sync_pass(db))["checked"] == 0  # final
    # what was sent, Admin health: no secrets anywhere
    seen.append((await client.get(f"{V2}/sent/{it['_id']}")).text)
    owner = await admin_client("owner")
    h = (await owner.get("/api/admin/auto-apply/v2/partners")).json()
    seen.append(json.dumps(h))
    gh = next(p for p in h["partners"] if p["key"] == "greenhouse")
    assert gh["connected"] == 1 and gh["deliveredToday"] == 1 and gh["lastSyncAt"] and gh["failures"] == 0
    audits = await db[AUDIT_LOG].find({"action": {"$regex": "^company.ats_"}}).to_list(50)
    assert {a["action"] for a in audits} >= {"company.ats_connect", "company.ats_link_job"}
    seen.append(json.dumps(audits, default=str))
    no_secret(*seen, caplog.text)


async def test_wrong_key_and_errors_never_echo_the_key(client, outbox, db, partner, caplog):
    caplog.set_level(logging.INFO)
    caplog.set_level(logging.DEBUG, logger="httpx")
    caplog.set_level(logging.DEBUG, logger="nm7.autoapply.ats")
    _, session, cid = await setup(client, outbox, db)
    partner.on("GET", GH, {"name": "Acme"})
    partner.on("GET", f"{HV}/users", 401)  # the partner's body echoes what it got
    r = await connect_gh(client, session, cid)
    assert r.status_code == 400 and r.json()["error"]["code"] == "partner_auth"
    assert "key isn’t valid" in r.json()["error"]["message"]
    assert await db[ATS_CONNECTIONS].count_documents({}) == 0  # nothing saved
    partner.on("GET", f"{HV}/users", 500)
    r2 = await connect_gh(client, session, cid)
    assert r2.json()["error"]["code"] == "partner_server" and partner.waits == [1.0, 2.0]
    a = await db[AUDIT_LOG].find_one({"action": "company.ats_connect_failed"})
    assert a["data"]["error"] == "auth"
    r3 = await connect_gh(client, session, cid, board_token="bad token!")
    assert r3.status_code == 400 and r3.json()["error"]["code"] == "bad_field"
    no_secret(r.text, r2.text, r3.text, caplog.text, json.dumps(a, default=str))


async def test_permissions_switch_and_disconnect(client, outbox, db, partner, make_client):
    _, session, cid = await setup(client, outbox, db)
    greenhouse_ok(partner)
    # a posting admin may look and link, never connect / test / disconnect
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"members.$[m].role": "posting"}},
                                   array_filters=[{"m.email_lc": FOUNDER}])  # fmt: skip
    assert (await connect_gh(client, session, cid)).status_code == 403
    assert (await client.get(f"/api/company/{cid}/ats", headers=H(session))).json()["canManage"] is False
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"members.$[m].role": "full"}},
                                   array_filters=[{"m.email_lc": FOUNDER}])  # fmt: skip
    assert (await connect_gh(client, session, cid)).status_code == 200
    r = await client.post(f"/api/company/{cid}/ats/test", headers=H(session))
    assert r.status_code == 200 and r.json()["connection"]["testOk"] is True
    # someone not on the team: nothing
    other = make_client()
    assert (await other.get(f"/api/company/{cid}/ats")).status_code in (401, 404)
    # disconnect: keys gone at once, links removed, waiting ones kept on Nm7
    j = await company_job(client, session, cid, "Data Analyst Intern", autoApply={"accept": False})
    await client.put(f"/api/company/{cid}/jobs/{j['id']}/ats", json={"partnerJob": {"id": "4001"}}, headers=H(session))
    await db[ATS_DELIVERIES].insert_one({"_id": "d1", "app_id": "a1", "item_id": "i1", "user_id": "u",
                                         "job_id": j["id"], "company_id": cid, "partner": "greenhouse",
                                         "partner_name": "Greenhouse",
                                         "partner_job_id": "4001", "state": "pending", "tries": 0,
                                         "next_at": now()})  # fmt: skip
    r = await client.delete(f"/api/company/{cid}/ats", headers=H(session))
    assert r.status_code == 200 and r.json()["connection"] is None and r.json()["keptOnNm7"] == 1
    assert await db[ATS_CONNECTIONS].count_documents({"_id": cid}) == 0
    assert "partner_job" not in await db[JOBS].find_one({"_id": j["id"]})
    assert (await db[ATS_DELIVERIES].find_one({"_id": "d1"}))["state"] == "failed"
    a = await db[AUDIT_LOG].find_one({"action": "company.ats_disconnect"})
    assert a["data"] == {"by": FOUNDER, "partner": "greenhouse", "waiting_kept_on_nm7": 1}
    # behind the switch: a company with no tester on its team (switch OFF) doesn't see the page
    await save_site(db, {"auto_apply_v2": {"testers": [EMAIL]}})
    assert (await client.get(f"/api/company/{cid}/ats", headers=H(session))).status_code == 404


# ---------- delivery failures: bounded retries, never lost; 429 backoff ----------


async def test_failures_retry_with_a_bound_and_stay_on_nm7(client, outbox, db, partner):
    uid, session, cid = await setup(client, outbox, db, mode="full_auto")
    greenhouse_ok(partner)
    await connect_gh(client, session, cid)
    partner.on("POST", f"{GH}/jobs/4001", 503)
    j = await linked_job(client, session, cid, db)
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["id"]})
    assert app and app["status"] == "applied"  # on Nm7 whatever the partner does
    d = await db[ATS_DELIVERIES].find_one({"app_id": app["_id"]})
    assert d["tries"] == 1 and d["state"] == "pending"  # tried once right after the scan (the kick), 3 polite tries
    assert d["next_at"] > now()  # waits BACKOFF[0] before the next pass tries again
    for n in range(2, service.MAX_TRIES + 1):
        await db[ATS_DELIVERIES].update_many({"app_id": app["_id"], "state": "pending"}, {"$set": {"next_at": now()}})
        await service.deliver_due(db)
        d = await db[ATS_DELIVERIES].find_one({"app_id": app["_id"]})
        assert d["tries"] == n and d["error"]["type"] == "server"
        assert d["state"] == ("failed" if n == service.MAX_TRIES else "pending")
    it = await db[AUTO_ITEMS].find_one({"_id": app["auto_item_id"]})
    assert it["partner"]["state"] == "kept"
    row = next(i for i in (await client.get(f"{V2}/tracker")).json()["items"] if i["job"]["id"] == j["id"])
    assert row["partner"]["stateText"] == "Kept on Nm7" and row["stage"] in ("applied", "viewed")
    posts = [c for c in partner.calls if c.method == "POST"]
    assert len(posts) == service.MAX_TRIES * base.TRIES  # each pass: 3 polite tries, then wait for the next
    await db[ATS_DELIVERIES].update_many({}, {"$set": {"next_at": now()}})
    await service.deliver_due(db)
    assert len([c for c in partner.calls if c.method == "POST"]) == len(posts)  # given up: no more
    assert (await db[ATS_CONNECTIONS].find_one({"_id": cid}))["last_error"]["type"] == "server"


async def test_429_waits_for_retry_after_then_backs_off(partner):
    partner.on("GET", "https://x.test/a", (429, {"Retry-After": "3"}), {"ok": 1})
    async with base.client() as http:
        r = await base.request(http, "GET", "https://x.test/a")
    assert r.status_code == 200 and partner.waits == [3.0]
    partner.waits.clear()
    partner.on("GET", "https://x.test/b", (429, {"Retry-After": "120"}), 503, 503)
    async with base.client() as http:
        with pytest.raises(PartnerError) as e:
            await base.request(http, "GET", "https://x.test/b")
    assert e.value.kind == "server" and partner.waits == [base.MAX_WAIT, 2.0] and str(e.value) == "server"
    partner.on("GET", "https://x.test/c", 403)
    async with base.client() as http:
        with pytest.raises(PartnerError) as e:
            await base.request(http, "GET", "https://x.test/c")
    assert e.value.kind == "auth" and len([c for c in partner.calls if c.url.path == "/c"]) == 1  # never retried


# ---------- each adapter's request shape ----------

SUB = Submission(job_id="P-1", first_name="Sai", last_name="Varsha", email=EMAIL, phone="+91 90000 00000",
                 resume_pdf=b"%PDF-1.4 x", resume_name="Sai_Varsha_Resume.pdf", cover_note=["Line one.", "Line two."],
                 answers=[("Can you work from Hyderabad?", "yes")])  # fmt: skip


async def test_lever_shape_key_masked_in_logs(partner, caplog):
    caplog.set_level(logging.INFO)
    caplog.set_level(logging.DEBUG, logger="httpx")
    caplog.set_level(logging.DEBUG, logger="nm7.autoapply.ats")
    h = "https://api.eu.lever.co"
    partner.on("POST", f"{h}/v0/postings/acme/P-1", {"ok": True, "applicationId": "app-9"})
    partner.on("GET", f"{h}/v1/opportunities", {"data": [{"applications": ["app-9"], "archived": {"reason": "r1"}}]})
    partner.on("GET", f"{h}/v1/archive_reasons", {"data": [{"id": "r1", "type": "hired"}]})
    async with base.client() as http:
        ad = Lever({"site": "acme", "region": "eu"}, {"api_key": LEVER_KEY, "lever_key": "lvAPI-x"}, http)
        got = await ad.submit(SUB)
        assert got["remote_id"] == "app-9"
        raw = await ad.status({"email": EMAIL, "remote_id": "app-9"})
    post = partner.calls[0]
    assert post.url.params["key"] == LEVER_KEY and post.headers["content-type"].startswith("multipart/form-data")
    content = post.content.decode(errors="replace")
    for part in ('name="name"', "Sai Varsha", 'name="email"', 'name="resume"; filename="Sai_Varsha_Resume.pdf"',
                 "Q: Can you work from Hyderabad?", 'name="source"'):  # fmt: skip
        assert part in content
    assert raw == "hired" and map_status(raw) == "offer"
    assert "HTTP Request" in caplog.text and "key=•••" in caplog.text
    no_secret(caplog.text)


async def test_zoho_code_swap_submit_and_status(partner):
    acc, api = "https://accounts.zoho.in", "https://recruit.zoho.in/recruit/v2"
    partner.on("POST", f"{acc}/oauth/v2/token", {"refresh_token": "1000.zoho-refresh-SECRET", "access_token": "AT1",
                                                 "expires_in": 3600})  # fmt: skip
    partner.on("POST", f"{api}/Candidates", {"data": [{"code": "SUCCESS", "details": {"id": "Z55"}}]})
    partner.on("POST", f"{api}/Candidates/Z55/Attachments", {"data": [{"code": "SUCCESS"}]})
    partner.on("PUT", f"{api}/Candidates/actions/associate", {"data": [{"code": "SUCCESS"}]})
    partner.on("GET", f"{api}/Candidates/Z55", {"data": [{"Candidate_Status": "Interview-Scheduled"}]})
    async with base.client() as http:
        ad = Zoho({"region": "in"}, {"client_id": "cid", "client_secret": "zoho-client-secret-XYZ", "code": "1000.c"},
                  http)  # fmt: skip
        secret = await ad.prepare()
        assert secret == {"client_id": "cid", "client_secret": "zoho-client-secret-XYZ",
                          "refresh_token": "1000.zoho-refresh-SECRET"}  # fmt: skip
        assert ad.main_secret.endswith("CRET")
        got = await ad.submit(SUB)
        raw = await ad.status({"remote_id": got["remote_id"]})
    swap = partner.calls[0]
    assert b"grant_type=authorization_code" in swap.content and b"code=1000.c" in swap.content
    cand = partner.calls[1]
    assert cand.headers["authorization"] == "Zoho-oauthtoken AT1"
    row = json.loads(cand.content)["data"][0]
    assert row == {"First_Name": "Sai", "Last_Name": "Varsha", "Email": EMAIL, "Source": "Nm7",
                   "Mobile": "+91 90000 00000"}  # fmt: skip
    assert b'name="attachments_category"' in partner.calls[2].content and b"Resume" in partner.calls[2].content
    assoc = json.loads(partner.calls[3].content)["data"][0]
    assert assoc["jobids"] == ["P-1"] and assoc["ids"] == ["Z55"] and "Line one." in assoc["comments"]
    assert got == {"remote_id": "Z55", "candidate_id": "Z55"} and map_status(raw) == "interview"


async def test_greenhouse_and_darwinbox_shapes(partner):
    partner.on("POST", f"{GH}/jobs/P-1", {"success": "ok"})
    dbx = "https://acme.darwinbox.in/JobsApiv3"
    partner.on("POST", f"{dbx}/AddCandidate", {"status": 1, "candidate_id": "D9"})
    partner.on("POST", f"{dbx}/BulkCandidatesData", {"status": 1, "data": [{"stage": "Rejected"}]})
    async with base.client() as http:
        await Greenhouse({"board_token": "acme"}, {"api_key": GH_KEY}, http).submit(SUB)
        ad = Darwinbox({"subdomain": "acme"}, {"username": "u", "password": "p", "api_key": "dbx-SECRET-key"}, http)
        got = await ad.submit(SUB)
        raw = await ad.status({"remote_id": got["remote_id"]})
    gh = json.loads(partner.calls[0].content)
    assert set(gh) == {"first_name", "last_name", "email", "phone", "resume_content", "resume_content_filename",
                       "cover_letter_text"}  # fmt: skip
    dx = partner.calls[1]
    assert dx.headers["authorization"] == "Basic " + base64.b64encode(b"u:p").decode()
    body = json.loads(dx.content)
    assert body["api_key"] == "dbx-SECRET-key" and body["job_id"] == "P-1" and body["source"] == "Nm7"
    assert got["remote_id"] == "D9" and map_status(raw) == "rejected"


def test_status_words_map_onto_nm7():
    assert map_status("Application Review") == "viewed"
    assert map_status("Phone Screen") == "interview"
    assert map_status("Face to Face Interview") == "interview"
    assert map_status("Offer") == "offer" and map_status("hired") == "offer"
    assert map_status("Not Selected") == "rejected" and map_status("rejected") == "rejected"
    assert map_status("Qualified") == "shortlisted"
    assert map_status("New") is None and map_status("") is None and map_status(None) is None


# ---------- the switch, the demo ----------


async def test_switch_off_never_reaches_a_real_companys_system(client, outbox, db, partner):
    uid, session, cid = await setup(client, outbox, db, mode="full_auto")
    greenhouse_ok(partner)
    await connect_gh(client, session, cid)
    partner.on("POST", f"{GH}/jobs/4001", 503)  # the first try fails: it waits for the next pass
    j = await linked_job(client, session, cid, db)
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["id"]})
    assert app and app["channel_v2"] == "partner"
    # the company's tester leaves the list before the pass: the delivery is kept on Nm7, the partner is not called
    await save_site(db, {"auto_apply_v2": {"testers": [EMAIL]}})
    posts = len([c for c in partner.calls if c.method == "POST"])
    await db[ATS_DELIVERIES].update_many({}, {"$set": {"next_at": now()}})
    await service.deliver_due(db)
    assert len([c for c in partner.calls if c.method == "POST"]) == posts
    d = await db[ATS_DELIVERIES].find_one({"app_id": app["_id"]})
    assert d["state"] == "failed" and d["reason"] == "switch_off"
    # and a new one is never queued for that company while the switch is OFF
    u = await db[USERS].find_one({"_id": uid})
    it = await db[AUTO_ITEMS].find_one({"_id": app["auto_item_id"]})
    site = {"auto_apply_v2": {"public": False, "testers": [EMAIL]}}
    await db[ATS_DELIVERIES].delete_many({})
    assert await service.queue(db, u, it, await db[JOBS].find_one({"_id": j["id"]}), site) is None
    # a demo account never reaches a real company, even once public
    assert await service.queue(db, {**u, "demo": True}, it, await db[JOBS].find_one({"_id": j["id"]}),
                               {"auto_apply_v2": {"public": True}}) is None  # fmt: skip
    await save_site(db, TEST_CO)


async def test_demo_company_connected_demo_without_network(db, monkeypatch, client, outbox):
    from app.companies import demo

    def boom(request):
        raise AssertionError("the demo must never call a partner")

    monkeypatch.setattr(base, "TRANSPORT", httpx.MockTransport(boom))
    await demo.create(db)
    conn = await db[ATS_CONNECTIONS].find_one({"_id": demo.COMPANY_ID})
    assert conn["demo"] and conn["secret_enc"] is None
    assert service.safe(conn)["name"] == "Greenhouse (demo)"
    ds = await db[ATS_DELIVERIES].find({"company_id": demo.COMPANY_ID}).to_list(10)
    assert ds and all(d["state"] == "delivered" and d["demo"] for d in ds)
    # a delivery and a status pass through the demo adapter: no network
    async with base.client() as http:
        ad = service.adapter_for(conn, http)
        assert not ad.network and (await ad.submit(SUB))["remote_id"].startswith("demo-")
        assert (await ad.jobs())[0]["id"].startswith("demo-")
    await db[ATS_DELIVERIES].update_many({}, {"$set": {"checked_at": None}})
    await service.sync_pass(db)
    h = await service.health(db)
    assert next(p for p in h if p["key"] == "greenhouse")["demo"] == 1
    await demo.remove(db)
    assert await db[ATS_CONNECTIONS].count_documents({}) == 0 and await db[ATS_DELIVERIES].count_documents({}) == 0


async def test_sandbox_only_off_production(monkeypatch):
    from app.core import config

    assert any(p["key"] == "sandbox" for p in service.catalogue())
    monkeypatch.setattr(config.Settings, "is_prod", property(lambda self: True))
    assert service.partner_cls("sandbox") is None
    assert all(p["key"] != "sandbox" for p in service.catalogue())
