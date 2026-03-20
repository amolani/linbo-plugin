# LINBO Router — PR-Anleitung für linuxmuster-api

> **Status:** PROPOSAL (not yet submitted)

## Übersicht

Dieser PR fügt 6 read-only Endpoints zur offiziellen `linuxmuster-api` hinzu, damit LINBO Docker Hosts, Configs und DHCP-Daten direkt über Port 8001 abrufen kann — ohne separate Authority API.

## Dateien

| Datei | Aktion | Beschreibung |
|-------|--------|-------------|
| `routers_v1/linbo.py` | **NEU** | 6 Endpoints + Helper-Funktionen (~350 Zeilen) |
| `routers_v1/body_schemas.py` | **ERWEITERN** | 2 Pydantic Models am Ende anfügen |
| `main.py` | **ERWEITERN** | 2 Zeilen (Import + Router-Registrierung) |

## Schritt-für-Schritt

### 1. Fork & Branch

```bash
# Fork auf GitHub: https://github.com/linuxmuster/linuxmuster-api
git clone https://github.com/<DEIN-USER>/linuxmuster-api.git
cd linuxmuster-api
git checkout -b feature/linbo-docker-sync
```

### 2. Router kopieren

```bash
cp <pfad>/routers_v1/linbo.py usr/lib/python3/dist-packages/linuxmusterApi/routers_v1/linbo.py
```

### 3. Body Schemas erweitern

Die 2 Models aus `body_schemas_patch.py` am Ende von `body_schemas.py` einfügen:

```python
# --- LINBO Models ---

class LinboBatchMacs(BaseModel):
    """List of MAC addresses for batch host lookup."""
    macs: list[str]

class LinboBatchIds(BaseModel):
    """List of IDs for batch config lookup."""
    ids: list[str]
```

### 4. main.py erweitern

Import hinzufügen (bei den anderen Router-Imports):
```python
from routers_v1 import linbo
```

Router registrieren (bei den anderen `include_router`-Aufrufen):
```python
app.include_router(linbo.router, prefix="/v1")
```

### 5. Service neustarten & testen

```bash
# Auf dem LMN-Server:
systemctl restart linuxmuster-api.service

# Health Check:
TOKEN=$(curl -s -X POST http://localhost:8001/v1/auth \
  -H 'Content-Type: application/json' \
  -d '{"username":"global-admin","password":"..."}' | jq -r .token)

curl -H "Authorization: Bearer $TOKEN" http://localhost:8001/v1/linbo/health

# Delta Feed (Full Snapshot):
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8001/v1/linbo/changes?since=0"

# Batch Hosts:
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"macs":["AA:BB:CC:DD:EE:FF"]}' \
  http://localhost:8001/v1/linbo/hosts:batch

# Start.conf Batch:
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids":["win11_efi_sata"]}' \
  http://localhost:8001/v1/linbo/startconfs:batch

# GRUB Config Batch:
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids":["win11_efi_sata"]}' \
  http://localhost:8001/v1/linbo/configs:batch

# DHCP Export:
curl -H "Authorization: Bearer $TOKEN" http://localhost:8001/v1/linbo/dhcp/export/dnsmasq-proxy
```

### 6. PR erstellen

```bash
git add routers_v1/linbo.py routers_v1/body_schemas.py main.py
git commit -m "feat: add LINBO Docker sync endpoints

Add 6 read-only endpoints under /v1/linbo/ for LINBO Docker
sync mode: health, delta-feed, batch hosts, batch startconfs,
batch GRUB configs, and DHCP dnsmasq-proxy export.

Data sources: devices.csv, start.conf.*, boot/grub/*.cfg
Auth: RoleChecker('G') — global-administrators only"

git push origin feature/linbo-docker-sync
# → PR auf GitHub erstellen
```

## Endpoint-Übersicht

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| `GET` | `/v1/linbo/health` | LINBO-Subsystem Health Check |
| `GET` | `/v1/linbo/changes?since=<cursor>` | Delta-Feed (Cursor = Unix-Timestamp) |
| `POST` | `/v1/linbo/hosts:batch` | Hosts nach MAC-Liste (max 500) |
| `POST` | `/v1/linbo/startconfs:batch` | start.conf-Dateien (max 100) |
| `POST` | `/v1/linbo/configs:batch` | GRUB-Configs (max 100) |
| `GET` | `/v1/linbo/dhcp/export/dnsmasq-proxy` | DHCP-Export (text/plain, ETag) |

## Docker-seitige Anpassung

Nach dem Merge muss in LINBO Docker der `lmn-api-client.js` angepasst werden:

| Aspekt | Aktuell (Authority API) | Neu (linuxmuster-api) |
|--------|------------------------|----------------------|
| Base URL | `http://10.0.0.11:8400` | `http://10.0.0.11:8001` |
| Pfad-Prefix | `/api/v1/linbo/` | `/v1/linbo/` |
| Auth | `Bearer <static-token>` | `Bearer <JWT>` (Login via `/v1/auth`) |
| Health | `GET /health` | `GET /v1/linbo/health` |

## Unterschiede zur Authority API

| Aspekt | Authority API | linuxmuster-api Version |
|--------|--------------|------------------------|
| Delta-Cursor | `timestamp:sequence` (SQLite) | Unix-Timestamp (file mtimes) |
| Async | `async def` | `def` (synchron) |
| Auth | Bearer Token + IP allowlist | LDAP JWT + RoleChecker |
| File Watcher | inotify-basiert | Kein (mtime bei jedem Request) |
| Caching | In-Memory + SQLite | Kein (für <1000 Hosts performant) |

## Risiken & Fallbacks

1. **LDAP-Auth:** Docker braucht einen LMN-User mit `globaladministrator`-Rolle
2. **Performance:** devices.csv wird bei jedem Request gelesen (kein Cache). Für <1000 Hosts kein Problem
3. **Cursor-Format:** Geändert von `timestamp:sequence` auf reinen Unix-Timestamp. Docker-Client muss entsprechend angepasst werden
4. **Fallback:** Authority API kann weiterhin als separate Installation betrieben werden
