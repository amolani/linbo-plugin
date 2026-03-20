# LINBO Docker Restructuring - Use Case Catalog

> **Version:** 2.0.0
> **Date:** 2026-02-26
> **Status:** Phase 0 - Planning
> **Scope:** Complete use-case catalog for the restructured LINBO Docker architecture
>
> **ACHTUNG: Nicht umgesetzter Entwurf.** Siehe [docs/ARCHITECTURE.md](../ARCHITECTURE.md) fuer den aktuellen Stand.

## Architecture Overview (Context)

```
LMN Authority API (Python FastAPI, linuxmuster server)
    = single source of truth for hosts, configs, rooms, devices.csv
    |
    v  (delta-feed poll 30-60s + webhook)
Docker Snapshot Engine
    -> staging/ -> atomic switch -> current/ (+ previous/ for rollback)
    |
    v
Docker Runtime Services:
    - TFTP (69/udp) - serves grub.efi
    - nginx (HTTP) - serves linbo64, linbofs64, start.conf, images
    - rsync (873) - start.conf + image sync to clients
    - ssh (2222) - linbo_wrapper commands to LINBO clients
    - API (3000) - status, operations, image management
    - Web (8080) - admin frontend
    |
    v
PXE Clients (up to ~2000)
    DHCP -> TFTP (grub.efi) -> GRUB loads hostcfg from snapshot
    -> nginx serves linbo64/linbofs64 -> kernel boots
    -> rsync downloads start.conf -> LINBO GUI
```

**Key change:** Docker becomes runtime-only. No Host/Config/Room CRUD. Snapshot-based boot serving, no DB queries during boot.

---

## Table of Contents

- [A. Boot Scenarios (UC-BOOT-01 to UC-BOOT-10)](#a-boot-scenarios)
- [B. Sync Scenarios (UC-SYNC-01 to UC-SYNC-10)](#b-sync-scenarios)
- [C. Admin/Operations Scenarios (UC-OPS-01 to UC-OPS-14)](#c-adminoperations-scenarios)
- [D. Error/Edge Cases (UC-ERR-01 to UC-ERR-10)](#d-erroredge-cases)
- [Appendix: Cross-References](#appendix-use-case-cross-reference-by-phase)

---

## A. Boot Scenarios

### UC-BOOT-01: Normal PXE Boot (Single Client)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-BOOT-01 |
| **Title** | Normal PXE boot of a single registered client |
| **Actor(s)** | PXE Client, DHCP Server, Docker TFTP/HTTP/rsync |
| **Preconditions** | Client MAC is registered in devices.csv on LMN server. Snapshot `current/` exists on Docker with valid hostcfg and group config. DHCP server (OPNsense or Docker) is running with correct Option 40 (nisdomain = HOSTGROUP). TFTP, HTTP, and rsync services are healthy. |
| **Phase** | Phase 1 (Core Boot Infrastructure) |

**Main Flow:**

1. Client powers on, NIC sends DHCP DISCOVER (PXE option 60).
2. DHCP server responds with OFFER containing:
   - IP address (static or from pool)
   - Option 66 (next-server) = Docker TFTP IP
   - Option 67 (bootfile) = `boot/grub/x86_64-efi/core.efi` (UEFI) or `boot/grub/i386-pc/core.0` (BIOS)
   - Option 40 (nisdomain) = HOSTGROUP name (e.g., `pc-raum1`)
   - Option 12 (hostname) = client hostname
3. Client downloads GRUB bootloader via TFTP from Docker.
4. GRUB executes `grub.cfg.pxe` (main PXE template):
   a. Checks for `spool/${net_pxe_hostname}.reboot` file on server (remote grubenv for local-boot reboot).
   b. If no reboot variable set, searches local cache partition for `/start.conf` and loads local grubenv.
   c. If `reboot_grub` or `reboot_label` is set, boots the indicated OS directly (see UC-BOOT-08).
5. Normal boot path: GRUB attempts to load host-specific config:
   a. Tries `$prefix/hostcfg/${net_default_hostname}.cfg`
   b. Tries `$prefix/hostcfg/${net_pxe_hostname}.cfg`
   c. Tries `$prefix/hostcfg/${hostname}.cfg`
   d. Tries group config `$prefix/${group}.cfg` (from DHCP extensionspath / Option 40)
   e. Tries MAC-based config lookup (for proxy-DHCP scenarios without hostname)
6. Matched config (`source`d) sets variables and loads LINBO:
   - `insmod http`
   - `set http_root="(http,<docker-ip>:<port>)"`
   - `linux ${http_root}/linbo64 quiet splash server=<docker-ip> group=<groupname> ...`
   - `initrd ${http_root}/linbofs64`
   - `boot`
7. GRUB downloads `linbo64` (~15MB kernel) and `linbofs64` (~350MB initramfs) via HTTP from Docker nginx.
8. Linux kernel boots, `init.sh` runs:
   a. `udevd` starts, network interface comes up.
   b. `udhcpc` obtains IP (same DHCP lease or new).
   c. `server=` variable from kernel cmdline used to contact Docker.
   d. `rsync` downloads `start.conf` for this host's group from Docker rsync.
   e. `start.conf` parsed, cache partition identified.
   f. `linbo_gui64_7.tar.lz` downloaded via rsync and extracted (Qt GUI).
9. LINBO GUI launches on framebuffer, displays OS selection with action pills (Start, Sync, New).
10. Docker API receives heartbeat/status update; host marked as `linbo` status.

**Expected Result:** Client displays LINBO GUI with correct OS entries matching its group's `start.conf`. Boot time < 60 seconds on Gigabit LAN.

**Error Handling:**
- DHCP timeout (5s): Client retries DHCP DISCOVER 3 times, then falls back to local boot if cache partition exists.
- TFTP timeout: GRUB retransmits; after 30s, client shows GRUB shell or retries PXE boot.
- HTTP download failure: GRUB shows error on screen; client stuck at GRUB prompt.
- rsync failure in init.sh: LINBO falls back to cached `start.conf` if available; otherwise shows "Control Mode" without OS entries.
- Missing `linbo_gui64_7.tar.lz`: LINBO shows "Control Mode" (text-only, no GUI).

**Performance Notes:** Single client boot is not performance-critical. HTTP download of linbofs64 (~350MB) is the bottleneck; expect ~3s on Gigabit.

---

### UC-BOOT-02: Boot Storm (2000 Clients Simultaneously)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-BOOT-02 |
| **Title** | Simultaneous PXE boot of up to 2000 clients |
| **Actor(s)** | 2000 PXE Clients, DHCP Server, Docker TFTP/HTTP/rsync |
| **Preconditions** | All clients registered. Snapshot current and valid. DHCP server can handle 2000 concurrent leases. Docker host has sufficient CPU/RAM/bandwidth. |
| **Phase** | Phase 1 (Core Boot Infrastructure) + Phase 2 (Performance Tuning) |

**Main Flow:**

1. All 2000 clients power on within a 1-5 minute window (e.g., morning class start via WoL or power schedule).
2. DHCP server processes burst of DISCOVER packets (staggered by NIC firmware, typically 0-5s random delay).
3. TFTP serves GRUB bootloader (~500KB-2MB) to all clients:
   - TFTP is connectionless UDP, each client gets its own transfer.
   - Docker TFTP must handle ~2000 concurrent sessions.
4. GRUB on each client requests config files via TFTP:
   - Each client reads `grub.cfg.pxe` + its hostcfg/group cfg.
   - Total TFTP reads: ~4000-6000 small file reads (< 10KB each).
5. **Critical bottleneck:** 2000 clients simultaneously request `linbo64` (~15MB) and `linbofs64` (~350MB) via HTTP.
   - Total bandwidth if all cold-boot: ~700 GB. With client-side linbofs caching (typical): ~30 GB.
   - At 10Gbps: ~9.3 min (cold) or ~24s (cached). At 1Gbps: ~93 min (cold) or ~4 min (cached).
   - nginx must handle 2000 concurrent HTTP connections.
   - Natural staggering: PXE/TFTP phase takes 2-5s per client (spread by switch/DHCP), creating a ramp.
6. Kernel boot phase (20-40s) creates natural staggering for rsync phase.
7. rsync daemon handles `start.conf` downloads (~2KB each, trivial).
8. rsync daemon handles `linbo_gui64_7.tar.lz` downloads (~10MB each, staggered by kernel boot time).
9. All clients reach LINBO GUI within 2-5 minutes of first power-on.

**Alternative Flows:**

- **A1: Multicast download.** If `downloadtype=multicast` in `start.conf`, image sync uses multicast (not boot files). Boot files always use HTTP/rsync.
- **A2: Torrent download.** If `downloadtype=torrent`, clients share image data peer-to-peer after initial seed from Docker.

**Expected Result:** All 2000 clients boot to LINBO GUI within 5 minutes. No client fails due to server overload.

**Error Handling:**
- TFTP overload: Implement connection queue with backoff. GRUB retransmits automatically.
- HTTP overload: nginx worker_connections tuned to 4096+. Use sendfile + tcp_nopush. Rate-limit if needed.
- rsync overload: `max connections = 200` in rsyncd.conf; clients retry with exponential backoff.
- Memory exhaustion: Docker container memory limits prevent OOM; health checks restart containers.

**Performance Notes:**
- **TFTP:** Use multi-threaded TFTP server (e.g., `tftpd-hpa` with `--listen` mode). ~2000 concurrent 500KB transfers = ~1GB total, trivial.
- **HTTP (critical):** 2000 x 350MB = 700GB total. At 10Gbps NIC (~1.25 GB/s), theoretical minimum ~9.3 minutes. At 1Gbps (~125 MB/s), ~93 minutes. **In practice:** Not all 2000 clients cold-boot simultaneously; linbofs64 (161MB) is cached on client disk after first boot, reducing per-boot transfer to ~15MB (kernel only). Typical simultaneous burst is 100-300 clients. **Recommendation:** 10Gbps NIC + client-side caching.
- **nginx tuning:** `worker_processes auto; worker_connections 4096; sendfile on; tcp_nopush on; open_file_cache max=1000;`
- **Snapshot serving:** Configs served from filesystem (no DB queries). Each config < 10KB. OS-level page cache handles all reads from RAM after first access.

---

### UC-BOOT-03: Boot with LMN Server Unreachable (Snapshot Fallback)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-BOOT-03 |
| **Title** | PXE boot when LMN Authority API is unreachable |
| **Actor(s)** | PXE Client, Docker Runtime |
| **Preconditions** | Docker has a valid `current/` snapshot from a previous successful sync. LMN Authority API is down or unreachable. Docker runtime services (TFTP, HTTP, rsync) are running. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Client powers on and proceeds through normal PXE boot chain (UC-BOOT-01 steps 1-9).
2. Docker serves all boot files from the `current/` snapshot:
   - GRUB configs from `current/boot/grub/hostcfg/` and `current/boot/grub/`
   - `linbo64` and `linbofs64` from `current/`
   - `start.conf` files from `current/` via rsync
3. Boot succeeds identically to UC-BOOT-01.
4. In parallel, Docker sync engine detects LMN API is unreachable:
   - Delta-feed poll fails with connection timeout/error.
   - Sync engine logs warning, increments retry counter.
   - WebSocket broadcast: `sync.error` event to admin frontend.
   - Admin dashboard shows "LMN Sync: Disconnected" with timestamp of last successful sync.
5. All LINBO operations (start, sync, new) continue to work because they operate on local images and configs.

**Alternative Flows:**

- **A1: LMN was never reachable (fresh Docker install).** No snapshot exists. Boot falls through to GRUB fallback (line 173-187 of grub.cfg.pxe): boots LINBO with default/empty config. Client shows LINBO GUI in minimal mode.
- **A2: LMN comes back during client session.** Next sync poll succeeds; new snapshot staged and atomically switched. Clients already booted are unaffected; new boots get updated configs.

**Expected Result:** Clients boot normally using cached snapshot. Admin is informed of sync failure. No data loss.

**Error Handling:**
- Snapshot corruption: If `current/` is corrupt, Docker falls back to `previous/` snapshot (see UC-SYNC-07).
- Partial snapshot: Atomic switch ensures `current/` is always complete; partial staging never becomes current.

**Performance Notes:** No performance difference from normal boot. Snapshot is filesystem-based, no network calls to LMN during boot serving.

---

### UC-BOOT-04: Boot of Unknown/Unregistered Client

| Field | Value |
|-------|-------|
| **UC-ID** | UC-BOOT-04 |
| **Title** | PXE boot of a client whose MAC is not in the snapshot |
| **Actor(s)** | Unknown PXE Client, Docker Runtime |
| **Preconditions** | Client MAC not registered in devices.csv on LMN server. No hostcfg exists for this client. DHCP may or may not assign an IP (depends on DHCP pool config). |
| **Phase** | Phase 1 (Core Boot) + Phase 3 (Unknown Client Handling) |

**Main Flow:**

1. Client powers on, NIC sends DHCP DISCOVER.
2. DHCP server behavior depends on configuration:
   a. **Static-only DHCP:** No OFFER sent. Client cannot PXE boot. Boot fails at DHCP.
   b. **DHCP pool enabled:** Client gets IP from pool. No hostname assigned. Option 40 may be empty or set to a default group.
3. If client received IP and bootfile, GRUB loads and executes `grub.cfg.pxe`.
4. GRUB config lookup sequence fails:
   a. `hostcfg/${hostname}.cfg` -- no hostname from DHCP, or hostname not in hostcfg/.
   b. `${group}.cfg` -- group may be empty or default.
   c. MAC-based lookup -- MAC not in mapping table.
5. GRUB falls through to fallback block (lines 173-187 of grub.cfg.pxe):
   ```
   insmod http
   set http_root="(http,<docker-ip>:<port>)"
   linux ${http_root}/linbo64 quiet splash server=<docker-ip>
   initrd ${http_root}/linbofs64
   boot
   ```
6. LINBO kernel boots with no `group=` parameter.
7. `init.sh` runs, rsync attempts to download start.conf but no group-specific file exists.
8. LINBO starts in minimal/fallback mode. GUI shows empty OS list or "No configuration found."
9. Docker API logs the unknown MAC address. Admin dashboard can show "Unknown Clients" list.

**Alternative Flows:**

- **A1: Default group configured.** Docker has a `default.cfg` GRUB config that catches unregistered clients and assigns them a default start.conf with a basic imaging setup.
- **A2: Registration workflow.** Admin sees unknown MAC in dashboard, registers it on LMN server via School Console. Next sync cycle creates hostcfg. Client reboots and gets proper config.

**Expected Result:** Client boots to LINBO in fallback mode. Admin is notified of unknown client. No crash or hang.

**Error Handling:**
- No DHCP: Client falls back to local boot (if any OS installed) or shows PXE boot failure.
- Fallback LINBO with no start.conf: LINBO runs but cannot perform sync/start operations. User sees "Control Mode."

**Performance Notes:** Minimal impact. One additional GRUB config miss per unknown client.

---

### UC-BOOT-05: Boot with DHCP-Only IP (Pool, Option 40 for HOSTGROUP)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-BOOT-05 |
| **Title** | PXE boot using dynamic DHCP with Option 40 (nisdomain) for group resolution |
| **Actor(s)** | PXE Client, DHCP Server (OPNsense), Docker TFTP/HTTP |
| **Preconditions** | DHCP server configured with Option 40 (nisdomain) per host/class. Client is registered but uses dynamic IP from pool (not static reservation). Docker snapshot contains group config matching the nisdomain value. |
| **Phase** | Phase 1 (Core Boot) + Phase 3 (DHCP Integration) |

**Main Flow:**

1. Client sends DHCP DISCOVER.
2. DHCP server matches client MAC to a host-class or reservation and responds with:
   - Dynamic IP from pool
   - Option 40 (nisdomain) = HOSTGROUP name (e.g., `pc-raum1`)
   - Option 66 (next-server) = Docker TFTP IP
   - Option 67 (bootfile) = GRUB EFI path
   - Option 12 (hostname) = assigned hostname (may be absent)
3. GRUB boots, reads DHCP options:
   - `net_pxe_extensionspath` or `net_efinet0_extensionspath` populated from vendor class / nisdomain.
4. GRUB config lookup:
   a. Hostname-based lookup may succeed if hostname was provided.
   b. Group-based lookup uses `extensionspath` (derived from nisdomain): loads `$prefix/${group}.cfg`.
5. Group config found and loaded. LINBO boots with correct `group=` parameter.
6. rsync downloads correct `start.conf` for the group.
7. LINBO GUI displays correctly.

**Alternative Flows:**

- **A1: Option 40 not set.** Group lookup fails. Falls through to MAC-based lookup or GRUB fallback (UC-BOOT-04 flow).
- **A2: Option 40 set to wrong group.** Client loads wrong start.conf. May show wrong OS entries. Admin must fix DHCP config.

**Expected Result:** Client boots with correct group config derived from DHCP Option 40, even without a static IP or hostname.

**Error Handling:**
- Missing Option 40: Falls through to MAC-based or fallback. Admin warned in dashboard.
- GRUB `extensionspath` parsing failure: Falls through to fallback boot.

**Performance Notes:** No difference from static IP boot. DHCP processing adds negligible latency.

---

### UC-BOOT-06: UEFI PXE Boot

| Field | Value |
|-------|-------|
| **UC-ID** | UC-BOOT-06 |
| **Title** | PXE boot on UEFI firmware client |
| **Actor(s)** | UEFI PXE Client, Docker TFTP |
| **Preconditions** | Client firmware set to UEFI boot with PXE enabled. DHCP provides UEFI-specific bootfile. Docker TFTP has `boot/grub/x86_64-efi/core.efi`. |
| **Phase** | Phase 1 (Core Boot) |

**Main Flow:**

1. Client UEFI firmware sends DHCP DISCOVER with architecture type 7 (x86-64 UEFI) or 9 (EFI x86-64) in Option 93.
2. DHCP server detects UEFI client and responds with:
   - Option 67 = `boot/grub/x86_64-efi/core.efi`
3. Client downloads `core.efi` (~2MB) via TFTP.
4. GRUB EFI starts, sets `grub_platform = "efi"`.
5. Config loading uses EFI-specific network variables:
   - `net_efinet0_extensionspath`, `net_efinet1_extensionspath`, etc.
   - Iterates through multiple EFI network interfaces (lines 117-128 of grub.cfg.pxe).
6. Group config loaded. LINBO kernel + initrd loaded via HTTP.
7. UEFI-specific reboot handling: If reboot to Windows, uses `chainloader "$win_efiloader"` for EFI boot manager (lines 98-108 of grub.cfg.pxe).
8. Normal LINBO boot proceeds as UC-BOOT-01 steps 7-10.

**Alternative Flows:**

- **A1: Secure Boot enabled.** GRUB must be signed with appropriate certificate. If not signed, firmware rejects bootloader. Docker must serve signed GRUB (from linuxmuster.net package or custom-signed).
- **A2: Multiple EFI network interfaces.** GRUB iterates efinet0, efinet1, efinet2 to find the one with DHCP response (lines 117-128).

**Expected Result:** Client boots LINBO via UEFI PXE. OS reboot works via EFI boot manager chainloading.

**Error Handling:**
- Secure Boot rejection: Client shows firmware error. Admin must disable Secure Boot or provide signed GRUB.
- Wrong bootfile served: UEFI firmware cannot execute BIOS binary. DHCP must correctly classify client architecture.

**Performance Notes:** UEFI GRUB binary (~2MB) is larger than BIOS equivalent. TFTP transfer adds ~1-2s.

---

### UC-BOOT-07: BIOS/Legacy PXE Boot

| Field | Value |
|-------|-------|
| **UC-ID** | UC-BOOT-07 |
| **Title** | PXE boot on legacy BIOS firmware client |
| **Actor(s)** | BIOS PXE Client, Docker TFTP |
| **Preconditions** | Client firmware set to Legacy/BIOS boot with PXE. DHCP provides BIOS bootfile. Docker TFTP has `boot/grub/i386-pc/core.0`. |
| **Phase** | Phase 1 (Core Boot) |

**Main Flow:**

1. Client BIOS PXE ROM sends DHCP DISCOVER with architecture type 0 (BIOS x86) in Option 93.
2. DHCP server responds with:
   - Option 67 = `boot/grub/i386-pc/core.0`
3. Client downloads `core.0` via TFTP.
4. GRUB BIOS starts, sets `grub_platform = "pc"`.
5. Config loading uses BIOS PXE variables:
   - `net_pxe_extensionspath`, `net_pxe_hostname`.
6. Group config loaded. LINBO boot proceeds.
7. BIOS-specific reboot handling: If reboot to Windows, uses `ntldr /bootmgr` or `chainloader +1` (lines 85-97 of grub.cfg.pxe).

**Alternative Flows:**

- **A1: No PXE ROM.** Client cannot network boot. Must boot from local disk or USB.

**Expected Result:** Client boots LINBO via legacy PXE. OS reboot works via NTLDR/chainloader.

**Error Handling:**
- BIOS bootfile served to UEFI client (or vice versa): Boot fails immediately. DHCP must match architecture.

**Performance Notes:** BIOS GRUB binary is smaller (~500KB). Slightly faster TFTP transfer than UEFI.

---

### UC-BOOT-08: Local Boot / Reboot into OS from LINBO

| Field | Value |
|-------|-------|
| **UC-ID** | UC-BOOT-08 |
| **Title** | Reboot from LINBO GUI directly into an installed OS |
| **Actor(s)** | PXE Client (in LINBO), Docker GRUB spool |
| **Preconditions** | Client is in LINBO GUI. OS is installed and synced on local disk. GRUB environment (`grubenv`) mechanism is functional. |
| **Phase** | Phase 1 (Core Boot) |

**Main Flow:**

1. User clicks "Start" on an OS entry in LINBO GUI.
2. LINBO writes reboot variables to local cache partition's `/boot/grub/grubenv`:
   - `reboot_grub` = GRUB partition identifier (e.g., `(hd0,2)`)
   - `reboot_label` = filesystem label of the OS root partition
   - `reboot_kernel`, `reboot_initrd`, `reboot_append` (for Linux OS)
3. LINBO also writes a remote grubenv file to Docker server:
   - File: `/srv/linbo/boot/grub/spool/${hostname}.reboot`
   - Content: same reboot variables
4. LINBO issues `reboot` command.
5. Client PXE boots again (BIOS/UEFI -> DHCP -> TFTP -> GRUB).
6. GRUB `grub.cfg.pxe` checks for reboot file:
   a. **Remote check (line 19):** `set remote_grubenv=$prefix/spool/${net_pxe_hostname}.reboot` -- if file exists on TFTP server, loads variables from it.
   b. **Local check (line 26):** If remote not found, searches local cache partition for grubenv.
7. `reboot_grub` or `reboot_label` is set. GRUB enters reboot path (lines 40-110 of grub.cfg.pxe):
   a. Uses `search --label "$reboot_label" --set tmproot` to find OS root.
   b. Clears reboot variables in local grubenv (so next boot returns to LINBO).
   c. Detects OS type:
      - Linux: `linux /boot/vmlinuz` + `initrd /boot/initrd.img` + `boot`
      - Windows UEFI: `chainloader /EFI/Microsoft/Boot/bootmgfw.efi`
      - Windows BIOS: `ntldr /bootmgr` or `chainloader +1`
      - Other: `configfile /boot/grub/grub.cfg`
8. OS boots directly, bypassing LINBO.

**Alternative Flows:**

- **A1: Remote grubenv takes priority.** If Docker spool file exists, it is used even if local grubenv also exists. This allows admin-initiated reboots (e.g., via `linbo-remote` scheduling `start:1`).
- **A2: OS not found at specified partition.** GRUB falls through all detection methods and returns to normal LINBO boot.
- **A3: grubenv corrupted.** Variables not loaded. Normal LINBO boot proceeds.

**Expected Result:** Client reboots directly into the specified OS. Next boot (after OS restart) returns to LINBO GUI.

**Error Handling:**
- Missing OS at partition: GRUB falls through to LINBO boot.
- Spool file permissions: Docker must ensure files are readable by TFTP user.
- Race condition (client reboots before spool file written): Local grubenv used as fallback.

**Performance Notes:** Adds ~2-3 seconds to boot for grubenv checking. Negligible.

---

### UC-BOOT-09: Boot After Config Change Not Yet Synced to Docker

| Field | Value |
|-------|-------|
| **UC-ID** | UC-BOOT-09 |
| **Title** | Client boots before a recent LMN config change has been synced to Docker snapshot |
| **Actor(s)** | PXE Client, Admin (on School Console), Docker Sync Engine |
| **Preconditions** | Admin just changed a host's group or start.conf on the LMN server. Delta-feed poll interval is 30-60 seconds. Change has not yet been fetched by Docker. |
| **Phase** | Phase 2 (Snapshot Sync) |

**Main Flow:**

1. Admin changes host `pc01` from group `raum1` to group `raum2` on School Console.
2. LMN Authority API records the change with a monotonic version number.
3. Client `pc01` powers on and PXE boots.
4. Docker serves from `current/` snapshot, which still has `pc01` in group `raum1`.
5. Client loads `raum1` group config and `raum1` start.conf.
6. LINBO GUI shows `raum1` OS entries (old config).
7. Meanwhile, Docker sync engine polls delta feed:
   - Discovers change for `pc01` (version > last_synced_cursor).
   - Downloads updated host data and new group assignment.
   - Stages new snapshot in `staging/`.
   - Atomic switch: `staging/` -> `current/`, old `current/` -> `previous/`.
8. On next reboot, client `pc01` gets correct `raum2` config.

**Alternative Flows:**

- **A1: Webhook-triggered sync.** If LMN fires a webhook on change, Docker sync happens within 1-2 seconds. Client may still boot with old config if it was faster than webhook processing.
- **A2: Admin forces sync.** Admin clicks "Sync Now" in Docker dashboard. Immediate delta fetch + snapshot rebuild.

**Expected Result:** Client boots with slightly stale config (max 30-60s old). Correct config available on next boot after sync completes. No errors, no crash.

**Error Handling:**
- Config inconsistency (host in wrong group): Harmless for boot. Client gets wrong OS list but can still operate. Self-corrects on next boot after sync.

**Performance Notes:** No performance impact. Stale reads from filesystem are instant.

---

### UC-BOOT-10: Boot with Proxy-DHCP (OPNsense Main DHCP, Docker as Proxy)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-BOOT-10 |
| **Title** | PXE boot using proxy-DHCP mode (Docker supplements OPNsense DHCP) |
| **Actor(s)** | PXE Client, OPNsense DHCP, Docker Proxy-DHCP, Docker TFTP |
| **Preconditions** | OPNsense is the primary DHCP server (IP assignment, gateway, DNS). Docker runs proxy-DHCP (responds to PXE requests only, no IP assignment). OPNsense does not set Option 66/67. |
| **Phase** | Phase 1 (Core Boot) + Phase 3 (Proxy-DHCP) |

**Main Flow:**

1. Client sends DHCP DISCOVER with PXE option 60.
2. OPNsense responds with OFFER (IP, gateway, DNS). No boot options.
3. Docker proxy-DHCP detects PXE request and sends PROXYDHCP OFFER:
   - Option 66 (next-server) = Docker TFTP IP
   - Option 67 (bootfile) = GRUB EFI/BIOS path
   - **No** Option 40 or hostname (OPNsense may provide these separately).
4. Client selects boot server from proxy-DHCP response.
5. GRUB downloads and executes on client.
6. Config resolution challenge: without hostname from DHCP, GRUB tries:
   a. Hostname-based lookups fail (no hostname).
   b. Group-based lookup fails (no extensionspath/nisdomain).
   c. **MAC-based config lookup** (line 161 `@@mac_mapping@@`): GRUB template includes MAC-to-config mapping generated from snapshot.
7. MAC mapping matches client, loads correct group config.
8. LINBO boots normally.

**Alternative Flows:**

- **A1: OPNsense provides hostname via Option 12.** GRUB can use `net_default_hostname` or `net_pxe_hostname` for hostcfg lookup.
- **A2: OPNsense provides Option 40.** Group lookup works via extensionspath.
- **A3: MAC not in mapping.** Falls through to GRUB fallback (UC-BOOT-04).

**Expected Result:** Client boots correctly via proxy-DHCP using MAC-based config resolution.

**Error Handling:**
- Proxy-DHCP race condition: Client may accept OPNsense DHCP before proxy responds. PXE firmware retries.
- MAC mapping table too large (2000 entries): GRUB config file may be slow to parse. Consider limiting to active hosts.

**Performance Notes:**
- MAC mapping in GRUB config: 2000 entries = ~100KB of GRUB script. Parsed in <1s by GRUB.
- Proxy-DHCP adds ~200ms to DHCP negotiation (two servers responding).

---

## B. Sync Scenarios

### UC-SYNC-01: Initial Sync (Docker Starts Fresh)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-SYNC-01 |
| **Title** | First-time sync when Docker has no snapshot data |
| **Actor(s)** | Docker Sync Engine, LMN Authority API |
| **Preconditions** | Docker container freshly deployed. No `current/` or `previous/` snapshot exists. LMN Authority API is reachable and has host/config/room data. API token is valid. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Docker Sync Engine starts and detects no `current/` snapshot directory.
2. Engine sets `last_synced_cursor = 0` (full sync mode).
3. Engine calls LMN Authority API: `GET /api/v1/linbo/changes?since=` (empty cursor = full dump).
4. API returns a DeltaResponse with all MACs and startConf IDs:
   `{ "nextCursor": "1708943200:500", "hostsChanged": ["AA:BB:...", ...], "startConfsChanged": ["win11_efi_sata", ...], "configsChanged": [...], "dhcpChanged": true, "deletedHosts": [], "deletedStartConfs": [] }`
5. Engine fetches full data via batch endpoints:
   - `POST /api/v1/linbo/hosts:batch { "macs": [...] }` → all HostRecords
   - `POST /api/v1/linbo/startconfs:batch { "ids": [...] }` → all StartConfRecords
   - `GET /api/v1/linbo/dhcp/export/dnsmasq-proxy` → DHCP config with Option 40
6. Engine validates received data:
   - JSON schema validation for each HostRecord/StartConfRecord.
   - MAC address format validation.
   - start.conf syntax validation.
   - Duplicate MAC detection.
7. Engine builds `staging/` directory:
   - `staging/boot/grub/hostcfg/` -- one `.cfg` file per host (symlink to group).
   - `staging/boot/grub/` -- one `.cfg` file per group.
   - `staging/start.conf.d/` -- one `start.conf` per group.
   - `staging/grub.cfg.pxe` -- main PXE config with MAC mapping.
   - `staging/dhcp/` -- DHCP export files.
   - `staging/metadata.json` -- version, timestamp, host count, checksum.
8. Engine performs integrity check on staging (file count, checksums).
9. Atomic switch: `rename staging/ -> current/`.
10. Engine records `last_synced_cursor = <nextCursor from DeltaResponse>`.
11. WebSocket broadcast: `sync.completed` with stats (host count, group count, duration).
12. Admin dashboard updates: "Last Sync: just now, 500 hosts, 12 groups."

**Expected Result:** Docker has complete, valid snapshot. Clients can PXE boot immediately.

**Error Handling:**
- API unreachable: Retry with exponential backoff (1s, 2s, 4s, 8s... max 60s). Log warning. Dashboard shows "Initial sync pending."
- API returns invalid data: Reject entire sync. Do not create snapshot. Log validation errors with details.
- Disk full during staging: Clean up partial staging dir. Alert admin. Retry after space freed.
- API timeout on large dataset: Use paginated API calls. Resume from last page on timeout.

**Performance Notes:**
- Full sync of 2000 hosts + 50 groups: ~500KB JSON. Download < 1s.
- GRUB config generation for 2000 hosts: ~2000 file writes. < 5s on SSD.
- Total initial sync: < 10 seconds for typical school.

---

### UC-SYNC-02: Incremental Sync (Delta Feed)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-SYNC-02 |
| **Title** | Incremental sync via delta feed (few hosts/configs changed) |
| **Actor(s)** | Docker Sync Engine, LMN Authority API |
| **Preconditions** | Docker has valid `current/` snapshot at version N. LMN API has changes since version N. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Docker Sync Engine poll timer fires (every 30-60 seconds).
2. Engine calls: `GET /api/v1/linbo/changes?since=<last_synced_cursor>`.
3. API returns DeltaResponse:
   ```json
   {
     "nextCursor": "1708943200:142",
     "hostsChanged": ["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"],
     "startConfsChanged": ["raum1"],
     "configsChanged": [],
     "dhcpChanged": false,
     "deletedHosts": [],
     "deletedStartConfs": []
   }
   ```
4. If all change arrays are empty (no changes since last sync): Engine records cursor, no snapshot rebuild. Done.
5. If changes exist:
   a. Engine fetches changed data via batch:
      - `POST /api/v1/linbo/hosts:batch { "macs": ["AA:BB:...", "11:22:..."] }` → updated HostRecords
      - `POST /api/v1/linbo/startconfs:batch { "ids": ["raum1"] }` → updated StartConfRecords
   b. Engine copies `current/` → `staging/` using hardlinks (`cp -al`) for efficiency.
   c. For each changed host: Regenerate `staging/boot/grub/hostcfg/<hostname>.cfg`, update MAC mapping.
   d. For each deleted host: Remove hostcfg, remove from MAC mapping.
   e. For each changed startconf: Regenerate group `.cfg` and `start.conf`.
   f. For each deleted startconf: Remove group cfg, start.conf, and hostcfgs pointing to it.
   g. If `dhcpChanged`: Fetch and update DHCP export files.
   h. Regenerate `staging/grub.cfg.pxe` MAC mapping section.
   i. Update `staging/metadata.json`.
6. Integrity check on staging.
7. Atomic switch: `staging/` → `current/`, old `current/` → `previous/`.
8. Engine records `last_synced_cursor = "1708943200:142"`.
9. WebSocket broadcast: `sync.completed` with delta summary.

**Expected Result:** Snapshot updated with minimal changes. New boots get updated configs. < 2 seconds for small deltas.

**Error Handling:**
- Delta API returns error: Retry on next poll cycle. If persistent (3+ failures), attempt full resync.
- Delta version gap detected (API version jumped): Perform full resync instead of delta.
- File write failure during staging: Roll back staging, keep current. Retry next cycle.

**Performance Notes:**
- Small delta (1-10 changes): < 500ms including file I/O.
- Medium delta (100 changes): < 2s.
- Hardlink copy: Unmodified files share disk blocks, O(n) symlinks but O(1) data.
- Delta fetch network: < 10KB typically. Negligible bandwidth.

---

### UC-SYNC-03: Bulk Change (500 New Devices Imported)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-SYNC-03 |
| **Title** | Sync after admin imports 500 new devices via linuxmuster-import-devices |
| **Actor(s)** | Admin (School Console), LMN Server, Docker Sync Engine |
| **Preconditions** | Admin has prepared CSV with 500 new devices. Import triggers on LMN server. Docker polling interval is 30-60s. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Admin runs `linuxmuster-import-devices` on LMN server with 500-row CSV.
2. LMN processes import: creates 500 host entries, updates AD, regenerates DHCP.
3. LMN Authority API version jumps (500 individual changes or 1 bulk event).
4. Docker Sync Engine polls delta feed.
5. DeltaResponse contains 500 MACs in `hostsChanged[]`. Engine fetches all via `POST /api/v1/linbo/hosts:batch` (paginated, max 500 per request).
6. Engine decides strategy:
   a. If delta is manageable (< 1000 individual changes): Apply incrementally with hardlink copy.
   b. If API signals bulk change or delta too large: Perform full resync.
7. Staging directory built with all 500 new hostcfgs + updated MAC mapping.
8. Atomic snapshot switch.
9. All 500 new clients can now PXE boot.

**Alternative Flows:**

- **A1: Webhook notification.** LMN fires webhook immediately after import completes. Docker syncs within 1-2 seconds instead of waiting for next poll.
- **A2: Import in batches.** LMN processes import in batches. Multiple delta feeds over several poll cycles.

**Expected Result:** All 500 new devices bootable within 60 seconds of import completion (or 2 seconds with webhook).

**Error Handling:**
- Partial import on LMN (import fails halfway): Delta feed contains only successfully imported hosts. Docker syncs what is available. Admin retries import for remaining.
- Snapshot rebuild timeout: Set generous timeout for large rebuilds (30s). Log if exceeded.

**Performance Notes:**
- 500 host GRUB config generation: ~500 file writes = 2-3 seconds on SSD.
- MAC mapping regeneration for 2500 total hosts: < 1 second.
- Full resync (2500 hosts, 50 groups): < 10 seconds.

---

### UC-SYNC-04: Sync with LMN API Temporarily Unavailable

| Field | Value |
|-------|-------|
| **UC-ID** | UC-SYNC-04 |
| **Title** | Sync engine handles temporary LMN API outage |
| **Actor(s)** | Docker Sync Engine, LMN Authority API |
| **Preconditions** | Docker has valid `current/` snapshot. LMN API becomes temporarily unreachable (network issue, maintenance, restart). |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Sync Engine poll timer fires.
2. Engine calls `GET /api/v1/linbo/changes?since=<version>`.
3. Request fails (connection refused, timeout, 5xx error).
4. Engine logs: `WARN: LMN API unreachable (attempt 1/10): <error>`.
5. Engine increments failure counter, schedules retry with exponential backoff:
   - Attempt 1: wait 30s
   - Attempt 2: wait 60s
   - Attempt 3: wait 120s
   - Attempt 4+: wait 300s (max)
6. WebSocket broadcast: `sync.warning` with failure count and last successful sync timestamp.
7. Dashboard shows: "LMN Sync: Disconnected (5 failures, last success 3 min ago)".
8. Boot serving continues normally from `current/` snapshot (no impact on clients).
9. After N minutes, LMN API comes back online.
10. Next retry succeeds. Engine fetches delta, rebuilds snapshot.
11. Failure counter resets. Dashboard shows: "LMN Sync: Connected".
12. WebSocket broadcast: `sync.recovered`.

**Alternative Flows:**

- **A1: Extended outage (>1 hour).** Engine continues retrying every 300s. Logs at ERROR level after 10 failures. Admin may investigate.
- **A2: API returns 503 with Retry-After header.** Engine respects header and waits specified duration.

**Expected Result:** Boot serving unaffected during outage. Sync resumes automatically when API recovers. Admin informed throughout.

**Error Handling:**
- API returns 401 (token invalid): See UC-ERR-09. Engine enters degraded mode, admin must update Bearer token.
- API returns 410 (delta no longer available, version too old): Engine performs full resync.
- If outage exceeds `DELTA_MAX_AGE` (24h or 10,000 events), Authority API forces full dump (cursor reset).

**Performance Notes:** No performance impact during outage. Snapshot serving is purely local.

---

### UC-SYNC-05: Sync Receives Corrupted/Invalid Data

| Field | Value |
|-------|-------|
| **UC-ID** | UC-SYNC-05 |
| **Title** | Sync engine receives invalid or corrupted data from LMN API |
| **Actor(s)** | Docker Sync Engine, LMN Authority API |
| **Preconditions** | Docker sync running normally. LMN API returns data that fails validation. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Sync Engine calls delta API. Response received successfully (HTTP 200).
2. Engine runs validation on response body:
   - JSON schema validation
   - Per-entity validation (MAC format, hostname charset, start.conf syntax)
3. Validation fails on one or more entities. Examples:
   - MAC address `XX:YY:ZZ` (invalid hex)
   - Hostname `pc 01` (space in hostname)
   - start.conf with missing `[LINBO]` section
   - Duplicate MAC addresses across hosts
4. Engine behavior (configurable):
   - **Strict mode (default):** Rejects the **entire delta batch**. Does NOT update snapshot.
   - **Lenient mode:** Accepts valid entities, skips invalid ones with warnings.
5. Engine logs: `ERROR: Sync validation failed: <details>`. Lists all validation errors.
6. WebSocket broadcast: `sync.validation_error` with error details.
7. Dashboard shows: "Sync Error: 3 validation failures" with expandable details.
8. Engine continues polling. Next delta may include fixes from admin.

**Alternative Flows:**

- **A1: Auto-sanitization.** Engine attempts to fix common issues (e.g., lowercase MAC, trim whitespace from hostname). Logs corrections. If unfixable, rejects entity.
- **A2: >10% of records invalid.** Even in lenient mode, entire batch is rejected to prevent cascading errors.

**Expected Result:** Invalid data never reaches the boot-serving snapshot. Admin informed of validation errors. Boot serving continues with previous valid data.

**Error Handling:**
- All entities invalid: Full rejection. Alarm raised.
- JSON parse failure: Treat as API error, retry on next cycle.
- Cursor NOT advanced on rejection, ensuring retry picks up the same data.

**Performance Notes:** Validation overhead: ~1ms per entity. Negligible for any dataset size.

---

### UC-SYNC-06: Atomic Snapshot Switch

| Field | Value |
|-------|-------|
| **UC-ID** | UC-SYNC-06 |
| **Title** | Atomic swap from staging snapshot to current |
| **Actor(s)** | Docker Sync Engine |
| **Preconditions** | `staging/` directory fully built and integrity-checked. `current/` exists (may be absent on first sync). |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Engine completes staging build and integrity check.
2. Engine performs atomic switch using symlinks:
   ```
   a. Create new symlink: ln -sfn snap-<timestamp>/ current.new
   b. Atomic rename: rename("current.new", "current")   # single syscall, atomic on Linux
   c. Update previous: ln -sfn <old-target> previous
   d. Cleanup: remove snapshots beyond SNAPSHOT_MAX_KEEP (default 3)
   ```
   Alternative (directory-based):
   ```
   a. rm -rf previous/
   b. rename current/ -> previous/
   c. rename staging/ -> current/
   ```
3. Active boot requests:
   - Clients mid-TFTP transfer: TFTP reads are file-descriptor based. Open FDs continue reading from old inode (previous/). Safe.
   - Clients mid-HTTP transfer: nginx has open file handles. Same inode behavior. Safe.
   - New requests after rename: Serve from new `current/`. Correct.
4. Engine updates `last_synced_cursor`.
5. WebSocket broadcast: `snapshot.switched` with version and timestamp.

**Alternative Flows:**

- **A1: Symlink-based switch (preferred).** Uses `ln -sfn` + `rename` for single-syscall atomicity. Even safer than directory renames.

**Expected Result:** Zero-downtime switch. No client ever sees partial or inconsistent config. Old configs remain accessible via `previous/` for rollback.

**Error Handling:**
- Rename fails (disk error, permission): Engine leaves `current/` untouched. Staging remains for retry. Error logged.
- Power loss mid-switch: On ext4/xfs, rename is atomic. At most one of the two renames completes. Recovery: check if `current/` exists; if not, rename `staging/` or `previous/` to `current/`.

**Performance Notes:** `rename()` syscall: < 1ms. Zero-copy, zero-downtime.

---

### UC-SYNC-07: Rollback to Previous Snapshot

| Field | Value |
|-------|-------|
| **UC-ID** | UC-SYNC-07 |
| **Title** | Admin triggers rollback from current snapshot to previous |
| **Actor(s)** | Admin (Docker Dashboard), Docker Sync Engine |
| **Preconditions** | `current/` snapshot is faulty (e.g., wrong configs causing boot failures). `previous/` snapshot exists and is known-good. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Admin observes boot failures or incorrect configs via dashboard.
2. Admin clicks "Rollback to Previous Snapshot" button.
3. Frontend sends: `POST /api/v1/sync/rollback`.
4. API validates `previous/` snapshot integrity (manifest.json, file counts).
5. Engine performs atomic switch:
   ```
   a. current symlink updated to point to previous snapshot directory
   b. SyncState.cursor reset to previous snapshot's cursor value
   c. SyncState.status set to "rolled_back"
   ```
6. Boot serving immediately uses rolled-back snapshot.
7. Engine pauses automatic sync (to prevent re-syncing the bad data).
8. Dashboard shows: "ROLLBACK ACTIVE - Auto-sync paused. Previous snapshot serving."
9. Admin investigates and fixes issue on LMN server.
10. Admin clicks "Resume Sync". Engine resumes polling, performs full resync.
11. New valid snapshot replaces rolled-back one.

**Expected Result:** Boot serving restored to known-good state within seconds. Auto-sync paused to prevent re-introducing bad data.

**Error Handling:**
- No `previous/` exists: Rollback not possible. Error message to admin. Must fix forward.
- `previous/` also faulty: Admin must manually intervene or perform emergency full resync.
- Maximum rollback depth: `SNAPSHOT_MAX_KEEP - 1` snapshots.

**Performance Notes:** Rollback is instant (symlink update or rename syscall). Boot serving restored in < 1 second.

---

### UC-SYNC-08: Webhook-Triggered Immediate Sync

| Field | Value |
|-------|-------|
| **UC-ID** | UC-SYNC-08 |
| **Title** | LMN server sends webhook to trigger immediate Docker sync |
| **Actor(s)** | LMN Authority API, Docker Sync Engine |
| **Preconditions** | LMN server configured with Docker webhook URL. Docker API has webhook endpoint. Shared secret for authentication. |
| **Phase** | Phase 2 (Snapshot Sync Engine) + Phase 3 (Webhook Integration) |

**Main Flow:**

1. Admin makes change on LMN server (e.g., edits devices.csv, changes group config).
2. LMN Authority API processes change and fires webhook:
   ```
   POST https://<docker-ip>:3000/api/v1/internal/webhook
   X-Webhook-Secret: <shared_secret>
   Content-Type: application/json
   {"event": "data_changed", "cursor": 143, "summary": "host:upsert:pc01"}
   ```
3. Docker API validates webhook signature/secret.
4. API signals Sync Engine to perform immediate delta fetch (bypasses poll timer).
5. Engine calls delta API: `GET /api/v1/linbo/changes?since=<last_version>`.
6. Delta applied, snapshot rebuilt and switched (UC-SYNC-02 flow).
7. Total latency from change to live: 1-3 seconds.

**Alternative Flows:**

- **A1: Webhook delivery fails.** LMN retries 3 times with backoff. If all fail, Docker catches up on next poll cycle (30-60s).
- **A2: Multiple webhooks in quick succession.** Engine debounces: if a sync is already in progress, queues one more sync after completion. Does not queue multiple.

**Expected Result:** Config changes on LMN server reflected in Docker within 1-3 seconds.

**Error Handling:**
- Invalid webhook secret: Reject with 401. Log suspicious request.
- Webhook flood: Rate limit to max 1 sync per second. Queue excess.

**Performance Notes:** Webhook reduces worst-case latency from 60 seconds (poll interval) to 1-3 seconds.

---

### UC-SYNC-09: Concurrent Sync (Changes During Active Sync)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-SYNC-09 |
| **Title** | New changes arrive from LMN while a sync is already in progress |
| **Actor(s)** | Docker Sync Engine, LMN Authority API |
| **Preconditions** | Sync Engine is currently building a staging snapshot. New changes are made on LMN server. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Engine is processing delta (version 140 -> 142), building staging.
2. Webhook arrives (or poll fires) indicating version 143 is available.
3. Engine notes the incoming change but does NOT interrupt current staging:
   - Sets `pending_sync = true`.
4. Current staging completes. Snapshot switched to version 142.
5. Engine checks `pending_sync` flag.
6. Engine immediately starts new delta fetch: `GET /api/v1/linbo/changes?since=142`.
7. Gets version 143, applies it, rebuilds snapshot.
8. `pending_sync` cleared.

**Alternative Flows:**

- **A1: Multiple changes during long staging.** Engine only queues one follow-up sync. The follow-up will catch all accumulated changes since last synced version.
- **A2: Staging fails.** `pending_sync` remains true. Engine retries both the failed sync and the pending changes.

**Expected Result:** No changes are lost. At most one sync-cycle delay for changes that arrive during active sync.

**Error Handling:**
- Deadlock prevention: Sync Engine uses a mutex/lock. Only one sync runs at a time.
- Timeout on staging build: If staging takes > 30s, abort and retry.

**Performance Notes:** Queue depth is always 0 or 1. No unbounded queue growth.

---

### UC-SYNC-10: DHCP Export Sync (Option 40 Correctness)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-SYNC-10 |
| **Title** | Sync ensures DHCP Option 40 (nisdomain = HOSTGROUP) is correctly exported |
| **Actor(s)** | Docker Sync Engine, DHCP Server Configuration |
| **Preconditions** | Docker manages or exports DHCP configuration. LMN API provides host-to-group mapping. |
| **Phase** | Phase 3 (DHCP Integration) |

**Main Flow:**

1. Delta feed includes host group assignment changes.
2. Engine generates DHCP export file in staging:
   - For each host: `host <hostname> { hardware ethernet <mac>; fixed-address <ip>; option nisdomain "<group>"; option host-name "<hostname>"; }`
   - Or ISC DHCP include format, or KEA JSON, or OPNsense API format.
3. Engine generates DHCP class/group mappings:
   - Each HOSTGROUP maps to an Option 40 value.
   - Hosts without static IP get pool assignment with group-based Option 40.
4. Export file written to `staging/dhcp/dhcpd.hosts.conf` (or equivalent).
5. After snapshot switch, DHCP reload triggered:
   - If Docker DHCP: Send SIGHUP to dhcpd or restart container.
   - If external DHCP (OPNsense): Push via API or SCP + reload signal.
6. DHCP server now serves correct Option 40 for all hosts.

**Alternative Flows:**

- **A1: OPNsense as DHCP.** Docker generates OPNsense-compatible config and pushes via OPNsense API.
- **A2: Docker proxy-DHCP only.** Proxy-DHCP provides PXE options but not Option 40. Option 40 must come from primary DHCP. Docker generates config for primary DHCP to import.

**Expected Result:** Every host receives correct Option 40 matching its HOSTGROUP. GRUB resolves correct group config.

**Error Handling:**
- DHCP reload fails: Alert admin. Old DHCP config still active (may serve stale group assignments).
- Option 40 value contains invalid characters: Validation rejects during sync. Must be alphanumeric + hyphens.

**Performance Notes:** DHCP config generation for 2000 hosts: < 1 second. DHCP reload: < 2 seconds.

---

## C. Admin/Operations Scenarios

### UC-OPS-01: linbo-remote Command from Docker Frontend

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-01 |
| **Title** | Admin executes linbo-remote command on one or more hosts from Docker frontend |
| **Actor(s)** | Admin (Docker Dashboard), Docker API, LINBO Client(s) |
| **Preconditions** | Target host(s) booted into LINBO (status: `linbo`). SSH service running on port 2222. Admin authenticated with valid JWT token. |
| **Phase** | Phase 4 (Operations) |

**Main Flow:**

1. Admin selects host(s) in dashboard, chooses action (e.g., "Sync + Start OS 1").
2. Frontend sends to API:
   ```
   POST /api/v1/operations/remote
   {
     "hostIds": ["<id1>", "<id2>"],
     "commands": "sync:1,start:1",
     "options": { "wol": false }
   }
   ```
3. API validates command string via `parseCommands()`. Known commands: `label`, `partition`, `format`, `initcache`, `new`, `sync`, `postsync`, `start`, `prestart`, `create_image`, `create_qdiff`, `upload_image`, `upload_qdiff`, `reboot`, `halt`. Special flags: `noauto`, `disablegui`.
4. API creates `Operation` record in database (status: `pending`).
5. API creates `Session` records for each target host.
6. WebSocket broadcast: `operation.started`.
7. For each host (with concurrency limit, default `MAX_CONCURRENT_SESSIONS=5`):
   a. Test SSH connection to host IP via `sshService.testConnection()`.
   b. If online: disable GUI (`gui_ctl disable`), execute `/usr/bin/linbo_wrapper sync:1,start:1`, re-enable GUI if no terminal command.
   c. Update `Session` status (running -> completed/failed).
   d. WebSocket broadcast: `session.started`, `session.completed`, or `session.failed`.
8. After all hosts processed:
   - Operation marked as `completed`, `failed`, or `completed_with_errors`.
   - WebSocket broadcast: `operation.completed` with stats.
9. Dashboard updates in real-time showing progress bar and per-host results.

**Alternative Flows:**

- **A1: Host not online.** SSH test fails. Session marked as `failed` with "Host not online". Operation continues with remaining hosts.
- **A2: WoL before command.** If `options.wol = true`, WoL magic packets sent first (via `wolService.sendWakeOnLanBulk`), then optional wait (`options.wolWait` seconds), then SSH commands.
- **A3: Onboot mode.** Commands written to `.cmd` files (`/srv/linbo/linbocmd/<hostname>.cmd`) instead of SSH execution. Commands execute when client next boots into LINBO.

**Expected Result:** Commands executed on all reachable hosts. Admin sees real-time progress. Failed hosts clearly indicated.

**Error Handling:**
- SSH timeout (default 300s for long operations like sync): Session marked as failed.
- Invalid command string: API returns 400 before creating operation.
- Host removed during operation: Session fails gracefully, operation continues.

**Performance Notes:**
- Concurrency limit prevents SSH connection exhaustion (default 5, configurable via `MAX_CONCURRENT_SESSIONS`).
- For 100 hosts at concurrency 5: ~20 batches. If each batch takes 30s (sync+start): ~10 minutes total.

---

### UC-OPS-02: Wake-on-LAN Single Host

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-02 |
| **Title** | Admin sends WoL magic packet to wake a single host |
| **Actor(s)** | Admin (Docker Dashboard), Docker API, Target Host (powered off) |
| **Preconditions** | Host MAC address known (from snapshot). Host NIC supports WoL and is enabled in BIOS. Host connected to network (power to NIC even when off). |
| **Phase** | Phase 4 (Operations) |

**Main Flow:**

1. Admin selects host in dashboard, clicks "Wake Up".
2. Frontend sends: `POST /api/v1/hosts/<id>/wol`.
3. API retrieves host MAC from snapshot (or database).
4. `wolService.sendWakeOnLan(macAddress)`:
   a. Creates magic packet: 6 bytes `0xFF` + MAC repeated 16 times = 102 bytes.
   b. Opens UDP socket, enables broadcast.
   c. Sends 3 packets (100ms apart) to broadcast address `255.255.255.255:9`.
   d. Closes socket.
5. API responds: `{ "macAddress": "AA:BB:CC:DD:EE:FF", "packetsSent": 3 }`.
6. Host NIC detects magic packet, powers on motherboard.
7. Host BIOS starts, PXE boot begins (UC-BOOT-01).

**Alternative Flows:**

- **A1: Subnet-specific broadcast.** If host is on a different subnet, use subnet broadcast address (e.g., `10.0.1.255`) via `sendWakeOnLanToSubnet()`.
- **A2: WoL fails (host does not wake).** Admin sees no status change after ~60s. May retry or check BIOS WoL setting physically.

**Expected Result:** Host powers on and begins PXE boot within 5-10 seconds of WoL packet.

**Error Handling:**
- Invalid MAC: `createMagicPacket()` throws error. API returns 400.
- Socket error (permission denied): Docker container must have `NET_RAW` capability for raw UDP broadcast.
- WoL not supported by NIC: Packet sent but no effect. No error detectable server-side.

**Performance Notes:** 3 UDP packets x 102 bytes. Negligible network and CPU usage.

---

### UC-OPS-03: Wake-on-LAN Entire Room

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-03 |
| **Title** | Admin wakes all hosts in a room |
| **Actor(s)** | Admin (Docker Dashboard), Docker API |
| **Preconditions** | Room exists in snapshot with assigned hosts. All host NICs support WoL. |
| **Phase** | Phase 4 (Operations) |

**Main Flow:**

1. Admin selects room in dashboard, clicks "Wake All".
2. Frontend sends: `POST /api/v1/rooms/<id>/wol` or `POST /api/v1/operations/wol { "roomId": "<id>" }`.
3. API calls `getHostsByFilter({ roomId })` to get all hosts in room.
4. `wolService.sendWakeOnLanBulk(macAddresses)`:
   - Sends WoL to all hosts in parallel via `Promise.allSettled`.
   - Each host gets 3 magic packets.
5. API responds with results: `{ total: 30, successful: 30, failed: 0 }`.
6. WebSocket broadcast: `wol.sent` with stats.
7. Hosts power on and begin PXE boot.

**Alternative Flows:**

- **A1: WoL + Command.** Admin selects "Wake + Sync + Start". Uses `wakeAndExecute()`:
  1. Send WoL to all hosts.
  2. Wait `wolWait` seconds (e.g., 120s for hosts to boot to LINBO).
  3. Execute `sync:1,start:1` via SSH on all hosts that are now online.
- **A2: Some hosts fail WoL.** Results show which MACs failed. Admin can retry individually.

**Expected Result:** All room hosts powered on. Optional follow-up command executed after boot.

**Error Handling:**
- Empty room: API returns error "No hosts found."
- Mixed subnet room: Some hosts may need different broadcast addresses.

**Performance Notes:** 30 hosts x 3 packets x 100ms interval = ~300ms per host, but parallelized = ~300ms total. Very fast.

---

### UC-OPS-04: Bulk Sync Operation (Multiple Hosts)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-04 |
| **Title** | Admin triggers image sync on multiple hosts simultaneously |
| **Actor(s)** | Admin (Docker Dashboard), Docker API, LINBO Clients |
| **Preconditions** | Multiple hosts booted into LINBO. Image available on Docker rsync. |
| **Phase** | Phase 4 (Operations) |

**Main Flow:**

1. Admin selects multiple hosts (by room, group, or individual selection).
2. Admin chooses "Sync OS 1" from action menu.
3. Frontend sends: `POST /api/v1/operations/remote { "hostIds": [...], "commands": "sync:1" }`.
4. API creates Operation with Sessions for each host (UC-OPS-01 flow).
5. SSH commands executed with concurrency limit (default 5).
6. Each host's LINBO runs `linbo_wrapper sync:1`:
   - Compares local image with server image (rsync checksum).
   - Downloads delta or full image as needed.
   - Writes image to local partition.
7. Progress updates via WebSocket per session.
8. Operation completes with per-host success/failure summary.

**Expected Result:** All targeted hosts have synced OS image. Dashboard shows completion status per host.

**Error Handling:**
- Image not found on server: linbo_wrapper returns error code. Session marked failed.
- Network interruption during sync: linbo_wrapper times out. Session marked failed. Admin can retry.
- Disk full on client: linbo_wrapper reports error. Admin must free space or resize partition.

**Performance Notes:**
- Image sync bandwidth: rsync delta typically 1-10% of full image. For 50GB image with 1GB changes: ~1GB per host.
- Concurrency 5: Limits server rsync bandwidth usage. At 1Gbps: ~200Mbps per host = ~25 minutes per 50GB sync.
- Consider increasing concurrency for delta-only syncs (low bandwidth).

---

### UC-OPS-05: View Operation History/Logs

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-05 |
| **Title** | Admin views past operations, their sessions, and logs |
| **Actor(s)** | Admin (Docker Dashboard) |
| **Preconditions** | Operations have been executed previously. |
| **Phase** | Phase 4 (Operations) |

**Main Flow:**

1. Admin navigates to "Operations" page in dashboard.
2. Frontend fetches: `GET /api/v1/operations?page=1&limit=50&sort=createdAt:desc`.
3. Dashboard shows table of operations:
   - ID, Type (direct/onboot), Commands, Status, Host Count, Success/Fail, Created, Duration.
4. Admin clicks on an operation to expand detail view.
5. Frontend fetches: `GET /api/v1/operations/<id>`.
6. Detail view shows:
   - Operation metadata and options.
   - Session list: hostname, status (completed/failed), start time, end time.
   - For each session: stdout, stderr, exit code (from SSH execution).
7. Admin can filter by status, date range, host, command type.

**Expected Result:** Admin has full visibility into all past operations and per-host execution results.

**Error Handling:**
- Large result set: Pagination prevents memory issues.
- Old operations cleaned up: Retention policy (e.g., 30 days) configurable.

**Performance Notes:** Database query with index on `createdAt`. < 50ms for paginated list.

---

### UC-OPS-06: Image Upload from PXE Client

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-06 |
| **Title** | LINBO client creates and uploads an OS image to Docker |
| **Actor(s)** | Admin (LINBO GUI or linbo-remote), LINBO Client, Docker rsync |
| **Preconditions** | Client booted into LINBO with a synced/installed OS. Docker rsync module `linbo` is writable for image uploads. Image name defined in start.conf. |
| **Phase** | Phase 4 (Operations) |

**Main Flow:**

1. Admin triggers image creation:
   - Via LINBO GUI: Long-press on OS card, select "Create Image".
   - Via linbo-remote: `create_image:1:"Initial Windows 11 image"`.
2. LINBO creates QCOW2 image from OS partition:
   - Reads partition block-by-block.
   - Compresses into QCOW2 format.
   - Calculates MD5/SHA256 checksum.
3. LINBO uploads image to Docker via rsync:
   - Target: `rsync://<docker-ip>/linbo/images/<group>/<imagename>.qcow2`
   - Also uploads: `.qcow2.md5`, `.qcow2.info` (metadata), `.qcow2.desc` (description).
4. Docker rsync receives files into `/srv/linbo/images/<group>/`.
5. Docker API detects new image (via filesystem watcher or rsync post-transfer hook):
   - Verifies checksum.
   - Updates image metadata in database/state.
   - WebSocket broadcast: `image.uploaded`.
6. Dashboard shows new image with size, checksum, creation date.

**Alternative Flows:**

- **A1: Differential image (qdiff).** `create_qdiff:1` creates a QCOW2 differential against the base image. Smaller upload.
- **A2: Upload fails mid-transfer.** rsync supports resume. Client retries. Partial file detected by checksum mismatch.

**Expected Result:** Complete OS image stored on Docker. Verifiable by checksum. Available for deployment to other clients.

**Error Handling:**
- Disk full on Docker: rsync transfer fails. Alert admin. See UC-ERR-05.
- Checksum mismatch after upload: Image marked as corrupt. Admin can retry upload.
- Concurrent uploads from multiple clients: rsync handles file locking. Second upload waits or overwrites.

**Performance Notes:**
- Image creation: ~5-15 minutes for 50GB partition (depends on compression ratio and client CPU/disk speed).
- Upload: At 1Gbps = ~400 seconds for 50GB raw. With QCOW2 compression: typically 10-30GB = 80-240 seconds.

---

### UC-OPS-07: Image Verification (Checksum)

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-07 |
| **Title** | Admin verifies integrity of a stored image |
| **Actor(s)** | Admin (Docker Dashboard), Docker API |
| **Preconditions** | Image exists in `/srv/linbo/images/`. |
| **Phase** | Phase 4 (Operations) |

**Main Flow:**

1. Admin selects image in Images page, clicks "Verify Checksum".
2. Frontend sends: `POST /api/v1/images/<id>/verify`.
3. API calculates MD5/SHA256 of the image file on disk.
4. API compares with stored `.qcow2.md5` file.
5. Result returned: match or mismatch.
6. Dashboard shows verification result with timestamp.

**Expected Result:** Admin confirms image integrity. Corrupt images identified.

**Error Handling:**
- Image file missing: Error returned. Dashboard shows "File not found."
- Checksum file missing: API calculates checksum and creates `.md5` file.

**Performance Notes:** MD5 of 30GB file: ~30 seconds (depends on disk I/O). SHA256: ~45 seconds. Consider background job for large images.

---

### UC-OPS-08: Image Deletion

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-08 |
| **Title** | Admin deletes an OS image from Docker storage |
| **Actor(s)** | Admin (Docker Dashboard), Docker API |
| **Preconditions** | Image exists. No active operations referencing this image. |
| **Phase** | Phase 4 (Operations) |

**Main Flow:**

1. Admin selects image, clicks "Delete".
2. Dashboard shows confirmation dialog: "Delete image '<name>'? This cannot be undone. X clients in group Y reference this image."
3. Admin confirms.
4. Frontend sends: `DELETE /api/v1/images/<id>`.
5. API checks for active operations/sync sessions using this image.
6. API deletes files:
   - `<name>.qcow2`
   - `<name>.qcow2.md5`
   - `<name>.qcow2.info`
   - `<name>.qcow2.desc`
   - Any differential images (`<name>.qdiff`, etc.)
7. API updates database/state.
8. WebSocket broadcast: `image.deleted`.
9. Dashboard removes image from list.

**Expected Result:** Image and all associated files removed from Docker storage. Disk space freed.

**Error Handling:**
- Image in use by active operation: Deletion blocked with error message.
- File permissions: API must have write access to image directory.
- Referenced in start.conf: Warning shown but deletion allowed (start.conf on LMN server is authoritative; Docker image is a local copy).

**Performance Notes:** File deletion is instant. No performance concern.

---

### UC-OPS-09: Kernel Switching

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-09 |
| **Title** | Admin installs or switches to a different LINBO kernel variant |
| **Actor(s)** | Admin (Docker Dashboard), Docker API |
| **Preconditions** | Multiple kernel packages/variants available (e.g., from GitHub releases). |
| **Phase** | Phase 5 (Kernel Management) |

**Main Flow:**

1. Admin navigates to "Kernel" page in dashboard.
2. Dashboard shows:
   - Current active kernel (version, size, module count).
   - Available kernel variants from configured source (e.g., GitHub releases).
3. Admin selects a kernel variant and clicks "Install".
4. API downloads kernel package:
   - `linbo64` (kernel binary)
   - `linbofs64` (initramfs)
   - `linbo_gui64_7.tar.lz` (GUI archive)
5. API places files in staging area, verifies checksums.
6. Admin clicks "Activate".
7. API atomically replaces `/srv/linbo/linbo64` and `/srv/linbo/linbofs64`:
   - Backup: `linbo64.bak`, `linbofs64.bak`.
   - Replace: rename new files to `linbo64`, `linbofs64`.
   - Update MD5 files.
8. WebSocket broadcast: `kernel.switched`.
9. Next PXE boot uses new kernel.

**Alternative Flows:**

- **A1: Rollback kernel.** Admin clicks "Rollback". Backup files restored.
- **A2: Custom kernel build.** Admin uploads custom-built kernel via API.

**Expected Result:** New kernel active for all subsequent PXE boots. Rollback available if issues detected.

**Error Handling:**
- Download failure: Retry with backoff.
- Checksum mismatch: Reject installation. Keep current kernel.
- New kernel causes boot failures: Admin rolls back via dashboard. Previous kernel restored.

**Performance Notes:** Kernel files total ~370MB. Download at 100Mbps: ~30 seconds.

---

### UC-OPS-10: Firmware Upload and Deployment

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-10 |
| **Title** | Admin uploads firmware files for inclusion in linbofs |
| **Actor(s)** | Admin (Docker Dashboard), Docker API |
| **Preconditions** | Admin has firmware files (e.g., WiFi, Ethernet) needed by LINBO kernel. |
| **Phase** | Phase 5 (Firmware Management) |

**Main Flow:**

1. Admin navigates to "Firmware" page.
2. Admin uploads firmware files (`.bin`, `.fw`, etc.) via drag-and-drop or file picker.
3. API stores firmware in `/srv/linbo/firmware/` directory.
4. Admin selects firmware files to include in linbofs.
5. Admin clicks "Rebuild linbofs".
6. API runs `update-linbofs.sh` which:
   - Extracts current `linbofs64` initramfs.
   - Copies selected firmware to `lib/firmware/` inside initramfs.
   - Repacks initramfs.
   - Updates `linbofs64` and `.md5`.
7. WebSocket broadcast: `firmware.deployed`.
8. Next PXE boot includes new firmware.

**Expected Result:** LINBO kernel loads with new firmware, enabling hardware that requires it (e.g., WiFi adapters).

**Error Handling:**
- Invalid firmware file: Validation by file type/header.
- linbofs rebuild fails: Original linbofs64 preserved (backup).
- Firmware path incorrect: LINBO kernel cannot find firmware at runtime. Admin must verify path matches kernel expectations.

**Performance Notes:** linbofs rebuild: ~30-60 seconds (decompress + modify + recompress ~350MB).

---

### UC-OPS-11: Driver/Patchclass Creation and Management

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-11 |
| **Title** | Admin creates and manages Windows driver patchclasses |
| **Actor(s)** | Admin (Docker Dashboard), Docker API |
| **Preconditions** | Windows images deployed. Driver packages available. |
| **Phase** | Phase 5 (Driver Management) |

**Main Flow:**

1. Admin navigates to "Drivers" page.
2. Admin creates a new patchclass (e.g., "dell-optiplex-7090"):
   - Name, description, target OS, hardware match criteria.
3. Admin uploads driver packages (.inf, .sys, .cat files) to the patchclass.
4. API stores drivers in `/srv/linbo/images/<group>/drivers/<patchclass>/`.
5. Admin assigns patchclass to hosts or groups (via start.conf `Patchclass = <name>`).
6. During LINBO sync/new operation, postsync script:
   - Detects patchclass assignment.
   - Copies drivers from server to Windows driver store.
   - Runs `dism /add-driver` or equivalent.
7. Windows boots with correct drivers.

**Expected Result:** Windows hosts receive hardware-specific drivers during image deployment.

**Error Handling:**
- Driver incompatible: Windows rejects driver during DISM. Logged in postsync output.
- Missing driver dependency: Warning in dashboard.

**Performance Notes:** Driver transfer: typically < 100MB per patchclass. Negligible vs. full image sync.

---

### UC-OPS-12: GRUB Theme Customization

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-12 |
| **Title** | Admin customizes GRUB boot menu theme |
| **Actor(s)** | Admin (Docker Dashboard), Docker API |
| **Preconditions** | GRUB theme files exist in `/srv/linbo/boot/grub/themes/`. |
| **Phase** | Phase 6 (UI Customization) |

**Main Flow:**

1. Admin navigates to "GRUB Theme" page.
2. Dashboard shows current theme with preview.
3. Admin modifies:
   - Background image (upload PNG/JPG)
   - Font (upload .pf2 file)
   - Colors (text, selection, background)
   - Boot logo (school/org logo)
4. API updates theme files in `/srv/linbo/boot/grub/themes/linbo/`.
5. Preview updates in dashboard.
6. Next PXE boot shows customized GRUB menu.

**Expected Result:** GRUB boot menu displays custom branding.

**Error Handling:**
- Invalid image format: Validation rejects.
- Theme file too large: TFTP transfer slow. Warn if total theme > 5MB.

**Performance Notes:** Theme files loaded via TFTP during GRUB stage. Large themes add boot latency.

---

### UC-OPS-13: View Boot Logs and Troubleshoot Failing Client

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-13 |
| **Title** | Admin troubleshoots a client that fails to PXE boot |
| **Actor(s)** | Admin (Docker Dashboard) |
| **Preconditions** | Client attempted PXE boot. Docker services have logging enabled. |
| **Phase** | Phase 5 (Monitoring) |

**Main Flow:**

1. Admin reports client "pc01" is not booting.
2. Admin navigates to "Boot Logs" or host detail page in dashboard.
3. Dashboard shows aggregated log timeline:
   a. **DHCP:** Was DHCP OFFER sent? Check DHCP server logs. (IP assigned? Option 40 correct?)
   b. **TFTP:** Did client request GRUB bootloader? Check TFTP access log. (File served? Timeout?)
   c. **HTTP:** Did client request linbo64/linbofs64? Check nginx access log. (200 OK? 404?)
   d. **rsync:** Did client request start.conf? Check rsync log.
   e. **SSH:** Did client connect for status update? Check SSH connection log.
4. Dashboard shows: "Last seen: TFTP request at 08:15:23, requested boot/grub/x86_64-efi/core.efi".
5. Admin identifies: "HTTP request for linbofs64 returned 404 -- file missing."
6. Admin takes corrective action (re-deploy kernel, check file permissions).

**Alternative Flows:**

- **A1: Client never reached TFTP.** Problem is DHCP or physical (cable, NIC, BIOS setting).
- **A2: Client stuck at GRUB.** Hostcfg not found. Check snapshot for hostcfg file.
- **A3: Client boots LINBO but shows Control Mode.** Missing linbo_gui64_7.tar.lz or wrong start.conf.

**Expected Result:** Admin can trace exactly where in the boot chain the client failed.

**Error Handling:**
- Log rotation: Ensure logs retained for reasonable period (7 days minimum).
- Missing log entries: Some services may not log at debug level by default. Admin can increase log level.

**Performance Notes:** Log aggregation should use indexed storage. grep across raw logs for 2000 clients is slow.

---

### UC-OPS-14: Monitor Snapshot Sync Health

| Field | Value |
|-------|-------|
| **UC-ID** | UC-OPS-14 |
| **Title** | Admin monitors the health and status of snapshot sync |
| **Actor(s)** | Admin (Docker Dashboard) |
| **Preconditions** | Docker sync engine is running. Dashboard is accessible. |
| **Phase** | Phase 2 (Snapshot Sync) + Phase 5 (Monitoring) |

**Main Flow:**

1. Admin views dashboard home page or dedicated "Sync Status" widget.
2. Dashboard displays:
   - **Sync Status:** Connected / Disconnected / Error / Rolled Back
   - **Last Successful Sync:** timestamp + version number
   - **Snapshot Version:** current version, host count, group count
   - **Sync History:** last 10 syncs with duration, change count, status
   - **LMN API Health:** response time, last check
   - **Previous Snapshot:** version, timestamp (available for rollback)
3. Real-time updates via WebSocket:
   - `sync.completed`, `sync.error`, `sync.warning`, `sync.recovered`, `snapshot.switched`
4. If sync is degraded (>3 consecutive failures):
   - Dashboard shows red alert bar: "Sync unhealthy since <timestamp>".
   - Optional: email/webhook notification to admin.

**Expected Result:** Admin has at-a-glance visibility into sync health. Can immediately detect and respond to sync issues.

**Error Handling:**
- Dashboard WebSocket disconnects: Auto-reconnect (already implemented in frontend wsStore).
- Stale data: Dashboard shows "Last update: X min ago" warning if WebSocket reconnect takes long.

**Performance Notes:** WebSocket events: < 1KB each. Dashboard rendering: < 100ms.

---

## D. Error/Edge Cases

### UC-ERR-01: DHCP Server Not Responding During Boot

| Field | Value |
|-------|-------|
| **UC-ID** | UC-ERR-01 |
| **Title** | PXE client cannot obtain IP address from DHCP |
| **Actor(s)** | PXE Client |
| **Preconditions** | Client powered on. DHCP server is down, overloaded, or misconfigured. |
| **Phase** | Phase 5 (Monitoring) |

**Main Flow:**

1. Client NIC sends DHCP DISCOVER.
2. No DHCP OFFER received within timeout (typically 4 seconds).
3. Client retries DHCP DISCOVER (exponential backoff):
   - Attempt 2: 8 seconds
   - Attempt 3: 16 seconds
   - Attempt 4: 32 seconds
4. After 4 failed attempts (~60 seconds), PXE firmware:
   a. If local disk has bootable OS: Falls back to local disk boot (BIOS boot order).
   b. If no local OS: Displays "PXE-E51: No DHCP or proxyDHCP offers were received" or similar error.
   c. Some NIC firmware retries indefinitely with longer intervals.
5. Client does NOT reach Docker TFTP or any LINBO services.
6. Docker has no visibility into this failure (no request received).

**Expected Result:** Client fails to PXE boot. Falls back to local boot or shows PXE error.

**Error Handling:**
- Docker monitoring: Cannot directly detect DHCP failures for individual clients.
- Indirect detection: If many hosts expected to be in LINBO status but aren't (no heartbeat after scheduled WoL), admin is alerted.
- DHCP health check: Docker can periodically test DHCP from its own subnet (send DHCP DISCOVER from test MAC).

**Performance Notes:** N/A - failure case.

---

### UC-ERR-02: TFTP Timeout During Boot Storm

| Field | Value |
|-------|-------|
| **UC-ID** | UC-ERR-02 |
| **Title** | TFTP server overwhelmed during simultaneous boot of many clients |
| **Actor(s)** | PXE Clients (many), Docker TFTP |
| **Preconditions** | Large number of clients booting simultaneously. TFTP server resource limits reached. |
| **Phase** | Phase 2 (Performance Tuning) |

**Main Flow:**

1. 2000 clients simultaneously request GRUB bootloader via TFTP.
2. TFTP server hits file descriptor limit or CPU saturation:
   - New connections queued or dropped.
   - Active transfers slow down.
3. Some clients experience TFTP timeout:
   - GRUB not downloaded within NIC firmware timeout (30-60s).
   - PXE firmware retries (typically 3 times with 5-10s intervals).
4. Staggered retries naturally spread load:
   - First wave: ~500 clients succeed immediately.
   - Second wave (retries): ~1000 clients succeed.
   - Third wave: remaining ~500 clients succeed.
5. Total boot window extends from expected 1-2 minutes to 3-5 minutes.

**Expected Result:** All clients eventually boot, though some experience delays. No permanent failure.

**Error Handling:**
- TFTP tuning: Increase max connections, use multi-process TFTP (`atftpd` or `dnsmasq`).
- Alternative: Serve GRUB via HTTP (iPXE chainloading) instead of TFTP for better scalability.
- Monitoring: Log TFTP connection rate and timeouts. Alert when rate exceeds threshold.

**Performance Notes:**
- tftpd-hpa: Single-threaded, handles ~200 concurrent transfers efficiently.
- For 2000+ clients: Consider `atftpd` (multi-threaded) or `dnsmasq` TFTP.
- GRUB binary is ~500KB-2MB. 2000 transfers = 1-4GB total. At 1Gbps: 8-32 seconds if bandwidth-limited.
- TFTP is only used for the initial bootloader. The heavy lifting (kernel, initramfs) uses HTTP.
- Alternative: HTTP-only boot with UEFI HTTP Boot (eliminates TFTP entirely for UEFI clients).

---

### UC-ERR-03: Snapshot Generation Fails Mid-Staging

| Field | Value |
|-------|-------|
| **UC-ID** | UC-ERR-03 |
| **Title** | Snapshot staging fails partway through (disk error, process crash) |
| **Actor(s)** | Docker Sync Engine |
| **Preconditions** | Sync engine is building `staging/` directory. Failure occurs mid-process. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Sync Engine begins building `staging/`:
   - 500 of 1000 hostcfg files written.
   - Process crashes (OOM, segfault) or disk I/O error.
2. `staging/` directory left in incomplete state.
3. `current/` snapshot remains untouched (atomic switch never happened).
4. Boot serving continues from `current/` - no impact on clients.
5. Sync Engine restarts (container restart or process recovery).
6. Engine detects incomplete `staging/`:
   - Deletes `staging/` directory entirely.
   - Performs full resync from LMN API.
7. New staging built successfully. Atomic switch occurs.

**Expected Result:** No impact on boot serving. Automatic recovery on next sync cycle.

**Error Handling:**
- Startup check: Always check for and clean up partial `staging/` directory on engine start.
- Disk full: Cannot create staging. Alert admin. Do not retry until space freed.
- Repeated failures: After 3 consecutive staging failures, alert admin and pause auto-sync.

**Performance Notes:** Cleanup of partial staging: rm -rf < 1 second. Full resync: < 10 seconds.

---

### UC-ERR-04: Network Partition Between LMN and Docker

| Field | Value |
|-------|-------|
| **UC-ID** | UC-ERR-04 |
| **Title** | Network connectivity between LMN server and Docker host is lost |
| **Actor(s)** | Docker Sync Engine, LMN Authority API |
| **Preconditions** | Docker and LMN on separate networks or hosts. Network link fails. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Network partition occurs (switch failure, routing issue, firewall rule).
2. Docker sync poll fails with connection timeout.
3. Sync engine enters degraded mode (UC-SYNC-04 flow):
   - Exponential backoff retries.
   - Dashboard shows disconnected status.
4. Docker local services unaffected:
   - TFTP, HTTP, rsync continue serving from `current/` snapshot.
   - LINBO operations (SSH to clients) work if clients are on Docker's local network.
   - Image management works for local images.
5. LMN-side operations also unaffected:
   - School Console works for CRUD operations.
   - Changes queue up on LMN API delta feed.
6. Network partition resolves.
7. Sync engine reconnects. Delta feed catches up all accumulated changes.
8. Snapshot rebuilt with all changes. Dashboard shows recovered.

**Alternative Flows:**

- **A1: Split-brain scenario.** Admin changes config on LMN, client boots with old config from Docker. No conflict because Docker is read-only (no CRUD). Config converges on next sync.

**Expected Result:** Boot serving unaffected during partition. Full sync recovery when connectivity restored.

**Error Handling:**
- Webhook delivery fails during partition: Caught by poll-based fallback.
- API token invalid during extended partition: See UC-ERR-09 (degraded mode, admin rotates token).

**Performance Notes:** No degradation in boot serving. Delta catch-up may be larger after long partition.

---

### UC-ERR-05: Disk Full on Docker Volume During Image Upload

| Field | Value |
|-------|-------|
| **UC-ID** | UC-ERR-05 |
| **Title** | Docker volume runs out of disk space during image upload from client |
| **Actor(s)** | LINBO Client (uploading), Docker rsync |
| **Preconditions** | Docker volume hosting `/srv/linbo/images/` is nearly full. Client is uploading a large image. |
| **Phase** | Phase 4 (Operations) + Phase 5 (Monitoring) |

**Main Flow:**

1. LINBO client begins uploading 30GB QCOW2 image via rsync.
2. After 25GB written, disk reaches 100% capacity.
3. rsync write fails with ENOSPC (No space left on device).
4. rsync reports error to client. Transfer aborted.
5. Partial file left on Docker volume: `<image>.qcow2` (25GB, incomplete).
6. Docker API detects:
   - Filesystem watcher sees new file but no `.md5` companion.
   - Or: rsync post-transfer hook not called (transfer incomplete).
7. Dashboard alert: "Disk space critical: <volume> at 100%. Image upload failed."
8. Partial file NOT listed as valid image (no checksum verified).

**Expected Result:** Upload fails cleanly. Partial file does not corrupt image library. Admin alerted.

**Error Handling:**
- Pre-check: Before upload, check available disk space. Warn if < 2x expected image size.
- Cleanup: Auto-delete partial uploads after timeout (e.g., 1 hour with no progress).
- Quota: Set maximum image storage per group. Warn before quota exceeded.
- Alert thresholds: Warn at 80% disk usage. Critical at 90%.

**Performance Notes:** Disk full check: `statfs()` syscall, < 1ms. Should check periodically and before operations.

---

### UC-ERR-06: Invalid start.conf Received from LMN API

| Field | Value |
|-------|-------|
| **UC-ID** | UC-ERR-06 |
| **Title** | LMN API returns a start.conf with invalid syntax or missing required sections |
| **Actor(s)** | Docker Sync Engine |
| **Preconditions** | LMN API sends config data. Config has syntax errors or missing fields. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Delta feed includes `startconf upsert` for group "raum1".
2. Config data contains start.conf content.
3. Sync Engine validates start.conf:
   - Checks for required `[LINBO]` section.
   - Validates `Server`, `Cache`, `Group` fields in `[LINBO]`.
   - Checks at least one `[Partition]` section exists.
   - Checks at least one `[OS]` section exists.
   - Validates field values (e.g., `SystemType` must be `bios`, `bios64`, `efi32`, `efi64`).
4. Validation fails: Missing `[LINBO]` section.
5. Engine rejects this specific config change:
   - **Strict mode:** Reject entire delta batch.
   - **Per-config mode (preferred):** Skip invalid config, process everything else. Previous version of this config remains in snapshot.
6. Log error: `ERROR: Invalid start.conf for group 'raum1': missing [LINBO] section`.
7. Dashboard shows validation error for this group.
8. Admin fixes on LMN server. Next sync delivers corrected config.

**Expected Result:** Invalid config never serves to clients. Previous valid config continues serving.

**Error Handling:**
- Parser error (malformed INI): Catch parse exception, reject config.
- Missing BaseImage reference: Warning (image may not be deployed yet).
- Per-config validation: one bad config does not block the entire sync.
- Detailed error messages in SyncState and audit log.

**Performance Notes:** start.conf validation: < 1ms per config. Negligible.

---

### UC-ERR-07: Duplicate MAC Addresses in devices.csv

| Field | Value |
|-------|-------|
| **UC-ID** | UC-ERR-07 |
| **Title** | Two hosts have the same MAC address in LMN data |
| **Actor(s)** | Docker Sync Engine, LMN Authority API |
| **Preconditions** | devices.csv on LMN server contains duplicate MAC entry (admin error). |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Delta feed includes two hosts with same MAC: `AA:BB:CC:DD:EE:FF`.
   - Host "pc01" in group "raum1"
   - Host "pc02" in group "raum2"
2. Sync Engine validation detects duplicate MAC.
3. Engine behavior (configurable):
   - **Strict mode:** Reject both hosts. Log error.
   - **Last-wins mode:** Accept last entry in delta (pc02). Log warning.
   - **First-wins mode:** Accept first entry (pc01). Log warning.
4. For GRUB MAC mapping: Only one entry per MAC is possible. Duplicate creates ambiguity.
5. For DHCP: Duplicate MAC causes unpredictable DHCP behavior (first match wins).
6. Dashboard shows: "WARNING: Duplicate MAC AA:BB:CC:DD:EE:FF found on hosts pc01, pc02."
7. Admin must fix on LMN server.

**Expected Result:** Duplicate detected and flagged. One host may boot with wrong config until fixed. No crash or data corruption.

**Error Handling:**
- Always log duplicate MACs prominently.
- Dashboard should highlight affected hosts.
- Consider blocking both hosts until resolved (strict mode).

**Performance Notes:** Duplicate detection: O(n) hash set check during sync. Negligible.

---

### UC-ERR-08: Host Removed on LMN but Still Has Active LINBO Session

| Field | Value |
|-------|-------|
| **UC-ID** | UC-ERR-08 |
| **Title** | Admin deletes host on LMN server while client is actively booted in LINBO |
| **Actor(s)** | Admin (School Console), LINBO Client, Docker Sync Engine |
| **Preconditions** | Host "pc01" is currently booted in LINBO. Admin deletes pc01 from devices.csv on LMN. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Client "pc01" is running LINBO GUI, fully functional.
2. Admin removes pc01 from LMN devices.csv.
3. Next sync cycle: Delta includes `host delete: pc01`.
4. Sync Engine removes:
   - `hostcfg/pc01.cfg` from snapshot.
   - pc01 from MAC mapping.
   - pc01 from DHCP export.
5. New snapshot goes live.
6. Client "pc01" is still running LINBO (already booted, in RAM):
   - All cached operations still work (start, sync from local cache).
   - New rsync requests to server may still work (rsync doesn't check host authorization).
   - SSH commands from Docker API to pc01 still work (SSH doesn't check snapshot).
7. On next reboot:
   - DHCP may or may not assign IP (depends on DHCP config - pool vs. static only).
   - If DHCP works: GRUB boot falls through to fallback (no hostcfg, no MAC mapping).
   - Client boots LINBO in fallback mode (UC-BOOT-04).
8. Docker dashboard no longer shows pc01 in host list. Active LINBO session may show as "orphaned."

**Alternative Flows:**

- **A1: Admin wants to force-disconnect.** Admin can send SSH `halt` command to pc01 before/after deletion.
- **A2: Re-registration.** Admin re-adds pc01. Next sync creates new hostcfg. Client reboots and gets proper config again.

**Expected Result:** Running LINBO session not disrupted. Host becomes unregistered on next boot. Dashboard reflects removal.

**Error Handling:**
- Orphaned session handling: Dashboard shows "Last seen at <time>, host no longer registered."
- Operation cleanup: Cancel any scheduled onboot commands for deleted host.

**Performance Notes:** No performance impact. Deletion is a simple file removal in snapshot.

---

### UC-ERR-09: Bearer Token Invalid or Rotated

| Field | Value |
|-------|-------|
| **UC-ID** | UC-ERR-09 |
| **Title** | Docker's Bearer token for LMN Authority API is invalid or has been rotated |
| **Actor(s)** | Docker Sync Engine, LMN Authority API, Admin |
| **Preconditions** | Docker authenticates to LMN API with a pre-shared Bearer token (`AUTHORITY_BEARER_TOKEN`). Token has been rotated on the LMN server or is otherwise invalid. |
| **Phase** | Phase 2 (Snapshot Sync Engine) |

**Main Flow:**

1. Sync Engine polls delta API: `GET /api/v1/linbo/changes?since=<cursor>`.
2. LMN API returns `401 Unauthorized` with body: `{ "error": "invalid_token", "message": "Bearer token is invalid or has been revoked" }`.
3. Sync Engine detects 401 response.
4. Engine enters degraded mode (same as UC-SYNC-04):
   a. Boot serving continues from existing `current/` snapshot (unaffected).
   b. Sync is paused — no snapshot updates until token is fixed.
   c. Dashboard shows: "Sync Error: Authentication failed (401). Admin must update Bearer token."
   d. Log: `ERROR: LMN API auth failed (401). Token may have been rotated. Update AUTHORITY_BEARER_TOKEN in .env and restart API container.`
5. Engine retries with exponential backoff (30s, 60s, 120s... max 600s) in case of transient issue.
6. **Admin intervention required:**
   a. Admin generates a new Bearer token on the LMN server.
   b. Admin updates `AUTHORITY_BEARER_TOKEN` in Docker's `.env` file.
   c. Admin restarts the API container: `docker compose restart api`.
7. On restart, Sync Engine reads new token from environment and resumes normal polling.

**Expected Result:** Manual token rotation by admin. Boot serving continues uninterrupted from cached snapshot during the outage. No automatic token refresh (pre-shared tokens are long-lived, rotation is an explicit admin action).

**Error Handling:**
- Persistent 401: After 10 consecutive failures, reduce poll frequency to once per 10 minutes to avoid log spam.
- Token not exposed in logs or API responses (only "invalid token" message).
- Health endpoint reports: `{ "sync": { "status": "auth_error", "lastSuccess": "...", "consecutiveFailures": 10 } }`.

**Performance Notes:** Zero impact on boot serving. Only sync is affected.

---

### UC-ERR-10: Docker Container Restart During Active Operations

| Field | Value |
|-------|-------|
| **UC-ID** | UC-ERR-10 |
| **Title** | Docker API container restarts while operations are in progress |
| **Actor(s)** | Docker Engine, Docker API Container |
| **Preconditions** | Active operations (SSH commands to clients, image upload, sync). Container restarts (crash, update, manual restart). |
| **Phase** | Phase 4 (Operations) + Phase 5 (Reliability) |

**Main Flow:**

1. Docker API container is running with:
   - 3 active SSH operations (Session status: `running`).
   - 1 image upload in progress.
   - 1 sync cycle building staging.
2. Container receives SIGTERM (or crashes).
3. Graceful shutdown (if SIGTERM):
   a. API stops accepting new requests.
   b. Active SSH connections terminated (client LINBO handles disconnect gracefully).
   c. Active sessions NOT updated to `failed` (process dies before DB write).
   d. Staging directory left in partial state.
4. Container restarts.
5. Startup recovery:
   a. **Operations recovery:** API scans for operations with status `running`:
      - Sessions with `running` status and `startedAt` > 10 minutes ago: Mark as `failed` with "Container restart."
      - Operations with all sessions resolved: Mark operation as `completed_with_errors`.
   b. **Sync recovery:** Detect and delete partial `staging/` directory. Schedule immediate full resync.
   c. **Image upload recovery:** Detect partial upload files (no matching `.md5`). Mark for cleanup or resume.
   d. **WebSocket:** All client WebSocket connections dropped. Frontend auto-reconnects (wsStore reconnect logic).
6. Dashboard shows: Operations marked as failed due to restart. Admin can retry.

**Alternative Flows:**

- **A1: OOM kill (SIGKILL, no graceful shutdown).** Same recovery but without graceful cleanup step. All in-flight state lost.
- **A2: Rolling restart (update).** If using Docker Compose rolling update: second container starts before first stops. Zero-downtime for HTTP requests. SSH operations on old container still terminate.

**Expected Result:** Automatic recovery on restart. In-flight operations marked as failed. No data corruption. Admin can retry failed operations.

**Error Handling:**
- Startup health check: Verify DB connectivity, filesystem access, required services before accepting requests.
- Operation idempotency: SSH commands to LINBO are generally idempotent (sync can be re-run). Safe to retry.
- Image upload resume: rsync supports resume. Client can retry upload and rsync handles partial files.

**Performance Notes:** Startup recovery scan: < 5 seconds for typical operation count. Container restart time: ~5-10 seconds (Node.js).

---

## Appendix: Use Case Cross-Reference by Phase

| Phase | Use Cases |
|-------|-----------|
| **Phase 1: Core Boot Infrastructure** | UC-BOOT-01, UC-BOOT-02, UC-BOOT-04, UC-BOOT-05, UC-BOOT-06, UC-BOOT-07, UC-BOOT-08, UC-BOOT-10 |
| **Phase 2: Snapshot Sync Engine** | UC-BOOT-02 (perf), UC-BOOT-03, UC-BOOT-09, UC-SYNC-01 through UC-SYNC-09, UC-ERR-02, UC-ERR-03, UC-ERR-04, UC-ERR-06, UC-ERR-07, UC-ERR-08, UC-OPS-14 |
| **Phase 3: DHCP + Auth Integration** | UC-BOOT-05, UC-BOOT-10, UC-SYNC-08, UC-SYNC-10, UC-ERR-09 |
| **Phase 4: Operations** | UC-OPS-01 through UC-OPS-08, UC-ERR-05, UC-ERR-10 |
| **Phase 5: Monitoring + Management** | UC-OPS-09, UC-OPS-10, UC-OPS-11, UC-OPS-13, UC-OPS-14, UC-ERR-01, UC-ERR-05 |
| **Phase 6: UI Customization** | UC-OPS-12 |

## Appendix: Actor Summary

| Actor | Description |
|-------|-------------|
| **PXE Client** | Physical or virtual machine booting via network |
| **DHCP Server** | OPNsense (primary) or Docker (optional/proxy) |
| **Docker TFTP** | Serves GRUB bootloader to PXE clients |
| **Docker HTTP (nginx)** | Serves kernel, initramfs, and boot files |
| **Docker rsync** | Serves start.conf, images, GUI archive |
| **Docker API** | REST API for operations, monitoring, sync |
| **Docker Sync Engine** | Polls/receives changes from LMN, builds snapshots |
| **Docker Web (Dashboard)** | React frontend for admin operations |
| **LMN Authority API** | Source of truth on linuxmuster server (Python FastAPI) |
| **Admin** | School IT administrator using Docker Dashboard or School Console |
| **LINBO Client** | Client running LINBO environment (in RAM after kernel boot) |

## Appendix: Use Case ID Quick Reference

| UC-ID | Title | Phase |
|-------|-------|-------|
| UC-BOOT-01 | Normal PXE Boot (Single Client) | 1 |
| UC-BOOT-02 | Boot Storm (2000 Clients) | 1+2 |
| UC-BOOT-03 | Boot with LMN Server Unreachable | 2 |
| UC-BOOT-04 | Boot of Unknown/Unregistered Client | 1+3 |
| UC-BOOT-05 | Boot with DHCP-Only IP (Option 40) | 1+3 |
| UC-BOOT-06 | UEFI PXE Boot | 1 |
| UC-BOOT-07 | BIOS/Legacy PXE Boot | 1 |
| UC-BOOT-08 | Local Boot / Reboot into OS | 1 |
| UC-BOOT-09 | Boot After Config Change Not Yet Synced | 2 |
| UC-BOOT-10 | Boot with Proxy-DHCP | 1+3 |
| UC-SYNC-01 | Initial Sync (Fresh Docker) | 2 |
| UC-SYNC-02 | Incremental Sync (Delta Feed) | 2 |
| UC-SYNC-03 | Bulk Change (500 Devices Imported) | 2 |
| UC-SYNC-04 | Sync with LMN API Temporarily Unavailable | 2 |
| UC-SYNC-05 | Sync Receives Corrupted/Invalid Data | 2 |
| UC-SYNC-06 | Atomic Snapshot Switch | 2 |
| UC-SYNC-07 | Rollback to Previous Snapshot | 2 |
| UC-SYNC-08 | Webhook-Triggered Immediate Sync | 2+3 |
| UC-SYNC-09 | Concurrent Sync (Changes During Active Sync) | 2 |
| UC-SYNC-10 | DHCP Export Sync (Option 40 Correctness) | 3 |
| UC-OPS-01 | linbo-remote Command from Frontend | 4 |
| UC-OPS-02 | Wake-on-LAN Single Host | 4 |
| UC-OPS-03 | Wake-on-LAN Entire Room | 4 |
| UC-OPS-04 | Bulk Sync Operation | 4 |
| UC-OPS-05 | View Operation History/Logs | 4 |
| UC-OPS-06 | Image Upload from PXE Client | 4 |
| UC-OPS-07 | Image Verification (Checksum) | 4 |
| UC-OPS-08 | Image Deletion | 4 |
| UC-OPS-09 | Kernel Switching | 5 |
| UC-OPS-10 | Firmware Upload and Deployment | 5 |
| UC-OPS-11 | Driver/Patchclass Management | 5 |
| UC-OPS-12 | GRUB Theme Customization | 6 |
| UC-OPS-13 | View Boot Logs and Troubleshoot | 5 |
| UC-OPS-14 | Monitor Snapshot Sync Health | 2+5 |
| UC-ERR-01 | DHCP Server Not Responding | 5 |
| UC-ERR-02 | TFTP Timeout During Boot Storm | 2 |
| UC-ERR-03 | Snapshot Generation Fails Mid-Staging | 2 |
| UC-ERR-04 | Network Partition Between LMN and Docker | 2 |
| UC-ERR-05 | Disk Full During Image Upload | 4+5 |
| UC-ERR-06 | Invalid start.conf from LMN API | 2 |
| UC-ERR-07 | Duplicate MAC Addresses | 2 |
| UC-ERR-08 | Host Removed but Active LINBO Session | 2 |
| UC-ERR-09 | API Token Expired During Sync | 2+3 |
| UC-ERR-10 | Container Restart During Active Operations | 4+5 |
