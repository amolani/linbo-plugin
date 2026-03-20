"""StartConf batch fetch and single lookup endpoints."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Query

from lmn_authority.dependencies import get_startconf_adapter
from lmn_authority.exceptions import NotFoundError, ValidationError
from lmn_authority.models.startconf import BatchStartConfsRequest, BatchStartConfsResponse, StartConfRecord

router = APIRouter(prefix="/api/v1/linbo", tags=["startconfs"])

_ID_RE = re.compile(r"^[\w._-]+$", re.UNICODE)


@router.post("/startconfs:batch", response_model=BatchStartConfsResponse)
async def batch_get_startconfs(
    body: BatchStartConfsRequest,
    startconf=Depends(get_startconf_adapter),
) -> BatchStartConfsResponse:
    for conf_id in body.ids:
        if not _ID_RE.match(conf_id):
            raise ValidationError(f"Invalid config ID format: {conf_id}")

    confs = []
    for conf_id in body.ids:
        record = startconf.get_raw(conf_id)
        if record:
            confs.append(record)

    return BatchStartConfsResponse(startConfs=confs)


@router.get("/startconf", response_model=StartConfRecord)
async def get_startconf(
    id: str = Query(..., alias="id", description="Config ID (start.conf suffix)"),
    startconf=Depends(get_startconf_adapter),
) -> StartConfRecord:
    if not _ID_RE.match(id):
        raise ValidationError(f"Invalid config ID format: {id}")

    record = startconf.get_raw(id)
    if not record:
        raise NotFoundError(f"No start.conf found with id '{id}'")

    return record
