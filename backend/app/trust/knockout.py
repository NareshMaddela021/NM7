# ruff: noqa: E501  (dense docstrings)
"""Knock-out questions, the shared model (Vetting Trust T5; T6 makes them self-serve for companies and extends this).

A knock-out is one short yes/no question with the answer that fits ("Can you work night shifts?" want yes). It is only
ever a label for the company ("Not a fit: answered no to …"): never an automatic rejection, never hidden from the
company, and the rule (which answer fits) is never shown to the candidate, so answers stay honest.

Where they come from, in order (ids are stable, so answers stay attached when the list changes):
  job     the job's own yes/no questions with a rule (`jobs.questions`, kind yesno, want yes/no; app/companies/questions.py)
          id "q1".."q5", the same ids the apply form uses, so an answer given on WhatsApp / a call is the answer to the
          apply-form question
  extra   a simple per-job list the company adds for the calling agent (`jobs.knockouts`, additive: [{id k1.., text,
          want}]), up to MAX_EXTRA
Each may carry the question in Hindi / Telugu (`texts`: {lang: text}); without it the company's own words are used.

T6 (self-serve, this file): the job's number questions (at least `min`) and single-choice questions (`accept`) are
knock-outs too, so WhatsApp and the AI call ask them (a number, or one of the options); templates for the common ones
(night shifts, a two-wheeler, joining now, relocating, …) that Work preferences can answer once for every job; and the
check that refuses questions about gender, religion, caste, age, marital status, pregnancy or photos / looks (the form
warns as the company types; the server refuses on post and edit). Keep `Knockout` additive (new fields with defaults)
so stored rows still read.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import Field, field_validator

from app.core.schemas import CamelModel

MAX_EXTRA = 5
MAX_ASKED = 8  # the most a call / WhatsApp flow asks (job questions first); T6: up to 8 job questions
MAX_SELF_SERVE = 8  # T6: questions a company may put on one job while the Trust switch lets it in (else 5, as before)
Want = Literal["yes", "no"]


@dataclass(frozen=True)
class Knockout:
    id: str
    text: str
    want: str  # "yes" | "no" ("" for number / choice questions)
    source: str = "job"  # job | extra (T6: bank, …)
    texts: dict[str, str] = field(default_factory=dict)  # lang → the question in that language
    kind: str = "yesno"  # T6: yesno | number | choice
    min: int | None = None  # number: the smallest answer that fits
    options: tuple[str, ...] = ()  # choice: what the person picks from
    accept: tuple[str, ...] = ()  # choice: the options that fit

    def text_in(self, lang: str) -> str:
        return self.texts.get(lang) or self.text

    def clean(self, answer: Any) -> Any:
        """The answer in its stored form ("yes"/"no", an int, the option's own spelling), or None when it isn't one."""
        if self.kind == "number":
            return parse_number(answer)
        if self.kind == "choice":
            return pick_option(self.options, answer)
        a = str(answer or "").strip().lower()
        return a if a in ("yes", "no") else None

    def fits(self, answer: Any) -> bool | None:
        """True / False, or None when not answered yet."""
        a = self.clean(answer)
        if a is None:
            return None
        if self.kind == "number":
            return self.min is None or a >= self.min
        if self.kind == "choice":
            return not self.accept or a.lower() in {x.lower() for x in self.accept}
        return a == self.want


class KnockoutIn(CamelModel):
    text: str = Field(min_length=5, max_length=200)
    want: Want = "yes"
    texts: dict[str, str] = Field(default_factory=dict)

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("texts")
    @classmethod
    def _texts(cls, v: dict[str, str]) -> dict[str, str]:
        return {k: " ".join(str(t).split())[:200] for k, t in v.items() if k in ("hi", "te") and str(t).strip()}


def parse_extra(raw: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """The company's extra list as stored on the job ([{id, text, want, texts}]); raises ValueError on a bad one."""
    items = [KnockoutIn.model_validate(x) for x in (raw or [])]
    if len(items) > MAX_EXTRA:
        raise ValueError(f"Add at most {MAX_EXTRA} yes/no questions.")
    return [{"id": f"k{i}", **k.model_dump()} for i, k in enumerate(items, 1)]


def parse_number(v: Any) -> int | None:
    """A whole number 0–100,000 from an answer: 12, "12", "12 months", "about 6", and Hindi / Telugu digits ("१२")."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v if 0 <= v <= 100_000 else None
    s = "".join(str(unicodedata.digit(c)) if c.isdigit() else c for c in str(v or ""))
    m = re.search(r"\d{1,6}", s)
    if not m:
        return None
    n = int(m.group(0))
    return n if n <= 100_000 else None


def pick_option(options: tuple[str, ...] | list[str], v: Any) -> str | None:
    """The option an answer names: its text (any case) or its number in the list ("2", "option 2")."""
    s = " ".join(str(v or "").split()).strip().lower()
    if not s:
        return None
    for o in options:
        if o.lower() == s:
            return o
    n = parse_number(s) if re.fullmatch(r"(?:#|no\.?\s*|number\s*|option\s*)?\d{1,2}", s) else None
    if n and 1 <= n <= len(options):
        return options[n - 1]
    return None


def for_job(j: dict[str, Any]) -> list[Knockout]:
    """Every knock-out the agent asks for this job (job questions with a rule, then the extra list). T6: number
    questions with a minimum and choice questions with answers that fit are asked too."""
    out: list[Knockout] = []
    for q in j.get("questions") or []:
        texts = dict(q.get("texts") or {})
        if q.get("kind") == "yesno" and q.get("want") in ("yes", "no"):
            out.append(Knockout(q["id"], q["text"], q["want"], "job", texts))
        elif q.get("kind") == "number" and q.get("min") is not None:
            out.append(Knockout(q["id"], q["text"], "", "job", texts, "number", int(q["min"])))
        elif q.get("kind") == "choice" and q.get("accept") and len(q.get("options") or []) >= 2:
            out.append(
                Knockout(q["id"], q["text"], "", "job", texts, "choice", None, tuple(q["options"]), tuple(q["accept"]))
            )
    for q in j.get("knockouts") or []:
        if q.get("want") in ("yes", "no") and q.get("text"):
            out.append(Knockout(q["id"], q["text"], q["want"], "extra", dict(q.get("texts") or {})))
    return out[:MAX_ASKED]


def reasons(kos: list[Knockout], answers: dict[str, Any]) -> list[str]:
    """Why the answers don't fit (plain words for the company's label), [] = a fit. Unanswered ones don't count."""
    out = []
    for k in kos:
        if k.fits(answers.get(k.id)) is False:
            a = k.clean(answers.get(k.id))
            out.append(f"{k.text} – answered {a}" + (f" (needs at least {k.min})" if k.kind == "number" else ""))
    return out


def not_met(kos: list[Knockout], answers: dict[str, Any]) -> list[str]:
    """T6: the questions whose answers don't fit, for "Not a fit for: <question>"."""
    return [k.text for k in kos if k.fits(answers.get(k.id)) is False]


def company_out(kos: list[Knockout], answers: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"id": k.id, "text": k.text, "kind": k.kind, "answer": "" if answers.get(k.id) is None else answers.get(k.id),
         "fits": k.fits(answers.get(k.id))}
        for k in kos
    ]  # fmt: skip


# --- T6: templates for the common questions --------------------------------------------------------------------------

# `pref` is the Work preferences answer that answers the question for every job (app/trust/workprefs.py), so the person
# is never asked twice. The texts are fixed: the saved-answer key is the question's words.
TEMPLATES: list[dict[str, Any]] = [
    {"key": "night_shift", "text": "Are you willing to work night shifts?", "kind": "yesno", "want": "yes", "pref": "night_shift"},
    {"key": "two_wheeler", "text": "Do you have a two-wheeler?", "kind": "yesno", "want": "yes", "pref": "vehicle"},
    {"key": "immediate", "text": "Can you join immediately?", "kind": "yesno", "want": "yes", "pref": "available_now"},
    {"key": "relocate", "text": "Are you willing to relocate for this job?", "kind": "yesno", "want": "yes", "pref": "relocate"},
    {"key": "weekends", "text": "Can you work on weekends?", "kind": "yesno", "want": "yes", "pref": "weekends"},
    {"key": "licence", "text": "Do you have a valid driving licence?", "kind": "yesno", "want": "yes", "pref": "licence"},
    {"key": "shift", "text": "Which shift suits you?", "kind": "choice", "options": ["Day", "Night", "Rotational"],
     "accept": ["Day", "Night", "Rotational"], "pref": "shift"},
    {"key": "experience", "text": "How many months of experience do you have in this kind of work?", "kind": "number", "min": 6},
    {"key": "notice", "text": "How many days of notice do you need to give?", "kind": "number", "pref": "notice_days"},
]  # fmt: skip
TEMPLATE_KEYS = {t["key"] for t in TEMPLATES}


def template_for(q: dict[str, Any]) -> dict[str, Any] | None:
    """The template a stored question came from (by its key, or by the very same words)."""
    key = q.get("template")
    for t in TEMPLATES:
        if t["key"] == key or t["text"].lower() == str(q.get("text") or "").strip().lower():
            return t
    return None


# --- T6: no discriminatory questions -----------------------------------------------------------------------------------

# Words that make a question about a person rather than the work. Checked on the question and its options. Word
# boundaries keep "language", "manage", "wage" and "single choice" out. The frontend gets the same patterns.
BLOCKED_TOPICS: dict[str, dict[str, Any]] = {
    "gender": {"label": "gender", "words": [r"gender", r"male", r"female", r"man or (?:a )?woman", r"woman or (?:a )?man",
               r"sex", r"boys?", r"girls?", r"transgender", r"pronouns?"]},
    "religion": {"label": "religion", "words": [r"religio(?:n|us)", r"hindu", r"muslim", r"christian", r"sikh", r"jain",
                 r"buddhist", r"parsi", r"namaz"]},
    "caste": {"label": "caste", "words": [r"castes?", r"sub-?castes?", r"jati", r"sc ?/ ?st", r"obc", r"scheduled (?:caste|tribe)s?",
              r"dalit", r"brahmin", r"community certificate", r"gotra"]},
    "age": {"label": "age", "words": [r"age", r"aged", r"how old", r"years old", r"date of birth", r"dob", r"birth ?day",
            r"born (?:in|on|after|before)", r"year of birth"]},
    "marital": {"label": "marital status", "words": [r"marri(?:ed|age)", r"marital", r"unmarried", r"spouse", r"husband",
                r"wife", r"are you single", r"divorced?", r"widow(?:ed|er)?", r"family planning"]},
    "pregnancy": {"label": "pregnancy", "words": [r"pregnan(?:t|cy)", r"maternity", r"expecting a (?:baby|child)",
                  r"planning (?:a|to have a) (?:baby|child|family)"]},
    "photo": {"label": "photos or looks", "words": [r"photo(?:graph)?s?", r"pictures?", r"selfie", r"pic", r"how (?:do )?you look",
              r"your looks", r"appearance", r"complexion", r"fair skin", r"skin colou?r", r"good[- ]looking",
              r"beautiful", r"handsome", r"attractive"]},
}  # fmt: skip
_TOPIC_RX = {k: re.compile(r"\b(?:" + "|".join(v["words"]) + r")\b", re.IGNORECASE) for k, v in BLOCKED_TOPICS.items()}


def discriminatory(text: str, options: list[str] | None = None) -> str | None:
    """The topic a question asks about that has nothing to do with the work (gender, religion, …), or None."""
    blob = " ".join([str(text or ""), *(str(o) for o in options or [])])
    for k, rx in _TOPIC_RX.items():
        if rx.search(blob):
            return k
    return None


def refusal(topic: str) -> str:
    return (f"Questions about {BLOCKED_TOPICS[topic]['label']} aren't allowed: ask only about the work (shifts, "
            "travel, skills, when someone can join).")  # fmt: skip


def patterns() -> dict[str, str]:
    """The patterns for the form's live warning (JavaScript regex source, case-insensitive)."""
    return {k: r"\b(?:" + "|".join(v["words"]) + r")\b" for k, v in BLOCKED_TOPICS.items()}
