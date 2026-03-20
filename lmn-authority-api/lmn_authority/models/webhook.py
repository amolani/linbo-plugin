"""Webhook registration models (stub for future phase)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


WebhookEvent = Literal[
    "hosts.changed",
    "startconfs.changed",
    "configs.changed",
    "dhcp.changed",
]


class WebhookRegistration(BaseModel):
    url: str
    events: list[WebhookEvent] = Field(min_length=1)
    secret: str = Field(min_length=16)


class WebhookResponse(BaseModel):
    id: str
    url: str
    events: list[str]
    createdAt: datetime
