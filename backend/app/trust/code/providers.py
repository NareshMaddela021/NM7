# ruff: noqa: E501  (dense docstrings)
"""The code-sandbox provider interface, the deterministic test sandbox and the registry.

Candidates' code NEVER runs on the API server (512 MB, shared with everything else). A provider takes one program, its
language and a batch of test cases (stdin + the expected output) and runs each case in its own isolated sandbox with
the limits Nm7 passes on every call:

  cpu_s / wall_s       CPU and wall-clock seconds per case
  memory_mb            memory per case
  output_kb            the most output read back per case (anything longer is cut and marked)
  network              always False: no network inside the sandbox
  processes            the most processes / threads (no fork bombs)

It answers, per case: a status (ran / time_limit / memory_limit / compile_error / runtime_error), stdout and stderr
(capped), time and memory. Nm7 compares stdout with the expected output itself (provider independent). A provider that
can't be reached, answers 5xx / 429 or says "internal error" raises ProviderDown: the submission stays queued and is
tried again later (no lost work). Keys come from app/core/config.py and are never returned by any API (Admin only sees
"set / not set").

  mock     deterministic, no network, runs nothing (tests, demo, local) — markers below
  judge0   Judge0 CE (RapidAPI or self-hosted on its own VM), judge0.py
"""

from dataclasses import dataclass, field
from typing import Protocol

LANGUAGES: dict[str, dict[str, object]] = {
    # key: label, Judge0 CE language id (needs vendor docs confirmation for the instance's version list), file hint
    "python": {"label": "Python 3", "judge0": 71},
    "javascript": {"label": "JavaScript (Node.js)", "judge0": 63},
    "java": {"label": "Java", "judge0": 62},
    "cpp": {"label": "C++", "judge0": 54},
    "sql": {"label": "SQL (SQLite)", "judge0": 82},
}
STATUSES = ("ran", "time_limit", "memory_limit", "compile_error", "runtime_error")
STATUS_TEXT = {
    "ran": "Ran",
    "time_limit": "Took too long (time limit)",
    "memory_limit": "Used too much memory",
    "compile_error": "Didn’t compile",
    "runtime_error": "Stopped with an error",
}


@dataclass(frozen=True)
class Limits:
    cpu_s: float = 2.0
    wall_s: float = 5.0
    memory_mb: int = 128
    output_kb: int = 64
    processes: int = 30
    network: bool = False  # never True: kept as a field so every call states it


@dataclass
class Case:
    stdin: str
    expected: str = ""


@dataclass
class CaseResult:
    status: str  # one of STATUSES
    stdout: str = ""
    stderr: str = ""
    time_s: float | None = None
    memory_kb: int | None = None
    truncated: bool = False


@dataclass
class Health:
    ok: bool
    detail: str = ""
    extra: dict[str, object] = field(default_factory=dict)


class ProviderDown(Exception):
    """The sandbox can't be reached or failed on its side: keep the work and try again later."""


class Provider(Protocol):
    key: str
    label: str
    test: bool

    def keys(self) -> dict[str, bool]: ...

    def ready(self) -> bool: ...

    async def run(self, source: str, language: str, cases: list[Case], limits: Limits) -> list[CaseResult]: ...

    async def health(self) -> Health: ...


def cap(text: str, kb: int) -> tuple[str, bool]:
    b = (text or "").encode("utf-8", "replace")
    if len(b) <= kb * 1024:
        return text or "", False
    return b[: kb * 1024].decode("utf-8", "ignore"), True


def same_output(got: str, want: str) -> bool:
    """Trailing spaces on each line and trailing blank lines don't matter (as in most judges)."""

    def norm(s: str) -> list[str]:
        lines = [ln.rstrip() for ln in (s or "").replace("\r\n", "\n").split("\n")]
        while lines and not lines[-1]:
            lines.pop()
        return lines

    return norm(got) == norm(want)


# --- the test sandbox ----------------------------------------------------------------------------------------------------


class Mock:
    """Deterministic, runs nothing (no network, never executes the code). Markers in the source:
      MOCK:DOWN        → ProviderDown (the sandbox is unreachable)
      MOCK:TLE / MOCK:MLE / MOCK:CE / MOCK:RTE → that status for every case
      MOCK:FAIL        → every case prints nothing (wrong answer)
      MOCK:PASSN=<k>   → the first k cases of the batch print the expected output, the rest print nothing
      MOCK:BIG         → prints far more than the output cap (cut, marked truncated)
    Otherwise: code that still has the starter's "TODO" prints nothing; any other code prints the expected output."""

    key = "mock"
    label = "Test sandbox (runs nothing; for tests and the demo)"
    test = True

    def keys(self) -> dict[str, bool]:
        return {}

    def ready(self) -> bool:
        return True

    async def health(self) -> Health:
        return Health(True, "Test sandbox")

    async def run(self, source: str, language: str, cases: list[Case], limits: Limits) -> list[CaseResult]:
        import re

        if "MOCK:DOWN" in source:
            raise ProviderDown("mock: down")
        for mark, st in (
            ("MOCK:TLE", "time_limit"),
            ("MOCK:MLE", "memory_limit"),
            ("MOCK:CE", "compile_error"),
            ("MOCK:RTE", "runtime_error"),
        ):
            if mark in source:
                err = {"compile_error": "error: expected ';'", "runtime_error": "Traceback: ZeroDivisionError"}.get(
                    st, ""
                )
                return [CaseResult(st, "", err, limits.wall_s if st == "time_limit" else 0.01, 1024) for _ in cases]
        m = re.search(r"MOCK:PASSN=(\d+)", source)
        n = int(m[1]) if m else (0 if ("MOCK:FAIL" in source or "TODO" in source) else len(cases))
        out = []
        for i, c in enumerate(cases):
            text = ("x" * (limits.output_kb * 1024 * 2)) if "MOCK:BIG" in source else (c.expected if i < n else "")
            text, cut = cap(text, limits.output_kb)
            out.append(CaseResult("ran", text, "", 0.02, 3000, cut))
        return out


def registry() -> dict[str, Provider]:
    from app.trust.code.judge0 import Judge0

    return {"mock": Mock(), "judge0": Judge0()}


def get(key: str) -> Provider | None:
    return registry().get(key)
