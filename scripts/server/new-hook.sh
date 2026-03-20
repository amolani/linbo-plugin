#!/bin/bash
#
# LINBO Docker - Hook Scaffold Generator
# Creates a new update-linbofs hook with proper template, documentation,
# and error handling.
#
# Usage:
#   bash new-hook.sh HOOKNAME [pre|post]
#
# Examples:
#   bash new-hook.sh 02_custom-patch pre
#   bash new-hook.sh 01_notify post
#
# Exit codes:
#   0 - Hook created successfully
#   1 - Invalid arguments or hook already exists
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HOOKSDIR="${HOOKSDIR:-/etc/linuxmuster/linbo/hooks}"

# ---------------------------------------------------------------------------
# Argument validation
# ---------------------------------------------------------------------------

NAME="${1:-}"
TYPE="${2:-pre}"

if [ -z "$NAME" ]; then
    echo "Usage: new-hook.sh HOOKNAME [pre|post]"
    echo ""
    echo "  HOOKNAME  Hook filename (alphanumeric, underscore, hyphen only)"
    echo "  TYPE      Hook type: pre (before repack) or post (after repack)"
    echo "            Default: pre"
    exit 1
fi

# Validate hook name (alphanumeric + underscore + hyphen only)
case "$NAME" in
    *[!a-zA-Z0-9_-]*)
        echo "ERROR: Invalid hook name '$NAME'"
        echo "Only alphanumeric characters, underscores, and hyphens are allowed."
        exit 1
        ;;
esac

# Validate type
case "$TYPE" in
    pre|post) ;;
    *)
        echo "ERROR: Invalid type '$TYPE' (must be 'pre' or 'post')"
        exit 1
        ;;
esac

# Target directory and file
TARGET_DIR="$HOOKSDIR/update-linbofs.${TYPE}.d"
TARGET_FILE="$TARGET_DIR/$NAME"

# Check if hook already exists
if [ -f "$TARGET_FILE" ]; then
    echo "ERROR: Hook already exists: $TARGET_FILE"
    echo "Remove it first or choose a different name."
    exit 1
fi

# Ensure target directory exists
mkdir -p "$TARGET_DIR"

# ---------------------------------------------------------------------------
# Determine description based on type
# ---------------------------------------------------------------------------

if [ "$TYPE" = "pre" ]; then
    TIMING="BEFORE"
    CWD_NOTE="Pre-hooks: CWD is the extracted linbofs root. Use relative paths
#   (e.g., usr/share/...) to modify linbofs contents."
else
    TIMING="AFTER"
    CWD_NOTE="Post-hooks: CWD is still the extracted linbofs root but repack
#   is already done. Use for notifications, cleanup, etc."
fi

# ---------------------------------------------------------------------------
# Create hook from template
# ---------------------------------------------------------------------------

CREATE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$TARGET_FILE" <<HOOKTEMPLATE
#!/bin/bash
#
# Hook: $NAME
# Type: $TYPE (runs $TIMING linbofs64 repack)
# Created: $CREATE_DATE
#
# Available exported variables:
#   LINBO_DIR   - LINBO base directory (/srv/linbo)
#   CONFIG_DIR  - LINBO config directory (/etc/linuxmuster/linbo)
#   CACHE_DIR   - Cache directory (/var/cache/linbo)
#   KTYPE       - Kernel variant (stable/longterm/legacy)
#   KVERS       - Kernel version string
#   WORKDIR     - Extracted linbofs root (CWD for pre-hooks)
#
# $CWD_NOTE
#

set -e

echo "Running hook: $NAME"

# --- Your hook logic below ---

HOOKTEMPLATE

chmod +x "$TARGET_FILE"

echo "Created hook: $TARGET_FILE"
echo "Validate with: make validate-hooks"
