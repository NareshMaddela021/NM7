# ruff: noqa: E501  (the document table)
"""Setu DigiLocker (https://docs.setu.co/data/digilocker): the real adapter. Isolated: it only needs httpx and the keys.

The flow, as Setu documents it (marked "needs vendor docs confirmation" where we could not check the exact field
names against Setu's current docs from here; confirm them in the Setu sandbox before going live):

  1. POST {base}/api/digilocker  {"redirectUrl": "<nm7.si/me/settings?dl=<session>>"}
       → {"id": "<request id>", "status": "unauthenticated", "url": "<DigiLocker consent page>", "validUpto": "…"}
  2. The candidate signs in to DigiLocker on that page and allows Nm7 to read the documents; DigiLocker sends them
     back to redirectUrl. Setu may also call our callback (needs vendor docs confirmation: header name and signing).
  3. GET  {base}/api/digilocker/{id}/status  → {"status": "authenticated" | "unauthenticated" | "revoked" | "expired"}
  4. POST {base}/api/digilocker/{id}/document {"docType": "DRVLC", "orgId": "…", "format": "xml", "consent": "Y"}
       → {"fileUrl": "<short-lived link to the issued XML>", "validUpto": "…"}; Nm7 downloads the XML, reads the few
       fields it needs (xmldoc.parse → service.keep) and throws the XML away.
  5. POST {base}/api/digilocker/{id}/revoke  (after the fetch: Nm7 needs no further access)

Never called: GET {base}/api/digilocker/{id}/aadhaar (Nm7 never asks for Aadhaar).

Headers: x-client-id, x-client-secret, x-product-instance-id (Setu Bridge → the DigiLocker product). Keys are read
from settings and never logged.
"""

import hashlib
import hmac
import json
import logging
from datetime import datetime
from typing import Any

import httpx

from app.core.config import get_settings
from app.trust.digilocker import xmldoc
from app.trust.digilocker.providers import Fetched, RawDoc, Started

log = logging.getLogger("nm7.trust.digilocker.setu")

HTTP_CLIENT: httpx.AsyncClient | None = None  # tests put a mock transport here
TIMEOUT = 15
CALLBACK_HEADER = "x-setu-signature"  # needs vendor docs confirmation

# kind → the DigiLocker (docType, orgId) pairs tried in order (needs vendor docs confirmation: orgIds per issuer; a pair
# the candidate doesn't have answers 4xx and is skipped). State boards and universities issue under their own orgIds,
# so more pairs can be added here without touching anything else.
DOCS: dict[str, list[tuple[str, str]]] = {
    "pan": [("PANCR", "001891")],  # Income Tax Department
    "dl": [("DRVLC", "000048")],  # Ministry of Road Transport and Highways (Sarathi), all states
    "class10": [("SSCER", "001925"), ("SSCMS", "001925")],  # CBSE Class X passing certificate / marksheet
    "class12": [("HSCER", "001925"), ("HSCMS", "001925")],  # CBSE Class XII passing certificate / marksheet
    "degree": [("DGCER", "NAD"), ("PDCER", "NAD")],  # degrees through the National Academic Depository (NAD)
}


class Setu:
    key = "setu"
    label = "Setu DigiLocker"
    test = False

    ENV = ("SETU_DG_CLIENT_ID", "SETU_DG_CLIENT_SECRET", "SETU_DG_PRODUCT_INSTANCE_ID", "DIGILOCKER_WEBHOOK_SECRET")

    def keys(self) -> dict[str, bool]:
        s = get_settings()
        return {"SETU_DG_CLIENT_ID": bool(s.setu_dg_client_id), "SETU_DG_CLIENT_SECRET": bool(s.setu_dg_client_secret),
                "SETU_DG_PRODUCT_INSTANCE_ID": bool(s.setu_dg_product_instance_id),
                "DIGILOCKER_WEBHOOK_SECRET": bool(s.digilocker_webhook_secret)}  # fmt: skip

    def ready(self) -> bool:  # the webhook secret is optional: without it Nm7 polls (callbacks are refused)
        k = self.keys()
        return k["SETU_DG_CLIENT_ID"] and k["SETU_DG_CLIENT_SECRET"] and k["SETU_DG_PRODUCT_INSTANCE_ID"]

    def _headers(self) -> dict[str, str]:
        s = get_settings()
        return {"x-client-id": s.setu_dg_client_id, "x-client-secret": s.setu_dg_client_secret,
                "x-product-instance-id": s.setu_dg_product_instance_id, "content-type": "application/json"}  # fmt: skip

    def _url(self, path: str) -> str:
        return get_settings().setu_dg_base_url.rstrip("/") + path

    async def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> httpx.Response:
        client = HTTP_CLIENT or httpx.AsyncClient(timeout=TIMEOUT)
        try:
            return await client.request(method, self._url(path), headers=self._headers(), json=body)
        finally:
            if client is not HTTP_CLIENT:
                await client.aclose()

    async def _download(self, url: str) -> bytes | None:
        client = HTTP_CLIENT or httpx.AsyncClient(timeout=TIMEOUT)
        try:
            r = await client.get(url)
            return r.content if r.status_code == 200 and len(r.content) <= xmldoc.MAX_BYTES else None
        finally:
            if client is not HTTP_CLIENT:
                await client.aclose()

    async def start(self, *, sid: str, kinds: list[str], redirect_url: str, name_hint: str) -> Started:
        r = await self._call("POST", "/api/digilocker", {"redirectUrl": redirect_url})
        if r.status_code >= 300:
            raise RuntimeError(f"Setu answered {r.status_code} when asked for a DigiLocker request")
        d = r.json()
        exp = None
        try:
            exp = datetime.fromisoformat(str(d.get("validUpto")).replace("Z", "+00:00")) if d.get("validUpto") else None
        except ValueError:
            exp = None
        return Started(vendor_ref=str(d["id"]), url=str(d["url"]), expires_at=exp)

    async def fetch(self, session: dict[str, Any], *, name_hint: str) -> Fetched:
        ref = session["vendor_ref"]
        r = await self._call("GET", f"/api/digilocker/{ref}/status")
        if r.status_code >= 300:
            return Fetched("failed", error=f"status check answered {r.status_code}")
        st = str(r.json().get("status") or "").lower()
        if st in ("unauthenticated", "pending", "initiated", ""):
            return Fetched("pending")
        if st in ("revoked", "denied", "rejected", "expired"):
            return Fetched("denied", error=f"DigiLocker request {st}")
        docs: list[RawDoc] = []
        for kind in session.get("kinds") or []:
            for doc_type, org in DOCS.get(kind, []):
                g = await self._call("POST", f"/api/digilocker/{ref}/document",
                                     {"docType": doc_type, "orgId": org, "format": "xml", "consent": "Y"})  # fmt: skip
                if g.status_code >= 300:
                    continue
                url = (g.json() or {}).get("fileUrl")
                xml = await self._download(url) if url else None
                doc = xmldoc.parse(xml) if xml else None
                if doc:
                    doc.doc_type = doc.doc_type or doc_type
                    docs.append(doc)
                    break
        try:
            await self._call("POST", f"/api/digilocker/{ref}/revoke")
        except httpx.HTTPError:
            log.info("Setu revoke failed for a request (ignored)")
        return Fetched("done", docs)

    def verify_callback(self, body: bytes, headers: dict[str, str]) -> bool:
        secret = get_settings().digilocker_webhook_secret
        got = headers.get(CALLBACK_HEADER, "")
        if not secret or not got:
            return False
        want = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(got.removeprefix("sha256="), want)

    def callback_ref(self, body: bytes) -> str | None:
        try:
            d = json.loads(body or b"{}")
        except ValueError:
            return None
        v = d.get("id") or d.get("requestId") or (d.get("data") or {}).get("id")
        return str(v) if v else None
