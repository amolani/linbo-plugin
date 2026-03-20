#!/bin/bash
#
# LINBO Docker - RSYNC Post-Download Hook
# Notifies API after download completes
#
# Called by rsyncd after each download operation
#

# API configuration
API_URL="${API_URL:-http://linbo-api:3000/api/v1}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-linbo-internal-secret}"

# Log file
LOGFILE="/var/log/rsync-hooks.log"

# Log helper
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [post-download] $*" >> "$LOGFILE"
}

log "Started: module=$RSYNC_MODULE_NAME client=$RSYNC_HOST_ADDR request=$RSYNC_REQUEST"

# Notify API
curl -s -X POST "${API_URL}/internal/rsync-event" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
    -d "{
        \"event\": \"post-download\",
        \"module\": \"${RSYNC_MODULE_NAME}\",
        \"clientIp\": \"${RSYNC_HOST_ADDR}\",
        \"request\": \"${RSYNC_REQUEST}\"
    }" 2>/dev/null || log "Failed to notify API"

log "Completed: exit=$RSYNC_EXIT_STATUS"

exit $RSYNC_EXIT_STATUS
