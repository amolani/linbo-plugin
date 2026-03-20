"""Generate DHCP configuration files from host data."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone

from lmn_authority.adapters.devices import HostData


@dataclass
class NetworkSettings:
    """Network configuration for DHCP export."""

    server_ip: str = "10.0.0.1"
    subnet: str = "10.0.0.0"
    netmask: str = "255.255.0.0"
    gateway: str = "10.0.0.254"
    dns: str = "10.0.0.1"
    domain: str = "linuxmuster.lan"
    dhcp_interface: str = "eth0"


_TAG_RE = re.compile(r"[^a-zA-Z0-9_-]")


class DhcpExportAdapter:
    """Generate DHCP configuration files from host data."""

    def __init__(self, settings: NetworkSettings):
        self._settings = settings

    def generate_dnsmasq_proxy(
        self, hosts: list[HostData], *, generated_at: str | None = None
    ) -> str:
        """Generate dnsmasq proxy-DHCP config."""
        s = self._settings
        ts = generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        lines: list[str] = []

        lines.append("#")
        lines.append("# LINBO Docker - dnsmasq Configuration (proxy mode)")
        lines.append(f"# Generated: {ts}")
        lines.append(f"# Hosts: {len(hosts)}")
        lines.append("#")
        lines.append("")

        lines.append("# Proxy DHCP mode - no IP assignment, PXE only")
        lines.append("port=0")
        lines.append(f"dhcp-range={s.subnet},proxy")
        lines.append("log-dhcp")
        lines.append("")

        lines.append(f"interface={s.dhcp_interface}")
        lines.append("bind-interfaces")
        lines.append("")

        lines.append("# PXE boot architecture detection")
        lines.append("dhcp-match=set:bios,option:client-arch,0")
        lines.append("dhcp-match=set:efi32,option:client-arch,6")
        lines.append("dhcp-match=set:efi64,option:client-arch,7")
        lines.append("dhcp-match=set:efi64,option:client-arch,9")
        lines.append("")
        lines.append(f"dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,{s.server_ip}")
        lines.append(f"dhcp-boot=tag:efi32,boot/grub/i386-efi/core.efi,{s.server_ip}")
        lines.append(f"dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,{s.server_ip}")
        lines.append("")

        # Filter PXE-enabled hosts
        pxe_hosts = [h for h in hosts if h["pxeEnabled"]]

        if pxe_hosts:
            # Group by config
            config_groups = _group_by_config(pxe_hosts)

            lines.append("# Host config assignments")
            for host in pxe_hosts:
                tag = self.sanitize_tag(host["hostgroup"])
                lines.append(f"dhcp-host={host['mac']},set:{tag}")
            lines.append("")

            lines.append("# Config name via NIS-Domain (Option 40)")
            for config_name in config_groups:
                if config_name:
                    tag = self.sanitize_tag(config_name)
                    lines.append(f"dhcp-option=tag:{tag},40,{config_name}")
            lines.append("")

        return "\n".join(lines)

    def generate_isc_dhcp(
        self, hosts: list[HostData], *, generated_at: str | None = None
    ) -> str:
        """Generate ISC DHCP config."""
        s = self._settings
        ts = generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        lines: list[str] = []

        lines.append("#")
        lines.append("# LINBO Docker - ISC DHCP Configuration")
        lines.append(f"# Generated: {ts}")
        lines.append(f"# Hosts: {len(hosts)}")
        lines.append("#")
        lines.append("")
        lines.append("# Architecture detection for PXE boot")
        lines.append("option arch code 93 = unsigned integer 16;")
        lines.append("")
        lines.append("# DHCP server settings")
        lines.append(f"server-identifier {s.server_ip};")
        lines.append(f'server-name "{s.server_ip}";')
        lines.append("")
        lines.append("# LINBO TFTP boot settings")
        lines.append(f"next-server {s.server_ip};")
        lines.append("")
        lines.append('if option arch = 00:06 {')
        lines.append('  filename "boot/grub/i386-efi/core.efi";')
        lines.append('} else if option arch = 00:07 {')
        lines.append('  filename "boot/grub/x86_64-efi/core.efi";')
        lines.append('} else if option arch = 00:09 {')
        lines.append('  filename "boot/grub/x86_64-efi/core.efi";')
        lines.append("} else {")
        lines.append('  filename "boot/grub/i386-pc/core.0";')
        lines.append("}")
        lines.append("")

        # Subnet block
        lines.append(f"subnet {s.subnet} netmask {s.netmask} {{")
        lines.append(f"  option routers {s.gateway};")
        lines.append(f"  option domain-name-servers {s.dns};")
        lines.append(f'  option domain-name "{s.domain}";')
        lines.append("  default-lease-time 86400;")
        lines.append("  max-lease-time 172800;")
        lines.append("")

        # Group hosts by config
        config_groups = _group_by_config(hosts)

        for config_name, group_hosts in config_groups.items():
            lines.append(f"  # Config: {config_name or 'no-config'}")
            lines.append(f"  # Hosts: {len(group_hosts)}")

            for host in group_hosts:
                lines.append(f"  host {host['hostname']} {{")
                lines.append(f"    hardware ethernet {host['mac']};")

                if host["ip"]:
                    lines.append(f"    fixed-address {host['ip']};")

                lines.append(f'    option host-name "{host["hostname"]}";')

                if host["pxeEnabled"]:
                    lines.append(f"    next-server {s.server_ip};")
                    lines.append(f'    option extensions-path "{host["hostgroup"]}";')
                    lines.append(f'    option nis-domain "{host["hostgroup"]}";')

                lines.append("  }")
                lines.append("")

        lines.append("}")

        return "\n".join(lines)

    @staticmethod
    def sanitize_tag(name: str) -> str:
        """Sanitize string for dnsmasq tag (replace non-alphanumeric/dash/underscore with _)."""
        return _TAG_RE.sub("_", name)


def _group_by_config(hosts: list[HostData]) -> dict[str, list[HostData]]:
    """Group hosts by hostgroup/config name, preserving insertion order."""
    groups: dict[str, list[HostData]] = {}
    for host in hosts:
        key = host["hostgroup"] or "no-config"
        groups.setdefault(key, []).append(host)
    return groups
