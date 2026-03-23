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
    # Preserve existing secrets on re-run (avoids JWT invalidation)
    if [[ -f "$env_file" ]]; then
        jwt_secret=$(grep '^JWT_SECRET=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' || true)
        internal_key=$(grep '^INTERNAL_API_KEY=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' || true)
        rsync_pw=$(grep '^RSYNC_PASSWORD=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' || true)
    fi
    # Generate only if not already set (fresh install or missing values)
    [[ -z "$jwt_secret" ]] && jwt_secret=$(generate_secret jwt)
    [[ -z "$internal_key" ]] && internal_key=$(generate_secret api_key)
    [[ -z "$rsync_pw" ]] && rsync_pw=$(generate_secret password)

    cat > "$env_file" << ENVEOF
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
ADMIN_PASSWORD=Muster!

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

    chmod 600 "$env_file"
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
    log_info "Deploying API to /srv/linbo-api..."

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

    # systemd units
    cp "$SCRIPT_DIR/systemd/linbo-api.service" /etc/systemd/system/
    cp "$SCRIPT_DIR/systemd/linbo-setup.service" /etc/systemd/system/
    cp "$SCRIPT_DIR/scripts/setup-bootfiles.sh" /usr/local/bin/
    chmod +x /usr/local/bin/setup-bootfiles.sh
    systemctl daemon-reload
    systemctl enable linbo-api linbo-setup 2>/dev/null
    log_ok "systemd units installed and enabled"

    # sudoers: allow linbo user to run LINBO management commands without password
    cat > /etc/sudoers.d/linbo-services << 'SUDOEOF'
# Allow linbo API service to manage LINBO services
linbo ALL=(root) NOPASSWD: /usr/sbin/linbo-torrent
linbo ALL=(root) NOPASSWD: /usr/sbin/linbo-multicast
linbo ALL=(root) NOPASSWD: /usr/sbin/update-linbofs
linbo ALL=(root) NOPASSWD: /bin/systemctl restart isc-dhcp-server
linbo ALL=(root) NOPASSWD: /usr/sbin/dhcpd -t -cf *
SUDOEOF
    chmod 440 /etc/sudoers.d/linbo-services
    log_ok "sudoers configured for linbo service management"

    # Install monitoring (health check cron + morning report)
    if [[ -x "$SCRIPT_DIR/scripts/monitoring/install-monitoring.sh" ]]; then
        "$SCRIPT_DIR/scripts/monitoring/install-monitoring.sh" >/dev/null 2>&1
        log_ok "Monitoring installed (health check every 5min, morning report 06:00)"
    fi
}

# =============================================================================
# 14. Deploy frontend + nginx
# =============================================================================
deploy_frontend() {
    log_info "Deploying frontend..."

    local dist_dir="$SCRIPT_DIR/frontend/dist"
    if [[ -d "$dist_dir" && -f "$dist_dir/index.html" ]]; then
        mkdir -p /var/www/linbo
        cp -r "$dist_dir"/* /var/www/linbo/
        log_ok "Frontend deployed to /var/www/linbo"
    else
        log_warn "No frontend build at $dist_dir — UI won't be available"
        log_warn "Build with: cd frontend && npm run build"
    fi

    # nginx site config (idempotent — skip if already exists)
    if [[ ! -f /etc/nginx/sites-available/linbo ]]; then
        cat > /etc/nginx/sites-available/linbo << 'NGINXEOF'
server {
    listen 80 default_server;
    server_name _;
    root /var/www/linbo;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINXEOF
        log_ok "nginx site config created"
    else
        log_ok "nginx site config already exists"
    fi

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
# 15. Start services
# =============================================================================
enable_services() {
    log_info "Starting services..."
    systemctl enable --now nginx 2>/dev/null && log_ok "nginx running" || log_warn "nginx start failed"

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
    echo "  Admin login:     admin / Muster!"
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
# main
# =============================================================================
main() {
    print_banner
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
    enable_services
    print_summary
}

main "$@"
