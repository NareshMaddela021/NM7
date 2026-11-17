"""The partner adapter interface and one careful HTTP helper for every partner.

Official APIs only: each adapter calls the partner's documented API with the key the company gave Nm7. Nothing here
scrapes a partner's site, opens an account anywhere or posts to a job board.

Secrets never leave this process in readable form: a PartnerError carries only a kind ("auth", "rate_limited", …) and
the HTTP status, never a response body, a URL or a key; httpx's own request log has keys in query strings masked.
"""

import asyncio
import base64
import logging
import re
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

log = logging.getLogger("nm7.autoapply.ats")

TIMEOUT = httpx.Timeout(15.0, connect=5.0)
TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests set an httpx.MockTransport: never the network
SLEEP = asyncio.sleep  # tests replace it to check the waits without waiting
TRIES = 3  # attempts for a 429, a 5xx or a network error; 401 / 403 / 404 / other 4xx are not retried
MAX_WAIT = 30.0  # the longest single wait between tries (a partner's Retry-After is honoured up to this)
AGENT = "Nm7-AutoApply/1.0 (+https://nm7.si)"

# what a company sees for each kind (never the partner's own message, which could echo what was sent)
MESSAGES = {
    "auth": "The hiring system said the key isn’t valid or doesn’t have permission. Check the key and try again.",
    "not_found": "The hiring system couldn’t find that account or job. Check the board, site or subdomain name.",
    "rate_limited": "The hiring system asked Nm7 to slow down. Try again in a minute.",
    "server": "The hiring system had a problem on its side. Try again later.",
    "network": "Nm7 couldn’t reach the hiring system. Try again later.",
    "bad_request": "The hiring system refused the request. Check the details you entered.",
    "config": "Some details are missing or not in the right format.",
    "error": "Something went wrong talking to the hiring system. Try again later.",
}


class PartnerError(Exception):
    """A partner call that failed. str() is only the kind: safe for logs, the database and the browser."""

    def __init__(self, kind: str, status: int | None = None, retry_after: float | None = None):
        super().__init__(kind)
        self.kind = kind if kind in MESSAGES else "error"
        self.status = status
        self.retry_after = retry_after

    @property
    def message(self) -> str:
        return MESSAGES[self.kind]


class _Redact(logging.Filter):
    """httpx logs each request's URL; Lever's apply call carries its key in the query string. Mask such values."""

    RX = re.compile(
        r"((?:key|api_key|apikey|token|access_token|refresh_token|client_secret|client_id|code)=)[^&\s\"']+", re.I
    )

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001
            return True
        new = self.RX.sub(r"\1•••", msg)
        if new != msg:
            record.msg, record.args = new, ()
        return True


_FILTER = _Redact()
for _name in ("httpx", "httpcore"):
    if _FILTER not in logging.getLogger(_name).filters:
        logging.getLogger(_name).addFilter(_FILTER)


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=TIMEOUT, transport=TRANSPORT, follow_redirects=False, headers={"User-Agent": AGENT}
    )


def _retry_after(r: httpx.Response) -> float | None:
    v = r.headers.get("Retry-After")
    if not v:
        return None
    try:
        return max(0.0, float(v))
    except ValueError:
        pass
    try:
        from datetime import UTC, datetime

        return max(0.0, (parsedate_to_datetime(v) - datetime.now(UTC)).total_seconds())
    except (TypeError, ValueError):
        return None


async def request(http: httpx.AsyncClient, method: str, url: str, **kw) -> httpx.Response:
    """One partner call with polite retries: 429 waits for Retry-After (else 1 s, 2 s …), 5xx and network errors back
    off the same way, at most TRIES attempts. 401 / 403 → "auth", 404 → "not_found", other 4xx → "bad_request"."""
    err = PartnerError("error")
    for attempt in range(TRIES):
        try:
            r = await http.request(method, url, **kw)
        except httpx.TimeoutException:
            err = PartnerError("network")
        except httpx.HTTPError:
            err = PartnerError("network")
        else:
            if 200 <= r.status_code < 300:
                return r
            if r.status_code in (401, 403):
                raise PartnerError("auth", r.status_code)
            if r.status_code == 404:
                raise PartnerError("not_found", 404)
            if r.status_code == 429:
                err = PartnerError("rate_limited", 429, _retry_after(r))
            elif r.status_code >= 500:
                err = PartnerError("server", r.status_code)
            else:
                raise PartnerError("bad_request", r.status_code)
        if attempt + 1 < TRIES:
            await SLEEP(min(MAX_WAIT, err.retry_after if err.retry_after is not None else float(2**attempt)))
    raise err


def json_of(r: httpx.Response) -> Any:
    try:
        return r.json()
    except ValueError as e:
        raise PartnerError("server", r.status_code) from e


# ---------- the interface ----------


@dataclass
class Field:
    key: str
    label: str
    secret: bool = False
    required: bool = True
    help: str = ""
    options: list[tuple[str, str]] | None = None
    pattern: str = r"^\S{1,300}$"

    def out(self) -> dict[str, Any]:
        o: dict[str, Any] = {
            "key": self.key,
            "label": self.label,
            "secret": self.secret,
            "required": self.required,
            "help": self.help,
        }
        if self.options:
            o["options"] = [{"value": v, "label": lbl} for v, lbl in self.options]
        return o


@dataclass
class Submission:
    """One application, as a partner receives it: only what the candidate gave Nm7 (nothing invented)."""

    job_id: str
    first_name: str
    last_name: str
    email: str
    phone: str = ""
    resume_pdf: bytes = b""
    resume_name: str = "Resume.pdf"
    cover_note: list[str] = field(default_factory=list)
    answers: list[tuple[str, str]] = field(default_factory=list)
    profile_url: str = ""

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def resume_b64(self) -> str:
        return base64.b64encode(self.resume_pdf).decode()

    def note(self) -> str:
        """The cover note, then the screening answers in plain words, then where it came from."""
        parts = ["\n".join(x for x in self.cover_note if x)]
        if self.answers:
            parts.append("Screening answers (given on Nm7):\n" + "\n".join(f"Q: {q}\nA: {a}" for q, a in self.answers))
        if self.profile_url:
            parts.append(f"Nm7 profile: {self.profile_url}")
        parts.append("Sent by Nm7 Auto Apply on the candidate’s behalf.")
        return "\n\n".join(p for p in parts if p.strip())


class Adapter:
    """One partner. `config` holds the non-secret settings (board token, site, region, subdomain), `secret` the keys
    (decrypted only for the call). Each method raises PartnerError."""

    key = ""
    name = ""
    fields: list[Field] = []
    how = ""  # where a company finds its key, in plain words
    network = True
    status_ready_field: str | None = None  # the optional secret needed for the status read-back (None: always)

    def __init__(self, config: dict[str, Any], secret: dict[str, Any], http: httpx.AsyncClient | None = None):
        self.config = config
        self.secret = secret
        self.http = http

    @property
    def main_secret(self) -> str:
        """The key whose last 4 characters the company sees."""
        for f in self.fields:
            if f.secret and f.required and self.secret.get(f.key):
                return str(self.secret[f.key])
        return ""

    async def prepare(self) -> dict[str, Any]:
        """At connect: anything to swap before saving (Zoho: the one-time code for a refresh token). → the secret."""
        return self.secret

    async def test(self) -> None:
        raise NotImplementedError

    async def jobs(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    async def submit(self, s: Submission) -> dict[str, Any]:
        """→ {"remote_id": the partner's application / candidate id or None, "candidate_id": … or None}."""
        raise NotImplementedError

    async def status(self, d: dict[str, Any]) -> str | None:
        """The partner's current status text for one delivered application (None: unknown / not readable)."""
        return None

    def can_read_status(self) -> bool:
        return self.status_ready_field is None or bool(self.secret.get(self.status_ready_field))

    async def call(self, method: str, url: str, **kw) -> httpx.Response:
        if self.http is None:
            raise PartnerError("network")
        return await request(self.http, method, url, **kw)


# ---------- partner statuses → Nm7 statuses (the A2 status sync) ----------

RANK = {"applied": 0, "viewed": 1, "shortlisted": 2, "interview": 3, "offer": 4, "rejected": 4}
FINAL = ("offer", "rejected")
_WORDS = (
    ("rejected", ("reject", "declin", "not selected", "disqualif", "unsuccessful", "not a fit", "non-hired")),
    ("offer", ("offer", "hired", "joined")),
    ("interview", ("interview", "phone screen", "assessment", "panel", "technical round")),
    ("shortlisted", ("shortlist", "qualified", "screen", "selected")),
    ("viewed", ("review", "viewed", "in progress", "contacted", "associated")),
)


def map_status(raw: str | None) -> str | None:
    """A partner's stage or status, in its words → one of viewed / shortlisted / interview / offer / rejected, or
    None for "just applied" or anything not recognised (the tracker then stays as it is)."""
    s = f" {str(raw or '').strip().lower()} "
    if not s.strip():
        return None
    for status, words in _WORDS:
        if any(w in s for w in words):
            return status
    return None
