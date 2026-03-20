---
phase: 05-dependency-cleanup
plan: "01"
subsystem: testing
tags: [tdd, jest, containerLogs, health, dockerode, api-05, api-06, api-07, api-08]

# Dependency graph
requires:
  - phase: 04-api-filesystem-migration
    provides: store.js backend replacing Redis, redis.js delegation pattern
provides:
  - RED test suite for containerLogs.js (API-05, API-06, API-08) — 15 tests
  - RED test suite for /health endpoint (API-07) — 6 tests
affects: [05-dependency-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-level assertions via fs.readFileSync for dependency auditing"
    - "File content assertions for config/script hostname migration"

key-files:
  created:
    - tests/api/lib/containerLogs.test.js
    - tests/api/routes/health.test.js
  modified: []

key-decisions:
  - "Source-level assertion for services.linbo check (avoids requiring full index.js which triggers server startup)"
  - "Split nginx.conf Docker hostname checks into two tests (http://api: and http://linbo-api:) for clarity"
  - "API-08 behavioral tests run against real containerLogs module with Docker socket available — more RED tests than anticipated"

patterns-established:
  - "Source-level file content assertions for dependency auditing (no dockerode, no Docker hostnames)"
  - "Standalone Express app in route tests to avoid EADDRINUSE from index.js server startup"

requirements-completed: [API-05, API-06, API-07, API-08]

# Metrics
duration: 17min
completed: 2026-03-20
---

# Phase 5 Plan 01: TDD RED Tests Summary

**RED test suites defining contracts for Docker dependency removal: containerLogs (15 tests, 8 RED) and /health endpoint (6 tests, 1 RED)**

## Performance

- **Duration:** 17 min
- **Started:** 2026-03-20T11:32:37Z
- **Completed:** 2026-03-20T11:49:56Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- Created containerLogs.test.js with 15 tests covering API-05 (no dockerode), API-06 (Docker hostnames), API-08 (graceful degradation)
- Created health.test.js with 6 tests covering API-07 (services.linbo field, no redis field, response shape)
- 9 total RED tests confirmed failing on current codebase (8 in containerLogs, 1 in health)
- All tests load cleanly with no syntax errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Write RED tests for containerLogs.js (API-05, API-06, API-08)** - `34ed42a` (test)
2. **Task 2: Write RED tests for health endpoint (API-07)** - `1a4f2ec` (test)

## Files Created/Modified
- `tests/api/lib/containerLogs.test.js` - RED test suite: no Docker deps, hostname migration, graceful degradation
- `tests/api/routes/health.test.js` - RED test suite: services.linbo field, response shape assertions

## Decisions Made
- Used source-level `fs.readFileSync` assertions for dependency auditing (API-05) and hostname migration (API-06), matching the pattern established in Phase 4's redis.test.js
- For health endpoint, used source-level assertion (`services.linbo` pattern in index.js source) instead of requiring the full index.js module, which would trigger server startup and cause EADDRINUSE conflicts
- Split nginx.conf hostname test into two separate assertions (http://api: and http://linbo-api:) for maximum specificity
- API-08 tests run against the real containerLogs module: since Docker socket IS available on the build server, isAvailable() returns true and listContainers() returns real containers -- these are additional RED tests that will turn GREEN when dockerode is removed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Docker socket available in test environment (plan assumed it wouldn't be): this caused 2 additional API-08 tests to be RED (isAvailable returns true, listContainers returns real containers). This is actually better -- more tests that must turn GREEN when Docker dependency is removed.
- npm dependencies not installed at start: ran `npm install` to set up test infrastructure.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RED test suites ready for Plan 02 (GREEN phase: implement Docker dependency removal)
- 9 RED tests define the exact contracts that Plan 02 must satisfy
- 12 GREEN tests validate that existing correct behavior is preserved

## Self-Check: PASSED

- [x] tests/api/lib/containerLogs.test.js exists (15 tests)
- [x] tests/api/routes/health.test.js exists (6 tests)
- [x] Commit 34ed42a exists (Task 1)
- [x] Commit 1a4f2ec exists (Task 2)
- [x] 05-01-SUMMARY.md exists

---
*Phase: 05-dependency-cleanup*
*Completed: 2026-03-20*
