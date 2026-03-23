# API-Konventionen -- LINBO Docker

## REST-API

### URL-Schema
```
Base:           /api/v1
Auth:           /api/v1/auth/login
Hosts:          /api/v1/hosts, /hosts/:id, /hosts/:id/status
Rooms:          /api/v1/rooms, /rooms/:id
Configs:        /api/v1/configs, /configs/:id, /configs/:id/grub-preview
Images:         /api/v1/images, /images/:name
Operations:     /api/v1/operations, /operations/:id
Sync:           /api/v1/sync/status, /sync/trigger, /sync/changes
System:         /api/v1/system/linbofs/rebuild, /system/kernel/switch
Settings:       /api/v1/settings
Patchclass:     /api/v1/patchclass, /patchclass/:name
Terminal:        /api/v1/terminal/sessions
Stats:          /api/v1/stats
DHCP:           /api/v1/dhcp/status, /dhcp/config
Internal:       /api/v1/internal/...
```

### HTTP-Methoden
- `GET` -- Lesen (idempotent)
- `POST` -- Erstellen oder Aktion ausfuehren
- `PUT` -- Vollstaendig aktualisieren
- `PATCH` -- Teilweise aktualisieren
- `DELETE` -- Loeschen

### Antwortformat

```json
// Erfolg (einzelnes Objekt)
{
  "data": { ... }
}

// Erfolg (Liste mit Pagination)
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 128
  }
}

// Fehler
{
  "error": {
    "code": "HOST_NOT_FOUND",
    "message": "Host with ID xyz does not exist"
  }
}

// Sync-Mode-Fehler
{
  "error": {
    "code": "SYNC_MODE_ACTIVE",
    "message": "This operation is not available in sync mode"
  }
}
```

### Status-Codes
- `200` OK
- `201` Created
- `204` No Content (Delete)
- `400` Bad Request (Zod-Validierungsfehler)
- `401` Unauthorized (Token fehlt/ungueltig)
- `403` Forbidden (keine Berechtigung)
- `404` Not Found
- `409` Conflict (Sync-Mode aktiv, Duplikat)
- `500` Internal Server Error

### Input-Validierung (Zod)
```javascript
const createHostSchema = z.object({
  hostname: z.string().min(1).max(255),
  mac: z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/),
  ip: z.string().ip().optional(),
  roomId: z.string().uuid(),
  configId: z.string().uuid().optional(),
});
```

## WebSocket-Events

### Verbindung
```
Main WebSocket:     ws://host:8080/ws
Terminal WebSocket:  ws://host:8080/ws/terminal
Auth:               Token im Query-Parameter oder erste Nachricht
```

### Server -> Client Events
```json
{ "type": "host.status.changed", "payload": { "hostId": "...", "ip": "...", "online": true } }
{ "type": "operation.progress", "payload": { "opId": "...", "percent": 45, "output": "..." } }
{ "type": "sync.progress", "payload": { "image": "win11", "speed": "12.5 MB/s", "eta": "3:42" } }
{ "type": "notification", "payload": { "level": "info", "message": "Sync completed" } }
{ "type": "host.changed", "payload": { "action": "created", "host": { ... } } }
{ "type": "config.changed", "payload": { "action": "updated", "config": { ... } } }
```

### Client -> Server Events
```json
{ "type": "subscribe", "payload": { "channels": ["hosts", "operations"] } }
{ "type": "_reconnected", "payload": {} }
```

## Authentifizierung

### JWT (Browser/Frontend)
```
Authorization: Bearer <access_token>
```

### API-Key (Service-to-Service)
```
X-API-Key: <api_key>
```

### WebSocket Auth
```
ws://host:8080/ws?token=<access_token>
```

## Modus-abhaengige Endpunkte

| Endpunkt | Standalone | Sync |
|---|---|---|
| /hosts | CRUD (Prisma) | 409 SYNC_MODE_ACTIVE |
| /rooms | CRUD (Prisma) | 409 SYNC_MODE_ACTIVE |
| /configs | CRUD (Prisma) | Read-only (Filesystem) |
| /operations | CRUD (Prisma) | Redis-backed |
| /sync | Nicht verfuegbar | Delta-Feed + Trigger |
| /images | Prisma + FS | Filesystem-only |
| /settings | Immer verfuegbar | Immer verfuegbar |
| /system | Immer verfuegbar | Immer verfuegbar |
