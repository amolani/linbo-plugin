# ──────────────────────────────────────────────────────────────────────
# Append the following models to the END of:
#   linuxmusterApi/routers_v1/body_schemas.py
# ──────────────────────────────────────────────────────────────────────

# --- LINBO Models ---


class LinboBatchMacs(BaseModel):
    """List of MAC addresses for batch host lookup."""

    macs: list[str]


class LinboBatchIds(BaseModel):
    """List of IDs for batch config lookup."""

    ids: list[str]
