"""Parse start.conf.* files from a LINBO directory."""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import TypedDict

logger = logging.getLogger(__name__)


class PartitionData(TypedDict):
    device: str
    label: str
    size: str
    id: str
    fsType: str
    bootable: bool


class OsData(TypedDict):
    name: str
    description: str
    version: str
    iconname: str
    baseimage: str
    boot: str
    root: str
    kernel: str
    initrd: str
    append: str
    startEnabled: bool
    syncEnabled: bool
    newEnabled: bool
    autostart: bool
    autostartTimeout: int
    defaultAction: str
    hidden: bool


class GrubPolicyData(TypedDict):
    timeout: int
    defaultEntry: int
    hiddenMenu: bool


class LinboData(TypedDict):
    server: str
    cache: str
    group: str
    rootTimeout: int
    autoPartition: bool
    autoFormat: bool
    autoInitCache: bool
    downloadType: str
    systemType: str
    kernelOptions: str
    locale: str
    guiDisabled: bool
    useMinimalLayout: bool
    bootTimeout: int


class StartConfData(TypedDict):
    id: str
    raw: str
    hash: str
    linbo: LinboData
    partitions: list[PartitionData]
    osEntries: list[OsData]
    grubPolicy: GrubPolicyData
    updatedAt: datetime


def _parse_bool(value: str) -> bool:
    """Parse yes/true/1 -> True, everything else -> False."""
    return value.strip().lower() in ("yes", "true", "1")


def _parse_int(value: str, default: int = 0) -> int:
    """Parse integer with fallback."""
    value = value.strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _parse_startconf(text: str) -> tuple[LinboData, list[PartitionData], list[OsData]]:
    """Parse start.conf text into structured data."""
    linbo = LinboData(
        server="",
        cache="",
        group="",
        rootTimeout=600,
        autoPartition=False,
        autoFormat=False,
        autoInitCache=False,
        downloadType="torrent",
        systemType="efi64",
        kernelOptions="",
        locale="",
        guiDisabled=False,
        useMinimalLayout=False,
        bootTimeout=5,
    )
    partitions: list[PartitionData] = []
    os_entries: list[OsData] = []

    current_section: str | None = None
    current_partition: PartitionData | None = None
    current_os: OsData | None = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        # Section header — strip inline comments: [Partition]  # comment
        if "#" in line and line.startswith("["):
            line = line[:line.index("#")].strip()
        if line.startswith("[") and line.endswith("]"):
            # Commit any pending partition or OS
            if current_partition is not None:
                partitions.append(current_partition)
                current_partition = None
            if current_os is not None:
                os_entries.append(current_os)
                current_os = None

            section_name = line[1:-1].strip().upper()
            current_section = section_name

            if section_name == "PARTITION":
                current_partition = PartitionData(
                    device="",
                    label="",
                    size="",
                    id="",
                    fsType="",
                    bootable=False,
                )
            elif section_name == "OS":
                current_os = OsData(
                    name="",
                    description="",
                    version="",
                    iconname="",
                    baseimage="",
                    boot="",
                    root="",
                    kernel="",
                    initrd="",
                    append="",
                    startEnabled=True,
                    syncEnabled=True,
                    newEnabled=True,
                    autostart=False,
                    autostartTimeout=0,
                    defaultAction="sync",
                    hidden=False,
                )
            continue

        # Key = Value — strip inline comments: Dev = /dev/sda1  # comment
        if "=" not in line:
            continue
        key, _, raw_value = line.partition("=")
        key = key.strip().lower()
        # Strip inline comment from raw value (before stripping whitespace)
        # e.g. "  /dev/sda1      # device name" → "  /dev/sda1"
        # e.g. "             # no filesystem"   → ""
        hash_idx = raw_value.find(" #")
        if hash_idx >= 0:
            raw_value = raw_value[:hash_idx]
        value = raw_value.strip()

        if current_section == "LINBO":
            if key == "server":
                linbo["server"] = value
            elif key == "cache":
                linbo["cache"] = value
            elif key == "group":
                linbo["group"] = value
            elif key == "roottimeout":
                linbo["rootTimeout"] = _parse_int(value, 600)
            elif key == "autopartition":
                linbo["autoPartition"] = _parse_bool(value)
            elif key == "autoformat":
                linbo["autoFormat"] = _parse_bool(value)
            elif key == "autoinitcache":
                linbo["autoInitCache"] = _parse_bool(value)
            elif key == "downloadtype":
                linbo["downloadType"] = value
            elif key == "systemtype":
                linbo["systemType"] = value
            elif key == "kerneloptions":
                linbo["kernelOptions"] = value
            elif key == "locale":
                linbo["locale"] = value
            elif key == "guidisabled":
                linbo["guiDisabled"] = _parse_bool(value)
            elif key == "useminimallayout":
                linbo["useMinimalLayout"] = _parse_bool(value)
            elif key == "boottimeout":
                linbo["bootTimeout"] = _parse_int(value, 5)

        elif current_section == "PARTITION" and current_partition is not None:
            if key == "dev":
                current_partition["device"] = value
            elif key == "label":
                current_partition["label"] = value
            elif key == "size":
                current_partition["size"] = value
            elif key == "id":
                current_partition["id"] = value
            elif key == "fstype":
                current_partition["fsType"] = value
            elif key == "bootable":
                current_partition["bootable"] = _parse_bool(value)

        elif current_section == "OS" and current_os is not None:
            if key == "name":
                current_os["name"] = value
            elif key == "description":
                current_os["description"] = value
            elif key == "version":
                current_os["version"] = value
            elif key == "iconname":
                current_os["iconname"] = value
            elif key == "baseimage":
                current_os["baseimage"] = value
            elif key == "boot":
                current_os["boot"] = value
            elif key == "root":
                current_os["root"] = value
            elif key == "kernel":
                current_os["kernel"] = value
            elif key == "initrd":
                current_os["initrd"] = value
            elif key == "append":
                current_os["append"] = value
            elif key == "startenabled":
                current_os["startEnabled"] = _parse_bool(value)
            elif key == "syncenabled":
                current_os["syncEnabled"] = _parse_bool(value)
            elif key == "newenabled":
                current_os["newEnabled"] = _parse_bool(value)
            elif key == "autostart":
                current_os["autostart"] = _parse_bool(value)
            elif key == "autostarttimeout":
                current_os["autostartTimeout"] = _parse_int(value, 0)
            elif key == "defaultaction":
                current_os["defaultAction"] = value
            elif key == "hidden":
                current_os["hidden"] = _parse_bool(value)

    # Commit any trailing section
    if current_partition is not None:
        partitions.append(current_partition)
    if current_os is not None:
        os_entries.append(current_os)

    return linbo, partitions, os_entries


class StartConfAdapter:
    """Parse start.conf.* files from /srv/linbo/."""

    def __init__(self, start_conf_dir: Path):
        self._dir = start_conf_dir
        self._configs: dict[str, StartConfData] = {}  # keyed by config ID
        self._last_modified: datetime | None = None

    def load(self) -> bool:
        """Scan directory, parse all start.conf.* files. Returns True on success."""
        if not self._dir.is_dir():
            logger.warning("start.conf directory not found: %s", self._dir)
            return False

        configs: dict[str, StartConfData] = {}
        latest_mtime: float = 0

        for path in sorted(self._dir.glob("start.conf.*")):
            if not path.is_file():
                continue
            config_id = path.name.removeprefix("start.conf.")
            if not config_id:
                continue

            data = self._parse_file(path, config_id)
            if data is not None:
                configs[config_id] = data
                mtime = path.stat().st_mtime
                if mtime > latest_mtime:
                    latest_mtime = mtime

        self._configs = configs
        if latest_mtime > 0:
            self._last_modified = datetime.fromtimestamp(latest_mtime, tz=timezone.utc)

        logger.info("Loaded %d start.conf files from %s", len(configs), self._dir)
        return True

    def load_single(self, config_id: str) -> bool:
        """Load/reload a single start.conf file."""
        path = self._dir / f"start.conf.{config_id}"
        if not path.is_file():
            logger.warning("start.conf.%s not found in %s", config_id, self._dir)
            return False

        data = self._parse_file(path, config_id)
        if data is None:
            return False

        self._configs[config_id] = data

        # Update last_modified if this file is newer
        mtime = path.stat().st_mtime
        ts = datetime.fromtimestamp(mtime, tz=timezone.utc)
        if self._last_modified is None or ts > self._last_modified:
            self._last_modified = ts

        return True

    @property
    def configs(self) -> dict[str, StartConfData]:
        return self._configs

    @property
    def last_modified(self) -> datetime | None:
        return self._last_modified

    def get_raw(self, config_id: str) -> dict | None:
        """Get raw content + SHA-256 hash for a config."""
        data = self._configs.get(config_id)
        if data is None:
            return None
        return {
            "id": data["id"],
            "content": data["raw"],
            "hash": data["hash"],
            "updatedAt": data["updatedAt"],
        }

    def get_parsed(self, config_id: str) -> dict | None:
        """Get parsed config with OS entries, partitions, grub policy."""
        data = self._configs.get(config_id)
        if data is None:
            return None
        return {
            "id": data["id"],
            "name": data["linbo"]["group"] or config_id,
            "osEntries": data["osEntries"],
            "partitions": data["partitions"],
            "grubPolicy": data["grubPolicy"],
            "updatedAt": data["updatedAt"],
        }

    def get_all_ids(self) -> list[str]:
        """Return all config IDs."""
        return list(self._configs.keys())

    @staticmethod
    def _parse_file(path: Path, config_id: str) -> StartConfData | None:
        """Parse a single start.conf file."""
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.error("Failed to read %s: %s", path, exc)
            return None

        content_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        linbo, partitions, os_entries = _parse_startconf(raw)

        # Derive GrubPolicy from LINBO section
        grub_policy = GrubPolicyData(
            timeout=linbo["bootTimeout"],
            defaultEntry=0,
            hiddenMenu=False,
        )

        mtime = path.stat().st_mtime
        updated_at = datetime.fromtimestamp(mtime, tz=timezone.utc)

        return StartConfData(
            id=config_id,
            raw=raw,
            hash=content_hash,
            linbo=linbo,
            partitions=partitions,
            osEntries=os_entries,
            grubPolicy=grub_policy,
            updatedAt=updated_at,
        )
