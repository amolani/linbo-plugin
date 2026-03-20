"""Tests for DeltaFeedService."""

from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

import pytest

from lmn_authority.services.delta_feed import DeltaFeedService, EntitySnapshot


@pytest.fixture
async def feed(tmp_path):
    """Create a DeltaFeedService with a tmp SQLite DB."""
    svc = DeltaFeedService(db_path=tmp_path / "delta.db")
    await svc.start()
    yield svc
    await svc.stop()


@pytest.fixture
def snapshot_provider():
    """Provides a callable that returns a fixed EntitySnapshot."""
    snap = EntitySnapshot(
        host_macs=["AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02"],
        startconf_ids=["ubuntu", "win10"],
        config_ids=["cfg-1"],
    )
    return lambda: snap


# -- Full Snapshot Tests -------------------------------------------------------


async def test_empty_cursor_returns_full_snapshot(feed: DeltaFeedService, snapshot_provider):
    """Empty cursor should return all known entity IDs."""
    feed.set_entity_provider(snapshot_provider)

    resp = await feed.get_changes("")
    assert resp.hostsChanged == ["AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02"]
    assert resp.startConfsChanged == ["ubuntu", "win10"]
    assert resp.configsChanged == ["cfg-1"]
    assert resp.dhcpChanged is True
    assert resp.deletedHosts == []
    assert resp.deletedStartConfs == []


async def test_stale_cursor_returns_full_snapshot(feed: DeltaFeedService, snapshot_provider):
    """A cursor that was compacted away should trigger a full snapshot (AC-5)."""
    feed.set_entity_provider(snapshot_provider)

    # Record some changes and capture cursor
    await feed.record_change("host", "mac-1")
    first = await feed.get_changes("")
    first_cursor = first.nextCursor

    # Record more
    await feed.record_change("host", "mac-2")
    await feed.record_change("host", "mac-3")

    # Compact everything (max_age_hours=0 removes all based on time)
    # Use a direct delete to simulate compaction of the first cursor
    await feed._db.execute(
        "DELETE FROM changelog WHERE cursor_seq <= 1"
    )
    await feed._db.commit()

    # Now the first cursor is stale — should return full snapshot
    resp = await feed.get_changes(first_cursor)
    assert resp.hostsChanged == ["AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02"]
    assert resp.dhcpChanged is True


async def test_cursor_not_in_db_returns_full_snapshot(feed: DeltaFeedService, snapshot_provider):
    """A fabricated cursor that was never recorded should trigger full snapshot."""
    feed.set_entity_provider(snapshot_provider)

    # Fabricate a cursor that never existed
    resp = await feed.get_changes("9999999999:9999")
    assert resp.hostsChanged == ["AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02"]
    assert resp.dhcpChanged is True


async def test_empty_cursor_no_provider(feed: DeltaFeedService):
    """Empty cursor with no entity provider returns empty lists."""
    resp = await feed.get_changes("")
    assert resp.hostsChanged == []
    assert resp.startConfsChanged == []
    assert resp.configsChanged == []
    assert resp.dhcpChanged is True


# -- Incremental Tests ---------------------------------------------------------


async def test_record_and_get_incremental(feed: DeltaFeedService):
    """Record changes and retrieve incremental delta."""
    await feed.record_change("host", "mac-A")
    cursor = (await feed.get_changes("")).nextCursor

    await feed.record_change("host", "mac-B")
    await feed.record_change("startconf", "ubuntu")

    resp = await feed.get_changes(cursor)
    assert "mac-B" in resp.hostsChanged
    assert "mac-A" not in resp.hostsChanged
    assert "ubuntu" in resp.startConfsChanged


async def test_deleted_entities(feed: DeltaFeedService):
    """Delete actions should appear in deletedHosts/deletedStartConfs."""
    await feed.record_change("host", "mac-X")
    cursor = (await feed.get_changes("")).nextCursor

    await feed.record_change("host", "mac-Y", action="delete")
    await feed.record_change("startconf", "old-conf", action="delete")

    resp = await feed.get_changes(cursor)
    assert "mac-Y" in resp.deletedHosts
    assert "old-conf" in resp.deletedStartConfs
    assert resp.hostsChanged == []


async def test_dhcp_changed_flag(feed: DeltaFeedService):
    """Host changes should trigger dhcpChanged=True."""
    await feed.record_change("config", "cfg-1")
    cursor = (await feed.get_changes("")).nextCursor

    # Only config change — no dhcp
    await feed.record_change("config", "cfg-2")
    resp = await feed.get_changes(cursor)
    assert resp.dhcpChanged is False
    assert resp.configsChanged == ["cfg-2"]

    cursor2 = resp.nextCursor
    # Host change — dhcp triggered
    await feed.record_change("host", "mac-Z")
    resp2 = await feed.get_changes(cursor2)
    assert resp2.dhcpChanged is True


async def test_dhcp_entity_type(feed: DeltaFeedService):
    """Direct dhcp entity type changes should trigger dhcpChanged."""
    await feed.record_change("config", "cfg-1")
    cursor = (await feed.get_changes("")).nextCursor

    await feed.record_change("dhcp", "all")
    resp = await feed.get_changes(cursor)
    assert resp.dhcpChanged is True


# -- Compaction ----------------------------------------------------------------


async def test_compaction(feed: DeltaFeedService):
    """Compact should remove old entries."""
    # Record many entries
    for i in range(20):
        await feed.record_change("host", f"mac-{i}")

    # Compact to max 5 entries
    await feed.compact(max_age_hours=0, max_entries=5)

    # Verify count
    async with feed._db.execute("SELECT COUNT(*) FROM changelog") as cur:
        row = await cur.fetchone()
        assert row[0] <= 5


# -- Cursor Format -------------------------------------------------------------


async def test_cursor_format(feed: DeltaFeedService):
    """Cursor should be in 'timestamp:sequence' format."""
    await feed.record_change("host", "mac-1")
    resp = await feed.get_changes("")
    cursor = resp.nextCursor
    parts = cursor.split(":")
    assert len(parts) == 2
    assert parts[0].isdigit()
    assert parts[1].isdigit()


# -- Concurrent Changes --------------------------------------------------------


async def test_concurrent_changes(feed: DeltaFeedService):
    """Multiple rapid changes should get unique cursors."""
    for i in range(10):
        await feed.record_change("host", f"mac-{i}")

    # All entries should have unique cursor pairs
    async with feed._db.execute(
        "SELECT cursor_ts, cursor_seq FROM changelog"
    ) as cur:
        rows = await cur.fetchall()
    cursors = [(r[0], r[1]) for r in rows]
    assert len(cursors) == len(set(cursors)), "Cursors must be unique"


# -- Malformed Cursor ----------------------------------------------------------


async def test_malformed_cursor_returns_snapshot(feed: DeltaFeedService, snapshot_provider):
    """Malformed cursor strings should fall back to full snapshot."""
    feed.set_entity_provider(snapshot_provider)

    for bad in ["not-a-cursor", ":", "abc:def", ""]:
        resp = await feed.get_changes(bad)
        assert resp.hostsChanged == ["AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02"]
