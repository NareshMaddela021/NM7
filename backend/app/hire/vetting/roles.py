# ruff: noqa: E501  (one role a line)
"""The 50 roles with a skill check. `test` is the test's name (the key in the questions and attempts collections, as in
H3: the first 18 keep their names so old results still count). `existing`: one of the 18 H3 tests. `group`: tech,
business, trades or health. `langs`: the languages the paper can be taken in (Telugu and Hindi for roles that don't
need English). `task`: the practical task type after the MCQ (tech = a written mini task graded to a rubric, written =
a written scenario, voice = a spoken reply turned into text in the browser, proof = picture-style situation questions
plus an optional photo of past work)."""

from typing import Literal, TypedDict

Group = Literal["tech", "business", "trades", "health"]
Task = Literal["tech", "written", "voice", "proof"]


class Role(TypedDict):
    slug: str
    test: str
    role: str
    group: Group
    existing: bool
    langs: tuple[str, ...]
    task: Task


EN: tuple[str, ...] = ("en",)
EN_TE_HI: tuple[str, ...] = ("en", "te", "hi")


def _r(slug: str, test: str, role: str, group: Group, existing: bool, task: Task, langs: tuple[str, ...] = EN) -> Role:
    return {
        "slug": slug,
        "test": test,
        "role": role,
        "group": group,
        "existing": existing,
        "langs": langs,
        "task": task,
    }


ROLES: list[Role] = [
    # ---- the 18 H3 tests (names kept) ----
    _r("sql", "SQL", "Data analyst", "tech", True, "tech"),
    _r("python", "Python", "Python developer", "tech", True, "tech"),
    _r("java", "Java", "Java developer", "tech", True, "tech"),
    _r("web-basics", "Web basics", "Front-end (React) developer", "tech", True, "tech"),
    _r("software-testing", "Software testing", "QA / software tester", "tech", True, "tech"),
    _r("excel", "Excel", "Office assistant (Excel)", "business", True, "written"),
    _r("customer-support", "Customer support", "Customer support (voice)", "business", True, "voice"),
    _r("spoken-english", "Spoken English", "Customer support (spoken English)", "business", True, "voice"),
    _r("sales", "Sales", "Field sales executive", "business", True, "voice", EN_TE_HI),
    _r("retail", "Retail", "Retail store associate", "business", True, "voice", EN_TE_HI),
    _r("accounting", "Accounting", "Accounts executive", "business", True, "written"),
    _r("tally-gst", "Tally and GST", "Accounts executive (Tally + GST)", "business", True, "written"),
    _r("data-entry", "Data entry", "Data entry operator", "business", True, "written"),
    _r("delivery", "Delivery and logistics", "Delivery partner", "trades", True, "proof", EN_TE_HI),
    _r("warehouse", "Warehouse", "Warehouse picker / packer", "trades", True, "proof", EN_TE_HI),
    _r("electrical", "Electrical", "Electrician (ITI)", "trades", True, "proof", EN_TE_HI),
    _r("mechanical", "Mechanical basics", "Fitter (ITI)", "trades", True, "proof", EN_TE_HI),
    _r("nursing", "Nursing basics", "Staff nurse (GNM / BSc)", "health", True, "written"),
    # ---- 32 new ----
    _r("fullstack-mern", "Full-stack (MERN)", "Full-stack developer (MERN)", "tech", False, "tech"),
    _r("mobile-dev", "Mobile apps (Android / Flutter)", "Android / Flutter developer", "tech", False, "tech"),
    _r("devops-aws", "DevOps and cloud (AWS basics)", "DevOps / cloud engineer", "tech", False, "tech"),
    _r("data-science", "Data science (ML basics)", "Data scientist", "tech", False, "tech"),
    _r("ui-ux", "UI / UX design", "UI / UX designer", "tech", False, "written"),
    _r("cybersecurity", "Cybersecurity basics", "Cybersecurity analyst (junior)", "tech", False, "tech"),
    _r("business-analyst", "Business analysis", "Business analyst", "tech", False, "written"),
    _r("salesforce-crm", "Salesforce / CRM admin", "Salesforce / CRM admin", "tech", False, "written"),
    _r("it-support", "IT support", "IT support / desktop engineer", "tech", False, "written"),
    _r("cloud-db", "Databases (SQL design)", "Database developer", "tech", False, "tech"),
    _r(
        "support-chat",
        "Customer support (chat / email)",
        "Customer support (chat / email)",
        "business",
        False,
        "written",
    ),
    _r("telecaller", "Telecalling and telesales", "Telecaller / telesales", "business", False, "voice", EN_TE_HI),
    _r("cashier", "Cashier and billing", "Cashier / billing executive", "business", False, "written", EN_TE_HI),
    _r("hr-recruiter", "HR recruiting", "HR recruiter", "business", False, "written"),
    _r("hr-admin", "HR and admin", "HR / admin executive", "business", False, "written"),
    _r("front-office", "Front office", "Receptionist / hotel front desk", "business", False, "voice"),
    _r("digital-marketing", "Digital marketing", "Digital marketing executive", "business", False, "written"),
    _r("content-writing", "Content writing", "Content writer", "business", False, "written"),
    _r("graphic-design", "Graphic design", "Graphic designer", "business", False, "written"),
    _r("back-office", "Operations and back office", "Operations / back-office executive", "business", False, "written"),
    _r("welding", "Welding", "Welder", "trades", False, "proof", EN_TE_HI),
    _r("ac-tech", "AC and refrigeration", "AC / refrigeration technician", "trades", False, "proof", EN_TE_HI),
    _r("two-wheeler", "Two-wheeler mechanic", "Two-wheeler mechanic", "trades", False, "proof", EN_TE_HI),
    _r("cnc", "CNC operation", "CNC operator", "trades", False, "proof", EN_TE_HI),
    _r("plumbing", "Plumbing", "Plumber", "trades", False, "proof", EN_TE_HI),
    _r("security-guard", "Security guard", "Security guard", "trades", False, "proof", EN_TE_HI),
    _r("housekeeping", "Housekeeping", "Housekeeping staff", "trades", False, "proof", EN_TE_HI),
    _r("cook", "Cooking and kitchen", "Cook / kitchen helper", "trades", False, "proof", EN_TE_HI),
    _r("driver", "Driving (LMV)", "Driver (LMV)", "trades", False, "proof", EN_TE_HI),
    _r("pharmacy", "Pharmacy assistant", "Pharmacy assistant", "health", False, "written"),
    _r("lab-tech", "Lab technician", "Lab technician", "health", False, "written"),
    _r("teaching", "Primary teaching and tutoring", "Primary teacher / tutor", "health", False, "written"),
]

BY_SLUG: dict[str, Role] = {r["slug"]: r for r in ROLES}
BY_TEST: dict[str, Role] = {r["test"]: r for r in ROLES}
assert len(ROLES) == 50 and len(BY_SLUG) == 50 and len(BY_TEST) == 50
