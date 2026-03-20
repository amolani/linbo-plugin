# LINBO Docker — Architecture

> **Stand:** 2026-03-04 | **Modus:** Sync (Read-Only)

## IST-Zustand (aktuell)

```mermaid
graph TB
    subgraph LMN["LMN-Server (10.0.0.11)"]
        direction TB
        AD["Samba AD<br/>LDAP · DNS · DHCP"]
        SOPHO["Sophomorix<br/>User/Device Mgmt"]
        WEBUI["webui7<br/>Host/Config/Room CRUD"]
        LMNAPI["linuxmuster-api :8001<br/>Sophomorix REST (FastAPI)"]
        AUTH["Authority API :8400<br/>Read-Only Delta-Feed (FastAPI)<br/><i>eigenentwickelt</i>"]
        CSV[("devices.csv<br/>start.conf.*<br/>Source of Truth")]

        WEBUI -->|CRUD| CSV
        SOPHO -->|Import| CSV
        AUTH -->|liest| CSV
    end

    subgraph DOCKER["LINBO Docker (10.0.0.13)"]
        direction TB

        subgraph BOOT["Boot-Schicht"]
            INIT["init<br/><i>einmalig</i>"]
            TFTP["tftp :69/udp<br/>PXE Boot"]
            RSYNC["rsync :873<br/>Images + Treiber"]
            SSH["ssh :2222<br/>Remote Commands"]
        end

        subgraph DATA["Daten-Schicht"]
            REDIS[("Redis :6379<br/>Sync-Cache · Status<br/>Operations · Settings")]
        end

        subgraph API_LAYER["API-Schicht"]
            API["api :3000<br/>Express.js + WebSocket"]
        end

        subgraph WEB["Frontend"]
            NGINX["web :8080<br/>Nginx + React SPA"]
        end

        INIT --> TFTP
        API --> SSH
        API --> REDIS
        NGINX -->|/api/ · /ws| API
    end

    subgraph CLIENTS["PXE-Clients"]
        PC1["pc01<br/>10.0.152.x"]
        PC2["pc02<br/>10.0.152.x"]
        PCN["..."]
    end

    AUTH -->|"Delta-Feed<br/>GET /changes?since=cursor<br/>Batch-GET hosts/configs"| API
    API -.->|"NIEMALS<br/>Write-Back"| AUTH

    PC1 & PC2 & PCN -->|TFTP| TFTP
    PC1 & PC2 & PCN -->|rsync| RSYNC
    PC1 & PC2 & PCN -->|SSH| SSH

    BROWSER["Browser"] -->|HTTP :8080| NGINX

    style AUTH fill:#2563eb,color:#fff
    style API fill:#2563eb,color:#fff
    style REDIS fill:#dc2626,color:#fff
    style NGINX fill:#16a34a,color:#fff
    style CSV fill:#f59e0b,color:#000
```

## Datenfluss im Sync-Modus

```mermaid
sequenceDiagram
    participant LMN as Authority API<br/>(10.0.0.11:8400)
    participant API as Docker API<br/>(10.0.0.13:3000)
    participant Redis as Redis Cache
    participant FS as Dateisystem<br/>(/srv/linbo/)
    participant Client as PXE-Client

    Note over API: POST /api/v1/sync/trigger

    API->>LMN: GET /changes?since=cursor
    LMN-->>API: {hostsChanged, startConfsChanged, dhcpChanged}

    API->>LMN: POST /hosts:batch {macs}
    LMN-->>API: {hosts: [{mac, ip, hostname, hostgroup}]}

    API->>LMN: POST /startconfs:batch {ids}
    LMN-->>API: {startConfs: [{id, content}]}

    API->>Redis: SET sync:host:{mac}
    API->>Redis: SET sync:config:{group}
    API->>FS: start.conf.{group} schreiben<br/>(server= → Docker-IP)
    API->>FS: GRUB group.cfg regenerieren

    Client->>FS: TFTP: linbo64 + linbofs64
    Client->>FS: rsync: OS-Images
    Client->>API: SSH: Remote Commands
```

## Docker-exklusive Features

Diese Features existieren nur in LINBO Docker, nicht in der Standard-Installation:

```mermaid
graph LR
    subgraph DOCKER_FEATURES["Docker-exklusive Features"]
        direction TB
        PATCH["Patchclass<br/>Windows-Treiber<br/>DMI-Matching"]
        FW["Firmware<br/>Auto-Detection<br/>via SSH"]
        KERN["Kernel Switching<br/>stable · longterm · legacy"]
        TERM["Web Terminal<br/>xterm.js + PTY"]
        GRUB["GRUB Theme<br/>Logo · Icons · Farben"]
        GUI["LINBO GUI<br/>Boot-Animation"]
        REACT["React Frontend<br/>Ersetzt webui7"]
    end

    subgraph STORAGE["Lokaler Speicher (nicht synchronisiert)"]
        DRV[("/var/lib/linbo/drivers/")]
        KRN[("/var/lib/linuxmuster/linbo/")]
        SRV[("/srv/linbo/boot/grub/themes/")]
    end

    PATCH --> DRV
    KERN --> KRN
    GRUB --> SRV
```

## SOLL-Zustand (mit Upstream-PRs)

Ziel: Docker-exklusive Features universal machen via PRs an die Upstream-Repos.

```mermaid
graph TB
    subgraph LMN_FUTURE["LMN-Server (Zukunft)"]
        direction TB
        AD2["Samba AD"]
        SOPHO2["Sophomorix"]
        REACT_UI["React Frontend<br/><i>ersetzt webui7</i>"]
        LMNAPI2["linuxmuster-api :8001<br/>+ Patchclass-Endpoints<br/>+ Firmware-Endpoints"]
        AUTH2["Authority API :8400<br/>+ Webhook-Dispatch<br/>+ Event-Stream"]
        CSV2[("devices.csv<br/>start.conf.*")]

        REACT_UI -->|REST| LMNAPI2
        REACT_UI -->|REST| AUTH2
        LMNAPI2 -->|CRUD| CSV2
        AUTH2 -->|liest| CSV2
    end

    subgraph DOCKER_FUTURE["LINBO Docker (Zukunft)"]
        direction TB

        subgraph BOOT2["Boot-Schicht"]
            TFTP2["tftp"]
            RSYNC2["rsync"]
            SSH2["ssh"]
        end

        REDIS2[("Redis")]
        API2["api :3000"]
        WEB2["web :8080<br/>React Frontend"]

        API2 --> REDIS2
        API2 --> SSH2
        WEB2 --> API2
    end

    subgraph UPSTREAM["Upstream-PRs"]
        direction TB
        PR1["linuxmuster-linbo7<br/>├ devpts Fix<br/>├ udev Input Fix<br/>├ blkdev Symlinks<br/>└ Patchclass Framework"]
        PR2["lmn-authority-api<br/>├ Webhook Dispatch<br/>└ Event-Stream (SSE)"]
        PR3["linuxmuster-api<br/>├ Patchclass CRUD<br/>└ Firmware CRUD"]
    end

    AUTH2 -->|"Webhook / SSE<br/>(Push statt Poll)"| API2
    API2 -.->|Read-Only| AUTH2

    PR1 -.->|PR| LINBO7["linuxmuster-linbo7<br/>(GitHub)"]
    PR2 -.->|PR| AUTHREPO["lmn-authority-api"]
    PR3 -.->|PR| LMNAPIREPO["linuxmuster-api<br/>(GitHub)"]

    style REACT_UI fill:#16a34a,color:#fff
    style AUTH2 fill:#2563eb,color:#fff
    style API2 fill:#2563eb,color:#fff
    style REDIS2 fill:#dc2626,color:#fff
    style PR1 fill:#7c3aed,color:#fff
    style PR2 fill:#7c3aed,color:#fff
    style PR3 fill:#7c3aed,color:#fff
```

## Upstream-PR Übersicht

| Repo | Feature | Typ | Beschreibung |
|------|---------|-----|-------------|
| `linuxmuster-linbo7` | devpts Mount | Bugfix | `/dev/pts` vor dropbear mounten |
| `linuxmuster-linbo7` | udev Input | Bugfix | udevd restart vor linbo_gui |
| `linuxmuster-linbo7` | blkdev Symlinks | Bugfix | `/dev/sd*` Symlinks für NVMe |
| `linuxmuster-linbo7` | Patchclass | Feature | `linbo_patch_registry` Client-Script |
| `lmn-authority-api` | Webhooks | Feature | Push-Notifications bei Änderungen |
| `linuxmuster-api` | Patchclass CRUD | Feature | Treiber-Verwaltung via REST |
| `linuxmuster-api` | Firmware CRUD | Feature | Firmware-Verwaltung via REST |

## Container-Übersicht

| Container | Port | Netzwerk | Rolle |
|-----------|------|----------|-------|
| `init` | — | — | Boot-Dateien herunterladen (einmalig) |
| `tftp` | 69/udp | host | PXE-Boot für Clients |
| `rsync` | 873 | bridge | Images + Treiber verteilen |
| `ssh` | 2222 | host | Remote Commands + Terminal |
| `cache` | 6379 | bridge | Redis (Sync, Status, Settings) |
| `api` | 3000 | bridge | REST API + WebSocket |
| `web` | 8080 | bridge | Nginx + React SPA |
| `dhcp` | 67/udp | host | dnsmasq Proxy (optional) |

## Volume-Mapping

| Volume | Mount | Inhalt |
|--------|-------|--------|
| `linbo_srv_data` | `/srv/linbo` | Boot-Dateien, Images, Configs |
| `linbo_config` | `/etc/linuxmuster/linbo` | SSH-Keys, Kernel-State |
| `linbo_log` | `/var/log/linuxmuster/linbo` | Logs |
| `linbo_redis_data` | Redis Data | Sync-Cursor, Cache |
| `linbo_kernel_data` | `/var/lib/linuxmuster/linbo` | Kernel-Varianten |
| `linbo_driver_data` | `/var/lib/linbo/drivers` | Patchclass-Treiber |
