"""Live check of the summary writer ("Write with AI") against the real Claude API. Not run in CI; costs a few paise
per note (8 notes ≈ Rs 0.50).

    cd backend
    ANTHROPIC_API_KEY=... uv run python scripts/summary_smoke.py   # 8 sample notes, configured model
    ANTHROPIC_MODEL=claude-sonnet-5-5 ANTHROPIC_API_KEY=... uv run python scripts/summary_smoke.py

For each note it prints the three options the model wrote, after the same checks the server runs (length, no contact
details or IDs, no number that isn't in the facts or the note), and the time taken. The facts are made up here; on
the site they come from the person's resume. Nothing from this run is stored.
"""

import asyncio
import logging
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import anthropic  # noqa: E402

from app.core import claude  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.summary import writer  # noqa: E402
from app.summary.router import allowed, clean_facts, trim  # noqa: E402

SAMPLES = [
    (
        {
            "degreeFull": "B.Sc in Computer Science",
            "eduYear": "2024",
            "target": "data analyst",
            "skills": ["Python", "Excel", "SQL"],
            "persona": "fresher_grad",
        },
        "I am Angelin, I completed BSc Computer Science, I like working with data",
    ),
    (
        {
            "eduLabel": "10th class",
            "years": "5 years",
            "role": "driver",
            "target": "driver",
            "strengths": ["safe driving", "route knowledge", "punctuality"],
            "languages": ["Telugu", "Hindi"],
            "persona": "skilled",
        },
        "10th pass, driver with 5 years experience, want cab driver job",
    ),
    (
        {
            "degreeFull": "Intermediate (12th)",
            "years": "2 years",
            "role": "delivery partner",
            "target": "driver",
            "persona": "skilled",
        },
        "Nenu inter chadivanu. 2 samvatsaralu delivery boy ga pani chesanu. Driver job kavali",
    ),
    (
        {
            "degreeFull": "Intermediate (12th)",
            "years": "3 years",
            "role": "electrician",
            "target": "ac technician",
            "strengths": ["wiring", "fault finding", "electrical safety"],
            "persona": "changer",
        },
        "maine 12vi pass kiya hai, 3 saal electrician ka kaam kiya, ab AC technician banna chahta hu",
    ),
    (
        {
            "role": "receptionist",
            "years": "2 years",
            "strengths": ["front-desk handling", "phone etiquette"],
            "persona": "returning",
        },
        "housewife returning to work after 6 years break, earlier worked as receptionist for 2 years",
    ),
    (
        {
            "degreeFull": "B.Com",
            "years": "4 years",
            "role": "sales executive",
            "target": "data analyst",
            "skills": ["Excel"],
            "persona": "changer",
        },
        "I want to change my field from sales to data analyst. BCom graduate, 4 yrs sales executive, excel",
    ),
    (
        {
            "degreeFull": "B.Tech in Computer Science",
            "eduYear": "2025",
            "role": "Data Analyst Intern",
            "company": "Northwind Retail",
            "years": "6 months",
            "target": "Data Analyst",
            "skills": ["Python", "SQL", "Power BI"],
            "cert": "Google Data Analytics Certificate",
            "achievement": "Cut weekly reporting from 5 hours to 30 minutes",
            "persona": "fresher_grad",
        },
        "",
    ),
    ({"persona": "unknown"}, "need job"),
]


async def main() -> int:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Set ANTHROPIC_API_KEY first.")
        return 2
    model = get_settings().anthropic_model
    print(f"model: {model} (fallback: {claude.FALLBACK_MODEL})")
    ok = True
    for facts, note in SAMPLES:
        facts = clean_facts(facts)
        print(f"\n--- note: {note or '(none)'}")
        t0 = time.time()
        try:
            options = await writer.call_model(facts, note, "generate", "")
        except claude.Unusable as e:
            ok = False
            print(f"UNUSABLE ({e.reason})")
            continue
        except anthropic.APIError as e:
            ok = False
            print(f"FAIL {claude.error_kind(e)}{claude.error_detail(e)}")
            continue
        for o in options:
            keep = allowed(o["text"], facts, note)
            print(f"{'OK  ' if keep else 'DROP'} {o['style']:13} {trim(o['text'])}")
        print(f"     {time.time() - t0:.1f}s")
    return 0 if ok else 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    raise SystemExit(asyncio.run(main()))
