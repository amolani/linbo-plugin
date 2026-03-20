# LINBO Docker - Architektur

## Container-Übersicht

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DOCKER NETWORK (linbo-net)                       │
└─────────────────────────────────────────────────────────────────────────┘
         │              │              │              │              │
    ┌────┴────┐    ┌────┴────┐    ┌────┴────┐    ┌────┴────┐    ┌────┴────┐
    │  TFTP   │    │  RSYNC  │    │   SSH   │    │   API   │    │   WEB   │
    │ :69/udp │    │ :873    │    │ :2222   │    │ :3000   │    │ :8080   │
    └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘
         │              │              │              │              │
         └──────────────┴──────────────┼──────────────┴──────────────┘
                                       │
                              ┌────────┴────────┐
                              │  SHARED VOLUMES │
                              │  - /srv/linbo   │
                              │  - /etc/linbo   │
                              │  - /var/log     │
                              └────────┬────────┘
                                       │
                              ┌────────┴────────┐
                              │   PostgreSQL    │
                              │     + Redis     │
                              └─────────────────┘
```

## Container-Definitionen

### 1. TFTP Container (`linbo-tftp`)

**Funktion**: PXE-Boot-Dateien bereitstellen

```yaml
image: ubuntu:22.04 + tftpd-hpa
ports:
  - "69:69/udp"
volumes:
  - linbo_srv:/srv/linbo:ro
environment:
  - TFTP_ROOT=/srv/linbo
```

**Bereitgestellte Dateien**:
- `/srv/linbo/linbo64` - Kernel
- `/srv/linbo/linbofs64` - Initramfs
- `/srv/linbo/boot/grub/` - GRUB-Dateien

### 2. RSYNC Container (`linbo-rsync`)

**Funktion**: Image-Synchronisation und Konfigurationsverteilung

```yaml
image: ubuntu:22.04 + rsync
ports:
  - "873:873"
volumes:
  - linbo_srv:/srv/linbo
  - linbo_config:/etc/linuxmuster/linbo:ro
  - ./rsyncd.conf:/etc/rsyncd.conf:ro
  - ./rsyncd.secrets:/etc/rsyncd.secrets:ro
```

**RSYNC-Module**:
```ini
[linbo]
  path = /srv/linbo
  comment = LINBO data
  read only = no
  auth users = linbo
  secrets file = /etc/rsyncd.secrets
```

### 3. SSH Container (`linbo-ssh`)

**Funktion**: Remote-Verbindungen zu Clients

```yaml
image: ubuntu:22.04 + openssh-server + dropbear-bin + tmux
ports:
  - "2222:2222"
volumes:
  - linbo_srv:/srv/linbo
  - linbo_config:/etc/linuxmuster/linbo
  - ssh_keys:/root/.ssh
```

**Enthält**:
- `linbo-remote` (angepasst)
- `linbo-ssh.sh`, `linbo-scp.sh`
- SSH-Host-Keys
- tmux für Session-Management

### 4. API Container (`linbo-api`)

**Funktion**: REST-API und WebSocket-Server

```yaml
image: node:20-alpine / golang:1.21
ports:
  - "3000:3000"
volumes:
  - linbo_srv:/srv/linbo
  - linbo_config:/etc/linuxmuster/linbo
depends_on:
  - postgres
  - redis
  - linbo-ssh
environment:
  - DATABASE_URL=postgresql://...
  - REDIS_URL=redis://...
  - SSH_CONTAINER=linbo-ssh
```

**Verantwortlichkeiten**:
- REST-Endpunkte
- WebSocket-Events
- Datenbank-Zugriff
- Orchestrierung von SSH-Commands

### 5. Web Container (`linbo-web`)

**Funktion**: Frontend Web-Anwendung

```yaml
image: nginx:alpine + React/Vue Build
ports:
  - "8080:80"
depends_on:
  - linbo-api
```

**Features**:
- SPA (Single Page Application)
- Real-time Dashboard
- Host-Verwaltung
- Image-Management

### 6. Datenbank Container (`linbo-db`)

```yaml
image: postgres:15-alpine
volumes:
  - postgres_data:/var/lib/postgresql/data
environment:
  - POSTGRES_DB=linbo
  - POSTGRES_USER=linbo
  - POSTGRES_PASSWORD=${DB_PASSWORD}
```

### 7. Cache Container (`linbo-cache`)

```yaml
image: redis:7-alpine
volumes:
  - redis_data:/data
```

**Verwendung**:
- Host-Status-Cache
- Session-Daten
- Event-Queue

## Optionale Container

### BitTorrent (`linbo-torrent`)

```yaml
image: ubuntu:22.04 + ctorrent + opentracker
ports:
  - "6969:6969"
  - "6881-6889:6881-6889"
volumes:
  - linbo_srv:/srv/linbo
```

### Multicast (`linbo-multicast`)

```yaml
image: ubuntu:22.04 + udpcast
ports:
  - "9000-9100:9000-9100/udp"
volumes:
  - linbo_srv:/srv/linbo
```

## Volume-Struktur

```
volumes/
├── linbo_srv/                      # /srv/linbo
│   ├── linbo64                     # Kernel
│   ├── linbofs64                   # Initramfs
│   ├── linbo64.md5
│   ├── linbofs64.md5
│   ├── start.conf.default
│   ├── boot/
│   │   ├── grub/
│   │   │   ├── grub.cfg
│   │   │   ├── fonts/
│   │   │   └── themes/linbo/
│   │   └── pxe/
│   ├── images/                     # qcow2/qdiff Images
│   │   ├── win10.qcow2
│   │   ├── win10.qdiff
│   │   ├── ubuntu.qcow2
│   │   └── ...
│   ├── icons/                      # OS-Icons
│   ├── examples/                   # Beispiel-Configs
│   └── linbocmd/                   # OnBoot-Commands
│
├── linbo_config/                   # /etc/linuxmuster/linbo
│   ├── start.conf.default
│   ├── ssh_config
│   ├── ssh_host_*_key*
│   ├── dropbear_*_host_key
│   └── custom_kernel.ex
│
├── linbo_log/                      # /var/log/linuxmuster/linbo
│   ├── *.log
│   └── ...
│
├── postgres_data/                  # PostgreSQL
│
└── redis_data/                     # Redis Cache
```

## Netzwerk-Konfiguration

### Docker Network

```yaml
networks:
  linbo-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

### Port-Mapping

| Container | Port | Protokoll | Funktion |
|-----------|------|-----------|----------|
| tftp | 69 | UDP | PXE-Boot |
| rsync | 873 | TCP | Image-Sync |
| ssh | 2222 | TCP | Remote-Commands |
| api | 3000 | TCP | REST/WebSocket |
| web | 8080 | TCP | Web-UI |
| torrent | 6969 | TCP | Tracker |
| multicast | 9000+ | UDP | Massenverteilung |

### DHCP-Integration

LINBO benötigt DHCP-Optionen für den Boot-Prozess:

```
Option 66 (TFTP Server): <Docker-Host-IP>
Option 67 (Bootfile): boot/grub/grub.efi (UEFI) / pxelinux.0 (BIOS)
Option 119 (Domain Search): <hostgroup>
```

**Optionen für DHCP-Setup**:
1. Externer DHCP-Server (dnsmasq, ISC DHCP)
2. Eigener DHCP-Container (optional)

## Kommunikationsflüsse

### 1. Client-Boot-Sequenz

```
Client                TFTP            RSYNC           SSH
  │                    │                │               │
  │──PXE Boot (DHCP)──►│                │               │
  │◄──grub.efi────────│                │               │
  │◄──linbo64─────────│                │               │
  │◄──linbofs64───────│                │               │
  │                    │                │               │
  │──rsync start.conf─────────────────►│               │
  │◄──start.conf.$GROUP───────────────│               │
  │                    │                │               │
  │──SSH Connect (2222)────────────────────────────────►│
  │◄──Ready for Commands──────────────────────────────│
```

### 2. Remote-Command-Ausführung

```
WebApp              API              SSH             Client
  │                  │                │                 │
  │──POST /sync─────►│                │                 │
  │                  │──ssh linbo-ssh────────────────►│
  │                  │                │──linbo_sync───►│
  │◄──WS: Progress──│◄──Status──────│◄──Progress─────│
  │◄──WS: Complete──│◄──Complete────│◄──Complete─────│
```

### 3. Image-Upload

```
Client             RSYNC            API              WebApp
  │                  │               │                  │
  │──rsync upload───►│               │                  │
  │                  │──File Written─►│                 │
  │                  │               │──WS: New Image──►│
  │                  │               │──DB Update──────►│
```

## Skalierung

### Horizontal

- **API**: Mehrere Instanzen hinter Load Balancer
- **RSYNC**: Nur ein Master (Dateisystem-basiert)
- **SSH**: Nur ein Master (Session-Management)

### Vertikal

- **Images-Volume**: NFS/GlusterFS für große Deployments
- **PostgreSQL**: Replikation möglich
- **Redis**: Cluster-Mode für hohe Last

## Sicherheit

### Container-Isolation

- Keine privilegierten Container (außer für spezielle Netzwerk-Features)
- Read-only Root-Filesystem wo möglich
- Minimale Base-Images (Alpine wo möglich)

### Netzwerk-Segmentierung

- Interne Services nur über Docker-Network erreichbar
- Nur definierte Ports nach außen exponiert
- API authentifiziert alle Anfragen

### Secrets-Management

```yaml
secrets:
  db_password:
    file: ./secrets/db_password.txt
  rsync_password:
    file: ./secrets/rsync_password.txt
  ssh_key:
    file: ./secrets/ssh_host_key
```

## Health Checks

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

## Logging

### Centralized Logging

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

**Alternative**: Loki/Promtail für zentrales Log-Management

## Monitoring

- **Prometheus**: Metriken von API und Containern
- **Grafana**: Dashboards für Überwachung
- **Health-Endpoints**: `/health`, `/ready` für jeden Service
