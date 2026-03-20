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

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Install Scripts** - install.sh and setup.sh for the native host environment
- [ ] **Phase 2: systemd Units + Boot Scaffold** - Service units with correct dependency ordering and setup-bootfiles.sh oneshot
- [ ] **Phase 3: DHCP + PXE Boot** - isc-dhcp-server natively configured with PXE options and Authority Server sync
- [ ] **Phase 4: API Filesystem Migration** - Replace redis.js with direct filesystem reads, in-memory Map for host-status, lock file for sync-lock
- [ ] **Phase 5: Dependency Cleanup** - Remove ioredis/dockerode/rate-limit-redis, fix Docker hostnames, update health endpoint, disable containerLogs.js
- [ ] **Phase 6: Native LINBO File Access** - API reads and controls native /srv/linbo/ files and systemd-managed LINBO services
- [ ] **Phase 7: Caching-Satellite Features** - Multi-school sync, image caching, auto-discovery, first-boot sync
- [ ] **Phase 8: Frontend Build + nginx** - Vite static build served by native nginx with API reverse proxy
- [ ] **Phase 9: Docker Artifact Removal** - Remove all Docker/container source artifacts, clean directory structure
- [ ] **Phase 10: End-to-End Verification** - Live hardware test confirming PXE, rsync, API, WebSocket, and multi-school chain

## Phase Details

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
- [ ] 01-01-PLAN.md — install.sh (idempotent APT installer) + bats test scaffold for INST-01
- [ ] 01-02-PLAN.md — setup.sh rewrite (native mode) + .env.example update + bats tests for INST-02

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
- [ ] 02-01-PLAN.md — bats test scaffold (RED) + systemd unit source files in systemd/ (GREEN contract)
- [ ] 02-02-PLAN.md — scripts/setup-bootfiles.sh oneshot provisioner + setup.sh linbo user creation
- [ ] 02-03-PLAN.md — system installation, service activation, bats verification + human checkpoint

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
- [ ] 03-01-PLAN.md — bats test scaffold (RED) + setup-dhcp.sh (dhcpd.conf template, placeholders, INTERFACESv4, sudoers)
- [ ] 03-02-PLAN.md — sync.service.js DHCP write path to /etc/dhcp/ + dhcpd restart via sudo + .env.example + setup.sh
- [ ] 03-03-PLAN.md — system deployment (deploy-dhcp.sh), service activation, bats verification + human checkpoint

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
- [ ] 04-01-PLAN.md — jest.config.js fix + RED test suites for store.js and host-status worker (TDD Wave 1)
- [ ] 04-02-PLAN.md — implement src/lib/store.js — in-memory Map with ioredis-compatible client facade (TDD GREEN)
- [ ] 04-03-PLAN.md — wire store.js into redis.js + fix index.js (5 Redis locations) + fix rate-limit.js

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
- [ ] 05-01-PLAN.md — RED test suites: containerLogs.test.js (API-05/06/08) + health.test.js (API-07)
- [ ] 05-02-PLAN.md — containerLogs.js journald rewrite + Docker hostname fixes + health filesystem check (GREEN)
- [ ] 05-03-PLAN.md — npm uninstall ioredis dockerode rate-limit-redis + full suite regression check

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
- [ ] 06-01-PLAN.md — devices-csv-reader.js + startconf-parser.js + linbo-fs.service.js (pure library modules)
- [ ] 06-02-PLAN.md — wire native FS fallbacks into sync.js routes + POST /sync/services/reload + setup-linbo.sh sudoers

### Phase 7: Caching-Satellite Features
**Goal**: The server acts as a full Caching-Satellite: multiple schools sync correctly via the school parameter, LINBO images are cached locally, new clients are discovered automatically, and first-boot sync triggers without manual intervention
**Depends on**: Phase 6
**Requirements**: CACHE-01, CACHE-02, CACHE-03, CACHE-04
**Success Criteria** (what must be TRUE):
  1. Hosts from two different schools (distinct school parameters) are loaded correctly — no cross-contamination of host lists between schools
  2. A LINBO image requested by a client that is not yet cached locally is downloaded from the Authority Server via rsync and served to the client from local storage on subsequent requests
  3. A new client that has never contacted the server is detected automatically within the configured discovery interval — no manual registration needed
  4. A client that boots for the first time triggers an automatic sync without admin interaction — the sync log shows "first-boot" origin
**Plans**: TBD

### Phase 8: Frontend Build + nginx
**Goal**: The React frontend is built as static files and served by native nginx, with the API and WebSocket correctly proxied — an admin can open the browser and see the dashboard
**Depends on**: Phase 7
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. npm run build in the frontend directory produces a dist/ folder and the build exits without errors
  2. Opening http://[server-ip]/ in a browser loads the React app and the login page appears
  3. The browser WebSocket connection to /ws stays connected and delivers real-time events without disconnecting
  4. All API calls via the browser (through the nginx reverse proxy) return correct responses — no CORS errors, no 502s
**Plans**: TBD

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

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Install Scripts | 2/2 | Complete | 2026-03-19 |
| 2. systemd Units + Boot Scaffold | 3/3 | Complete | 2026-03-19 |
| 3. DHCP + PXE Boot | 3/3 | Complete | 2026-03-20 |
| 4. API Filesystem Migration | 3/3 | Complete | 2026-03-20 |
| 5. Dependency Cleanup | 3/3 | Complete | 2026-03-20 |
| 6. Native LINBO File Access | 0/2 | Not started | - |
| 7. Caching-Satellite Features | 0/? | Not started | - |
| 8. Frontend Build + nginx | 0/? | Not started | - |
| 9. Docker Artifact Removal | 0/? | Not started | - |
| 10. End-to-End Verification | 0/? | Not started | - |
