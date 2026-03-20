"""FastAPI application factory with lifespan context manager."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from lmn_authority.config import Settings
from lmn_authority.exceptions import register_exception_handlers

logger = logging.getLogger(__name__)

_start_time: float = 0.0


def get_uptime() -> int:
    """Return process uptime in seconds."""
    return int(time.monotonic() - _start_time)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: start/stop adapters, services, watcher."""
    global _start_time
    _start_time = time.monotonic()

    settings: Settings = app.state.settings

    # Configure logging
    logging.basicConfig(
        level=getattr(logging, settings.log_level, logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # --- Import here to avoid circular imports at module level ---
    from lmn_authority.adapters.devices import DevicesAdapter
    from lmn_authority.adapters.dhcp_export import DhcpExportAdapter, NetworkSettings
    from lmn_authority.adapters.startconf import StartConfAdapter
    from lmn_authority.services.delta_feed import DeltaFeedService, EntitySnapshot

    # --- Initialize adapters ---
    devices_adapter = DevicesAdapter(settings.devices_csv_path)
    devices_adapter.load()
    app.state.devices_adapter = devices_adapter

    startconf_adapter = StartConfAdapter(settings.start_conf_dir)
    startconf_adapter.load()
    app.state.startconf_adapter = startconf_adapter

    net_settings = NetworkSettings(
        server_ip=settings.server_ip,
        subnet=settings.subnet,
        netmask=settings.netmask,
        gateway=settings.gateway,
        dns=settings.dns,
        domain=settings.domain,
        dhcp_interface=settings.dhcp_interface,
    )
    dhcp_adapter = DhcpExportAdapter(net_settings)
    app.state.dhcp_adapter = dhcp_adapter

    # --- Initialize delta feed ---
    settings.delta_db_path.parent.mkdir(parents=True, exist_ok=True)
    delta_feed = DeltaFeedService(settings.delta_db_path)
    await delta_feed.start()

    def _entity_provider() -> EntitySnapshot:
        return EntitySnapshot(
            host_macs=devices_adapter.get_all_macs(),
            startconf_ids=startconf_adapter.get_all_ids(),
            config_ids=startconf_adapter.get_all_ids(),
        )

    delta_feed.set_entity_provider(_entity_provider)
    app.state.delta_feed = delta_feed

    # --- Start watcher (optional, only if paths exist) ---
    watcher = None
    try:
        from lmn_authority.services.watcher import WatcherService

        watcher = WatcherService(
            devices_adapter=devices_adapter,
            startconf_adapter=startconf_adapter,
            delta_feed=delta_feed,
            debounce_ms=settings.watcher_debounce_ms,
        )
        await watcher.start()
        app.state.watcher = watcher
    except Exception:
        logger.warning("File watcher could not start (non-fatal)", exc_info=True)

    logger.info(
        "LMN Authority API started — %d hosts, %d configs",
        len(devices_adapter.hosts),
        len(startconf_adapter.configs),
    )

    yield

    # --- Shutdown ---
    if watcher:
        await watcher.stop()
    await delta_feed.stop()
    logger.info("LMN Authority API stopped")


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    if settings is None:
        settings = Settings()

    version = "1.0.0"
    try:
        version_file = Path(__file__).parent.parent / "VERSION"
        if version_file.exists():
            version = version_file.read_text().strip()
    except Exception:
        pass

    from lmn_authority.models.error import ErrorResponse

    app = FastAPI(
        title="LMN Authority API",
        version=version,
        summary="linuxmuster.net LINBO Host & Config Authority API",
        lifespan=lifespan,
        responses={
            400: {"model": ErrorResponse},
            401: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
            429: {"model": ErrorResponse},
        },
    )

    app.state.settings = settings
    app.state.version = version

    # Register exception handlers
    register_exception_handlers(app)

    # Register middleware (order matters: auth first, then rate limit)
    tokens = settings.resolve_tokens()
    networks = settings.parse_ip_allowlist()

    from lmn_authority.middleware.auth import AuthMiddleware
    from lmn_authority.middleware.rate_limit import RateLimitMiddleware

    # Middleware is applied in reverse order (last added = first executed)
    app.add_middleware(RateLimitMiddleware, rpm=settings.rate_limit_rpm)
    app.add_middleware(
        AuthMiddleware,
        tokens=tokens,
        networks=networks,
        trust_proxy=settings.trust_proxy_headers,
    )

    # Register routers
    from lmn_authority.routers import configs, delta, dhcp, health, hosts, images, startconfs, webhooks

    app.include_router(health.router)
    app.include_router(delta.router)
    app.include_router(hosts.router)
    app.include_router(startconfs.router)
    app.include_router(configs.router)
    app.include_router(dhcp.router)
    app.include_router(webhooks.router)
    app.include_router(images.router)

    return app


# Default app instance for uvicorn
app = create_app()
