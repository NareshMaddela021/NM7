"""Prints the asuraa.ai / "Asuraa AI" / "AsuraaX" mentions in the older blog articles (left unchanged on nm7.si).

    HYGRAPH_TOKEN=... python -m app.blog.flags

Needs the same read-only HYGRAPH_TOKEN as the API (set it in the shell for one run; never commit or paste it).
"""

import asyncio

from app.blog.legacy import blog


async def main() -> int:
    b = await blog()
    if not b["configured"]:
        print("HYGRAPH_TOKEN is not set: nothing to check.")
        return 1
    if b["error"]:
        print(f"Reading Hygraph failed: {b['error']}")
        return 1
    print(f"{b['found']} published articles read, {len(b['posts'])} shown after removing duplicates.")
    print(f"{len(b['flags'])} asuraa.ai mentions (left as they are):")
    for f in b["flags"]:
        print(f"- {f['url']} [{f['field']}] {f['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
