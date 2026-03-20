"""DHCP export and reservation batch endpoints."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from email.utils import format_datetime, parsedate_to_datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse, JSONResponse

from lmn_authority.dependencies import get_devices_adapter, get_dhcp_adapter
from lmn_authority.exceptions import ValidationError
from lmn_authority.models.dhcp import (
    BatchDhcpRequest,
    BatchDhcpResponse,
    BootPolicy,
    DhcpReservation,
)

router = APIRouter(prefix="/api/v1/linbo/dhcp", tags=["dhcp"])

_MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")


def _host_to_reservation(data: dict) -> DhcpReservation:
    """Convert adapter HostData to DhcpReservation."""
    # Default to efi64 architecture for boot policy
    arch = "efi64"
    bootfile = "boot/grub/x86_64-efi/core.efi"

    return DhcpReservation(
        mac=data["mac"],
        hostname=data["hostname"],
        ip=data.get("ip"),
        pxeEnabled=data["pxeEnabled"],
        hostgroup=data["hostgroup"],
        bootPolicy=BootPolicy(
            arch=arch,
            bootfile=bootfile,
            nextServer=data.get("_server_ip", "10.0.0.1"),
        ),
    )


@router.post("/reservations:batch", response_model=BatchDhcpResponse)
async def batch_get_reservations(
    body: BatchDhcpRequest,
    devices=Depends(get_devices_adapter),
    request: Request = None,
) -> BatchDhcpResponse:
    for mac in body.macs:
        if not _MAC_RE.match(mac):
            raise ValidationError(f"Invalid MAC format: {mac}")

    server_ip = request.app.state.settings.server_ip if request else "10.0.0.1"

    reservations = []
    for mac in body.macs:
        data = devices.get_host(mac.upper())
        if data:
            data_with_server = {**data, "_server_ip": server_ip}
            reservations.append(_host_to_reservation(data_with_server))

    return BatchDhcpResponse(reservations=reservations)


def _conditional_response(
    request: Request, content: str, last_modified: datetime | None
) -> PlainTextResponse | JSONResponse:
    """Handle ETag / If-None-Match and Last-Modified / If-Modified-Since."""
    etag = '"' + hashlib.md5(content.encode()).hexdigest()[:12] + '"'
    headers = {"ETag": etag}

    if last_modified:
        headers["Last-Modified"] = format_datetime(last_modified, usegmt=True)

    # Check If-None-Match
    if_none_match = request.headers.get("If-None-Match")
    if if_none_match and if_none_match == etag:
        return PlainTextResponse(status_code=304, content="", headers=headers)

    # Check If-Modified-Since
    if last_modified:
        if_modified_since = request.headers.get("If-Modified-Since")
        if if_modified_since:
            try:
                client_time = parsedate_to_datetime(if_modified_since)
                if last_modified <= client_time:
                    return PlainTextResponse(status_code=304, content="", headers=headers)
            except Exception:
                pass

    return PlainTextResponse(content=content, headers=headers)


@router.get("/export/dnsmasq-proxy")
async def export_dnsmasq_proxy(
    request: Request,
    devices=Depends(get_devices_adapter),
    dhcp=Depends(get_dhcp_adapter),
) -> PlainTextResponse:
    pxe_hosts = [h for h in devices.hosts.values() if h["pxeEnabled"]]
    content = dhcp.generate_dnsmasq_proxy(pxe_hosts)
    return _conditional_response(request, content, devices.last_modified)


@router.get("/export/isc-dhcp")
async def export_isc_dhcp(
    request: Request,
    devices=Depends(get_devices_adapter),
    dhcp=Depends(get_dhcp_adapter),
) -> PlainTextResponse:
    all_hosts = list(devices.hosts.values())
    content = dhcp.generate_isc_dhcp(all_hosts)
    return _conditional_response(request, content, devices.last_modified)
