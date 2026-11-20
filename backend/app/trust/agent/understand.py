"""Reading a candidate's free-text WhatsApp reply: the rules first (texts.rules_intent: Stop / yes / no / a number, in
English, Hindi and Telugu), and only when they can't tell, the AI with a strict schema (counted in ai_quota as
"agent_reply"; no key, the allowance used up or an error → "unclear", and the agent asks again). The prompt holds only
the reply and what the last message asked: never the person's name, phone or anything about them.
"""

import logging
from typing import Any

from app.core import claude
from app.core.config import get_settings
from app.trust.agent.texts import rules_intent

log = logging.getLogger("nm7.trust.agent")

FEATURE = "agent_reply"
TIMEOUT = 8  # seconds: it runs inside the WhatsApp webhook
RETRIES = 0
HTTP_CLIENT = None  # tests put a mock transport here
INTENTS = ("stop", "interested", "not_now", "yes", "no", "slot", "none", "unclear")

SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": list(INTENTS)},
        "slot": {"type": "integer", "minimum": 0, "maximum": 9},
    },
    "required": ["intent", "slot"],
    "additionalProperties": False,
}

ASKED = {
    "interest": "whether they are interested in a job (answers: interested, not_now)",
    "yesno": "a yes/no question about a job (answers: yes, no)",
    "slot": "to pick an interview time by its number (answers: slot with its number, or none)",
}


def check(raw: Any) -> tuple[str, int]:
    if not isinstance(raw, dict) or raw.get("intent") not in INTENTS:
        raise claude.Unusable("bad_intent")
    slot = raw.get("slot")
    if not isinstance(slot, int) or not 0 <= slot <= 9:
        raise claude.Unusable("bad_slot")
    return raw["intent"], slot


def prompt(text: str, expecting: str) -> str:
    return (
        "A job seeker replied on WhatsApp (in English, Hindi, Telugu or a mix, maybe typed in Latin letters). The last "
        f"message asked {ASKED.get(expecting, ASKED['interest'])}. Say what the reply means. Use stop only when they "
        "ask not to be messaged or called any more. Use unclear when it is none of these.\n\n"
        f"Reply: {text[:500]}"
    )


async def call_model(text: str, expecting: str) -> tuple[str, int]:
    return await claude.ask_models(
        FEATURE,
        [{"type": "text", "text": prompt(text, expecting)}],
        SCHEMA,
        check,
        max_tokens=40,
        effort="low",
        timeout_s=TIMEOUT,
        retries=RETRIES,
        http_client=HTTP_CLIENT,
        thinking={"type": "disabled"},
    )


async def intent(db, uid: str, text: str, expecting: str) -> tuple[str, int, str]:
    """(intent, slot, by): by = rules | ai | none."""
    from app.core import ai_quota

    got, slot = rules_intent(text, expecting)
    if got != "unclear":
        return got, slot, "rules"
    if not get_settings().anthropic_api_key or not text.strip():
        return "unclear", 0, "none"
    try:
        await ai_quota.take(db, FEATURE, uid)
    except Exception:  # noqa: BLE001 — the person's or the site's daily AI limit
        return "unclear", 0, "none"
    try:
        got, slot = await call_model(text, expecting)
    except Exception:  # noqa: BLE001 — unusable or an API error: ask again
        log.warning("calling agent: reading a reply with AI failed")
        await ai_quota.note(db, FEATURE, "failed")
        return "unclear", 0, "none"
    if expecting != "slot" and got in ("slot", "none"):
        return "unclear", 0, "ai"
    return got, slot, "ai"
