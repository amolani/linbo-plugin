"""Error response model."""

from __future__ import annotations

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    error: str
    message: str
    details: dict | None = None
