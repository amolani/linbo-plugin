"""Cursor-based delta feed endpoint."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Query

from lmn_authority.dependencies import get_delta_feed
from lmn_authority.exceptions import ValidationError
from lmn_authority.models.delta import DeltaResponse

router = APIRouter(prefix="/api/v1/linbo", tags=["delta"])

_CURSOR_RE = re.compile(r"^\d+:\d+$")


@router.get("/changes", response_model=DeltaResponse)
async def get_changes(
    since: str = Query(..., description="Cursor from previous response, or empty for full snapshot"),
    delta_feed=Depends(get_delta_feed),
) -> DeltaResponse:
    # Validate cursor format: empty string or "timestamp:sequence"
    if since and not _CURSOR_RE.match(since):
        raise ValidationError(
            "Cursor must be in format 'timestamp:sequence' or empty for full snapshot"
        )

    return await delta_feed.get_changes(since)
