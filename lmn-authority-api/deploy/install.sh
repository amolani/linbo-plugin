#!/bin/bash
# =============================================================================
# LMN Authority API - Installation Script
# =============================================================================
# Run as root on the linuxmuster.net server (10.0.0.11)
# =============================================================================

set -euo pipefail

INSTALL_DIR="/opt/lmn-authority-api"
CONFIG_DIR="/etc/lmn-authority-api"
DATA_DIR="/var/lib/lmn-authority-api"
SERVICE_USER="lmn-authority"

echo "=== LMN Authority API Installer ==="
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root."
    exit 1
fi

# Check Python 3.11+
PYTHON=$(command -v python3 || true)
if [[ -z "$PYTHON" ]]; then
    echo "ERROR: python3 not found. Install Python 3.11+."
    exit 1
fi
PY_VERSION=$($PYTHON -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "Python version: $PY_VERSION"

# Create service user
if ! id "$SERVICE_USER" &>/dev/null; then
    echo "Creating service user: $SERVICE_USER"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# Create directories
echo "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$DATA_DIR"

# Install Python package
echo "Setting up virtual environment..."
$PYTHON -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install /root/linbo-docker/lmn-authority-api

# Copy config template if not exists
if [[ ! -f "$CONFIG_DIR/lmn-authority-api.conf" ]]; then
    echo "Creating config from template..."
    cp /root/linbo-docker/lmn-authority-api/deploy/lmn-authority-api.conf.example \
       "$CONFIG_DIR/lmn-authority-api.conf"
    echo "IMPORTANT: Edit $CONFIG_DIR/lmn-authority-api.conf before starting."
fi

# Create token file template if not exists
if [[ ! -f "$CONFIG_DIR/tokens.txt" ]]; then
    echo "Creating token file template..."
    TOKEN=$(openssl rand -hex 32)
    cat > "$CONFIG_DIR/tokens.txt" <<EOF
# LMN Authority API Bearer Tokens
# One token per line. Lines starting with # are comments.
# Generate new tokens with: openssl rand -hex 32
$TOKEN
EOF
    chmod 640 "$CONFIG_DIR/tokens.txt"
    echo "Generated token: $TOKEN"
    echo "SAVE THIS TOKEN — it is needed for LINBO Docker Runtime configuration."
fi

# Set permissions
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chown -R root:"$SERVICE_USER" "$CONFIG_DIR"
chmod 750 "$CONFIG_DIR"
chmod 640 "$CONFIG_DIR/lmn-authority-api.conf"

# Allow service user to read linuxmuster files
usermod -aG linuxmuster "$SERVICE_USER" 2>/dev/null || true

# Install systemd service
echo "Installing systemd service..."
cp /root/linbo-docker/lmn-authority-api/deploy/lmn-authority-api.service \
   /etc/systemd/system/lmn-authority-api.service
systemctl daemon-reload
systemctl enable lmn-authority-api.service

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit $CONFIG_DIR/lmn-authority-api.conf"
echo "  2. Start the service: systemctl start lmn-authority-api"
echo "  3. Check status: systemctl status lmn-authority-api"
echo "  4. View logs: journalctl -u lmn-authority-api -f"
echo ""
