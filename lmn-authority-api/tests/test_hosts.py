"""Tests for host batch and single lookup endpoints."""

import pytest
from tests.conftest import auth_headers


@pytest.mark.asyncio
async def test_batch_hosts_returns_matches(app_client):
    # First check what MACs are available
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    macs = resp.json().get("hostsChanged", [])
    if not macs:
        pytest.skip("No hosts loaded from fixture")

    resp = await app_client.post(
        "/api/v1/linbo/hosts:batch",
        json={"macs": macs[:3]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "hosts" in data
    assert len(data["hosts"]) > 0
    host = data["hosts"][0]
    assert "mac" in host
    assert "hostname" in host
    assert "room" in host
    assert "pxeEnabled" in host


@pytest.mark.asyncio
async def test_batch_hosts_unknown_mac_returns_empty(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/hosts:batch",
        json={"macs": ["FF:FF:FF:FF:FF:FF"]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["hosts"] == []


@pytest.mark.asyncio
async def test_batch_hosts_invalid_mac_returns_400(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/hosts:batch",
        json={"macs": ["not-a-mac"]},
        headers=auth_headers(),
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_batch_hosts_empty_array_returns_422(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/hosts:batch",
        json={"macs": []},
        headers=auth_headers(),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_batch_hosts_requires_auth(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/hosts:batch",
        json={"macs": ["AA:BB:CC:DD:EE:FF"]},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_host_found(app_client):
    # First find a valid MAC
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    macs = resp.json().get("hostsChanged", [])
    if not macs:
        pytest.skip("No hosts loaded from fixture")

    resp = await app_client.get(
        "/api/v1/linbo/host", params={"mac": macs[0]}, headers=auth_headers()
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["mac"] == macs[0]


@pytest.mark.asyncio
async def test_get_host_not_found(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/host",
        params={"mac": "FF:FF:FF:FF:FF:FF"},
        headers=auth_headers(),
    )
    assert resp.status_code == 404
    assert resp.json()["error"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_get_host_invalid_mac(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/host", params={"mac": "invalid"}, headers=auth_headers()
    )
    assert resp.status_code == 400
