#!/bin/bash
# deploy-dhcp.sh — Deploy DHCP scaffold and activate isc-dhcp-server
# Usage: sudo ./scripts/server/deploy-dhcp.sh
# Idempotent: safe to re-run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
log_info()  { echo "[deploy-dhcp] INFO:  $*"; }
log_ok()    { echo "[deploy-dhcp] OK:    $*"; }
log_error() { echo "[deploy-dhcp] ERROR: $*" >&2; }

[[ "$EUID" -ne 0 ]] && log_error "Must run as root" && exit 1

log_info "Step 1: Running DHCP scaffold provisioning..."
bash "${SCRIPT_DIR}/setup-dhcp.sh"
log_ok "setup-dhcp.sh complete"

log_info "Step 2: Enabling and starting isc-dhcp-server..."
systemctl daemon-reload
systemctl unmask isc-dhcp-server 2>/dev/null || true
systemctl enable isc-dhcp-server
systemctl start isc-dhcp-server
log_ok "isc-dhcp-server enabled and started"

log_info "Step 3: Verifying service state..."
sleep 2  # allow service to stabilize
if ! systemctl is-active --quiet isc-dhcp-server; then
    log_error "isc-dhcp-server failed to start. Check: journalctl -u isc-dhcp-server -n 50"
    exit 1
fi
log_ok "isc-dhcp-server is active"

log_info "Step 4: Running bats verification..."
if command -v bats &>/dev/null; then
    BATS_ROOT="$(cd "${SCRIPT_DIR}/../../" && pwd)"
    bats "${BATS_ROOT}/tests/dhcp/test_dhcp.bats"
    log_ok "All dhcp tests passed"
else
    log_info "bats not found — run manually: sudo bats tests/dhcp/test_dhcp.bats"
fi

log_ok "DHCP deployment complete."
echo ""
echo "  DHCP is active on: $(grep '^INTERFACESv4=' /etc/default/isc-dhcp-server | cut -d= -f2 | tr -d '"')"
echo "  Config: /etc/dhcp/dhcpd.conf"
echo "  Logs:   journalctl -u isc-dhcp-server -f"
echo "  PXE:    next-server = $(grep '^next-server' /etc/dhcp/dhcpd.conf | awk '{print $2}' | tr -d ';')"
