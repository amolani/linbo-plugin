---
phase: 06-native-linbo-file-access
plan: 02
subsystem: api
tags: [linbo, sync-routes, filesystem-fallback, systemd, sudoers, rsync, tftpd-hpa]

# Dependency graph
requires:
  - phase: 06-native-linbo-file-access
    provides: linbo-fs.service.js with readHostsFromDevicesCsv, listNativeStartConfIds, reloadLinboServices
provides:
  - "GET /sync/hosts native FS fallback from devices.csv when store is empty"
  - "GET /sync/configs native FS fallback from start.conf files when store is empty"
  - "POST /sync/services/reload endpoint for rsync + tftpd-hpa control"
  - "setup-linbo.sh sudoers provisioner for LINBO service control"
affects: [07-caching-satellite, api-routes, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns: [native-fs-fallback-when-store-empty, sudoers-provisioner-with-visudo-validation]

key-files:
  created:
    - scripts/server/setup-linbo.sh
  modified:
    - src/routes/sync.js

key-decisions:
  - "Fallback uses push/mutation on existing hosts array rather than reassignment to preserve any future enrichment logic"
  - "Configs fallback returns { id, content: null, source: 'native-fs', updatedAt: null } shape to distinguish native-fs from synced data"
  - "setup-linbo.sh follows identical pattern to setup-dhcp.sh for consistency (visudo validation, chmod 440, same log helpers)"

patterns-established:
  - "Native FS fallback: check array.length === 0 after store load, try/catch around FS read, log on fallback activation"
  - "Sudoers provisioner: write heredoc, chmod 440, visudo -c validation, remove on failure"

requirements-completed: [BASE-02, BASE-03]

# Metrics
duration: 4min
completed: 2026-03-20
---

# Phase 6 Plan 02: Sync Routes Integration Summary

**Native FS fallback in GET /sync/hosts and /configs endpoints, plus POST /sync/services/reload for rsync and tftpd-hpa control via systemd**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-20T14:25:24Z
- **Completed:** 2026-03-20T14:29:30Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- GET /sync/hosts now falls back to devices.csv when the in-memory store is empty (before first sync)
- GET /sync/configs now falls back to native start.conf file enumeration when the store is empty
- POST /sync/services/reload endpoint with admin auth calls reloadLinboServices() for rsync reload + tftpd-hpa restart
- setup-linbo.sh provisions /etc/sudoers.d/linbo-services with exactly two NOPASSWD rules (rsync reload, tftpd-hpa restart)
- All Plan 01 library modules now wired into running API -- no dead code remains

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire native FS fallbacks into GET /sync/hosts and GET /sync/configs** - `dbd1247` (feat)
2. **Task 2: Add POST /sync/services/reload endpoint + setup-linbo.sh** - `6ffc6a0` (feat)

## Files Created/Modified
- `src/routes/sync.js` - Added linbo-fs.service import, native FS fallbacks in /hosts and /configs, POST /services/reload endpoint
- `scripts/server/setup-linbo.sh` - Sudoers provisioner for rsync reload and tftpd-hpa restart (chmod 440 + visudo validation)

## Decisions Made
- Fallback uses push/mutation on existing hosts array rather than reassignment to preserve enrichment loop compatibility
- Configs fallback returns { id, content: null, source: 'native-fs', updatedAt: null } to distinguish native-fs entries from synced data
- setup-linbo.sh follows identical pattern to setup-dhcp.sh (same log functions, same visudo check, same chmod 440)

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 6 complete: all native LINBO file access modules created (Plan 01) and wired into API (Plan 02)
- BASE-02 (native FS reads) and BASE-03 (service control) requirements satisfied
- Ready for Phase 7 (Caching Satellite features: multi-school sync, image caching, auto-discovery)
- setup-linbo.sh must be run on deployment target before POST /services/reload will succeed (sudoers required)

## Self-Check: PASSED

All 3 files verified present. All 2 commits verified in git log.

---
*Phase: 06-native-linbo-file-access*
*Completed: 2026-03-20*
