"""Tests for DhcpExportAdapter."""

from __future__ import annotations

from pathlib import Path

import pytest

from lmn_authority.adapters.devices import DevicesAdapter
from lmn_authority.adapters.dhcp_export import DhcpExportAdapter, NetworkSettings

FIXTURES = Path(__file__).parent.parent / "fixtures"
GOLDEN_TS = "2026-01-01T00:00:00Z"


@pytest.fixture
def settings():
    return NetworkSettings()


@pytest.fixture
def dhcp(settings):
    return DhcpExportAdapter(settings)


@pytest.fixture
def hosts():
    adapter = DevicesAdapter(FIXTURES / "devices.csv")
    adapter.load()
    return list(adapter.hosts.values())


class TestGoldenDnsmasqProxy:
    def test_matches_golden_file(self, dhcp, hosts):
        result = dhcp.generate_dnsmasq_proxy(hosts, generated_at=GOLDEN_TS)
        golden = (FIXTURES / "golden_dnsmasq_proxy.conf").read_text(encoding="utf-8")
        if result != golden:
            # Show a clear diff for debugging
            import difflib

            diff = "\n".join(
                difflib.unified_diff(
                    golden.splitlines(),
                    result.splitlines(),
                    fromfile="golden",
                    tofile="actual",
                    lineterm="",
                )
            )
            pytest.fail(f"dnsmasq proxy output differs from golden file:\n{diff}")


class TestGoldenIscDhcp:
    def test_matches_golden_file(self, dhcp, hosts):
        result = dhcp.generate_isc_dhcp(hosts, generated_at=GOLDEN_TS)
        golden = (FIXTURES / "golden_isc_dhcp.conf").read_text(encoding="utf-8")
        if result != golden:
            import difflib

            diff = "\n".join(
                difflib.unified_diff(
                    golden.splitlines(),
                    result.splitlines(),
                    fromfile="golden",
                    tofile="actual",
                    lineterm="",
                )
            )
            pytest.fail(f"ISC DHCP output differs from golden file:\n{diff}")


class TestSanitizeTag:
    def test_alphanumeric_unchanged(self):
        assert DhcpExportAdapter.sanitize_tag("win11_efi_sata") == "win11_efi_sata"

    def test_special_chars_replaced(self):
        assert DhcpExportAdapter.sanitize_tag("my config.v2") == "my_config_v2"

    def test_dashes_preserved(self):
        assert DhcpExportAdapter.sanitize_tag("ubuntu-efi") == "ubuntu-efi"

    def test_dots_replaced(self):
        assert DhcpExportAdapter.sanitize_tag("config.2024.v1") == "config_2024_v1"

    def test_spaces_replaced(self):
        assert DhcpExportAdapter.sanitize_tag("my config") == "my_config"


class TestEmptyHosts:
    def test_dnsmasq_proxy_no_hosts(self, dhcp):
        result = dhcp.generate_dnsmasq_proxy([], generated_at=GOLDEN_TS)
        assert "port=0" in result
        assert "dhcp-range=" in result
        # No host config assignments section
        assert "# Host config assignments" not in result

    def test_isc_dhcp_no_hosts(self, dhcp):
        result = dhcp.generate_isc_dhcp([], generated_at=GOLDEN_TS)
        assert "subnet" in result
        assert "}" in result
        # No host blocks
        assert "host " not in result.split("subnet")[1].replace("option host-name", "")


class TestNopxeHostsExcluded:
    def test_nopxe_hosts_not_in_pxe_tags(self, dhcp, hosts):
        result = dhcp.generate_dnsmasq_proxy(hosts, generated_at=GOLDEN_TS)
        # nopxe hosts (server, firewall) should NOT appear in dhcp-host lines
        assert "4F:55:FF:69:15:CC" not in result
        assert "BC:24:11:02:96:D1" not in result

    def test_pxe_hosts_present(self, dhcp, hosts):
        result = dhcp.generate_dnsmasq_proxy(hosts, generated_at=GOLDEN_TS)
        # PXE-enabled hosts should be present
        assert "BC:24:11:63:8E:40" in result
        assert "BC:24:11:2A:E9:8C" in result

    def test_nopxe_in_isc_no_pxe_options(self, dhcp, hosts):
        result = dhcp.generate_isc_dhcp(hosts, generated_at=GOLDEN_TS)
        # Find the server host block and verify no next-server inside it
        lines = result.split("\n")
        in_server_block = False
        server_block_lines = []
        for line in lines:
            if "host server {" in line:
                in_server_block = True
            if in_server_block:
                server_block_lines.append(line)
                if line.strip() == "}":
                    break
        server_block = "\n".join(server_block_lines)
        assert 'option extensions-path' not in server_block
        assert 'option nis-domain' not in server_block
