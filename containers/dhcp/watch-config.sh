#!/bin/sh
# inotify-based config watcher for ISC DHCP server
# Watches /srv/linbo/dhcp/ for changes written by sync.service.js
# On change: copies subnets.conf + devices/*.conf into /etc/dhcp/ and sends SIGHUP to dhcpd

SHARED_DIR="/srv/linbo/dhcp"
DHCP_CONFIG_DIR="/etc/dhcp"
SCHOOL="${LMN_SCHOOL:-default-school}"

# Wait until the shared directory exists
while [ ! -d "$SHARED_DIR" ]; do
  echo "[DHCP-Watch] Waiting for ${SHARED_DIR} ..."
  sleep 5
done

echo "[DHCP-Watch] Watching ${SHARED_DIR} for changes..."

# Watch shared dir and devices subdir for close_write and moved_to events
while true; do
  # Build inotifywait args — watch shared dir, optionally devices subdir
  WATCH_DIRS="$SHARED_DIR"
  [ -d "$SHARED_DIR/devices" ] && WATCH_DIRS="$WATCH_DIRS $SHARED_DIR/devices"

  inotifywait -e close_write,moved_to $WATCH_DIRS 2>/dev/null

  # Copy updated files
  if [ -f "$SHARED_DIR/subnets.conf" ]; then
    cp "$SHARED_DIR/subnets.conf" "$DHCP_CONFIG_DIR/subnets.conf"
  fi
  if [ -f "$SHARED_DIR/devices/${SCHOOL}.conf" ]; then
    mkdir -p "$DHCP_CONFIG_DIR/devices"
    cp "$SHARED_DIR/devices/${SCHOOL}.conf" "$DHCP_CONFIG_DIR/devices/${SCHOOL}.conf"
  fi

  echo "[DHCP-Watch] Config updated, sending SIGHUP to dhcpd..."
  kill -HUP $(cat /var/run/dhcp-server/dhcpd.pid 2>/dev/null) 2>/dev/null || killall -HUP dhcpd 2>/dev/null || true
done
