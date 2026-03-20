#!/bin/bash
#
# LINBO Docker - RSYNC Post-Download Hook
# Deletes .cmd files marked by pre-download hook (one-shot onboot commands).
#

LOGFILE="/var/log/rsync-hooks.log"

# .cmd file cleanup — read marker from pre-download hook
CMD_MARKER="/tmp/.rsync-cmd-delete.${RSYNC_PID}"
if [ -f "$CMD_MARKER" ]; then
    CMD_FILE=$(cat "$CMD_MARKER")
    rm -f "$CMD_MARKER"
    if [ -n "$CMD_FILE" ] && [ -f "$CMD_FILE" ]; then
        rm -f "$CMD_FILE"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [post-download] Deleted onboot cmd: $CMD_FILE" >> "$LOGFILE"
    fi
fi

exit 0
