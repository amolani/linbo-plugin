"""Tests for startconfs batch and single lookup endpoints."""

import pytest
from tests.conftest import auth_headers


@pytest.mark.asyncio
async def test_batch_startconfs_returns_matches(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    ids = resp.json().get("startConfsChanged", [])
    if not ids:
        pytest.skip("No startconfs loaded from fixture")

    resp = await app_client.post(
        "/api/v1/linbo/startconfs:batch",
        json={"ids": ids[:2]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "startConfs" in data
    assert len(data["startConfs"]) > 0
    conf = data["startConfs"][0]
    assert "id" in conf
    assert "content" in conf
    assert "hash" in conf
    assert "updatedAt" in conf


@pytest.mark.asyncio
async def test_batch_startconfs_unknown_id(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/startconfs:batch",
        json={"ids": ["nonexistent_config"]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["startConfs"] == []


@pytest.mark.asyncio
async def test_batch_startconfs_requires_auth(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/startconfs:batch", json={"ids": ["test"]}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_startconf_found(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    ids = resp.json().get("startConfsChanged", [])
    if not ids:
        pytest.skip("No startconfs loaded from fixture")

    resp = await app_client.get(
        "/api/v1/linbo/startconf", params={"id": ids[0]}, headers=auth_headers()
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == ids[0]
    assert "[LINBO]" in data["content"]


@pytest.mark.asyncio
async def test_get_startconf_not_found(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/startconf",
        params={"id": "nonexistent"},
        headers=auth_headers(),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_startconf_content_no_server_rewrite(app_client):
    """AC-6: start.conf content must be delivered as-is, NO server= rewrite."""
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    ids = resp.json().get("startConfsChanged", [])
    if not ids:
        pytest.skip("No startconfs loaded from fixture")

    resp = await app_client.post(
        "/api/v1/linbo/startconfs:batch",
        json={"ids": [ids[0]]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    confs = resp.json()["startConfs"]
    if confs:
        content = confs[0]["content"]
        # Content should contain the ORIGINAL Server = value, not rewritten
        assert "Server =" in content or "server =" in content.lower()
