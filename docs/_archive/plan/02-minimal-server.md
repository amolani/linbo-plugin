# LINBO Docker - Minimaler Server (MVP)

## Übersicht

Dieses Dokument definiert die **absolut notwendigen Komponenten** für einen funktionsfähigen LINBO-Server in Docker.

## MUST-HAVE Komponenten

### 1. Server-Dienste

| Dienst | Port | Paket | Priorität |
|--------|------|-------|-----------|
| **TFTP** | 69/udp | tftpd-hpa | KRITISCH |
| **RSYNC** | 873 | rsync | KRITISCH |
| **SSH** | 2222 | openssh-server | KRITISCH |

### 2. Binaries und Tools

#### Essentiell

```bash
# Image-Handling
qemu-utils          # qemu-img, qemu-nbd für qcow2
rsync               # Synchronisation

# SSH/Remote
openssh-server      # SSH-Daemon
openssh-client      # SSH-Client
dropbear-bin        # Embedded SSH für Clients

# Session Management
tmux                # Background-Sessions für linbo-remote

# Boot
tftpd-hpa           # TFTP-Server

# Basis-Utilities
coreutils           # Standard-Tools
cpio                # Archiv-Format
tar                 # Archiv-Format
xz-utils            # Kompression (linbofs)
zstd                # Kompression (Kernel-Module)

# Scripting
bash                # Shell
python3             # Für Helper-Skripte
```

#### Nice-to-Have (Phase 2)

```bash
# BitTorrent
ctorrent            # BitTorrent-Client
opentracker         # BitTorrent-Tracker (muss gebaut werden)

# Multicast
udpcast             # UDP Multicast

# Wake-on-LAN
wakeonlan           # WoL-Pakete senden

# Zusätzliche Tools
parted              # Partitionierung
dosfstools          # FAT-Dateisysteme
e2fsprogs           # ext4-Dateisysteme
ntfs-3g             # NTFS-Support
```

### 3. Server-Skripte (aus serverfs/)

#### Kritisch

| Skript | Pfad | Funktion |
|--------|------|----------|
| **linbo-remote** | /usr/sbin/ | Zentrale Remote-Steuerung |
| **linbo-ssh.sh** | /usr/share/linuxmuster/linbo/ | SSH-Wrapper |
| **linbo-scp.sh** | /usr/share/linuxmuster/linbo/ | SCP-Wrapper |

#### Anpassungen erforderlich

Diese Skripte müssen für Docker angepasst werden:

1. **linbo-remote**
   - Entfernen: `source /usr/share/linuxmuster/helperfunctions.sh`
   - Ersetzen: Eigene Helper-Funktionen
   - Entfernen: WIMPORTDATA (devices.csv) Abhängigkeit
   - Ersetzen: API-basierte Host-Lookup

2. **update-linbofs** (optional für MVP)
   - Nur wenn linbofs neu gebaut werden muss
   - Kann initial vorgefertigtes linbofs nutzen

### 4. Konfigurationsdateien

```
/etc/linuxmuster/linbo/
├── ssh_config              # SSH-Client-Konfiguration
├── ssh_host_*_key*         # SSH-Host-Keys (generiert)
├── dropbear_*_host_key     # Dropbear-Keys (generiert)
└── start.conf.default      # Default-Konfiguration
```

**ssh_config** (minimal):
```
Host *
  Port 2222
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
  ConnectTimeout 5
```

### 5. Boot-Dateien

```
/srv/linbo/
├── linbo64                 # Kernel (aus Original-Paket)
├── linbo64.md5
├── linbofs64               # Initramfs (aus Original-Paket)
├── linbofs64.md5
├── start.conf.default
└── boot/
    └── grub/
        ├── grub.cfg        # GRUB-Konfiguration
        ├── x86_64-efi/     # GRUB EFI-Module
        └── fonts/
```

### 6. RSYNC-Konfiguration

**/etc/rsyncd.conf**:
```ini
pid file = /var/run/rsyncd.pid
log file = /var/log/rsync.log
transfer logging = true
use chroot = yes
read only = no

[linbo]
  path = /srv/linbo
  comment = LINBO data
  uid = root
  gid = root
  read only = no
  auth users = linbo
  secrets file = /etc/rsyncd.secrets
  hosts allow = *
  dont compress = *.qcow2 *.qdiff *.iso *.xz *.gz *.bz2 *.zip
```

**/etc/rsyncd.secrets**:
```
linbo:geheimespasswort
```

## Docker Compose (MVP)

```yaml
version: '3.8'

services:
  # TFTP Server
  tftp:
    build:
      context: ./containers/tftp
    ports:
      - "69:69/udp"
    volumes:
      - linbo_srv:/srv/linbo:ro
    restart: unless-stopped

  # RSYNC Daemon
  rsync:
    build:
      context: ./containers/rsync
    ports:
      - "873:873"
    volumes:
      - linbo_srv:/srv/linbo
      - ./config/rsyncd.conf:/etc/rsyncd.conf:ro
      - ./secrets/rsyncd.secrets:/etc/rsyncd.secrets:ro
    restart: unless-stopped

  # SSH Server für Remote-Commands
  ssh:
    build:
      context: ./containers/ssh
    ports:
      - "2222:2222"
    volumes:
      - linbo_srv:/srv/linbo
      - linbo_config:/etc/linuxmuster/linbo
      - ./scripts:/usr/share/linuxmuster/linbo
    restart: unless-stopped

  # API Backend
  api:
    build:
      context: ./containers/api
    ports:
      - "3000:3000"
    volumes:
      - linbo_srv:/srv/linbo
      - linbo_config:/etc/linuxmuster/linbo
    environment:
      - DATABASE_URL=postgresql://linbo:${DB_PASSWORD}@db:5432/linbo
      - REDIS_URL=redis://cache:6379
      - SSH_HOST=ssh
      - SSH_PORT=22
    depends_on:
      - db
      - cache
      - ssh
    restart: unless-stopped

  # PostgreSQL Datenbank
  db:
    image: postgres:15-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=linbo
      - POSTGRES_USER=linbo
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    restart: unless-stopped

  # Redis Cache
  cache:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

  # Web Frontend
  web:
    build:
      context: ./containers/web
    ports:
      - "8080:80"
    depends_on:
      - api
    restart: unless-stopped

volumes:
  linbo_srv:
  linbo_config:
  postgres_data:
  redis_data:

networks:
  default:
    name: linbo-net
```

## Dockerfile: TFTP

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    tftpd-hpa \
    && rm -rf /var/lib/apt/lists/*

COPY tftpd-hpa.conf /etc/default/tftpd-hpa

EXPOSE 69/udp

CMD ["in.tftpd", "-L", "-s", "/srv/linbo"]
```

## Dockerfile: RSYNC

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    rsync \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 873

CMD ["rsync", "--daemon", "--no-detach", "--config=/etc/rsyncd.conf"]
```

## Dockerfile: SSH

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    openssh-server \
    openssh-client \
    dropbear-bin \
    tmux \
    qemu-utils \
    rsync \
    wakeonlan \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# SSH-Konfiguration
RUN mkdir -p /var/run/sshd
RUN echo 'Port 2222' >> /etc/ssh/sshd_config
RUN echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config

# Skripte kopieren
COPY linbo-remote /usr/sbin/
COPY linbo-ssh.sh /usr/share/linuxmuster/linbo/
COPY linbo-scp.sh /usr/share/linuxmuster/linbo/

# Helper-Funktionen (ersetzt linuxmuster helperfunctions)
COPY docker-helperfunctions.sh /usr/share/linuxmuster/helperfunctions.sh

EXPOSE 2222

CMD ["/usr/sbin/sshd", "-D"]
```

## Ersetzte Helper-Funktionen

**docker-helperfunctions.sh**:
```bash
#!/bin/bash
# Ersatz für /usr/share/linuxmuster/helperfunctions.sh

# Konfiguration
LINBODIR="/srv/linbo"
LINBOIMGDIR="/srv/linbo/images"
LINBOSYSDIR="/etc/linuxmuster/linbo"
LINBOSHAREDIR="/usr/share/linuxmuster/linbo"
LINBOLOGDIR="/var/log/linuxmuster/linbo"
LINBOVARDIR="/var/lib/linuxmuster/linbo"

# Validierung
validhostname() {
    [[ "$1" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]]
}

validip() {
    local ip="$1"
    [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
}

validmac() {
    local mac="$1"
    [[ "$mac" =~ ^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$ ]]
}

isinteger() {
    [[ "$1" =~ ^[0-9]+$ ]]
}

# Host-Lookup (ersetzt devices.csv)
# Muss durch API-Aufruf ersetzt werden
get_ip() {
    local hostname="$1"
    # API-Call: curl -s http://api:3000/api/v1/hosts/by-name/$hostname | jq -r '.ipAddress'
    echo ""
}

get_mac() {
    local hostname="$1"
    # API-Call: curl -s http://api:3000/api/v1/hosts/by-name/$hostname | jq -r '.macAddress'
    echo ""
}

get_bcaddress() {
    local ip="$1"
    # Broadcast für Wake-on-LAN
    local network=$(echo "$ip" | cut -d. -f1-3)
    echo "${network}.255"
}

# Logging
linbo_log() {
    local level="$1"
    local message="$2"
    echo "$(date '+%Y-%m-%d %H:%M:%S') [$level] $message" >> "$LINBOLOGDIR/linbo.log"
}
```

## Was weggelassen werden kann (linuxmuster-spezifisch)

| Komponente | Original-Pfad | Ersatz |
|------------|---------------|--------|
| devices.csv | /etc/linuxmuster/sophomorix/.../devices.csv | PostgreSQL |
| helperfunctions.sh | /usr/share/linuxmuster/helperfunctions.sh | docker-helperfunctions.sh |
| environment.sh | /usr/share/linuxmuster/environment.sh | Docker ENV |
| DHCP-Leases | /var/lib/linuxmuster/dhcp-leases.db | Externe DHCP |
| Samba/LDAP | - | Nicht benötigt |
| linuxmuster-base7 | - | Nicht benötigt |
| linuxmuster-webui7 | - | Eigenes Frontend |

## Checkliste: MVP-Funktionalität

### Boot & Deployment
- [ ] Client kann via PXE booten
- [ ] GRUB lädt Kernel und linbofs
- [ ] Client lädt start.conf via rsync
- [ ] Client zeigt LINBO-GUI

### Remote-Steuerung
- [ ] SSH-Verbindung zu Clients funktioniert
- [ ] linbo-remote sendet Commands
- [ ] Wake-on-LAN funktioniert

### Image-Management
- [ ] Images liegen in /srv/linbo/images
- [ ] Client kann Image downloaden (rsync)
- [ ] Client kann Image syncen
- [ ] Client kann Image uploaden

### API
- [ ] REST-Endpunkte für Hosts
- [ ] REST-Endpunkte für Operations
- [ ] WebSocket für Status-Updates

### Web-UI
- [ ] Host-Liste anzeigen
- [ ] Host-Status (online/offline)
- [ ] Sync/Start/Reboot auslösen
- [ ] Image-Übersicht

## Geschätzte Ressourcen

| Ressource | Minimum | Empfohlen |
|-----------|---------|-----------|
| RAM | 2 GB | 4 GB |
| CPU | 2 Cores | 4 Cores |
| Disk (System) | 10 GB | 20 GB |
| Disk (Images) | Nach Bedarf | SSD empfohlen |

## Nächste Schritte

1. **Container-Images bauen**
2. **SSH-Keys generieren und einbetten**
3. **linbo-remote anpassen**
4. **API-Grundstruktur implementieren**
5. **GRUB-Konfiguration erstellen**
6. **Test mit echtem PXE-Client**
