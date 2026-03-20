# LINBO Docker - Installationsanleitung

Diese Anleitung beschreibt die Installation von LINBO Docker im **Sync-Modus** mit einem bestehenden linuxmuster.net-Server. Nach Abschluss aller Schritte bootet ein Testclient per PXE und zeigt die LINBO-GUI. Fuer Details zur Container-Architektur und Netzwerk-Diagramme siehe [docs/ADMIN-GUIDE.md](ADMIN-GUIDE.md).

> **Hinweis:** LINBO Docker kann auch im Standalone-Modus ohne linuxmuster.net betrieben werden. Diese Anleitung behandelt ausschliesslich den Sync-Modus.

---

## 1. Voraussetzungen

### Hardware

| Ressource | Minimum | Empfohlen |
|-----------|---------|-----------|
| RAM | 4 GB | 8 GB |
| Festplatte | 50 GB (mehr fuer Images) | 100 GB+ |
| Netzwerk | Interface im PXE-Subnet | Dediziertes Interface |
| CPU | 2 Kerne | 4 Kerne |

### Betriebssystem

- Ubuntu 22.04 LTS oder 24.04 LTS
- Debian 12 (Bookworm)

### Docker Engine

Falls Docker noch nicht installiert ist:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Nach dem Hinzufuegen zur `docker`-Gruppe: **Abmelden und neu anmelden**, damit die Gruppenmitgliedschaft aktiv wird.

> **Offizielle Dokumentation:** https://docs.docker.com/engine/install/

Docker Compose v2 ist als Plugin in modernen Docker-Engine-Versionen enthalten. Pruefung:

```bash
docker compose version
# Docker Compose version v2.x.x
```

### Weitere Voraussetzungen

- **Netzwerkzugang** zu `deb.linuxmuster.net` (HTTPS, Port 443) -- der Init-Container laedt LINBO-Pakete von dort
- **openssl** -- fuer die sichere Generierung von Secrets (JWT, API-Keys, Passwoerter)

```bash
# Pruefen ob openssl installiert ist:
openssl version
# Falls nicht: apt-get install openssl
```

---

## 2. Installation

### Repository klonen

```bash
git clone https://github.com/amolani/linbo-docker.git
cd linbo-docker
```

### Setup-Wizard ausfuehren

```bash
./setup.sh
```

Der Setup-Wizard fuehrt folgende Schritte automatisch durch:

**7 Prerequisite-Checks:**
1. **Privileges** -- root oder Mitglied der `docker`-Gruppe
2. **Docker** -- Docker Engine installiert und Daemon laeuft
3. **Docker Compose** -- Compose v2 Plugin vorhanden
4. **Disk space** -- Mindestens 2 GB freier Speicher auf `/srv` bzw. `/`
5. **DNS resolution** -- `deb.linuxmuster.net` loesbar
6. **Network connectivity** -- `deb.linuxmuster.net` per HTTPS erreichbar
7. **OpenSSL** -- fuer Secret-Generierung

**Port-Konflikt-Pruefung:**
- Port 69/udp (TFTP) -- darf nicht von einem anderen TFTP-Server belegt sein
- Port 873/tcp (rsync) -- darf nicht von einem anderen rsync-Dienst belegt sein

**Automatische IP-Erkennung:**
- Erkennt die IP-Adresse auf dem Default-Route-Interface
- Im interaktiven Modus: Bestaetigung oder manuelle Eingabe moeglich

**Sichere Secret-Generierung:**
- `JWT_SECRET` -- fuer API-Authentifizierung (Base64, 48 Bytes)
- `INTERNAL_API_KEY` -- fuer Container-zu-Container-Kommunikation (Hex, 32 Bytes)
- `DB_PASSWORD` -- PostgreSQL-Passwort
- `RSYNC_PASSWORD` -- fuer rsync-Authentifizierung

**GITHUB_TOKEN-Abfrage:**
- Der Web-Container benoetigt einen GitHub-Token fuer den Zugriff auf private npm-Pakete (`@edulution-io/ui-kit`)
- Token erstellen unter: https://github.com/settings/tokens (Scope: `read:packages`)
- Ohne Token schlaegt der Build des Web-Containers fehl (wird in einer zukuenftigen Version entfallen, siehe OSS-01)

**Ergebnis:**
- `.env` (Mode 600) -- Konfigurationsdatei mit allen Variablen
- `config/rsyncd.secrets` (Mode 600) -- rsync-Authentifizierung

### .env Ueberblick

Die wichtigsten Variablen in der generierten `.env`:

| Variable | Beschreibung | Standardwert |
|----------|-------------|--------------|
| `LINBO_SERVER_IP` | IP-Adresse des Docker-Hosts im PXE-Netzwerk | automatisch erkannt |
| `JWT_SECRET` | Secret fuer API-Token-Signierung | automatisch generiert |
| `GITHUB_TOKEN` | Token fuer npm-Pakete (Web-Container) | manuell eingegeben |
| `ADMIN_USERNAME` | Web-UI Administrator-Benutzername | `admin` |
| `ADMIN_PASSWORD` | Web-UI Administrator-Passwort | `Muster!` |
| `SYNC_ENABLED` | Sync-Modus aktivieren | `false` |
| `LMN_API_URL` | URL der linuxmuster.net API | `https://10.0.0.11:8001` |
| `LMN_API_KEY` | API-Key fuer Sync-Authentifizierung | leer |
| `WEB_PORT` | Port fuer das Web-Interface | `8080` |
| `API_PORT` | Port fuer die REST API | `3000` |

> **Wichtig:** `ADMIN_PASSWORD=Muster!` ist das Standard-Passwort. Aendern Sie es nach dem ersten Login im Web-UI unter *Settings*.

---

## 3. Erster Start

### Container starten

```bash
docker compose up -d
```

### Auf Bereitschaft warten

```bash
make wait-ready
```

Dieser Befehl blockiert, bis alle Container gesund (healthy) sind (Timeout: 120 Sekunden). Waehrend des ersten Starts passiert Folgendes:

**Init-Container (`linbo-init`):**
- Laedt das `linbo7`-Paket (.deb) von `deb.linuxmuster.net` herunter
- Extrahiert Boot-Dateien: `linbo64`, `linbofs64`, GRUB-Module, Kernel
- Wird nach erfolgreichem Abschluss automatisch beendet (Exit 0)

**SSH-Container (`linbo-ssh`):**
- Generiert automatisch alle fehlenden SSH- und Dropbear-Keys
- Keys werden im persistenten Volume `linbo_config` gespeichert
- Kein manuelles Key-Management noetig

**Cache-Container (`linbo-cache`):**
- Redis startet und wird fuer Health-Checks bereit

**API-Container (`linbo-api`):**
- Wartet auf: Cache healthy, SSH gestartet, Init abgeschlossen
- Baut `linbofs64` -- injiziert SSH-Keys und Kernel-Module
- Erzeugt GRUB-Konfigurationen fuer PXE-Boot
- Schreibt den `.linbofs-patch-status` Marker nach erfolgreichem Build

**TFTP-Container (`linbo-tftp`):**
- Wartet auf den `.linbofs-patch-status` Marker, bevor TFTP gestartet wird
- Stellt sicher, dass nur eine fertig gebaute `linbofs64` ausgeliefert wird

**Web-Container (`linbo-web`):**
- Startet Nginx mit der React-SPA
- Wartet auf API healthy, bevor er als ready gilt

> **Erster Start:** Dauert ca. 2-5 Minuten (abhaengig von der Internet-Geschwindigkeit fuer den Download des linbo7-Pakets).

---

## 4. Verifikation

### System-Diagnose

```bash
make doctor
```

`doctor.sh` prueft 6 Kategorien mit insgesamt 24 Checks:

| Kategorie | Was geprueft wird |
|-----------|-------------------|
| **Container Health** | Alle 6 Services healthy (cache, api, web, tftp, rsync, ssh) + Init Exit-Code |
| **Volume Permissions** | `/srv/linbo` schreibbar durch API-Container (UID 1001) |
| **SSH Keys** | 4 Key-Dateien vorhanden (ssh_host_rsa_key, .pub, linbo_client_key, .pub) |
| **linbofs64 Build Status** | `.linbofs-patch-status` Marker und `linbofs64` Boot-Image vorhanden |
| **Redis Connectivity** | Redis antwortet auf PING mit PONG |
| **PXE Port Reachability** | Ports 69/udp, 873/tcp, 3000/tcp, 2222/tcp lauschen |

**Alle Checks muessen PASS zeigen.** Bei einem FAIL wird direkt der Fix-Befehl angezeigt.

### Web-UI

Oeffnen Sie im Browser:

```
http://<LINBO_SERVER_IP>:8080
```

Login:
- **Benutzer:** `admin`
- **Passwort:** `Muster!`

### API Health-Check

```bash
curl -sf http://localhost:3000/health
```

Erwartete Antwort:
```json
{"status":"ok"}
```

---

## 5. DHCP-Konfiguration

LINBO Docker bringt **keinen eigenen DHCP-Server** mit (ausser einem optionalen Proxy-DHCP-Container). Fuer PXE-Boot muessen DHCP-Optionen auf dem bestehenden DHCP-Server konfiguriert werden.

### Option A: Bestehender DHCP-Server

#### ISC DHCP (dhcpd)

In der DHCP-Konfiguration (z.B. `/etc/dhcp/dhcpd.conf` oder `/etc/dhcp/custom.conf`):

```
option architecture-type code 93 = unsigned integer 16;

if option architecture-type = 00:07 {
    filename "boot/grub/x86_64-efi/core.efi";
} elsif option architecture-type = 00:09 {
    filename "boot/grub/x86_64-efi/core.efi";
} else {
    filename "boot/grub/i386-pc/core.0";
}

next-server <LINBO_SERVER_IP>;
```

Ersetzen Sie `<LINBO_SERVER_IP>` durch die IP-Adresse Ihres Docker-Hosts.

#### dnsmasq

Fuer Schulen, die dnsmasq als DHCP-Server einsetzen:

```
dhcp-match=set:bios,option:client-arch,0
dhcp-match=set:efi64,option:client-arch,7
dhcp-match=set:efi64,option:client-arch,9
dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,<LINBO_SERVER_IP>
dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,<LINBO_SERVER_IP>
```

### Option B: Eingebauter Proxy-DHCP-Container

```bash
docker compose --profile dhcp up -d
```

Der Proxy-DHCP-Container (dnsmasq) **ergaenzt** einen bestehenden DHCP-Server:
- Vergibt **keine** IP-Adressen
- Sendet nur PXE-Boot-Optionen (`next-server` + `filename`) an Clients
- **Vorteil:** Der bestehende DHCP-Server muss nicht veraendert werden

Konfiguration in `.env`:
```bash
DHCP_INTERFACE=eth0   # Netzwerk-Interface fuer PXE (anpassen!)
```

### BIOS vs. UEFI

| Client-Typ | Boot-Datei | Protokoll |
|------------|-----------|-----------|
| BIOS (Legacy) | `boot/grub/i386-pc/core.0` | TFTP |
| UEFI (x86_64) | `boot/grub/x86_64-efi/core.efi` | TFTP |

Die meisten modernen PCs verwenden UEFI. Aeltere Geraete oder VMs booten haeufig noch im BIOS-Modus. Die DHCP-Konfiguration oben erkennt den Client-Typ automatisch (Option 93: architecture-type).

---

## 6. Erster PXE-Boot (Verifikation)

### Testclient vorbereiten

1. Stellen Sie sicher, dass der Testclient im gleichen Netzwerk wie der Docker-Host ist
2. Konfigurieren Sie die Boot-Reihenfolge im BIOS/UEFI: **Network Boot (PXE) zuerst**
3. Bei UEFI: Secure Boot ggf. deaktivieren

### Erwartete Boot-Sequenz

```
Client PXE-Boot
  |
  v
DHCP --> Client erhaelt IP + PXE-Optionen (next-server, filename)
  |
  v
GRUB (via TFTP, Port 69) --> GRUB-Menue erscheint mit LINBO Boot-Eintrag
  |
  v
Kernel + linbofs64 (via HTTP, Port 8080) --> Kernel-Meldungen auf dem Bildschirm
  |
  v
init.sh --> hwsetup() --> Netzwerk-Treiber laden, DHCP
  |
  v
linbo_gui --> LINBO-GUI erscheint mit Gruppen-Buttons
```

### Was bei jedem Schritt zu sehen ist

**GRUB-Menue:**
- Eintrag "LINBO" oder der Name der start.conf-Gruppe
- Falls das Menue nicht erscheint: DHCP-Konfiguration pruefen (next-server, filename)

**Kernel-Meldungen:**
- Netzwerk-Treiber werden geladen (z.B. `e1000e`, `igc`, `r8169`)
- Falls der Kernel haengt: Kernel-Module pruefen (siehe Troubleshooting)

**LINBO-GUI:**
- Grafische Oberflaeche mit Buttons fuer die konfigurierten Betriebssysteme
- Falls die GUI nicht erscheint aber eine Shell sichtbar ist: `linbofs64` Build pruefen

### Wenn es haengt

| Symptom | Pruefschritt |
|---------|-------------|
| Kein DHCP-Angebot | DHCP-Server-Konfiguration pruefen: `next-server` und `filename` gesetzt? |
| GRUB "File not found" | TFTP pruefen: `make doctor` -> PXE Port Reachability |
| Kernel panic / no init | `linbofs64` Build-Status pruefen: `make doctor` -> linbofs64 Build Status |
| Kein Netzwerk nach Kernel | Kernel-Module pruefen: `make doctor` -> Container Health |
| GUI erscheint nicht | Logs pruefen: `docker logs linbo-api --tail 50` |

---

## 7. Sync-Modus einrichten

Der Sync-Modus verbindet LINBO Docker mit einem bestehenden linuxmuster.net-Server. Hosts, Configs und Rooms werden ausschliesslich auf dem LMN-Server verwaltet -- Docker ist **permanent read-only** fuer diese Daten und konsumiert sie via Cursor-basiertem Delta-Feed.

### Voraussetzung: Authority API

Auf dem LMN-Server muss eine API laufen, die den Delta-Feed bereitstellt (z.B. die linuxmuster.net-API auf Port 8001 oder die Authority API auf Port 8400).

### Konfiguration

In der `.env`-Datei:

```bash
SYNC_ENABLED=true
LMN_API_URL=http://10.0.0.11:8001
LMN_API_KEY=<api-key>
```

Ersetzen Sie `10.0.0.11` durch die IP Ihres LMN-Servers und `<api-key>` durch den entsprechenden API-Key.

Container mit neuer Konfiguration neu erstellen:

```bash
docker compose up -d
```

> **Wichtig:** Verwenden Sie `docker compose up -d` und **nicht** `docker compose restart`. Nur `up -d` liest die `.env`-Datei neu ein.

### Verifikation

```bash
curl -sf http://localhost:3000/api/v1/sync/status | python3 -m json.tool
```

Erwartete Ausgabe (Auszug):
```json
{
    "connected": true,
    "mode": "sync",
    ...
}
```

Im Web-UI unter *Sync* ist der Sync-Status ebenfalls sichtbar.

---

## 8. Haeufige Probleme

### 1. Port 69/udp belegt (anderer TFTP-Server)

**Symptom:** TFTP-Container startet nicht.

```bash
ss -ulnp | grep :69
```

**Loesung:** Den bestehenden TFTP-Server stoppen:
```bash
systemctl stop tftpd-hpa && systemctl disable tftpd-hpa
# oder:
systemctl stop dnsmasq && systemctl disable dnsmasq
```

Dann Container neu starten:
```bash
docker compose up -d tftp
```

### 2. Permission-Fehler (EACCES)

**Symptom:** API meldet `EACCES: permission denied` beim Schreiben in `/srv/linbo`.

```bash
docker exec linbo-api ls -la /srv/linbo
```

**Loesung:** Berechtigungen auf dem Docker Volume korrigieren:
```bash
VOLUME_PATH=$(docker volume inspect linbo_srv_data -f '{{.Mountpoint}}')
chown -R 1001:1001 "$VOLUME_PATH"
```

### 3. .env-Aenderungen nicht aktiv

**Symptom:** Nach Aenderung der `.env` zeigt der Container alte Werte.

**Ursache:** `docker compose restart` liest die `.env` **nicht** neu ein.

**Loesung:** Immer `up -d` verwenden:
```bash
# FALSCH:
docker compose restart api

# RICHTIG:
docker compose up -d api
```

### 4. Web-Container Build scheitert (401 Unauthorized)

**Symptom:** `npm ci` meldet `401 Unauthorized` beim Download von `@edulution-io/ui-kit`.

**Loesung:** `GITHUB_TOKEN` in `.env` pruefen:
```bash
grep GITHUB_TOKEN .env
```

Falls leer: Token unter https://github.com/settings/tokens erstellen (Scope: `read:packages`) und in `.env` eintragen, dann:
```bash
docker compose up -d --build web
```

### 5. TFTP liefert leeres/unfertiges linbofs64

**Symptom:** Client bootet, aber SSH-Keys fehlen oder Kernel-Module nicht vorhanden.

**Ursache:** TFTP hat ausgeliefert, bevor die API die `linbofs64` fertig gebaut hat.

**Loesung:** Build-Status pruefen:
```bash
make doctor
```

Der Check "linbofs64 patch status marker exists" muss PASS zeigen. Falls FAIL:
```bash
# Rebuild ausloesen:
curl -X POST http://localhost:3000/api/v1/system/update-linbofs
# Dann warten:
make wait-ready
```

---

Ausfuehrliche Fehlerdiagnose mit 25 dokumentierten Problemen und Loesungen: [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 9. Naechste Schritte

- **Admin-Handbuch:** [docs/ADMIN-GUIDE.md](ADMIN-GUIDE.md) -- Container-Architektur, Netzwerk-Diagramm, Firewall-Regeln, Design-Entscheidungen
- **Hook-System:** [docs/hooks.md](hooks.md) -- linbofs64 anpassen (z.B. Plymouth-Theme, zusaetzliche Dateien)
- **Vergleich mit Vanilla-LINBO:** [docs/UNTERSCHIEDE-ZU-LINBO.md](UNTERSCHIEDE-ZU-LINBO.md) -- was Docker anders macht und warum

### Nuetzliche Befehle

| Befehl | Beschreibung |
|--------|-------------|
| `make up` | Alle Container starten |
| `make down` | Alle Container stoppen |
| `make doctor` | 24 Diagnose-Checks in 6 Kategorien |
| `make wait-ready` | Warten bis alle Container healthy |
| `make logs` | API-Logs anzeigen (tail -f) |
| `make logs-all` | Alle Container-Logs anzeigen |
| `make rebuild` | API + Web neu bauen |
| `make rebuild-all` | Alle Container neu bauen |
| `make health` | Quick Health-Check (API + Web) |
| `make status` | Git + Docker Status anzeigen |
| `make test` | Test-Suite ausfuehren |
