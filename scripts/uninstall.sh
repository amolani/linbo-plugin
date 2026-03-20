#!/bin/bash
#
# LINBO Docker - Uninstall Script
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="/opt/linbo-docker"

echo -e "${YELLOW}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              LINBO Docker - Uninstall                         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Warning: This will remove:${NC}"
echo "  - All LINBO Docker containers"
echo "  - All Docker volumes (images, database, configs)"
echo "  - Installation directory: $INSTALL_DIR"
echo ""
read -p "Are you sure? Type 'yes' to confirm: " confirm

if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo ""

# Stop and remove containers
if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    echo -e "${YELLOW}Stopping containers...${NC}"
    cd "$INSTALL_DIR"
    docker compose down -v --remove-orphans 2>/dev/null || true
fi

# Remove any remaining containers
echo -e "${YELLOW}Removing any remaining containers...${NC}"
docker rm -f linbo-api linbo-web linbo-db linbo-cache linbo-tftp linbo-rsync linbo-ssh linbo-init 2>/dev/null || true

# Remove volumes
echo -e "${YELLOW}Removing volumes...${NC}"
docker volume rm linbo-docker_srv_data linbo-docker_db_data linbo-docker_redis_data linbo-docker_config_data 2>/dev/null || true

# Remove images (optional)
read -p "Remove Docker images too? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Removing images...${NC}"
    docker images | grep linbo-docker | awk '{print $3}' | xargs -r docker rmi -f 2>/dev/null || true
fi

# Remove installation directory
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Removing $INSTALL_DIR...${NC}"
    rm -rf "$INSTALL_DIR"
fi

echo ""
echo -e "${GREEN}LINBO Docker has been uninstalled.${NC}"
echo ""
