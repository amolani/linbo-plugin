#!/bin/bash
# =============================================================================
# LINBO Docker - API Test Runner
# Führt alle API-Tests gegen die laufende API aus
# =============================================================================

set -e

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_DIR/containers/api"

# API URL (Standard: localhost:3000)
API_URL="${API_URL:-http://localhost:3000}"

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║           LINBO Docker - API Tests                               ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "API URL: ${YELLOW}$API_URL${NC}"
echo ""

# =============================================================================
# Prüfungen
# =============================================================================
echo -e "${YELLOW}[1/4] Prüfe Voraussetzungen...${NC}"

# API erreichbar?
echo -n "  Prüfe API-Verfügbarkeit... "
if curl -s --max-time 5 "$API_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FEHLER${NC}"
    echo ""
    echo -e "${RED}API nicht erreichbar unter $API_URL${NC}"
    echo "Stelle sicher, dass die Container laufen:"
    echo "  docker-compose up -d"
    exit 1
fi

# Health Check
echo -n "  Prüfe API-Health... "
HEALTH=$(curl -s "$API_URL/health" | grep -o '"status":"healthy"' || true)
if [ -n "$HEALTH" ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}WARNUNG (API nicht vollständig healthy)${NC}"
fi

echo -e "${GREEN}✓ Voraussetzungen erfüllt${NC}"
echo ""

# =============================================================================
# Node.js Version prüfen
# =============================================================================
echo -e "${YELLOW}[2/4] Prüfe Node.js...${NC}"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "  Node.js Version: ${GREEN}$NODE_VERSION${NC}"
else
    echo -e "${RED}Node.js nicht gefunden!${NC}"
    echo "Installiere Node.js 18+ oder führe Tests im Container aus."
    exit 1
fi

# =============================================================================
# Dependencies installieren
# =============================================================================
echo -e "${YELLOW}[3/4] Installiere Test-Dependencies...${NC}"

cd "$API_DIR"

# Prüfe ob node_modules existiert
if [ ! -d "node_modules" ] || [ ! -d "node_modules/jest" ]; then
    echo "  Installiere Dependencies..."
    npm install --include=dev
else
    echo -e "  ${GREEN}✓ Dependencies bereits installiert${NC}"
fi

# =============================================================================
# Tests ausführen
# =============================================================================
echo ""
echo -e "${YELLOW}[4/4] Führe Tests aus...${NC}"
echo ""

# API URL für Tests setzen
export API_URL

# Tests ausführen
npm test -- --colors "$@"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Alle Tests erfolgreich!                                ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║           Einige Tests fehlgeschlagen!                           ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════╝${NC}"
fi

exit $EXIT_CODE
