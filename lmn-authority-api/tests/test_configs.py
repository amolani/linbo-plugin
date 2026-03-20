"""Tests for parsed configs batch endpoint."""

import pytest
from tests.conftest import auth_headers


@pytest.mark.asyncio
async def test_batch_configs_returns_parsed(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    ids = resp.json().get("configsChanged", [])
    if not ids:
        pytest.skip("No configs loaded from fixture")

    resp = await app_client.post(
        "/api/v1/linbo/configs:batch",
        json={"ids": ids[:2]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "configs" in data
    assert len(data["configs"]) > 0
    config = data["configs"][0]
    assert "id" in config
    assert "name" in config
    assert "osEntries" in config
    assert "partitions" in config
    assert "grubPolicy" in config
    assert "updatedAt" in config


@pytest.mark.asyncio
async def test_batch_configs_os_entries_have_required_fields(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    ids = resp.json().get("configsChanged", [])
    if not ids:
        pytest.skip("No configs loaded from fixture")

    resp = await app_client.post(
        "/api/v1/linbo/configs:batch",
        json={"ids": [ids[0]]},
        headers=auth_headers(),
    )
    configs = resp.json()["configs"]
    if configs and configs[0]["osEntries"]:
        os_entry = configs[0]["osEntries"][0]
        assert "name" in os_entry
        assert "startEnabled" in os_entry
        assert "syncEnabled" in os_entry
        assert "newEnabled" in os_entry


@pytest.mark.asyncio
async def test_batch_configs_partitions_have_required_fields(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    ids = resp.json().get("configsChanged", [])
    if not ids:
        pytest.skip("No configs loaded from fixture")

    resp = await app_client.post(
        "/api/v1/linbo/configs:batch",
        json={"ids": [ids[0]]},
        headers=auth_headers(),
    )
    configs = resp.json()["configs"]
    if configs and configs[0]["partitions"]:
        part = configs[0]["partitions"][0]
        assert "device" in part


@pytest.mark.asyncio
async def test_batch_configs_unknown_id(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/configs:batch",
        json={"ids": ["nonexistent"]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["configs"] == []


@pytest.mark.asyncio
async def test_batch_configs_requires_auth(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/configs:batch", json={"ids": ["test"]}
    )
    assert resp.status_code == 401
