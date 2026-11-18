# ruff: noqa: E501  (starter code and plain texts)
"""Coding problems: the statement, starter code per language, VISIBLE sample tests and HIDDEN test cases.

Hidden tests (and the reference solution) live only here, in `trust_code_problems`, and in the server-side snapshot of
a started task (`trust_code.problem`). No candidate or company response ever carries them (`public` below is the only
shape that leaves the server for a candidate). Everyone who gets a problem gets the same tests (a started task keeps
the tests it opened with, so an edit never changes a running task).

A problem is offered only when it is active and VALIDATED: its reference solution was run through the sandbox and
passed every sample and hidden test (`validate`). An Admin edit is a new version and must be validated again.

Two problems come with the code (checked in tests/test_trust_t14.py against the test sandbox): "Sum of the even numbers"
(Python, Java, QA, data science) and "The most frequent word" (front-end, full-stack, mobile). Admin adds more.
"""

from typing import Any

from app.core.db import TRUST_CODE_PROBLEMS
from app.core.time import now
from app.trust.code.providers import LANGUAGES

MAX_HIDDEN = 30
MIN_HIDDEN = 3
MAX_SAMPLES = 5
MAX_IO = 10_000  # characters of stdin / expected output per test
MAX_SOURCE = 20_000

_SUM_STATEMENT = (
    "A shop records the bill amounts of one day. Print the sum of the amounts that are EVEN numbers.\n\n"
    "Input: the first line has n (1 ≤ n ≤ 100000). The second line has n integers separated by spaces "
    "(each between -10^9 and 10^9).\nOutput: one line with the sum of the even integers (0 if there are none).\n\n"
    "Read from standard input and print to standard output."
)
_WORD_STATEMENT = (
    "Find the most frequent word in a customer review.\n\n"
    "Input: one line of text (at most 10000 characters). Words are runs of the letters a–z; ignore case, digits and "
    "punctuation.\nOutput: the most frequent word in lower case, a space, and how many times it appears. If several "
    "words appear equally often, print the one that comes first in alphabetical order. If there are no words, print "
    '"none 0".\n\nRead from standard input and print to standard output.'
)

SEEDS: list[dict[str, Any]] = [
    {
        "_id": "sum-even",
        "title": "Sum of the even numbers",
        "statement": _SUM_STATEMENT,
        "skills": ["Python", "Java", "Software testing", "Data science (ML basics)"],
        "minutes": 30,
        "languages": {
            "python": "import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0])\n    nums = list(map(int, data[1:1 + n]))\n    # TODO: print the sum of the even numbers\n\n\nmain()\n",
            "javascript": "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/);\nconst n = Number(data[0]);\nconst nums = data.slice(1, 1 + n).map(Number);\n// TODO: print the sum of the even numbers\n",
            "java": "import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));\n        int n = Integer.parseInt(in.readLine().trim());\n        StringTokenizer st = new StringTokenizer(in.readLine());\n        // TODO: print the sum of the even numbers (use long)\n    }\n}\n",
            "cpp": "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    // TODO: read n numbers and print the sum of the even ones (use long long)\n    return 0;\n}\n",
        },
        "samples": [
            {"name": "Sample 1: a mix", "stdin": "5\n1 2 3 4 5\n", "expected": "6\n"},
            {"name": "Sample 2: no even numbers", "stdin": "3\n1 3 5\n", "expected": "0\n"},
        ],
        "hidden": [
            {"name": "negative numbers", "stdin": "4\n-2 -3 4 7\n", "expected": "2\n"},
            {"name": "one number", "stdin": "1\n8\n", "expected": "8\n"},
            {
                "name": "big numbers (needs 64-bit)",
                "stdin": "3\n1000000000 1000000000 1000000000\n",
                "expected": "3000000000\n",
            },
            {"name": "zeros", "stdin": "3\n0 0 1\n", "expected": "0\n"},
            {"name": "all even", "stdin": "6\n2 4 6 8 10 12\n", "expected": "42\n"},
        ],
        "reference": {
            "language": "python",
            "source": "import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0])\n    nums = list(map(int, data[1:1 + n]))\n    print(sum(x for x in nums if x % 2 == 0))\n\n\nmain()\n",
        },
    },
    {
        "_id": "top-word",
        "title": "The most frequent word",
        "statement": _WORD_STATEMENT,
        "skills": ["Web basics", "Full-stack (MERN)", "Mobile apps (Android / Flutter)"],
        "minutes": 30,
        "languages": {
            "javascript": "const text = require('fs').readFileSync(0, 'utf8');\n// TODO: count the words (letters a-z, ignore case) and print \"word count\"\n",
            "python": 'import sys\n\ntext = sys.stdin.read()\n# TODO: count the words (letters a-z, ignore case) and print "word count"\n',
            "java": 'import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        String text = new String(System.in.readAllBytes());\n        // TODO: count the words (letters a-z, ignore case) and print "word count"\n    }\n}\n',
            "cpp": '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    string text((istreambuf_iterator<char>(cin)), istreambuf_iterator<char>());\n    // TODO: count the words (letters a-z, ignore case) and print "word count"\n    return 0;\n}\n',
        },
        "samples": [
            {"name": "Sample 1: a short review", "stdin": "Good food, good price. Good!\n", "expected": "good 3\n"},
            {"name": "Sample 2: a tie", "stdin": "fast delivery slow app\n", "expected": "app 1\n"},
        ],
        "hidden": [
            {"name": "no words", "stdin": "123 !!! 456\n", "expected": "none 0\n"},
            {"name": "mixed case", "stdin": "Nice NICE nice staff Staff\n", "expected": "nice 3\n"},
            {"name": "digits inside words", "stdin": "abc1abc abc\n", "expected": "abc 3\n"},
            {"name": "tie, alphabetical", "stdin": "zeta beta zeta beta\n", "expected": "beta 2\n"},
        ],
        "reference": {
            "language": "python",
            "source": "import re\nimport sys\nfrom collections import Counter\n\nwords = re.findall(r'[a-z]+', sys.stdin.read().lower())\nif not words:\n    print('none 0')\nelse:\n    c = Counter(words)\n    best = min(c, key=lambda w: (-c[w], w))\n    print(best, c[best])\n",
        },
    },
]


def check(p: dict[str, Any]) -> list[str]:
    """Problems with a problem (Admin's form, the seeds): empty when it can be saved."""
    out = []
    if not str(p.get("title") or "").strip() or len(p.get("title") or "") > 120:
        out.append("A title (at most 120 characters) is needed.")
    if not str(p.get("statement") or "").strip() or len(p.get("statement") or "") > 6000:
        out.append("A problem statement (at most 6000 characters) is needed.")
    langs = p.get("languages") or {}
    if not langs or any(k not in LANGUAGES for k in langs):
        out.append("Pick at least one language from: " + ", ".join(LANGUAGES) + ".")
    if any(len(str(v or "")) > MAX_SOURCE for v in langs.values()):
        out.append("Starter code is too long.")
    s, h = p.get("samples") or [], p.get("hidden") or []
    if not 1 <= len(s) <= MAX_SAMPLES:
        out.append(f"Add 1 to {MAX_SAMPLES} visible sample tests.")
    if not MIN_HIDDEN <= len(h) <= MAX_HIDDEN:
        out.append(f"Add {MIN_HIDDEN} to {MAX_HIDDEN} hidden tests.")
    for t in [*s, *h]:
        if (
            len(str(t.get("stdin") or "")) > MAX_IO
            or len(str(t.get("expected") or "")) > MAX_IO
            or not str(t.get("expected") or "").strip()
        ):
            out.append("Every test needs an expected output, and input / output of at most 10,000 characters.")
            break
    ref = p.get("reference") or {}
    if (
        ref.get("language") not in langs
        or not str(ref.get("source") or "").strip()
        or len(ref.get("source") or "") > MAX_SOURCE
    ):
        out.append("A reference solution in one of the problem's languages is needed (it is run to check the tests).")
    return out


def public(snap: dict[str, Any]) -> dict[str, Any]:
    """What a candidate sees of a problem: never the hidden tests or the reference solution."""
    return {
        "problemId": snap["id"], "title": snap["title"], "statement": snap["statement"],
        "languages": [{"key": k, "label": LANGUAGES[k]["label"], "starter": v} for k, v in snap["languages"].items() if k in LANGUAGES],
        "samples": [{"name": t["name"], "stdin": t["stdin"], "expected": t["expected"]} for t in snap["samples"]],
        "hiddenCount": len(snap["hidden"]),
    }  # fmt: skip


def snapshot(p: dict[str, Any]) -> dict[str, Any]:
    """The server-side copy a started task keeps (so an Admin edit never changes it)."""
    return {"id": p["_id"], "version": int(p.get("version") or 1), "title": p["title"], "statement": p["statement"],
            "languages": dict(p["languages"]), "samples": list(p["samples"]), "hidden": list(p["hidden"])}  # fmt: skip


async def ensure_seeds(db) -> None:
    t = now()
    for s in SEEDS:
        await db[TRUST_CODE_PROBLEMS].update_one(
            {"_id": s["_id"]},
            {"$setOnInsert": {**s, "active": True, "version": 1, "seed": True, "created_at": t, "updated_at": t,
                              "validated": {"ok": True, "by": "seed", "at": t, "passed": len(s["samples"]) + len(s["hidden"]),
                                            "total": len(s["samples"]) + len(s["hidden"]), "note": "Checked in the tests with the test sandbox; press Validate to run it through the chosen sandbox"}}},
            upsert=True,
        )  # fmt: skip


async def for_skill(db, skill: str) -> dict[str, Any] | None:
    """The role's coding problem: the first active, validated one (by title), the same for everyone."""
    await ensure_seeds(db)
    async for p in (
        db[TRUST_CODE_PROBLEMS]
        .find({"skills": skill, "active": True, "validated.ok": True})
        .sort([("title", 1), ("_id", 1)])
        .limit(1)
    ):
        return p
    return None
