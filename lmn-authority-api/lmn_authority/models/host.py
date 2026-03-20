"""Host record models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class HostPolicies(BaseModel):
    bootDefault: Literal["start", "sync", "new"] = "sync"
    timeout: int = Field(default=5, ge=0)
    hiddenMenu: bool = False


class HostRecord(BaseModel):
    mac: str
    hostname: str
    ip: str | None = None
    room: str
    school: str
    hostgroup: str
    pxeEnabled: bool
    pxeFlag: Literal[0, 1, 2]
    dhcpOptions: str = ""
    startConfId: str
    policies: HostPolicies | None = None
    updatedAt: datetime


class BatchHostsRequest(BaseModel):
    macs: list[str] = Field(min_length=1, max_length=500)


class BatchHostsResponse(BaseModel):
    hosts: list[HostRecord]
