---
phase: 08-frontend-build-nginx
plan: 01
subsystem: infra
tags: [nginx, deploy-script, frontend, static-files]

# Dependency graph
requires:
  - phase: 07-caching-satellite-features
    provides: "Fully functional backend with multi-school sync, image caching, auto-discovery"
provides:
  - "nginx config with correct root /var/www/linbo for static file serving"
  - "Idempotent deploy-frontend.sh script (5-step: mkdir, copy dist, install nginx config, reload, smoke test)"
affects: [08-02-PLAN, 09-docker-artifact-removal, 10-e2e-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: ["deploy-*.sh idempotent script pattern (same as deploy-dhcp.sh)"]

key-files:
  created: ["scripts/server/deploy-frontend.sh"]
  modified: ["config/nginx.conf"]

key-decisions:
  - "nginx root set to /var/www/linbo (not /usr/share/nginx/html) to match deploy script target"
  - "deploy-frontend.sh follows identical log/structure pattern as deploy-dhcp.sh for consistency"
  - "No npm/build steps in deploy script -- dist/ is pre-built locally and rsynced to server"
  - "Smoke test (curl localhost for HTTP 200) included as final deploy validation step"

patterns-established:
  - "deploy-frontend.sh: 5-step idempotent pattern (mkdir, copy, nginx config install, reload, smoke test)"

requirements-completed: [UI-01, UI-02]

# Metrics
duration: 3min
completed: 2026-03-20
---

# Phase 8 Plan 01: Frontend Deploy Infrastructure Summary

**nginx root directive fixed to /var/www/linbo + idempotent deploy-frontend.sh with 5-step static file deployment and smoke test**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-20T17:20:48Z
- **Completed:** 2026-03-20T17:24:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Fixed nginx.conf root directive from /usr/share/nginx/html to /var/www/linbo, preventing 404s on all frontend routes
- Created idempotent deploy-frontend.sh with 5 steps: create web root, deploy dist/ files, install nginx config, validate+reload, smoke test
- Deploy script follows established deploy-dhcp.sh pattern (same header, logging, root check)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix nginx.conf root directive** - `8265a62` (feat)
2. **Task 2: Write scripts/server/deploy-frontend.sh** - `dbea1d8` (feat)

## Files Created/Modified
- `config/nginx.conf` - Changed root from /usr/share/nginx/html to /var/www/linbo
- `scripts/server/deploy-frontend.sh` - Idempotent deploy script: mkdir, copy dist/, nginx config install, reload, smoke test

## Decisions Made
- nginx root set to /var/www/linbo to match the deploy script's target directory
- deploy-frontend.sh follows the same log_info/log_ok/log_error pattern as deploy-dhcp.sh for team consistency
- No npm install or npm run build in the deploy script -- the frontend dist/ directory is built locally and rsynced to the server
- Added HTTP 200 smoke test as Step 5 to catch deployment failures early

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- config/nginx.conf ready to deploy with correct root directive
- deploy-frontend.sh ready to execute on target server (Plan 08-02 will rsync dist/ and run this script)
- Frontend dist/ must be built locally before running deploy-frontend.sh on the server

## Self-Check: PASSED

- [x] config/nginx.conf exists with `root /var/www/linbo;`
- [x] scripts/server/deploy-frontend.sh exists, executable, syntax valid
- [x] Commit 8265a62 found (Task 1)
- [x] Commit dbea1d8 found (Task 2)

---
*Phase: 08-frontend-build-nginx*
*Completed: 2026-03-20*
