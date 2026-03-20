#!/bin/sh
# Auto-deployed by LINBO Docker API
# Executed (not sourced) by postsync — use exit, not return
#
# Phase 1: Manifest-based hash check (skip if unchanged)
# Phase 2: DMI matching (vendor/product)
# Phase 3: PCI/USB-ID matching via sysfs (if available)
# Phase 4: Selective rsync of matched driver sets
# Phase 5: Copy to Windows + pnputil RunOnce

LOG="/tmp/linbo-drivers.log"
echo "=== LINBO Driver Match $(date) ===" > "$LOG"

# PATCHCLASS and CACHE are set and exported by the postsync template
SERVERIP=$LINBOSERVER
RULES="$CACHE/driver-rules.sh"
TARGET="/mnt/Drivers/LINBO"

# =========================================================================
# Phase 1: Manifest-based hash check
# =========================================================================

REPO_HASH=""
if [ -f "$CACHE/driver-manifest.json" ]; then
    # POSIX-safe JSON parsing (one key per line, no jq needed)
    REPO_HASH=$(sed -n 's/.*"repoHash"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' "$CACHE/driver-manifest.json" | head -1)
fi
CACHED_HASH=""
[ -f "$CACHE/.repohash" ] && CACHED_HASH=$(cat "$CACHE/.repohash")

NEED_SYNC=1
if [ "$REPO_HASH" = "$CACHED_HASH" ] && [ -n "$REPO_HASH" ] && [ -d "$CACHE/drivers" ]; then
    echo "Repo unchanged (hash=$REPO_HASH), skipping set download" | tee -a "$LOG"
    NEED_SYNC=0
fi

# =========================================================================
# Phase 2: DMI matching
# =========================================================================

# Source generated match rules
if [ ! -f "$RULES" ]; then
    echo "WARN: No driver-rules.sh found at $RULES" | tee -a "$LOG"
    exit 0
fi
. "$RULES"

# Read DMI
SYS_VENDOR=$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null | tr -d '\n\r')
PRODUCT_NAME=$(cat /sys/class/dmi/id/product_name 2>/dev/null | tr -d '\n\r')
echo "DMI: vendor='$SYS_VENDOR' product='$PRODUCT_NAME'" | tee -a "$LOG"

# Match DMI (strip trailing whitespace/CR from sysfs)
SYS_VENDOR=$(printf '%s' "$SYS_VENDOR" | tr -d '\r' | sed 's/[[:space:]]*$//')
PRODUCT_NAME=$(printf '%s' "$PRODUCT_NAME" | tr -d '\r' | sed 's/[[:space:]]*$//')
DRIVER_SETS=""
match_drivers "$SYS_VENDOR" "$PRODUCT_NAME"
DMI_SETS="$DRIVER_SETS"
echo "DMI matched sets: $DMI_SETS" | tee -a "$LOG"

# =========================================================================
# Phase 3: PCI/USB-ID Detection via sysfs (POSIX-safe, no lspci needed)
# =========================================================================

list_pci_ids() {
    for dev in /sys/bus/pci/devices/*; do
        [ -r "$dev/vendor" ] || continue
        v=$(sed 's/^0x//' "$dev/vendor")
        d=$(sed 's/^0x//' "$dev/device")
        sv=$(sed 's/^0x//' "$dev/subsystem_vendor" 2>/dev/null)
        sd=$(sed 's/^0x//' "$dev/subsystem_device" 2>/dev/null)
        # Subsystem-tuple first (more specific)
        if [ -n "$sv" ] && [ -n "$sd" ]; then
            echo "${v}:${d}:${sv}:${sd}"
        fi
        # Base-tuple
        echo "${v}:${d}"
    done | tr '[:upper:]' '[:lower:]' | sort -u
}

list_usb_ids() {
    for dev in /sys/bus/usb/devices/*; do
        [ -r "$dev/idVendor" ] || continue
        v=$(cat "$dev/idVendor")
        p=$(cat "$dev/idProduct")
        echo "${v}:${p}"
    done | tr '[:upper:]' '[:lower:]' | sort -u
}

# Collect hardware IDs
if [ -d /sys/bus/pci/devices ]; then
    PCI_IDS=$(list_pci_ids)
else
    PCI_IDS=""
fi
USB_IDS=$(list_usb_ids 2>/dev/null)
ALL_HW_IDS=$(printf "%s\n%s" "$PCI_IDS" "$USB_IDS" | sort -u | grep -v '^$')

DEVICE_SETS=""
if [ -n "$ALL_HW_IDS" ] && type match_device_drivers >/dev/null 2>&1; then
    DEVICE_SETS=$(match_device_drivers "$ALL_HW_IDS")
    echo "Device matched sets: $DEVICE_SETS" | tee -a "$LOG"
fi

# Merge DMI + Device sets (deduplicated, DMI takes priority)
if [ -n "$DEVICE_SETS" ]; then
    DRIVER_SETS=$(printf "%s %s" "$DMI_SETS" "$DEVICE_SETS" | tr ' ' '\n' | awk '!seen[$0]++' | tr '\n' ' ')
else
    DRIVER_SETS="$DMI_SETS"
fi
echo "Final matched sets: $DRIVER_SETS" | tee -a "$LOG"

# =========================================================================
# Phase 4: Selective rsync of matched sets (only if manifest changed)
# =========================================================================

if [ "$NEED_SYNC" = "1" ]; then
    for SET in $DRIVER_SETS; do
        # Per-set hash check from manifest
        SET_HASH=$(sed -n "/${SET}/s/.*\"hash\"[[:space:]]*:[[:space:]]*\"\([0-9a-f]*\)\".*/\1/p" "$CACHE/driver-manifest.json" 2>/dev/null | head -1)
        CACHED_SET_HASH=""
        [ -f "$CACHE/drivers/${SET}/.sethash" ] && CACHED_SET_HASH=$(cat "$CACHE/drivers/${SET}/.sethash")
        if [ "$SET_HASH" = "$CACHED_SET_HASH" ] && [ -n "$SET_HASH" ]; then
            echo "  Set '$SET' unchanged, skip" | tee -a "$LOG"
            continue
        fi
        echo "  Syncing set '$SET'..." | tee -a "$LOG"
        mkdir -p "$CACHE/drivers/${SET}"
        rsync --delete -r "${SERVERIP}::drivers/${PATCHCLASS}/drivers/${SET}/" "$CACHE/drivers/${SET}/" 2>&1 | tee -a "$LOG"
        if [ -n "$SET_HASH" ]; then
            echo "$SET_HASH" > "$CACHE/drivers/${SET}/.sethash"
        fi
    done
    if [ -n "$REPO_HASH" ]; then
        echo "$REPO_HASH" > "$CACHE/.repohash"
    fi
fi

# =========================================================================
# Phase 5: Copy matched sets into separate subfolders + pnputil
# =========================================================================

for SET in $DRIVER_SETS; do
    if [ -d "$CACHE/drivers/$SET" ]; then
        echo "  Copying: $SET" | tee -a "$LOG"
        mkdir -p "$TARGET/$SET"
        cp -ar "$CACHE/drivers/$SET"/* "$TARGET/$SET/" 2>/dev/null
    else
        echo "  WARN: Set '$SET' not found in cache" | tee -a "$LOG"
    fi
done

# Only set up pnputil if actual INF files were copied
INF_COUNT=$(find "$TARGET" -iname '*.inf' 2>/dev/null | wc -l)
if [ "$INF_COUNT" -gt 0 ]; then
    # pnputil batch — CRLF line endings required for Windows
    printf '@echo off\r\n' > "$TARGET/pnputil-install.cmd"
    printf 'pnputil /add-driver C:\\Drivers\\LINBO\\*.inf /subdirs /install\r\n' >> "$TARGET/pnputil-install.cmd"
    printf 'del "%%~f0"\r\n' >> "$TARGET/pnputil-install.cmd"
    printf 'exit /b 0\r\n' >> "$TARGET/pnputil-install.cmd"

    # Registry: RunOnce key via offline registry patching
    cat > /tmp/linbo-driver-install.reg << 'REG'
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce]
"LinboDriverInstall"="C:\\Drivers\\LINBO\\pnputil-install.cmd"
REG
    linbo_patch_registry /tmp/linbo-driver-install.reg 2>&1 | tee -a "$LOG"
    rm -f /tmp/linbo-driver-install.reg
    echo "Driver auto-install: $INF_COUNT INF files, RunOnce set" | tee -a "$LOG"
else
    echo "No INF files found — skipping pnputil setup" | tee -a "$LOG"
fi

# Copy log to cache for server retrieval
cp "$LOG" "/cache/linbo-drivers.log" 2>/dev/null
