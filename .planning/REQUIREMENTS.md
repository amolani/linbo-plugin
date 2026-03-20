# Requirements: LINBO Native Server

**Defined:** 2026-03-19
**Core Value:** Vanilla LINBO unberuehrt lassen, alles ueber eigene API-Schicht ansprechen — vollwertiger Caching-Satellit

## v1 Requirements

### Native LINBO Basis

- [x] **BASE-01**: linuxmuster-linbo7 per APT installiert — vanilla, kein Touch
- [x] **BASE-02**: API liest native LINBO-Dateien direkt (/srv/linbo/, start.confs, GRUB-Configs)
- [x] **BASE-03**: API steuert native LINBO-Dienste (rsync, tftpd-hpa) ueber systemd/Filesystem

### API Nativ

- [x] **API-01**: Express API laeuft als systemd Service (linbo-api.service)
- [x] **API-02**: redis.js durch direkte Filesystem-Operationen ersetzen — Hosts, Configs, Settings aus Dateien lesen statt Cache
- [x] **API-03**: Host-Online-Status als einfache In-Memory Map (fluechtig, kein Persist noetig)
- [x] **API-04**: Sync-Lock als Lock-Datei statt Redis-Key
- [x] **API-05**: ioredis, dockerode, rate-limit-redis aus package.json entfernen
- [x] **API-06**: Docker DNS Hostnamen durch localhost ersetzen
- [x] **API-07**: Health-Endpoint ohne Redis-Check
- [x] **API-08**: containerLogs.js durch journald-Streaming ersetzen oder deaktivieren
- [x] **API-09**: setup-bootfiles.sh als systemd oneshot — provisioniert Boot-Files einmalig

### DHCP

- [x] **DHCP-01**: isc-dhcp-server nativ installiert und als systemd Service konfiguriert
- [x] **DHCP-02**: DHCP-Config wird vom LMN Authority Server gesynct (wie im Docker-Projekt)
- [x] **DHCP-03**: PXE Boot Options korrekt konfiguriert (next-server, filename fuer GRUB)

### Caching-Satellit

- [x] **CACHE-01**: Multi-School Sync — school-Parameter durchgaengig, bis zu 40 Schulen
- [x] **CACHE-02**: Image Caching — Images lokal vorhalten, rsync-Download von Authority Server
- [x] **CACHE-03**: Auto-Discovery — automatische Erkennung neuer Clients im Netz
- [x] **CACHE-04**: First-Boot Sync — automatischer erster Sync bei neuem Client

### Frontend Nativ

- [x] **UI-01**: Vite Build erzeugt statische Dateien
- [x] **UI-02**: nginx serviert Frontend + Reverse Proxy fuer API + WebSocket Upgrade

### Installation

- [x] **INST-01**: install.sh installiert Abhaengigkeiten (Node.js 20, npm, nginx, linuxmuster-linbo7, isc-dhcp-server)
- [x] **INST-02**: setup.sh fuer Erstkonfiguration (Pfade, Berechtigungen, Secrets, systemd enable)

### Code Quality

- [ ] **QUAL-01**: Docker-Artefakte entfernt (Dockerfiles, docker-compose, .dockerignore, containers/ Struktur)
- [ ] **QUAL-02**: Saubere Verzeichnisstruktur ohne Container-Verschachtelung
- [ ] **QUAL-03**: Kein toter Code — alles Docker/Redis-spezifische das nicht mehr gebraucht wird, ist weg

### Verification (Live-Test)

- [ ] **VERIFY-01**: Natives LINBO bootet — PXE Client bekommt DHCP + GRUB + Kernel + linbofs64 vom nativen Server
- [ ] **VERIFY-02**: API zeigt Hosts und Status im Web-Frontend
- [ ] **VERIFY-03**: Remote-Operationen funktionieren (Reboot, Sync, Start)
- [ ] **VERIFY-04**: WebSocket Echtzeit-Updates kommen durch nginx an
- [ ] **VERIFY-05**: Multi-School Sync funktioniert — Hosts aus verschiedenen Schulen werden korrekt geladen

## v2 Requirements

- **PKG-01**: .deb Paket (apt install linbo-native)
- **PKG-02**: Kombiniertes Paket (linbo7 + eigene Features)
- **EXT-01**: Multicast/Torrent Image-Verteilung

## Out of Scope

| Feature | Reason |
|---------|--------|
| LINBO-Paket modifizieren | Bleibt 100% vanilla |
| Docker beibehalten | Wird komplett entfernt |
| Redis / store.js | Nicht noetig — Dateien liegen nativ auf dem Server |
| PostgreSQL/Prisma | War nie aktiv |
| Standalone-Modus | Bereits entfernt |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BASE-01 | Phase 2 | Complete |
| BASE-02 | Phase 6 | Complete |
| BASE-03 | Phase 6 | Complete |
| API-01 | Phase 2 | Complete |
| API-02 | Phase 4 | Complete |
| API-03 | Phase 4 | Complete |
| API-04 | Phase 4 | Complete |
| API-05 | Phase 5 | Complete |
| API-06 | Phase 5 | Complete |
| API-07 | Phase 5 | Complete |
| API-08 | Phase 5 | Complete |
| API-09 | Phase 2 | Complete |
| DHCP-01 | Phase 3 | Complete |
| DHCP-02 | Phase 3 | Complete |
| DHCP-03 | Phase 3 | Complete |
| CACHE-01 | Phase 7 | Complete |
| CACHE-02 | Phase 7 | Complete |
| CACHE-03 | Phase 7 | Complete |
| CACHE-04 | Phase 7 | Complete |
| UI-01 | Phase 8 | Complete |
| UI-02 | Phase 8 | Complete |
| INST-01 | Phase 1 | Complete |
| INST-02 | Phase 1 | Complete |
| QUAL-01 | Phase 9 | Pending |
| QUAL-02 | Phase 9 | Pending |
| QUAL-03 | Phase 9 | Pending |
| VERIFY-01 | Phase 10 | Pending |
| VERIFY-02 | Phase 10 | Pending |
| VERIFY-03 | Phase 10 | Pending |
| VERIFY-04 | Phase 10 | Pending |
| VERIFY-05 | Phase 10 | Pending |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 — DHCP + Caching-Satellit Features hinzugefuegt; alle 31 Requirements auf 10 Phasen gemappt*
