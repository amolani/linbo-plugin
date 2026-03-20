#!/bin/bash
#
# LINBO Docker - System Diagnostics
# Checks 9 categories: containers, volumes, SSH keys, SSH key chain, linbofs64, Redis, PXE ports, APT repo, GRUB modules.
#
# Usage:
#   ./scripts/doctor.sh   # or: make doctor
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
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
# Counters
# ---------------------------------------------------------------------------
PASS=0
FAIL=0

# ---------------------------------------------------------------------------
# check() helper: prints PASS/FAIL with fix suggestion
#   $1 = description
#   $2 = result (0=pass, non-zero=fail)
#   $3 = fix suggestion (shown on failure)
# ---------------------------------------------------------------------------
check() {
    local desc="$1"
    local result="$2"
    local fix="$3"

    if [[ "$result" -eq 0 ]]; then
        echo -e "  ${GREEN}[PASS]${NC} $desc"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}[FAIL]${NC} $desc"
        echo -e "         Fix: $fix"
        FAIL=$((FAIL + 1))
    fi
}

# ---------------------------------------------------------------------------
# Helper: check if a container is running
# ---------------------------------------------------------------------------
is_running() {
    docker inspect --format '{{.State.Running}}' "$1" 2>/dev/null | grep -q "true"
}

# ---------------------------------------------------------------------------
# Category 1: Container Health
# ---------------------------------------------------------------------------
echo -e "\n${BLUE}Container Health${NC}"

HEALTH_SERVICES="cache api web tftp rsync ssh"

for svc in $HEALTH_SERVICES; do
    if docker inspect --format '{{.State.Health.Status}}' "linbo-${svc}" 2>/dev/null | grep -q "healthy"; then
        check "linbo-${svc} is healthy" 0 ""
    else
        check "linbo-${svc} is healthy" 1 "docker compose restart ${svc}"
    fi
done

# DHCP: only check if container exists (optional profile)
if docker inspect linbo-dhcp &>/dev/null; then
    if docker inspect --format '{{.State.Health.Status}}' linbo-dhcp 2>/dev/null | grep -q "healthy"; then
        check "linbo-dhcp is healthy" 0 ""
    else
        check "linbo-dhcp is healthy" 1 "docker compose --profile dhcp restart dhcp"
    fi
fi

# Init: check exit code (one-shot container)
if docker inspect linbo-init &>/dev/null; then
    init_exit=$(docker inspect --format '{{.State.ExitCode}}' linbo-init 2>/dev/null || echo "1")
    if [[ "$init_exit" == "0" ]]; then
        check "linbo-init completed successfully" 0 ""
    else
        check "linbo-init completed successfully" 1 "docker compose up init"
    fi
fi

# ---------------------------------------------------------------------------
# Category 2: Volume Permissions
# ---------------------------------------------------------------------------
echo -e "\n${BLUE}Volume Permissions${NC}"

if is_running linbo-api; then
    if docker exec linbo-api sh -c 'touch /srv/linbo/.doctor-test && rm /srv/linbo/.doctor-test' 2>/dev/null; then
        check "/srv/linbo writable by API container" 0 ""
    else
        mountpoint=$(docker volume inspect linbo_srv_data -f '{{.Mountpoint}}' 2>/dev/null || echo "/var/lib/docker/volumes/linbo_srv_data/_data")
        check "/srv/linbo writable by API container" 1 "chown -R 1001:1001 ${mountpoint}"
    fi
else
    echo -e "  ${YELLOW}[SKIP]${NC} linbo-api not running -- cannot test volume permissions"
fi

# ---------------------------------------------------------------------------
# Category 3: SSH Key Presence
# ---------------------------------------------------------------------------
echo -e "\n${BLUE}SSH Keys${NC}"

SSH_KEYS=(
    "/etc/linuxmuster/linbo/ssh_host_rsa_key"
    "/etc/linuxmuster/linbo/ssh_host_rsa_key.pub"
    "/etc/linuxmuster/linbo/linbo_client_key"
    "/etc/linuxmuster/linbo/linbo_client_key.pub"
)

if is_running linbo-ssh; then
    for key in "${SSH_KEYS[@]}"; do
        keyname=$(basename "$key")
        if docker exec linbo-ssh test -f "$key" 2>/dev/null; then
            check "${keyname} present" 0 ""
        else
            check "${keyname} present" 1 "docker compose restart ssh (auto-generates keys on start)"
        fi
    done
else
    echo -e "  ${YELLOW}[SKIP]${NC} linbo-ssh not running -- cannot check SSH keys"
fi

# ---------------------------------------------------------------------------
# Category: SSH Key Chain (API perspective)
# ---------------------------------------------------------------------------
echo -e "\n${BLUE}SSH Key Chain${NC}"

if is_running linbo-api; then
    # Check 1: linbo_client_key readable by API container (uid 1001)
    if docker exec linbo-api test -r /etc/linuxmuster/linbo/linbo_client_key 2>/dev/null; then
        check "linbo_client_key readable by API" 0 ""
    else
        check "linbo_client_key readable by API" 1 "docker compose restart ssh (generates keys with correct permissions)"
    fi

    # Check 2: linbo_client_key.pub present on shared volume
    if docker exec linbo-api test -f /etc/linuxmuster/linbo/linbo_client_key.pub 2>/dev/null; then
        check "linbo_client_key.pub present" 0 ""
    else
        check "linbo_client_key.pub present" 1 "docker compose restart ssh"
    fi

    # Check 3: authorized_keys exists and is non-empty inside linbofs64
    if docker exec linbo-api test -f /srv/linbo/linbofs64 2>/dev/null; then
        ak_lines=$(docker exec linbo-api bash -c 'xzcat /srv/linbo/linbofs64 | cpio -i --to-stdout .ssh/authorized_keys 2>/dev/null | wc -l' 2>/dev/null || echo "0")
        if [[ "$ak_lines" -gt 0 ]]; then
            check "authorized_keys in linbofs64 (${ak_lines} key lines)" 0 ""
        else
            check "authorized_keys in linbofs64" 1 "make linbofs-rebuild"
        fi
    else
        echo -e "  ${YELLOW}[SKIP]${NC} linbofs64 not found -- cannot verify authorized_keys injection"
    fi
else
    echo -e "  ${YELLOW}[SKIP]${NC} linbo-api not running -- cannot check SSH key chain"
fi

# ---------------------------------------------------------------------------
# Category 4: linbofs64 Build Status
# ---------------------------------------------------------------------------
echo -e "\n${BLUE}linbofs64 Build Status${NC}"

if is_running linbo-api; then
    if docker exec linbo-api test -f /srv/linbo/.linbofs-patch-status 2>/dev/null; then
        check "linbofs64 patch status marker exists" 0 ""
    else
        check "linbofs64 patch status marker exists" 1 "Trigger rebuild: curl -X POST http://localhost:3000/api/system/linbo-update/rebuild"
    fi

    if docker exec linbo-api test -f /srv/linbo/linbofs64 2>/dev/null; then
        check "linbofs64 boot image present" 0 ""
    else
        check "linbofs64 boot image present" 1 "Run: make rebuild-all"
    fi
else
    echo -e "  ${YELLOW}[SKIP]${NC} linbo-api not running -- cannot check linbofs64 status"
fi

# ---------------------------------------------------------------------------
# Category 5: Redis Connectivity
# ---------------------------------------------------------------------------
echo -e "\n${BLUE}Redis Connectivity${NC}"

if docker exec linbo-cache redis-cli ping 2>/dev/null | grep -q PONG; then
    check "Redis responds to PING" 0 ""
else
    check "Redis responds to PING" 1 "docker compose restart cache"
fi

# ---------------------------------------------------------------------------
# Category 6: PXE Port Reachability
# ---------------------------------------------------------------------------
echo -e "\n${BLUE}PXE Port Reachability${NC}"

if ss -ulnp sport = :69 2>/dev/null | grep -q 69; then
    check "TFTP port 69/udp listening" 0 ""
else
    check "TFTP port 69/udp listening" 1 "TFTP uses host network. Check: docker compose restart tftp"
fi

if ss -tlnp sport = :873 2>/dev/null | grep -q 873; then
    check "Rsync port 873/tcp listening" 0 ""
else
    check "Rsync port 873/tcp listening" 1 "docker compose restart rsync"
fi

if ss -tlnp sport = :3000 2>/dev/null | grep -q 3000; then
    check "API port 3000/tcp listening" 0 ""
else
    check "API port 3000/tcp listening" 1 "docker compose restart api"
fi

if ss -tlnp sport = :2222 2>/dev/null | grep -q 2222; then
    check "SSH port 2222/tcp listening" 0 ""
else
    check "SSH port 2222/tcp listening" 1 "docker compose restart ssh"
fi

# ---------------------------------------------------------------------------
# Category 7: APT Repository Connectivity
# ---------------------------------------------------------------------------
echo -e "\n${BLUE}APT Repository${NC}"

if curl -sf --connect-timeout 5 -o /dev/null "https://deb.linuxmuster.net/dists/lmn73/Release"; then
    check "deb.linuxmuster.net reachable" 0 ""
else
    check "deb.linuxmuster.net reachable" 1 "Check DNS and internet connectivity. URL: https://deb.linuxmuster.net"
fi

# ---------------------------------------------------------------------------
# Category 8: GRUB Modules
# ---------------------------------------------------------------------------
echo -e "\n${BLUE}GRUB Modules${NC}"

if is_running linbo-api; then
    for arch in i386-pc x86_64-efi; do
        mod_count=$(docker exec linbo-api find /srv/linbo/boot/grub/${arch} -name '*.mod' 2>/dev/null | wc -l)
        if [[ "$mod_count" -gt 0 ]]; then
            check "GRUB ${arch} modules present (${mod_count})" 0 ""
        else
            check "GRUB ${arch} modules present" 1 "docker compose up init (re-provision boot files)"
        fi
    done
else
    echo -e "  ${YELLOW}[SKIP]${NC} linbo-api not running -- cannot check GRUB modules"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo -e "Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "========================================"

if [[ $FAIL -gt 0 ]]; then
    exit 1
else
    exit 0
fi
