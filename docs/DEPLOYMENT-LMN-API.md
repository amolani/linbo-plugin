# Deployment: LINBO Router auf linuxmuster-api

> **Status:** PROPOSAL (noch nicht als PR eingereicht)

Dieses Dokument beschreibt, wie der LINBO-Router (`linbo.py`) auf einem
linuxmuster.net 7.3 Server installiert wird, damit LINBO Docker im
Sync-Modus Hosts, Configs und DHCP-Daten direkt ueber die offizielle
`linuxmuster-api` (Port 8001) abrufen kann.

---

## Inhaltsverzeichnis

1. [Voraussetzungen](#voraussetzungen)
2. [Dateien im PR](#dateien-im-pr)
3. [Schritt-fuer-Schritt Installation](#schritt-fuer-schritt-installation)
4. [Docker-Seite konfigurieren](#docker-seite-konfigurieren)
5. [Verifizierung](#verifizierung)
6. [Konventionen-Unterschiede](#konventionen-unterschiede)
7. [Datenquellen auf dem LMN-Server](#datenquellen-auf-dem-lmn-server)
8. [Rollback](#rollback)

---

## Voraussetzungen

- **linuxmuster.net 7.3 Server** mit installiertem Paket `linuxmuster-api`
- Python-Paket `linuxmusterApi` unter `/usr/lib/python3/dist-packages/linuxmusterApi/`
- `linuxmuster-api.service` laeuft (systemd)
- Ein Benutzer mit der Rolle `globaladministrator` (z.B. `global-admin`)
- SSH- oder Konsolenzugang zum LMN-Server (root)
- LINBO Docker Host muss den LMN-Server per HTTPS auf Port 8001 erreichen koennen

---

## Dateien im PR

Alle Dateien liegen im Repository unter `docs/upstream-pr/linuxmuster-api/`.

### 1. `routers_v1/linbo.py` -- LINBO Router (NEU)

**Umfang:** ca. 550 Zeilen, 6 read-only Endpoints, 7 Helper-Funktionen.

Der Router stellt folgende Endpoints unter `/v1/linbo/` bereit:

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| `GET` | `/v1/linbo/health` | LINBO-Subsystem Health Check |
| `GET` | `/v1/linbo/changes?since=<cursor>` | Delta-Feed (Cursor = Unix-Timestamp) |
| `POST` | `/v1/linbo/hosts:batch` | Hosts nach MAC-Liste (max 500) |
| `POST` | `/v1/linbo/startconfs:batch` | start.conf-Dateien nach Gruppen-ID (max 100) |
| `POST` | `/v1/linbo/configs:batch` | GRUB-Configs nach Gruppen-ID (max 100) |
| `GET` | `/v1/linbo/dhcp/export/dnsmasq-proxy` | DHCP-Export als text/plain (mit ETag) |

**Abhaengigkeiten:**
- `fastapi` (APIRouter, Depends, HTTPException, Request)
- `security` (AuthenticatedUser, RoleChecker) -- bereits in linuxmuster-api enthalten
- `body_schemas` (LinboBatchMacs, LinboBatchIds) -- muss erweitert werden (s.u.)
- Python-Standardbibliothek: `hashlib`, `logging`, `re`, `time`, `datetime`, `pathlib`

**Zugriffskontrolle:** Alle Endpoints erfordern `RoleChecker("G")` -- nur `globaladministrator`-Benutzer.

**Dateipfade im Code:**
- `DEVICES_CSV_PATH` = `/etc/linuxmuster/sophomorix/default-school/devices.csv`
- `LINBO_DIR` = `/srv/linbo`
- `GRUB_DIR` = `/srv/linbo/boot/grub`

**Helper-Funktionen:**
- `_normalize_mac(raw)` -- MAC-Adresse normalisieren (Uppercase, Doppelpunkt-getrennt)
- `_get_mtime(path)` -- Datei-mtime als UTC datetime
- `_mtime_cursor(dt)` -- datetime in Unix-Timestamp-String umwandeln
- `_parse_devices_csv()` -- devices.csv parsen (Semikolon-getrennt, 15 Spalten)
- `_list_startconf_ids()` -- start.conf.* Dateien in /srv/linbo/ auflisten
- `_list_grub_cfg_ids()` -- *.cfg Dateien in /srv/linbo/boot/grub/ auflisten
- `_generate_dnsmasq_proxy(hosts)` -- dnsmasq proxy-DHCP Config generieren

### 2. `body_schemas_patch.py` -- Pydantic Models (ERWEITERN)

**Umfang:** 2 Pydantic Models, ca. 15 Zeilen.

Diese Models werden am Ende der bestehenden Datei `body_schemas.py` angefuegt:

```python
class LinboBatchMacs(BaseModel):
    """List of MAC addresses for batch host lookup."""
    macs: list[str]

class LinboBatchIds(BaseModel):
    """List of IDs for batch config lookup."""
    ids: list[str]
```

- `LinboBatchMacs` -- wird von `/v1/linbo/hosts:batch` verwendet
- `LinboBatchIds` -- wird von `/v1/linbo/startconfs:batch` und `/v1/linbo/configs:batch` verwendet

### 3. `main_patch.txt` -- Router-Registrierung (ERWEITERN)

**Umfang:** 2 Zeilen in `main.py`.

```python
# Import (bei den anderen Router-Imports):
from routers_v1 import linbo

# Registrierung (bei den anderen app.include_router-Aufrufen):
app.include_router(linbo.router, prefix="/v1")
```

---

## Schritt-fuer-Schritt Installation

### Manuelle Installation (zum Testen)

Diese Methode eignet sich zum schnellen Testen auf einem Entwicklungs- oder Testserver.

#### Schritt 1: Backup erstellen

```bash
# Auf dem LMN-Server (10.0.0.11):
cd /usr/lib/python3/dist-packages/linuxmusterApi

# Backup der zu aendernden Dateien
cp routers_v1/body_schemas.py routers_v1/body_schemas.py.bak
cp main.py main.py.bak

# Falls linbo.py schon existiert (z.B. von frueherer Installation):
[ -f routers_v1/linbo.py ] && cp routers_v1/linbo.py routers_v1/linbo.py.bak
```

#### Schritt 2: linbo.py kopieren

```bash
# Vom LINBO Docker Host auf den LMN-Server:
scp docs/upstream-pr/linuxmuster-api/routers_v1/linbo.py \
    root@10.0.0.11:/usr/lib/python3/dist-packages/linuxmusterApi/routers_v1/linbo.py

# Oder direkt auf dem LMN-Server (falls das Repository dort verfuegbar ist):
cp /pfad/zum/repo/docs/upstream-pr/linuxmuster-api/routers_v1/linbo.py \
   /usr/lib/python3/dist-packages/linuxmusterApi/routers_v1/linbo.py
```

#### Schritt 3: body_schemas.py erweitern

Die zwei Pydantic Models am Ende der Datei anfuegen:

```bash
# Auf dem LMN-Server:
cat >> /usr/lib/python3/dist-packages/linuxmusterApi/routers_v1/body_schemas.py << 'EOF'


# --- LINBO Models ---


class LinboBatchMacs(BaseModel):
    """List of MAC addresses for batch host lookup."""

    macs: list[str]


class LinboBatchIds(BaseModel):
    """List of IDs for batch config lookup."""

    ids: list[str]
EOF
```

**Wichtig:** Pruefen, dass `BaseModel` bereits importiert ist (ist es standardmaessig in body_schemas.py).

#### Schritt 4: main.py erweitern

```bash
# Auf dem LMN-Server:
cd /usr/lib/python3/dist-packages/linuxmusterApi

# Import hinzufuegen (bei den anderen Router-Imports, ca. Zeile 50):
# Manuell in main.py einfuegen:
#   from routers_v1 import linbo

# Router registrieren (bei den anderen include_router-Aufrufen, ca. Zeile 100):
# Manuell in main.py einfuegen:
#   app.include_router(linbo.router, prefix="/v1")
```

Beispiel mit `sed` (vorher Zeilen-Nummern pruefen!):

```bash
# Import einfuegen nach der letzten "from routers_v1 import ..." Zeile:
# Zuerst die letzte Import-Zeile finden:
grep -n "from routers_v1 import" main.py | tail -1
# Dann nach dieser Zeile einfuegen (Beispiel: Zeile 52):
sed -i '52a\    linbo,' main.py

# Router registrieren nach dem letzten include_router-Aufruf:
grep -n "app.include_router" main.py | tail -1
# Dann nach dieser Zeile einfuegen (Beispiel: Zeile 107):
sed -i '107a\app.include_router(linbo.router, prefix="/v1")' main.py
```

**Hinweis:** Die genauen Zeilennummern haengen von der Version der linuxmuster-api ab.
Am sichersten ist die manuelle Bearbeitung mit einem Texteditor.

#### Schritt 5: API neu starten

```bash
systemctl restart linuxmuster-api.service

# Status pruefen:
systemctl status linuxmuster-api.service

# Log pruefen (bei Import-Fehlern):
journalctl -u linuxmuster-api.service -n 50 --no-pager
```

### Per PR (fuer Produktion)

Fuer die dauerhafte Integration in das offizielle linuxmuster-api Paket:

#### Schritt 1: Fork erstellen

```bash
# GitHub-Fork von: https://github.com/linuxmuster/linuxmuster-api
git clone https://github.com/<DEIN-USER>/linuxmuster-api.git
cd linuxmuster-api
git checkout -b feature/linbo-docker-sync
```

#### Schritt 2: Dateien einfuegen

```bash
# Router kopieren
cp <pfad>/docs/upstream-pr/linuxmuster-api/routers_v1/linbo.py \
   usr/lib/python3/dist-packages/linuxmusterApi/routers_v1/linbo.py

# Body Schemas erweitern (Models am Ende anfuegen)
cat <pfad>/docs/upstream-pr/linuxmuster-api/body_schemas_patch.py \
   >> usr/lib/python3/dist-packages/linuxmusterApi/routers_v1/body_schemas.py

# main.py erweitern (Import + include_router)
# Manuell bearbeiten -- siehe Schritt 4 oben
```

#### Schritt 3: Commit und PR erstellen

```bash
git add \
  usr/lib/python3/dist-packages/linuxmusterApi/routers_v1/linbo.py \
  usr/lib/python3/dist-packages/linuxmusterApi/routers_v1/body_schemas.py \
  usr/lib/python3/dist-packages/linuxmusterApi/main.py

git commit -m "feat: add LINBO Docker sync endpoints

Add 6 read-only endpoints under /v1/linbo/ for LINBO Docker
sync mode: health, delta-feed, batch hosts, batch startconfs,
batch GRUB configs, and DHCP dnsmasq-proxy export.

Data sources: devices.csv, start.conf.*, boot/grub/*.cfg
Auth: RoleChecker('G') -- global-administrators only"

git push origin feature/linbo-docker-sync
# Dann PR auf GitHub erstellen
```

---

## Docker-Seite konfigurieren

Nachdem die LINBO-Endpoints auf dem LMN-Server laufen, muss LINBO Docker
konfiguriert werden, um diese zu nutzen.

### Methode 1: .env Datei (empfohlen)

Die `.env` Datei im LINBO Docker Projektverzeichnis bearbeiten:

```bash
# Sync aktivieren
SYNC_ENABLED=true

# LMN-API Verbindung (Port 8001 = linuxmuster-api mit JWT)
LMN_API_URL=https://10.0.0.11:8001
LMN_API_USER=global-admin
LMN_API_PASSWORD=<passwort-des-global-admin>

# TLS-Zertifikat des LMN-Servers akzeptieren (selbstsigniert)
NODE_TLS_REJECT_UNAUTHORIZED=0
```

Danach Container neu starten:

```bash
docker compose up -d --build api
```

### Methode 2: Settings API (zur Laufzeit)

Aenderungen ueber die REST-API des LINBO Docker API-Containers:

```bash
# Token holen (LINBO Docker Login):
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Muster!"}' | jq -r .token)

# LMN-API URL setzen:
curl -X PUT http://localhost:3000/api/v1/settings/lmn_api_url \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value":"https://10.0.0.11:8001"}'

# LMN-API Benutzer setzen:
curl -X PUT http://localhost:3000/api/v1/settings/lmn_api_user \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value":"global-admin"}'

# LMN-API Passwort setzen:
curl -X PUT http://localhost:3000/api/v1/settings/lmn_api_password \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value":"geheim"}'

# Sync aktivieren:
curl -X PUT http://localhost:3000/api/v1/settings/sync_enabled \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value":"true"}'
```

### Methode 3: Redis direkt (Debugging)

Fuer schnelle Tests oder Debugging direkt in Redis:

```bash
docker exec linbo-cache redis-cli SET config:lmn_api_url "https://10.0.0.11:8001"
docker exec linbo-cache redis-cli SET config:lmn_api_user "global-admin"
docker exec linbo-cache redis-cli SET config:lmn_api_password "geheim"
docker exec linbo-cache redis-cli SET config:sync_enabled "true"
```

**Hinweis:** Redis-Werte werden durch `.env`-Werte beim Container-Neustart
ueberschrieben, wenn die entsprechende Umgebungsvariable gesetzt ist.

### Methode 4: Legacy Authority API (Port 8400)

Falls die separate Authority API (Python/FastAPI auf Port 8400) genutzt
werden soll statt der offiziellen linuxmuster-api:

```bash
# In .env:
SYNC_ENABLED=true
LMN_API_URL=http://10.0.0.11:8400
LMN_API_KEY=<statischer-bearer-token>
# LMN_API_USER und LMN_API_PASSWORD bleiben leer
```

Der `lmn-api-client.js` erkennt den Modus automatisch anhand des Ports:
- **Port 8001** → JWT-Auth via `/v1/auth/`, Pfad-Prefix `/v1/linbo/`
- **Port 8400** → Statischer Bearer-Token, Pfad-Prefix `/api/v1/linbo/`

---

## Verifizierung

### 1. Health Check (LMN-Server direkt)

```bash
# JWT-Token holen (auf dem LMN-Server oder remote):
TOKEN=$(curl -sk -u "global-admin:PASSWORT" \
  https://10.0.0.11:8001/v1/auth/ | tr -d '"')

# Health Check:
curl -sk -H "X-API-Key: $TOKEN" \
  https://10.0.0.11:8001/v1/linbo/health

# Erwartete Antwort:
# {"status":"ok","devicesCSV":true,"linboDir":true,"startConfs":3,"grubConfigs":3}
```

### 2. Changes (Full Snapshot)

```bash
curl -sk -H "X-API-Key: $TOKEN" \
  "https://10.0.0.11:8001/v1/linbo/changes?since=0"

# Erwartete Antwort:
# {
#   "nextCursor": "1741100000",
#   "hostsChanged": ["AA:BB:CC:DD:EE:FF", ...],
#   "startConfsChanged": ["win11_efi_sata", ...],
#   "configsChanged": ["win11_efi_sata", ...],
#   "dhcpChanged": true,
#   "deletedHosts": [],
#   "deletedStartConfs": [],
#   "allHostMacs": ["AA:BB:CC:DD:EE:FF", ...],
#   "allStartConfIds": ["win11_efi_sata", ...],
#   "allConfigIds": ["win11_efi_sata", ...]
# }
```

### 3. Hosts Batch

```bash
# MAC-Adressen aus der Changes-Antwort verwenden:
curl -sk -X POST -H "X-API-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"macs":["AA:BB:CC:DD:EE:FF"]}' \
  https://10.0.0.11:8001/v1/linbo/hosts:batch

# Erwartete Antwort:
# {
#   "hosts": [{
#     "mac": "AA:BB:CC:DD:EE:FF",
#     "hostname": "pc001",
#     "ip": "10.0.0.100",
#     "room": "raum1",
#     "school": "default-school",
#     "hostgroup": "win11_efi_sata",
#     "pxeEnabled": true,
#     "pxeFlag": 1,
#     "dhcpOptions": "",
#     "startConfId": "win11_efi_sata",
#     "updatedAt": "2026-03-01T12:00:00+00:00"
#   }]
# }
```

### 4. StartConfs Batch

```bash
curl -sk -X POST -H "X-API-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids":["win11_efi_sata"]}' \
  https://10.0.0.11:8001/v1/linbo/startconfs:batch

# Erwartete Antwort:
# {
#   "startConfs": [{
#     "id": "win11_efi_sata",
#     "content": "[LINBO]\nServer = ...\n...",
#     "hash": "a1b2c3d4...",
#     "updatedAt": "2026-03-01T12:00:00+00:00"
#   }]
# }
```

### 5. Configs Batch (GRUB)

```bash
curl -sk -X POST -H "X-API-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids":["win11_efi_sata"]}' \
  https://10.0.0.11:8001/v1/linbo/configs:batch

# Erwartete Antwort:
# {
#   "configs": [{
#     "id": "win11_efi_sata",
#     "content": "# GRUB configuration for win11_efi_sata\n...",
#     "updatedAt": "2026-03-01T12:00:00+00:00"
#   }]
# }
```

### 6. DHCP Export

```bash
curl -sk -H "X-API-Key: $TOKEN" \
  https://10.0.0.11:8001/v1/linbo/dhcp/export/dnsmasq-proxy

# Erwartete Antwort (text/plain):
# #
# # LINBO - dnsmasq Configuration (proxy mode)
# # Generated: 2026-03-04T12:00:00Z
# # Hosts: 28
# #
# port=0
# dhcp-range=10.0.0.0,proxy
# ...
# dhcp-host=AA:BB:CC:DD:EE:FF,set:win11_efi_sata
# ...

# ETag-Header pruefen:
curl -sk -I -H "X-API-Key: $TOKEN" \
  https://10.0.0.11:8001/v1/linbo/dhcp/export/dnsmasq-proxy
# Antwort enthaelt: ETag: "abc123..."
```

### 7. Frontend: Sync triggern

Ueber die LINBO Docker API den Sync manuell ausloesen:

```bash
# LINBO Docker Token holen:
DOCKER_TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Muster!"}' | jq -r .token)

# Sync triggern:
curl -X POST http://localhost:3000/api/v1/sync/trigger \
  -H "Authorization: Bearer $DOCKER_TOKEN"

# Sync-Status pruefen:
curl -H "Authorization: Bearer $DOCKER_TOKEN" \
  http://localhost:3000/api/v1/sync/status
```

Oder im Frontend: Einstellungen → Sync → "Sync jetzt ausloesen".

---

## Konventionen-Unterschiede

Vergleich zwischen der Legacy Authority API (Port 8400) und der neuen
linuxmuster-api Integration (Port 8001):

| Aspekt | Authority API (Port 8400) | linuxmuster-api (Port 8001) |
|--------|---------------------------|----------------------------|
| **Typ** | Separate FastAPI-App | Router in bestehender API |
| **Port** | 8400 | 8001 (HTTPS) |
| **Pfad-Prefix** | `/api/v1/linbo/` | `/v1/linbo/` |
| **Auth-Methode** | Statischer Bearer-Token | JWT via HTTP Basic Auth (`/v1/auth/`) |
| **Auth-Header** | `Authorization: Bearer <token>` | `X-API-Key: <jwt>` |
| **Berechtigungen** | IP-Allowlist + Token | LDAP-Rolle `globaladministrator` |
| **Async** | `async def` (AsyncIO) | `def` (synchron, WSGI) |
| **Delta-Cursor** | `timestamp:sequence` (SQLite) | Unix-Timestamp (file mtimes) |
| **Caching** | In-Memory + SQLite | Kein (mtime bei jedem Request) |
| **File Watcher** | inotify-basiert | Kein (performant fuer <1000 Hosts) |
| **DHCP ETag** | MD5 des Inhalts | MD5 des Inhalts (identisch) |
| **TLS** | Optional (HTTP moeglich) | Immer HTTPS (selbstsigniertes Zert.) |
| **Installation** | Manuelle FastAPI-App | Teil des LMN-Pakets |
| **Pydantic Models** | Eigene Schemas | Erweiterte body_schemas.py |
| **Fehler-Codes** | Standard FastAPI (422, 404) | Standard FastAPI (422, 404) |
| **Rate Limiting** | Kein | Kein |
| **Logging** | Python logging | Python logging (linuxmuster-api) |

### Auto-Erkennung im Docker-Client

Der `lmn-api-client.js` (`containers/api/src/lib/lmn-api-client.js`) erkennt
den Modus automatisch anhand des Ports in `LMN_API_URL`:

```javascript
function _detectMode(baseUrl) {
  const url = new URL(baseUrl);
  if (url.port === '8001') {
    return { pathPrefix: '/v1/linbo', useJwt: true };
  }
  return { pathPrefix: '/api/v1/linbo', useJwt: false };
}
```

- **Port 8001:** JWT-Login via `GET /v1/auth/` mit HTTP Basic Auth, Token wird
  gecacht (1h, 5min Puffer). Auth-Header: `X-API-Key`.
- **Andere Ports:** Statischer Bearer-Token aus `lmn_api_key` Setting.
  Auth-Header: `Authorization: Bearer`.

---

## Datenquellen auf dem LMN-Server

Der LINBO-Router liest folgende Dateien auf dem LMN-Server:

| Dateipfad | Beschreibung | Verwendet von |
|-----------|-------------|---------------|
| `/etc/linuxmuster/sophomorix/default-school/devices.csv` | Host-Liste (Semikolon-getrennt, 15 Spalten) | `_parse_devices_csv()` → `/changes`, `/hosts:batch`, `/dhcp/export` |
| `/srv/linbo/start.conf.*` | start.conf-Dateien pro Gruppe (z.B. `start.conf.win11_efi_sata`) | `_list_startconf_ids()` → `/changes`, `/startconfs:batch` |
| `/srv/linbo/boot/grub/*.cfg` | GRUB-Konfigurationen pro Gruppe (z.B. `win11_efi_sata.cfg`) | `_list_grub_cfg_ids()` → `/changes`, `/configs:batch` |

### devices.csv Spalten-Mapping

Die Datei `devices.csv` wird Semikolon-getrennt gelesen. Relevante Spalten:

| Index | Spalte | Verwendung im Host-Objekt |
|-------|--------|---------------------------|
| 0 | `room` | `room` |
| 1 | `hostname` | `hostname` |
| 2 | `hostgroup` | `hostgroup`, `startConfId` |
| 3 | `mac` | `mac` (normalisiert: Uppercase, Doppelpunkt) |
| 4 | `ip` | `ip` (validiert per Regex) |
| 10 | `pxeFlag` | `pxeFlag`, `pxeEnabled` (> 0 und hostgroup != "nopxe") |

Zeilen, die mit `#` beginnen oder weniger als 5 Felder haben, werden uebersprungen.
Fehlende Spalten werden mit Leerstrings aufgefuellt (bis 15 Spalten).

### Datei-Aenderungserkennung

Der `/changes`-Endpoint nutzt die `mtime` (Modification Time) der Dateien:

1. `since=0` → Vollstaendiger Snapshot aller bekannten Entitaeten
2. `since=<timestamp>` → Nur Dateien, deren mtime neuer als der Cursor ist
3. `nextCursor` = aktuelle Unix-Zeit (`int(time.time())`)

**Einschraenkung:** Da kein inotify oder SQLite verwendet wird, kann es bei
sehr schnellen aufeinanderfolgenden Aenderungen innerhalb derselben Sekunde
vorkommen, dass eine Aenderung verpasst wird. In der Praxis ist dies bei
administrativen Aenderungen (Import-Devices, start.conf-Editor) nicht relevant.

---

## Rollback

Falls Probleme auftreten, koennen die Aenderungen schnell rueckgaengig gemacht werden.

### Backup-Dateien wiederherstellen

```bash
# Auf dem LMN-Server:
cd /usr/lib/python3/dist-packages/linuxmusterApi

# body_schemas.py wiederherstellen:
cp routers_v1/body_schemas.py.bak routers_v1/body_schemas.py

# main.py wiederherstellen:
cp main.py.bak main.py

# linbo.py entfernen:
rm routers_v1/linbo.py

# Python-Cache leeren (wichtig!):
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null

# API neu starten:
systemctl restart linuxmuster-api.service

# Pruefen, dass die API ohne Fehler startet:
systemctl status linuxmuster-api.service
journalctl -u linuxmuster-api.service -n 20 --no-pager
```

### Docker-Seite zuruecksetzen

```bash
# Sync deaktivieren:
# In .env:
SYNC_ENABLED=false

# Container neu starten:
docker compose up -d api

# Oder via Redis:
docker exec linbo-cache redis-cli SET config:sync_enabled "false"
```

### Pruefen, dass alles sauber ist

```bash
# LMN-Server: API-Endpoints auflisten (linbo sollte fehlen):
curl -sk -u "global-admin:PASSWORT" https://10.0.0.11:8001/v1/auth/ | tr -d '"' | \
  xargs -I{} curl -sk -H "X-API-Key: {}" https://10.0.0.11:8001/v1/linbo/health
# Erwartete Antwort: 404 Not Found

# Docker: Sync-Status pruefen (sollte disabled sein):
curl -s http://localhost:3000/api/v1/sync/status | jq .syncEnabled
# Erwartete Antwort: false
```

---

## Haeufige Probleme

### API startet nicht nach Aenderung

```bash
journalctl -u linuxmuster-api.service -n 50 --no-pager
```

Typische Ursachen:
- **ImportError:** `from routers_v1 import linbo` -- Datei fehlt oder Syntax-Fehler
- **ModuleNotFoundError:** `LinboBatchMacs` -- Models nicht in body_schemas.py eingefuegt
- **IndentationError:** Leerzeichen/Tab-Mix in body_schemas.py

### JWT-Login schlaegt fehl

```
lmn_api_user and lmn_api_password required for linuxmuster-api
```

Loesung: `LMN_API_USER` und `LMN_API_PASSWORD` in `.env` setzen oder via
Settings API konfigurieren.

### Selbstsigniertes Zertifikat

```
UNABLE_TO_VERIFY_LEAF_SIGNATURE
```

Loesung: `NODE_TLS_REJECT_UNAUTHORIZED=0` in `.env` setzen (Standard).

### devices.csv nicht gefunden

```json
{"status":"degraded","devicesCSV":false}
```

Loesung: Pfad `/etc/linuxmuster/sophomorix/default-school/devices.csv` pruefen.
Bei Multi-School-Setups ggf. den Pfad in linbo.py anpassen.

### Sync liefert keine Hosts

Pruefen, ob die devices.csv gueltige Eintraege enthaelt:

```bash
# Auf dem LMN-Server:
grep -v "^#" /etc/linuxmuster/sophomorix/default-school/devices.csv | head -5
```

Jede Zeile muss mindestens 5 Semikolon-getrennte Felder haben,
und Spalte 3 (Index 3) muss eine gueltige MAC-Adresse enthalten.
