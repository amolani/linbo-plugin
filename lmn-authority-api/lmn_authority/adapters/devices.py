"""Parse linuxmuster.net devices.csv into HostRecord dicts."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import TypedDict

logger = logging.getLogger(__name__)

# MAC address pattern: 6 pairs of hex digits separated by colons or dashes
_MAC_RE = re.compile(r"^([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}$")
# Simple IP v4 pattern
_IP_RE = re.compile(
    r"^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$"
)


class HostData(TypedDict):
    mac: str
    hostname: str
    ip: str | None
    room: str
    school: str
    hostgroup: str
    pxeEnabled: bool
    pxeFlag: int
    dhcpOptions: str
    startConfId: str
    sophomorixRole: str
    updatedAt: datetime


def _normalize_mac(raw: str) -> str | None:
    """Normalize a MAC address to uppercase colon-separated form.

    Returns None if the MAC is invalid.
    """
    raw = raw.strip()
    if not _MAC_RE.match(raw):
        return None
    return raw.upper().replace("-", ":")


def _validate_ip(raw: str) -> str | None:
    """Return the IP string if valid, else None."""
    raw = raw.strip()
    if _IP_RE.match(raw):
        return raw
    return None


class DevicesAdapter:
    """Parse linuxmuster.net devices.csv into HostData dicts."""

    def __init__(self, csv_path: Path):
        self._path = csv_path
        self._hosts: dict[str, HostData] = {}  # keyed by uppercase MAC
        self._last_modified: datetime | None = None

    def load(self) -> bool:
        """Load and parse devices.csv. Returns True on success, False on failure."""
        try:
            text = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            logger.warning("devices.csv not found: %s", self._path)
            return False
        except OSError as exc:
            logger.error("Failed to read devices.csv: %s", exc)
            return False

        stat = self._path.stat()
        self._last_modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)

        hosts: dict[str, HostData] = {}
        for line_no, raw_line in enumerate(text.splitlines(), start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            fields = line.split(";")

            # Skip rows with fewer than 5 columns
            if len(fields) < 5:
                logger.debug("Skipping line %d: fewer than 5 columns", line_no)
                continue

            # Pad to 15 columns if needed (take first 15 if more)
            fields = fields[:15]
            while len(fields) < 15:
                fields.append("")

            room = fields[0].strip()
            hostname = fields[1].strip()
            config = fields[2].strip()
            raw_mac = fields[3].strip()
            raw_ip = fields[4].strip()
            sophomorix_role = fields[8].strip()

            # Parse pxe_flag from column 10, default 1
            pxe_flag_str = fields[10].strip()
            try:
                pxe_flag = int(pxe_flag_str) if pxe_flag_str else 1
            except ValueError:
                pxe_flag = 1

            # Normalize and validate MAC
            mac = _normalize_mac(raw_mac)
            if mac is None:
                logger.debug("Skipping line %d: invalid MAC %r", line_no, raw_mac)
                continue

            # Validate IP (optional — store None if invalid)
            ip = _validate_ip(raw_ip) if raw_ip else None

            # pxeEnabled: pxeFlag > 0 AND config != "nopxe"
            pxe_enabled = pxe_flag > 0 and config.lower() != "nopxe"

            hosts[mac] = HostData(
                mac=mac,
                hostname=hostname,
                ip=ip,
                room=room,
                school="default-school",
                hostgroup=config,
                pxeEnabled=pxe_enabled,
                pxeFlag=pxe_flag,
                dhcpOptions="",
                startConfId=config,
                sophomorixRole=sophomorix_role,
                updatedAt=self._last_modified,
            )

        self._hosts = hosts
        logger.info("Loaded %d hosts from %s", len(hosts), self._path)
        return True

    @property
    def hosts(self) -> dict[str, HostData]:
        return self._hosts

    @property
    def last_modified(self) -> datetime | None:
        return self._last_modified

    def get_host(self, mac: str) -> HostData | None:
        """Lookup a host by MAC address (case-insensitive)."""
        return self._hosts.get(mac.upper().replace("-", ":"))

    def get_all_macs(self) -> list[str]:
        """Return all MAC addresses."""
        return list(self._hosts.keys())
