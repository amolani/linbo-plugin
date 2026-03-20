#!/bin/bash
# setup-bootfiles.sh — LINBO boot scaffold provisioning
# Called by linbo-setup.service (systemd Type=oneshot)
# Idempotent: re-runs safely via sentinel file
# Usage: sudo /usr/local/bin/setup-bootfiles.sh
set -euo pipefail

SENTINEL="/var/lib/linbo-native/.boot-scaffold-done"
LINBO_DIR="/srv/linbo"
LINBO_VAR="/var/lib/linuxmuster/linbo"
ENV_FILE="/etc/linbo-native/.env"
RSYNCD_TEMPLATE="/usr/share/linuxmuster/templates/rsyncd.conf"
RSYNCD_CONF="/etc/rsyncd.conf"
RSYNCD_OVERRIDE="/etc/systemd/system/rsync.service.d/override.conf"
RSYNCD_SECRETS="/etc/rsyncd.secrets"

# =============================================================================
# Log functions (SyslogIdentifier=linbo-setup in journald)
# =============================================================================
log_info()  { echo "[linbo-setup] INFO:  $*"; }
log_ok()    { echo "[linbo-setup] OK:    $*"; }
log_error() { echo "[linbo-setup] ERROR: $*" >&2; }
log_warn()  { echo "[linbo-setup] WARN:  $*" >&2; }

# =============================================================================
# Root guard
# =============================================================================
if [[ "$EUID" -ne 0 ]]; then
    log_error "Must run as root"
    exit 1
fi

# =============================================================================
# Sentinel check (idempotency)
# =============================================================================
if [[ -f "$SENTINEL" ]]; then
    log_info "Boot scaffold already done (sentinel: $SENTINEL). Skipping."
    exit 0
fi
log_info "Starting LINBO boot scaffold provisioning..."

# =============================================================================
# Step 1 — Verify linbo7 postinst ran (GRUB netboot, SSH keys, TFTP config)
# =============================================================================
# linuxmuster-linbo7 postinst runs linbo-configure.sh which handles:
#   - GRUB netboot directory (mkgrubnetdir.sh)
#   - Dropbear SSH keys
#   - TFTP config (TFTP_DIRECTORY=/srv/linbo)
#   - tftpd-hpa restart
# We only verify these exist — do NOT re-run (avoids duplicate work).
log_info "Step 1: Verifying linbo7 postinst artifacts..."
if [[ ! -d "$LINBO_DIR/boot/grub/x86_64-efi" ]]; then
    log_warn "GRUB netboot dir missing — running mkgrubnetdir.sh..."
    /usr/share/linuxmuster/linbo/mkgrubnetdir.sh
fi
if [[ ! -f /etc/linuxmuster/linbo/ssh_host_rsa_key ]]; then
    log_warn "SSH keys missing — running linbo-configure.sh..."
    /usr/share/linuxmuster/linbo/linbo-configure.sh
fi
log_ok "linbo7 postinst artifacts verified"

# NOTE: linbo-configure.sh exits early on caching servers (no setup.ini).
# Steps 2-6 handle what it skips: kernel copy, linbofs copy, rsyncd config.

# =============================================================================
# Step 2 — Copy kernel
# =============================================================================
log_info "Step 2: Copying linbo64 kernel (stable)..."
if [[ ! -f "$LINBO_VAR/stable/linbo64" ]]; then
    log_error "Kernel not found at $LINBO_VAR/stable/linbo64"
    exit 1
fi
cp "$LINBO_VAR/stable/linbo64" "$LINBO_DIR/linbo64"
md5sum "$LINBO_DIR/linbo64" | awk '{print $1}' > "$LINBO_DIR/linbo64.md5"
log_ok "linbo64 kernel copied ($(du -sh "$LINBO_DIR/linbo64" | cut -f1))"

# =============================================================================
# Step 3 — Build linbofs64 via update-linbofs (SSH keys, firmware, hooks)
# =============================================================================
log_info "Step 3: Building linbofs64 via update-linbofs..."
# update-linbofs packs the real linbofs64 with SSH host keys, firmware,
# and any pre/post hooks — replaces the raw template copy.
if [[ ! -x /usr/sbin/update-linbofs ]]; then
    log_warn "update-linbofs not found — falling back to template copy"
    if [[ ! -f "$LINBO_VAR/linbofs64.xz" ]]; then
        log_error "linbofs64.xz template not found at $LINBO_VAR/linbofs64.xz"
        exit 1
    fi
    cp "$LINBO_VAR/linbofs64.xz" "$LINBO_DIR/linbofs64"
    md5sum "$LINBO_DIR/linbofs64" | awk '{print $1}' > "$LINBO_DIR/linbofs64.md5"
    log_ok "linbofs64 template copied as fallback ($(du -sh "$LINBO_DIR/linbofs64" | cut -f1))"
else
    /usr/sbin/update-linbofs 2>&1 | while IFS= read -r line; do
        echo "[linbo-setup]   $line"
    done
    if [[ -f "$LINBO_DIR/linbofs64" ]]; then
        log_ok "linbofs64 built successfully ($(du -sh "$LINBO_DIR/linbofs64" | cut -f1))"
    else
        log_error "update-linbofs did not produce $LINBO_DIR/linbofs64"
        exit 1
    fi
fi

# =============================================================================
# Step 4 — rsyncd setup
# =============================================================================
log_info "Step 4: Configuring rsyncd..."

# 4a: rsyncd.conf from template
if [[ ! -f "$RSYNCD_TEMPLATE" ]]; then
    log_error "rsyncd.conf template not found at $RSYNCD_TEMPLATE"
    exit 1
fi
sed "s|@@linbodir@@|${LINBO_DIR}|g" "$RSYNCD_TEMPLATE" > "$RSYNCD_CONF"
log_ok "rsyncd.conf written from template"

# 4b: rsync.service drop-in (ProtectSystem=true — skipped by linbo-configure.sh on caching server)
mkdir -p "$(dirname "$RSYNCD_OVERRIDE")"
cat > "$RSYNCD_OVERRIDE" << 'EOF'
[Service]
ProtectSystem=true
EOF
log_ok "rsync.service drop-in written"

# 4c: rsyncd.secrets (linbo password from .env RSYNC_PASSWORD)
if [[ -f "$ENV_FILE" ]]; then
    rsync_pw=$(grep '^RSYNC_PASSWORD=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' ')
    if [[ -n "$rsync_pw" ]]; then
        echo "linbo:${rsync_pw}" > "$RSYNCD_SECRETS"
        chmod 600 "$RSYNCD_SECRETS"
        log_ok "rsyncd.secrets written (chmod 600)"
    else
        log_warn "RSYNC_PASSWORD not found in $ENV_FILE — rsyncd.secrets not written"
        log_warn "Run setup.sh first, then re-run this script"
    fi
else
    log_warn "$ENV_FILE not found — rsyncd.secrets skipped (run setup.sh first)"
fi

# =============================================================================
# Step 5 — Ensure tftpd-hpa and rsync are enabled
# =============================================================================
log_info "Step 5: Ensuring tftpd-hpa and rsync are active..."
# tftpd-hpa: already started by linbo7 postinst (linbo-configure.sh restarts it)
# rsync: needs enabling on caching server (postinst skips this without setup.ini)
systemctl unmask tftpd-hpa rsync.service 2>/dev/null || true
systemctl daemon-reload
# tftpd-hpa should already be running from postinst — just ensure enabled
if ! systemctl is-enabled tftpd-hpa >/dev/null 2>&1; then
    systemctl enable tftpd-hpa
fi
if ! systemctl is-active tftpd-hpa >/dev/null 2>&1; then
    systemctl start --no-block tftpd-hpa
fi
log_ok "tftpd-hpa active"
# rsync needs explicit enable (postinst exits before rsync setup on caching server)
systemctl enable rsync
systemctl start --no-block rsync
log_ok "rsync enabled and start queued"

# =============================================================================
# Step 6 — Set permissions
# =============================================================================
log_info "Step 6: Setting /srv/linbo permissions..."
# /srv/linbo must be world-readable (755) so tftpd-hpa (runs as tftp user) can read all files
chown -R root:root "$LINBO_DIR"
chmod -R 755 "$LINBO_DIR"
# linbo user needs write access to specific subdirs (commands, GRUB spool pipes, tmp)
for d in linbocmd boot/grub/spool tmp; do
    if [[ -d "$LINBO_DIR/$d" ]]; then
        chown -R linbo:linbo "$LINBO_DIR/$d"
    fi
done
log_ok "Permissions set"

# =============================================================================
# Step 7 — Write sentinel
# =============================================================================
log_info "Step 7: Writing sentinel..."
mkdir -p "$(dirname "$SENTINEL")"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SENTINEL"
log_ok "Sentinel written: $SENTINEL"

log_ok "LINBO boot scaffold provisioning complete."
