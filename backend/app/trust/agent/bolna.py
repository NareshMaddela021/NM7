# ruff: noqa: E501  (request shapes)
"""Bolna (https://bolna.ai, an Indian AI voice-agent platform: speech-to-text, the conversation and text-to-speech in
English, Hindi and Telugu, over Indian telephony through Exotel / Plivo): the real AI calling adapter. Isolated: httpx
and three settings (BOLNA_API_KEY, BOLNA_AGENT_ID, VOICE_WEBHOOK_SECRET).

  start  POST {base}/call   (Authorization: Bearer <api key>)
         {"agent_id": "<one agent set up in Bolna's dashboard with our prompt>", "recipient_phone_number": "+919876543210",
          "user_data": {"language": "hi", "intro": "…", "questions": "1. … 2. …", "slots": "1. … 2. …", "ref": "<convo>", …}}
         answer: {"execution_id": "…", "status": "queued"}
  result Bolna POSTs the execution to the agent's webhook URL when the call ends:
         {"id" | "execution_id", "status": completed | no-answer | busy | failed | call-disconnected, "conversation_duration",
          "transcript": "assistant: …\\nuser: …", "extracted_data": {"interest", "knockouts": {"q1": "yes"}, "slot"},
          "context_details": {"recipient_data": {"ref": "<convo>"}}, "telephony_data": {"recording_url"}}
         We never fetch or store the recording (recording is turned off on the agent; the URL is dropped here).
         Webhook check: the URL we give Bolna carries ?token=<VOICE_WEBHOOK_SECRET>; an X-Nm7-Signature HMAC header is
         also accepted if it is added later.
Needs vendor docs confirmation: the /call path and body names, the webhook's field names and status values, whether
Bolna can sign webhooks, and the extraction set-up (all read with fallbacks below). Try one call in their dashboard first.
"""

import logging
import re
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.security import same
from app.trust.agent.providers import CallResult, SendError, hmac_hex

log = logging.getLogger("nm7.trust.agent.bolna")

HTTP_CLIENT: httpx.AsyncClient | None = None  # tests put a mock transport here
TIMEOUT = 20
STATUS = {"completed": "completed", "call-disconnected": "completed", "no-answer": "no_answer", "no_answer": "no_answer",
          "busy": "busy", "failed": "failed", "error": "failed", "canceled": "failed", "cancelled": "failed"}  # fmt: skip


def _turns(t: Any) -> list[dict[str, str]]:
    if isinstance(t, list):
        return [{"who": "agent" if str(x.get("role") or x.get("who")) in ("assistant", "agent") else "candidate",
                 "text": str(x.get("content") or x.get("text") or "")[:1000]} for x in t if isinstance(x, dict)][:80]  # fmt: skip
    out = []
    for line in str(t or "").splitlines():
        m = re.match(r"\s*(assistant|agent|bot|user|human|customer)\s*:\s*(.*)", line, re.I)
        if m and m.group(2).strip():
            out.append(
                {
                    "who": "agent" if m.group(1).lower() in ("assistant", "agent", "bot") else "candidate",
                    "text": m.group(2).strip()[:1000],
                }
            )
    return out[:80]


class Bolna:
    key = "bolna"
    label = "Bolna AI voice agent (Exotel / Plivo numbers)"
    test = False

    def keys(self) -> dict[str, bool]:
        s = get_settings()
        return {
            "BOLNA_API_KEY": bool(s.bolna_api_key),
            "BOLNA_AGENT_ID": bool(s.bolna_agent_id),
            "VOICE_WEBHOOK_SECRET": bool(s.voice_webhook_secret),
        }

    def ready(self) -> bool:
        return all(self.keys().values())

    async def start_call(self, to: str, lang: str, script: dict[str, Any], ref: str) -> str:
        s = get_settings()
        data = {"language": lang, "ref": ref, **{k: (v if isinstance(v, str) else "\n".join(f"{i}. {x}" for i, x in enumerate(v, 1)))
                                                 for k, v in script.items()}}  # fmt: skip
        client = HTTP_CLIENT or httpx.AsyncClient(timeout=TIMEOUT)
        try:
            r = await client.post(f"{s.bolna_base_url.rstrip('/')}/call", headers={"Authorization": f"Bearer {s.bolna_api_key}"},
                                  json={"agent_id": s.bolna_agent_id, "recipient_phone_number": f"+{to}", "user_data": data})  # fmt: skip
        except httpx.HTTPError as e:
            raise SendError(f"bolna: {type(e).__name__}") from None
        finally:
            if HTTP_CLIENT is None:
                await client.aclose()
        if r.status_code >= 400:
            log.warning("bolna call refused: %s", r.status_code)
            raise SendError(f"bolna {r.status_code}")
        try:
            j = r.json()
            return str(j.get("execution_id") or j.get("id") or j.get("call_id") or "")
        except (ValueError, AttributeError):
            raise SendError("bolna: odd answer") from None

    def verify(self, raw: bytes, headers: dict[str, str], token: str = "") -> bool:
        secret = get_settings().voice_webhook_secret
        if not secret:
            return False
        sig = headers.get("x-nm7-signature") or ""
        return same(sig, hmac_hex(secret, raw)) if sig else bool(token) and same(token, secret)

    def parse(self, body: dict[str, Any]) -> CallResult:
        ex = body.get("extracted_data") or {}
        if isinstance(ex, str):
            ex = {}
        kos = ex.get("knockouts") if isinstance(ex.get("knockouts"), dict) else {}
        slot = str(ex.get("slot") or "0")
        try:
            minutes = float(body.get("conversation_duration") or 0) / 60
        except (TypeError, ValueError):
            minutes = 0.0
        return CallResult(
            ref=str(body.get("id") or body.get("execution_id") or ""), status=STATUS.get(str(body.get("status") or "").lower(), "failed"),
            transcript=_turns(body.get("transcript")), interest=str(ex.get("interest") or "").lower().replace(" ", "_"),
            answers={str(k): str(v).lower() for k, v in kos.items() if str(v).lower() in ("yes", "no")},
            slot=int(slot) if slot.isdigit() else 0, minutes=round(minutes, 2),
        ) if body else CallResult("", "failed")  # fmt: skip


def ref_of(body: dict[str, Any]) -> str:
    """Our conversation id, sent in user_data (used when the vendor's call id isn't stored yet)."""
    return str((((body.get("context_details") or {}).get("recipient_data")) or {}).get("ref") or "")
