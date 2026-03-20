"""Custom exceptions and FastAPI exception handlers."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Base application error."""

    def __init__(self, error: str, message: str, status_code: int = 400, details: dict | None = None):
        self.error = error
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


class NotFoundError(AppError):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__("NOT_FOUND", message, 404, details)


class ValidationError(AppError):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__("VALIDATION_ERROR", message, 400, details)


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Missing or invalid Authorization header"):
        super().__init__("UNAUTHORIZED", message, 401)


class ForbiddenError(AppError):
    def __init__(self, message: str = "Source IP is not in the allowlist"):
        super().__init__("FORBIDDEN", message, 403)


class RateLimitedError(AppError):
    def __init__(self, retry_after: int = 60):
        self.retry_after = retry_after
        super().__init__(
            "RATE_LIMITED",
            f"Rate limit exceeded. Retry after {retry_after} seconds.",
            429,
        )


def register_exception_handlers(app: FastAPI) -> None:
    """Attach all exception handlers to the FastAPI app."""

    @app.exception_handler(AppError)
    async def _app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        body: dict = {"error": exc.error, "message": exc.message}
        if exc.details:
            body["details"] = exc.details
        headers = {}
        if isinstance(exc, RateLimitedError):
            headers["Retry-After"] = str(exc.retry_after)
        return JSONResponse(status_code=exc.status_code, content=body, headers=headers)
