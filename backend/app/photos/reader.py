"""Reads resume details from photos with the Claude API (images in, strict JSON out).

Images stay in memory for the one request; nothing about them, and nothing the model returns, is logged.
Tests replace `call_model`.
"""

import json
import logging
import re
from typing import Any

import anthropic

from app.core.config import get_settings

CONF = {"type": "string", "enum": ["high", "low"]}


def _field() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"value": {"type": "string"}, "confidence": CONF, "fromId": {"type": "boolean"}},
        "required": ["value", "confidence", "fromId"],
        "additionalProperties": False,
    }


def _obj(props: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


STR = {"type": "string"}
SCHEMA = _obj(
    {
        "photos": {
            "type": "array",
            "items": _obj(
                {
                    "index": {"type": "integer"},
                    "kind": {
                        "type": "string",
                        "enum": [
                            "id_card",
                            "work_document",
                            "salary_slip",
                            "certificate",
                            "marksheet",
                            "handwritten_note",
                            "resume",
                            "other",
                        ],
                    },
                    "readable": {"type": "boolean"},
                }
            ),
        },
        "personal": _obj(
            {k: _field() for k in ("name", "city", "state", "address", "dob", "gender", "guardian", "phone", "email")}
        ),
        "headline": STR,
        "experience": {
            "type": "array",
            "items": _obj(
                {
                    "role": STR,
                    "company": STR,
                    "from": STR,
                    "to": STR,
                    "lines": {"type": "array", "items": STR},
                    "confidence": CONF,
                }
            ),
        },
        "skills": {"type": "array", "items": _obj({"value": STR, "confidence": CONF})},
        "certifications": {
            "type": "array",
            "items": _obj({"name": STR, "issuer": STR, "year": STR, "confidence": CONF}),
        },
        "education": {
            "type": "array",
            "items": _obj({"degree": STR, "institution": STR, "year": STR, "grade": STR, "confidence": CONF}),
        },
        "languages": {"type": "array", "items": _obj({"value": STR, "confidence": CONF})},
    }
)

PROMPT = """These photos were taken by a job seeker in India to build a resume, often someone who finds typing hard
(a driver, electrician, delivery rider, helper or shop worker). The photos may be ID cards, experience letters,
salary slips, company ID cards, ITI or training certificates, marksheets, a handwritten note or an old resume.
Text may be handwritten and in any Indian language (Hindi, Telugu, Tamil, Kannada, Marathi, Bengali, Gujarati,
Malayalam, Odia, Punjabi, Urdu…). Read everything you can and answer ONLY in English.

Fill the JSON schema:
- photos: one entry per photo, in the order given (index 0, 1, …): what kind it is, and readable=false when it is
  too blurry, dark, cut off or not a document.
- personal: name, city, state, full address, date of birth (DD/MM/YYYY), gender, father's or husband's name
  (guardian), phone and email. fromId=true when the value came from an ID card. Use "" when not found.
- headline: a short job title for the person, e.g. "Light Commercial Vehicle Driver" ("" if unclear).
- experience: each job with role, company, from, to (month and year or year; "Present" if ongoing) and 1-3
  simple, strong English lines with real facts from the photos, e.g. "Drove light commercial vehicles for 4 years
  across Hyderabad with no accidents". Do not invent numbers or facts.
- skills: practical skills, tools and licences, e.g. "LMV driving licence", "HMV driving licence", "Wiring and
  fault finding", "Two-wheeler delivery", "Billing and cash handling".
- certifications, education (empty is fine), languages the person speaks or writes.
- confidence: "low" for anything you are unsure of or had to guess from unclear writing; otherwise "high".

Strict privacy rules, no exceptions:
- NEVER output any identity or account number: Aadhaar number (including masked forms like XXXX XXXX 1234),
  Aadhaar VID, PAN, voter ID (EPIC), driving licence number, passport number, ration card number, bank account
  number or IFSC, UAN/PF/ESI number or employee ID. Leave them out entirely - not even in other fields.
- Ignore QR codes, barcodes, signatures and the face photo.
- Do not describe the person's appearance.
"""


HTTP_CLIENT = None  # tests put a mock transport here; production uses the SDK's own client

# If the configured model's answer is unusable (declined, cut off, not JSON, or empty), the photos are read once more
# with this model, as part of the same attempt.
FALLBACK_MODEL = "claude-sonnet-5-5"
# Models that take Anthropic's server-side refusal fallback (`fallbacks: "default"`). Claude Haiku 5.5 has none -
# the parameter must not be sent to it.
SERVER_FALLBACK = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}
TIMEOUT = 75  # seconds per try
RETRIES = 1  # the SDK retries timeouts, 429 and 5xx once

log = logging.getLogger("nm7.photos")


def error_kind(e: BaseException) -> str:
    """A short label for the logs - never the message, the content or the key."""
    if isinstance(e, ReadFailed):
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


def _params(model: str) -> dict[str, Any]:
    """What this model accepts: the refusal fallback only where Anthropic offers it."""
    if model in SERVER_FALLBACK:
        return {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    return {}


def _empty(out: Any) -> bool:
    """Nothing usable came back: not the expected object, or every field blank."""
    if not isinstance(out, dict) or not isinstance(out.get("photos"), list):
        return True
    personal = out.get("personal") or {}
    has_personal = any(isinstance(v, dict) and str(v.get("value", "")).strip() for v in personal.values())
    lists = ("experience", "skills", "certifications", "education", "languages")
    return not (has_personal or str(out.get("headline", "")).strip() or any(out.get(k) for k in lists))


async def _read(client: anthropic.AsyncAnthropic, model: str, content: list[dict[str, Any]]) -> dict[str, Any]:
    response = await client.beta.messages.create(
        model=model,
        max_tokens=16000,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": content}],
        **_params(model),
    )
    if response.stop_reason == "refusal":
        raise ReadFailed("refused")
    if response.stop_reason == "max_tokens":
        raise ReadFailed("too_long")
    # read by type: the answer may follow thinking blocks
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        out = json.loads(text)
    except ValueError as e:
        raise ReadFailed("bad_json") from e
    if _empty(out):
        raise ReadFailed("empty")
    return out


async def call_model(images: list[tuple[str, str]]) -> dict[str, Any]:
    """images: [(media_type, base64 data)]. Returns the parsed JSON (not yet scrubbed).

    Raises ReadFailed when neither model gave usable data, or the SDK's APIError (logged by type only)."""
    s = get_settings()
    extra = {"http_client": HTTP_CLIENT} if HTTP_CLIENT is not None else {}
    client = anthropic.AsyncAnthropic(api_key=s.anthropic_api_key, max_retries=RETRIES, timeout=TIMEOUT, **extra)
    content: list[dict[str, Any]] = []
    for i, (media_type, data) in enumerate(images):
        content.append({"type": "text", "text": f"Photo {i}:"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}})
    content.append({"type": "text", "text": PROMPT})
    models = [s.anthropic_model] + ([FALLBACK_MODEL] if s.anthropic_model != FALLBACK_MODEL else [])
    for n, model in enumerate(models):
        try:
            out = await _read(client, model, content)
        except ReadFailed as e:
            last = n == len(models) - 1
            log.warning("photo reader: %s on %s%s", e.reason, model, "" if last else f", trying {models[n + 1]}")
            if last:
                raise
            continue
        except anthropic.APIError as e:
            log.warning("photo reader: %s on %s%s", error_kind(e), model, error_detail(e))
            raise
        if n:
            log.info("photo reader: read with fallback %s", model)
        return out
    raise ReadFailed("no_model")  # not reached


class ReadFailed(Exception):
    """The model answered but not with usable data (refused, cut off, not JSON, empty)."""

    def __init__(self, reason: str = "unusable"):
        super().__init__(reason)
        self.reason = reason
