# LINBO Docker - API Design

## Übersicht

Die API ist das zentrale Interface zwischen Web-Frontend und LINBO-Backend. Sie bietet:
- REST-Endpunkte für CRUD-Operationen
- WebSocket für Echtzeit-Updates
- Authentifizierung via JWT

## Basis-URL

```
REST:      https://linbo.example.com/api/v1
WebSocket: wss://linbo.example.com/ws
```

## Authentifizierung

### JWT-Token

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "secret"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 86400,
  "user": {
    "id": "usr_123",
    "username": "admin",
    "role": "admin"
  }
}
```

### API-Key (für Automation)

```http
GET /api/v1/hosts
X-API-Key: lnb_key_abc123...
```

---

## REST-Endpunkte

### Hosts (Clients)

#### Liste aller Hosts

```http
GET /api/v1/hosts
Query: ?room=D2.1&group=classroom1&status=online&page=1&limit=50

Response:
{
  "data": [
    {
      "id": "host_abc123",
      "hostname": "pc01",
      "macAddress": "00:11:22:33:44:55",
      "ipAddress": "192.168.1.101",
      "room": "D2.1",
      "group": "classroom1",
      "status": "online",
      "lastSeen": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 120,
    "pages": 3
  }
}
```

#### Host erstellen

```http
POST /api/v1/hosts
Content-Type: application/json

{
  "hostname": "pc01",
  "macAddress": "00:11:22:33:44:55",
  "room": "D2.1",
  "group": "classroom1"
}

Response: 201 Created
{
  "id": "host_abc123",
  "hostname": "pc01",
  ...
}
```

#### Host Details

```http
GET /api/v1/hosts/{hostId}

Response:
{
  "id": "host_abc123",
  "hostname": "pc01",
  "macAddress": "00:11:22:33:44:55",
  "ipAddress": "192.168.1.101",
  "room": "D2.1",
  "group": "classroom1",
  "status": "online",
  "lastSeen": "2024-01-15T10:30:00Z",
  "hardware": {
    "cpu": "Intel Core i5-10400",
    "memory": "16 GB",
    "disk": "256 GB SSD"
  },
  "cache": {
    "device": "/dev/sda2",
    "totalSize": "50 GB",
    "usedSize": "32 GB"
  },
  "config": {
    "configId": "cfg_xyz789",
    "configName": "Windows 10 + Ubuntu"
  }
}
```

#### Host aktualisieren

```http
PATCH /api/v1/hosts/{hostId}
Content-Type: application/json

{
  "room": "D2.2",
  "group": "classroom2"
}

Response: 200 OK
```

#### Host löschen

```http
DELETE /api/v1/hosts/{hostId}

Response: 204 No Content
```

---

### Host-Gruppen

#### Liste aller Gruppen

```http
GET /api/v1/groups

Response:
{
  "data": [
    {
      "id": "grp_123",
      "name": "classroom1",
      "description": "Klassenzimmer 1 - Windows 10",
      "hostCount": 25,
      "defaults": {
        "downloadType": "rsync",
        "autoPartition": true
      }
    }
  ]
}
```

#### Gruppe erstellen

```http
POST /api/v1/groups
Content-Type: application/json

{
  "name": "classroom1",
  "description": "Klassenzimmer 1",
  "defaults": {
    "downloadType": "rsync",
    "autoPartition": true,
    "locale": "de-de"
  }
}
```

---

### Räume

#### Liste aller Räume

```http
GET /api/v1/rooms

Response:
{
  "data": [
    {
      "id": "room_abc",
      "name": "D2.1",
      "description": "Informatik-Raum",
      "hostCount": 30
    }
  ]
}
```

---

### Konfigurationen (start.conf)

#### Liste aller Konfigurationen

```http
GET /api/v1/configs
Query: ?approved=true

Response:
{
  "data": [
    {
      "id": "cfg_xyz789",
      "name": "Windows 10 + Ubuntu",
      "version": "1.2.0",
      "status": "approved",
      "createdAt": "2024-01-10T08:00:00Z",
      "appliedToGroups": ["grp_123", "grp_456"]
    }
  ]
}
```

#### Konfiguration erstellen

```http
POST /api/v1/configs
Content-Type: application/json

{
  "name": "Windows 10 + Ubuntu",
  "description": "Dual-Boot für Informatik",
  "linbo": {
    "cache": "/dev/sda2",
    "downloadType": "rsync",
    "autoPartition": true,
    "autoFormat": false,
    "locale": "de-de"
  },
  "partitions": [
    {
      "device": "/dev/sda1",
      "label": "windows",
      "size": "100G",
      "fsType": "ntfs",
      "bootable": true
    },
    {
      "device": "/dev/sda2",
      "label": "cache",
      "size": "50G",
      "fsType": "ext4",
      "bootable": false
    },
    {
      "device": "/dev/sda3",
      "label": "ubuntu",
      "size": "",
      "fsType": "ext4",
      "bootable": false
    }
  ],
  "operatingSystems": [
    {
      "name": "Windows 10",
      "osType": "windows",
      "baseImage": "win10.qcow2",
      "root": "/dev/sda1",
      "kernel": "auto",
      "startEnabled": true,
      "syncEnabled": true,
      "newEnabled": true,
      "autostart": false,
      "defaultAction": "sync"
    },
    {
      "name": "Ubuntu 22.04",
      "osType": "linux",
      "baseImage": "ubuntu.qcow2",
      "root": "/dev/sda3",
      "kernel": "/boot/vmlinuz",
      "initrd": "/boot/initrd.img",
      "append": ["ro", "splash"],
      "startEnabled": true,
      "syncEnabled": true,
      "newEnabled": true
    }
  ]
}

Response: 201 Created
```

#### Konfiguration als start.conf anzeigen

```http
GET /api/v1/configs/{configId}/preview

Response:
Content-Type: text/plain

[LINBO]
Cache = /dev/sda2
DownloadType = rsync
AutoPartition = yes
AutoFormat = no
Locale = de-de

[Partition]
Dev = /dev/sda1
Label = windows
Size = 100G
Id = 7
FSType = ntfs
Bootable = yes

[Partition]
Dev = /dev/sda2
...

[OS]
Name = Windows 10
...
```

#### Konfiguration auf Gruppe anwenden

```http
POST /api/v1/configs/{configId}/apply-to-groups
Content-Type: application/json

{
  "groupIds": ["grp_123", "grp_456"]
}

Response: 200 OK
```

---

### Images

#### Liste aller Images

```http
GET /api/v1/images

Response:
{
  "data": [
    {
      "id": "img_abc",
      "filename": "win10.qcow2",
      "type": "base",
      "size": "5.2 GB",
      "checksum": "sha256:abc123...",
      "createdAt": "2024-01-05T14:00:00Z",
      "status": "available"
    },
    {
      "id": "img_def",
      "filename": "win10.qdiff",
      "type": "differential",
      "size": "1.1 GB",
      "backingImage": "win10.qcow2",
      "status": "available"
    }
  ]
}
```

#### Image-Details

```http
GET /api/v1/images/{imageId}

Response:
{
  "id": "img_abc",
  "filename": "win10.qcow2",
  "type": "base",
  "path": "/srv/linbo/images/win10.qcow2",
  "size": "5.2 GB",
  "checksum": "sha256:abc123def456...",
  "createdAt": "2024-01-05T14:00:00Z",
  "status": "available",
  "usedBy": [
    {
      "configId": "cfg_xyz789",
      "configName": "Windows 10 + Ubuntu"
    }
  ],
  "history": [
    {
      "version": "1.0",
      "createdAt": "2024-01-05T14:00:00Z",
      "createdBy": "admin",
      "comment": "Initial image"
    }
  ]
}
```

---

### Remote-Operationen

#### Command senden

```http
POST /api/v1/operations/send-command
Content-Type: application/json

{
  "targets": {
    "hostIds": ["host_abc123", "host_def456"]
  },
  "commands": ["sync:1", "start:1"],
  "wakeOnLan": {
    "enabled": true,
    "delay": 30
  }
}

Response: 202 Accepted
{
  "operationId": "op_xyz789",
  "status": "pending",
  "affectedHosts": 2,
  "estimatedDuration": 300
}
```

#### Operation Status

```http
GET /api/v1/operations/{operationId}

Response:
{
  "operationId": "op_xyz789",
  "status": "running",
  "progress": 45,
  "hosts": [
    {
      "hostId": "host_abc123",
      "hostname": "pc01",
      "status": "syncing",
      "progress": 67
    },
    {
      "hostId": "host_def456",
      "hostname": "pc02",
      "status": "waiting",
      "progress": 0
    }
  ]
}
```

---

### Host-Aktionen

#### Sync starten

```http
POST /api/v1/hosts/{hostId}/sync
Content-Type: application/json

{
  "osNumber": 1
}

Response: 202 Accepted
{
  "sessionId": "ses_abc123",
  "command": "sync:1"
}
```

#### OS starten

```http
POST /api/v1/hosts/{hostId}/start
Content-Type: application/json

{
  "osNumber": 1
}
```

#### Partitionieren

```http
POST /api/v1/hosts/{hostId}/partition

Response: 202 Accepted
```

#### Formatieren

```http
POST /api/v1/hosts/{hostId}/format
Content-Type: application/json

{
  "partitionNumber": 1  // optional, alle wenn nicht angegeben
}
```

#### Wake-on-LAN

```http
POST /api/v1/hosts/{hostId}/wake-on-lan

Response: 200 OK
{
  "message": "WoL packet sent",
  "macAddress": "00:11:22:33:44:55"
}
```

#### Neustart

```http
POST /api/v1/hosts/{hostId}/reboot
```

#### Herunterfahren

```http
POST /api/v1/hosts/{hostId}/shutdown
```

---

### Image-Erstellung

#### Base-Image erstellen

```http
POST /api/v1/hosts/{hostId}/create-image
Content-Type: application/json

{
  "osNumber": 1,
  "description": "Windows 10 - Update Januar 2024"
}

Response: 202 Accepted
{
  "sessionId": "ses_img123",
  "command": "create_image:1"
}
```

#### Differential-Image erstellen

```http
POST /api/v1/hosts/{hostId}/create-qdiff
Content-Type: application/json

{
  "osNumber": 1,
  "description": "Software-Update"
}
```

#### Image hochladen

```http
POST /api/v1/hosts/{hostId}/upload-image
Content-Type: application/json

{
  "osNumber": 1
}
```

---

### Batch-Operationen

#### Gruppe syncen

```http
POST /api/v1/batch/groups/{groupId}/sync
Content-Type: application/json

{
  "osNumber": 1,
  "wakeOnLan": true
}

Response: 202 Accepted
{
  "operationId": "op_batch123",
  "affectedHosts": 25
}
```

#### Raum syncen

```http
POST /api/v1/batch/rooms/{roomId}/sync
Content-Type: application/json

{
  "osNumber": 1
}
```

---

### Statistiken

#### Dashboard-Übersicht

```http
GET /api/v1/stats/overview

Response:
{
  "totalHosts": 150,
  "onlineHosts": 45,
  "offlineHosts": 105,
  "activeSessions": 3,
  "totalImages": 8,
  "storageUsed": "125 GB",
  "storageFree": "375 GB",
  "lastActivity": "2024-01-15T10:30:00Z"
}
```

---

## WebSocket Events

### Verbindung

```javascript
const ws = new WebSocket('wss://linbo.example.com/ws');
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    channels: ['hosts', 'operations']
  }));
};
```

### Event-Typen

#### Host-Status

```json
{
  "type": "host.status.changed",
  "data": {
    "hostId": "host_abc123",
    "hostname": "pc01",
    "status": "online",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### Sync-Fortschritt

```json
{
  "type": "sync.progress",
  "data": {
    "sessionId": "ses_abc123",
    "hostId": "host_abc123",
    "progress": 45,
    "speed": "52 MB/s",
    "eta": 120,
    "currentFile": "Windows/System32/..."
  }
}
```

#### Sync abgeschlossen

```json
{
  "type": "sync.completed",
  "data": {
    "sessionId": "ses_abc123",
    "hostId": "host_abc123",
    "duration": 245,
    "status": "success"
  }
}
```

#### Image-Erstellung Fortschritt

```json
{
  "type": "image.creation.progress",
  "data": {
    "sessionId": "ses_img123",
    "hostId": "host_abc123",
    "phase": "syncing",
    "progress": 72,
    "eta": 180
  }
}
```

#### Fehler

```json
{
  "type": "error",
  "data": {
    "code": "SSH_CONNECTION_FAILED",
    "message": "Cannot connect to host pc01",
    "hostId": "host_abc123"
  }
}
```

### Subscription-Channels

| Channel | Events |
|---------|--------|
| `hosts` | host.online, host.offline, host.status.changed |
| `operations` | operation.started, operation.completed |
| `sync:{hostId}` | sync.progress, sync.completed, sync.failed |
| `image:{hostId}` | image.creation.progress, image.upload.progress |
| `system` | system.error, disk.space.low |

---

## Error Responses

### Format

```json
{
  "error": {
    "code": "HOST_NOT_FOUND",
    "message": "Host with ID 'host_xyz' not found",
    "timestamp": "2024-01-15T10:30:00Z",
    "requestId": "req_abc123"
  }
}
```

### Error Codes

| Code | HTTP Status | Beschreibung |
|------|-------------|--------------|
| `INVALID_REQUEST` | 400 | Ungültige Anfrage |
| `UNAUTHORIZED` | 401 | Nicht authentifiziert |
| `FORBIDDEN` | 403 | Keine Berechtigung |
| `HOST_NOT_FOUND` | 404 | Host nicht gefunden |
| `IMAGE_NOT_FOUND` | 404 | Image nicht gefunden |
| `CONFIG_NOT_FOUND` | 404 | Konfiguration nicht gefunden |
| `HOST_OFFLINE` | 409 | Host ist offline |
| `HOST_BUSY` | 409 | Host führt bereits Operation aus |
| `OPERATION_IN_PROGRESS` | 409 | Operation läuft bereits |
| `SSH_CONNECTION_FAILED` | 502 | SSH-Verbindung fehlgeschlagen |
| `INTERNAL_ERROR` | 500 | Interner Serverfehler |

---

## Rate Limiting

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1705312200
Retry-After: 60
```

---

## Paginierung

```http
GET /api/v1/hosts?page=2&limit=25

Response Headers:
X-Total-Count: 150
X-Page: 2
X-Limit: 25
X-Total-Pages: 6

Link: <https://api/v1/hosts?page=1&limit=25>; rel="first",
      <https://api/v1/hosts?page=1&limit=25>; rel="prev",
      <https://api/v1/hosts?page=3&limit=25>; rel="next",
      <https://api/v1/hosts?page=6&limit=25>; rel="last"
```
