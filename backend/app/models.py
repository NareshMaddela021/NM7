"""Imports every model module so Alembic (and tests) see all tables on Base.metadata."""

from app import audit  # noqa: F401
from app.auth import models as auth_models  # noqa: F401
from app.core import rate_limit  # noqa: F401
from app.core.db import Base
from app.orders import models as order_models  # noqa: F401
from app.payments import models as payment_models  # noqa: F401

__all__ = ["Base"]
