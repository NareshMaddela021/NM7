import os

# Point the app at the test database before anything imports the settings.
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://nm7:nm7@localhost:5432/nm7_test")
os.environ["CORS_ORIGINS"] = "http://localhost:5173"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["RAZORPAY_KEY_ID"] = "rzp_test_key"
os.environ["RAZORPAY_KEY_SECRET"] = "rzp_test_secret"
os.environ["RAZORPAY_WEBHOOK_SECRET"] = "whsec_test"

import re  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.db import get_sessionmaker  # noqa: E402
from app.core.email import Email, get_mailer  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Base  # noqa: E402

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"
ORIGIN = "http://localhost:5173"
PASSWORD = "Nm7@2026x"


@pytest.fixture(scope="session", autouse=True)
def migrated_db() -> None:
    """Start every test run from an empty schema migrated to the latest revision."""
    cfg = Config(str(ALEMBIC_INI))
    cfg.attributes["database_url"] = os.environ["DATABASE_URL"]
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
async def clean_tables():
    yield
    names = ", ".join(t.name for t in Base.metadata.sorted_tables)
    async with get_sessionmaker()() as s:
        await s.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
        await s.execute(text("ALTER SEQUENCE order_no_seq RESTART"))
        await s.execute(text("ALTER SEQUENCE refund_no_seq RESTART"))
        await s.commit()


@pytest.fixture
async def db():
    async with get_sessionmaker()() as s:
        yield s


class Outbox:
    def __init__(self):
        self.sent: list[Email] = []

    async def send(self, msg: Email) -> None:
        self.sent.append(msg)

    def last_code(self, to: str) -> str:
        msg = next(m for m in reversed(self.sent) if m.to.lower() == to.lower())
        return re.search(r"\b(\d{6})\b", msg.text).group(1)


@pytest.fixture
def outbox():
    return Outbox()


@pytest.fixture
def app(outbox):
    app = create_app()
    app.dependency_overrides[get_mailer] = lambda: outbox
    return app


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": ORIGIN}) as c:
        yield c


@pytest.fixture
async def make_client(app):
    """Extra browsers (separate cookie jars)."""
    clients = []

    def make():
        c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": ORIGIN})
        clients.append(c)
        return c

    yield make
    for c in clients:
        await c.aclose()


async def signup(client, outbox, email="sai@example.com", role="customer", name="Sai Varsha", verify=True, **extra):
    body = {
        "role": role,
        "name": name,
        "email": email,
        "password": PASSWORD,
        "passwordConfirm": PASSWORD,
        "termsAccepted": True,
        **extra,
    }
    r = await client.post("/api/auth/signup", json=body)
    assert r.status_code == 201, r.text
    if verify:
        r = await client.post("/api/auth/verify-email", json={"email": email, "code": outbox.last_code(email)})
        assert r.status_code == 200, r.text
    return r.json()


# ---------- Razorpay (mocked) ----------

import hashlib  # noqa: E402
import hmac  # noqa: E402
import itertools  # noqa: E402
import json  # noqa: E402

import httpx  # noqa: E402
import respx  # noqa: E402

from app.payments.razorpay import BASE_URL  # noqa: E402


class FakeRazorpay:
    def __init__(self, router: respx.MockRouter):
        self.router = router
        self._ids = itertools.count(1)
        self.orders = router.post(f"{BASE_URL}/orders").mock(side_effect=self._create_order)
        self.refunds = router.post(url__regex=rf"{BASE_URL}/payments/(?P<pid>[^/]+)/refund").mock(
            side_effect=self._refund
        )

    def _create_order(self, request):
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": f"order_T{next(self._ids):04d}",
                "entity": "order",
                "amount": body["amount"],
                "currency": body["currency"],
                "receipt": body["receipt"],
                "status": "created",
            },
        )

    def _refund(self, request, pid):
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": f"rfnd_T{next(self._ids):04d}",
                "entity": "refund",
                "payment_id": pid,
                "amount": body["amount"],
                "status": "pending",
            },
        )

    def last_json(self, route):
        return json.loads(route.calls.last.request.content)


@pytest.fixture
def razorpay():
    with respx.mock(assert_all_called=False) as router:
        yield FakeRazorpay(router)


def checkout_signature(order_id: str, payment_id: str) -> str:
    msg = f"{order_id}|{payment_id}".encode()
    return hmac.new(os.environ["RAZORPAY_KEY_SECRET"].encode(), msg, hashlib.sha256).hexdigest()


async def send_webhook(client, event: dict, event_id: str | None = None, secret: str | None = None):
    body = json.dumps(event).encode()
    sig = hmac.new((secret or os.environ["RAZORPAY_WEBHOOK_SECRET"]).encode(), body, hashlib.sha256).hexdigest()
    headers = {"X-Razorpay-Signature": sig, "Content-Type": "application/json", "Origin": ""}
    if event_id:
        headers["X-Razorpay-Event-Id"] = event_id
    return await client.post("/api/payments/webhook", content=body, headers=headers)


def payment_event(kind: str, razorpay_order_id: str, payment_id: str, amount: int, method: str = "upi", **extra):
    entity = {
        "id": payment_id,
        "entity": "payment",
        "order_id": razorpay_order_id,
        "amount": amount,
        "currency": "INR",
        "method": method,
        "status": "captured" if kind != "payment.failed" else "failed",
        **extra,
    }
    return {"entity": "event", "event": kind, "payload": {"payment": {"entity": entity}}}


async def buy(client, plan="expert", role="Data Analyst", addons=None, pay=True):
    """Creates an order and (optionally) completes checkout. Returns (create_response_json, order_json)."""
    r = await client.post("/api/orders", json={"planId": plan, "role": role, "addons": addons or []})
    assert r.status_code == 201, r.text
    created = r.json()
    if not pay:
        return created, None
    pid = f"pay_{created['orderId'].replace('-', '')}"
    r = await client.post(
        "/api/payments/verify",
        json={
            "razorpay_order_id": created["razorpayOrderId"],
            "razorpay_payment_id": pid,
            "razorpay_signature": checkout_signature(created["razorpayOrderId"], pid),
        },
    )
    assert r.status_code == 200, r.text
    return created, r.json()
