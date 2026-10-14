import os

# Point the app at the test database before anything imports the settings.
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://nm7:nm7@localhost:5432/nm7_test")
os.environ["CORS_ORIGINS"] = "http://localhost:5173"
os.environ["SECRET_KEY"] = "test-secret"

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
