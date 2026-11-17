"""The 100 test users for checking the live site (app/admin/test_users.py): how the rest of the code recognises them.
Only the standard library, so anything (the mailer, the apply endpoint) can use it."""

import uuid

COUNT = 100
DOMAIN = "test.nm7.invalid"  # their addresses: no inbox exists, and nothing is ever sent there


def uid_of(n: int) -> str:
    """Test user n always has the same id (user ids are UUIDs)."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://nm7.si/test-user/{n:03d}"))


IDS: tuple[str, ...] = tuple(uid_of(n) for n in range(1, COUNT + 1))
_IDS = frozenset(IDS)


def is_test_user(user_id: str | None) -> bool:
    return str(user_id) in _IDS


def is_test_address(email: str | None) -> bool:
    return bool(email) and email.strip().lower().endswith(f"@{DOMAIN}")
