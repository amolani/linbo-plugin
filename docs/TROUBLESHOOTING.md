# LINBO Docker - Troubleshooting & Fehlerdokumentation

**Stand:** 2026-03-03

---

## Zusammenfassung der Session

Diese Dokumentation beschreibt alle Fehler, die während der Entwicklung und des Deployments von LINBO Docker aufgetreten sind, sowie deren Lösungen.

---

## 1. Raw Config Editor - Permission Denied (500 Error)

### Problem
Beim Speichern im Raw Config Editor erscheint ein HTTP 500 Fehler:
```
EACCES: permission denied, open '/srv/linbo/start.conf.testgruppe'
```

### Ursache
- Der API-Container läuft als User `linbo` (UID 1001)
- Die Dateien in `/srv/linbo/` gehörten `root:root`
- Der linbo-User hat keine Schreibrechte

### Lösung
```bash
# Berechtigungen auf dem Docker Volume korrigieren
chown -R 1001:1001 /var/lib/docker/volumes/linbo_srv_data/_data/
```

### Permanente Lösung
Das `init` Container Script (`containers/init/entrypoint.sh`) wurde angepasst:
```bash
# Set permissions - linbo user (uid 1001) needs write access
chmod -R 755 "${LINBO_DIR}"
chown -R 1001:1001 "${LINBO_DIR}"
```

---

## 2. Raw Config Editor - Dateninkonsistenz

### Problem
Änderungen im Raw Editor wurden nicht in der Datenbank reflektiert:
- Partitionen erscheinen nicht im strukturierten Editor
- Zwei separate Datenquellen (Filesystem vs. Database)

### Ursache
Der Raw Editor speicherte nur ins Filesystem, ohne die Datenbank zu aktualisieren.

### Lösung
Parser implementiert in `containers/api/src/services/config.service.js`:

```javascript
/**
 * Parse start.conf content into structured data
 */
function parseStartConf(content) {
  // Parst [LINBO], [Partition], [OS] Sektionen
  // Konvertiert zu strukturierten Daten für die DB
}

/**
 * Save raw config and sync to database
 */
async function saveRawConfig(configName, content, configId = null) {
  // 1. Datei speichern
  // 2. Inhalt parsen
  // 3. Datenbank in Transaktion aktualisieren
}
```

---

## 3. Modal Title TypeScript Error

### Problem
```
Type 'Element' is not assignable to type 'string'
```

### Ursache
Die `Modal` Komponente akzeptierte nur `string` als `title` Prop, aber der Raw Editor wollte ein JSX Element übergeben.

### Lösung
`containers/web/frontend/src/components/ui/Modal.tsx`:
```typescript
// Vorher
title?: string;

// Nachher
title?: ReactNode;
```

---

## 4. GitHub Release URL 404

### Problem
```
curl: (22) The requested URL returned error: 404
https://github.com/amolani/linbo-docker/releases/latest/download/linbo-boot-files.tar.gz
```

### Ursache
Der Release-Tag war `latest`, was mit GitHubs speziellem `/latest/` Redirect-Pfad kollidiert.

### Lösung
Release-Tag umbenannt:
```bash
gh release edit latest --tag boot-files-v1.0.0
```

**Hinweis:** Die URL `/releases/download/boot-files-v1.0.0/linbo-boot-files.tar.gz` funktioniert.

---

## 5. Database Authentication Failed (nach Container-Neustart)

### Problem
```
Authentication failed against database server at `linbo-db`,
the provided database credentials for `linbo` are not valid.
```

### Ursache
- `docker compose down` wurde ausgeführt
- Neuer DB-Container wurde erstellt
- POSTGRES_PASSWORD in `.env` stimmte nicht mit dem Passwort im persistenten Volume überein

### Lösung
Variante A - Volume löschen (Datenverlust):
```bash
docker compose down -v
docker compose up -d
```

Variante B - Passwort im Volume anpassen:
```bash
docker exec linbo-db psql -U linbo -c "ALTER USER linbo WITH PASSWORD 'neues_passwort';"
```

---

## 6. Port 69/udp Already in Use (TFTP)

### Problem
```
failed to bind host port 0.0.0.0:69/udp: address already in use
```

### Ursache
Auf dem Produktionsserver läuft bereits ein TFTP-Dienst (dnsmasq oder tftpd-hpa).

### Lösung
Entweder:
1. Produktions-TFTP stoppen: `systemctl stop tftpd-hpa`
2. Oder TFTP-Container Port ändern in `docker-compose.yml`
3. Oder TFTP-Container nicht starten (wenn Produktion genutzt wird)

---

## 7. Init Container Exit 1 (Boot Files Download)

### Problem
```
ERROR: Failed to download boot files after 3 attempts
```

### Ursache
- GitHub Release URL nicht erreichbar
- Oder Release-Assets nicht vorhanden

### Lösung für Produktionsserver
Boot-Dateien manuell vom Host kopieren:
```bash
VOLUME_PATH="/var/lib/docker/volumes/linbo_srv_data/_data"
cp -a /srv/linbo/linbo64 /srv/linbo/linbofs64 /srv/linbo/boot "$VOLUME_PATH/"
echo "manual-copy" > "$VOLUME_PATH/.boot-files-installed"
chown -R 1001:1001 "$VOLUME_PATH/"
```

---

## 8. EFI Boot Failure auf Test-Client

### Problem
```
BdsDXE: failed to load boot0002 UEFI PXEv4
```

### Ursache
DHCP lieferte BIOS-Bootdatei (`i386-pc/core.0`) statt EFI-Bootdatei.

### Lösung
DHCP-Konfiguration anpassen (`/etc/dhcp/custom.conf`):
```
host testpc01 {
    hardware ethernet BC:24:11:D1:7B:4D;
    fixed-address 10.0.11.10;
    option host-name "testpc01";
    next-server 10.0.10.1;
    filename "boot/grub/x86_64-efi/core.efi";  # EFI statt BIOS
}
```

Zusätzlich in `start.conf`:
```ini
[LINBO]
SystemType = efi64
```

---

## 9. Client verbindet sich mit falschem Server

### Problem
Test-Client (10.0.11.10) verbindet sich mit Produktionsserver (10.0.0.11) statt Testserver (10.0.10.1).

### Ursache
Produktions-DHCP antwortet schneller als Test-DHCP.

### Lösung
Host-Eintrag im Produktions-DHCP hinzufügen, der auf Testserver verweist:
```
host testpc01 {
    hardware ethernet BC:24:11:D1:7B:4D;
    next-server 10.0.10.1;
    ...
}
```

---

## 10. Container "unhealthy" aber funktioniert

### Problem
```
Container linbo-api is unhealthy
dependency failed to start: container linbo-api is unhealthy
```

### Ursache
Health-Check Interval ist zu kurz oder Start-Period zu kurz konfiguriert.

### Lösung
Manuell prüfen ob Service wirklich läuft:
```bash
docker exec linbo-api curl -s http://localhost:3000/health
# Sollte {"status":"healthy",...} zurückgeben
```

Wenn healthy, Container manuell starten:
```bash
docker start linbo-web
```

---

## 11. Rsync Pre-Xfer Exec Failure - Alle Verbindungen abgelehnt (KRITISCH)

### Problem
LINBO-Client bootet via PXE, bekommt aber keine `start.conf`:
```
rsync: [Receiver] failed to connect to 10.0.0.13 (10.0.0.13): Connection refused (111)
```

Im rsync Container-Log:
```
rsync-pre-download-api.sh: not found
pre-xfer exec returned failure (32512)
```

### Auswirkung
**KRITISCH** - Wenn die Pre-Xfer-Scripts fehlen, lehnt rsync ALLE Verbindungen ab. Kein Client kann start.conf oder Images herunterladen.

### Ursache
Das rsync Container Dockerfile (`containers/rsync/Dockerfile`) hatte weder `curl` installiert noch die Hook-Scripts aus `scripts/server/` in den Container kopiert.

Die `rsyncd.conf` referenzierte jedoch:
```ini
[linbo]
pre-xfer exec = /usr/share/linuxmuster/linbo/rsync-pre-download-api.sh
post-xfer exec = /usr/share/linuxmuster/linbo/rsync-post-download-api.sh

[linbo-upload]
pre-xfer exec = /usr/share/linuxmuster/linbo/rsync-pre-upload-api.sh
post-xfer exec = /usr/share/linuxmuster/linbo/rsync-post-upload-api.sh
```

Da die Scripts nicht existierten, gab die Shell Exit-Code 127 (command not found) zurueck, was rsync als Fehler 32512 interpretierte und die Verbindung ablehnte.

### Loesung
`containers/rsync/Dockerfile` erweitert:
```dockerfile
# Install rsync + curl (needed for API hook scripts)
RUN apt-get update && apt-get install -y --no-install-recommends \
    rsync \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /srv/linbo /var/log /usr/share/linuxmuster/linbo

# Copy API hook scripts
COPY scripts/ /usr/share/linuxmuster/linbo/
RUN chmod +x /usr/share/linuxmuster/linbo/*.sh
```

Hook-Scripts als eigene Kopien nach `containers/rsync/scripts/` gelegt:
- `rsync-pre-download-api.sh` - Meldet Download an API, triggert macct-repair bei Images
- `rsync-post-download-api.sh` - Meldet Download-Ende an API
- `rsync-pre-upload-api.sh` - Meldet Upload an API
- `rsync-post-upload-api.sh` - Meldet Upload-Ende an API

```bash
# Nach Fix: Container neu bauen
docker compose up -d --build rsync

# Verifizieren
rsync --list-only rsync://10.0.0.13/linbo/start.conf.amodrei
# Sollte Datei anzeigen statt "Connection refused"
```

**Commit:** `bbf747c` - "Fix rsync container: include API hook scripts and curl"

---

## 12. docker compose restart laedt keine neuen ENV-Variablen

### Problem
Nach Aenderung von `.env` (z.B. `DC_PROVISIONING_ENABLED=true`) zeigt der Container weiterhin die alten Werte.

### Ursache
`docker compose restart` startet den bestehenden Container neu, liest aber die `.env`-Datei NICHT erneut ein. Die Umgebungsvariablen wurden beim `docker compose up` festgelegt und bleiben bis zur Container-Neuinstallierung unveraendert.

### Loesung
Immer `docker compose up -d [service]` statt `docker compose restart [service]` verwenden:
```bash
# FALSCH - ENV-Aenderungen werden NICHT uebernommen
docker compose restart api

# RICHTIG - Container wird mit neuen ENV-Werten neu erstellt
docker compose up -d api
```

### Verifikation
```bash
docker exec linbo-api env | grep DC_PROVISIONING
# DC_PROVISIONING_ENABLED=true
# DC_PROVISIONING_DRYRUN=false
```

---

## 13. DC Worker Cross-Server Setup

### Problem
DC Worker muss auf dem AD DC (10.0.0.11) laufen, nicht im Docker-Stack auf der Test-VM (10.0.0.13), da nur der DC Zugriff auf `linuxmuster-import-devices`, `samba-tool` und `sam.ldb` hat.

### Loesung
1. Config erstellen auf dem DC (`/etc/linbo-docker/macct-worker.conf`):
```ini
REDIS_HOST=10.0.0.13
REDIS_PORT=6379
API_URL=http://10.0.0.13:3000/api/v1
API_KEY=linbo-internal-secret
CONSUMER_NAME=dc-01
```

2. Redis-Port im Docker-Stack exposen (`docker-compose.yml`):
```yaml
cache:
  ports:
    - "6379:6379"
```

3. Worker starten:
```bash
python3 /root/linbo-docker/dc-worker/macct-worker.py \
  --config /etc/linbo-docker/macct-worker.conf
```

4. Konnektivitaet pruefen:
```bash
redis-cli -h 10.0.0.13 -p 6379 PING  # PONG
curl -s http://10.0.0.13:3000/api/v1/health  # {"status":"healthy"}
```

---

## 14. Raum aufklappen zeigt keine Hosts (500 Error)

### Problem
Beim Aufklappen eines Raumes in der neuen Accordion-Ansicht erscheint "Fehler beim Laden der Hosts".
Im API-Log:
```
Unknown field `group` for include statement on model `Host`.
```

### Ursache
`containers/api/src/routes/rooms.js` (Zeile 58) enthielt noch ein `include: { group: ... }` aus der Zeit vor Phase 9 (Groups Removal). Das `group`-Modell existiert nicht mehr im Prisma Schema.

### Loesung
```javascript
// Vorher (rooms.js:57-60)
include: {
  group: { select: { id: true, name: true } },
  config: { select: { id: true, name: true } },
},

// Nachher
include: {
  config: { select: { id: true, name: true } },
},
```

**Commit:** `55b6766`

---

## 15. LINBO-Clients immer "Offline" obwohl in LINBO gebootet

### Problem
Ein Host, der in LINBO gebootet ist und aktiv per rsync Dateien synchronisiert, zeigt im Frontend dauerhaft Status "Offline".

### Ursache
Der rsync `pre-download` Event-Handler in `containers/api/src/routes/internal.js` aktualisierte nur das `lastSeen`-Feld, setzte aber **nicht** den Status auf `online`:

```javascript
// Vorher
case 'pre-download':
  if (host) {
    await prisma.host.update({
      where: { id: host.id },
      data: { lastSeen: new Date() },  // Nur lastSeen!
    });
  }
```

### Loesung
Status auf `online` setzen und WebSocket-Event broadcasten:

```javascript
case 'pre-download':
  if (host) {
    const wasOffline = host.status !== 'online';
    await prisma.host.update({
      where: { id: host.id },
      data: { lastSeen: new Date(), status: 'online' },
    });
    if (wasOffline) {
      ws.broadcast('host.status.changed', {
        hostId: host.id,
        hostname: host.hostname,
        status: 'online',
        previousStatus: host.status,
        timestamp: new Date(),
      });
    }
  }
```

**Hinweis:** Der Status wechselt erst beim naechsten rsync-Download (z.B. PXE-Boot, Cache-Sync). Es gibt aktuell keinen Heartbeat-Mechanismus.

**Commit:** `862dcd2`

---

## 16. SSH zu LINBO-Clients: Connection Refused (Port + Key)

### Problem
SSH vom API-Container zu LINBO-Clients schlägt fehl:
```
Error: connect ECONNREFUSED 10.0.150.2:22
```
Remote-Befehle (sync, start, reboot) über API funktionieren nicht.

### Ursache
Zwei Fehler in `containers/api/src/services/ssh.service.js`:
1. **Port 22 statt 2222**: LINBO-Clients (Dropbear) lauschen auf Port 2222
2. **Key-Pfad statt Key-Inhalt**: `ssh2` benötigt den SSH-Key als Buffer, nicht als Dateipfad

### Lösung
```javascript
// ssh.service.js: Key als Datei lesen
const fs = require('fs');
let loadedPrivateKey = null;
if (keyPath) {
  loadedPrivateKey = fs.readFileSync(keyPath);
}

const defaultConfig = {
  port: parseInt(process.env.SSH_PORT, 10) || 2222,  // war: 22
  privateKey: loadedPrivateKey,  // war: process.env.SSH_PRIVATE_KEY (Pfad!)
};
```

In `docker-compose.yml`:
```yaml
- SSH_PORT=2222   # war: SSH_PORT=22
```

### Verifikation
```bash
docker exec linbo-api node -e "
  const ssh = require('./src/services/ssh.service');
  ssh.testConnection('10.0.150.2').then(console.log);
"
# { success: true, connected: true }
```

---

## 17. Qt-GUI Buttons nicht klickbar (udevd/libinput)

### Problem
LINBO-GUI zeigt Buttons an, aber Maus-Klicks werden ignoriert. Cursor bewegt sich nicht.

### Ursache
`init.sh` startet udevd in `hwsetup()`, aber udevd stirbt bevor `linbo.sh` die GUI startet. Ohne udevd fehlt die `/run/udev/` Datenbank. Qt/libinput braucht `ID_INPUT=1` Properties um Input-Geräte zu erkennen.

### Status
**Verifiziert (2026-03-05):** Vanilla LINBO (ohne Patches) funktioniert korrekt — udevd bleibt am Leben und GUI-Buttons sind klickbar. Kein Patch nötig.

### Debug
```bash
# Auf dem Client via SSH:
pidof udevd                    # Muss PID zeigen
ls /run/udev/data/             # Muss Dateien enthalten
udevadm info --query=property --name=/dev/input/event3  # Muss ID_INPUT=1 zeigen
```

---

## 18. PTY Allocation Failed — SSH interaktive Shell

### Problem
```bash
linbo-ssh 10.0.150.2
# PTY allocation request failed on channel 0
# shell request failed on channel 0
```

### Ursache
LINBO-Clients booten ein minimales Linux (initramfs). Das `/dev/pts` Pseudo-Terminal-Dateisystem ist standardmäßig nicht gemountet.

### Status
**Verifiziert (2026-03-05):** Vanilla LINBO mountet devpts korrekt — SSH-PTY funktioniert ohne Patches.

### Sofort-Fix (falls Problem auftritt)
```bash
linbo-ssh -tt root@10.0.150.2 'mkdir -p /dev/pts && mount -t devpts devpts /dev/pts'
```

---

## 19. Deploy: "no configuration file provided"

### Problem
```bash
ssh root@10.0.0.13 "docker compose up -d --build api web"
# no configuration file provided: not found
```

### Ursache
SSH-Session startet in `/root/`, nicht in `/root/linbo-docker/`.

### Lösung
```bash
ssh root@10.0.0.13 "COMPOSE_FILE=/root/linbo-docker/docker-compose.yml \
  docker compose up -d --build api web"
```

Oder `scripts/deploy.sh` verwenden, das dies automatisch handhabt.

---

## 20. Web-Container Build: 401 Unauthorized (npm)

### Problem
```
npm ci: 401 Unauthorized - GET https://npm.pkg.github.com/download/@edulution-io/ui-kit/...
```

### Ursache
`@edulution-io/ui-kit` ist ein privates npm-Paket auf GitHub Packages.

### Lösung
GitHub-Token beim Build übergeben:
```bash
GITHUB_TOKEN=ghp_xxx docker compose up -d --build web
```

---

## 21. WebSocket "Getrennt" — Sidebar zeigt dauerhaft Disconnected

### Problem
Im Frontend zeigt die Sidebar dauerhaft "Getrennt" (roter Punkt) an. WebSocket verbindet sich, trennt sofort, verbindet erneut — Endlosschleife.

Im API-Log:
```
websocketClients: 0  (statt 1 oder 2)
```

### Ursache
Jede Route war einzeln mit `<ProtectedRoute><AppLayout>` gewrappt:
```tsx
// FALSCH — AppLayout wird bei JEDER Navigation neu gemountet
<Route path="hosts" element={<ProtectedRoute><AppLayout><HostsPage /></AppLayout></ProtectedRoute>} />
<Route path="rooms" element={<ProtectedRoute><AppLayout><RoomsPage /></AppLayout></ProtectedRoute>} />
```

Bei Navigation von `/hosts` zu `/rooms` wird `AppLayout` **komplett zerstört und neu erstellt**. Da `AppLayout` den `useWebSocket()` Hook enthält, wird die WS-Verbindung bei jeder Navigation getrennt und neu aufgebaut.

### Lösung
React Router **Layout Route Pattern**: Ein einziges `<AppLayout />` wrapping aller Kind-Routen via `<Outlet />`:

```tsx
// RICHTIG — AppLayout wird EINMAL gemountet und bleibt bestehen
<Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
  <Route path="hosts" element={<HostsPage />} />
  <Route path="rooms" element={<RoomsPage />} />
  ...
</Route>
```

**Geänderte Dateien:**
- `containers/web/frontend/src/routes/index.tsx` — Layout Route Refactor
- `containers/web/frontend/src/components/layout/AppLayout.tsx` — `children` → `<Outlet />`

**Zusätzlich:** Server-seitiger Heartbeat (Ping/Pong alle 30s) in `containers/api/src/index.js` um tote Verbindungen zu erkennen.

### Verifikation
```bash
# API Health prüfen — websocketClients sollte > 0 sein
curl -s http://localhost:3000/health | jq .websocketClients
# Erwartet: 1 oder 2 (je nach offene Browser-Tabs)
```

**Commit:** `cb599df`

---

## 22. Web-Terminal: Verbindung steht, aber keine Ein-/Ausgabe

### Problem
Im Terminal-Tab wird eine SSH-Verbindung erfolgreich hergestellt (grüner Punkt), aber:
- Kein Output sichtbar (leerer schwarzer Bildschirm)
- Tastatureingabe wird gesendet, aber keine Antwort angezeigt

### Ursache
**DOM-Element-Referenz-Fehler:** `TerminalPage` speicherte eine Ref auf ein Wrapper-`<div>`, aber `TerminalView` setzte `termWrite` auf ein anderes, inneres `containerRef`-Element. Die Referenzen zeigten auf **verschiedene DOM-Elemente**.

```tsx
// TerminalPage (FALSCH): Ref auf äußeres div
<div ref={(el) => { if (el) termRefs.current.set(tab.id, el); }}>
  <TerminalView ... />   // ← hat EIGENES containerRef, nicht das gleiche Element!
</div>

// Output-Handler versuchte:
const el = termRefs.current.get(sessionId);
el.termWrite?.(data);  // ← undefined, weil termWrite auf dem inneren Element liegt
```

### Lösung
**Globale Writer-Registry** statt DOM-Element-Hack:

```tsx
// TerminalView.tsx — Globale Map
const terminalWriters = new Map<string, (data: string) => void>();

export function getTerminalWriter(sessionId: string) {
  return terminalWriters.get(sessionId);
}

// In TerminalView: Registriert sich automatisch
useEffect(() => {
  if (sessionId) {
    terminalWriters.set(sessionId, (data) => termRef.current?.write(data));
    return () => { terminalWriters.delete(sessionId); };
  }
}, [sessionId]);

// TerminalPage.tsx — Output-Handler
case 'terminal.output': {
  const writer = getTerminalWriter(msg.sessionId!);
  if (writer) writer(msg.data!);
  break;
}
```

**Geänderte Dateien:**
- `containers/web/frontend/src/components/terminal/TerminalView.tsx`
- `containers/web/frontend/src/pages/TerminalPage.tsx`

**Commit:** `c2a290a`

---

## 23. SSH Key Permissions: API-Container hat keinen Zugriff

### Problem
Terminal-Verbindungen vom Testserver scheitern, obwohl sie vom Hauptserver funktionieren:
```
Error: Cannot read SSH key: EACCES: permission denied
```

### Ursache
Der API-Container läuft als User `linbo` (UID 1001). Die SSH-Key-Datei `config/linbo_client_key` hatte `root:root 600` auf dem Testserver.

### Lösung
```bash
chmod 644 /root/linbo-docker/config/linbo_client_key
```

**Hinweis:** Der Key ist kein geheimer Host-Key — er wird zum Verbinden mit LINBO-Clients verwendet, die den öffentlichen Schlüssel bereits kennen. `644` ist hier ausreichend sicher.

### Prüfung
```bash
# Auf dem Server:
ls -la /root/linbo-docker/config/linbo_client_key
# -rw-r--r-- 1 root root ... linbo_client_key

# Im Container:
docker exec linbo-api ls -la /app/config/linbo_client_key
# Muss lesbar sein für linbo:1001
```

---

## 24. SSH Keys fehlen nach frischem Clone (Auto-Key-Provisioning)

### Problem
Nach `git clone` + `docker compose up` auf einer neuen Maschine:
- Kein SSH zu LINBO-Clients möglich
- `linbo-ssh 10.0.150.2` → `Permission denied (publickey)`
- Web-Terminal → Verbindung schlägt fehl
- update-linbofs.sh kann keine SSH-Keys in linbofs64 einbetten

### Ursache
Drei Key-Dateien in `./config/` sind gitignored (und sollen es sein — Secrets gehören nicht ins Repo):
- `config/dropbear_rsa_host_key` — Dropbear RSA Host-Key für LINBO-Client SSH-Daemon
- `config/dropbear_dss_host_key` — Dropbear DSS Host-Key für LINBO-Client SSH-Daemon
- `config/linbo_client_key` — RSA-Key für API→Client SSH-Verbindungen

**Ohne diese Dateien:**
- Docker erstellt leere Dateien für fehlende Bind-Mounts → stille Fehler
- update-linbofs.sh bettet leere Keys in linbofs64 ein → Dropbear startet nicht
- API hat keinen privaten Schlüssel → kann nicht zu Clients verbinden

### Lösung: Auto-Key-Provisioning im SSH-Container

**Commit:** Session 26 — Keys werden nicht mehr als Bind-Mounts vom Host gemountet, sondern leben im persistenten `linbo_config` Docker-Volume. Der SSH-Container (`containers/ssh/entrypoint.sh`) generiert alle fehlenden Keys automatisch beim Start:

```bash
# Dropbear Host-Keys (für LINBO-Client SSH-Daemon in linbofs64)
dropbearkey -t rsa -f /etc/linuxmuster/linbo/dropbear_rsa_host_key
dropbearkey -t dss -f /etc/linuxmuster/linbo/dropbear_dss_host_key

# LINBO Client Key (API → Client SSH)
# Kopiert host /root/.ssh/id_rsa falls vorhanden, sonst generiert neu
ssh-keygen -t rsa -b 4096 -f /etc/linuxmuster/linbo/linbo_client_key -N ""

# server_id_rsa.pub (Kompatibilität mit update-linbofs.sh)
cp linbo_client_key.pub → server_id_rsa.pub
```

**Geänderte Dateien:**
- `containers/ssh/entrypoint.sh` — Auto-Generierung aller fehlenden Keys
- `docker-compose.yml` — 4 Key-Bind-Mounts entfernt (Zeilen 143-145, 149)
- `containers/api/Dockerfile` — `dropbear-bin` zu Runtime-Dependencies hinzugefügt
- `.gitignore` — `config/dropbear_*_host_key` hinzugefügt

### Verifikation
```bash
# Nach docker compose up: Alle Keys vorhanden?
docker exec linbo-ssh ls -la /etc/linuxmuster/linbo/
# Erwartet: dropbear_rsa_host_key, dropbear_dss_host_key,
#           linbo_client_key, linbo_client_key.pub, server_id_rsa.pub,
#           ssh_host_rsa_key, ssh_host_ed25519_key

# Logs prüfen (frische Installation):
docker logs linbo-ssh 2>&1 | grep -i "generat"
# Erwartet: "Generating Dropbear RSA host key..."
#           "Generating Dropbear DSS host key..."
#           "Generated new linbo_client_key"

# Bestehende Installation:
docker logs linbo-ssh 2>&1 | grep -i "key"
# Erwartet: Keine "Generating"-Meldungen (Keys existieren bereits)
```

### Migration bestehender Deployments
Keine manuellen Schritte nötig. Nach `git pull && docker compose up -d --build`:
- SSH-Container erkennt vorhandene Keys im Volume → überspringt Generierung
- `/root/.ssh/id_rsa` wird als `linbo_client_key` kopiert → gleicher Key wie vorher
- Bind-Mounts fallen weg, Volume-Keys werden genutzt

---

## 25. TFTP Race Condition — linbofs64 noch nicht gebaut

### Problem
Bei einem frischen Deployment (`git clone` + `docker compose up`) bootet ein LINBO-Client, aber SSH-Keys fehlen.

### Ursache
**Race Condition zwischen TFTP und API:** TFTP startet bevor API die linbofs64 mit SSH-Keys gebaut hat.

### Lösung: TFTP Entrypoint wartet auf Build-Marker

`containers/tftp/entrypoint.sh` blockiert den TFTP-Start, bis die linbofs64 gebaut ist:

```bash
MARKER="/srv/linbo/.linbofs-patch-status"
if [ -f "$MARKER" ]; then exec "$@"; fi
while [ ! -f "$MARKER" ]; do sleep 2; done
exec "$@"
```

### Startup-Reihenfolge
```
1. init        — lädt vanilla linbofs64 + boot files herunter
2. cache       — Redis startet
3. ssh         — generiert alle SSH-Keys (auto-provisioning)
4. api         — startet, baut linbofs64 (Keys + Module)
                 → schreibt .linbofs-patch-status
5. tftp        — Entrypoint erkennt Marker → startet TFTP
6. web         — Frontend (wartet auf api healthy)
```

---

## Aktueller Stand (2026-03-03)

### Hauptserver (10.0.0.11 - Produktion)
| Service | Status | Port | Notizen |
|---------|--------|------|---------|
| linbo-web | Running | 8080 | Frontend |
| linbo-api | Running | 3000 | REST API |
| linbo-ssh | Healthy | 2222 | LINBO SSH |
| linbo-rsync | Healthy | 873 | Image Sync |
| linbo-tftp | Healthy | 69/udp | PXE Boot |
| linbo-db | Healthy | - | PostgreSQL |
| linbo-cache | Healthy | - | Redis |

### Test-VM (10.0.0.13)
| Service | Status | Port | Notizen |
|---------|--------|------|---------|
| linbo-web | Running | 8080 | Frontend |
| linbo-api | Running | 3000 | REST API + Provisioning |
| linbo-ssh | Healthy | 2222 | LINBO SSH |
| linbo-rsync | Healthy | 873 | Image Sync (mit Hook-Fix) |
| linbo-tftp | Healthy | 69/udp | PXE Boot |
| linbo-db | Healthy | 5432 | PostgreSQL |
| linbo-cache | Healthy | 6379 | Redis (exposed fuer DC Worker) |

DC Worker laeuft auf 10.0.0.11 und verbindet sich zu Redis/API auf 10.0.0.13.

### Zugangsdaten
- **Produktion:** `http://10.0.0.11:8080/` - admin / admin123
- **Test-VM:** `http://10.0.0.13:8080/` - admin / admin123

### Implementierte Features
- [x] Raw Config Editor mit Datenbank-Synchronisation
- [x] start.conf Parser (LINBO, Partition, OS Sektionen)
- [x] Backup bei Dateiänderungen
- [x] GitHub Release mit Boot-Dateien
- [x] Host Provisioning via DC Worker (AD + DNS + devices.csv)
- [x] PXE Boot Chain: Config → GRUB → start.conf via rsync (E2E getestet)
- [x] SSH Web-Terminal (xterm.js) mit Tab-System
- [x] Sync-Modus Toggle (Runtime-Einstellung)
- [x] Vanilla LINBO Boot (keine Patches nötig)
- [x] WebSocket Heartbeat (Server-seitig Ping/Pong)
- [x] Auto-Key-Provisioning (SSH/Dropbear-Keys werden automatisch generiert)
- [x] TFTP Race Condition Fix (wartet auf linbofs64-Build)

### Bekannte Einschraenkungen
- TFTP-Container kann mit Produktions-TFTP kollidieren
- GitHub "latest" Tag funktioniert nicht fuer Downloads
- Bei DB-Neustart muessen User/Configs neu erstellt werden
- `docker compose restart` laedt KEINE neuen ENV-Variablen (immer `up -d` verwenden)
- Sync-Modus Umschalten erfordert Container-Restart (Routen werden beim Start gemountet)

---

## Checkliste für neue Installation

1. **Docker & Docker Compose installieren**
2. **Repository klonen:** `git clone https://github.com/amolani/linbo-docker.git`
3. **.env erstellen:** `cp .env.example .env` und anpassen
4. **Container starten:** `docker compose up -d`
   - Init lädt Boot-Dateien automatisch herunter
   - SSH-Container generiert alle SSH/Dropbear-Keys automatisch
   - API baut linbofs64 mit SSH-Keys + Kernel-Modulen
   - TFTP wartet auf gebaute linbofs64 bevor es startet
5. **Port-Konflikte prüfen:** Besonders TFTP (69/udp)
6. **Fertig!** — Kein manuelles Key-Kopieren oder Setup nötig

---

## Nützliche Befehle

```bash
# Alle Container Status
docker compose ps

# API Logs
docker logs linbo-api --tail 50

# In Container einloggen
docker exec -it linbo-api sh

# Datenbank direkt abfragen
docker exec linbo-db psql -U linbo -d linbo -c "SELECT * FROM users;"

# Volume Pfad finden
docker volume inspect linbo_srv_data --format '{{.Mountpoint}}'

# Berechtigungen korrigieren
chown -R 1001:1001 /var/lib/docker/volumes/linbo_srv_data/_data/

# Health Check manuell
docker exec linbo-api curl -s http://localhost:3000/health
```
