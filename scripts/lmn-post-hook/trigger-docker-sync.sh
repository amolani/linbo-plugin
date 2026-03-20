#!/bin/bash
# LMN Post-Hook: Trigger LINBO Docker sync after device-import
#
# Install on the LMN Server (10.0.0.11):
#   cp trigger-docker-sync.sh /etc/linuxmuster/device-import.post.d/
#   chmod +x /etc/linuxmuster/device-import.post.d/trigger-docker-sync.sh
#
# Configure via environment or edit defaults below:
#   LINBO_DOCKER_HOST  - IP/hostname of the Docker host (default: 10.0.0.13)
#   LINBO_DOCKER_PORT  - API port (default: 3000)
#   LINBO_DOCKER_API_TOKEN - Bearer token for auth

DOCKER_HOST="${LINBO_DOCKER_HOST:-10.0.0.13}"
DOCKER_PORT="${LINBO_DOCKER_PORT:-3000}"
API_TOKEN="${LINBO_DOCKER_API_TOKEN:-}"

AUTH_HEADER=""
if [ -n "$API_TOKEN" ]; then
  AUTH_HEADER="-H \"Authorization: Bearer ${API_TOKEN}\""
fi

echo "[PostHook] Triggering LINBO Docker sync on ${DOCKER_HOST}:${DOCKER_PORT}..."

eval curl -sf -X POST \
  -H "Content-Type: application/json" \
  $AUTH_HEADER \
  "http://${DOCKER_HOST}:${DOCKER_PORT}/api/v1/sync/trigger" \
  && echo "[PostHook] Sync triggered successfully" \
  || echo "[PostHook] WARNING: Could not trigger Docker sync"
