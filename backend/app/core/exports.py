"""Shared bits of the CSV exports (organizations' shared-resume list, the admin orders report)."""

# Excel opens a UTF-8 CSV as Windows-1252 unless it starts with a byte-order mark; with it, Telugu, Hindi and
# every other script show as typed.
CSV_BOM = "﻿"

# A cell starting with one of these is quoted with a leading apostrophe so spreadsheets never run it as a formula
# (tab and carriage return are the separators Excel's DDE trick hides behind).
FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(v):
    """Quotes a string cell that would otherwise run as a formula; anything else is returned as it is."""
    return "'" + v if isinstance(v, str) and v[:1] in FORMULA_STARTS else v
