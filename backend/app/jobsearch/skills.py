"""The skills dictionary (skills.json, about 2,000 common Indian job skills with synonyms) and the matcher every
job-search feature uses: the job-post parser, the match score, the tailored copy, cover letters and interview prep.

`find(text)` returns the canonical names of the skills a text mentions. Synonyms count as the same skill (Power BI /
PowerBI / MS Power BI, JS / JavaScript, MS Excel / Excel). Forms listed under "cs" (everyday words such as Word,
Spark, Go, or two-letter codes such as CA, PR) only count when written exactly like that, so "a word of advice" or
"go to the office" never become skills.
"""

import json
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

DATA = Path(__file__).with_name("skills.json")
_EDGE = r"(?<![A-Za-z0-9+#])"  # a skill starts at a word edge (so "C" never matches inside "Cloud")
_END = r"(?![A-Za-z0-9+#])"


@dataclass(frozen=True)
class Skill:
    name: str
    kind: str  # tech, tool, cert, soft, lang


def _form(alias: str) -> str:
    """The alias as a regex: any run of spaces, dots, hyphens or slashes between words matches any other
    ("Power BI" = "Power-BI"; "Node.js" = "Node js")."""
    lead = r"\." if alias.startswith(".") else ""  # ".NET" needs its dot, or "net banking" would match
    parts = [re.escape(p) for p in re.split(r"[\s.\-/]+", alias.strip()) if p]
    return lead + r"[\s.\-/]*".join(parts)


@cache
def _load() -> tuple[dict[str, Skill], re.Pattern, re.Pattern, dict[str, str]]:
    raw = json.loads(DATA.read_text(encoding="utf-8"))["skills"]
    by_name: dict[str, Skill] = {}
    loose: dict[str, str] = {}  # lower-case form → name
    exact: dict[str, str] = {}  # exact form → name
    for e in raw:
        s = Skill(e["n"], e["k"])
        by_name[s.name] = s
        cs = e.get("cs", [])
        if s.name not in cs:
            loose[s.name.lower()] = s.name
        for a in e.get("s", []):
            loose.setdefault(a.lower(), s.name)
        for a in cs:
            exact.setdefault(a, s.name)
        # a name with dots or spaces also matches written together ("PowerBI", "NodeJS")
        squashed = re.sub(r"[\s.\-]+", "", s.name.lower())
        if s.name not in cs and len(squashed) > 3 and squashed != s.name.lower():
            loose.setdefault(squashed, s.name)

    def pattern(forms: dict[str, str], flags: int) -> re.Pattern:
        alts = sorted(forms, key=len, reverse=True)  # the longest form wins ("Power BI Desktop" before "Power BI")
        return re.compile(_EDGE + "(" + "|".join(_form(a) for a in alts) + ")" + _END, flags)

    keys = {re.sub(r"[\s.\-/]+", " ", k.lower()): v for k, v in loose.items()}
    exact_keys = {re.sub(r"[\s.\-/]+", " ", k): v for k, v in exact.items()}
    lookup = {**{f"i:{k}": v for k, v in keys.items()}, **{f"x:{k}": v for k, v in exact_keys.items()}}
    return by_name, pattern(loose, re.IGNORECASE), pattern(exact, 0), lookup


def _norm(found: str) -> str:
    return re.sub(r"[\s.\-/]+", " ", found)


def skill(name: str) -> Skill | None:
    return _load()[0].get(name)


def kind(name: str) -> str:
    s = skill(name)
    return s.kind if s else "tech"


def count() -> int:
    return len(_load()[0])


def find(text: str) -> list[str]:
    """Canonical skill names mentioned in the text, in the order they first appear (no repeats)."""
    if not text:
        return []
    _, loose, exact, lookup = _load()
    hits: list[tuple[int, int, str]] = []
    for m in loose.finditer(text):
        name = lookup.get("i:" + _norm(m.group(1)).lower())
        if name:
            hits.append((m.start(), m.end(), name))
    for m in exact.finditer(text):
        name = lookup.get("x:" + _norm(m.group(1)))
        if name:
            hits.append((m.start(), m.end(), name))
    # the longest match wins where two overlap ("Power-BI" is Power BI, not also "BI")
    hits.sort(key=lambda h: (h[0], -(h[1] - h[0])))
    out: list[str] = []
    end = -1
    for start, stop, name in hits:
        if start < end:
            continue
        end = stop
        if name not in out:
            out.append(name)
    return out


def canonical(term: str) -> str | None:
    """The dictionary name for one term ("PowerBI" → "Power BI"), or None when it is not a known skill."""
    hits = find(term)
    return hits[0] if hits else None


def same(a: str, b: str) -> bool:
    """Two terms name the same skill (synonyms included); unknown terms compare case-insensitively."""
    ca, cb = canonical(a), canonical(b)
    if ca and cb:
        return ca == cb
    return a.strip().lower() == b.strip().lower()
