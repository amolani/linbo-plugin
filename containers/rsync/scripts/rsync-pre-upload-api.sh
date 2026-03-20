#!/bin/bash
#
# LINBO Docker - RSYNC Pre-Upload Hook
# Creates directories for image uploads.
#

LOGFILE="/var/log/rsync-hooks.log"

FILE="${RSYNC_MODULE_PATH}/${RSYNC_REQUEST##$RSYNC_MODULE_NAME/}"
DIRNAME="$(dirname "$FILE")"
FILENAME=$(basename "$RSYNC_REQUEST")
EXT="${FILENAME##*.}"

# Traversal check
if [[ "$DIRNAME" != "$RSYNC_MODULE_PATH"* ]]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [pre-upload] SECURITY: path traversal blocked" >> "$LOGFILE"
    exit 0
fi

# Create directory before rsync writes
case "$EXT" in
    qcow2|qdiff|cloop|info|desc|torrent|macct|md5|reg|prestart|postsync)
        mkdir -p "$DIRNAME"
        ;;
esac

exit 0
