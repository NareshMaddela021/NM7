"""The 100 test users for checking the live site (app/admin/test_users.py): how the rest of the code recognises them.
No imports, so anything (the mailer, the apply endpoint) can use it."""

PREFIX = "demo-test-"  # user ids demo-test-001 … 100 ("demo-" ids are skipped by the fraud scan without a lookup)
DOMAIN = "test.nm7.invalid"  # their addresses: no inbox exists, and nothing is ever sent there


def is_test_user(user_id: str | None) -> bool:
    return bool(user_id) and str(user_id).startswith(PREFIX)


def is_test_address(email: str | None) -> bool:
    return bool(email) and email.strip().lower().endswith(f"@{DOMAIN}")
