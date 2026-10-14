"""Sending email. Production uses Zoho ZeptoMail; dev prints to the log; tests collect messages."""

import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.core.config import get_settings

log = logging.getLogger("nm7.email")


@dataclass
class Email:
    to: str
    to_name: str
    subject: str
    text: str
    html: str


class Mailer(Protocol):
    async def send(self, msg: Email) -> None: ...


class ZeptoMailer:
    def __init__(self, token: str, sender: str, url: str):
        self.token, self.sender, self.url = token, sender, url

    async def send(self, msg: Email) -> None:
        body = {
            "from": {"address": self.sender, "name": "Nm7"},
            "to": [{"email_address": {"address": msg.to, "name": msg.to_name}}],
            "subject": msg.subject,
            "textbody": msg.text,
            "htmlbody": msg.html,
        }
        headers = {"Authorization": f"Zoho-enczapikey {self.token}", "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(self.url, json=body, headers=headers)
            r.raise_for_status()


class ConsoleMailer:
    """Development: prints the email (including any code) to the server log."""

    async def send(self, msg: Email) -> None:
        log.warning("EMAIL to %s — %s\n%s", msg.to, msg.subject, msg.text)


class MissingMailer:
    """Production without a ZeptoMail token: never logs the content (codes are secrets)."""

    async def send(self, msg: Email) -> None:
        raise RuntimeError("ZEPTOMAIL_TOKEN is not set; email not sent")


def get_mailer() -> Mailer:
    s = get_settings()
    if s.zeptomail_token:
        return ZeptoMailer(s.zeptomail_token, s.email_from, s.zeptomail_url)
    return MissingMailer() if s.is_prod else ConsoleMailer()


async def send_safely(mailer: Mailer, msg: Email) -> bool:
    """Email problems must not break sign-up or payments; they are logged and the user can ask again."""
    try:
        await mailer.send(msg)
        return True
    except Exception:
        log.exception("Could not send email %r to %s", msg.subject, msg.to)
        return False
