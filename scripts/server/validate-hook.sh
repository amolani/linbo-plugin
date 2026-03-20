#!/bin/bash
#
# LINBO Docker - Hook Validator
# Validates installed update-linbofs hooks for common issues:
# missing shebang, missing executable bit, invalid filenames,
# hardcoded WORKDIR paths, and missing set -e.
#
# Usage:
#   bash validate-hook.sh [hook-file]   # validate a single hook
#   bash validate-hook.sh --all         # validate all installed hooks
#
# Exit codes:
#   0 - All hooks passed (no FAILs)
#   1 - One or more hooks have FAILs
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HOOKSDIR="${HOOKSDIR:-/etc/linuxmuster/linbo/hooks}"
PRE_DIR="$HOOKSDIR/update-linbofs.pre.d"
POST_DIR="$HOOKSDIR/update-linbofs.post.d"

# Counters
TOTAL_CHECKED=0
TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_WARNINGS=0
HAS_ANY_FAIL=0

# ---------------------------------------------------------------------------
# Validation function
# ---------------------------------------------------------------------------

validate_hook() {
    local file="$1"
    local hook_failed=0
    local hook_warnings=0
    local hookname
    hookname=$(basename "$file")

    TOTAL_CHECKED=$((TOTAL_CHECKED + 1))
    echo "Checking: $hookname"

    # 1. Shebang check
    local first_line
    first_line=$(head -1 "$file" 2>/dev/null) || first_line=""
    case "$first_line" in
        "#!"*)
            echo "  OK: shebang ($first_line)"
            ;;
        *)
            echo "  FAIL: shebang -- missing (first line: ${first_line:-<empty>})"
            hook_failed=1
            ;;
    esac

    # 2. Executable bit
    if [ -x "$file" ]; then
        echo "  OK: executable"
    else
        echo "  FAIL: executable -- not set (fix: chmod +x $file)"
        hook_failed=1
    fi

    # 3. Filename validity (only alphanumeric, underscore, hyphen, dot)
    case "$hookname" in
        *[!a-zA-Z0-9_.-]*)
            echo "  FAIL: filename -- contains invalid characters (allowed: a-z A-Z 0-9 _ - .)"
            hook_failed=1
            ;;
        *)
            echo "  OK: filename"
            ;;
    esac

    # 4. Hardcoded WORKDIR paths (only /var/cache/linbo/linbofs patterns)
    local hardcoded_lines
    hardcoded_lines=$({ grep -v '^[[:space:]]*#' "$file" | grep -n '/var/cache/linbo/linbofs' || true; })
    if [ -n "$hardcoded_lines" ]; then
        echo "$hardcoded_lines" | while IFS= read -r line; do
            local lineno
            lineno=$(echo "$line" | cut -d: -f1)
            echo "  WARN: hardcoded WORKDIR path on line $lineno"
        done
        hook_warnings=$((hook_warnings + 1))
    else
        echo "  OK: no hardcoded WORKDIR paths"
    fi

    # 5. set -e check (only for bash/sh scripts)
    case "$first_line" in
        *bash*|*sh*)
            if { grep -q 'set -e' "$file" || true; } && grep -q 'set -e' "$file" 2>/dev/null; then
                echo "  OK: set -e present"
            else
                echo "  WARN: set -e not found (recommended for bash/sh hooks)"
                hook_warnings=$((hook_warnings + 1))
            fi
            ;;
    esac

    # Tally results
    if [ "$hook_failed" -gt 0 ]; then
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
        HAS_ANY_FAIL=1
    else
        TOTAL_PASSED=$((TOTAL_PASSED + 1))
    fi
    TOTAL_WARNINGS=$((TOTAL_WARNINGS + hook_warnings))
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo "=== LINBO Docker - Hook Validator ==="
echo ""

if [ "${1:-}" = "--all" ]; then
    # Scan both hook directories
    HOOK_FILES=""
    for dir in "$PRE_DIR" "$POST_DIR"; do
        if [ -d "$dir" ]; then
            found=$(find "$dir" -maxdepth 1 -type f -not -name '.*' 2>/dev/null | sort)
            if [ -n "$found" ]; then
                HOOK_FILES="${HOOK_FILES}${HOOK_FILES:+ }${found}"
            fi
        fi
    done

    if [ -z "$HOOK_FILES" ]; then
        echo "No hooks found in:"
        echo "  $PRE_DIR"
        echo "  $POST_DIR"
        echo ""
        echo "0 hooks checked, 0 passed, 0 failed, 0 warnings"
        exit 0
    fi

    for file in $HOOK_FILES; do
        validate_hook "$file"
    done
elif [ -n "${1:-}" ]; then
    # Validate a single file
    if [ ! -f "$1" ]; then
        echo "ERROR: File not found: $1"
        exit 1
    fi
    validate_hook "$1"
else
    echo "Usage: validate-hook.sh [hook-file]"
    echo "       validate-hook.sh --all"
    exit 1
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo "=== Summary ==="
echo "$TOTAL_CHECKED hooks checked, $TOTAL_PASSED passed, $TOTAL_FAILED failed, $TOTAL_WARNINGS warnings"

if [ "$HAS_ANY_FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
