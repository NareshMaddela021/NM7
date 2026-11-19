"""Darwinbox: NEEDS PARTNER DOCS CONFIRMATION before it is used for real.

Darwinbox does not publish its recruitment API openly; tenants get the docs (a Postman workspace) and credentials from
Darwinbox. What could be found publicly: tenant hosts `https://{subdomain}.darwinbox.in`, HTTP Basic credentials that
Darwinbox issues per tenant plus an `api_key` in the JSON body, and V3 recruitment endpoints under `/JobsApiv3/`
(a job list, `BulkCandidatesData` for candidates' stages, and rejecting candidates). The exact path and fields of the
"add a candidate to a job" call below are our best reading and are kept in the constants here, so confirming them with
Darwinbox changes only this file. Until then Admin should not turn Darwinbox on for a real company.
"""

from typing import Any

from app.autoapply.ats.base import Adapter, Field, PartnerError, Submission, json_of

PATH_JOBS = "/JobsApiv3/JobsList"  # to confirm
PATH_APPLY = "/JobsApiv3/AddCandidate"  # to confirm
PATH_STATUS = "/JobsApiv3/BulkCandidatesData"  # seen in public integration guides
CONFIRMED = False


class Darwinbox(Adapter):
    key = "darwinbox"
    name = "Darwinbox"
    fields = [
        Field(
            "subdomain",
            "Darwinbox subdomain",
            help="The first part of your address: <subdomain>.darwinbox.in.",
            pattern=r"^[A-Za-z0-9-]{1,63}$",
        ),
        Field(
            "username", "API user name", secret=True, help="Given by Darwinbox with the API access for your account."
        ),
        Field("password", "API password", secret=True),
        Field(
            "api_key",
            "Recruitment API key",
            secret=True,
            help="Darwinbox > Settings > Integrations > API, or ask your Darwinbox account manager.",
        ),
    ]
    how = (
        "Ask your Darwinbox account manager (or a Darwinbox admin under Settings > Integrations > API) to turn on "
        "the Recruitment API for Nm7; they give you the user name, password and API key."
    )

    @property
    def main_secret(self) -> str:
        return str(self.secret.get("api_key") or "")

    def _url(self, path: str) -> str:
        return f"https://{self.config['subdomain']}.darwinbox.in{path}"

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        r = await self.call(
            "POST",
            self._url(path),
            json={"api_key": self.secret["api_key"], **body},
            auth=(self.secret["username"], self.secret["password"]),
        )
        got = json_of(r)
        if isinstance(got, dict) and str(got.get("status")) in ("0", "false", "False"):
            raise PartnerError("bad_request", r.status_code)
        return got if isinstance(got, dict) else {}

    async def test(self) -> None:
        await self._post(PATH_JOBS, {"page": 1, "limit": 1})

    async def jobs(self) -> list[dict[str, Any]]:
        got = await self._post(PATH_JOBS, {"page": 1, "limit": 100})
        return [
            {
                "id": str(j.get("job_id") or j.get("id")),
                "title": str(j.get("job_title") or j.get("title") or "")[:160],
                "location": str(j.get("location") or "")[:80],
            }
            for j in (got.get("data") or [])[:300]
            if j.get("job_id") or j.get("id")
        ]

    async def submit(self, s: Submission) -> dict[str, Any]:
        got = await self._post(
            PATH_APPLY,
            {
                "job_id": s.job_id,
                "first_name": s.first_name,
                "last_name": s.last_name,
                "email": s.email,
                "mobile": s.phone,
                "source": "Nm7",
                "cover_letter": s.note(),
                "resume_name": s.resume_name,
                "resume": s.resume_b64,
            },
        )
        cid = got.get("candidate_id") or (got.get("data") or {}).get("candidate_id")
        return {"remote_id": str(cid) if cid else None, "candidate_id": str(cid) if cid else None}

    async def status(self, d: dict[str, Any]) -> str | None:
        if not d.get("remote_id"):
            return None
        got = await self._post(PATH_STATUS, {"candidate_ids": [d["remote_id"]]})
        rows = got.get("data") or []
        row = rows[0] if rows and isinstance(rows, list) else {}
        return str(row.get("stage") or row.get("status") or "") or None
