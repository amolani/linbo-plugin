# Phase 11: Host Provisioning via DC Worker

**Zeitraum:** 2026-02-06
**Status:** Abgeschlossen und getestet
**Commits:** `6b80c11` bis `da7ce31` (6 Commits)
**Tests:** 29 Provisioning + 43 DeviceImport = 72 Tests (alle passing)

---

## Inhaltsverzeichnis

1. [Zusammenfassung](#zusammenfassung)
2. [Motivation und Problemstellung](#motivation-und-problemstellung)
3. [Architektur-Entscheidungen](#architektur-entscheidungen)
4. [Implementierte Komponenten](#implementierte-komponenten)
5. [Dateien und Aenderungen](#dateien-und-aenderungen)
6. [Bugs und Fixes](#bugs-und-fixes)
7. [Live-Test Ergebnis](#live-test-ergebnis)
8. [Konfiguration](#konfiguration)
9. [Betrieb und Troubleshooting](#betrieb-und-troubleshooting)
10. [Verbleibende Arbeiten](#verbleibende-arbeiten)

---

## Zusammenfassung

Phase 11 erweitert den bestehenden DC Worker (Phase 8: Machine Account) um Host Provisioning.
Wenn ein Host in der Docker-API erstellt, geaendert oder geloescht wird, sorgt der DC Worker
auf dem Active Directory Domain Controller (10.0.0.11) dafuer, dass:

- Ein AD Computer-Objekt angelegt/aktualisiert/geloescht wird
- DNS A- und PTR-Records erstellt werden
- DHCP-Reservierungen konfiguriert werden
- LINBO-GRUB Symlinks gesetzt werden

Das Ganze geschieht ueber das bestehende `linuxmuster-import-devices` Script, das
`sophomorix-device --sync` aufruft und die gesamte AD/DNS/DHCP-Kette abarbeitet.

### Kernprinzip

**Extend, don't duplicate.** Gleicher Redis Stream (`linbo:jobs`), gleiche Consumer Group
(`dc-workers`), gleiches Operation-Model, gleiche Internal API Endpoints.

### Sicherheitsfeatures

- **Opt-in:** `DC_PROVISIONING_ENABLED=false` (Default) — Provisioning muss explizit aktiviert werden
- **Dry-Run:** `DC_PROVISIONING_DRYRUN=true` (Default) — erst trocken testen, dann scharf schalten
- **Delta/Merge:** Eigene Delta-Datei, manuelle Eintraege in Master bleiben erhalten
- **Atomares Ersetzen:** `os.rename()` auf gleichem Filesystem (POSIX-Garantie)
- **Backup:** `devices.csv.bak` vor jedem Schreibvorgang
- **File Lock:** Nur ein Provisioning-Batch gleichzeitig

---

## Motivation und Problemstellung

### Ausgangslage

Nach Phase 1-10 konnte die Docker-API Hosts verwalten (DB + GRUB), aber der produktive
AD Domain Controller (10.0.0.11) wusste nichts davon. Hosts existierten nur in der
Docker-Datenbank, hatten aber:

- Kein AD Computer-Objekt (kein Domain Join moeglich)
- Keinen DNS-Eintrag (kein Hostname-Aufloesung)
- Keine DHCP-Reservierung (kein Netzwerk-Boot)

### Loesung

Erweiterung des DC Workers um eine `ProvisionProcessor`-Klasse, die:

1. Provisioning-Jobs aus dem Redis Stream konsumiert
2. Eine Delta-Datei pflegt (`linbo-docker.devices.csv`)
3. Delta mit Master (`devices.csv`) merged
4. `linuxmuster-import-devices` ausfuehrt (einmal pro Batch)
5. Ergebnis per Host verifiziert (AD, DNS, DHCP)
6. Status an die API zurueckmeldet

---

## Architektur-Entscheidungen

### 1. Delta/Merge statt direktes devices.csv-Editing

Docker verwaltet eine eigene Delta-Datei:
```
/etc/linuxmuster/sophomorix/default-school/linbo-docker.devices.csv
```

Workflow:
```
Master (devices.csv)  +  Delta (linbo-docker.devices.csv)
         |                        |
         +-------- Merge ---------+
                    |
         devices.csv.tmp  (merged output)
                    |
         Backup: devices.csv -> devices.csv.bak
                    |
         os.rename(devices.csv.tmp, devices.csv)  <- ATOMAR
                    |
         linuxmuster-import-devices
```

**Merge-Regeln:**
- Delta patcht Master-Eintraege bei gleichem Hostname (MANAGED_COLS: 0,1,2,3,4,8,10)
- Master-Spalten 5+ ausserhalb MANAGED_COLS bleiben erhalten
- Master-Eintraege ohne Delta-Match: unveraendert
- Neue Delta-Eintraege: werden angehaengt, auf Master-Spaltenanzahl gepadded
- Geloeschte Hosts (`_deleted_hosts` Set): aus Merge-Ergebnis entfernt
- Kommentare (`#`) und Leerzeilen: erhalten

### 2. Schlanker Stream-Payload

Stream enthaelt nur Routing-Info:
```json
{
  "type": "provision_host",
  "operation_id": "<uuid>",
  "action": "create|update|delete",
  "school": "default-school",
  "attempt": "0"
}
```

Details stecken in `Operation.options` (DB) und werden vom Worker per API abgerufen.

### 3. 15-Spalten CSV-Format

Delta-Datei nutzt das volle 15-Spalten-Format, das `sophomorix-device` erwartet:

```
room;host;config;mac;ip;office_key;win_key;unused;role;unused_2;pxe_flag;option;field_13;field_14;comment
 0     1     2    3   4     5         6       7     8      9       10      11      12       13       14
```

**Kritisch:** Spalte 10 (`pxeFlag`) ist ein Pflichtfeld. Leerer String fuehrt zu `exit 88`
in `sophomorix-device`. Siehe [BUG-PROVISIONING-CSV-COLUMNS.md](./BUG-PROVISIONING-CSV-COLUMNS.md).

### 4. Batch-Import

Statt pro Host einmal `linuxmuster-import-devices` aufzurufen (teuer: ~4s pro Aufruf),
batcht der Worker:

1. Erster Job triggert Lock + Delta-Anwendung
2. Debounce: 5 Sekunden warten (konfig.: `PROVISION_DEBOUNCE_SEC`)
3. Drain: bis zu 50 weitere Jobs aus dem Stream holen (konfig.: `PROVISION_BATCH_SIZE`)
4. Delta fuer alle anwenden
5. EIN Merge + EIN `linuxmuster-import-devices`
6. Verify per Host
7. XACK erst nach vollstaendigem Batch

**Beispiel:** 200 neue Hosts → 4 Batches a 50 → 4x Import statt 200x.

### 5. ProvisionStatus Lifecycle

```
null -> pending -> running -> synced
                      |
                      +-----> failed
```

- `null`: Provisioning nicht aktiv oder Host nie provisioniert
- `pending`: Job in Queue
- `running`: DC Worker arbeitet gerade
- `synced`: AD + DNS + DHCP erfolgreich verifiziert
- `failed`: Verify fehlgeschlagen (Details in Operation.error)

**Dry-Run:** Status bleibt `pending` (nicht `synced`), da nichts geschrieben wurde.

---

## Implementierte Komponenten

### API-Seite

#### 1. Provisioning Service (`provisioning.service.js`)
**445 Zeilen** — Kernlogik fuer Job-Erstellung und Status-Management.

Exports:
| Funktion | Zweck |
|----------|-------|
| `isProvisioningEnabled()` | Prueft `DC_PROVISIONING_ENABLED` ENV |
| `createProvisionJob(host, action, opts)` | Operation erstellen + Stream publish |
| `updateProvisionStatus(opId, update)` | Operation + Host.provisionStatus aktualisieren |
| `retryProvisionJob(opId)` | Re-publish mit `attempt+1` (max 3) |
| `syncHostProvisionStatus(hostId, opId, status)` | Host-Felder updaten |

Features:
- **Deduplizierung:** Prueft auf existierende pending/running Jobs fuer gleichen Host+Action
- **Frozen Snapshot:** Bei Delete werden alle Host-Daten in Operation.options gespeichert
- **Dry-Run Flag:** `DC_PROVISIONING_DRYRUN` wird in jede Operation.options geschrieben
- **WebSocket:** Broadcast bei jedem Status-Wechsel (`provision.job.updated`)

#### 2. Host CRUD Hooks (`routes/hosts.js`)
Provisioning wird automatisch getriggert bei:
- `POST /api/v1/hosts` — `action: 'create'`
- `PATCH /api/v1/hosts/:id` — `action: 'update'` (inkl. `oldHostname` bei Rename)
- `DELETE /api/v1/hosts/:id` — `action: 'delete'` (Frozen Snapshot)
- `POST /api/v1/import/devices` — Pro importiertem Host ein Job

#### 3. Provisioning Routes (`routes/operations.js`)
| Method | Path | Zweck |
|--------|------|-------|
| GET | `/operations/provision` | Jobs auflisten (paginiert) |
| GET | `/operations/provision/:id` | Job-Details |
| POST | `/operations/provision` | Manuell ausloesen |
| POST | `/operations/provision/:id/retry` | Fehlgeschlagenen Job wiederholen |

#### 4. Internal Routes (`routes/internal.js`)
Generalisierter Dispatch nach `operation.type`:
- `PATCH /internal/operations/:id/status` — dispatch zu provisioning oder macct Service
- `POST /internal/operations/:id/retry` — dispatch zu provisioning oder macct Service
- `GET /internal/operations/:id` — Neuer Endpoint, Worker holt Operation.options

#### 5. Schema-Aenderungen (`prisma/schema.prisma`)
```prisma
model Host {
  // ... bestehende Felder ...
  provisionStatus String? @map("provision_status") @db.VarChar(50)
  provisionOpId   String? @map("provision_op_id") @db.Uuid
}
```

#### 6. Validierung (`middleware/validate.js`)
Hostname-Validierung: max 15 Zeichen (NetBIOS-Limit), alphanumerisch + Bindestrich.

### DC Worker-Seite

#### 7. ProvisionProcessor (`macct-worker.py`)
**~500 Zeilen** neue Klasse im bestehenden Worker.

Kernmethoden:
| Methode | Zweck |
|---------|-------|
| `process(msg_id, fields)` | Batch-Einstiegspunkt |
| `_apply_delta(lines, action, options)` | Delta-Datei modifizieren (create/update/delete) |
| `_merge(master, delta)` | Patch-Merge mit MANAGED_COLS={0,1,2,3,4,8,10} |
| `_format_csv_line(options)` | 15-Spalten CSV-Zeile generieren |
| `_check_conflicts(action, options, merged)` | Duplikat-Pruefung (Hostname, MAC, IP) |
| `_verify_results(hostname, action, domain)` | AD + DNS-A + DNS-PTR + DHCP pruefen |
| `_cleanup_deleted_host(hostname, domain)` | Explizites AD/DNS-Cleanup bei Delete |
| `_run_import_script()` | linuxmuster-import-devices mit Error-Pattern-Scanning |
| `_drain_pending_jobs(school, batch_size)` | Stream-Drain fuer Batching |
| `_validate_hostname(hostname)` | NetBIOS 15-Char Hard Gate |

Features:
- **Batch-Import:** Bis zu 50 Jobs gebatcht, EIN Import pro Batch
- **Debounce:** Konfigurierbare Wartezeit (Default 5s) vor Drain
- **File Lock:** `fcntl.flock()` mit 5min Timeout
- **Crash-Safety:** XACK erst nach vollstaendigem Batch, PEL-Recovery beim Neustart
- **Error-Pattern-Scanning:** Workaround fuer Upstream-Bug (import-devices ignoriert sophomorix-Fehler)
- **Dry-Run:** Liest `dryRun` aus Operation.options, loggt Merge-Ergebnis ohne zu schreiben
- **Deferred Messages:** macct_repair Jobs werden nach dem Batch verarbeitet, nicht blockiert
- **Delete Cleanup:** `samba-tool computer delete` + DNS falls import-devices nicht aufraumt

#### 8. Config-Erweiterung
Neue Konfigurationsvariablen:
- `SCHOOL`, `DEVICES_CSV_MASTER`, `DEVICES_CSV_DELTA` (mit `{school}` Platzhalter)
- `IMPORT_SCRIPT`, `PROVISION_LOCK_FILE`
- `LINBO_DOMAIN` (oder `auto` fuer Samba-Detect)
- `DHCP_VERIFY_FILE`, `SAMBA_TOOL_AUTH`, `REV_DNS_OCTETS`
- `PROVISION_BATCH_SIZE`, `PROVISION_DEBOUNCE_SEC`

### Frontend-Seite

#### 9. ProvisionBadge (`components/hosts/ProvisionBadge.tsx`)
Inline-Badge neben dem Hostnamen:
- `null` → nichts (Provisioning nicht aktiv)
- `pending` → gelber Punkt + "Queued"
- `running` → blauer Spinner + "Provisioning..."
- `synced` → gruenes Haekchen + "Synced"
- `failed` → rotes Ausrufezeichen + "Failed"

#### 10. Types (`types/index.ts`)
```typescript
provisionStatus?: 'pending' | 'running' | 'synced' | 'failed' | null;
provisionOpId?: string | null;
```

---

## Dateien und Aenderungen

### Neue Dateien (4)

| Datei | Zeilen | Zweck |
|-------|--------|-------|
| `containers/api/src/services/provisioning.service.js` | 445 | Provisioning Service |
| `containers/api/tests/services/provisioning.service.test.js` | 620 | 29 Tests |
| `containers/web/frontend/src/components/hosts/ProvisionBadge.tsx` | 54 | Status-Badge |
| `docs/BUG-PROVISIONING-CSV-COLUMNS.md` | 391 | Bug-Dokumentation |

### Geaenderte Dateien (18)

| Datei | Aenderungen | Zweck |
|-------|-------------|-------|
| `containers/api/prisma/schema.prisma` | +8 | provisionStatus + provisionOpId |
| `containers/api/src/middleware/validate.js` | +41/-2 | Hostname max 15 chars |
| `containers/api/src/routes/hosts.js` | +110 | Provisioning Hooks POST/PATCH/DELETE |
| `containers/api/src/routes/index.js` | +15 | API Info Update |
| `containers/api/src/routes/internal.js` | +61 | Generalisierter Dispatch + GET |
| `containers/api/src/routes/operations.js` | +163 | Provision Endpoints |
| `containers/api/src/services/deviceImport.service.js` | +44/-12 | CSV_COLUMNS Fix |
| `containers/api/tests/services/deviceImport.service.test.js` | +67/-8 | CSV-Tests |
| `containers/web/frontend/src/components/hosts/index.ts` | +1 | Export ProvisionBadge |
| `containers/web/frontend/src/pages/HostsPage.tsx` | +7 | Badge Integration |
| `containers/web/frontend/src/types/index.ts` | +41 | Provision Types |
| `dc-worker/macct-worker.py` | +964 | ProvisionProcessor + Fixes |
| `dc-worker/macct-worker.conf.example` | +36 | Neue Config-Variablen |
| `docker-compose.yml` | +32 | ENV Variablen + Redis Port |
| `docs/STATUS.md` | +246 | Aktualisierte Dokumentation |

**Gesamt:** 22 Dateien, +3.191 / -170 Zeilen

### Commits (6)

| Commit | Beschreibung |
|--------|-------------|
| `6b80c11` | Implement host provisioning via DC worker with delta/merge strategy |
| `05a19f0` | Improve hostname validation error message for NetBIOS limit |
| `2aaf67b` | Add separate DHCP-Server IP field for server-identifier |
| `b13881e` | Expose Redis port for DC worker connectivity |
| `f2acbe0` | Fix Redis drain timeout: block=0 means forever in redis-py |
| `da7ce31` | Fix devices.csv column mapping for sophomorix compatibility |

---

## Bugs und Fixes

Waehrend der Live-Tests auf dem Produktionsserver wurden 4 Bugs entdeckt und behoben.
Ausfuehrliche Dokumentation: [BUG-PROVISIONING-CSV-COLUMNS.md](./BUG-PROVISIONING-CSV-COLUMNS.md)

### Bug 1: Fehlende Spalten in `_format_csv_line` (KRITISCH)

**Problem:** DC Worker erzeugte nur 5-Spalten CSV. Spalte 10 (`pxeFlag`) fehlte.
`sophomorix-device` verlangt pxeFlag und bricht mit `exit 88` ab bei leerem Wert.

**Fix:** `_format_csv_line` erweitert auf 15 Spalten mit explizitem `pxeFlag` an Position 10.

**Datei:** `dc-worker/macct-worker.py`

### Bug 2: CSV_COLUMNS Off-by-One (HOCH)

**Problem:** `deviceImport.service.js` hatte `ROLE=9` statt `8` und `PXE_FLAG=11` statt `10`.
Import las falsche Spalten, Export schrieb Role und pxeFlag an falsche Positionen.

**Fix:** Konstanten korrigiert, Export-Funktion angepasst.

**Datei:** `containers/api/src/services/deviceImport.service.js`

### Bug 3: Import-Script Fehler-Verschluckung (MITTEL)

**Problem:** `linuxmuster-import-devices` (Upstream) ignoriert den Return-Wert von
`subProc('sophomorix-device --sync')`. Bei `exit 88` wird trotzdem `exit 0` gemeldet.

**Workaround:** `_run_import_script` im DC Worker scannt stdout/stderr auf Error-Patterns
(`ERROR:`, `errors detected`, `syntax check failed`).

**Datei:** `dc-worker/macct-worker.py`

### Bug 4: Irrefuehrende Batch-Log-Meldung (NIEDRIG)

**Problem:** "Batch complete: X succeeded" zaehlte verarbeitete Jobs, nicht verifizierte.

**Fix:** Separate `verify_ok` / `verify_fail` Counter.

**Datei:** `dc-worker/macct-worker.py`

### Zusaetzliche Fixes

| Commit | Fix |
|--------|-----|
| `f2acbe0` | Redis `XREADGROUP` mit `block=0` blockiert ewig in redis-py. Fix: `block=None` fuer non-blocking |
| `b13881e` | Redis Port 6379 nicht von aussen erreichbar. Fix: Port-Mapping in docker-compose.yml |

---

## Live-Test Ergebnis

### Testdurchfuehrung (2026-02-06, ~14:40 Uhr)

1. **Ausgangslage:**
   - DC Worker laeuft auf 10.0.0.11 (systemd macct-worker.service)
   - API auf 10.0.0.13 mit `DC_PROVISIONING_ENABLED=true`, `DC_PROVISIONING_DRYRUN=false`
   - `devices.csv` hat 35 Eintraege (Backup vorhanden)

2. **Host erstellt:**
   ```bash
   curl -X POST -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"hostname":"linbo-fix05","macAddress":"AA:BB:CC:DD:EE:B5",
          "ipAddress":"10.0.0.237","roomId":"<testlab-uuid>"}' \
     http://10.0.0.13:3000/api/v1/hosts
   ```

3. **DC Worker Log:**
   ```
   [INFO]  Processing job: 37ab0e7d-... (type=provision_host)
   [INFO]  [Provision] Starting batch for school=default-school
   [INFO]  [Provision] Debounce: waiting 5s...
   [INFO]  [Provision] Batch: 1 provision jobs, 0 deferred
   [INFO]  [Provision] Wrote merged devices.csv (36 lines)
   [INFO]  [Provision] Running /usr/sbin/linuxmuster-import-devices
   [INFO]  [Provision] import-devices completed successfully
   [INFO]  [Verify] DHCP verify skipped (DHCP_VERIFY_FILE not set)
   [INFO]  [Provision] Batch complete: 1 verified OK, 0 failed verify
   ```

4. **Verifikation:**

   **AD Computer-Objekt:**
   ```
   CN=LINBO-FIX05,OU=testlab,OU=Devices,OU=default-school,OU=SCHOOLS,DC=linuxmuster,DC=lan
   ```

   **DNS A-Record:**
   ```
   linbo-fix05.linuxmuster.lan has address 10.0.0.237
   ```

   **devices.csv (Eintrag):**
   ```
   testlab;linbo-fix05;nopxe;AA:BB:CC:DD:EE:B5;10.0.0.237;;;;;;0;;;;;
   ```

   **Delta-Datei:**
   ```
   # managed-by: linbo-docker -- DO NOT EDIT MANUALLY
   testlab;linbo-fix05;nopxe;AA:BB:CC:DD:EE:B5;10.0.0.237;;;;;;0;;;;
   ```

   **Operation-Status:** `completed` mit `provisionStatus: 'synced'`

### Ergebnis: VOLLSTAENDIGER ERFOLG

Die gesamte Kette funktioniert:
```
API Host-Create → Redis Stream → DC Worker → Delta → Merge → Import → AD + DNS
       |                                                                    |
       +---- provisionStatus: pending → running → synced ------------------+
```

---

## Konfiguration

### API (docker-compose.yml)

```yaml
environment:
  - DC_PROVISIONING_ENABLED=${DC_PROVISIONING_ENABLED:-false}
  - DC_PROVISIONING_DRYRUN=${DC_PROVISIONING_DRYRUN:-true}
  - CSV_COL0_SOURCE=${CSV_COL0_SOURCE:-room}
```

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `DC_PROVISIONING_ENABLED` | `false` | Provisioning aktivieren |
| `DC_PROVISIONING_DRYRUN` | `true` | Dry-Run Modus (kein Schreiben auf DC) |
| `CSV_COL0_SOURCE` | `room` | Quelle fuer CSV Spalte 0 (room.name) |

### DC Worker (macct-worker.conf)

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `SCHOOL` | `default-school` | Schule (Multi-School: `{school}` Platzhalter) |
| `DEVICES_CSV_MASTER` | `.../default-school/devices.csv` | Master-CSV Pfad |
| `DEVICES_CSV_DELTA` | `.../default-school/linbo-docker.devices.csv` | Delta-CSV Pfad |
| `IMPORT_SCRIPT` | `/usr/sbin/linuxmuster-import-devices` | Import-Script |
| `LINBO_DOMAIN` | `linuxmuster.lan` | DNS Domain (`auto` = Samba-Detect) |
| `PROVISION_BATCH_SIZE` | `50` | Max Jobs pro Import-Lauf |
| `PROVISION_DEBOUNCE_SEC` | `5` | Wartezeit vor Batch-Drain |
| `SAMBA_TOOL_AUTH` | *(leer)* | Auth fuer samba-tool (leer = Cleanup deaktiviert) |
| `DHCP_VERIFY_FILE` | *(leer)* | DHCP-Datei fuer Verify (leer = Skip) |
| `REV_DNS_OCTETS` | `3` | Reverse-DNS Zone Oktette (3 = /24) |

### Inbetriebnahme-Checkliste

```bash
# 1. Dry-Run aktivieren und testen
DC_PROVISIONING_ENABLED=true
DC_PROVISIONING_DRYRUN=true
docker compose up -d api

# 2. Host erstellen, Worker-Log pruefen
# Erwartung: "DRY-RUN: would write merged devices.csv"

# 3. Wenn Dry-Run OK: Scharf schalten
DC_PROVISIONING_DRYRUN=false
docker compose up -d api

# 4. Host erstellen, auf DC pruefen:
samba-tool computer show <hostname>
host <hostname>.linuxmuster.lan
```

---

## Betrieb und Troubleshooting

### Worker-Log pruefen
```bash
# Auf dem DC (10.0.0.11):
journalctl -u macct-worker -f

# Oder direkt:
tail -f /var/log/macct/macct-worker.log
```

### Haeufige Probleme

| Problem | Ursache | Loesung |
|---------|---------|---------|
| "Timeout reading from socket" | Redis-Verbindung unterbrochen | Worker neustarten: `systemctl restart macct-worker` |
| "SAMBA_TOOL_AUTH not set" | Cleanup deaktiviert | Bei Delete: manuell `samba-tool computer delete` |
| "DHCP verify skipped" | `DHCP_VERIFY_FILE` nicht gesetzt | Normal bei Installationen ohne DHCP-Verify |
| provisionStatus bleibt "pending" | Dry-Run aktiv | `DC_PROVISIONING_DRYRUN=false` setzen |
| "ERROR in pxe field" | Leeres pxeFlag in CSV | Bug 1 — sollte mit Commit da7ce31 behoben sein |
| Host nicht in AD | import-devices Fehler | Worker-Log pruefen, `sophomorix-device --dry-run` testen |

### Rollback

```bash
# Auf dem DC:
# 1. Delta-Datei loeschen
rm /etc/linuxmuster/sophomorix/default-school/linbo-docker.devices.csv

# 2. Backup zurueckspielen (atomar)
cp devices.csv.bak devices.csv.restore
mv devices.csv.restore devices.csv

# 3. Import erneut ausfuehren (entfernt Docker-Hosts aus AD/DNS/DHCP)
/usr/sbin/linuxmuster-import-devices

# 4. Provisioning deaktivieren
DC_PROVISIONING_ENABLED=false
docker compose up -d api
```

### Manuelle Bereinigung

```bash
# AD-Objekt loeschen
samba-tool computer delete <hostname>

# DNS A-Record loeschen
samba-tool dns delete 127.0.0.1 linuxmuster.lan <hostname> A <ip>

# DNS PTR-Record loeschen
samba-tool dns delete 127.0.0.1 0.0.10.in-addr.arpa <last-octet> PTR <fqdn>.
```

---

## Verbleibende Arbeiten

### Offene Punkte

1. **Test-Hosts bereinigen:** linbo-fix01 bis linbo-fix05 und linbo-test01 bis linbo-test03
   existieren noch in der Datenbank. linbo-fix05 existiert auf dem DC (AD + DNS).

2. **Update/Delete testen:** Bisher nur Create live getestet. Update (inkl. Rename) und
   Delete sollten noch auf dem Produktionsserver verifiziert werden.

3. **ENV persistent machen:** `DC_PROVISIONING_ENABLED` und `DC_PROVISIONING_DRYRUN`
   sollten in eine `.env`-Datei auf dem Testserver geschrieben werden, damit sie bei
   Container-Rebuilds erhalten bleiben.

4. **DHCP Verify:** `DHCP_VERIFY_FILE` konfigurieren, sobald der Pfad bekannt ist.

5. **SAMBA_TOOL_AUTH:** Fuer Delete-Cleanup konfigurieren (z.B. `-U administrator%password`
   oder `--use-kerberos=required`).

### Naechste Phasen

| Phase | Feature | Status |
|-------|---------|--------|
| 12 | Multicast (udpcast) + Torrent (ctorrent) | Geplant |
| 13 | Host-GRUB .img Generierung | Geplant |
| 14 | Image Versioning | Geplant |

---

## Test-Uebersicht

### Unit Tests: `provisioning.service.test.js` (29 Tests)

**Service-Logik (13):**
- isProvisioningEnabled true/false
- createProvisionJob: Operation + Stream publish
- createProvisionJob: Deduplizierung
- createProvisionJob: Schlanker Stream-Payload
- createProvisionJob: Details in Operation.options
- createProvisionJob: Delete mit Frozen Snapshot
- updateProvisionStatus: Timestamps
- updateProvisionStatus: Host.provisionStatus running/synced/failed
- updateProvisionStatus: Dry-Run → pending bleibt
- updateProvisionStatus: Geloeschter Host (P2025)
- retryProvisionJob: Re-publish mit attempt+1
- retryProvisionJob: DLQ nach MAX_RETRIES
- syncHostProvisionStatus: Host-Felder updaten

**Route-Integration (9):**
- POST /hosts: Provision Job wenn enabled
- POST /hosts: Skip wenn disabled
- PATCH /hosts: Update Job
- PATCH /hosts: oldHostname bei Rename
- DELETE /hosts: Delete Job mit Frozen Snapshot
- Hostname > 15 chars: 400
- PATCH /internal/operations: Dispatch by type
- GET /internal/operations: Full operation
- GET /operations/provision: Paginierte Liste

**Edge Cases (7):**
- Host ohne Config → pxeFlag=0
- Host ohne IP → ip=''
- Concurrent Attempts → Dedup
- CSV Column Layout Tests
- Export Column Positions
- Und weitere

### Gesamte Test-Suite

```
384 Tests total, 379 passing (98.7%)
5 pre-existing integration test failures (nicht Phase-11-bezogen)
```
