"""One file-name rule for every download the server names (the same as frontend/src/lib/fileName.js):
- letters and digits stay (in any script, with their vowel signs and the zero-width joiners inside a word); every
  other run of characters becomes one underscore;
- empty parts are dropped, and so are repeats: a part already said by another or inside a longer part
  ("AsuraaX" + "AsuraaX Batch 2026" → "AsuraaX_Batch_2026"), and the same word twice in a row ("AsuraaX_AsuraaX"),
  ignoring case;
- a date part (2026-10-25) keeps its dashes;
- at most about 80 characters with the extension, cut between words; the extension is always kept."""

import re
import unicodedata

MAX_NAME = 80
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _keep(c: str) -> bool:
    return c.isalnum() or unicodedata.category(c).startswith("M") or c in "‌‍"


def slug(s: str | None, max_len: int = 60) -> str:
    """'Asha – Data Analyst' → 'Asha_Data_Analyst' ('' when nothing usable is left)."""
    out = re.sub(r"_+", "_", "".join(c if _keep(c) else "_" for c in str(s or ""))).strip("_‌‍")
    return out[:max_len].rstrip("_")


def _within(outer: list[str], inner: list[str]) -> bool:
    n = len(inner)
    return 0 < n <= len(outer) and any(outer[i : i + n] == inner for i in range(len(outer) - n + 1))


def file_name(parts: list[str | None], ext: str = "", *, fallback: str = "Nm7", max_len: int = MAX_NAME) -> str:
    e = re.sub(r"[^A-Za-z0-9]", "", (ext or "").lstrip(".")).lower()
    words = []
    for p in parts:
        t = str(p or "").strip()
        ws = [t] if _DATE.match(t) else [w for w in slug(t, 200).split("_") if w]
        if ws:
            words.append(ws)
    low = [[w.casefold() for w in ws] for ws in words]
    kept = []
    for i, me in enumerate(low):
        said = any(
            (len(them) == len(me) and j < i and them == me) or (len(them) > len(me) and _within(them, me))
            for j, them in enumerate(low)
            if j != i
        )
        if not said:
            kept.append(words[i])
    flat: list[str] = []
    for w in (w for ws in kept for w in ws):
        if not flat or flat[-1].casefold() != w.casefold():
            flat.append(w)
    room = max(10, max_len - (len(e) + 1 if e else 0))
    stem = ""
    for w in flat:
        nxt = f"{stem}_{w}" if stem else w
        if len(nxt) > room:
            stem = stem or w[:room]
            break
        stem = nxt
    stem = stem or slug(fallback) or "Nm7"
    return f"{stem}.{e}" if e else stem
