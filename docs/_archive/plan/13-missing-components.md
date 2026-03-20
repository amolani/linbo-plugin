# LINBO Docker - Fehlende Komponenten

**Analyse-Datum:** 2026-02-05
**Vergleich:** Docker-Projekt vs. linuxmuster 7.3 Server (4.3.29-0)

---

## Übersicht

Nach Analyse des bestehenden linuxmuster.net 7.3 Servers mit LINBO 4.3.29-0 wurden folgende fehlende Komponenten im Docker-Projekt identifiziert:

| Kategorie | Komponente | Priorität | Status |
|-----------|------------|-----------|--------|
| Distribution | Multicast (udpcast) | HOCH | Phase 7 geplant |
| Distribution | Torrent (ctorrent) | HOCH | Phase 7 geplant |
| VDI | VDI Integration | MITTEL | Nicht geplant |
| Remote | linbo-remote Features | HOCH | Teilweise implementiert |
| RSYNC | Windows Registry Hooks | MITTEL | Nicht implementiert |
| RSYNC | Machine Account Sync | MITTEL | Nicht implementiert |
| Tools | ISO Creation | NIEDRIG | Nicht implementiert |
| Tools | Image Conversion (cloop2qcow2) | NIEDRIG | Legacy, nicht relevant |
| Boot | Host-specific GRUB Images | MITTEL | Teilweise implementiert |
| Boot | iPXE Integration | NIEDRIG | Nicht implementiert |

---

## 1. Fehlende Distribution-Services

### 1.1 Multicast Distribution (udpcast)

**Server-Referenz:** `/usr/sbin/linbo-multicast`, `/usr/share/linuxmuster/linbo/linbo-mcasthelper.sh`

**Funktion:**
- Simultanes Image-Broadcasting an mehrere Clients
- UDP-basierte Dateiverteilung
- Konfigurierbar via `/etc/default/linbo-multicast`

**Konfiguration (Produktionsserver):**
```bash
PORTBASE=9000
MINCLIENTS=15
MINSECONDS=30
MAXSECONDS=60
```

**Erforderliche Implementierung:**
1. Container `linbo-multicast` mit udpcast
2. Service `multicast.service.js` für API-Integration
3. API-Endpoints für Multicast-Session-Management
4. WebSocket-Events für Session-Status
5. Konfigurationsdatei `multicast.list` generieren

**Geschätzter Aufwand:** 2-3 Tage

---

### 1.2 Torrent Distribution (ctorrent)

**Server-Referenz:** `/usr/sbin/linbo-torrent`, `/usr/share/linuxmuster/linbo/linbo-torrenthelper.sh`

**Funktion:**
- P2P-basierte Image-Verteilung
- Automatische Torrent-Erstellung bei Image-Upload
- Seeding für lokale Clients

**Konfiguration (Produktionsserver):**
```bash
SEEDHOURS=100000
MAXPEERS=100
MINPEERS=1
SLICESIZE=512
PIECE_LENGTH=524288
```

**Erforderliche Implementierung:**
1. Container `linbo-torrent` mit ctorrent
2. Container `linbo-tracker` mit opentracker (optional)
3. Service `torrent.service.js` für API-Integration
4. Automatische `.torrent`-Erstellung bei Image-Upload
5. Session-Management via tmux

**Geschätzter Aufwand:** 2-3 Tage

---

## 2. Fehlende VDI Integration

### 2.1 VDI Service

**Server-Referenz:** `/usr/lib/linuxmuster-linbo-vdi/`, `/etc/linuxmuster/linbo-vdi/`

**Funktion:**
- Hypervisor-Integration (Proxmox VE)
- Automatische Clone-Erstellung
- VDI-Zustand-Monitoring

**Python-Module (2,250 Zeilen auf Produktionsserver):**
- `vdi-service.py` - Haupt-Daemon
- `buildClone.py` - Clone-Erstellung
- `removeClone.py` - Clone-Löschung
- `createNewMaster.py` - Master-VM-Erstellung
- `getVmStates.py` - VM-Zustand-Monitoring
- `getConnection.py` - Verbindungsmanagement

**Erforderliche Implementierung:**
1. VDI-Konfiguration in Datenbank
2. Proxmox-API-Client
3. Service `vdi.service.js` für Node.js-Integration
4. Worker für VM-Zustand-Polling
5. API-Endpoints für VDI-Management
6. WebSocket-Events für VM-Status

**Geschätzter Aufwand:** 5-7 Tage

**Hinweis:** VDI ist optional und nur für Proxmox-Umgebungen relevant.

---

## 3. Fehlende linbo-remote Features

### 3.1 Onboot-Commands

**Server-Referenz:** `/usr/sbin/linbo-remote` (400+ Zeilen)

**Fehlende Features:**
- Verzögerte Befehlsausführung (`-p` Flag)
- Onboot-Command-Dateien (`/srv/linbo/linbocmd/*.cmd`)
- Room/Group-basierte Massenoperationen

**Aktuell implementiert:**
- Einzelhost-Befehle via SSH
- WoL-Unterstützung
- Basis-Operationen (sync, start, reboot, halt)

**Fehlend:**
```bash
# Onboot-Commands (bei nächstem Boot ausführen)
linbo-remote -p sync:1,start:1 -g gruppe01

# Room-basierte Operationen
linbo-remote -r raum01 -c reboot
```

**Erforderliche Implementierung:**
1. Onboot-Command-Dateien generieren
2. RSYNC-Hook für Command-Download
3. API-Endpoint für verzögerte Befehle
4. Batch-Operationen erweitern

**Geschätzter Aufwand:** 1-2 Tage

---

## 4. Fehlende RSYNC-Hook-Funktionen

### 4.1 Windows Registry Hooks

**Server-Referenz:** `/usr/share/linuxmuster/linbo/rsync-pre-download.sh`

**Funktion:**
- Windows-Produkt-Key-Injektion
- Aktivierungs-Token-Management
- Registry-Patching für Windows-Clients

**Fehlende Features:**
```bash
# Windows-Key aus devices.csv extrahieren
# In Registry-Patch einfügen
# Bei Download dem Client bereitstellen
```

**Erforderliche Implementierung:**
1. Windows-Key-Feld in Host-Modell
2. Registry-Template-Verarbeitung
3. RSYNC-Hook für Key-Download
4. API-Endpoint für Key-Management

**Geschätzter Aufwand:** 1 Tag

---

### 4.2 Machine Account Synchronization

**Server-Referenz:** `/usr/share/linuxmuster/linbo/rsync-post-upload.sh`

**Funktion:**
- Samba Machine-Account-Passwörter speichern
- Samba SAM-Datenbank-Integration
- `.macct`-Dateien verwalten

**Hinweis:** In Docker-Umgebung ohne Samba/AD möglicherweise nicht relevant.

**Geschätzter Aufwand:** 2 Tage (falls erforderlich)

---

## 5. Fehlende Boot-Funktionen

### 5.1 Host-spezifische GRUB-Images

**Server-Referenz:** `/usr/share/linuxmuster/linbo/mkgrubhostimg.py`

**Funktion:**
- GRUB-Disk-Images pro Host generieren
- BIOS und EFI Unterstützung
- DHCP-Konfiguration automatisch aktualisieren

**Aktuell implementiert:**
- GRUB `.cfg` Dateien pro Host/Gruppe
- Basis GRUB-Konfiguration

**Fehlend:**
- `grub-mkimage` Integration
- `.img` Datei-Generierung
- DHCP Bootfile-Integration

**Erforderliche Implementierung:**
1. grub-mkimage Wrapper-Funktion
2. BIOS/EFI Image-Generierung
3. DHCP-Integration (dnsmasq/isc-dhcp)

**Geschätzter Aufwand:** 2 Tage

---

### 5.2 iPXE Integration

**Server-Referenz:** `/srv/linbo/boot/grub/ipxe.efi`, `ipxe.lkrn`

**Funktion:**
- Alternative Boot-Methode via iPXE
- Chainloading zu GRUB

**Status:** Niedrige Priorität, GRUB-Boot funktioniert bereits.

**Geschätzter Aufwand:** 1 Tag

---

## 6. Fehlende Utility-Tools

### 6.1 ISO-Erstellung

**Server-Referenz:** `/usr/share/linuxmuster/linbo/make-linbo-iso.sh`

**Funktion:**
- Bootfähige LINBO-ISO erstellen
- USB-Stick-Boot unterstützen
- Hybrid-ISO (BIOS + UEFI)

**Erforderliche Implementierung:**
1. xorriso Integration
2. isolinux/GRUB Konfiguration
3. API-Endpoint für ISO-Download
4. Temporäre ISO-Generierung

**Geschätzter Aufwand:** 1-2 Tage

---

### 6.2 Application Harvesting

**Server-Referenz:** `/usr/share/linuxmuster/linbo/harvest-app.sh`

**Funktion:**
- Applikationen aus Server-OS für linbofs extrahieren
- Dependency-Analyse mit ldd
- XZ-komprimierte Archive erstellen

**Status:** Niedrige Priorität, spezielle Anwendungsfälle.

**Geschätzter Aufwand:** 1 Tag

---

## 7. Vergleichstabelle: Server vs. Docker

| Feature | linuxmuster 7.3 Server | Docker-Projekt | Gap |
|---------|------------------------|----------------|-----|
| TFTP Boot | ✅ tftpd-hpa | ✅ tftpd-hpa | - |
| RSYNC Sync | ✅ rsyncd | ✅ rsyncd | - |
| SSH Remote | ✅ OpenSSH + Dropbear | ✅ OpenSSH | - |
| start.conf | ✅ Datei-basiert | ✅ DB + Deploy | - |
| GRUB Configs | ✅ mkgrubhostimg.py | ✅ grub.service.js | Teilweise |
| Host-GRUB-Images | ✅ .img Dateien | ❌ Nicht implementiert | **Gap** |
| Multicast | ✅ udpcast | ❌ Phase 7 geplant | **Gap** |
| Torrent | ✅ ctorrent | ❌ Phase 7 geplant | **Gap** |
| VDI | ✅ Python-Service | ❌ Nicht geplant | **Gap** |
| linbo-remote | ✅ Vollständig | ⚠️ Teilweise | Teilweise |
| Windows-Keys | ✅ Registry-Hooks | ❌ Nicht implementiert | **Gap** |
| Machine-Accounts | ✅ Samba-Integration | ❌ Nicht relevant | - |
| ISO-Erstellung | ✅ make-linbo-iso.sh | ❌ Nicht implementiert | **Gap** |
| Web-Frontend | ❌ Nicht vorhanden | ✅ React App | Vorteil |
| REST-API | ❌ Nicht vorhanden | ✅ Express.js | Vorteil |
| WebSocket | ❌ Nicht vorhanden | ✅ Real-time Events | Vorteil |
| Datenbank | ❌ Dateien | ✅ PostgreSQL | Vorteil |
| Audit-Logging | ❌ Minimal | ✅ Vollständig | Vorteil |

---

## 8. Empfohlene Implementierungs-Reihenfolge

### Phase 7a: Distribution (Priorität HOCH)
1. Multicast-Container und -Service
2. Torrent-Container und -Service
3. Automatische Torrent-Erstellung bei Upload

### Phase 7b: linbo-remote Erweiterungen (Priorität HOCH)
1. Onboot-Command-Unterstützung
2. Room/Group-basierte Massenoperationen
3. Command-Scheduling

### Phase 7c: Boot-Erweiterungen (Priorität MITTEL)
1. Host-spezifische GRUB-Images
2. DHCP-Integration
3. ISO-Erstellung

### Phase 7d: Windows-Integration (Priorität MITTEL)
1. Windows-Key-Management
2. Registry-Hooks
3. Aktivierungs-Token

### Phase 8: VDI (Priorität NIEDRIG/OPTIONAL)
1. Proxmox-API-Client
2. VDI-Service
3. Clone-Management
4. VM-Monitoring

---

## 9. Zusammenfassung

Das Docker-Projekt hat **~80%** der Kernfunktionalität implementiert. Die wichtigsten Lücken sind:

1. **Distribution-Services** (Multicast/Torrent) - Kritisch für große Deployments
2. **linbo-remote Erweiterungen** - Wichtig für Batch-Operationen
3. **Boot-Image-Generierung** - Nice-to-have für spezielle Hardware
4. **VDI-Integration** - Optional, nur für Proxmox-Umgebungen

Das Docker-Projekt bietet jedoch erhebliche **Vorteile** gegenüber dem traditionellen Setup:
- Moderne Web-Oberfläche
- REST-API für Automatisierung
- Echtzeit-Updates via WebSocket
- Vollständiges Audit-Logging
- Einfache Deployment mit Docker Compose
