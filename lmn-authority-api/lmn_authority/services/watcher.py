"""Watch filesystem for changes to devices.csv and start.conf files."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

from watchfiles import Change, awatch

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_DELAY_S = 0.2
_COOLDOWN_S = 5.0


class WatcherService:
    """Watch filesystem for changes to devices.csv and start.conf files."""

    def __init__(self, devices_adapter, startconf_adapter, delta_feed, debounce_ms: int = 500):
        self._devices = devices_adapter
        self._startconf = startconf_adapter
        self._delta = delta_feed
        self._debounce_ms = debounce_ms
        self._cooldowns: dict[str, float] = {}  # path -> cooldown_until timestamp
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start watching in background."""
        self._task = asyncio.create_task(self._watch_loop(), name="watcher")
        logger.info("WatcherService started (debounce=%dms)", self._debounce_ms)

    async def stop(self) -> None:
        """Stop watching."""
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
            logger.info("WatcherService stopped")

    async def _watch_loop(self) -> None:
        """Main watch loop using watchfiles."""
        watch_paths = set()

        devices_path = getattr(self._devices, "_path", None) or getattr(self._devices, "path", None)
        startconf_dir = getattr(self._startconf, "_dir", None) or getattr(self._startconf, "directory", None)

        if devices_path:
            # Watch parent directory so we catch new files and renames
            watch_paths.add(str(Path(devices_path).parent))
        if startconf_dir:
            watch_paths.add(str(startconf_dir))

        if not watch_paths:
            logger.warning("No paths configured for watching")
            return

        logger.info("Watching paths: %s", watch_paths)

        try:
            async for changes in awatch(
                *watch_paths,
                debounce=self._debounce_ms,
                step=100,
            ):
                for change_type, path in changes:
                    if change_type == Change.deleted:
                        continue
                    await self._handle_change(path)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Watcher loop error")

    async def _handle_change(self, path: str) -> None:
        """Handle a file change with retry logic (AC-4)."""
        now = time.monotonic()

        # 1. Check cooldown
        cooldown_until = self._cooldowns.get(path, 0)
        if now < cooldown_until:
            logger.debug("Skipping %s (in cooldown)", path)
            return

        p = Path(path)

        # 2. Check file exists and readable
        if not p.exists():
            return

        # 3. Determine adapter
        devices_path = getattr(self._devices, "_path", None) or getattr(self._devices, "path", None)
        is_devices = devices_path and str(p) == str(devices_path)
        is_startconf = p.name.startswith("start.conf.") and not is_devices

        if not is_devices and not is_startconf:
            return

        # 4. Attempt reload with retries
        last_error = None
        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                if is_devices:
                    self._devices.load()
                    logger.info("Reloaded devices.csv after file change")
                    await self._delta.record_change("host", "all", "upsert")
                    await self._delta.record_change("dhcp", "all", "upsert")
                else:
                    conf_name = p.name.removeprefix("start.conf.")
                    self._startconf.load_single(conf_name)
                    logger.info("Reloaded start.conf: %s", conf_name)
                    await self._delta.record_change("startconf", conf_name, "upsert")
                    await self._delta.record_change("config", conf_name, "upsert")
                return  # success
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Reload attempt %d/%d failed for %s: %s",
                    attempt,
                    _MAX_RETRIES,
                    path,
                    exc,
                )
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(_RETRY_DELAY_S)

        # 5. Persistent failure: log warning, set cooldown, keep old cache
        logger.warning(
            "All %d retries failed for %s, setting %ds cooldown: %s",
            _MAX_RETRIES,
            path,
            _COOLDOWN_S,
            last_error,
        )
        self._cooldowns[path] = time.monotonic() + _COOLDOWN_S
