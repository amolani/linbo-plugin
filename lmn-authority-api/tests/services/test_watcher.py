"""Tests for WatcherService."""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from lmn_authority.services.watcher import WatcherService, _COOLDOWN_S, _MAX_RETRIES


@pytest.fixture
def devices_adapter():
    adapter = AsyncMock()
    adapter.path = "/etc/linuxmuster/sophomorix/default-school/devices.csv"
    adapter.load = AsyncMock()
    return adapter


@pytest.fixture
def startconf_adapter():
    adapter = AsyncMock()
    adapter.directory = "/srv/linbo"
    adapter.load_single = AsyncMock()
    return adapter


@pytest.fixture
def delta_feed():
    return AsyncMock()


@pytest.fixture
def watcher(devices_adapter, startconf_adapter, delta_feed):
    return WatcherService(
        devices_adapter=devices_adapter,
        startconf_adapter=startconf_adapter,
        delta_feed=delta_feed,
        debounce_ms=100,
    )


# -- File Change Triggers Reload -----------------------------------------------


async def test_file_change_triggers_reload_devices(
    watcher: WatcherService, devices_adapter, delta_feed
):
    """Devices.csv change should trigger adapter.load()."""
    with patch("lmn_authority.services.watcher.Path") as MockPath:
        mock_path = MagicMock()
        mock_path.exists.return_value = True
        mock_path.__str__ = lambda s: devices_adapter.path
        mock_path.stem = "devices"
        MockPath.return_value = mock_path

        await watcher._handle_change(devices_adapter.path)

    devices_adapter.load.assert_awaited_once()
    delta_feed.record_change.assert_any_call("host", "all", "upsert")
    delta_feed.record_change.assert_any_call("dhcp", "all", "upsert")


async def test_file_change_triggers_reload_startconf(
    watcher: WatcherService, startconf_adapter, delta_feed
):
    """Start.conf change should trigger adapter.load_single()."""
    conf_path = "/srv/linbo/ubuntu.conf"

    with patch("lmn_authority.services.watcher.Path") as MockPath:
        mock_path = MagicMock()
        mock_path.exists.return_value = True
        mock_path.__str__ = lambda s: conf_path
        mock_path.stem = "ubuntu"
        MockPath.return_value = mock_path

        await watcher._handle_change(conf_path)

    startconf_adapter.load_single.assert_awaited_once_with("ubuntu")
    delta_feed.record_change.assert_awaited_once_with("startconf", "ubuntu", "upsert")


# -- Debounce ------------------------------------------------------------------


async def test_debounce_via_cooldown(watcher: WatcherService, devices_adapter):
    """Rapid changes within cooldown window should be skipped."""
    # Set a cooldown for the path
    watcher._cooldowns[devices_adapter.path] = time.monotonic() + 60

    with patch("lmn_authority.services.watcher.Path") as MockPath:
        mock_path = MagicMock()
        mock_path.exists.return_value = True
        mock_path.__str__ = lambda s: devices_adapter.path
        MockPath.return_value = mock_path

        await watcher._handle_change(devices_adapter.path)

    devices_adapter.load.assert_not_awaited()


# -- Retry on Parse Failure ----------------------------------------------------


async def test_retry_on_parse_failure(
    watcher: WatcherService, devices_adapter, delta_feed
):
    """Adapter.load() fails twice then succeeds — should retry."""
    devices_adapter.load.side_effect = [
        ValueError("parse error"),
        ValueError("parse error"),
        None,  # success on 3rd try
    ]

    with patch("lmn_authority.services.watcher.Path") as MockPath:
        mock_path = MagicMock()
        mock_path.exists.return_value = True
        mock_path.__str__ = lambda s: devices_adapter.path
        mock_path.stem = "devices"
        MockPath.return_value = mock_path

        await watcher._handle_change(devices_adapter.path)

    assert devices_adapter.load.await_count == 3
    delta_feed.record_change.assert_any_call("host", "all", "upsert")


# -- Cooldown on Persistent Failure --------------------------------------------


async def test_cooldown_on_persistent_failure(
    watcher: WatcherService, devices_adapter, delta_feed
):
    """3 failed retries should trigger a cooldown, no delta recorded."""
    devices_adapter.load.side_effect = ValueError("always fails")

    with patch("lmn_authority.services.watcher.Path") as MockPath:
        mock_path = MagicMock()
        mock_path.exists.return_value = True
        mock_path.__str__ = lambda s: devices_adapter.path
        mock_path.stem = "devices"
        MockPath.return_value = mock_path

        await watcher._handle_change(devices_adapter.path)

    assert devices_adapter.load.await_count == _MAX_RETRIES
    delta_feed.record_change.assert_not_awaited()
    assert devices_adapter.path in watcher._cooldowns


# -- Only Delta on Success -----------------------------------------------------


async def test_only_delta_on_success(
    watcher: WatcherService, startconf_adapter, delta_feed
):
    """Failed reload should not record delta."""
    startconf_adapter.load_single.side_effect = IOError("file locked")
    conf_path = "/srv/linbo/broken.conf"

    with patch("lmn_authority.services.watcher.Path") as MockPath:
        mock_path = MagicMock()
        mock_path.exists.return_value = True
        mock_path.__str__ = lambda s: conf_path
        mock_path.stem = "broken"
        MockPath.return_value = mock_path

        await watcher._handle_change(conf_path)

    delta_feed.record_change.assert_not_awaited()


# -- Non-existent File Ignored -------------------------------------------------


async def test_nonexistent_file_ignored(watcher: WatcherService, devices_adapter):
    """File that doesn't exist should be silently ignored."""
    with patch("lmn_authority.services.watcher.Path") as MockPath:
        mock_path = MagicMock()
        mock_path.exists.return_value = False
        MockPath.return_value = mock_path

        await watcher._handle_change("/srv/linbo/ghost.conf")

    devices_adapter.load.assert_not_awaited()


# -- Non-conf File Ignored -----------------------------------------------------


async def test_non_conf_file_ignored(watcher: WatcherService, devices_adapter, startconf_adapter):
    """Files that aren't .conf or devices.csv should be ignored."""
    with patch("lmn_authority.services.watcher.Path") as MockPath:
        mock_path = MagicMock()
        mock_path.exists.return_value = True
        mock_path.__str__ = lambda s: "/srv/linbo/random.txt"
        mock_path.stem = "random"
        MockPath.return_value = mock_path

        await watcher._handle_change("/srv/linbo/random.txt")

    devices_adapter.load.assert_not_awaited()
    startconf_adapter.load_single.assert_not_awaited()
