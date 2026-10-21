"""Small async Razorpay client (orders, payments, refunds, payment links) and signature checks."""

import hashlib
import hmac
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.errors import ApiError

BASE_URL = "https://api.razorpay.com/v1"


class RazorpayError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"Razorpay {status}: {body[:300]}")
        self.status, self.body = status, body


class Razorpay:
    def __init__(self, key_id: str, key_secret: str, base_url: str = BASE_URL):
        self.key_id, self._secret, self.base_url = key_id, key_secret, base_url

    async def _call(self, method: str, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(auth=(self.key_id, self._secret), timeout=15) as client:
                r = await client.request(method, self.base_url + path, json=json)
        except httpx.HTTPError as e:
            raise RazorpayError(0, str(e)) from e
        if r.status_code >= 400:
            raise RazorpayError(r.status_code, r.text)
        return r.json()

    async def create_order(self, amount: int, currency: str, receipt: str, notes: dict[str, str]) -> dict[str, Any]:
        return await self._call(
            "POST", "/orders", {"amount": amount, "currency": currency, "receipt": receipt, "notes": notes}
        )

    async def fetch_payment(self, payment_id: str) -> dict[str, Any]:
        """The payment as Razorpay sees it (status, amount, currency, order_id, method)."""
        return await self._call("GET", f"/payments/{payment_id}")

    async def refund(self, payment_id: str, amount: int, receipt: str, notes: dict[str, str]) -> dict[str, Any]:
        body = {"amount": amount, "speed": "normal", "receipt": receipt, "notes": notes}
        return await self._call("POST", f"/payments/{payment_id}/refund", body)

    async def create_payment_link(
        self,
        amount: int,
        reference_id: str,
        description: str,
        customer: dict[str, str],
        notes: dict[str, str],
        expire_by: int,
    ) -> dict[str, Any]:
        """A Razorpay-hosted page to pay `amount` (for a proforma). Paid → webhook "payment_link.paid"."""
        body = {
            "amount": amount,
            "currency": "INR",
            "reference_id": reference_id,
            "description": description[:2048],
            "customer": customer,
            "notify": {"sms": False, "email": False},
            "reminder_enable": False,
            "notes": notes,
            "expire_by": expire_by,
        }
        return await self._call("POST", "/payment_links", body)

    async def cancel_payment_link(self, link_id: str) -> dict[str, Any]:
        return await self._call("POST", f"/payment_links/{link_id}/cancel")


def get_razorpay() -> Razorpay:
    s = get_settings()
    if not (s.razorpay_key_id and s.razorpay_key_secret):
        raise ApiError(503, "payments_unavailable", "Payments aren’t switched on yet. Please try again later.")
    return Razorpay(s.razorpay_key_id, s.razorpay_key_secret)


def _hmac(secret: str, msg: bytes) -> str:
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def payment_signature_ok(order_id: str, payment_id: str, signature: str, key_secret: str) -> bool:
    """Checkout handler: HMAC-SHA256("<order_id>|<payment_id>", key secret)."""
    return hmac.compare_digest(_hmac(key_secret, f"{order_id}|{payment_id}".encode()), signature or "")


def webhook_signature_ok(body: bytes, signature: str, webhook_secret: str) -> bool:
    """Webhook: HMAC-SHA256(raw request body, webhook secret)."""
    return hmac.compare_digest(_hmac(webhook_secret, body), signature or "")
