#!/bin/bash
# LINBO Native - Install Script
# Installs all system dependencies on Ubuntu 24.04 LTS
# Usage: sudo ./install.sh
# Idempotent: safe to run multiple times
set -euo pipefail

# =============================================================================
# Colors & helpers
# =============================================================================
if [[ -t 1 ]] && command -v tput &>/dev/null && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_ok()    { echo -e "  ${GREEN}[OK]${NC}    $1"; }
log_fail()  { echo -e "  ${RED}[FAIL]${NC}  $1"; }

# =============================================================================
# Banner
# =============================================================================
print_banner() {
    echo ""
    echo -e "${BLUE}+--------------------------------------------------+${NC}"
    echo -e "${BLUE}|         LINBO Native - Install Script             |${NC}"
    echo -e "${BLUE}|     System Dependencies for Ubuntu 24.04 LTS      |${NC}"
    echo -e "${BLUE}+--------------------------------------------------+${NC}"
    echo ""
}

# =============================================================================
# Root check
# =============================================================================
check_root() {
    if [[ "$EUID" -ne 0 ]]; then
        log_error "This script must be run as root. Use: sudo ./install.sh"
        exit 1
    fi
}

# =============================================================================
# Idempotent package check
# =============================================================================
is_installed() {
    dpkg -l "$1" 2>/dev/null | grep -q '^ii'
}

# =============================================================================
# Add LMN APT repository (idempotent)
# =============================================================================
add_lmn_repo() {
    local KEYRING="/usr/share/keyrings/linuxmuster.net.gpg"
    local SOURCES="/etc/apt/sources.list.d/lmn73.list"

    if [[ -f "$KEYRING" && -f "$SOURCES" ]]; then
        log_ok "LMN APT repo already configured"
        return 0
    fi

    log_info "Adding LMN APT repo..."
    wget -qO- "https://deb.linuxmuster.net/pub.gpg" \
        | gpg --dearmor -o "$KEYRING"

    if [[ ! -f "$KEYRING" ]]; then
        log_error "Failed to import LMN APT GPG key to $KEYRING"
        exit 1
    fi

    # signed-by=/usr/share/keyrings/linuxmuster.net.gpg — modern APT keyring pattern
    echo "deb [arch=amd64 signed-by=${KEYRING}] https://deb.linuxmuster.net/ lmn73 main" \
        > "$SOURCES"
    log_ok "LMN APT repo added"
}

# =============================================================================
# Add NodeSource Node.js 20 repository (idempotent)
# =============================================================================
add_nodesource_repo() {
    if node --version 2>/dev/null | grep -q '^v20\.'; then
        log_ok "Node.js 20 already installed ($(node --version))"
        return 0
    fi

    log_info "Adding NodeSource Node.js 20 repo..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    log_ok "NodeSource repo added"
}

# =============================================================================
# Install packages (idempotent)
# =============================================================================
install_packages() {
    log_info "Installing system dependencies..."
    echo ""

    # --- Prerequisites for repo setup ---
    log_info "Ensuring base tools..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q \
        curl gnupg ca-certificates wget >/dev/null
    log_ok "Base tools (curl, gnupg, ca-certificates, wget)"

    # --- Add APT repositories ---
    add_lmn_repo
    add_nodesource_repo

    # --- Update package lists ---
    log_info "Updating package lists..."
    DEBIAN_FRONTEND=noninteractive apt-get update -q >/dev/null 2>&1
    log_ok "Package lists updated"

    # --- Install packages with idempotency guards ---
    echo ""
    log_info "Installing packages..."

    # Node.js (brings npm)
    if ! is_installed nodejs; then
        log_info "Installing nodejs..."
        DEBIAN_FRONTEND=noninteractive apt-get install -y -q nodejs >/dev/null
        log_ok "nodejs $(node --version) installed"
    else
        log_ok "nodejs already installed ($(node --version))"
    fi

    # nginx
    if ! is_installed nginx; then
        log_info "Installing nginx..."
        DEBIAN_FRONTEND=noninteractive apt-get install -y -q nginx >/dev/null
        log_ok "nginx installed"
    else
        log_ok "nginx already installed"
    fi

    # linuxmuster-linbo7 — brings tftpd-hpa, rsync, grub, ssh, dropbear as dependencies
    # NOTE: linuxmuster-common pulls linuxmuster-base7/tools7/webui7 which may fail
    # on a caching server (missing LMN setup). linbo7 itself installs fine — we check
    # for it explicitly and ignore errors from unrelated LMN packages.
    if ! is_installed linuxmuster-linbo7; then
        log_info "Installing linuxmuster-linbo7 (includes tftpd-hpa, rsync, grub, ssh)..."
        DEBIAN_FRONTEND=noninteractive apt-get install -y -q linuxmuster-linbo7 2>&1 || true
        # Repair any packages left in half-configured state (linuxmuster-base7 postinst may fail on caching servers)
        DEBIAN_FRONTEND=noninteractive dpkg --configure -a 2>/dev/null || true
        if is_installed linuxmuster-linbo7; then
            log_ok "linuxmuster-linbo7 installed"
        else
            log_error "linuxmuster-linbo7 installation failed"
            exit 1
        fi
    else
        log_ok "linuxmuster-linbo7 already installed"
    fi

    # isc-dhcp-server — NOT a linbo7 dependency, must install separately
    # Disable immediately to prevent startup with empty dhcpd.conf
    if ! is_installed isc-dhcp-server; then
        log_info "Installing isc-dhcp-server..."
        DEBIAN_FRONTEND=noninteractive apt-get install -y -q isc-dhcp-server >/dev/null
        systemctl disable isc-dhcp-server 2>/dev/null || true
        systemctl stop isc-dhcp-server 2>/dev/null || true
        log_ok "isc-dhcp-server installed (disabled — setup-dhcp.sh configures and enables it)"
    else
        systemctl disable isc-dhcp-server 2>/dev/null || true
        log_ok "isc-dhcp-server already installed (disabled)"
    fi

    # openssl
    if ! is_installed openssl; then
        log_info "Installing openssl..."
        DEBIAN_FRONTEND=noninteractive apt-get install -y -q openssl >/dev/null
        log_ok "openssl installed"
    else
        log_ok "openssl already installed"
    fi

    # jq
    if ! is_installed jq; then
        log_info "Installing jq..."
        DEBIAN_FRONTEND=noninteractive apt-get install -y -q jq >/dev/null
        log_ok "jq installed"
    else
        log_ok "jq already installed"
    fi

    echo ""
}

# =============================================================================
# Clean Docker/iptables residue
# =============================================================================
clean_docker_firewall_residue() {
    # If Docker was previously installed, it leaves iptables/nftables chains
    # that can block DHCP, TFTP, and rsync traffic. Clean them up.
    if iptables -L DOCKER -n &>/dev/null || nft list table ip docker &>/dev/null; then
        log_info "Cleaning Docker firewall residue..."

        # Remove Docker iptables chains
        for chain in DOCKER DOCKER-ISOLATION-STAGE-1 DOCKER-ISOLATION-STAGE-2 DOCKER-USER; do
            iptables -F "$chain" 2>/dev/null || true
            iptables -X "$chain" 2>/dev/null || true
        done

        # Remove Docker FORWARD rules referencing docker0
        iptables -D FORWARD -o docker0 -j DOCKER 2>/dev/null || true
        iptables -D FORWARD -o docker0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
        iptables -D FORWARD -i docker0 ! -o docker0 -j ACCEPT 2>/dev/null || true
        iptables -D FORWARD -i docker0 -o docker0 -j ACCEPT 2>/dev/null || true

        # Remove Docker NAT rules
        iptables -t nat -F DOCKER 2>/dev/null || true
        iptables -t nat -X DOCKER 2>/dev/null || true
        iptables -t nat -D PREROUTING -m addrtype --dst-type LOCAL -j DOCKER 2>/dev/null || true
        iptables -t nat -D OUTPUT -m addrtype --dst-type LOCAL -j DOCKER 2>/dev/null || true

        # Delete Docker-created nftables tables only (never flush the entire ruleset)
        if command -v nft &>/dev/null; then
            for table in $(nft list tables 2>/dev/null | grep -i docker | awk '{print $3}'); do
                nft delete table ip "$table" 2>/dev/null || true
            done
        fi

        # Ensure FORWARD policy is ACCEPT (Docker sets it to DROP)
        iptables -P FORWARD ACCEPT 2>/dev/null || true

        log_ok "Docker firewall residue cleaned"
    else
        log_ok "No Docker firewall residue detected"
    fi
}

# =============================================================================
# Main
# =============================================================================
main() {
    print_banner
    check_root
    clean_docker_firewall_residue
    install_packages

    echo -e "${GREEN}+--------------------------------------------------+${NC}"
    echo -e "${GREEN}|           Installation Complete                   |${NC}"
    echo -e "${GREEN}+--------------------------------------------------+${NC}"
    echo ""
    echo "  All system dependencies have been installed."
    echo "  Next step: run ./setup.sh to configure the service."
    echo ""
}

main "$@"
