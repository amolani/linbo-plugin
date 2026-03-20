"""Append-only changelog with cursor-based delta feed, persisted in SQLite."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import aiosqlite

from lmn_authority.models.delta import DeltaResponse

logger = logging.getLogger(__name__)

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS changelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cursor_ts INTEGER NOT NULL,
    cursor_seq INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'upsert',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(cursor_ts, cursor_seq)
);
CREATE INDEX IF NOT EXISTS idx_changelog_cursor ON changelog(cursor_ts, cursor_seq);
"""


@dataclass
class EntitySnapshot:
    """Current set of known entity IDs, used for full-snapshot mode."""

    host_macs: list[str] = field(default_factory=list)
    startconf_ids: list[str] = field(default_factory=list)
    config_ids: list[str] = field(default_factory=list)


class DeltaFeedService:
    """Append-only changelog with cursor-based delta feed, persisted in SQLite."""

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None
        self._sequence = 0
        self._entity_provider: Callable[[], EntitySnapshot] | None = None

    def set_entity_provider(self, provider: Callable[[], EntitySnapshot]) -> None:
        """Set callback to get current entity IDs for full snapshot mode."""
        self._entity_provider = provider

    async def start(self) -> None:
        """Initialize SQLite DB, create tables, restore sequence."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(str(self._db_path))
        await self._db.executescript(_SCHEMA)
        await self._db.commit()

        # Restore sequence from last entry
        async with self._db.execute(
            "SELECT cursor_seq FROM changelog ORDER BY id DESC LIMIT 1"
        ) as cur:
            row = await cur.fetchone()
            if row:
                self._sequence = row[0]

        logger.info("DeltaFeedService started (sequence=%d)", self._sequence)

    async def stop(self) -> None:
        """Close DB connection."""
        if self._db:
            await self._db.close()
            self._db = None

    async def record_change(
        self, entity_type: str, entity_id: str, action: str = "upsert"
    ) -> None:
        """Record a change event.

        entity_type: 'host' | 'startconf' | 'config' | 'dhcp'
        action: 'upsert' | 'delete'
        """
        if not self._db:
            raise RuntimeError("DeltaFeedService not started")

        self._sequence += 1
        cursor_ts = int(time.time())
        cursor_seq = self._sequence

        await self._db.execute(
            "INSERT INTO changelog (cursor_ts, cursor_seq, entity_type, entity_id, action) "
            "VALUES (?, ?, ?, ?, ?)",
            (cursor_ts, cursor_seq, entity_type, entity_id, action),
        )
        await self._db.commit()
        logger.debug(
            "Recorded change: %s %s %s (cursor=%d:%d)",
            action,
            entity_type,
            entity_id,
            cursor_ts,
            cursor_seq,
        )

    async def get_changes(self, since: str = "") -> DeltaResponse:
        """Get changes since cursor. Empty/stale cursor -> full snapshot."""
        if not self._db:
            raise RuntimeError("DeltaFeedService not started")

        # Empty cursor -> full snapshot
        if not since:
            return await self._full_snapshot()

        # Parse cursor
        try:
            ts_str, seq_str = since.split(":")
            cursor_ts = int(ts_str)
            cursor_seq = int(seq_str)
        except (ValueError, AttributeError):
            return await self._full_snapshot()

        # Check if cursor is still valid (AC-5 stale detection)
        if not await self._is_valid_cursor(cursor_ts, cursor_seq):
            return await self._full_snapshot()

        # Incremental query
        rows = []
        async with self._db.execute(
            "SELECT entity_type, entity_id, action FROM changelog "
            "WHERE (cursor_ts > ?) OR (cursor_ts = ? AND cursor_seq > ?) "
            "ORDER BY cursor_ts, cursor_seq",
            (cursor_ts, cursor_ts, cursor_seq),
        ) as cur:
            rows = await cur.fetchall()

        hosts_changed: list[str] = []
        startconfs_changed: list[str] = []
        configs_changed: list[str] = []
        dhcp_changed = False
        deleted_hosts: list[str] = []
        deleted_startconfs: list[str] = []

        for entity_type, entity_id, action in rows:
            if action == "delete":
                if entity_type == "host":
                    deleted_hosts.append(entity_id)
                elif entity_type == "startconf":
                    deleted_startconfs.append(entity_id)
            else:
                if entity_type == "host":
                    hosts_changed.append(entity_id)
                    dhcp_changed = True
                elif entity_type == "startconf":
                    startconfs_changed.append(entity_id)
                elif entity_type == "config":
                    configs_changed.append(entity_id)
                elif entity_type == "dhcp":
                    dhcp_changed = True

        next_cursor = await self._latest_cursor()

        return DeltaResponse(
            nextCursor=next_cursor,
            hostsChanged=hosts_changed,
            startConfsChanged=startconfs_changed,
            configsChanged=configs_changed,
            dhcpChanged=dhcp_changed,
            deletedHosts=deleted_hosts,
            deletedStartConfs=deleted_startconfs,
        )

    async def compact(self, max_age_hours: int = 24, max_entries: int = 10000) -> None:
        """Remove old changelog entries."""
        if not self._db:
            raise RuntimeError("DeltaFeedService not started")

        cutoff_ts = int(time.time()) - (max_age_hours * 3600)

        # Delete by age
        await self._db.execute(
            "DELETE FROM changelog WHERE cursor_ts < ?", (cutoff_ts,)
        )

        # Delete by count (keep newest max_entries)
        await self._db.execute(
            "DELETE FROM changelog WHERE id NOT IN "
            "(SELECT id FROM changelog ORDER BY id DESC LIMIT ?)",
            (max_entries,),
        )
        await self._db.commit()
        logger.info("Compacted changelog (max_age_hours=%d, max_entries=%d)", max_age_hours, max_entries)

    async def _is_valid_cursor(self, cursor_ts: int, cursor_seq: int) -> bool:
        """Check if cursor exists in changelog (AC-5 stale detection)."""
        if not self._db:
            return False
        async with self._db.execute(
            "SELECT 1 FROM changelog WHERE cursor_ts = ? AND cursor_seq = ?",
            (cursor_ts, cursor_seq),
        ) as cur:
            return (await cur.fetchone()) is not None

    async def _full_snapshot(self) -> DeltaResponse:
        """Return a full snapshot of all known entities."""
        snapshot = EntitySnapshot()
        if self._entity_provider:
            snapshot = self._entity_provider()

        next_cursor = await self._latest_cursor()

        return DeltaResponse(
            nextCursor=next_cursor,
            hostsChanged=snapshot.host_macs,
            startConfsChanged=snapshot.startconf_ids,
            configsChanged=snapshot.config_ids,
            dhcpChanged=True,
            deletedHosts=[],
            deletedStartConfs=[],
        )

    async def _latest_cursor(self) -> str:
        """Get the latest cursor string. Returns a synthetic cursor if DB is empty."""
        if not self._db:
            return self._make_cursor()
        async with self._db.execute(
            "SELECT cursor_ts, cursor_seq FROM changelog ORDER BY id DESC LIMIT 1"
        ) as cur:
            row = await cur.fetchone()
            if row:
                return f"{row[0]}:{row[1]}"
        # No entries yet — return a synthetic cursor that we also record
        # so that subsequent _is_valid_cursor checks pass
        return await self._create_synthetic_cursor()

    async def _create_synthetic_cursor(self) -> str:
        """Create and persist a synthetic cursor entry for an empty DB."""
        self._sequence += 1
        cursor_ts = int(time.time())
        cursor_seq = self._sequence
        await self._db.execute(
            "INSERT INTO changelog (cursor_ts, cursor_seq, entity_type, entity_id, action) "
            "VALUES (?, ?, ?, ?, ?)",
            (cursor_ts, cursor_seq, "_synthetic", "_snapshot", "snapshot"),
        )
        await self._db.commit()
        return f"{cursor_ts}:{cursor_seq}"

    def _make_cursor(self) -> str:
        """Generate cursor: 'unix_timestamp:sequence'."""
        return f"{int(time.time())}:{self._sequence}"
