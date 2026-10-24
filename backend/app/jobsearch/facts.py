"""The fact check every AI-written job-search text goes through (tailored lines, cover letters, interview answers).

A text passes only when it adds nothing the person didn't have:
- every number in it (years, %, counts, amounts) is in their resume (or what they typed);
- every skill, tool, certification or language it names (skills dictionary) is in their resume;
- every name-like word (a capitalised word that isn't the first of a sentence: a company, college, product, city,
  degree) is in their resume, or is one of the words of the job it is written for (its title, company, location);
- no phone number, email address or ID number.

A text that fails is dropped and the rules-based version is used instead. The job post's own skills are NOT allowed
in the person's lines: "not something you've done" is never added.
"""

import re
from typing import Any

from app.jobsearch import skills as dictionary
from app.photos.scrub import looks_like_id

NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
CONTACT = re.compile(
    r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)|[\w.+-]+@[\w-]+\.[\w.]+|https?://|\bwww\.", re.IGNORECASE
)
NAME_WORD = re.compile(r"(?<![\w.])([A-Z][A-Za-z0-9&+#.\-']*[A-Za-z0-9+#])")
# capitalised words that are ordinary English (sentence parts, months, resume words), never treated as names
COMMON = {
    "i",
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "with",
    "of",
    "my",
    "me",
    "we",
    "our",
    "you",
    "your",
    "this",
    "that",
    "these",
    "those",
    "it",
    "as",
    "by",
    "from",
    "into",
    "about",
    "after",
    "before",
    "dear",
    "hi",
    "hello",
    "regards",
    "sincerely",
    "thank",
    "thanks",
    "yours",
    "best",
    "kind",
    "warm",
    "respected",
    "sir",
    "madam",
    "mr",
    "ms",
    "mrs",
    "hiring",
    "manager",
    "team",
    "subject",
    "re",
    "application",
    "role",
    "position",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "jan",
    "feb",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "sept",
    "oct",
    "nov",
    "dec",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "india",
    "indian",
    "english",
    "hindi",
    "built",
    "made",
    "led",
    "created",
    "designed",
    "developed",
    "managed",
    "handled",
    "improved",
    "reduced",
    "increased",
    "delivered",
    "worked",
    "used",
    "cleaned",
    "analysed",
    "analyzed",
    "prepared",
    "trained",
    "helped",
    "supported",
    "maintained",
    "wrote",
    "tested",
    "ran",
    "set",
    "planned",
    "organised",
    "organized",
    "completed",
    "currently",
    "previously",
    "also",
    "during",
    "while",
    "skilled",
    "experienced",
    "fresher",
    "graduate",
    "looking",
    "seeking",
    "keen",
    "eager",
    "ready",
    "able",
    "happy",
    "excited",
    "interested",
    "familiar",
    "proficient",
    "strong",
    "good",
    "hands-on",
    "situation",
    "task",
    "action",
    "result",
    "star",
    "tell",
    "why",
    "what",
    "how",
    "when",
    "where",
    "who",
    "which",
    "yes",
    "no",
    "please",
    "let",
    "here",
    "there",
    "today",
    "tomorrow",
    "first",
    "second",
    "third",
    "next",
    "then",
    "finally",
    "overall",
    "recently",
    "since",
    "over",
    "more",
    "most",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "each",
    "every",
    "all",
    "some",
    "many",
    "much",
    "very",
    "really",
    "just",
    "only",
    "still",
    "even",
    "well",
    "too",
    "not",
    "is",
    "am",
    "are",
    "was",
    "were",
    "be",
    "been",
    "have",
    "has",
    "had",
    "do",
    "did",
    "does",
    "can",
    "could",
    "will",
    "would",
    "should",
    "shall",
    "might",
    "must",
    "if",
    "so",
    "because",
    "though",
    "although",
    "however",
    "therefore",
    "data",
    "analyst",
    "developer",
    "engineer",
    "executive",
    "sales",
    "customer",
    "support",
    "intern",
    "internship",
    "project",
    "projects",
    "experience",
    "skills",
    "education",
    "summary",
    "resume",
    "cover",
    "letter",
    "interview",
    "company",
    "job",
    "work",
    "office",
    "field",
    "assistant",
    "associate",
}


def resume_text(data: dict[str, Any]) -> str:
    """Every word on the resume, as one text (the facts the AI may use)."""
    out: list[str] = []

    def walk(v: Any) -> None:
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(data or {})
    return "\n".join(out)


def _present(word: str, sources_lower: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(word.lower())}(?![a-z0-9])", sources_lower) is not None


def problems(text: str, resume: str, allowed: str = "", typed: str = "") -> list[str]:
    """What in `text` isn't backed by the resume. `allowed`: the job's own words (title, company, location) that may
    appear as names; `typed`: what the person typed or said (their own words also count as facts)."""
    issues: list[str] = []
    facts = f"{resume}\n{typed}"
    if CONTACT.search(text) or looks_like_id(text):
        issues.append("contact details or an ID number")
    for n in NUMBER.findall(text):
        if n not in facts and n.replace(",", "") not in facts.replace(",", ""):
            issues.append(f"the number {n}")
    have = set(dictionary.find(facts))
    allowed_skills = set(dictionary.find(allowed))
    for s in dictionary.find(text):
        if s not in have and s not in allowed_skills:
            issues.append(f"the skill {s}")
    sources = f"{facts}\n{allowed}".lower()
    for sentence in re.split(r"(?<=[.!?:])\s+|\n+", text):
        words = NAME_WORD.findall(sentence)
        first = re.match(r"\W*([A-Za-z0-9&+#.\-']+)", sentence)
        for i, w in enumerate(words):
            if i == 0 and first and first.group(1) == w:
                continue  # the first word of a sentence is capitalised anyway
            if w.lower() in COMMON or _present(w, sources):
                continue
            issues.append(f"the name {w}")
    return issues


def ok(text: str, resume: str, allowed: str = "", typed: str = "") -> bool:
    return not problems(text, resume, allowed, typed)
