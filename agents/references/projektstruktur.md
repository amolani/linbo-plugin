# Projektstruktur -- LINBO Docker

## Verzeichnisaufbau

```
linbo-docker/
├── CLAUDE.md                     # Claude Code Projektanweisungen
├── docker-compose.yml            # Alle Services, Volumes, Networks
├── .env                          # Umgebungsvariablen
├── Makefile                      # Build/Deploy/Test-Targets
├── init.sh                       # Container-Initialisierung
│
├── containers/                   # Docker-Container
│   ├── api/                      # REST-API (Express.js)
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── prisma/
│   │   │   └── schema.prisma     # Datenbankschema (12 Modelle)
│   │   ├── src/
│   │   │   ├── index.js          # Server-Einstiegspunkt (699 LOC)
│   │   │   ├── routes/           # 15 Route-Module
│   │   │   │   ├── index.js      # Route-Mounting (conditional)
│   │   │   │   ├── auth.js
│   │   │   │   ├── hosts.js
│   │   │   │   ├── rooms.js
│   │   │   │   ├── configs.js
│   │   │   │   ├── images.js
│   │   │   │   ├── operations.js
│   │   │   │   ├── sync.js
│   │   │   │   ├── sync-operations.js
│   │   │   │   ├── system.js
│   │   │   │   ├── patchclass.js
│   │   │   │   ├── settings.js
│   │   │   │   ├── terminal.js
│   │   │   │   ├── internal.js
│   │   │   │   ├── stats.js
│   │   │   │   └── dhcp.js
│   │   │   ├── services/         # 22 Service-Module (~16k LOC)
│   │   │   │   ├── sync.service.js
│   │   │   │   ├── host.service.js
│   │   │   │   ├── config.service.js
│   │   │   │   ├── grub.service.js
│   │   │   │   ├── grub-generator.js
│   │   │   │   ├── image-sync.service.js
│   │   │   │   ├── linbofs.service.js
│   │   │   │   ├── linbo-update.service.js
│   │   │   │   ├── kernel.service.js
│   │   │   │   ├── patchclass.service.js
│   │   │   │   ├── ssh.service.js
│   │   │   │   ├── remote.service.js
│   │   │   │   ├── terminal.service.js
│   │   │   │   ├── provisioning.service.js
│   │   │   │   ├── firmware.service.js
│   │   │   │   ├── dhcp.service.js
│   │   │   │   ├── settings.service.js
│   │   │   │   ├── wol.service.js
│   │   │   │   └── ...
│   │   │   ├── workers/          # Background-Jobs
│   │   │   │   ├── operation.worker.js
│   │   │   │   └── host-status.worker.js
│   │   │   ├── middleware/       # Express Middleware
│   │   │   │   ├── auth.js       # JWT + API-Key
│   │   │   │   ├── validate.js   # Zod-Validierung
│   │   │   │   └── audit.js      # Audit-Logging
│   │   │   └── lib/              # Shared Utilities
│   │   │       ├── prisma.js     # DB-Connection (optional)
│   │   │       ├── redis.js      # Redis-Client
│   │   │       ├── websocket.js  # WS-Broadcast
│   │   │       ├── lmn-api-client.js  # LMN API Client
│   │   │       ├── startconf-rewrite.js
│   │   │       └── ...
│   │   └── tests/                # Jest-Tests
│   │
│   ├── web/                      # Web-Frontend (nginx + React)
│   │   ├── Dockerfile
│   │   └── frontend/
│   │       ├── package.json
│   │       ├── vite.config.ts
│   │       ├── tsconfig.json
│   │       └── src/
│   │           ├── App.tsx
│   │           ├── main.tsx
│   │           ├── pages/        # 16 Seiten
│   │           ├── components/   # UI-Komponenten
│   │           ├── stores/       # 5 Zustand-Stores
│   │           ├── api/          # 14 API-Module
│   │           ├── hooks/        # Custom Hooks
│   │           └── types/        # TypeScript Interfaces
│   │
│   ├── tftp/                     # TFTP-Server
│   │   └── Dockerfile
│   ├── ssh/                      # SSH-Server (Port 2222)
│   │   └── Dockerfile
│   ├── rsync/                    # rsync-Daemon
│   │   └── Dockerfile
│   └── dhcp/                     # DHCP-Server (optional)
│       └── Dockerfile
│
├── scripts/                      # Server-Skripte
│   └── server/
│       ├── update-linbofs.sh     # Baut linbofs64 (SSH-Keys, Passwort-Hash, Kernel-Module, Firmware)
│       └── ...
│
├── config/                       # Konfigurationsdateien
│   ├── nginx.conf                # Web Reverse Proxy
│   └── ...
│
├── docs/                         # Dokumentation
│   ├── TROUBLESHOOTING.md
│   ├── GAP-ANALYSIS.md
│   ├── agents/                   # Agenten-Definitionen (dieses Setup)
│   └── ...
│
├── tests/                        # Projekt-weite Tests
├── themes/                       # GRUB-Themes
├── volumes/                      # Docker-Volume-Daten
│
└── docs/                         # Weitere Dokumentation
    └── ...
```

## Schluessel-Pfade zur Laufzeit

| Pfad (im Container) | Beschreibung |
|---|---|
| `/srv/linbo/` | Boot-Dateien, Images, start.conf |
| `/srv/linbo/boot/grub/` | GRUB-Konfigurationen |
| `/srv/linbo/images/` | QCOW2-Images |
| `/etc/linuxmuster/linbo/` | SSH-Keys, Templates |
| `/srv/linbo/linbo64` | LINBO-Kernel |
| `/srv/linbo/linbofs64` | LINBO-Initramfs |

## Code-Metriken

| Bereich | LOC (ca.) |
|---|---|
| API Routes | ~5,800 |
| API Services | ~16,000 |
| API Total | ~22,000 |
| Frontend | ~8,000 |
| Tests | ~4,000 |
| Scripts | ~2,000 |
| **Gesamt** | **~36,000** |
