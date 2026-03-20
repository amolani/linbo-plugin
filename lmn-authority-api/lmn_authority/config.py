"""Application configuration via pydantic-settings."""

from __future__ import annotations

import ipaddress
import logging
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """LMN Authority API configuration.

    Loaded from environment variables with the ``LMN_`` prefix.
    """

    model_config = {"env_prefix": "LMN_"}

    # -- Paths ---------------------------------------------------------------
    devices_csv_path: Path = Path(
        "/etc/linuxmuster/sophomorix/default-school/devices.csv"
    )
    start_conf_dir: Path = Path("/srv/linbo")
    delta_db_path: Path = Path("/var/lib/lmn-authority-api/delta.db")

    # -- Auth ----------------------------------------------------------------
    bearer_tokens_file: Path | None = None
    bearer_tokens: str = ""  # comma-separated fallback
    ip_allowlist: str = "10.0.0.0/16,127.0.0.0/8,::1/128"
    trust_proxy_headers: bool = False

    # -- Rate limit ----------------------------------------------------------
    rate_limit_rpm: int = 60  # requests per minute per token

    # -- Watcher -------------------------------------------------------------
    watcher_debounce_ms: int = 500

    # -- Network defaults (for DHCP export) ----------------------------------
    server_ip: str = "10.0.0.1"
    subnet: str = "10.0.0.0"
    netmask: str = "255.255.0.0"
    gateway: str = "10.0.0.254"
    dns: str = "10.0.0.1"
    domain: str = "linuxmuster.lan"
    dhcp_interface: str = "eth0"

    # -- Misc ----------------------------------------------------------------
    log_level: str = "INFO"

    # -- Derived (computed at startup) ---------------------------------------
    _resolved_tokens: set[str] | None = None

    def resolve_tokens(self) -> set[str]:
        """Load bearer tokens from file (preferred) or env fallback (AC-1)."""
        if self._resolved_tokens is not None:
            return self._resolved_tokens

        tokens: set[str] = set()

        # Primary: file-based
        if self.bearer_tokens_file is not None:
            try:
                text = self.bearer_tokens_file.read_text(encoding="utf-8")
                for line in text.splitlines():
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#"):
                        tokens.add(stripped)
                if tokens:
                    logger.info(
                        "Loaded %d token(s) from %s",
                        len(tokens),
                        self.bearer_tokens_file,
                    )
                    self._resolved_tokens = tokens
                    return tokens
            except FileNotFoundError:
                logger.warning(
                    "Token file %s not found, falling back to env",
                    self.bearer_tokens_file,
                )
            except Exception:
                logger.exception("Failed to read token file %s", self.bearer_tokens_file)

        # Fallback: comma-separated env var
        if self.bearer_tokens:
            for t in self.bearer_tokens.split(","):
                stripped = t.strip()
                if stripped:
                    tokens.add(stripped)
            if tokens:
                logger.info("Loaded %d token(s) from LMN_BEARER_TOKENS env", len(tokens))

        self._resolved_tokens = tokens
        return tokens

    def parse_ip_allowlist(self) -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
        """Parse the comma-separated IP allowlist into network objects."""
        networks = []
        for entry in self.ip_allowlist.split(","):
            entry = entry.strip()
            if not entry:
                continue
            try:
                networks.append(ipaddress.ip_network(entry, strict=False))
            except ValueError:
                logger.warning("Invalid network in allowlist: %s", entry)
        return networks

    @field_validator("log_level")
    @classmethod
    def _normalise_log_level(cls, v: str) -> str:
        return v.upper()
