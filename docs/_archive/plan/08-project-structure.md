# LINBO Docker - Projektstruktur

**Letzte Aktualisierung:** 2026-02-03 (Session 3)

## Verzeichnisübersicht

```
linbo-docker/
├── config/                         # Konfigurationsdateien
│   ├── init.sql                    # PostgreSQL Schema & Seed-Daten
│   └── rsyncd.conf                 # RSYNC-Daemon Konfiguration
│
├── containers/                     # Docker Container
│   ├── api/                        # REST-API Backend (Node.js)
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── jest.config.js          # Test-Konfiguration
│   │   ├── prisma/
│   │   │   └── schema.prisma       # Datenbank-Schema (ORM)
│   │   ├── src/
│   │   │   ├── index.js            # Haupteinstiegspunkt
│   │   │   ├── lib/
│   │   │   │   ├── prisma.js       # DB-Client Singleton
│   │   │   │   ├── redis.js        # Cache-Client
│   │   │   │   └── websocket.js    # WebSocket-Utilities
│   │   │   ├── middleware/
│   │   │   │   ├── auth.js         # JWT-Authentifizierung
│   │   │   │   ├── validate.js     # Zod-Validierung
│   │   │   │   └── audit.js        # Audit-Logging
│   │   │   ├── routes/
│   │   │   │   ├── index.js        # Route-Aggregator
│   │   │   │   ├── auth.js         # /auth Endpoints
│   │   │   │   ├── hosts.js        # /hosts Endpoints
│   │   │   │   ├── groups.js       # /groups Endpoints
│   │   │   │   ├── rooms.js        # /rooms Endpoints
│   │   │   │   ├── configs.js      # /configs Endpoints
│   │   │   │   ├── images.js       # /images Endpoints
│   │   │   │   ├── operations.js   # /operations Endpoints
│   │   │   │   └── stats.js        # /stats Endpoints
│   │   │   └── services/
│   │   │       ├── host.service.js # Host-Logik
│   │   │       ├── wol.service.js  # Wake-on-LAN
│   │   │       └── ssh.service.js  # SSH-Commands
│   │   └── tests/
│   │       ├── api.test.js         # API-Tests (39 Tests)
│   │       ├── helpers.js          # Test-Hilfsfunktionen
│   │       └── setup.js            # Jest-Setup
│   │
│   ├── rsync/                      # RSYNC-Server
│   │   └── Dockerfile
│   │
│   ├── ssh/                        # SSH-Server für Remote-Commands
│   │   ├── Dockerfile
│   │   ├── entrypoint.sh
│   │   └── helperfunctions.sh
│   │
│   ├── tftp/                       # TFTP-Server für PXE-Boot
│   │   ├── Dockerfile
│   │   └── tftpd-hpa.conf
│   │
│   └── web/                        # Web-Frontend (geplant)
│       ├── Dockerfile
│       └── nginx.conf
│
├── deploy/                         # Standalone Deployment
│   ├── docker-compose.yml          # Deployment-Compose
│   ├── install.sh                  # Auto-Installer
│   └── package.sh                  # Paket-Erstellung
│
├── docs/                           # Dokumentation
│   └── plan/
│       ├── 00-overview.md          # Projektübersicht
│       ├── 01-architecture.md      # Architektur
│       ├── 02-minimal-server.md    # MVP-Definition
│       ├── 03-api-design.md        # API-Spezifikation
│       ├── 04-data-models.md       # Datenmodelle
│       ├── 05-implementation-roadmap.md
│       ├── 06-implementation-status.md
│       ├── 07-test-results.md
│       └── 08-project-structure.md # Diese Datei
│
├── scripts/                        # Server-Skripte
│   └── server/
│       ├── linbo-ssh.sh
│       ├── linbo-scp.sh
│       └── ...
│
├── tests/                          # Test-Runner
│   ├── run-api-tests.sh
│   └── run-api-tests-docker.sh
│
├── volumes/                        # Docker Volumes
│   └── linbo/
│       └── boot/grub/              # GRUB-Boot-Dateien
│
├── docker-compose.yml              # Haupt-Compose-Datei
├── .env.example                    # Umgebungsvariablen-Template
└── README.md                       # Projekt-README
```

---

## Container-Übersicht

| Container | Image | Port | Funktion |
|-----------|-------|------|----------|
| linbo-db | postgres:15-alpine | 5432 | PostgreSQL Datenbank |
| linbo-cache | redis:7-alpine | 6379 | Redis Cache |
| linbo-api | linbo-docker_api | 3000 | REST-API Backend |
| linbo-ssh | linbo-docker_ssh | 2222 | SSH Remote-Commands |
| linbo-tftp | linbo-docker_tftp | 69/udp | PXE-Boot (TFTP) |
| linbo-rsync | linbo-docker_rsync | 873 | Image-Synchronisation |
| linbo-web | linbo-docker_web | 8080 | Web-Frontend (geplant) |

---

## API-Struktur

### Endpoints

| Pfad | Methoden | Beschreibung |
|------|----------|--------------|
| `/health` | GET | Health Check (alle Services) |
| `/ready` | GET | Readiness Check (DB) |
| `/api/v1` | GET | API-Dokumentation |
| `/api/v1/auth/*` | POST, GET, PUT | Authentifizierung |
| `/api/v1/hosts/*` | CRUD | Host-Verwaltung |
| `/api/v1/groups/*` | CRUD | Gruppen-Verwaltung |
| `/api/v1/rooms/*` | CRUD | Raum-Verwaltung |
| `/api/v1/configs/*` | CRUD | Konfigurationen |
| `/api/v1/images/*` | CRUD | Image-Verwaltung |
| `/api/v1/operations/*` | CRUD | Operationen |
| `/api/v1/stats/*` | GET | Statistiken |
| `/ws` | WebSocket | Real-time Events |

### Datenbank-Schema (Prisma)

| Modell | Beschreibung |
|--------|--------------|
| Room | Räume/Standorte |
| HostGroup | Gruppen von Hosts |
| Config | start.conf Konfigurationen |
| ConfigPartition | Partitions-Definitionen |
| ConfigOs | OS-Definitionen |
| Host | LINBO-Clients |
| Image | qcow2/qdiff Images |
| Operation | Batch-Operationen |
| Session | Einzelne Host-Sessions |
| User | API-Benutzer |
| ApiKey | API-Schlüssel |
| AuditLog | Audit-Trail |

---

## Deployment-Paket

**Datei:** `linbo-docker-YYYYMMDD.tar.gz`

**Erstellung:**
```bash
cd /root/linbo-docker/deploy
./package.sh
```

**Inhalt:**
- docker-compose.yml
- install.sh
- containers/
- config/
- README.md
- .env.example

---

## Test-Suite

**Ausführung:**
```bash
# Im Container
cd /root/linbo-docker/tests
./run-api-tests-docker.sh

# Oder direkt
docker exec linbo-api npm test
```

**Test-Kategorien:**
- Health Checks
- Authentication (JWT)
- CRUD für alle Entitäten
- Validierung
- Error-Handling
