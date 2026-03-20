#!/bin/bash
#
# Build .deb package for linbo-docker-dc-worker
#
# Usage:
#   cd dc-worker && bash build-deb.sh
#   → linbo-docker-dc-worker_1.0.0_all.deb
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Read version
if [[ ! -f VERSION ]]; then
    echo "ERROR: VERSION file not found" >&2
    exit 1
fi
VERSION=$(cat VERSION | tr -d '[:space:]')
PACKAGE="linbo-docker-dc-worker"
PKG_ROOT="pkg-root"
DEB_FILE="${PACKAGE}_${VERSION}_all.deb"

echo "Building ${PACKAGE} ${VERSION} ..."

# Clean previous build
rm -rf "$PKG_ROOT" "$DEB_FILE"

# =============================================================================
# Create directory structure
# =============================================================================

mkdir -p "$PKG_ROOT/DEBIAN"
mkdir -p "$PKG_ROOT/usr/local/bin"
mkdir -p "$PKG_ROOT/etc/systemd/system"
mkdir -p "$PKG_ROOT/etc"
mkdir -p "$PKG_ROOT/var/lib/linuxmuster/hooks/device-import.post.d"
mkdir -p "$PKG_ROOT/usr/share/doc/${PACKAGE}"

# =============================================================================
# Copy files to target paths
# =============================================================================

# Worker binary
cp macct-worker.py "$PKG_ROOT/usr/local/bin/macct-worker.py"

# Systemd service
cp macct-worker.service "$PKG_ROOT/etc/systemd/system/macct-worker.service"

# Example configs (never overwrite user configs)
cp macct-worker.conf.example "$PKG_ROOT/etc/macct-worker.conf.example"
cp linbo-docker-dhcp.conf.example "$PKG_ROOT/etc/linbo-docker-dhcp.conf.example"

# DHCP post-import hook
cp 50-linbo-docker-dhcp "$PKG_ROOT/var/lib/linuxmuster/hooks/device-import.post.d/50-linbo-docker-dhcp"

# Configure script (install.sh reused as post-install configurator)
cp install.sh "$PKG_ROOT/usr/local/bin/linbo-docker-configure"

# Documentation
cp README.md "$PKG_ROOT/usr/share/doc/${PACKAGE}/README.md"

# =============================================================================
# Set permissions
# =============================================================================

# Executables
chmod 755 "$PKG_ROOT/usr/local/bin/macct-worker.py"
chmod 755 "$PKG_ROOT/usr/local/bin/linbo-docker-configure"
chmod 755 "$PKG_ROOT/var/lib/linuxmuster/hooks/device-import.post.d/50-linbo-docker-dhcp"

# Config files
chmod 644 "$PKG_ROOT/etc/systemd/system/macct-worker.service"
chmod 644 "$PKG_ROOT/etc/macct-worker.conf.example"
chmod 644 "$PKG_ROOT/etc/linbo-docker-dhcp.conf.example"

# Documentation
chmod 644 "$PKG_ROOT/usr/share/doc/${PACKAGE}/README.md"

# =============================================================================
# DEBIAN control files
# =============================================================================

# control — substitute version placeholder
sed "s/__VERSION__/${VERSION}/" debian/control > "$PKG_ROOT/DEBIAN/control"

# conffiles
cp debian/conffiles "$PKG_ROOT/DEBIAN/conffiles"

# maintainer scripts
for script in postinst prerm postrm; do
    if [[ -f "debian/${script}" ]]; then
        cp "debian/${script}" "$PKG_ROOT/DEBIAN/${script}"
        chmod 755 "$PKG_ROOT/DEBIAN/${script}"
    fi
done

# =============================================================================
# Build .deb
# =============================================================================

# Fix ownership (everything root:root)
if [[ $EUID -eq 0 ]]; then
    chown -R root:root "$PKG_ROOT"
else
    echo "WARN: Not running as root — file ownership in .deb may not be root:root"
fi

dpkg-deb --build "$PKG_ROOT" "$DEB_FILE"

# =============================================================================
# Cleanup & summary
# =============================================================================

rm -rf "$PKG_ROOT"

echo ""
echo "Built: $DEB_FILE"
echo ""
echo "Inspect:"
echo "  dpkg-deb --info $DEB_FILE"
echo "  dpkg-deb --contents $DEB_FILE"
echo ""
echo "Install:"
echo "  dpkg -i $DEB_FILE"
echo ""
