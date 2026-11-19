"""Greenhouse, Lever and Zoho Recruit through their official APIs, plus the no-network sandbox (test servers only) and
the demo company's adapter. Darwinbox lives in darwinbox.py.

Greenhouse
  Job Board API (send an application): POST https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}, HTTP Basic
  with the Job Board API key as the user name, JSON with first_name, last_name, email, phone, resume_content (base64),
  resume_content_filename, cover_letter_text. Jobs: GET …/boards/{board}/jobs (public).
  Harvest API (optional, statuses): GET https://harvest.greenhouse.io/v1/candidates?email=…, HTTP Basic with the
  Harvest key; each candidate's applications carry status (active / rejected / hired) and current_stage.
Lever
  Postings API: GET https://api.lever.co/v0/postings/{site}?mode=json (public); apply:
  POST https://api.lever.co/v0/postings/{site}/{posting}?key={Postings API key}, multipart with name, email, phone,
  comments, source and the resume file → {"ok": true, "applicationId": …}. EU accounts use api.eu.lever.co.
  Lever API (optional, statuses): GET /v1/opportunities?email=…&expand=stage and /v1/archive_reasons, HTTP Basic with
  a Lever API key (read-only is enough).
Zoho Recruit (REST v2, OAuth)
  The company makes a Self Client in the Zoho API Console, generates a one-time code with the scopes
  ZohoRecruit.modules.ALL and gives Nm7 the client id, client secret and that code; Nm7 swaps the code for a refresh
  token once (accounts.zoho.{dc}/oauth/v2/token) and keeps only the refresh token (encrypted). Calls:
  GET /recruit/v2/Job_Openings, POST /recruit/v2/Candidates, POST /recruit/v2/Candidates/{id}/Attachments (the resume,
  category Resume), PUT /recruit/v2/Candidates/actions/associate (to the job opening, with the cover note), and
  GET /recruit/v2/Candidates/{id} (Candidate_Status) for the status.
"""

import hashlib
import time
from typing import Any

from app.autoapply.ats.base import Adapter, Field, PartnerError, Submission, json_of

# ---------- Greenhouse ----------

GH_BOARDS = "https://boards-api.greenhouse.io/v1/boards"
GH_HARVEST = "https://harvest.greenhouse.io/v1"


class Greenhouse(Adapter):
    key = "greenhouse"
    name = "Greenhouse"
    fields = [
        Field(
            "board_token",
            "Job board token",
            help="The name in your job board’s address: boards.greenhouse.io/<token>.",
            pattern=r"^[A-Za-z0-9_-]{1,80}$",
        ),
        Field(
            "api_key",
            "Job Board API key",
            secret=True,
            help="Greenhouse > Configure > Dev Center > API Credential Management > Create new API key > "
            "API type “Job Board”.",
        ),
        Field(
            "harvest_key",
            "Harvest API key (optional, for status updates)",
            secret=True,
            required=False,
            help="Same page, API type “Harvest”, with permission to read Candidates and Applications. Without it, "
            "statuses are not read back.",
        ),
    ]
    how = (
        "A Greenhouse admin creates the keys under Configure > Dev Center > API Credential Management. The Job "
        "Board key sends applications; the optional Harvest key lets Nm7 read their status."
    )
    status_ready_field = "harvest_key"

    @property
    def board(self) -> str:
        return self.config["board_token"]

    async def test(self) -> None:
        await self.call("GET", f"{GH_BOARDS}/{self.board}")
        if self.secret.get("harvest_key"):
            await self.call("GET", f"{GH_HARVEST}/users", params={"per_page": 1}, auth=(self.secret["harvest_key"], ""))

    async def jobs(self) -> list[dict[str, Any]]:
        got = json_of(await self.call("GET", f"{GH_BOARDS}/{self.board}/jobs"))
        return [
            {
                "id": str(j.get("id")),
                "title": str(j.get("title") or "")[:160],
                "location": str((j.get("location") or {}).get("name") or "")[:80],
            }
            for j in (got.get("jobs") or [])[:300]
            if j.get("id")
        ]

    async def submit(self, s: Submission) -> dict[str, Any]:
        body = {
            "first_name": s.first_name,
            "last_name": s.last_name or "-",
            "email": s.email,
            "phone": s.phone,
            "resume_content": s.resume_b64,
            "resume_content_filename": s.resume_name,
            "cover_letter_text": s.note(),
        }
        await self.call(
            "POST", f"{GH_BOARDS}/{self.board}/jobs/{s.job_id}", json=body, auth=(self.secret["api_key"], "")
        )
        return {"remote_id": None, "candidate_id": None}  # the Job Board API answers without an id

    async def status(self, d: dict[str, Any]) -> str | None:
        if not self.secret.get("harvest_key") or not d.get("email"):
            return None
        got = json_of(
            await self.call(
                "GET",
                f"{GH_HARVEST}/candidates",
                params={"email": d["email"], "per_page": 5},
                auth=(self.secret["harvest_key"], ""),
            )
        )
        for c in got if isinstance(got, list) else []:
            for a in c.get("applications") or []:
                if any(str(j.get("id")) == str(d["partner_job_id"]) for j in a.get("jobs") or []):
                    st = str(a.get("status") or "")
                    if st in ("rejected", "hired"):
                        return st
                    return str((a.get("current_stage") or {}).get("name") or "") or None
        return None


# ---------- Lever ----------

LEVER_HOSTS = {"global": "https://api.lever.co", "eu": "https://api.eu.lever.co"}


class Lever(Adapter):
    key = "lever"
    name = "Lever"
    fields = [
        Field(
            "site",
            "Lever site name",
            help="The name in your jobs page address: jobs.lever.co/<site>.",
            pattern=r"^[A-Za-z0-9_-]{1,80}$",
        ),
        Field(
            "region",
            "Region",
            options=[("global", "Global (api.lever.co)"), ("eu", "Europe (api.eu.lever.co)")],
            pattern=r"^(global|eu)$",
        ),
        Field(
            "api_key",
            "Postings API key",
            secret=True,
            help="Lever > Settings > Integrations and API > API Credentials > Postings API > Generate new key.",
        ),
        Field(
            "lever_key",
            "Lever API key (optional, for status updates)",
            secret=True,
            required=False,
            help="Same page, Lever API > Generate new key, read access to Opportunities and Archive reasons.",
        ),
    ]
    how = (
        "A Lever super admin creates the keys under Settings > Integrations and API > API Credentials. The Postings "
        "key sends applications; the optional Lever API key lets Nm7 read their status."
    )
    status_ready_field = "lever_key"

    @property
    def host(self) -> str:
        return LEVER_HOSTS.get(self.config.get("region") or "global", LEVER_HOSTS["global"])

    async def test(self) -> None:
        await self.call("GET", f"{self.host}/v0/postings/{self.config['site']}", params={"mode": "json", "limit": 1})
        if self.secret.get("lever_key"):
            await self.call("GET", f"{self.host}/v1/users", params={"limit": 1}, auth=(self.secret["lever_key"], ""))

    async def jobs(self) -> list[dict[str, Any]]:
        got = json_of(await self.call("GET", f"{self.host}/v0/postings/{self.config['site']}", params={"mode": "json"}))
        return [
            {
                "id": str(p.get("id")),
                "title": str(p.get("text") or "")[:160],
                "location": str((p.get("categories") or {}).get("location") or "")[:80],
            }
            for p in (got if isinstance(got, list) else [])[:300]
            if p.get("id")
        ]

    async def submit(self, s: Submission) -> dict[str, Any]:
        data = {"name": s.full_name, "email": s.email, "phone": s.phone, "comments": s.note(), "source": "Nm7"}
        r = await self.call(
            "POST",
            f"{self.host}/v0/postings/{self.config['site']}/{s.job_id}",
            params={"key": self.secret["api_key"]},
            data={k: v for k, v in data.items() if v},
            files={"resume": (s.resume_name, s.resume_pdf, "application/pdf")},
        )
        got = json_of(r)
        if not got.get("ok", True):
            raise PartnerError("bad_request", r.status_code)
        return {"remote_id": got.get("applicationId"), "candidate_id": None}

    async def status(self, d: dict[str, Any]) -> str | None:
        if not self.secret.get("lever_key") or not d.get("email"):
            return None
        auth = (self.secret["lever_key"], "")
        got = json_of(
            await self.call(
                "GET", f"{self.host}/v1/opportunities", params={"email": d["email"], "expand": "stage"}, auth=auth
            )
        )
        opps = got.get("data") or []
        mine = [o for o in opps if d.get("remote_id") and d["remote_id"] in (o.get("applications") or [])] or opps[:1]
        if not mine:
            return None
        o = mine[0]
        if o.get("archived"):
            reasons = json_of(await self.call("GET", f"{self.host}/v1/archive_reasons", auth=auth)).get("data") or []
            rid = (o["archived"] or {}).get("reason")
            kind = next((r.get("type") for r in reasons if r.get("id") == rid), None)
            return "hired" if kind == "hired" else "rejected" if kind == "non-hired" else None
        stage = o.get("stage")
        return str(stage.get("text") or "") if isinstance(stage, dict) else None


# ---------- Zoho Recruit ----------

ZOHO_DC = {"com": "com", "in": "in", "eu": "eu", "com.au": "com.au", "jp": "jp", "ca": "ca", "sa": "sa"}
_TOKENS: dict[str, tuple[str, float]] = {}  # refresh-token hash → (access token, expiry): memory only, never stored


class Zoho(Adapter):
    key = "zoho"
    name = "Zoho Recruit"
    fields = [
        Field(
            "region",
            "Zoho data centre",
            options=[
                ("in", "India (zoho.in)"),
                ("com", "US (zoho.com)"),
                ("eu", "Europe (zoho.eu)"),
                ("com.au", "Australia (zoho.com.au)"),
                ("jp", "Japan (zoho.jp)"),
                ("ca", "Canada (zohocloud.ca)"),
                ("sa", "Saudi Arabia (zoho.sa)"),
            ],
            pattern=r"^(com|in|eu|com\.au|jp|ca|sa)$",
        ),
        Field("client_id", "Client ID", secret=True, help="Zoho API Console > Self Client > Client Secret tab."),
        Field("client_secret", "Client secret", secret=True, help="Same tab as the Client ID."),
        Field(
            "code",
            "One-time code",
            secret=True,
            help="Self Client > Generate Code, scope ZohoRecruit.modules.ALL, 10 minutes. Paste it here straight "
            "away: Nm7 swaps it once for a lasting token.",
        ),
    ]
    how = (
        "A Zoho Recruit admin opens the Zoho API Console (api-console.zoho.in for India), adds a Self Client, copies "
        "the client ID and secret, and generates a one-time code with the scope ZohoRecruit.modules.ALL."
    )

    @property
    def main_secret(self) -> str:
        return str(self.secret.get("refresh_token") or self.secret.get("code") or "")

    def _hosts(self) -> tuple[str, str]:
        dc = ZOHO_DC.get(self.config.get("region") or "in", "in")
        if dc == "ca":
            return "https://accounts.zohocloud.ca", "https://recruit.zohocloud.ca"
        return f"https://accounts.zoho.{dc}", f"https://recruit.zoho.{dc}"

    async def prepare(self) -> dict[str, Any]:
        if self.secret.get("refresh_token") or not self.secret.get("code"):
            return self.secret
        accounts, _ = self._hosts()
        got = json_of(
            await self.call(
                "POST",
                f"{accounts}/oauth/v2/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": self.secret["client_id"],
                    "client_secret": self.secret["client_secret"],
                    "code": self.secret["code"],
                },
            )
        )
        if not got.get("refresh_token"):
            raise PartnerError("auth")  # a used or expired code answers 200 with {"error": "invalid_code"}
        self.secret = {
            "client_id": self.secret["client_id"],
            "client_secret": self.secret["client_secret"],
            "refresh_token": got["refresh_token"],
        }
        if got.get("access_token"):
            _TOKENS[self._cache_key()] = (got["access_token"], time.time() + int(got.get("expires_in") or 3600) - 120)
        return self.secret

    def _cache_key(self) -> str:
        return hashlib.sha256(str(self.secret.get("refresh_token") or "").encode()).hexdigest()

    async def _token(self) -> str:
        hit = _TOKENS.get(self._cache_key())
        if hit and hit[1] > time.time():
            return hit[0]
        if not self.secret.get("refresh_token"):
            raise PartnerError("config")
        accounts, _ = self._hosts()
        got = json_of(
            await self.call(
                "POST",
                f"{accounts}/oauth/v2/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": self.secret["client_id"],
                    "client_secret": self.secret["client_secret"],
                    "refresh_token": self.secret["refresh_token"],
                },
            )
        )
        if not got.get("access_token"):
            raise PartnerError("auth")
        _TOKENS[self._cache_key()] = (got["access_token"], time.time() + int(got.get("expires_in") or 3600) - 120)
        return got["access_token"]

    async def _api(self, method: str, path: str, **kw):
        _, api = self._hosts()
        headers = {"Authorization": f"Zoho-oauthtoken {await self._token()}"}
        return await self.call(method, f"{api}/recruit/v2{path}", headers=headers, **kw)

    async def test(self) -> None:
        await self._api("GET", "/Job_Openings", params={"per_page": 1})

    async def jobs(self) -> list[dict[str, Any]]:
        r = await self._api("GET", "/Job_Openings", params={"per_page": 100})
        got = json_of(r) if r.status_code != 204 else {}
        return [
            {
                "id": str(j.get("id")),
                "title": str(j.get("Posting_Title") or j.get("Job_Opening_Name") or "")[:160],
                "location": str(j.get("City") or "")[:80],
            }
            for j in (got.get("data") or [])[:300]
            if j.get("id")
        ]

    async def submit(self, s: Submission) -> dict[str, Any]:
        row = {"First_Name": s.first_name, "Last_Name": s.last_name or "-", "Email": s.email, "Source": "Nm7"}
        if s.phone:
            row["Mobile"] = s.phone
        got = json_of(await self._api("POST", "/Candidates", json={"data": [row]}))
        first = (got.get("data") or [{}])[0]
        cid = (first.get("details") or {}).get("id")
        if not cid or first.get("code") not in ("SUCCESS", "DUPLICATE_DATA"):
            raise PartnerError("bad_request")
        await self._api(
            "POST",
            f"/Candidates/{cid}/Attachments",
            data={"attachments_category": "Resume"},
            files={"file": (s.resume_name, s.resume_pdf, "application/pdf")},
        )
        await self._api(
            "PUT",
            "/Candidates/actions/associate",
            json={"data": [{"jobids": [s.job_id], "ids": [cid], "comments": s.note()[:3000]}]},
        )
        return {"remote_id": str(cid), "candidate_id": str(cid)}

    async def status(self, d: dict[str, Any]) -> str | None:
        if not d.get("remote_id"):
            return None
        got = json_of(await self._api("GET", f"/Candidates/{d['remote_id']}"))
        row = (got.get("data") or [{}])[0]
        return str(row.get("Candidate_Status") or "") or None


# ---------- no network: the sandbox (test servers) and the demo company ----------

SANDBOX_JOBS = [
    {"id": "sbx-101", "title": "Data Analyst (sandbox)", "location": "Hyderabad"},
    {"id": "sbx-102", "title": "Support Engineer (sandbox)", "location": "Chennai"},
    {"id": "sbx-103", "title": "Sales Associate (sandbox)", "location": "Bengaluru"},
]


def _fake_id(prefix: str, s: Submission) -> str:
    return f"{prefix}-" + hashlib.sha256(f"{s.job_id}:{s.email}".encode()).hexdigest()[:10]


class Sandbox(Adapter):
    """A pretend hiring system for test servers and the live browser tests: never on production, never the network.
    A key containing "fail" acts like a wrong key, so the failure messages can be seen too."""

    key = "sandbox"
    name = "Test system (no network)"
    fields = [
        Field(
            "api_key",
            "Test key",
            secret=True,
            help="Any 8 or more characters. A key with “fail” in it is refused, to see what a wrong key looks like.",
        )
    ]
    how = "Only on test servers: nothing leaves Nm7."
    network = False

    async def test(self) -> None:
        if len(self.secret.get("api_key") or "") < 8 or "fail" in self.secret.get("api_key", "").lower():
            raise PartnerError("auth", 401)

    async def jobs(self) -> list[dict[str, Any]]:
        await self.test()
        return [dict(j) for j in SANDBOX_JOBS]

    async def submit(self, s: Submission) -> dict[str, Any]:
        await self.test()
        return {"remote_id": _fake_id("sbx", s), "candidate_id": None}

    async def status(self, d: dict[str, Any]) -> str | None:
        return d.get("sandbox_status")  # set by hand in tests: shows the read-back without a partner


class Demo(Adapter):
    """The demo company's "connected (demo)" system: looks like the chosen partner, never calls anyone."""

    network = False
    fields: list[Field] = []

    def __init__(self, partner: Adapter | None, config, secret, http=None):
        super().__init__(config, secret, None)
        self.key = partner.key if partner else "greenhouse"
        self.name = f"{partner.name if partner else 'Greenhouse'} (demo)"

    async def test(self) -> None:
        return None

    async def jobs(self) -> list[dict[str, Any]]:
        return [
            {**j, "id": j["id"].replace("sbx", "demo"), "title": j["title"].replace("sandbox", "demo")}
            for j in SANDBOX_JOBS
        ]

    async def submit(self, s: Submission) -> dict[str, Any]:
        return {"remote_id": _fake_id("demo", s), "candidate_id": None}

    async def status(self, d: dict[str, Any]) -> str | None:
        return None
