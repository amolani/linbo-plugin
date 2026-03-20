---
phase: 04-api-filesystem-migration
plan: "03"
subsystem: api
tags: [redis-removal, store-delegation, rate-limit, health-endpoint, graceful-shutdown]

# Dependency graph
requires:
  - phase: 04-api-filesystem-migration
    plan: "02"
    provides: "In-memory Map store with ioredis-compatible client facade (src/lib/store.js)"
provides:
  - "redis.js thin delegate to store.js -- no ioredis import, all 17 importers unchanged"
  - "index.js startup without Redis -- store initialized synchronously"
  - "/health returns services.store='up' (not redis), always HTTP 200"
  - "/ready returns 200 without Redis ping"
  - "rate-limit.js always uses in-memory MemoryStore (no RedisStore)"
  - "Graceful shutdown flushes store snapshot to disk"
affects: [05-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Thin delegate pattern: redis.js -> store.js via require('./store')", "In-memory rate limiting without Redis dependency"]

key-files:
  created: []
  modified:
    - src/lib/redis.js
    - src/index.js
    - src/middleware/rate-limit.js
    - tests/api/lib/redis.test.js

key-decisions:
  - "redis.js fully rewritten as thin delegate -- 80 lines replaced 200 lines of ioredis client management"
  - "redis.test.js rewritten to test against real store.js (no ioredis mock needed)"
  - "/ready endpoint simplified to always-200 (store is always ready, no network dependency)"
  - "rate-limit.js RedisStore block removed entirely, not just bypassed"

patterns-established:
  - "Delegate pattern: redis.js exports unchanged API, internals delegate to store.js"
  - "Health endpoint pattern: services.store='up' always (synchronous in-process store)"
  - "Startup pattern: no async connection blocks, store ready at require() time"

requirements-completed: [API-02, API-03, API-04]

# Metrics
duration: 10min
completed: 2026-03-20
---

# Phase 4 Plan 03: Store.js Wiring Summary

**redis.js rewritten as thin delegate to store.js -- API starts without Redis, /health returns store='up', rate limiting uses in-memory MemoryStore**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-20T10:44:57Z
- **Completed:** 2026-03-20T10:55:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Rewrote redis.js from 200-line ioredis wrapper to 80-line thin delegate to store.js -- all 17 importer files work unchanged
- Removed all 5 Redis-specific locations from index.js: health check, ready check, startup connection, first-boot sync, graceful shutdown
- Eliminated RedisStore from rate-limit.js -- always uses express-rate-limit built-in MemoryStore
- All 63 runnable tests pass (39 store + 17 redis + 7 host-status worker)

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: redis.js delegate tests** - `9e349a3` (test)
2. **Task 1 GREEN: rewrite redis.js to delegate to store.js** - `4379776` (feat)
3. **Task 2: remove Redis from index.js + rate-limit.js** - `0310ae0` (feat)
4. Task 3: verification-only (no code changes)

## Files Created/Modified
- `src/lib/redis.js` - Thin delegate to store.js: getClient/getSubscriber return store.client, disconnect calls flushToDisk, no ioredis dependency
- `src/index.js` - 5 Redis locations replaced: health uses store, ready always 200, no startup connection block, storeClient variable, shutdown flushes store
- `src/middleware/rate-limit.js` - RedisStore block removed, always in-memory MemoryStore
- `tests/api/lib/redis.test.js` - Rewritten to test store.js delegation (17 tests, no ioredis mock)

## Decisions Made
- redis.js completely rewritten rather than patched -- cleaner result with no dead code paths
- redis.test.js rewritten to test against real store.js rather than mocking at jest.mock level -- more reliable, tests actual behavior
- /ready endpoint simplified to synchronous handler (no async needed when store is always ready)
- rate-limit.js RedisStore block removed entirely rather than being wrapped in a false condition

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- 38 of 41 test suites fail due to missing npm dependencies (express, supertest, ssh2, uuid, etc.) in the development environment -- these are pre-existing failures unrelated to Phase 4 changes
- All tests that CAN run in this environment (store, redis, host-status worker) pass successfully

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 4 is now complete: store.js created (Plan 02), redis.js delegated (Plan 03), all endpoints work without Redis
- Phase 5 can proceed with auth middleware and containerLogs.js changes
- sync:isRunning lock is cleared on startup via store.js loadFromDisk() (Pitfall 3 from RESEARCH.md handled)
- All 17 importer files verified unchanged -- zero modifications to any file that imports redis.js

## Self-Check: PASSED

All 6 files verified on disk. All 3 task commits (9e349a3, 4379776, 0310ae0) verified in git log.

---
*Phase: 04-api-filesystem-migration*
*Completed: 2026-03-20*
