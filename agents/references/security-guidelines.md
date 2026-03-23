# Sicherheitsrichtlinien -- LINBO Docker

## Allgemeine Regeln

1. **Keine Secrets im Code** -- Alles ueber `.env` oder Auto-Provisioning
2. **SSH-Keys nicht im Git** -- Werden beim Start automatisch generiert
3. **Input validieren** -- Zod an jeder API-Grenze
4. **Path-Traversal verhindern** -- Datei-Pfade immer sanitisieren
5. **Fehler nicht leaken** -- Keine Stack Traces an Clients
6. **Logging ohne Secrets** -- Keine Tokens oder Keys in Logs

## Authentifizierung

### JWT-Strategie
- Access Token: JWT, HS256, konfigurierbare Lebensdauer
- Kein Refresh Token (Admin-Tool, Session-basiert)
- Bei 401: Frontend redirectet zu /login
- Token in localStorage (akzeptabler Kompromiss fuer Admin-Tool)

### API-Keys
- Fuer Service-to-Service-Kommunikation (init -> API)
- In DB gespeichert (gehashed mit bcrypt)
- Header: `X-API-Key`
- Kein Ablaufdatum (manuell rotierbar)

### Authority API Auth
- Bearer Token (statisch konfiguriert)
- IP-Allowlist auf LMN-Server-Seite
- Nur ausgehende Verbindungen (Docker -> LMN)

## SSH-Key-Management

### Lebenszyklus
1. Erster Start: SSH-Container generiert alle Keys automatisch
2. Keys werden in `/etc/linuxmuster/linbo/` gespeichert (Volume)
3. Client-Key wird beim linbofs64-Build eingebettet
4. Keys persistieren ueber Container-Neustarts (Volume)

### Key-Typen
| Key | Zweck | Speicherort |
|---|---|---|
| ssh_host_rsa_key | Server-Identitaet | /etc/linuxmuster/linbo/ |
| linbo_client_key | Client -> Server SSH | /etc/linuxmuster/linbo/ |
| Dropbear Host Key | Client SSH-Server | In linbofs64 eingebettet |

## Container-Sicherheit

### Netzwerk-Isolation
- PXE-Netzwerk (TFTP, DHCP): host-Netzwerkmodus fuer UDP
- Management-Netzwerk (API, Web): Bridge mit Port-Mapping
- Redis/PostgreSQL: Nur intern erreichbar

### Port-Exposure
| Port | Service | Extern? |
|---|---|---|
| 67/udp | DHCP | Ja (PXE) |
| 69/udp | TFTP | Ja (PXE) |
| 873 | rsync | Ja (Image-Sync) |
| 2222 | SSH | Ja (Client-Zugriff) |
| 3000 | API | Nur intern (via nginx) |
| 5432 | PostgreSQL | Nur intern |
| 6379 | Redis | Nur intern |
| 8080 | Web/nginx | Ja (Admin-Dashboard) |

### Volume-Permissions
- `/srv/linbo/`: Schreibzugriff fuer init, tftp, rsync, api
- `/etc/linuxmuster/linbo/`: Schreibzugriff fuer ssh, init
- Postgres/Redis-Daten: Nur fuer eigenen Container

## API-Sicherheit

### Input-Validierung
- Alle Endpunkte: Zod-Schema-Validierung via `validate.js` Middleware
- MAC-Adressen: Regex-Validierung
- IP-Adressen: `z.string().ip()`
- Dateinamen: Path-Traversal-Check (kein `..`, keine absoluten Pfade)
- Dateigroessen: Limits fuer Uploads

### Autorisierung
- Alle Endpunkte (ausser /auth/login): JWT oder API-Key erforderlich
- Keine granularen Rollen (alle Admins haben vollen Zugriff)
- Sync-Mode: Bestimmte Endpunkte automatisch deaktiviert (409)

### Rate Limiting
- Aktuell nicht implementiert (internes Admin-Tool)
- Empfohlen fuer: /auth/login, /system/*, /terminal/*

## Boot-Chain-Sicherheit

### Trusted Boot
- TFTP: Keine Authentifizierung (Standard PXE-Limitation)
- GRUB: Laedt Kernel und Initramfs ohne Signatur-Pruefung
- Risiko: Man-in-the-Middle im PXE-Netzwerk
- Mitigation: Dediziertes PXE-VLAN empfohlen

### Client-Keys
- SSH-Client-Key in linbofs64 eingebettet
- Jede linbofs64-Instanz hat den gleichen Client-Key
- Host-Verifizierung via known_hosts

## Bekannte Limitierungen

1. **Kein HTTPS**: Admin-Dashboard ueber HTTP (internes Netzwerk)
2. **Keine Token-Rotation**: Access Token bis zum Ablauf gueltig
3. **Keine Role-Based Access Control**: Alle Admins sind gleichberechtigt
4. **PXE unsigniert**: Standard-PXE-Limitation, kein Secure Boot
5. **Shared Client-Key**: Alle Clients nutzen denselben SSH-Key
