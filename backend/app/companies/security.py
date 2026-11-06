"""Account security for company admins (and recruiters: the same email-code account) — Phase 2, C1.

  GET    /api/company-account/security              2-step on?, signed-in devices (this one marked)
  POST   /api/company-account/2fa/setup             a new authenticator secret + otpauth link (not on until confirmed)
  POST   /api/company-account/2fa/enable {code}     turns 2-step on
  POST   /api/company-account/2fa/disable {code}    turns it off (needs a current code)
  DELETE /api/company-account/devices/{id}          signs that device out

2-step is free (any authenticator app, TOTP) and optional. With it on, the email-code sign-in also asks for the 6-digit
app code; a code works once. Each session remembers its device (browser and system, from the User-Agent) and network
(a keyed hash of the IP's /24, never the IP itself). A sign-in from a device + network pair this account hasn't used
before emails the person and the main admin of each company they're on, and is listed as an "unusual sign-in" flag in
Admin → Companies. Nm7 has no location lookup (that needs a paid IP database), so "new network" stands in for
"new city".
"""

import re
import time
from typing import Any

import pyotp
from fastapi import APIRouter, Header, Request
from pydantic import Field

from app.audit import audit
from app.auth.sessions import client_ip
from app.core.db import COMPANIES, DB, RECRUITERS
from app.core.email import Email, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import decrypt, encrypt, keyed_hash, same
from app.core.time import now
from app.me.service import ms

router = APIRouter(prefix="/api/company-account", tags=["company security"])
KNOWN_MAX = 20
FLAGS_MAX = 5


def device_label(ua: str) -> str:
    ua = ua or ""
    browser = next(
        (
            b
            for k, b in (
                ("Edg/", "Edge"),
                ("OPR/", "Opera"),
                ("SamsungBrowser", "Samsung Internet"),
                ("Firefox/", "Firefox"),
                ("Chrome/", "Chrome"),
                ("Safari/", "Safari"),
            )
            if k in ua
        ),
        "Browser",
    )
    system = next(
        (
            s
            for k, s in (
                ("Android", "Android"),
                ("iPhone", "iPhone"),
                ("iPad", "iPad"),
                ("Windows", "Windows"),
                ("Mac OS X", "Mac"),
                ("Linux", "Linux"),
            )
            if k in ua
        ),
        "",
    )
    return f"{browser} on {system}" if system else browser


def network_of(request: Request | None) -> str:
    ip = (client_ip(request) if request else None) or "-"
    prefix = ".".join(ip.split(".")[:3]) if re.match(r"^\d+\.\d+\.\d+\.\d+$", ip) else ip.split(":")[:4]
    return keyed_hash("net", str(prefix))[:16]


def device_of(request: Request | None) -> dict[str, str]:
    ua = (request.headers.get("user-agent") if request else "") or ""
    return {"ua": device_label(ua)[:60], "net": network_of(request)}


async def note_sign_in(db, acc: dict[str, Any], device: dict[str, str], mailer=None) -> bool:
    """Remembers this device + network; True (and alerts) when it is new for an account that had others."""
    key = f"{device['ua']}|{device['net']}"
    known = acc.get("known_devices") or []
    if key in known:
        return False
    await db[RECRUITERS].update_one({"_id": acc["_id"]}, {"$set": {"known_devices": (known + [key])[-KNOWN_MAX:]}})
    if not known:
        return False  # the first sign-in is never unusual
    email = acc["email_lc"]
    companies = (
        await db[COMPANIES].find({"members": {"$elemMatch": {"email_lc": email, "status": "active"}}}).to_list(20)
    )
    text = f"New sign-in from {device['ua']} on a network this account hasn't used before."
    for c in companies:
        flags = ((c.get("login_flags") or []) + [{"code": "unusual_login", "text": f"{email}: {text}"}])[-FLAGS_MAX:]
        await db[COMPANIES].update_one({"_id": c["_id"]}, {"$set": {"login_flags": flags}})
    await audit(db, None, "company.unusual_login", target=acc["_id"], data={"device": device["ua"]})
    if mailer:
        to = {email} | {m["email_lc"] for c in companies for m in c.get("members") or [] if m["role"] == "main"}
        body = (
            f"{text}\n\nAccount: {email}\nWhen: {now().strftime('%d %b %Y %H:%M')} UTC\n\n"
            "If this wasn't you or your team, "
            "sign that device out at nm7.si/company (Security) and turn on 2-step sign-in.\n\nNm7 · nm7.si"
        )
        for addr in to:
            await send_safely(
                mailer,
                Email(
                    addr,
                    "",
                    "New sign-in to your Nm7 company account",
                    body,
                    "<p>" + body.replace("\n", "<br>") + "</p>",
                ),
            )
    return True


# ---------- 2-step ----------


def totp_ok(acc: dict[str, Any], code: str) -> int | None:
    """The 30-second step this code belongs to (current or one either side), if newer than the last one used."""
    secret = acc.get("totp_secret_enc")
    if not secret or not (len(code) == 6 and code.isdigit()):
        return None
    totp = pyotp.TOTP(decrypt(secret))
    step = int(time.time() // totp.interval)
    last = acc.get("totp_last_step") if acc.get("totp_last_step") is not None else -1
    for s in (step - 1, step, step + 1):
        if s > last and same(totp.generate_otp(s), code):
            return s
    return None


async def claim(db, acc: dict[str, Any], code: str) -> bool:
    s = totp_ok(acc, code)
    if s is None:
        return False
    r = await db[RECRUITERS].update_one(
        {"_id": acc["_id"], "$or": [{"totp_last_step": None}, {"totp_last_step": {"$lt": s}}]},
        {"$set": {"totp_last_step": s}},
    )
    return r.modified_count == 1


async def _acc(db, session: str | None) -> dict[str, Any]:
    from app.orgs.recruiter_account import account_for

    acc = await account_for(db, session)
    if not acc:
        raise ApiError(401, "session_required", "Please sign in with the code we email you.")
    return acc


def _this(acc: dict[str, Any], session: str | None) -> str | None:
    from app.orgs.recruiter_account import _hash

    h = _hash("session", session or "")
    return next((s.get("id") for s in acc.get("sessions") or [] if same(s["hash"], h)), None)


@router.get("/security")
async def security(db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc = await _acc(db, x_recruiter_account)
    mine = _this(acc, x_recruiter_account)
    t = now()
    devices = [
        {"id": s.get("id"), "device": s.get("ua") or "Browser", "at": ms(s.get("at")), "current": s.get("id") == mine}
        for s in acc.get("sessions") or []
        if s["exp"] > t and s.get("id")
    ]
    return {"twoStep": bool(acc.get("totp_on")), "devices": devices[::-1]}


@router.post("/2fa/setup")
async def setup(db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc = await _acc(db, x_recruiter_account)
    if acc.get("totp_on"):
        raise ApiError(409, "already_on", "2-step sign-in is already on.")
    secret = pyotp.random_base32()
    await db[RECRUITERS].update_one(
        {"_id": acc["_id"]}, {"$set": {"totp_secret_enc": encrypt(secret), "totp_last_step": None}}
    )
    uri = pyotp.TOTP(secret).provisioning_uri(name=acc["email_lc"], issuer_name="Nm7 company")
    return {"secret": secret, "uri": uri}


class TotpIn(CamelModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


@router.post("/2fa/enable")
async def enable(body: TotpIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc = await _acc(db, x_recruiter_account)
    if acc.get("totp_on") or not acc.get("totp_secret_enc"):
        raise ApiError(409, "setup_first", "Start the set-up first.")
    if not await claim(db, acc, body.code):
        raise ApiError(
            400, "wrong_code", "That code didn’t match. Check the time on your phone and try the newest code."
        )
    await db[RECRUITERS].update_one({"_id": acc["_id"]}, {"$set": {"totp_on": True}})
    await audit(db, None, "company.2fa_on", target=acc["_id"])
    return {"twoStep": True}


@router.post("/2fa/disable")
async def disable(body: TotpIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc = await _acc(db, x_recruiter_account)
    if not acc.get("totp_on"):
        raise ApiError(409, "not_on", "2-step sign-in is off.")
    if not await claim(db, acc, body.code):
        raise ApiError(400, "wrong_code", "That code didn’t match.")
    await db[RECRUITERS].update_one({"_id": acc["_id"]}, {"$set": {"totp_on": False, "totp_secret_enc": None}})
    await audit(db, None, "company.2fa_off", target=acc["_id"])
    return {"twoStep": False}


@router.delete("/devices/{device_id}")
async def sign_out_device(device_id: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc = await _acc(db, x_recruiter_account)
    keep = [s for s in acc.get("sessions") or [] if s.get("id") != device_id]
    if len(keep) == len(acc.get("sessions") or []):
        raise ApiError(404, "not_found", "That device isn’t signed in.")
    await db[RECRUITERS].update_one({"_id": acc["_id"]}, {"$set": {"sessions": keep}})
    await audit(db, None, "company.device_signed_out", target=acc["_id"])
    return {"ok": True}
