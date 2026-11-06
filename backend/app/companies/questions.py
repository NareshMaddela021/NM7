"""Knockout questions on company jobs (Phase 2, C5).

A company job can ask up to 5 short questions, each yes/no, a number or one choice. Each question may carry a rule:
  yesno   want "yes" or "no"         (e.g. "Can you work from Pune?" want yes)
  number  min                        (e.g. "How many months of SQL have you used?" at least 6)
  choice  accept [options]           (e.g. "Which shift suits you?" accept Day, Either)
An answer that breaks a rule marks the application "Not a fit" with the reason in plain words. It is only a label the
company sees next to the applicant, sorted to the bottom of the list: never deleted, never hidden, never auto-rejected.
The rules are not shown to students (only the questions), so answers stay honest.
"""

from typing import Any, Literal

from pydantic import Field, ValidationError, field_validator, model_validator

from app.core.schemas import CamelModel

MAX_QUESTIONS = 5


class QuestionIn(CamelModel):
    text: str = Field(min_length=5, max_length=200)
    kind: Literal["yesno", "number", "choice"]
    options: list[str] = Field(default_factory=list, max_length=6)
    want: Literal["yes", "no", ""] = ""  # yesno: the answer that fits ("" = no rule)
    min: int | None = Field(None, ge=0, le=100_000)  # number: the smallest answer that fits
    accept: list[str] = Field(default_factory=list, max_length=6)  # choice: answers that fit (empty = no rule)

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("options", "accept")
    @classmethod
    def _opts(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for o in v:
            o = " ".join(str(o).split())[:60]
            if o and o.lower() not in (x.lower() for x in out):
                out.append(o)
        return out

    @model_validator(mode="after")
    def _shape(self) -> "QuestionIn":
        if self.kind == "choice":
            if len(self.options) < 2:
                raise ValueError("A choice question needs at least 2 options.")
            low = {o.lower() for o in self.options}
            if any(a.lower() not in low for a in self.accept):
                raise ValueError("The answers that fit must be among the options.")
        else:
            self.options, self.accept = [], []
        if self.kind != "yesno":
            self.want = ""
        if self.kind != "number":
            self.min = None
        return self


def parse(raw: Any) -> tuple[list[dict[str, Any]], list[str]]:
    """The questions as stored on the job ({id, text, kind, options, want, min, accept}), or the problems."""
    if raw in (None, ""):
        return [], []
    if not isinstance(raw, list):
        return [], ["Questions must be a list."]
    if len(raw) > MAX_QUESTIONS:
        return [], [f"Ask at most {MAX_QUESTIONS} questions."]
    out, errors = [], []
    for i, q in enumerate(raw, 1):
        try:
            v = QuestionIn.model_validate(q)
        except ValidationError as e:
            errors.append(f"Question {i}: {e.errors()[0]['msg'].removeprefix('Value error, ')}")
            continue
        out.append({"id": f"q{i}", **v.model_dump()})
    return out, errors


def public(qs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """What students see: the questions without the rules."""
    return [{"id": q["id"], "text": q["text"], "kind": q["kind"], "options": q.get("options") or []} for q in qs or []]


def for_company(qs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [
        {
            "text": q["text"],
            "kind": q["kind"],
            "options": q.get("options") or [],
            "want": q.get("want") or "",
            "min": q.get("min"),
            "accept": q.get("accept") or [],
        }
        for q in qs or []
    ]


def answers_for(qs: list[dict[str, Any]], given: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Clean answers (one per question) or what is missing / not valid."""
    out: dict[str, Any] = {}
    problems: list[str] = []
    for q in qs:
        v = (given or {}).get(q["id"])
        if q["kind"] == "yesno":
            v = str(v or "").lower()
            if v not in ("yes", "no"):
                problems.append(f"Answer: {q['text']}")
                continue
        elif q["kind"] == "number":
            try:
                v = int(str(v).strip())
                if not 0 <= v <= 100_000:
                    raise ValueError
            except (TypeError, ValueError):
                problems.append(f"Give a whole number: {q['text']}")
                continue
        else:
            match = next((o for o in q.get("options") or [] if o.lower() == str(v or "").strip().lower()), None)
            if not match:
                problems.append(f"Choose one: {q['text']}")
                continue
            v = match
        out[q["id"]] = v
    return out, problems


def knockout(qs: list[dict[str, Any]], answers: dict[str, Any]) -> list[str]:
    """Why the answers don't fit the company's rules ([] = a fit)."""
    why: list[str] = []
    for q in qs:
        a = answers.get(q["id"])
        if a is None:
            continue
        if q["kind"] == "yesno" and q.get("want") and a != q["want"]:
            why.append(f"{q['text']} – answered {a}")
        elif q["kind"] == "number" and q.get("min") is not None and a < q["min"]:
            why.append(f"{q['text']} – answered {a} (needs at least {q['min']})")
        elif q["kind"] == "choice" and q.get("accept") and a.lower() not in {x.lower() for x in q["accept"]}:
            why.append(f"{q['text']} – answered {a}")
    return why
