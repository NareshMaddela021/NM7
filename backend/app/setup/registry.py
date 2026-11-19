# ruff: noqa: E501  (one step a line)
"""Profile setup P2: the dashboard checklist of every role, in ONE registry.

Each step: id, its place (the order in the tuple is the order shown and the order the next step is picked in), what it
detects (a pure function of the facts loaded in checklist.py), a one-line reward (never a made-up number), the time it
takes, the page that does it, whether it is required for "Profile complete", the switch it sits behind (hidden from
normal people while that switch is off; testers, demo people and an admin's personas see it) and who it is for.

P3 (company / college checklists) adds its roles here with their own facts loader; P4 (Daily report funnel, Easy
dashboard) reads the same registry, so a step is defined once.

Steps for features that don't exist yet are left out (listed in the PR): phone / WhatsApp verification.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

Status = Literal["done", "waiting", "todo"]


@dataclass(frozen=True)
class Step:
    id: str
    title: str
    reward: str
    minutes: int
    link: str
    detect: Callable[[dict[str, Any]], Status]
    required: bool = True
    switch: str | None = None  # vetting | trust | hire | payments: hidden while this switch is off for the person
    adult_only: bool = False  # under-18s never get it (ID + selfie)
    only: str | None = None  # fresher | experienced | reviewer: shown only to them


def _yes(v: Any) -> Status:
    return "done" if v else "todo"


# ---------- detectors: facts → done / waiting / todo ----------


def preferences(f: dict[str, Any]) -> Status:
    """L1's "Ready to join" parts: expected salary, notice period and a city (or remote)."""
    p = f.get("hire") or {}
    salary = bool((p.get("salary") or {}).get("amount"))
    notice = p.get("notice_days") is not None and p.get("on") is not None
    city = bool(p.get("cities")) or bool(p.get("remote"))
    return _yes(salary and notice and city)


def resume_ats(f: dict[str, Any]) -> Status:
    r = f.get("resume") or {}
    return _yes((r.get("ats") or 0) >= 60)


def first_resume(f: dict[str, Any]) -> Status:
    return _yes((f.get("resume") or {}).get("complete"))


def education(f: dict[str, Any]) -> Status:
    e = f.get("edu") or {}
    return _yes(e.get("institution") and e.get("degree") and e.get("year"))


def practice(f: dict[str, Any]) -> Status:
    return _yes(f.get("practice", 0) > 0)


def skill_badge(f: dict[str, Any]) -> Status:
    if f.get("badges"):
        return "done"
    return "waiting" if f.get("skill_waiting") else "todo"


def identity(f: dict[str, Any]) -> Status:
    if f.get("face") == "verified" or f.get("docs_ok"):
        return "done"
    return "waiting" if f.get("face") == "review" or f.get("docs_review") else "todo"


def interview(f: dict[str, Any]) -> Status:
    if f.get("l3"):
        return "done"
    return "waiting" if f.get("interview_waiting") else "todo"


def auto_apply(f: dict[str, Any]) -> Status:
    return _yes(f.get("auto_apply"))


def skills(f: dict[str, Any]) -> Status:
    return _yes(f.get("skills"))


def college_group(f: dict[str, Any]) -> Status:
    return _yes(f.get("group"))


def first_application(f: dict[str, Any]) -> Status:
    return _yes(f.get("applications", 0) > 0 or f.get("launch"))


def expert_profile(f: dict[str, Any]) -> Status:
    a = (f.get("expert") or {}).get("about") or {}
    p = f.get("expert") or {}
    return _yes(str(a.get("headline", "")).strip() and len(str(a.get("bio", "")).strip()) >= 150 and p.get("photo"))


def expert_services(f: dict[str, Any]) -> Status:
    return _yes(((f.get("expert") or {}).get("services") or {}).get("plans"))


def expert_availability(f: dict[str, Any]) -> Status:
    per_week = ((f.get("expert") or {}).get("services") or {}).get("perWeek")
    ok = isinstance(per_week, int | float) and per_week > 0
    if f.get("reviewer"):
        ok = ok and bool(f.get("reviewer_slots"))
    return _yes(ok)


def calibration(f: dict[str, Any]) -> Status:
    return _yes(f.get("calibrated"))


def payout(f: dict[str, Any]) -> Status:
    return _yes(f.get("payout_ok"))


def submitted(f: dict[str, Any]) -> Status:
    st = f.get("expert_status") or "draft"
    if st == "approved":
        return "done"
    return "waiting" if st in ("review", "testReview") else "todo"


# ---------- the registry ----------

_PREFS = Step(
    "preferences",
    "Add your job preferences",
    "Salary, notice period, job type, shifts and languages. Part of Level 1 (Profile ready), and companies see if you fit.",
    3,
    "/me/hire",
    preferences,
    switch="hire",
)
_IDENTITY = Step(
    "identity",
    "Verify your ID with a selfie or DigiLocker",
    "Companies see “ID verified” on your profile. No camera? Use DigiLocker or ask for a video call.",
    5,
    "/me/settings#s-face",
    identity,
    required=False,
    switch="trust",
    adult_only=True,
)

STEPS: dict[str, tuple[Step, ...]] = {
    "jobseeker": (
        _PREFS,
        Step(
            "education",
            "Add your college, course and passing year",
            "Companies hiring freshers look for it first.",
            2,
            "/me/profile#edu",
            education,
            only="fresher",
        ),
        Step(
            "resume",
            "Get your resume to an ATS score of 60+",
            "Hiring systems can read it. Part of Level 1 (Profile ready). No resume? Build one in the builder.",
            10,
            "/me/ats",
            resume_ats,
        ),
        Step(
            "papers",
            "Try the fresher practice papers",
            "Aptitude, English and basic coding, free. Good practice before a skill check.",
            15,
            "/me/practice",
            practice,
            required=False,
            only="fresher",
        ),
        Step(
            "skill",
            "Pass a skill check and its practical task",
            "Level 2 (Skill verified): companies hiring now see the badge.",
            30,
            "/me/skill-checks",
            skill_badge,
            switch="vetting",
        ),
        _IDENTITY,
        Step(
            "interview",
            "Take the AI interview",
            "Level 3 (Interview-ready): companies can skip their first round.",
            20,
            "/me/interviews",
            interview,
            switch="vetting",
        ),
        Step(
            "autoapply",
            "Turn on Auto Apply",
            "Nm7 applies for you every morning, only within your own rules.",
            3,
            "/me/auto-apply",
            auto_apply,
        ),
    ),
    "student": (
        Step(
            "skills",
            "Add your skills and interests",
            "So we show internships and projects that fit you.",
            3,
            "/me/profile#skills",
            skills,
        ),
        Step(
            "resume",
            "Make your first resume",
            "Every application starts from it. Start from your profile, or upload an old one.",
            10,
            "/me/resumes",
            first_resume,
        ),
        Step(
            "practice",
            "Take a practice test",
            "Free and unlimited. See your strong and weak topics before a real skill check.",
            10,
            "/me/practice",
            practice,
        ),
        Step(
            "skill",
            "Pass a skill check",
            "Companies see a “Skill verified” badge on your profile.",
            30,
            "/me/skill-checks",
            skill_badge,
            switch="vetting",
        ),
        Step(
            "group",
            "Join your college group",
            "Your college’s drives, notices and placement updates in one place.",
            1,
            "/me/groups",
            college_group,
        ),
        Step(
            "apply",
            "Apply for your first internship or job",
            "Your first step into work. Track every application in one place.",
            5,
            "/jobs",
            first_application,
        ),
    ),
    "expert": (
        Step(
            "profile",
            "Complete your expert profile",
            "Headline, bio and photo (LinkedIn if you have it). This is what people see on your expert card.",
            10,
            "/expert/profile#about",
            expert_profile,
        ),
        Step(
            "services",
            "Choose your services",
            "Prices come from Nm7’s price list, so you see what each order pays before you take it.",
            2,
            "/expert/profile#services",
            expert_services,
        ),
        Step(
            "availability",
            "Set your weekly availability",
            "We send you only as much work as you can take each week.",
            2,
            "/expert/profile#services",
            expert_availability,
        ),
        Step(
            "identity",
            "Verify your ID with a selfie",
            "People see “ID verified” on your expert card. No camera? Ask for a video call.",
            5,
            "/me/settings#s-face",
            identity,
            switch="trust",
            adult_only=True,
        ),
        Step(
            "calibration",
            "Pass reviewer calibration",
            "Grade 5 sample interviews. Then you can take skill verification checks.",
            20,
            "/expert/reviewer",
            calibration,
            switch="vetting",
            only="reviewer",
        ),
        Step(
            "payout",
            "Add your payout details",
            "So your earnings reach your bank or UPI.",
            3,
            "/expert/profile#payout",
            payout,
            switch="payments",
        ),
        Step(
            "submit",
            "Submit your application for approval",
            "We check it in 1–2 working days. You can use your other roles while you wait.",
            1,
            "/expert/profile",
            submitted,
        ),
    ),
}

ROLES = tuple(STEPS)


def step_ids(role: str) -> tuple[str, ...]:
    return tuple(s.id for s in STEPS.get(role, ()))
