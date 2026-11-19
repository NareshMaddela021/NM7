# ruff: noqa: E501  (request shapes)
"""WhatsApp Business through Meta's Cloud API directly (no BSP in between): the real WhatsApp adapter. Isolated: httpx
and four settings (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN).

  send   POST {graph}/{phone_number_id}/messages  (Authorization: Bearer <System User token>)
         template:    {"messaging_product": "whatsapp", "to": "919876543210", "type": "template", "template": {"name":
                      "nm7_job_match", "language": {"code": "en" | "hi" | "te"}, "components": [{"type": "body",
                      "parameters": [{"type": "text", "text": "Asha"}, …]}, {"type": "button", "sub_type": "quick_reply",
                      "index": "0", "parameters": [{"type": "payload", "payload": "nm7:<convo>:interested"}]}, …]}}
         in-window:   "type": "interactive" with up to 3 reply buttons (title ≤ 20 characters), or "type": "text"
         answer:      {"messages": [{"id": "wamid…"}]}
  webhook  GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → the challenge (the set-up check)
           POST signed X-Hub-Signature-256: sha256=HMAC-SHA256(app secret, raw body); entry → changes → value →
                messages (text / button / interactive) and statuses
Templates must be approved by Meta before the first send (Admin → Calls & WhatsApp shows the text to submit).
The request shapes follow Meta's Cloud API documents as we know them; check the template-button payload parameter and
the Graph version in the sandbox (Meta's test number) before going live.
"""

import logging
from typing import Any

import httpx

from app.core.config import get_settings
from app.trust.agent.providers import SendError, meta_signature_ok
from app.trust.agent.texts import TEMPLATE_NAME

log = logging.getLogger("nm7.trust.agent.meta")

HTTP_CLIENT: httpx.AsyncClient | None = None  # tests put a mock transport here
TIMEOUT = 15


class MetaCloud:
    key = "meta"
    label = "Meta WhatsApp Cloud API"
    test = False

    def keys(self) -> dict[str, bool]:
        s = get_settings()
        return {"WHATSAPP_ACCESS_TOKEN": bool(s.whatsapp_access_token), "WHATSAPP_PHONE_NUMBER_ID": bool(s.whatsapp_phone_number_id),
                "WHATSAPP_APP_SECRET": bool(s.whatsapp_app_secret), "WHATSAPP_VERIFY_TOKEN": bool(s.whatsapp_verify_token)}  # fmt: skip

    def ready(self) -> bool:
        return all(self.keys().values())

    async def _post(self, body: dict[str, Any]) -> str:
        s = get_settings()
        client = HTTP_CLIENT or httpx.AsyncClient(timeout=TIMEOUT)
        try:
            r = await client.post(f"{s.whatsapp_graph_url.rstrip('/')}/{s.whatsapp_phone_number_id}/messages", json=body,
                                  headers={"Authorization": f"Bearer {s.whatsapp_access_token}"})  # fmt: skip
        except httpx.HTTPError as e:
            raise SendError(f"meta: {type(e).__name__}") from None
        finally:
            if HTTP_CLIENT is None:
                await client.aclose()
        if r.status_code >= 400:
            code = ""
            try:
                code = str(((r.json() or {}).get("error") or {}).get("code") or "")
            except ValueError:
                pass
            log.warning("whatsapp send refused: %s %s", r.status_code, code)  # never the token or the body
            raise SendError(f"meta {r.status_code} {code}")
        try:
            return str((r.json().get("messages") or [{}])[0].get("id") or "")
        except (ValueError, AttributeError, IndexError):
            raise SendError("meta: odd answer") from None

    async def send_template(self, to: str, lang: str, params: list[str], payloads: list[str]) -> str:
        comps: list[dict[str, Any]] = [
            {"type": "body", "parameters": [{"type": "text", "text": p[:200]} for p in params]}
        ]
        comps += [{"type": "button", "sub_type": "quick_reply", "index": str(i), "parameters": [{"type": "payload", "payload": p}]}
                  for i, p in enumerate(payloads)]  # fmt: skip
        return await self._post({"messaging_product": "whatsapp", "to": to, "type": "template",
                                 "template": {"name": TEMPLATE_NAME, "language": {"code": lang}, "components": comps}})  # fmt: skip

    async def send_text(self, to: str, text: str, buttons: list[tuple[str, str]] | None = None) -> str:
        if buttons:
            return await self._post({"messaging_product": "whatsapp", "to": to, "type": "interactive", "interactive": {
                "type": "button", "body": {"text": text[:1024]},
                "action": {"buttons": [{"type": "reply", "reply": {"id": p[:256], "title": t[:20]}} for p, t in buttons[:3]]}}})  # fmt: skip
        return await self._post(
            {"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": text[:4096]}}
        )

    def verify(self, raw: bytes, headers: dict[str, str]) -> bool:
        return meta_signature_ok(get_settings().whatsapp_app_secret, raw, headers.get("x-hub-signature-256"))
