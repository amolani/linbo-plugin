#!/bin/bash
#
# Build linbo-docker .deb package
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=$(head -1 debian/changelog | sed 's/.*(\(.*\)).*/\1/')
PKGNAME="linbo-docker"
BUILDDIR="/tmp/${PKGNAME}_${VERSION}_all"

echo "Building ${PKGNAME} ${VERSION}..."

# Clean
rm -rf "$BUILDDIR"
mkdir -p "$BUILDDIR/DEBIAN"
mkdir -p "$BUILDDIR/opt/linbo-docker"
mkdir -p "$BUILDDIR/usr/bin"
mkdir -p "$BUILDDIR/var/log/linbo-docker"

# Write binary package control file
cat > "$BUILDDIR/DEBIAN/control" << CTRL
Package: linbo-docker
Version: ${VERSION}
Architecture: all
Maintainer: Amo Lani <amo@edulution.io>
Depends: docker-ce | docker.io, docker-compose-plugin, jq, curl, openssl
Recommends: git
Section: admin
Priority: optional
Description: LINBO Docker - Modern Caching Server for linuxmuster.net 7.3
 Dockerized LINBO network boot solution that replaces the traditional
 linuxmuster-cachingserver-satellite package.
CTRL

cp debian/postinst "$BUILDDIR/DEBIAN/postinst"
chmod 755 "$BUILDDIR/DEBIAN/postinst"

# Copy application files
for dir in containers config scripts themes volumes; do
    if [[ -d "$dir" ]]; then
        cp -r "$dir" "$BUILDDIR/opt/linbo-docker/"
    fi
done

# Copy root-level files
for f in docker-compose.yml Makefile .env.example README.md; do
    [[ -f "$f" ]] && cp "$f" "$BUILDDIR/opt/linbo-docker/"
done

# Copy CLI
cp usr/bin/linbo-docker "$BUILDDIR/usr/bin/linbo-docker"
chmod 755 "$BUILDDIR/usr/bin/linbo-docker"

# Exclude unwanted files
find "$BUILDDIR" -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find "$BUILDDIR" -name ".git" -type d -exec rm -rf {} + 2>/dev/null || true
find "$BUILDDIR" -name "*.pyc" -delete 2>/dev/null || true
find "$BUILDDIR" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true

# Calculate installed size
SIZE=$(du -sk "$BUILDDIR" | awk '{print $1}')
echo "Installed-Size: $SIZE" >> "$BUILDDIR/DEBIAN/control"

# Build package
dpkg-deb --build "$BUILDDIR"

# Move to project root
DEBFILE="/tmp/${PKGNAME}_${VERSION}_all.deb"
mv "$DEBFILE" "${SCRIPT_DIR}/"

echo ""
echo "Package built: ${PKGNAME}_${VERSION}_all.deb"
echo "Size: $(du -h "${SCRIPT_DIR}/${PKGNAME}_${VERSION}_all.deb" | awk '{print $1}')"
echo ""
echo "Install with: dpkg -i ${PKGNAME}_${VERSION}_all.deb"

# Cleanup
rm -rf "$BUILDDIR"
