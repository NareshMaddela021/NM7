"""The Chrome Web Store reviewer's demo account (app/autoapply/reviewer.py): how the rest of the code recognises it.
Only the standard library, so anything (the mailer, the route guards, the send points) can use it.

One made-up person, "Priya Sharma (demo)", who signs in at nm7.si/login with email and password so Google's reviewer
can try the Nm7 Apply helper on two practice pages (nm7.si/demo/apply/...). The account is marked demo (left out of
every number, report, morning run and company search, like the other made-up people) and on top of that:
- nothing is ever sent for it: no Auto Apply email, no partner hiring system, no company form, no Nm7 application to
  a company (each send point checks is_reviewer as well as demo);
- no email is ever sent to its address;
- it can't change its password or email, delete the account, pay, upload ID documents or join Ready to join
  (blocked(): the route guard in app/auth/deps.py answers 403 with a plain message).
"""

import re
import uuid

EMAIL = "chrome-review@nm7.si"
NAME = "Priya Sharma (demo)"
ID = str(uuid.uuid5(uuid.NAMESPACE_URL, "https://nm7.si/chrome-web-store-reviewer"))
# the two practice pages on nm7.si (frontend/src/pages/demo/PracticeApply.jsx) the demo jobs' apply links point to
# (the first is the one the test instructions open: its kit is first in Jobs ready, so the helper picks it there)
PRACTICE = (
    ("customer-support-executive", "Customer Support Executive", ["Customer service", "Email", "CRM"]),
    ("junior-data-analyst", "Junior Data Analyst", ["SQL", "Excel", "Power BI"]),
)
PRACTICE_COMPANY = "Demo Tech Solutions"

MESSAGE = (
    "This is the Chrome Web Store review account. It can’t change its password or email, delete the account, "
    "pay, upload ID documents or join Ready to join."
)

# changes the account may never make (reading stays allowed, so its pages still open)
WRITES = ("POST", "PUT", "PATCH", "DELETE")
BLOCKED: tuple[re.Pattern[str], ...] = (
    re.compile(r"^/api/auth/password/"),  # change (forgot / reset are refused in app/auth/router.py)
    re.compile(r"^/api/auth/google(/|$)"),  # connect Google (another way in) or remove it
    re.compile(r"^/api/me/account/"),  # account deletion
    re.compile(r"^/api/orders(/|$)"),  # pay
    re.compile(r"^/api/payments/verify$"),
    re.compile(r"^/api/me/codes/"),  # a code at the pay step
    re.compile(r"^/api/org/[^/]+/billing/"),
    re.compile(r"^/api/me/hire(/confirm)?$"),  # Ready to join: never shown to companies
    re.compile(r"^/api/me/trust/(documents|face)/"),  # ID documents (Aadhaar, DigiLocker), face checks
)


def is_reviewer(who: object) -> bool:
    """A user id, a user document (dict) or a User: is it the reviewer's account?"""
    if isinstance(who, dict):
        return who.get("_id") == ID or str(who.get("email_lc") or who.get("email") or "").strip().lower() == EMAIL
    if isinstance(who, str):
        return who == ID
    uid = getattr(who, "id", None)
    return uid == ID or str(getattr(who, "email_lc", "") or "").lower() == EMAIL


def is_reviewer_address(email: str | None) -> bool:
    return bool(email) and email.strip().lower() == EMAIL


def blocked(method: str, path: str) -> bool:
    return method in WRITES and any(p.match(path) for p in BLOCKED)
