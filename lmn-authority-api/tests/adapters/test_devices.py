"""Tests for DevicesAdapter."""

from __future__ import annotations

from pathlib import Path

import pytest

from lmn_authority.adapters.devices import DevicesAdapter

FIXTURES = Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def adapter():
    return DevicesAdapter(FIXTURES / "devices.csv")


@pytest.fixture
def loaded_adapter(adapter):
    assert adapter.load() is True
    return adapter


class TestLoadValidCsv:
    def test_load_returns_true(self, adapter):
        assert adapter.load() is True

    def test_host_count(self, loaded_adapter):
        # 2 servers + 5 PCs = 7 hosts
        assert len(loaded_adapter.hosts) == 7

    def test_mac_normalization(self, loaded_adapter):
        # All MACs should be uppercase colon-separated
        for mac in loaded_adapter.hosts:
            assert mac == mac.upper()
            assert ":" in mac

    def test_server_host_fields(self, loaded_adapter):
        host = loaded_adapter.get_host("4F:55:FF:69:15:CC")
        assert host is not None
        assert host["hostname"] == "server"
        assert host["ip"] == "10.0.0.11"
        assert host["room"] == "server"
        assert host["hostgroup"] == "nopxe"
        assert host["school"] == "default-school"
        assert host["sophomorixRole"] == "addc"

    def test_pc_host_fields(self, loaded_adapter):
        host = loaded_adapter.get_host("BC:24:11:2A:E9:8C")
        assert host is not None
        assert host["hostname"] == "amo-pc02"
        assert host["ip"] == "10.0.0.111"
        assert host["room"] == "amo"
        assert host["hostgroup"] == "win11_efi_sata"
        assert host["startConfId"] == "win11_efi_sata"


class TestEmptyCsv:
    def test_load_empty_csv(self):
        adapter = DevicesAdapter(FIXTURES / "devices_empty.csv")
        assert adapter.load() is True
        assert len(adapter.hosts) == 0

    def test_get_all_macs_empty(self):
        adapter = DevicesAdapter(FIXTURES / "devices_empty.csv")
        adapter.load()
        assert adapter.get_all_macs() == []


class TestMalformedCsv:
    def test_valid_rows_still_parsed(self):
        adapter = DevicesAdapter(FIXTURES / "devices_malformed.csv")
        assert adapter.load() is True
        # 3 parseable rows: sgm-pc01 (AA:BB:CC:DD:EE:FF), lab-pc02 (11:22:33:44:55:66,
        # invalid IP stored as None), and amo-pc10 (DE:AD:BE:EF:00:01)
        # Invalid MAC (ZZ:ZZ...) rows are skipped, too-few-column rows are skipped
        assert len(adapter.hosts) == 3

    def test_valid_host_accessible(self):
        adapter = DevicesAdapter(FIXTURES / "devices_malformed.csv")
        adapter.load()
        host = adapter.get_host("AA:BB:CC:DD:EE:FF")
        assert host is not None
        assert host["hostname"] == "sgm-pc01"

    def test_invalid_mac_skipped(self):
        adapter = DevicesAdapter(FIXTURES / "devices_malformed.csv")
        adapter.load()
        assert adapter.get_host("ZZ:ZZ:ZZ:ZZ:ZZ:ZZ") is None

    def test_too_few_columns_skipped(self):
        adapter = DevicesAdapter(FIXTURES / "devices_malformed.csv")
        adapter.load()
        # 3 parseable rows (invalid IP gets ip=None, not skipped)
        assert len(adapter.hosts) == 3

    def test_invalid_ip_stored_as_none(self):
        adapter = DevicesAdapter(FIXTURES / "devices_malformed.csv")
        adapter.load()
        host = adapter.get_host("11:22:33:44:55:66")
        assert host is not None
        assert host["hostname"] == "lab-pc02"
        assert host["ip"] is None  # Invalid IP stored as None


class TestNopxeHandling:
    def test_nopxe_hosts_disabled(self, loaded_adapter):
        # server and firewall have config=nopxe
        server = loaded_adapter.get_host("4F:55:FF:69:15:CC")
        assert server is not None
        assert server["pxeEnabled"] is False

        firewall = loaded_adapter.get_host("BC:24:11:02:96:D1")
        assert firewall is not None
        assert firewall["pxeEnabled"] is False

    def test_pxe_hosts_enabled(self, loaded_adapter):
        host = loaded_adapter.get_host("BC:24:11:63:8E:40")
        assert host is not None
        assert host["pxeEnabled"] is True


class TestPxeFlagParsing:
    def test_flag_zero(self, loaded_adapter):
        # server has pxe_flag=0
        host = loaded_adapter.get_host("4F:55:FF:69:15:CC")
        assert host is not None
        assert host["pxeFlag"] == 0

    def test_flag_one(self, loaded_adapter):
        host = loaded_adapter.get_host("BC:24:11:63:8E:40")
        assert host is not None
        assert host["pxeFlag"] == 1


class TestDuplicateDetection:
    def test_last_duplicate_wins(self, tmp_path):
        """When duplicate MACs appear, the last row wins."""
        csv = tmp_path / "devices.csv"
        csv.write_text(
            "room1;host-old;config1;AA:BB:CC:DD:EE:FF;10.0.0.1;;;;role;;1;;;;\n"
            "room2;host-new;config2;AA:BB:CC:DD:EE:FF;10.0.0.2;;;;role;;1;;;;\n"
        )
        adapter = DevicesAdapter(csv)
        adapter.load()
        host = adapter.get_host("AA:BB:CC:DD:EE:FF")
        assert host is not None
        assert host["hostname"] == "host-new"
        assert host["ip"] == "10.0.0.2"


class TestGetHost:
    def test_lookup_existing(self, loaded_adapter):
        host = loaded_adapter.get_host("bc:24:11:2a:e9:8c")  # lowercase
        assert host is not None
        assert host["hostname"] == "amo-pc02"

    def test_lookup_missing(self, loaded_adapter):
        assert loaded_adapter.get_host("FF:FF:FF:FF:FF:FF") is None


class TestGetAllMacs:
    def test_returns_all_macs(self, loaded_adapter):
        macs = loaded_adapter.get_all_macs()
        assert len(macs) == 7
        assert "4F:55:FF:69:15:CC" in macs
        assert "BC:24:11:63:8E:40" in macs


class TestLoadReturnsBool:
    def test_missing_file_returns_false(self, tmp_path):
        adapter = DevicesAdapter(tmp_path / "nonexistent.csv")
        assert adapter.load() is False

    def test_valid_file_returns_true(self):
        adapter = DevicesAdapter(FIXTURES / "devices.csv")
        assert adapter.load() is True


class TestExtraColumns:
    def test_extra_columns_ignored(self, tmp_path):
        csv = tmp_path / "devices.csv"
        csv.write_text(
            "room;host;cfg;AA:BB:CC:DD:EE:FF;10.0.0.1;;;;role;;1;;;;;extra1;extra2;extra3\n"
        )
        adapter = DevicesAdapter(csv)
        adapter.load()
        assert len(adapter.hosts) == 1
        host = adapter.get_host("AA:BB:CC:DD:EE:FF")
        assert host is not None
        assert host["hostname"] == "host"


class TestFewerColumns:
    def test_fewer_than_five_skipped(self, tmp_path):
        csv = tmp_path / "devices.csv"
        csv.write_text(
            "a;b;c\n"
            "a;b;c;d\n"
            "room;host;cfg;AA:BB:CC:DD:EE:FF;10.0.0.1\n"
        )
        adapter = DevicesAdapter(csv)
        adapter.load()
        assert len(adapter.hosts) == 1
