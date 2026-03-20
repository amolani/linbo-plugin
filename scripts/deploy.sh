#!/bin/bash
# LINBO Docker — Deploy to remote server(s)
# Usage: ./scripts/deploy.sh <host1[,host2,...]> [--rebuild] [--git]
#
# Deploys code from this repo to the target server(s).
# The .env on each target is NEVER overwritten (standort-spezifisch).
#
# Options:
#   --rebuild   Also rebuild linbofs64 and regenerate GRUB configs
#   --git       Use git pull instead of rsync (requires clean working tree on target)
#
# Examples:
#   ./scripts/deploy.sh 10.0.0.11
#   ./scripts/deploy.sh 10.0.0.11,10.0.0.13 --rebuild
#   ./scripts/deploy.sh 10.0.0.11,10.0.0.13 --rebuild --git

set -e

TARGET_ARG=${1:?Usage: $0 <host1[,host2,...]> [--rebuild] [--git]}
shift

REBUILD=""
USE_GIT=""
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    --git)     USE_GIT=1 ;;
    *)         echo "Unknown option: $arg"; exit 1 ;;
  esac
done

REMOTE_DIR="/root/linbo-docker"
COMPOSE_FILE="${REMOTE_DIR}/docker-compose.yml"

# Parse comma-separated targets
IFS=',' read -ra TARGETS <<< "$TARGET_ARG"

# Track results for summary
declare -A RESULTS

# ---------------------------------------------------------------------------
# deploy_to() — deploy to a single target
# ---------------------------------------------------------------------------
deploy_to() {
  local target="$1"
  echo ""
  echo "========================================"
  echo "=== Deploying to $target ==="
  echo "========================================"

  # --- Code deploy ---
  if [ -n "$USE_GIT" ]; then
    echo "--- Git push + pull ---"
    git push origin main
    ssh "$target" "cd ${REMOTE_DIR}; git fetch origin; git reset --hard origin/main"
  else
    echo "--- rsync ---"
    rsync -avz --delete \
      --exclude '.env' \
      --exclude '.env.local' \
      --exclude 'node_modules' \
      --exclude '.git' \
      --exclude 'docs/bilder' \
      -e ssh \
      /root/linbo-docker/ "${target}:${REMOTE_DIR}/"
  fi

  # --- Rebuild containers ---
  echo "--- Rebuilding containers ---"
  ssh "$target" "GITHUB_TOKEN=\$(grep GITHUB_TOKEN ${REMOTE_DIR}/.env 2>/dev/null | cut -d= -f2) docker compose -f $COMPOSE_FILE up -d --build api web"

  # --- Optional: Rebuild linbofs + regenerate GRUB via API ---
  if [ "$REBUILD" = "1" ]; then
    echo "=== Rebuilding linbofs64 (via API) ==="

    # Read INTERNAL_API_KEY from remote .env
    local INTERNAL_KEY
    INTERNAL_KEY=$(ssh "$target" "grep '^INTERNAL_API_KEY=' ${REMOTE_DIR}/.env 2>/dev/null | sed 's/^INTERNAL_API_KEY=//'")

    if [ -z "$INTERNAL_KEY" ]; then
      echo "  WARNING: INTERNAL_API_KEY not found in remote .env"
      echo "  Falling back to direct docker exec for rebuild..."
      ssh "$target" "docker exec linbo-api /usr/share/linuxmuster/linbo/update-linbofs.sh"
    else
      # Rebuild linbofs64 via API (X-Internal-Key header)
      echo "  POST /system/update-linbofs ..."
      ssh "$target" "curl -sf -X POST http://localhost:3000/api/v1/system/update-linbofs \
        -H 'X-Internal-Key: ${INTERNAL_KEY}' \
        -H 'Content-Type: application/json'" \
        && echo "  linbofs64 rebuild OK" \
        || echo "  WARNING: linbofs64 rebuild failed (check API logs)"

      # Regenerate GRUB configs via API (X-Internal-Key header)
      echo "  POST /system/regenerate-grub-configs ..."
      ssh "$target" "curl -sf -X POST http://localhost:3000/api/v1/system/regenerate-grub-configs \
        -H 'X-Internal-Key: ${INTERNAL_KEY}'" \
        && echo "  GRUB regeneration OK" \
        || echo "  WARNING: GRUB regeneration failed (check API logs)"
    fi

    echo "=== Restarting TFTP + rsync ==="
    ssh "$target" "docker compose -f $COMPOSE_FILE restart tftp rsync"
  fi

  echo "=== Deploy to $target complete ==="
}

# ---------------------------------------------------------------------------
# Main: deploy to all targets
# ---------------------------------------------------------------------------
echo "Deploying to ${#TARGETS[@]} target(s): ${TARGETS[*]}"
FAILED=0

for target in "${TARGETS[@]}"; do
  if deploy_to "$target"; then
    RESULTS["$target"]="OK"
  else
    RESULTS["$target"]="FAILED"
    FAILED=$((FAILED + 1))
    echo "ERROR: Deploy to $target failed — continuing with remaining targets"
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "=== Deploy Summary ==="
echo "========================================"
for target in "${TARGETS[@]}"; do
  echo "  $target: ${RESULTS[$target]}"
done

if [ "$FAILED" -gt 0 ]; then
  echo ""
  echo "WARNING: $FAILED target(s) failed"
  exit 1
fi

echo ""
echo "All targets deployed successfully."
