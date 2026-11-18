# ruff: noqa: E501  (pattern tables)
"""Vetting Trust T12: warning employers about discriminatory filters (job posts, knock-out questions, requirements and
Hire now filters).

Two levels, checked on the server (and shown on the pages as the company types / checks):
  refuse  a filter that targets a protected characteristic DIRECTLY — "male candidates only", "girls preferred", "age
          below 28", "freshers under 25", "unmarried only", "no married women", "not pregnant", "Hindus only", "no
          disabled", "fair complexion", "send your photo". It can't be posted or saved (as T6 does for questions about
          gender, religion, caste, age, marital status, pregnancy or photos, and T7 for requirements about a name or a
          college), with why and a neutral alternative.
  warn    a PROXY that stands in for one — "only from IIT / a top college", "2023 pass-outs only", "young and
          energetic", "locals only", "Telugu people only", "mother tongue", "no family commitments", "no career gap",
          "physically fit", "presentable", "salesgirl", a community name with "only / preferred", a Hire now language
          filter the job doesn't need, a city filter that isn't the job's city. It can still be used: the company sees
          why it can be unfair and a suggested neutral wording; going ahead is logged as an override.
Every warning shown, overridden or refused goes to `trust_fairness_events` (company, where, topic, action, the flagged
words; never anything about a candidate) for the Admin fairness report.
"""

import re
from dataclasses import asdict, dataclass
from typing import Any

from app.core.db import TRUST_FAIRNESS_EVENTS
from app.core.time import now

WHERE = ("job", "question", "criteria", "hire_filter")
ACTIONS = ("shown", "override", "refused")

G = r"(?:males?|females?|men|women|boys?|girls?|ladies|lady|gents|gentlemen)"
REL = r"(?:hindus?|muslims?|christians?|sikhs?|jains?|buddhists?|parsis?)"
COMMUNITY = (r"(?:reddys?|kammas?|kapus?|velamas?|naidus?|yadavs?|jats?|rajputs?|brahmins?|iyers?|iyengars?|nairs?|lingayats?|"
             r"vokkaligas?|thevars?|nadars?|gounders?|chettiars?|kayasthas?|marathas?|marwaris?|kshatriyas?|vaishyas?)")  # fmt: skip
PREF = r"(?:only|preferred|prefered|preferable|candidates? only|required|wanted|needed)"
LANGS = r"(?:telugu|tamil|kannada|malayali|malayalee|bengali|gujarati|marathi|odia|punjabi|bihari|north indian|south indian|hindi speaking|telugu speaking|tamil speaking)"


@dataclass(frozen=True)
class Rule:
    topic: str
    level: str  # refuse | warn
    rx: re.Pattern
    why: str
    suggest: str


def _r(p: str) -> re.Pattern:
    return re.compile(p, re.IGNORECASE)


LABEL = {"gender": "gender", "age": "age", "marital": "marital status", "pregnancy": "pregnancy", "religion": "religion",
         "caste": "caste or community", "disability": "disability", "looks": "photos or looks", "college": "which college",
         "region": "where someone is from", "language": "mother tongue / language"}  # fmt: skip

WHY = {
    "gender": "Choosing people by gender is discrimination: anyone who can do the work should be able to apply.",
    "age": "Age limits shut out people who can do the work; what matters is the skill and experience.",
    "marital": "Marital status says nothing about the work and is used to keep out women.",
    "pregnancy": "Pregnancy or family plans must never decide who gets a job.",
    "religion": "Choosing people by religion is discrimination.",
    "caste": "Caste or community must never decide who gets a job.",
    "disability": "People with a disability can do most jobs; say what the work needs instead.",
    "looks": "Photos and looks say nothing about the work and invite bias (skin colour, gender, age).",
}
SUGGEST = {
    "gender": "Remove it. If the work has a real need (for example night travel), describe the work: “Night shifts, cab provided”.",
    "age": "Ask for the experience the work needs (“0–2 years in sales”) instead of an age.",
    "marital": "Remove it. Describe the work: shifts, travel, relocation.",
    "pregnancy": "Remove it. Describe the work: shifts, travel, physical tasks.",
    "religion": "Remove it.",
    "caste": "Remove it.",
    "disability": "Describe the task (“can stand for a 6-hour shift”, “lifts up to 15 kg”) and welcome everyone who can do it.",
    "looks": "Remove it. Ask for what the work needs (“speaks clearly with customers”, “wears the uniform”).",
}

RULES: list[Rule] = [
    # --- direct: refused ---------------------------------------------------------------------------------------------
    Rule("gender", "refuse", _r(rf"\b(?:only|prefer(?:red|ably)?|must be|should be|looking for)\s+(?:a\s+)?(?:local\s+)?{G}\b(?!\s+and\s+{G})"), WHY["gender"], SUGGEST["gender"]),
    Rule("gender", "refuse", _r(rf"\b{G}\s+(?:candidates?\s+)?{PREF}\b"), WHY["gender"], SUGGEST["gender"]),
    Rule("gender", "refuse", _r(rf"\bno\s+{G}\b|\b{G}\s+(?:need not|should not|cannot|can't)\s+apply\b|\(\s*(?:male|female)\s*\)"), WHY["gender"], SUGGEST["gender"]),
    Rule("age", "refuse", _r(r"\bage\s*(?:limit|between|below|under|upto|up to|:)?\s*(?!18\b)\d{2}\b"), WHY["age"], SUGGEST["age"]),
    Rule("age", "refuse", _r(r"\b(?:freshers?|candidates?|applicants?|people|boys|girls|youngsters?|graduates?)\s+(?:below|under|less than|not above|not more than|upto|up to)\s*(?!18\b)\d{2}\b"), WHY["age"], SUGGEST["age"]),
    Rule("age", "refuse", _r(r"\b(?:below|under|less than|not above|not more than|max(?:imum)?)\s*(?!18\b)\d{2}\s*(?:years?|yrs)(?:\s*(?:old|of age|age))?\b(?!\s*(?:of\s+)?(?:experience|exp|in\b|work))"), WHY["age"], SUGGEST["age"]),
    Rule("age", "refuse", _r(r"\b\d{2}\s*(?:-|to)\s*\d{2}\s*(?:years?|yrs)\s*(?:old|of age)\b|\b(?:young|younger) candidates\b|\bbelow the age\b"), WHY["age"], SUGGEST["age"]),
    Rule("marital", "refuse", _r(rf"\b(?:unmarried|married|single|bachelors?|spinsters?)\s+(?:{G}\s+)?{PREF}\b|\b(?:only|prefer(?:red)?)\s+(?:unmarried|married|single|bachelors?)\b|\bno\s+married\b|\bunmarried\b"), WHY["marital"], SUGGEST["marital"]),
    Rule("pregnancy", "refuse", _r(r"\b(?:no|not)\s+(?:pregnant|expecting)\b|\bpregnant\s+(?:women|ladies|candidates)\s+(?:need not|should not|cannot|can't|not)\b|\bplanning (?:a|to have a) (?:baby|child|family)\b|\bno pregnancy\b"), WHY["pregnancy"], SUGGEST["pregnancy"]),
    Rule("religion", "refuse", _r(rf"\b{REL}\s+(?:candidates?\s+)?{PREF}\b|\b(?:only|prefer(?:red)?)\s+{REL}\b|\bno\s+{REL}\b"), WHY["religion"], SUGGEST["religion"]),
    Rule("caste", "refuse", _r(r"\b(?:sc ?/ ?st|obc|dalits?|brahmins?)\s+(?:candidates?\s+)?(?:only|preferred|not allowed|need not apply)\b|\bcaste\b|\bsame community\b|\bour community\b"), WHY["caste"], SUGGEST["caste"]),
    Rule("disability", "refuse", _r(r"\bno\s+(?:disabled|disabilit(?:y|ies)|handicapped|physically challenged|pwd)\b|\b(?:not|non)[- ]disabled\b|\b(?:disabled|handicapped|physically challenged)\s+(?:persons?\s+|people\s+|candidates?\s+)?(?:need not|should not|cannot|can't|not allowed|not eligible)\b|\bshould not have any disabilit"), WHY["disability"], SUGGEST["disability"]),
    Rule("looks", "refuse", _r(r"\bfair (?:complexion|skin(?:ned)?)\b|\bgood[- ]looking\b|\b(?:attractive|beautiful|handsome|pretty)\s+(?:candidates?|girls?|boys?|women|men|ladies|persons?|people|face|looks?|receptionists?)\b|\bskin colou?r\b|\b(?:send|attach|share|with)\s+(?:a\s+|your\s+|recent\s+)*(?:photo(?:graph)?|picture|pic|selfie)s?\b|\bphoto (?:required|must|compulsory|mandatory)\b"), WHY["looks"], SUGGEST["looks"]),
    # --- proxies: warned ---------------------------------------------------------------------------------------------
    Rule("college", "warn", _r(r"\b(?:only|prefer(?:red|ably)?|must be)\b[^.\n]{0,30}?\b(?:IIT|NIT|IIIT|IIM|BITS|tier[- ]?(?:1|one)|top|premier|reputed|good)\b[^.\n]{0,20}?\b(?:colleges?|institutes?|universit(?:y|ies)|graduates?|alumni|campus(?:es)?)?\b"
                                 r"|\b(?:IIT|NIT|IIIT|IIM|BITS|tier[- ]?(?:1|one)|top|premier|reputed)[- ](?:colleges?|institutes?|universit(?:y|ies)|graduates?|alumni|campus(?:es)?)\b"
                                 r"|\b(?:only|prefer(?:red)?)\s+(?:from\s+)?[A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*){0,3}\s+(?:college|university|institute)\b"),
         "Which college someone went to stands in for family money and where they grew up, not for what they can do.",
         "Ask for the skill instead (“Has passed the SQL skill check”, “Knows Tally and GST”)."),
    Rule("age", "warn", _r(r"\b(?:19|20)\d\d\s*(?:pass[- ]?outs?|pass(?:ed)? out|batch)\b|\bpass(?:ed)?[- ]?out\s+(?:in|after)\s+(?:19|20)\d\d\b|\b(?:recent|fresh) graduates? only\b|\bgraduated in the last \d+\s*years?\b|\byoung(?:sters?)?\b|\byouthful\b|\bdigital natives?\b|\bmax(?:imum)? \d+ years? since graduation\b"),
         "The year someone graduated, or “young”, stands in for age and shuts out people who started later or are returning to work.",
         "Say the experience the work needs (“0–2 years of experience”) and welcome freshers of any age."),
    Rule("gender", "warn", _r(r"\bsales ?(?:man|men|girls?|boys?)\b|\boffice boys?\b|\btea boys?\b|\bpeon boys?\b|\bair ?hostess(?:es)?\b|\bwaitress(?:es)?\b|\bhouse ?wi(?:fe|ves)\b|\bfemale receptionist\b|\b(?:his|her)\s+(?:role|duties|job)\b|\bgirl friday\b"),
         "A gendered job title tells half the people it isn't for them.",
         "Use a neutral title: salesperson, office assistant, cabin crew, server, receptionist."),
    Rule("marital", "warn", _r(r"\bno family (?:commitments?|responsibilit(?:y|ies)|burden)\b|\bfree from family\b|\bwithout (?:kids|children)\b|\bno (?:kids|children)\b|\bno (?:career )?gaps?\b|\bcareer breaks? not\b|\bno breaks? in (?:career|education)\b"),
         "“No family commitments” and “no career gap” mostly shut out women and people who cared for family.",
         "Describe the work instead: the shift timings, travel, or overtime it needs."),
    Rule("region", "warn", _r(r"\blocals?(?:\s+(?:candidates?|people|residents?|boys|girls))?\s+only\b|\bonly\s+locals?\b|\blocalites?\b|\bnatives? of\b|\bdomicile(?:d)?\b|\bborn and brought up in\b|\bbelongs? to (?:this|the same|our) (?:area|region|state|city)\b|\bnon[- ]locals? (?:need not|should not|not)\b"),
         "Where someone is from stands in for community and caste, and shuts out people who would move for the job.",
         "Say where the work is and the shift (“Office in Kukatpally, 9 AM–6 PM”); people decide if they can reach it."),
    Rule("language", "warn", _r(rf"\b{LANGS}s?\s+(?:people|candidates?|persons?|boys|girls)\s*{PREF}\b|\b{LANGS}s?\s+only\b|\bonly\s+{LANGS}s?\s+(?:people|candidates?|persons?)\b|\bmother[- ]tongue\b"),
         "Choosing people by mother tongue or which state they are from stands in for community and region.",
         "If the work needs a language, ask for the language: “Speaks Telugu with customers”."),
    Rule("disability", "warn", _r(r"\bphysically fit\b|\bable[- ]bodied\b|\bno medical (?:conditions?|history|problems?)\b|\bperfect health\b|\bno spectacles\b|\b6/6 vision\b|\bmedically fit\b|\bhealthy candidates\b"),
         "“Physically fit” and “able-bodied” shut out people with a disability who can do the work.",
         SUGGEST["disability"]),
    Rule("looks", "warn", _r(r"\bpleasing personality\b|\bpresentable\b|\bsmart[- ]looking\b|\b(?:min(?:imum)?\.?\s+)?(?:height|weight)\s*(?:of|:|-|above|at least|minimum|should be)?\s*\d|\bslim\b|\btall (?:candidates?|people|persons?|boys|girls)\b|\bwell[- ]groomed\b|\bgood personality\b"),
         "Looks, height or “pleasing personality” invite bias about skin colour, gender and body; they say nothing about the work.",
         "Ask for what the work needs (“speaks clearly and politely with customers”, “wears the uniform”)."),
    Rule("caste", "warn", _r(rf"\b(?:only|prefer(?:red)?)\s+{COMMUNITY}\b|\b{COMMUNITY}\s+(?:candidates?|people|boys|girls|community)\b|\b{COMMUNITY}\s+{PREF}\b"),
         "A community name stands in for caste or religion.",
         "Remove it: choose people by their skills."),
]  # fmt: skip


BOTH = _r(rf"\b{G}\s*(?:and|or|&|/)\s*{G}\b")


@dataclass(frozen=True)
class Finding:
    level: str
    topic: str
    label: str
    phrase: str
    why: str
    suggest: str


def check_text(text: str) -> list[Finding]:
    """Every refused phrase and every proxy warning in a text (one per topic × level, the first phrase found; a topic
    refused is not also warned)."""
    s = " ".join(str(text or "").split())
    s = BOTH.sub("everyone", s)  # "male and female candidates required" is open to everyone
    out: list[Finding] = []
    seen: set[tuple[str, str]] = set()
    for r in RULES:
        if (r.topic, r.level) in seen or (r.level == "warn" and (r.topic, "refuse") in seen):
            continue
        m = r.rx.search(s)
        if m and m.group(0).strip():
            seen.add((r.topic, r.level))
            out.append(
                Finding(r.level, r.topic, LABEL.get(r.topic, r.topic), m.group(0).strip()[:80], r.why, r.suggest)
            )
    return out


def refused(fs: list[Finding]) -> list[Finding]:
    return [f for f in fs if f.level == "refuse"]


def warned(fs: list[Finding]) -> list[Finding]:
    return [f for f in fs if f.level == "warn"]


def out(fs: list[Finding]) -> list[dict[str, Any]]:
    return [asdict(f) for f in fs]


def refusal_text(fs: list[Finding]) -> str:
    f = refused(fs)[0]
    return f"“{f.phrase}” can’t be used: {f.why} {f.suggest}"


def job_text(job: dict[str, Any], questions: list[dict[str, Any]] | None = None) -> str:
    qs = questions if questions is not None else job.get("questions") or []
    return "\n".join([str(job.get("title") or ""), str(job.get("description") or ""), " ".join(job.get("skills") or []),
                      *(str(q.get("text") or "") for q in qs), *(str(o) for q in qs for o in q.get("options") or [])])  # fmt: skip


def hire_filters(params: dict[str, Any], job: dict[str, Any]) -> list[Finding]:
    """Hire now filters that work as a proxy: a language the job doesn't ask for, a city filter that isn't where the
    job is."""
    fs: list[Finding] = []
    text = job_text(job).lower()
    lang = str(params.get("lang") or "").strip()
    if lang and lang.lower() not in text:
        fs.append(Finding("warn", "language", LABEL["language"], f"Speaks {lang}",
                          "This job doesn’t mention the language, so filtering by it can stand in for which state or community someone is from.",
                          f"Keep it only if the work needs {lang} (then add it to the job’s requirements); else remove the filter."))  # fmt: skip
    city = str(params.get("city") or "").strip().lower()
    places = [str(x).lower() for x in job.get("locations") or []]
    if (
        city
        and not job.get("remote")
        and places
        and not any(city in p or p.split(",")[0].strip() in city for p in places)
    ):
        fs.append(Finding("warn", "region", LABEL["region"], f"Lives in {params.get('city')}",
                          "This isn’t the job’s city: filtering by where someone lives shuts out people who would move for the job.",
                          "Use “distance from the job” or the job’s own city, or remove the filter."))  # fmt: skip
    return fs


async def log(db, company_id: str, where: str, fs: list[Finding] | list[dict[str, Any]], action: str) -> int:
    """One row per finding (company, where, topic, level, action, the flagged words). Never anything about a candidate."""
    rows = []
    t = now()
    for f in fs:
        d = asdict(f) if isinstance(f, Finding) else f
        if not d.get("topic"):
            continue
        rows.append({"company_id": company_id, "where": where if where in WHERE else "job", "topic": str(d["topic"])[:20],
                     "level": "refuse" if d.get("level") == "refuse" else "warn", "action": action if action in ACTIONS else "shown",
                     "phrase": str(d.get("phrase") or "")[:80], "at": t})  # fmt: skip
    if rows:
        await db[TRUST_FAIRNESS_EVENTS].insert_many(rows)
    return len(rows)
