# ruff: noqa: E501
"""V3 screening interview question sets: one fixed, versioned set per role, stored as interviews/<slug>.json and
checked here (run: `python3 -m app.hire.vetting.interview_sets`). Each set has 7 questions, in this order:
2 "experience", 3 "knowledge", 1 "situation", 1 "motivation" (availability, salary and notice). Original wording only.

{
  "slug": "welding", "version": 1,
  "questions": [{"id": "welding-i1", "kind": "experience" | "knowledge" | "situation" | "motivation",
                 "q": "...", "looks_for": "what a good answer shows (for the grader, never shown)",
                 "te": "...", "hi": "..."}]          te / hi only for the roles that offer Telugu and Hindi
}
"""

import json
import re
import sys
from pathlib import Path
from typing import Any

from app.hire.vetting.roles import BY_SLUG, ROLES

DIR = Path(__file__).parent / "interviews"
ORDER = ["experience", "experience", "knowledge", "knowledge", "knowledge", "situation", "motivation"]
SCRIPT = {"te": re.compile(r"[ఀ-౿]"), "hi": re.compile(r"[ऀ-ॿ]")}


def validate(s: dict[str, Any], slug: str) -> list[str]:
    p: list[str] = []
    role = BY_SLUG.get(slug)
    if not role:
        return [f"{slug}: not a role"]
    if s.get("slug") != slug:
        p.append(f"slug must be {slug!r}")
    if not isinstance(s.get("version"), int) or s["version"] < 1:
        p.append("version must be a whole number from 1")
    qs = s.get("questions") or []
    if [q.get("kind") for q in qs] != ORDER:
        p.append(f"needs 7 questions in this order: {', '.join(ORDER)}")
    ids = set()
    for i, q in enumerate(qs):
        w = f"question {i + 1}"
        if not isinstance(q.get("id"), str) or not q["id"].startswith(f"{slug}-i") or q["id"] in ids:
            p.append(f"{w}: id must be unique and start with '{slug}-i'")
        ids.add(q.get("id"))
        if not isinstance(q.get("q"), str) or not 15 <= len(q["q"]) <= 300 or not q["q"].rstrip().endswith("?"):
            p.append(f"{w}: the question needs 15–300 characters and ends with '?'")
        if not isinstance(q.get("looks_for"), str) or not 20 <= len(q["looks_for"]) <= 400:
            p.append(f"{w}: looks_for needs 20–400 characters")
        for lang in [x for x in role["langs"] if x != "en"]:
            if not isinstance(q.get(lang), str) or not SCRIPT[lang].search(q[lang]):
                p.append(f"{w}: needs a {lang} version in {lang} script")
    return p


def load(slug: str) -> dict[str, Any] | None:
    f = DIR / f"{slug}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


_SETS: dict[str, dict[str, Any]] | None = None


def sets() -> dict[str, dict[str, Any]]:
    """Every valid set, by role test name (read once per process)."""
    global _SETS
    if _SETS is None:
        out = {}
        for r in ROLES:
            s = load(r["slug"])
            if s and not validate(s, r["slug"]):
                out[r["test"]] = s
        _SETS = out
    return _SETS


def main(argv: list[str]) -> int:
    bad = 0
    for r in [BY_SLUG[x] for x in argv] if argv else ROLES:
        s = load(r["slug"])
        probs = ["no file"] if s is None else validate(s, r["slug"])
        print(f"{r['slug']}: {'OK' if not probs else '; '.join(probs[:5])}")
        bad += bool(probs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
