"""StartConf record models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class StartConfRecord(BaseModel):
    id: str
    content: str
    hash: str
    updatedAt: datetime


class BatchStartConfsRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)


class BatchStartConfsResponse(BaseModel):
    startConfs: list[StartConfRecord]
