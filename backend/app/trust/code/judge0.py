# ruff: noqa: E501  (URLs and field lists)
"""Judge0 CE, the real sandbox (isolated adapter; httpx, no SDK). Each case is one Judge0 submission, sent as one batch:

  POST {JUDGE0_URL}/submissions/batch?base64_encoded=true
       {"submissions": [{source_code, language_id, stdin, expected_output, cpu_time_limit, cpu_extra_time,
                         wall_time_limit, memory_limit (KB), stack_limit (KB), max_processes_and_or_threads,
                         enable_per_process_and_thread_time_limit, enable_per_process_and_thread_memory_limit,
                         max_file_size (KB), enable_network: false, number_of_runs: 1, redirect_stderr_to_stdout: false}, …]}
       → [{"token": …}, …]
  GET  {JUDGE0_URL}/submissions/batch?tokens=a,b&base64_encoded=true&fields=token,stdout,stderr,compile_output,message,status_id,time,memory
       → {"submissions": [{status_id, stdout (base64), …}]}, polled until every status_id ≥ 3 (1 In Queue, 2 Processing)
  GET  {JUDGE0_URL}/about (health)

Headers: on RapidAPI (the default URL) X-RapidAPI-Key + X-RapidAPI-Host; self-hosted: X-Auth-Token (Judge0's
AUTHN_TOKEN) when set. Status ids: 3 Accepted, 4 Wrong Answer (both = "ran": Nm7 compares the output itself),
5 Time Limit Exceeded, 6 Compilation Error, 7–12 Runtime Error (a memory-limit kill shows as a runtime error / SIGKILL),
13 Internal Error (→ ProviderDown, tried again), 14 Exec Format Error (runtime error).

NEEDS VENDOR DOCS CONFIRMATION before going live: the language ids of the chosen instance (GET /languages; CE ids 71
Python 3.8, 63 Node.js 12, 62 Java 13, 54 C++ GCC 9.2, 82 SQLite 3.27 are assumed), that enable_network is honoured
(Judge0 ≥ 1.13 with ALLOW_ENABLE_NETWORK=false on a self-hosted box), the RapidAPI plan's batch size and rate limits,
and the instance's MAX_* limits (a limit above them is refused with 422). docs/trust/T14-vendors.md.
"""

import asyncio
import base64
import logging
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings
from app.trust.code.providers import LANGUAGES, Case, CaseResult, Health, Limits, ProviderDown, cap

log = logging.getLogger("nm7.trust.code.judge0")
TIMEOUT = httpx.Timeout(20.0, connect=5.0)
HTTP_CLIENT: httpx.AsyncClient | None = None  # tests put a client with a mock transport here
POLL_EVERY = 1.0  # seconds between status polls (tests set 0)
POLLS = 30
BATCH_MAX = 20  # Judge0's default MAX_SUBMISSION_BATCH_SIZE
FIELDS = "token,stdout,stderr,compile_output,message,status_id,time,memory"


def _b64(s: str) -> str:
    return base64.b64encode((s or "").encode()).decode()


def _unb64(s: str | None) -> str:
    if not s:
        return ""
    try:
        return base64.b64decode(s).decode("utf-8", "replace")
    except ValueError:
        return ""


def payload(source: str, language: str, case: Case, limits: Limits) -> dict:
    """One Judge0 submission with every limit stated (no network, ever)."""
    return {
        "source_code": _b64(source), "language_id": int(LANGUAGES[language]["judge0"]), "stdin": _b64(case.stdin),
        "expected_output": _b64(case.expected), "cpu_time_limit": limits.cpu_s, "cpu_extra_time": 0.5,
        "wall_time_limit": limits.wall_s, "memory_limit": int(limits.memory_mb) * 1024, "stack_limit": 64_000,
        "max_processes_and_or_threads": int(limits.processes), "enable_per_process_and_thread_time_limit": False,
        "enable_per_process_and_thread_memory_limit": False, "max_file_size": int(limits.output_kb),
        "enable_network": False, "number_of_runs": 1, "redirect_stderr_to_stdout": False,
    }  # fmt: skip


def result_of(sub: dict, limits: Limits) -> CaseResult:
    sid = int((sub.get("status") or {}).get("id") or sub.get("status_id") or 0)
    if sid == 13 or sid < 3:
        raise ProviderDown(f"judge0 status {sid}")
    out, cut = cap(_unb64(sub.get("stdout")), limits.output_kb)
    err = _unb64(sub.get("compile_output")) if sid == 6 else _unb64(sub.get("stderr")) or _unb64(sub.get("message"))
    err, _ = cap(err, 4)
    status = {3: "ran", 4: "ran", 5: "time_limit", 6: "compile_error"}.get(sid, "runtime_error")
    try:
        t = float(sub["time"]) if sub.get("time") is not None else None
    except (TypeError, ValueError):
        t = None
    mem = sub.get("memory")
    if status == "runtime_error" and isinstance(mem, int) and mem >= limits.memory_mb * 1024 * 0.95:
        status = "memory_limit"
    return CaseResult(status, out, err, t, mem if isinstance(mem, int) else None, cut)


class Judge0:
    key = "judge0"
    label = "Judge0 CE (RapidAPI or self-hosted)"
    test = False

    def _rapid(self) -> bool:
        return "rapidapi.com" in (get_settings().judge0_url or "")

    def keys(self) -> dict[str, bool]:
        s = get_settings()
        return {
            "JUDGE0_URL": bool(s.judge0_url),
            "JUDGE0_RAPIDAPI_KEY": bool(s.judge0_rapidapi_key),
            "JUDGE0_AUTH_TOKEN": bool(s.judge0_auth_token),
        }

    def ready(self) -> bool:
        s = get_settings()
        if not s.judge0_url:
            return False
        return bool(s.judge0_rapidapi_key) if self._rapid() else bool(s.judge0_auth_token)

    def headers(self) -> dict[str, str]:
        s = get_settings()
        h = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._rapid():
            h.update(
                {"X-RapidAPI-Key": s.judge0_rapidapi_key, "X-RapidAPI-Host": urlparse(s.judge0_url).hostname or ""}
            )
        elif s.judge0_auth_token:
            h["X-Auth-Token"] = s.judge0_auth_token
        return h

    async def _call(self, client: httpx.AsyncClient, method: str, path: str, **kw) -> httpx.Response:
        url = get_settings().judge0_url.rstrip("/") + path
        try:
            r = await client.request(method, url, headers=self.headers(), **kw)
        except httpx.HTTPError as e:
            raise ProviderDown(type(e).__name__) from None
        if r.status_code in (401, 403):
            log.warning("judge0: the key was refused (%s)", r.status_code)
            raise ProviderDown("auth")
        if r.status_code == 429 or r.status_code >= 500:
            raise ProviderDown(f"status {r.status_code}")
        if r.status_code >= 400:
            raise ProviderDown(f"refused {r.status_code}")  # e.g. 422: a limit above the instance's maximum
        return r

    async def run(self, source: str, language: str, cases: list[Case], limits: Limits) -> list[CaseResult]:
        if not self.ready():
            raise ProviderDown("not configured")
        client = HTTP_CLIENT or httpx.AsyncClient(timeout=TIMEOUT)
        try:
            out: list[CaseResult] = []
            for i in range(0, len(cases), BATCH_MAX):
                chunk = cases[i : i + BATCH_MAX]
                r = await self._call(client, "POST", "/submissions/batch", params={"base64_encoded": "true"},
                                     json={"submissions": [payload(source, language, c, limits) for c in chunk]})  # fmt: skip
                try:
                    tokens = [str(x["token"]) for x in r.json()]
                except (ValueError, KeyError, TypeError):
                    raise ProviderDown("bad answer") from None
                if len(tokens) != len(chunk):
                    raise ProviderDown("bad answer")
                subs: list[dict] = []
                for _ in range(POLLS):
                    g = await self._call(client, "GET", "/submissions/batch",
                                         params={"tokens": ",".join(tokens), "base64_encoded": "true", "fields": FIELDS})  # fmt: skip
                    try:
                        subs = list(g.json()["submissions"])
                    except (ValueError, KeyError, TypeError):
                        raise ProviderDown("bad answer") from None
                    if len(subs) == len(tokens) and all(int(s.get("status_id") or 0) >= 3 for s in subs):
                        break
                    await asyncio.sleep(POLL_EVERY)
                else:
                    raise ProviderDown("still running")
                out.extend(result_of(s, limits) for s in subs)
            return out
        finally:
            if HTTP_CLIENT is None:
                await client.aclose()

    async def health(self) -> Health:
        if not self.ready():
            return Health(False, "Keys not set")
        client = HTTP_CLIENT or httpx.AsyncClient(timeout=TIMEOUT)
        try:
            r = await self._call(client, "GET", "/about")
            j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            return Health(True, f"Judge0 {j.get('version', '')}".strip(), {"version": j.get("version")})
        except ProviderDown as e:
            return Health(False, str(e))
        finally:
            if HTTP_CLIENT is None:
                await client.aclose()
