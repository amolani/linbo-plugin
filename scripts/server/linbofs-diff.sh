#!/bin/bash
#
# LINBO Docker - linbofs64 Diff
# Compares the template linbofs64.xz (upstream LMN) with the built linbofs64
# (Docker pipeline output) and shows categorized added/removed files.
#
# Usage:
#   bash linbofs-diff.sh                # or: make linbofs-diff
#
# Exit codes:
#   0 - Diff completed successfully
#   1 - Template or built linbofs64 not found
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LINBO_DIR="${LINBO_DIR:-/srv/linbo}"
BUILT="$LINBO_DIR/linbofs64"
TEMPLATE="/var/lib/linuxmuster/linbo/current/linbofs64.xz"

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

if [ ! -f "$TEMPLATE" ]; then
    echo "ERROR: Template not found at $TEMPLATE"
    echo ""
    echo "Template linbofs64.xz is provisioned by the init container."
    echo "Run 'docker compose up init' to provision kernel and template files."
    exit 1
fi

if [ ! -f "$BUILT" ]; then
    echo "ERROR: Built linbofs64 not found at $BUILT"
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

# ===================================================================
# Header
# ===================================================================

echo "=== LINBO Docker - linbofs64 Diff ==="
echo "Date: $(date)"
echo ""

# ===================================================================
# File Sizes
# ===================================================================

echo "=== File Sizes ==="
TMPL_SIZE=$(stat -c%s "$TEMPLATE")
# Human-readable size (awk fallback for Alpine BusyBox which lacks numfmt)
TMPL_SIZE_HR=$(numfmt --to=iec-i --suffix=B "$TMPL_SIZE" 2>/dev/null || \
    awk "BEGIN { s=$TMPL_SIZE; u=\"B\"; if(s>1024){s/=1024;u=\"KiB\"} if(s>1024){s/=1024;u=\"MiB\"} if(s>1024){s/=1024;u=\"GiB\"} printf \"%.1f%s\n\",s,u }")
BUILT_SIZE=$(stat -c%s "$BUILT")
BUILT_SIZE_HR=$(numfmt --to=iec-i --suffix=B "$BUILT_SIZE" 2>/dev/null || \
    awk "BEGIN { s=$BUILT_SIZE; u=\"B\"; if(s>1024){s/=1024;u=\"KiB\"} if(s>1024){s/=1024;u=\"MiB\"} if(s>1024){s/=1024;u=\"GiB\"} printf \"%.1f%s\n\",s,u }")
echo "  Template: $TMPL_SIZE_HR ($TEMPLATE)"
echo "  Built:    $BUILT_SIZE_HR ($BUILT)"
echo ""

# ===================================================================
# Generate file lists (cpio -t, NOT extraction -- fast and works for dev nodes)
# ===================================================================

xzcat "$TEMPLATE" | cpio -t 2>/dev/null | sort > "$TMPDIR/template.list" || true
xzcat "$BUILT"    | cpio -t 2>/dev/null | sort > "$TMPDIR/built.list" || true

TMPL_COUNT=$(wc -l < "$TMPDIR/template.list")
BUILT_COUNT=$(wc -l < "$TMPDIR/built.list")

# Compute added/removed/common
comm -13 "$TMPDIR/template.list" "$TMPDIR/built.list" > "$TMPDIR/added.list"
comm -23 "$TMPDIR/template.list" "$TMPDIR/built.list" > "$TMPDIR/removed.list"
comm -12 "$TMPDIR/template.list" "$TMPDIR/built.list" > "$TMPDIR/common.list"

ADDED_COUNT=$(wc -l < "$TMPDIR/added.list")
REMOVED_COUNT=$(wc -l < "$TMPDIR/removed.list")
COMMON_COUNT=$(wc -l < "$TMPDIR/common.list")

# ===================================================================
# ADDED (files only in built)
# ===================================================================

echo "=== ADDED ($ADDED_COUNT files only in built) ==="
echo ""

if [ "$ADDED_COUNT" -gt 0 ]; then
    # Categorize added files (wrap grep in { || true; } to handle pipefail
    # when grep finds 0 matches and exits 1)
    ADDED_MODULES=$({ grep -E '\.(ko|ko\.xz)$' "$TMPDIR/added.list" || true; } | wc -l)
    ADDED_FIRMWARE=$({ grep '^lib/firmware/' "$TMPDIR/added.list" || true; } | wc -l)
    ADDED_SSH=$({ grep -E '^(etc/ssh/|etc/dropbear/|\.ssh/)' "$TMPDIR/added.list" || true; } | wc -l)
    ADDED_THEMES=$({ grep '^themes/' "$TMPDIR/added.list" || true; } | wc -l)
    ADDED_OTHER=$((ADDED_COUNT - ADDED_MODULES - ADDED_FIRMWARE - ADDED_SSH - ADDED_THEMES))

    # Modules
    if [ "$ADDED_MODULES" -gt 0 ]; then
        echo "  Modules (.ko/.ko.xz): $ADDED_MODULES"
        if [ "$ADDED_MODULES" -le 20 ]; then
            grep -E '\.(ko|ko\.xz)$' "$TMPDIR/added.list" | sed 's/^/    /'
        else
            { grep -E '\.(ko|ko\.xz)$' "$TMPDIR/added.list" || true; } | head -10 | sed 's/^/    /'
            echo "    ... and $((ADDED_MODULES - 10)) more"
        fi
        echo ""
    fi

    # Firmware
    if [ "$ADDED_FIRMWARE" -gt 0 ]; then
        echo "  Firmware (lib/firmware/): $ADDED_FIRMWARE"
        if [ "$ADDED_FIRMWARE" -le 20 ]; then
            grep '^lib/firmware/' "$TMPDIR/added.list" | sed 's/^/    /'
        else
            { grep '^lib/firmware/' "$TMPDIR/added.list" || true; } | head -10 | sed 's/^/    /'
            echo "    ... and $((ADDED_FIRMWARE - 10)) more"
        fi
        echo ""
    fi

    # SSH keys
    if [ "$ADDED_SSH" -gt 0 ]; then
        echo "  SSH keys (etc/ssh/, etc/dropbear/, .ssh/): $ADDED_SSH"
        grep -E '^(etc/ssh/|etc/dropbear/|\.ssh/)' "$TMPDIR/added.list" | sed 's/^/    /'
        echo ""
    fi

    # Themes
    if [ "$ADDED_THEMES" -gt 0 ]; then
        echo "  Themes (themes/): $ADDED_THEMES"
        grep '^themes/' "$TMPDIR/added.list" | sed 's/^/    /'
        echo ""
    fi

    # Other
    if [ "$ADDED_OTHER" -gt 0 ]; then
        echo "  Other: $ADDED_OTHER"
        grep -vE '\.(ko|ko\.xz)$' "$TMPDIR/added.list" \
            | grep -v '^lib/firmware/' \
            | grep -vE '^(etc/ssh/|etc/dropbear/|\.ssh/)' \
            | grep -v '^themes/' \
            | sed 's/^/    /'
        echo ""
    fi
else
    echo "  (none)"
    echo ""
fi

# ===================================================================
# REMOVED (files only in template)
# ===================================================================

echo "=== REMOVED ($REMOVED_COUNT files only in template) ==="
echo ""

if [ "$REMOVED_COUNT" -gt 0 ]; then
    if [ "$REMOVED_COUNT" -le 30 ]; then
        cat "$TMPDIR/removed.list" | sed 's/^/  /'
    else
        head -20 "$TMPDIR/removed.list" | sed 's/^/  /'
        echo "  ... and $((REMOVED_COUNT - 20)) more"
    fi
    echo ""
else
    echo "  (none)"
    echo ""
fi

# ===================================================================
# Summary
# ===================================================================

echo "=== Summary ==="
echo "  Template files: $TMPL_COUNT"
echo "  Built files:    $BUILT_COUNT"
echo "  Added:          $ADDED_COUNT"
echo "  Removed:        $REMOVED_COUNT"
echo "  Common:         $COMMON_COUNT"
echo ""

exit 0
