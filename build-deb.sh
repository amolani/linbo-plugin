#!/bin/bash
# build-deb.sh — Build edulution-linbo-plugin .deb package
# Usage: GITHUB_TOKEN=<token> ./build-deb.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_NAME="edulution-linbo-plugin"
PKG_VERSION=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")
BUILD_DIR="/tmp/${PKG_NAME}_${PKG_VERSION}_build"
DEB_ROOT="${BUILD_DIR}/${PKG_NAME}_${PKG_VERSION}_all"

echo "Building ${PKG_NAME} ${PKG_VERSION}..."

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------
rm -rf "$BUILD_DIR"
mkdir -p "$DEB_ROOT/DEBIAN"

# ---------------------------------------------------------------------------
# 1. Build frontend
# ---------------------------------------------------------------------------
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo "WARNING: GITHUB_TOKEN not set — frontend will not be built"
    echo "Set GITHUB_TOKEN=<token> for @edulution-io/ui-kit access"
else
    echo "Building frontend..."
    (cd "$SCRIPT_DIR/frontend" && npm ci --loglevel error && npm run build)
fi

# ---------------------------------------------------------------------------
# 2. API code → /srv/linbo-api/
# ---------------------------------------------------------------------------
echo "Packaging API..."
mkdir -p "$DEB_ROOT/srv/linbo-api"
cp "$SCRIPT_DIR/package.json" "$DEB_ROOT/srv/linbo-api/"
cp "$SCRIPT_DIR/package-lock.json" "$DEB_ROOT/srv/linbo-api/"
cp -r "$SCRIPT_DIR/src" "$DEB_ROOT/srv/linbo-api/"

# ---------------------------------------------------------------------------
# 3. Frontend dist → /var/www/linbo/
# ---------------------------------------------------------------------------
if [[ -d "$SCRIPT_DIR/frontend/dist" && -f "$SCRIPT_DIR/frontend/dist/index.html" ]]; then
    echo "Packaging frontend..."
    mkdir -p "$DEB_ROOT/var/www/linbo"
    cp -r "$SCRIPT_DIR/frontend/dist"/* "$DEB_ROOT/var/www/linbo/"
else
    echo "No frontend build — package will be API-only"
    mkdir -p "$DEB_ROOT/var/www/linbo"
fi

# ---------------------------------------------------------------------------
# 4. Scripts → /usr/local/bin/ + /usr/share/linbo-api/
# ---------------------------------------------------------------------------
echo "Packaging scripts..."
mkdir -p "$DEB_ROOT/usr/local/bin"
mkdir -p "$DEB_ROOT/usr/share/linbo-api/scripts"
mkdir -p "$DEB_ROOT/usr/share/linbo-api/config"

# Main setup wizard
cp "$SCRIPT_DIR/setup.sh" "$DEB_ROOT/usr/local/bin/linbo-setup"
chmod 755 "$DEB_ROOT/usr/local/bin/linbo-setup"

# Boot scaffold
cp "$SCRIPT_DIR/scripts/setup-bootfiles.sh" "$DEB_ROOT/usr/local/bin/"
chmod 755 "$DEB_ROOT/usr/local/bin/setup-bootfiles.sh"

# DHCP setup
if [[ -f "$SCRIPT_DIR/scripts/server/setup-dhcp.sh" ]]; then
    cp "$SCRIPT_DIR/scripts/server/setup-dhcp.sh" "$DEB_ROOT/usr/local/bin/"
    chmod 755 "$DEB_ROOT/usr/local/bin/setup-dhcp.sh"
fi

# All server scripts
cp -r "$SCRIPT_DIR/scripts/server"/* "$DEB_ROOT/usr/share/linbo-api/scripts/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/scripts/monitoring" "$DEB_ROOT/usr/share/linbo-api/scripts/" 2>/dev/null || true
chmod -R 755 "$DEB_ROOT/usr/share/linbo-api/scripts/"

# Config templates
cp -r "$SCRIPT_DIR/config"/* "$DEB_ROOT/usr/share/linbo-api/config/" 2>/dev/null || true

# .env example
mkdir -p "$DEB_ROOT/etc/linbo-native"
if [[ -f "$SCRIPT_DIR/.env.example" ]]; then
    cp "$SCRIPT_DIR/.env.example" "$DEB_ROOT/etc/linbo-native/.env.example"
fi

# ---------------------------------------------------------------------------
# 5. systemd units → /lib/systemd/system/
# ---------------------------------------------------------------------------
echo "Packaging systemd units..."
mkdir -p "$DEB_ROOT/lib/systemd/system"
cp "$SCRIPT_DIR/systemd/linbo-api.service" "$DEB_ROOT/lib/systemd/system/"
cp "$SCRIPT_DIR/systemd/linbo-setup.service" "$DEB_ROOT/lib/systemd/system/"

# ---------------------------------------------------------------------------
# 6. nginx config → /etc/nginx/sites-available/
# ---------------------------------------------------------------------------
if [[ -f "$SCRIPT_DIR/config/nginx.conf" ]]; then
    mkdir -p "$DEB_ROOT/etc/nginx/sites-available"
    cp "$SCRIPT_DIR/config/nginx.conf" "$DEB_ROOT/etc/nginx/sites-available/linbo"
fi

# ---------------------------------------------------------------------------
# 7. DEBIAN control files
# ---------------------------------------------------------------------------
echo "Packaging DEBIAN metadata..."

# control
sed "s/^Version:.*/Version: ${PKG_VERSION}/" "$SCRIPT_DIR/debian/control" | \
    grep -v "^Source:" | grep -v "^Section:" | grep -v "^Priority:" | \
    grep -v "^Maintainer:" | grep -v "^Homepage:" | grep -v "^$" | head -1 > /dev/null

cat > "$DEB_ROOT/DEBIAN/control" << EOF
Package: ${PKG_NAME}
Version: ${PKG_VERSION}
Architecture: all
Maintainer: Edulution <info@edulution.io>
Homepage: https://github.com/amolani/linbo-plugin
Depends: linuxmuster-linbo7 (>= 4.3.0), nodejs (>= 18), nginx, isc-dhcp-server, openssl, jq, curl
Description: Edulution LINBO Plugin - Native Caching Server
 Web-based management interface and caching satellite for linuxmuster-linbo7.
 Provides REST API, React frontend, Delta-Sync from LMN server,
 DHCP/PXE configuration, image management, and SSH terminal.
 .
 After installation, run 'sudo linbo-setup' to configure.
EOF

# postinst, prerm, postrm
for script in postinst prerm postrm; do
    if [[ -f "$SCRIPT_DIR/debian/$script" ]]; then
        cp "$SCRIPT_DIR/debian/$script" "$DEB_ROOT/DEBIAN/"
        chmod 755 "$DEB_ROOT/DEBIAN/$script"
    fi
done

# conffiles (files that dpkg should not overwrite on upgrade)
cat > "$DEB_ROOT/DEBIAN/conffiles" << EOF
/etc/nginx/sites-available/linbo
EOF

# ---------------------------------------------------------------------------
# 8. Fix permissions
# ---------------------------------------------------------------------------
find "$DEB_ROOT" -type d -exec chmod 755 {} \;
find "$DEB_ROOT/srv/linbo-api" -type f -exec chmod 644 {} \;
find "$DEB_ROOT/usr/local/bin" -type f -exec chmod 755 {} \;
find "$DEB_ROOT/DEBIAN" -type f -name "*.sh" -exec chmod 755 {} \;

# ---------------------------------------------------------------------------
# 9. Build .deb
# ---------------------------------------------------------------------------
echo "Building .deb..."
DEB_FILE="${SCRIPT_DIR}/${PKG_NAME}_${PKG_VERSION}_all.deb"
dpkg-deb --build "$DEB_ROOT" "$DEB_FILE"

# ---------------------------------------------------------------------------
# 10. Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo "  Package built: $(basename $DEB_FILE)"
echo "  Size: $(du -h "$DEB_FILE" | awk '{print $1}')"
echo "============================================"
echo ""
echo "Install with:"
echo "  sudo dpkg -i $DEB_FILE"
echo "  sudo apt-get -f install  # resolve dependencies"
echo "  sudo linbo-setup          # configure"
echo ""

# Cleanup
rm -rf "$BUILD_DIR"
