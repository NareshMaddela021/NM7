"""One error shape for the whole API: {"error": {"code", "message", ["fields"]}}."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.headers = status, code, message, headers


async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, exc.status, headers=exc.headers)


async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [{"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]} for e in exc.errors()]
    body = {"error": {"code": "invalid_input", "message": "Please check the highlighted fields.", "fields": fields}}
    return JSONResponse(body, 422)


def install(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
