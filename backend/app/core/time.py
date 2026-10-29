from datetime import UTC, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def now() -> datetime:
    return datetime.now(UTC)


def ist_day(at: datetime | None = None) -> str:
    """The calendar day in India (IST) as YYYY-MM-DD: what "today" means to the people using the site."""
    return (at or now()).astimezone(IST).date().isoformat()


def financial_year(at: datetime) -> str:
    """The Indian financial year (April to March, in IST) as "26-27"."""
    d = at.astimezone(IST)
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"
