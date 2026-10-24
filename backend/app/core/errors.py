"""One error shape for the whole API: {"error": {"code", "message", ["fields"]}}."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

HTTP_CODES = {404: "not_found", 405: "method_not_allowed", 413: "too_large", 415: "unsupported_type"}


class ApiError(Exception):
    def __init__(
        self, status: int, code: str, message: str, headers: dict[str, str] | None = None, extra: dict | None = None
    ):
        super().__init__(message)
        self.status, self.code, self.message, self.headers = status, code, message, headers
        self.extra = extra or {}  # more fields in the error object, e.g. which photos


async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": exc.code, "message": exc.message, **exc.extra}}, exc.status, headers=exc.headers
    )


async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [{"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]} for e in exc.errors()]
    body = {"error": {"code": "invalid_input", "message": "Please check the highlighted fields.", "fields": fields}}
    return JSONResponse(body, 422)


async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
    """Starlette's own errors (unknown route, wrong method, a body over the limit) in the same shape."""
    code = HTTP_CODES.get(exc.status_code, "http_error")
    message = exc.detail if isinstance(exc.detail, str) and exc.detail else "Something went wrong."
    return JSONResponse({"error": {"code": code, "message": message}}, exc.status_code, headers=exc.headers)


def install(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(HTTPException, _http_error)
