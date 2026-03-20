#!/bin/bash
# deploy-frontend.sh — Deploy pre-built frontend static files and nginx config
# Usage: sudo ./scripts/server/deploy-frontend.sh
# Idempotent: safe to re-run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../" && pwd)"

log_info()  { echo "[deploy-frontend] INFO:  $*"; }
log_ok()    { echo "[deploy-frontend] OK:    $*"; }
log_error() { echo "[deploy-frontend] ERROR: $*" >&2; }

[[ "$EUID" -ne 0 ]] && log_error "Must run as root" && exit 1

# --- Step 1: Create web root ---
log_info "Step 1: Creating web root /var/www/linbo..."
mkdir -p /var/www/linbo
log_ok "Web root exists"

# --- Step 2: Deploy static files ---
log_info "Step 2: Deploying frontend static files..."
if [ ! -d "${REPO_ROOT}/frontend/dist" ]; then
    log_error "frontend/dist/ not found at ${REPO_ROOT}/frontend/dist — build locally first"
    exit 1
fi
rm -rf /var/www/linbo/*
cp -r "${REPO_ROOT}/frontend/dist/." /var/www/linbo/
chown -R www-data:www-data /var/www/linbo
chmod -R 755 /var/www/linbo
log_ok "Static files deployed to /var/www/linbo/"

# --- Step 3: Install nginx config ---
log_info "Step 3: Installing nginx configuration..."
cp "${REPO_ROOT}/config/nginx.conf" /etc/nginx/sites-available/linbo
ln -sf /etc/nginx/sites-available/linbo /etc/nginx/sites-enabled/linbo
rm -f /etc/nginx/sites-enabled/default
log_ok "Nginx config installed (default site removed)"

# --- Step 4: Validate and reload nginx ---
log_info "Step 4: Validating and reloading nginx..."
nginx -t
systemctl reload nginx
log_ok "Nginx reloaded successfully"

# --- Step 5: Smoke test ---
log_info "Step 5: Running smoke test..."
sleep 1  # allow reload to settle
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/)
if [ "$HTTP_CODE" != "200" ]; then
    log_error "Smoke test failed — expected HTTP 200, got ${HTTP_CODE}"
    exit 1
fi
log_ok "Smoke test passed (HTTP ${HTTP_CODE})"

log_ok "Frontend deployment complete."
echo ""
echo "  Web root: /var/www/linbo/"
echo "  Config:   /etc/nginx/sites-available/linbo"
echo "  URL:      http://localhost/"
