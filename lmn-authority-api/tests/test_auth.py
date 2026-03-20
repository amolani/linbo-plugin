"""Tests for AuthMiddleware."""

from __future__ import annotations

import ipaddress
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from lmn_authority.config import Settings
from lmn_authority.middleware.auth import AuthMiddleware

VALID_TOKEN = "test-token-abc"
TOKENS = {VALID_TOKEN}


def _make_app(
    tokens: set[str] = TOKENS,
    networks: list | None = None,
    trust_proxy: bool = False,
) -> FastAPI:
    """Create a minimal FastAPI app with AuthMiddleware."""
    if networks is None:
        networks = [
            ipaddress.ip_network("127.0.0.0/8"),
            ipaddress.ip_network("10.0.0.0/16"),
        ]

    app = FastAPI()
    app.add_middleware(
        AuthMiddleware,
        tokens=tokens,
        networks=networks,
        trust_proxy=trust_proxy,
    )

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
def app():
    return _make_app()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# -- Basic Auth Tests ----------------------------------------------------------


async def test_no_auth_header(client: AsyncClient):
    """Missing Authorization header returns 401."""
    resp = await client.get("/test")
    assert resp.status_code == 401
    body = resp.json()
    assert body["error"] == "UNAUTHORIZED"


async def test_invalid_token(client: AsyncClient):
    """Invalid token returns 401."""
    resp = await client.get("/test", headers={"Authorization": "Bearer wrong-token"})
    assert resp.status_code == 401


async def test_bearer_prefix_required(client: AsyncClient):
    """Non-Bearer auth scheme returns 401."""
    resp = await client.get("/test", headers={"Authorization": f"Basic {VALID_TOKEN}"})
    assert resp.status_code == 401


async def test_valid_token(client: AsyncClient):
    """Valid token passes through."""
    resp = await client.get("/test", headers={"Authorization": f"Bearer {VALID_TOKEN}"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


# -- Health Endpoints ----------------------------------------------------------


async def test_health_no_auth(client: AsyncClient):
    """/health should not require auth."""
    resp = await client.get("/health")
    assert resp.status_code == 200


async def test_ready_no_auth(client: AsyncClient):
    """/ready should not require auth."""
    resp = await client.get("/ready")
    assert resp.status_code == 200


# -- IP Allowlist Tests --------------------------------------------------------


async def test_ip_allowlist_allowed():
    """IP in allowlist passes through."""
    app = _make_app(networks=[ipaddress.ip_network("127.0.0.0/8")])
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/test", headers={"Authorization": f"Bearer {VALID_TOKEN}"}
        )
        # httpx/ASGI uses 127.0.0.1 by default
        assert resp.status_code == 200


async def test_ip_allowlist_blocked():
    """IP not in allowlist returns 403."""
    # Only allow a subnet that excludes 127.0.0.1
    app = _make_app(networks=[ipaddress.ip_network("192.168.0.0/24")])
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/test", headers={"Authorization": f"Bearer {VALID_TOKEN}"}
        )
        assert resp.status_code == 403
        body = resp.json()
        assert body["error"] == "FORBIDDEN"


# -- Proxy Header Tests --------------------------------------------------------


async def test_proxy_header_trusted():
    """X-Forwarded-For used when trust_proxy=True."""
    app = _make_app(
        networks=[ipaddress.ip_network("10.0.0.0/16")],
        trust_proxy=True,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/test",
            headers={
                "Authorization": f"Bearer {VALID_TOKEN}",
                "X-Forwarded-For": "10.0.0.50, 192.168.1.1",
            },
        )
        assert resp.status_code == 200


async def test_proxy_header_ignored():
    """X-Forwarded-For ignored when trust_proxy=False."""
    app = _make_app(
        networks=[ipaddress.ip_network("10.0.0.0/16")],
        trust_proxy=False,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/test",
            headers={
                "Authorization": f"Bearer {VALID_TOKEN}",
                "X-Forwarded-For": "10.0.0.50",
            },
        )
        # Direct IP is 127.0.0.1 which is NOT in 10.0.0.0/16
        assert resp.status_code == 403


# -- Token File Parsing --------------------------------------------------------


async def test_token_file_parsing(tmp_path: Path):
    """config.resolve_tokens() should parse token file correctly."""
    token_file = tmp_path / "tokens.txt"
    token_file.write_text("# comment\n\nsecret-token-1\nsecret-token-2\n")

    settings = Settings(bearer_tokens_file=token_file)
    tokens = settings.resolve_tokens()
    assert tokens == {"secret-token-1", "secret-token-2"}


async def test_token_file_missing_falls_back_to_env(tmp_path: Path):
    """Missing token file should fall back to bearer_tokens env."""
    settings = Settings(
        bearer_tokens_file=tmp_path / "nonexistent.txt",
        bearer_tokens="fallback-token",
    )
    tokens = settings.resolve_tokens()
    assert tokens == {"fallback-token"}


# -- Empty Networks Allows All -------------------------------------------------


async def test_empty_allowlist_allows_all():
    """Empty network allowlist should allow all IPs."""
    app = _make_app(networks=[])
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/test", headers={"Authorization": f"Bearer {VALID_TOKEN}"}
        )
        assert resp.status_code == 200
