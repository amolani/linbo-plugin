#!/bin/bash
# =============================================================================
# LINBO Docker - API Test Runner (Docker)
# Führt Tests im API-Container aus
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

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║           LINBO Docker - API Tests (Docker)                      ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# =============================================================================
# Prüfungen
# =============================================================================
echo -e "${YELLOW}[1/3] Prüfe Container-Status...${NC}"

cd "$PROJECT_DIR"

# Prüfe ob API-Container läuft
if ! docker ps | grep -q linbo-api; then
    echo -e "${RED}API-Container läuft nicht!${NC}"
    echo "Starte mit: docker-compose up -d"
    exit 1
fi

echo -e "${GREEN}✓ API-Container läuft${NC}"

# =============================================================================
# Tests vorbereiten
# =============================================================================
echo -e "${YELLOW}[2/3] Bereite Tests vor...${NC}"

# Kopiere Test-Dateien in Container
docker cp "$PROJECT_DIR/containers/api/tests" linbo-api:/app/
docker cp "$PROJECT_DIR/containers/api/jest.config.js" linbo-api:/app/

# Installiere Test-Dependencies im Container
echo "  Installiere Test-Dependencies..."
docker exec linbo-api npm install --include=dev jest 2>/dev/null || true

echo -e "${GREEN}✓ Tests vorbereitet${NC}"

# =============================================================================
# Tests ausführen
# =============================================================================
echo ""
echo -e "${YELLOW}[3/3] Führe Tests aus...${NC}"
echo ""

# API URL innerhalb des Containers ist localhost:3000
docker exec -e API_URL=http://localhost:3000 linbo-api npm test -- --colors --forceExit "$@"

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
