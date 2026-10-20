import os

# Point the app at the test database before anything imports the settings.
os.environ["APP_ENV"] = "test"
# A MongoDB replica set (transactions need one): GitHub Actions starts one; locally see README.
os.environ["MONGODB_URI"] = os.environ.get("TEST_MONGODB_URI", "mongodb://127.0.0.1:27017/?replicaSet=rs0")
os.environ["MONGODB_DB"] = os.environ.get("TEST_MONGODB_DB", "nm7_test")
os.environ["CORS_ORIGINS"] = "http://localhost:5173"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["RAZORPAY_KEY_ID"] = "rzp_test_key"
os.environ["RAZORPAY_KEY_SECRET"] = "rzp_test_secret"
os.environ["RAZORPAY_WEBHOOK_SECRET"] = "whsec_test"

import re  # noqa: E402

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.core.db import COLLECTIONS, close_client, ensure_indexes, get_client, get_database  # noqa: E402
from app.core.email import Email, get_mailer  # noqa: E402
from app.main import create_app  # noqa: E402

ORIGIN = "http://localhost:5173"
PASSWORD = "Nm7@2026x"


@pytest.fixture(scope="session", autouse=True)
async def fresh_database():
    """Start every test run from an empty database with all collections and indexes."""
    db_name = os.environ["MONGODB_DB"]
    assert db_name.endswith("_test"), "refusing to drop a database that isn't a test database"
    await get_client().drop_database(db_name)
    await ensure_indexes(get_database())
    yield
    await close_client()


@pytest.fixture(autouse=True)
async def clean_collections():
    yield
    db = get_database()
    for name in COLLECTIONS:
        await db[name].delete_many({})


@pytest.fixture
async def db():
    return get_database()


class Outbox:
    available = True

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
    """Razorpay's API, mocked: orders are created, a payment fetched by /verify is captured for the order created
    last (tests make the payment id up), refunds are accepted. `payment_overrides` changes what a fetch returns."""

    def __init__(self, router: respx.MockRouter):
        self.router = router
        self._ids = itertools.count(1)
        self.last_order: dict | None = None
        self.payment_overrides: dict = {}
        self.orders = router.post(f"{BASE_URL}/orders").mock(side_effect=self._create_order)
        self.payments = router.get(url__regex=rf"{BASE_URL}/payments/(?P<pid>[^/]+)$").mock(side_effect=self._payment)
        self.refunds = router.post(url__regex=rf"{BASE_URL}/payments/(?P<pid>[^/]+)/refund").mock(
            side_effect=self._refund
        )

    def _create_order(self, request):
        body = json.loads(request.content)
        self.last_order = {
            "id": f"order_T{next(self._ids):04d}",
            "entity": "order",
            "amount": body["amount"],
            "currency": body["currency"],
            "receipt": body["receipt"],
            "status": "created",
        }
        return httpx.Response(200, json=self.last_order)

    def _payment(self, request, pid):
        o = self.last_order or {}
        payment = {
            "id": pid,
            "entity": "payment",
            "amount": o.get("amount", 0),
            "currency": o.get("currency", "INR"),
            "status": "captured",
            "order_id": o.get("id"),
            "method": "upi",
            **self.payment_overrides,
        }
        return httpx.Response(200, json=payment)

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


# ---------- admins and experts ----------

import pyotp  # noqa: E402

from app.auth.admin_service import create_admin  # noqa: E402


@pytest.fixture
def admin_client(make_client, db):
    """A browser signed in as an admin with two-step login done."""

    async def make(role="owner", email=None):
        email = email or f"{role}@nm7.si"
        _, secret, _ = await create_admin(db, email, role.title(), role, PASSWORD)
        c = make_client()
        await c.post("/api/auth/admin/login", json={"email": email, "password": PASSWORD})
        r = await c.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(secret).now()})
        assert r.status_code == 200, r.text
        return c

    return make


async def approved_expert(make_client, outbox, db, email="ravi@example.com", name="Ravi Kumar"):
    """A browser signed in as an approved expert. Returns (client, user_id)."""
    c = make_client()
    me = await signup(c, outbox, email, role="expert", name=name)
    await db["users"].update_one({"_id": me["id"]}, {"$set": {"expert_status": "approved"}})
    await db["expert_profiles"].update_one(
        {"_id": me["id"]}, {"$set": {"status": "approved", "profile": {}}}, upsert=True
    )
    return c, me["id"]
