#!/bin/bash
# LINBO Morning Report — Run via cron at 06:00 before school starts
# Comprehensive boot-readiness check
#
# Usage: ./linbo-morning-report.sh

set -uo pipefail

HOSTNAME=$(hostname)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
LOG="/var/log/linbo-native/morning-report.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null

# Run health check
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HEALTH_RESULT=$("$SCRIPT_DIR/linbo-health-check.sh" 2>&1)
HEALTH_EXIT=$?

# Additional morning checks
echo "=============================================="
echo "  LINBO Morning Report — $HOSTNAME"
echo "  $TIMESTAMP"
echo "=============================================="
echo ""

# Health check results
echo "$HEALTH_RESULT"
echo ""

# Boot readiness summary
echo "----------------------------------------------"
echo "  Boot-Readiness Checks"
echo "----------------------------------------------"
echo ""

# start.conf files present?
STARTCONF_COUNT=$(ls /srv/linbo/start.conf.* 2>/dev/null | wc -l)
echo "  start.conf Dateien:    $STARTCONF_COUNT"

# GRUB configs present?
GRUB_GROUP=$(ls /srv/linbo/boot/grub/*.cfg 2>/dev/null | grep -v grub.cfg | wc -l)
GRUB_HOST=$(ls /srv/linbo/boot/grub/hostcfg/*.cfg 2>/dev/null | wc -l)
echo "  GRUB Gruppen-Configs:  $GRUB_GROUP"
echo "  GRUB Host-Configs:     $GRUB_HOST"

# Images available?
IMAGE_COUNT=$(find /srv/linbo/images -name "*.qcow2" -o -name "*.qdiff" 2>/dev/null | wc -l)
IMAGE_SIZE=$(du -sh /srv/linbo/images 2>/dev/null | awk '{print $1}')
echo "  Images:                $IMAGE_COUNT (${IMAGE_SIZE:-0})"

# DHCP config valid?
if [[ -f /etc/dhcp/dhcpd.conf ]]; then
  if dhcpd -t -cf /etc/dhcp/dhcpd.conf 2>/dev/null; then
    echo "  DHCP Config:           valid"
  else
    echo "  DHCP Config:           ⚠️  INVALID"
  fi
else
  echo "  DHCP Config:           not found"
fi

# System resources
echo ""
echo "----------------------------------------------"
echo "  System-Ressourcen"
echo "----------------------------------------------"
echo ""

# Memory
MEM_TOTAL=$(free -m | awk '/^Mem:/{print $2}')
MEM_USED=$(free -m | awk '/^Mem:/{print $3}')
MEM_PCT=$((MEM_USED * 100 / MEM_TOTAL))
echo "  RAM:                   ${MEM_USED}/${MEM_TOTAL} MB (${MEM_PCT}%)"

# Load
LOAD=$(cat /proc/loadavg | awk '{print $1, $2, $3}')
echo "  Load:                  $LOAD"

# Uptime
UPTIME=$(uptime -p | sed 's/up //')
echo "  Uptime:                $UPTIME"

# API uptime
API_UPTIME=$(curl -sf http://localhost:3000/health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{int(d.get('uptime',0))//3600}h {int(d.get('uptime',0))%3600//60}m\")" 2>/dev/null || echo "N/A")
echo "  API Uptime:            $API_UPTIME"

# Last 24h errors in journal
ERRORS_24H=$(journalctl -u linbo-api --since "24 hours ago" -p err --no-pager 2>/dev/null | grep -c "." || echo 0)
echo "  API Errors (24h):      $ERRORS_24H"

echo ""
echo "----------------------------------------------"

if [[ $HEALTH_EXIT -eq 0 ]]; then
  echo "  ✅ SCHULE BEREIT — Alle Systeme funktionsfähig"
else
  echo "  ❌ WARNUNG — Probleme gefunden, siehe oben"
fi

echo "----------------------------------------------"
echo ""

# Log result
echo "$TIMESTAMP healthy=$([[ $HEALTH_EXIT -eq 0 ]] && echo yes || echo no) configs=$STARTCONF_COUNT images=$IMAGE_COUNT errors=$ERRORS_24H" >> "$LOG"
