#!/bin/bash
#
# LINBO Docker - RSYNC Pre-Download Hook
# Marks .cmd files for post-download deletion.
#

LOGFILE="/var/log/rsync-hooks.log"

# Mark .cmd files for post-download deletion
# RSYNC_REQUEST is only available in pre-download, not post-download.
EXT="${RSYNC_REQUEST##*.}"
if [ "$EXT" = "cmd" ]; then
    CMD_MARKER="/tmp/.rsync-cmd-delete.${RSYNC_PID}"
    echo "/srv/linbo/${RSYNC_REQUEST}" > "$CMD_MARKER"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [pre-download] Marked .cmd for deletion: /srv/linbo/${RSYNC_REQUEST}" >> "$LOGFILE"
fi

exit 0
