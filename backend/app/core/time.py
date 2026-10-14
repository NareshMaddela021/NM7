from datetime import UTC, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def now() -> datetime:
    return datetime.now(UTC)
