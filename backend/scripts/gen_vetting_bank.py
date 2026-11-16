# ruff: noqa: E501
"""Drafts a skill-check question bank with Claude, ONCE per role (never per candidate), then runs the validator.

    cd backend && ANTHROPIC_API_KEY=... uv run python scripts/gen_vetting_bank.py welding [--model claude-opus-5-5]

The draft is written to app/hire/vetting/banks/<slug>.json only when it passes app/hire/vetting/validate.py; otherwise
the problems are printed and the model is asked once more to fix them. A person reads every bank before it ships
(the Telugu / Hindi text is marked "needs native review" in Admin automatically). The rules the model follows are in
docs/vetting/v2/bank-brief.md: original questions only, India context, fair, simple words for non-tech roles,
experience bands, and a practical task with a rubric. Raising "version" in an existing file makes the app load it.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

import anthropic

from app.hire.vetting.roles import BY_SLUG
from app.hire.vetting.validate import BANKS, h3_questions, validate

BRIEF = Path(__file__).resolve().parents[2] / "docs" / "vetting" / "v2" / "bank-brief.md"
FORMAT = (Path(__file__).resolve().parents[1] / "app" / "hire" / "vetting" / "validate.py").read_text().split('"""')[1]


def ask_text(role: dict, extra: str = "") -> str:
    h3 = h3_questions(role["test"]) if role["existing"] else []
    parts = [
        "Write ONE skill-check question bank as a single JSON object (no code fence, no other text).",
        f"Role: {json.dumps(role, ensure_ascii=False)}",
        f"Rules:\n{BRIEF.read_text()}",
        f"File format:\n{FORMAT}",
        f'The existing questions to tag in "existing" (exact text):\n{json.dumps([q["q"] for q in h3], ensure_ascii=False)}'
        if h3
        else "",
        extra,
    ]
    return "\n\n".join(p for p in parts if p)


async def draft(client: anthropic.AsyncAnthropic, model: str, role: dict, extra: str = "") -> dict:
    out = await client.messages.create(
        model=model, max_tokens=32000, messages=[{"role": "user", "content": ask_text(role, extra)}]
    )
    text = next((b.text for b in out.content if b.type == "text"), "")
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start : end + 1])


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--model", default="claude-opus-5-5")
    args = ap.parse_args()
    role = BY_SLUG.get(args.slug)
    if not role:
        print(f"unknown role {args.slug!r}")
        return 1
    client = anthropic.AsyncAnthropic()
    bank = await draft(client, args.model, role)
    problems = validate(bank, role)
    if problems:
        print(f"first draft: {len(problems)} problems, asking for a fix")
        bank = await draft(
            client,
            args.model,
            role,
            "Your previous draft had these problems; fix all of them:\n- " + "\n- ".join(problems[:60]),
        )
        problems = validate(bank, role)
    if problems:
        print("still not valid:\n- " + "\n- ".join(problems[:60]))
        return 1
    (BANKS / f"{args.slug}.json").write_text(json.dumps(bank, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{args.slug}: written ({len(bank['questions'])} new questions). Read it before committing.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
