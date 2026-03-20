"""FastAPI dependency injection via Depends()."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Request

if TYPE_CHECKING:
    from lmn_authority.adapters.devices import DevicesAdapter
    from lmn_authority.adapters.dhcp_export import DhcpExportAdapter
    from lmn_authority.adapters.startconf import StartConfAdapter
    from lmn_authority.config import Settings
    from lmn_authority.services.delta_feed import DeltaFeedService


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_devices_adapter(request: Request) -> DevicesAdapter:
    return request.app.state.devices_adapter


def get_startconf_adapter(request: Request) -> StartConfAdapter:
    return request.app.state.startconf_adapter


def get_dhcp_adapter(request: Request) -> DhcpExportAdapter:
    return request.app.state.dhcp_adapter


def get_delta_feed(request: Request) -> DeltaFeedService:
    return request.app.state.delta_feed
