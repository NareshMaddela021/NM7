# ruff: noqa: E501  (dense docstrings)
"""The speech-assessment provider interface (pronunciation), the test provider and the registry.

A provider gets ONE short voice clip (WAV, 16 kHz mono PCM, at most 20 seconds) held only in memory, with the words the
browser heard (the reference text), and answers how clearly it was pronounced: accuracy 0–100 (plus its own fluency /
completeness when it has them, kept for the record only) and its reference id for the request. Nm7 never sends the
person's name or anything else with the clip. Keys come from app/core/config.py and are never returned by any API
(Admin only sees "set / not set").

  none    "Not measured": pronunciation is left out and the band uses the other three sub-scores (the default on a
          live site until Naresh adds a key).
  mock    deterministic, no network (tests, demo, local): accuracy 88; a clip containing b"MOCK:UNCLEAR" → 45; one
          containing b"MOCK:FAIL" → a provider error.
  azure   Azure AI Speech, Pronunciation Assessment over the short-audio REST API (azure.py).
"""

import hashlib
from dataclasses import dataclass
from typing import Protocol


@dataclass
class Assessment:
    accuracy: float  # 0–100: how closely the sounds match the words (what Nm7 uses, as intelligibility)
    fluency: float | None = None  # the provider's own numbers, kept for the record, never used for the band
    completeness: float | None = None
    ref: str = ""  # the provider's request / result reference
    words: int = 0


class ProviderError(Exception):
    pass


class Provider(Protocol):
    key: str
    label: str
    test: bool

    def keys(self) -> dict[str, bool]: ...

    def ready(self) -> bool: ...

    async def assess(self, audio: bytes, reference: str, *, locale: str = "en-IN") -> Assessment: ...


class NoProvider:
    key = "none"
    label = "None: pronunciation not measured"
    test = False

    def keys(self) -> dict[str, bool]:
        return {}

    def ready(self) -> bool:
        return False

    async def assess(self, audio: bytes, reference: str, *, locale: str = "en-IN") -> Assessment:
        raise ProviderError("not configured")


class Mock:
    key = "mock"
    label = "Test provider (no real speech assessment)"
    test = True

    def keys(self) -> dict[str, bool]:
        return {}

    def ready(self) -> bool:
        return True

    async def assess(self, audio: bytes, reference: str, *, locale: str = "en-IN") -> Assessment:
        if b"MOCK:FAIL" in audio:
            raise ProviderError("mock failure")
        acc = 45.0 if b"MOCK:UNCLEAR" in audio else 88.0
        ref = "mock-" + hashlib.sha256(audio).hexdigest()[:12]
        return Assessment(acc, 80.0, 95.0, ref, len((reference or "").split()))


def registry() -> dict[str, Provider]:
    from app.trust.spoken.azure import Azure

    return {"none": NoProvider(), "mock": Mock(), "azure": Azure()}


def get(key: str) -> Provider | None:
    return registry().get(key)
