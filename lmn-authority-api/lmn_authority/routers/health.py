"""Health and readiness endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from lmn_authority.models.health import HealthResponse, ReadyResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    from lmn_authority.main import get_uptime

    devices = request.app.state.devices_adapter
    startconf = request.app.state.startconf_adapter

    last_change = None
    if devices.last_modified or startconf.last_modified:
        times = [t for t in [devices.last_modified, startconf.last_modified] if t is not None]
        if times:
            last_change = max(times)

    status = "ok"
    if len(devices.hosts) == 0 and len(startconf.configs) == 0:
        status = "degraded"

    return HealthResponse(
        status=status,
        version=request.app.state.version,
        uptime=get_uptime(),
        lastChange=last_change,
    )


@router.get("/ready")
async def ready(request: Request) -> JSONResponse:
    settings = request.app.state.settings

    issues = []
    if not settings.devices_csv_path.exists():
        issues.append(f"devices.csv not found: {settings.devices_csv_path}")
    if not settings.start_conf_dir.exists():
        issues.append(f"start.conf dir not found: {settings.start_conf_dir}")

    if issues:
        body = ReadyResponse(ready=False, reason="; ".join(issues))
        return JSONResponse(status_code=503, content=body.model_dump())

    return JSONResponse(status_code=200, content=ReadyResponse(ready=True).model_dump())
