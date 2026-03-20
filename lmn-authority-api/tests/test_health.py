"""Tests for health and readiness endpoints."""

import pytest
from tests.conftest import auth_headers


@pytest.mark.asyncio
async def test_health_returns_ok(app_client):
    resp = await app_client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("ok", "degraded")
    assert "version" in data
    assert "uptime" in data


@pytest.mark.asyncio
async def test_health_no_auth_required(app_client):
    # Health endpoint should work without auth
    resp = await app_client.get("/health")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_ready_returns_status(app_client):
    resp = await app_client.get("/ready")
    # May be 200 or 503 depending on fixture files
    assert resp.status_code in (200, 503)
    data = resp.json()
    assert "ready" in data


@pytest.mark.asyncio
async def test_ready_no_auth_required(app_client):
    resp = await app_client.get("/ready")
    assert resp.status_code in (200, 503)
