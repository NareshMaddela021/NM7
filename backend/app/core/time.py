from datetime import UTC, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def now() -> datetime:
    return datetime.now(UTC)


def ist_day(at: datetime | None = None) -> str:
    """The calendar day in India (IST) as YYYY-MM-DD: what "today" means to the people using the site."""
    return (at or now()).astimezone(IST).date().isoformat()
