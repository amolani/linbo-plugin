#!/bin/bash
#
# LINBO Docker - RSYNC Post-Upload Hook
# Notifies API after upload completes (e.g., image upload)
#
# Called by rsyncd after each upload operation
#

# API configuration
API_URL="${API_URL:-http://linbo-api:3000/api/v1}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-linbo-internal-secret}"

# Log file
LOGFILE="/var/log/rsync-hooks.log"

# Log helper
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [post-upload] $*" >> "$LOGFILE"
}

log "Started: module=$RSYNC_MODULE_NAME client=$RSYNC_HOST_ADDR request=$RSYNC_REQUEST exit=$RSYNC_EXIT_STATUS"

# Only notify for successful uploads
if [ "$RSYNC_EXIT_STATUS" = "0" ]; then
    # Extract filename from request
    FILENAME=$(basename "$RSYNC_REQUEST")

    # Notify API about upload completion
    # For image files (.qcow2, .qdiff), API will auto-register them
    curl -s -X POST "${API_URL}/internal/rsync-event" \
        -H "Content-Type: application/json" \
        -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
        -d "{
            \"event\": \"post-upload\",
            \"module\": \"${RSYNC_MODULE_NAME}\",
            \"clientIp\": \"${RSYNC_HOST_ADDR}\",
            \"request\": \"${RSYNC_REQUEST}\",
            \"filename\": \"${FILENAME}\"
        }" 2>/dev/null || log "Failed to notify API"

    log "Upload successful: $FILENAME"
else
    log "Upload failed: exit=$RSYNC_EXIT_STATUS"
fi

log "Completed"

exit $RSYNC_EXIT_STATUS
