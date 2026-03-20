"""Tests for RateLimitMiddleware."""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from starlette.middleware.base import BaseHTTPMiddleware

from lmn_authority.middleware.rate_limit import RateLimitMiddleware


def _make_app(rpm: int = 60) -> FastAPI:
    """Create a test app with a fake auth state injector and rate limiter."""
    app = FastAPI()

    # Inject a fake auth token so the rate limiter has something to key on
    class FakeAuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            token = request.headers.get("X-Test-Token", "default-token")
            if request.url.path not in ("/health", "/ready"):
                request.state.auth_token = token
            return await call_next(request)

    # Order: add_middleware wraps outermost-last. FakeAuth must run before
    # RateLimit so the token is available. FakeAuth added last = outermost.
    app.add_middleware(RateLimitMiddleware, rpm=rpm)
    app.add_middleware(FakeAuthMiddleware)

    @app.get("/test")
    async def test_endpoint():
        return {"ok": True}

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    @app.get("/ready")
    async def ready():
        return {"status": "ready"}

    return app


@pytest.fixture
async def client():
    app = _make_app(rpm=5)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# -- Basic Rate Limit Tests ----------------------------------------------------


async def test_under_limit(client: AsyncClient):
    """Requests under the limit should pass."""
    for _ in range(5):
        resp = await client.get("/test")
        assert resp.status_code == 200


async def test_at_limit(client: AsyncClient):
    """The request exceeding the limit returns 429."""
    for _ in range(5):
        resp = await client.get("/test")
        assert resp.status_code == 200

    resp = await client.get("/test")
    assert resp.status_code == 429
    body = resp.json()
    assert body["error"] == "RATE_LIMITED"


async def test_retry_after_header(client: AsyncClient):
    """429 response should have Retry-After header."""
    for _ in range(5):
        await client.get("/test")

    resp = await client.get("/test")
    assert resp.status_code == 429
    assert "retry-after" in resp.headers
    retry_val = int(resp.headers["retry-after"])
    assert 1 <= retry_val <= 60


async def test_window_slides():
    """After 60s, requests should be allowed again."""
    app = _make_app(rpm=3)

    # We'll patch time.monotonic to simulate passage of time
    base_time = 1000.0

    with patch("lmn_authority.middleware.rate_limit.time") as mock_time:
        mock_time.monotonic.return_value = base_time

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # Use up all 3
            for _ in range(3):
                resp = await client.get("/test")
                assert resp.status_code == 200

            # 4th should fail
            resp = await client.get("/test")
            assert resp.status_code == 429

            # Advance time by 61 seconds
            mock_time.monotonic.return_value = base_time + 61

            # Should work again
            resp = await client.get("/test")
            assert resp.status_code == 200


async def test_per_token_isolation():
    """Different tokens should have separate rate limit windows."""
    app = _make_app(rpm=2)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        # Token A: 2 requests
        for _ in range(2):
            resp = await client.get("/test", headers={"X-Test-Token": "token-A"})
            assert resp.status_code == 200

        # Token A: 3rd request blocked
        resp = await client.get("/test", headers={"X-Test-Token": "token-A"})
        assert resp.status_code == 429

        # Token B: should still have quota
        resp = await client.get("/test", headers={"X-Test-Token": "token-B"})
        assert resp.status_code == 200


async def test_health_exempt():
    """/health and /ready should not be rate limited."""
    app = _make_app(rpm=1)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        # Use up the single allowed request
        resp = await client.get("/test")
        assert resp.status_code == 200

        resp = await client.get("/test")
        assert resp.status_code == 429

        # Health endpoints should still work
        resp = await client.get("/health")
        assert resp.status_code == 200

        resp = await client.get("/ready")
        assert resp.status_code == 200
