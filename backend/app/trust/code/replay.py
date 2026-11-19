# ruff: noqa: E501  (dense docstrings)
"""Keystroke / code replay: what happened in the code editor ONLY, recorded in the browser in a compact form and sent
with the submission (only with the T1 consent "code_replay"; without it nothing is recorded or stored).

Format (version 1), small on purpose:
  {"v": 1, "start": <the editor text when recording began>, "lang": "python", "truncated": false,
   "events": [[dt_ms, kind, pos, deleted, text], …]}
  dt_ms    milliseconds since the previous event (so idle time compresses well)
  kind     "e" typed edit · "p" paste (text = what was pasted) · "s" set (a language switch / reset: the whole text) ·
           "b" the editor lost focus · "f" focus came back
  pos      where the edit starts (characters); deleted: how many characters were removed there; text: inserted

Size cap: at most MAX_EVENTS events and MAX_BYTES of JSON; the browser stops recording at the cap (truncated: true) and
the server refuses to keep anything larger (the submission still goes through). The server replays the events to
check they end in the code that was submitted, and works out the numbers itself (it never trusts the browser's).

Integrity (T8, for a person — never an automatic rejection): a paste of BIG_PASTE+ characters ("code_big_paste") and a
solution with almost no typing (at least 80 characters added to the starter with fewer than 20 typed: "code_no_typing").
Without a replay the same two are worked out from the counters the page always sends (the skill-check monitoring the
person already agreed to: characters typed, pasted, the largest paste).
"""

import json
from typing import Any

MAX_EVENTS = 20_000
MAX_BYTES = 200_000
NO_TYPING_ADDED = 80
NO_TYPING_TYPED = 20
KINDS = ("e", "p", "s", "b", "f")


class Bad(ValueError):
    pass


def size_of(replay: dict[str, Any]) -> int:
    return len(json.dumps(replay, separators=(",", ":"), ensure_ascii=False).encode())


def clean(replay: Any) -> dict[str, Any]:
    """The replay as stored (types checked, bounded) or Bad."""
    if not isinstance(replay, dict) or replay.get("v") != 1 or not isinstance(replay.get("events"), list):
        raise Bad("format")
    if size_of(replay) > MAX_BYTES or len(replay["events"]) > MAX_EVENTS:
        raise Bad("too_big")
    start = replay.get("start")
    if not isinstance(start, str):
        raise Bad("format")
    ev = []
    for e in replay["events"]:
        if not (isinstance(e, list) and len(e) == 5 and e[1] in KINDS):
            raise Bad("format")
        dt, kind, pos, dele, text = e
        if not (
            isinstance(dt, int)
            and 0 <= dt <= 86_400_000
            and isinstance(pos, int)
            and pos >= 0
            and isinstance(dele, int)
            and dele >= 0
            and isinstance(text, str)
        ):
            raise Bad("format")
        ev.append([dt, kind, pos, dele, text])
    return {
        "v": 1,
        "start": start,
        "lang": str(replay.get("lang") or "")[:20],
        "truncated": bool(replay.get("truncated")),
        "events": ev,
    }


def apply(text: str, e: list) -> str:
    _, kind, pos, dele, ins = e
    if kind in ("b", "f"):
        return text
    if kind == "s":
        return ins
    pos = min(pos, len(text))
    return text[:pos] + ins + text[pos + dele :]


def final_text(r: dict[str, Any]) -> str:
    t = r["start"]
    for e in r["events"]:
        t = apply(t, e)
    return t


def stats(r: dict[str, Any]) -> dict[str, Any]:
    typed = pasted = biggest = blurs = 0
    pastes, at = [], 0
    for e in r["events"]:
        at += e[0]
        if e[1] == "e":
            typed += len(e[4])
        elif e[1] == "p":
            pasted += len(e[4])
            biggest = max(biggest, len(e[4]))
            if len(pastes) < 200:
                pastes.append({"at": at, "size": len(e[4])})
        elif e[1] == "b":
            blurs += 1
    return {
        "typed": typed,
        "pasted": pasted,
        "largestPaste": biggest,
        "pastes": pastes,
        "blurs": blurs,
        "durationMs": at,
        "events": len(r["events"]),
    }


def flags(st: dict[str, Any], source: str, starter: str, big_paste: int) -> list[str]:
    out = []
    if int(st.get("largestPaste") or 0) >= big_paste:
        out.append("code_big_paste")
    added = len((source or "").strip()) - len((starter or "").strip())
    if added >= NO_TYPING_ADDED and int(st.get("typed") or 0) < NO_TYPING_TYPED:
        out.append("code_no_typing")
    return out
