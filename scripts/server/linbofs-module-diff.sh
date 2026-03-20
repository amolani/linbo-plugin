#!/bin/bash
#
# LINBO Docker - linbofs64 Module Diff
# Compares kernel module lists between the Docker-built linbofs64 and a
# reference LMN-built linbofs64. Useful for diagnosing boot differences
# caused by differing module selections.
#
# Usage:
#   bash linbofs-module-diff.sh [path-to-lmn-linbofs64]
#   make module-diff
#
# The LMN reference file defaults to /srv/linbo/linbofs64.lmn-reference.
# Copy it from the LMN server:
#   scp root@10.0.0.11:/srv/linbo/linbofs64 /srv/linbo/linbofs64.lmn-reference
#
# Exit codes:
#   0 - Comparison completed (informational, always exits 0)
#   1 - Reference file not found
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LINBO_DIR="${LINBO_DIR:-/srv/linbo}"
DOCKER_LINBOFS="$LINBO_DIR/linbofs64"
LMN_LINBOFS="${1:-$LINBO_DIR/linbofs64.lmn-reference}"

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

if [ ! -f "$DOCKER_LINBOFS" ]; then
    echo "ERROR: Docker linbofs64 not found at $DOCKER_LINBOFS"
    exit 1
fi

if [ ! -f "$LMN_LINBOFS" ]; then
    echo "ERROR: LMN reference linbofs64 not found at $LMN_LINBOFS"
    echo ""
    echo "To create the reference file, copy it from the LMN server:"
    echo "  scp root@<lmn-server>:/srv/linbo/linbofs64 $LINBO_DIR/linbofs64.lmn-reference"
    echo ""
    echo "Or specify a custom path:"
    echo "  bash $0 /path/to/lmn-linbofs64"
    exit 1
fi

# ---------------------------------------------------------------------------
# Extract module lists
# ---------------------------------------------------------------------------

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

xzcat "$DOCKER_LINBOFS" | cpio -t 2>/dev/null | { grep '\.ko$' || true; } | sort > "$TMPDIR/docker-modules.txt"
xzcat "$LMN_LINBOFS"    | cpio -t 2>/dev/null | { grep '\.ko$' || true; } | sort > "$TMPDIR/lmn-modules.txt"

DOCKER_COUNT=$(wc -l < "$TMPDIR/docker-modules.txt")
LMN_COUNT=$(wc -l < "$TMPDIR/lmn-modules.txt")

# ---------------------------------------------------------------------------
# Compare
# ---------------------------------------------------------------------------

comm -23 "$TMPDIR/docker-modules.txt" "$TMPDIR/lmn-modules.txt" > "$TMPDIR/only-docker.txt"
comm -13 "$TMPDIR/docker-modules.txt" "$TMPDIR/lmn-modules.txt" > "$TMPDIR/only-lmn.txt"
comm -12 "$TMPDIR/docker-modules.txt" "$TMPDIR/lmn-modules.txt" > "$TMPDIR/common.txt"

ONLY_DOCKER=$(wc -l < "$TMPDIR/only-docker.txt")
ONLY_LMN=$(wc -l < "$TMPDIR/only-lmn.txt")
COMMON=$(wc -l < "$TMPDIR/common.txt")

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

echo "=== LINBO Module Diff ==="
echo "Docker linbofs64: $DOCKER_LINBOFS"
echo "LMN reference:    $LMN_LINBOFS"
echo ""

if [ "$ONLY_DOCKER" -gt 0 ]; then
    echo "Modules only in Docker ($ONLY_DOCKER):"
    while IFS= read -r mod; do
        echo "  + $mod"
    done < "$TMPDIR/only-docker.txt"
    echo ""
fi

if [ "$ONLY_LMN" -gt 0 ]; then
    echo "Modules only in LMN ($ONLY_LMN):"
    while IFS= read -r mod; do
        echo "  - $mod"
    done < "$TMPDIR/only-lmn.txt"
    echo ""
fi

if [ "$ONLY_DOCKER" -eq 0 ] && [ "$ONLY_LMN" -eq 0 ]; then
    echo "No differences found -- module lists are identical."
    echo ""
fi

echo "Common modules: $COMMON"
echo "Total: Docker=$DOCKER_COUNT, LMN=$LMN_COUNT"
