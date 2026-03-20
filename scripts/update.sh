#!/bin/bash
#
# LINBO Docker - Update Script
# Pulls latest changes and rebuilds containers
#

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="${LINBO_DOCKER_DIR:-/opt/linbo-docker}"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              LINBO Docker - Update                            ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Find installation directory
if [ ! -d "$INSTALL_DIR" ]; then
    # Check if we're in the repo directory
    if [ -f "docker-compose.yml" ]; then
        INSTALL_DIR="$(pwd)"
    else
        echo -e "${YELLOW}Installation not found at $INSTALL_DIR${NC}"
        read -p "Enter installation directory: " INSTALL_DIR
    fi
fi

cd "$INSTALL_DIR"

echo -e "${BLUE}[INFO]${NC} Updating from: $INSTALL_DIR"
echo ""

# Backup .env
if [ -f ".env" ]; then
    cp .env .env.backup
    echo -e "${GREEN}[OK]${NC} Backed up .env to .env.backup"
fi

# Pull latest changes
echo -e "${BLUE}[INFO]${NC} Pulling latest changes..."
git fetch origin
git pull origin main

# Rebuild and restart containers
echo -e "${BLUE}[INFO]${NC} Rebuilding containers..."
docker compose build

echo -e "${BLUE}[INFO]${NC} Restarting containers..."
docker compose up -d

# Wait for API
echo -e "${BLUE}[INFO]${NC} Waiting for API..."
sleep 5
for i in {1..20}; do
    if docker exec linbo-api curl -s http://localhost:3000/health > /dev/null 2>&1; then
        echo -e "${GREEN}[OK]${NC} API is healthy"
        break
    fi
    echo -n "."
    sleep 2
done
echo ""

# Show status
echo ""
echo -e "${GREEN}Update complete!${NC}"
echo ""
docker compose ps
