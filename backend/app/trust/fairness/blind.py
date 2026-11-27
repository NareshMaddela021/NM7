# ruff: noqa: E501  (dense registry lines)
"""Vetting Trust T12: one anonymiser for every AI grading or evaluation call ("blind grading").

Before ANY AI call that grades or evaluates a person (V2 practical task grading, V3 interview follow-ups and grading, T9
"Explain your answer", T10 spoken grammar / comprehension, T7 requirement checks, Auto Apply tailoring and the T12
second-opinion re-grades), the text about the person goes through `anonymiser` (one line) or `scrubber_for` (a whole
answer, sentence by sentence). It removes, as "[removed]":
  - this person's own details: their name (and each part of it), email, phone, address, city / PIN code, date of birth,
    the colleges in their education (from the account and their resume);
  - the general kinds, for anyone: emails, phone numbers, links (a profile link can carry a name), dates of birth and
    ages, "Mr / Mrs / Smt …" titles, college / university / institute names (and IIT / NIT / IIM / BITS …), Aadhaar /
    PAN-like numbers, house / door / PIN code addresses, gender, religion, caste, marital-status and pregnancy words
    (the T6 word lists) and community / caste names.
Photos are never sent with a grading call. The one image call (V2's "photo of past work") sends only the work photo and
the role and is told not to judge the person; it decides only "genuine relevant work?", never a score.

Where the existing code did not anonymise yet (V2 grading, V3 interview, Auto Apply tailoring), blind grading is applied
for the people the Vetting Trust switch lets in (`applies`), so the grades of real users don't change while the switch
is OFF. T7, T9 and T10 already anonymised (they are Trust features) and now share this anonymiser.

BLIND is the registry of every AI call site that grades or evaluates a person: tests/test_trust_t12.py feeds each one a
profile full of identifying data and checks none of it reaches the prompt; NOT_GRADING lists every other Claude call
site with why it is not an evaluation of a person. Together they must cover tests/test_claude_schemas.py SENT.
"""

import re
from collections.abc import Callable
from typing import Any

from app.core.db import RESUMES, USERS
from app.core.pii import AADHAAR, PAN, PHONE
from app.trust import knockout as K

GONE = "[removed]"
MAX_LINE = 400
MAX_TEXT = 6000

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL = re.compile(r"\b(?:https?://|www\.)\S+|\b(?:linkedin|github|facebook|instagram|twitter)\.com/\S*", re.IGNORECASE)
DOB = re.compile(
    r"\b(?:d\.?o\.?b\.?|date of birth|born(?: on| in)?|birth ?day)\b\s*[:\-]?\s*[\w ,./-]{0,24}?(?:\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})",
    re.IGNORECASE,
)
AGE = re.compile(r"\b\d{2}\s*(?:years?|yrs?)\s*(?:old|of age)\b|\bage[d]?\s*[:\-]?\s*\d{2}\b", re.IGNORECASE)
TITLES = re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Shri|Smt|Kumari|MR|MRS|SMT)\b\.?(?=\s+[A-Z][a-z])")  # "MS Excel" stays
COLLEGE = re.compile(
    r"\b(?:[A-Z][\w&.'-]*\s+){0,5}(?:College|University|Institute|Vidyalaya|Vidyapeeth|Vidyapith|Polytechnic|Academy)\b(?:\s+of(?:\s+[A-Z][\w&.'-]*){1,4})?"
    r"|\b(?:IIT|NIT|IIIT|IIM|BITS)\b(?:\s+[A-Z][a-z]+)?"
)
ADDRESS = re.compile(
    r"\b(?:pin ?code|pin|postal code|h\.? ?no|house no|door no|flat no|plot no)\b\.?\s*[:\-]?\s*[\w/-]{0,6}\d[\w/-]{0,8}",
    re.IGNORECASE,
)
# community / caste names (a person's community says nothing about the work; common surnames are removed with the name)
COMMUNITY = re.compile(
    r"\b(?:reddys?|kammas?|kapus?|velamas?|naidus?|yadavs?|jats?|rajputs?|brahmins?|iyers?|iyengars?|nairs?|ezhavas?|"
    r"lingayats?|vokkaligas?|thevars?|nadars?|gounders?|chettiars?|kayasthas?|marathas?|madigas?|dalits?|adivasis?|"
    r"banjaras?|lambadas?|marwaris?|kshatriyas?|vaishyas?|shudras?)\b",
    re.IGNORECASE,
)
GENDER = re.compile(r"\b(?:wom[ae]n|lad(?:y|ies)|gentlem[ae]n|housewi(?:fe|ves)|homemakers?)\b", re.IGNORECASE)
PERSONAL = ("gender", "religion", "caste", "marital", "pregnancy")
# resume / profile fields that identify the person (never the work)
PROFILE_KEYS = (
    "name",
    "location",
    "address",
    "dob",
    "dateOfBirth",
    "city",
    "pincode",
    "email",
    "phone",
    "state",
    "hometown",
)


def anonymiser(
    name: str = "", email: str = "", phone: str = "", extra: list[str] | None = None
) -> Callable[[str], str]:
    """A function that removes this person's details (and the general kinds above) from a line of text."""
    words = [w for w in re.split(r"[\s.]+", name or "") if len(w) >= 3]
    exact = sorted(
        {x.strip() for x in [name, email, phone, *(extra or []), *words] if x and len(x.strip()) >= 3},
        key=len,
        reverse=True,
    )
    exact_rx = (
        re.compile(r"(?<!\w)(?:" + "|".join(re.escape(x) for x in exact) + r")(?!\w)", re.IGNORECASE) if exact else None
    )
    digits = re.sub(r"\D", "", phone or "")[-10:]
    phone_rx = re.compile(r"(?<!\d)" + r"[\s-]?".join(digits) + r"(?!\d)") if len(digits) == 10 else None

    def scrub(text: str) -> str:
        s = TITLES.sub(GONE, str(text or ""))
        for rx in (URL, EMAIL, DOB, AGE):
            s = rx.sub(GONE, s)
        if phone_rx:
            s = phone_rx.sub(GONE, s)
        s = PHONE.sub(GONE, s)
        s = AADHAAR.sub(GONE, s)
        s = PAN.sub(GONE, s)
        if exact_rx:
            s = exact_rx.sub(GONE, s)
        s = COLLEGE.sub(GONE, s)
        s = ADDRESS.sub(GONE, s)
        for k in PERSONAL:
            s = K._TOPIC_RX[k].sub(GONE, s)
        s = COMMUNITY.sub(GONE, s)
        s = GENDER.sub(GONE, s)
        s = re.sub(r"(?:\[removed\][\s,]*){2,}", GONE + " ", s)
        return " ".join(s.split())[:MAX_LINE]

    return scrub


def long_text(one: Callable[[str], str], limit: int = MAX_TEXT) -> Callable[[str], str]:
    """The line anonymiser over a whole answer (it keeps 400 characters a line): sentence by sentence, lines kept."""

    def scrub(text: str) -> str:
        out_lines = []
        for line in str(text or "").split("\n"):
            parts = [p for p in re.split(r"(?<=[.!?।])\s+", line) if p.strip()]
            out, chunk = [], ""
            for p in parts:
                if len(chunk) + len(p) > 350 and chunk:
                    out.append(one(chunk))
                    chunk = ""
                chunk = f"{chunk} {p}".strip()
                while len(chunk) > 380:
                    out.append(one(chunk[:380]))
                    chunk = chunk[380:]
            if chunk:
                out.append(one(chunk))
            out_lines.append(" ".join(x for x in out if x))
        return "\n".join(out_lines).strip()[:limit]

    return scrub


def identifiers(user: dict[str, Any] | None, resume: dict[str, Any] | None) -> tuple[str, str, str, list[str]]:
    """(name, email, phone, extra) from the account and the resume data: everything that names this person."""
    u = user or {}
    data = (resume or {}).get("data") or {}
    pers = data.get("personal") or {}
    extra = [str(pers.get(k) or "") for k in PROFILE_KEYS]
    # each part of an address ("Plot No 14, Kukatpally, Hyderabad 500072" → "Kukatpally", "Hyderabad 500072", …)
    extra += [
        p.strip()
        for k in ("location", "address", "city", "hometown")
        for p in re.split(r"[,;/\n]", str(pers.get(k) or ""))
    ]
    extra += [w for k in ("location", "address") for w in re.findall(r"\b\d{6}\b", str(pers.get(k) or ""))]
    extra += [
        str(e.get(k) or "")
        for e in data.get("edu") or []
        if isinstance(e, dict)
        for k in ("institution", "school", "college", "university", "board")
    ]
    extra += [w for w in re.split(r"\s+", str(pers.get("name") or "")) if len(w) >= 3]
    extra += [str(x.get("name") or "") for x in data.get("references") or [] if isinstance(x, dict)]
    phone = str(u.get("phone") or pers.get("phone") or "")
    return (
        str(u.get("name") or ""),
        str(u.get("email") or pers.get("email") or ""),
        phone,
        [x for x in extra if x.strip()],
    )


async def resume_of(db, uid: str) -> dict[str, Any]:
    return (
        await db[RESUMES].find_one({"user_id": uid, "active": True})
        or await db[RESUMES].find_one({"user_id": uid}, sort=[("updated_at", -1)])
        or {}
    )


async def line_for(db, uid: str) -> Callable[[str], str]:
    u = await db[USERS].find_one({"_id": uid}, {"name": 1, "email": 1, "phone": 1}) or {}
    return anonymiser(*identifiers(u, await resume_of(db, uid)))


async def scrubber_for(db, uid: str, limit: int = MAX_TEXT) -> Callable[[str], str]:
    """Removes this person's details and the general kinds from a whole answer (the one used by every grading call)."""
    return long_text(await line_for(db, uid), limit)


async def applies(db, uid: str) -> bool:
    """Blind grading for call sites that did not anonymise before T12 (V2, V3, tailoring): only where the Vetting Trust
    switch lets this person in, so real users' grades don't change while the switch is OFF."""
    from app.trust import access

    return await access.for_user(db, uid)


async def maybe(db, uid: str, limit: int = MAX_TEXT) -> Callable[[str], str] | None:
    return await scrubber_for(db, uid, limit) if await applies(db, uid) else None


def blind_resume(data: dict[str, Any]) -> dict[str, Any]:
    """A resume for an AI prompt: no personal block, links, photo, references or declaration, and no school / college
    names in the education (degree, field and year stay)."""
    out = {
        k: v
        for k, v in (data or {}).items()
        if k not in ("personal", "links", "photo", "references", "declaration", "hobbies")
    }
    if isinstance(out.get("edu"), list):
        out["edu"] = [
            {
                k: v
                for k, v in e.items()
                if k not in ("institution", "school", "college", "university", "board", "location", "city")
            }
            if isinstance(e, dict)
            else e
            for e in out["edu"]
        ]
    return out


# Every AI call site that grades or evaluates a person, and the prompt builders the test probes. The test (BLIND probes
# in tests/test_trust_t12.py) must have one probe per entry.
BLIND: dict[str, dict[str, Any]] = {
    "app.hire.vetting.grade": {
        "what": "V2 practical task grading (written / tech / spoken) and the work-photo check",
        "builders": ["prompt"],
        "since": "T12 (Trust switch)",
    },
    "app.hire.vetting.interview": {
        "what": "V3 interview follow-ups, grading and the weekly second grader",
        "builders": ["follow_prompt", "grade_prompt", "second_prompt"],
        "since": "T12 (Trust switch)",
    },
    "app.trust.honesty.explain": {
        "what": "T9 Explain your answer: questions and the check",
        "builders": ["question_prompt", "grade_prompt"],
        "since": "T9",
    },
    "app.trust.spoken.service": {
        "what": "T10 spoken English: grammar and comprehension",
        "builders": ["prompt"],
        "since": "T10",
    },
    "app.trust.criteria.evaluate": {
        "what": "T7 requirement checks (Met / Not met / Unknown)",
        "builders": ["prompt"],
        "since": "T7",
    },
    "app.autoapply.tailoring": {
        "what": "Auto Apply tailoring (rephrasing; the truth check runs on the result)",
        "builders": ["prompt"],
        "since": "A2 (name, contact, photo, gender…); T12 adds colleges, references and the anonymiser (Trust switch)",
    },
    "app.trust.fairness.regrade": {
        "what": "T12 second-opinion re-grades of V2 / V3 / T9",
        "builders": ["v2_prompt", "explain_prompt"],
        "since": "T12",
    },
}
NOT_GRADING: dict[str, str] = {
    "app.jobs.collector": "summarises job posts (no person)",
    "app.companies.jobcheck": "checks a company's job post / writes a job description (no candidate)",
    "app.projects.helper": "rewrites the person's own project for their resume (shown only to them)",
    "app.summary.writer": "writes the person's own resume summary (shown only to them)",
    "app.linkedin.pack_writer": "writes the person's own LinkedIn texts",
    "app.linkedin.writer": "writes the person's own LinkedIn texts",
    "app.jobsearch.interview": "practice interview questions and feedback shown only to the person (never stored as a grade, never shown to companies)",
    "app.jobsearch.ai": "explains job matches to the person themself",
    "app.jobsearch.cover": "writes the person's own cover letter",
    "app.jobsearch.tailor": "rewrites the person's own resume for a job (shown only to them)",
    "app.photos.reader": "reads a photo of the person's own resume into the builder for them",
    "app.seek.offers": "explains a job offer to the person",
    "app.seek.roles": "suggests roles to the person from their answers",
    "app.autoapply.replies": "reads a company's email reply (no candidate evaluation)",
    "app.autoapply.helper": "drafts the person's own answer to a form question from their own profile; they approve it (no evaluation)",
    "app.jobs.ai_health": "tests that the AI answers (fixed text)",
    "app.trust.agent.understand": "reads a WhatsApp reply into yes / no / a number (the answer, not the person)",
    "app.trust.criteria.extract": "reads a job description into requirements (no candidate)",
}
