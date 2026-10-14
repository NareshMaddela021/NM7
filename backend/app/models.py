"""Imports every model module so Alembic (and tests) see all tables on Base.metadata."""

from app.core.db import Base

__all__ = ["Base"]
