#!/bin/bash
set -e

MARKER="/srv/linbo/.linbofs-patch-status"
TIMEOUT=300  # 5 minutes max wait

# If linbofs64 is already built (existing installation), start immediately
if [ -f "$MARKER" ]; then
    echo "TFTP: linbofs64 ready, starting."
    exec "$@"
fi

# Fresh deploy: wait until API has built linbofs64
echo "TFTP: Waiting for linbofs64 build (max ${TIMEOUT}s)..."
elapsed=0
while [ ! -f "$MARKER" ] && [ $elapsed -lt $TIMEOUT ]; do
    sleep 2
    elapsed=$((elapsed + 2))
done

if [ -f "$MARKER" ]; then
    echo "TFTP: linbofs64 ready after ${elapsed}s, starting."
else
    echo "TFTP: WARNING — timeout after ${TIMEOUT}s, starting with existing linbofs64!"
fi

exec "$@"
