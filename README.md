# LINBO Plugin

**Docker-basierter LINBO Network Boot Server**

[![Update Boot Files](https://github.com/amolani/linbo-docker/actions/workflows/update-boot-files.yml/badge.svg)](https://github.com/amolani/linbo-docker/actions/workflows/update-boot-files.yml)

LINBO Plugin ist eine containerisierte Version von [LINBO](https://github.com/linuxmuster/linuxmuster-linbo7) (Linux Network Boot). Es wird als Sync-Client an einen bestehenden linuxmuster.net-Server angebunden.

> **Installationsanleitung:** [docs/INSTALL.md](docs/INSTALL.md) -- Schritt-fuer-Schritt von einem frischen Server bis zum ersten PXE-Boot.
>
> **Admin-Handbuch:** Siehe [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) fuer Container-Architektur, Netzwerk-Diagramm und Firewall-Regeln.
>
> **Architektur-Diagramme:** Siehe [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) fuer Mermaid-Diagramme (IST/SOLL).
>
> **Unterschiede zu Vanilla-LINBO:** Siehe [docs/UNTERSCHIEDE-ZU-LINBO.md](docs/UNTERSCHIEDE-ZU-LINBO.md) -- was LINBO ist, was Docker anders macht, und warum.

## Features

### Boot & Imaging
- **PXE Network Boot** — Clients booten über TFTP + HTTP (GRUB)
- **HTTP Boot** — Kernel/Initrd via HTTP für 5-10x schnellere Transfers als TFTP
- **Image Management** — qcow2-Images erstellen, synchronisieren und deployen
- **Remote Control** — SSH-Befehle an Clients (sync, start, reboot, shutdown, WoL)

### Docker-exklusive Features
- **Treiber-Profile** -- Windows-Treiber via DMI-Matching automatisch installieren (match.conf + Postsync)
- **Firmware Auto-Detection** — Firmware von Clients per SSH scannen und in linbofs64 injizieren
- **Kernel Switching** — Zwischen stable/longterm/legacy Kernel-Varianten wechseln
- **Web Terminal** — Interaktive SSH-Sessions zu LINBO-Clients (xterm.js + WebSocket)
- **GRUB Theme** — Logo, Icons und Farben anpassen
- **React Frontend** — Moderne Web-Oberfläche mit Dark Theme

### Integration
- **Sync-Modus** — Read-Only Delta-Feed von linuxmuster.net Authority API
- **REST API** -- Express.js mit JWT-Authentifizierung
- **WebSocket** — Echtzeit-Updates für Host-Status, Operations, Sync-Fortschritt
- **DHCP** — Export für ISC DHCP / dnsmasq, optionaler Proxy-DHCP-Container

## Installation

> **Vollstaendige Installationsanleitung:** [docs/INSTALL.md](docs/INSTALL.md) -- Schritt-fuer-Schritt von einem frischen Server bis zum ersten PXE-Boot.

Kurzfassung:

```bash
git clone https://github.com/amolani/linbo-docker.git
cd linbo-docker
./setup.sh          # Interaktiver Setup-Assistent
docker compose up -d
make wait-ready      # Wartet bis alle Container bereit sind
make doctor          # 24 Diagnose-Checks
```

Web-UI: **http://\<LINBO_SERVER_IP\>:8080** -- Login: `admin` / `Muster!`

Sync-Modus einrichten: Siehe [INSTALL.md -- Sync-Modus](docs/INSTALL.md#7-sync-modus-einrichten).

## Architektur

```
                     LMN-Server (optional)
                    ┌──────────────────┐
                    │ Authority API    │
                    │ :8400            │
                    │ (Delta-Feed)     │
                    └────────┬─────────┘
                             │ Read-Only
                             ▼
┌─────────────────────────────────────────────────────────┐
│                   LINBO Plugin                          │
│                                                         │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────────┐ │
│  │ TFTP │  │RSYNC │  │ SSH  │  │ API  │  │   Web    │ │
│  │:69   │  │:873  │  │:2222 │  │:3000 │  │  :8080   │ │
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └────┬─────┘ │
│     └─────────┴─────────┴─────────┴────────────┘       │
│                         │                               │
│              ┌──────────┴──────────┐                    │
│              │   Redis    :6379    │                    │
│              │ (Cache, Status,     │                    │
│              │  Operations,        │                    │
│              │  Settings)          │                    │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
         ▲           ▲           ▲
         │           │           │
    ┌────┴───┐  ┌────┴───┐  ┌───┴────┐
    │ Client │  │ Client │  │ Client │
    │  PXE   │  │  PXE   │  │  PXE   │
    └────────┘  └────────┘  └────────┘
```

> Detaillierte Mermaid-Diagramme: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Container

| Container | Port | Beschreibung |
|-----------|------|-------------|
| `init` | — | Boot-Dateien herunterladen (einmalig) |
| `tftp` | 69/udp | PXE-Boot (GRUB-Configs) |
| `rsync` | 873 | Images + Treiber verteilen |
| `ssh` | 2222 | Remote Commands + Terminal |
| `api` | 3000 | REST API + WebSocket |
| `web` | 8080 | React SPA + HTTP Boot (Nginx) |
| `cache` | 6379 | Redis |
| `dhcp` | 67/udp | dnsmasq Proxy (optional, `--profile dhcp`) |

## Web-Interface Seiten

| Seite | Beschreibung |
|-------|-------------|
| Dashboard | Host-Übersicht, Speicher, letzte Operations |
| Hosts | Host-Liste mit Filter (Read-Only im Sync-Modus) |
| Rooms | Raum-Übersicht |
| Configs | start.conf-Editor mit Vorschau |
| Images | Image-Inventar (qcow2) |
| Operations | Echtzeit-Tracking aller Befehle |
| Drivers | Treiber-Verwaltung (DMI-Matching, Treiber-Profile) |
| Firmware | Auto-Detection + Injection |
| Kernel | Varianten-Wechsel + Status |
| Terminal | SSH-Sessions mit xterm.js |
| GRUB Theme | Logo, Icons, Farben |
| Sync | Sync-Status, Cursor, API-Health |
| Settings | Authority API, Passwort, Modus-Toggle |

## API-Endpoints

| Endpoint | Beschreibung |
|----------|-------------|
| `GET /health` | Health Check |
| `POST /api/v1/auth/login` | Authentifizierung |
| `GET /api/v1/auth/me` | Aktueller Benutzer |
| `GET /api/v1/sync/status` | Sync-Status |
| `POST /api/v1/sync/trigger` | Sync ausloesen |
| `GET /api/v1/sync/hosts` | Host-Liste (aus LMN-Sync) |
| `GET /api/v1/sync/configs` | Config-Liste |
| `GET /api/v1/images` | Image-Liste |
| `POST /api/v1/operations/direct` | Remote-Befehl (sync, start, reboot...) |
| `POST /api/v1/operations/wake` | Wake-on-LAN |
| `POST /api/v1/operations/schedule` | Onboot-Befehle planen |
| `POST /api/v1/drivers/create-profile` | Treiber-Profil erstellen (DMI) |
| `GET /api/v1/drivers/profiles` | Treiber-Profile auflisten |
| `GET /api/v1/settings` | Runtime-Einstellungen |
| `POST /api/v1/system/update-linbofs` | linbofs64 neu bauen |
| `POST /api/v1/system/kernel/switch` | Kernel-Variante wechseln |
| `GET /api/v1/terminal/sessions` | Terminal-Sessions |

## DHCP-Konfiguration

Bestehenden DHCP-Server fuer PXE konfigurieren:

```
# ISC DHCP
option architecture-type code 93 = unsigned integer 16;

if option architecture-type = 00:07 {
    filename "boot/grub/x86_64-efi/core.efi";
} elsif option architecture-type = 00:09 {
    filename "boot/grub/x86_64-efi/core.efi";
} else {
    filename "boot/grub/i386-pc/core.0";
}

next-server <LINBO_SERVER_IP>;
```

Oder den eingebauten DHCP-Proxy-Container nutzen:

```bash
docker compose --profile dhcp up -d
```

Detaillierte DHCP-Konfiguration (ISC DHCP, dnsmasq, Proxy-DHCP): [docs/INSTALL.md](docs/INSTALL.md#5-dhcp-konfiguration)

## Development

```bash
# Container bauen
docker compose build

# Mit Logs starten
docker compose up

# Tests ausführen (1135 Tests)
docker exec linbo-api npm test

# Container-Shell
docker exec -it linbo-api sh

```

### Makefile

```bash
make up              # Alle Container starten
make wait-ready      # Warten bis alle Container healthy
make doctor          # 24 Diagnose-Checks (6 Kategorien)
make health          # Quick Health-Check (API + Web)
make status          # Git + Docker Status
make deploy          # Deploy zum Testserver (rsync)
make deploy-full     # + linbofs + GRUB neu bauen
make test            # Tests ausfuehren
```

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| PXE kein Netzwerk | Kernel-Module pruefen: `make doctor` -- PXE Port Reachability |
| Control Mode | `linbo_gui64_7.tar.lz` fehlt auf dem Server |
| Buttons nicht klickbar | udevd tot → linbofs64 neu bauen |
| SSH refused | Port 22 vs 2222 prüfen |
| Keys fehlen nach Clone | Werden automatisch generiert (SSH-Container) |
| TFTP liefert unfertiges linbofs64 | TFTP wartet auf `.linbofs-patch-status` Marker (Build-Indikator) |
| 500 im Sync-Modus | Route-Mounting in routes/index.js prüfen |
| EACCES | `chown -R 1001:1001` auf Docker Volume |
| .env-Änderungen nicht aktiv | `docker compose up -d` statt `restart` |

Ausführliche Fehlerdiagnose: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Vergleich mit Production linuxmuster.net

| Feature | Production | LINBO Plugin |
|---------|-----------|-------------|
| PXE Network Boot | ✅ | ✅ |
| HTTP Boot (GRUB) | ❌ (nur TFTP) | ✅ |
| Image Sync (rsync) | ✅ | ✅ |
| Remote Commands | ✅ | ✅ |
| Config Deployment | ✅ | ✅ |
| GRUB Config Generation | ✅ | ✅ |
| DHCP Integration | ✅ | ✅ |
| Windows-Treiber (Treiber-Profile) | ❌ | ✅ |
| Firmware Auto-Detection | ❌ | ✅ |
| Kernel Switching | ❌ | ✅ |
| Web Terminal (xterm.js) | ❌ | ✅ |
| React Frontend | ❌ | ✅ |
| Multicast (udpcast) | ✅ | Geplant |
| Torrent (ctorrent) | ✅ | Geplant |
| Sophomorix/LDAP | ✅ | N/A |

## Lizenz

GPL-3.0 — siehe [LICENSE](LICENSE).

Basiert auf [linuxmuster-linbo7](https://github.com/linuxmuster/linuxmuster-linbo7) vom linuxmuster.net-Team.
