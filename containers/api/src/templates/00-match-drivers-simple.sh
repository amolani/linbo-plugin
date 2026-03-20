#!/bin/sh
# LINBO Docker - Simple Driver Matching via match.conf
# Executed by postsync — iterates /drivers/ folders, reads match.conf,
# compares vendor+product against client DMI.
#
# Unlike driver-rules.sh (generated case statement), this reads
# match.conf files directly — no code generation needed.

LOG="/tmp/linbo-drivers-simple.log"
echo "=== LINBO Simple Driver Match $(date) ===" > "$LOG"

SERVERIP=$LINBOSERVER
TARGET="/mnt/Drivers/LINBO"

# Read client DMI
SYS_VENDOR=$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null | tr -d '\n\r' | sed 's/[[:space:]]*$//')
PRODUCT_NAME=$(cat /sys/class/dmi/id/product_name 2>/dev/null | tr -d '\n\r' | sed 's/[[:space:]]*$//')
echo "DMI: vendor='$SYS_VENDOR' product='$PRODUCT_NAME'" | tee -a "$LOG"

MATCHED_FOLDERS=""

# Iterate all driver profile folders from server
# Each folder that has a match.conf is a simple driver profile
for PROFILE_DIR in /cache/linbo-drivers/*/; do
    [ -d "$PROFILE_DIR" ] || continue
    CONF="$PROFILE_DIR/match.conf"
    [ -f "$CONF" ] || continue

    FOLDER=$(basename "$PROFILE_DIR")

    # Parse match.conf — extract vendor and product lines
    CONF_VENDOR=""
    CONF_PRODUCTS=""
    IN_MATCH=0
    while IFS= read -r line; do
        # Skip comments and empty lines
        case "$line" in
            \#*|"") continue ;;
            \[match\]*) IN_MATCH=1; continue ;;
            \[*) IN_MATCH=0; continue ;;
        esac
        [ "$IN_MATCH" = "0" ] && continue

        key=$(echo "$line" | sed 's/[[:space:]]*=.*//' | tr -d ' ')
        value=$(echo "$line" | sed 's/[^=]*=[[:space:]]*//')

        case "$key" in
            vendor) CONF_VENDOR="$value" ;;
            product) CONF_PRODUCTS="$CONF_PRODUCTS|$value" ;;
        esac
    done < "$CONF"

    # Wildcard match: no match.conf vendor or product=* means match all
    if [ -z "$CONF_VENDOR" ] || [ "$CONF_VENDOR" = "*" ]; then
        echo "  $FOLDER: default/wildcard profile, matched" | tee -a "$LOG"
        MATCHED_FOLDERS="$MATCHED_FOLDERS $FOLDER"
        continue
    fi

    # Vendor must match exactly
    if [ "$CONF_VENDOR" != "$SYS_VENDOR" ]; then
        continue
    fi

    # Product substring match — any product line must be contained in PRODUCT_NAME
    if [ -z "$CONF_PRODUCTS" ] || [ "$CONF_PRODUCTS" = "|*" ]; then
        echo "  $FOLDER: vendor matched, wildcard product" | tee -a "$LOG"
        MATCHED_FOLDERS="$MATCHED_FOLDERS $FOLDER"
        continue
    fi

    # Check each product entry (separated by |, first is empty)
    OLD_IFS="$IFS"
    IFS="|"
    for pat in $CONF_PRODUCTS; do
        [ -z "$pat" ] && continue
        case "$PRODUCT_NAME" in
            *"$pat"*)
                echo "  $FOLDER: matched (product contains '$pat')" | tee -a "$LOG"
                MATCHED_FOLDERS="$MATCHED_FOLDERS $FOLDER"
                break
                ;;
        esac
    done
    IFS="$OLD_IFS"
done

echo "Matched folders: $MATCHED_FOLDERS" | tee -a "$LOG"

# Copy matched driver folders to Windows target
for FOLDER in $MATCHED_FOLDERS; do
    SRC="/cache/linbo-drivers/$FOLDER"
    if [ -d "$SRC" ]; then
        # Count actual driver files (not match.conf)
        FILE_COUNT=$(find "$SRC" -type f ! -name "match.conf" 2>/dev/null | wc -l)
        if [ "$FILE_COUNT" -gt 0 ]; then
            echo "  Copying drivers from: $FOLDER ($FILE_COUNT files)" | tee -a "$LOG"
            mkdir -p "$TARGET/$FOLDER"
            # Copy everything except match.conf
            find "$SRC" -type f ! -name "match.conf" -exec cp -a {} "$TARGET/$FOLDER/" \; 2>/dev/null
        else
            echo "  $FOLDER: no driver files, skipping copy" | tee -a "$LOG"
        fi
    fi
done

# pnputil setup if INF files were copied
INF_COUNT=$(find "$TARGET" -iname '*.inf' 2>/dev/null | wc -l)
if [ "$INF_COUNT" -gt 0 ]; then
    printf '@echo off\r\n' > "$TARGET/pnputil-install.cmd"
    printf 'pnputil /add-driver C:\\Drivers\\LINBO\\*.inf /subdirs /install\r\n' >> "$TARGET/pnputil-install.cmd"
    printf 'del "%%~f0"\r\n' >> "$TARGET/pnputil-install.cmd"
    printf 'exit /b 0\r\n' >> "$TARGET/pnputil-install.cmd"

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

cp "$LOG" "/cache/linbo-drivers-simple.log" 2>/dev/null
