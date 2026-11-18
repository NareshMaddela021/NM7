# ruff: noqa: E501  (dense test data)
"""The DigiLocker provider interface, the test provider and the registry.

A provider does three things for one candidate's request (a "session"):
  start(...)            asks the vendor for a DigiLocker consent URL (the candidate approves there, inside DigiLocker)
  fetch(session, ...)   asks the vendor for the documents once the candidate approved: "pending" until then
  verify_callback(...)  checks the signature of the vendor's callback (the callback is only a nudge: Nm7 then calls
                        fetch itself and never trusts what the callback body says about documents)

Whatever a provider returns is raw (`RawDoc`): it may hold Aadhaar data, document numbers, dates of birth, photos.
service.keep() turns it into the few fields Nm7 stores and drops everything else, so a provider never decides what is
kept. Keys come from app/core/config.py and are never returned by any API (Admin only sees "set / not set").
"""

import hashlib
import hmac
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal, Protocol

from app.core.config import get_settings
from app.core.time import now

Status = Literal["pending", "done", "failed", "denied"]


@dataclass
class RawDoc:
    """One document as the vendor gave it (DigiLocker doc type code, e.g. DRVLC, PANCR, SSCER). Untrusted and unfiltered."""

    doc_type: str
    issuer: str = ""
    name: str = ""  # the name on the document
    number: str = ""  # PAN / licence / roll number: never stored as it is (service.keep)
    valid_until: str = ""  # YYYY-MM-DD when the document says so
    data: dict[str, Any] = field(default_factory=dict)  # anything else the vendor sent


@dataclass
class Started:
    vendor_ref: str
    url: str  # where the candidate approves (DigiLocker)
    expires_at: datetime | None = None


@dataclass
class Fetched:
    status: Status
    docs: list[RawDoc] = field(default_factory=list)
    error: str = ""  # plain words for the log and the Admin counts; never a key or a document number


class Provider(Protocol):
    key: str
    label: str
    test: bool  # True: the test provider (no real documents)

    def keys(self) -> dict[str, bool]: ...  # env var name → set (never the value)

    def ready(self) -> bool: ...

    async def start(self, *, sid: str, kinds: list[str], redirect_url: str, name_hint: str) -> Started: ...

    async def fetch(self, session: dict[str, Any], *, name_hint: str) -> Fetched: ...

    def verify_callback(self, body: bytes, headers: dict[str, str]) -> bool: ...

    def callback_ref(self, body: bytes) -> str | None: ...  # the vendor's request id named in the callback


# --- the test provider -------------------------------------------------------------------------------------------------

MOCK_HEADER = "x-mock-signature"


def mock_signature(body: bytes) -> str:
    """HMAC-SHA256 of the callback body with a key derived from SECRET_KEY (the tests sign their callbacks with it)."""
    key = hmac.new(get_settings().secret_key.encode(), b"digilocker-mock-webhook", hashlib.sha256).digest()
    return hmac.new(key, body, hashlib.sha256).hexdigest()


def _digits(seed: str, n: int) -> str:
    return str(int(hashlib.sha256(seed.encode()).hexdigest(), 16))[:n].rjust(n, "0")


class Mock:
    """Deterministic: the documents depend only on the session (user id, chosen kinds) and the profile name. The
    candidate "approves" with the test approve button (router: POST …/mock-approve). Every answer also carries Aadhaar
    data, a date of birth and a photo, exactly what a real vendor may send, so the tests prove they are dropped.
    A profile name with "mismatch" in it gets documents in another name (to try the review flow)."""

    key = "mock"
    label = "Test provider (no real documents)"
    test = True

    def keys(self) -> dict[str, bool]:
        return {}

    def ready(self) -> bool:
        return True

    async def start(self, *, sid: str, kinds: list[str], redirect_url: str, name_hint: str) -> Started:
        return Started(vendor_ref=f"mock-{sid}", url=f"{redirect_url}{'&' if '?' in redirect_url else '?'}dlmock=1",
                       expires_at=now() + timedelta(minutes=30))  # fmt: skip

    async def fetch(self, session: dict[str, Any], *, name_hint: str) -> Fetched:
        if session.get("mock_denied"):
            return Fetched("denied", error="The candidate said no in DigiLocker")
        if not session.get("mock_approved"):
            return Fetched("pending")
        uid = str(session.get("user_id"))
        name = "Ramesh Kumar Sharma" if "mismatch" in (name_hint or "").lower() else (name_hint or "Test Person")
        aadhaar = {"uid": "9999" + _digits(uid + "a", 8), "aadhaar_xml": "<OfflinePaperlessKyc>…</OfflinePaperlessKyc>",
                   "photo": "/9j/4AAQSkZJRgABAQ…", "dob": "12-04-1999", "gender": "F"}  # fmt: skip
        out = [RawDoc("ADHAR", "UIDAI", name, aadhaar["uid"], data=dict(aadhaar))]  # never kept
        made = {
            "dl": RawDoc("DRVLC", "Transport Department, Telangana", name, f"TS09 2019{_digits(uid + 'd', 7)}", "2039-04-11",
                         {"classes": ["MCWG", "LMV"], "dob": "1999-04-12", "photo": "/9j/4AAQ…", "uid": aadhaar["uid"]}),
            "class10": RawDoc("SSCER", "Board of Secondary Education, Telangana", name, _digits(uid + "10", 10),
                              data={"year": 2015, "result": "PASS", "examination": "SSC", "dob": "1999-04-12"}),
            "class12": RawDoc("HSCER", "Telangana State Board of Intermediate Education", name, _digits(uid + "12", 10),
                              data={"year": 2017, "result": "PASS", "examination": "Intermediate", "aadhaar": aadhaar["uid"]}),
            "degree": RawDoc("DGCER", "Jawaharlal Nehru Technological University Hyderabad", name, _digits(uid + "dg", 10),
                             data={"year": 2021, "result": "PASS", "degree": "B.Tech (Computer Science)"}),
            "pan": RawDoc("PANCR", "Income Tax Department", name, f"ABCPK{_digits(uid + 'p', 4)}L",
                          data={"dob": "12/04/1999", "aadhaar_seeding": "Y", "uid": aadhaar["uid"]}),
        }  # fmt: skip
        out += [made[k] for k in session.get("kinds") or [] if k in made]
        return Fetched("done", out)

    def verify_callback(self, body: bytes, headers: dict[str, str]) -> bool:
        got = headers.get(MOCK_HEADER, "")
        return bool(got) and hmac.compare_digest(got, mock_signature(body))

    def callback_ref(self, body: bytes) -> str | None:
        import json

        try:
            v = json.loads(body or b"{}").get("id")
        except (ValueError, AttributeError):
            return None
        return str(v) if v else None


# --- the registry ------------------------------------------------------------------------------------------------------


def registry() -> dict[str, Provider]:
    from app.trust.digilocker.setu import Setu

    return {"mock": Mock(), "setu": Setu()}


def get(key: str) -> Provider | None:
    return registry().get(key)
