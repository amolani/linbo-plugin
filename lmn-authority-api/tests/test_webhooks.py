"""Tests for webhook registration stub."""

import pytest
from tests.conftest import auth_headers


@pytest.mark.asyncio
async def test_register_webhook_returns_201(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/webhooks",
        json={
            "url": "https://10.0.0.13:3000/api/v1/webhooks/lmn",
            "events": ["hosts.changed", "startconfs.changed"],
            "secret": "whsec_a1b2c3d4e5f6g7h8",
        },
        headers=auth_headers(),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "id" in data
    assert data["url"] == "https://10.0.0.13:3000/api/v1/webhooks/lmn"
    assert "hosts.changed" in data["events"]
    assert "createdAt" in data


@pytest.mark.asyncio
async def test_register_webhook_requires_auth(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/webhooks",
        json={
            "url": "https://example.com/hook",
            "events": ["hosts.changed"],
            "secret": "whsec_a1b2c3d4e5f6g7h8",
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_register_webhook_validates_events(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/webhooks",
        json={
            "url": "https://example.com/hook",
            "events": [],  # min 1 required
            "secret": "whsec_a1b2c3d4e5f6g7h8",
        },
        headers=auth_headers(),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_webhook_validates_secret_length(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/webhooks",
        json={
            "url": "https://example.com/hook",
            "events": ["hosts.changed"],
            "secret": "short",  # min 16 chars
        },
        headers=auth_headers(),
    )
    assert resp.status_code == 422
