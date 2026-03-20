"""Tests for StartConfAdapter."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from lmn_authority.adapters.startconf import StartConfAdapter, _parse_startconf

FIXTURES = Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def adapter():
    return StartConfAdapter(FIXTURES)


@pytest.fixture
def loaded_adapter(adapter):
    assert adapter.load() is True
    return adapter


class TestParseWin11:
    def test_linbo_settings(self, loaded_adapter):
        parsed = loaded_adapter.get_parsed("win11_efi_sata")
        assert parsed is not None
        data = loaded_adapter.configs["win11_efi_sata"]
        linbo = data["linbo"]
        assert linbo["server"] == "10.0.10.1"
        assert linbo["cache"] == "/dev/sda5"
        assert linbo["group"] == "win11_efi_sata"
        assert linbo["rootTimeout"] == 600
        assert linbo["autoPartition"] is False
        assert linbo["autoFormat"] is False
        assert linbo["autoInitCache"] is False
        assert linbo["downloadType"] == "torrent"
        assert linbo["systemType"] == "efi64"
        assert linbo["locale"] == "de-de"

    def test_partitions(self, loaded_adapter):
        parsed = loaded_adapter.get_parsed("win11_efi_sata")
        assert parsed is not None
        parts = parsed["partitions"]
        assert len(parts) == 3
        assert parts[0]["device"] == "/dev/sda1"
        assert parts[0]["label"] == "efi"
        assert parts[0]["size"] == "512M"
        assert parts[0]["fsType"] == "vfat"
        assert parts[0]["bootable"] is True
        assert parts[1]["device"] == "/dev/sda2"
        assert parts[1]["fsType"] == "ntfs"
        assert parts[1]["bootable"] is False

    def test_os_entry(self, loaded_adapter):
        parsed = loaded_adapter.get_parsed("win11_efi_sata")
        assert parsed is not None
        os_entries = parsed["osEntries"]
        assert len(os_entries) == 1
        os = os_entries[0]
        assert os["name"] == "Windows 11"
        assert os["description"] == "Windows 11 Pro Education"
        assert os["baseimage"] == "win11_pro_edu.qcow2"
        assert os["boot"] == "/dev/sda2"
        assert os["startEnabled"] is True
        assert os["syncEnabled"] is True
        assert os["newEnabled"] is True
        assert os["defaultAction"] == "sync"

    def test_config_id(self, loaded_adapter):
        parsed = loaded_adapter.get_parsed("win11_efi_sata")
        assert parsed is not None
        assert parsed["id"] == "win11_efi_sata"
        assert parsed["name"] == "win11_efi_sata"


class TestParseBios:
    def test_system_type(self, loaded_adapter):
        data = loaded_adapter.configs["bios_sata"]
        assert data["linbo"]["systemType"] == "bios64"

    def test_partitions(self, loaded_adapter):
        parsed = loaded_adapter.get_parsed("bios_sata")
        assert parsed is not None
        assert len(parsed["partitions"]) == 2

    def test_os_entry(self, loaded_adapter):
        parsed = loaded_adapter.get_parsed("bios_sata")
        assert parsed is not None
        os_entries = parsed["osEntries"]
        assert len(os_entries) == 1
        os = os_entries[0]
        assert os["name"] == "Ubuntu 22.04"
        assert os["kernel"] == "/boot/vmlinuz"
        assert os["initrd"] == "/boot/initrd.img"
        assert os["hidden"] is False


class TestParseDualBoot:
    def test_two_os_entries(self, loaded_adapter):
        parsed = loaded_adapter.get_parsed("dual_boot")
        assert parsed is not None
        assert len(parsed["osEntries"]) == 2
        assert parsed["osEntries"][0]["name"] == "Windows 11"
        assert parsed["osEntries"][1]["name"] == "Ubuntu 22.04"

    def test_five_partitions(self, loaded_adapter):
        parsed = loaded_adapter.get_parsed("dual_boot")
        assert parsed is not None
        assert len(parsed["partitions"]) == 5

    def test_autostart_timeout(self, loaded_adapter):
        data = loaded_adapter.configs["dual_boot"]
        os_entries = data["osEntries"]
        assert os_entries[0]["autostartTimeout"] == 5

    def test_boot_timeout(self, loaded_adapter):
        data = loaded_adapter.configs["dual_boot"]
        assert data["linbo"]["bootTimeout"] == 10
        assert data["grubPolicy"]["timeout"] == 10


class TestRawContentUnchanged:
    def test_no_server_rewrite(self, loaded_adapter):
        """AC-6: Raw content must NOT have server= rewritten."""
        raw_data = loaded_adapter.get_raw("win11_efi_sata")
        assert raw_data is not None
        content = raw_data["content"]
        # The original file has Server = 10.0.10.1, it must be unchanged
        assert "Server = 10.0.10.1" in content
        # KernelOptions also has server=10.0.10.1
        assert "server=10.0.10.1" in content


class TestSha256Hash:
    def test_hash_matches(self, loaded_adapter):
        raw_data = loaded_adapter.get_raw("win11_efi_sata")
        assert raw_data is not None
        content = raw_data["content"]
        expected_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        assert raw_data["hash"] == expected_hash

    def test_hash_is_hex(self, loaded_adapter):
        raw_data = loaded_adapter.get_raw("bios_sata")
        assert raw_data is not None
        assert len(raw_data["hash"]) == 64
        int(raw_data["hash"], 16)  # Should not raise


class TestGrubPolicyDefaults:
    def test_default_timeout(self, loaded_adapter):
        data = loaded_adapter.configs["win11_efi_sata"]
        # win11_efi_sata has no BootTimeout, so default is 5
        assert data["grubPolicy"]["timeout"] == 5
        assert data["grubPolicy"]["defaultEntry"] == 0
        assert data["grubPolicy"]["hiddenMenu"] is False


class TestBooleanParsing:
    def test_yes_is_true(self, loaded_adapter):
        data = loaded_adapter.configs["win11_efi_sata"]
        # AutoPartition = no -> False, first partition Bootable = yes -> True
        assert data["linbo"]["autoPartition"] is False
        assert data["partitions"][0]["bootable"] is True

    def test_no_is_false(self, loaded_adapter):
        data = loaded_adapter.configs["win11_efi_sata"]
        assert data["linbo"]["autoFormat"] is False
        assert data["partitions"][1]["bootable"] is False


class TestLoadReturnsBool:
    def test_missing_dir_returns_false(self, tmp_path):
        adapter = StartConfAdapter(tmp_path / "nonexistent")
        assert adapter.load() is False

    def test_valid_dir_returns_true(self):
        adapter = StartConfAdapter(FIXTURES)
        assert adapter.load() is True


class TestLoadSingle:
    def test_reload_single(self, loaded_adapter):
        assert loaded_adapter.load_single("win11_efi_sata") is True
        assert "win11_efi_sata" in loaded_adapter.configs

    def test_nonexistent_returns_false(self, loaded_adapter):
        assert loaded_adapter.load_single("nonexistent_config") is False

    def test_load_single_updates_data(self, loaded_adapter):
        # Verify data is accessible after load_single
        loaded_adapter.load_single("bios_sata")
        data = loaded_adapter.configs.get("bios_sata")
        assert data is not None
        assert data["linbo"]["systemType"] == "bios64"


class TestGetAllIds:
    def test_returns_all_config_ids(self, loaded_adapter):
        ids = loaded_adapter.get_all_ids()
        assert "win11_efi_sata" in ids
        assert "bios_sata" in ids
        assert "dual_boot" in ids
        assert len(ids) == 3


class TestInlineComments:
    """Regression: start.conf files often have inline comments on section headers."""

    CONF_WITH_COMMENTS = """\
[LINBO]
Server = 10.0.0.13
Group = inline_test
Cache = /dev/sda4
SystemType = efi64

[Partition]          # efi system partition
Dev = /dev/sda1      # device name of the partition
Label = efi          # partition label
Size = 200M          # partition size 200M
Id = ef              # partition id (ef = efi)
FSType = vfat        # filesystem vfat
Bootable = yes       # set bootable flag yes

[Partition]          # microsoft reserved partition
Dev = /dev/sda2      # device name
Label = msr          # partition label
Size = 128M          # partition size 128M
Id = 0c01            # partition id (0c01 = msr)
FSType =             # no filesystem
Bootable = no        # set bootable flag no

[Partition]          # partition section (operating system)
Dev = /dev/sda3      # device name
Label = windows      # partition label
Size = 70G           # partition size
Id = 7               # partition id (7 = ntfs)
FSType = ntfs        # filesystem ntfs
Bootable = no        # set bootable flag no

[OS]
Name = Windows 10
BaseImage = win11.qcow2
Boot = /dev/sda3
Root = /dev/sda3
Kernel = auto
StartEnabled = yes
SyncEnabled = no
NewEnabled = yes
"""

    def test_partitions_parsed_with_inline_comments(self):
        linbo, partitions, os_entries = _parse_startconf(self.CONF_WITH_COMMENTS)
        assert len(partitions) == 3, f"Expected 3 partitions, got {len(partitions)}"

    def test_partition_values_stripped(self):
        _, partitions, _ = _parse_startconf(self.CONF_WITH_COMMENTS)
        assert partitions[0]["device"] == "/dev/sda1"
        assert partitions[0]["label"] == "efi"
        assert partitions[0]["size"] == "200M"
        assert partitions[0]["fsType"] == "vfat"
        assert partitions[0]["bootable"] is True

    def test_partition_empty_fstype(self):
        _, partitions, _ = _parse_startconf(self.CONF_WITH_COMMENTS)
        # FSType =             # no filesystem → empty string
        assert partitions[1]["fsType"] == ""

    def test_os_entry_parsed(self):
        _, _, os_entries = _parse_startconf(self.CONF_WITH_COMMENTS)
        assert len(os_entries) == 1
        assert os_entries[0]["name"] == "Windows 10"

    def test_linbo_section_parsed(self):
        linbo, _, _ = _parse_startconf(self.CONF_WITH_COMMENTS)
        assert linbo["group"] == "inline_test"
        assert linbo["systemType"] == "efi64"


class TestLastModified:
    def test_last_modified_set(self, loaded_adapter):
        assert loaded_adapter.last_modified is not None

    def test_last_modified_none_before_load(self):
        adapter = StartConfAdapter(FIXTURES)
        assert adapter.last_modified is None
