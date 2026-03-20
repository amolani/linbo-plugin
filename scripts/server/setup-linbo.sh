#!/usr/bin/env bash
# setup-linbo.sh -- LINBO service control sudoers provisioning
# Provisions sudoers entries for the linbo user to reload rsync and restart tftpd-hpa.
# Idempotent: safe to re-run. Validates with visudo before accepting.
# Usage: sudo ./scripts/server/setup-linbo.sh
set -euo pipefail

SUDOERS_FILE="/etc/sudoers.d/linbo-services"

log_info()  { echo "[setup-linbo] INFO:  $*"; }
log_ok()    { echo "[setup-linbo] OK:    $*"; }
log_error() { echo "[setup-linbo] ERROR: $*" >&2; }
log_warn()  { echo "[setup-linbo] WARN:  $*" >&2; }

# Root guard
[[ "$EUID" -ne 0 ]] && log_error "Must run as root" && exit 1

log_info "Provisioning LINBO service control sudoers..."

# =============================================================================
# Write sudoers entry for linbo user (minimal privilege)
# =============================================================================
cat > "$SUDOERS_FILE" << 'SUDOEOF'
# /etc/sudoers.d/linbo-services
# Allow linbo API service to reload rsync and restart tftpd-hpa
linbo ALL=(root) NOPASSWD: /bin/systemctl reload rsync
linbo ALL=(root) NOPASSWD: /bin/systemctl restart tftpd-hpa
SUDOEOF
chmod 440 "$SUDOERS_FILE"
log_ok "Written: $SUDOERS_FILE (chmod 440)"

# Validate sudoers entry
if ! visudo -c -f "$SUDOERS_FILE" &>/dev/null; then
    log_error "sudoers validation failed -- removing $SUDOERS_FILE"
    rm -f "$SUDOERS_FILE"
    exit 1
fi
log_ok "sudoers entry validated"

log_ok "LINBO service control provisioning complete."
