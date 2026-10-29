"""Request ids, a JSON answer for unexpected errors, and (optional) error reporting to Sentry.

Every request gets an id (`X-Request-Id` on the answer). An unhandled exception becomes a 500 in the API's own
error shape, carrying that id, and is logged with the traceback under the same id, so a report "it said error
abc123" can be matched to the log line. When SENTRY_DSN is set the exception is also sent to Sentry; without it
nothing else happens."""

import json
import logging
import os
import secrets

from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger("nm7.errors")
HEADER = b"x-request-id"
MESSAGE = "Something went wrong on our side. Please try again in a moment."


def init_sentry(dsn: str, environment: str) -> bool:
    """Starts Sentry when a DSN is set. Never sends personal data (no cookies, headers, bodies or IPs)."""
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:  # the package is optional
        log.warning("SENTRY_DSN is set but sentry-sdk is not installed")
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=os.environ.get("RENDER_GIT_COMMIT") or None,
        send_default_pii=False,
        traces_sample_rate=0,
        max_request_body_size="never",
    )
    return True


def _capture(exc: BaseException, request_id: str) -> None:
    try:
        import sentry_sdk

        if sentry_sdk.is_initialized():
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("request_id", request_id)
                sentry_sdk.capture_exception(exc)
    except Exception:  # reporting must never add a second failure
        log.debug("could not report to Sentry", exc_info=True)


class RequestContext:
    """Pure ASGI (sits inside CORS, so even the 500 carries the CORS headers and the browser can read it)."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = secrets.token_hex(6)
        scope.setdefault("state", {})["request_id"] = request_id
        started = False

        async def send_with_id(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                message["headers"] = [*message.get("headers", []), (HEADER, request_id.encode())]
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception as exc:
            log.exception("request %s %s %s failed", request_id, scope.get("method"), scope.get("path"))
            _capture(exc, request_id)
            from app.admin.daily import count_error  # late: the admin modules import this one

            await count_error()
            if started:  # the answer was already on its way: nothing more can be said
                raise
            body = json.dumps({"error": {"code": "server_error", "message": MESSAGE, "requestId": request_id}})
            data = body.encode()
            headers = [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(data)).encode()),
                (HEADER, request_id.encode()),
            ]
            await send({"type": "http.response.start", "status": 500, "headers": headers})
            await send({"type": "http.response.body", "body": data})
