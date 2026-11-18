# ruff: noqa: E501  (field tables)
"""Surepass KYC APIs (https://surepass.io): the real registry-lookup adapter. Isolated: it only needs httpx and one key.

One vendor for all three registries, called with a Bearer token (SUREPASS_TOKEN; never logged, never returned):

  GSTIN  POST {base}/api/v1/corporate/gstin            {"id_number": "<GSTIN>", "filing_status_get": false}
  CIN    POST {base}/api/v1/corporate/company-details  {"id_number": "<CIN>"}
  Udyam  POST {base}/api/v1/corporate/udyog-aadhaar    {"id_number": "<UDYAM-XX-00-0000000>"}

Answer: {"data": {...}, "status_code": 200, "success": true, "message_code": "success"}; a number the registry doesn't
know answers 422 / 404 (or success false with message_code "verification_failed" / "invalid_..."). The field names
below are read with fallbacks, because we could not check every one against Surepass's current documents from here:
needs vendor docs confirmation (the paths, especially Udyam's, and the status / date field names) in the sandbox
(base https://sandbox.surepass.io) before going live (base https://kyc-api.surepass.io).
"""

import logging
import re
from datetime import datetime
from typing import Any

import httpx

from app.core.config import get_settings
from app.trust.employer.providers import LookupError_, Registry

log = logging.getLogger("nm7.trust.employer.surepass")

HTTP_CLIENT: httpx.AsyncClient | None = None  # tests put a mock transport here
TIMEOUT = 20
PATHS = {
    "gstin": "/api/v1/corporate/gstin",
    "cin": "/api/v1/corporate/company-details",
    "udyam": "/api/v1/corporate/udyog-aadhaar",  # needs vendor docs confirmation
}
NOT_FOUND_CODES = {
    "verification_failed",
    "invalid_gstin",
    "invalid_cin",
    "invalid_udyam",
    "not_found",
    "invalid_id_number",
}


def _first(d: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        cur: Any = d
        for part in k.split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        if cur not in (None, "", [], {}):
            return cur
    return None


def _date(v: Any) -> str:
    s = str(v or "").strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def _status(v: Any) -> str:
    s = str(v or "").strip().lower()
    if not s:
        return "unknown"
    if "cancel" in s or "struck" in s or "strike" in s or "dissolved" in s or "liquidat" in s:
        return "cancelled"
    if "suspend" in s:
        return "suspended"
    if "inactive" in s or "dormant" in s or "under process" in s:
        return "inactive"
    if "active" in s or s in ("provisional", "registered"):
        return "active"
    return "unknown"


def _city(address: Any) -> str:
    """The city from a free-text address ("..., Madhapur, Hyderabad, Telangana, 500081") or an address dict."""
    if isinstance(address, dict):
        return str(_first(address, "city", "district", "dst", "loc", "location") or "").strip().title()
    parts = [p.strip() for p in re.split(r",", str(address or "")) if p.strip()]
    parts = [p for p in parts if not re.fullmatch(r"\d{6}|india", p, re.I)]
    return parts[-2].title() if len(parts) >= 2 else ""


def _state(address: Any, fallback: str = "") -> str:
    if isinstance(address, dict):
        return str(_first(address, "state", "stcd") or fallback).strip().title()
    parts = [
        p.strip()
        for p in str(address or "").split(",")
        if p.strip() and not re.fullmatch(r"\d{6}|india", p.strip(), re.I)
    ]
    return parts[-1].title() if parts else fallback.title()


def parse(kind: str, data: dict[str, Any]) -> Registry:
    """Surepass's `data` → Registry (only the facts the match needs)."""
    ref = str(_first(data, "client_id", "request_id", "reference_id") or "")[:80]
    if kind == "gstin":
        addr = _first(data, "address", "principal_place_address", "pradr.addr")
        return Registry(True, legal_name=str(_first(data, "legal_name", "lgnm") or ""), trade_name=str(_first(data, "business_name", "trade_name", "tradeNam") or ""),
                        status=_status(_first(data, "gstin_status", "status", "sts")), registered_on=_date(_first(data, "date_of_registration", "rgdt")),
                        state=_state(addr, str(_first(data, "state_jurisdiction") or "")), city=_city(addr), vendor_ref=ref)  # fmt: skip
    if kind == "cin":
        info = _first(data, "details.company_info", "company_info") or data
        addr = _first(info, "registered_address", "address") or _first(data, "registered_address")
        return Registry(True, legal_name=str(_first(info, "company_name", "name") or _first(data, "company_name") or ""),
                        status=_status(_first(info, "company_status", "status", "llp_status") or _first(data, "company_status")),
                        registered_on=_date(_first(info, "date_of_incorporation", "incorporation_date")), state=_state(addr), city=_city(addr), vendor_ref=ref)  # fmt: skip
    main = _first(data, "main_details", "enterprise_details") or data
    addr = _first(main, "official_address", "address") or _first(data, "official_address")
    return Registry(True, legal_name=str(_first(main, "name_of_enterprise", "enterprise_name", "name") or ""),
                    status=_status(_first(main, "status", "registration_status") or "active"),  # Udyam has no "cancelled" in most answers
                    registered_on=_date(_first(main, "date_of_udyam_registration", "registration_date", "date_of_registration")),
                    state=_state(addr, str(_first(main, "state") or "")), city=_city(addr) or str(_first(main, "city", "district") or "").title(), vendor_ref=ref)  # fmt: skip


class Surepass:
    key = "surepass"
    label = "Surepass (GST, Udyam and MCA lookups)"
    test = False

    def keys(self) -> dict[str, bool]:
        return {"SUREPASS_TOKEN": bool(get_settings().surepass_token)}

    def ready(self) -> bool:
        return self.keys()["SUREPASS_TOKEN"]

    async def lookup(self, kind: str, number: str, *, hint: str = "") -> Registry:
        s = get_settings()
        body: dict[str, Any] = {"id_number": number}
        if kind == "gstin":
            body["filing_status_get"] = False
        client = HTTP_CLIENT or httpx.AsyncClient(timeout=TIMEOUT)
        try:
            r = await client.post(s.surepass_base_url.rstrip("/") + PATHS[kind], json=body,
                                  headers={"Authorization": f"Bearer {s.surepass_token}", "Content-Type": "application/json"})  # fmt: skip
        except httpx.HTTPError as e:
            raise LookupError_(type(e).__name__) from None
        finally:
            if HTTP_CLIENT is None:
                await client.aclose()
        try:
            j = r.json()
        except ValueError:
            j = {}
        code = str(j.get("message_code") or "").lower()
        if r.status_code in (404, 422) or (
            r.status_code == 200 and j.get("success") is False and code in NOT_FOUND_CODES
        ):
            return Registry(False, vendor_ref=str((j.get("data") or {}).get("client_id") or "")[:80])
        if r.status_code in (401, 403):
            log.warning("surepass: the token was refused (%s)", r.status_code)
            raise LookupError_("auth")
        if r.status_code != 200 or not isinstance(j.get("data"), dict):
            raise LookupError_(f"status {r.status_code}")
        return parse(kind, j["data"])
