# linuxmuster-api Integration (LINBO Router)

Die linuxmuster-api ist die offizielle REST-API des linuxmuster.net 7.3 Servers. Sie laeuft als Python/FastAPI-Anwendung auf Port 8001 des LMN-Servers und stellt verschiedene Router bereit (Benutzer, Geraete, Samba, etc.).

Der **LINBO Router** (`/v1/linbo/`) ist ein speziell fuer LINBO Docker entwickelter Erweiterungsrouter. Er bietet einen schreibgeschuetzten, Cursor-basierten Delta-Feed ueber Host-Daten, Start-Konfigurationen, GRUB-Configs und DHCP-Exports. LINBO Docker nutzt diese Endpoints im **Sync-Modus**, um Aenderungen vom LMN-Server automatisch zu uebernehmen, ohne selbst Daten zurueckzuschreiben.

### Wie passt das ins Gesamtbild?

```
LMN-Server (10.0.0.11)           LINBO Docker (10.0.0.13)
========================          ==========================
linuxmuster-api :8001             lmn-api-client.js
  /v1/linbo/*          <------      (HTTP-Client)
                                       |
  devices.csv                     sync.service.js
  start.conf.*                       |
  boot/grub/*.cfg                 Redis-Cache + Frontend
```

LINBO Docker ist **permanent read-only** gegenueber dem LMN-Server. Alle Aenderungen an Hosts, Konfigurationen und Raeumen erfolgen ausschliesslich auf der LMN-Seite (webui7 / `linuxmuster-import-devices`). Docker konsumiert die Daten ueber den Delta-Feed.

---

## Uebersicht

| # | Methode | Pfad | Beschreibung | Auth |
|---|---------|------|-------------|------|
| 1 | `GET` | `/v1/linbo/health` | Subsystem-Healthcheck | `RoleChecker("G")` -- global-administrators |
| 2 | `GET` | `/v1/linbo/changes?since=<cursor>` | Delta-Feed: Aenderungen seit letztem Cursor | `RoleChecker("G")` -- global-administrators |
| 3 | `POST` | `/v1/linbo/hosts:batch` | Batch-Abfrage von Host-Datensaetzen nach MAC | `RoleChecker("G")` -- global-administrators |
| 4 | `POST` | `/v1/linbo/startconfs:batch` | Batch-Abfrage von start.conf-Inhalten | `RoleChecker("G")` -- global-administrators |
| 5 | `POST` | `/v1/linbo/configs:batch` | Batch-Abfrage von GRUB-Konfigurationen | `RoleChecker("G")` -- global-administrators |
| 6 | `GET` | `/v1/linbo/dhcp/export/dnsmasq-proxy` | DHCP-Export fuer dnsmasq Proxy-Modus | `RoleChecker("G")` -- global-administrators |

### Authentifizierung

Alle Endpoints erfordern die Rolle `"G"` (global-administrators). Die Authentifizierung erfolgt ueber die linuxmuster-api JWT-Authentifizierung:

1. **JWT holen:** `GET /v1/auth/` mit HTTP Basic Auth (Benutzername + Passwort)
2. **JWT verwenden:** Header `X-API-Key: <jwt-token>` bei allen nachfolgenden Requests

Der JWT-Token wird vom LINBO Docker API-Client automatisch gecacht und bei Ablauf erneuert (siehe `lmn-api-client.js`).

---

## Endpoint-Details

---

### 1. GET /v1/linbo/health

**Beschreibung:**
Prueft den Zustand der LINBO-Datenquellen auf dem LMN-Server. Wird von LINBO Docker verwendet, um die Erreichbarkeit und Funktionsfaehigkeit der API zu verifizieren, bevor ein Sync gestartet wird.

**Auth:** `RoleChecker("G")` -- nur global-administrators

**Response Format:**

```json
{
  "status": "ok",
  "devicesCSV": true,
  "linboDir": true,
  "startConfs": 5,
  "grubConfigs": 3
}
```

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `status` | `string` | `"ok"` wenn sowohl `devices.csv` als auch `/srv/linbo/` vorhanden sind, sonst `"degraded"` |
| `devicesCSV` | `boolean` | Ob `/etc/linuxmuster/sophomorix/default-school/devices.csv` existiert |
| `linboDir` | `boolean` | Ob `/srv/linbo/` als Verzeichnis existiert |
| `startConfs` | `number` | Anzahl gefundener `start.conf.*`-Dateien in `/srv/linbo/` |
| `grubConfigs` | `number` | Anzahl gefundener `*.cfg`-Dateien in `/srv/linbo/boot/grub/` |

**Curl-Beispiel:**

```bash
# 1. JWT holen
TOKEN=$(curl -s -u "global-admin:Muster!" \
  http://10.0.0.11:8001/v1/auth/ | tr -d '"')

# 2. Health pruefen
curl -s -H "X-API-Key: $TOKEN" \
  http://10.0.0.11:8001/v1/linbo/health | jq .
```

---

### 2. GET /v1/linbo/changes?since=\<cursor\>

**Beschreibung:**
Cursor-basierter Delta-Feed. Erkennt Aenderungen anhand der Datei-Modifikationszeiten (mtime) von `devices.csv`, `start.conf.*` und GRUB `*.cfg` Dateien. Dies ist der zentrale Endpoint fuer den Sync-Modus -- LINBO Docker ruft ihn periodisch auf, um zu erfahren, welche Daten sich geaendert haben.

**Auth:** `RoleChecker("G")` -- nur global-administrators

**Query-Parameter:**

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|-------------|-------------|
| `since` | `string` | Nein (Default: `"0"`) | Unix-Timestamp als Cursor. `"0"` oder leer = Full Snapshot (alle Entitaeten). Wert aus `nextCursor` einer vorherigen Response fuer inkrementelle Updates. |

**Wie der Cursor funktioniert:**

1. **Erster Aufruf:** `since=0` oder ohne Parameter → Full Snapshot. Alle bekannten Hosts, Start-Konfigurationen und GRUB-Configs werden als "geaendert" zurueckgegeben.
2. **Folge-Aufrufe:** `since=<nextCursor>` aus der vorherigen Response → Nur Dateien, deren mtime neuer als der Cursor ist, werden als geaendert gemeldet.
3. **Loeschungserkennung:** Die `allHostMacs`, `allStartConfIds` und `allConfigIds` Listen enthalten immer ALLE aktuell bekannten IDs. Der Client kann durch Vergleich mit seinem lokalen Bestand geloeschte Eintraege erkennen.
4. **Cursor-Format:** Der `nextCursor` ist immer ein Unix-Timestamp (Sekunden seit Epoch) als String, z.B. `"1709568000"`.

**Response Format:**

```json
{
  "nextCursor": "1709568000",
  "hostsChanged": ["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"],
  "startConfsChanged": ["pc_still", "lehrerzimmer"],
  "configsChanged": ["pc_still"],
  "dhcpChanged": true,
  "deletedHosts": [],
  "deletedStartConfs": [],
  "allHostMacs": ["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66", "77:88:99:AA:BB:CC"],
  "allStartConfIds": ["pc_still", "lehrerzimmer", "nopxe"],
  "allConfigIds": ["pc_still", "lehrerzimmer"]
}
```

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `nextCursor` | `string` | Unix-Timestamp fuer den naechsten Aufruf |
| `hostsChanged` | `string[]` | MAC-Adressen der Hosts, deren Daten sich geaendert haben (bei Full Snapshot: alle MACs) |
| `startConfsChanged` | `string[]` | IDs der start.conf-Dateien mit neuerem mtime als der Cursor |
| `configsChanged` | `string[]` | IDs der GRUB-Config-Dateien mit neuerem mtime als der Cursor |
| `dhcpChanged` | `boolean` | `true` wenn sich die devices.csv geaendert hat (DHCP-Export muss neu abgerufen werden) |
| `deletedHosts` | `string[]` | MACs von geloeschten Hosts (derzeit immer leer -- Loeschung via `allHostMacs`-Vergleich) |
| `deletedStartConfs` | `string[]` | IDs von geloeschten Start-Konfigurationen (derzeit immer leer -- Loeschung via `allStartConfIds`-Vergleich) |
| `allHostMacs` | `string[]` | Vollstaendige Liste aller aktuell bekannten Host-MACs |
| `allStartConfIds` | `string[]` | Vollstaendige Liste aller aktuell vorhandenen start.conf-Gruppen |
| `allConfigIds` | `string[]` | Vollstaendige Liste aller aktuell vorhandenen GRUB-Config-Gruppen |

**Curl-Beispiel:**

```bash
# Full Snapshot (erster Sync)
curl -s -H "X-API-Key: $TOKEN" \
  "http://10.0.0.11:8001/v1/linbo/changes?since=0" | jq .

# Inkrementelles Update (Cursor aus vorheriger Response)
curl -s -H "X-API-Key: $TOKEN" \
  "http://10.0.0.11:8001/v1/linbo/changes?since=1709568000" | jq .
```

---

### 3. POST /v1/linbo/hosts:batch

**Beschreibung:**
Gibt Host-Datensaetze fuer eine Liste von MAC-Adressen zurueck. Die Daten stammen aus der `devices.csv` des LMN-Servers. LINBO Docker ruft diesen Endpoint nach einem `/changes`-Aufruf auf, um die Details der geaenderten Hosts abzurufen.

**Auth:** `RoleChecker("G")` -- nur global-administrators

**Datenquelle:** `/etc/linuxmuster/sophomorix/default-school/devices.csv`

Die devices.csv ist semikolon-getrennt mit folgenden Spalten:
```
room;hostname;hostgroup;mac;ip;...;sophomorixRole;...;pxeFlag;...
```

**Request Body:**

```json
{
  "macs": ["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"]
}
```

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `macs` | `string[]` | Liste von MAC-Adressen (max. 500 pro Request). Format: `XX:XX:XX:XX:XX:XX` oder `XX-XX-XX-XX-XX-XX` |

**Response Format (200 OK):**

```json
{
  "hosts": [
    {
      "mac": "AA:BB:CC:DD:EE:FF",
      "hostname": "pc100",
      "ip": "10.0.0.100",
      "room": "r100",
      "school": "default-school",
      "hostgroup": "pc_still",
      "pxeEnabled": true,
      "pxeFlag": 1,
      "dhcpOptions": "",
      "startConfId": "pc_still",
      "updatedAt": "2025-03-04T10:30:00+00:00"
    }
  ]
}
```

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `mac` | `string` | MAC-Adresse (normalisiert, Grossbuchstaben, Doppelpunkt-getrennt) |
| `hostname` | `string` | Hostname des Geraets |
| `ip` | `string\|null` | IP-Adresse (null wenn ungueltig oder leer) |
| `room` | `string` | Raum-Zuordnung |
| `school` | `string` | Immer `"default-school"` |
| `hostgroup` | `string` | Hardwareklasse/Hostgruppe (entspricht dem start.conf-Gruppennamen) |
| `pxeEnabled` | `boolean` | `true` wenn `pxeFlag > 0` UND Hostgruppe nicht `"nopxe"` |
| `pxeFlag` | `number` | PXE-Flag-Wert aus devices.csv (Standard: 1) |
| `dhcpOptions` | `string` | Zusaetzliche DHCP-Optionen (derzeit immer leer) |
| `startConfId` | `string` | ID der zugehoerigen start.conf (= hostgroup) |
| `updatedAt` | `string\|null` | ISO-8601-Timestamp der letzten Aenderung der devices.csv |

**Fehler-Responses:**

| Status | Beschreibung |
|--------|-------------|
| `400` | Mehr als 500 MACs im Request |
| `404` | devices.csv nicht gefunden/leer ODER keine Hosts fuer die angegebenen MACs gefunden |

**Curl-Beispiel:**

```bash
curl -s -X POST \
  -H "X-API-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"macs": ["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"]}' \
  http://10.0.0.11:8001/v1/linbo/hosts:batch | jq .
```

---

### 4. POST /v1/linbo/startconfs:batch

**Beschreibung:**
Gibt den Inhalt von `start.conf`-Dateien fuer eine Liste von Gruppen-IDs zurueck. Die Dateien liegen als `start.conf.<group>` in `/srv/linbo/`. Jede Response enthaelt den rohen Dateiinhalt, einen SHA-256-Hash und den Modifikations-Timestamp.

**Auth:** `RoleChecker("G")` -- nur global-administrators

**Datenquelle:** `/srv/linbo/start.conf.<group>` (z.B. `/srv/linbo/start.conf.pc_still`)

**Request Body:**

```json
{
  "ids": ["pc_still", "lehrerzimmer"]
}
```

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `ids` | `string[]` | Liste von Gruppen-IDs (max. 100 pro Request) |

**Response Format (200 OK):**

```json
{
  "startConfs": [
    {
      "id": "pc_still",
      "content": "[LINBO]\nServer = 10.0.0.1\nGroup = pc_still\n...",
      "hash": "a1b2c3d4e5f6...64-stelliger-sha256-hash",
      "updatedAt": "2025-03-04T10:30:00+00:00"
    }
  ]
}
```

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `id` | `string` | Gruppen-ID (entspricht dem Dateinamen ohne `start.conf.`-Praefix) |
| `content` | `string` | Vollstaendiger Dateiinhalt der start.conf als UTF-8-String |
| `hash` | `string` | SHA-256-Hash des Dateiinhalts (64 Hex-Zeichen) |
| `updatedAt` | `string\|null` | ISO-8601-Timestamp der Datei-mtime |

**Fehler-Responses:**

| Status | Beschreibung |
|--------|-------------|
| `400` | Mehr als 100 IDs im Request |
| `404` | Keine der angegebenen IDs hat eine zugehoerige start.conf-Datei |

**Curl-Beispiel:**

```bash
curl -s -X POST \
  -H "X-API-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids": ["pc_still", "lehrerzimmer"]}' \
  http://10.0.0.11:8001/v1/linbo/startconfs:batch | jq .
```

---

### 5. POST /v1/linbo/configs:batch

**Beschreibung:**
Gibt den Inhalt von GRUB-Konfigurationsdateien fuer eine Liste von Gruppen-IDs zurueck. Die Dateien liegen als `<group>.cfg` in `/srv/linbo/boot/grub/`. Jede Response enthaelt den rohen Dateiinhalt und den Modifikations-Timestamp.

**Auth:** `RoleChecker("G")` -- nur global-administrators

**Datenquelle:** `/srv/linbo/boot/grub/<group>.cfg` (z.B. `/srv/linbo/boot/grub/pc_still.cfg`)

**WICHTIG:** Neue Gruppen, die zwar eine `start.conf` haben aber noch keine Hosts besitzen, haben moeglicherweise noch keine GRUB-Config. In diesem Fall gibt der Endpoint `404` zurueck, wenn KEINE der angefragten IDs eine GRUB-Config hat. Der LINBO Docker Sync-Client muss diesen 404 als "noch keine Configs vorhanden" behandeln, nicht als Fehler.

**Request Body:**

```json
{
  "ids": ["pc_still", "lehrerzimmer"]
}
```

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `ids` | `string[]` | Liste von Gruppen-IDs (max. 100 pro Request) |

**Response Format (200 OK):**

```json
{
  "configs": [
    {
      "id": "pc_still",
      "content": "# GRUB configuration for group pc_still\nset default=0\n...",
      "updatedAt": "2025-03-04T10:30:00+00:00"
    }
  ]
}
```

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `id` | `string` | Gruppen-ID (entspricht dem Dateinamen ohne `.cfg`-Endung) |
| `content` | `string` | Vollstaendiger Dateiinhalt der GRUB-Config als UTF-8-String |
| `updatedAt` | `string\|null` | ISO-8601-Timestamp der Datei-mtime |

**Fehler-Responses:**

| Status | Beschreibung |
|--------|-------------|
| `400` | Mehr als 100 IDs im Request |
| `404` | Keine der angegebenen IDs hat eine zugehoerige GRUB-Config-Datei |

**Curl-Beispiel:**

```bash
curl -s -X POST \
  -H "X-API-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids": ["pc_still", "lehrerzimmer"]}' \
  http://10.0.0.11:8001/v1/linbo/configs:batch | jq .
```

---

### 6. GET /v1/linbo/dhcp/export/dnsmasq-proxy

**Beschreibung:**
Generiert eine vollstaendige dnsmasq-Konfigurationsdatei fuer den Proxy-DHCP-Modus. Die Konfiguration enthaelt alle PXE-faehigen Hosts aus der `devices.csv` mit ihren MAC-Adressen und Hostgruppen-Zuordnungen. LINBO Docker nutzt diesen Export, um seinen optionalen DHCP-Container zu konfigurieren.

Der Endpoint unterstuetzt **ETag-basiertes Caching**: Bei unveraenderter Konfiguration kann der Client mit dem `If-None-Match`-Header eine `304 Not Modified`-Response erhalten, ohne den gesamten Inhalt erneut zu uebertragen.

**Auth:** `RoleChecker("G")` -- nur global-administrators

**Datenquelle:** `/etc/linuxmuster/sophomorix/default-school/devices.csv` (nur Hosts mit `pxeEnabled = true`)

**Response Format (200 OK):**

```
Content-Type: text/plain
ETag: "a1b2c3d4e5f6..."
Last-Modified: Tue, 04 Mar 2025 10:30:00 GMT
```

```
#
# LINBO - dnsmasq Configuration (proxy mode)
# Generated: 2025-03-04T10:30:00Z
# Hosts: 28
#

# Proxy DHCP mode - no IP assignment, PXE only
port=0
dhcp-range=10.0.0.0,proxy
log-dhcp

interface=eth0
bind-interfaces

# PXE boot architecture detection
dhcp-match=set:bios,option:client-arch,0
dhcp-match=set:efi32,option:client-arch,6
dhcp-match=set:efi64,option:client-arch,7
dhcp-match=set:efi64,option:client-arch,9

dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,10.0.0.1
dhcp-boot=tag:efi32,boot/grub/i386-efi/core.efi,10.0.0.1
dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,10.0.0.1

# Host config assignments
dhcp-host=AA:BB:CC:DD:EE:FF,set:pc_still
dhcp-host=11:22:33:44:55:66,set:pc_still

# Config name via NIS-Domain (Option 40)
dhcp-option=tag:pc_still,40,pc_still
```

**ETag / Conditional GET:**

| Request-Header | Beschreibung |
|----------------|-------------|
| `If-None-Match: "<etag>"` | ETag aus einer vorherigen Response. Wenn der Inhalt identisch ist, antwortet der Server mit `304 Not Modified`. |

| Response-Status | Beschreibung |
|----------------|-------------|
| `200 OK` | Konfiguration hat sich geaendert (oder erster Abruf). Body enthaelt die vollstaendige dnsmasq-Config. |
| `304 Not Modified` | Konfiguration ist unveraendert. Kein Body. Der Client kann seine gecachte Version weiter verwenden. |
| `404 Not Found` | devices.csv nicht gefunden oder leer |

**Curl-Beispiele:**

```bash
# Erster Abruf (kein ETag)
curl -s -D- -H "X-API-Key: $TOKEN" \
  http://10.0.0.11:8001/v1/linbo/dhcp/export/dnsmasq-proxy

# Folgender Abruf mit ETag (Conditional GET)
curl -s -D- -H "X-API-Key: $TOKEN" \
  -H 'If-None-Match: "a1b2c3d4e5f6..."' \
  http://10.0.0.11:8001/v1/linbo/dhcp/export/dnsmasq-proxy
# -> 304 Not Modified (wenn unveraendert)
```

---

## LINBO Docker Client-Implementierung

Die Datei `containers/api/src/lib/lmn-api-client.js` implementiert den HTTP-Client, der diese Endpoints aufruft. Wichtige Eigenschaften:

### Auto-Detection des API-Modus

Der Client erkennt automatisch anhand des Ports, welche API verwendet wird:

| Port | API | Auth-Methode | Pfad-Praefix |
|------|-----|-------------|-------------|
| `8001` | linuxmuster-api | JWT via HTTP Basic Auth + `X-API-Key` Header | `/v1/linbo` |
| `8400` | Legacy Authority API | Statischer Bearer Token | `/api/v1/linbo` |

### Retry-Logik

- **Max. 3 Versuche** mit exponentiellem Backoff (500ms, 1s, 2s)
- **4xx-Fehler** (ausser 429): Kein Retry, sofortige Rueckgabe
- **429 / 5xx-Fehler**: Retry mit Backoff
- **401 bei JWT-Modus**: Token-Cache wird geleert, neuer Token wird geholt (einmalig)
- **Timeout:** 10 Sekunden pro Request

### Konfiguration

Die Verbindungsdaten werden ueber den Settings-Service gelesen:

| Setting | Beschreibung |
|---------|-------------|
| `lmn_api_url` | Basis-URL der API (z.B. `http://10.0.0.11:8001`) |
| `lmn_api_user` | Benutzername fuer JWT-Auth (Port 8001) |
| `lmn_api_password` | Passwort fuer JWT-Auth (Port 8001) |
| `lmn_api_key` | Statischer API-Key (Port 8400, Legacy) |

### Client-Funktionen

| Funktion | Endpoint | Beschreibung |
|----------|----------|-------------|
| `checkHealth()` | `GET /health` | Prueft Erreichbarkeit, gibt `{ healthy, status }` zurueck |
| `getChanges(cursor)` | `GET /changes?since=` | Delta-Feed abrufen |
| `batchGetHosts(macs)` | `POST /hosts:batch` | Host-Details nach MAC-Adressen |
| `batchGetStartConfs(ids)` | `POST /startconfs:batch` | start.conf-Inhalte nach Gruppen-ID |
| `batchGetConfigs(ids)` | `POST /configs:batch` | GRUB-Config-Inhalte nach Gruppen-ID |
| `getDhcpExport(etag)` | `GET /dhcp/export/dnsmasq-proxy` | DHCP-Config mit ETag-Support |
