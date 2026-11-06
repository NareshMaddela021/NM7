"""Safe job posting checks (Phase 2, C3), rules first:

  unfair wording   blocks the job ("male preferred", "age below 25", "young candidates only", "no disabilities", …)
  scam signs       sends the job to Admin review before it goes live ("registration fee", "pay to apply", "contact only
                   on WhatsApp", "guaranteed income", "no interview required", …)
  fresher fit      warns when a fresher / internship job asks for years of experience
  AI check         once per job (when it is first posted, never per view): a fake-job reading; "suspicious" → review

Both phrase lists are in Admin → Settings & prices (site "job_checks"); the defaults are below. The AI description
writer turns 3 lines (role, skills, city / salary) into a description and never invents salary, benefits or company
facts: any number, rupee amount or perk word not in the 3 lines sends it back to the plain template.
"""

import re
from typing import Any

from app.core.config import get_settings

BLOCKED = [
    "male preferred",
    "female preferred",
    "males only",
    "females only",
    "only male",
    "only female",
    "only males",
    "only females",
    "male candidates only",
    "female candidates only",
    "boys only",
    "girls only",
    "age below",
    "age under",
    "below 25 years of age",
    "below 30 years of age",
    "young candidates",
    "young candidates only",
    "no disabilities",
    "not disabled",
    "no disabled",
    "unmarried",
    "married only",
    "fair complexion",
    "good looking",
    "good-looking",
    "caste",
    "religion",
    "hindu only",
    "muslim only",
    "christian only",
]
SCAM = [
    "registration fee",
    "registration charges",
    "security deposit",
    "deposit",
    "pay to apply",
    "processing fee",
    "application fee",
    "training fee",
    "joining fee",
    "refundable fee",
    "guaranteed income",
    "guaranteed salary",
    "earn from home daily",
    "no interview required",
    "no interview",
    "contact only on whatsapp",
    "whatsapp only",
    "telegram only",
    "contact only on telegram",
    "only on telegram",
    "pay first",
    "kit charges",
]
YEARS_RE = re.compile(
    r"\b(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)\b(?:\s+of)?\s*(?:experience|exp\b)?", re.I
)
AGE_RE = re.compile(r"\bage\s*(?:limit|between|below|under|upto|up to|:)?\s*\d{2}\b", re.I)


def _norm(text: str) -> str:
    return " " + re.sub(r"\s+", " ", re.sub(r"[^a-z0-9+ ]", " ", (text or "").lower())) + " "


def _hits(text: str, phrases: list[str]) -> list[str]:
    t = _norm(text)
    return [p for p in phrases if _norm(p) in t]


def job_text(j: dict[str, Any]) -> str:
    return " \n".join([j.get("title", ""), j.get("description", ""), " ".join(j.get("skills") or [])])


def check(j: dict[str, Any], lists: dict[str, list[str]] | None = None) -> dict[str, list[str]]:
    """{blocked: [...], scam: [...], warnings: [...]} for a job (title, description, skills, experience)."""
    lists = lists or {}
    text = job_text(j)
    blocked = _hits(text, lists.get("blocked") or BLOCKED)
    if AGE_RE.search(text):
        blocked.append("an age limit")
    scam = _hits(text, lists.get("scam") or SCAM)
    warnings = []
    if j.get("experience") in ("internship", "fresher"):
        years = [int(m.group(1)) for m in YEARS_RE.finditer(text) if int(m.group(1)) >= 1]
        if years:
            warnings.append(
                f"This is a {j['experience']} job but the description asks for {max(years)}+ years of experience."
            )
    return {"blocked": sorted(set(blocked)), "scam": sorted(set(scam)), "warnings": warnings}


# ---------- AI fake-job check (once per job) ----------

AI_SCHEMA = {
    "type": "object",
    "properties": {"suspicious": {"type": "boolean"}, "reasons": {"type": "array", "items": {"type": "string"}}},
    "required": ["suspicious", "reasons"],
    "additionalProperties": False,
}


async def ai_check(db, company_id: str, j: dict[str, Any]) -> dict[str, Any] | None:
    """{suspicious, reasons} from Claude, or None when AI is off, the day's AI budget is used, or it fails (the rules
    still decide). Called once when a job is first posted."""
    if not get_settings().anthropic_api_key:
        return None
    from app.core import ai_quota, claude

    try:
        await ai_quota.take(db, "jobs", f"company:{company_id}")
    except Exception:  # noqa: BLE001  (the day's limit: the rules decide)
        return None
    text = (
        "You check job posts on an Indian job board for students and freshers. Is this post likely fake, a scam or "
        "unsafe (asks for money, too-good pay, vague work, off-platform contact only, personal data up front)? "
        "Answer suspicious true/false and short reasons.\n\n"
        f"Company: {j.get('company_name', '')}\nTitle: {j.get('title', '')}\nSalary: {j.get('salary') or 'not given'}\n"
        f"Description:\n{j.get('description', '')[:6000]}"
    )

    def ok(a):
        if not isinstance(a, dict) or "suspicious" not in a:
            raise claude.Unusable("shape")
        return {"suspicious": bool(a["suspicious"]), "reasons": [str(r)[:200] for r in a.get("reasons") or []][:5]}

    try:
        return await claude.ask_models(
            "job fake check",
            [{"type": "text", "text": text}],
            AI_SCHEMA,
            ok,
            max_tokens=400,
            effort="low",
            timeout_s=30,
            retries=1,
        )
    except Exception:  # noqa: BLE001
        return None


# ---------- AI description writer ----------

WRITE_SCHEMA = {
    "type": "object",
    "properties": {"description": {"type": "string"}},
    "required": ["description"],
    "additionalProperties": False,
}
PERKS = [
    "benefit",
    "insurance",
    "bonus",
    "esop",
    "stock",
    "incentive",
    "allowance",
    "free lunch",
    "free food",
    "cab",
    "transport",
    "pf ",
    "provident",
    "gratuity",
    "medical",
    "health cover",
    "leave",
    "work from home",
    "hybrid",
    "remote",
    "award",
    "fortune",
    "largest",
    "leading",
    "no. 1",
    "number one",
    "founded",
    "since 19",
    "since 20",
    "employees",
    "offices in",
    "clients",
]
NUM_RE = re.compile(r"(?:₹|rs\.?|inr)?\s*\d[\d,\.]*\s*(?:lpa|lakh|lakhs|k|cr|crore|%)?", re.I)


def template(role: str, skills: str, place: str) -> str:
    sk = ", ".join(s.strip() for s in re.split(r"[,;/]", skills) if s.strip())
    lines = [f"We are hiring a {role.strip()}."]
    if sk:
        lines.append(f"You will work with {sk}.")
    lines.append(
        "What you will do:\n- Work with the team on day-to-day tasks for this role\n"
        "- Learn and grow with guidance from senior colleagues"
    )
    if sk:
        lines.append(
            f"What we look for:\n- Working knowledge of {sk}\n- Willingness to learn; freshers are welcome to apply"
        )
    if place.strip():
        lines.append(f"Location and pay: {place.strip()}")
    return "\n\n".join(lines)


def invented(text: str, given: str) -> list[str]:
    """Numbers / rupee amounts and perk or company-fact words in `text` that the company didn't type."""
    low = _norm(given)
    out = []
    for m in NUM_RE.finditer(text):
        v = m.group(0).strip()
        digits = re.sub(r"\D", "", v)
        if digits and digits not in re.sub(r"\D", " ", given).split() and digits not in re.sub(r"\D", "", given):
            out.append(v)
    out += [p.strip() for p in PERKS if _norm(p).strip() in _norm(text) and _norm(p).strip() not in low]
    return out


async def write(db, company_id: str, company: str, role: str, skills: str, place: str) -> dict[str, Any]:
    """{description, source: ai | template, removed: [...]} — the AI text only when it passes the fact check."""
    base = template(role, skills, place)
    if not get_settings().anthropic_api_key:
        return {"description": base, "source": "template", "removed": []}
    from app.core import ai_quota, claude

    try:
        await ai_quota.take(db, "jobs", f"company:{company_id}")
    except Exception:  # noqa: BLE001
        return {"description": base, "source": "template", "removed": []}
    given = f"{role}\n{skills}\n{place}"
    prompt = (
        "Write a clear job description (120-220 words, plain text, short paragraphs and '- ' bullet points) for a job "
        "post aimed at freshers in India. Use ONLY these facts. Do NOT add salary, pay, benefits, perks, work mode, "
        "company size, history or any number that is not below. If something is missing, leave it out.\n\n"
        f"Company: {company}\nRole: {role}\nSkills: {skills}\nCity / salary as given: {place}"
    )

    def ok(a):
        if not isinstance(a, dict) or not str(a.get("description") or "").strip():
            raise claude.Unusable("shape")
        return str(a["description"]).strip()[:5000]

    try:
        text = await claude.ask_models(
            "job writer",
            [{"type": "text", "text": prompt}],
            WRITE_SCHEMA,
            ok,
            max_tokens=900,
            effort="low",
            timeout_s=40,
            retries=1,
        )
    except Exception:  # noqa: BLE001
        return {"description": base, "source": "template", "removed": []}
    bad = invented(text, given + "\n" + company)
    if bad:
        return {"description": base, "source": "template", "removed": bad}
    return {"description": text, "source": "ai", "removed": []}
