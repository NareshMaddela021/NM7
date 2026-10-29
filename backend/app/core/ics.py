"""iCalendar (.ics, RFC 5545) files for one event: what Google Calendar, Outlook and Apple Calendar import from an
email attachment. Times are written in UTC ("Z"), so every calendar shows them in the reader's own time zone; the
email text gives the IST time. A changed event keeps its UID with a higher SEQUENCE, so calendars update it."""

from datetime import UTC, datetime, timedelta


def _esc(text: str) -> str:
    """TEXT values: backslash, semicolon, comma and line breaks escaped."""
    t = str(text or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    return t.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")


def _fold(line: str) -> str:
    """Lines longer than 75 octets continue on the next line after CRLF + a space (never inside a UTF-8 character)."""
    out, cur, size = [], "", 0
    for ch in line:
        n = len(ch.encode())
        if size + n > (75 if not out else 74):
            out.append(cur)
            cur, size = "", 0
        cur += ch
        size += n
    out.append(cur)
    return "\r\n ".join(out)


def _utc(t: datetime) -> str:
    return t.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def event(
    *,
    uid: str,
    sequence: int,
    start: datetime,
    minutes: int,
    summary: str,
    location: str = "",
    description: str = "",
    url: str = "",
    cancelled: bool = False,
    stamp: datetime | None = None,
) -> bytes:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Nm7//Interviews//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"SEQUENCE:{sequence}",
        f"DTSTAMP:{_utc(stamp or datetime.now(UTC))}",
        f"DTSTART:{_utc(start)}",
        f"DTEND:{_utc(start + timedelta(minutes=minutes))}",
        f"SUMMARY:{_esc(summary)}",
        *([f"LOCATION:{_esc(location)}"] if location else []),
        *([f"DESCRIPTION:{_esc(description)}"] if description else []),
        *([f"URL:{url}"] if url else []),
        f"STATUS:{'CANCELLED' if cancelled else 'CONFIRMED'}",
        "TRANSP:OPAQUE",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return ("\r\n".join(_fold(x) for x in lines) + "\r\n").encode()
