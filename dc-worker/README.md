# LINBO Docker - DC Worker

The DC Worker runs on the linuxmuster.net AD DC (Active Directory Domain Controller) and bridges LINBO Docker with the production infrastructure. It processes two types of jobs via Redis Streams:

- **Phase 8 — Machine Account Repair:** Fixes machine account passwords in `sam.ldb` so LINBO clients can domain-join
- **Phase 11 — Host Provisioning:** Creates/updates/deletes hosts via `linuxmuster-import-devices` with delta/merge strategy

Additionally, a **DHCP post-import hook** ensures that PXE clients managed by LINBO Docker boot from the Docker TFTP server instead of the production server.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ LINBO Docker Host                                                │
│                                                                  │
│  ┌─────────┐    ┌────────────┐    ┌──────────────────────────┐  │
│  │  API     │───→│ PostgreSQL │    │ Redis                    │  │
│  │ (3000)   │    │ operations │    │ Stream: linbo:jobs       │  │
│  └─────────┘    └────────────┘    └────────────┬─────────────┘  │
│                                                 │                │
│  ┌─────────┐                                    │                │
│  │  TFTP   │ ◄── PXE clients boot here          │                │
│  │ (69/udp)│                                    │                │
│  └─────────┘                                    │                │
└─────────────────────────────────────────────────┼────────────────┘
                                                  │ XREADGROUP
                                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ AD DC (linuxmuster.net server)                                   │
│                                                                  │
│  ┌──────────────────────────────────────┐                       │
│  │ macct-worker.service                  │                       │
│  │                                       │                       │
│  │  Phase 8:  repair_macct.py → sam.ldb  │                       │
│  │  Phase 11: delta/merge → devices.csv  │                       │
│  │            → linuxmuster-import-devices│                       │
│  │            → AD + DNS + DHCP          │                       │
│  └──────────────────────────────────────┘                       │
│                                                                  │
│  ┌──────────────────────────────────────┐                       │
│  │ 50-linbo-docker-dhcp (post-import)    │                       │
│  │                                       │                       │
│  │  Patches next-server in DHCP config   │                       │
│  │  → PXE clients → Docker TFTP         │                       │
│  └──────────────────────────────────────┘                       │
└──────────────────────────────────────────────────────────────────┘
```

## Why a Separate Worker?

Both machine account repair and host provisioning require direct access to the AD DC:

| Operation | Requires |
|-----------|----------|
| Machine account repair | `ldbmodify` on `sam.ldb` (root on DC) |
| Host provisioning | `linuxmuster-import-devices` (AD, DNS, DHCP, GRUB) |
| DHCP redirect | Write access to `/etc/dhcp/devices/*.conf` |

None of these can be done remotely or from a container. The worker architecture solves this:

1. LINBO Docker API creates "intent" jobs in a Redis Stream
2. The worker on the DC consumes jobs via `XREADGROUP`
3. The worker executes local commands with full system access
4. Results are reported back to the API

## Installation

### Prerequisites

- linuxmuster.net 7.3 server (AD DC)
- Python 3.8+ with `redis` and `requests` packages
- Network access from DC to LINBO Docker:
  - Redis: port 6379/tcp
  - API: port 3000/tcp

### Quick Install

```bash
# Copy dc-worker directory to DC
scp -r dc-worker/ root@10.0.0.11:/tmp/dc-worker/

# Run installer on DC
ssh root@10.0.0.11 '/tmp/dc-worker/install.sh 10.0.0.13'
```

The installer:
1. Checks prerequisites (root, linuxmuster.net server, Python deps)
2. Prompts for configuration (IP, API key, school, domain)
3. Tests connectivity (Redis + API)
4. Installs worker script + systemd service + config
5. Installs DHCP post-import hook + config
6. Enables service (does **not** start it — you start when ready)

### Manual Install

```bash
# Install dependencies
sudo apt-get install python3-pip python3-redis python3-requests

# Create directories
sudo mkdir -p /var/log/macct /var/log/linuxmuster

# Copy worker
sudo cp macct-worker.py /usr/local/bin/
sudo chmod +x /usr/local/bin/macct-worker.py

# Configure worker
sudo cp macct-worker.conf.example /etc/macct-worker.conf
sudo chmod 600 /etc/macct-worker.conf
sudo nano /etc/macct-worker.conf  # adjust settings

# Install service
sudo cp macct-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable macct-worker

# Install DHCP hook
sudo mkdir -p /var/lib/linuxmuster/hooks/device-import.post.d
sudo cp 50-linbo-docker-dhcp /var/lib/linuxmuster/hooks/device-import.post.d/
sudo chmod +x /var/lib/linuxmuster/hooks/device-import.post.d/50-linbo-docker-dhcp

# Configure DHCP hook
sudo cp linbo-docker-dhcp.conf.example /etc/linbo-docker-dhcp.conf
sudo nano /etc/linbo-docker-dhcp.conf  # adjust settings
```

### Upgrade from Phase 8 Only

If you installed the worker before Phase 11, your config is missing provisioning variables. The installer detects this:

```
[WARN] Existing config is missing 11 Phase 11 variables:
  SCHOOL=default-school
  DEVICES_CSV_MASTER=/etc/linuxmuster/sophomorix/{school}/devices.csv
  ...
```

Add the listed variables to `/etc/macct-worker.conf` manually, or remove the config and re-run the installer.

### Uninstall

```bash
sudo ./install.sh --uninstall
```

This removes the worker binary, service, DHCP hook, and DHCP config. The worker config (`/etc/macct-worker.conf`) and logs are preserved.

## Configuration

### Worker Config (`/etc/macct-worker.conf`)

#### Connection Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `localhost` | LINBO Docker Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | *(empty)* | Redis password |
| `REDIS_DB` | `0` | Redis database |
| `API_URL` | `http://localhost:3000/api/v1` | LINBO API URL |
| `API_KEY` | `linbo-internal-secret` | Internal API key |
| `CONSUMER_NAME` | `$(hostname)` | Unique consumer ID |
| `LOG_DIR` | `/var/log/macct` | Worker log directory |

#### Phase 8: Machine Account Repair

| Variable | Default | Description |
|----------|---------|-------------|
| `REPAIR_SCRIPT` | `/usr/share/linuxmuster/linbo/repair_macct.py` | Path to repair script |

#### Phase 11: Host Provisioning

| Variable | Default | Description |
|----------|---------|-------------|
| `SCHOOL` | `default-school` | School name (`{school}` placeholder) |
| `DEVICES_CSV_MASTER` | `/etc/linuxmuster/sophomorix/{school}/devices.csv` | Master devices file |
| `DEVICES_CSV_DELTA` | `/etc/linuxmuster/sophomorix/{school}/linbo-docker.devices.csv` | Delta file (Docker-managed) |
| `IMPORT_SCRIPT` | `/usr/sbin/linuxmuster-import-devices` | Import script path |
| `PROVISION_LOCK_FILE` | `/var/lock/linbo-provision.lock` | Provisioning lock file |
| `LINBO_DOMAIN` | `linuxmuster.lan` | DNS domain (`auto` = detect from Samba) |
| `DHCP_VERIFY_FILE` | `/etc/dhcp/devices/{school}.conf` | DHCP file for verify (empty = skip) |
| `SAMBA_TOOL_AUTH` | *(empty)* | Samba auth for delete cleanup |
| `REV_DNS_OCTETS` | `3` | Reverse DNS zone octets (3 = /24) |
| `PROVISION_BATCH_SIZE` | `50` | Max hosts per import batch |
| `PROVISION_DEBOUNCE_SEC` | `5` | Debounce window (seconds) |

> **Note:** Dry-run mode is controlled by the API (`DC_PROVISIONING_DRYRUN` env in docker-compose.yml). The worker reads `dryRun` from each operation's options.

### DHCP Hook Config (`/etc/linbo-docker-dhcp.conf`)

| Variable | Default | Description |
|----------|---------|-------------|
| `LINBO_DOCKER_IP` | *(required)* | IP of Docker host (TFTP server) |
| `SCHOOL` | `default-school` | School name |
| `DELTA_CSV` | `/etc/linuxmuster/sophomorix/{school}/linbo-docker.devices.csv` | Delta CSV with managed hosts |
| `DEVICES_DHCP` | `/etc/dhcp/devices/{school}.conf` | DHCP devices config to patch |
| `LOGFILE` | `/var/log/linuxmuster/linbo-docker-dhcp.log` | Hook log file |

## Phase 8: Machine Account Repair

When a LINBO client boots, it may fail to authenticate against Active Directory if the machine account password in `sam.ldb` is out of sync. The worker fixes this by running `repair_macct.py` locally on the DC.

**Flow:**
1. rsync pre-download hook or API call triggers `macct_repair` operation
2. API enqueues job to Redis Stream `linbo:jobs`
3. Worker picks up job, runs `repair_macct.py --only-hosts <hostname>`
4. Script modifies `sam.ldb` via `ldbmodify`
5. Worker reports success/failure back to API

## Phase 11: Host Provisioning

Creates, updates, or deletes hosts on the DC. Uses a delta/merge strategy to coexist with manually managed hosts in `devices.csv`.

**Flow:**
1. API creates `provision_host` operation with host details
2. Worker acquires file lock, debounces, drains batch
3. Applies changes to `linbo-docker.devices.csv` (delta file)
4. Merges delta into `devices.csv` (managed columns only: room, hostname, config, MAC, IP, role, pxeFlag)
5. Runs `linuxmuster-import-devices` (creates AD object, DNS records, DHCP config, GRUB config)
6. Post-import hook patches `next-server` in DHCP config (see below)
7. Verifies results (AD object, DNS A record, optionally DNS PTR + DHCP)
8. Reports per-host results back to API

**Delta CSV format (15 columns, semicolon-separated):**
```
room;hostname;config;MAC;IP;;;;;role;;pxeFlag;;;;
```

Column 10 (`pxeFlag`) is **required** — an empty value causes `sophomorix-device` to fail with exit code 88.

## DHCP Post-Import Hook

### The Problem

When `linuxmuster-import-devices` generates DHCP configs, the `next-server` directive (TFTP boot server) either points to the production server or is absent. PXE clients managed by LINBO Docker need `next-server` pointing to the Docker host.

### The Solution

The hook script `50-linbo-docker-dhcp` runs automatically after every device import (via linuxmuster's hook system). It:

1. Reads the delta CSV to identify Docker-managed hosts with `pxeFlag >= 1`
2. Patches `next-server <DOCKER_IP>` into their DHCP host blocks
3. Validates the result with `dhcpd -t` (if applicable)
4. Rolls back on syntax errors

### How It Works

The hook uses an AWK state machine that processes DHCP host blocks:

```
host pxe-test01 {                    ← Enters IN_BLOCK state
  option host-name "pxe-test01";
  hardware ethernet AA:BB:CC:DD:EE:FF;
  next-server 10.0.0.13;             ← Inserted/replaced by hook
  fixed-address 10.0.0.240;
  ...
}                                    ← Returns to OUTSIDE state
```

**Behavior per host:**
- **Not in Docker set:** Pass through unchanged
- **In Docker set, no `next-server`:** Insert after `hardware ethernet` line
- **In Docker set, wrong IP:** Replace existing `next-server` line
- **In Docker set, correct IP:** Skip (already patched)

**Safety:**
- Atomic write (write to `.tmp`, then `mv`)
- Backup created before patching
- `dhcpd -t` syntax check against full config
- Automatic rollback if syntax check fails
- No DHCP restart (left to `linuxmuster-import-devices`)

### Hook Location

```
/var/lib/linuxmuster/hooks/device-import.post.d/50-linbo-docker-dhcp
```

`linuxmuster-import-devices` runs all executable scripts in this directory after generating DHCP/DNS configs but before restarting DHCP. The hook receives `-s <school>` as argument.

## Network Requirements

Open these ports from DC to LINBO Docker host:

| Port | Protocol | Service | Direction |
|------|----------|---------|-----------|
| 6379 | TCP | Redis | DC → Docker |
| 3000 | TCP | API | DC → Docker |

### Firewall (on Docker host)

```bash
# Allow DC to connect
iptables -A INPUT -p tcp -s 10.0.0.11 --dport 6379 -j ACCEPT
iptables -A INPUT -p tcp -s 10.0.0.11 --dport 3000 -j ACCEPT
```

### Docker Compose

Ensure Redis port is exposed in `docker-compose.yml`:

```yaml
cache:
  ports:
    - "6379:6379"
```

## Usage

```bash
# Start worker
sudo systemctl start macct-worker

# Check status
sudo systemctl status macct-worker

# View worker logs
journalctl -u macct-worker -f

# View DHCP hook logs
tail -f /var/log/linuxmuster/linbo-docker-dhcp.log

# Test DHCP hook manually
/var/lib/linuxmuster/hooks/device-import.post.d/50-linbo-docker-dhcp -s default-school

# Stop worker
sudo systemctl stop macct-worker
```

## Verification

```bash
# Test Redis connection
redis-cli -h 10.0.0.13 ping

# Test API connection
curl http://10.0.0.13:3000/health

# Verify worker is processing jobs
journalctl -u macct-worker --since "1 hour ago" | grep -i provision

# Verify DHCP redirect
grep 'next-server' /etc/dhcp/devices/default-school.conf

# Full end-to-end test
# 1. Create host in LINBO Docker UI → triggers provisioning
# 2. Watch worker log: journalctl -u macct-worker -f
# 3. Watch DHCP hook log: tail -f /var/log/linuxmuster/linbo-docker-dhcp.log
# 4. Verify: grep 'next-server 10.0.0.13' /etc/dhcp/devices/default-school.conf
# 5. PXE-boot client → should reach Docker TFTP
```

## Troubleshooting

### Worker not starting

```bash
# Check logs
journalctl -u macct-worker -n 50

# Verify Python dependencies
python3 -c "import redis; import requests; print('OK')"

# Test with verbose logging
python3 /usr/local/bin/macct-worker.py --verbose
```

### Connection refused to Redis

1. Check if Redis port is exposed in `docker-compose.yml`
2. Check firewall rules on both hosts
3. Verify `REDIS_HOST` and `REDIS_PORT` in config
4. Test: `redis-cli -h <DOCKER_IP> -p 6379 ping`

### API errors

1. Check `API_URL` in config
2. Verify `API_KEY` matches `INTERNAL_API_KEY` in Docker
3. Test: `curl -H "X-Internal-Key: <key>" http://<IP>:3000/health`

### Provisioning fails with "exit code 88"

`sophomorix-device` requires `pxeFlag` (column 10) to be non-empty. Ensure hosts are provisioned with `pxeFlag >= 1`. Check the delta CSV:

```bash
cat /etc/linuxmuster/sophomorix/default-school/linbo-docker.devices.csv
# Each line must have 15 semicolon-separated fields with pxeFlag at position 10
```

### DHCP hook not running

1. Verify hook is installed and executable:
   ```bash
   ls -la /var/lib/linuxmuster/hooks/device-import.post.d/50-linbo-docker-dhcp
   ```
2. Check hook config exists:
   ```bash
   cat /etc/linbo-docker-dhcp.conf
   ```
3. Run manually:
   ```bash
   /var/lib/linuxmuster/hooks/device-import.post.d/50-linbo-docker-dhcp -s default-school
   ```
4. Check log:
   ```bash
   cat /var/log/linuxmuster/linbo-docker-dhcp.log
   ```

### DHCP hook runs but next-server not patched

1. Check delta CSV exists and has PXE-enabled hosts:
   ```bash
   awk -F';' '$11 >= 1 {print $2}' /etc/linuxmuster/sophomorix/default-school/linbo-docker.devices.csv
   ```
2. Check DHCP devices file has the host blocks:
   ```bash
   grep -c '^host ' /etc/dhcp/devices/default-school.conf
   ```

### DHCP hook rolled back

The hook rolls back if `dhcpd -t` fails. Check the log for the specific syntax error:

```bash
grep ERROR /var/log/linuxmuster/linbo-docker-dhcp.log
```

### Lock file stuck

If provisioning hangs due to a stale lock:

```bash
rm -f /var/lock/linbo-provision.lock
```

## Files

| File | Installed to | Description |
|------|-------------|-------------|
| `macct-worker.py` | `/usr/local/bin/macct-worker.py` | DC Worker (Phase 8 + 11) |
| `macct-worker.service` | `/etc/systemd/system/macct-worker.service` | Systemd unit |
| `macct-worker.conf.example` | `/etc/macct-worker.conf` | Worker config template |
| `install.sh` | *(run from source)* | Installer script |
| `50-linbo-docker-dhcp` | `/var/lib/linuxmuster/hooks/device-import.post.d/` | DHCP post-import hook |
| `linbo-docker-dhcp.conf.example` | `/etc/linbo-docker-dhcp.conf` | DHCP hook config template |

## Security Notes

- The `API_KEY` should be changed from default in production
- Worker config (`/etc/macct-worker.conf`) is mode 600 (root-only)
- Consider firewall rules to restrict Redis access to the DC only
- Logs may contain hostnames and IPs — protect log directories
- The worker runs as root (required for `ldbmodify` and `linuxmuster-import-devices`)
- `SAMBA_TOOL_AUTH` may contain plaintext credentials — keep config file secure
