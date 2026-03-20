"""Parsed config batch fetch endpoint."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends

from lmn_authority.dependencies import get_startconf_adapter
from lmn_authority.exceptions import ValidationError
from lmn_authority.models.config import BatchConfigsRequest, BatchConfigsResponse

router = APIRouter(prefix="/api/v1/linbo", tags=["configs"])

_ID_RE = re.compile(r"^[\w._-]+$", re.UNICODE)


@router.post("/configs:batch", response_model=BatchConfigsResponse)
async def batch_get_configs(
    body: BatchConfigsRequest,
    startconf=Depends(get_startconf_adapter),
) -> BatchConfigsResponse:
    for conf_id in body.ids:
        if not _ID_RE.match(conf_id):
            raise ValidationError(f"Invalid config ID format: {conf_id}")

    configs = []
    for conf_id in body.ids:
        record = startconf.get_parsed(conf_id)
        if record:
            configs.append(record)

    return BatchConfigsResponse(configs=configs)
