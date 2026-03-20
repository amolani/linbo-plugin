"""Tests for DHCP export and reservation endpoints."""

import pytest
from tests.conftest import auth_headers


@pytest.mark.asyncio
async def test_batch_reservations_returns_data(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/changes", params={"since": ""}, headers=auth_headers()
    )
    macs = resp.json().get("hostsChanged", [])
    if not macs:
        pytest.skip("No hosts loaded from fixture")

    resp = await app_client.post(
        "/api/v1/linbo/dhcp/reservations:batch",
        json={"macs": macs[:3]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "reservations" in data
    if data["reservations"]:
        res = data["reservations"][0]
        assert "mac" in res
        assert "hostname" in res
        assert "pxeEnabled" in res
        assert "hostgroup" in res
        assert "bootPolicy" in res
        bp = res["bootPolicy"]
        assert bp["arch"] in ("efi64", "efi32", "bios")
        assert "bootfile" in bp
        assert "nextServer" in bp


@pytest.mark.asyncio
async def test_batch_reservations_unknown_mac(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/dhcp/reservations:batch",
        json={"macs": ["FF:FF:FF:FF:FF:FF"]},
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["reservations"] == []


@pytest.mark.asyncio
async def test_batch_reservations_requires_auth(app_client):
    resp = await app_client.post(
        "/api/v1/linbo/dhcp/reservations:batch",
        json={"macs": ["AA:BB:CC:DD:EE:FF"]},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_export_dnsmasq_proxy(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/dhcp/export/dnsmasq-proxy", headers=auth_headers()
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    content = resp.text
    assert "proxy" in content.lower() or "port=0" in content


@pytest.mark.asyncio
async def test_export_isc_dhcp(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/dhcp/export/isc-dhcp", headers=auth_headers()
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    content = resp.text
    assert "ISC DHCP" in content or "subnet" in content


@pytest.mark.asyncio
async def test_export_etag_header(app_client):
    resp = await app_client.get(
        "/api/v1/linbo/dhcp/export/dnsmasq-proxy", headers=auth_headers()
    )
    assert "etag" in resp.headers


@pytest.mark.asyncio
async def test_export_conditional_304(app_client):
    # First request to get ETag
    resp1 = await app_client.get(
        "/api/v1/linbo/dhcp/export/dnsmasq-proxy", headers=auth_headers()
    )
    etag = resp1.headers.get("etag")
    if not etag:
        pytest.skip("No ETag in response")

    # Second request with If-None-Match
    headers = {**auth_headers(), "If-None-Match": etag}
    resp2 = await app_client.get(
        "/api/v1/linbo/dhcp/export/dnsmasq-proxy", headers=headers
    )
    assert resp2.status_code == 304


@pytest.mark.asyncio
async def test_export_requires_auth(app_client):
    resp = await app_client.get("/api/v1/linbo/dhcp/export/dnsmasq-proxy")
    assert resp.status_code == 401
