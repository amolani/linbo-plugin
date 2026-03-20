# LINBO Docker - Phase 7: Remote Commands & Device Import

**Erstellt:** 2026-02-05
**Aktualisiert:** 2026-02-05
**Status:** Phase 7a/7b ABGESCHLOSSEN, Phase 7c AUSSTEHEND
**Priorität:** HOCH

---

## Übersicht

Phase 7 implementiert die fehlenden Kernfunktionen für den produktiven Einsatz:

1. **Remote Command Service** - Ersetzt `linbo-remote`
2. **Device Import Service** - Ersetzt `linuxmuster-import-devices`
3. **Onboot Commands** - `.cmd` Dateien für verzögerte Befehle

---

## 1. Analyse: linbo-remote

### Originales Verhalten
```bash
# Direkte Befehle via SSH
linbo-remote -i pc01,pc02 -c sync:1,start:1

# Onboot-Commands (beim nächsten Boot)
linbo-remote -i pc01 -p sync:1,start:1

# Gruppen-/Raum-basiert
linbo-remote -g win11_efi_sata -c reboot
linbo-remote -r raum01 -c shutdown

# Mit Wake-on-LAN
linbo-remote -i pc01 -w 60 -c sync:1,start:1
```

### Sophomorix-Abhängigkeiten (zu ersetzen)
| Original | Quelle | Unser Ersatz |
|----------|--------|--------------|
| `get_hostname()` | Samba AD (ldbsearch) | PostgreSQL `hosts` Tabelle |
| `get_mac()` | Samba AD | PostgreSQL `hosts.macAddress` |
| `get_ip()` | Samba AD | PostgreSQL `hosts.ipAddress` |
| `devices.csv` | Sophomorix | PostgreSQL + CSV Import |
| `$LINBODIR` | environment.py | `process.env.LINBO_DIR` |

### Unterstützte Befehle
```
partition          - Partitionstabelle schreiben
label              - Partitionen labeln
format             - Formatieren (alle oder :nr)
initcache[:type]   - Cache aktualisieren (rsync|multicast|torrent)
sync:nr            - OS synchronisieren
new:nr             - Clean sync (mit Formatierung)
start:nr           - OS starten
reboot             - Neustart
halt               - Herunterfahren
create_image:nr    - Image erstellen
upload_image:nr    - Image hochladen
```

---

## 2. Analyse: linuxmuster-import-devices

### Originales Verhalten
```bash
linuxmuster-import-devices [-s school]
```

### Workflow
1. `sophomorix-device --sync` → AD-Synchronisation
2. DHCP-Config generieren → `/etc/dhcp/devices.conf`
3. Symlinks erstellen:
   - `start.conf-{ip}` → `start.conf.{group}`
   - `hostcfg/{hostname}.cfg` → `../{group}.cfg`
4. start.conf prüfen/erstellen
5. GRUB-Configs generieren
6. Post-Hooks ausführen
7. DHCP-Service neu starten

### Unser Ersatz
| Funktion | Implementation |
|----------|----------------|
| AD-Sync | Nicht nötig (eigene DB) |
| DHCP-Config | Optional (separater Container) |
| Symlinks | `config.service.js` (existiert) |
| start.conf | `config.service.js` (existiert) |
| GRUB-Configs | `grub.service.js` (existiert) |
| Post-Hooks | Event-System + WebSocket |

---

## 3. Neue Services

### 3.1 remote.service.js

```javascript
/**
 * Remote Command Service
 * Ersetzt linbo-remote für Docker-Umgebung
 */

// Direkte Befehle via SSH
async executeDirectCommands(hostIds, commands, options)

// Onboot-Commands (.cmd Dateien)
async scheduleOnbootCommands(hostIds, commands, options)

// Geplante Commands auflisten
async listScheduledCommands()

// Geplanten Command löschen
async cancelScheduledCommand(hostname)

// Command-String validieren
validateCommandString(commands)

// Command-String parsen
parseCommands(commandString)
```

### 3.2 deviceImport.service.js

```javascript
/**
 * Device Import Service
 * Ersetzt linuxmuster-import-devices für Docker-Umgebung
 */

// CSV importieren
async importFromCsv(csvContent, options)

// Validierung
async validateCsvRow(row)

// Nach Import: Configs deployen
async deployAfterImport(hostIds)

// Export als CSV
async exportToCsv()
```

---

## 4. API Endpoints

### 4.1 Remote Commands

```
POST   /api/operations/direct
       Body: { hostIds: [], commands: "sync:1,start:1", options: {} }
       → Direkte SSH-Befehle

POST   /api/operations/schedule
       Body: { hostIds: [], commands: "sync:1,start:1", options: {} }
       → Onboot-Commands erstellen

GET    /api/operations/scheduled
       → Alle pending .cmd Dateien auflisten

DELETE /api/operations/scheduled/:hostname
       → .cmd Datei löschen

POST   /api/operations/wake
       Body: { hostIds: [], wait: 60 }
       → Wake-on-LAN senden
```

### 4.2 Device Import

```
POST   /api/hosts/import
       Body: { csv: "...", options: { dryRun: false } }
       → CSV importieren

GET    /api/hosts/export
       → Als CSV exportieren

POST   /api/hosts/import/validate
       Body: { csv: "..." }
       → CSV validieren ohne Import
```

---

## 5. Onboot Command Format

### Dateistruktur
```
/srv/linbo/linbocmd/
├── pc-r101-01.cmd    # Befehle für pc-r101-01
├── pc-r101-02.cmd    # Befehle für pc-r101-02
└── ...
```

### Dateiinhalt
```
sync:1,start:1
# oder mit Optionen:
noauto,sync:1,start:1
# oder nur Flags:
noauto,disablegui
```

### Spezielle Flags
- `noauto` - Automatische Funktionen überspringen
- `disablegui` - GUI deaktivieren

---

## 6. Datenbank-Erweiterungen

### Neue Felder für Host-Modell
```prisma
model Host {
  // ... existierende Felder ...

  // Neu für Device-Import Kompatibilität
  pxeFlag       Int       @default(1) @map("pxe_flag")
  dhcpOptions   String?   @map("dhcp_options")
  computerType  String?   @map("computer_type") @db.VarChar(50)

  // Für Scheduling
  scheduledCommand  String?   @map("scheduled_command")
  scheduledAt       DateTime? @map("scheduled_at")
}
```

---

## 7. Implementierungsreihenfolge

### Phase 7a: Remote Commands (Priorität 1) ✅ ABGESCHLOSSEN
1. [x] `remote.service.js` erstellen
2. [x] Command-Parser implementieren
3. [x] Onboot-Command-Dateien (.cmd) schreiben/lesen
4. [x] API-Endpoints in `operations.js` erweitern
5. [x] Tests für remote.service.js (33 Tests)
6. [x] WebSocket-Events für Command-Status

### Phase 7b: Device Import (Priorität 2) ✅ ABGESCHLOSSEN
1. [x] `deviceImport.service.js` erstellen
2. [x] CSV-Parser (kompatibel mit devices.csv Format)
3. [x] Validierung mit detaillierten Fehlermeldungen
4. [x] Bulk-Insert mit Transaction
5. [x] Auto-Deploy nach Import (Symlinks, GRUB)
6. [x] Tests für deviceImport.service.js (42 Tests)
7. [x] API-Endpoints für Import/Export

### Phase 7c: Integration (Priorität 3) - AUSSTEHEND
1. [ ] Frontend: Remote-Command-Dialog
2. [ ] Frontend: CSV-Import-Wizard
3. [ ] Dokumentation aktualisieren

---

## 8. Beispiel-Workflows

### Workflow 1: Klassenraum synchronisieren
```
1. Admin wählt Raum "r101" im Frontend
2. Klickt "Alle synchronisieren"
3. API: POST /operations/direct
   {
     filter: { roomId: "..." },
     commands: "sync:1,start:1",
     options: { wol: true, wolWait: 60 }
   }
4. Backend:
   - Sendet WoL an alle Hosts
   - Wartet 60 Sekunden
   - Führt sync:1,start:1 via SSH aus
5. WebSocket: Echtzeit-Status-Updates
```

### Workflow 2: Nacht-Deployment planen
```
1. Admin wählt Gruppe "win11_efi_sata"
2. Klickt "Für nächsten Boot planen"
3. API: POST /operations/schedule
   {
     filter: { groupId: "..." },
     commands: "sync:1,start:1"
   }
4. Backend:
   - Erstellt .cmd Dateien für jeden Host
5. Am nächsten Morgen:
   - Admin sendet WoL
   - Clients booten, lesen .cmd, führen aus
```

### Workflow 3: Hosts importieren
```
1. Admin lädt devices.csv hoch
2. API: POST /hosts/import/validate
3. Frontend zeigt Vorschau mit Änderungen
4. Admin bestätigt
5. API: POST /hosts/import
6. Backend:
   - Importiert/aktualisiert Hosts
   - Erstellt fehlende Gruppen/Räume
   - Deployt Configs (start.conf, GRUB)
   - Erstellt Symlinks
```

---

## 9. Abhängigkeiten

### Bereits implementiert ✅
- `ssh.service.js` - SSH-Verbindungen
- `wol.service.js` - Wake-on-LAN
- `config.service.js` - start.conf + Symlinks
- `grub.service.js` - GRUB-Konfiguration
- `host.service.js` - Host-Management

### Neu zu implementieren
- `remote.service.js` - Remote Commands
- `deviceImport.service.js` - CSV Import

---

## 10. Risiken & Mitigationen

| Risiko | Mitigation |
|--------|------------|
| SSH-Timeout bei vielen Hosts | Batch-Processing mit Concurrency-Limit |
| .cmd Dateien nicht gelöscht | Cleanup-Job + manuelle Löschung |
| CSV-Format-Varianten | Flexible Parser + Validierung |
| Konflikte bei Import | Dry-Run + Merge-Strategien |

---

## 11. Nächste Schritte nach Phase 7

### Phase 8: Distribution Services
- Multicast (udpcast)
- Torrent (ctorrent)

### Phase 9: Erweiterte Features
- Windows-Key-Injection
- Host-GRUB-Images (.img)
- ISO-Erstellung

---

## 12. Zeitschätzung

| Komponente | Aufwand |
|------------|---------|
| remote.service.js | 4-6 Stunden |
| API-Endpoints Remote | 2-3 Stunden |
| Tests Remote | 2-3 Stunden |
| deviceImport.service.js | 4-6 Stunden |
| API-Endpoints Import | 2-3 Stunden |
| Tests Import | 2-3 Stunden |
| Integration & Docs | 2-4 Stunden |
| **Gesamt** | **~2-3 Tage** |
