# LINBO Docker Restructuring - Architecture Document

> **Version:** 1.0.0 | **Date:** 2026-02-26 | **Status:** Phase 0 - Design
>
> **ACHTUNG: Dieses Dokument ist ein NICHT umgesetzter Entwurf vom 26.02.2026.**
> Viele hier beschriebene Konzepte (SnapshotService, atomares Verzeichnis-Switching,
> Entfernung der CRUD-Routen, PostgreSQL-Datenmodelle) wurden **nicht implementiert**.
>
> **Fuer die aktuelle Architektur siehe:**
> - [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — Aktuelle Mermaid-Diagramme (IST/SOLL)
> - [docs/UNTERSCHIEDE-ZU-LINBO.md](../UNTERSCHIEDE-ZU-LINBO.md) — Was LINBO Docker anders macht
>
> **Wesentliche Abweichungen von diesem Entwurf:**
> - PostgreSQL wurde komplett aus docker-compose.yml entfernt (Redis-primaer im Sync-Modus)
> - SnapshotService/atomares Switching wurde nicht implementiert (Dateien direkt in /srv/linbo/)
> - CRUD-Routen fuer Hosts/Configs/Rooms existieren noch (geben 409 im Sync-Modus zurueck)
> - Patchclass, Firmware, Kernel Switching, Web Terminal fehlen in diesem Entwurf

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [LMN Authority API Architecture](#2-lmn-authority-api-architecture)
3. [LINBO Runtime Docker Architecture](#3-linbo-runtime-docker-architecture)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
5. [Snapshot File Structure](#5-snapshot-file-structure)
6. [Data Models](#6-data-models)
7. [Security Model](#7-security-model)
8. [Scalability Considerations](#8-scalability-considerations)

---

## 1. System Overview

The restructured architecture separates concerns into three tiers: the **LMN Server** (source of truth for hosts/configs), the **LINBO Runtime Docker** (PXE boot serving + LINBO operations), and **PXE Clients** (booted machines).

### 1.1 C4 Context Diagram

```mermaid
C4Context
    title LINBO Docker - System Context (C4 Level 1)

    Person(admin, "School Admin", "Manages hosts, configs, images")

    System_Boundary(lmn, "LMN Server (10.0.0.11)") {
        System(console, "School Console", "Web UI for host/config/room CRUD")
        System(authority, "LMN Authority API", "FastAPI - single source of truth")
        System_Ext(devices_csv, "devices.csv", "Sophomorix host database")
        System_Ext(startconfs, "start.conf files", "/srv/linbo/start.conf.*")
    }

    System_Boundary(docker, "LINBO Runtime Docker (10.0.0.13)") {
        System(runtime, "LINBO Runtime", "PXE boot serving + operations")
        System(frontend, "Docker Frontend", "Status, monitoring, images, ops")
    }

    System_Ext(clients, "PXE Clients", "~2000 machines booting via network")

    Rel(admin, console, "Manages hosts/configs/rooms")
    Rel(admin, frontend, "Monitors status, manages images/ops")
    Rel(console, authority, "CRUD via REST API")
    Rel(authority, devices_csv, "Reads/watches")
    Rel(authority, startconfs, "Reads/watches")
    Rel(runtime, authority, "Polls delta-feed every 30-60s")
    Rel(authority, runtime, "Webhook on changes (optional)")
    Rel(clients, runtime, "PXE boot, image sync, commands")
```

### 1.2 High-Level Component Interaction

```mermaid
flowchart TB
    subgraph LMN["LMN Server (linuxmuster.net)"]
        SC["School Console<br/>(Web UI)"]
        AUTH["LMN Authority API<br/>(Python FastAPI)"]
        DCV["devices.csv"]
        SCF["start.conf files"]
        DHCP_LMN["DHCP Server<br/>(ISC/dnsmasq)"]
    end

    subgraph DOCKER["LINBO Runtime Docker"]
        SYNC["SyncService<br/>(delta-feed poller)"]
        SNAP["SnapshotService<br/>(atomic file generation)"]
        API["Docker API<br/>(Express.js)"]
        WEB["Frontend<br/>(React)"]
        TFTP["TFTP Server<br/>(grub.efi)"]
        NGINX["nginx<br/>(HTTP boot files)"]
        RSYNC["rsync<br/>(image sync)"]
        SSH["SSH Server<br/>(remote commands)"]
        DB["PostgreSQL<br/>(images, ops, audit)"]
        CACHE["Redis<br/>(jobs, state)"]
    end

    subgraph CLIENTS["PXE Clients (~2000)"]
        PXE["GRUB bootloader"]
        LINBO["LINBO Kernel + GUI"]
    end

    SC -->|CRUD| AUTH
    AUTH -->|reads/watches| DCV
    AUTH -->|reads/watches| SCF
    AUTH -.->|webhook| SYNC
    SYNC -->|"GET /changes?since="| AUTH
    SYNC --> SNAP
    SNAP -->|"atomic switch<br/>staging/ → current/"| TFTP
    SNAP -->|"atomic switch<br/>staging/ → current/"| NGINX
    API --> DB
    API --> CACHE
    API --> SSH
    WEB --> API
    PXE -->|"TFTP: grub.efi"| TFTP
    PXE -->|"HTTP: linbo64, linbofs64,<br/>hostcfg, start.conf"| NGINX
    LINBO -->|"rsync: images"| RSYNC
    LINBO -->|"SSH: remote commands"| SSH
    DHCP_LMN -->|"next-server,<br/>boot-filename"| PXE
```

---

## 2. LMN Authority API Architecture

**Repository:** `amolani/lmn-linbo-authority-api`
**Runtime:** Python 3.11+ / FastAPI / uvicorn
**Location:** LMN Server (10.0.0.11)

### 2.1 Class Diagram

```mermaid
classDiagram
    direction TB

    class FastAPIApp {
        +lifespan(app) AsyncGenerator
        +include_router(router)
    }

    class ChangesRouter {
        +GET /api/v1/linbo/changes?since=cursor
    }

    class BatchRouter {
        +POST /api/v1/linbo/hosts:batch
        +POST /api/v1/linbo/startconfs:batch
        +POST /api/v1/linbo/configs:batch
    }

    class LookupRouter {
        +GET /api/v1/linbo/host?mac=...
        +GET /api/v1/linbo/startconf?id=...
    }

    class DhcpRouter {
        +GET /api/v1/linbo/dhcp/export/dnsmasq-proxy
        +GET /api/v1/linbo/dhcp/export/isc-dhcp
        +POST /api/v1/linbo/dhcp/reservations:batch
    }

    class HealthRouter {
        +GET /health
        +GET /ready
    }

    class DevicesAdapter {
        -str csv_path
        -dict~str,HostRecord~ _cache
        -float _last_modified
        +load() list~HostRecord~
        +get_by_mac(mac: str) HostRecord?
        +get_all() list~HostRecord~
        -_parse_csv() list~HostRecord~
    }

    class StartConfAdapter {
        -str conf_dir
        -dict~str,StartConfRecord~ _cache
        +load() list~StartConfRecord~
        +get_by_name(name: str) StartConfRecord?
        +get_all() list~StartConfRecord~
        -_parse_start_conf(path: str) StartConfRecord
    }

    class DhcpExportAdapter {
        +generate_reservations(hosts: list) list~DhcpReservation~
    }

    class WatcherService {
        -Inotify _inotify
        -asyncio.Queue _change_queue
        +start() None
        +stop() None
        -_watch_devices_csv() None
        -_watch_start_conf_dir() None
        -_on_file_changed(path: str) None
    }

    class DeltaFeedService {
        -list~ChangeEvent~ _changelog
        -int _cursor
        -int _max_entries
        +record_change(event: ChangeEvent) None
        +get_changes(since: int, limit: int) DeltaResponse
        +get_current_cursor() int
        -_compact() None
    }

    class HostRecord {
        +str mac_address
        +str hostname
        +str ip_address
        +str room
        +str config_name
        +str role
        +str pxe_flag
        +str sophomorix_status
        +dict metadata
    }

    class StartConfRecord {
        +str name
        +dict linbo_settings
        +list~PartitionRecord~ partitions
        +list~OsRecord~ os_entries
        +str raw_content
        +str checksum
    }

    class ChangeEvent {
        +int cursor
        +str entity_type
        +str entity_id
        +str action
        +datetime timestamp
        +dict data
    }

    class DeltaResponse {
        +int cursor
        +bool has_more
        +list~ChangeEvent~ changes
    }

    class DhcpReservation {
        +str mac_address
        +str ip_address
        +str hostname
        +str config_name
    }

    FastAPIApp --> HostsRouter
    FastAPIApp --> StartConfsRouter
    FastAPIApp --> DhcpRouter
    FastAPIApp --> HealthRouter
    HostsRouter --> DevicesAdapter
    HostsRouter --> DeltaFeedService
    StartConfsRouter --> StartConfAdapter
    StartConfsRouter --> DeltaFeedService
    DhcpRouter --> DhcpExportAdapter
    DhcpExportAdapter --> DevicesAdapter
    WatcherService --> DeltaFeedService
    WatcherService --> DevicesAdapter
    WatcherService --> StartConfAdapter
    DeltaFeedService --> ChangeEvent
    DeltaFeedService --> DeltaResponse
    DevicesAdapter --> HostRecord
    StartConfAdapter --> StartConfRecord
    DhcpExportAdapter --> DhcpReservation
```

### 2.2 Internal Component Diagram

```mermaid
flowchart LR
    subgraph FileSystem["LMN File System"]
        CSV["devices.csv<br/>(DEVICES_CSV_PATH,<br/>per installation)"]
        CONFS["start.conf.*<br/>/srv/linbo/"]
    end

    subgraph Watchers["Watcher Layer"]
        INO["inotify<br/>WatcherService"]
    end

    subgraph Adapters["Adapter Layer"]
        DA["DevicesAdapter<br/>(CSV parser)"]
        SA["StartConfAdapter<br/>(start.conf parser)"]
        DHA["DhcpExportAdapter"]
    end

    subgraph Core["Core Services"]
        DFS["DeltaFeedService<br/>(in-memory changelog)"]
        CQ["ChangeQueue<br/>(asyncio.Queue)"]
    end

    subgraph APILayer["FastAPI Routes"]
        HC["/api/v1/linbo/changes<br/>/hosts:batch<br/>/host?mac="]
        SCC["/api/v1/linbo/<br/>startconfs:batch<br/>/startconf?id="]
        DHR["/api/v1/linbo/dhcp/<br/>export/dnsmasq-proxy<br/>export/isc-dhcp<br/>reservations:batch"]
        HLT["/health, /ready"]
    end

    CSV --> INO
    CONFS --> INO
    INO -->|"file changed"| CQ
    CQ --> DFS
    CQ -->|"reload"| DA
    CQ -->|"reload"| SA
    DA --> HC
    SA --> SCC
    DHA --> DHR
    DA --> DHA
    DFS --> HC
    DFS --> SCC
```

### 2.3 Delta-Feed Protocol

The delta-feed is the core synchronization mechanism. The Authority API maintains a changelog of all changes to hosts and start.conf files. The changelog is persisted (JSONL file or SQLite) so it survives API restarts.

```
GET /api/v1/linbo/changes?since=1708943200:40

Response:
{
  "nextCursor": "1708943200:42",
  "hostsChanged": ["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"],
  "startConfsChanged": ["win11_efi_sata"],
  "configsChanged": ["win11_efi_sata"],
  "dhcpChanged": true,
  "deletedHosts": [],
  "deletedStartConfs": []
}
```

The Docker then fetches the changed data via batch endpoints:

```
POST /api/v1/linbo/hosts:batch
{ "macs": ["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"] }

POST /api/v1/linbo/startconfs:batch
{ "ids": ["win11_efi_sata"] }
```

**Cursor semantics:**
- Cursor format: `"timestamp:sequence"` (monotonic, e.g., `"1708943200:42"`)
- `since` empty/null: Full dump (returns all MACs and startConf IDs for initial sync)
- `since=<cursor>`: Only changes since that cursor
- Compaction: Events older than 24h or beyond 10,000 entries are compacted; clients that fall behind get a full dump

**Restart behavior:**
- The changelog is persisted to disk (JSONL or SQLite), so API restarts do not lose history
- If the changelog is lost/corrupted, clients detect an invalid cursor and fall back to a full sync (`since` empty)

---

## 3. LINBO Runtime Docker Architecture

### 3.1 Service Classification: KEEP / REMOVE / NEW

```mermaid
classDiagram
    direction TB

    class SyncService {
        <<NEW>>
        -int pollIntervalSec
        -int cursor
        -string authorityUrl
        +start() void
        +stop() void
        +pollChanges() SyncResult
        +fullSync() SyncResult
        -_applyHostChanges(changes) void
        -_applyStartConfChanges(changes) void
    }

    class SnapshotService {
        <<NEW>>
        -string stagingDir
        -string currentDir
        +buildSnapshot(hosts, configs) void
        +switchSnapshot() void
        +rollback() void
        -_generateGrubConfigs(staging) void
        -_generateStartConfs(staging) void
        -_generateHostCfgs(staging) void
        -_atomicSwitch() void
    }

    class SnapshotGrubGenerator {
        <<NEW>>
        +generateMainGrub(hosts, configs) string
        +generateGroupGrub(config) string
        +generateHostSymlinks(hosts) void
    }

    class ImageService {
        <<KEEP>>
        +list() Image[]
        +get(id) Image
        +scan() ScanResult
        +delete(id) void
        +getInfo(filename) ImageInfo
    }

    class KernelService {
        <<KEEP>>
        +listKernels() Kernel[]
        +switchKernel(variant) void
        +getCurrentKernel() Kernel
    }

    class FirmwareService {
        <<KEEP>>
        +listFirmware() Firmware[]
        +searchFirmware(query) Firmware[]
        +addFirmware(files) void
    }

    class PatchclassService {
        <<KEEP>>
        +list() Patchclass[]
        +get(name) Patchclass
        +addDriver(patchclass, driver) void
        +removeDriver(patchclass, driver) void
    }

    class RemoteService {
        <<KEEP>>
        +sendCommand(hosts, command) Operation
        +reboot(hosts) Operation
        +shutdown(hosts) Operation
        +localBoot(hosts) Operation
    }

    class WolService {
        <<KEEP>>
        +wake(macAddresses) WolResult
        +wakeByRoom(roomName) WolResult
    }

    class GrubThemeService {
        <<KEEP>>
        +getThemeConfig() ThemeConfig
        +updateThemeConfig(config) ThemeConfig
        +uploadBackground(file) void
    }

    class LinbofsService {
        <<KEEP>>
        +getStatus() LinbofsStatus
        +rebuild() void
    }

    class SshService {
        <<KEEP>>
        +exec(host, command) SshResult
        +getKeys() SshKeys
    }

    class AuthService {
        <<KEEP>>
        +login(username, password) Token
        +verify(token) User
        +createApiKey(name) ApiKey
    }

    class OperationWorker {
        <<KEEP>>
        +startWorker() void
        +processJob(job) void
    }

    class HostService {
        <<REMOVE>>
        +list() Host[]
        +create(data) Host
        +update(id, data) Host
        +delete(id) void
    }

    class ConfigService {
        <<REMOVE>>
        +list() Config[]
        +create(data) Config
        +update(id, data) Config
        +delete(id) void
        +deploy(id) void
    }

    class RoomService {
        <<REMOVE>>
        +list() Room[]
        +create(data) Room
        +update(id, data) Room
        +delete(id) void
    }

    class DeviceImportService {
        <<REMOVE>>
        +importCsv(data) ImportResult
        +exportCsv() string
    }

    class ProvisioningService {
        <<REMOVE>>
        +provision(hosts) ProvisionResult
    }

    class MacctService {
        <<REMOVE>>
        +initializeConsumerGroup() void
    }

    class DhcpService {
        <<REMOVE>>
        +getNetworkSettings() NetworkSettings
        +generateConfig() DhcpConfig
    }

    SyncService --> SnapshotService : triggers build
    SnapshotService --> SnapshotGrubGenerator : generates GRUB
    RemoteService --> SshService : sends commands
    RemoteService --> OperationWorker : enqueues jobs
    WolService ..> RemoteService : wakes then commands
```

### 3.2 Container Architecture (Updated docker-compose)

```mermaid
flowchart TB
    subgraph DockerCompose["docker-compose.yml"]
        subgraph InitLayer["Initialization"]
            INIT["init<br/>Downloads boot files<br/>One-shot container"]
        end

        subgraph BootLayer["Boot Serving (Static)"]
            TFTP["tftp<br/>in.tftpd<br/>Port 69/udp<br/>Serves: grub.efi"]
            WEB["web (nginx)<br/>Port 8080<br/>Serves: linbo64, linbofs64,<br/>grub.cfg, hostcfg/, start.conf,<br/>+ React frontend"]
        end

        subgraph DataLayer["Data Services"]
            DB["db (PostgreSQL 15)<br/>Port 5432<br/>Images, Operations,<br/>Users, Audit, SyncState"]
            CACHE["cache (Redis 7)<br/>Port 6379<br/>Job streams, cursor,<br/>host status cache"]
        end

        subgraph AppLayer["Application"]
            API["api (Node.js)<br/>Port 3000<br/>REST API + WebSocket<br/>+ SyncService<br/>+ SnapshotService"]
        end

        subgraph FileLayer["File Services"]
            RSYNC["rsync<br/>Port 873<br/>Image upload/download"]
            SSH["ssh<br/>Port 2222<br/>Remote commands to clients"]
        end

        subgraph Volumes["Docker Volumes"]
            SRV["linbo_srv_data<br/>/srv/linbo/<br/>(boot files, images,<br/>snapshot/current/)"]
            CFG["linbo_config<br/>/etc/linuxmuster/linbo/<br/>(SSH keys)"]
            LOG["linbo_log<br/>/var/log/linuxmuster/linbo/"]
            KERN["linbo_kernel_data<br/>/var/lib/linuxmuster/linbo/"]
            DRV["linbo_driver_data<br/>/var/lib/linbo/drivers/"]
            PGDATA["linbo_postgres_data"]
            REDIS["linbo_redis_data"]
        end
    end

    INIT -->|"writes"| SRV
    INIT -->|"writes"| KERN
    TFTP -->|"reads"| SRV
    WEB -->|"reads"| SRV
    API -->|"reads/writes"| SRV
    API --> DB
    API --> CACHE
    API --> SSH
    RSYNC -->|"reads/writes"| SRV
    SSH -->|"reads"| SRV
    SSH -->|"reads"| CFG
    DB --> PGDATA
    CACHE --> REDIS

    style INIT fill:#4a5568,color:#fff
    style TFTP fill:#2b6cb0,color:#fff
    style WEB fill:#2b6cb0,color:#fff
    style DB fill:#38a169,color:#fff
    style CACHE fill:#38a169,color:#fff
    style API fill:#d69e2e,color:#000
    style RSYNC fill:#805ad5,color:#fff
    style SSH fill:#805ad5,color:#fff
```

**Key change:** No new containers are needed. The `SyncService` and `SnapshotService` run inside the existing `api` container. The `web` (nginx) container serves snapshot files from the shared `linbo_srv_data` volume.

### 3.3 API Routes: KEEP vs REMOVE

| Current Route | Status | Reason |
|---|---|---|
| `POST /api/v1/auth/login` | **KEEP** | Local auth for Docker frontend |
| `GET /api/v1/hosts` | **KEEP (read-only)** | Shows synced host data (no CRUD) |
| `POST /api/v1/hosts` | **REMOVE** | CRUD moves to School Console |
| `PUT /api/v1/hosts/:id` | **REMOVE** | CRUD moves to School Console |
| `DELETE /api/v1/hosts/:id` | **REMOVE** | CRUD moves to School Console |
| `POST /api/v1/hosts/import` | **REMOVE** | Import moves to School Console |
| `GET /api/v1/configs` | **KEEP (read-only)** | Shows synced config data |
| `POST /api/v1/configs` | **REMOVE** | CRUD moves to School Console |
| `PUT /api/v1/configs/:id` | **REMOVE** | CRUD moves to School Console |
| `DELETE /api/v1/configs/:id` | **REMOVE** | CRUD moves to School Console |
| `GET /api/v1/rooms` | **KEEP (read-only)** | Shows synced room data |
| `POST /api/v1/rooms` | **REMOVE** | CRUD moves to School Console |
| `GET /api/v1/images/*` | **KEEP** | Image management stays local |
| `POST /api/v1/images/*` | **KEEP** | Image management stays local |
| `GET /api/v1/operations/*` | **KEEP** | Operations stay on Docker |
| `POST /api/v1/operations/*` | **KEEP** | Operations stay on Docker |
| `GET /api/v1/system/kernel/*` | **KEEP** | Kernel management |
| `GET /api/v1/system/firmware/*` | **KEEP** | Firmware management |
| `GET /api/v1/system/patchclass/*` | **KEEP** | Driver management |
| `GET /api/v1/system/grub-theme/*` | **KEEP** | GRUB theme |
| `GET /api/v1/dhcp/*` | **REMOVE** | DHCP config editing moves to LMN; Docker reads DHCP exports from snapshot (dnsmasq-proxy, isc-dhcp via LMN Authority API `/api/v1/linbo/dhcp/export/*`) |
| `POST /api/v1/internal/*` | **MODIFY** | Add sync webhook endpoint |
| **NEW** `GET /api/v1/sync/status` | **NEW** | Sync state & cursor info |
| **NEW** `POST /api/v1/sync/trigger` | **NEW** | Force immediate sync |
| **NEW** `POST /api/v1/internal/webhook` | **NEW** | Receive change notifications |

---

## 4. Data Flow Diagrams

### 4.1 Boot Chain (PXE Client Startup)

```mermaid
sequenceDiagram
    autonumber
    participant DHCP as DHCP Server<br/>(LMN or Docker)
    participant Client as PXE Client
    participant TFTP as TFTP Server<br/>(Docker)
    participant NGINX as nginx<br/>(Docker)
    participant Snapshot as Snapshot<br/>/srv/linbo/

    Note over Client: Machine powers on / WoL
    Client->>DHCP: DHCP Discover
    DHCP-->>Client: Offer (IP, next-server, boot-filename)

    rect rgb(40, 60, 80)
        Note over Client,TFTP: Stage 1: GRUB Bootloader (TFTP)
        Client->>TFTP: TFTP Request: boot/grub/grub.efi
        TFTP-->>Client: grub.efi (UEFI bootloader)
        Note over Client: GRUB starts with own network stack
    end

    rect rgb(40, 80, 60)
        Note over Client,NGINX: Stage 2: GRUB Config + Kernel (HTTP)
        Client->>NGINX: HTTP GET /boot/grub/grub.cfg
        NGINX->>Snapshot: Read snapshot/current/boot/grub/grub.cfg
        Snapshot-->>NGINX: grub.cfg (MAC-based routing)
        NGINX-->>Client: grub.cfg
        Note over Client: GRUB evaluates MAC → finds boot params
        Client->>NGINX: HTTP GET /linbo64 (kernel)
        NGINX-->>Client: linbo64 (~15MB)
        Client->>NGINX: HTTP GET /linbofs64 (initramfs)
        NGINX-->>Client: linbofs64 (~400MB)
        Note over Client: GRUB boots kernel<br/>(GRUB network stack gone)
    end

    rect rgb(80, 60, 40)
        Note over Client,Snapshot: Stage 3: LINBO Init (New Network)
        Note over Client: Kernel → init.sh → udevd
        Note over Client: udhcpc → new DHCP lease
        Client->>NGINX: rsync/HTTP: start.conf (via group= param)
        Snapshot->>NGINX: snapshot/current/start.conf.{group}
        NGINX-->>Client: start.conf
        Client->>NGINX: HTTP GET /linbo_gui64_7.tar.lz
        NGINX-->>Client: Qt GUI archive
        Note over Client: LINBO GUI starts → user selects action
    end
```

**Important: `server=` and `LINBOSERVER` resolution:**
- GRUB passes `server=<ip>` as kernel cmdline parameter (from grub.cfg or hostcfg)
- LINBO init.sh also reads `LINBOSERVER` from DHCP Option 54 (Server Identifier)
- `server=` in start.conf `[LINBO]` section is overridden by the kernel cmdline `server=`
- **Consistency requirement:** The `server=` in GRUB configs (snapshot) and `Server =` in start.conf must both point to the Docker Runtime IP (e.g., 10.0.0.1), NOT the LMN server (10.0.0.11)
- The LMN Authority API's StartConfAdapter should validate/rewrite `Server =` in start.conf to match `LINBO_SERVER_IP` during snapshot generation
- In proxy-DHCP setups, DHCP Option 54 naturally resolves to the Docker/LINBO server IP

### 4.2 Sync Chain (Authority API → Docker Snapshot)

```mermaid
sequenceDiagram
    autonumber
    participant Timer as SyncService<br/>(30-60s interval)
    participant Auth as LMN Authority API
    participant Snap as SnapshotService
    participant Staging as staging/<br/>(temp directory)
    participant Current as current/<br/>(live directory)
    participant Redis as Redis Cache
    participant WS as WebSocket<br/>(frontend clients)

    Note over Timer: Poll timer fires (or webhook received)
    Timer->>Redis: GET sync:cursor
    Redis-->>Timer: cursor = 41

    Timer->>Auth: GET /api/v1/linbo/changes?since=1708943200:41
    Auth-->>Timer: {nextCursor: "1708943200:47", hostsChanged: [...], ...}

    alt has changes
        Timer->>Snap: buildSnapshot(changes)

        rect rgb(40, 60, 80)
            Note over Snap,Staging: Build in staging directory
            Snap->>Staging: Apply host upserts/deletes
            Snap->>Staging: Apply startconf upserts/deletes
            Snap->>Staging: Generate GRUB configs (main + group)
            Snap->>Staging: Generate host symlinks (MAC → group)
            Snap->>Staging: Copy start.conf files
            Snap->>Snap: Validate snapshot integrity
        end

        rect rgb(60, 80, 40)
            Note over Snap,Current: Atomic switch
            Snap->>Current: rename staging/ → current/<br/>(atomic on same filesystem)
            Note over Current: Boot files now serve new data
        end

        Snap->>Redis: SET sync:cursor = 47
        Snap->>WS: broadcast("sync", {cursor: 47, changes: 6})
        Timer->>Timer: Update local DB (hosts table, read-only copy)
    else no changes
        Note over Timer: Sleep until next poll
    end
```

### 4.3 Operation Chain (linbo-remote, WoL, Reboot)

```mermaid
sequenceDiagram
    autonumber
    participant Admin as Frontend<br/>(React)
    participant API as Docker API<br/>(Express)
    participant DB as PostgreSQL
    participant Redis as Redis<br/>(job stream)
    participant Worker as OperationWorker
    participant SSH as SSH Server
    participant Client as PXE Client
    participant WS as WebSocket

    Admin->>API: POST /api/v1/operations<br/>{type:"sync", targets:["AA:BB:CC:DD:EE:FF"]}
    API->>DB: INSERT Operation (status=pending)
    API->>Redis: XADD linbo:jobs {op_id, type, targets}
    API-->>Admin: 202 Accepted {operation_id}
    API->>WS: emit("operation:created", {id, status})

    loop For each target host
        Worker->>Redis: XREADGROUP linbo:jobs
        Redis-->>Worker: Job {op_id, type, target_mac}
        Worker->>DB: UPDATE Operation (status=running)
        Worker->>WS: emit("operation:progress", {id, progress: 10})

        Worker->>SSH: ssh linbo-ssh "linbo-remote -i AA:BB:CC:DD:EE:FF -c sync:1"
        SSH->>Client: Execute linbo-remote command

        alt Success
            Client-->>SSH: Exit 0
            SSH-->>Worker: stdout/stderr
            Worker->>DB: UPDATE Operation (status=completed)
            Worker->>WS: emit("operation:completed", {id})
        else Failure
            Client-->>SSH: Exit non-zero
            SSH-->>Worker: Error output
            Worker->>DB: UPDATE Operation (status=failed, error)
            Worker->>WS: emit("operation:failed", {id, error})
        end
    end
```

### 4.4 Image Upload Chain (PXE Client → Docker)

```mermaid
sequenceDiagram
    autonumber
    participant Client as PXE Client<br/>(LINBO)
    participant RSYNC as rsync Server<br/>(Docker)
    participant Volume as linbo_srv_data<br/>/srv/linbo/images/
    participant API as Docker API
    participant DB as PostgreSQL
    participant WS as WebSocket

    Note over Client: User clicks "New Image" in LINBO GUI
    Client->>Client: dd + qemu-img convert → .qcow2
    Client->>Client: Generate .qcow2.info, .qcow2.desc

    Client->>RSYNC: rsync --partial --progress image.qcow2<br/>→ linbo-upload module
    RSYNC->>Volume: Write /srv/linbo/images/image.qcow2

    Client->>RSYNC: rsync image.qcow2.info
    RSYNC->>Volume: Write .qcow2.info sidecar

    Note over API: Periodic image scan (or inotify)
    API->>Volume: Scan /srv/linbo/images/
    API->>API: Detect new/changed image
    API->>API: Verify checksum (.qcow2.md5)
    API->>DB: UPSERT Image record
    API->>WS: emit("image:updated", {filename})
```

### 4.5 Webhook Notification (Optional Fast Path)

```mermaid
sequenceDiagram
    autonumber
    participant Watch as WatcherService<br/>(LMN Authority)
    participant DFS as DeltaFeedService
    participant AuthAPI as Authority API
    participant Docker as Docker API<br/>(webhook endpoint)
    participant Sync as SyncService

    Note over Watch: inotify: devices.csv modified
    Watch->>DFS: record_change({entity_type:"host", action:"upsert", ...})
    Watch->>AuthAPI: Trigger webhook dispatch

    AuthAPI->>Docker: POST /api/v1/internal/webhook<br/>{event:"changes_available", cursor: 48}
    Note over Docker: Verify webhook secret
    Docker->>Sync: triggerImmediateSync()
    Note over Sync: Skip wait, poll now
    Sync->>AuthAPI: GET /api/v1/linbo/changes?since=1708943200:47
```

---

## 5. Snapshot File Structure

The snapshot system uses an atomic directory-switch pattern. Boot-serving containers (TFTP, nginx) always read from `current/`, which is a symlink to an immutable snapshot directory.

```
/srv/linbo/
├── snapshot/
│   ├── current -> ./snap-20260226T100000Z/     # Atomic symlink (live)
│   ├── previous -> ./snap-20260226T093000Z/    # Rollback target
│   │
│   ├── snap-20260226T100000Z/                  # Immutable snapshot
│   │   ├── boot/
│   │   │   └── grub/
│   │   │       ├── grub.cfg                    # Main GRUB (MAC routing)
│   │   │       ├── win11-uefi.cfg              # Group config
│   │   │       ├── ubuntu-2204.cfg             # Group config
│   │   │       ├── dual-uefi.cfg               # Group config
│   │   │       └── hostcfg/
│   │   │           ├── pc-r101-01.cfg -> ../win11-uefi.cfg
│   │   │           ├── pc-r101-02.cfg -> ../win11-uefi.cfg
│   │   │           ├── pc-r201-01.cfg -> ../ubuntu-2204.cfg
│   │   │           └── ...                     # One symlink per host
│   │   ├── start.conf.win11-uefi              # Generated start.conf
│   │   ├── start.conf.ubuntu-2204             # Generated start.conf
│   │   ├── start.conf.dual-uefi              # Generated start.conf
│   │   └── manifest.json                      # Snapshot metadata
│   │
│   ├── snap-20260226T093000Z/                  # Previous snapshot
│   │   └── ...
│   │
│   └── staging/                                # Build area (not served)
│       └── ...                                 # In-progress snapshot
│
├── linbo64                                     # Kernel (not in snapshot)
├── linbofs64                                   # Initramfs (not in snapshot)
├── linbo_gui64_7.tar.lz                        # GUI archive
├── images/                                     # QCOW2 images (not in snapshot)
│   ├── win11-base.qcow2
│   ├── win11-base.qcow2.info
│   ├── win11-base.qcow2.desc
│   ├── win11-base.qcow2.md5
│   ├── ubuntu-2204.qcow2
│   └── ...
└── icons/                                      # OS icons for LINBO GUI
    ├── ubuntu.svg
    ├── win10.svg
    └── ...
```

### 5.1 manifest.json

Each snapshot contains a manifest for auditability and rollback:

```json
{
  "version": 1,
  "created_at": "2026-02-26T10:00:00Z",
  "cursor": 47,
  "authority_url": "http://10.0.0.11:8000",
  "host_count": 2000,
  "config_count": 5,
  "grub_configs": ["grub.cfg", "win11-uefi.cfg", "ubuntu-2204.cfg", "dual-uefi.cfg"],
  "start_confs": ["start.conf.win11-uefi", "start.conf.ubuntu-2204", "start.conf.dual-uefi"],
  "checksum": "sha256:abc123..."
}
```

### 5.2 nginx Configuration for Snapshots

```nginx
# Boot files served from snapshot/current/
location /boot/ {
    alias /srv/linbo/snapshot/current/boot/;
    expires -1;                    # No caching during boot storms
    add_header X-Snapshot-Dir $upstream_http_x_snapshot;
}

# start.conf files from snapshot
location ~ ^/start\.conf\. {
    root /srv/linbo/snapshot/current/;
    expires -1;
}

# Static boot files (kernel, initramfs - not in snapshot)
location /linbo64  { alias /srv/linbo/linbo64; }
location /linbofs64 { alias /srv/linbo/linbofs64; }
```

---

## 6. Data Models

### 6.1 LMN Authority API Models

```mermaid
erDiagram
    HostRecord {
        string mac_address PK "AA:BB:CC:DD:EE:FF"
        string hostname "pc-r101-01"
        string ip_address "10.0.0.101"
        string room "r101"
        string config_name "win11-uefi"
        string role "student"
        string pxe_flag "1"
        string sophomorix_status "active"
        json metadata "custom fields"
    }

    StartConfRecord {
        string name PK "win11-uefi"
        json linbo_settings "Server, Cache, KernelOptions..."
        string raw_content "Original file content"
        string checksum "sha256 of file"
    }

    PartitionRecord {
        int position "1-based order"
        string device "/dev/sda1"
        string label "efi"
        string size "512M"
        string partition_id "ef00"
        string fs_type "vfat"
        boolean bootable "true"
    }

    OsRecord {
        int position "1-based order"
        string name "Windows 11 Pro"
        string version "23H2"
        string icon_name "win11"
        string base_image "win11-base.qcow2"
        string root "/dev/sda3"
        string kernel "/boot/vmlinuz"
        string initrd "/boot/initrd.img"
        string append "ro quiet"
        boolean start_enabled "true"
        boolean sync_enabled "true"
        boolean new_enabled "true"
        boolean autostart "false"
    }

    ChangeEvent {
        int cursor PK "auto-increment"
        string entity_type "host | startconf"
        string entity_id "MAC or config name"
        string action "upsert | delete"
        datetime timestamp "ISO 8601"
        json data "full entity snapshot"
    }

    StartConfRecord ||--o{ PartitionRecord : "has"
    StartConfRecord ||--o{ OsRecord : "has"
```

### 6.2 Docker Runtime Models (Prisma DB - What Stays)

After restructuring, the PostgreSQL database retains only **runtime-local** data. Host and Config tables become read-only caches populated by SyncService.

```mermaid
erDiagram
    Host {
        uuid id PK
        string mac_address UK "Primary key from LMN"
        string hostname UK
        string ip_address
        string room_name "denormalized from LMN"
        string config_name "denormalized from LMN"
        string status "online|offline|linbo|..."
        datetime last_seen
        json hardware
        json cache_info
    }

    Image {
        uuid id PK
        string filename UK
        string type "qcow2"
        string path
        bigint size
        string checksum
        string status "available|uploading|error"
        json image_info
    }

    Operation {
        uuid id PK
        string type "sync|start|reboot|..."
        string[] target_hosts
        string status "pending|running|completed|failed"
        int progress
        json options
        json result
        string error
    }

    Session {
        uuid id PK
        uuid operation_id FK
        uuid host_id FK
        string status
        int progress
        string log_file
    }

    User {
        uuid id PK
        string username UK
        string password_hash
        string role
        boolean active
    }

    ApiKey {
        uuid id PK
        string name
        string key_hash
        json permissions
        uuid created_by FK
    }

    AuditLog {
        uuid id PK
        datetime timestamp
        string actor
        string action
        string target_type
        string target_id
        json changes
    }

    SyncState {
        string id PK "singleton"
        int cursor
        datetime last_sync_at
        string authority_url
        string status "synced|syncing|error"
        string last_error
        string snapshot_dir "current snapshot name"
    }

    Operation ||--o{ Session : "has"
    Host ||--o{ Session : "has"
    User ||--o{ ApiKey : "created"
```

**Removed from Prisma schema:**
- `Room` model (rooms derived from host data)
- `Config` model (configs come from start.conf files via snapshot)
- `ConfigPartition` model
- `ConfigOs` model
- Host write operations (create/update/delete)

**Added to Prisma schema:**
- `SyncState` model (cursor tracking, sync status)

### 6.3 Snapshot State

The `SyncState` singleton tracks the synchronization cursor and snapshot metadata:

```json
{
  "id": "singleton",
  "cursor": 47,
  "last_sync_at": "2026-02-26T10:00:00Z",
  "authority_url": "http://10.0.0.11:8000",
  "status": "synced",
  "last_error": null,
  "snapshot_dir": "snap-20260226T100000Z"
}
```

Stored in both PostgreSQL (persistent) and Redis (fast access):
- **Redis key:** `sync:state` (JSON, updated every poll cycle)
- **PostgreSQL:** `SyncState` table (persisted, survives Redis flush)

---

## 7. Security Model

### 7.1 Authentication Between Components

```mermaid
flowchart TB
    subgraph LMN["LMN Server"]
        AUTH_API["Authority API"]
    end

    subgraph DOCKER["LINBO Docker"]
        API["Docker API"]
        WEB["Frontend"]
        SSH_SRV["SSH Server"]
        RSYNC_SRV["rsync Server"]
    end

    subgraph CLIENTS["PXE Clients"]
        GRUB["GRUB"]
        LINBO["LINBO"]
    end

    AUTH_API -->|"Bearer Token<br/>(Authorization header)<br/>+ IP Allowlist"| API
    API -->|"Webhook secret<br/>(HMAC-SHA256)"| AUTH_API
    WEB -->|"JWT Bearer token<br/>(per-user login)"| API
    API -->|"SSH key pair<br/>(/etc/linuxmuster/linbo/)"| SSH_SRV
    GRUB -->|"Unauthenticated<br/>(read-only boot files)"| DOCKER
    LINBO -->|"rsyncd.secrets<br/>(shared password)"| RSYNC_SRV
    LINBO -->|"SSH host key<br/>(for linbo-remote)"| SSH_SRV

    style AUTH_API fill:#38a169,color:#fff
    style API fill:#d69e2e,color:#000
```

### 7.2 Security Boundaries

| Boundary | Authentication | Authorization | Encryption |
|---|---|---|---|
| Admin → Frontend | JWT (username/password) | Role-based (admin/viewer) | HTTPS (reverse proxy) |
| Frontend → Docker API | JWT Bearer token | Middleware check per route | HTTPS (reverse proxy) |
| Docker API → Authority API | Bearer Token + IP Allowlist | Read-only scope | HTTPS recommended |
| Authority API → Docker webhook | HMAC-SHA256 signature | Webhook secret validation | HTTPS recommended |
| PXE Client → TFTP | None (read-only) | N/A | None (TFTP limitation) |
| PXE Client → HTTP boot | None (read-only) | N/A | None (PXE limitation) |
| PXE Client → rsync | rsyncd.secrets | Module-level ACL | None (rsync limitation) |
| Docker API → SSH Server | SSH key pair | Root on SSH container | SSH encryption |

### 7.3 Secrets Management

| Secret | Location | Rotation |
|---|---|---|
| `JWT_SECRET` | `.env` on Docker host | Manual, restart required |
| `AUTHORITY_BEARER_TOKEN` | `.env` on Docker host + Authority API config | Manual, coordinated |
| `WEBHOOK_SECRET` | `.env` on both servers | Manual, coordinated |
| `DB_PASSWORD` | `.env` on Docker host | Manual, restart required |
| SSH host keys | `linbo_config` volume | Generated on first boot |
| rsync secrets | `config/rsyncd.secrets` | Manual |

---

## 8. Scalability Considerations

### 8.1 Boot Storm Handling (~2000 Clients)

A "boot storm" occurs when many machines power on simultaneously (e.g., start of school day). The architecture handles this through static file serving:

```mermaid
flowchart LR
    subgraph BootStorm["Boot Storm: 2000 clients in ~60s"]
        C1["Client 1"]
        C2["Client 2"]
        CN["Client 2000"]
    end

    subgraph Docker["LINBO Docker"]
        TFTP["TFTP<br/>(grub.efi only,<br/>~2MB per client)"]
        NGINX["nginx<br/>(kernel+initramfs,<br/>~415MB per client)"]
    end

    C1 --> TFTP
    C2 --> TFTP
    CN --> TFTP
    C1 --> NGINX
    C2 --> NGINX
    CN --> NGINX
```

**Why this scales:**

| Concern | Current (DB queries) | New (Snapshot) |
|---|---|---|
| GRUB config per client | DB query → generate → serve | Static file read (nginx) |
| start.conf per client | DB query → generate → serve | Static file read (nginx) |
| Host config lookup | DB query by MAC | Symlink dereference (filesystem) |
| Bottleneck | PostgreSQL connections | Disk I/O + network bandwidth |
| Concurrent capacity | ~50-100 (DB pool) | ~2000+ (nginx worker_connections) |

### 8.2 Resource Estimates

| Resource | Boot Storm (2000 clients) | Steady State |
|---|---|---|
| TFTP bandwidth | 2000 x 2MB = 4GB burst | Negligible |
| HTTP bandwidth | 2000 x 415MB = ~800GB total | Negligible |
| Duration (1Gbps) | ~107 min theoretical; staggered boot + client-side cache reduces effective load | N/A |
| Duration (10Gbps) | ~11 min theoretical; with staggered boot + linbofs caching ~5-7 min practical | N/A |
| **Note** | Real-world: not all 2000 clients cold-boot simultaneously. linbofs64 is cached locally after first boot. Typical burst is 100-300 concurrent, not 2000. | |
| nginx connections | Up to 2000 concurrent | 0-5 |
| PostgreSQL connections | 0 (no DB during boot) | 5-10 |
| Redis operations | 0 (no cache during boot) | ~10/min |
| Disk IOPS | High (sequential reads) | Low |

### 8.3 Snapshot Switching During Boot Storm

The atomic symlink switch ensures no client ever sees a half-updated state:

```
# Atomic operation (single rename syscall)
# Even during 2000 concurrent reads, this is safe

staging/  ← build complete, validated
current -> snap-20260226T093000Z  ← currently being read by clients

# Switch:
rename("staging/", "snap-20260226T100000Z/")
symlink("snap-20260226T100000Z/", "current.new")
rename("current.new", "current")  ← atomic on Linux

# Result:
# - Clients mid-read: finish with old snapshot (file handles still open)
# - New clients: get new snapshot
# - No partial states ever visible
```

### 8.4 Multi-Node Deployment (Future)

For schools with multiple LINBO Docker instances (e.g., per building):

```mermaid
flowchart TB
    AUTH["LMN Authority API<br/>(single source of truth)"]

    subgraph Building1["Building A"]
        D1["LINBO Docker 1"]
        C1A["Clients A1-A500"]
    end

    subgraph Building2["Building B"]
        D2["LINBO Docker 2"]
        C2A["Clients B1-B500"]
    end

    subgraph Building3["Building C"]
        D3["LINBO Docker 3"]
        C3A["Clients C1-C1000"]
    end

    AUTH -->|"delta-feed"| D1
    AUTH -->|"delta-feed"| D2
    AUTH -->|"delta-feed"| D3
    C1A --> D1
    C2A --> D2
    C3A --> D3
```

Each Docker instance independently polls the Authority API and maintains its own snapshot. This provides:
- **Geographic distribution:** Boot files served locally per building
- **Fault isolation:** One Docker down does not affect others
- **Bandwidth optimization:** Only delta changes flow over WAN
- **Independent operation:** Each Docker can serve cached snapshots even if Authority API is unreachable

---

## Appendix A: Migration Path from Current to New Architecture

```mermaid
gantt
    title Migration Phases
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Phase 0
    Architecture & Design           :done, p0, 2026-02-26, 3d
    OpenAPI Spec                    :p0b, after p0, 2d

    section Phase 1
    LMN Authority API (MVP)         :p1a, after p0b, 7d
    Delta-feed endpoint             :p1b, after p0b, 5d
    Watcher (inotify)               :p1c, after p1b, 3d

    section Phase 2
    SyncService in Docker API       :p2a, after p1a, 5d
    SnapshotService                 :p2b, after p2a, 5d
    SnapshotGrubGenerator           :p2c, after p2b, 3d

    section Phase 3
    Remove CRUD routes              :p3a, after p2c, 3d
    Remove services                 :p3b, after p3a, 2d
    Update frontend                 :p3c, after p3a, 5d
    Prisma schema migration         :p3d, after p3b, 2d

    section Phase 4
    Integration testing             :p4a, after p3c, 5d
    Boot storm testing              :p4b, after p4a, 3d
    Documentation                   :p4c, after p4b, 2d
```

## Appendix B: Configuration Variables

### New Environment Variables for Docker API

| Variable | Default | Description |
|---|---|---|
| `AUTHORITY_API_URL` | `http://10.0.0.11:8000` | LMN Authority API base URL |
| `AUTHORITY_BEARER_TOKEN` | (required) | Bearer token for Authority API |
| `SYNC_POLL_INTERVAL_SEC` | `30` | Delta-feed poll interval |
| `SYNC_FULL_INTERVAL_SEC` | `3600` | Full sync interval (fallback) |
| `WEBHOOK_SECRET` | (optional) | HMAC secret for webhook verification |
| `SNAPSHOT_DIR` | `/srv/linbo/snapshot` | Snapshot base directory |
| `SNAPSHOT_MAX_KEEP` | `3` | Number of old snapshots to retain |

### New Environment Variables for LMN Authority API

| Variable | Default | Description |
|---|---|---|
| `DEVICES_CSV_PATH` | (required, no default) | Path to devices.csv. Typical: `/etc/linuxmuster/sophomorix/default-school/devices/devices.csv`. Varies per installation — must be configured explicitly. |
| `START_CONF_DIR` | `/srv/linbo/` | Directory containing start.conf files |
| `BEARER_TOKENS` | (required) | Comma-separated list of valid Bearer tokens |
| `IP_ALLOWLIST` | `10.0.0.0/16` | Comma-separated CIDRs for IP allowlist |
| `WEBHOOK_TARGETS` | (optional) | Comma-separated list of Docker webhook URLs |
| `WEBHOOK_SECRET` | (optional) | HMAC secret for webhooks |
| `DELTA_MAX_ENTRIES` | `10000` | Max changelog entries before compaction |
| `LISTEN_HOST` | `0.0.0.0` | Bind address |
| `LISTEN_PORT` | `8000` | Listen port |
