# LINBO Docker - Nächste Schritte

**Stand:** 2026-02-05
**Priorität:** Phase 7c → Phase 8

---

## Sofortige nächste Schritte

### Phase 7c: Frontend Integration (2-3 Tage)

**Ziel:** Remote Commands und Device Import im Frontend nutzbar machen

#### 1. Remote Command Dialog
```
Standort: frontend/src/components/operations/RemoteCommandDialog.jsx

Features:
- Host/Gruppe/Raum-Auswahl
- Command Builder mit Dropdown
- Validierung vor Ausführung
- Direkt vs. Onboot-Option
- WoL-Integration mit Wartezeit
- Echtzeit-Fortschritt via WebSocket
```

#### 2. CSV Import Wizard
```
Standort: frontend/src/components/hosts/ImportWizard.jsx

Features:
- Datei-Upload oder Text-Eingabe
- Vorschau der zu importierenden Hosts
- Validierungs-Fehler anzeigen
- Dry-Run Option
- Merge-Strategie wählen
- Fortschritts-Anzeige
```

#### 3. Scheduled Commands View
```
Standort: frontend/src/pages/ScheduledCommands.jsx

Features:
- Liste aller geplanten .cmd Dateien
- Host-Filter
- Command-Inhalt anzeigen
- Einzeln oder Batch löschen
```

---

## Phase 8: Distribution Services (3-5 Tage)

**Ziel:** Multicast und Torrent für große Deployments

### 8.1 Multicast Container

```yaml
# docker-compose.yml
services:
  multicast:
    build: ./containers/multicast
    volumes:
      - linbo-data:/srv/linbo:ro
    ports:
      - "9000-9100:9000-9100/udp"
    environment:
      - PORTBASE=9000
      - MINCLIENTS=16
      - MINSECONDS=60
```

**Komponenten:**
- udpcast Installation
- Session-Management via tmux
- multicast.list Auto-Generierung
- API-Endpoints für Start/Stop
- WebSocket Events für Status

### 8.2 Torrent Container

```yaml
services:
  torrent:
    build: ./containers/torrent
    volumes:
      - linbo-data:/srv/linbo
    ports:
      - "6881-6889:6881-6889"
    environment:
      - SEEDHOURS=100000
      - MAXPEERS=100
```

**Komponenten:**
- ctorrent Installation
- .torrent Auto-Generierung bei Upload
- Seeding-Session-Management
- API-Endpoints für Control
- Tracker-Integration

### 8.3 API Erweiterungen

```
POST   /api/v1/distribution/multicast/start
POST   /api/v1/distribution/multicast/stop
GET    /api/v1/distribution/multicast/sessions

POST   /api/v1/distribution/torrent/create/:imageName
POST   /api/v1/distribution/torrent/start/:imageName
POST   /api/v1/distribution/torrent/stop/:imageName
GET    /api/v1/distribution/torrent/status
```

---

## Phase 9: Image Management (2-3 Tage)

**Ziel:** Vollständiges Image-Lifecycle-Management

### 9.1 Automatische Metadaten

```javascript
// Beim Upload automatisch generieren:
- {image}.qcow2.info    // Timestamp, Size, Partition
- {image}.qcow2.desc    // Changelog aus DB
- {image}.qcow2.torrent // Für P2P Distribution
```

### 9.2 Backup/Versioning

```
/srv/linbo/images/{name}/
├── {image}.qcow2              # Aktuell
├── backups/
│   ├── 202602051200/          # Timestamp-basiert
│   │   ├── {image}.qcow2
│   │   └── {image}.qcow2.info
│   └── 202602041500/
└── tmp/                        # Upload-Staging
```

**API:**
```
POST   /api/v1/images/:id/backup
GET    /api/v1/images/:id/backups
POST   /api/v1/images/:id/restore/:timestamp
DELETE /api/v1/images/:id/backups/:timestamp
```

### 9.3 Windows Registry Patches

```
Standort: /srv/linbo/images/{name}/{image}.reg

API:
GET    /api/v1/images/:id/registry
PUT    /api/v1/images/:id/registry
```

---

## Phase 10: Boot Enhancements (2 Tage)

### 10.1 Host-GRUB Images

```bash
# grub-mkimage Integration
grub-mkimage -o boot.img -O i386-pc ...
grub-mkimage -o bootx64.efi -O x86_64-efi ...
```

**API:**
```
POST /api/v1/hosts/:id/generate-grub-image
GET  /api/v1/hosts/:id/grub-image
```

### 10.2 ISO Creation

```bash
# make-linbo-iso.sh Integration
POST /api/v1/system/create-iso
GET  /api/v1/system/iso/download
```

---

## Implementierungsreihenfolge

```
Woche 1:
├── Phase 7c: Frontend (Remote + Import)
└── Tests & Dokumentation

Woche 2:
├── Phase 8a: Multicast Container
├── Phase 8b: Torrent Container
└── Distribution API

Woche 3:
├── Phase 9: Image Management
│   ├── Auto-Metadaten
│   ├── Backup System
│   └── Registry Patches
└── Integration Tests

Woche 4:
├── Phase 10: Boot Enhancements
├── End-to-End Testing
└── Dokumentation finalisieren
```

---

## Nicht geplante Features

Folgende Features werden **nicht** implementiert:

| Feature | Grund |
|---------|-------|
| Sophomorix/AD Integration | Docker ist standalone |
| Samba LDAP | Kein AD benötigt |
| Machine Accounts (.macct) | Nur für AD-Umgebungen |
| Windows Activation (winact/) | Lizenz-spezifisch |

---

## Risiken & Mitigationen

| Risiko | Mitigation |
|--------|------------|
| Multicast Netzwerk-Isolation | Host-Netzwerk-Modus testen |
| Torrent Port-Konflikte | Konfigurierbarer Port-Range |
| Image-Größe bei Backups | Retention Policy, Compression |
| GRUB-Image Kompatibilität | Testen auf verschiedener Hardware |

---

## Erfolgskriterien

### Phase 7c abgeschlossen wenn:
- [ ] Remote Command Dialog funktioniert
- [ ] CSV Import Wizard funktioniert
- [ ] Scheduled Commands View funktioniert
- [ ] E2E Tests bestehen

### Phase 8 abgeschlossen wenn:
- [ ] Multicast-Session startet/stoppt
- [ ] Torrent-Seeding funktioniert
- [ ] Auto-Torrent bei Upload
- [ ] 10+ Clients gleichzeitig bedienbar

### Phase 9 abgeschlossen wenn:
- [ ] .info/.desc automatisch generiert
- [ ] Backup erstellt bei Upload
- [ ] Restore funktioniert
- [ ] Registry-Patches deploybar
