# ruff: noqa: E501  (dense docstrings)
"""The face-check provider interface, the test provider and the registry.

A provider answers five questions for one candidate, each from photos held only in memory:
  read_id(image)                    what kind of card is this (driving licence, PAN, Aadhaar → refused), is there a face
  liveness(frames, challenge)       a live person in front of the camera (2–3 frames around a short prompt)
  match(selfie, id_image)           the selfie and the card photo are the same face (a score 0–100)
  enroll(uid, selfie) → reference   a face reference for the joining-day check (the provider keeps the face data; Nm7
                                    keeps only this reference, encrypted)
  same_person(uid, reference, selfie)  the joining-day selfie is the face of that reference (a score 0–100)
  forget(reference)                 the provider deletes its face data (consent taken back, retention over)

Keys come from app/core/config.py and are never returned by any API (Admin only sees "set / not set").
"""

import re
from dataclasses import dataclass
from typing import Protocol

from app.core.security import keyed_hash

CHALLENGES = {
    "turn_left": "Slowly turn your head to your left, then look back at the camera.",
    "turn_right": "Slowly turn your head to your right, then look back at the camera.",
    "smile": "Give us a big smile.",
}


@dataclass
class IdRead:
    kind: str  # "dl" | "pan" | "aadhaar" | "unknown"
    has_face: bool = True
    vendor_ref: str = ""


@dataclass
class Score:
    score: float  # 0–100
    reason: str = ""  # plain words when it is low (shown to the candidate and the reviewer)
    vendor_ref: str = ""


class Provider(Protocol):
    key: str
    label: str
    test: bool

    def keys(self) -> dict[str, bool]: ...

    def ready(self) -> bool: ...

    async def read_id(self, image: bytes, *, hint: str = "") -> IdRead: ...

    async def liveness(self, frames: list[bytes], challenge: str, *, hint: str = "") -> Score: ...

    async def match(self, selfie: bytes, id_image: bytes, *, hint: str = "") -> Score: ...

    async def enroll(self, uid: str, selfie: bytes, *, hint: str = "") -> str: ...

    async def same_person(self, uid: str, reference: str, selfie: bytes, *, hint: str = "") -> Score: ...

    async def forget(self, reference: str) -> None: ...


# --- the test provider -------------------------------------------------------------------------------------------------

AADHAAR_BYTES = re.compile(rb"aadhaar|aadhar|uidai|\xe0\xa4\x86\xe0\xa4\xa7\xe0\xa4\xbe\xe0\xa4\xb0", re.I)  # "आधार"
FACE_MARK = re.compile(rb"MOCKFACE:([A-Za-z0-9_-]{1,32})")


def _face_key(b: bytes, hint: str) -> str:
    m = FACE_MARK.search(b)
    if m:
        return m[1].decode()
    return "other" if "otherface" in (hint or "").lower() else "self"


class Mock:
    """Deterministic, from the bytes and the profile name only (no network). Markers for the tests and the demo:
      a frame with b"MOCK:NOLIVE", or a profile name with "nolive"        → liveness fails
      an ID / frame with b"MOCK:NOMATCH", or a name with "nomatch"        → the faces don't match
      an ID with b"MOCK:NOFACE"                                            → no face found on the card
      an ID with "AADHAAR" / "UIDAI" / "आधार" in its bytes                 → read as an Aadhaar card (refused)
      b"MOCKFACE:<key>" in a selfie, or a name with "otherface"           → a different face (continuity fails)
    Real photos without markers (the browser's camera) pass."""

    key = "mock"
    label = "Test provider (no real face check)"
    test = True

    def keys(self) -> dict[str, bool]:
        return {}

    def ready(self) -> bool:
        return True

    async def read_id(self, image: bytes, *, hint: str = "") -> IdRead:
        if AADHAAR_BYTES.search(image):
            return IdRead("aadhaar", True)
        return IdRead("unknown", b"MOCK:NOFACE" not in image, "mock-id")

    async def liveness(self, frames: list[bytes], challenge: str, *, hint: str = "") -> Score:
        if "nolive" in (hint or "").lower() or any(b"MOCK:NOLIVE" in f for f in frames):
            return Score(
                14, "We couldn’t see the movement we asked for, or the camera saw a photo or a screen.", "mock-live"
            )
        return Score(97, "", "mock-live")

    async def match(self, selfie: bytes, id_image: bytes, *, hint: str = "") -> Score:
        if b"MOCK:NOFACE" in id_image:
            return Score(0, "We couldn’t find a face on the card photo.", "mock-match")
        if "nomatch" in (hint or "").lower() or b"MOCK:NOMATCH" in id_image or b"MOCK:NOMATCH" in selfie:
            return Score(31, "The selfie and the photo on the card don’t look like the same person.", "mock-match")
        return Score(96, "", "mock-match")

    async def enroll(self, uid: str, selfie: bytes, *, hint: str = "") -> str:
        return "mock:" + keyed_hash("mock-face", uid, _face_key(selfie, hint))[:32]

    async def same_person(self, uid: str, reference: str, selfie: bytes, *, hint: str = "") -> Score:
        if reference == "mock:" + keyed_hash("mock-face", uid, _face_key(selfie, hint))[:32]:
            return Score(95, "", "mock-same")
        return Score(22, "Today’s selfie doesn’t look like the person from the earlier check.", "mock-same")

    async def forget(self, reference: str) -> None:
        return None


# --- the registry ------------------------------------------------------------------------------------------------------


def registry() -> dict[str, Provider]:
    from app.trust.face.rekognition import Rekognition

    return {"mock": Mock(), "rekognition": Rekognition()}


def get(key: str) -> Provider | None:
    return registry().get(key)
