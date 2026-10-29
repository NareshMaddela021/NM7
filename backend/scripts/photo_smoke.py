"""Live check of the Snap photos reader against the real Claude API. Not run in CI; costs a few cents.

    cd backend
    ANTHROPIC_API_KEY=... uv run python scripts/photo_smoke.py               # a tiny blank test image
    ANTHROPIC_API_KEY=... uv run python scripts/photo_smoke.py letter.jpg    # one of your own photos

For each model (claude-haiku-5-5, then claude-sonnet-5-5) it says whether the schema is accepted as a grammar
(strict) and whether a read works with it, and the same without the grammar (loose). It prints field names and
counts only - never the key, and never the values read from the photo.
"""

import asyncio
import base64
import logging
import os
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import anthropic  # noqa: E402

from app.core import claude  # noqa: E402
from app.photos import reader  # noqa: E402
from app.photos.router import _kind  # noqa: E402

MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"]


def blank_png(size: int = 64) -> bytes:
    """A plain white PNG (no Pillow needed)."""
    row = b"\x00" + b"\xff\xff\xff" * size
    raw = zlib.compress(row * size)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


def summary(out: dict) -> str:
    filled = [k for k, v in out["personal"].items() if v["value"]]
    lists = {k: len(out[k]) for k in ("experience", "skills", "certifications", "education", "languages")}
    kinds = [p["kind"] for p in out["photos"]]
    return f"photos={kinds} personal fields={filled} headline={'yes' if out['headline'] else 'no'} {lists}"


async def main(raw: bytes) -> int:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        print("Set ANTHROPIC_API_KEY first.")
        return 2
    kind = _kind(raw)
    if kind not in ("image/jpeg", "image/png", "image/webp"):
        print("Use a JPG, PNG or WebP photo.")
        return 2
    content = reader.content_for([(kind, base64.b64encode(raw).decode())])
    ok = True
    for model in MODELS:
        for strict in (True, False):
            mode = "strict (schema as grammar)" if strict else "loose (schema in prompt)"
            try:
                out = reader.check(
                    await claude.ask(
                        "photo reader",
                        model,
                        content,
                        reader.SCHEMA,
                        max_tokens=16000,
                        effort="medium",
                        timeout_s=reader.TIMEOUT,
                        retries=reader.RETRIES,
                        modes=(strict,),
                    )
                )
                print(f"OK    {model:20} {mode:28} {summary(out)}")
            except reader.GrammarTooLarge:
                print(f"NO    {model:20} {mode:28} grammar too large for this model")
            except reader.ReadFailed as e:
                # the request was accepted; the answer wasn't usable (a blank test image reads as "empty")
                print(f"READ  {model:20} {mode:28} accepted, answer: {e.reason}")
            except anthropic.APIError as e:
                ok = False
                print(f"FAIL  {model:20} {mode:28} {reader.error_kind(e)}{reader.error_detail(e)}")
    # 0 = every request was accepted (a "grammar too large" is handled by the loose mode); 1 = an API error
    return 0 if ok else 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    photo = Path(sys.argv[1]).read_bytes() if len(sys.argv) > 1 else blank_png()
    raise SystemExit(asyncio.run(main(photo)))
