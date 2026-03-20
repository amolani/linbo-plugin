---
phase: 06-native-linbo-file-access
plan: 01
subsystem: api
tags: [linbo, filesystem, ini-parser, csv-parser, systemd, grub, start.conf]

# Dependency graph
requires:
  - phase: 04-api-filesystem-migration
    provides: atomic-write.js utility for crash-safe file writes
  - phase: 05-dependency-cleanup
    provides: clean codebase without Docker/Redis dependencies
provides:
  - "readHostsFromDevicesCsv() - async CSV parser for devices.csv"
  - "parseStartConf() - pure INI parser for start.conf files"
  - "linbo-fs.service.js - native FS operations (enumerate, read, write, reload)"
affects: [06-02-sync-routes, api-routes, sync-service]

# Tech tracking
tech-stack:
  added: []
  patterns: [ini-section-parser, csv-line-parser, enoent-returns-empty, execFileAsync-systemd]

key-files:
  created:
    - src/lib/devices-csv-reader.js
    - src/lib/startconf-parser.js
    - src/services/linbo-fs.service.js
    - tests/api/lib/devices-csv-reader.test.js
    - tests/api/lib/startconf-parser.test.js
  modified: []

key-decisions:
  - "Pure function for startconf-parser (no I/O, no dependencies) -- maximizes testability"
  - "Re-export readHostsFromDevicesCsv from linbo-fs.service for single-import convenience"
  - "ENOENT returns empty array/null (not throw) -- graceful degradation before first sync"

patterns-established:
  - "ENOENT-safe pattern: try/catch with code check, return [] or null on ENOENT, re-throw others"
  - "Section-tracking INI parser: track currentObj reference, push new object on section header"
  - "execFileAsync with sudo + full path for systemd operations (never exec())"

requirements-completed: [BASE-02, BASE-03]

# Metrics
duration: 22min
completed: 2026-03-20
---

# Phase 6 Plan 01: Native LINBO File Access Summary

**Three pure-logic library modules for native LINBO filesystem access: CSV host reader, INI start.conf parser, and FS service with GRUB config read/write and systemd reload**

## Performance

- **Duration:** 22 min
- **Started:** 2026-03-20T13:54:17Z
- **Completed:** 2026-03-20T14:16:50Z
- **Tasks:** 2
- **Files created:** 5

## Accomplishments
- devices-csv-reader: reads hosts from devices.csv with ENOENT safety, MAC lowercasing, field validation
- startconf-parser: pure synchronous INI parser returning { linbo, partitions, os } structure
- linbo-fs.service: 7 exported functions for start.conf enumeration, GRUB config CRUD, systemd reload
- 20 TDD tests covering all behaviors (10 reader + 10 parser)
- Zero new npm dependencies (Node built-ins only)

## Task Commits

Each task was committed atomically:

1. **Task 1: devices-csv-reader.js + startconf-parser.js (TDD RED)** - `be2c8e4` (test)
2. **Task 1: devices-csv-reader.js + startconf-parser.js (TDD GREEN)** - `f47cfbf` (feat)
3. **Task 2: linbo-fs.service.js** - `5789ce1` (feat)

## Files Created/Modified
- `src/lib/devices-csv-reader.js` - Async CSV parser for /etc/linuxmuster/sophomorix/default-school/devices.csv
- `src/lib/startconf-parser.js` - Pure synchronous INI parser for start.conf files
- `src/services/linbo-fs.service.js` - Native FS operations: enumerate start.conf, GRUB read/write, systemd reload
- `tests/api/lib/devices-csv-reader.test.js` - 10 tests covering ENOENT, empty, comments, parsing, filtering
- `tests/api/lib/startconf-parser.test.js` - 10 tests covering sections, keys, comments, realistic conf

## Decisions Made
- Pure function for startconf-parser (no I/O, no dependencies) -- maximizes testability
- Re-export readHostsFromDevicesCsv from linbo-fs.service so routes only need one import
- ENOENT returns empty array/null (not throw) -- graceful degradation before first sync
- tftpd-hpa uses restart (not reload) because it has no SIGHUP support

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test require paths**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Tests used `../../src/lib/` but correct path from tests/api/lib/ is `../../../src/lib/` (3 levels up)
- **Fix:** Changed require paths to `../../../src/lib/` in both test files
- **Files modified:** tests/api/lib/devices-csv-reader.test.js, tests/api/lib/startconf-parser.test.js
- **Verification:** All 20 tests pass
- **Committed in:** f47cfbf (part of GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Path fix necessary for tests to run. No scope creep.

## Issues Encountered
None beyond the path resolution fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three library modules are ready for consumption by Plan 02 (sync.js routes)
- linbo-fs.service exports all 7 functions needed for native API endpoints
- No blockers for Phase 6 Plan 02

## Self-Check: PASSED

All 5 files verified present. All 3 commits verified in git log.

---
*Phase: 06-native-linbo-file-access*
*Completed: 2026-03-20*
