# Roadmap: LINBO Native Server

## Overview

Brownfield migration of an existing Docker-based LINBO management stack to a fully native
systemd deployment and a production-grade Caching-Satellite. linuxmuster-linbo7 is installed
vanilla via APT and left completely untouched. The Express API is migrated to read LINBO
data directly from the filesystem (no Redis, no store.js) and a simple in-memory Map tracks
host-status. isc-dhcp-server is installed natively and synced from the LMN Authority Server
so PXE boot works out of the box. Multi-school sync, image caching, auto-discovery, and
first-boot sync complete the Caching-Satellite feature set. The migration completes when a
real LINBO client PXE boots, syncs an image, receives a remote command, multiple schools
load correctly, and an admin watches it all in real-time in the frontend.

v2.0 verifies every Docker-era feature in the native environment — one category at a time,
starting with SSH (which all other SSH-dependent features require).

## Milestones

- 🚧 **v1.0 Native Migration** - Phases 1-10 (in progress — phases 9-10 remaining)
- 📋 **v2.0 Feature Verification** - Phases 11-20 (planned)

## Phases

<details>
<summary>🚧 v1.0 Native Migration (Phases 1-10) — Phases 1-8 Complete</summary>

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Install Scripts** - install.sh and setup.sh for the native host environment
- [x] **Phase 2: systemd Units + Boot Scaffold** - Service units with correct dependency ordering and setup-bootfiles.sh oneshot
- [x] **Phase 3: DHCP + PXE Boot** - isc-dhcp-server natively configured with PXE options and Authority Server sync
- [x] **Phase 4: API Filesystem Migration** - Replace redis.js with direct filesystem reads, in-memory Map for host-status, lock file for sync-lock
- [x] **Phase 5: Dependency Cleanup** - Remove ioredis/dockerode/rate-limit-redis, fix Docker hostnames, update health endpoint, disable containerLogs.js
- [x] **Phase 6: Native LINBO File Access** - API reads and controls native /srv/linbo/ files and systemd-managed LINBO services
- [x] **Phase 7: Caching-Satellite Features** - Multi-school sync, image caching, auto-discovery, first-boot sync
- [x] **Phase 8: Frontend Build + nginx** - Vite static build served by native nginx with API reverse proxy
- [ ] **Phase 9: Docker Artifact Removal** - Remove all Docker/container source artifacts, clean directory structure
- [ ] **Phase 10: End-to-End Verification** - Live hardware test confirming PXE, rsync, API, WebSocket, and multi-school chain

### Phase 1: Install Scripts
**Goal**: A developer can run install.sh on a fresh host and have all system dependencies installed, then run setup.sh to configure the service for first use
**Depends on**: Nothing (first phase)
**Requirements**: INST-01, INST-02
**Success Criteria** (what must be TRUE):
  1. Running install.sh on a fresh Ubuntu host installs Node.js 20, npm, nginx, linuxmuster-linbo7, and isc-dhcp-server without errors
  2. Running setup.sh creates required directories (/srv/linbo-api, /var/lib/linbo-api, /etc/linbo-native), sets correct ownership and permissions, and writes a working .env file
  3. setup.sh enables and starts nginx without Docker or Redis present; linbo-api.service is deferred to Phase 2
  4. No Docker-targeting environment variables (REDIS_HOST, DOCKER_GID) appear in the generated .env
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — install.sh (idempotent APT installer) + bats test scaffold for INST-01
- [x] 01-02-PLAN.md — setup.sh rewrite (native mode) + .env.example update + bats tests for INST-02

### Phase 2: systemd Units + Boot Scaffold
**Goal**: All service units exist with correct dependency ordering, linbo-setup.service runs once on install, and tftpd-hpa serves /srv/linbo on UDP 69
**Depends on**: Phase 1
**Requirements**: API-01, API-09, BASE-01
**Success Criteria** (what must be TRUE):
  1. linuxmuster-linbo7 is installed as a vanilla APT package and systemctl shows its services active
  2. linbo-api.service starts after linbo-setup.service completes (Requires= dependency enforced)
  3. linbo-setup.service runs setup-bootfiles.sh exactly once, creates a sentinel file, and skips on subsequent boots
  4. tftpd-hpa.service serves /srv/linbo and linbo-api.service is running as a persistent systemd service
  5. systemctl restart linbo-api.service recovers cleanly without hitting StartLimitBurst
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — bats test scaffold (RED) + systemd unit source files in systemd/ (GREEN contract)
- [x] 02-02-PLAN.md — scripts/setup-bootfiles.sh oneshot provisioner + setup.sh linbo user creation
- [x] 02-03-PLAN.md — system installation, service activation, bats verification + human checkpoint

### Phase 3: DHCP + PXE Boot
**Goal**: isc-dhcp-server runs as a native systemd service, receives its config from the LMN Authority Server sync, and hands out correct PXE boot options so clients can reach GRUB
**Depends on**: Phase 2
**Requirements**: DHCP-01, DHCP-02, DHCP-03
**Success Criteria** (what must be TRUE):
  1. isc-dhcp-server.service is active and survives a system reboot without manual intervention
  2. The DHCP config file at /etc/dhcp/dhcpd.conf is populated by the Authority Server sync — not hand-written — and dhcpd reloads after each sync
  3. A test client on the same network segment receives an IP address, next-server pointing at the Caching-Satellite, and the correct filename for GRUB (e.g. grub/x86_64-efi/grubnetx64.efi.signed)
  4. PXE chainload succeeds: the client loads GRUB from TFTP without a "file not found" error
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — bats test scaffold (RED) + setup-dhcp.sh (dhcpd.conf template, placeholders, INTERFACESv4, sudoers)
- [x] 03-02-PLAN.md — sync.service.js DHCP write path to /etc/dhcp/ + dhcpd restart via sudo + .env.example + setup.sh
- [x] 03-03-PLAN.md — system deployment (deploy-dhcp.sh), service activation, bats verification + human checkpoint

### Phase 4: API Filesystem Migration
**Goal**: The API starts and operates entirely without Redis — host data is read directly from the filesystem, host-status is tracked in a plain in-memory Map, sync-lock is a lock file on disk
**Depends on**: Phase 3
**Requirements**: API-02, API-03, API-04
**Success Criteria** (what must be TRUE):
  1. All modules that previously imported redis.js work without code changes — host arrays are populated by reading /srv/linbo/ start.conf files directly
  2. Host online-status is tracked in an in-memory Map: status is correct while the process runs and is intentionally lost on restart (no persistence required)
  3. A sync lock written before a simulated crash is automatically cleared on next startup from the lock file — no manual intervention needed
  4. The health endpoint reports the API as ready without any Redis connection attempt
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — jest.config.js fix + RED test suites for store.js and host-status worker (TDD Wave 1)
- [x] 04-02-PLAN.md — implement src/lib/store.js — in-memory Map with ioredis-compatible client facade (TDD GREEN)
- [x] 04-03-PLAN.md — wire store.js into redis.js + fix index.js (5 Redis locations) + fix rate-limit.js

### Phase 5: Dependency Cleanup
**Goal**: ioredis, dockerode, and rate-limit-redis are removed from the codebase; all Docker-internal hostnames replaced with localhost; containerLogs.js is cleanly disabled; health endpoint checks filesystem not Redis
**Depends on**: Phase 4
**Requirements**: API-05, API-06, API-07, API-08
**Success Criteria** (what must be TRUE):
  1. npm install completes with no reference to ioredis, dockerode, or rate-limit-redis in node_modules or package.json
  2. No occurrence of Docker internal DNS names (linbo-api:3000, linbo-cache:6379) remains in any config or source file
  3. GET /api/v1/health returns 200 and reports a native filesystem/service status — not a Redis connection status
  4. The container-logs endpoint returns a clear "not available in native mode" response instead of crashing or hanging
**Plans**: 3 plans

Plans:
- [x] 05-01-PLAN.md — RED test suites: containerLogs.test.js (API-05/06/08) + health.test.js (API-07)
- [x] 05-02-PLAN.md — containerLogs.js journald rewrite + Docker hostname fixes + health filesystem check (GREEN)
- [x] 05-03-PLAN.md — npm uninstall ioredis dockerode rate-limit-redis + full suite regression check

### Phase 6: Native LINBO File Access
**Goal**: The API reads host lists, start.confs, and GRUB configs directly from /srv/linbo/ filesystem paths, and can trigger rsync and TFTP service restarts through systemd without any Docker indirection
**Depends on**: Phase 5
**Requirements**: BASE-02, BASE-03
**Success Criteria** (what must be TRUE):
  1. The API returns correct host data read directly from /srv/linbo/ start.conf files — no cache layer required
  2. Calling the rsync-trigger API endpoint causes rsyncd to reload its configuration via systemd
  3. The API can read and write GRUB config files under /srv/linbo/boot/grub/ and the changes persist across service restarts
**Plans**: 2 plans

Plans:
- [x] 06-01-PLAN.md — devices-csv-reader.js + startconf-parser.js + linbo-fs.service.js (pure library modules)
- [x] 06-02-PLAN.md — wire native FS fallbacks into sync.js routes + POST /sync/services/reload + setup-linbo.sh sudoers

### Phase 7: Caching-Satellite Features
**Goal**: The server acts as a full Caching-Satellite: multiple schools sync correctly via the school parameter, LINBO images are cached locally, new clients are discovered automatically, and first-boot sync triggers without manual intervention
**Depends on**: Phase 6
**Requirements**: CACHE-01, CACHE-02, CACHE-03, CACHE-04
**Success Criteria** (what must be TRUE):
  1. Hosts from two different schools (distinct school parameters) are loaded correctly — no cross-contamination of host lists between schools
  2. A LINBO image requested by a client that is not yet cached locally is downloaded from the Authority Server via rsync and served to the client from local storage on subsequent requests
  3. A new client that has never contacted the server is detected automatically within the configured discovery interval — no manual registration needed
  4. A client that boots for the first time triggers an automatic sync without admin interaction — the sync log shows "first-boot" origin
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md — Fix school param bug (sync.service.js line 151) + fix 26 broken test path shims
- [x] 07-02-PLAN.md — Write missing tests: sync.service.school.test.js (CACHE-01) + startup-first-boot.test.js (CACHE-04)
- [x] 07-03-PLAN.md — Deploy to 10.40.0.10 + human verification of all four CACHE features

### Phase 8: Frontend Build + nginx
**Goal**: The React frontend is built as static files and served by native nginx, with the API and WebSocket correctly proxied — an admin can open the browser and see the dashboard
**Depends on**: Phase 7
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. npm run build in the frontend directory produces a dist/ folder and the build exits without errors
  2. Opening http://[server-ip]/ in a browser loads the React app and the login page appears
  3. The browser WebSocket connection to /ws stays connected and delivers real-time events without disconnecting
  4. All API calls via the browser (through the nginx reverse proxy) return correct responses — no CORS errors, no 502s
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — Fix nginx.conf root directive + write deploy-frontend.sh
- [x] 08-02-PLAN.md — Deploy dist/ to 10.40.0.10 + human browser verification

### Phase 9: Docker Artifact Removal
**Goal**: The repository contains no Docker-specific files, no container directory nesting, and no dead code — only the native service stack remains
**Depends on**: Phase 8
**Requirements**: QUAL-01, QUAL-02, QUAL-03
**Success Criteria** (what must be TRUE):
  1. No Dockerfile, docker-compose.yml, .dockerignore, or containers/ directory structure exists in the repository
  2. The source tree has a flat, readable layout: api/, frontend/, scripts/, systemd/ — no container subdirectory nesting
  3. Running grep -r "dockerode\|ioredis\|DOCKER_GID\|redis.getClient" src/ returns zero matches
**Plans**: TBD

### Phase 10: End-to-End Verification
**Goal**: A real LINBO client PXE boots from the native server, downloads an image over rsync, receives a remote command via the API, multiple schools load correctly, and the admin sees it all in real-time in the frontend
**Depends on**: Phase 9
**Requirements**: VERIFY-01, VERIFY-02, VERIFY-03, VERIFY-04, VERIFY-05
**Success Criteria** (what must be TRUE):
  1. A physical test client PXE boots: DHCP hands it an IP, TFTP delivers GRUB and linbofs64, and the LINBO boot screen appears
  2. The web frontend displays the test client as online with correct hardware info populated from the API
  3. Clicking Reboot or Sync in the frontend sends the command and the test client executes it within 30 seconds
  4. WebSocket real-time events appear in the frontend as the client connects, syncs, and reboots — no page refresh needed
  5. Hosts from a second test school are loaded correctly in the frontend — school selector switches between school views without errors
**Plans**: TBD

</details>

---

### 📋 v2.0 Feature Verification (Phases 11-20)

**Milestone Goal:** Every feature that existed in the Docker project works correctly in native mode — verified on real hardware, one category at a time. The API/scripts are fixed as needed; the LINBO package is never modified.

- [x] **Phase 11: SSH & Terminal** - SSH key-chain configured, browser terminal works, HWInfo-Scanner detects online clients (completed 2026-03-20)
- [x] **Phase 12: Kernel Management** - Kernel variants shown correctly, kernel switch works, active kernel status accurate (completed 2026-03-20)
- [x] **Phase 13: Linbofs Management** - Linbofs status correct, rebuild triggers via API with WebSocket progress, patch status shows hooks (completed 2026-03-20)
- [x] **Phase 14: Firmware Management** - Firmware detect via SSH works, firmware can be added to linbofs64, SSH key confirmed (completed 2026-03-20)
- [ ] **Phase 15: GRUB Config Management** - GRUB configs shown per group, regeneration and cleanup work via API
- [ ] **Phase 16: Driver Management** - Driver profiles managed, match.conf read/write works, HWInfo-Scan via SSH works
- [ ] **Phase 17: Remote Operations** - Reboot/Halt, Partition/Sync/Start, Wake-on-LAN, and .cmd scheduling all work
- [ ] **Phase 18: Image Management** - Image list from /srv/linbo/, pull from Authority via rsync, push to Authority via rsync
- [ ] **Phase 19: WLAN Management** - WLAN config read/write works, config embedded in linbofs64 correctly
- [ ] **Phase 20: LINBO Update** - Update status displayed, apt update/install for linuxmuster-linbo7 triggered via API

## Phase Details

### Phase 11: SSH & Terminal
**Goal**: The SSH key-chain is correctly wired end-to-end so that every SSH-dependent feature (firmware detect, hwinfo scan, terminal, remote operations) can reach online LINBO clients
**Depends on**: Phase 10 (v1.0 complete)
**Requirements**: SSH-01, SSH-02, SSH-03
**Success Criteria** (what must be TRUE):
  1. The Dropbear key chain (linbo_client_key) is present and correctly distributed so the API can SSH into a booted LINBO client without a password prompt
  2. Opening the SSH terminal in the browser connects to a live LINBO client and an interactive shell session appears within 5 seconds
  3. The HWInfo-Scanner background service automatically discovers online clients — at least one booted client appears in the scanner list without manual registration
**Plans**: 3 plans

Plans:
- [x] 11-01-PLAN.md — SSH key provisioning in setup.sh + ssh.service.js error message cleanup
- [ ] 11-02-PLAN.md — Unit tests: LINBO_CLIENT_SSH_KEY env var, error message, hwinfo auto-trigger
- [ ] 11-03-PLAN.md — Deploy to 10.40.0.10 + rebuild linbofs64 + human verification of SSH-01/02/03

### Phase 12: Kernel Management
**Goal**: Kernel variants are readable and switchable via API — the admin can see which kernel versions are available and the active kernel, and switch the active kernel which then triggers a GRUB update
**Depends on**: Phase 11
**Requirements**: KERN-01, KERN-02, KERN-03
**Success Criteria** (what must be TRUE):
  1. The kernel list endpoint returns at least the stable/longterm/legacy variants with correct version strings and file sizes read from /srv/linbo/
  2. Calling the kernel-switch API endpoint changes which kernel is active in /srv/linbo/ and the GRUB config reflects the new kernel on the next client boot
  3. The kernel status endpoint returns the version string of the currently active kernel matching the actual file on disk
**Plans**: TBD

### Phase 13: Linbofs Management
**Goal**: Linbofs status is accurate and the rebuild pipeline works end-to-end — the admin can trigger update-linbofs via the API and watch real-time progress in the browser
**Depends on**: Phase 11
**Requirements**: LFS-01, LFS-02, LFS-03
**Success Criteria** (what must be TRUE):
  1. The linbofs status endpoint returns the correct file size, MD5 hash, and modification date of the current linbofs64 file
  2. Triggering a linbofs rebuild via the API runs update-linbofs and streams progress events over WebSocket until completion — the browser receives at least one progress update
  3. The patch status endpoint lists hooks found in the update-linbofs.pre.d/ and update-linbofs.post.d/ directories
**Plans**: TBD

### Phase 14: Firmware Management
**Goal**: The API can detect required firmware from a live client over SSH and build it into linbofs64 — the complete firmware cycle works without touching the LINBO package
**Depends on**: Phase 11
**Requirements**: FW-01, FW-02, FW-03
**Success Criteria** (what must be TRUE):
  1. Calling the firmware-detect API endpoint for an online client returns a list of firmware packages the client reports as needed — retrieved via SSH from the live client
  2. Adding a firmware entry via the API and triggering a linbofs rebuild results in the firmware being present in the rebuilt linbofs64
  3. FW-03 is covered by Phase 11 SSH-01 — the SSH key used for firmware detect is the same linbo_client_key verified there
**Plans**: TBD

### Phase 15: GRUB Config Management
**Goal**: GRUB configurations for all client groups are visible, regeneratable, and cleanable via API — the admin can see and fix GRUB configs without touching /srv/linbo/ by hand
**Depends on**: Phase 12
**Requirements**: GRUB-01, GRUB-02, GRUB-03
**Success Criteria** (what must be TRUE):
  1. The GRUB config list endpoint returns one config entry per group defined in /srv/linbo/ with the correct config content
  2. Triggering GRUB config regeneration via the API produces updated config files under /srv/linbo/boot/grub/ — the file timestamps change
  3. The GRUB cleanup endpoint removes config files for groups that no longer have a corresponding start.conf — orphaned configs are gone after cleanup
**Plans**: TBD

### Phase 16: Driver Management
**Goal**: Driver profiles are manageable via the API, match.conf is readable and writable, and HWInfo scans can be run against live clients over SSH — the full driver workflow works natively
**Depends on**: Phase 11
**Requirements**: DRV-01, DRV-02, DRV-03
**Success Criteria** (what must be TRUE):
  1. The driver profiles endpoint returns the current set of driver profiles and a new profile can be created via POST — the profile appears on subsequent GET
  2. The match.conf endpoint reads the current match.conf content and a PUT updates the file on disk — the change is confirmed by reading it back
  3. Running an HWInfo scan via the API for an online client returns hardware information retrieved from the live client over SSH
**Plans**: TBD

### Phase 17: Remote Operations
**Goal**: All four remote operation types work reliably — the admin can send reboot, partition/sync/start, wake-on-LAN, and scheduled commands to clients and observe results
**Depends on**: Phase 11
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04
**Success Criteria** (what must be TRUE):
  1. Sending a Reboot or Halt command via the API to an online LINBO client causes the client to reboot or shut down within 30 seconds
  2. Sending a Partition, Sync, or Start command via the API to an online LINBO client causes the client to execute that operation — confirmed in the client's LINBO console or API status
  3. Sending a Wake-on-LAN command via the API to a known offline client causes the client to power on — confirmed by the client appearing online within 60 seconds
  4. Writing a scheduled .cmd file via the API results in the file appearing in /srv/linbo/linbocmd/ — the client picks it up on its next LINBO poll cycle
**Plans**: TBD

### Phase 18: Image Management
**Goal**: The API can list, pull, and push LINBO images — images in /srv/linbo/ are visible and bidirectional rsync to the Authority Server works
**Depends on**: Phase 10
**Requirements**: IMG-01, IMG-02, IMG-03
**Success Criteria** (what must be TRUE):
  1. The image list endpoint returns all .qcow2 and .cloop image files present in /srv/linbo/ with correct names and file sizes
  2. Triggering an image pull via the API downloads the specified image from the Authority Server via rsync and the image appears in /srv/linbo/ on completion
  3. Triggering an image push via the API uploads the specified local image to the Authority Server via rsync and the transfer completes without error
**Plans**: TBD

### Phase 19: WLAN Management
**Goal**: WLAN configuration is readable and writable via the API, and the config is correctly embedded in linbofs64 so clients receive it on boot
**Depends on**: Phase 13
**Requirements**: WLAN-01, WLAN-02
**Success Criteria** (what must be TRUE):
  1. The WLAN config endpoint reads the current WLAN configuration from disk and a PUT updates it — the change is confirmed by reading it back
  2. After updating the WLAN config and triggering a linbofs rebuild, the WLAN configuration is present inside the rebuilt linbofs64 — verified by extracting and inspecting the archive
**Plans**: TBD

### Phase 20: LINBO Update
**Goal**: The update status endpoint accurately reports the installed LINBO version and available updates, and the update trigger causes apt to upgrade linuxmuster-linbo7 without manual intervention
**Depends on**: Phase 10
**Requirements**: UPD-01, UPD-02
**Success Criteria** (what must be TRUE):
  1. The LINBO update status endpoint returns the currently installed linuxmuster-linbo7 package version and whether a newer version is available in the APT repository
  2. Triggering a LINBO update via the API runs apt update followed by apt install linuxmuster-linbo7 — the API returns success and the installed version changes if an update was available
**Plans**: TBD

## Progress

**Execution Order:**
v1.0 phases: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10
v2.0 phases: 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Install Scripts | v1.0 | 2/2 | Complete | 2026-03-19 |
| 2. systemd Units + Boot Scaffold | v1.0 | 3/3 | Complete | 2026-03-19 |
| 3. DHCP + PXE Boot | v1.0 | 3/3 | Complete | 2026-03-20 |
| 4. API Filesystem Migration | v1.0 | 3/3 | Complete | 2026-03-20 |
| 5. Dependency Cleanup | v1.0 | 3/3 | Complete | 2026-03-20 |
| 6. Native LINBO File Access | v1.0 | 2/2 | Complete | 2026-03-20 |
| 7. Caching-Satellite Features | v1.0 | 3/3 | Complete | 2026-03-20 |
| 8. Frontend Build + nginx | v1.0 | 2/2 | Complete | 2026-03-20 |
| 9. Docker Artifact Removal | v1.0 | 0/? | Not started | - |
| 10. End-to-End Verification | v1.0 | 0/? | Not started | - |
| 11. SSH & Terminal | 2/3 | Complete    | 2026-03-20 | - |
| 12. Kernel Management | v2.0 | Complete    | 2026-03-20 | - |
| 13. Linbofs Management | v2.0 | Complete    | 2026-03-20 | - |
| 14. Firmware Management | v2.0 | Complete    | 2026-03-20 | - |
| 15. GRUB Config Management | v2.0 | 0/? | Not started | - |
| 16. Driver Management | v2.0 | 0/? | Not started | - |
| 17. Remote Operations | v2.0 | 0/? | Not started | - |
| 18. Image Management | v2.0 | 0/? | Not started | - |
| 19. WLAN Management | v2.0 | 0/? | Not started | - |
| 20. LINBO Update | v2.0 | 0/? | Not started | - |
