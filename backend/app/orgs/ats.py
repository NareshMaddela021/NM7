"""The rule-based ATS score (0-100) on the server, for organization dashboards and the recruiter portal.

The same rules as frontend/src/lib/atsScore.js (without a job description), so a coordinator sees the score the
student sees in "ATS check". tests/fixtures/ats_cases.json holds resumes with the score both sides must give
(backend: tests/test_org_placement.py, frontend: src/lib/atsScore.parity.test.js).
"""

import math
import re
from typing import Any

from app.core.richtext import plain
from app.me.service import visible_resume

ACTION = re.compile(
    r"^(built|led|created|improved|reduced|increased|designed|automated|analy[sz]ed|delivered|launched|managed|"
    r"developed|cut|grew|drove|owned|optimi[sz]ed|implemented|migrated|trained|mentored|negotiated|achieved|won|"
    r"streamlined|planned|wrote|researched|tested|deployed|scaled|saved|resolved|coordinated|organi[sz]ed|presented|"
    r"prepared|conducted|established|generated|handled|supported|collaborated|identified|elevated|utili[sz]ed|ran|"
    r"made)\b",
    re.I,
)
WEAK = re.compile(r"^(made|handled|ran)\b", re.I)
BULLET = re.compile(r"^[•\-*▸–]\s*")
DEFAULT_DESIGN = {
    "layout": "one",
    "bodySize": 10,
    "textColor": "#111111",
    "accent": "#111827",
    "accentOn": {"name": False, "headings": True, "lines": True, "links": False},
    "skillsStyle": "lines",
    "headingStyle": "underline",
    "sideTint": False,
}
BANDS = (("low", 0, 59), ("mid", 60, 79), ("high", 80, 100))


def _round(x: float) -> int:
    return math.floor(x + 0.5)  # JavaScript's Math.round (Python's round() rounds halves to even)


def _s(v: Any) -> str:
    return v if isinstance(v, str) else ""


def _list(v: Any) -> list[dict[str, Any]]:
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def split_skills(v: Any) -> list[str]:
    return [s.strip() for s in _s(v).split(",") if s.strip()]


def all_skills(d: dict[str, Any]) -> list[str]:
    return [s for g in _list(d.get("skillGroups")) if g.get("off") is not True for s in split_skills(g.get("value"))]


def courses_of(e: dict[str, Any]) -> list[str]:
    c = e.get("courses")
    items = c if isinstance(c, list) else re.split(r"[,;\n]+", _s(c))
    out: list[str] = []
    for x in items:
        x = re.sub(r"\s+", " ", str(x or "")).strip()
        if x and x.lower() not in {y.lower() for y in out}:
            out.append(x)
    return out[:12]


def _plain(v: Any) -> Any:
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_plain(x) for x in v]
    return plain(v)


def printed(data: dict[str, Any]) -> dict[str, Any]:
    """What prints, as plain text (hidden entries removed, no bold markers)."""
    return _plain(visible_resume(data or {}))


def resume_text(d: dict[str, Any]) -> str:
    parts: list[Any] = [(d.get("personal") or {}).get("headline"), d.get("summary"), *all_skills(d)]
    for e in _list(d.get("exp")):
        parts += [e.get("role"), e.get("company"), e.get("description")]
    for p in _list(d.get("proj")):
        parts += [p.get("title"), p.get("tagline"), p.get("description"), p.get("tech")]
    for e in _list(d.get("edu")):
        parts += [e.get("degree"), e.get("field"), *courses_of(e)]
    parts += [c.get("name") for c in _list(d.get("certs"))]
    for a in _list(d.get("ach")):
        parts += [a.get("title"), a.get("description")]
    for c in _list(d.get("custom")):
        for x in _list(c.get("items")):
            parts += [x.get("title"), x.get("description")]
    return " \n ".join(str(p) for p in parts if p).lower()


def bullets_of(d: dict[str, Any]) -> list[str]:
    out = []
    for e in [*_list(d.get("exp")), *_list(d.get("proj"))]:
        for b in _s(e.get("description")).split("\n"):
            b = BULLET.sub("", b).strip()
            if len(b) > 12:
                out.append(b)
    return out


def _lum(hex_: str) -> float:
    try:
        n = int(str(hex_).replace("#", ""), 16)
    except ValueError:
        return 0.0
    out = 0.0
    for i, c in enumerate(((n >> 16) & 255, (n >> 8) & 255, n & 255)):
        s = c / 255
        s = s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4
        out += s * (0.2126, 0.7152, 0.0722)[i]
    return out


def contrast_on_white(hex_: str) -> float:
    return 1.05 / (_lum(hex_) + 0.05)


def layout_score(ds: dict[str, Any], d: dict[str, Any]) -> int:
    """frontend/src/pages/builder/design.js atsCheck()."""
    p = 0
    if ds.get("layout") == "two":
        p += 15
    if (ds.get("bodySize") or 10) < 9.5:
        p += 10
    if ds.get("textColor") == "#4A4F59":
        p += 5
    on = ds.get("accentOn") or {}
    if (on.get("name") or on.get("headings") or on.get("links")) and contrast_on_white(ds.get("accent", "")) < 4.5:
        p += 10
    if ds.get("skillsStyle") == "chips":
        p += 5
    if d.get("showPhoto"):
        p += 5
    if ds.get("layout") == "two" and ds.get("sideTint") and contrast_on_white(ds.get("accent", "")) < 3:
        p += 3
    if ds.get("headingStyle") == "bar" and contrast_on_white(ds.get("accent", "")) < 3:
        p += 5
    return max(0, 100 - p)


def ats_score(data: dict[str, Any]) -> dict[str, Any]:
    """{score, checks: [{key, label, ok}]} — the same checks as the student's ATS check (no job description)."""
    d = printed(data)
    ds = {**DEFAULT_DESIGN, **(d.get("design") if isinstance(d.get("design"), dict) else {})}
    bullets = bullets_of(d)
    with_num = sum(1 for b in bullets if re.search(r"\d", b))
    strong = sum(1 for b in bullets if ACTION.search(b) and not WEAK.search(b))
    skills = len(all_skills(d))
    words = len(re.split(r"\s+", resume_text(d)))
    p = d.get("personal") or {}
    summary = _s(d.get("summary"))
    links = d.get("links") if isinstance(d.get("links"), dict) else {}
    n = max(1, len(bullets))
    checks = [
        ("contact", "Name, email and phone", 10, bool(p.get("name") and p.get("email") and p.get("phone")), None),
        ("linkedin", "LinkedIn link", 5, bool(links.get("linkedin")), None),
        ("summary", "Summary of 150–450 characters", 10, 150 <= len(summary) <= 450, None),
        (
            "experience",
            "Experience or projects",
            10,
            any(e.get("role") or e.get("company") for e in _list(d.get("exp")))
            or any(x.get("title") for x in _list(d.get("proj"))),
            None,
        ),
        (
            "numbers",
            "Results with numbers",
            15,
            bool(bullets) and with_num / n >= 0.5,
            _round(15 * min(1, with_num / n / 0.5)) if bullets else 0,
        ),
        (
            "verbs",
            "Bullets start with strong action verbs",
            10,
            bool(bullets) and strong / n >= 0.7,
            _round(10 * min(1, strong / n / 0.7)) if bullets else 0,
        ),
        ("skills", "8+ relevant skills", 10, skills >= 8, _round(10 * min(1, skills / 8))),
        (
            "education",
            "Education with dates",
            5,
            any(e.get("degree") and (e.get("to") or e.get("from")) for e in _list(d.get("edu"))),
            None,
        ),
        ("layout", "ATS-safe layout", 10, layout_score(ds, d) >= 90, None),
        ("length", "Fits about one page", 5, words <= 650, None),
    ]
    total = sum(w for _, _, w, _, _ in checks)
    got = sum(part if part is not None else (w if ok else 0) for _, _, w, ok, part in checks)
    return {
        "score": _round(got / total * 100),
        "checks": [{"key": k, "label": label, "ok": bool(ok)} for k, label, _, ok, _ in checks],
    }


def band(score: int | None) -> str | None:
    if score is None:
        return None
    return "low" if score < 60 else "mid" if score < 80 else "high"
