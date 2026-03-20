# =============================================================================
# LINBO Docker - Development Makefile
# =============================================================================

.PHONY: help up down rebuild logs health deploy test status clean wait-ready doctor linbofs-audit linbofs-diff validate-hooks new-hook module-diff

# Default target
help:
	@echo "LINBO Docker - Available targets:"
	@echo ""
	@echo "  make up          - Start all containers"
	@echo "  make down        - Stop all containers"
	@echo "  make rebuild     - Rebuild and restart API + Web containers"
	@echo "  make rebuild-all - Rebuild ALL containers"
	@echo "  make logs        - Tail API logs"
	@echo "  make logs-all    - Tail all container logs"
	@echo "  make health      - Check health of all services"
	@echo "  make test        - Run API tests"
	@echo "  make deploy      - Deploy to test server (10.0.0.13)"
	@echo "  make deploy-full - Deploy + rebuild linbofs + GRUB"
	@echo "  make status      - Show git + Docker status"
	@echo "  make wait-ready  - Wait until all containers are healthy"
	@echo "  make doctor      - Run system diagnostics"
	@echo "  make linbofs-audit   - Inspect built linbofs64 contents"
	@echo "  make linbofs-diff    - Compare template vs built linbofs64"
	@echo "  make validate-hooks  - Validate all installed hooks"
	@echo "  make new-hook        - Create hook scaffold (NAME=... TYPE=pre|post)"
	@echo "  make module-diff     - Compare Docker vs LMN linbofs64 modules"
	@echo "  make db-push         - Apply Prisma schema changes"
	@echo "  make clean           - Prune Docker build cache + images"

# ---------------------------------------------------------------------------
# Docker Operations
# ---------------------------------------------------------------------------

up:
	docker compose up -d

down:
	docker compose down

rebuild:
	docker compose up -d --build api web

rebuild-all:
	docker compose up -d --build

logs:
	docker logs linbo-api --tail 50 -f

logs-all:
	docker compose logs --tail 20 -f

# ---------------------------------------------------------------------------
# Health & Status
# ---------------------------------------------------------------------------

health:
	@echo "=== Main Server (localhost) ==="
	@curl -sf http://localhost:3000/health | python3 -m json.tool 2>/dev/null || echo "API: DOWN"
	@curl -sf -o /dev/null -w "Web: HTTP %{http_code}\n" http://localhost:8080 2>/dev/null || echo "Web: DOWN"
	@echo ""
	@echo "=== Test Server (10.0.0.13) ==="
	@curl -sf http://10.0.0.13:3000/health | python3 -m json.tool 2>/dev/null || echo "API: DOWN"
	@curl -sf -o /dev/null -w "Web: HTTP %{http_code}\n" http://10.0.0.13:8080 2>/dev/null || echo "Web: DOWN"

wait-ready:
	./scripts/wait-ready.sh

doctor:
	./scripts/doctor.sh

status:
	@echo "=== Git Status ==="
	@git status --short
	@echo ""
	@echo "=== Local Docker ==="
	@docker compose ps --format "table {{.Name}}\t{{.Status}}"
	@echo ""
	@echo "=== Test Server Docker ==="
	@ssh -o ConnectTimeout=3 root@10.0.0.13 "cd /root/linbo-docker; docker compose ps --format 'table {{.Name}}\t{{.Status}}'" 2>/dev/null || echo "  (unreachable)"
	@echo ""
	@echo "=== Git Sync ==="
	@echo -n "  Main: " && git log --oneline -1
	@echo -n "  Test: " && ssh -o ConnectTimeout=3 root@10.0.0.13 "cd /root/linbo-docker; git log --oneline -1" 2>/dev/null || echo "  (unreachable)"

# ---------------------------------------------------------------------------
# linbofs64 Inspection
# ---------------------------------------------------------------------------

linbofs-audit:
	@docker exec linbo-api bash /usr/share/linuxmuster/linbo/linbofs-audit.sh

linbofs-diff:
	@docker exec linbo-api bash /usr/share/linuxmuster/linbo/linbofs-diff.sh

module-diff:
	@docker exec linbo-api bash /usr/share/linuxmuster/linbo/linbofs-module-diff.sh

# ---------------------------------------------------------------------------
# Hook Management
# ---------------------------------------------------------------------------

validate-hooks:
	@docker exec linbo-api bash /usr/share/linuxmuster/linbo/validate-hook.sh --all

new-hook:
ifndef NAME
	$(error NAME is required. Usage: make new-hook NAME=my-hook TYPE=pre)
endif
	@docker exec linbo-api bash /usr/share/linuxmuster/linbo/new-hook.sh "$(NAME)" "$(or $(TYPE),pre)"

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

deploy:
	./scripts/deploy.sh root@10.0.0.13

deploy-full:
	./scripts/deploy.sh root@10.0.0.13 --rebuild

# ---------------------------------------------------------------------------
# Development
# ---------------------------------------------------------------------------

test:
	docker exec linbo-api npm test 2>&1

db-push:
	docker exec linbo-api npx prisma db push

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

clean:
	docker builder prune -f
	docker image prune -f
	@echo "=== Disk Usage ==="
	@df -h / | tail -1
