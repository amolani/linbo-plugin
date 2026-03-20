"""Delta feed response model."""

from __future__ import annotations

from pydantic import BaseModel


class DeltaResponse(BaseModel):
    nextCursor: str
    hostsChanged: list[str]
    startConfsChanged: list[str]
    configsChanged: list[str]
    dhcpChanged: bool
    deletedHosts: list[str]
    deletedStartConfs: list[str]
