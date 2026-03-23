#!/bin/bash
# LINBO Health Check — Run via cron every 5 minutes
# Exit 0 = healthy, Exit 1 = problems found
# Writes status to /var/log/linbo-native/health-check.log
#
# Usage: ./linbo-health-check.sh [--quiet] [--json]

set -uo pipefail

QUIET=false
JSON=false
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    --json)  JSON=true ;;
  esac
done

# Counters
CHECKS=0
PASS=0
WARN=0
FAIL=0
RESULTS=()

check() {
  local name="$1" critical="$2" cmd="$3"
  CHECKS=$((CHECKS + 1))
  local status detail
  if detail=$(eval "$cmd" 2>&1); then
    status="ok"
    PASS=$((PASS + 1))
  else
    if [[ "$critical" == "yes" ]]; then
      status="fail"
      FAIL=$((FAIL + 1))
    else
      status="warn"
      WARN=$((WARN + 1))
    fi
  fi
  RESULTS+=("${status}|${name}|${detail}")
  if [[ "$QUIET" == "false" && "$JSON" == "false" ]]; then
    case "$status" in
      ok)   printf "  ✅ %-25s %s\n" "$name" "$detail" ;;
      warn) printf "  ⚠️  %-25s %s\n" "$name" "$detail" ;;
      fail) printf "  ❌ %-25s %s\n" "$name" "$detail" ;;
    esac
  fi
}

# ===========================================================================
# Checks
# ===========================================================================

[[ "$QUIET" == "false" && "$JSON" == "false" ]] && echo "LINBO Health Check — $(date '+%Y-%m-%d %H:%M:%S')" && echo ""

# 1. Critical services
check "linbo-api" yes \
  'systemctl is-active linbo-api >/dev/null 2>&1 && echo "active (pid $(systemctl show -p MainPID --value linbo-api))" || (echo "INACTIVE"; false)'

check "tftpd-hpa" yes \
  'systemctl is-active tftpd-hpa >/dev/null 2>&1 && echo "active" || (echo "INACTIVE"; false)'

check "rsync" yes \
  'systemctl is-active rsync >/dev/null 2>&1 && echo "active" || (echo "INACTIVE"; false)'

check "isc-dhcp-server" yes \
  'systemctl is-active isc-dhcp-server >/dev/null 2>&1 && echo "active" || (echo "INACTIVE"; false)'

check "nginx" no \
  'systemctl is-active nginx >/dev/null 2>&1 && echo "active" || (echo "INACTIVE"; false)'

# 2. API health endpoint
check "API /health" yes \
  'resp=$(curl -sf --max-time 5 http://localhost:3000/health 2>/dev/null) && echo "$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get(\"status\",\"unknown\"))" 2>/dev/null || echo "ok")" || (echo "UNREACHABLE"; false)'

# 3. Disk space
check "Disk /srv/linbo" yes \
  'avail=$(df -BG /srv/linbo 2>/dev/null | awk "NR==2{print \$4}" | tr -d "G"); [[ "$avail" -gt 5 ]] && echo "${avail}GB free" || (echo "ONLY ${avail}GB free (<5GB)"; false)'

check "Disk /var" no \
  'avail=$(df -BG /var 2>/dev/null | awk "NR==2{print \$4}" | tr -d "G"); [[ "$avail" -gt 2 ]] && echo "${avail}GB free" || (echo "ONLY ${avail}GB free (<2GB)"; false)'

# 4. linbofs64 exists and is recent
check "linbofs64" yes \
  'f="/srv/linbo/linbofs64"; [[ -f "$f" ]] && size=$(stat -c%s "$f" 2>/dev/null) && age=$(( ($(date +%s) - $(stat -c%Y "$f")) / 3600 )) && echo "${size} bytes, ${age}h old" || (echo "MISSING"; false)'

# 5. linbo64 kernel exists
check "linbo64 kernel" yes \
  '[[ -f "/srv/linbo/linbo64" ]] && echo "present" || (echo "MISSING"; false)'

# 6. GRUB boot files
check "GRUB core.efi" yes \
  '[[ -f "/srv/linbo/boot/grub/x86_64-efi/core.efi" ]] && echo "present" || (echo "MISSING"; false)'

# 7. SSH keys (needed for client communication)
check "SSH client key" yes \
  '[[ -f "/etc/linuxmuster/linbo/ssh_host_rsa_key_client" ]] && echo "present" || (echo "MISSING"; false)'

# 8. DHCP leases (are clients getting IPs?)
check "DHCP leases" no \
  'leases=$(grep -c "^lease " /var/lib/dhcp/dhcpd.leases 2>/dev/null); leases=${leases:-0}; echo "${leases} leases"; [[ "$leases" -gt 0 ]] || false'

# 9. Port reachability
check "Port 69/udp (TFTP)" yes \
  'ss -ulnp sport = :69 2>/dev/null | grep -q ":69" && echo "listening" || (echo "NOT listening"; false)'

check "Port 873/tcp (rsync)" yes \
  'ss -tlnp sport = :873 2>/dev/null | grep -q ":873" && echo "listening" || (echo "NOT listening"; false)'

check "Port 3000/tcp (API)" yes \
  'ss -tlnp sport = :3000 2>/dev/null | grep -q ":3000" && echo "listening" || (echo "NOT listening"; false)'

# 10. Store snapshot age (data loss indicator)
check "Store snapshot" no \
  'f="/var/lib/linbo-native/store.json"; [[ -f "$f" ]] && age=$(( ($(date +%s) - $(stat -c%Y "$f")) / 60 )) && echo "${age}min old" && [[ "$age" -lt 10 ]] || (echo "STALE or missing (>${age:-?}min)"; false)'

# ===========================================================================
# Summary
# ===========================================================================

if [[ "$JSON" == "true" ]]; then
  echo "{"
  echo "  \"timestamp\": \"$(date -Iseconds)\","
  echo "  \"hostname\": \"$(hostname)\","
  echo "  \"checks\": $CHECKS,"
  echo "  \"pass\": $PASS,"
  echo "  \"warn\": $WARN,"
  echo "  \"fail\": $FAIL,"
  echo "  \"healthy\": $([ $FAIL -eq 0 ] && echo true || echo false),"
  echo "  \"results\": ["
  local first=true
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r status name detail <<< "$r"
    [[ "$first" == "true" ]] && first=false || echo ","
    printf '    {"status":"%s","name":"%s","detail":"%s"}' "$status" "$name" "$detail"
  done
  echo ""
  echo "  ]"
  echo "}"
else
  [[ "$QUIET" == "false" ]] && echo "" && echo "  $CHECKS checks: $PASS ok, $WARN warnings, $FAIL failures"
fi

# Write to log
LOG_DIR="/var/log/linbo-native"
mkdir -p "$LOG_DIR" 2>/dev/null
echo "$(date -Iseconds) checks=$CHECKS pass=$PASS warn=$WARN fail=$FAIL" >> "$LOG_DIR/health-check.log" 2>/dev/null

# Exit code
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
