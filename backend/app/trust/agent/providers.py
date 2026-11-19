# ruff: noqa: E501  (dense docstrings)
"""The two outside services of the calling agent, behind small interfaces, with deterministic test providers.

WhatsApp (send a template that opens a conversation, send a reply inside the 24-hour window, read the webhook):
  send_template(to, lang, params, payloads) → message id      to: digits with country code ("919876543210")
  send_text(to, text, buttons) → message id                   buttons: [(payload, title)] (up to 3 quick replies)
  verify(raw body, headers) → bool                            the webhook's signature
The webhook format is Meta's (entry → changes → value → messages / statuses); the test provider uses the same format,
signed with a fixed test secret, so one parser reads both (`parse_meta`).

AI voice calls (start a call with a script; the provider calls back with the result):
  start_call(to, lang, script, ref) → call id                 script: intro, questions, slot times, closing lines
  verify(raw body, headers, token) → bool
  parse(payload) → CallResult                                 status, transcript turns, the answers it understood
Keys come from app/core/config.py and are never returned by any API (Admin only sees "set / not set").
"""

import hashlib
import hmac
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

from app.core.security import same

MOCK_WA_SECRET = "nm7-test-whatsapp-secret"  # the test provider's webhook signing secret (never used on production)
MOCK_VOICE_SECRET = "nm7-test-voice-secret"
SENT: deque = deque(maxlen=200)  # what the test providers "sent" (tests and the Admin test console read it)


class SendError(Exception):
    """The provider couldn't be reached or refused the message: try again later (nothing is marked as sent)."""


def hmac_hex(secret: str, raw: bytes) -> str:
    return hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def meta_signature_ok(secret: str, raw: bytes, header: str | None) -> bool:
    """Meta signs each webhook with the app secret: X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>."""
    if not secret or not header or not header.startswith("sha256="):
        return False
    return same(header.removeprefix("sha256="), hmac_hex(secret, raw))


@dataclass
class Inbound:
    phone: str  # digits with country code
    msg_id: str
    text: str = ""
    payload: str = ""  # a quick-reply button's payload ("nm7:<convo>:interested")
    at: datetime | None = None


@dataclass
class Status:
    msg_id: str
    status: str  # sent | delivered | read | failed
    phone: str = ""


def parse_meta(body: dict[str, Any]) -> tuple[list[Inbound], list[Status]]:
    """Messages and delivery statuses from a Meta Cloud API webhook (text, button and interactive replies)."""
    msgs: list[Inbound] = []
    statuses: list[Status] = []
    for entry in body.get("entry") or []:
        for ch in entry.get("changes") or []:
            v = ch.get("value") or {}
            for m in v.get("messages") or []:
                kind = m.get("type")
                text, payload = "", ""
                if kind == "text":
                    text = str((m.get("text") or {}).get("body") or "")
                elif kind == "button":  # a template's quick-reply button
                    payload = str((m.get("button") or {}).get("payload") or "")
                    text = str((m.get("button") or {}).get("text") or "")
                elif kind == "interactive":  # a reply button inside the conversation
                    br = (
                        (m.get("interactive") or {}).get("button_reply")
                        or (m.get("interactive") or {}).get("list_reply")
                        or {}
                    )
                    payload, text = str(br.get("id") or ""), str(br.get("title") or "")
                try:
                    at = datetime.fromtimestamp(int(m.get("timestamp")), UTC)
                except (TypeError, ValueError):
                    at = None
                msgs.append(Inbound(str(m.get("from") or ""), str(m.get("id") or ""), text[:1000], payload[:200], at))
            for s in v.get("statuses") or []:
                statuses.append(
                    Status(str(s.get("id") or ""), str(s.get("status") or ""), str(s.get("recipient_id") or ""))
                )
    return msgs, statuses


class WhatsApp(Protocol):
    key: str
    label: str
    test: bool

    def keys(self) -> dict[str, bool]: ...

    def ready(self) -> bool: ...

    async def send_template(self, to: str, lang: str, params: list[str], payloads: list[str]) -> str: ...

    async def send_text(self, to: str, text: str, buttons: list[tuple[str, str]] | None = None) -> str: ...

    def verify(self, raw: bytes, headers: dict[str, str]) -> bool: ...


class MockWhatsApp:
    """No network: "sends" into SENT and answers with a message id. A phone ending in 0000 fails (vendor down)."""

    key = "mock"
    label = "Test provider (no real WhatsApp messages)"
    test = True

    def keys(self) -> dict[str, bool]:
        return {}

    def ready(self) -> bool:
        return True

    def _send(self, to: str, kind: str, data: dict[str, Any]) -> str:
        if to.endswith("0000"):
            raise SendError("mock vendor down")
        mid = f"wamid.mock.{hashlib.sha256(f'{to}{kind}{len(SENT)}{datetime.now(UTC).timestamp()}'.encode()).hexdigest()[:16]}"
        SENT.append({"channel": "whatsapp", "to": to, "kind": kind, "id": mid, **data})
        return mid

    async def send_template(self, to: str, lang: str, params: list[str], payloads: list[str]) -> str:
        return self._send(to, "template", {"lang": lang, "params": params, "payloads": payloads})

    async def send_text(self, to: str, text: str, buttons: list[tuple[str, str]] | None = None) -> str:
        return self._send(to, "text", {"text": text, "buttons": buttons or []})

    def verify(self, raw: bytes, headers: dict[str, str]) -> bool:
        return meta_signature_ok(MOCK_WA_SECRET, raw, headers.get("x-hub-signature-256"))


@dataclass
class CallResult:
    ref: str
    status: str  # completed | no_answer | busy | failed
    transcript: list[dict[str, str]] = field(default_factory=list)  # [{who: agent | candidate, text}]
    interest: str = ""  # interested | not_now | stop | ""
    answers: dict[str, str] = field(default_factory=dict)  # knock-out id → yes / no (T6: or a number / an option)
    slot: int = 0  # 1.. the number of the offered time it picked, 0 none
    minutes: float = 0.0


def parse_canonical(body: dict[str, Any]) -> CallResult:
    """Our own call-result format (the test provider's, and what an adapter maps a vendor's answer to)."""
    a = body.get("answers") or {}
    return CallResult(
        ref=str(body.get("ref") or ""), status=str(body.get("status") or "failed"),
        transcript=[{"who": "agent" if t.get("who") == "agent" else "candidate", "text": str(t.get("text") or "")[:1000]}
                    for t in (body.get("transcript") or [])[:80] if isinstance(t, dict)],
        interest=str(a.get("interest") or ""), answers={str(k)[:10]: str(v)[:80] for k, v in list((a.get("knockouts") or {}).items())[:12] if str(v).strip()},
        slot=int(a.get("slot") or 0) if str(a.get("slot") or "0").isdigit() else 0, minutes=float(body.get("minutes") or 0),
    )  # fmt: skip


class Voice(Protocol):
    key: str
    label: str
    test: bool

    def keys(self) -> dict[str, bool]: ...

    def ready(self) -> bool: ...

    async def start_call(self, to: str, lang: str, script: dict[str, Any], ref: str) -> str: ...

    def verify(self, raw: bytes, headers: dict[str, str], token: str = "") -> bool: ...

    def parse(self, body: dict[str, Any]) -> CallResult: ...


class MockVoice:
    """No network: records the call in SENT and answers with a call id; the result comes back through the webhook
    (tests, or Admin's test console), signed with the test secret."""

    key = "mock"
    label = "Test provider (no real calls)"
    test = True

    def keys(self) -> dict[str, bool]:
        return {}

    def ready(self) -> bool:
        return True

    async def start_call(self, to: str, lang: str, script: dict[str, Any], ref: str) -> str:
        if to.endswith("0000"):
            raise SendError("mock vendor down")
        cid = f"call.mock.{ref}"
        SENT.append({"channel": "call", "to": to, "kind": "call", "id": cid, "lang": lang, "script": script})
        return cid

    def verify(self, raw: bytes, headers: dict[str, str], token: str = "") -> bool:
        return same(headers.get("x-nm7-signature") or "", hmac_hex(MOCK_VOICE_SECRET, raw))

    def parse(self, body: dict[str, Any]) -> CallResult:
        return parse_canonical(body)


def whatsapp_providers() -> dict[str, WhatsApp]:
    from app.trust.agent.meta import MetaCloud

    return {"mock": MockWhatsApp(), "meta": MetaCloud()}


def voice_providers() -> dict[str, Voice]:
    from app.trust.agent.bolna import Bolna

    return {"mock": MockVoice(), "bolna": Bolna()}
