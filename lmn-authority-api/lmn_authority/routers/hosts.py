"""Host batch fetch and single lookup endpoints."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from lmn_authority.dependencies import get_devices_adapter
from lmn_authority.exceptions import NotFoundError, ValidationError
from lmn_authority.models.host import BatchHostsRequest, BatchHostsResponse, HostPolicies, HostRecord

router = APIRouter(prefix="/api/v1/linbo", tags=["hosts"])

_MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")


def _host_data_to_record(data: dict) -> HostRecord:
    """Convert adapter HostData dict to HostRecord model."""
    return HostRecord(
        mac=data["mac"],
        hostname=data["hostname"],
        ip=data.get("ip"),
        room=data["room"],
        school=data.get("school", "default-school"),
        hostgroup=data["hostgroup"],
        pxeEnabled=data["pxeEnabled"],
        pxeFlag=data["pxeFlag"],
        dhcpOptions=data.get("dhcpOptions", ""),
        startConfId=data["startConfId"],
        policies=HostPolicies() if data["pxeEnabled"] else None,
        updatedAt=data.get("updatedAt", datetime.now(timezone.utc)),
    )


@router.post("/hosts:batch", response_model=BatchHostsResponse)
async def batch_get_hosts(
    body: BatchHostsRequest,
    devices=Depends(get_devices_adapter),
) -> BatchHostsResponse:
    # Validate MAC formats
    for mac in body.macs:
        if not _MAC_RE.match(mac):
            raise ValidationError(f"Invalid MAC format: {mac}")

    hosts = []
    for mac in body.macs:
        data = devices.get_host(mac.upper())
        if data:
            hosts.append(_host_data_to_record(data))

    return BatchHostsResponse(hosts=hosts)


@router.get("/host", response_model=HostRecord)
async def get_host(
    mac: str = Query(..., description="MAC address (colon-separated)"),
    devices=Depends(get_devices_adapter),
) -> HostRecord:
    if not _MAC_RE.match(mac):
        raise ValidationError("mac must be in format AA:BB:CC:DD:EE:FF")

    data = devices.get_host(mac.upper())
    if not data:
        raise NotFoundError(f"No host found with MAC {mac.upper()}")

    return _host_data_to_record(data)
