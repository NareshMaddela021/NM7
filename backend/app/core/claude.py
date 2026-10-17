"""The Claude API, shared by Snap photos (photos/reader.py) and the summary writer (summary/writer.py).

- one client factory, with the SDK's own retries and a per-feature timeout;
- the server-side refusal fallback only for the models that take it (Claude Haiku 5.5 has none);
- "grammar too large": a model that can't compile a structured-output schema is remembered and read in the loose
  mode (the schema in the prompt, the answer checked here) from then on;
- logging by error type and Anthropic's own message, never the prompt, the content or the key.
"""

import json
import logging
import re
from typing import Any

import anthropic

from app.core.config import get_settings

FALLBACK_MODEL = "claude-sonnet-5-5"  # an unusable answer from the configured model is read once more here
# Models that take Anthropic's server-side refusal fallback (`fallbacks: "default"`). Claude Haiku 5.5 has none -
# the parameter must not be sent to it.
SERVER_FALLBACK = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}

log = logging.getLogger("nm7.claude")

# "The compiled grammar is too large…" / "Schema is too complex for compilation": the model can't take the schema as
# a grammar. Remembered per model and feature (until the server restarts) so later calls go straight to the loose mode.
_GRAMMAR = re.compile(r"grammar is too large|too complex for compilation", re.IGNORECASE)
NO_GRAMMAR: set[str] = set()


class GrammarTooLarge(Exception):
    pass


class Unusable(Exception):
    """The model answered but not with usable data (refused, cut off, not JSON, invalid, empty)."""

    def __init__(self, reason: str = "unusable"):
        super().__init__(reason)
        self.reason = reason


def grammar_too_large(e: anthropic.APIError) -> bool:
    if not isinstance(e, anthropic.BadRequestError):
        return False
    err = e.body.get("error") if isinstance(e.body, dict) else None
    return bool(_GRAMMAR.search(str(err.get("message") if isinstance(err, dict) else e.message)))


def error_kind(e: BaseException) -> str:
    """A short label for the logs - never the message, the content or the key."""
    if isinstance(e, Unusable):
        return e.reason
    if isinstance(e, anthropic.AuthenticationError):
        return "auth_error"  # wrong or revoked ANTHROPIC_API_KEY
    if isinstance(e, anthropic.PermissionDeniedError):
        return "permission_denied"
    if isinstance(e, anthropic.RateLimitError):
        return "rate_limited"  # also: out of credit / spend limit reached
    if isinstance(e, anthropic.BadRequestError):
        return "bad_request"
    if isinstance(e, anthropic.NotFoundError):
        return "model_not_found"
    if isinstance(e, anthropic.APITimeoutError):
        return "timeout"
    if isinstance(e, anthropic.APIConnectionError):
        return "connection_error"
    if isinstance(e, anthropic.APIStatusError):
        return f"api_error_{e.status_code}"
    return type(e).__name__


_KEY = re.compile(r"sk-ant-[A-Za-z0-9_\-]*")
_BLOB = re.compile(r"[A-Za-z0-9+/=]{80,}")  # anything that looks like base64 data


def error_detail(e: BaseException) -> str:
    """Anthropic's own error type, message and request id - safe to log (the API's error message never echoes the
    prompt, the photos or the key); key-like and base64-like strings are removed anyway, and it is kept short."""
    if not isinstance(e, anthropic.APIStatusError):
        return ""
    body = e.body if isinstance(e.body, dict) else {}
    err = body.get("error") if isinstance(body.get("error"), dict) else {}
    message = str(err.get("message") or "")
    message = _BLOB.sub("[data]", _KEY.sub("[key]", " ".join(message.split())))[:300]
    request_id = e.request_id or body.get("request_id") or "-"
    return f" (type={e.type or err.get('type') or '-'}, request_id={request_id}, message={message!r})"


def params(model: str) -> dict[str, Any]:
    """What this model accepts: the refusal fallback only where Anthropic offers it."""
    if model in SERVER_FALLBACK:
        return {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    return {}


def client(timeout_s: float, retries: int, http_client: Any = None) -> anthropic.AsyncAnthropic:
    extra = {"http_client": http_client} if http_client is not None else {}
    return anthropic.AsyncAnthropic(
        api_key=get_settings().anthropic_api_key, max_retries=retries, timeout=timeout_s, **extra
    )


def models() -> list[str]:
    """The configured model, then the fallback model (once)."""
    m = get_settings().anthropic_model
    return [m] + ([FALLBACK_MODEL] if m != FALLBACK_MODEL else [])


def loose_suffix(schema: dict[str, Any]) -> str:
    """For the loose mode: the schema asked for in the prompt instead of enforced by the API."""
    return (
        "\nReply with ONE JSON object and nothing else (no code fence, no text before or after), with exactly these "
        "keys and types:\n" + json.dumps(schema, separators=(",", ":"))
    )


def answer_text(response: Any) -> str:
    """The answer, read by block type (it may follow thinking blocks); raises Unusable for a refusal or a cut-off."""
    if response.stop_reason == "refusal":
        raise Unusable("refused")
    if response.stop_reason == "max_tokens":
        raise Unusable("too_long")
    return next((b.text for b in response.content if b.type == "text"), "")


def parse_json(text: str, strict: bool) -> Any:
    """Strict: the whole answer is JSON. Loose: the outermost {...} (a code fence or a stray sentence is ignored)."""
    if not strict:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise Unusable("bad_json")
        text = text[start : end + 1]
    try:
        return json.loads(text)
    except ValueError as e:
        raise Unusable("bad_json") from e


async def ask(
    feature: str,
    model: str,
    content: list[dict[str, Any]],
    schema: dict[str, Any],
    *,
    max_tokens: int,
    effort: str,
    timeout_s: float,
    retries: int,
    http_client: Any = None,
    modes: tuple[bool, ...] | None = None,
) -> Any:
    """One structured answer from `model`: strict first (the schema as a grammar); if this model can't compile it,
    the loose mode on the same model. `modes` pins the mode(s) to try (the smoke scripts). Returns the parsed JSON
    (not yet checked). Raises Unusable or the SDK's APIError."""
    c = client(timeout_s, retries, http_client)
    key = f"{feature}:{model}"
    for strict in modes or ((True, False) if key not in NO_GRAMMAR else (False,)):
        output_config: dict[str, Any] = {"effort": effort}
        if strict:
            output_config["format"] = {"type": "json_schema", "schema": schema}
            sent = content
        else:
            sent = [*content[:-1], {"type": "text", "text": content[-1]["text"] + loose_suffix(schema)}]
        try:
            response = await c.beta.messages.create(
                model=model,
                max_tokens=max_tokens,
                output_config=output_config,
                messages=[{"role": "user", "content": sent}],
                **params(model),
            )
        except anthropic.APIError as e:
            if strict and grammar_too_large(e):
                if modes:
                    raise GrammarTooLarge from e
                NO_GRAMMAR.add(key)
                log.warning("%s: grammar_too_large on %s, reading without the schema grammar", feature, model)
                continue
            raise
        return parse_json(answer_text(response), strict)
    raise Unusable("no_mode")  # not reached


async def ask_models(feature: str, content, schema, check, *, stats=None, **opts) -> Any:
    """`ask` on the configured model, then once on the fallback model when the answer is unusable (`check` raises
    Unusable). API errors are logged by type and Anthropic's message, then raised. `stats` gets model / fallback."""
    ms = models()
    for n, model in enumerate(ms):
        last = n == len(ms) - 1
        try:
            out = check(await ask(feature, model, content, schema, **opts))
        except Unusable as e:
            log.warning("%s: %s on %s%s", feature, e.reason, model, "" if last else f", trying {ms[n + 1]}")
            if last:
                raise
            continue
        except anthropic.APIError as e:
            log.warning("%s: %s on %s%s", feature, error_kind(e), model, error_detail(e))
            raise
        if n:
            log.info("%s: answered by fallback %s", feature, model)
        if stats is not None:
            stats.update(model=model, fallback=n > 0)
        return out
    raise Unusable("no_model")  # not reached
