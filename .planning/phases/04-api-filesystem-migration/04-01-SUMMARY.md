---
phase: 04-api-filesystem-migration
plan: "01"
subsystem: testing
tags: [jest, tdd, store, redis-replacement, in-memory]

# Dependency graph
requires:
  - phase: 03-dhcp-pxe-boot
    provides: "Working test infrastructure (jest.config.js)"
provides:
  - "Fixed jest configuration with root-level shims"
  - "RED test suite for store.js (30 test cases, full API surface)"
  - "RED test suite for host-status worker store.js backing (7 test cases)"
affects: [04-02-PLAN, 04-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: ["TDD RED phase: write failing tests before implementation", "Root-level shims for jest config path resolution"]

key-files:
  created:
    - tests/setup.js
    - tests/globalSetup.js
    - tests/globalTeardown.js
    - tests/api/lib/store.test.js
    - tests/api/workers/host-status.worker.test.js
  modified: []

key-decisions:
  - "Root-level shims instead of modifying jest.config.js paths — preserves existing api/ files untouched"
  - "30 test cases for store.js covering full ioredis-compatible API surface including NX/EX, pipeline tuples, scanStream"
  - "Host-status worker tests mock redis.getClient() to delegate to store.client — zero changes needed in worker"

patterns-established:
  - "Shim pattern: tests/setup.js -> tests/api/setup.js delegation for jest config"
  - "Store test pattern: store.reset() in beforeEach for clean state between tests"
  - "TDD RED: all tests fail with Cannot find module until implementation exists"

requirements-completed: [API-02, API-03, API-04]

# Metrics
duration: 4min
completed: 2026-03-20
---

# Phase 4 Plan 01: Jest Config Fix + RED Test Suites Summary

**TDD RED phase: jest config shims + 37 failing tests covering store.js full API surface and host-status worker volatility contract**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-20T10:16:44Z
- **Completed:** 2026-03-20T10:21:38Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Fixed broken jest.config.js path resolution via root-level shims (tests/setup.js, tests/globalSetup.js, tests/globalTeardown.js)
- Created comprehensive RED test suite for store.js with 30 test cases covering: String/Set/Hash/SortedSet/List ops, NX/EX set variant, TTL expiry, pipeline [null, result] tuple format, scanStream, publish/subscribe no-ops, call() error path
- Created RED test suite for host-status worker store.js backing with 7 test cases covering: host status volatility, hmset/expire/hgetall/hget/exists patterns, client.status guard

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix jest.config.js + create root-level shims** - `e9685cb` (test)
2. **Task 2: Write RED test suite -- store.test.js** - `a8db3d0` (test)
3. **Task 3: Write RED test suite -- host-status.worker.test.js** - `b4f4d23` (test)

## Files Created/Modified
- `tests/setup.js` - Root-level shim delegating to tests/api/setup.js
- `tests/globalSetup.js` - Root-level shim delegating to tests/api/globalSetup.js
- `tests/globalTeardown.js` - Root-level shim delegating to tests/api/globalTeardown.js
- `tests/api/lib/store.test.js` - 30 test cases for store.js full API surface (348 lines)
- `tests/api/workers/host-status.worker.test.js` - 7 test cases for host-status worker backing (107 lines)

## Decisions Made
- Used root-level shims (tests/setup.js etc.) instead of modifying jest.config.js paths -- preserves existing tests/api/ files untouched and avoids touching jest.config.js
- store.test.js uses jest.useFakeTimers() for TTL expiry tests -- clean, no real timeouts
- host-status.worker.test.js mocks redis module to delegate to store.client -- same mock pattern the GREEN phase will use, zero worker changes needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- RED tests are ready for Plan 02 (store.js implementation) to turn GREEN
- store.test.js covers the complete API surface that 17 importers depend on
- host-status.worker.test.js validates the API-03 volatility contract
- jest config now resolves correctly for all future test additions

## Self-Check: PASSED

All 5 created files verified on disk. All 3 task commits verified in git log.

---
*Phase: 04-api-filesystem-migration*
*Completed: 2026-03-20*
