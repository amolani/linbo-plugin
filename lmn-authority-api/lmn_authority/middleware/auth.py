"""Bearer token + IP allowlist authentication middleware."""

from __future__ import annotations

import ipaddress
import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

_SKIP_PATHS = {"/health", "/ready"}


class AuthMiddleware(BaseHTTPMiddleware):
    """Bearer token + IP allowlist authentication."""

    def __init__(
        self,
        app,
        tokens: set[str],
        networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network],
        trust_proxy: bool = False,
    ):
        super().__init__(app)
        self._tokens = tokens
        self._networks = networks
        self._trust_proxy = trust_proxy

    async def dispatch(self, request: Request, call_next):
        # Skip auth for health endpoints
        if request.url.path in _SKIP_PATHS:
            return await call_next(request)

        # 1. Check Bearer token
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={
                    "error": "UNAUTHORIZED",
                    "message": "Missing or invalid Authorization header",
                },
            )

        token = auth[7:]
        if token not in self._tokens:
            return JSONResponse(
                status_code=401,
                content={
                    "error": "UNAUTHORIZED",
                    "message": "Missing or invalid Authorization header",
                },
            )

        # 2. Check IP allowlist (AC-3)
        client_ip = self._get_client_ip(request)
        if not self._is_allowed(client_ip):
            return JSONResponse(
                status_code=403,
                content={
                    "error": "FORBIDDEN",
                    "message": f"Source IP {client_ip} is not in the allowlist",
                },
            )

        # Store token in request state for rate limiter
        request.state.auth_token = token
        return await call_next(request)

    def _get_client_ip(self, request: Request) -> str:
        """Get client IP, respecting X-Forwarded-For if trust_proxy=True (AC-3)."""
        if self._trust_proxy:
            forwarded = request.headers.get("X-Forwarded-For", "")
            if forwarded:
                # First entry is the original client
                return forwarded.split(",")[0].strip()
        # Fall back to direct connection IP
        if request.client:
            return request.client.host
        return ""

    def _is_allowed(self, ip_str: str) -> bool:
        """Check if IP is in allowlist. Empty allowlist allows all."""
        if not self._networks:
            return True
        if not ip_str:
            return False
        try:
            addr = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        return any(addr in net for net in self._networks)
