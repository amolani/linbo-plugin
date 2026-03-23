#!/bin/bash
# Install LINBO monitoring — cron jobs + scripts
# Usage: sudo ./install-monitoring.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/usr/local/lib/linbo-monitoring"
CRON_FILE="/etc/cron.d/linbo-monitoring"

echo "Installing LINBO monitoring..."

# Copy scripts
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/linbo-health-check.sh" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/linbo-morning-report.sh" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR"/*.sh

# Create cron jobs
cat > "$CRON_FILE" << 'EOF'
# LINBO Monitoring — Health checks and morning report
# Installed by: scripts/monitoring/install-monitoring.sh

# Health check every 5 minutes (writes to /var/log/linbo-native/health-check.log)
*/5 * * * * root /usr/local/lib/linbo-monitoring/linbo-health-check.sh --quiet 2>/dev/null

# Morning report at 06:00 (writes to /var/log/linbo-native/morning-report.log)
0 6 * * 1-5 root /usr/local/lib/linbo-monitoring/linbo-morning-report.sh >> /var/log/linbo-native/morning-report.log 2>&1
EOF

chmod 644 "$CRON_FILE"

# Create log directory
mkdir -p /var/log/linbo-native

echo "  ✅ Scripts installed to $INSTALL_DIR"
echo "  ✅ Cron jobs installed to $CRON_FILE"
echo "  ✅ Health check: every 5 minutes"
echo "  ✅ Morning report: weekdays 06:00"
echo ""
echo "  Manual run: $INSTALL_DIR/linbo-health-check.sh"
echo "  Logs: /var/log/linbo-native/health-check.log"
