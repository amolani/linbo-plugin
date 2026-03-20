---
phase: 11-ssh-terminal
plan: 01
subsystem: infra
tags: [ssh, ssh-keygen, setup, linbo-client-key]

# Dependency graph
requires:
  - phase: 08-frontend-build-nginx
    provides: "Working native deployment with setup.sh and API"
provides:
  - "_ensure_linbo_ssh_key() function in setup.sh"
  - "LINBO_CLIENT_SSH_KEY env var in .env template"
  - "/etc/linuxmuster/linbo/linbo_client_key provisioned with root:linbo 640 permissions"
affects: [12-kernel-management, 13-linbofs-management, 14-firmware-management, 16-driver-management, 17-remote-operations]

# Tech tracking
tech-stack:
  added: []
  patterns: ["SSH key provisioning via setup.sh with copy-to-API-readable-location pattern"]

key-files:
  created: []
  modified:
    - setup.sh
    - src/services/ssh.service.js

key-decisions:
  - "Copy key to /etc/linuxmuster/linbo/ rather than symlink (linbo user cannot traverse /root/.ssh/)"
  - "Handle broken /root/.ssh/id_rsa directory artifact from previous setup"

patterns-established:
  - "SSH key chain: generate in /root/.ssh/, copy to /etc/linuxmuster/linbo/, set root:linbo 640"

requirements-completed: [SSH-01]

# Metrics
duration: 5min
completed: 2026-03-20
---

# Phase 11 Plan 01: SSH Key Provisioning Summary

**setup.sh gains _ensure_linbo_ssh_key() to provision /etc/linuxmuster/linbo/linbo_client_key (root:linbo 640) so the API user can authenticate into live LINBO clients over SSH**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-20
- **Completed:** 2026-03-20
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `_ensure_linbo_ssh_key()` function to setup.sh that generates or reuses an RSA key, copies it to an API-readable location, and sets correct ownership/permissions
- Added `LINBO_CLIENT_SSH_KEY` env var to the .env template written by `write_env()`
- Added `ssh-keygen` to prerequisite checks in `run_prerequisites()`
- Removed all Docker-container references from ssh.service.js (error message + JSDoc comment)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add _ensure_linbo_ssh_key() to setup.sh + write LINBO_CLIENT_SSH_KEY to .env** - `f089b39` (feat)
2. **Task 2: Update ssh.service.js error message -- remove Docker-container language** - `094fefd` (fix)

## Files Created/Modified
- `setup.sh` - Added `_ensure_linbo_ssh_key()` function, call in main(), ssh-keygen prereq, LINBO_CLIENT_SSH_KEY env var in .env heredoc
- `src/services/ssh.service.js` - Updated error message and JSDoc comment to reference setup.sh instead of SSH container

## Decisions Made
- Copy key approach (not symlink): linbo user cannot traverse /root/.ssh/ (mode 700), so the key must be copied to a group-readable location
- Handle broken directory artifact: previous setup on 10.40.0.10 left /root/.ssh/id_rsa as a directory; function detects and removes it before regenerating

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SSH key provisioning is wired; running setup.sh on a server will now create the key file
- Phase 11 Plan 02 (unit tests) can proceed to verify the key loading and error message behavior
- Phase 11 Plan 03 (deployment + human verification) will test the full SSH chain on real hardware

## Self-Check: PASSED

- FOUND: setup.sh
- FOUND: src/services/ssh.service.js
- FOUND: 11-01-SUMMARY.md
- VERIFIED: _ensure_linbo_ssh_key appears 2 times in setup.sh (line 428 definition, line 736 call)
- VERIFIED: setup.sh appears 2 times in ssh.service.js (line 7 JSDoc, line 62 error message)
- VERIFIED: Commit f089b39 (Task 1) and 094fefd (Task 2)

---
*Phase: 11-ssh-terminal*
*Completed: 2026-03-20*
