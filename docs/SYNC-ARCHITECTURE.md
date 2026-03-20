# Sync-Architektur

## Ueberblick

Der LINBO Docker Sync-Mechanismus synchronisiert Daten vom linuxmuster.net-Server (via Authority API oder linuxmuster-api) in den Docker-Container. Docker ist dabei **permanent read-only** -- es werden niemals Daten zurueck zum LMN-Server geschrieben.

Der Sync wird manuell via `POST /api/v1/sync/trigger` ausgeloest. Bei jedem Sync-Zyklus werden folgende Daten geholt und lokal gespeichert:

- **Start.conf-Dateien** -- als Dateien auf `/srv/linbo/` (mit `server=`-Rewrite und MD5-Pruefsummen)
- **Parsed Configs** -- in Redis gecacht (fuer den GRUB-Generator)
- **Hosts** -- in Redis gecacht (mit Symlink-Erstellung fuer IP/MAC-Zuordnung)
- **DHCP-Export** -- als dnsmasq-proxy.conf Datei (von inotify im DHCP-Container ueberwacht)
- **GRUB-Konfigurationen** -- regeneriert aus den gecachten Daten

## Sync-Flow (Schritt fuer Schritt)

Die zentrale Funktion ist `syncOnce()` in `containers/api/src/services/sync.service.js`. Sie durchlaeuft folgende Schritte:

### Schritt 1: Lock-Check (isRunning)

```javascript
const running = await client.get(KEY.IS_RUNNING);
if (running === 'true') {
  throw new Error('Sync already in progress');
}
await client.set(KEY.IS_RUNNING, 'true');
```

Es darf immer nur ein Sync gleichzeitig laufen. Der Lock wird via Redis-Key `sync:isRunning` gesetzt. Im `finally`-Block wird der Lock immer zurueckgesetzt, auch bei Fehlern.

### Schritt 2: Delta-Feed abrufen (getChanges mit Cursor)

```javascript
const cursor = await client.get(KEY.CURSOR) || '';
const isFullSync = !cursor;
const delta = await lmnClient.getChanges(cursor);
```

Der gespeicherte Cursor wird aus Redis gelesen. Ist er leer (erster Sync oder nach Reset), wird ein **Full Snapshot** angefordert. Andernfalls werden nur die Aenderungen seit dem letzten Sync geholt.

Die `getChanges()`-Funktion ruft `GET /changes?since={cursor}` auf der Authority API auf. Die Antwort enthaelt:

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `nextCursor` | string | Neuer Cursor fuer den naechsten Sync |
| `startConfsChanged` | string[] | IDs geaenderter Start.conf-Gruppen |
| `configsChanged` | string[] | IDs geaenderter GRUB-Configs |
| `hostsChanged` | string[] | MAC-Adressen geaenderter Hosts |
| `deletedStartConfs` | string[] | IDs geloeschter Start.confs |
| `deletedHosts` | string[] | MAC-Adressen geloeschter Hosts |
| `dhcpChanged` | boolean | Ob sich die DHCP-Konfiguration geaendert hat |
| `allStartConfIds` | string[] | Komplette Liste aller Start.conf-IDs auf dem Server |
| `allHostMacs` | string[] | Komplette Liste aller Host-MACs auf dem Server |
| `allConfigIds` | string[] | Komplette Liste aller Config-IDs auf dem Server |

### Schritt 3: Server-IP Check + Rewrite

```javascript
const serverIp = await settingsService.get('linbo_server_ip');
const lastServerIp = await client.get(KEY.SERVER_IP);
const serverIpChanged = lastServerIp && lastServerIp !== serverIp;
```

Die konfigurierte LINBO-Server-IP wird mit der zuletzt gespeicherten verglichen. Falls sie sich geaendert hat, muessen alle Start.conf-Dateien neu geschrieben werden (das `server=`-Feld wird umgeschrieben).

### Schritt 4: Start.confs schreiben

```javascript
const { startConfs } = await lmnClient.batchGetStartConfs(delta.startConfsChanged);
for (const sc of startConfs) {
  const rewritten = rewriteServerField(sc.content, serverIp);
  const filepath = path.join(LINBO_DIR, `start.conf.${sc.id}`);
  await atomicWriteWithMd5(filepath, rewritten);
}
```

Fuer jede geaenderte Gruppe wird:
1. Der Rohinhalt via `POST /startconfs:batch` geholt
2. Das `server=`-Feld auf die Docker-Server-IP umgeschrieben (via `startconf-rewrite.js`)
3. Die Datei atomar geschrieben (erst `.tmp`, dann `rename()`) inkl. `.md5`-Pruefsumme

Ergebnis: `/srv/linbo/start.conf.{gruppenname}` + `/srv/linbo/start.conf.{gruppenname}.md5`

### Schritt 5: Configs cachen (Redis)

```javascript
const allConfigsChanged = [...new Set([...delta.configsChanged, ...delta.startConfsChanged])];
const { configs } = await lmnClient.batchGetConfigs(allConfigsChanged);
for (const config of configs) {
  await client.set(`${KEY.CONFIG}${config.id}`, JSON.stringify(config));
  await client.sadd(KEY.CONFIG_INDEX, config.id);
}
```

Hier werden die geparsten Konfigurationen (GRUB-Config-Daten) in Redis gecacht. **Wichtig:** `configsChanged` und `startConfsChanged` werden zusammengemerged, weil eine Start.conf-Aenderung immer auch eine Config-Aenderung impliziert (sie stammen aus derselben Datei).

Der `batchGetConfigs()`-Aufruf kann mit einem **404** fehlschlagen -- das passiert bei neuen Gruppen, die noch keine Hosts haben und daher auch keine GRUB-Config. Dieser Fehler wird abgefangen und der Sync laeuft weiter:

```javascript
catch (err) {
  if (!err.message.includes('404')) throw err;
  console.log('[Sync] No GRUB configs found for changed groups');
}
```

### Schritt 6 (4b): Start.confs ohne GRUB-Config im Config-Index aufnehmen

```javascript
for (const scId of delta.startConfsChanged) {
  const exists = await client.sismember(KEY.CONFIG_INDEX, scId);
  if (!exists) {
    const record = { id: scId, content: null, updatedAt: new Date().toISOString() };
    await client.set(`${KEY.CONFIG}${scId}`, JSON.stringify(record));
    await client.sadd(KEY.CONFIG_INDEX, scId);
  }
}
```

Neue Gruppen ohne Hosts haben keine GRUB-Config (Step 5 hat sie nicht erfasst). Das Frontend braucht sie aber im Config-Index, um die Gruppe anzuzeigen. Daher wird ein minimaler Record mit `content: null` erstellt und in den Config-Index aufgenommen. Die `sismember`-Pruefung verhindert, dass ein vorhandener (vollstaendiger) Record ueberschrieben wird.

### Schritt 7: Hosts cachen + Symlinks erstellen

```javascript
const { hosts } = await lmnClient.batchGetHosts(hostsToSync);
for (const host of hosts) {
  await client.set(`${KEY.HOST}${host.mac}`, JSON.stringify(host));
  await client.sadd(KEY.HOST_INDEX, host.mac);

  // Symlinks: start.conf-{ip} → start.conf.{hostgroup}
  //           start.conf-{mac} → start.conf.{hostgroup}
  if (host.ip) await forceSymlink(groupFile, path.join(LINBO_DIR, `start.conf-${host.ip}`));
  if (host.mac) await forceSymlink(groupFile, path.join(LINBO_DIR, `start.conf-${host.mac.toLowerCase()}`));
}
```

Fuer jeden geaenderten Host wird:
1. Die Host-Daten in Redis unter `sync:host:{mac}` gespeichert
2. Die MAC-Adresse zum Host-Index (`sync:host:index`) hinzugefuegt
3. Zwei Symlinks erstellt: `start.conf-{IP}` und `start.conf-{mac}` zeigen auf `start.conf.{hostgroup}`

Die Symlinks ermoeglichen es dem LINBO-Client, seine Konfiguration sowohl ueber IP als auch ueber MAC-Adresse zu finden.

**Sonderfall "all":** Wenn `hostsChanged` den String `"all"` enthaelt (statt einzelner MACs), holt der Sync eine vollstaendige Host-Liste ueber einen neuen `getChanges('')`-Aufruf:

```javascript
if (Array.isArray(hostsToSync) && hostsToSync.includes('all')) {
  const fullDelta = await lmnClient.getChanges('');
  hostsToSync = fullDelta.hostsChanged.filter(m => m !== 'all');
}
```

### Schritt 8: Explizite Loeschungen verarbeiten

Aus `delta.deletedStartConfs` und `delta.deletedHosts` werden Loeschungen durchgefuehrt:

**Start.conf-Loeschungen:**
- Datei `start.conf.{id}` und zugehoerige `.md5` loeschen
- Redis-Config-Eintrag und Config-Index-Eintrag entfernen

**Host-Loeschungen:**
- Host-Daten aus Redis lesen (fuer Symlink-Cleanup)
- Symlinks `start.conf-{ip}` und `start.conf-{mac}` loeschen
- Redis-Host-Eintrag und Host-Index-Eintrag entfernen

### Schritt 9: Universe Lists Reconciliation (nur bei inkrementellem Sync)

```javascript
if (!isFullSync) {
  await reconcileUniverseLists(client, delta, stats);
}
```

Wird nur bei inkrementellen Syncs ausgefuehrt. Details siehe Abschnitt "Loesch-Erkennung" unten.

### Schritt 10: Full Snapshot Reconciliation (nur bei Full Sync)

```javascript
if (isFullSync) {
  await reconcileFullSnapshot(client, delta, stats);
}
```

Wird nur bei Full Syncs (leerer Cursor) ausgefuehrt. Details siehe Abschnitt "Loesch-Erkennung" unten.

### Schritt 11: DHCP-Export

```javascript
if (delta.dhcpChanged) {
  const currentEtag = await client.get(KEY.DHCP_ETAG);
  const dhcpResult = await lmnClient.getDhcpExport(currentEtag);
  if (dhcpResult.status === 200) {
    await atomicWrite(DHCP_CONFIG_FILE, dhcpResult.content);
    if (dhcpResult.etag) await client.set(KEY.DHCP_ETAG, dhcpResult.etag);
  }
}
```

Der DHCP-Export verwendet **Conditional GET** mit ETags:
- Wenn `dhcpChanged` im Delta gesetzt ist, wird der Export abgerufen
- Der bisherige ETag wird als `If-None-Match`-Header mitgesendet
- Bei Status 200: Neue Datei `/srv/linbo/dhcp/dnsmasq-proxy.conf` atomar schreiben + ETag speichern
- Bei Status 304: Nichts tun (Inhalt unveraendert)

Der DHCP-Container ueberwacht diese Datei via inotify und laedt dnsmasq automatisch neu.

### Schritt 12: GRUB-Generator

```javascript
const hasChanges = stats.startConfs > 0 || stats.configs > 0 || stats.hosts > 0
  || stats.deletedStartConfs > 0 || stats.deletedHosts > 0;

if (hasChanges || isFullSync) {
  const allHosts = await loadAllHostsFromRedis(client);
  const allConfigs = await loadAllConfigsFromRedis(client);
  await grubGenerator.regenerateAll(allHosts, allConfigs, {
    server: serverIp,
    changedConfigIds,
  });
}
```

Nur wenn tatsaechlich Aenderungen vorlagen (oder bei Full Sync), wird der GRUB-Generator angestossen. Er:
1. Laedt ALLE Hosts und Configs aus Redis (via Pipeline fuer Performance)
2. Regeneriert die GRUB-Konfigurationen
3. Bei inkrementellem Sync: nur fuer die geaenderten Config-IDs (`changedConfigIds`)

### Schritt 13: Cursor + Metadaten speichern

```javascript
await client.set(KEY.CURSOR, delta.nextCursor);
await client.set(KEY.SERVER_IP, serverIp);
await client.set(KEY.LAST_SYNC, new Date().toISOString());
await client.set(KEY.LAST_ERROR, '');
```

Der neue Cursor wird erst **nach** erfolgreichem Abschluss gespeichert. Bei einem Fehler bleibt der alte Cursor erhalten, sodass der naechste Sync die gleichen Aenderungen erneut abruft (Retry-Semantik).

Abschliessend werden WebSocket-Events gebroadcastet:
- `sync.completed` bei Erfolg (mit Stats und Dauer)
- `sync.failed` bei Fehler (mit Fehlermeldung)

## Delta-Feed (Cursor-basiert)

### Cursor-Konzept

Der Cursor ist ein **Epoch-Timestamp** (Sekunden seit 1970-01-01), der den Zeitpunkt des letzten erfolgreichen Syncs markiert. Die Authority API auf dem LMN-Server nutzt die `mtime` (Aenderungszeit) der Dateien, um festzustellen, welche Dateien sich seit dem Cursor geaendert haben.

### Full Snapshot vs Incremental

| Modus | Cursor | Verhalten |
|-------|--------|-----------|
| **Full Snapshot** | `""` (leer) | Alle Hosts, Configs und Start.confs werden zurueckgegeben |
| **Incremental** | `"1709123456"` | Nur Aenderungen seit dem Timestamp werden zurueckgegeben |

### mtime-basierte Erkennung auf dem Server

Die Authority API (Python/FastAPI auf dem LMN-Server) ueberwacht:
- `/srv/linbo/start.conf.*` -- Start.conf-Dateien
- `/etc/linuxmuster/sophomorix/default-school/devices.csv` -- Host-Daten
- GRUB-Konfigurationsdateien

Aenderungen werden anhand der Datei-mtime erkannt. Ist die mtime neuer als der Cursor, wird die Datei als "geaendert" gemeldet.

### Loeschen + Neuerstellen

Wenn eine Datei auf dem LMN-Server geloescht und neu erstellt wird:
1. Die Loeschung wird ueber die expliziten `deletedStartConfs`/`deletedHosts`-Listen gemeldet
2. Die Neuerstellung wird als Aenderung im naechsten Delta gemeldet
3. Zusaetzlich sorgen die **Universe Lists** (`allStartConfIds`, `allHostMacs`, `allConfigIds`) dafuer, dass der Docker-Container verwaiste Eintraege erkennt

### nextCursor

Der Server gibt bei jeder Antwort einen `nextCursor` zurueck, der den aktuellen Zeitstempel repraesentiert. Dieser wird im Docker gespeichert und beim naechsten Sync als `since`-Parameter mitgesendet.

## Loesch-Erkennung

Die Loesch-Erkennung hat zwei Mechanismen, die sich ergaenzen:

### reconcileUniverseLists (bei jedem inkrementellen Sync)

Diese Funktion wird bei **jedem inkrementellen Sync** ausgefuehrt und nutzt die Universe Lists aus der Server-Antwort. Die Server-Seite liefert Listen aller aktuell existierenden Entitaeten mit.

#### Start.conf-Reconciliation

```
Vergleich: allStartConfIds (Server) vs. Dateien auf Disk (/srv/linbo/start.conf.*)
```

1. Alle `start.conf.*`-Dateien in `/srv/linbo/` werden gelesen
2. Dateien mit `.md5` oder `.bak`-Endung werden uebersprungen
3. Fuer jede Datei wird die ID extrahiert (z.B. `start.conf.pc_group` -> `pc_group`)
4. Wenn die ID **nicht** in `allStartConfIds` vorkommt:
   - Datei + MD5-Datei loeschen
   - Redis-Config-Eintrag und Config-Index-Eintrag entfernen

#### Host-Reconciliation

```
Vergleich: allHostMacs (Server) vs. Redis Host-Index (sync:host:index)
```

1. Alle MACs aus dem Redis Host-Index werden geladen
2. Fuer jede MAC, die **nicht** in `allHostMacs` vorkommt:
   - Host-Daten aus Redis lesen (fuer Symlink-Cleanup)
   - Symlinks `start.conf-{ip}` und `start.conf-{mac}` loeschen
   - Redis-Host-Eintrag und Host-Index-Eintrag entfernen

#### Config-Reconciliation (WICHTIG: Merge beider Sets!)

```
Vergleich: (allConfigIds + allStartConfIds) (Server) vs. Redis Config-Index (sync:config:index)
```

Dies ist ein kritischer Punkt: Der Vergleich nutzt die **Vereinigung** von `allConfigIds` UND `allStartConfIds`:

```javascript
const serverIds = new Set([
  ...(delta.allConfigIds || []),
  ...(delta.allStartConfIds || []),
]);
```

**Warum?** Eine neue Gruppe (z.B. "server_group") hat eine Start.conf, aber noch keine GRUB-Config (weil keine Hosts zugewiesen sind). Wuerde nur `allConfigIds` geprueft, wuerde der Config-Eintrag dieser neuen Gruppe sofort wieder geloescht -- obwohl er in Step 4b gerade erst erstellt wurde. Durch den Merge beider Sets wird sichergestellt, dass alle Gruppen erhalten bleiben.

### reconcileFullSnapshot (nur bei Full Sync)

Diese Funktion wird nur bei einem **Full Sync** (leerer Cursor) ausgefuehrt. Sie nutzt die Listen aus dem Delta-Response direkt als "vollstaendige Wahrheit".

#### Start.conf-Dateien auf Disk bereinigen

```
Vergleich: delta.startConfsChanged vs. Dateien auf Disk
```

Alle `start.conf.*`-Dateien auf Disk, die **nicht** in `startConfsChanged` vorkommen, werden geloescht. Bei einem Full Sync enthaelt `startConfsChanged` alle existierenden Gruppen.

#### Host-Redis-Eintraege bereinigen

```
Vergleich: delta.hostsChanged vs. Redis Host-Index
```

Alle Host-Eintraege im Redis, die **nicht** in `hostsChanged` vorkommen, werden entfernt (inkl. Symlinks).

#### Config-Redis-Eintraege bereinigen

```
Vergleich: (delta.configsChanged + delta.startConfsChanged) vs. Redis Config-Index
```

Auch hier werden beide Listen gemerged, um neue Gruppen ohne GRUB-Config nicht zu loeschen:

```javascript
const validConfigIds = new Set([...delta.configsChanged, ...delta.startConfsChanged]);
```

#### Symlink-Bereinigung

Nach der Host-Reconciliation werden alle verwaisten Symlinks bereinigt:

1. Alle `start.conf-*`-Dateien in `/srv/linbo/` werden gelesen
2. Gueltige IPs und MACs werden aus den aktuellen Host-Daten in Redis gesammelt
3. Symlinks, die auf keine gueltige IP/MAC zeigen, werden geloescht
4. Unterscheidung IP vs MAC: IPs enthalten `.`, MACs enthalten `:`

## Redis-Keys

| Key | Typ | Beschreibung |
|-----|-----|--------------|
| `sync:cursor` | String | Aktueller Sync-Cursor (Epoch-Timestamp) |
| `sync:lastSyncAt` | String | ISO-Timestamp des letzten erfolgreichen Syncs |
| `sync:lastError` | String | Letzte Fehlermeldung (leer bei Erfolg) |
| `sync:isRunning` | String | `"true"` / `"false"` -- Sync-Lock |
| `sync:server_ip` | String | Zuletzt verwendete LINBO-Server-IP |
| `sync:host:{mac}` | String (JSON) | Host-Daten (IP, MAC, Hostname, Hostgroup, etc.) |
| `sync:host:index` | Set | Alle bekannten MAC-Adressen |
| `sync:config:{id}` | String (JSON) | Geparste Config-Daten (oder `{content: null}` fuer neue Gruppen) |
| `sync:config:index` | Set | Alle bekannten Config-IDs |
| `sync:dhcp:etag` | String | ETag des letzten DHCP-Exports (fuer Conditional GET) |

## Bekannte Edge Cases

### Neue Gruppe ohne Hosts
Eine neue Gruppe hat eine Start.conf, aber noch keine GRUB-Config (keine Hosts zugewiesen). Step 4b erstellt einen minimalen Record mit `content: null` im Config-Index. Die Universe-List-Reconciliation merged `allConfigIds + allStartConfIds`, um diesen Record nicht sofort wieder zu loeschen.

### "all" in hostsChanged
Die Authority API gibt `["all"]` statt einzelner MACs zurueck, wenn zu viele Hosts geaendert wurden. In diesem Fall holt der Sync eine vollstaendige Host-Liste ueber einen separaten `getChanges('')`-Aufruf (Full Snapshot nur fuer Hosts).

### batchGetConfigs 404
Wenn `batchGetConfigs` mit 404 fehlschlaegt (neue Gruppen ohne Hosts), wird der Fehler abgefangen und der Sync laeuft weiter. Andere HTTP-Fehler werden weiterhin geworfen.

### Config-Reconciliation: Merge beider Sets
Sowohl `reconcileUniverseLists` als auch `reconcileFullSnapshot` mergen `allConfigIds`/`configsChanged` mit `allStartConfIds`/`startConfsChanged`. Ohne diesen Merge wuerden Config-Eintraege fuer neue Gruppen (die nur eine Start.conf, aber keine GRUB-Config haben) sofort wieder geloescht.

### Server-IP-Aenderung
Wenn sich die `linbo_server_ip`-Einstellung zwischen zwei Syncs aendert, wird ein Log-Eintrag geschrieben. Die tatsaechliche Rewrite-Logik laeuft automatisch, da alle geaenderten Start.confs ohnehin mit der aktuellen Server-IP umgeschrieben werden. Fuer einen vollstaendigen Rewrite aller Dateien muss ein Full Sync ausgeloest werden (`POST /api/v1/sync/reset`).

### Fehler-Handling und Retry
Bei einem Fehler wird der Cursor **nicht** aktualisiert. Der naechste Sync-Trigger wiederholt daher die gleichen Aenderungen. Der Lock (`sync:isRunning`) wird im `finally`-Block immer zurueckgesetzt.

### LMN API Client: Retry-Logik
Der HTTP-Client (`lmn-api-client.js`) hat eine eingebaute Retry-Logik:
- Maximal 3 Versuche
- Exponentielles Backoff (500ms, 1000ms, 2000ms)
- Retry bei 429 (Rate Limit) und 5xx (Server-Fehler)
- Kein Retry bei 4xx (Client-Fehler, ausser 429)
- Bei JWT-Mode: automatischer Token-Refresh bei 401

## Quellcode-Referenzen

| Datei | Beschreibung |
|-------|--------------|
| `containers/api/src/services/sync.service.js` | Haupt-Sync-Logik |
| `containers/api/src/lib/lmn-api-client.js` | HTTP-Client fuer Authority API |
| `containers/api/src/lib/atomic-write.js` | Atomare Dateioperationen |
| `containers/api/src/lib/startconf-rewrite.js` | `server=`-Feld Rewriting |
| `containers/api/src/services/grub-generator.js` | GRUB-Config-Generierung |
| `containers/api/src/services/settings.service.js` | Runtime-Settings (Server-IP etc.) |
