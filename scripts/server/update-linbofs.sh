#!/bin/bash
#
# LINBO Docker - Update-Linbofs Script
# Injects SSH-Keys, RSYNC-Password hash, and selected kernel modules into linbofs64
#
# Based on the original linuxmuster.net update-linbofs script
# Adapted for LINBO Docker standalone solution with kernel variant support
#
# LINBOFS64 ARCHIVE FORMAT
# ========================
# When invoked via fakeroot (default in Docker), the output is a SINGLE
# XZ-compressed CPIO archive — identical to the native LMN build.
# fakeroot emulates root permissions so device nodes (dev/console, dev/null)
# are created during extraction and included naturally in the archive.
#
# Without fakeroot (legacy fallback), the output consists of TWO concatenated
# XZ-compressed CPIO segments:
#   Segment 1: Main filesystem (--owner 0:0 for root ownership)
#   Segment 2: Device nodes (pre-built CPIO fragment, appended separately)
#
# To inspect the archive:
#   xzcat linbofs64 | cpio -t          # lists ALL files
#   xzcat linbofs64 | cpio -i -d       # extracts ALL files
#
# See also: docs/UNTERSCHIEDE-ZU-LINBO.md (divergence #5: CPIO format)
#

set -e

# =============================================================================
# Build mode detection (fakeroot vs non-root)
# =============================================================================

if [ -n "$FAKEROOTKEY" ]; then
    BUILD_MODE="fakeroot"
else
    BUILD_MODE="nonroot"
fi

# =============================================================================
# Configuration
# =============================================================================

LINBO_DIR="${LINBO_DIR:-/srv/linbo}"
CONFIG_DIR="${CONFIG_DIR:-/etc/linuxmuster/linbo}"
CACHE_DIR="/var/cache/linbo"
KERNEL_VAR_DIR="${KERNEL_VAR_DIR:-/var/lib/linuxmuster/linbo/current}"
HOOKSDIR="${HOOKSDIR:-/etc/linuxmuster/linbo/hooks}"

# Files
LINBOFS="$LINBO_DIR/linbofs64"
RSYNC_SECRETS="${RSYNC_SECRETS:-$CONFIG_DIR/rsyncd.secrets}"
CUSTOM_KERNEL_FILE="$CONFIG_DIR/custom_kernel"
LINBOFS_TEMPLATE="$KERNEL_VAR_DIR/linbofs64.xz"

echo "=== LINBO Docker Update-Linbofs ==="
echo "Date: $(date)"
echo "Build mode: $BUILD_MODE (uid $(id -u))"
if [ "$BUILD_MODE" = "nonroot" ]; then
    echo "  WARNING: Running without fakeroot — using legacy two-segment archive."
    echo "  Install fakeroot for production-quality builds."
fi
echo ""

# =============================================================================
# Lockfile handling (flock-based for shared volume safety)
# =============================================================================

REBUILD_LOCK="${CONFIG_DIR}/.rebuild.lock"
exec 8>"$REBUILD_LOCK"
if ! flock -n 8; then
    echo "ERROR: Another update-linbofs process is running!"
    echo "If this is not the case, the lock will be released when the process exits."
    exit 1
fi
# Lock is held until script exits (fd 8 is closed automatically)

# =============================================================================
# Validate prerequisites
# =============================================================================

# Check for linbofs64 (or template for first build)
if [ ! -f "$LINBOFS" ]; then
    if [ -f "$LINBOFS_TEMPLATE" ]; then
        echo "First build: $LINBOFS not found, will build from template"
        echo "  Template: $LINBOFS_TEMPLATE"
        # Create a placeholder so backup step and extraction work
        xzcat "$LINBOFS_TEMPLATE" > "$LINBOFS"
        FIRST_BUILD=true
    else
        echo "ERROR: $LINBOFS not found and no template available!"
        echo "Please run the init container first to provision boot files."
        exit 1
    fi
fi

# Check for rsync secrets
if [ ! -s "$RSYNC_SECRETS" ]; then
    echo "ERROR: $RSYNC_SECRETS not found or empty!"
    exit 1
fi

# Check for required tools
for tool in xz cpio argon2; do
    if ! command -v $tool &> /dev/null; then
        echo "ERROR: Required tool '$tool' not found!"
        exit 1
    fi
done

# =============================================================================
# Hook support (compatible with linuxmuster.net update-linbofs hooks)
# =============================================================================
# Hooks are executable scripts in:
#   $HOOKSDIR/update-linbofs.pre.d/   — run BEFORE repack (CWD = extracted linbofs)
#   $HOOKSDIR/update-linbofs.post.d/  — run AFTER repack (CWD = extracted linbofs)
# Scripts are executed in sorted order. Key variables (LINBO_DIR, CONFIG_DIR,
# KTYPE, KVERS, WORKDIR) are exported so hooks can use them.

# Hook observability counters (accumulated across pre + post hooks)
HOOK_RESULTS=""
HOOK_WARNINGS=0
HOOK_COUNT=0
HOOK_WARNING_DETAIL=""

exec_hooks() {
    case "$1" in
        pre|post) ;;
        *) return ;;
    esac
    local hookdir="$HOOKSDIR/update-linbofs.$1.d"
    [ -d "$hookdir" ] || return 0
    local hook_files
    hook_files=$(find "$hookdir" -type f -executable 2>/dev/null | sort)
    [ -z "$hook_files" ] && return 0
    local file hookname exit_code files_before files_after files_delta
    for file in $hook_files; do
        hookname=$(basename "$file")
        echo "Executing $1 hook: $hookname"

        # Count files before hook
        files_before=$(find . -type f 2>/dev/null | wc -l)

        # Run hook, capture exit code (safe under set -e)
        "$file" && exit_code=0 || exit_code=$?

        # Count files after hook
        files_after=$(find . -type f 2>/dev/null | wc -l)
        files_delta=$((files_after - files_before))

        if [ "$exit_code" -ne 0 ]; then
            echo "  WARNING: hook $hookname exited with $exit_code"
            HOOK_WARNINGS=$((HOOK_WARNINGS + 1))
            HOOK_WARNING_DETAIL="${HOOK_WARNING_DETAIL}${hookname}(exit=${exit_code}) "
        fi

        # Accumulate JSON entries (comma-separated)
        if [ -n "$HOOK_RESULTS" ]; then
            HOOK_RESULTS="${HOOK_RESULTS},"
        fi
        HOOK_RESULTS="${HOOK_RESULTS}{\"name\":\"${hookname}\",\"type\":\"$1\",\"exitCode\":${exit_code},\"filesDelta\":${files_delta}}"

        HOOK_COUNT=$((HOOK_COUNT + 1))
    done
}

write_build_manifest() {
    local manifest_tmp manifest_path build_ts kvers_val
    manifest_path="${LINBO_DIR}/.linbofs-build-manifest.json"
    manifest_tmp="${manifest_path}.tmp"
    build_ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    kvers_val="${KVERS:-unknown}"

    printf '{\n' > "$manifest_tmp"
    printf '  "buildTimestamp": "%s",\n' "$build_ts" >> "$manifest_tmp"
    printf '  "buildMode": "%s",\n' "$BUILD_MODE" >> "$manifest_tmp"
    printf '  "kernelVariant": "%s",\n' "$KTYPE" >> "$manifest_tmp"
    printf '  "kernelVersion": "%s",\n' "$kvers_val" >> "$manifest_tmp"
    printf '  "hookCount": %d,\n' "$HOOK_COUNT" >> "$manifest_tmp"
    printf '  "hookWarnings": %d,\n' "$HOOK_WARNINGS" >> "$manifest_tmp"
    printf '  "hooks": [%s]\n' "$HOOK_RESULTS" >> "$manifest_tmp"
    printf '}\n' >> "$manifest_tmp"

    mv "$manifest_tmp" "$manifest_path"
    chmod 644 "$manifest_path"
    echo "Build manifest: $manifest_path"
}

# =============================================================================
# Step 1: Read kernel variant from custom_kernel
# =============================================================================

KTYPE="stable"

if [ -s "$CUSTOM_KERNEL_FILE" ]; then
    # Tolerant parsing: ignore comments, quotes, whitespace, take last KERNELPATH=
    KPATH=$(grep -E '^[[:space:]]*KERNELPATH=' "$CUSTOM_KERNEL_FILE" 2>/dev/null | tail -1 | sed 's/.*=//;s/[" ]//g')
    case "$KPATH" in
        legacy|longterm|stable) KTYPE="$KPATH" ;;
        "") KTYPE="stable" ;;
        *) echo "ERROR: Invalid KERNELPATH '$KPATH' in custom_kernel"; exit 1 ;;
    esac
fi

echo "Kernel variant: $KTYPE"

# =============================================================================
# Step 2: Validate kernel variant directory (if available)
# =============================================================================

VARIANT_DIR="$KERNEL_VAR_DIR/$KTYPE"
HAS_KERNEL_VARIANT=false

if [ -d "$VARIANT_DIR" ]; then
    MISSING_VARIANT_FILES=""
    for f in linbo64 modules.tar.xz version; do
        if [ ! -f "$VARIANT_DIR/$f" ]; then
            MISSING_VARIANT_FILES="$MISSING_VARIANT_FILES $f"
        fi
    done

    if [ -n "$MISSING_VARIANT_FILES" ]; then
        echo "WARNING: Incomplete variant '$KTYPE': missing$MISSING_VARIANT_FILES"
        echo "Proceeding without kernel module injection"
    else
        HAS_KERNEL_VARIANT=true
        KVERS=$(cat "$VARIANT_DIR/version")
        echo "Kernel version: $KVERS"
    fi
else
    echo "INFO: Kernel variant directory not found ($VARIANT_DIR)"
    echo "Proceeding without kernel module injection"
    echo "(This is normal for setups without kernel variant provisioning)"
fi

# =============================================================================
# Step 3: Read and hash RSYNC password
# =============================================================================

linbo_passwd="$(grep ^linbo "$RSYNC_SECRETS" | awk -F: '{print $2}')"
if [ -z "$linbo_passwd" ]; then
    echo "ERROR: Cannot read linbo password from $RSYNC_SECRETS!"
    exit 1
fi

echo -n "Hashing linbo password... "
linbo_salt="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
linbo_pwhash="$(echo "$linbo_passwd" | argon2 "$linbo_salt" -t 1000 | grep ^Hash | awk '{print $2}')"

if [ -z "$linbo_pwhash" ] || [ -z "$linbo_salt" ]; then
    echo "FAILED"
    echo "ERROR: Password hashing failed!"
    exit 1
fi
echo "OK"

# =============================================================================
# Step 4: Prepare work directory (unique per run)
# =============================================================================

WORKDIR=$(mktemp -d "${CACHE_DIR}/linbofs-build.XXXXXX")
DEVNODES_CPIO=""
if [ "$BUILD_MODE" = "nonroot" ]; then
    DEVNODES_CPIO=$(mktemp "${CACHE_DIR}/devnodes.XXXXXX")
fi
trap 'rm -rf "$WORKDIR"; [ -n "$DEVNODES_CPIO" ] && rm -f "$DEVNODES_CPIO"' EXIT

echo "Work directory: $WORKDIR"

# =============================================================================
# Step 5: Create backup
# =============================================================================

echo "Creating backup: ${LINBOFS}.bak"
cp "$LINBOFS" "${LINBOFS}.bak"

# =============================================================================
# Step 6: Extract linbofs64 template or current linbofs64
# =============================================================================

cd "$WORKDIR"

EXTRACT_SRC=""
if [ -f "$LINBOFS_TEMPLATE" ]; then
    echo "Extracting linbofs template (linbofs64.xz)..."
    EXTRACT_SRC="$LINBOFS_TEMPLATE"
else
    echo "WARNING: linbofs64.xz template not found, using current linbofs64"
    EXTRACT_SRC="$LINBOFS"
fi
EXTRACT_ERR=$(xzcat "$EXTRACT_SRC" | cpio -i -d -H newc --no-absolute-filenames 2>&1) || true
if [ -n "$EXTRACT_ERR" ]; then
    # Filter harmless cpio messages: block counts, empty member name, "newer" skips
    REAL_ERRORS=$(echo "$EXTRACT_ERR" | grep -v -E '^[0-9]+ blocks$|Substituting.*empty member|not created: newer' || true)
    if [ -n "$REAL_ERRORS" ]; then
        echo "  INFO: Extraction messages:"
        echo "$REAL_ERRORS" | head -5
    fi
fi

# Verify extraction produced files
if [ ! -d "$WORKDIR/bin" ] || [ ! -d "$WORKDIR/etc" ]; then
    echo "ERROR: Failed to extract linbofs — bin/ or etc/ directory missing!"
    exit 1
fi
echo "Extract OK ($(find "$WORKDIR" -type f | wc -l) files)"

# =============================================================================
# Step 6.5: Pre-injection path validation
# =============================================================================
# Validate that the extracted linbofs64 template has the expected directory
# structure. Subsequent steps use mkdir -p which would mask a changed upstream
# structure — catch it early before any injection occurs.

echo "Validating linbofs64 internal structure..."
VALIDATION_FAIL=0
for required_dir in bin etc; do
    if [ ! -d "$required_dir" ]; then
        echo "ERROR: Required directory '$required_dir' not found in extracted linbofs64."
        echo "  Expected at: $WORKDIR/$required_dir"
        echo "  The linbo7 package may have changed its internal directory structure."
        VALIDATION_FAIL=1
    fi
done
if [ "$VALIDATION_FAIL" -ne 0 ]; then
    exit 1
fi
echo "  - Structure validation: OK"

if [ "$BUILD_MODE" = "fakeroot" ]; then
    # fakeroot: device nodes were created during extraction (mknod emulated)
    if [ -c dev/console ] && [ -c dev/null ]; then
        echo "  - Device nodes: present (fakeroot extraction)"
    else
        echo "  WARNING: Device nodes missing despite fakeroot — creating manually"
        mkdir -p dev
        mknod -m 600 dev/console c 5 1 2>/dev/null || true
        mknod -m 666 dev/null c 1 3 2>/dev/null || true
    fi
else
    # Non-root: prepare pre-built CPIO fragment for append during repack
    echo "MDcwNzAxMDAyNEE0QzcwMDAwNDFFRDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMjY5QTlBRDQ0MDAwMDAwMDAwMDAwMDA4MDAwMDAwMDIwMDAwMDAwMDAwMDAwMDAwMDAwMDA0MDAwMDAwMDBkZXYAAAAwNzA3MDEwMDI0QTRDODAwMDAyMTgwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAxNjlBOUFENDQwMDAwMDAwMDAwMDAwMDA4MDAwMDAwMjAwMDAwMDA1MDAwMDAwMDEwMDAwMDAwQzAwMDAwMDAwZGV2L2NvbnNvbGUAAAAwNzA3MDEwMDI0QTRDOTAwMDAyMUI2MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDE2OUE5QUQ0NDAwMDAwMDAwMDAwMDAwODAwMDAwMDIwMDAwMDAwMTAwMDAwMDAzMDAwMDAwMDkwMDAwMDAwMGRldi9udWxsAAAwNzA3MDEwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAxMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMEIwMDAwMDAwMFRSQUlMRVIhISEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
        | base64 -d > "$DEVNODES_CPIO"
    echo "  - Device nodes fragment prepared (non-root fallback)"
fi

# =============================================================================
# Step 7: Inject kernel modules (if variant available)
# =============================================================================

if [ "$HAS_KERNEL_VARIANT" = "true" ]; then
    echo "Injecting kernel modules from variant '$KTYPE'..."

    # Ensure lib/modules exists
    mkdir -p lib/modules
    # NOTE: Do NOT rm -rf lib/modules/* here! LMN's update-linbofs extracts
    # variant modules ON TOP of the template's modules. The template contains
    # essential supporting modules that modules.tar.xz may not include.
    # Removing them causes "remote control mode" on clients.

    # Tar safety: check for path traversal
    if tar tf "$VARIANT_DIR/modules.tar.xz" | grep -qE '(^/|\.\.)'; then
        echo "ERROR: modules.tar.xz contains absolute paths or .. segments — refusing to extract"
        exit 1
    fi

    # Extract modules
    tar xf "$VARIANT_DIR/modules.tar.xz"

    # Validate: exactly one lib/modules/<kver> directory
    MOD_DIRS=$(ls -d lib/modules/*/ 2>/dev/null | wc -l)
    if [ "$MOD_DIRS" -ne 1 ]; then
        echo "ERROR: Expected exactly 1 modules directory, found $MOD_DIRS"
        exit 1
    fi

    MOD_KVER=$(basename $(ls -d lib/modules/*/))

    # Sanity check on module version format
    if [ -z "$MOD_KVER" ] || [ ${#MOD_KVER} -lt 3 ] || ! echo "$MOD_KVER" | grep -qE '^[0-9]+\.'; then
        echo "ERROR: Suspicious module version '$MOD_KVER' — expected format like '6.12.57'"
        exit 1
    fi

    echo "  - Modules: $MOD_KVER (variant version: $KVERS)"

    # Verify modules extracted successfully
    if [ ! -d "lib/modules" ] || [ -z "$(ls -A lib/modules/ 2>/dev/null)" ]; then
        echo "ERROR: No lib/modules/ found after extracting modules.tar.xz — archive may be corrupt"
        exit 1
    fi

    # Run depmod if available
    if command -v depmod &>/dev/null; then
        depmod -a -b . "$MOD_KVER"
        echo "  - depmod completed"
    fi
fi

# =============================================================================
# Step 8: Inject password hash
# =============================================================================

echo "Injecting password hash..."
mkdir -p etc
echo -n "$linbo_pwhash" > etc/linbo_pwhash
echo -n "$linbo_salt" > etc/linbo_salt
chmod 600 etc/linbo_*
echo "  - Password hash injected"

# =============================================================================
# Step 9: Inject SSH keys
# =============================================================================

echo "Injecting SSH keys..."

# Create required directories
mkdir -p etc/dropbear etc/ssh .ssh var/log
touch var/log/lastlog

# Dropbear host keys
DROPBEAR_KEYS=0
if ls "$CONFIG_DIR"/dropbear_*_host_key 1>/dev/null 2>&1; then
    cp "$CONFIG_DIR"/dropbear_*_host_key etc/dropbear/
    DROPBEAR_KEYS=$(ls etc/dropbear/*_host_key 2>/dev/null | wc -l)
    echo "  - Dropbear keys injected: $DROPBEAR_KEYS"
fi

# OpenSSH host keys
SSH_KEYS=0
if ls "$CONFIG_DIR"/ssh_host_*_key* 1>/dev/null 2>&1; then
    cp "$CONFIG_DIR"/ssh_host_*_key* etc/ssh/
    SSH_KEYS=$(ls etc/ssh/ssh_host_*_key 2>/dev/null | wc -l)
    echo "  - SSH host keys injected: $SSH_KEYS"
fi

# Authorized keys (public keys for server -> client SSH)
AUTH_KEYS=0
if ls "$CONFIG_DIR"/*.pub 1>/dev/null 2>&1; then
    cat "$CONFIG_DIR"/*.pub > .ssh/authorized_keys
    chmod 600 .ssh/authorized_keys
    AUTH_KEYS=$(wc -l < .ssh/authorized_keys)
    echo "  - Authorized keys injected: $AUTH_KEYS"
fi

# Also check /root/.ssh for authorized keys (compatibility with linuxmuster.net)
if [ -f /root/.ssh/id_rsa.pub ] || [ -f /root/.ssh/id_ed25519.pub ]; then
    cat /root/.ssh/id_*.pub >> .ssh/authorized_keys 2>/dev/null
    chmod 600 .ssh/authorized_keys
    echo "  - Added server keys from /root/.ssh"
fi

# Ensure correct permissions
chmod 700 .ssh 2>/dev/null || true

# =============================================================================
# Step 10: Copy default start.conf
# =============================================================================

if [ -f "$LINBO_DIR/start.conf" ]; then
    cp "$LINBO_DIR/start.conf" .
    echo "  - Default start.conf copied"
fi

# =============================================================================
# Step 10.5: Inject firmware files
# =============================================================================

FIRMWARE_CONFIG="$CONFIG_DIR/firmware"
FW_BASE="/lib/firmware"

if [ -f "$FIRMWARE_CONFIG" ] && grep -qvE '^[[:space:]]*(#|$)' "$FIRMWARE_CONFIG" 2>/dev/null; then
    echo "Injecting firmware files..."

    # Clean slate — remove any old firmware from previous builds
    rm -rf lib/firmware
    mkdir -p lib/firmware

    FIRMWARE_COUNT=0
    FILES_COPIED=0

    while IFS= read -r entry || [ -n "$entry" ]; do
        # Trim whitespace + strip CR (Windows CRLF compat)
        entry="$(echo "$entry" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/\r$//')"
        [ -z "$entry" ] && continue
        [ "${entry#\#}" != "$entry" ] && continue

        # Strip /lib/firmware/ prefix (production compat)
        entry="${entry#/lib/firmware/}"

        # Segment-based traversal check (foo..bar.bin stays allowed)
        if echo "$entry" | grep -qE '(^|/)\.\.(/|$)'; then
            echo "  REJECT (path traversal): $entry"; continue
        fi
        case "$entry" in
            /*|*\\*) echo "  REJECT (unsafe path): $entry"; continue ;;
        esac

        SOURCE="$FW_BASE/$entry"
        TARGET="lib/firmware/$entry"

        # Symlink-out-of-base check on entry root
        if [ -e "$SOURCE" ]; then
            REAL_SOURCE="$(realpath "$SOURCE" 2>/dev/null)" || REAL_SOURCE=""
            if [ -n "$REAL_SOURCE" ]; then
                case "$REAL_SOURCE" in
                    "$FW_BASE"/*|"$FW_BASE") ;;
                    *) echo "  REJECT (symlink outside base): $entry -> $REAL_SOURCE"; continue ;;
                esac
            fi
        fi

        # Handle .zst — decompress (lazy zstd check: only fail when actually needed)
        if [ ! -e "$SOURCE" ] && [ -e "${SOURCE}.zst" ]; then
            REAL_ZST="$(realpath "${SOURCE}.zst" 2>/dev/null)" || REAL_ZST=""
            case "$REAL_ZST" in "$FW_BASE"/*|"$FW_BASE") ;; *)
                echo "  REJECT (zst symlink outside base): $entry"; continue ;; esac
            if ! command -v zstd >/dev/null 2>&1; then
                echo "  ERROR: zstd not found but needed for: $entry"
                exit 1
            fi
            mkdir -p "$(dirname "$TARGET")"
            if ! zstd -d -q "${SOURCE}.zst" -o "$TARGET" 2>/dev/null; then
                echo "  ERROR: zstd decompress failed: $entry"
                exit 1
            fi
            echo "  + file (decompressed): $entry"
            FIRMWARE_COUNT=$((FIRMWARE_COUNT + 1))
            FILES_COPIED=$((FILES_COPIED + 1))
            continue
        fi

        if [ ! -e "$SOURCE" ]; then
            echo "  WARN: not found: $entry"; continue
        fi

        # Copy
        if [ -d "$SOURCE" ]; then
            mkdir -p "$TARGET"
            # rsync --safe-links drops symlinks pointing outside source tree
            rsync -a --links --safe-links "$SOURCE"/ "$TARGET"/
            DIR_FILES=$(find "$TARGET" -type f | wc -l)
            echo "  + dir: $entry ($DIR_FILES files)"
            FIRMWARE_COUNT=$((FIRMWARE_COUNT + 1))
            FILES_COPIED=$((FILES_COPIED + DIR_FILES))
        else
            mkdir -p "$(dirname "$TARGET")"
            # Single file: cp -aL is safe (realpath already checked above)
            cp -aL "$SOURCE" "$TARGET"
            echo "  + file: $entry"
            FIRMWARE_COUNT=$((FIRMWARE_COUNT + 1))
            FILES_COPIED=$((FILES_COPIED + 1))
        fi
    done < "$FIRMWARE_CONFIG"

    echo "Firmware: $FIRMWARE_COUNT entries, $FILES_COPIED files injected"
else
    echo "No firmware config or empty ($FIRMWARE_CONFIG), skipping firmware injection"
fi

# =============================================================================
# Step 10.6: Inject wpa_supplicant config
# =============================================================================

WPA_CONF="$CONFIG_DIR/wpa_supplicant.conf"
if [ -f "$WPA_CONF" ] && [ -s "$WPA_CONF" ]; then
    echo "Injecting wpa_supplicant.conf..."
    mkdir -p etc
    cp "$WPA_CONF" etc/wpa_supplicant.conf
    chmod 600 etc/wpa_supplicant.conf
    echo "  - WLAN config injected"
fi

# =============================================================================
# Step 10.7: Inject GUI themes and custom linbo_gui binary
# =============================================================================

# 10.7a: GUI themes — copy from provisioned themes into linbofs
GUI_THEMES_SRC="$LINBO_DIR/gui-themes"
if [ -d "$GUI_THEMES_SRC" ] && [ "$(ls -A "$GUI_THEMES_SRC" 2>/dev/null)" ]; then
    echo "Injecting GUI themes..."
    THEME_COUNT=0
    for theme_dir in "$GUI_THEMES_SRC"/*/; do
        [ -d "$theme_dir" ] || continue
        theme_name=$(basename "$theme_dir")
        # Validate theme name (alphanumeric + hyphens only)
        case "$theme_name" in
            *[!a-zA-Z0-9_-]*) echo "  REJECT (invalid name): $theme_name"; continue ;;
        esac
        mkdir -p "themes/$theme_name"
        cp -r "$theme_dir"* "themes/$theme_name/"
        echo "  + theme: $theme_name"
        THEME_COUNT=$((THEME_COUNT + 1))
    done
    echo "GUI themes: $THEME_COUNT injected"
else
    echo "No GUI themes found ($GUI_THEMES_SRC), skipping"
fi

# 10.7b: Custom linbo_gui binary — override the default binary in linbofs
CUSTOM_GUI="$CONFIG_DIR/linbo_gui"
if [ -f "$CUSTOM_GUI" ]; then
    echo "Injecting custom linbo_gui binary..."
    if [ ! -x "$CUSTOM_GUI" ]; then
        echo "  WARNING: $CUSTOM_GUI is not executable, setting +x"
    fi
    cp "$CUSTOM_GUI" "usr/bin/linbo_gui"
    chmod 755 "usr/bin/linbo_gui"
    echo "  - Custom linbo_gui injected ($(stat -c%s "$CUSTOM_GUI") bytes)"
fi

# =============================================================================
# Step 10.9: Execute pre-repack hooks
# =============================================================================

export LINBO_DIR CONFIG_DIR CACHE_DIR KTYPE KVERS WORKDIR
exec_hooks pre

# =============================================================================
# Step 11: Repack linbofs64
# =============================================================================

echo "Repacking linbofs64 (this may take a while)..."
set -o pipefail

if [ "$BUILD_MODE" = "fakeroot" ]; then
    # fakeroot mode: single-segment archive matching LMN original exactly.
    # No --owner needed (fakeroot reports all files as root-owned).
    # No devnodes fragment needed (device nodes created during extraction).
    find . -print | cpio --quiet -o -H newc | xz -e --check=none -z -f -T 0 -c > "$LINBOFS.new"
    RC=$?
    echo "  - Single-segment archive (fakeroot mode)"
else
    # Non-root fallback: force root ownership + append devnodes fragment
    find . -print | cpio --quiet -o -H newc --owner 0:0 | xz --check=none -z -f -T 0 -c > "$LINBOFS.new"
    RC=$?
    if [ $RC -eq 0 ] && [ -f "$DEVNODES_CPIO" ]; then
        xz --check=none -z -f -T 0 -c < "$DEVNODES_CPIO" >> "$LINBOFS.new"
        echo "  - Two-segment archive with devnodes (non-root fallback)"
    fi
fi

set +o pipefail
if [ $RC -ne 0 ]; then
    echo "ERROR: Failed to repack linbofs64 (pipeline exit code: $RC)!"
    exit 1
fi

# =============================================================================
# Step 12: Verify new file
# =============================================================================

NEW_SIZE=$(stat -c%s "$LINBOFS.new")
OLD_SIZE=$(stat -c%s "${LINBOFS}.bak")

echo "Verifying new linbofs64..."
echo "  - Old size: $OLD_SIZE bytes"
echo "  - New size: $NEW_SIZE bytes"

# Sanity check: new file must be at least 10MB (reasonable minimum for linbofs64)
MIN_SIZE=10485760
if [ "$NEW_SIZE" -lt "$MIN_SIZE" ]; then
    echo "ERROR: New file is suspiciously small ($NEW_SIZE bytes, minimum $MIN_SIZE)"
    echo "Keeping backup, aborting!"
    rm -f "$LINBOFS.new"
    exit 1
fi

# Hard upper bound (200MB)
MAX_SIZE=209715200
if [ "$NEW_SIZE" -gt "$MAX_SIZE" ]; then
    echo "ERROR: linbofs64 exceeds maximum size: $(($NEW_SIZE / 1048576))MB > 200MB"
    echo "This indicates a build problem (e.g., double compression, leaked temp files)."
    rm -f "$LINBOFS.new"
    exit 1
fi

# Warning threshold (80MB)
WARN_SIZE=83886080
if [ "$NEW_SIZE" -gt "$WARN_SIZE" ]; then
    echo "WARNING: linbofs64 is unusually large: $(($NEW_SIZE / 1048576))MB (threshold: 80MB)"
    echo "Current production size is typically ~55MB. Investigate before deploying."
fi

# =============================================================================
# Step 12.5: Post-rebuild CPIO verification
# =============================================================================

echo "Verifying CPIO archive integrity..."

# Test 1: All XZ segments must decompress correctly
if ! xz -t "$LINBOFS.new" 2>/dev/null; then
    echo "ERROR: linbofs64 XZ verification failed - archive is corrupt"
    rm -f "$LINBOFS.new"
    exit 1
fi
echo "  - XZ integrity: OK"

# Test 2: CPIO listing must work; dev/console is in the devnodes segment
CPIO_LIST=$(xz -dc "$LINBOFS.new" 2>/dev/null | cpio -t 2>/dev/null) || true
if [ -z "$CPIO_LIST" ]; then
    echo "ERROR: Could not list CPIO contents from linbofs64"
    rm -f "$LINBOFS.new"
    exit 1
fi
# Test 2b: Verify dev/console is present
if echo "$CPIO_LIST" | grep -q "dev/console"; then
    echo "  - CPIO content: OK (dev/console present)"
else
    if [ "$BUILD_MODE" = "fakeroot" ]; then
        echo "  WARNING: dev/console not found — fakeroot may not have created device nodes"
    else
        echo "  - CPIO content: OK (devnodes appended as separate segment)"
    fi
fi

# Test 3: Module count (only when kernel variant was injected)
if [ "$HAS_KERNEL_VARIANT" = "true" ]; then
    KO_COUNT=$({ echo "$CPIO_LIST" | grep '\.ko$' || true; } | wc -l)
    if [ "$KO_COUNT" -eq 0 ]; then
        echo "ERROR: No kernel modules (.ko files) found in linbofs64"
        echo "Kernel variant '$KTYPE' was injected but no modules survived repack."
        rm -f "$LINBOFS.new"
        exit 1
    fi
    echo "  - Module count: $KO_COUNT .ko files"

    # Test 4: NIC module spot-check (critical: missing NIC drivers = no network)
    NIC_MODULES=0
    for driver in e1000e igc r8169 iwlwifi bnxt_en; do
        if echo "$CPIO_LIST" | grep -q "${driver}\.ko"; then
            NIC_MODULES=$((NIC_MODULES + 1))
        fi
    done
    if [ "$NIC_MODULES" -eq 0 ]; then
        echo "  WARNING: No common NIC modules found (e1000e, igc, r8169, iwlwifi, bnxt_en)"
        echo "  Clients may not have network after boot!"
    else
        echo "  - NIC spot-check: $NIC_MODULES common driver(s) found"
    fi
fi

# =============================================================================
# Step 13: Replace original file
# =============================================================================

echo "Replacing original linbofs64..."
mv "$LINBOFS.new" "$LINBOFS"

# =============================================================================
# Step 14: Generate MD5 hash
# =============================================================================

echo "Generating MD5 hash..."
md5sum "$LINBOFS" | awk '{print $1}' > "${LINBOFS}.md5"
echo "  - MD5: $(cat ${LINBOFS}.md5)"

# =============================================================================
# Step 14.5: Write build status marker
# =============================================================================

{
    echo "# Build Status — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "build|OK"
    if [ "$HOOK_COUNT" -eq 0 ]; then
        echo "hooks|none"
    elif [ "$HOOK_WARNINGS" -eq 0 ]; then
        echo "hooks|${HOOK_COUNT} run, 0 warnings"
    else
        echo "hooks|${HOOK_COUNT} run, ${HOOK_WARNINGS} warnings: ${HOOK_WARNING_DETAIL}"
    fi
} > "${LINBO_DIR}/.linbofs-patch-status"
chmod 644 "${LINBO_DIR}/.linbofs-patch-status"

# =============================================================================
# Step 14.6: Sync to Docker volume (if different from LINBO_DIR)
# =============================================================================

DOCKER_VOLUME="/var/lib/docker/volumes/linbo_srv_data/_data"
if [ -d "$DOCKER_VOLUME" ] && [ "$LINBO_DIR" != "$DOCKER_VOLUME" ]; then
    echo "Syncing linbofs64 to Docker volume..."
    cp "$LINBOFS" "$DOCKER_VOLUME/linbofs64"
    cp "${LINBOFS}.md5" "$DOCKER_VOLUME/linbofs64.md5"
    cp "${LINBO_DIR}/.linbofs-patch-status" "$DOCKER_VOLUME/.linbofs-patch-status" 2>/dev/null || true
    cp "${LINBO_DIR}/.linbofs-build-manifest.json" "$DOCKER_VOLUME/.linbofs-build-manifest.json" 2>/dev/null || true
    chown 1001:1001 "$DOCKER_VOLUME/linbofs64" "$DOCKER_VOLUME/linbofs64.md5" "$DOCKER_VOLUME/.linbofs-build-manifest.json" 2>/dev/null || true
    echo "  - Copied to $DOCKER_VOLUME/linbofs64"
elif [ "$LINBO_DIR" = "$DOCKER_VOLUME" ]; then
    echo "LINBO_DIR is Docker volume, no sync needed."
fi

# =============================================================================
# Step 15: Copy kernel from variant (if available)
# =============================================================================

if [ "$HAS_KERNEL_VARIANT" = "true" ]; then
    echo "Copying kernel from variant '$KTYPE'..."
    cp "$VARIANT_DIR/linbo64" "$LINBO_DIR/linbo64"
    chmod 644 "$LINBO_DIR/linbo64"
    md5sum "$LINBO_DIR/linbo64" | awk '{print $1}' > "$LINBO_DIR/linbo64.md5"
    echo "  - linbo64: $(cat $LINBO_DIR/linbo64.md5)"
fi

# =============================================================================
# Step 15.5: Execute post-repack hooks
# =============================================================================

exec_hooks post

# =============================================================================
# Step 15.7: Write build manifest
# =============================================================================

write_build_manifest

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "=== Update-Linbofs completed successfully ==="
echo "File: $LINBOFS"
echo "Size: $NEW_SIZE bytes"
echo "Keys: Dropbear=$DROPBEAR_KEYS, SSH=$SSH_KEYS, Authorized=$AUTH_KEYS"
if [ "$HAS_KERNEL_VARIANT" = "true" ]; then
    echo "Kernel: $KTYPE ($KVERS)"
fi
echo ""
