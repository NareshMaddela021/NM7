"""Request bodies have a size limit, checked before anything is parsed (a 512 MB instance must not read a
200 MB JSON document). The limit is per path prefix: photo import carries up to six 10 MB photos as base64."""

import json

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MB = 1024 * 1024
DEFAULT_LIMIT = 2 * MB
LIMITS: list[tuple[str, int]] = [
    ("/api/me/photo-import", 85 * MB),
    ("/api/me/certificates", 3 * MB),
]  # longest prefix first when they overlap
TOO_LARGE = "This request is too large."


def limit_for(path: str, limits: list[tuple[str, int]] = LIMITS, default: int = DEFAULT_LIMIT) -> int:
    for prefix, limit in limits:
        if path.startswith(prefix):
            return limit
    return default


class BodyLimit:
    def __init__(self, app: ASGIApp, limits: list[tuple[str, int]] = LIMITS, default: int = DEFAULT_LIMIT):
        self.app, self.limits, self.default = app, limits, default

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = limit_for(scope["path"], self.limits, self.default)
        declared = next((v for k, v in scope["headers"] if k == b"content-length"), None)
        if declared and declared.isdigit() and int(declared) > limit:
            return await _reject(send)
        seen = 0

        async def guarded() -> Message:  # no Content-Length (chunked): count what arrives
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    raise HTTPException(413, TOO_LARGE)
            return message

        await self.app(scope, guarded, send)


async def _reject(send: Send) -> None:
    body = json.dumps({"error": {"code": "too_large", "message": TOO_LARGE}}).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    await send({"type": "http.response.start", "status": 413, "headers": headers})
    await send({"type": "http.response.body", "body": body})
