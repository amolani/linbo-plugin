# Session 6: Server-Komponenten Implementation

**Datum:** 2026-02-05
**Ziel:** LINBO Docker zur echten Standalone-Lösung machen

## Übersicht

In dieser Session wurden die fehlenden Server-Komponenten implementiert, die LINBO Docker von einem reinen Container-Setup zu einer vollständigen Standalone-Lösung machen.

## Implementierte Komponenten

### Phase 1: Config Deploy Service

**Neue Dateien:**
- `containers/api/src/services/config.service.js`

**Geänderte Dateien:**
- `containers/api/src/routes/configs.js` - Neue Deploy-Endpoints
- `containers/api/prisma/schema.prisma` - metadata/deployedAt Felder

**Funktionalität:**
- `generateStartConf()` - Generiert start.conf aus DB
- `deployConfig()` - Schreibt start.conf.{group} nach /srv/linbo/
- `createHostSymlinks()` - Erstellt IP-basierte Symlinks
- `cleanupOrphanedSymlinks()` - Entfernt verwaiste Symlinks
- `deployAllConfigs()` - Deployed alle aktiven Configs
- `listDeployedConfigs()` - Listet deployed Configs

**API Endpoints:**
- `POST /configs/:id/deploy` - Deploy einzelne Config
- `GET /configs/deployed/list` - Liste deployed Configs
- `POST /configs/deploy-all` - Deploy alle aktiven Configs
- `POST /configs/cleanup-symlinks` - Cleanup

### Phase 2: Update-Linbofs Service

**Neue Dateien:**
- `scripts/server/update-linbofs.sh` - Shell-Script für Key-Injection
- `containers/api/src/services/linbofs.service.js` - Node.js Integration
- `containers/api/src/routes/system.js` - System-Endpoints

**Funktionalität:**
- RSYNC-Passwort hashen (argon2)
- linbofs64 entpacken (xz/cpio)
- Passwort-Hash injizieren
- SSH-Keys injizieren (Dropbear + OpenSSH)
- Authorized Keys injizieren
- linbofs64 neu packen
- MD5-Hash generieren

**API Endpoints:**
- `POST /system/update-linbofs` - Update linbofs64
- `GET /system/linbofs-status` - Status prüfen
- `GET /system/linbofs-info` - File-Info
- `GET /system/key-status` - Key-Status
- `POST /system/initialize-keys` - Keys generieren
- `POST /system/generate-ssh-key` - SSH-Key generieren
- `POST /system/generate-dropbear-key` - Dropbear-Key generieren

### Phase 3: Operation Runner Worker

**Neue Dateien:**
- `containers/api/src/workers/operation.worker.js`

**Geänderte Dateien:**
- `containers/api/src/index.js` - Worker-Start
- `containers/api/src/routes/system.js` - Worker-Management

**Funktionalität:**
- Poll-Loop für pending Operations
- Parallel Session-Processing (konfigurierbare Concurrency)
- SSH-Befehle auf Hosts ausführen
- Status-Updates (DB + WebSocket)
- Pause/Resume Support

**API Endpoints:**
- `GET /system/worker-status` - Worker-Status
- `POST /system/worker/pause` - Worker pausieren
- `POST /system/worker/resume` - Worker fortsetzen

**Umgebungsvariablen:**
- `ENABLE_OPERATION_WORKER` - Worker aktivieren (default: true)
- `OPERATION_POLL_INTERVAL` - Poll-Interval in ms (default: 5000)
- `MAX_CONCURRENT_SESSIONS` - Max parallele Sessions (default: 5)

### Phase 4: GRUB Config Generator

**Neue Dateien:**
- `containers/api/src/services/grub.service.js`

**Geänderte Dateien:**
- `containers/api/src/routes/system.js` - GRUB-Endpoints
- `containers/api/src/routes/groups.js` - Auto-Trigger
- `containers/api/src/routes/hosts.js` - Auto-Trigger

**Funktionalität:**
- `generateGroupGrubConfig()` - Gruppen-Config
- `generateHostGrubConfig()` - Host-Config
- `generateMainGrubConfig()` - Haupt grub.cfg
- `regenerateAllGrubConfigs()` - Alle regenerieren
- `deleteGroupGrubConfig()` / `deleteHostGrubConfig()` - Löschen
- `cleanupOrphanedConfigs()` - Cleanup

**Auto-Trigger:**
- Gruppen CRUD → Gruppen-Config generieren/löschen
- Host CRUD → Host-Config generieren/löschen

**API Endpoints:**
- `POST /system/regenerate-grub-configs` - Alle regenerieren
- `GET /system/grub-configs` - Configs listen
- `POST /system/cleanup-grub-configs` - Cleanup

### Phase 5: RSYNC Hooks & Internal API

**Neue Dateien:**
- `containers/api/src/routes/internal.js` - Internal API
- `scripts/server/rsync-pre-download-api.sh`
- `scripts/server/rsync-post-download-api.sh`
- `scripts/server/rsync-pre-upload-api.sh`
- `scripts/server/rsync-post-upload-api.sh`

**Geänderte Dateien:**
- `config/rsyncd.conf` - Hooks aktiviert
- `containers/api/src/routes/index.js` - Internal-Routes
- `.env` - Neue Variablen

**Funktionalität:**
- RSYNC-Events an API senden
- Download/Upload-Tracking
- Automatische Image-Registrierung
- Host-Status-Updates während Transfers
- Client-Registrierung via PXE

**Internal API Endpoints:**
- `POST /internal/rsync-event` - RSYNC-Event empfangen
- `POST /internal/client-status` - Client-Status update
- `GET /internal/config/:identifier` - Config für Client holen
- `POST /internal/register-host` - Auto-Registrierung

## Dateiübersicht

### Neue Dateien (11)

| Datei | Beschreibung |
|-------|--------------|
| `containers/api/src/services/config.service.js` | Config-Deployment |
| `containers/api/src/services/linbofs.service.js` | Key-Injection |
| `containers/api/src/services/grub.service.js` | GRUB-Generator |
| `containers/api/src/routes/system.js` | System-Endpoints |
| `containers/api/src/routes/internal.js` | Internal API |
| `containers/api/src/workers/operation.worker.js` | Operation Worker |
| `scripts/server/update-linbofs.sh` | Key-Injection Script |
| `scripts/server/rsync-pre-download-api.sh` | RSYNC Hook |
| `scripts/server/rsync-post-download-api.sh` | RSYNC Hook |
| `scripts/server/rsync-pre-upload-api.sh` | RSYNC Hook |
| `scripts/server/rsync-post-upload-api.sh` | RSYNC Hook |

### Geänderte Dateien (8)

| Datei | Änderung |
|-------|----------|
| `containers/api/src/routes/configs.js` | Deploy-Endpoints |
| `containers/api/src/routes/groups.js` | GRUB Auto-Trigger |
| `containers/api/src/routes/hosts.js` | GRUB Auto-Trigger |
| `containers/api/src/routes/index.js` | System/Internal Routes |
| `containers/api/src/index.js` | Worker-Start |
| `containers/api/prisma/schema.prisma` | Config metadata/deployedAt |
| `config/rsyncd.conf` | Hooks aktiviert |
| `.env` | Neue Variablen |

## Neue API Endpoints (Zusammenfassung)

### Config Deployment
- `POST /api/v1/configs/:id/deploy`
- `GET /api/v1/configs/deployed/list`
- `POST /api/v1/configs/deploy-all`
- `POST /api/v1/configs/cleanup-symlinks`

### System Management
- `POST /api/v1/system/update-linbofs`
- `GET /api/v1/system/linbofs-status`
- `GET /api/v1/system/linbofs-info`
- `GET /api/v1/system/key-status`
- `POST /api/v1/system/initialize-keys`
- `POST /api/v1/system/generate-ssh-key`
- `POST /api/v1/system/generate-dropbear-key`
- `POST /api/v1/system/regenerate-grub-configs`
- `GET /api/v1/system/grub-configs`
- `POST /api/v1/system/cleanup-grub-configs`
- `GET /api/v1/system/worker-status`
- `POST /api/v1/system/worker/pause`
- `POST /api/v1/system/worker/resume`

### Internal API
- `POST /api/v1/internal/rsync-event`
- `POST /api/v1/internal/client-status`
- `GET /api/v1/internal/config/:identifier`
- `POST /api/v1/internal/register-host`

## Nächste Schritte

1. **Testing** - End-to-End Tests mit echten LINBO-Clients
2. **Frontend Integration** - Web-UI für neue Funktionen
3. **Docker Integration** - Update-Linbofs im Container ausführen
4. **Monitoring** - Prometheus/Grafana Metriken
