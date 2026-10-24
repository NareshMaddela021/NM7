"""Sending email. Production uses Resend (or Zoho ZeptoMail); dev prints to the log; tests collect messages."""

import logging
from base64 import b64encode
from dataclasses import dataclass, field
from email.utils import parseaddr
from typing import Annotated, Protocol

import httpx
from fastapi import Depends

from app.core.config import get_settings
from app.core.errors import ApiError

log = logging.getLogger("nm7.email")
TIMEOUT = httpx.Timeout(10.0)


@dataclass
class Email:
    to: str
    to_name: str
    subject: str
    text: str
    html: str
    reply_to: str | None = None  # e.g. the customer, for support tickets sent to our inbox
    # (file name, MIME type, bytes) — e.g. an invoice PDF. Kept small: providers cap the whole email (~10 MB).
    attachments: list[tuple[str, str, bytes]] = field(default_factory=list)


class Mailer(Protocol):
    available: bool

    async def send(self, msg: Email) -> None: ...


class ResendMailer:
    """Resend HTTP API: POST https://api.resend.com/emails with a Bearer API key."""

    available = True

    def __init__(self, api_key: str, sender: str, reply_to: str, url: str):
        self.api_key, self.sender, self.reply_to, self.url = api_key, sender, reply_to, url

    async def send(self, msg: Email) -> None:
        body = {
            "from": self.sender,
            "to": [msg.to],
            "subject": msg.subject,
            "html": msg.html,
            "text": msg.text,
            **({"reply_to": msg.reply_to or self.reply_to} if msg.reply_to or self.reply_to else {}),
            **(
                {"attachments": [{"filename": n, "content": b64encode(b).decode()} for n, _, b in msg.attachments]}
                if msg.attachments
                else {}
            ),
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.post(self.url, json=body, headers=headers)
            r.raise_for_status()


class ZeptoMailer:
    available = True

    def __init__(self, token: str, sender: str, reply_to: str, url: str):
        name, address = parseaddr(sender)
        self.token, self.name, self.address, self.reply_to, self.url = token, name or "Nm7", address, reply_to, url

    async def send(self, msg: Email) -> None:
        body = {
            "from": {"address": self.address, "name": self.name},
            "to": [{"email_address": {"address": msg.to, "name": msg.to_name}}],
            "subject": msg.subject,
            "textbody": msg.text,
            "htmlbody": msg.html,
            **({"reply_to": [{"address": msg.reply_to or self.reply_to}]} if msg.reply_to or self.reply_to else {}),
            **(
                {
                    "attachments": [
                        {"name": n, "mime_type": t, "content": b64encode(b).decode()} for n, t, b in msg.attachments
                    ]
                }
                if msg.attachments
                else {}
            ),
        }
        headers = {"Authorization": f"Zoho-enczapikey {self.token}", "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.post(self.url, json=body, headers=headers)
            r.raise_for_status()


class ConsoleMailer:
    """Development: prints the email (including any code) to the server log."""

    available = True

    async def send(self, msg: Email) -> None:
        files = "".join(f"\n[attached: {n}, {len(b)} bytes]" for n, _, b in msg.attachments)
        log.warning("EMAIL to %s — %s\n%s%s", msg.to, msg.subject, msg.text, files)


class MissingMailer:
    """Production without an API key: nothing can be sent (and the content, which holds codes, is never logged)."""

    available = False

    def __init__(self, setting: str):
        self.setting = setting

    async def send(self, msg: Email) -> None:
        raise RuntimeError(f"{self.setting} is not set; email not sent")


def get_mailer() -> Mailer:
    s = get_settings()
    if s.email_provider == "resend":
        if s.resend_api_key:
            return ResendMailer(s.resend_api_key, s.email_from, s.email_reply_to, s.resend_url)
        missing = "RESEND_API_KEY"
    else:
        if s.zeptomail_token:
            return ZeptoMailer(s.zeptomail_token, s.email_from, s.email_reply_to, s.zeptomail_url)
        missing = "ZEPTOMAIL_TOKEN"
    return MissingMailer(missing) if s.is_prod else ConsoleMailer()


EMAIL_UNAVAILABLE = ApiError(503, "email_unavailable", "Email is temporarily unavailable. Please try again later.")


def require_email(mailer: Mailer) -> None:
    """Endpoints that promise "we've emailed you a code" call this first: no key, no promise."""
    if not mailer.available:
        log.error(
            "Email is OFF: %s is not set (EMAIL_PROVIDER=%s). Sign-up, code resend and password reset answer 503 "
            "until it is added on the server.",
            getattr(mailer, "setting", "the email API key"),
            get_settings().email_provider,
        )
        raise EMAIL_UNAVAILABLE


def log_email_status() -> None:
    """At start-up: say clearly if production can't send email."""
    mailer = get_mailer()
    if not mailer.available:
        log.error("Email is OFF: %s is not set (EMAIL_PROVIDER=%s).", mailer.setting, get_settings().email_provider)


async def send_safely(mailer: Mailer, msg: Email) -> bool:
    """Email problems must not break sign-up or payments; they are logged and the user can ask again."""
    try:
        await mailer.send(msg)
        return True
    except httpx.HTTPStatusError as e:
        # Status and provider message only — never the subject or body (they can contain one-time codes).
        log.error("Email to %s refused by provider: HTTP %s %s", msg.to, e.response.status_code, e.response.text[:300])
        return False
    except Exception:
        log.exception("Could not send an email to %s", msg.to)
        return False


MailerDep = Annotated[Mailer, Depends(get_mailer)]


async def send_batch(mailer: Mailer, msgs: list[Email]) -> list[bool]:
    """Many emails at once (organization reminders): Resend's batch API, 100 per call, so a few hundred reminders
    take a few requests and stay inside Resend's rate limit. Other mailers send one by one. Never raises."""
    if not isinstance(mailer, ResendMailer):
        return [await send_safely(mailer, m) for m in msgs]
    out: list[bool] = []
    headers = {"Authorization": f"Bearer {mailer.api_key}", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
        for i in range(0, len(msgs), 100):
            chunk = msgs[i : i + 100]
            body = [
                {
                    "from": mailer.sender,
                    "to": [m.to],
                    "subject": m.subject,
                    "html": m.html,
                    "text": m.text,
                    **({"reply_to": m.reply_to or mailer.reply_to} if m.reply_to or mailer.reply_to else {}),
                }
                for m in chunk
            ]
            try:
                r = await client.post(f"{mailer.url.rstrip('/')}/batch", json=body, headers=headers)
                r.raise_for_status()
                out += [True] * len(chunk)
            except Exception:
                log.exception("A batch of %d emails could not be sent", len(chunk))
                out += [False] * len(chunk)
    return out
