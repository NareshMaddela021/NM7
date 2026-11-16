# ruff: noqa: E501  (dense response shapes, one field group a line)
"""The question-bank validator: every bank file in banks/ must pass before it is stored (the generator script, CI and
the Admin import all run it). Run: `uv run python -m app.hire.vetting.validate` (exit 1 on any problem).

A bank file (banks/<slug>.json):
{
  "slug": "welding", "version": 1,
  "topics": ["Safety", ...],                       4–6 topics
  "questions": [{"id": "welding-001", "topic": "Safety", "difficulty": "easy" | "medium" | "hard",
                 "kind": "mcq" | "scenario", "q": "...", "options": [4 strings], "answer": 0–3,
                 "te": {"q": "...", "options": [4]}, "hi": {...}}],          te / hi only for Telugu / Hindi roles
  "existing": {"<an H3 question's exact text>": {"topic": "...", "te": {...}, "hi": {...}}},   the 18 H3 tests only
  "task": {"type": "tech" | "written" | "voice" | "proof", "title": "...", "brief": "...", "minutes": 5–30,
           "material": "..." (optional: a sample table, a short function, an invoice ...),
           "key_points": ["..."] (optional, up to 10: what a good answer covers, for the grader),
           "rubric": [{"key": "clarity", "label": "Clarity", "guide": "0 = ..., 5 = ..."}],   3–5 criteria
           "situations": [{"q": "...", "options": [3–4], "answer": n, "topic": "..."}]}       proof only, 6+
}
Checked: the shape; exactly one right answer per question (one index, 4 different options, no "all / none of the
above"); no duplicate or near-duplicate questions (also against the H3 questions); answer positions balanced; no
answer leaked in the question text; the right option is not usually the longest; enough easy / medium / hard
questions for every experience band; simple words for non-tech roles (short questions and sentences); Telugu / Hindi
versions present and in the right script for the roles that offer them; a rubric for the practical task.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from app.hire.vetting.roles import BY_SLUG, ROLES, Role

BANKS = Path(__file__).parent / "banks"
MIN_QUESTIONS = 40
MIN_BY_DIFFICULTY = {"easy": 10, "medium": 12, "hard": 10}
MIN_PER_TOPIC = 4
VAGUE = re.compile(r"\b(all|none|both|neither) of (the )?(above|these)\b|^both\b|\ball the above\b", re.I)
SCRIPT = {"te": re.compile(r"[ఀ-౿]"), "hi": re.compile(r"[ऀ-ॿ]")}
STOP = set(
    "a an the of to in on for and or is are be it its this that with by at as from what which who when how why do does you your if can will should".split()
)


def words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9+#.]+", s.lower())


def norm(s: str) -> str:
    return " ".join(words(s))


def similar(a: str, b: str) -> float:
    """Jaccard similarity of the content words (1 = the same words)."""
    x, y = set(words(a)) - STOP, set(words(b)) - STOP
    return len(x & y) / len(x | y) if x and y else 0.0


def h3_questions(test: str) -> list[dict[str, Any]]:
    """The H3 starting questions of one test (bank.py + bank2.py), as {q, options, answer, difficulty}."""
    from app.hire.bank import SEED
    from app.hire.bank2 import SEED_2

    return [{"q": q, "options": o, "answer": a, "difficulty": d} for s, _r, d, q, o, a in SEED + SEED_2 if s == test]


def _opts(where: str, opts: Any, n: tuple[int, ...], answer: Any, problems: list[str]) -> None:
    if not isinstance(opts, list) or len(opts) not in n or not all(isinstance(o, str) and o.strip() for o in opts):
        problems.append(f"{where}: needs {' or '.join(map(str, n))} non-empty options")
        return
    if len({norm(o) for o in opts}) != len(opts):
        problems.append(f"{where}: two options are the same")
    if any(len(o) > 160 for o in opts):
        problems.append(f"{where}: an option is longer than 160 characters")
    if any(VAGUE.search(o) for o in opts):
        problems.append(f"{where}: 'all / none / both of the above' makes more than one answer possible")
    if not isinstance(answer, int) or not 0 <= answer < len(opts):
        problems.append(f"{where}: the answer must be the index of one option")


def _translation(where: str, lang: str, tr: Any, n: int, problems: list[str]) -> None:
    if not isinstance(tr, dict) or not isinstance(tr.get("q"), str) or not tr["q"].strip():
        problems.append(f"{where}: no {lang} version")
        return
    if not SCRIPT[lang].search(tr["q"]):
        problems.append(f"{where}: the {lang} question is not in {lang} script")
    opts = tr.get("options")
    if not isinstance(opts, list) or len(opts) != n or not all(isinstance(o, str) and o.strip() for o in opts):
        problems.append(f"{where}: the {lang} version needs {n} options, in the same order")


def validate(bank: dict[str, Any], role: Role) -> list[str]:
    p: list[str] = []
    slug = role["slug"]
    if bank.get("slug") != slug:
        p.append(f"slug must be {slug!r}")
    if not isinstance(bank.get("version"), int) or bank["version"] < 1:
        p.append("version must be a whole number from 1")
    topics = bank.get("topics")
    if not isinstance(topics, list) or not 4 <= len(topics) <= 6 or len(set(topics)) != len(topics):
        p.append("needs 4–6 different topics")
        topics = topics if isinstance(topics, list) else []
    extra_langs = [x for x in role["langs"] if x != "en"]
    simple = role["group"] != "tech"
    qs = bank.get("questions") or []
    existing = bank.get("existing") or {}
    h3 = h3_questions(role["test"]) if role["existing"] else []
    if role["existing"]:
        texts = {x["q"] for x in h3}
        for t in texts - set(existing):
            p.append(f"existing: H3 question has no topic: {t[:60]!r}")
        for t, v in existing.items():
            if t not in texts:
                p.append(f"existing: not an H3 question of this test: {t[:60]!r}")
                continue
            if v.get("topic") not in topics:
                p.append(f"existing: {t[:40]!r}: unknown topic {v.get('topic')!r}")
            n = len(next(x["options"] for x in h3 if x["q"] == t))
            for lang in extra_langs:
                _translation(f"existing {t[:40]!r}", lang, v.get(lang), n, p)
    elif existing:
        p.append("existing: only the 18 H3 tests have existing questions")
    ids: set[str] = set()
    seen: list[str] = [x["q"] for x in h3]
    positions: Counter[int] = Counter()
    longest = 0
    diff: Counter[str] = Counter(x["difficulty"] for x in h3)
    per_topic: Counter[str] = Counter(v.get("topic") for v in existing.values())
    for i, q in enumerate(qs):
        w = f"question {q.get('id') or i}"
        if not isinstance(q.get("id"), str) or not q["id"].startswith(f"{slug}-") or q["id"] in ids:
            p.append(f"{w}: id must be unique and start with '{slug}-'")
        ids.add(q.get("id"))
        if q.get("topic") not in topics:
            p.append(f"{w}: unknown topic {q.get('topic')!r}")
        per_topic[q.get("topic")] += 1
        if q.get("difficulty") not in MIN_BY_DIFFICULTY:
            p.append(f"{w}: difficulty must be easy, medium or hard")
        diff[q.get("difficulty")] += 1
        if q.get("kind") not in ("mcq", "scenario"):
            p.append(f"{w}: kind must be mcq or scenario")
        text = q.get("q")
        if not isinstance(text, str) or not 10 <= len(text) <= 400:
            p.append(f"{w}: the question needs 10–400 characters")
            continue
        _opts(w, q.get("options"), (4,), q.get("answer"), p)
        opts, ans = q.get("options") or [], q.get("answer")
        if not (isinstance(ans, int) and 0 <= ans < len(opts) == 4):
            continue
        positions[ans] += 1
        right = opts[ans]
        if len(norm(right)) >= 6 and norm(right) in norm(text):
            p.append(f"{w}: the right answer is written in the question")
        lens = [len(o) for o in opts]
        if lens[ans] == max(lens) and lens.count(max(lens)) == 1 and lens[ans] > 1.6 * sorted(lens)[-2]:
            longest += 1
        for other in seen:
            if norm(other) == norm(text) or similar(other, text) >= 0.85:
                p.append(f"{w}: same as another question: {other[:60]!r}")
                break
        seen.append(text)
        if simple:
            limit = 260 if q.get("kind") == "scenario" else 200
            sentences = [s for s in re.split(r"[.?!]+", text) if s.strip()]
            if len(text) > limit or max((len(s.split()) for s in sentences), default=0) > 25:
                p.append(f"{w}: too long for simple reading (≤{limit} characters, ≤25 words a sentence)")
        for lang in extra_langs:
            _translation(w, lang, q.get(lang), 4, p)
    total = len(qs) + len(h3)
    if total < MIN_QUESTIONS:
        p.append(f"needs at least {MIN_QUESTIONS} questions, has {total}")
    for d, n in MIN_BY_DIFFICULTY.items():
        if diff[d] < n:
            p.append(f"needs at least {n} {d} questions (for the experience bands), has {diff[d]}")
    for t in topics:
        if per_topic[t] < MIN_PER_TOPIC:
            p.append(f"topic {t!r} needs at least {MIN_PER_TOPIC} questions, has {per_topic[t]}")
    n = sum(positions.values())
    if n >= 12:
        for k in range(4):
            if not 0.15 <= positions[k] / n <= 0.35:
                p.append(f"answer positions are unbalanced: option {k + 1} is right in {positions[k]} of {n}")
    if n and longest / n > 0.25:
        p.append(f"the right option is clearly the longest in {longest} of {n} questions (a giveaway)")
    p.extend(_task(bank.get("task"), role))
    return p


def _task(t: Any, role: Role) -> list[str]:
    p: list[str] = []
    if not isinstance(t, dict):
        return ["task: missing"]
    if t.get("type") != role["task"]:
        p.append(f"task: type must be {role['task']!r} for this role")
    for k, lo, hi in (("title", 5, 120), ("brief", 40, 1500)):
        if not isinstance(t.get(k), str) or not lo <= len(t[k]) <= hi:
            p.append(f"task: {k} needs {lo}–{hi} characters")
    if not isinstance(t.get("minutes"), int) or not 5 <= t["minutes"] <= 30:
        p.append("task: minutes must be 5–30")
    if "material" in t and (not isinstance(t["material"], str) or len(t["material"]) > 3000):
        p.append("task: material must be text up to 3000 characters")
    kp = t.get("key_points", [])
    if not isinstance(kp, list) or len(kp) > 10 or not all(isinstance(x, str) and 3 <= len(x) <= 200 for x in kp):
        p.append("task: key_points must be up to 10 short strings (what a good answer covers)")
    rubric = t.get("rubric")
    if not isinstance(rubric, list) or not 3 <= len(rubric) <= 5:
        p.append("task: the rubric needs 3–5 criteria")
    else:
        keys = [c.get("key") for c in rubric]
        if len(set(keys)) != len(keys) or not all(
            isinstance(k, str) and re.fullmatch(r"[a-z_]{2,30}", k) for k in keys
        ):
            p.append("task: rubric keys must be different lower_case words")
        for c in rubric:
            if not isinstance(c.get("label"), str) or not isinstance(c.get("guide"), str) or len(c["guide"]) < 20:
                p.append(f"task: rubric {c.get('key')!r} needs a label and a guide (what 0 and 5 look like)")
    if role["task"] == "proof":
        sit = t.get("situations")
        if not isinstance(sit, list) or len(sit) < 6:
            p.append("task: a proof task needs at least 6 situations")
        else:
            for i, s in enumerate(sit):
                _opts(f"task situation {i + 1}", s.get("options"), (3, 4), s.get("answer"), p)
                if not isinstance(s.get("q"), str) or len(s["q"]) < 10:
                    p.append(f"task situation {i + 1}: needs a question")
                for lang in [x for x in role["langs"] if x != "en"]:
                    _translation(f"task situation {i + 1}", lang, s.get(lang), len(s.get("options") or []), p)
    return p


def load(slug: str) -> dict[str, Any] | None:
    f = BANKS / f"{slug}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


def main(argv: list[str]) -> int:
    slugs = argv or [r["slug"] for r in ROLES]
    bad = 0
    for slug in slugs:
        role = BY_SLUG.get(slug)
        bank = load(slug) if role else None
        if bank is None:
            print(f"{slug}: no bank file" if role else f"{slug}: not a role")
            bad += 1
            continue
        probs = validate(bank, role)
        n = len(bank.get("questions") or []) + (len(h3_questions(role["test"])) if role["existing"] else 0)
        print(f"{slug}: {'OK' if not probs else f'{len(probs)} problems'} ({n} questions)")
        for x in probs[:40]:
            print(f"  - {x}")
        bad += bool(probs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
