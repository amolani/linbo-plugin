"""Per-token sliding window rate limiter middleware."""

from __future__ import annotations

import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

_SKIP_PATHS = {"/health", "/ready"}


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-token sliding window rate limiter.

    NOTE: In-memory state - only correct with 1 Uvicorn worker (AC-2).
    """

    def __init__(self, app, rpm: int = 60):
        super().__init__(app)
        self._rpm = rpm
        self._windows: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        # Skip rate limit for health endpoints
        if request.url.path in _SKIP_PATHS:
            return await call_next(request)

        token = getattr(request.state, "auth_token", None)
        if not token:
            return await call_next(request)

        now = time.monotonic()
        window = self._windows[token]

        # Remove entries older than 60s
        cutoff = now - 60
        window[:] = [t for t in window if t > cutoff]

        if len(window) >= self._rpm:
            retry_after = int(60 - (now - window[0]))
            return JSONResponse(
                status_code=429,
                content={
                    "error": "RATE_LIMITED",
                    "message": f"Rate limit exceeded. Retry after {retry_after} seconds.",
                },
                headers={"Retry-After": str(max(1, retry_after))},
            )

        window.append(now)
        return await call_next(request)
