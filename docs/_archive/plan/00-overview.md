# LINBO Docker - Projektübersicht

## Projektziel

Entwicklung einer **standalone Docker-basierten LINBO-Lösung** mit einer modernen Web-Oberfläche, die unabhängig von linuxmuster.net betrieben werden kann.

## Motivation

- **Entkopplung**: LINBO als eigenständige Imaging-Lösung nutzbar machen
- **Portabilität**: Docker ermöglicht einfaches Deployment auf verschiedenen Plattformen
- **Moderne Verwaltung**: Web-basierte UI ersetzt CLI-basierte Administration
- **Flexibilität**: Einfache Integration in bestehende Infrastrukturen

## Kernfunktionen

### Phase 1: MVP (Minimum Viable Product)

1. **PXE-Boot-Infrastruktur**
   - TFTP-Server für Kernel/Bootloader
   - GRUB-Konfiguration für Netzwerk-Boot

2. **Image-Management**
   - qcow2/qdiff Image-Unterstützung
   - Basis- und Differenzial-Images
   - Image-Upload/Download via rsync

3. **Client-Steuerung**
   - Remote-Command-Ausführung via SSH
   - Partition/Format/Sync/Start-Operationen
   - Wake-on-LAN

4. **Web-API**
   - REST-API für alle Operationen
   - WebSocket für Echtzeit-Updates
   - Host/Gruppe/Raum-Verwaltung

### Phase 2: Erweiterungen

- BitTorrent-Distribution (Peer-to-Peer)
- Multicast-Verteilung (UDP)
- Konfigurationsvorlagen mit Genehmigungsworkflow
- Erweiterte Statistiken und Monitoring
- Multi-Tenant-Unterstützung

## Technologie-Stack

| Komponente | Technologie |
|------------|-------------|
| Container | Docker / Docker Compose |
| Backend API | Node.js / Go / Python (TBD) |
| Datenbank | PostgreSQL + Redis (Cache) |
| Frontend | React / Vue.js (TBD) |
| Real-time | WebSocket |
| Boot | TFTP + GRUB + PXE |
| Imaging | qemu-utils, rsync, qemu-nbd |
| Remote | SSH (Dropbear + OpenSSH) |

## Architektur-Prinzipien

1. **Microservices**: Jeder Dienst in eigenem Container
2. **Stateless**: Zustand in Datenbank/Volumes, nicht in Containern
3. **API-First**: Alle Operationen über definierte APIs
4. **Event-Driven**: Asynchrone Kommunikation via Events
5. **Infrastructure as Code**: Alles reproduzierbar via Docker Compose

## Abgrenzung zu linuxmuster.net

### Was übernommen wird:
- linbofs (Client-Initramfs) mit allen linbo_* Commands
- Image-Format (qcow2/qdiff)
- Boot-Mechanismus (PXE + GRUB)
- Grundlegende Server-Skripte (angepasst)

### Was ersetzt wird:
- `devices.csv` → Datenbank + REST-API
- `helperfunctions.sh` → Docker-interne Utilities
- DHCP-Integration → Externe DHCP oder eigener Service
- linuxmuster-webui7 → Eigene Web-Oberfläche

## Projektstruktur

```
linbo-docker/
├── docker-compose.yml          # Service-Orchestrierung
├── containers/
│   ├── tftp/                   # TFTP-Server
│   ├── rsync/                  # RSYNC-Daemon
│   ├── ssh/                    # SSH-Server für Remote
│   ├── api/                    # Backend REST-API
│   └── web/                    # Frontend Web-App
├── volumes/
│   ├── linbo/                  # /srv/linbo - Images, Boot
│   ├── config/                 # Konfigurationen
│   └── data/                   # PostgreSQL-Daten
├── linbofs/                    # Client-Dateisystem (aus Original)
└── docs/                       # Dokumentation
```

## Meilensteine

**Aktualisiert: 2026-02-03**

| Phase | Beschreibung | Status |
|-------|--------------|--------|
| 0 | Analyse & Konzeption | ✅ Abgeschlossen |
| 1 | Docker-Grundstruktur | ✅ Abgeschlossen |
| 2 | Minimaler LINBO-Server (TFTP/RSYNC/SSH) | ✅ Abgeschlossen |
| 3 | REST-API Backend | ✅ Abgeschlossen |
| 4 | Web-Frontend MVP | ⏳ **Nächster Schritt** |
| 5 | Testing & Dokumentation | ⏳ Geplant |
| 6 | Erweiterungen (Torrent/Multicast) | ⏳ Optional |

**Detaillierter Status:** Siehe [docs/plan/06-implementation-status.md](./06-implementation-status.md)

## Lizenz

Das Projekt basiert auf linuxmuster-linbo7 (GPL) und wird unter derselben Lizenz veröffentlicht.

## Referenzen

- [linuxmuster-linbo7 Repository](https://github.com/linuxmuster/linuxmuster-linbo7)
- [LINBO Dokumentation](https://docs.linuxmuster.net/de/latest/clients/linbo/)
- [linbo-build-docker](https://github.com/linuxmuster/linbo-build-docker)
