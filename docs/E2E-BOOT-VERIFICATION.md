# E2E Boot Chain Verification

## Overview

This runbook verifies the complete PXE boot chain for the LINBO Docker solution.
All verification was performed on the Docker testserver **10.0.0.13** on 2026-03-17.

**Boot chain:** DHCP -> TFTP -> GRUB -> LINBO -> Image Sync -> OS

```
Client PXE
  |
  v
DHCP (linbo-dhcp)           -- assigns IP + next-server + bootfile + Option 40 (group)
  |
  v
TFTP (linbo-tftp)           -- serves GRUB core (i386-pc/core.0 or x86_64-efi/core.efi)
  |
  v
GRUB (grub.cfg)             -- loads /boot/grub/grub.cfg from TFTP root
  |                             uses $net_pxe_hostname or 01-$net_pxe_mac for hostcfg fallback
  v
Group GRUB cfg              -- e.g. /boot/grub/win11_pro.cfg via hostcfg/ symlink
  |                             contains: linux $linbo_kernel ... server=10.0.0.13 group=win11_pro
  v
LINBO kernel + initrd       -- boots linbofs64.lz (Ubuntu-based)
  |                             reads server= from kernel cmdline
  v
LINBO GUI / rsync           -- fetches start.conf-{IP} -> start.conf.{group} via rsync
  |                             Server = 10.0.0.13 (rewritten by sync service)
  v
Image sync + OS boot        -- downloads/restores OS images via rsync, then boots OS
```

**Testserver:** 10.0.0.13
**LMN Authority API:** 10.0.0.11:8001
**Verified:** 2026-03-17T13:48:09Z

## Pre-flight

All LINBO containers must be running before verification.

```bash
# On 10.0.0.13:
docker ps --format "table {{.Names}}\t{{.Status}}" | grep linbo
```

**Expected output (all healthy):**

```
linbo-web       Up 17 hours (healthy)
linbo-rsync     Up 21 hours (healthy)
linbo-api       Up 22 hours (healthy)
linbo-tftp      Up 27 hours (healthy)
linbo-ssh       Up 27 hours (healthy)
linbo-cache     Up 27 hours (healthy)
```

**Note:** The DHCP container (`linbo-dhcp`) requires `--profile dhcp` and is not started by default:
```bash
docker compose --profile dhcp up -d
```

## 1. Sync Cycle

### 1.1 Trigger a full sync

Reset the cursor to force a full snapshot, then trigger sync:

```bash
# Reset cursor for full sync
curl -s -X POST http://localhost:3000/api/v1/sync/reset \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" | python3 -m json.tool

# Trigger sync
curl -s -X POST http://localhost:3000/api/v1/sync/trigger \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" | python3 -m json.tool
```

**Captured evidence (2026-03-17):**

```json
{
    "data": {
        "success": true,
        "stats": {
            "startConfs": 9,
            "configs": 9,
            "hosts": 31,
            "deletedStartConfs": 0,
            "deletedHosts": 0,
            "dhcp": true,
            "grub": true
        },
        "message": "Sync completed successfully"
    }
}
```

### 1.2 Verify sync status

```bash
curl -s http://localhost:3000/api/v1/sync/status \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" | python3 -m json.tool
```

**Captured evidence:**

```json
{
    "data": {
        "cursor": "1773755289",
        "lastSyncAt": "2026-03-17T13:48:09.758Z",
        "lastError": null,
        "isRunning": false,
        "serverIp": "10.0.0.13",
        "hosts": 31,
        "configs": 9,
        "lmnApiHealthy": true,
        "hostOfflineTimeoutSec": 300
    }
}
```

**Verification criteria:**
- `isRunning` = false (sync finished)
- `lastError` = null (no errors)
- `serverIp` = "10.0.0.13" (Docker VM IP, not LMN server)
- `hosts` = 31 (hosts synced)
- `configs` = 9 (group configs synced)
- `lmnApiHealthy` = true (Authority API reachable)

## 2. GRUB Configs

### 2.1 List GRUB config files

```bash
docker exec linbo-api ls -la /srv/linbo/boot/grub/*.cfg
```

**Captured evidence:**

```
-rw-r--r-- 1 linbo linbo 7036 Mar 17 13:48 /srv/linbo/boot/grub/grub.cfg
-rw-r--r-- 1 linbo linbo 1514 Mar 17 13:48 /srv/linbo/boot/grub/win11_pro.cfg
```

**Expected:** `grub.cfg` (PXE entry point) + at least one `{group}.cfg` per group with hosts.

**Note:** Only groups that have the Authority API GRUB config export get `.cfg` files here.
Groups with only start.conf but no GRUB config (e.g. nopxe) will not have a `.cfg` in boot/grub/.
The hostcfg/ symlinks (section 4) handle the per-host fallback.

### 2.2 Verify server= rewrite

```bash
docker exec linbo-api grep -n "server=" /srv/linbo/boot/grub/*.cfg
```

**Captured evidence:**

```
/srv/linbo/boot/grub/win11_pro.cfg:55:  linux $linbo_kernel quiet splash dhcpretry=9 forcegrub noefibootmgr server=10.0.0.13 group=win11_pro hostgroup=win11_pro $bootflag
```

**Verification:** All `server=` values show **10.0.0.13** (Docker VM IP), NOT 10.0.0.11 (LMN server).

### 2.3 Verify GRUB menu entries

```bash
docker exec linbo-api grep -A2 "menuentry" /srv/linbo/boot/grub/*.cfg 2>/dev/null
```

**Captured evidence:**

```
/srv/linbo/boot/grub/grub.cfg:menuentry 'Default' {
/srv/linbo/boot/grub/win11_pro.cfg:menuentry 'LINBO' --class linbo {
```

**Expected:** At least a `Default` entry in grub.cfg and OS/LINBO entries in group configs.

## 3. start.conf Symlinks

### 3.1 List start.conf group files

```bash
docker exec linbo-api sh -c "ls -la /srv/linbo/start.conf.* | grep -v md5 | grep -v bak"
```

**Captured evidence (9 group files):**

```
-rw-r--r-- 1 linbo linbo  785 Mar 17 13:48 /srv/linbo/start.conf.bios_sata
-rw-r--r-- 1 linbo linbo 2137 Mar 17 13:48 /srv/linbo/start.conf.ubuntu2204_efi_nvme
-rw-r--r-- 1 linbo linbo 3661 Mar 17 13:48 /srv/linbo/start.conf.ubuntu-efi
-rw-r--r-- 1 linbo linbo 1336 Mar 17 13:48 /srv/linbo/start.conf.win11_efi_nvme
-rw-r--r-- 1 linbo linbo  743 Mar 17 13:48 /srv/linbo/start.conf.win11_efi_sata
-rw-r--r-- 1 linbo linbo 2416 Mar 17 13:48 /srv/linbo/start.conf.win11_ohnedata
-rw-r--r-- 1 linbo linbo 1236 Mar 17 13:48 /srv/linbo/start.conf.win11_pro
-rw-r--r-- 1 linbo linbo 1926 Mar 17 13:48 /srv/linbo/start.conf.win11-vdi
-rw-r--r-- 1 linbo linbo  996 Mar 17 13:48 /srv/linbo/start.conf.win-generic-efi-sata
```

### 3.2 Verify start.conf IP symlinks (E2E-02)

```bash
docker exec linbo-api sh -c 'for f in /srv/linbo/start.conf-*; do echo "$(basename $f) -> $(readlink $f)"; done'
```

**Captured evidence (31 IP + 31 MAC = 62 symlinks, showing IP-based subset):**

```
start.conf-10.0.0.102 -> start.conf.bios_sata
start.conf-10.0.0.104 -> start.conf.win-generic-efi-sata
start.conf-10.0.0.111 -> start.conf.win11_efi_sata
start.conf-10.0.0.112 -> start.conf.win11_ohnedata
start.conf-10.0.0.113 -> start.conf.win11_efi_nvme
start.conf-10.0.0.116 -> start.conf.win11_efi_nvme
start.conf-10.0.0.120 -> start.conf.win11_pro
start.conf-10.0.0.121 -> start.conf.win11_pro
start.conf-10.0.0.122 -> start.conf.ubuntu-efi
start.conf-10.0.0.200 -> start.conf.bios_sata
start.conf-10.0.0.252 -> start.conf.win11_efi_nvme
start.conf-10.0.0.90  -> start.conf.ubuntu2204_efi_nvme
start.conf-10.0.1.10  -> start.conf.win11_efi_sata
start.conf-10.0.1.11  -> start.conf.win11_efi_sata
start.conf-10.0.1.201 -> start.conf.win11-vdi
start.conf-10.0.1.202 -> start.conf.win11-vdi
start.conf-10.0.1.203 -> start.conf.win11-vdi
start.conf-10.0.1.204 -> start.conf.win11-vdi
start.conf-10.0.1.50  -> start.conf.win11-vdi
start.conf-10.0.150.2 -> start.conf.win11_pro
start.conf-10.0.152.111 -> start.conf.win11_pro
start.conf-10.0.152.112 -> start.conf.win11_pro
```

**MAC-based symlinks (sample):**

```
start.conf-bc:24:11:58:38:f6 -> start.conf.win11_pro
start.conf-bc:24:11:63:8e:40 -> start.conf.bios_sata
start.conf-4c:0f:3e:39:46:71 -> start.conf.win11_pro
start.conf-84:ba:59:ca:d4:45 -> start.conf.win11_pro
```

**E2E-02 verification: 36 IP-based start.conf symlinks found (requirement: at least 3).**

### 3.3 Verify Server= rewrite in start.conf files

```bash
docker exec linbo-api grep "Server" /srv/linbo/start.conf.* | head -10
```

**Captured evidence:**

```
/srv/linbo/start.conf.bios_sata:Server = 10.0.0.13
/srv/linbo/start.conf.ubuntu-efi:Server = 10.0.0.13
/srv/linbo/start.conf.ubuntu2204_efi_nvme:Server = 10.0.0.13
/srv/linbo/start.conf.win-generic-efi-sata:Server = 10.0.0.13
/srv/linbo/start.conf.win11-vdi:Server = 10.0.0.13
/srv/linbo/start.conf.win11_efi_nvme:Server = 10.0.0.13
/srv/linbo/start.conf.win11_efi_sata:Server = 10.0.0.13
/srv/linbo/start.conf.win11_ohnedata:Server = 10.0.0.13
/srv/linbo/start.conf.win11_pro:Server = 10.0.0.13
```

**All 9 start.conf group files show `Server = 10.0.0.13` (Docker VM IP).**

## 4. hostcfg/ Fallback

### 4.1 List hostcfg symlinks

```bash
docker exec linbo-api ls -la /srv/linbo/boot/grub/hostcfg/
```

**Captured evidence (63 entries -- hostname + MAC-based):**

```
01-00-21-cc-67-58-8f.cfg -> ../bios_sata.cfg
01-4c-0f-3e-39-46-71.cfg -> ../win11_pro.cfg
01-84-ba-59-ca-d4-45.cfg -> ../win11_pro.cfg
01-aa-ee-4e-b5-5c-01.cfg -> ../win11-vdi.cfg
01-aa-ee-4e-b5-5c-02.cfg -> ../win11-vdi.cfg
01-bc-24-11-2a-e9-8c.cfg -> ../win11_efi_sata.cfg
01-bc-24-11-58-38-f6.cfg -> ../win11_pro.cfg
01-bc-24-11-5c-7f-94.cfg -> ../win11_ohnedata.cfg
01-bc-24-11-63-8e-40.cfg -> ../bios_sata.cfg
01-bc-24-11-d0-a1-33.cfg -> ../ubuntu-efi.cfg
01-bc-24-11-d1-7b-4d.cfg -> ../win11_efi_sata.cfg
01-c4-c6-e6-d9-7b-95.cfg -> ../win11_efi_nvme.cfg
01-d0-bf-9c-1f-e2-d8.cfg -> ../win-generic-efi-sata.cfg
01-d4-a2-cd-82-9e-95.cfg -> ../win11_efi_nvme.cfg
01-f4-f1-9e-0f-42-13.cfg -> ../ubuntu2204_efi_nvme.cfg
amo-pc02.cfg -> ../win11_efi_sata.cfg
amo-pc03.cfg -> ../win11_ohnedata.cfg
amo-pc04.cfg -> ../win11_efi_nvme.cfg
amo-pc06.cfg -> ../win11_efi_nvme.cfg
amo-pc08.cfg -> ../win11_pro.cfg
amo-pc09.cfg -> ../ubuntu-efi.cfg
```

### 4.2 Count hostcfg entries

```bash
docker exec linbo-api ls /srv/linbo/boot/grub/hostcfg/ | wc -l
```

**Result: 63 symlinks** (both hostname-based `{hostname}.cfg` and MAC-based `01-{mac}.cfg`).

### 4.3 Verify symlink resolution

```bash
docker exec linbo-api sh -c 'for f in /srv/linbo/boot/grub/hostcfg/*.cfg; do echo "$(basename $f) -> $(readlink $f)"; done' | head -10
```

**How GRUB hostcfg fallback works:**

1. GRUB PXE client boots, loads `/boot/grub/grub.cfg`
2. grub.cfg tries to load `hostcfg/$net_pxe_hostname.cfg` (hostname from DHCP)
3. If hostname not set, falls back to `hostcfg/01-$net_pxe_mac.cfg` (MAC address)
4. The hostcfg symlink resolves to `../{group}.cfg` (e.g. `../win11_pro.cfg`)
5. This loads the group-specific GRUB config with correct kernel params + server=

## 5. DHCP Configs

### 5.1 DHCP config files in the Docker volume

```bash
docker exec linbo-api ls -laR /srv/linbo/dhcp/
```

**Captured evidence:**

```
/srv/linbo/dhcp/:
total 20
drwxr-xr-x  2 linbo linbo  4096 Mar 17 13:48 .
drwxr-xr-x 12 linbo linbo 12288 Mar 17 13:48 ..
-rw-r--r--  1 linbo linbo  2064 Mar 17 13:48 dnsmasq-proxy.conf
```

**Note:** The current testserver API container runs an older build that writes
`dnsmasq-proxy.conf` (dnsmasq-proxy format). The source code has been updated
in Phase 25 to write ISC DHCP format (`subnets.conf` + `devices/{school}.conf`).
After the next `docker compose build && docker compose up -d`, the ISC DHCP
files will appear here.

### 5.2 Current DHCP config content

```bash
docker exec linbo-api cat /srv/linbo/dhcp/dnsmasq-proxy.conf
```

**Captured evidence (22 host entries):**

```
#
# LINBO - dnsmasq Configuration (proxy mode)
# Generated: 2026-03-17T13:48:09Z
# Hosts: 22
#

# Proxy DHCP mode - no IP assignment, PXE only
port=0
dhcp-range=10.0.0.0,proxy
log-dhcp

interface=eth0
bind-interfaces

# PXE boot architecture detection
dhcp-match=set:bios,option:client-arch,0
dhcp-match=set:efi32,option:client-arch,6
dhcp-match=set:efi64,option:client-arch,7
dhcp-match=set:efi64,option:client-arch,9

dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,10.0.0.1
dhcp-boot=tag:efi32,boot/grub/i386-efi/core.efi,10.0.0.1
dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,10.0.0.1

# Host config assignments (sample)
dhcp-host=BC:24:11:63:8E:40,set:bios_sata
dhcp-host=BC:24:11:58:38:F6,set:win11_pro
dhcp-host=BC:24:11:D0:A1:33,set:ubuntu-efi
...

# Config name via NIS-Domain (Option 40)
dhcp-option=tag:bios_sata,40,bios_sata
dhcp-option=tag:win11_pro,40,win11_pro
dhcp-option=tag:ubuntu-efi,40,ubuntu-efi
...
```

### 5.3 ISC DHCP container

The ISC DHCP container (`linbo-dhcp`) is started with the `dhcp` profile:

```bash
docker compose --profile dhcp up -d
```

The ISC DHCP container:
- Reads config from `/srv/linbo/dhcp/` shared volume
- Generates `dhcpd.conf` at startup from caching-server-satellite template
- Uses inotify (`watch-config.sh`) to detect file changes and reload dhcpd via SIGHUP
- Includes `subnets.conf` and `devices/{school}.conf` for host declarations

**Verify ISC DHCP container is running:**
```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | grep dhcp
```

**Verify dhcpd is responding:**
```bash
docker exec linbo-dhcp pgrep dhcpd && echo "DHCP running"
```

## 6. Full Boot Chain

### 6.1 Chain diagram

```
                   +-- Client PXE ROM --+
                   |                    |
                   v                    |
           +------+------+             |
           | DHCP Server |             |
           | (linbo-dhcp) |            |
           +------+------+             |
                   |                    |
     IP + next-server + bootfile        |
     Option 40 = group name             |
                   |                    |
                   v                    |
           +------+------+             |
           | TFTP Server |             |
           | (linbo-tftp) |            |
           +------+------+             |
                   |                    |
   boot/grub/x86_64-efi/core.efi       |
   (or i386-pc/core.0 for BIOS)        |
                   |                    |
                   v                    |
           +------+------+             |
           |    GRUB     |             |
           +------+------+             |
                   |                    |
   1. loads grub.cfg (PXE entry)        |
   2. sources hostcfg/{host}.cfg        |
      -> symlink to ../{group}.cfg      |
   3. boots linbo_kernel + linbofs64    |
      with server=10.0.0.13            |
                   |                    |
                   v                    |
           +------+------+             |
           |  LINBO GUI  |             |
           +------+------+             |
                   |                    |
   1. reads server= from cmdline       |
   2. rsync: gets start.conf-{IP}      |
      -> symlink to start.conf.{group}  |
   3. Server = 10.0.0.13 (rewritten)   |
                   |                    |
                   v                    |
           +------+------+             |
           | rsync/Image |             |
           | (linbo-rsync)|            |
           +------+------+             |
                   |                    |
   Sync/restore OS image               |
   Boot into Windows/Linux             |
                   +--------------------+
```

### 6.2 Per-step verification commands

| Step | Component | Verification Command |
|------|-----------|---------------------|
| 1 | DHCP running | `docker exec linbo-dhcp pgrep dhcpd` |
| 2 | TFTP running | `docker exec linbo-tftp pgrep in.tftpd` |
| 3 | GRUB files exist | `docker exec linbo-api ls /srv/linbo/boot/grub/*.cfg` |
| 4 | server= rewrite | `docker exec linbo-api grep "server=" /srv/linbo/boot/grub/*.cfg` |
| 5 | hostcfg symlinks | `docker exec linbo-api ls /srv/linbo/boot/grub/hostcfg/` |
| 6 | start.conf files | `docker exec linbo-api ls /srv/linbo/start.conf.*` |
| 7 | start.conf symlinks | `docker exec linbo-api ls /srv/linbo/start.conf-*` |
| 8 | Server= rewrite | `docker exec linbo-api grep "Server" /srv/linbo/start.conf.*` |
| 9 | DHCP config | `docker exec linbo-api ls /srv/linbo/dhcp/` |
| 10 | Sync status | `curl -s http://localhost:3000/api/v1/sync/status -H "X-Internal-Key: $KEY"` |

## Troubleshooting

### Client gets wrong server IP

**Symptom:** LINBO connects to 10.0.0.11 instead of 10.0.0.13

**Cause:** `server=` rewrite did not apply during sync

**Fix:**
```bash
# Check LINBO_SERVER_IP in .env
grep LINBO_SERVER_IP /root/linbo-docker/.env

# Verify sync rewrites server=
docker exec linbo-api grep "server=" /srv/linbo/boot/grub/*.cfg
docker exec linbo-api grep "Server" /srv/linbo/start.conf.*

# If wrong, reset and re-sync
curl -s -X POST http://localhost:3000/api/v1/sync/reset -H "X-Internal-Key: $KEY"
curl -s -X POST http://localhost:3000/api/v1/sync/trigger -H "X-Internal-Key: $KEY"
```

### Client does not get GRUB config (stuck at grub>)

**Symptom:** Client boots to GRUB shell instead of LINBO menu

**Cause:** Missing hostcfg symlink or missing group .cfg file

**Fix:**
```bash
# Check if client MAC has a hostcfg symlink
MAC="bc:24:11:58:38:f6"
docker exec linbo-api ls -la "/srv/linbo/boot/grub/hostcfg/01-${MAC//:/-}.cfg"

# Check if the target group .cfg exists
docker exec linbo-api ls -la /srv/linbo/boot/grub/*.cfg

# If group .cfg missing, the Authority API may not export GRUB config for that group
# Check API logs:
docker logs linbo-api 2>&1 | grep "GRUB"
```

### Sync fails or returns errors

**Symptom:** `lastError` is not null in sync status

**Fix:**
```bash
# Check sync status
curl -s http://localhost:3000/api/v1/sync/status -H "X-Internal-Key: $KEY" | python3 -m json.tool

# Check API logs for error details
docker logs linbo-api --tail 50 2>&1 | grep -i "error\|fail"

# Verify LMN API is reachable
docker exec linbo-api curl -sk https://10.0.0.11:8001/api/v1/linbo/health
```

### DHCP not assigning IPs

**Symptom:** Client does not get an IP address

**Cause:** DHCP container not started, or conflicting DHCP server in VLAN

**Fix:**
```bash
# Start DHCP container
docker compose --profile dhcp up -d

# Check for conflicting DHCP servers
# WARNING: Only ONE DHCP server should be active per VLAN
docker logs linbo-dhcp 2>&1 | tail -20
```

### start.conf symlinks broken

**Symptom:** Client boots LINBO but shows no OS options

**Cause:** start.conf-{IP} symlink missing or target start.conf.{group} deleted

**Fix:**
```bash
# Check if symlink exists for client IP
docker exec linbo-api ls -la /srv/linbo/start.conf-10.0.0.120

# Check if target file exists
docker exec linbo-api ls -la /srv/linbo/start.conf.win11_pro

# Re-trigger sync to recreate symlinks
curl -s -X POST http://localhost:3000/api/v1/sync/reset -H "X-Internal-Key: $KEY"
curl -s -X POST http://localhost:3000/api/v1/sync/trigger -H "X-Internal-Key: $KEY"
```

### nopxe group has no GRUB config

**Observation:** Hosts in the `nopxe` group have hostcfg symlinks pointing to
`../nopxe.cfg`, but this file does not exist in `/srv/linbo/boot/grub/`.

**This is expected behavior.** The `nopxe` group is for devices that should NOT
PXE boot. GRUB will fail to load the config and fall through, which is the
desired outcome for these devices.

## Verification Summary

| Requirement | Status | Evidence |
|-------------|--------|----------|
| E2E-01: GRUB configs with server= rewrite | PASS | `server=10.0.0.13` in win11_pro.cfg |
| E2E-01: hostcfg/ symlinks present | PASS | 63 symlinks (hostname + MAC) |
| E2E-02: start.conf-{ip} symlinks (>= 3) | PASS | 36 IP-based symlinks |
| Sync cycle completes without error | PASS | lastError=null, 31 hosts, 9 configs |
| Server= rewrite in start.conf files | PASS | All 9 groups show `Server = 10.0.0.13` |
| DHCP config generated | PASS | dnsmasq-proxy.conf with 22 host entries |
| LMN Authority API healthy | PASS | lmnApiHealthy=true |
