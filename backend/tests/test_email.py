import json
import logging

import httpx
import pytest
import respx

from app.core.config import get_settings
from app.core.email import (
    ConsoleMailer,
    Email,
    MissingMailer,
    ResendMailer,
    ZeptoMailer,
    get_mailer,
    send_safely,
)
from tests.conftest import PASSWORD

RESEND = "https://api.resend.com/emails"
MSG = Email("sai@example.com", "Sai", "123456 is your Nm7 code", "Your code: 123456", "<p>123456</p>")


def resend_mailer() -> ResendMailer:
    return ResendMailer("re_test_key", "Nm7 <no-reply@nm7.si>", "info@nm7.si", RESEND)


@respx.mock
async def test_resend_success_request_shape():
    route = respx.post(RESEND).mock(return_value=httpx.Response(200, json={"id": "email_123"}))
    assert await send_safely(resend_mailer(), MSG) is True
    req = route.calls.last.request
    assert req.headers["Authorization"] == "Bearer re_test_key"
    assert json.loads(req.content) == {
        "from": "Nm7 <no-reply@nm7.si>",
        "to": ["sai@example.com"],
        "subject": "123456 is your Nm7 code",
        "html": "<p>123456</p>",
        "text": "Your code: 123456",
        "reply_to": "info@nm7.si",
    }


@respx.mock
async def test_resend_4xx_is_logged_without_the_code(caplog):
    respx.post(RESEND).mock(
        return_value=httpx.Response(
            403, json={"name": "validation_error", "message": "The nm7.si domain is not verified."}
        )
    )
    with caplog.at_level(logging.ERROR, logger="nm7.email"):
        assert await send_safely(resend_mailer(), MSG) is False
    assert "HTTP 403" in caplog.text and "not verified" in caplog.text
    assert "123456" not in caplog.text


@respx.mock
async def test_resend_timeout_is_logged_without_the_code(caplog):
    respx.post(RESEND).mock(side_effect=httpx.ReadTimeout("timed out"))
    with caplog.at_level(logging.ERROR, logger="nm7.email"):
        assert await send_safely(resend_mailer(), MSG) is False
    assert "Could not send an email to sai@example.com" in caplog.text
    assert "123456" not in caplog.text


@respx.mock
async def test_zeptomail_still_available():
    route = respx.post("https://api.zeptomail.in/v1.1/email").mock(return_value=httpx.Response(201, json={}))
    m = ZeptoMailer("tok123", "Nm7 <no-reply@nm7.si>", "info@nm7.si", "https://api.zeptomail.in/v1.1/email")
    assert await send_safely(m, MSG) is True
    req = route.calls.last.request
    body = json.loads(req.content)
    assert req.headers["Authorization"] == "Zoho-enczapikey tok123"
    assert body["from"] == {"address": "no-reply@nm7.si", "name": "Nm7"}
    assert body["to"][0]["email_address"] == {"address": "sai@example.com", "name": "Sai"}
    assert body["reply_to"] == [{"address": "info@nm7.si"}]


@pytest.mark.parametrize(
    ("env", "expected"),
    [
        ({"email_provider": "resend", "resend_api_key": "re_x"}, ResendMailer),
        ({"email_provider": "resend", "resend_api_key": ""}, ConsoleMailer),  # dev: printed to the log
        ({"email_provider": "resend", "resend_api_key": "", "app_env": "prod"}, MissingMailer),
        ({"email_provider": "zeptomail", "zeptomail_token": "z"}, ZeptoMailer),
        ({"email_provider": "zeptomail", "zeptomail_token": "", "app_env": "prod"}, MissingMailer),
    ],
)
def test_provider_selection(monkeypatch, env, expected):
    for k, v in env.items():
        monkeypatch.setattr(get_settings(), k, v)
    assert isinstance(get_mailer(), expected)


def test_defaults():
    s = get_settings()
    assert s.email_provider == "resend"
    assert s.email_from == "Nm7 <no-reply@nm7.si>" and s.email_reply_to == "info@nm7.si"


async def test_production_without_key_answers_503(client, app, monkeypatch, caplog):
    app.dependency_overrides.clear()  # use the real get_mailer
    monkeypatch.setattr(get_settings(), "app_env", "prod")
    monkeypatch.setattr(get_settings(), "resend_api_key", "")
    body = {
        "role": "customer",
        "name": "Sai",
        "email": "sai@example.com",
        "password": PASSWORD,
        "passwordConfirm": PASSWORD,
        "termsAccepted": True,
    }
    with caplog.at_level(logging.ERROR, logger="nm7.email"):
        for path, payload in [
            ("/api/auth/signup", body),
            ("/api/auth/verify-email/resend", {"email": "sai@example.com"}),
            ("/api/auth/password/forgot", {"email": "sai@example.com"}),
        ]:
            r = await client.post(path, json=payload)
            assert r.status_code == 503, path
            assert r.json()["error"] == {
                "code": "email_unavailable",
                "message": "Email is temporarily unavailable. Please try again later.",
            }
    assert "RESEND_API_KEY is not set" in caplog.text
    # Nothing was created or counted against the rate limit.
    r = await client.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    assert r.status_code == 401


@respx.mock
async def test_signup_sends_through_resend(client, app, monkeypatch):
    app.dependency_overrides.clear()
    monkeypatch.setattr(get_settings(), "resend_api_key", "re_test_key")
    route = respx.post(RESEND).mock(return_value=httpx.Response(200, json={"id": "email_1"}))
    r = await client.post(
        "/api/auth/signup",
        json={
            "role": "customer",
            "name": "Sai",
            "email": "sai@example.com",
            "password": PASSWORD,
            "passwordConfirm": PASSWORD,
            "termsAccepted": True,
        },
    )
    assert r.status_code == 201 and r.json()["codeSent"] is True
    sent = json.loads(route.calls.last.request.content)
    assert sent["to"] == ["sai@example.com"] and "Nm7 code" in sent["subject"]
