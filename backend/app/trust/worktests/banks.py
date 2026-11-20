# ruff: noqa: E501  (dense checks)
"""Vetting Trust T15: the three work-test banks (banks/typing.json, sjt.json, aptitude.json) and their validator, like
the V2 question banks (app/hire/vetting/validate.py). Every bank must pass before it is used: the tests read banks only
through `load()`, which validates once and raises on any problem. Run: `uv run python -m app.trust.worktests.banks`.

  typing    2+ forms; each a short passage (150–400 characters) in English, Hindi (Devanagari) and Telugu script
  sjt       2+ forms of 10–15 workplace scenarios for non-tech roles (customer support, retail, delivery, front office,
            sales, field work, warehouse, working in a team); each scenario has 4 different responses, the expert key
            marks one "best" and one different "worst"; Hindi and Telugu in their own script; a form covers 5+ roles
  aptitude  2+ forms of 15–20 items: numerical, verbal and logical (3+ of each per form), 4 different options, one right
            answer; Hindi and Telugu versions in their own script (verbal items are written in the chosen language)
Every bank: unique ids, no "all / none of the above", no duplicate questions, nothing in a form missing a language.
"""

import json
import re
import sys
from functools import cache
from pathlib import Path
from typing import Any

DIR = Path(__file__).parent / "banks"
TESTS = ("typing", "sjt", "aptitude")
LANGS = ("en", "hi", "te")
LANG_NAMES = {"en": "English", "hi": "Hindi", "te": "Telugu"}
SCRIPT = {"hi": re.compile(r"[ऀ-ॿ]"), "te": re.compile(r"[ఀ-౿]")}
LATIN = re.compile(r"[A-Za-z]")
VAGUE = re.compile(r"\b(all|none|both|neither) of (the )?(above|these)\b|\ball the above\b", re.I)
SJT_ROLES = {"customer_support", "retail", "delivery", "front_office", "sales", "field_work", "warehouse", "team"}
SECTIONS = ("numerical", "verbal", "logical")
MIN_FORMS = 2
SJT_ITEMS = (10, 15)
APT_ITEMS = (15, 20)
PASSAGE = (150, 400)


class BankError(ValueError):
    pass


def _script_ok(text: str, lang: str) -> bool:
    """Mostly in the language's own script (a few Latin letters, like "UPI" or "ID", are fine)."""
    if lang == "en":
        return not SCRIPT["hi"].search(text) and not SCRIPT["te"].search(text)
    native = len(SCRIPT[lang].findall(text))
    return native > 0 and native >= 3 * len(LATIN.findall(text))


def _options(where: str, opts: Any, problems: list[str], lang: str = "en", script: bool = False) -> None:
    if not isinstance(opts, list) or len(opts) != 4 or not all(isinstance(o, str) and o.strip() for o in opts):
        problems.append(f"{where}: needs 4 options")
        return
    if len({o.strip().lower() for o in opts}) != 4:
        problems.append(f"{where}: the 4 options must be different")
    if any(VAGUE.search(o) for o in opts):
        problems.append(f"{where}: no “all / none of the above”")
    if (
        script
        and lang != "en"
        and not any(_script_ok(o, lang) for o in opts if LATIN.search(o) or SCRIPT[lang].search(o))
    ):
        problems.append(f"{where}: options not in {LANG_NAMES[lang]} script")


def _translations(where: str, item: dict[str, Any], problems: list[str], *, options_script: bool) -> None:
    for lang in ("hi", "te"):
        tr = item.get(lang)
        if not isinstance(tr, dict) or not str(tr.get("q") or "").strip():
            problems.append(f"{where}: missing the {LANG_NAMES[lang]} version")
            continue
        if not _script_ok(tr["q"], lang):
            problems.append(f"{where}: the {LANG_NAMES[lang]} question is not in {LANG_NAMES[lang]} script")
        _options(f"{where} ({lang})", tr.get("options"), problems, lang, script=options_script)


def validate(test: str, bank: dict[str, Any]) -> list[str]:
    """Every problem in one bank (an empty list = it may be used)."""
    p: list[str] = []
    if bank.get("test") != test:
        p.append(f"{test}: the file says test {bank.get('test')!r}")
    forms = bank.get("forms") or []
    if len(forms) < MIN_FORMS:
        p.append(f"{test}: needs at least {MIN_FORMS} forms to rotate (has {len(forms)})")
    fids = [f.get("id") for f in forms]
    if len(set(fids)) != len(fids) or not all(fids):
        p.append(f"{test}: every form needs its own id")
    seen_ids: set[str] = set()
    seen_q: set[str] = set()
    for f in forms:
        fid = f.get("id") or "?"
        if test == "typing":
            ps = f.get("passages") or {}
            for lang in LANGS:
                s = str(ps.get(lang) or "")
                if not s.strip():
                    p.append(f"{fid}: missing the {LANG_NAMES[lang]} passage")
                    continue
                if not PASSAGE[0] <= len(s) <= PASSAGE[1]:
                    p.append(
                        f"{fid} ({lang}): the passage should be {PASSAGE[0]}–{PASSAGE[1]} characters (has {len(s)})"
                    )
                if not _script_ok(s, lang) or (lang != "en" and LATIN.search(s)):
                    p.append(f"{fid} ({lang}): the passage must be in {LANG_NAMES[lang]} script only")
                if s != s.strip() or "  " in s or "\n" in s:
                    p.append(f"{fid} ({lang}): one line, single spaces")
            continue
        items = f.get("items") or []
        lo, hi = SJT_ITEMS if test == "sjt" else APT_ITEMS
        if not lo <= len(items) <= hi:
            p.append(f"{fid}: needs {lo}–{hi} items (has {len(items)})")
        for it in items:
            iid = it.get("id") or "?"
            if iid in seen_ids:
                p.append(f"{iid}: the id is used twice")
            seen_ids.add(iid)
            q = str(it.get("q") or "").strip()
            if not q:
                p.append(f"{iid}: no question")
            key = re.sub(r"\W+", " ", q.lower()).strip()
            if key in seen_q and test == "sjt":
                p.append(f"{iid}: the same scenario twice")
            seen_q.add(key)
            _options(iid, it.get("options"), p)
            if test == "sjt":
                if it.get("role") not in SJT_ROLES:
                    p.append(f"{iid}: unknown role {it.get('role')!r}")
                b, w = it.get("best"), it.get("worst")
                if b not in range(4) or w not in range(4):
                    p.append(f"{iid}: the key needs a best and a worst response (0–3)")
                elif b == w:
                    p.append(f"{iid}: the best and the worst response must be different")
                _translations(iid, it, p, options_script=True)
            else:
                if it.get("section") not in SECTIONS:
                    p.append(f"{iid}: section must be one of {', '.join(SECTIONS)}")
                if it.get("answer") not in range(4):
                    p.append(f"{iid}: one right answer (0–3)")
                _translations(iid, it, p, options_script=it.get("section") == "verbal")
                if it.get("section") == "verbal":  # verbal items are in the chosen language, never English options
                    for lang in ("hi", "te"):
                        opts = (it.get(lang) or {}).get("options") or []
                        if any(LATIN.search(o) and not SCRIPT[lang].search(o) for o in opts):
                            p.append(f"{iid} ({lang}): verbal options must be in {LANG_NAMES[lang]}")
        if test == "sjt" and len({it.get("role") for it in items}) < 5:
            p.append(f"{fid}: a form should cover at least 5 roles")
        if test == "aptitude":
            for s in SECTIONS:
                if sum(1 for it in items if it.get("section") == s) < 3:
                    p.append(f"{fid}: needs at least 3 {s} items")
    return p


def read(test: str) -> dict[str, Any]:
    return json.loads((DIR / f"{test}.json").read_text(encoding="utf-8"))


@cache
def load(test: str) -> dict[str, Any]:
    """The validated bank (cached). Raises BankError when the bank has a problem, so a broken bank is never used."""
    bank = read(test)
    problems = validate(test, bank)
    if problems:
        raise BankError(f"{test} bank: " + "; ".join(problems[:10]))
    return bank


def form(test: str, form_id: str) -> dict[str, Any]:
    for f in load(test)["forms"]:
        if f["id"] == form_id:
            return f
    raise KeyError(form_id)


def summary() -> list[dict[str, Any]]:
    """For Admin: each bank's forms, items and problems."""
    out = []
    for t in TESTS:
        bank = read(t)
        problems = validate(t, bank)
        forms = bank.get("forms") or []
        out.append({"test": t, "version": bank.get("version"), "forms": [f.get("id") for f in forms],
                    "items": [len(f.get("items") or f.get("passages") or []) for f in forms], "langs": list(LANGS),
                    "problems": problems, "ok": not problems})  # fmt: skip
    return out


def main() -> int:
    bad = 0
    for s in summary():
        print(f"{s['test']}: {'OK' if s['ok'] else 'PROBLEMS'} · forms {s['forms']} · items {s['items']}")
        for x in s["problems"]:
            print("  -", x)
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
