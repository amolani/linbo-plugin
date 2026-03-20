"""DHCP reservation models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class BootPolicy(BaseModel):
    arch: Literal["efi64", "efi32", "bios"]
    bootfile: str
    nextServer: str


class DhcpReservation(BaseModel):
    mac: str
    hostname: str
    ip: str | None = None
    pxeEnabled: bool
    hostgroup: str
    bootPolicy: BootPolicy


class BatchDhcpRequest(BaseModel):
    macs: list[str] = Field(min_length=1, max_length=500)


class BatchDhcpResponse(BaseModel):
    reservations: list[DhcpReservation]
