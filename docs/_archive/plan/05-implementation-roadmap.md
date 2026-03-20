# LINBO Docker - Implementierungs-Roadmap

## Phasen-Übersicht

**Aktualisiert: 2026-02-03**

```
Phase 0: Vorbereitung & Setup          ✅ ABGESCHLOSSEN
    │
    ▼
Phase 1: Docker-Grundstruktur          ✅ ABGESCHLOSSEN
    │
    ▼
Phase 2: Core Services (TFTP/RSYNC)    ✅ ABGESCHLOSSEN
    │
    ▼
Phase 3: SSH & Remote-Steuerung        ✅ ABGESCHLOSSEN
    │
    ▼
Phase 4: REST-API Backend              ✅ ABGESCHLOSSEN
    │
    ▼
Phase 5: Web-Frontend MVP              ⏳ NÄCHSTER SCHRITT
    │
    ▼
Phase 6: Integration & Testing         ⏳ Geplant
    │
    ▼
Phase 7: Erweiterungen                 ⏳ Optional
```

**Detaillierter Status:** Siehe [06-implementation-status.md](./06-implementation-status.md)

---

## Phase 0: Vorbereitung & Setup

### Ziele
- Entwicklungsumgebung einrichten
- Projekt-Struktur erstellen
- CI/CD vorbereiten

### Aufgaben

#### 0.1 Repository Setup
- [ ] Neues Git-Repository erstellen
- [ ] `.gitignore` konfigurieren
- [ ] README.md mit Projektbeschreibung
- [ ] Lizenz (GPL) hinzufügen

#### 0.2 Entwicklungsumgebung
- [ ] Docker & Docker Compose installieren
- [ ] VS Code / IDE konfigurieren
- [ ] Linting & Formatting (ESLint, Prettier, etc.)

#### 0.3 Projekt-Struktur
```
linbo-docker/
├── .github/
│   └── workflows/
├── containers/
│   ├── tftp/
│   ├── rsync/
│   ├── ssh/
│   ├── api/
│   └── web/
├── config/
├── scripts/
├── volumes/
├── docs/
├── tests/
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── Makefile
└── README.md
```

#### 0.4 Original-LINBO-Dateien extrahieren
- [ ] linbofs64 aus Paket extrahieren
- [ ] linbo64 Kernel extrahieren
- [ ] GRUB-Dateien kopieren
- [ ] Beispiel-Konfigurationen kopieren

### Deliverables
- Funktionsfähiges Repository
- Dokumentierte Entwicklungsumgebung
- Extrahierte LINBO-Boot-Dateien

---

## Phase 1: Docker-Grundstruktur

### Ziele
- Basis-Container definieren
- Docker Compose Setup
- Volume-Struktur

### Aufgaben

#### 1.1 Base Images definieren
- [ ] Ubuntu 22.04 als Basis
- [ ] Alpine wo möglich (für kleinere Images)
- [ ] Multi-stage Builds für API

#### 1.2 Docker Compose
- [ ] `docker-compose.yml` erstellen
- [ ] Networks definieren (linbo-net)
- [ ] Volumes definieren
- [ ] Environment-Variablen

#### 1.3 Volume-Struktur initialisieren
- [ ] `/srv/linbo` Struktur erstellen
- [ ] Boot-Dateien platzieren
- [ ] Beispiel-Images (Test)

#### 1.4 Health Checks
- [ ] Health-Check für jeden Service
- [ ] Startup-Reihenfolge (depends_on)

### Deliverables
- `docker-compose.yml` funktionsfähig
- Alle Container starten erfolgreich
- Volumes korrekt gemountet

---

## Phase 2: Core Services (TFTP/RSYNC)

### Ziele
- PXE-Boot funktioniert
- Image-Synchronisation via rsync

### Aufgaben

#### 2.1 TFTP Container
- [ ] Dockerfile erstellen
- [ ] tftpd-hpa konfigurieren
- [ ] Boot-Dateien verfügbar machen
- [ ] Test: TFTP-Download funktioniert

#### 2.2 RSYNC Container
- [ ] Dockerfile erstellen
- [ ] rsyncd.conf erstellen
- [ ] Authentifizierung (rsyncd.secrets)
- [ ] Test: rsync pull/push funktioniert

#### 2.3 GRUB Konfiguration
- [ ] grub.cfg für Netzwerk-Boot
- [ ] UEFI und BIOS Support
- [ ] Kernel-Parameter definieren

#### 2.4 Test-Setup
- [ ] VM als Test-Client einrichten
- [ ] PXE-Boot testen
- [ ] LINBO-GUI startet

### Deliverables
- Test-Client bootet via PXE
- LINBO-GUI wird angezeigt
- start.conf wird geladen

---

## Phase 3: SSH & Remote-Steuerung

### Ziele
- SSH-Verbindung zu Clients
- linbo-remote funktioniert
- Commands können ausgeführt werden

### Aufgaben

#### 3.1 SSH Container
- [ ] Dockerfile erstellen
- [ ] SSH-Keys generieren
- [ ] Keys in linbofs einbetten (update-linbofs oder manuell)
- [ ] tmux installieren

#### 3.2 linbo-remote anpassen
- [ ] helperfunctions.sh ersetzen
- [ ] devices.csv Abhängigkeit entfernen
- [ ] API-basierte Host-Lookup vorbereiten
- [ ] Test: Einzelne Commands funktionieren

#### 3.3 SSH-Wrapper
- [ ] linbo-ssh.sh kopieren/anpassen
- [ ] linbo-scp.sh kopieren/anpassen
- [ ] Verbindungstest automatisieren

#### 3.4 Integration Test
- [ ] Client bootet in LINBO
- [ ] SSH-Verbindung von Server zu Client
- [ ] `linbo-remote -c hostname sync:1` funktioniert

### Deliverables
- Remote-Commands werden ausgeführt
- Session-Management (tmux) funktioniert
- Logs werden erstellt

---

## Phase 4: REST-API Backend

### Ziele
- REST-Endpunkte implementiert
- WebSocket für Real-time
- Datenbank-Integration

### Aufgaben

#### 4.1 Technologie-Entscheidung
- [ ] Framework wählen (Node.js/Express, Go/Gin, Python/FastAPI)
- [ ] ORM wählen (Prisma, GORM, SQLAlchemy)
- [ ] WebSocket-Library

#### 4.2 Datenbank Setup
- [ ] PostgreSQL Container
- [ ] Schema-Migrationen erstellen
- [ ] Seed-Daten für Tests

#### 4.3 API Grundstruktur
- [ ] Router/Endpoints definieren
- [ ] Middleware (Auth, Logging, Errors)
- [ ] Validation (Request/Response)

#### 4.4 Core Endpoints implementieren
- [ ] `GET/POST/PATCH/DELETE /hosts`
- [ ] `GET/POST/PATCH/DELETE /groups`
- [ ] `GET/POST/PATCH/DELETE /rooms`
- [ ] `GET/POST /configs`
- [ ] `GET /images`

#### 4.5 Operation Endpoints
- [ ] `POST /operations/send-command`
- [ ] `GET /operations/{id}`
- [ ] `POST /hosts/{id}/sync`
- [ ] `POST /hosts/{id}/start`
- [ ] `POST /hosts/{id}/wake-on-lan`

#### 4.6 WebSocket
- [ ] Connection-Handling
- [ ] Subscription-Channels
- [ ] Event-Broadcasting

#### 4.7 Integration mit SSH-Container
- [ ] Inter-Container-Kommunikation
- [ ] Command-Ausführung via API
- [ ] Progress-Streaming

### Deliverables
- Alle Core-Endpoints funktionieren
- WebSocket sendet Events
- API-Dokumentation (OpenAPI/Swagger)

---

## Phase 5: Web-Frontend MVP

### Ziele
- Dashboard mit Host-Übersicht
- Basis-Operationen ausführbar
- Real-time Status-Updates

### Aufgaben

#### 5.1 Technologie-Entscheidung
- [ ] Framework wählen (React, Vue.js, Svelte)
- [ ] UI-Library (Tailwind, shadcn/ui, Vuetify)
- [ ] State-Management

#### 5.2 Projekt-Setup
- [ ] Vite/Next.js Setup
- [ ] Routing
- [ ] API-Client (Axios/Fetch)
- [ ] WebSocket-Client

#### 5.3 Authentifizierung
- [ ] Login-Page
- [ ] JWT-Handling
- [ ] Protected Routes

#### 5.4 Dashboard
- [ ] Übersicht: Online/Offline Hosts
- [ ] Aktive Operationen
- [ ] Letzte Aktivitäten

#### 5.5 Host-Verwaltung
- [ ] Host-Liste mit Filter/Suche
- [ ] Host-Details-Seite
- [ ] Host erstellen/bearbeiten
- [ ] Bulk-Aktionen (Select multiple)

#### 5.6 Operationen
- [ ] Sync starten (einzeln/bulk)
- [ ] Start OS
- [ ] Wake-on-LAN
- [ ] Reboot/Shutdown
- [ ] Progress-Anzeige (Real-time)

#### 5.7 Konfigurationen
- [ ] Config-Liste
- [ ] Config-Editor (Partitionen, OS)
- [ ] Vorschau als start.conf
- [ ] Zuweisen an Gruppen/Räume

#### 5.8 Images
- [ ] Image-Liste
- [ ] Image-Details
- [ ] Upload-Status

### Deliverables
- Funktionsfähige Web-Oberfläche
- Alle MVP-Features nutzbar
- Responsive Design

---

## Phase 6: Integration & Testing

### Ziele
- End-to-End Tests
- Dokumentation
- Deployment-Ready

### Aufgaben

#### 6.1 Integration Tests
- [ ] API-Tests (Jest, Pytest, etc.)
- [ ] E2E-Tests (Playwright, Cypress)
- [ ] Load-Tests (k6, Artillery)

#### 6.2 Reale Hardware Tests
- [ ] Test mit echten PXE-Clients
- [ ] Verschiedene Hardware-Konfigurationen
- [ ] Windows und Linux Images

#### 6.3 Dokumentation
- [ ] Installation Guide
- [ ] User Guide
- [ ] API Reference
- [ ] Troubleshooting

#### 6.4 CI/CD
- [ ] GitHub Actions Workflows
- [ ] Automated Testing
- [ ] Docker Image Publishing

#### 6.5 Security Review
- [ ] Dependency Audit
- [ ] Secret Management
- [ ] Network Security

### Deliverables
- Getestete, stabile Version
- Vollständige Dokumentation
- CI/CD Pipeline

---

## Phase 7: Erweiterungen (Optional)

### BitTorrent Distribution
- [ ] opentracker kompilieren/Container
- [ ] ctorrent Integration
- [ ] Torrent-Erstellung automatisieren
- [ ] UI für Torrent-Status

### Multicast Distribution
- [ ] udpcast Container
- [ ] Multicast-Sessions verwalten
- [ ] UI für Multicast-Status

### Erweiterte Features
- [ ] Konfiguration Genehmigungsworkflow
- [ ] Scheduled Operations (Cron)
- [ ] Email-Benachrichtigungen
- [ ] LDAP/AD Integration
- [ ] Multi-Tenant Support

### Monitoring & Observability
- [ ] Prometheus Metrics
- [ ] Grafana Dashboards
- [ ] Loki für Logs
- [ ] Alerting

---

## Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Auswirkung | Mitigation |
|--------|-------------------|------------|------------|
| SSH-Key-Integration komplex | Hoch | Hoch | Frühzeitig testen, Fallback zu manuellem Embed |
| Performance bei vielen Clients | Mittel | Mittel | Load-Tests früh, Caching-Strategie |
| DHCP-Integration | Mittel | Hoch | Dokumentation für externe DHCP |
| Browser-Kompatibilität | Niedrig | Niedrig | Moderne Browser als Requirement |

---

## Erfolgs-Metriken

### MVP Erfolg
- [ ] 10 Clients können gleichzeitig gesynct werden
- [ ] < 5 Sekunden für Host-Status-Update
- [ ] 99% Uptime für Core-Services
- [ ] Dokumentation vollständig

### User Acceptance
- [ ] Sync funktioniert zuverlässig
- [ ] UI ist intuitiv bedienbar
- [ ] Keine kritischen Bugs

---

## Team & Ressourcen

### Empfohlene Skillsets
- Docker/Container-Expertise
- Backend-Entwicklung (Node.js/Go/Python)
- Frontend-Entwicklung (React/Vue)
- Linux-Administration
- Netzwerk-Kenntnisse (PXE, DHCP, TFTP)

### Tools
- Git/GitHub
- Docker/Docker Compose
- PostgreSQL
- Redis
- VS Code oder vergleichbar

---

## Nächste Schritte

1. **Repository erstellen** und Grundstruktur anlegen
2. **LINBO-Dateien extrahieren** aus Original-Paket
3. **Ersten Container (TFTP) bauen** und testen
4. **Test-VM einrichten** für PXE-Boot-Tests
