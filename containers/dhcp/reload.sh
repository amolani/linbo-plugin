#!/bin/sh
set -e

SHARED_DIR="/srv/linbo/dhcp"
DHCP_CONFIG_DIR="/etc/dhcp"
SCHOOL="${LMN_SCHOOL:-default-school}"

echo "[DHCP-Reload] Reloading ISC DHCP config..."

if [ -f "$SHARED_DIR/subnets.conf" ]; then
  cp "$SHARED_DIR/subnets.conf" "$DHCP_CONFIG_DIR/subnets.conf"
fi
if [ -f "$SHARED_DIR/devices/${SCHOOL}.conf" ]; then
  mkdir -p "$DHCP_CONFIG_DIR/devices"
  cp "$SHARED_DIR/devices/${SCHOOL}.conf" "$DHCP_CONFIG_DIR/devices/${SCHOOL}.conf"
fi

echo "[DHCP-Reload] Sending SIGHUP to dhcpd..."
kill -HUP $(cat /var/run/dhcp-server/dhcpd.pid 2>/dev/null) 2>/dev/null || killall -HUP dhcpd 2>/dev/null || echo "[DHCP-Reload] WARNING: Could not signal dhcpd"
echo "[DHCP-Reload] Done"
