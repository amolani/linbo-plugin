#!/bin/bash
# =============================================================================
# LINBO Docker - Helper Functions
# Replacement for /usr/share/linuxmuster/helperfunctions.sh
# =============================================================================

# Configuration paths
LINBODIR="/srv/linbo"
LINBOIMGDIR="/srv/linbo/images"
LINBOSYSDIR="/etc/linuxmuster/linbo"
LINBOSHAREDIR="/usr/share/linuxmuster/linbo"
LINBOLOGDIR="/var/log/linuxmuster/linbo"
LINBOVARDIR="/var/lib/linuxmuster/linbo"

# API Configuration (for Docker environment)
API_HOST="${API_HOST:-api}"
API_PORT="${API_PORT:-3000}"
API_BASE_URL="http://${API_HOST}:${API_PORT}/api/v1"

# =============================================================================
# Validation Functions
# =============================================================================

# Validate hostname format
validhostname() {
    local hostname="$1"
    [[ "$hostname" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]]
}

# Validate IP address format
validip() {
    local ip="$1"
    [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
}

# Validate MAC address format
validmac() {
    local mac="$1"
    [[ "$mac" =~ ^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$ ]]
}

# Check if value is an integer
isinteger() {
    [[ "$1" =~ ^[0-9]+$ ]]
}

# =============================================================================
# Host Lookup Functions (API-based replacement for devices.csv)
# =============================================================================

# Get IP address for hostname via API
get_ip() {
    local hostname="$1"
    if [ -z "$hostname" ]; then
        return 1
    fi

    # Try API first
    local ip
    ip=$(curl -s --max-time 5 "${API_BASE_URL}/hosts/by-name/${hostname}" 2>/dev/null | jq -r '.ipAddress // empty')

    if [ -n "$ip" ] && validip "$ip"; then
        echo "$ip"
        return 0
    fi

    # Fallback: try DNS resolution
    ip=$(getent hosts "$hostname" 2>/dev/null | awk '{print $1}')
    if [ -n "$ip" ]; then
        echo "$ip"
        return 0
    fi

    return 1
}

# Get MAC address for hostname via API
get_mac() {
    local hostname="$1"
    if [ -z "$hostname" ]; then
        return 1
    fi

    local mac
    mac=$(curl -s --max-time 5 "${API_BASE_URL}/hosts/by-name/${hostname}" 2>/dev/null | jq -r '.macAddress // empty')

    if [ -n "$mac" ] && validmac "$mac"; then
        echo "$mac"
        return 0
    fi

    return 1
}

# Get hostname for IP address via API
get_hostname() {
    local ip="$1"
    if [ -z "$ip" ]; then
        return 1
    fi

    local hostname
    hostname=$(curl -s --max-time 5 "${API_BASE_URL}/hosts/by-ip/${ip}" 2>/dev/null | jq -r '.hostname // empty')

    if [ -n "$hostname" ]; then
        echo "$hostname"
        return 0
    fi

    return 1
}

# Get group for hostname via API
get_group() {
    local hostname="$1"
    if [ -z "$hostname" ]; then
        return 1
    fi

    local group
    group=$(curl -s --max-time 5 "${API_BASE_URL}/hosts/by-name/${hostname}" 2>/dev/null | jq -r '.group.name // empty')

    if [ -n "$group" ]; then
        echo "$group"
        return 0
    fi

    return 1
}

# Get all hosts in a group via API
get_hosts_by_group() {
    local group="$1"
    if [ -z "$group" ]; then
        return 1
    fi

    curl -s --max-time 10 "${API_BASE_URL}/hosts?group=${group}" 2>/dev/null | jq -r '.data[].hostname // empty'
}

# Get all hosts in a room via API
get_hosts_by_room() {
    local room="$1"
    if [ -z "$room" ]; then
        return 1
    fi

    curl -s --max-time 10 "${API_BASE_URL}/hosts?room=${room}" 2>/dev/null | jq -r '.data[].hostname // empty'
}

# =============================================================================
# Network Functions
# =============================================================================

# Get broadcast address for an IP
get_bcaddress() {
    local ip="$1"
    if [ -z "$ip" ]; then
        return 1
    fi

    # Simple calculation for /24 network (can be enhanced for other masks)
    local network
    network=$(echo "$ip" | cut -d. -f1-3)
    echo "${network}.255"
}

# =============================================================================
# Logging Functions
# =============================================================================

# Log a message to LINBO log
linbo_log() {
    local level="${1:-INFO}"
    local message="$2"
    local logfile="${LINBOLOGDIR}/linbo.log"

    mkdir -p "$(dirname "$logfile")"
    echo "$(date '+%Y-%m-%d %H:%M:%S') [$level] $message" >> "$logfile"
}

# Log info message
log_info() {
    linbo_log "INFO" "$1"
}

# Log warning message
log_warn() {
    linbo_log "WARN" "$1"
}

# Log error message
log_error() {
    linbo_log "ERROR" "$1"
}

# =============================================================================
# File Functions
# =============================================================================

# Get start.conf for a host/group
get_startconf() {
    local identifier="$1"
    local startconf=""

    # Check if it's an IP
    if validip "$identifier"; then
        startconf="${LINBODIR}/start.conf-${identifier}"
    else
        # It's a hostname or group
        startconf="${LINBODIR}/start.conf.${identifier}"
    fi

    if [ -f "$startconf" ]; then
        echo "$startconf"
    elif [ -f "${LINBODIR}/start.conf" ]; then
        echo "${LINBODIR}/start.conf"
    elif [ -f "${LINBOSYSDIR}/start.conf.default" ]; then
        echo "${LINBOSYSDIR}/start.conf.default"
    else
        return 1
    fi
}

# =============================================================================
# Status Update Functions (for API integration)
# =============================================================================

# Update host status via API
update_host_status() {
    local hostname="$1"
    local status="$2"

    if [ -z "$hostname" ] || [ -z "$status" ]; then
        return 1
    fi

    curl -s --max-time 5 -X PATCH \
        -H "Content-Type: application/json" \
        -d "{\"status\": \"${status}\"}" \
        "${API_BASE_URL}/hosts/by-name/${hostname}/status" >/dev/null 2>&1
}

# Report operation progress via API
report_progress() {
    local session_id="$1"
    local progress="$2"
    local message="$3"

    if [ -z "$session_id" ]; then
        return 1
    fi

    curl -s --max-time 5 -X POST \
        -H "Content-Type: application/json" \
        -d "{\"progress\": ${progress}, \"message\": \"${message}\"}" \
        "${API_BASE_URL}/operations/sessions/${session_id}/progress" >/dev/null 2>&1
}

# =============================================================================
# Utility Functions
# =============================================================================

# Generate random string
random_string() {
    local length="${1:-16}"
    tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c "$length"
}

# Check if a service is available
check_service() {
    local host="$1"
    local port="$2"
    local timeout="${3:-5}"

    nc -z -w "$timeout" "$host" "$port" 2>/dev/null
}

# Export functions for use in scripts
export -f validhostname validip validmac isinteger
export -f get_ip get_mac get_hostname get_group
export -f get_hosts_by_group get_hosts_by_room
export -f get_bcaddress
export -f linbo_log log_info log_warn log_error
export -f get_startconf
export -f update_host_status report_progress
export -f random_string check_service

# Export variables
export LINBODIR LINBOIMGDIR LINBOSYSDIR LINBOSHAREDIR LINBOLOGDIR LINBOVARDIR
export API_HOST API_PORT API_BASE_URL
