# LINBO Docker - Scripts

## Quick Install (on fresh VM)

```bash
# One-liner installation
curl -fsSL https://raw.githubusercontent.com/amolani/linbo-docker/main/scripts/install.sh | sudo bash
```

Or manually:

```bash
git clone https://github.com/amolani/linbo-docker.git
cd linbo-docker
sudo ./scripts/install.sh
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `install.sh` | Full automated installation |
| `update.sh` | Pull latest changes and rebuild |
| `status.sh` | Quick health check of all services |
| `uninstall.sh` | Complete removal |

## Usage

### Install
```bash
sudo ./scripts/install.sh
```

The installer will:
1. Check/install dependencies (Docker, Docker Compose, git)
2. Clone repository to `/opt/linbo-docker`
3. Auto-detect server IP (configurable)
4. Generate secure random passwords
5. Start all containers
6. Create admin user

### Update
```bash
cd /opt/linbo-docker
sudo ./scripts/update.sh
```

### Status Check
```bash
sudo ./scripts/status.sh
```

### Uninstall
```bash
sudo ./scripts/uninstall.sh
```

## Post-Installation

### DHCP Configuration

Configure your DHCP server to point PXE clients to the LINBO server:

**For BIOS clients:**
```
next-server <LINBO_SERVER_IP>;
filename "boot/grub/i386-pc/core.0";
```

**For EFI clients:**
```
next-server <LINBO_SERVER_IP>;
filename "boot/grub/x86_64-efi/core.efi";
```

### Access

- **Web UI:** `http://<SERVER_IP>:8080`
- **API:** `http://<SERVER_IP>:3000`
- **Default login:** admin / admin123

## Troubleshooting

### Port 69 already in use
```bash
# Stop existing TFTP service
sudo systemctl stop tftpd-hpa
sudo systemctl disable tftpd-hpa
```

### Permission errors
```bash
# Fix volume permissions
sudo chown -R 1001:1001 /var/lib/docker/volumes/linbo-docker_srv_data/_data/
```

### Container won't start
```bash
# Check logs
docker logs linbo-api
docker logs linbo-db

# Restart everything
docker compose down
docker compose up -d
```
