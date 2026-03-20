"""Health and readiness response models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    uptime: int
    lastChange: datetime | None


class ReadyResponse(BaseModel):
    ready: bool
    reason: str | None = None
