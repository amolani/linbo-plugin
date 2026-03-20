#!/bin/bash
#
# LINBO Docker - linbofs64 Audit
# Inspects the contents of a built linbofs64 archive and reports:
# kernel version, module count, SSH key fingerprints, firmware files,
# hook-modified files, device nodes, and summary totals.
#
# Usage:
#   bash linbofs-audit.sh                # or: make linbofs-audit
#
# Exit codes:
#   0 - Audit completed successfully
#   1 - linbofs64 not found
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LINBO_DIR="${LINBO_DIR:-/srv/linbo}"
LINBOFS="$LINBO_DIR/linbofs64"
TEMPLATE="/var/lib/linuxmuster/linbo/current/linbofs64.xz"

# ---------------------------------------------------------------------------
# Prerequisite check
# ---------------------------------------------------------------------------

if [ ! -f "$LINBOFS" ]; then
    echo "ERROR: linbofs64 not found at $LINBOFS"
    echo ""
    echo "The linbofs64 boot image has not been built yet."
    echo "Run 'update-linbofs.sh' or trigger a rebuild via the API."
    exit 1
fi

# ---------------------------------------------------------------------------
# Temp directory with cleanup
# ---------------------------------------------------------------------------

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

# Generate file listing once (used by multiple sections)
xzcat "$LINBOFS" | cpio -t 2>/dev/null > "$TMPDIR/filelist.txt" || true
TOTAL_FILES=$(wc -l < "$TMPDIR/filelist.txt")

# ===================================================================
# Header
# ===================================================================

echo "=== LINBO Docker - linbofs64 Audit ==="
echo "Date: $(date)"
echo "File: $LINBOFS"
echo ""

# ===================================================================
# Archive Info
# ===================================================================

echo "=== Archive Info ==="
FILE_SIZE=$(stat -c%s "$LINBOFS")
# Human-readable size (awk fallback for Alpine BusyBox which lacks numfmt)
FILE_SIZE_HR=$(numfmt --to=iec-i --suffix=B "$FILE_SIZE" 2>/dev/null || \
    awk "BEGIN { s=$FILE_SIZE; u=\"B\"; if(s>1024){s/=1024;u=\"KiB\"} if(s>1024){s/=1024;u=\"MiB\"} if(s>1024){s/=1024;u=\"GiB\"} printf \"%.1f%s\n\",s,u }")
FILE_MD5=$(md5sum "$LINBOFS" | awk '{print $1}')
FILE_MTIME=$(stat -c%y "$LINBOFS" 2>/dev/null | cut -d. -f1)
echo "  Size:     $FILE_SIZE_HR ($FILE_SIZE bytes)"
echo "  MD5:      $FILE_MD5"
echo "  Modified: $FILE_MTIME"
echo ""

# ===================================================================
# Kernel
# ===================================================================

echo "=== Kernel ==="
# Extract kernel version from module paths (BusyBox-compatible, no -P flag)
KVER=$(grep '^lib/modules/[0-9]' "$TMPDIR/filelist.txt" | head -1 | sed 's|^lib/modules/||; s|/.*||' || true)
if [ -n "$KVER" ]; then
    echo "  Version: $KVER"
else
    echo "  Version: not found (no modules injected)"
fi

# Count modules (BusyBox-compatible: avoid grep -c which exits 1 on 0 matches)
MOD_COUNT=$({ grep '\.ko$' "$TMPDIR/filelist.txt" || true; } | wc -l)
MOD_COUNT_XZ=$({ grep '\.ko\.xz$' "$TMPDIR/filelist.txt" || true; } | wc -l)
MOD_TOTAL=$((MOD_COUNT + MOD_COUNT_XZ))
echo "  Modules: $MOD_COUNT .ko + $MOD_COUNT_XZ .ko.xz = $MOD_TOTAL total"
echo ""

# ===================================================================
# SSH Keys
# ===================================================================

echo "=== SSH Keys ==="

# Extract keys to temp directory for fingerprinting
xzcat "$LINBOFS" | (cd "$TMPDIR" && cpio -i -d -H newc --no-absolute-filenames \
    'etc/ssh/ssh_host_*_key' \
    'etc/dropbear/dropbear_*_host_key' \
    2>/dev/null) || true

SSH_KEY_COUNT=0

# OpenSSH host keys
for key in "$TMPDIR"/etc/ssh/ssh_host_*_key; do
    [ -f "$key" ] || continue
    SSH_KEY_COUNT=$((SSH_KEY_COUNT + 1))
    FP=$(ssh-keygen -lf "$key" 2>/dev/null) && echo "  $FP" || echo "  (unreadable: $(basename "$key"))"
done

# Dropbear host keys
for key in "$TMPDIR"/etc/dropbear/dropbear_*_host_key; do
    [ -f "$key" ] || continue
    SSH_KEY_COUNT=$((SSH_KEY_COUNT + 1))
    KEYNAME=$(basename "$key")
    # Try dropbearkey -> ssh-keygen pipeline for fingerprint
    if command -v dropbearkey &>/dev/null; then
        PUB=$(dropbearkey -y -f "$key" 2>/dev/null | grep -E '^(ssh-|ecdsa-)') || PUB=""
        if [ -n "$PUB" ]; then
            FP=$(echo "$PUB" | ssh-keygen -lf - 2>/dev/null) && echo "  $FP (dropbear)" || echo "  Dropbear: $KEYNAME ($(stat -c%s "$key") bytes)"
        else
            echo "  Dropbear: $KEYNAME ($(stat -c%s "$key") bytes)"
        fi
    else
        echo "  Dropbear: $KEYNAME ($(stat -c%s "$key") bytes)"
    fi
done

if [ "$SSH_KEY_COUNT" -eq 0 ]; then
    echo "  No SSH keys found"
fi
echo ""

# ===================================================================
# Firmware
# ===================================================================

echo "=== Firmware ==="
FW_FILES=$(grep '^lib/firmware/' "$TMPDIR/filelist.txt" | grep -v '/$' || true)
if [ -z "$FW_FILES" ]; then FW_COUNT=0; else FW_COUNT=$(echo "$FW_FILES" | wc -l); fi
echo "  Files: $FW_COUNT"
if [ "$FW_COUNT" -gt 0 ]; then
    echo "$FW_FILES" | sed 's/^/  /'
fi
echo ""

# ===================================================================
# Hook-Modified Files
# ===================================================================

echo "=== Hook-Modified Files ==="
if [ -f "$TEMPLATE" ]; then
    # Generate template file list
    xzcat "$TEMPLATE" | cpio -t 2>/dev/null | sort > "$TMPDIR/template.list" || true
    sort "$TMPDIR/filelist.txt" > "$TMPDIR/built.list"

    # Files only in built (ADDED by Docker pipeline + hooks)
    ADDED=$(comm -13 "$TMPDIR/template.list" "$TMPDIR/built.list" || true)
    if [ -z "$ADDED" ]; then ADDED_COUNT=0; else ADDED_COUNT=$(echo "$ADDED" | wc -l); fi

    echo "  ADDED by Docker pipeline + hooks: $ADDED_COUNT files"
    if [ "$ADDED_COUNT" -gt 0 ] && [ "$ADDED_COUNT" -le 50 ]; then
        echo "$ADDED" | sed 's/^/    /'
    elif [ "$ADDED_COUNT" -gt 50 ]; then
        echo "$ADDED" | head -20 | sed 's/^/    /'
        echo "    ... and $((ADDED_COUNT - 20)) more"
    fi
else
    echo "  Template not available -- cannot determine hook modifications."
    echo "  (Template path: $TEMPLATE)"
fi
echo ""

# ===================================================================
# Device Nodes
# ===================================================================

echo "=== Device Nodes ==="
DEV_ENTRIES=$(grep '^dev/' "$TMPDIR/filelist.txt" || true)
if [ -z "$DEV_ENTRIES" ]; then DEV_COUNT=0; else DEV_COUNT=$(echo "$DEV_ENTRIES" | wc -l); fi
echo "  Count: $DEV_COUNT"
if [ "$DEV_COUNT" -gt 0 ]; then
    echo "$DEV_ENTRIES" | sed 's/^/  /'
fi
echo ""

# ===================================================================
# Summary
# ===================================================================

echo "=== Summary ==="
echo "  Total files:    $TOTAL_FILES"
echo "  Kernel modules: $MOD_TOTAL"
echo "  Firmware files: $FW_COUNT"
echo "  SSH keys:       $SSH_KEY_COUNT"
echo "  Device nodes:   $DEV_COUNT"
echo ""

exit 0
