# Authentifizierung und API-Client

## Uebersicht

LINBO Docker kommuniziert mit dem linuxmuster.net-Server ueber einen HTTP-API-Client (`containers/api/src/lib/lmn-api-client.js`). Dieser Client unterstuetzt zwei Authentifizierungsmodi, die automatisch anhand der konfigurierten URL erkannt werden:

- **Port 8001** (`linuxmuster-api`): JWT-Authentifizierung via HTTP Basic Auth
- **Port 8400** (Legacy Authority API): Statischer Bearer Token

Der Client wird ausschliesslich im **Sync-Modus** verwendet, um Hosts, Start-Konfigurationen, DHCP-Daten und Health-Status vom LMN-Server abzurufen. LINBO Docker liest nur Daten -- es schreibt niemals zurueck.

---

## Auto-Detection

Die Funktion `_detectMode(baseUrl)` in `lmn-api-client.js` (Zeile 30-38) erkennt den API-Modus anhand des Ports der konfigurierten URL:

```javascript
function _detectMode(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (url.port === '8001') {
      return { pathPrefix: '/v1/linbo', useJwt: true };
    }
  } catch { /* fall through */ }
  return { pathPrefix: '/api/v1/linbo', useJwt: false };
}
```

| Port | `pathPrefix` | `useJwt` | Modus |
|------|-------------|----------|-------|
| 8001 | `/v1/linbo` | `true` | linuxmuster-api (JWT) |
| Alle anderen | `/api/v1/linbo` | `false` | Legacy Authority API (Bearer Token) |

Die Erkennung basiert ausschliesslich auf dem Port. Ist der Port `8001`, wird JWT-Auth verwendet. Fuer alle anderen Ports (insbesondere `8400`) wird Bearer-Token-Auth angenommen.

Bei einem URL-Parse-Fehler (z.B. ungueltige URL) faellt die Erkennung auf den Legacy-Modus zurueck.

---

## JWT-Auth (Port 8001, linuxmuster-api)

### Detaillierter Ablauf

Die JWT-Authentifizierung (`_getJwtToken()`, Zeile 46-85) funktioniert in folgenden Schritten:

#### 1. Credentials laden

Username und Passwort werden aus den Settings gelesen:

```javascript
const lmnUser = await getSettings().get('lmn_api_user');
const lmnPass = await getSettings().get('lmn_api_password');
```

Fehlen diese Werte, wird ein sprechender Fehler geworfen:
> `lmn_api_user and lmn_api_password required for linuxmuster-api (port 8001). Set via settings API or use port 8400 with lmn_api_key for legacy mode.`

#### 2. HTTP Basic Auth Login

Der Client sendet einen `GET`-Request an den Auth-Endpoint:

```
GET {baseUrl}/v1/auth/
Authorization: Basic base64(user:pass)
```

Der `Authorization`-Header wird als Base64-kodierter String aus `user:pass` erstellt:

```javascript
const basicAuth = Buffer.from(`${lmnUser}:${lmnPass}`).toString('base64');
```

#### 3. Response: Bare JWT String

Die linuxmuster-api gibt den JWT-Token als **nackten String** zurueck, nicht als JSON-Objekt. Der Token ist in Anfuehrungszeichen eingeschlossen:

```
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

#### 4. Quote-Stripping

Die umschliessenden Anfuehrungszeichen werden entfernt:

```javascript
const raw = await response.text();
_jwtToken = raw.replace(/^"|"$/g, '');
```

#### 5. Token-Caching

Der Token wird im Modul-Scope gecacht mit einer angenommenen Gueltigkeit von **1 Stunde** (3600 Sekunden):

```javascript
let _jwtToken = null;    // Gecachter Token
let _jwtExpiry = 0;      // Ablaufzeitpunkt (Unix-Timestamp in ms)

_jwtExpiry = Date.now() + 3600 * 1000;
```

Bei nachfolgenden Requests wird der gecachte Token verwendet, solange er noch mindestens **5 Minuten** gueltig ist:

```javascript
if (_jwtToken && Date.now() < _jwtExpiry - 300_000) {
  return _jwtToken;
}
```

Ist der Token abgelaufen oder innerhalb des 5-Minuten-Puffers, wird automatisch ein neuer Token geholt.

#### 6. 401-Retry bei abgelaufenem Token

Wenn ein API-Request mit Status `401 Unauthorized` fehlschlaegt und JWT-Modus aktiv ist, wird der Token-Cache geloescht und **einmal** ein neuer Token geholt (nur beim ersten Versuch, `attempt === 0`):

```javascript
if (response.status === 401 && useJwt && attempt === 0) {
  _jwtToken = null;
  _jwtExpiry = 0;
  token = await _getJwtToken(lmnApiUrl);
  headers['X-API-Key'] = token;
  continue;
}
```

#### 7. Request-Header

Im JWT-Modus wird der Token als `X-API-Key`-Header gesendet (nicht als `Authorization: Bearer`):

```
X-API-Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Bearer-Auth (Port 8400, Legacy Authority API)

### Ablauf

Die Legacy-Authentifizierung ist deutlich einfacher:

1. Der statische API-Key wird aus den Settings gelesen:
   ```javascript
   token = await getSettings().get('lmn_api_key');
   ```

2. Der Token wird als `Authorization: Bearer`-Header gesendet:
   ```
   Authorization: Bearer <api-key>
   ```

Es gibt kein Login, kein Caching und kein Token-Refresh. Der API-Key ist statisch und muss manuell in der Authority API konfiguriert werden.

### Unterschiede zum JWT-Modus

| Eigenschaft | JWT (Port 8001) | Bearer (Port 8400) |
|-------------|-----------------|---------------------|
| Auth-Header | `X-API-Key: <jwt>` | `Authorization: Bearer <key>` |
| Login noetig | Ja (`GET /v1/auth/`) | Nein |
| Token-Typ | Dynamisch (JWT, 1h) | Statisch |
| Credentials | Username + Passwort | API-Key |
| Token-Refresh | Automatisch (5min Puffer) | Nicht noetig |
| 401-Retry | Ja (einmal) | Nein |
| API-Pfade | `/v1/linbo/*` | `/api/v1/linbo/*` |

---

## Settings

Alle relevanten Settings werden in `containers/api/src/services/settings.service.js` definiert und in Redis gespeichert (Schluessel: `config:{key}`). Falls kein Redis-Wert existiert, wird die Environment-Variable geprueft, dann der Default-Wert.

| Key | Env Var | Default | Geheim | Beschreibung |
|-----|---------|---------|--------|-------------|
| `lmn_api_url` | `LMN_API_URL` | `http://10.0.0.11:8001` | Nein | API Base URL. Der Port bestimmt den Auth-Modus (8001=JWT, 8400=Bearer). |
| `lmn_api_key` | `LMN_API_KEY` | (leer) | Ja | Statischer Bearer Token fuer die Legacy Authority API (Port 8400). |
| `lmn_api_user` | `LMN_API_USER` | (leer) | Nein | Username fuer JWT-Auth (Port 8001, linuxmuster-api). |
| `lmn_api_password` | `LMN_API_PASSWORD` | (leer) | Ja | Passwort fuer JWT-Auth (Port 8001, linuxmuster-api). |
| `sync_enabled` | `SYNC_ENABLED` | `false` | Nein | Aktiviert den Sync-Modus (Delta-Feed vom LMN-Server). |
| `sync_interval` | `SYNC_INTERVAL` | `0` | Nein | Auto-Sync Intervall in Sekunden (0 = deaktiviert). |

### Wert-Aufloesung (Prioritaet)

1. **Redis** (`config:{key}`) -- hoechste Prioritaet, gesetzt via Settings API
2. **Environment-Variable** -- aus `docker-compose.yml` oder `.env`-Datei
3. **Default-Wert** -- in der Settings-Schema-Definition

### Geheime Werte

Geheime Settings (`secret: true`) werden in `getAll()` maskiert:
- `lmn_api_key` und `lmn_api_password`: Nur die letzten 4 Zeichen sichtbar (`****abcd`)
- `admin_password_hash`: Nie sichtbar, nur `isSet: true/false`

### Aendern via API

```bash
# URL setzen (bestimmt den Auth-Modus)
curl -X PUT http://localhost:3000/api/v1/settings/lmn_api_url \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"value": "https://10.0.0.11:8001"}'

# JWT-Credentials setzen
curl -X PUT http://localhost:3000/api/v1/settings/lmn_api_user \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"value": "global-admin"}'

curl -X PUT http://localhost:3000/api/v1/settings/lmn_api_password \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"value": "Muster!"}'

# Zuruecksetzen auf Default
curl -X DELETE http://localhost:3000/api/v1/settings/lmn_api_url \
  -H "Authorization: Bearer <jwt>"
```

### In-Memory Cache

Settings werden 2 Sekunden lang im Speicher gecacht, um Redis-Abfragen bei hochfrequenten Zugriffen zu reduzieren:

```javascript
const CACHE_TTL = 2000; // 2 Sekunden
```

Nach jedem `set()` oder `reset()` wird der Cache invalidiert und ein WebSocket-Event `settings.changed` gesendet.

---

## Docker-Compose Konfiguration

Die relevanten Environment-Variablen im `api`-Service (`docker-compose.yml`, Zeile 153-158):

```yaml
api:
  environment:
    # Sync (LMN API -- port 8001=linuxmuster-api, 8400=legacy)
    - SYNC_ENABLED=${SYNC_ENABLED:-false}
    - LMN_API_URL=${LMN_API_URL:-https://10.0.0.11:8001}
    - LMN_API_KEY=${LMN_API_KEY:-}
    - LMN_API_USER=${LMN_API_USER:-}
    - LMN_API_PASSWORD=${LMN_API_PASSWORD:-}
    - NODE_TLS_REJECT_UNAUTHORIZED=${NODE_TLS_REJECT_UNAUTHORIZED:-0}
```

### Konfiguration via `.env`-Datei

Im Projekt-Root kann eine `.env`-Datei angelegt werden, die von Docker Compose automatisch eingelesen wird:

```bash
# .env (Beispiel fuer JWT-Auth mit linuxmuster-api)
SYNC_ENABLED=true
LMN_API_URL=https://10.0.0.11:8001
LMN_API_USER=global-admin
LMN_API_PASSWORD=Muster!

# .env (Beispiel fuer Legacy Authority API)
SYNC_ENABLED=true
LMN_API_URL=http://10.0.0.11:8400
LMN_API_KEY=my-secret-api-key
```

Die Werte aus der `.env`-Datei werden als Defaults verwendet. Via Settings API (Redis) koennen sie zur Laufzeit ueberschrieben werden, ohne den Container neu zu starten.

---

## Test-Connection Endpoint

### `POST /api/v1/settings/test-connection`

Dieser Endpoint (`containers/api/src/routes/settings.js`, Zeile 38-105) testet die Verbindung zum LMN-Server. Er erfordert Admin-Rechte.

### Request

```json
{
  "url": "https://10.0.0.11:8001",
  "user": "global-admin",
  "password": "Muster!"
}
```

Alle Felder sind optional. Fehlende Werte werden aus den gespeicherten Settings geladen. So kann man neue Credentials **vor dem Speichern** testen.

### Ablauf

1. **URL bestimmen**: `req.body.url` oder gespeichertes `lmn_api_url`
2. **Modus erkennen**: Port `8001` = JWT, sonst = Bearer Token
3. **Authentifizierung**:
   - **JWT-Modus**: Login via `GET {url}/v1/auth/` mit HTTP Basic Auth, Quote-Stripping des JWT-Tokens
   - **Bearer-Modus**: Statischen API-Key aus `req.body.key` oder Settings laden
4. **Health-Check**:
   - **JWT-Modus**: `GET {url}/v1/linbo/health` mit `X-API-Key`-Header
   - **Bearer-Modus**: `GET {url}/health` mit `Authorization: Bearer`-Header
5. **Response**: Ergebnis mit Status, Latenz und erkanntem Auth-Modus

### Response

```json
{
  "data": {
    "reachable": true,
    "healthy": true,
    "version": "1.0.0",
    "latency": 42,
    "authMode": "jwt"
  }
}
```

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `reachable` | boolean | Server erreichbar (kein Netzwerk-/Timeout-Fehler) |
| `healthy` | boolean | Health-Endpoint gibt `{ status: "ok" }` zurueck |
| `version` | string/null | API-Version aus Health-Response |
| `latency` | number | Round-Trip-Zeit in Millisekunden |
| `authMode` | string | Erkannter Modus: `"jwt"` oder `"token"` |

### Timeout

Der Test-Connection-Endpoint hat ein **8-Sekunden-Timeout** (AbortController), unabhaengig vom normalen Request-Timeout des API-Clients (10 Sekunden).

---

## TLS / Self-Signed Certificates

Der linuxmuster.net-Server verwendet typischerweise **selbst-signierte TLS-Zertifikate**. Damit Node.js diese akzeptiert, wird in `docker-compose.yml` die Umgebungsvariable gesetzt:

```yaml
- NODE_TLS_REJECT_UNAUTHORIZED=${NODE_TLS_REJECT_UNAUTHORIZED:-0}
```

| Wert | Verhalten |
|------|-----------|
| `0` (Default) | Self-signed Zertifikate werden akzeptiert |
| `1` | Nur gueltige, vertrauenswuerdige Zertifikate werden akzeptiert |

**Wichtig**: Der Wert `0` ist ein **globaler** Node.js-Prozessparameter. Er betrifft **alle** HTTPS-Verbindungen des API-Containers, nicht nur die zum LMN-Server. In einer Produktivumgebung mit gueltigen Zertifikaten sollte der Wert auf `1` gesetzt werden.

---

## Retry-Logik

Der API-Client (`lmn-api-client.js`, Zeile 93-164) implementiert eine robuste Retry-Strategie mit exponential Backoff.

### Konfiguration

```javascript
const REQUEST_TIMEOUT = 10_000;   // 10 Sekunden Timeout pro Request
const MAX_RETRIES = 3;            // Maximal 3 Versuche
const BASE_DELAY = 500;           // Basis-Wartezeit: 500ms
```

### Exponential Backoff

Die Wartezeit zwischen Retries verdoppelt sich mit jedem Versuch:

| Versuch | Wartezeit |
|---------|-----------|
| 1. Retry (nach Fehler) | 500ms |
| 2. Retry | 1000ms |
| 3. Versuch | (kein Retry, Fehler wird geworfen) |

Berechnung: `delay = BASE_DELAY * 2^attempt` = 500ms, 1000ms, 2000ms

### Welche Status-Codes werden retried?

| Status-Code | Verhalten |
|-------------|-----------|
| `2xx` (Erfolg) | Sofort zurueckgeben |
| `401` (JWT-Modus, 1. Versuch) | Token-Cache loeschen, neuen Token holen, retry |
| `401` (JWT-Modus, 2.+ Versuch) | Sofort zurueckgeben (kein weiterer Retry) |
| `4xx` (ausser 401, 429) | Sofort zurueckgeben (Client-Fehler, kein Retry) |
| `429` (Rate Limit) | Retry mit Backoff |
| `5xx` (Server-Fehler) | Retry mit Backoff |
| Netzwerk-Fehler / Timeout | Retry mit Backoff |

### Ablauf-Diagramm

```
Request #1
  |-- Erfolg (2xx) --> Zurueckgeben
  |-- 401 + JWT + attempt=0 --> Token refresh --> Request #2
  |-- 4xx (nicht 429) --> Zurueckgeben (kein Retry)
  |-- 429 / 5xx --> Warte 500ms --> Request #2
  |-- Netzwerk-Fehler --> Warte 500ms --> Request #2

Request #2
  |-- Erfolg --> Zurueckgeben
  |-- 429 / 5xx --> Warte 1000ms --> Request #3
  |-- Netzwerk-Fehler --> Warte 1000ms --> Request #3

Request #3
  |-- Erfolg --> Zurueckgeben
  |-- 429 / 5xx --> Response zurueckgeben (letzter Versuch)
  |-- Netzwerk-Fehler --> Exception werfen
```

### AbortController Timeout

Jeder einzelne Request hat ein eigenes **10-Sekunden-Timeout** via `AbortController`:

```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
```

Wird der Timeout ausgeloest, zaehlt dies als Netzwerk-Fehler und triggert einen Retry.

---

## Verfuegbare API-Methoden

Der Client (`lmn-api-client.js`) exportiert folgende Methoden, die alle die `request()`-Funktion mit Auto-Detection und Retry-Logik verwenden:

| Methode | HTTP | Pfad | Beschreibung |
|---------|------|------|-------------|
| `getChanges(cursor)` | `GET` | `/changes?since={cursor}` | Delta-Feed seit Cursor |
| `batchGetHosts(macs)` | `POST` | `/hosts:batch` | Hosts nach MAC-Adressen |
| `batchGetStartConfs(ids)` | `POST` | `/startconfs:batch` | Start-Konfigurationen nach ID |
| `batchGetConfigs(ids)` | `POST` | `/configs:batch` | Parsed Configs nach ID |
| `getDhcpExport(etag)` | `GET` | `/dhcp/export/dnsmasq-proxy` | DHCP-Export mit ETag-Support |
| `checkHealth()` | `GET` | `/health` | Health-Check |

Die vollstaendigen Pfade ergeben sich aus `{baseUrl}{pathPrefix}{path}`, z.B.:
- JWT-Modus: `https://10.0.0.11:8001/v1/linbo/changes?since=abc123`
- Legacy-Modus: `http://10.0.0.11:8400/api/v1/linbo/changes?since=abc123`
