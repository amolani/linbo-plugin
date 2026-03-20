"""Tests for delta feed endpoint."""

import pytest
from tests.conftest import auth_headers


@pytest.mark.asyncio
async def test_changes_empty_cursor_returns_full_snapshot(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "nextCursor" in data
    assert isinstance(data["hostsChanged"], list)
    assert isinstance(data["startConfsChanged"], list)
    assert isinstance(data["configsChanged"], list)
    assert isinstance(data["dhcpChanged"], bool)
    assert isinstance(data["deletedHosts"], list)
    assert isinstance(data["deletedStartConfs"], list)


@pytest.mark.asyncio
async def test_changes_invalid_cursor_returns_400(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": "not-a-cursor"}, headers=auth_headers()
    )
    assert resp.status_code == 400
    data = resp.json()
    assert data["error"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_changes_requires_auth(app_client):
    resp = await app_client.get("/api/v1/linbo/changes", params={"since": ""})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_changes_valid_cursor_returns_incremental(app_client):
    # First get a cursor
    resp1 = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    assert resp1.status_code == 200
    cursor = resp1.json()["nextCursor"]

    # Use that cursor for incremental
    resp2 = await app_client.get(
        "/api/v1/linbo/changes", params={"since": cursor}, headers=auth_headers()
    )
    assert resp2.status_code == 200
    data = resp2.json()
    # Incremental with no changes should be empty lists
    assert data["hostsChanged"] == []
    assert data["startConfsChanged"] == []


@pytest.mark.asyncio
async def test_changes_stale_cursor_returns_full_snapshot(app_client):
    # Use a fabricated cursor that was never recorded
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": "999999999:999"}, headers=auth_headers()
    )
    assert resp.status_code == 200
    data = resp.json()
    # Stale cursor should return full snapshot (AC-5)
    assert isinstance(data["hostsChanged"], list)
    assert data["deletedHosts"] == []
    assert data["deletedStartConfs"] == []
