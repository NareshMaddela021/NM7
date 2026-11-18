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

T6 adds: other sources (a company-wide bank), number / choice questions on WhatsApp, per-question translations
written by the company, and weights. Keep `Knockout` additive (new fields with defaults) so stored rows still read.
"""

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import Field, field_validator

from app.core.schemas import CamelModel

MAX_EXTRA = 5
MAX_ASKED = 6  # the most a call / WhatsApp flow asks (job questions first)
Want = Literal["yes", "no"]


@dataclass(frozen=True)
class Knockout:
    id: str
    text: str
    want: str  # "yes" | "no"
    source: str = "job"  # job | extra (T6: bank, …)
    texts: dict[str, str] = field(default_factory=dict)  # lang → the question in that language

    def text_in(self, lang: str) -> str:
        return self.texts.get(lang) or self.text

    def fits(self, answer: str | None) -> bool | None:
        """True / False, or None when not answered yet."""
        if answer not in ("yes", "no"):
            return None
        return answer == self.want


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


def for_job(j: dict[str, Any]) -> list[Knockout]:
    """Every yes/no knock-out the agent asks for this job (job questions with a rule, then the extra list)."""
    out: list[Knockout] = []
    for q in j.get("questions") or []:
        if q.get("kind") == "yesno" and q.get("want") in ("yes", "no"):
            out.append(Knockout(q["id"], q["text"], q["want"], "job", dict(q.get("texts") or {})))
    for q in j.get("knockouts") or []:
        if q.get("want") in ("yes", "no") and q.get("text"):
            out.append(Knockout(q["id"], q["text"], q["want"], "extra", dict(q.get("texts") or {})))
    return out[:MAX_ASKED]


def reasons(kos: list[Knockout], answers: dict[str, str]) -> list[str]:
    """Why the answers don't fit (plain words for the company's label), [] = a fit. Unanswered ones don't count."""
    return [f"{k.text} – answered {answers[k.id]}" for k in kos if k.fits(answers.get(k.id)) is False]


def company_out(kos: list[Knockout], answers: dict[str, str]) -> list[dict[str, Any]]:
    return [
        {"id": k.id, "text": k.text, "answer": answers.get(k.id) or "", "fits": k.fits(answers.get(k.id))} for k in kos
    ]
