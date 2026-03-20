# LINBO Docker - Server-Komponenten

Diese Dokumentation beschreibt die Server-Komponenten, die LINBO Docker zu einer echten Standalone-Lösung machen.

## Übersicht

Die Server-Komponenten bestehen aus fünf Hauptbereichen:

| Phase | Komponente | Beschreibung |
|-------|------------|--------------|
| 1 | Config Deploy Service | start.conf Dateien nach /srv/linbo schreiben |
| 2 | Update-Linbofs Service | SSH-Keys + Secrets in linbofs64 injizieren |
| 3 | Operation Runner | Pending Operations im Hintergrund ausführen |
| 4 | GRUB Config Generator | GRUB-Configs für Gruppen/Hosts generieren |
| 5 | RSYNC Hooks | API-Integration für Upload/Download Events |

---

## Phase 1: Config Deploy Service

### Beschreibung

Der Config Deploy Service ermöglicht das Deployment von Konfigurationen aus der Datenbank als `start.conf` Dateien nach `/srv/linbo/`. Dies ist essentiell für den LINBO-Bootprozess, da Clients ihre Konfiguration von dort abrufen.

### Dateien

- `containers/api/src/services/config.service.js` - Hauptlogik
- `containers/api/src/routes/configs.js` - API Endpoints

### Funktionen

#### `generateStartConf(configId)`
Generiert den Inhalt einer start.conf Datei aus der Datenbank-Konfiguration.

```javascript
const { content, config } = await configService.generateStartConf(configId);
```

#### `deployConfig(configId)`
Schreibt die Konfiguration als `start.conf.{groupname}` nach `/srv/linbo/`.

- Erstellt automatisch ein Backup der bestehenden Datei
- Generiert MD5-Hash für Integritätsprüfung

```javascript
const result = await configService.deployConfig(configId);
// { filepath: '/srv/linbo/start.conf.win11', hash: 'abc123...', size: 1234 }
```

#### `createHostSymlinks(configId)`
Erstellt IP-basierte Symlinks für alle Hosts einer Konfiguration.

LINBO verwendet IP-basierte Symlinks:
```
start.conf-10.0.0.111 -> start.conf.win11_efi_sata
start.conf-10.0.0.112 -> start.conf.win11_efi_sata
```

### API Endpoints

#### `POST /api/v1/configs/:id/deploy`
Deployed eine Konfiguration als start.conf Datei.

**Request:**
```json
{
  "createSymlinks": true
}
```

**Response:**
```json
{
  "data": {
    "filepath": "/srv/linbo/start.conf.win11",
    "hash": "d41d8cd98f00b204e9800998ecf8427e",
    "size": 1234,
    "configName": "win11",
    "symlinkCount": 5,
    "message": "Config deployed successfully with 5 symlinks"
  }
}
```

#### `GET /api/v1/configs/deployed/list`
Listet alle deployed Konfigurationen in /srv/linbo/.

#### `POST /api/v1/configs/deploy-all`
Deployed alle aktiven Konfigurationen.

#### `POST /api/v1/configs/cleanup-symlinks`
Entfernt verwaiste Symlinks.

---

## Phase 2: Update-Linbofs Service

### Beschreibung

Der Update-Linbofs Service injiziert SSH-Keys und das RSYNC-Passwort in `linbofs64`. Dies ist erforderlich, damit:
- Clients sich am Server authentifizieren können
- Der Server Befehle an Clients senden kann
- RSYNC-Uploads authentifiziert werden können

### Dateien

- `scripts/server/update-linbofs.sh` - Shell-Script für die Injection
- `containers/api/src/services/linbofs.service.js` - Node.js Integration
- `containers/api/src/routes/system.js` - API Endpoints

### Shell-Script: update-linbofs.sh

Das Script führt folgende Schritte aus:

1. **RSYNC-Passwort hashen** (argon2)
   ```bash
   linbo_pwhash="$(echo "$linbo_passwd" | argon2 "$linbo_salt" -t 1000 | grep ^Hash | awk '{print $2}')"
   ```

2. **linbofs64 entpacken**
   ```bash
   xzcat "$LINBOFS" | cpio -i -d -H newc --no-absolute-filenames
   ```

3. **Passwort-Hash injizieren**
   ```bash
   echo -n "$linbo_pwhash" > etc/linbo_pwhash
   echo -n "$linbo_salt" > etc/linbo_salt
   ```

4. **SSH-Keys injizieren**
   - Dropbear Host Keys nach `etc/dropbear/`
   - OpenSSH Keys nach `etc/ssh/`
   - Authorized Keys nach `.ssh/authorized_keys`

5. **linbofs64 neu packen**
   ```bash
   find . -print | cpio --quiet -o -H newc | xz -e --check=none -z -f -T 0 -c > "$LINBOFS.new"
   ```

6. **MD5-Hash generieren**
   ```bash
   md5sum "$LINBOFS" | awk '{print $1}' > "${LINBOFS}.md5"
   ```

### API Endpoints

#### `POST /api/v1/system/update-linbofs`
Führt das Update-Linbofs Script aus.

**Response:**
```json
{
  "data": {
    "success": true,
    "message": "linbofs64 updated successfully",
    "output": "=== LINBO Docker Update-Linbofs ===\n...",
    "duration": 45230
  }
}
```

#### `GET /api/v1/system/linbofs-status`
Prüft ob linbofs64 korrekt konfiguriert ist.

**Response:**
```json
{
  "data": {
    "status": "ready",
    "message": "linbofs64 is properly configured",
    "file": {
      "exists": true,
      "path": "/srv/linbo/linbofs64",
      "size": 89456789,
      "md5": "abc123...",
      "modifiedAt": "2024-01-15T10:30:00Z"
    },
    "contents": {
      "valid": true,
      "hasAuthorizedKeys": true,
      "hasDropbearKey": true,
      "hasSshKey": true,
      "hasPasswordHash": true
    },
    "availableKeys": {
      "dropbearKeys": ["dropbear_rsa_host_key", "dropbear_ed25519_host_key"],
      "sshKeys": ["ssh_host_rsa_key", "ssh_host_ed25519_key"],
      "publicKeys": ["id_rsa.pub", "id_ed25519.pub"]
    }
  }
}
```

#### `POST /api/v1/system/initialize-keys`
Generiert alle fehlenden SSH/Dropbear Keys.

#### `GET /api/v1/system/key-status`
Zeigt verfügbare SSH-Keys an.

---

## Phase 3: Operation Runner (Background Worker)

### Beschreibung

Der Operation Runner ist ein Background Worker, der pending Operations aus der Datenbank abarbeitet. Er ermöglicht das asynchrone Ausführen von LINBO-Befehlen auf mehreren Clients.

### Dateien

- `containers/api/src/workers/operation.worker.js` - Worker-Implementierung
- `containers/api/src/index.js` - Worker-Start

### Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                    Operation Runner                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐    ┌─────────────┐    ┌─────────────────┐     │
│  │  Poll   │───▶│  Process    │───▶│  Execute SSH    │     │
│  │  Loop   │    │  Operation  │    │  Commands       │     │
│  └─────────┘    └─────────────┘    └─────────────────┘     │
│       │                │                    │               │
│       │                │                    │               │
│       ▼                ▼                    ▼               │
│  ┌─────────┐    ┌─────────────┐    ┌─────────────────┐     │
│  │  Sleep  │    │  Update DB  │    │  Broadcast WS   │     │
│  │  5 sec  │    │  Status     │    │  Events         │     │
│  └─────────┘    └─────────────┘    └─────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Konfiguration

| Umgebungsvariable | Standard | Beschreibung |
|-------------------|----------|--------------|
| `ENABLE_OPERATION_WORKER` | `true` | Worker aktivieren/deaktivieren |
| `OPERATION_POLL_INTERVAL` | `5000` | Poll-Interval in ms |
| `MAX_CONCURRENT_SESSIONS` | `5` | Parallele SSH-Sessions pro Batch |

### Ablauf einer Operation

1. **Operation erstellen** (API)
   ```json
   POST /api/v1/operations/send-command
   {
     "targetHosts": ["uuid1", "uuid2"],
     "commands": ["sync", "start"],
     "options": { "osName": "Windows 11" }
   }
   ```

2. **Worker holt Operation**
   - Status wird auf `running` gesetzt
   - Sessions für jeden Host werden erstellt

3. **Sessions werden verarbeitet**
   - Parallel in Batches (max `MAX_CONCURRENT_SESSIONS`)
   - SSH-Verbindung zum Host
   - LINBO-Befehl ausführen
   - Status-Updates via WebSocket

4. **Operation abschließen**
   - Statistiken speichern
   - Finalen Status setzen (`completed` oder `completed_with_errors`)

### WebSocket Events

| Event | Beschreibung |
|-------|--------------|
| `operation.running` | Operation gestartet |
| `operation.progress` | Fortschritts-Update |
| `operation.completed` | Operation abgeschlossen |
| `session.running` | Session für Host gestartet |
| `session.completed` | Session für Host abgeschlossen |
| `session.failed` | Session fehlgeschlagen |

### API Endpoints

#### `GET /api/v1/system/worker-status`
Zeigt den Worker-Status an.

**Response:**
```json
{
  "data": {
    "running": true,
    "paused": false,
    "pollInterval": 5000,
    "maxConcurrentSessions": 5
  }
}
```

#### `POST /api/v1/system/worker/pause`
Pausiert den Worker.

#### `POST /api/v1/system/worker/resume`
Setzt den Worker fort.

---

## Phase 4: GRUB Config Generator

### Beschreibung

Der GRUB Config Generator erstellt automatisch GRUB-Konfigurationsdateien für den Netzwerk-Boot. Diese Dateien steuern, welche Konfiguration ein Client beim Booten erhält.

### Dateien

- `containers/api/src/services/grub.service.js` - Generator-Logik
- `containers/api/src/routes/system.js` - API Endpoints
- `containers/api/src/routes/groups.js` - Auto-Trigger
- `containers/api/src/routes/hosts.js` - Auto-Trigger

### Verzeichnisstruktur

```
/srv/linbo/boot/grub/
├── grub.cfg              # Haupt-Konfiguration (Chain-Loading)
├── win11_efi.cfg         # Gruppen-Konfiguration
├── ubuntu_pc.cfg         # Gruppen-Konfiguration
└── hostcfg/
    ├── pc-raum1-01.cfg   # Host-spezifische Konfiguration
    ├── pc-raum1-02.cfg
    └── ...
```

### Haupt grub.cfg

Die Haupt-Konfiguration lädt zuerst host-spezifische, dann gruppen-spezifische Configs:

```grub
# Versuche host-spezifische Config zu laden
if [ -f $prefix/hostcfg/$hostname.cfg ]; then
  source $prefix/hostcfg/$hostname.cfg
# Dann gruppen-spezifische Config
elif [ -n "$group" ] && [ -f $prefix/$group.cfg ]; then
  source $prefix/$group.cfg
# Fallback: direkt LINBO booten
else
  linux /linbo64 quiet splash linbo_server=$pxe_default_server
  initrd /linbofs64
fi
```

### Auto-Trigger

GRUB-Configs werden automatisch bei folgenden Aktionen aktualisiert:

- **Gruppe erstellt** → Gruppen-Config wird generiert
- **Gruppe aktualisiert** → Gruppen-Config wird regeneriert
- **Gruppe gelöscht** → Gruppen-Config wird gelöscht
- **Host erstellt** → Host-Config wird generiert (falls Gruppe zugewiesen)
- **Host aktualisiert** → Host-Config wird regeneriert
- **Host gelöscht** → Host-Config wird gelöscht

### API Endpoints

#### `POST /api/v1/system/regenerate-grub-configs`
Regeneriert alle GRUB-Configs für alle Gruppen und Hosts.

**Response:**
```json
{
  "data": {
    "message": "Generated 5 group configs and 23 host configs",
    "groups": 5,
    "hosts": 23,
    "configs": [
      { "type": "main", "name": "grub.cfg" },
      { "type": "group", "name": "win11_efi" },
      { "type": "host", "name": "pc-raum1-01", "group": "win11_efi" },
      ...
    ]
  }
}
```

#### `GET /api/v1/system/grub-configs`
Listet alle GRUB-Configs.

**Response:**
```json
{
  "data": {
    "groups": ["win11_efi", "ubuntu_pc", "linux_workstation"],
    "hosts": ["pc-raum1-01", "pc-raum1-02", "pc-raum2-01"]
  }
}
```

#### `POST /api/v1/system/cleanup-grub-configs`
Entfernt verwaiste GRUB-Configs.

---

## Phase 5: RSYNC Hooks & Internal API

### Beschreibung

Die RSYNC Hooks integrieren den rsync-Daemon mit der API. Sie ermöglichen:
- Tracking von Download/Upload-Aktivitäten
- Automatische Image-Registrierung bei Uploads
- Host-Status-Updates während Transfers
- Real-time WebSocket-Events

### Dateien

- `containers/api/src/routes/internal.js` - Internal API
- `scripts/server/rsync-pre-download-api.sh` - Pre-Download Hook
- `scripts/server/rsync-post-download-api.sh` - Post-Download Hook
- `scripts/server/rsync-pre-upload-api.sh` - Pre-Upload Hook
- `scripts/server/rsync-post-upload-api.sh` - Post-Upload Hook
- `config/rsyncd.conf` - RSYNC-Konfiguration mit aktivierten Hooks

### Hook-Ablauf

```
┌─────────────────────────────────────────────────────────────────┐
│                      RSYNC Download                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client          RSYNC           Hook Script         API        │
│    │               │                  │               │         │
│    │──get file────▶│                  │               │         │
│    │               │──pre-xfer───────▶│               │         │
│    │               │                  │──POST event──▶│         │
│    │               │                  │◀──200 OK─────│         │
│    │◀──file data───│                  │               │         │
│    │               │──post-xfer──────▶│               │         │
│    │               │                  │──POST event──▶│         │
│    │               │                  │◀──200 OK─────│         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### rsyncd.conf Konfiguration

```ini
[linbo]
path = /srv/linbo
read only = yes
pre-xfer exec = /usr/share/linuxmuster/linbo/rsync-pre-download-api.sh
post-xfer exec = /usr/share/linuxmuster/linbo/rsync-post-download-api.sh

[linbo-upload]
path = /srv/linbo
read only = no
auth users = linbo
pre-xfer exec = /usr/share/linuxmuster/linbo/rsync-pre-upload-api.sh
post-xfer exec = /usr/share/linuxmuster/linbo/rsync-post-upload-api.sh
```

### Internal API Endpoints

Diese Endpoints sind nur für interne Service-Kommunikation gedacht und durch einen API-Key geschützt.

#### `POST /api/v1/internal/rsync-event`
Empfängt RSYNC-Events von den Hook-Scripts.

**Header:**
```
X-Internal-Key: ${INTERNAL_API_KEY}
```

**Request:**
```json
{
  "event": "post-upload",
  "module": "linbo-upload",
  "clientIp": "10.0.0.111",
  "request": "/images/win11.qcow2",
  "filename": "win11.qcow2"
}
```

**Aktionen bei Image-Upload:**
- Image wird automatisch in der Datenbank registriert
- MD5-Hash wird gelesen (falls vorhanden)
- WebSocket-Event `image.created` wird gesendet

#### `POST /api/v1/internal/client-status`
Aktualisiert den Client-Status (von LINBO-Client während Boot).

**Request:**
```json
{
  "clientIp": "10.0.0.111",
  "status": "linbo",
  "cacheInfo": { "used": "50GB", "free": "100GB" },
  "hardware": { "cpu": "Intel i5", "ram": "16GB" }
}
```

#### `GET /api/v1/internal/config/:identifier`
Holt die start.conf für einen Client (per IP oder Hostname).

**Response:** `text/plain` - start.conf Inhalt

#### `POST /api/v1/internal/register-host`
Auto-Registrierung eines neuen Hosts während PXE-Boot.

**Request:**
```json
{
  "hostname": "pc-raum1-new",
  "macAddress": "00:11:22:33:44:55",
  "ipAddress": "10.0.0.155",
  "groupName": "win11_efi"
}
```

### WebSocket Events

| Event | Beschreibung |
|-------|--------------|
| `rsync.download.started` | Download gestartet |
| `rsync.download.completed` | Download abgeschlossen |
| `rsync.upload.started` | Upload gestartet |
| `rsync.upload.completed` | Upload abgeschlossen |
| `image.created` | Neues Image registriert |
| `image.updated` | Image aktualisiert |

---

## Umgebungsvariablen

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `LINBO_DIR` | `/srv/linbo` | LINBO-Datenverzeichnis |
| `CONFIG_DIR` | `/etc/linuxmuster/linbo` | LINBO-Konfigurationsverzeichnis |
| `INTERNAL_API_KEY` | `linbo-internal-secret` | API-Key für Service-Kommunikation |
| `ENABLE_OPERATION_WORKER` | `true` | Operation Worker aktivieren |
| `OPERATION_POLL_INTERVAL` | `5000` | Poll-Interval in Millisekunden |
| `MAX_CONCURRENT_SESSIONS` | `5` | Max. parallele SSH-Sessions |
| `UPDATE_LINBOFS_SCRIPT` | `/usr/share/linuxmuster/linbo/update-linbofs.sh` | Pfad zum Update-Script |

---

## Verifizierung

### Phase 1 testen
```bash
# Config deployen
curl -X POST http://localhost:3000/api/v1/configs/{id}/deploy \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"createSymlinks": true}'

# Prüfen ob Datei existiert
ls -la /srv/linbo/start.conf.*
```

### Phase 2 testen
```bash
# Linbofs updaten
curl -X POST http://localhost:3000/api/v1/system/update-linbofs \
  -H "Authorization: Bearer $TOKEN"

# Status prüfen
curl http://localhost:3000/api/v1/system/linbofs-status \
  -H "Authorization: Bearer $TOKEN"
```

### Phase 3 testen
```bash
# Operation erstellen
curl -X POST http://localhost:3000/api/v1/operations/send-command \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetHosts":["..."], "commands":["sync"]}'

# Worker-Status prüfen
curl http://localhost:3000/api/v1/system/worker-status \
  -H "Authorization: Bearer $TOKEN"
```

### Phase 4 testen
```bash
# GRUB configs generieren
curl -X POST http://localhost:3000/api/v1/system/regenerate-grub-configs \
  -H "Authorization: Bearer $TOKEN"

# Prüfen
ls -la /srv/linbo/boot/grub/*.cfg
ls -la /srv/linbo/boot/grub/hostcfg/
```

### End-to-End Test
1. Client via PXE booten
2. LINBO GUI sollte erscheinen
3. start.conf sollte geladen werden
4. Sync-Operation via Web-UI starten
5. Operation sollte vom Worker ausgeführt werden
