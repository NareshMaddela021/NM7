# ruff: noqa: E501  (long rule patterns and messages read better on one line)
"""Phase 6 S5: the offer checker. Paste an offer letter or send a PDF (its text is read in memory; the file itself is
never stored). Rules decide; AI may explain the findings in plain words (checked: no number that isn't in the letter
or the findings, no promises, never called advice from a lawyer; the rules' own words otherwise).

  POST   /api/me/offer-check {text | pdf (base64), save}   the findings and a verdict
  GET    /api/me/offer-check                               my saved checks (only when I chose Save)
  DELETE /api/me/offer-check/{id}

Checks: a fee or deposit; bond or penalty clauses (the amount and years found); missing basics (company, role, CTC,
joining date, location, signatory); pay far from what similar jobs pay on Nm7 (S4, only with enough data); whether the
company is on Nm7 and its trust level; scam phrases (Admin's list for job posts too). Verdict: "Looks OK", "Check these
points" or "Warning". For a bond we always suggest asking the company's HR or a lawyer. Saving keeps the text with ID
numbers (Aadhaar, PAN, bank) removed, and the result; never the file.
"""

import base64
import binascii
import io
import re
from datetime import timedelta
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter
from pydantic import Field, model_validator

from app.auth.deps import CustomerAuth
from app.core import ai_quota, claude, rate_limit
from app.core.config import get_settings
from app.core.db import COMPANIES, DB, OFFER_CHECKS
from app.core.errors import ApiError
from app.core.pii import scrub_id_numbers
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.seek.salary import range_for, role_for_title
from app.site import get_site

me = APIRouter(prefix="/api/me/offer-check", tags=["job seekers"])

MAX_PDF = 3 * 1024 * 1024
RULES = [(30, timedelta(hours=1))]
FEE = re.compile(
    r"\b(registration|security|training|joining|processing|kit|laptop|uniform|refundable|caution)\s+(fee|fees|deposit|charges?|amount)\b|\bdeposit\b|\bpay\s+(rs\.?|inr|₹)",
    re.I,
)
BOND = re.compile(
    r"\b(bond|service agreement|minimum service|lock-?in|liquidated damages|penalty|serve the company for)\b", re.I
)
MONEY = re.compile(
    r"(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|l\b|k\b)?|([\d.]+)\s*(lakhs?|lacs?|lpa)\b", re.I
)
YEARS = re.compile(r"\b(\d{1,2}|one|two|three|four|five)\s*(?:\(\w+\)\s*)?(years?|months?)\b", re.I)
WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
BASICS = {
    "company": re.compile(r"\b(pvt\.?|private|ltd\.?|limited|llp|inc\.?|technologies|solutions|services|industries)\b", re.I),
    "role": re.compile(r"\b(designation|position|role|post of|job title|appointed as)\b", re.I),
    "ctc": re.compile(r"\b(ctc|cost to company|salary|compensation|stipend|per annum|lpa|gross pay|remuneration)\b", re.I),
    "joining": re.compile(r"\b(date of joining|joining date|join(?:ing)? on|report(?:ing)? on|start date|commence)\b", re.I),
    "location": re.compile(r"\b(location|place of work|posting|work from|based (?:at|in)|office address)\b", re.I),
    "signatory": re.compile(r"\b(authori[sz]ed signatory|signature|signed|hr manager|head of hr|human resources|for and on behalf)\b", re.I),
}  # fmt: skip
BASIC_NAMES = {"company": "the company's full name", "role": "your role or designation", "ctc": "the salary or CTC",
               "joining": "the joining date", "location": "the work location", "signatory": "who signed it (HR or an authorised signatory)"}  # fmt: skip
EXTRA_SCAM = ["pay to confirm", "confirm your seat", "limited seats", "100% placement", "send your aadhaar", "send your pan",
              "gift card", "upi to", "no experience needed earn", "work from home earn"]  # fmt: skip
COMPANY_NAME = re.compile(
    r"([A-Z][A-Za-z&.\- ]{2,60}?\s(?:Pvt\.?\s*Ltd\.?|Private Limited|Limited|Ltd\.?|LLP|Technologies|Solutions))", re.M
)
ROLE_LINE = re.compile(
    r"(?:designation|position|role|post of|appointed as)\s*(?:of|as|:|-)?\s*([A-Za-z][A-Za-z /&\-]{2,50})", re.I
)
CITY_LINE = re.compile(
    r"(?:location|place of work|posting|based (?:at|in))\s*(?:at|in|:|-)?\s*([A-Z][A-Za-z ]{2,30})", re.I
)
NOT_ADVICE = "This is an automatic check of the words in the letter, not a lawyer's opinion. Before you sign anything with a bond or penalty, ask the company's HR or a lawyer to explain it."


def rupees(amount: str, unit: str | None) -> float:
    v = float(amount.replace(",", ""))
    u = (unit or "").lower()
    if u.startswith(("lakh", "lac", "l", "lpa")):
        v *= 100_000
    elif u == "k":
        v *= 1000
    return v


def money_in(text: str) -> list[float]:
    out = []
    for m in MONEY.finditer(text):
        try:
            out.append(rupees(m.group(1) or m.group(3), m.group(2) or m.group(4)))
        except ValueError:
            continue
    return [x for x in out if x >= 100]


def years_in(text: str) -> float | None:
    for m in YEARS.finditer(text):
        g = m.group(1)
        n = int(g) if g.isdigit() else WORDS[g.lower()]
        return n if m.group(2).lower().startswith("year") else round(n / 12, 1)
    return None


def sentences(text: str, rx: re.Pattern) -> list[str]:
    parts = re.split(r"(?<=[.;\n])\s+", text)
    return [" ".join(p.split())[:300] for p in parts if rx.search(p)][:4]


def ctc_yearly(text: str) -> float | None:
    """The CTC in rupees a year, read from the sentence that names it (None when no amount is found)."""
    for s in sentences(text, BASICS["ctc"]):
        amounts = money_in(s)
        if amounts:
            v = max(amounts)
            monthly = re.search(r"\b(per month|a month|monthly|p\.?m\.?)\b", s, re.I)
            return v * 12 if monthly or v < 100_000 else v
    return None


async def rule_check(db, text: str) -> dict[str, Any]:
    site = await get_site(db)
    findings: list[dict[str, Any]] = []
    fee = sentences(text, FEE)
    if fee:
        findings.append({"kind": "fee", "level": "warning", "title": "It asks you to pay a fee or deposit",
                         "detail": "A real employer doesn't ask you to pay to join. Don't pay before you check with the company directly.",
                         "quotes": fee})  # fmt: skip
    bond = sentences(text, BOND)
    if bond:
        joined = " ".join(bond)
        amount = max(money_in(joined), default=None)
        years = years_in(joined)
        bits = [f"₹{amount:,.0f}" if amount else "", f"{years:g} year(s)" if years else ""]
        findings.append({"kind": "bond", "level": "warning" if amount else "check",
                         "title": "There is a bond or penalty" + (f" ({', '.join(b for b in bits if b)})" if any(bits) else ""),
                         "detail": "Read what you would pay if you leave early, and for how long it applies. Ask the company's HR or a lawyer before you sign.",
                         "quotes": bond, "amount": amount, "years": years})  # fmt: skip
    missing = [k for k, rx in BASICS.items() if not rx.search(text)]
    if missing:
        findings.append({"kind": "missing", "level": "check", "title": "Some basics are missing",
                         "detail": "A clear offer names " + ", ".join(BASIC_NAMES[k] for k in missing) + ". Ask the company to add them.",
                         "missing": missing})  # fmt: skip
    low = text.lower()
    scam = [p for p in {*(site.get("job_checks") or {}).get("scam", []), *EXTRA_SCAM} if p and p.lower() in low]
    if scam and not fee:
        findings.append({"kind": "scam", "level": "warning", "title": "It uses words often seen in fake offers",
                         "detail": "Phrases found: " + ", ".join(sorted(scam)[:6]) + ". Check the company before you share documents or pay anything.",
                         "phrases": sorted(scam)[:6]})  # fmt: skip
    # the company on Nm7
    name = (COMPANY_NAME.search(text) or [None, ""])[1].strip() if COMPANY_NAME.search(text) else ""
    company = None
    if name:
        core = re.sub(r"\s(Pvt\.?\s*Ltd\.?|Private Limited|Limited|Ltd\.?|LLP)$", "", name, flags=re.I).strip()
        c = await db[COMPANIES].find_one({"details.legal_name": {"$regex": f"^{re.escape(core)}", "$options": "i"}, "demo": {"$ne": True}},
                                         {"details.legal_name": 1, "trust": 1, "score": 1, "slug": 1})  # fmt: skip
        if c:
            company = {"name": c["details"]["legal_name"], "trust": c.get("trust") or "basic",
                       "score": (c.get("score") or {}).get("value"), "slug": c.get("slug")}  # fmt: skip
        else:
            findings.append({"kind": "company", "level": "check", "title": f"{name} isn't on Nm7",
                             "detail": "That alone isn't a problem. Check the company's website and that the email came from its own domain, not a free email address."})  # fmt: skip
    # pay vs what similar jobs pay on Nm7 (S4; only with enough data)
    ctc = ctc_yearly(text)
    role_txt = (ROLE_LINE.search(text) or [None, ""])[1] if ROLE_LINE.search(text) else ""
    city = (CITY_LINE.search(text) or [None, ""])[1].strip() if CITY_LINE.search(text) else ""
    pay = None
    role = role_for_title(role_txt) if role_txt else None
    if ctc and role:
        r = (await range_for(db, role, city, "start")) if city else None
        r = r or await range_for(db, role, "", "start")
        if r:
            monthly = ctc / 12
            pay = {
                "monthly": round(monthly),
                "min": r["min"],
                "max": r["max"],
                "jobs": r["jobs"],
                "role": role["title"],
            }
            if monthly > 2.5 * r["max"]:
                findings.append({"kind": "pay", "level": "check", "title": "The pay is much higher than similar jobs on Nm7",
                                 "detail": f"Similar starting jobs pay ₹{r['min']:,}–₹{r['max']:,} a month (based on {r['jobs']} jobs). Very high pay for a fresher can be a sign of a fake offer: confirm it with the company."})  # fmt: skip
            elif monthly < 0.5 * r["min"]:
                findings.append({"kind": "pay", "level": "check", "title": "The pay is much lower than similar jobs on Nm7",
                                 "detail": f"Similar starting jobs pay ₹{r['min']:,}–₹{r['max']:,} a month (based on {r['jobs']} jobs). You can ask about it before you accept."})  # fmt: skip
    levels = {f["level"] for f in findings}
    verdict = "warning" if "warning" in levels else "check" if findings else "ok"
    facts = {"company": name, "role": role_txt.strip(), "city": city, "ctc": round(ctc) if ctc else None}
    return {"verdict": verdict, "findings": findings, "company": company, "pay": pay, "facts": facts}


VERDICT = {"ok": "Looks OK", "check": "Check these points", "warning": "Warning"}
PROMISE = re.compile(r"\b(guarantee|definitely|100%|legal advice|safe to sign|you must)\b", re.I)


def rule_summary(r: dict[str, Any]) -> str:
    if not r["findings"]:
        return "We found no fee, bond or missing basics in this letter. Still confirm it with the company before you resign anywhere or share documents."
    return " ".join(f["title"] + "." for f in r["findings"][:4])


def check_explain(text: str, r: dict[str, Any]):
    allowed = set(re.findall(r"\d[\d,]*", text + " " + str(r["findings"]) + " " + str(r["pay"])))

    def check(raw: Any) -> str:
        s = " ".join(str((raw or {}).get("explanation") or "").split())
        if not 20 <= len(s) <= 600 or PROMISE.search(s):
            raise claude.Unusable("explanation")
        for n in re.findall(r"\d[\d,]*", s):
            if n not in allowed:
                raise claude.Unusable("number")
        return s

    return check


async def ai_explain(db, uid: str, text: str, r: dict[str, Any]) -> str | None:
    if not get_settings().anthropic_api_key:
        return None
    if not await ai_quota.take(db, "offers", uid):
        return None
    schema = {"type": "object", "properties": {"explanation": {"type": "string"}}, "required": ["explanation"]}
    content = ("Explain these offer-letter check findings to an Indian fresher in 2-4 short, plain sentences. Use only "
               "the findings; no new numbers; no promises; don't call it legal advice. Findings: "
               + str([{k: f.get(k) for k in ("title", "detail")} for f in r["findings"]]))  # fmt: skip
    try:
        return await claude.ask_models("offers", content, schema, check_explain(text, r), max_tokens=300, effort="low",
                                       timeout_s=20, retries=1)  # fmt: skip
    except Exception:  # noqa: BLE001  (any failure, Unusable included: the rules' words)
        await ai_quota.note(db, "offers", "fallback")
        return None


class CheckIn(CamelModel):
    text: str = Field("", max_length=30_000)
    pdf: str = Field("", max_length=MAX_PDF * 2)  # base64
    save: bool = False
    label: str = Field("", max_length=80)

    @model_validator(mode="after")
    def _one(self):
        if not self.pdf and len(self.text.strip()) < 40:
            raise ValueError("Paste the offer letter's text (a few lines at least) or choose its PDF.")
        return self


def pdf_text(b64: str) -> str:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        raw = base64.b64decode(b64.split(",")[-1], validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, "bad_pdf", "That file couldn't be read. Try again or paste the text.") from None
    if len(raw) > MAX_PDF or not raw.startswith(b"%PDF"):
        raise ApiError(422, "bad_pdf", "Choose a PDF of 3 MB or less, or paste the text.")
    try:
        text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(raw)).pages[:10])
    except (PdfReadError, ValueError, KeyError):
        raise ApiError(422, "bad_pdf", "That PDF couldn't be read. Paste the text instead.") from None
    if len(text.strip()) < 40:
        raise ApiError(422, "no_text", "This PDF has no text we can read (it may be a scan). Paste the text instead.")
    return text  # read in memory only: the file is never stored


def out(doc: dict[str, Any]) -> dict[str, Any]:
    r = doc["result"]
    return {"id": str(doc["_id"]) if doc.get("_id") else None, "label": doc.get("label") or "", "at": ms(doc.get("at")),
            "verdict": r["verdict"], "verdictText": VERDICT[r["verdict"]], "findings": r["findings"], "company": r["company"],
            "pay": r["pay"], "facts": r["facts"], "explanation": doc.get("explanation") or rule_summary(r),
            "note": NOT_ADVICE, "saved": bool(doc.get("_id"))}  # fmt: skip


@me.post("")
async def check(body: CheckIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    key = f"offer-check:{auth.user.id}"
    await rate_limit.check(db, key, RULES)
    await rate_limit.record(db, key)
    text = pdf_text(body.pdf) if body.pdf else body.text
    r = await rule_check(db, text)
    explanation = await ai_explain(db, auth.user.id, text, r) if r["findings"] else None
    doc: dict[str, Any] = {"user_id": auth.user.id, "label": body.label.strip(), "at": now(), "result": r,
                           "explanation": explanation}  # fmt: skip
    if body.save:  # only on Save, and only the text without ID numbers: never the file
        clean, _ = scrub_id_numbers(text)  # Aadhaar, PAN and bank numbers removed
        doc["text"] = clean[:30_000]
        doc["_id"] = (await db[OFFER_CHECKS].insert_one(dict(doc))).inserted_id
    return out(doc)


@me.get("")
async def saved(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    rows = db[OFFER_CHECKS].find({"user_id": auth.user.id}, {"text": 0}).sort("at", -1).limit(20)
    return [out(d) async for d in rows]


@me.delete("/{cid}")
async def remove(cid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    try:
        oid = ObjectId(cid)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That check isn't here.") from None
    if not (await db[OFFER_CHECKS].delete_one({"_id": oid, "user_id": auth.user.id})).deleted_count:
        raise ApiError(404, "not_found", "That check isn't here.")
    return {"deleted": cid}
