# Requirements: LINBO Plugin v2.0 — Feature Verification

**Defined:** 2026-03-20
**Core Value:** Jedes Feature das im Docker-Projekt existierte muss nativ funktionieren — ohne das LINBO-Paket anzufassen

## v2.0 Requirements

### Kernel Management

- [ ] **KERN-01**: Kernel-Varianten (stable/longterm/legacy) werden korrekt angezeigt mit Version und Groesse
- [ ] **KERN-02**: Kernel-Wechsel per API aendert den aktiven Kernel in /srv/linbo/ und triggert GRUB-Update
- [ ] **KERN-03**: Kernel-Status zeigt korrekte Version des aktiven Kernels

### Linbofs Management

- [ ] **LFS-01**: Linbofs-Status zeigt Groesse, MD5, Datum korrekt an
- [ ] **LFS-02**: Linbofs-Rebuild per API triggert update-linbofs und liefert Fortschritt per WebSocket
- [ ] **LFS-03**: Patch-Status zeigt Hook-Informationen korrekt an

### Firmware Management

- [ ] **FW-01**: Firmware-Detect erkennt benoetigte Firmware von Online-Clients per SSH
- [ ] **FW-02**: Firmware-Eintraege koennen hinzugefuegt und in linbofs64 eingebaut werden
- [ ] **FW-03**: SSH-Key (linbo_client_key) ist korrekt konfiguriert fuer Client-Zugriff

### GRUB Config Management

- [ ] **GRUB-01**: GRUB-Configs fuer alle Gruppen werden korrekt angezeigt
- [ ] **GRUB-02**: GRUB-Config Regenerierung per API funktioniert
- [ ] **GRUB-03**: GRUB-Config Cleanup entfernt verwaiste Configs

### Driver Management

- [ ] **DRV-01**: Treiber-Profile koennen erstellt und verwaltet werden
- [ ] **DRV-02**: match.conf kann per API gelesen und geschrieben werden
- [ ] **DRV-03**: HWInfo-Scan von Online-Clients funktioniert per SSH

### Remote Operations

- [ ] **OPS-01**: Reboot/Halt Befehl an LINBO-Client per API funktioniert
- [ ] **OPS-02**: Partition/Sync/Start Befehl per API funktioniert
- [ ] **OPS-03**: Wake-on-LAN per API funktioniert
- [ ] **OPS-04**: Geplante Befehle (.cmd Dateien) werden korrekt geschrieben und ausgefuehrt

### Image Management

- [ ] **IMG-01**: Image-Liste zeigt verfuegbare Images in /srv/linbo/
- [ ] **IMG-02**: Image-Pull von Authority Server per rsync funktioniert
- [ ] **IMG-03**: Image-Push zum Authority Server per rsync funktioniert

### SSH & Terminal

- [x] **SSH-01**: SSH-Key-Chain ist korrekt konfiguriert (Dropbear Keys → linbo_client_key)
- [x] **SSH-02**: SSH-Terminal zu LINBO-Client im Browser funktioniert
- [x] **SSH-03**: HWInfo-Scanner erkennt Online-Clients automatisch

### WLAN Management

- [ ] **WLAN-01**: WLAN-Config kann gelesen und geschrieben werden
- [ ] **WLAN-02**: WLAN-Config wird korrekt in linbofs64 eingebaut

### LINBO Update

- [ ] **UPD-01**: LINBO-Update Status wird korrekt angezeigt
- [ ] **UPD-02**: LINBO-Update per API triggert apt update/install fuer linuxmuster-linbo7

## Out of Scope

| Feature | Reason |
|---------|--------|
| LINBO-Paket modifizieren | Bleibt 100% vanilla — nur API/Frontend |
| Neue Features hinzufuegen | Nur bestehende Docker-Features verifizieren |
| Multicast/Torrent | Eigener Milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SSH-01 | Phase 11 | In Progress (11-01 done) |
| SSH-02 | Phase 11 | Complete |
| SSH-03 | Phase 11 | Complete |
| KERN-01 | Phase 12 | Pending |
| KERN-02 | Phase 12 | Pending |
| KERN-03 | Phase 12 | Pending |
| LFS-01 | Phase 13 | Pending |
| LFS-02 | Phase 13 | Pending |
| LFS-03 | Phase 13 | Pending |
| FW-01 | Phase 14 | Pending |
| FW-02 | Phase 14 | Pending |
| FW-03 | Phase 14 | Pending |
| GRUB-01 | Phase 15 | Pending |
| GRUB-02 | Phase 15 | Pending |
| GRUB-03 | Phase 15 | Pending |
| DRV-01 | Phase 16 | Pending |
| DRV-02 | Phase 16 | Pending |
| DRV-03 | Phase 16 | Pending |
| OPS-01 | Phase 17 | Pending |
| OPS-02 | Phase 17 | Pending |
| OPS-03 | Phase 17 | Pending |
| OPS-04 | Phase 17 | Pending |
| IMG-01 | Phase 18 | Pending |
| IMG-02 | Phase 18 | Pending |
| IMG-03 | Phase 18 | Pending |
| WLAN-01 | Phase 19 | Pending |
| WLAN-02 | Phase 19 | Pending |
| UPD-01 | Phase 20 | Pending |
| UPD-02 | Phase 20 | Pending |

**Coverage:**
- v2.0 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-03-20*
*Traceability updated: 2026-03-20 (v2.0 roadmap)*
