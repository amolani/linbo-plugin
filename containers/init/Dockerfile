# LINBO Boot Files Init Container
# Downloads boot files on first start

# =============================================================================
# Stage 1: Build GRUB netboot core images using Debian/Ubuntu GRUB 2.12
# =============================================================================
# Alpine GRUB 2.06 produces core.efi files that break the UEFI->kernel PCI
# handoff (clients lose all PCI devices including NICs). The reference LMN
# server (Ubuntu 24.04) uses GRUB 2.12 which works correctly. We use Ubuntu
# as a builder stage to produce correct core images with the same module list
# as linuxmuster-linbo7's mkgrubnetdir.sh.
FROM ubuntu:24.04 AS grub-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    grub-common \
    grub-efi-amd64-bin \
    grub-pc-bin \
    && rm -rf /var/lib/apt/lists/*

# Build GRUB netboot directory structure matching mkgrubnetdir.sh from
# linuxmuster-linbo7. The module lists mirror the reference server exactly.
RUN set -e && \
    NETDIR=/grub-netboot && \
    SUBDIR=/boot/grub && \
    I386_DIR=/usr/lib/grub/i386-pc && \
    EFI64_DIR=/usr/lib/grub/x86_64-efi && \
    GRUB_COMMON="all_video boot chain configfile cpuid echo net ext2 extcmd fat gettext gfxmenu gfxterm gzio http iso9660 ntfs linux linux16 loadenv loopback minicmd net part_gpt part_msdos png progress read reiserfs search sleep terminal test tftp" && \
    GRUB_I386="$GRUB_COMMON biosdisk gfxterm_background normal ntldr pxe" && \
    GRUB_EFI="$GRUB_COMMON $(ls $EFI64_DIR/*efi*.mod 2>/dev/null | sed 's|.*/||;s|\.mod||' | tr '\n' ' ')" && \
    GRUB_ISO="$GRUB_EFI iso9660 usb" && \
    mkdir -p $NETDIR && \
    echo "Building i386-pc core images..." && \
    grub-mknetdir --fonts="unicode" -d "$I386_DIR" \
        --net-directory="$NETDIR" --subdir="$SUBDIR" && \
    cp "$NETDIR$SUBDIR/i386-pc/core.0" "$NETDIR$SUBDIR/i386-pc/core.min" && \
    grub-mknetdir --fonts="unicode" --modules="$GRUB_I386" -d "$I386_DIR" \
        --net-directory="$NETDIR" --subdir="$SUBDIR" && \
    echo "Building x86_64-efi core images..." && \
    grub-mknetdir --modules="$GRUB_ISO" -d "$EFI64_DIR" \
        --net-directory="$NETDIR" --subdir="$SUBDIR" && \
    cp "$NETDIR$SUBDIR/x86_64-efi/core.efi" "$NETDIR$SUBDIR/x86_64-efi/core.iso" && \
    grub-mknetdir --fonts="unicode" --modules="$GRUB_EFI" -d "$EFI64_DIR" \
        --net-directory="$NETDIR" --subdir="$SUBDIR" && \
    echo "Copying module files..." && \
    cp $I386_DIR/*.mod "$NETDIR$SUBDIR/i386-pc/" 2>/dev/null || true && \
    cp $I386_DIR/*.lst "$NETDIR$SUBDIR/i386-pc/" 2>/dev/null || true && \
    cp $EFI64_DIR/*.mod "$NETDIR$SUBDIR/x86_64-efi/" 2>/dev/null || true && \
    cp $EFI64_DIR/*.lst "$NETDIR$SUBDIR/x86_64-efi/" 2>/dev/null || true && \
    echo "GRUB build complete:" && \
    ls -la "$NETDIR$SUBDIR/i386-pc/core.0" "$NETDIR$SUBDIR/i386-pc/core.min" && \
    ls -la "$NETDIR$SUBDIR/x86_64-efi/core.efi" "$NETDIR$SUBDIR/x86_64-efi/core.iso" && \
    grub-mknetdir --version 2>&1 || true

# =============================================================================
# Stage 2: Runtime (Ubuntu — matches LMN reference server)
# =============================================================================
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tar \
    gzip \
    xz-utils \
    zstd \
    dpkg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pre-built Debian GRUB netboot files (core images + modules)
COPY --from=grub-builder /grub-netboot/boot/grub/ /opt/grub-netboot/

# Download edulution GUI package from GitHub Release (latest)
# Uses GitHub API for private repo support (Accept: application/octet-stream)
ARG GITHUB_TOKEN=""
RUN set -e && \
    REPO="edulution-io/edulution-linbo-gui" && \
    if [ -z "$GITHUB_TOKEN" ]; then \
      echo "WARNING: No GITHUB_TOKEN — skipping edulution GUI download" && \
      touch /opt/edulution-linbo-gui7.deb.skip; \
    else \
      echo "Fetching latest edulution-linbo-gui release..." && \
      ASSET_ID=$(curl -sf \
        -H "Authorization: token $GITHUB_TOKEN" \
        "https://api.github.com/repos/${REPO}/releases/latest" | \
        grep -B3 '"name": *".*\.deb"' | grep '"id":' | head -1 | \
        grep -o '[0-9]\+') && \
      if [ -z "$ASSET_ID" ]; then \
        echo "WARNING: No .deb asset found in latest release, using standard LMN GUI" && \
        touch /opt/edulution-linbo-gui7.deb.skip; \
      else \
        echo "Downloading asset ID $ASSET_ID..." && \
        curl -fSL \
          -H "Authorization: token $GITHUB_TOKEN" \
          -H "Accept: application/octet-stream" \
          "https://api.github.com/repos/${REPO}/releases/assets/${ASSET_ID}" \
          -o /opt/edulution-linbo-gui7.deb && \
        echo "Downloaded: $(stat -c%s /opt/edulution-linbo-gui7.deb) bytes"; \
      fi; \
    fi

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
