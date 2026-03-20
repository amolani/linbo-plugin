#!/bin/bash
#
# LINBO Docker - Health Gate
# Blocks until all containers are healthy or timeout is reached.
#
# Usage:
#   ./scripts/wait-ready.sh         # Wait up to 120s (default)
#   WAIT_TIMEOUT=300 make wait-ready # Wait up to 300s
#
# Exit codes:
#   0 - All containers healthy
#   1 - Timeout or init failure
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Color-safe output
# ---------------------------------------------------------------------------
if [[ -t 1 ]] && command -v tput &>/dev/null && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TIMEOUT="${WAIT_TIMEOUT:-120}"
INTERVAL=3
HEALTH_SERVICES="cache api web tftp rsync ssh"

# ---------------------------------------------------------------------------
# Init container check (one-shot, must exit 0)
# ---------------------------------------------------------------------------
check_init() {
    # Skip if container doesn't exist (first run before compose up)
    if ! docker inspect linbo-init &>/dev/null; then
        echo -e "${YELLOW}[SKIP]${NC} linbo-init not found (not yet started?)"
        return 0
    fi

    local status
    status=$(docker inspect --format '{{.State.Status}}' linbo-init 2>/dev/null)

    if [[ "$status" == "running" ]]; then
        echo -e "${YELLOW}[WAIT]${NC} linbo-init still running..."
        return 1
    fi

    local exit_code
    exit_code=$(docker inspect --format '{{.State.ExitCode}}' linbo-init 2>/dev/null)

    if [[ "$exit_code" == "0" ]]; then
        echo -e "${GREEN}[PASS]${NC} linbo-init completed successfully"
        return 0
    else
        echo -e "${RED}[FAIL]${NC} linbo-init exited with code ${exit_code}"
        echo "  Last 5 log lines:"
        docker logs linbo-init --tail 5 2>&1 | sed 's/^/    /'
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Main health polling loop
# ---------------------------------------------------------------------------
poll_health() {
    local elapsed=0
    local services="$HEALTH_SERVICES"

    # Check if DHCP container exists (optional profile)
    if docker inspect linbo-dhcp &>/dev/null; then
        services="$services dhcp"
    fi

    echo -e "${BLUE}Waiting for containers to become healthy (timeout: ${TIMEOUT}s)...${NC}"

    while [[ $elapsed -lt $TIMEOUT ]]; do
        local all_healthy=true

        for svc in $services; do
            local health
            health=$(docker inspect --format '{{.State.Health.Status}}' "linbo-${svc}" 2>/dev/null || echo "missing")

            if [[ "$health" != "healthy" ]]; then
                all_healthy=false
                break
            fi
        done

        if $all_healthy; then
            echo -e "\n${GREEN}All containers healthy after ${elapsed}s${NC}"
            return 0
        fi

        sleep "$INTERVAL"
        elapsed=$((elapsed + INTERVAL))
        # Progress indicator
        printf "\r  %ds / %ds ..." "$elapsed" "$TIMEOUT"
    done

    # Timeout -- print diagnostics
    echo -e "\n\n${RED}TIMEOUT after ${TIMEOUT}s -- not all containers healthy${NC}\n"

    for svc in $services; do
        local health
        health=$(docker inspect --format '{{.State.Health.Status}}' "linbo-${svc}" 2>/dev/null || echo "missing")

        if [[ "$health" != "healthy" ]]; then
            echo -e "${RED}[FAIL]${NC} linbo-${svc}: ${health}"
            echo "  Last 5 log lines:"
            docker logs "linbo-${svc}" --tail 5 2>&1 | sed 's/^/    /'
            echo ""
        fi
    done

    return 1
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

# Wait for init container first (early exit on failure)
# Retry init check if it's still running
init_elapsed=0
while ! check_init; do
    if [[ $init_elapsed -ge $TIMEOUT ]]; then
        echo -e "${RED}TIMEOUT waiting for init container${NC}"
        exit 1
    fi
    sleep "$INTERVAL"
    init_elapsed=$((init_elapsed + INTERVAL))
done

# Poll long-running services
if poll_health; then
    exit 0
else
    exit 1
fi
