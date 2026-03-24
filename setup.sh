#!/bin/bash
# LINBO Native - Setup Wizard
# Configures the native host environment: directories, .env, systemd enable
# Usage: sudo ./setup.sh
# Re-run to update configuration.

set -euo pipefail

# Prevent concurrent setup.sh runs
LOCK_FILE="/var/run/linbo-setup.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "ERROR: Another setup.sh instance is already running. Exiting."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# =============================================================================
# Colors & helpers
# =============================================================================
if [[ -t 1 ]] && command -v tput &>/dev/null && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

INTERACTIVE=false
[[ -t 0 ]] && INTERACTIVE=true

log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_ok()    { echo -e "  ${GREEN}[OK]${NC}    $1"; }
log_fail()  { echo -e "  ${RED}[FAIL]${NC}  $1"; }

# Trap Ctrl+C / SIGTERM so the user knows to re-run
trap 'echo ""; log_error "Setup interrupted. System may be in inconsistent state. Re-run setup.sh to complete."; exit 130' INT TERM

# =============================================================================
# Banner
# =============================================================================
print_banner() {
    echo ""
    echo -e "${BLUE}+--------------------------------------------------+${NC}"
    echo -e "${BLUE}|        LINBO Native - Setup Wizard                |${NC}"
    echo -e "${BLUE}|  Native Caching Server for linuxmuster.net        |${NC}"
    echo -e "${BLUE}+--------------------------------------------------+${NC}"
    echo ""
}

# =============================================================================
# 1. Prerequisite checks
# =============================================================================
PREREQ_FAILED=0

check_prereq() {
    local name="$1" check="$2" fix="$3"
    if eval "$check" &>/dev/null; then
        log_ok "$name"
        return 0
    fi
    log_fail "$name — $fix"
    PREREQ_FAILED=$((PREREQ_FAILED + 1))
    return 0
}

run_prerequisites() {
    echo "Checking prerequisites..."
    echo ""
    check_prereq "Root privileges" "[[ \$EUID -eq 0 ]]" "Run as root: sudo ./setup.sh"
    check_prereq "Node.js 20" "node --version 2>/dev/null | grep -q '^v20\.'" "Run ./install.sh first"
    check_prereq "nginx" "command -v nginx" "Run ./install.sh first"
    check_prereq "openssl" "command -v openssl" "Run ./install.sh first"
    check_prereq "curl" "command -v curl" "Run ./install.sh first"
    check_prereq "jq" "command -v jq" "Run ./install.sh first"
    check_prereq "ssh-keygen" "command -v ssh-keygen" "Install openssh-client: apt install openssh-client"

    # Disk space (2GB minimum)
    local avail_kb
    avail_kb=$(df -P /srv 2>/dev/null | awk 'NR==2{print $4}' || df -P / | awk 'NR==2{print $4}')
    if [[ "$avail_kb" -ge 2097152 ]]; then
        log_ok "Disk space ($(awk "BEGIN{printf \"%.1f\", $avail_kb/1048576}")GB available)"
    else
        log_fail "Disk space — need at least 2GB"
        PREREQ_FAILED=$((PREREQ_FAILED + 1))
    fi

    echo ""
    if [[ "$PREREQ_FAILED" -gt 0 ]]; then
        log_error "$PREREQ_FAILED check(s) failed. Run ./install.sh first."
        exit 1
    fi
    log_info "All prerequisites passed"
}

# =============================================================================
# 2. Port conflict check
# =============================================================================
PORT_WARNINGS=0

check_ports() {
    echo ""
    echo "Checking ports..."
    echo ""

    for spec in "69:udp:TFTP" "873:tcp:rsync" "80:tcp:nginx" "3000:tcp:API" "67:udp:DHCP"; do
        IFS=: read -r port proto svc <<< "$spec"
        local flag=$([[ "$proto" == "tcp" ]] && echo "-tlnp" || echo "-ulnp")
        if ss "$flag" sport = :"$port" 2>/dev/null | grep -q ":${port}"; then
            local proc
            proc=$(ss "$flag" sport = :"$port" 2>/dev/null | grep -oP 'users:\(\("\K[^"]+' | head -1)
            log_warn "$svc port $port/$proto in use by '${proc:-unknown}'"
            PORT_WARNINGS=$((PORT_WARNINGS + 1))
        else
            log_ok "$svc port $port/$proto available"
        fi
    done

    echo ""
}

# =============================================================================
# 3. Detect own IP
# =============================================================================
detect_own_ip() {
    local ip
    ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
    [[ -z "$ip" ]] && ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    echo "${ip:-127.0.0.1}"
}

# =============================================================================
# 4. LMN Server connection + Auto-Discovery
# =============================================================================

# Global variables filled by auto-discovery
LMN_SERVER_IP=""
LMN_API_URL=""
LMN_API_USER=""
LMN_API_PASSWORD=""
LMN_SCHOOL="default-school"
LINBO_DOMAIN=""
LINBO_GATEWAY=""
LINBO_DNS=""
LINBO_HOSTNAME=""
SYNC_ENABLED="false"
LINBO_SUBNET=""
LINBO_NETMASK=""
DHCP_INTERFACE=""
admin_pw=""

prompt_lmn_connection() {
    echo ""
    echo -e "${BOLD}LMN Server Connection${NC}"
    echo "  LINBO Native connects to your linuxmuster.net server to auto-configure"
    echo "  network settings, DHCP, and sync host/image data."
    echo ""

    if [[ "$INTERACTIVE" != "true" ]]; then
        log_info "Non-interactive: skipping LMN connection (configure .env manually)"
        return 0
    fi

    local enable
    read -p "Connect to LMN server? [Y/n]: " enable
    if [[ "$enable" =~ ^[Nn] ]]; then
        log_info "Offline mode. You'll need to configure network settings in .env manually."
        return 0
    fi

    # --- LMN Server IP ---
    local default_lmn_ip="10.0.0.1"
    read -p "LMN Server IP [${default_lmn_ip}]: " input_ip
    LMN_SERVER_IP="${input_ip:-$default_lmn_ip}"
    LMN_API_URL="https://${LMN_SERVER_IP}:8001"

    # --- Credentials ---
    LMN_API_USER="global-admin"
    read -sp "LMN API Password (global-admin): " LMN_API_PASSWORD
    echo ""

    if [[ -z "$LMN_API_PASSWORD" ]]; then
        log_error "Password is required."
        exit 1
    fi

    # --- Test connection + get JWT token ---
    echo ""
    log_info "Connecting to ${LMN_API_URL}..."

    local token
    token=$(curl -sk "${LMN_API_URL}/v1/auth/" \
        -u "${LMN_API_USER}:${LMN_API_PASSWORD}" \
        --max-time 10 2>/dev/null | tr -d '"')

    if [[ -z "$token" || "$token" == *"Wrong credentials"* || "$token" == *"detail"* ]]; then
        log_error "Authentication failed. Check IP and password."
        exit 1
    fi
    log_ok "Authenticated"

    # --- Auto-discover server info ---
    local server_info
    server_info=$(curl -sk -H "X-API-Key: $token" \
        "${LMN_API_URL}/v1/linbo/server-info" \
        --max-time 10 2>/dev/null)

    if [[ -z "$server_info" || "$server_info" == *"detail"* ]]; then
        log_warn "server-info endpoint not available. Manual configuration required."
        log_warn "You may need to update the LINBO router on your LMN server."
        prompt_manual_network
        return 0
    fi

    # Parse server-info JSON
    LINBO_DOMAIN=$(echo "$server_info" | jq -r '.domainname // empty')
    LINBO_GATEWAY=$(echo "$server_info" | jq -r '.gateway // empty')
    LINBO_DNS="${LMN_SERVER_IP}"  # DNS is usually the LMN server
    local network netmask
    network=$(echo "$server_info" | jq -r '.network // empty')
    netmask=$(echo "$server_info" | jq -r '.netmask // empty')

    log_ok "Domain:    ${LINBO_DOMAIN}"
    log_ok "Gateway:   ${LINBO_GATEWAY}"
    log_ok "DNS:       ${LINBO_DNS}"
    log_ok "Network:   ${network}/${netmask}"

    # --- School selection ---
    local schools_json
    schools_json=$(echo "$server_info" | jq -r '.schools[]' 2>/dev/null)
    local school_count
    school_count=$(echo "$server_info" | jq -r '.schools | length' 2>/dev/null || echo "0")

    echo ""
    if [[ "$school_count" -eq 0 ]]; then
        log_warn "No schools found. Using 'default-school'."
        LMN_SCHOOL="default-school"
    elif [[ "$school_count" -eq 1 ]]; then
        LMN_SCHOOL=$(echo "$server_info" | jq -r '.schools[0]')
        log_ok "School:    ${LMN_SCHOOL} (only school)"
    else
        echo -e "  ${BOLD}Available schools:${NC}"
        local idx=1
        while IFS= read -r school; do
            echo "    ${idx}) ${school}"
            idx=$((idx + 1))
        done <<< "$schools_json"
        echo ""
        read -p "  Select school [1]: " school_choice
        school_choice="${school_choice:-1}"
        LMN_SCHOOL=$(echo "$server_info" | jq -r ".schools[$((school_choice - 1))] // .schools[0]")
        log_ok "School:    ${LMN_SCHOOL}"
    fi

    SYNC_ENABLED="true"

    # Store network/netmask for .env
    LINBO_SUBNET="${network}"
    LINBO_NETMASK="${netmask}"
}

prompt_manual_network() {
    echo ""
    echo "Manual network configuration:"
    local val

    read -p "Domain name [linuxmuster.lan]: " val
    LINBO_DOMAIN="${val:-linuxmuster.lan}"

    read -p "Gateway [10.0.0.254]: " val
    LINBO_GATEWAY="${val:-10.0.0.254}"

    read -p "DNS Server [${LMN_SERVER_IP}]: " val
    LINBO_DNS="${val:-$LMN_SERVER_IP}"

    read -p "School name [default-school]: " val
    LMN_SCHOOL="${val:-default-school}"

    SYNC_ENABLED="true"
}

# =============================================================================
# 4b. DHCP Interface
# =============================================================================
prompt_dhcp_interface() {
    echo ""
    # Auto-detect the primary non-loopback interface
    local detected_iface
    detected_iface=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -1)
    detected_iface="${detected_iface:-eth0}"

    if [[ "$INTERACTIVE" == "true" ]]; then
        echo -e "${BOLD}DHCP Interface${NC}"
        echo "  The network interface isc-dhcp-server will listen on."
        echo "  Leave empty to listen on all interfaces."
        echo ""
        local iface_input
        read -p "DHCP interface [${detected_iface}]: " iface_input
        DHCP_INTERFACE="${iface_input:-$detected_iface}"
    else
        DHCP_INTERFACE="$detected_iface"
    fi
    log_ok "DHCP interface: ${DHCP_INTERFACE}"
}

# =============================================================================
# 5. Server Identity
# =============================================================================
prompt_server_identity() {
    echo ""
    local detected_ip
    detected_ip=$(detect_own_ip)

    echo -e "${BOLD}Server Identity${NC}"
    echo "  This is the IP and hostname that DHCP clients will see."
    echo ""

    # Show interfaces
    while IFS= read -r line; do
        local iface addr
        iface=$(echo "$line" | awk '{print $NF}')
        addr=$(echo "$line" | awk '{print $2}' | cut -d/ -f1)
        if [[ "$addr" != "127.0.0.1" ]]; then
            if [[ "$addr" == "$detected_ip" ]]; then
                echo -e "  ${GREEN}*${NC} $addr ($iface)"
            else
                echo "    $addr ($iface)"
            fi
        fi
    done < <(ip -4 addr show 2>/dev/null | grep 'inet ' || true)

    echo ""
    if [[ "$INTERACTIVE" == "true" ]]; then
        local ip_input
        read -p "Server IP [${detected_ip}]: " ip_input
        LINBO_SERVER_IP="${ip_input:-$detected_ip}"
    else
        LINBO_SERVER_IP="$detected_ip"
    fi

    # Hostname
    local detected_hostname
    detected_hostname=$(hostname -s 2>/dev/null || echo "linbo-native")
    if [[ "$INTERACTIVE" == "true" ]]; then
        read -p "DHCP hostname [${detected_hostname}]: " hn_input
        LINBO_HOSTNAME="${hn_input:-$detected_hostname}"
    else
        LINBO_HOSTNAME="$detected_hostname"
    fi

    log_ok "Server IP:  ${LINBO_SERVER_IP}"
    log_ok "Hostname:   ${LINBO_HOSTNAME}"
}

# =============================================================================
# 6. Secrets
# =============================================================================
generate_secret() {
    local type="$1"
    if command -v openssl &>/dev/null; then
        case "$type" in
            jwt)      openssl rand -base64 48 | tr -d '\n' ;;
            api_key)  openssl rand -hex 32 ;;
            password) openssl rand -base64 24 | tr -d '\n/+=' | head -c 32 ;;
        esac
    else
        case "$type" in
            jwt)      head -c 48 /dev/urandom | base64 | tr -d '\n' ;;
            api_key)  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' ;;
            password) head -c 24 /dev/urandom | base64 | tr -d '\n/+=' | head -c 32 ;;
        esac
    fi
}

# =============================================================================
# 7. Directory setup
# =============================================================================
setup_directories() {
    log_info "Creating directories..."
    local dirs=(/srv/linbo-api /var/lib/linbo-api /var/log/linbo-native)
    for d in "${dirs[@]}"; do
        mkdir -p "$d"
        chown root:root "$d"
        chmod 755 "$d"
        log_ok "Directory: $d"
    done
    mkdir -p /etc/linbo-native
    chown root:root /etc/linbo-native
    chmod 700 /etc/linbo-native
    log_ok "Directory: /etc/linbo-native (mode 700)"
}

# =============================================================================
# linbo system user (Phase 2: required by linbo-api.service User=linbo)
# =============================================================================
create_linbo_user() {
    log_info "Configuring linbo system user..."

    if ! id linbo &>/dev/null; then
        useradd \
            --system \
            --no-create-home \
            --shell /usr/sbin/nologin \
            --comment "LINBO API service account" \
            --home-dir /srv/linbo-api \
            linbo
        log_ok "Created system user: linbo"
    else
        log_ok "System user linbo already exists (uid: $(id -u linbo))"
    fi

    # linbo-api.service runs as linbo — needs write access to its working directory
    chown -R linbo:linbo /srv/linbo-api
    log_ok "Ownership set: /srv/linbo-api (linbo:linbo)"

    # Sophomorix dir for devices.csv (written by sync service in LMN standard path)
    if [[ -d /etc/linuxmuster/sophomorix ]]; then
        chown -R linbo:linbo /etc/linuxmuster/sophomorix
        log_ok "Ownership set: /etc/linuxmuster/sophomorix (linbo:linbo)"
    fi

    # /srv/linbo is created by linuxmuster-linbo7 APT install — grant linbo write to specific subdirs
    # (Full /srv/linbo stays root:root 755 so tftpd-hpa tftp user can read all files)
    if [[ -d /srv/linbo ]]; then
        for d in linbocmd boot/grub/spool tmp; do
            if [[ -d "/srv/linbo/$d" ]]; then
                chown -R linbo:linbo "/srv/linbo/$d"
                log_ok "Ownership set: /srv/linbo/$d (linbo:linbo)"
            fi
        done
    else
        log_info "/srv/linbo not yet present — setup-bootfiles.sh will set permissions after APT install"
    fi

    # /var/lib/linbo — drivers directory (patchclass profiles)
    if [[ -d /var/lib/linbo ]]; then
        chown -R linbo:linbo /var/lib/linbo
        log_ok "Ownership set: /var/lib/linbo (linbo:linbo)"
    else
        mkdir -p /var/lib/linbo/drivers
        chown -R linbo:linbo /var/lib/linbo
        log_ok "Created: /var/lib/linbo/drivers (linbo:linbo)"
    fi
}

# =============================================================================
# SSH Key: ensure /root/.ssh/id_rsa exists and is readable by linbo user
# =============================================================================
_ensure_linbo_ssh_key() {
    log_info "Configuring SSH client key for LINBO..."

    local key_path="/root/.ssh/id_rsa"

    # Remove if it is a directory (broken setup artifact)
    if [ -d "$key_path" ]; then
        log_warn "$key_path is a directory — removing and regenerating"
        rm -rf "$key_path" "${key_path}.pub"
    fi

    # Generate if missing (same as linuxmuster-setup does)
    if [ ! -f "$key_path" ]; then
        log_info "Generating SSH client key..."
        mkdir -p /root/.ssh
        chmod 700 /root/.ssh
        ssh-keygen -m PEM -t rsa -b 3072 -N "" -f "$key_path" -q
        log_ok "Generated: $key_path"
    else
        log_ok "Existing key: $key_path"
    fi

    # Keep original at 600 root:root (SSH standard requires this)
    chmod 600 "$key_path"
    chown root:root "$key_path"

    # Copy to /etc/linuxmuster/linbo/ (native LMN SSH config directory)
    # API runs as linbo user and needs read access — original stays secure
    local api_key="/etc/linuxmuster/linbo/ssh_host_rsa_key_client"
    cp "$key_path" "$api_key"
    chown root:linbo "$api_key"
    chmod 640 "$api_key"
    log_ok "SSH key: $key_path (600) + API copy: $api_key (640 root:linbo)"

    # Grant linbo group write access to /etc/linuxmuster/linbo/ for kernel state, rebuild locks
    chown root:linbo /etc/linuxmuster/linbo
    chmod 755 /etc/linuxmuster/linbo
    log_ok "Permissions set: /etc/linuxmuster/linbo (755 root:linbo)"
}

# =============================================================================
# 8. Existing .env handling
# =============================================================================
handle_existing_env() {
    local env_file="/etc/linbo-native/.env"
    if [[ -f "$env_file" ]]; then
        local modified
        modified=$(stat -c '%y' "$env_file" 2>/dev/null | cut -d. -f1 || echo "unknown")
        echo ""
        log_warn "Existing .env found (${modified})"
        if [[ "$INTERACTIVE" == "true" ]]; then
            read -p "Back up and overwrite? [Y/n]: " confirm
            if [[ "$confirm" =~ ^[Nn] ]]; then
                log_info "Keeping existing .env. Exiting."
                exit 0
            fi
        fi
        cp "$env_file" "${env_file}.backup.$(date +%Y%m%d-%H%M%S)"
        log_info "Backed up existing .env"
    fi
}

# =============================================================================
# 9. Assert no Docker variables leaked into .env
# =============================================================================
assert_no_docker_vars() {
    local env_file="$1"
    local forbidden=("DOCKER_GID" "REDIS_HOST" "REDIS_URL" "REDIS_PASSWORD")
    local found=0
    for var in "${forbidden[@]}"; do
        if grep -q "^${var}=" "$env_file"; then
            log_fail ".env contains forbidden Docker variable: $var"
            found=$((found + 1))
        fi
    done
    [[ "$found" -gt 0 ]] && exit 1
    log_ok ".env is clean (no Docker-specific variables)"
}

# =============================================================================
# 10. Write .env
# =============================================================================
write_env() {
    local env_file="/etc/linbo-native/.env"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Preserve existing secrets on re-run (avoids JWT invalidation)
    local jwt_secret="" internal_key="" rsync_pw=""
    admin_pw=""
    if [[ -f "$env_file" ]]; then
        jwt_secret=$(grep '^JWT_SECRET=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' || true)
        internal_key=$(grep '^INTERNAL_API_KEY=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' || true)
        rsync_pw=$(grep '^RSYNC_PASSWORD=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' || true)
        admin_pw=$(grep '^ADMIN_PASSWORD=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' || true)
    fi
    # Generate only if not already set (fresh install or missing values)
    [[ -z "$jwt_secret" ]] && jwt_secret=$(generate_secret jwt)
    [[ -z "$internal_key" ]] && internal_key=$(generate_secret api_key)
    [[ -z "$rsync_pw" ]] && rsync_pw=$(generate_secret password)
    [[ -z "$admin_pw" ]] && admin_pw=$(generate_secret password)

    local env_tmp="${env_file}.tmp.$$"
    cat > "$env_tmp" << ENVEOF
# LINBO Native - Environment Configuration
# Generated by: ./setup.sh on $timestamp
# Re-run ./setup.sh to regenerate

# === Server Identity ===
LINBO_SERVER_IP=$LINBO_SERVER_IP
LINBO_HOSTNAME=${LINBO_HOSTNAME:-linbo-native}
NODE_ENV=production

# === LMN Server ===
LMN_SERVER_IP=${LMN_SERVER_IP:-$LINBO_SERVER_IP}

# === Network / DHCP ===
LINBO_DOMAIN=${LINBO_DOMAIN:-linuxmuster.lan}
LINBO_GATEWAY=${LINBO_GATEWAY:-10.0.0.254}
LINBO_DNS=${LINBO_DNS:-$LMN_SERVER_IP}
LINBO_SUBNET=${LINBO_SUBNET:-}
LINBO_NETMASK=${LINBO_NETMASK:-}
DHCP_INTERFACE=${DHCP_INTERFACE:-}
DHCP_CONFIG_DIR=/etc/dhcp

# === Sync Mode ===
SYNC_ENABLED=$SYNC_ENABLED
LMN_API_URL=${LMN_API_URL:-}
LMN_API_USER=${LMN_API_USER:-}
LMN_API_PASSWORD=${LMN_API_PASSWORD:-}
LMN_SCHOOL=$LMN_SCHOOL

# === Secrets (auto-generated) ===
JWT_SECRET=$jwt_secret
INTERNAL_API_KEY=$internal_key
RSYNC_PASSWORD=$rsync_pw

# === Web UI ===
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$admin_pw

# === TLS ===
# TLS cert verification (disabled for self-signed LMN server certs when sync enabled)
NODE_TLS_REJECT_UNAUTHORIZED=$([ "$SYNC_ENABLED" = "true" ] && echo 0 || echo 1)

# === SSH ===
LINBO_CLIENT_SSH_KEY=/etc/linuxmuster/linbo/ssh_host_rsa_key_client

# === Optional overrides ===
# HOST_SCAN_INTERVAL_SEC=60
# JWT_EXPIRES_IN=24h
# SSH_TIMEOUT=10000
# CORS_ORIGIN=*
ENVEOF

    chmod 600 "$env_tmp"
    mv "$env_tmp" "$env_file"
    log_ok "Written: /etc/linbo-native/.env"

    assert_no_docker_vars "$env_file"
}

# =============================================================================
# 11. Generate setup.ini (required by linbo-configure.sh / update-linbofs)
# =============================================================================
generate_setup_ini() {
    local setup_ini="/var/lib/linuxmuster/setup.ini"
    local domain="${LINBO_DOMAIN:-linuxmuster.lan}"
    local server_ip="$LINBO_SERVER_IP"
    local hostname="${LINBO_HOSTNAME:-linbo-native}"
    local netmask="${LINBO_NETMASK:-255.255.255.0}"
    local gateway="${LINBO_GATEWAY:-10.0.0.254}"

    # Derive network values from IP and netmask
    local bitmask network broadcast

    # Convert netmask to bitmask (CIDR prefix length)
    bitmask=$(python3 -c "
import ipaddress, sys
try:
    n = ipaddress.IPv4Network('0.0.0.0/${netmask}')
    print(n.prefixlen)
except Exception:
    print('24')
" 2>/dev/null || echo "24")

    # Derive network and broadcast from IP/bitmask
    read -r network broadcast < <(python3 -c "
import ipaddress, sys
try:
    n = ipaddress.IPv4Network('${server_ip}/${bitmask}', strict=False)
    print(n.network_address, n.broadcast_address)
except Exception:
    print('10.0.0.0 10.0.0.255')
" 2>/dev/null || echo "10.0.0.0 10.0.0.255")

    # Derive LDAP / Samba values from domain
    local realm sambadomain basedn
    realm=$(echo "$domain" | tr '[:lower:]' '[:upper:]')
    sambadomain=$(echo "$domain" | cut -d. -f1 | tr '[:lower:]' '[:upper:]')
    basedn=$(echo "$domain" | sed 's/\./,DC=/g; s/^/DC=/')

    mkdir -p "$(dirname "$setup_ini")"
    cat > "$setup_ini" << INIEOF
[setup]
servername = ${hostname}
domainname = ${domain}
serverip = ${server_ip}
hostname = ${hostname}
netmask = ${netmask}
network = ${network}
broadcast = ${broadcast}
firewallip = ${gateway}
gateway = ${gateway}
bitmask = ${bitmask}
realm = ${realm}
sambadomain = ${sambadomain}
basedn = ${basedn}
INIEOF

    chmod 600 "$setup_ini"
    log_ok "Written: ${setup_ini}"
}

# =============================================================================
# 12. Fix /etc/hosts (hostname must resolve to real IP, not 127.0.1.1)
# =============================================================================
fix_etc_hosts() {
    local hostname="${LINBO_HOSTNAME:-linbo-native}"
    local server_ip="$LINBO_SERVER_IP"
    local domain="${LINBO_DOMAIN:-linuxmuster.lan}"
    local fqdn="${hostname}.${domain}"
    local hosts_file="/etc/hosts"

    # Remove any 127.0.1.1 entry for our hostname
    if grep -q "127\.0\.1\.1.*${hostname}" "$hosts_file" 2>/dev/null; then
        sed -i "/127\.0\.1\.1.*${hostname}/d" "$hosts_file"
        log_info "Removed 127.0.1.1 entry for ${hostname} from /etc/hosts"
    fi

    # Ensure our hostname resolves to the real server IP
    if grep -qE "^${server_ip}[[:space:]]" "$hosts_file" 2>/dev/null; then
        # IP already has an entry — update it if hostname is missing
        if ! grep -qE "^${server_ip}[[:space:]].*${hostname}" "$hosts_file" 2>/dev/null; then
            sed -i "s|^${server_ip}[[:space:]].*|${server_ip}        ${fqdn}        ${hostname}|" "$hosts_file"
            log_info "Updated ${server_ip} entry in /etc/hosts"
        else
            log_ok "/etc/hosts already has ${server_ip} → ${hostname}"
            return 0
        fi
    else
        # Add new entry after localhost
        sed -i "/^127\.0\.0\.1/a ${server_ip}        ${fqdn}        ${hostname}" "$hosts_file"
        log_info "Added ${server_ip} → ${fqdn} ${hostname} to /etc/hosts"
    fi

    log_ok "/etc/hosts: ${hostname} → ${server_ip}"
}

# =============================================================================
# 13. Deploy API + systemd units
# =============================================================================
deploy_api() {
    # If installed via .deb package, API code is already at /srv/linbo-api
    # and systemd units are at /lib/systemd/system/. Only deploy from repo if
    # running from a git checkout (SCRIPT_DIR contains src/).
    if [[ -d "$SCRIPT_DIR/src" && -f "$SCRIPT_DIR/package.json" ]]; then
        log_info "Deploying API from repo to /srv/linbo-api..."
        rsync -a --delete \
            --exclude=node_modules --exclude=.git --exclude=tests \
            --exclude=frontend --exclude='*.md' --exclude='.planning' \
            "$SCRIPT_DIR/" /srv/linbo-api/

        cd /srv/linbo-api
        if ! npm install --production --loglevel error 2>&1; then
            log_warn "npm install failed — check network and retry: cd /srv/linbo-api && npm install --production"
            return 1
        fi
        chown -R linbo:linbo /srv/linbo-api
        log_ok "API deployed to /srv/linbo-api"

        # systemd units (from repo)
        cp "$SCRIPT_DIR/systemd/linbo-api.service" /etc/systemd/system/ 2>/dev/null || true
        cp "$SCRIPT_DIR/systemd/linbo-setup.service" /etc/systemd/system/ 2>/dev/null || true
        cp "$SCRIPT_DIR/scripts/setup-bootfiles.sh" /usr/local/bin/ 2>/dev/null || true
        chmod +x /usr/local/bin/setup-bootfiles.sh 2>/dev/null || true
    elif [[ -f /srv/linbo-api/package.json ]]; then
        log_ok "API already deployed (installed via package)"
    else
        log_error "No API code found — install the package or run from the repo"
        return 1
    fi

    systemctl daemon-reload
    systemctl enable linbo-api linbo-setup 2>/dev/null
    log_ok "systemd units enabled"

    # sudoers (idempotent — always write)
    cat > /etc/sudoers.d/linbo-services << 'SUDOEOF'
linbo ALL=(root) NOPASSWD: /usr/sbin/linbo-torrent
linbo ALL=(root) NOPASSWD: /usr/sbin/linbo-multicast
linbo ALL=(root) NOPASSWD: /usr/sbin/update-linbofs
linbo ALL=(root) NOPASSWD: /bin/systemctl restart isc-dhcp-server
linbo ALL=(root) NOPASSWD: /usr/sbin/dhcpd -t -cf /etc/dhcp/dhcpd.conf
linbo ALL=(root) NOPASSWD: /bin/systemctl reload rsync
linbo ALL=(root) NOPASSWD: /bin/systemctl restart tftpd-hpa
SUDOEOF
    chmod 440 /etc/sudoers.d/linbo-services
    log_ok "sudoers configured"

    # Monitoring
    local mon_script="/usr/share/linbo-api/scripts/monitoring/install-monitoring.sh"
    [[ ! -x "$mon_script" ]] && mon_script="$SCRIPT_DIR/scripts/monitoring/install-monitoring.sh"
    if [[ -x "$mon_script" ]]; then
        "$mon_script" >/dev/null 2>&1
        log_ok "Monitoring installed"
    fi
}

# =============================================================================
# 14. Deploy frontend + nginx
# =============================================================================
deploy_frontend() {
    log_info "Deploying frontend..."

    # If frontend already deployed (e.g. from .deb package), skip build
    if [[ -f /var/www/linbo/index.html ]]; then
        log_ok "Frontend already deployed"
    fi

    local dist_dir="$SCRIPT_DIR/frontend/dist"

    # Build frontend only if not deployed AND repo has source
    if [[ ! -f /var/www/linbo/index.html && -d "$SCRIPT_DIR/frontend" && ! -f "$dist_dir/index.html" ]]; then
        # GITHUB_TOKEN needed for @edulution-io/ui-kit (private npm package)
        if [[ -z "${GITHUB_TOKEN:-}" ]]; then
            if [[ "$INTERACTIVE" == "true" ]]; then
                echo ""
                echo -e "${BOLD}Frontend Build${NC}"
                echo "  The UI requires a GitHub token for private npm packages."
                echo "  Create at: https://github.com/settings/tokens (scope: read:packages)"
                echo ""
                read -sp "GitHub Token (or Enter to skip frontend): " GITHUB_TOKEN
                echo ""
                export GITHUB_TOKEN
            fi
        fi

        if [[ -n "${GITHUB_TOKEN:-}" ]]; then
            log_info "Building frontend (this may take a minute)..."
            (
                cd "$SCRIPT_DIR/frontend"
                if npm ci --loglevel error 2>&1 && npm run build 2>&1; then
                    true  # success
                else
                    false  # failure
                fi
            )
            if [[ $? -eq 0 ]]; then
                log_ok "Frontend built"
            else
                log_warn "Frontend build failed — UI won't be available"
                log_warn "Manually: cd $SCRIPT_DIR/frontend && GITHUB_TOKEN=<token> npm ci && npm run build"
            fi
        else
            log_warn "No GITHUB_TOKEN — skipping frontend build (API still works)"
        fi
    fi

    # Deploy built frontend (skip if already present from .deb)
    if [[ ! -f /var/www/linbo/index.html ]]; then
        if [[ -d "$dist_dir" && -f "$dist_dir/index.html" ]]; then
            mkdir -p /var/www/linbo
            cp -r "$dist_dir"/* /var/www/linbo/
            log_ok "Frontend deployed to /var/www/linbo"
        else
            mkdir -p /var/www/linbo
            log_warn "No frontend — API-only mode (UI at http://localhost:3000/docs)"
        fi
    fi

    # nginx site config (always regenerate to pick up fixes)
    cat > /etc/nginx/sites-available/linbo << 'NGINXEOF'
server {
    listen 80 default_server;
    server_name _;
    root /var/www/linbo;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # API reverse proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 600;
        proxy_send_timeout 600;
        client_max_body_size 0;
    }

    # Health + Docs — proxy to API
    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    location /docs {
        proxy_pass http://127.0.0.1:3000;
    }

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # Frontend SPA (=404 prevents redirect loop when index.html is missing)
    location / {
        try_files $uri $uri/ /index.html =404;
    }
}
NGINXEOF
    log_ok "nginx site config written"

    ln -sf /etc/nginx/sites-available/linbo /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default

    if nginx -t 2>/dev/null; then
        # Start if not running, reload if already running
        if systemctl is-active nginx >/dev/null 2>&1; then
            systemctl reload nginx
        else
            systemctl start nginx
        fi
        log_ok "nginx configured and reloaded"
    else
        log_warn "nginx config test failed — check /etc/nginx/sites-available/linbo"
    fi
}

# =============================================================================
# 15. Rebuild linbofs64 (SSH keys, kernel modules, locale)
# =============================================================================
rebuild_linbofs() {
    # Native update-linbofs produces the correct linbofs matching the
    # installed linbo7 package. Must run BEFORE tftpd-hpa starts so
    # clients always get a properly patched linbofs64.
    if [[ -x /usr/sbin/update-linbofs ]]; then
        log_info "Rebuilding linbofs64 (this takes ~60s)..."
        if /usr/sbin/update-linbofs 2>&1 | tail -5; then
            log_ok "linbofs64 rebuilt (native update-linbofs)"
        else
            log_warn "update-linbofs failed — PXE clients may not boot correctly"
        fi
    else
        log_warn "update-linbofs not found — linbofs64 may lack SSH keys"
    fi
}

# =============================================================================
# 16. DHCP scaffold (dhcpd.conf with PXE boot options)
# =============================================================================
setup_dhcp() {
    local dhcp_script=""
    # Find setup-dhcp.sh: package location or repo location
    for candidate in /usr/local/bin/setup-dhcp.sh "$SCRIPT_DIR/scripts/server/setup-dhcp.sh"; do
        [[ -x "$candidate" ]] && dhcp_script="$candidate" && break
    done

    if [[ -n "$dhcp_script" ]]; then
        log_info "Setting up DHCP..."
        "$dhcp_script" --force
    else
        log_warn "setup-dhcp.sh not found — DHCP not configured"
    fi
}

# =============================================================================
# 16. Initial sync + linbofs rebuild (after API is running)
# =============================================================================
initial_sync() {
    if [[ "$SYNC_ENABLED" != "true" ]]; then
        log_info "Sync disabled — skipping initial sync"
        return 0
    fi

    # Wait for API to be ready
    local retries=0
    while ! curl -sf http://127.0.0.1:3000/health >/dev/null 2>&1; do
        retries=$((retries + 1))
        if [[ $retries -ge 30 ]]; then
            log_warn "API not ready after 30s — skipping initial sync"
            return 0
        fi
        sleep 1
    done

    log_info "Running initial sync from LMN server..."
    local admin_pw_for_sync
    admin_pw_for_sync=$(grep '^ADMIN_PASSWORD=' /etc/linbo-native/.env | cut -d= -f2-)
    local token
    token=$(curl -sf -X POST http://127.0.0.1:3000/api/v1/auth/login \
        -H 'Content-Type: application/json' \
        -d "{\"username\":\"admin\",\"password\":\"${admin_pw_for_sync}\"}" \
        | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])" 2>/dev/null)

    if [[ -z "$token" ]]; then
        log_warn "Could not authenticate — skipping initial sync"
        return 0
    fi

    # Trigger sync
    local sync_result
    sync_result=$(curl -sf -X POST http://127.0.0.1:3000/api/v1/sync/trigger \
        -H "Authorization: Bearer $token" 2>/dev/null)

    if echo "$sync_result" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('data',{}).get('success',''))" 2>/dev/null | grep -q "True"; then
        log_ok "Initial sync completed"
    else
        log_warn "Initial sync may have failed — check: curl http://localhost:3000/api/v1/sync/status"
    fi

    # Enable and start DHCP with fresh config from sync
    if [[ -f /etc/dhcp/dhcpd.conf ]]; then
        if /usr/sbin/dhcpd -t -cf /etc/dhcp/dhcpd.conf 2>/dev/null; then
            systemctl enable --now isc-dhcp-server 2>/dev/null && log_ok "isc-dhcp-server enabled and started" || log_warn "DHCP start failed"
        else
            log_warn "DHCP config test failed — not starting"
        fi
    fi
}

# =============================================================================
# 17. Start services
# =============================================================================
enable_services() {
    log_info "Starting services..."

    # Core boot services (from linuxmuster-linbo7 package)
    systemctl enable --now tftpd-hpa 2>/dev/null && log_ok "tftpd-hpa running" || log_warn "tftpd-hpa start failed"
    systemctl enable --now rsync 2>/dev/null && log_ok "rsync running" || log_warn "rsync start failed"

    # Torrent: opentracker (tracker) + linbo-torrent (seeding)
    if command -v opentracker &>/dev/null; then
        if [[ ! -f /etc/systemd/system/opentracker.service ]]; then
            cat > /etc/systemd/system/opentracker.service << 'OTEOF'
[Unit]
Description=OpenTracker service
After=network.target

[Service]
Type=simple
ExecStart=/usr/sbin/opentracker -u nobody -d /srv/linbo

[Install]
WantedBy=multi-user.target
OTEOF
            systemctl daemon-reload
        fi
        systemctl enable --now opentracker 2>/dev/null && log_ok "opentracker running (port 6969)" || log_warn "opentracker start failed"
        systemctl enable --now linbo-torrent 2>/dev/null && log_ok "linbo-torrent running" || log_warn "linbo-torrent start failed"
    fi

    # Web
    systemctl enable --now nginx 2>/dev/null && log_ok "nginx running" || log_warn "nginx start failed"

    # LINBO API
    systemctl start linbo-setup 2>/dev/null || true
    systemctl start linbo-api 2>/dev/null

    sleep 2
    if systemctl is-active --quiet linbo-api; then
        log_ok "linbo-api running"
    else
        log_warn "linbo-api failed to start — check: journalctl -u linbo-api"
    fi
}

# =============================================================================
# 16. Summary
# =============================================================================
print_summary() {
    echo ""
    local api_status nginx_status
    api_status=$(systemctl is-active linbo-api 2>/dev/null || echo "not running")
    nginx_status=$(systemctl is-active nginx 2>/dev/null || echo "not running")

    echo ""
    echo -e "${GREEN}+--------------------------------------------------+${NC}"
    echo -e "${GREEN}|              Setup Complete                       |${NC}"
    echo -e "${GREEN}+--------------------------------------------------+${NC}"
    echo ""
    echo "  Server IP:       ${LINBO_SERVER_IP}"
    echo "  Hostname:        ${LINBO_HOSTNAME:-linbo-native}"
    if [[ "$SYNC_ENABLED" == "true" ]]; then
        echo "  LMN Server:      ${LMN_SERVER_IP} (${LMN_API_URL})"
        echo "  Domain:          ${LINBO_DOMAIN}"
        echo "  Gateway:         ${LINBO_GATEWAY}"
        echo "  DNS:             ${LINBO_DNS}"
        echo "  School:          ${LMN_SCHOOL}"
        echo "  Sync:            enabled"
    else
        echo "  Sync:            disabled (offline mode)"
    fi
    echo "  Admin login:     admin / ${admin_pw:-<see .env>}"
    echo "  API:             ${api_status} (http://localhost:3000)"
    echo "  nginx:           ${nginx_status}"
    echo "  UI:              http://${LINBO_SERVER_IP}/"
    echo "  Health:          http://${LINBO_SERVER_IP}/health"
    echo "  .env:            /etc/linbo-native/.env"
    echo ""

    if [[ "$PORT_WARNINGS" -gt 0 ]]; then
        log_warn "Resolve $PORT_WARNINGS port conflict(s)!"
        echo ""
    fi
}

# =============================================================================
# Post-Install Verification
# =============================================================================
verify_installation() {
    echo ""
    echo -e "${BOLD}Post-Install Verification${NC}"
    echo ""
    local FAIL=0

    # --- Services ---
    for svc in linbo-api nginx tftpd-hpa rsync isc-dhcp-server; do
        if systemctl is-active --quiet "$svc" 2>/dev/null; then
            log_ok "Service: $svc running"
        else
            log_fail "Service: $svc NOT running — fix: systemctl start $svc; journalctl -u $svc"
            FAIL=$((FAIL + 1))
        fi
    done

    # Optional services (don't fail, just warn)
    for svc in opentracker linbo-torrent; do
        if systemctl is-active --quiet "$svc" 2>/dev/null; then
            log_ok "Service: $svc running"
        else
            log_warn "Service: $svc not running (optional)"
        fi
    done

    # --- API Health ---
    local health
    health=$(curl -sf --max-time 5 http://127.0.0.1:3000/health 2>/dev/null)
    if echo "$health" | grep -q '"healthy"'; then
        log_ok "API health: healthy"
    else
        log_fail "API health: NOT responding — fix: journalctl -u linbo-api"
        FAIL=$((FAIL + 1))
    fi

    # --- Boot files ---
    for f in /srv/linbo/linbo64 /srv/linbo/linbofs64 /srv/linbo/boot/grub/x86_64-efi/core.efi /srv/linbo/boot/grub/i386-pc/core.0; do
        if [[ -f "$f" ]]; then
            log_ok "Boot: $(basename $f)"
        else
            log_fail "Boot: $(basename $f) MISSING — fix: update-linbofs or reinstall linuxmuster-linbo7"
            FAIL=$((FAIL + 1))
        fi
    done

    # --- linbofs64 has SSH keys ---
    local tmpdir
    tmpdir=$(mktemp -d)
    (cd "$tmpdir" && xzcat /srv/linbo/linbofs64 2>/dev/null | cpio -id --quiet 2>/dev/null)
    if [[ -f "$tmpdir/.ssh/authorized_keys" ]] && grep -q "ssh-rsa" "$tmpdir/.ssh/authorized_keys" 2>/dev/null; then
        log_ok "linbofs64: SSH keys injected"
    else
        log_fail "linbofs64: SSH keys MISSING — fix: update-linbofs"
        FAIL=$((FAIL + 1))
    fi
    rm -rf "$tmpdir"

    # --- DHCP config ---
    if [[ -f /etc/dhcp/dhcpd.conf ]] && grep -q "next-server" /etc/dhcp/dhcpd.conf 2>/dev/null; then
        log_ok "DHCP: dhcpd.conf has PXE options"
    else
        log_fail "DHCP: dhcpd.conf missing or no PXE options — fix: setup-dhcp.sh --force"
        FAIL=$((FAIL + 1))
    fi

    if grep -q 'INTERFACESv4="[a-z]' /etc/default/isc-dhcp-server 2>/dev/null; then
        log_ok "DHCP: interface configured"
    else
        log_fail "DHCP: no interface set in /etc/default/isc-dhcp-server"
        FAIL=$((FAIL + 1))
    fi

    # --- GRUB configs ---
    local grub_count
    grub_count=$(ls /srv/linbo/boot/grub/*.cfg 2>/dev/null | wc -l)
    if [[ "$grub_count" -gt 0 ]]; then
        log_ok "GRUB: $grub_count config(s)"
    else
        log_warn "GRUB: no configs yet (will appear after first sync)"
    fi

    # --- start.conf ---
    local conf_count
    conf_count=$(ls /srv/linbo/start.conf.* 2>/dev/null | grep -v md5 | grep -v bak | wc -l)
    if [[ "$conf_count" -gt 0 ]]; then
        log_ok "start.conf: $conf_count group(s)"
    else
        log_warn "start.conf: none yet (will appear after first sync)"
    fi

    # --- Frontend ---
    if [[ -f /var/www/linbo/index.html ]]; then
        log_ok "Frontend: deployed"
    else
        log_warn "Frontend: not deployed (API-only mode)"
    fi

    # --- nginx proxy ---
    local nginx_health
    nginx_health=$(curl -sf --max-time 5 http://127.0.0.1/health 2>/dev/null)
    if echo "$nginx_health" | grep -q '"healthy"'; then
        log_ok "nginx → API proxy: working"
    else
        log_fail "nginx → API proxy: NOT working — fix: check /etc/nginx/sites-enabled/linbo"
        FAIL=$((FAIL + 1))
    fi

    # --- rsync accessible ---
    if rsync --list-only --timeout=3 rsync://127.0.0.1/linbo/ >/dev/null 2>&1; then
        log_ok "rsync: linbo module accessible"
    else
        log_fail "rsync: linbo module NOT accessible — fix: check /etc/rsyncd.conf"
        FAIL=$((FAIL + 1))
    fi

    # --- Ports ---
    for spec in "69:udp:TFTP" "873:tcp:rsync" "80:tcp:nginx" "3000:tcp:API"; do
        IFS=: read -r port proto svc <<< "$spec"
        local flag=$([[ "$proto" == "tcp" ]] && echo "-tlnp" || echo "-ulnp")
        if ss "$flag" sport = :"$port" 2>/dev/null | grep -q ":${port}"; then
            log_ok "Port $port/$proto ($svc) listening"
        else
            log_fail "Port $port/$proto ($svc) NOT listening"
            FAIL=$((FAIL + 1))
        fi
    done

    # --- .env ---
    if [[ -f /etc/linbo-native/.env ]]; then
        local perms
        perms=$(stat -c '%a' /etc/linbo-native/.env)
        if [[ "$perms" == "600" ]]; then
            log_ok ".env: present (mode 600)"
        else
            log_warn ".env: insecure permissions ($perms instead of 600)"
        fi
    else
        log_fail ".env: MISSING — this should not happen after setup"
        FAIL=$((FAIL + 1))
    fi

    # --- Summary ---
    echo ""
    if [[ "$FAIL" -eq 0 ]]; then
        echo -e "  ${GREEN}${BOLD}All checks passed — system is ready for PXE boot${NC}"
    else
        echo -e "  ${RED}${BOLD}$FAIL check(s) FAILED — see above for fixes${NC}"
    fi
    echo ""
}

# =============================================================================
# main
# =============================================================================
main() {
    print_banner

    # Auto-install system dependencies if not present
    if ! dpkg -l linuxmuster-linbo7 2>/dev/null | grep -q '^ii' \
       || ! command -v node &>/dev/null \
       || ! command -v nginx &>/dev/null; then
        log_info "System dependencies missing — running install.sh..."
        "$SCRIPT_DIR/install.sh"
    fi

    run_prerequisites
    check_ports
    prompt_lmn_connection
    prompt_server_identity
    prompt_dhcp_interface
    setup_directories
    create_linbo_user
    _ensure_linbo_ssh_key
    handle_existing_env
    write_env
    generate_setup_ini
    fix_etc_hosts
    deploy_api
    deploy_frontend
    setup_dhcp
    rebuild_linbofs
    enable_services
    initial_sync
    verify_installation
    print_summary
}

main "$@"
