#!/bin/bash
#
# LINBO Docker - Status Check
#

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="${LINBO_DOCKER_DIR:-/opt/linbo-docker}"

# Find installation
if [ ! -d "$INSTALL_DIR" ]; then
    if [ -f "docker-compose.yml" ]; then
        INSTALL_DIR="$(pwd)"
    fi
fi

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              LINBO Docker - Status                            ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

cd "$INSTALL_DIR" 2>/dev/null || true

# Container Status
echo -e "${BLUE}Container Status:${NC}"
echo "─────────────────────────────────────────────────────────────────"
docker compose ps 2>/dev/null || docker ps --filter "name=linbo-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

# API Health
echo -e "${BLUE}API Health:${NC}"
echo "─────────────────────────────────────────────────────────────────"
health=$(docker exec linbo-api curl -s http://localhost:3000/health 2>/dev/null)
if [ -n "$health" ]; then
    echo "$health" | python3 -m json.tool 2>/dev/null || echo "$health"
else
    echo -e "${RED}API not responding${NC}"
fi
echo ""

# Redis
echo -e "${BLUE}Redis:${NC}"
echo "─────────────────────────────────────────────────────────────────"
redis_check=$(docker exec linbo-cache redis-cli ping 2>/dev/null)
if [ "$redis_check" = "PONG" ]; then
    echo -e "${GREEN}Redis is ready${NC}"
else
    echo -e "${RED}Redis not ready${NC}"
fi
echo ""

# Disk Usage
echo -e "${BLUE}Volume Usage:${NC}"
echo "─────────────────────────────────────────────────────────────────"
docker system df -v 2>/dev/null | grep -E "linbo|VOLUME" | head -10
echo ""

# Network
echo -e "${BLUE}Ports:${NC}"
echo "─────────────────────────────────────────────────────────────────"
echo "  Web UI:  $(ss -tlnp | grep -q ':8080' && echo -e "${GREEN}8080 open${NC}" || echo -e "${RED}8080 closed${NC}")"
echo "  API:     $(ss -tlnp | grep -q ':3000' && echo -e "${GREEN}3000 open${NC}" || echo -e "${RED}3000 closed${NC}")"
echo "  TFTP:    $(ss -ulnp | grep -q ':69' && echo -e "${GREEN}69/udp open${NC}" || echo -e "${RED}69/udp closed${NC}")"
echo "  RSYNC:   $(ss -tlnp | grep -q ':873' && echo -e "${GREEN}873 open${NC}" || echo -e "${RED}873 closed${NC}")"
echo "  SSH:     $(ss -tlnp | grep -q ':2222' && echo -e "${GREEN}2222 open${NC}" || echo -e "${RED}2222 closed${NC}")"
echo ""

# Server IP
if [ -f "$INSTALL_DIR/.env" ]; then
    SERVER_IP=$(grep LINBO_SERVER_IP "$INSTALL_DIR/.env" | cut -d'=' -f2)
    echo -e "${BLUE}Access:${NC}"
    echo "─────────────────────────────────────────────────────────────────"
    echo "  http://$SERVER_IP:8080  (Web UI)"
    echo "  http://$SERVER_IP:3000  (API)"
    echo ""
fi
