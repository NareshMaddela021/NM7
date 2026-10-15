"""Reads resume details from photos with the Claude API (images in, strict JSON out).

Images stay in memory for the one request; nothing about them, and nothing the model returns, is logged.
Tests replace `call_model`.
"""

import json
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


async def call_model(images: list[tuple[str, str]]) -> dict[str, Any]:
    """images: [(media_type, base64 data)]. Returns the parsed JSON (not yet scrubbed)."""
    s = get_settings()
    extra = {"http_client": HTTP_CLIENT} if HTTP_CLIENT is not None else {}
    client = anthropic.AsyncAnthropic(api_key=s.anthropic_api_key, max_retries=2, timeout=180, **extra)
    content: list[dict[str, Any]] = []
    for i, (media_type, data) in enumerate(images):
        content.append({"type": "text", "text": f"Photo {i}:"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}})
    content.append({"type": "text", "text": PROMPT})
    response = await client.beta.messages.create(
        model=s.anthropic_model,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # a declined request is re-run on Anthropic's recommended fallback model
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": content}],
    )
    if response.stop_reason == "refusal":
        raise ReadFailed("refused")
    if response.stop_reason == "max_tokens":
        raise ReadFailed("too_long")
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except ValueError as e:
        raise ReadFailed("bad_json") from e


class ReadFailed(Exception):
    """The model answered but not with usable data (refused, cut off, not JSON)."""
