# LINBO Docker Migration Plan

> **Version:** 1.0
> **Date:** 2026-02-26
> **Status:** Draft
>
> **ACHTUNG: Nicht umgesetzter Entwurf.** Siehe [docs/ARCHITECTURE.md](../ARCHITECTURE.md) fuer den aktuellen Stand.

## Executive Summary

LINBO Docker is being restructured from a full standalone solution to a **runtime-only boot server** that receives its configuration from a new **LMN Authority API** (Python FastAPI) running on the LMN server. Docker keeps all LINBO operations (remote commands, WoL, kernel, firmware, drivers, GRUB theme, image management) but loses Host/Config/Room CRUD, which moves to the LMN Authority API as source of truth. Boot serving switches from live DB queries to a snapshot-based static model.

---

## 1. Current State Inventory

### 1.1 Codebase Summary

| Layer | Files | Total LOC |
|-------|------:|----------:|
| API Routes | 12 | 7,291 |
| API Services | 15 | 7,653 |
| API Libs | 10 | 2,536 |
| API Middleware | 3 | 815 |
| API Workers | 2 | 782 |
| API Templates | 5 | 573 |
| Prisma Schema | 1 | 287 |
| Frontend Pages | 14 | 3,621 |
| Frontend Components | ~50 | 8,747 |
| Frontend Stores | 5 | 486 |
| Frontend API modules | 11 | 1,240 |
| Tests | 28 | 11,273 |
| **Total** | **~156** | **~45,304** |

---

## 2. Detailed File Classification

Classification legend:
- **KEEP** = LINBO runtime function, stays as-is
- **MODIFY** = stays but needs refactoring for snapshot architecture
- **REMOVE** = Host/Config/Room CRUD, moves to LMN Authority API
- **NEW** = doesn't exist yet, needs to be created

### 2.1 API Routes

| File | LOC | Endpoints | Classification | Reason |
|------|----:|-----------|:--------------:|--------|
| `routes/index.js` | 152 | Route aggregator + API info | **MODIFY** | Remove CRUD route mounts, add sync/snapshot routes |
| `routes/auth.js` | 279 | POST login/logout/register, GET me, PUT password | **KEEP** | Auth stays local to Docker |
| `routes/hosts.js` | 963 | GET/POST/PATCH/DELETE hosts, import/export, WoL, sync, start, status, schedule-command | **MODIFY** | REMOVE: POST/PATCH/DELETE (CRUD), import/export, sync-filesystem. KEEP: GET (read from local snapshot DB), WoL, sync, start, status updates, schedule-command |
| `routes/rooms.js` | 366 | GET/POST/PATCH/DELETE rooms, wake-all, shutdown-all | **MODIFY** | REMOVE: POST/PATCH/DELETE (CRUD). KEEP: GET (read from snapshot), wake-all, shutdown-all |
| `routes/configs.js` | 910 | GET/POST/PATCH/DELETE configs, preview, deploy, clone, raw edit, deploy-all, cleanup-symlinks | **MODIFY** | REMOVE: POST/PATCH/DELETE/clone/raw-edit (CRUD). KEEP: GET (read from snapshot), preview. MODIFY: deploy endpoints become snapshot-based |
| `routes/images.js` | 886 | GET/POST/PATCH/DELETE images, verify, info, sidecars | **KEEP** | Image management stays in Docker |
| `routes/operations.js` | 1,127 | GET/POST operations, send-command, direct, schedule, wake, validate-commands, provision, macct | **KEEP** | All operations stay in Docker |
| `routes/dhcp.js` | 199 | GET/PUT network-settings, GET summary, GET export/*, POST reload-proxy | **REMOVE** | DHCP editing moves to LMN. Export endpoints may be kept read-only from snapshot |
| `routes/stats.js` | 401 | GET overview/hosts/operations/images/audit | **MODIFY** | Stats stay but host/room/config counts come from snapshot |
| `routes/system.js` | 1,330 | linbofs, keys, kernel, firmware, WLAN, GRUB theme, GRUB configs, worker | **KEEP** | All system/runtime operations stay |
| `routes/internal.js` | 976 | rsync-event, client-status, config/:id, register-host, macct-job, operations status | **MODIFY** | KEEP: rsync-event, client-status. MODIFY: config/:identifier reads from snapshot FS. REMOVE: register-host (LMN handles). KEEP: macct/operations |
| `routes/patchclass.js` | 563 | Full patchclass/driver-set CRUD, catalog, postsync deploy | **KEEP** | Driver management stays in Docker |

### 2.2 API Services

| File | LOC | Purpose | Classification | Changes if MODIFY |
|------|----:|---------|:--------------:|-------------------|
| `services/config.service.js` | 608 | Generate start.conf, deploy to /srv/linbo, symlink management, raw config read/write, parseStartConf | **MODIFY** | Remove write operations (create/update). Keep generateStartConf for preview. Add snapshot reader that reads from synced files instead of DB |
| `services/grub.service.js` | 769 | Generate GRUB configs (main, per-config, per-host), host symlinks, regenerateAll, cleanup | **MODIFY** | Switch from DB-driven generation to snapshot-driven. Grub configs generated from snapshot data |
| `services/host.service.js` | 381 | Host CRUD helpers, validateHostData, resolveHostConfig | **REMOVE** | Host CRUD moves to LMN |
| `services/dhcp.service.js` | 504 | Network settings CRUD, DHCP config generation (ISC, dnsmasq), export summary | **REMOVE** | DHCP config moves to LMN. May keep read-only export from snapshot |
| `services/deviceImport.service.js` | 748 | CSV import/export (15-column devices.csv), syncFilesystem, parseCsvRow | **REMOVE** | Device management moves to LMN |
| `services/remote.service.js` | 789 | linbo-remote SSH execution, onboot .cmd files, WoL+commands, validateCommandString | **KEEP** | Core LINBO operations |
| `services/wol.service.js` | 157 | Wake-on-LAN magic packet send | **KEEP** | Core LINBO operations |
| `services/ssh.service.js` | 282 | SSH connection to LINBO clients | **KEEP** | Core LINBO operations |
| `services/macct.service.js` | 483 | Machine account repair via Redis stream to DC worker | **KEEP** | Core LINBO operations |
| `services/provisioning.service.js` | 445 | Host provisioning via Redis stream to DC worker | **MODIFY** | Provisioning triggered by sync events instead of CRUD events |
| `services/kernel.service.js` | 394 | Kernel variant management, switch, repair, linbofs rebuild | **KEEP** | System management |
| `services/firmware.service.js` | 584 | Firmware entry management, catalog, WLAN config | **KEEP** | System management |
| `services/linbofs.service.js` | 339 | linbofs64 update, SSH key management, verification | **KEEP** | System management |
| `services/grub-theme.service.js` | 535 | GRUB theme config, icons, logo upload/management | **KEEP** | System management |
| `services/patchclass.service.js` | 831 | Windows driver patchclass management, driver sets, postsync | **KEEP** | System management |

### 2.3 Libraries & Middleware

| File | LOC | Purpose | Classification | Reason |
|------|----:|---------|:--------------:|--------|
| `lib/prisma.js` | 72 | Prisma client singleton | **MODIFY** | Schema changes for snapshot models |
| `lib/redis.js` | 187 | Redis client, caching, pub/sub | **KEEP** | Infrastructure |
| `lib/websocket.js` | 306 | WebSocket server, broadcast, event subscriptions | **KEEP** | Infrastructure |
| `lib/image-path.js` | 183 | Image path resolution, validation, sidecar helpers | **KEEP** | Image management |
| `lib/firmware-scanner.js` | 259 | Scan host filesystem for firmware files | **KEEP** | Firmware management |
| `lib/firmware-catalog.js` | 333 | Firmware vendor categorization | **KEEP** | Firmware management |
| `lib/driver-shell.js` | 29 | Shell command execution for drivers | **KEEP** | Driver management |
| `lib/driver-fs.js` | 192 | Driver filesystem operations | **KEEP** | Driver management |
| `lib/driver-path.js` | 130 | Driver path resolution | **KEEP** | Driver management |
| `lib/driver-catalog.js` | 199 | Driver catalog by category | **KEEP** | Driver management |
| `middleware/auth.js` | 264 | JWT authentication, API key auth, password hashing | **KEEP** | Auth stays local |
| `middleware/validate.js` | 344 | Zod schemas for request validation | **MODIFY** | Remove host/room/config CRUD schemas, add sync/snapshot schemas |
| `middleware/audit.js` | 207 | Audit logging middleware | **KEEP** | Observability |

### 2.4 Workers & Templates

| File | LOC | Purpose | Classification | Reason |
|------|----:|---------|:--------------:|--------|
| `workers/operation.worker.js` | 437 | Process pending operations via SSH | **KEEP** | Core runtime |
| `workers/host-status.worker.js` | 345 | Periodic host status check (ping/SSH) | **MODIFY** | Read hosts from snapshot instead of DB query |
| `templates/grub/grub.cfg.pxe` | 187 | PXE GRUB boot template | **KEEP** | Boot chain |
| `templates/grub/grub.cfg.global` | 78 | Global GRUB config template | **KEEP** | Boot chain |
| `templates/grub/grub.cfg.os` | 132 | Per-OS GRUB menu entry template | **KEEP** | Boot chain |
| `templates/postsync-patchclass.sh` | 101 | Postsync script for patchclass deployment | **KEEP** | Driver deployment |
| `templates/00-match-drivers.sh` | 175 | Driver matching script template | **KEEP** | Driver deployment |

### 2.5 Database Schema (Prisma Models)

| Model | Fields | Classification | Changes |
|-------|-------:|:--------------:|---------|
| `Room` | 6 | **MODIFY** | Becomes read-only mirror. Remove write paths. Add `syncedAt` field |
| `Config` | 17 | **MODIFY** | Becomes read-only mirror. Remove write paths. Add `syncedAt`, `snapshotVersion` |
| `Host` | 18 | **MODIFY** | Becomes read-only mirror for identity fields (hostname, MAC, IP, room, config). Status/lastSeen remain writable |
| `ConfigPartition` | 8 | **MODIFY** | Read-only mirror, populated by sync |
| `ConfigOs` | 23 | **MODIFY** | Read-only mirror, populated by sync |
| `Image` | 17 | **KEEP** | Image management stays in Docker |
| `Operation` | 16 | **KEEP** | Operations stay in Docker |
| `Session` | 11 | **KEEP** | Operations stay in Docker |
| `User` | 9 | **KEEP** | Auth stays local |
| `ApiKey` | 8 | **KEEP** | Auth stays local |
| `AuditLog` | 11 | **KEEP** | Observability stays |
| `SyncState` | - | **NEW** | Track last sync timestamp, version, status, error |
| `SnapshotMeta` | - | **NEW** | Track snapshot version, hash, file count, generated timestamp |

### 2.6 Frontend Pages

| Page | LOC | Classification | Reason |
|------|----:|:--------------:|--------|
| `LoginPage.tsx` | 83 | **KEEP** | Auth stays local |
| `DashboardPage.tsx` | 326 | **MODIFY** | Show sync status, snapshot age. Host/config counts from snapshot |
| `HostsPage.tsx` | 476 | **MODIFY** | REMOVE: Create/Edit/Delete host buttons. KEEP: List view, status display, WoL, operations. ADD: "Synced from LMN" badge, link to LMN for editing |
| `RoomsPage.tsx` | 470 | **MODIFY** | REMOVE: Create/Edit/Delete room. KEEP: List view, host counts, wake-all/shutdown-all. ADD: Sync status |
| `ConfigsPage.tsx` | 663 | **MODIFY** | REMOVE: Create/Edit/Delete/Clone config, partition/OS editors. KEEP: List view, preview, LINBO GUI preview. ADD: Snapshot version display |
| `ImagesPage.tsx` | 731 | **KEEP** | Image management stays |
| `OperationsPage.tsx` | 395 | **KEEP** | All operations stay |
| `DhcpPage.tsx` | 15 | **REMOVE** | DHCP editing moves to LMN |
| `KernelPage.tsx` | 16 | **KEEP** | System management |
| `FirmwarePage.tsx` | 16 | **KEEP** | System management |
| `DriversPage.tsx` | 17 | **KEEP** | System management |
| `GrubThemePage.tsx` | 15 | **KEEP** | System management |
| `LinboGuiPage.tsx` | 137 | **KEEP** | LINBO GUI preview |
| `index.ts` | 8 | **MODIFY** | Remove DHCP export |

### 2.7 Frontend Components

| Group | Files | Total LOC | Classification | Reason |
|-------|------:|----------:|:--------------:|--------|
| **layout/** (AppLayout, Sidebar, Header) | 4 | 312 | **MODIFY** | Remove DHCP nav item, add Sync Status indicator in header |
| **dashboard/** (StatsCards, RecentOperations) | 3 | 221 | **MODIFY** | Add sync/snapshot status card |
| **hosts/** (HostTable, HostFilters, HostActions, ImportHostsModal, ProvisionBadge) | 6 | 755 | **MODIFY** | REMOVE: ImportHostsModal, create/edit/delete actions from HostActions. KEEP: HostTable, HostFilters, ProvisionBadge |
| **configs/** (PartitionsEditor, OsEntriesEditor, LinboSettingsForm, IconSelect, DiskLayoutBar, GrubMenuPreview, LinboGuiPreview, LinboGuiAdminPreview, RawConfigEditorModal) | 10 | 2,536 | **MODIFY** | REMOVE: PartitionsEditor, OsEntriesEditor, LinboSettingsForm, RawConfigEditorModal (edit UIs). KEEP: DiskLayoutBar, GrubMenuPreview, LinboGuiPreview, LinboGuiAdminPreview, IconSelect (read-only previews) |
| **operations/** (RemoteCommandModal, ScheduledCommandsSection) | 3 | 594 | **KEEP** | All operations stay |
| **dhcp/** (NetworkSettingsForm, DhcpExportCard, DhcpPreviewModal) | 4 | 387 | **REMOVE** | DHCP editing moves to LMN |
| **drivers/** (PatchclassManager, DriverCatalog) | 2 | 1,033 | **KEEP** | Driver management stays |
| **system/** (KernelSwitcher, FirmwareManager, WlanConfig, GrubThemeManager) | 4 | 2,642 | **KEEP** | System management stays |
| **ui/** (Button, Input, Modal, Table, Badge, Toast, FileUpload) | 8 | 1,026 | **KEEP** | Shared UI components |

### 2.8 Frontend Stores & API Modules

#### Stores

| Store | LOC | Classification | Reason |
|-------|----:|:--------------:|--------|
| `authStore.ts` | 98 | **KEEP** | Auth stays local |
| `hostStore.ts` | 136 | **MODIFY** | Remove create/update/delete actions. Add sync status state |
| `wsStore.ts` | 162 | **MODIFY** | Add sync event handlers (sync.completed, snapshot.updated) |
| `notificationStore.ts` | 64 | **KEEP** | Infrastructure |
| `serverConfigStore.ts` | 26 | **KEEP** | Infrastructure |

#### API Modules

| Module | LOC | Classification | Reason |
|--------|----:|:--------------:|--------|
| `client.ts` | 62 | **KEEP** | Axios client stays |
| `auth.ts` | 32 | **KEEP** | Auth API stays |
| `hosts.ts` | 223 | **MODIFY** | Remove create/update/delete. Keep list/get/WoL/status. Add sync trigger |
| `rooms.ts` | 77 | **MODIFY** | Remove create/update/delete. Keep list/get/wake-all/shutdown-all |
| `configs.ts` | 104 | **MODIFY** | Remove create/update/delete/clone/rawEdit. Keep list/get/preview |
| `images.ts` | 80 | **KEEP** | Image management stays |
| `operations.ts` | 182 | **KEEP** | Operations stay |
| `dhcp.ts` | 60 | **REMOVE** | DHCP moves to LMN |
| `stats.ts` | 68 | **MODIFY** | Add sync status endpoint |
| `system.ts` | 140 | **KEEP** | System management stays |
| `patchclass.ts` | 147 | **KEEP** | Driver management stays |

### 2.9 Tests

| Test File | LOC | Classification | Changes |
|-----------|----:|:--------------:|---------|
| `tests/api.test.js` | 464 | **MODIFY** | Remove CRUD tests for hosts/rooms/configs. Add sync/snapshot tests |
| `tests/helpers.js` | 123 | **MODIFY** | Add sync test helpers |
| `tests/setup.js` | 18 | **KEEP** | Infrastructure |
| `tests/globalSetup.js` | 13 | **KEEP** | Infrastructure |
| `tests/globalTeardown.js` | 8 | **KEEP** | Infrastructure |
| `tests/services/config.service.test.js` | 695 | **MODIFY** | Remove CRUD tests. Keep generateStartConf, deploy. Add snapshot reader tests |
| `tests/services/grub.service.test.js` | 862 | **MODIFY** | Adapt to snapshot-driven generation |
| `tests/services/host.service.test.js` | 567 | **REMOVE** | Host CRUD service removed |
| `tests/services/dhcp.service.test.js` | 646 | **REMOVE** | DHCP service removed |
| `tests/services/deviceImport.service.test.js` | 492 | **REMOVE** | Device import removed |
| `tests/services/remote.service.test.js` | 388 | **KEEP** | Remote operations stay |
| `tests/services/wol.service.test.js` | 207 | **KEEP** | WoL stays |
| `tests/services/ssh.service.test.js` | 327 | **KEEP** | SSH stays |
| `tests/services/macct.service.test.js` | 453 | **KEEP** | macct stays |
| `tests/services/provisioning.service.test.js` | 620 | **MODIFY** | Adapt to sync-triggered provisioning |
| `tests/services/kernel.service.test.js` | 578 | **KEEP** | System management |
| `tests/services/firmware.service.test.js` | 795 | **KEEP** | System management |
| `tests/services/firmware-catalog.test.js` | 315 | **KEEP** | System management |
| `tests/services/grub-theme.service.test.js` | 591 | **KEEP** | System management |
| `tests/services/patchclass.service.test.js` | 830 | **KEEP** | Driver management |
| `tests/lib/image-path.test.js` | 484 | **KEEP** | Image management |
| `tests/lib/driver-path.test.js` | 173 | **KEEP** | Driver management |
| `tests/lib/driver-fs.test.js` | 255 | **KEEP** | Driver management |
| `tests/lib/driver-shell.test.js` | 52 | **KEEP** | Driver management |
| `tests/lib/driver-catalog.test.js` | 202 | **KEEP** | Driver management |
| `tests/routes/internal-sidecar.test.js` | 316 | **KEEP** | Internal routes |
| `tests/workers/host-status.worker.test.js` | 476 | **MODIFY** | Adapt to snapshot-based host list |

---

## 3. New Components Needed

### 3.1 LMN Authority API (Python FastAPI - separate repo)

Not part of this document. See `ARCHITECTURE.md` for the LMN Authority API specification.

### 3.2 New API Services (Docker side)

#### `sync.service.js` (NEW, ~300 LOC estimated)

**Purpose:** Pull host/room/config data from LMN Authority API and update local DB.

**Methods:**
- `fullSync()` - Complete sync of all entities from LMN API
- `incrementalSync(since)` - Sync only changes since last sync timestamp
- `syncHosts(hosts)` - Upsert hosts into local DB (identity fields only)
- `syncRooms(rooms)` - Upsert rooms into local DB
- `syncConfigs(configs)` - Upsert configs with partitions and OS entries
- `getSyncState()` - Get current sync status (last sync, version, errors)
- `setSyncState(state)` - Update sync state
- `validateSyncPayload(payload)` - Validate incoming sync data

**Dependencies:** prisma, redis (for cache invalidation), websocket (for broadcast)

**Trigger:** Timer (every N seconds configurable via `SYNC_INTERVAL_SECONDS`), manual via API

#### `snapshot.service.js` (NEW, ~250 LOC estimated)

**Purpose:** Generate static boot file snapshots from synced DB data.

**Methods:**
- `generateSnapshot()` - Generate all start.conf files + GRUB configs + symlinks
- `getSnapshotMeta()` - Get current snapshot version, hash, timestamp
- `verifySnapshot()` - Verify snapshot integrity (file hashes match DB)
- `diffSnapshot()` - Compare current snapshot with DB state
- `rollbackSnapshot(version)` - Restore previous snapshot version

**Dependencies:** config.service (for generateStartConf), grub.service (for GRUB generation), prisma

#### `snapshot-grub.service.js` (NEW, ~200 LOC estimated)

**Purpose:** Generate GRUB configs from snapshot data instead of live DB queries.

**Methods:**
- `generateFromSnapshot(snapshotData)` - Generate all GRUB files from snapshot
- `generateMainGrubFromSnapshot(hosts)` - Generate main grub.cfg with MAC mapping
- `generateConfigGrubFromSnapshot(config)` - Generate per-config GRUB entry

**Dependencies:** grub.service templates, filesystem

### 3.3 New Prisma Models

```prisma
model SyncState {
  id            String   @id @default("singleton") @db.VarChar(50)
  lastSyncAt    DateTime? @map("last_sync_at") @db.Timestamptz
  lastFullSync  DateTime? @map("last_full_sync") @db.Timestamptz
  syncVersion   Int      @default(0) @map("sync_version")
  status        String   @default("idle") @db.VarChar(50)  // idle, syncing, error
  errorMessage  String?  @map("error_message") @db.Text
  hostCount     Int      @default(0) @map("host_count")
  roomCount     Int      @default(0) @map("room_count")
  configCount   Int      @default(0) @map("config_count")
  lmnApiUrl     String?  @map("lmn_api_url") @db.VarChar(1024)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@map("sync_state")
}

model SnapshotMeta {
  id            String   @id @default(uuid()) @db.Uuid
  version       Int      @map("version")
  hash          String   @db.VarChar(64)
  fileCount     Int      @map("file_count")
  status        String   @default("active") @db.VarChar(50)  // active, superseded, rollback
  generatedAt   DateTime @map("generated_at") @db.Timestamptz
  syncVersion   Int      @map("sync_version")
  files         Json     @default("[]")  // list of generated file paths + hashes
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([version], map: "idx_snapshot_version")
  @@map("snapshot_meta")
}
```

### 3.4 New API Routes

#### `routes/sync.js` (NEW, ~150 LOC estimated)

**Endpoints:**
- `GET /sync/status` - Get sync state (last sync, version, error)
- `POST /sync/trigger` - Manually trigger a full sync
- `POST /sync/webhook` - Receive push notification from LMN API
- `GET /sync/diff` - Show what would change on next sync

#### `routes/snapshot.js` (NEW, ~100 LOC estimated)

**Endpoints:**
- `GET /snapshot/status` - Get current snapshot metadata
- `POST /snapshot/generate` - Manually trigger snapshot generation
- `GET /snapshot/history` - List previous snapshots
- `POST /snapshot/rollback/:version` - Rollback to a previous snapshot

### 3.5 New Frontend Components

#### `SyncStatusCard.tsx` (NEW, ~120 LOC estimated)
Dashboard card showing last sync time, status, entity counts, link to trigger sync.

#### `SyncStatusBadge.tsx` (NEW, ~40 LOC estimated)
Header badge showing sync state (green=synced, yellow=stale, red=error).

#### `SnapshotStatusCard.tsx` (NEW, ~80 LOC estimated)
Dashboard card showing snapshot version, age, file count.

### 3.6 New Frontend Stores

#### Additions to `wsStore.ts` (~20 LOC)
Handle `sync.completed`, `sync.error`, `snapshot.generated` events.

### 3.7 New Frontend API Module

#### `sync.ts` (NEW, ~50 LOC estimated)
- `getSyncStatus()` - Get sync state
- `triggerSync()` - POST manual sync
- `getSnapshotStatus()` - Get snapshot metadata
- `triggerSnapshot()` - POST manual snapshot generation

### 3.8 New Test Files

| Test | Estimated LOC | Purpose |
|------|-------------:|---------|
| `tests/services/sync.service.test.js` | ~400 | Full/incremental sync, error handling, state management |
| `tests/services/snapshot.service.test.js` | ~300 | Snapshot generation, verification, rollback |
| `tests/routes/sync.test.js` | ~200 | Sync API endpoint tests |
| `tests/routes/snapshot.test.js` | ~150 | Snapshot API endpoint tests |

---

## 4. Phase-by-Phase Implementation Plan

### Phase 1: LMN Authority API (MVP) -- SEPARATE REPO

> **Scope:** Create the Python FastAPI on the LMN server that serves as source of truth for hosts, rooms, and configs.
> **Not covered in this plan** -- see `ARCHITECTURE.md` and `API-SPEC.md`.

---

### Phase 2a: Docker Sync Service (parallel, non-breaking)

**Goal:** Add sync infrastructure to Docker without breaking existing CRUD.

**Work Packages:**

| # | Task | Files | Est. LOC |
|---|------|-------|---------|
| 2a.1 | Add SyncState and SnapshotMeta Prisma models | `prisma/schema.prisma` | +30 |
| 2a.2 | Run `prisma db push` to apply schema changes | (migration) | 0 |
| 2a.3 | Create `sync.service.js` | `src/services/sync.service.js` | ~300 |
| 2a.4 | Create `snapshot.service.js` | `src/services/snapshot.service.js` | ~250 |
| 2a.5 | Create `routes/sync.js` with all endpoints | `src/routes/sync.js` | ~150 |
| 2a.6 | Create `routes/snapshot.js` with all endpoints | `src/routes/snapshot.js` | ~100 |
| 2a.7 | Register new routes in `routes/index.js` | `src/routes/index.js` | +10 |
| 2a.8 | Add sync Zod schemas to `middleware/validate.js` | `src/middleware/validate.js` | +30 |
| 2a.9 | Add sync WS events to `lib/websocket.js` | `src/lib/websocket.js` | +10 |
| 2a.10 | Add env vars: `LMN_API_URL`, `LMN_API_KEY`, `SYNC_INTERVAL_SECONDS` | `docker-compose.yml`, `.env.example` | +10 |
| 2a.11 | Create `sync.service.test.js` | `tests/services/sync.service.test.js` | ~400 |
| 2a.12 | Create `snapshot.service.test.js` | `tests/services/snapshot.service.test.js` | ~300 |
| 2a.13 | Frontend: Add `api/sync.ts` | `frontend/src/api/sync.ts` | ~50 |
| 2a.14 | Frontend: Add SyncStatusCard + SyncStatusBadge | `frontend/src/components/` | ~160 |
| 2a.15 | Frontend: Add sync events to wsStore | `frontend/src/stores/wsStore.ts` | +20 |
| 2a.16 | Frontend: Add SyncStatusCard to DashboardPage | `frontend/src/pages/DashboardPage.tsx` | +20 |
| 2a.17 | Frontend: Add SyncStatusBadge to Header | `frontend/src/components/layout/Header.tsx` | +10 |

**Tests to write:**
- `sync.service.test.js`: fullSync, incrementalSync, error handling, state transitions, validation
- `snapshot.service.test.js`: generate, verify, rollback, diff, concurrent generation guard

**Definition of Done:**
- [ ] Sync service pulls from LMN API and populates local DB alongside existing CRUD
- [ ] Snapshot service generates boot files from DB
- [ ] Both old CRUD and new sync work simultaneously (dual-write period)
- [ ] All new tests pass
- [ ] Dashboard shows sync status
- [ ] Manual sync trigger works from UI

**Estimated scope:** 17 work packages, ~1,850 new LOC, ~700 test LOC

---

### Phase 2b: Switch Boot-Serving to Snapshots

**Goal:** Boot serving reads from snapshot files instead of live DB. CRUD still works but snapshots are authoritative.

**Work Packages:**

| # | Task | Files | Est. LOC |
|---|------|-------|---------|
| 2b.1 | Modify `grub.service.js` to accept snapshot data parameter | `src/services/grub.service.js` | ~50 changed |
| 2b.2 | Modify `config.service.js` deployConfig to work from snapshot | `src/services/config.service.js` | ~30 changed |
| 2b.3 | Modify `internal.js` config/:identifier to read from FS snapshot | `src/routes/internal.js` | ~20 changed |
| 2b.4 | Modify `host-status.worker.js` to read hosts from snapshot DB | `src/workers/host-status.worker.js` | ~15 changed |
| 2b.5 | Add snapshot generation trigger after every sync | `src/services/sync.service.js` | +20 |
| 2b.6 | Add snapshot integrity check on API startup | `src/app.js` or `src/index.js` | +15 |
| 2b.7 | Integration test: PXE boot chain with snapshot | (manual test) | 0 |
| 2b.8 | Modify `grub.service.test.js` for snapshot-driven tests | `tests/services/grub.service.test.js` | ~100 changed |
| 2b.9 | Modify `host-status.worker.test.js` | `tests/workers/host-status.worker.test.js` | ~50 changed |

**CRITICAL: Boot must keep working!**

Approach: Feature flag `BOOT_SOURCE=snapshot|db` (default: `db`). When `snapshot`, boot files served from FS. When `db`, existing behavior. Gradual cutover.

**Tests to modify:**
- `grub.service.test.js`: Add snapshot-input test cases alongside existing DB-input tests
- `host-status.worker.test.js`: Mock snapshot data instead of DB queries

**Definition of Done:**
- [ ] PXE boot works with `BOOT_SOURCE=snapshot`
- [ ] PXE boot still works with `BOOT_SOURCE=db` (fallback)
- [ ] Boot files regenerated automatically after each sync
- [ ] Integration test with real PXE client passes
- [ ] All modified tests pass

**Estimated scope:** 9 work packages, ~300 changed LOC, ~150 test LOC

---

### Phase 2c: Remove CRUD (cleanup)

**Goal:** Remove all host/room/config/DHCP CRUD code. Docker becomes read-only for these entities.

**Work Packages:**

| # | Task | Files Affected | LOC Removed |
|---|------|----------------|-------------|
| 2c.1 | Remove host CRUD endpoints from `routes/hosts.js` | `routes/hosts.js` | ~350 |
| 2c.2 | Remove host import/export from `routes/hosts.js` | `routes/hosts.js` | ~130 |
| 2c.3 | Remove room CRUD endpoints from `routes/rooms.js` | `routes/rooms.js` | ~180 |
| 2c.4 | Remove config CRUD endpoints from `routes/configs.js` | `routes/configs.js` | ~500 |
| 2c.5 | Remove DHCP routes entirely | `routes/dhcp.js` | ~199 (full file) |
| 2c.6 | Remove `host.service.js` entirely | `services/host.service.js` | ~381 (full file) |
| 2c.7 | Remove `dhcp.service.js` entirely | `services/dhcp.service.js` | ~504 (full file) |
| 2c.8 | Remove `deviceImport.service.js` entirely | `services/deviceImport.service.js` | ~748 (full file) |
| 2c.9 | Remove host CRUD schemas from `middleware/validate.js` | `middleware/validate.js` | ~80 |
| 2c.10 | Remove register-host from `routes/internal.js` | `routes/internal.js` | ~100 |
| 2c.11 | Remove DHCP route mount from `routes/index.js` | `routes/index.js` | ~5 |
| 2c.12 | Update `routes/index.js` API info endpoint | `routes/index.js` | ~30 changed |
| 2c.13 | Modify `provisioning.service.js`: trigger from sync not CRUD | `services/provisioning.service.js` | ~50 changed |
| 2c.14 | Remove `BOOT_SOURCE` flag, make snapshot-only | `services/grub.service.js`, `routes/internal.js` | ~20 removed |
| 2c.15 | Remove DHCP page from frontend | `pages/DhcpPage.tsx` | ~15 (full file) |
| 2c.16 | Remove DHCP components from frontend | `components/dhcp/*` | ~387 (3 files) |
| 2c.17 | Remove `api/dhcp.ts` from frontend | `api/dhcp.ts` | ~60 (full file) |
| 2c.18 | Remove DHCP nav from Sidebar | `components/layout/Sidebar.tsx` | ~10 |
| 2c.19 | Remove host CRUD UI from HostsPage | `pages/HostsPage.tsx` | ~150 |
| 2c.20 | Remove ImportHostsModal | `components/hosts/ImportHostsModal.tsx` | ~429 (full file) |
| 2c.21 | Remove room CRUD UI from RoomsPage | `pages/RoomsPage.tsx` | ~200 |
| 2c.22 | Remove config edit UIs from ConfigsPage | `pages/ConfigsPage.tsx` | ~350 |
| 2c.23 | Remove PartitionsEditor, OsEntriesEditor, LinboSettingsForm, RawConfigEditorModal | `components/configs/*` | ~1,261 (4 files) |
| 2c.24 | Remove CRUD functions from `api/hosts.ts`, `api/rooms.ts`, `api/configs.ts` | 3 files | ~200 |
| 2c.25 | Remove CRUD actions from `stores/hostStore.ts` | `stores/hostStore.ts` | ~40 |
| 2c.26 | Update frontend routing (remove /dhcp) | `routes/index.tsx` | ~10 |
| 2c.27 | Remove host/dhcp/config CRUD test files | 3 test files | ~1,705 (full files) |
| 2c.28 | Update `tests/api.test.js` to remove CRUD tests | `tests/api.test.js` | ~150 |
| 2c.29 | Remove unused provisioning triggers in hosts.js | `routes/hosts.js` | ~60 |

**Definition of Done:**
- [ ] No CRUD endpoints remain for hosts/rooms/configs/DHCP
- [ ] All remaining endpoints are read-only or operation-based
- [ ] Frontend shows read-only views with "managed by LMN" indicators
- [ ] All remaining tests pass
- [ ] PXE boot still works (snapshot-only)
- [ ] No dead code or unused imports

**Estimated scope:** 29 work packages, ~7,200 LOC removed, ~1,705 test LOC removed

---

### Phase 3: Boot-Storm Hardening

**Goal:** Optimize snapshot serving for high-concurrency PXE boot scenarios.

**Work Packages:**

| # | Task | Description |
|---|------|-------------|
| 3.1 | Add file caching layer to snapshot serving | Cache start.conf and GRUB configs in memory with TTL |
| 3.2 | Optimize grub.cfg generation for large host counts | Pre-generate MAC mapping table, avoid N+1 queries |
| 3.3 | Add rsync rate limiting | Limit concurrent rsync connections per config group |
| 3.4 | Add TFTP concurrency monitoring | Expose metrics for concurrent TFTP transfers |
| 3.5 | Load test with simulated boot storm | 50+ concurrent PXE clients |
| 3.6 | Add health check endpoint with degradation detection | `/health` returns sync age, snapshot age, pending operations |

**Performance Targets:**
- Snapshot generation: < 5 seconds for 500 hosts
- grub.cfg serve time: < 50ms per request
- Concurrent boot support: 100+ simultaneous PXE clients
- Sync latency: < 30 seconds from LMN change to Docker snapshot

**Definition of Done:**
- [ ] Load test passes with 50+ concurrent simulated PXE boots
- [ ] No boot failures under concurrent load
- [ ] Health endpoint reports degradation before failure
- [ ] Monitoring dashboard shows boot metrics

---

## 5. Test Migration Strategy

### Phase 2a (Sync Service)

| Action | Tests | Count |
|--------|-------|------:|
| **Keep unchanged** | All existing tests | 727 |
| **New tests** | sync.service.test.js, snapshot.service.test.js | ~700 |
| **Total after Phase 2a** | | ~1,427 |

### Phase 2b (Snapshot Boot)

| Action | Tests | Count |
|--------|-------|------:|
| **Keep unchanged** | Most existing tests | ~700 |
| **Modify** | grub.service.test.js (+snapshot input), host-status.worker.test.js | ~150 changed |
| **New tests** | Integration snapshot-boot test | ~50 |
| **Total after Phase 2b** | | ~1,477 |

### Phase 2c (Remove CRUD)

| Action | Tests | Count |
|--------|-------|------:|
| **Remove** | host.service.test.js, dhcp.service.test.js, deviceImport.service.test.js | -1,705 |
| **Modify** | api.test.js (remove CRUD tests), provisioning.service.test.js | ~200 changed |
| **Keep** | All remaining tests | ~9,568 |
| **Total after Phase 2c** | | ~9,772 |

### Phase 3 (Hardening)

| Action | Tests | Count |
|--------|-------|------:|
| **New tests** | Load test suite, health endpoint tests | ~200 |
| **Total after Phase 3** | | ~9,972 |

### Integration Test Scenarios (Per Phase)

**Phase 2a:**
1. Manual sync trigger pulls data from mock LMN API
2. Incremental sync detects changes correctly
3. Sync failure doesn't corrupt local DB
4. WS events fire on sync completion

**Phase 2b:**
5. PXE boot with `BOOT_SOURCE=snapshot` serves correct start.conf
6. GRUB config generated from snapshot matches expected output
7. Host status updates still work with snapshot-based host list
8. Fallback to `BOOT_SOURCE=db` works when snapshot is stale

**Phase 2c:**
9. CRUD endpoints return 404/405 (removed)
10. Frontend shows read-only views without edit buttons
11. PXE boot works without any CRUD in the system
12. Provisioning triggers on sync events

**Phase 3:**
13. 50 concurrent PXE boots complete without errors
14. Health endpoint detects stale snapshot
15. Sync under load doesn't block boot serving

---

## 6. Risk Register

| # | Risk | Impact | Probability | Mitigation | Phase |
|---|------|:------:|:-----------:|------------|:-----:|
| R1 | Boot breaks during snapshot cutover | **H** | M | Feature flag `BOOT_SOURCE` allows instant rollback to DB mode | 2b |
| R2 | LMN API unavailable during sync | M | **H** | Graceful degradation: Docker continues serving last good snapshot. Retry with exponential backoff | 2a |
| R3 | Data inconsistency between LMN and Docker | **H** | M | Full sync on startup, hash verification, diff endpoint for manual audit | 2a |
| R4 | Sync race condition with concurrent operations | M | M | Sync acquires mutex lock. Operations read from snapshot (immutable between syncs) | 2b |
| R5 | Large payload sync (1000+ hosts) times out | M | L | Pagination in LMN API. Incremental sync for normal updates, full sync only at startup | 2a |
| R6 | Removing CRUD breaks unknown integrations | **H** | L | Deprecation period: Phase 2a keeps CRUD working. Only Phase 2c removes it. Document migration guide | 2c |
| R7 | Frontend removal misses component dependency | L | M | TypeScript compiler catches unused imports. Manual review of each component tree | 2c |
| R8 | Boot storm overwhelms snapshot generation | **H** | L | Snapshot is pre-generated (not on-demand). Boot reads static files, not generates them | 3 |
| R9 | Provisioning breaks when CRUD removed | M | M | Provisioning refactored in Phase 2c to trigger from sync events. Tested before CRUD removal | 2c |
| R10 | Schema migration loses existing data | **H** | L | Non-destructive schema changes only (additive). Backup before each phase | 2a |

---

## 7. Rollback Strategy

### Phase 2a Rollback
**Trigger:** Sync service causes instability or data corruption.
**Action:**
1. Set `SYNC_ENABLED=false` in environment
2. Sync service stops but all CRUD continues working
3. Dashboard hides sync status (feature flag)
4. No data loss: sync only adds fields, doesn't modify existing data

**Recovery time:** Instant (env var change + container restart)

### Phase 2b Rollback
**Trigger:** PXE boot fails with snapshot mode.
**Action:**
1. Set `BOOT_SOURCE=db` in environment
2. Boot serving reverts to live DB queries (original behavior)
3. Restart API container

**Recovery time:** < 1 minute (env var + restart)

### Phase 2c Rollback
**Trigger:** Critical feature missing that wasn't identified as needed.
**Action:**
1. This is the hardest phase to rollback since code is deleted
2. **Mitigation:** Tag git before Phase 2c starts (`pre-phase-2c`)
3. Rollback: `git revert` the Phase 2c commits or checkout the tag
4. Rebuild and redeploy

**Recovery time:** 5-10 minutes (git operations + rebuild)

**Prevention:** Phase 2c should only start after Phase 2a/2b have been running in production for at least 2 weeks.

### Phase 3 Rollback
**Trigger:** Performance optimization causes regression.
**Action:**
1. Revert specific performance commits
2. Each Phase 3 work package is independent and can be reverted individually

**Recovery time:** < 5 minutes per work package

---

## 8. Summary Statistics

### Files Affected

| Category | Remove | Modify | Keep | New | Total |
|----------|-------:|-------:|-----:|----:|------:|
| API Routes | 1 | 6 | 4 | 2 | 13 |
| API Services | 3 | 4 | 8 | 3 | 18 |
| API Libs | 0 | 1 | 9 | 0 | 10 |
| API Middleware | 0 | 1 | 2 | 0 | 3 |
| API Workers | 0 | 1 | 1 | 0 | 2 |
| API Templates | 0 | 0 | 5 | 0 | 5 |
| Prisma Schema | 0 | 1 | 0 | 0 | 1 |
| Frontend Pages | 1 | 4 | 8 | 0 | 13 |
| Frontend Components | 8 | 5 | 33 | 3 | 49 |
| Frontend Stores | 0 | 2 | 3 | 0 | 5 |
| Frontend API | 1 | 3 | 6 | 1 | 11 |
| Tests | 3 | 4 | 17 | 4 | 28 |
| **Total** | **17** | **32** | **96** | **13** | **158** |

### LOC Changes (Estimated)

| Phase | LOC Removed | LOC Added | LOC Modified | Net Change |
|-------|----------:|----------:|-------------:|-----------:|
| Phase 2a (Sync) | 0 | ~1,850 | ~100 | +1,850 |
| Phase 2b (Snapshot Boot) | 0 | ~50 | ~300 | +50 |
| Phase 2c (Remove CRUD) | ~7,200 | 0 | ~200 | -7,200 |
| Phase 3 (Hardening) | 0 | ~500 | ~100 | +500 |
| **Total** | **~7,200** | **~2,400** | **~700** | **-4,800** |

### Test Count Changes

| Phase | Tests Removed | Tests Added | Tests Modified | Net Change |
|-------|-------------:|------------:|---------------:|-----------:|
| Phase 2a | 0 | ~700 | 0 | +700 |
| Phase 2b | 0 | ~50 | ~150 | +50 |
| Phase 2c | ~1,705 LOC (3 files) | 0 | ~200 | ~-20 tests |
| Phase 3 | 0 | ~200 | 0 | +200 |

### Final State

| Metric | Before | After | Change |
|--------|-------:|------:|-------:|
| Total files | ~156 | ~152 | -4 |
| Total LOC (code) | ~34,031 | ~29,231 | -4,800 |
| Total LOC (tests) | ~11,273 | ~12,223 | +950 |
| Prisma models | 11 | 13 | +2 |
| API routes | 11 | 12 | +1 |
| Frontend pages | 14 | 13 | -1 |

### Execution Timeline (Recommended)

| Phase | Depends On | Can Run Parallel? |
|-------|-----------|:-----------------:|
| Phase 1 (LMN API) | Nothing | Yes (separate repo) |
| Phase 2a (Sync Service) | Phase 1 MVP | Partly (mock API for testing) |
| Phase 2b (Snapshot Boot) | Phase 2a complete | No |
| Phase 2c (Remove CRUD) | Phase 2b in production 2+ weeks | No |
| Phase 3 (Hardening) | Phase 2c complete | Partly (can overlap) |
