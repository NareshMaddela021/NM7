# ruff: noqa: E501  (option tables: one per line)
"""The quick start of each individual role: which steps, which answers, and when a step counts as answered.

The browser has the same rules (frontend/src/lib/quickStart.js); tests keep both honest.

  job seeker: job → city → experience → (Fresher: college → course) → faster
  student:    college → course → looking → age (under-18 parent check; only where Vetting Trust is on) → faster
  expert:     expertise → years → services (L4 reviewer only where the vetting engine is on) → faster

Every step can be skipped; only name, contact and role are required (they come from sign-up and the picker).
"""

from typing import Any, Literal

from pydantic import ConfigDict, Field, field_validator

from app.core.schemas import CamelModel

ROLES = ("jobseeker", "student", "expert")
EXPERIENCE = ("fresher", "0_1", "1_3", "3_5", "5_8", "8_plus")
EXPERIENCE_LABEL = {"fresher": "Fresher", "0_1": "0–1 years", "1_3": "1–3 years", "3_5": "3–5 years",
                    "5_8": "5–8 years", "8_plus": "8+ years"}  # fmt: skip
LOOKING = ("internship", "first_job", "live_project", "learning")
# the same domains as the expert application (frontend/src/lib/expert.js DOMAINS)
DOMAINS = ("Data & analytics", "Software engineering", "Product", "Design", "Finance", "Marketing & HR", "Sales",
           "Operations & supply chain", "Management", "Healthcare", "Education", "Govt / PSU", "Core engineering")  # fmt: skip
YEARS = ("1_3", "3_5", "5_8", "8_12", "12_plus")
SERVICES = ("resume_review", "mock_interview", "career_guidance", "l4_reviewer")
MAX_CITIES = 3


def _clean(v: str) -> str:
    return " ".join(str(v or "").split())


class Answers(CamelModel):
    """One PUT's answers. Unknown keys are refused; null clears an answer."""

    model_config = ConfigDict(extra="forbid")
    job: str | None = Field(None, max_length=80)
    cities: list[str] | None = Field(None, max_length=MAX_CITIES)
    remote: bool | None = None
    experience: Literal[EXPERIENCE] | None = None  # type: ignore[valid-type]
    college: str | None = Field(None, max_length=120)
    course: str | None = Field(None, max_length=80)
    year: int | None = Field(None, ge=1980, le=2040)
    looking: list[Literal[LOOKING]] | None = Field(None, max_length=len(LOOKING))  # type: ignore[valid-type]
    expertise: list[Literal[DOMAINS]] | None = Field(None, max_length=5)  # type: ignore[valid-type]
    years: Literal[YEARS] | None = None  # type: ignore[valid-type]
    services: list[Literal[SERVICES]] | None = Field(None, max_length=len(SERVICES))  # type: ignore[valid-type]
    faster: Literal["used"] | None = None

    @field_validator("job", "college", "course")
    @classmethod
    def _text(cls, v):
        return _clean(v) if v is not None else v

    @field_validator("cities")
    @classmethod
    def _cities(cls, v):
        if v is None:
            return v
        from app.jobsearch.parse import canonical_city

        out: list[str] = []
        for c in v:
            c = canonical_city(_clean(c)[:60])
            if c and c.lower() not in ("remote", "india") and c not in out:
                out.append(c)
        return out

    @field_validator("looking", "expertise", "services")
    @classmethod
    def _unique(cls, v):
        return list(dict.fromkeys(v)) if v is not None else v


# the answers each role's quick start may hold
KEYS: dict[str, tuple[str, ...]] = {
    "jobseeker": ("job", "cities", "remote", "experience", "college", "course", "year", "faster"),
    "student": ("college", "course", "year", "looking", "faster"),
    "expert": ("expertise", "years", "services", "faster"),
}
ALL_STEPS: dict[str, tuple[str, ...]] = {
    "jobseeker": ("job", "city", "experience", "college", "course", "faster"),
    "student": ("college", "course", "looking", "age", "faster"),
    "expert": ("expertise", "years", "services", "faster"),
}


def steps_for(role: str, answers: dict[str, Any], switches: dict[str, bool]) -> list[str]:
    """The steps this person sees now, in order."""
    if role == "jobseeker":
        fresher = ["college", "course"] if answers.get("experience") == "fresher" else []
        return ["job", "city", "experience", *fresher, "faster"]
    if role == "student":
        return ["college", "course", "looking", *(["age"] if switches.get("trust") else []), "faster"]
    return ["expertise", "years", "services", "faster"]


def answered(step: str, a: dict[str, Any]) -> bool:
    if step == "city":
        return bool(a.get("cities")) or bool(a.get("remote"))
    if step == "age":
        return a.get("age") in ("adult", "parent_ok", "parent_asked")
    key = {"job": "job", "experience": "experience", "college": "college", "course": "course", "looking": "looking",
           "expertise": "expertise", "years": "years", "services": "services", "faster": "faster"}[step]  # fmt: skip
    return bool(a.get(key))


def resume(steps: list[str], a: dict[str, Any], skipped: list[str], at: str | None, done: bool) -> str:
    """Where the person picks up: the saved step (or the first), moved past steps already answered or skipped;
    "results" when nothing is left."""
    if done:
        return "results"
    i = steps.index(at) if at in steps else 0
    for s in steps[i:]:
        if not answered(s, a) and s not in skipped:
            return s
    return "results"
