#!/bin/bash
#
# LINBO Docker - RSYNC Pre-Download Hook
# Notifies API before download starts
# Triggers macct repair jobs for image downloads
#
# Called by rsyncd before each download operation
#

# API configuration
API_URL="${API_URL:-http://linbo-api:3000/api/v1}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-linbo-internal-secret}"

# RSYNC environment variables (set by rsyncd)
# RSYNC_MODULE_NAME - Module name (linbo, linbo-upload)
# RSYNC_HOST_ADDR   - Client IP address
# RSYNC_REQUEST     - Requested file path
# RSYNC_PID         - Process ID
# RSYNC_HOST_NAME   - Client hostname (if reverse DNS works)

# Log file
LOGFILE="/var/log/rsync-hooks.log"

# Log helper
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [pre-download] $*" >> "$LOGFILE"
}

log "Started: module=$RSYNC_MODULE_NAME client=$RSYNC_HOST_ADDR request=$RSYNC_REQUEST"

# Notify API about rsync event
curl -s -X POST "${API_URL}/internal/rsync-event" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
    -d "{
        \"event\": \"pre-download\",
        \"module\": \"${RSYNC_MODULE_NAME}\",
        \"clientIp\": \"${RSYNC_HOST_ADDR}\",
        \"request\": \"${RSYNC_REQUEST}\"
    }" 2>/dev/null || log "Failed to notify API (rsync-event)"

# =============================================================================
# Machine Account (macct) Job Trigger
# =============================================================================
# Trigger macct repair when downloading images (.qcow2, .qdiff)
# This ensures the machine account password is synchronized before image sync

# Get file extension from request
EXT="${RSYNC_REQUEST##*.}"

# Check if this is an image download that should trigger macct repair
case "$EXT" in
    qcow2|qdiff)
        log "Image download detected, triggering macct job"

        # Try to get hostname - prefer RSYNC_HOST_NAME, fallback to lookup
        HOSTNAME="${RSYNC_HOST_NAME:-}"

        # If no hostname, try to look it up from the API via IP
        if [[ -z "$HOSTNAME" ]]; then
            # Query API for hostname by IP
            HOSTNAME=$(curl -s "${API_URL}/internal/config/${RSYNC_HOST_ADDR}" \
                -H "X-Internal-Key: ${INTERNAL_API_KEY}" 2>/dev/null \
                | grep -o '"hostname":"[^"]*"' | cut -d'"' -f4)
        fi

        if [[ -n "$HOSTNAME" ]]; then
            # Create macct repair job
            MACCT_RESULT=$(curl -s -X POST "${API_URL}/internal/macct-job" \
                -H "Content-Type: application/json" \
                -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
                -d "{
                    \"host\": \"${HOSTNAME}\",
                    \"school\": \"default-school\"
                }" 2>/dev/null)

            log "Macct job created: $MACCT_RESULT"
        else
            log "Could not determine hostname for ${RSYNC_HOST_ADDR}, skipping macct"
        fi
        ;;
    macct)
        # Direct .macct file request - trigger macct job
        log ".macct file requested, triggering macct job"

        # Extract hostname from the request path (e.g., /linbocmd/hostname.macct)
        BASENAME=$(basename "$RSYNC_REQUEST" .macct)

        if [[ -n "$BASENAME" && "$BASENAME" != "*" ]]; then
            MACCT_RESULT=$(curl -s -X POST "${API_URL}/internal/macct-job" \
                -H "Content-Type: application/json" \
                -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
                -d "{
                    \"host\": \"${BASENAME}\",
                    \"school\": \"default-school\"
                }" 2>/dev/null)

            log "Macct job created: $MACCT_RESULT"
        fi
        ;;
esac

log "Completed: exit=$RSYNC_EXIT_STATUS"

exit $RSYNC_EXIT_STATUS
