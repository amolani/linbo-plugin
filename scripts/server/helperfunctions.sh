#!/bin/bash
#
# Docker-compatible helperfunctions for LINBO rsync hooks
#
# Drop-in replacement for /usr/share/linuxmuster/helperfunctions.sh
# Uses Docker API instead of ldbsearch for hostname/mac/ip lookups.
#

# Source environment (paths, setup.ini values)
source "$(dirname "$0")/environment.sh" 2>/dev/null || true

# API for host lookups (set by rsync container environment)
API_URL="${API_URL:-http://localhost:3000/api/v1}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-}"

# converting string to lower chars
tolower(){
  echo $1 | tr A-Z a-z
}

# converting string to upper chars
toupper(){
  echo $1 | tr a-z A-Z
}

# test if string is in string
stringinstring(){
  case "$2" in *$1*) return 0;; esac
  return 1
}

# test if variable is an integer
isinteger(){
  [ $# -eq 1 ] || return 1
  case $1 in
  *[!0-9]*|"") return 1;;
            *) return 0;;
  esac
}

# check valid ip
validip(){
  local i
  if expr "$1" : '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$' >/dev/null; then
    for i in 1 2 3 4; do
      [ $(echo "$1" | cut -d. -f$i) -gt 255 ] && return 1
    done
    return 0
  else
    return 1
  fi
}

# test valid mac address syntax
validmac(){
  [[ "$1" =~ ^([a-fA-F0-9]{2}:){5}[a-fA-F0-9]{2}$ ]] || return 1
}

# test for valid hostname
validhostname(){
  (expr match "$(tolower $1)" '\([a-z0-9\-]\+$\)') &> /dev/null || return 1
}

# check valid domain name
validdomain(){
  (expr match "$(tolower $1)" '\([A-Za-z0-9\-]\+\(\.[A-Za-z0-9\-]\+\)\+$\)') &> /dev/null || return 1
}

# ---- Docker API-based host lookups (replaces ldbsearch) ----

# Query Docker API for host data by IP or MAC
_api_host_lookup() {
  local field="$1" value="$2" return_field="$3"
  # Use internal config endpoint
  local result
  result=$(curl -sf --max-time 3 \
    "${API_URL}/internal/config/${value}" \
    -H "X-Internal-Key: ${INTERNAL_API_KEY}" 2>/dev/null)
  [ -z "$result" ] && return 1
  echo "$result" | grep -o "\"${return_field}\":\"[^\"]*\"" | cut -d'"' -f4
}

# get hostname from Docker API
get_hostname(){
  if validip "$1"; then
    _api_host_lookup "ip" "$1" "hostname"
  elif validmac "$1"; then
    _api_host_lookup "mac" "$(toupper $1)" "hostname"
  elif validhostname "$1"; then
    echo "$1"
  fi
}

# get host's mac address from Docker API
get_mac(){
  if validip "$1"; then
    _api_host_lookup "ip" "$1" "mac"
  elif validhostname "$1"; then
    _api_host_lookup "hostname" "$1" "mac"
  elif validmac "$1"; then
    echo "$(toupper $1)"
  fi
}

# get host's ip address from Docker API
get_ip(){
  if validhostname "$1"; then
    _api_host_lookup "hostname" "$1" "ip"
  elif validmac "$1"; then
    _api_host_lookup "mac" "$(toupper $1)" "ip"
  elif validip "$1"; then
    echo "$1"
  fi
}

# return hostgroup of device from Docker API
get_hostgroup(){
  _api_host_lookup "hostname" "$(tolower $1)" "hostgroup"
}

# return mac address from dhcp leases (fallback)
get_mac_dhcp(){
  validip "$1" || return
  # Try Docker API first
  local mac
  mac=$(_api_host_lookup "ip" "$1" "mac")
  [ -n "$mac" ] && echo "$mac" && return
  # Fallback: dhcp leases
  LANG=C grep -A10 "$1" /var/lib/dhcp/dhcpd.leases 2>/dev/null | grep "hardware ethernet" | awk '{ print $3 }' | awk -F\; '{ print $1 }' | tr A-Z a-z
}

# return hostname by dhcp ip
get_hostname_dhcp_ip(){
  validip "$1" || return
  get_hostname "$1"
}

# do hostname handling for linbo's rsync xfer scripts
do_rsync_hostname(){
  if echo "$RSYNC_HOST_NAME" | grep -q UNKNOWN; then
    local compname_tmp="$(get_hostname "$RSYNC_HOST_ADDR")"
    [ -n "$compname_tmp" ] && RSYNC_HOST_NAME="$(echo "$RSYNC_HOST_NAME" | sed -e "s|UNKNOWN|$compname_tmp|")"
  fi
  compname="$(echo $RSYNC_HOST_NAME | awk -F\. '{ print $1 }' | tr A-Z a-z)"
  validdomain "$RSYNC_HOST_NAME" || RSYNC_HOST_NAME="${RSYNC_HOST_NAME}.${domainname:-linuxmuster.lan}"
  export compname
  export RSYNC_HOST_NAME
}
