"""Webhook registration stub (future phase)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from lmn_authority.models.webhook import WebhookRegistration, WebhookResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/linbo", tags=["webhooks"])


@router.post("/webhooks", response_model=WebhookResponse, status_code=201)
async def register_webhook(body: WebhookRegistration) -> JSONResponse:
    """Stub: accepts registration, logs it, returns 201. No dispatch in MVP."""
    webhook_id = f"wh_{uuid.uuid4().hex[:24]}"

    logger.info(
        "Webhook registered (stub): id=%s url=%s events=%s",
        webhook_id,
        body.url,
        body.events,
    )

    response = WebhookResponse(
        id=webhook_id,
        url=body.url,
        events=body.events,
        createdAt=datetime.now(timezone.utc),
    )

    return JSONResponse(status_code=201, content=response.model_dump(mode="json"))
