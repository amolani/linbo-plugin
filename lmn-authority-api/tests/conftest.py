"""Shared test fixtures for LMN Authority API."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from lmn_authority.config import Settings

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture
def tmp_settings(tmp_path: Path) -> Settings:
    """Settings pointing to tmp_path for all data dirs."""
    devices_csv = FIXTURES_DIR / "devices.csv"
    start_conf_dir = FIXTURES_DIR

    return Settings(
        devices_csv_path=devices_csv,
        start_conf_dir=start_conf_dir,
        delta_db_path=tmp_path / "delta.db",
        bearer_tokens="test-token-alpha,test-token-beta",
        ip_allowlist="0.0.0.0/0,::0/0",
        trust_proxy_headers=False,
        rate_limit_rpm=60,
        server_ip="10.0.0.1",
        subnet="10.0.0.0",
        netmask="255.255.0.0",
        gateway="10.0.0.254",
        dns="10.0.0.1",
        domain="linuxmuster.lan",
        dhcp_interface="eth0",
        log_level="WARNING",
    )


@pytest.fixture
def sample_host_data() -> dict:
    """A sample HostData dict as returned by DevicesAdapter."""
    return {
        "mac": "BC:24:11:2A:E9:8C",
        "hostname": "amo-pc02",
        "ip": "10.0.0.111",
        "room": "amo",
        "school": "default-school",
        "hostgroup": "win11_efi_sata",
        "pxeEnabled": True,
        "pxeFlag": 1,
        "dhcpOptions": "",
        "startConfId": "win11_efi_sata",
        "role": "classroom-studentcomputer",
        "updatedAt": datetime(2026, 2, 26, 8, 0, 0, tzinfo=timezone.utc),
    }


@pytest.fixture
def sample_hosts() -> list[dict]:
    """Multiple sample hosts for batch/DHCP tests."""
    base_time = datetime(2026, 2, 26, 8, 0, 0, tzinfo=timezone.utc)
    return [
        {
            "mac": "BC:24:11:2A:E9:8C",
            "hostname": "amo-pc02",
            "ip": "10.0.0.111",
            "room": "amo",
            "school": "default-school",
            "hostgroup": "win11_efi_sata",
            "pxeEnabled": True,
            "pxeFlag": 1,
            "dhcpOptions": "",
            "startConfId": "win11_efi_sata",
            "role": "classroom-studentcomputer",
            "updatedAt": base_time,
        },
        {
            "mac": "C4:C6:E6:D9:7B:95",
            "hostname": "amo-pc04",
            "ip": "10.0.0.113",
            "room": "amo",
            "school": "default-school",
            "hostgroup": "win11_efi_nvme",
            "pxeEnabled": True,
            "pxeFlag": 1,
            "dhcpOptions": "",
            "startConfId": "win11_efi_nvme",
            "role": "classroom-studentcomputer",
            "updatedAt": base_time,
        },
        {
            "mac": "4F:55:FF:69:15:CC",
            "hostname": "server",
            "ip": "10.0.0.11",
            "room": "server",
            "school": "default-school",
            "hostgroup": "nopxe",
            "pxeEnabled": False,
            "pxeFlag": 0,
            "dhcpOptions": "",
            "startConfId": "nopxe",
            "role": "addc",
            "updatedAt": base_time,
        },
    ]


@pytest_asyncio.fixture
async def app_client(tmp_settings: Settings):
    """AsyncClient backed by the real FastAPI app with test settings and lifespan."""
    from lmn_authority.main import create_app

    app = create_app(settings=tmp_settings)

    # Trigger lifespan startup/shutdown
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


def auth_headers(token: str = "test-token-alpha") -> dict[str, str]:
    """Return Authorization header dict."""
    return {"Authorization": f"Bearer {token}"}
