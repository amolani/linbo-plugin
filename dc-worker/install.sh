#!/bin/bash
#
# LINBO Docker - DC Worker Installation / Configuration
#
# Installs the DC worker on a linuxmuster.net AD DC, including:
#   - macct-worker.py (Phase 8: Machine Account Repair + Phase 11: Host Provisioning)
#   - 50-linbo-docker-dhcp post-import hook (DHCP next-server redirect)
#
# This script serves dual purpose:
#   - Standalone installer: run directly from the source tree
#   - Post-dpkg configurator: installed as /usr/local/bin/linbo-docker-configure
#     by the linbo-docker-dc-worker .deb package
#
# Usage:
#   sudo ./install.sh [LINBO_DOCKER_IP]
#   sudo ./install.sh --uninstall
#   sudo linbo-docker-configure <LINBO_DOCKER_IP>   # after dpkg install
#
# Examples:
#   sudo ./install.sh 10.0.0.13
#   sudo ./install.sh                  # prompts for IP
#   sudo ./install.sh --uninstall      # removes everything
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Paths
WORKER_BIN="/usr/local/bin/macct-worker.py"
WORKER_CONF="/etc/macct-worker.conf"
WORKER_CONF_EXAMPLE="$SCRIPT_DIR/macct-worker.conf.example"
WORKER_SERVICE="/etc/systemd/system/macct-worker.service"
DHCP_HOOK_DIR="/var/lib/linuxmuster/hooks/device-import.post.d"
DHCP_HOOK="$DHCP_HOOK_DIR/50-linbo-docker-dhcp"
DHCP_CONF="/etc/linbo-docker-dhcp.conf"
DHCP_CONF_EXAMPLE="$SCRIPT_DIR/linbo-docker-dhcp.conf.example"
LOG_DIR="/var/log/macct"
DHCP_LOG="/var/log/linuxmuster/linbo-docker-dhcp.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }
step()  { echo -e "\n${CYAN}==> $*${NC}"; }

# =============================================================================
# Uninstall
# =============================================================================

do_uninstall() {
    echo ""
    echo "=========================================="
    echo "LINBO Docker - DC Worker Uninstall"
    echo "=========================================="
    echo ""

    # Stop and disable service
    if systemctl is-active --quiet macct-worker 2>/dev/null; then
        step "Stopping macct-worker service..."
        systemctl stop macct-worker
        info "Service stopped"
    fi
    if systemctl is-enabled --quiet macct-worker 2>/dev/null; then
        systemctl disable macct-worker
        info "Service disabled"
    fi

    # Remove files
    step "Removing installed files..."
    local files=("$WORKER_BIN" "$WORKER_SERVICE" "$DHCP_HOOK" "$DHCP_CONF")
    for f in "${files[@]}"; do
        if [[ -f "$f" ]]; then
            rm -f "$f"
            info "Removed $f"
        fi
    done

    # Reload systemd
    systemctl daemon-reload 2>/dev/null || true

    # Keep config and logs (user data)
    echo ""
    warn "Preserved (remove manually if desired):"
    [[ -f "$WORKER_CONF" ]] && warn "  Config:   $WORKER_CONF"
    [[ -d "$LOG_DIR" ]]     && warn "  Logs:     $LOG_DIR/"
    [[ -f "$DHCP_LOG" ]]    && warn "  DHCP log: $DHCP_LOG"

    echo ""
    info "Uninstall complete."
    exit 0
}

# =============================================================================
# Pre-flight checks
# =============================================================================

check_prerequisites() {
    step "Step 1: Checking prerequisites"

    # Must be root
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root"
        exit 1
    fi
    info "Running as root"

    # Check if linuxmuster.net server
    if [[ ! -f /etc/linuxmuster/linbo/ssh_host_rsa_key ]]; then
        warn "This doesn't appear to be a linuxmuster.net server"
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        info "linuxmuster.net server detected"
    fi

    # Check Python 3
    if ! command -v python3 &>/dev/null; then
        error "Python 3 is required but not installed"
        exit 1
    fi
    info "Python 3: $(python3 --version 2>&1)"

    # Check/install Python dependencies
    local missing_pkgs=()
    python3 -c "import redis" 2>/dev/null    || missing_pkgs+=("python3-redis")
    python3 -c "import requests" 2>/dev/null || missing_pkgs+=("python3-requests")

    if [[ ${#missing_pkgs[@]} -gt 0 ]]; then
        info "Installing missing packages: ${missing_pkgs[*]}"
        apt-get update -qq
        apt-get install -y "${missing_pkgs[@]}"
        # Fallback: pip
        pip3 install redis requests 2>/dev/null || true
    else
        info "Python dependencies OK (redis, requests)"
    fi
}

# =============================================================================
# Interactive configuration
# =============================================================================

configure_interactively() {
    step "Step 2: Configuration"

    # LINBO Docker IP
    if [[ -z "${LINBO_DOCKER_IP:-}" ]]; then
        read -p "LINBO Docker IP address: " LINBO_DOCKER_IP
        if [[ -z "$LINBO_DOCKER_IP" ]]; then
            error "LINBO Docker IP is required"
            exit 1
        fi
    fi
    info "LINBO Docker IP: $LINBO_DOCKER_IP"

    # API Key
    local default_key="linbo-internal-secret"
    read -p "API Key [$default_key]: " API_KEY
    API_KEY="${API_KEY:-$default_key}"
    info "API Key: ${API_KEY:0:8}..."

    # School
    local default_school="default-school"
    read -p "School [$default_school]: " SCHOOL
    SCHOOL="${SCHOOL:-$default_school}"
    info "School: $SCHOOL"

    # Domain (auto-detect)
    local detected_domain=""
    if command -v samba-tool &>/dev/null; then
        detected_domain=$(samba-tool domain info 127.0.0.1 2>/dev/null \
            | grep -i 'Domain name:' \
            | awk -F: '{print $2}' \
            | tr -d ' ' \
            | tr '[:upper:]' '[:lower:]' || true)
    fi
    local default_domain="${detected_domain:-linuxmuster.lan}"
    read -p "DNS Domain [$default_domain]: " LINBO_DOMAIN
    LINBO_DOMAIN="${LINBO_DOMAIN:-$default_domain}"
    info "Domain: $LINBO_DOMAIN"
}

# =============================================================================
# Connectivity validation
# =============================================================================

validate_connectivity() {
    step "Step 3: Connectivity validation"

    local ok=true

    # Test Redis
    if command -v redis-cli &>/dev/null; then
        if redis-cli -h "$LINBO_DOCKER_IP" -p 6379 ping 2>/dev/null | grep -q PONG; then
            info "Redis: OK (PONG)"
        else
            warn "Redis: NOT reachable at $LINBO_DOCKER_IP:6379"
            ok=false
        fi
    else
        warn "redis-cli not found, skipping Redis test"
    fi

    # Test API
    if command -v curl &>/dev/null; then
        local http_code
        http_code=$(curl -s -o /dev/null -w '%{http_code}' \
            --connect-timeout 5 "http://$LINBO_DOCKER_IP:3000/health" 2>/dev/null || echo "000")
        if [[ "$http_code" == "200" ]]; then
            info "API: OK (HTTP 200)"
        else
            warn "API: NOT reachable at $LINBO_DOCKER_IP:3000 (HTTP $http_code)"
            ok=false
        fi
    else
        warn "curl not found, skipping API test"
    fi

    if [[ "$ok" == "false" ]]; then
        warn "Some connectivity checks failed. The worker may not start correctly."
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# =============================================================================
# Install worker
# =============================================================================

install_worker() {
    step "Step 4: Installing DC Worker"

    # Create log directory
    mkdir -p "$LOG_DIR"
    chmod 755 "$LOG_DIR"
    info "Log directory: $LOG_DIR"

    # Copy worker script
    cp "$SCRIPT_DIR/macct-worker.py" "$WORKER_BIN"
    chmod 755 "$WORKER_BIN"
    info "Installed $WORKER_BIN"

    # Configuration
    local new_conf
    new_conf=$(generate_config)

    if [[ -f "$WORKER_CONF" ]]; then
        info "Existing config found: $WORKER_CONF"

        # Check for missing Phase 11 keys
        local missing_keys=()
        local phase11_keys=(
            "SCHOOL" "DEVICES_CSV_MASTER" "DEVICES_CSV_DELTA"
            "IMPORT_SCRIPT" "PROVISION_LOCK_FILE" "LINBO_DOMAIN"
            "DHCP_VERIFY_FILE" "SAMBA_TOOL_AUTH" "REV_DNS_OCTETS"
            "PROVISION_BATCH_SIZE" "PROVISION_DEBOUNCE_SEC"
        )

        for key in "${phase11_keys[@]}"; do
            if ! grep -q "^${key}=" "$WORKER_CONF"; then
                missing_keys+=("$key")
            fi
        done

        if [[ ${#missing_keys[@]} -gt 0 ]]; then
            warn "Existing config is missing ${#missing_keys[@]} Phase 11 variables:"
            for key in "${missing_keys[@]}"; do
                # Extract default value from generated config
                local default_val
                default_val=$(echo "$new_conf" | grep "^${key}=" | head -1 || echo "${key}=")
                warn "  $default_val"
            done
            echo ""
            warn "Add these to $WORKER_CONF manually, or remove it and re-run install."
        else
            info "Config has all required keys"
        fi

        # Show diff if content differs (ignoring comments/timestamps)
        local tmp_new="/tmp/macct-worker.conf.new.$$"
        echo "$new_conf" > "$tmp_new"
        if ! diff -q <(grep -v '^#' "$WORKER_CONF" | grep -v '^$' | sort) \
                      <(grep -v '^#' "$tmp_new" | grep -v '^$' | sort) &>/dev/null; then
            info "Config diff (existing vs. new template):"
            diff --color=auto -u "$WORKER_CONF" "$tmp_new" || true
        fi
        rm -f "$tmp_new"
    else
        echo "$new_conf" > "$WORKER_CONF"
        chmod 600 "$WORKER_CONF"
        info "Created $WORKER_CONF"
    fi

    # Install systemd service
    cp "$SCRIPT_DIR/macct-worker.service" "$WORKER_SERVICE"
    systemctl daemon-reload
    info "Installed systemd service"
}

generate_config() {
    cat << CONF
# LINBO Docker DC Worker Configuration
# Generated by install.sh on $(date)
#
# Phase 8: Machine Account Repair
# Phase 11: Host Provisioning

# =============================================================================
# Connection (LINBO Docker)
# =============================================================================

# Redis connection
REDIS_HOST=$LINBO_DOCKER_IP
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# LINBO API connection
API_URL=http://$LINBO_DOCKER_IP:3000/api/v1
API_KEY=$API_KEY

# Consumer identification (should be unique per worker)
CONSUMER_NAME=$(hostname)

# Log directory
LOG_DIR=$LOG_DIR

# =============================================================================
# Phase 8: Machine Account Repair
# =============================================================================

# Path to repair_macct.py script
REPAIR_SCRIPT=/usr/share/linuxmuster/linbo/repair_macct.py

# =============================================================================
# Phase 11: Host Provisioning
# =============================================================================

# Multi-school support: {school} placeholder in paths
SCHOOL=$SCHOOL
DEVICES_CSV_MASTER=/etc/linuxmuster/sophomorix/{school}/devices.csv
DEVICES_CSV_DELTA=/etc/linuxmuster/sophomorix/{school}/linbo-docker.devices.csv
IMPORT_SCRIPT=/usr/sbin/linuxmuster-import-devices
PROVISION_LOCK_FILE=/var/lock/linbo-provision.lock

# DNS domain for verify checks ('auto' = detect from Samba)
LINBO_DOMAIN=$LINBO_DOMAIN

# DHCP verify file (leave empty to skip DHCP verify)
DHCP_VERIFY_FILE=/etc/dhcp/devices/{school}.conf

# Samba auth for explicit AD/DNS cleanup on host delete
# Empty = skip explicit cleanup, only warn if import-devices didn't remove
SAMBA_TOOL_AUTH=
# Examples:
# SAMBA_TOOL_AUTH=-U administrator%secret
# SAMBA_TOOL_AUTH=--use-kerberos=required

# Reverse DNS zone octets (3 = /24, 2 = /16)
REV_DNS_OCTETS=3

# Batching: max hosts per import-devices run + debounce window
PROVISION_BATCH_SIZE=50
PROVISION_DEBOUNCE_SEC=5

# NOTE: Dry-run is controlled by API (DC_PROVISIONING_DRYRUN env in docker-compose.yml)
# Worker reads dryRun from Operation.options - no separate Worker ENV needed
CONF
}

# =============================================================================
# Install DHCP hook
# =============================================================================

install_dhcp_hook() {
    step "Step 5: Installing DHCP post-import hook"

    # Create hook directory if missing
    mkdir -p "$DHCP_HOOK_DIR"

    # Copy hook script
    if [[ -f "$SCRIPT_DIR/50-linbo-docker-dhcp" ]]; then
        cp "$SCRIPT_DIR/50-linbo-docker-dhcp" "$DHCP_HOOK"
        chmod 755 "$DHCP_HOOK"
        info "Installed $DHCP_HOOK"
    else
        warn "Hook script not found: $SCRIPT_DIR/50-linbo-docker-dhcp"
        warn "DHCP redirect will not work until you install it manually"
        return
    fi

    # Create DHCP hook config
    if [[ -f "$DHCP_CONF" ]]; then
        info "DHCP config already exists: $DHCP_CONF"
        # Check if IP matches
        local existing_ip
        existing_ip=$(grep '^LINBO_DOCKER_IP=' "$DHCP_CONF" 2>/dev/null | cut -d= -f2 || true)
        if [[ -n "$existing_ip" && "$existing_ip" != "$LINBO_DOCKER_IP" ]]; then
            warn "DHCP config has IP=$existing_ip but you specified $LINBO_DOCKER_IP"
            warn "Update $DHCP_CONF manually if needed"
        fi
    else
        cat > "$DHCP_CONF" << DHCPCONF
# LINBO Docker DHCP Redirect Configuration
# Used by post-import hook: 50-linbo-docker-dhcp
# Generated by install.sh on $(date)

LINBO_DOCKER_IP=$LINBO_DOCKER_IP
SCHOOL=$SCHOOL
DELTA_CSV=/etc/linuxmuster/sophomorix/{school}/linbo-docker.devices.csv
DEVICES_DHCP=/etc/dhcp/devices/{school}.conf
LOGFILE=/var/log/linuxmuster/linbo-docker-dhcp.log
DHCPCONF
        chmod 644 "$DHCP_CONF"
        info "Created $DHCP_CONF"
    fi

    # Create log directory for DHCP hook
    mkdir -p /var/log/linuxmuster
    info "DHCP log: $DHCP_LOG"
}

# =============================================================================
# Enable service + summary
# =============================================================================

finish_install() {
    step "Step 6: Enabling service"

    systemctl enable macct-worker
    info "Service enabled (macct-worker)"

    echo ""
    echo "=========================================="
    echo -e "${GREEN}Installation complete!${NC}"
    echo "=========================================="
    echo ""
    echo "Installed components:"
    echo "  Worker:     $WORKER_BIN"
    echo "  Config:     $WORKER_CONF"
    echo "  Service:    macct-worker.service"
    echo "  DHCP hook:  $DHCP_HOOK"
    echo "  DHCP conf:  $DHCP_CONF"
    echo "  Logs:       $LOG_DIR/"
    echo ""
    echo "Commands:"
    echo "  Start:      systemctl start macct-worker"
    echo "  Stop:       systemctl stop macct-worker"
    echo "  Status:     systemctl status macct-worker"
    echo "  Logs:       journalctl -u macct-worker -f"
    echo "  DHCP log:   tail -f $DHCP_LOG"
    echo ""
    echo "Verification:"
    echo "  Redis:      redis-cli -h $LINBO_DOCKER_IP ping"
    echo "  API:        curl http://$LINBO_DOCKER_IP:3000/health"
    echo "  DHCP hook:  $DHCP_HOOK -s $SCHOOL"
    echo ""
    echo "To start the worker:"
    echo "  systemctl start macct-worker"
    echo ""
}

# =============================================================================
# Main
# =============================================================================

main() {
    # Parse arguments
    LINBO_DOCKER_IP="${1:-}"

    if [[ "$LINBO_DOCKER_IP" == "--uninstall" || "$LINBO_DOCKER_IP" == "-u" ]]; then
        # Must be root for uninstall too
        if [[ $EUID -ne 0 ]]; then
            error "This script must be run as root"
            exit 1
        fi
        do_uninstall
    fi

    echo ""
    echo "=========================================="
    echo "LINBO Docker - DC Worker Installation"
    echo "=========================================="
    echo "  Phase 8:  Machine Account Repair"
    echo "  Phase 11: Host Provisioning"
    echo "  DHCP:     next-server redirect hook"
    echo "=========================================="

    check_prerequisites
    configure_interactively
    validate_connectivity
    install_worker
    install_dhcp_hook
    finish_install
}

main "$@"
