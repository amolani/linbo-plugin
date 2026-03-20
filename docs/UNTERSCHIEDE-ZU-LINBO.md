# Unterschiede zwischen LINBO Docker und Vanilla-LINBO (linuxmuster-linbo7)

Dieses Dokument beschreibt alle Abweichungen und Erweiterungen, die LINBO Docker gegenueber dem Original-LINBO-Paket (`linuxmuster-linbo7`) einfuehrt. Es richtet sich an Administratoren, Entwickler und alle, die verstehen wollen, was LINBO Docker anders macht — und warum.

> **Lesehinweis:** "Vanilla-LINBO" meint das unmodifizierte `linuxmuster-linbo7`-Paket, wie es im Rahmen von linuxmuster.net 7.x installiert wird. "LINBO Docker" meint die standalone Docker-Loesung in diesem Repository.

---

## Inhaltsverzeichnis

1. [Uebersicht](#1-uebersicht)
   - [Was ist LINBO?](#was-ist-linbo)
2. [Docker-exklusive Features](#2-docker-exklusive-features)
   - [2.1 Patchclass — Automatische Windows-Treiber-Installation](#21-patchclass--automatische-windows-treiber-installation)
   - [2.2 Firmware Auto-Detection](#22-firmware-auto-detection)
   - [2.3 Kernel Switching und Host-Kernel-Schutz](#23-kernel-switching-und-host-kernel-schutz)
   - [2.4 Web Terminal (xterm.js)](#24-web-terminal-xtermjs)
   - [2.5 GRUB Theme Customization](#25-grub-theme-customization)
   - [2.6 React Frontend (16 Seiten)](#26-react-frontend-16-seiten)
   - [2.7 Sync-Modus (Authority API Integration)](#27-sync-modus-authority-api-integration)
3. [Infrastruktur-Verbesserungen](#3-infrastruktur-verbesserungen)
   - [3.1 Auto-Key-Provisioning](#31-auto-key-provisioning)
   - [3.2 TFTP Race Condition Fix](#32-tftp-race-condition-fix)
4. [Boot-Kompatibilitaet](#4-boot-kompatibilitaet)
5. [Build-Pipeline: Strukturelle Unterschiede](#5-build-pipeline-strukturelle-unterschiede-update-linbofssh)
6. [Zusammenfassung](#6-zusammenfassung)

---

## 1. Uebersicht

| Feature | Vanilla-LINBO | LINBO Docker | Kategorie |
|---------|--------------|-------------|-----------|
| Patchclass (Windows-Treiber) | Nicht vorhanden | DMI + PCI/USB Matching, automatische Installation | Neues Feature |
| Firmware Auto-Detection | Statische Liste | SSH-Scan von Clients, automatische Injection | Neues Feature |
| Kernel Switching | Fester Kernel | 3-Schicht-Schutz + stable/longterm/legacy Varianten | Neues Feature |
| Web Terminal (xterm.js) | Nur CLI (`linbo-ssh`) | Browser-Terminal mit Tab-System | Neues Feature |
| GRUB Theme UI | Manuelle Konfiguration | Web-basierter Editor | Neues Feature |
| React Frontend | PHP webui7 | 16 Seiten, Dark Theme, WebSocket-Live-Updates | Neues Feature |
| Sync-Modus (Authority API) | Nicht vorhanden | Read-Only Delta-Feed von LMN Authority | Neues Feature |
| Auto-Key-Provisioning | Manuelle Installation | Automatische Generierung beim Container-Start | Infrastruktur |
| TFTP Race Condition Fix | N/A | Marker-basiertes Warten auf gebautes linbofs64 | Infrastruktur |
| Keine Boot-Patches noetig | N/A | Vanilla LINBO bootet korrekt mit Host-Kernel | Verifiziert 2026-03-05 |

---

## Was ist LINBO?

LINBO (**Li**nux **N**etwork **Bo**ot) ist das Netzwerk-Boot- und Imaging-System von [linuxmuster.net](https://linuxmuster.net). Es ermoeglicht, Hunderte von Clients gleichzeitig ueber das Netzwerk zu booten, mit Betriebssystem-Images zu bespielen und fernzusteuern.

### Boot-Kette

```
┌──────────┐   DHCP    ┌──────────┐   TFTP    ┌──────────┐
│  Client   │ ───────> │   DHCP   │ ───────> │   GRUB   │
│  PXE/UEFI │ <─ next- │  Server  │          │ Bootldr  │
└──────────┘  server   └──────────┘          └────┬─────┘
                                                   │
                       ┌───────────────────────────┘
                       │  GRUB laedt:
                       │  1. grub.cfg (TFTP, ~10KB)
                       │  2. <gruppe>.cfg (TFTP)
                       │  3. linbo64 (HTTP, 15MB Kernel)
                       │  4. linbofs64 (HTTP, 160MB Initramfs)
                       ▼
              ┌──────────────────┐
              │  Linux Kernel    │
              │  (linbo64)       │
              │       │          │
              │  Initramfs       │
              │  (linbofs64)     │
              │       │          │
              │  init.sh         │
              │  ├── hwsetup()   │  Treiber laden
              │  ├── network()   │  DHCP, IP, Server finden
              │  ├── dropbear    │  SSH-Daemon starten
              │  └── rsync       │  start.conf herunterladen
              │       │          │
              │  linbo.sh        │
              │  ├── udevd       │  Input-Devices erkennen
              │  └── linbo_gui   │  Qt-GUI starten
              └──────────────────┘
                       │
                  Nutzer waehlt Aktion
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
           Start     Sync      Neu
          (Boot)   (Image    (Format +
                   laden)    Sync + Boot)
```

### Kernsystem — Was LINBO auf dem Client macht

LINBO laeuft **komplett im RAM**. Es schreibt nichts auf die Festplatte des Clients, bis explizit ein Befehl (Sync, Format, Start) ausgefuehrt wird.

**init.sh** — Erster Userspace-Prozess nach Kernel-Boot:
- `hwsetup()` — Storage- und Netzwerk-Treiber laden, `/dev`-Symlinks erstellen
- `network()` — DHCP ausfuehren, Server-IP ermitteln, `/.env` mit Variablen schreiben
- dropbear SSH-Daemon starten (Port 2222)
- start.conf per rsync vom Server herunterladen

**linbo.sh** — GUI-Umgebung starten:
- linbo_gui-Bundle vom Server laden (falls nicht im Cache)
- udevd fuer Input-Device-Erkennung starten
- `linbo_gui` Qt-Anwendung starten (Framebuffer, kein X11)

**linbo_gui** — Qt6 GUI-Anwendung (23 MB, statisch gelinkt):
- Liest `/start.conf` und zeigt fuer jedes `[OS]` eine Karte mit Buttons
- **Start** — OS direkt booten (Chainload EFI/MBR)
- **Sync** — Image per rsync herunterladen und auf Partition schreiben
- **Neu** — Partition formatieren, Image herunterladen, booten
- Glassmorphism-Design mit Gradient-Hintergrund (Navy → Teal)

### start.conf — Konfigurationsdatei

Jeder Client erhaelt eine `start.conf`, die sein Boot-Verhalten steuert:

```ini
[LINBO]                          # Globale Einstellungen
Server = 10.0.0.13               # LINBO-Server-IP
Group = win11_pro                # Gruppe (bestimmt GRUB-Menue)
Cache = /dev/disk0p4             # Cache-Partition fuer Images
SystemType = efi64               # BIOS oder UEFI
KernelOptions = ...              # Kernel-Parameter

[Partition]                       # Partitionsdefinition
Dev = /dev/disk0p1
Label = efi
Size = 200M
Id = ef
FSType = vfat
Bootable = yes

[Partition]
Dev = /dev/disk0p3
Label = windows
Size = 70G
FSType = ntfs

[OS]                              # Betriebssystem-Definition
Name = Windows 11
BaseImage = win11_pro_edu.qcow2  # QCOW2-Image auf dem Server
Boot = /dev/disk0p3               # Boot-Partition
StartEnabled = yes                # "Start"-Button anzeigen
SyncEnabled = yes                 # "Sync"-Button anzeigen
NewEnabled = yes                  # "Neu"-Button anzeigen
DefaultAction = sync              # Standard-Aktion
```

**Dateipfade auf dem Server:**
- `/srv/linbo/start.conf.<gruppe>` — Pro Gruppe
- `/srv/linbo/start.conf-<ip>` — Symlink zur Gruppen-Datei

### Imaging-Pipeline

LINBO nutzt **QCOW2** (QEMU Copy-On-Write) als Image-Format:

```
/srv/linbo/images/
├── win11_pro_edu/
│   ├── win11_pro_edu.qcow2          # Komprimiertes Disk-Image
│   ├── win11_pro_edu.qcow2.md5      # Hash-Verifikation
│   └── win11_pro_edu.postsync       # Post-Sync-Script (optional)
```

**Sync-Ablauf:**
1. Client → rsync verbindet sich zum Server (`::linbo/images/...`)
2. Server sendet komprimiertes QCOW2-Image
3. Client schreibt Image direkt auf Partition (`/dev/disk0p3`)
4. MD5-Verifikation
5. Falls vorhanden: Postsync-Script ausfuehren (z.B. Treiber installieren)

**Postsync-Scripte** — Shell-Scripte, die nach dem Image-Sync auf dem Client laufen. Sie koennen die Windows-Partition mounten und Dateien aendern (Registry, Treiber, Konfiguration). Dies ist der Einstiegspunkt fuer das Patchclass-Feature.

### Remote Control (linbo-remote / SSH)

Der Server kann Befehle an LINBO-Clients senden:

```bash
# Vom Server aus:
linbo-remote -c "sync:1,start:1" 10.0.150.100

# Oder per linbocmd auf der GRUB-Kommandozeile:
linux /linbo64 server=10.0.0.13 linbocmd=sync:1,start:1
```

**Verfuegbare Befehle:**
| Befehl | Aktion |
|--------|--------|
| `start:<n>` | OS auf Partition n booten |
| `sync:<n>` | Image herunterladen und auf Partition n schreiben |
| `format:<n>` | Partition n formatieren |
| `partition` | Partitionstabelle neu schreiben |
| `initcache` | Cache initialisieren |
| `create_image:<n>` | Image von Partition n erstellen |
| `reboot` | Client neustarten |
| `halt` | Client herunterfahren |

Diese Befehle koennen verkettet werden: `format:3,sync:1,start:1` = formatieren, dann syncen, dann booten.

### GRUB-Konfiguration

LINBO nutzt GRUB als Bootloader mit dynamisch generierten Menueintraegen:

```
/srv/linbo/boot/grub/
├── grub.cfg                  # Hauptkonfiguration
├── win11_pro.cfg             # Gruppen-Menue
│   ├── menuentry 'LINBO'                    # LINBO-GUI starten
│   ├── menuentry 'Windows 11 (Start)'       # Direkt booten
│   ├── menuentry 'Windows 11 (Sync+Start)'  # Sync dann Boot
│   └── menuentry 'Windows 11 (Neu+Start)'   # Format+Sync+Boot
├── themes/linbo/             # Boot-Theme
└── x86_64-efi/               # UEFI-Module
```

**HTTP-Boot:** GRUB selbst wird per TFTP geladen (~10 KB). Der Kernel (15 MB) und das Initramfs (160 MB) werden per HTTP geladen — **5-10x schneller** als reines TFTP.

### rsync-Module

```ini
[linbo]                      # Read-Only: Images + Configs
path = /srv/linbo
read only = yes

[linbo-upload]               # Authentifiziert: Image-Upload
path = /srv/linbo
read only = no
auth users = linbo

[drivers]                    # Docker-exklusiv: Patchclass-Treiber
path = /var/lib/linbo/drivers
read only = yes
```

### SSH-Schluessel-Architektur

```
Server:
├── ssh_host_rsa_key           # OpenSSH Host-Key (Server-Identitaet)
├── dropbear_rsa_host_key      # Dropbear Host-Key (in linbofs64 injiziert)
├── linbo_client_key           # Private Key fuer Server → Client SSH
└── server_id_rsa.pub          # Public Key (in linbofs64 authorized_keys)

Client (in linbofs64):
├── /etc/dropbear/dropbear_rsa_host_key  # Client-SSH-Daemon
└── /.ssh/authorized_keys                # Erlaubt Server-Zugriff
```

---

## 2. Docker-exklusive Features

### 2.1 Patchclass — Automatische Windows-Treiber-Installation

**Was es macht:**
Ein vollstaendiges Pipeline-System fuer die automatische Erkennung und Installation von Windows-Treibern basierend auf der Hardware-Identifikation des Clients. Die Pipeline funktioniert wie folgt:

1. Der Administrator definiert eine **Patchclass** (z.B. `win11_standard`) und erstellt darin **Driver-Sets** (z.B. `Lenovo_L16`, `Dell_OptiPlex`)
2. In der `driver-map.json` werden **DMI-Matching-Rules** definiert, die Hardware-Modelle auf Driver-Sets abbilden
3. Die API generiert automatisch eine `driver-rules.sh` mit `case`-Statements fuer Vendor/Product-Matching
4. Ein **Postsync-Script** (`00-match-drivers.sh`) wird auf das QCOW2-Image deployed

Beim Client-Boot laeuft folgende Kette:
```
Client bootet -> DMI aus /sys/class/dmi/id/ lesen
  -> match_drivers() in driver-rules.sh
  -> rsync nur passende Driver-Sets vom Server (::drivers Modul)
  -> Kopie nach /mnt/Drivers/LINBO/
  -> Windows RunOnce Registry-Eintrag
  -> pnputil /add-driver installiert bei naechstem Windows-Start
```

Zusaetzliche Funktionen:
- **PCI/USB-ID-Matching** (`match_device_drivers()`): Erkennung ueber Hardware-IDs (4-stellig Hex), nicht nur DMI
- **Manifest-Hashing**: Nur geaenderte Driver-Sets werden synchronisiert (MD5-basiert)
- **Archiv-Extraktion**: ZIP, 7z und Inno-Setup-EXE werden serverseitig entpackt mit Security-Checks (Path-Traversal, Groessenlimits, Symlink-Entfernung)

**Warum es noetig war:**
In Schulnetzwerken mit heterogener Hardware (verschiedene Lenovo-, Dell-, HP-Modelle) fehlen nach einem Windows-Image-Sync regelmaessig Treiber fuer NIC, GPU oder Storage-Controller. Jedes neue Hardware-Modell erforderte bisher manuellen Eingriff — entweder im Image selbst oder ueber statische Postsync-Scripte.

**Was Vanilla-LINBO stattdessen macht:**
Kein automatischer Treiber-Mechanismus. Treiber muessen entweder direkt ins Master-Image integriert oder ueber manuell geschriebene Postsync-Scripte nachinstalliert werden. Es gibt keine DMI-basierte Hardware-Erkennung und kein Driver-Set-Konzept.

**Auswirkung wenn fehlend:**
Windows-Clients haben nach einem Sync fehlende NIC/GPU/Storage-Treiber. Insbesondere NIC-Treiber sind kritisch, da ohne Netzwerk kein Remote-Management moeglich ist. Jedes neue Hardware-Modell erfordert manuellen Eingriff ins Image.

---

### 2.2 Firmware Auto-Detection

**Was es macht:**
Erkennung fehlender Linux-Firmware durch SSH-Scan von laufenden LINBO-Clients:

1. API verbindet sich per SSH (Port 2222) zu einem laufenden Client
2. Liest PCI-Devices (`/sys/bus/pci/devices/`) und USB-Devices (`/sys/bus/usb/devices/`)
3. Vergleicht mit dem Firmware-Katalog auf dem Server (`/lib/firmware/`)
4. Identifiziert fehlende Firmware-Dateien (WLAN: iwlwifi, rtl8xxx; Bluetooth; Storage-Controller)
5. Fehlende Firmware wird in einer Konfigurationsdatei vermerkt
6. Beim naechsten `update-linbofs` Rebuild werden die Firmware-Dateien in das linbofs64-Initramfs injiziert

Das Firmware-Injection-System im `update-linbofs.sh` unterstuetzt:
- Automatische `.zst`-Dekompression (zstd-komprimierte Firmware)
- Symlink-Verfolgung innerhalb `/lib/firmware/` (aber Schutz gegen Symlinks ausserhalb)
- Path-Traversal-Schutz
- CRLF-Kompatibilitaet in der Konfigurationsdatei

**Warum es noetig war:**
Moderne Hardware (insbesondere Intel WLAN-Chips wie iwlwifi und Realtek USB-WLAN) benoetigt Firmware-Blobs, die nicht im Standard-linbofs64 enthalten sind. Ohne die passende Firmware kann der LINBO-Client kein WLAN nutzen, Bluetooth ist nicht verfuegbar, und manche NVMe-Controller funktionieren nicht.

**Was Vanilla-LINBO stattdessen macht:**
Statische Firmware-Liste, die mit dem Paket ausgeliefert wird. Keine automatische Hardware-Erkennung, kein SSH-Scan. Fehlende Firmware muss manuell identifiziert und in `/etc/linuxmuster/linbo/firmware` eingetragen werden.

**Auswirkung wenn fehlend:**
WLAN-Clients koennen sich nicht mit dem Netzwerk verbinden. Bluetooth-Peripherie funktioniert nicht. Bei manchen Laptops (insbesondere mit NVMe-Only-Storage) kann das Betriebssystem nicht gestartet werden.

---

### 2.3 Kernel Switching und Host-Kernel-Schutz

**Was es macht:**
Ein dreischichtiges Schutzsystem, das sicherstellt, dass LINBO-Clients immer mit einem Kernel booten, der ausreichend Hardware-Unterstuetzung bietet:

**Schicht 1 — Container-Entrypoint:**
Beim Start des API-Containers wird automatisch geprueft, ob der Host-Kernel (`/boot/vmlinuz`) noch mit dem Kernel in `/srv/linbo/linbo64` uebereinstimmt. Bei Abweichung wird der Host-Kernel zurueckkopiert.

**Schicht 2 — update-linbofs.sh:**
Die Umgebungsvariable `SKIP_KERNEL_COPY=true` verhindert, dass ein LINBO-Paket-Update den Host-Kernel ueberschreibt. Die Variable `USE_HOST_KERNEL=true` steuert, dass statt der Paket-Module die Host-Module (`/lib/modules/<kver>`) injiziert werden.

**Schicht 3 — linbo-update.service.js:**
Nach jedem LINBO-Rebuild wird automatisch geprueft, ob der Kernel in `/srv/linbo/linbo64` noch der Host-Kernel ist. Falls nicht, wird er zurueckkopiert.

Zusaetzlich:
- `.host-kernel-version` Marker fuer Drift-Detection bei Host-Kernel-Updates
- Kernel-Varianten: `stable`, `longterm`, `legacy` ueber die API umschaltbar
- Module werden per `rsync` oder `cp` injiziert, `depmod` wird ausgefuehrt

**Warum es noetig war:**
Das linbo7-Paket liefert einen minimalen Kernel mit ca. 720 Modulen (4.5 MB). Diesem Kernel fehlen Treiber fuer viele gaengige Netzwerkkarten (Intel igc, Realtek r8169), NVMe-Controller und USB-Geraete. Der Host-Kernel hat ca. 6000 Module (15 MB) und deckt nahezu alle Hardware ab.

**Wichtig:** Dies ist kein Docker-Spezifikum. Auch das produktive linuxmuster.net nutzt den Host-Kernel (`/boot/vmlinuz`) und nicht den Paket-Kernel. LINBO Docker macht das gleiche — nur expliziter und mit Schutz gegen versehentliches Ueberschreiben.

**Was Vanilla-LINBO stattdessen macht:**
Vanilla-LINBO verwendet ebenfalls den Host-Kernel, aber ohne expliziten Schutzmechanismus. Ein `apt upgrade` des linbo7-Pakets kann den Host-Kernel ueberschreiben, ohne dass dies bemerkt wird. Es gibt keine Varianten-Auswahl und keine automatische Drift-Detection.

**Auswirkung wenn fehlend:**
Clients verlieren nach dem GRUB-Handoff die Netzwerkverbindung, weil der Paket-Kernel den NIC-Treiber nicht enthaelt. Die LINBO-GUI zeigt "This LINBO client is in remote control mode." — der Client ist nicht mehr steuerbar. Dies ist der haeufigste und kritischste Fehler bei LINBO-Docker-Installationen.

---

### 2.4 Web Terminal (xterm.js)

**Was es macht:**
Ein vollwertiges interaktives SSH-Terminal im Browser:

- Eigener WebSocket-Endpunkt `/ws/terminal` mit JWT-Authentifizierung
- SSH2-Bibliothek verbindet sich zum LINBO-Client (Port 2222, Key-Auth)
- PTY-Allokation (pseudo-terminal) mit exec-Modus als Fallback
- xterm.js Frontend mit FitAddon (automatische Groessenanpassung) und WebLinksAddon (klickbare Links)
- Tab-System fuer mehrere gleichzeitige Verbindungen
- Maximal 10 gleichzeitige Sessions, 30 Minuten Idle-Timeout
- Verbindungstest-Endpunkt (`POST /terminal/test-connection`)

**Warum es noetig war:**
Debugging von LINBO-Clients erfordert oft interaktiven Shell-Zugang. In einer Docker-Umgebung ohne direkten SSH-Zugang zum Host ist ein browserbasiertes Terminal der natuerliche Weg. Insbesondere fuer Administratoren, die keinen SSH-Client installiert haben oder von einem Tablet/Chromebook aus arbeiten.

**Was Vanilla-LINBO stattdessen macht:**
Nur das Kommandozeilen-Tool `linbo-ssh` (Wrapper um `ssh -p 2222 -i <key>`). Kein Web-UI, keine Session-Verwaltung, kein Verbindungstest. Der Administrator muss einen SSH-Client installiert haben und den korrekten Key-Pfad kennen.

**Auswirkung wenn fehlend:**
Kein interaktiver Debug-Zugang ueber den Browser. Administratoren ohne SSH-Erfahrung koennen Client-Probleme nicht direkt diagnostizieren.

---

### 2.5 GRUB Theme Customization

**Was es macht:**
Web-basierter Editor fuer das GRUB-Boot-Menue:

- Logo- und Icon-Upload (PNG-Validierung)
- Farbschema anpassen: Desktop-Hintergrund, Item-Farben, Selection-Farben, Timeout-Darstellung
- Dynamische `theme.txt`-Generierung aus den Web-Einstellungen
- Vorschau im Browser

**Warum es noetig war:**
Schulen wollen oft ein eigenes Branding im Boot-Menue (Schullogo, Farben). Die manuelle Bearbeitung von `theme.txt` und das Kopieren von Bilddateien ist fehleranfaellig und erfordert GRUB-Kenntnisse.

**Was Vanilla-LINBO stattdessen macht:**
Manuelle Bearbeitung der Dateien in `/srv/linbo/boot/grub/themes/`. Kein Web-Editor, keine Vorschau. Das Standard-Theme wird mit dem Paket installiert.

**Auswirkung wenn fehlend:**
Generisches GRUB-Menue ohne Schulbranding. Funktional kein Problem, aber optisch nicht angepasst.

---

### 2.6 React Frontend (16 Seiten)

**Was es macht:**
Eine vollstaendige Single-Page-Application als Verwaltungsoberflaeche:

**Tech-Stack:**
- React 18 + TypeScript + Vite + Tailwind CSS
- Zustand State Management (5 Stores: auth, host, ws, notification, serverConfig)
- WebSocket mit Auto-Reconnect fuer Echtzeit-Updates
- Axios HTTP-Client mit JWT-Interceptor
- Dark Theme (schwarz/blau)

**8 Seiten mit Entsprechung in webui7:**

| Seite | Funktion |
|-------|----------|
| DashboardPage | Uebersicht: Hosts online, Images, Speicher |
| HostsPage | Host-Verwaltung mit Echtzeit-Status |
| RoomsPage | Raum-Verwaltung mit Sammelaktionen |
| ConfigsPage | start.conf-Editor mit Vorschau |
| ImagesPage | Image-Verwaltung (QCOW2/CLOOP) |
| OperationsPage | Operationen (sync, start, create) |
| DhcpPage | DHCP-Export (ISC, dnsmasq) |
| LoginPage | JWT-Authentifizierung |

**8 Docker-exklusive Seiten:**

| Seite | Funktion |
|-------|----------|
| TerminalPage | Interaktives SSH-Terminal (xterm.js) |
| DriversPage | Patchclass/Driver-Management |
| FirmwarePage | Firmware Auto-Detection und Injection |
| KernelPage | Kernel-Varianten und Host-Kernel-Schutz |
| GrubThemePage | GRUB Theme Editor |
| LinboGuiPage | LINBO GUI-Konfiguration |
| SettingsPage | Runtime-Einstellungen (Redis-backed) |
| SyncPage | Sync-Modus Verwaltung und Status |

**Warum es noetig war:**
webui7 ist eng mit der linuxmuster.net-Infrastruktur (Sophomorix, LDAP, webui7-Session-Management) verzahnt und kann nicht standalone betrieben werden. LINBO Docker benoetigt eine eigene Oberflaeche, die ohne diese Abhaengigkeiten funktioniert.

**Was Vanilla-LINBO stattdessen macht:**
Die linuxmuster.net-Weboberflaeche (webui7, PHP-basiert) mit LINBO-Modulen. Diese setzt eine vollstaendige linuxmuster.net-Installation voraus (Samba AD, Sophomorix, Webui7-Server).

**Auswirkung wenn fehlend:**
Keine grafische Verwaltung. Alle Operationen muessten ueber die REST-API oder Kommandozeile erfolgen.

---

### 2.7 Sync-Modus (Authority API Integration)

**Was es macht:**
Integration mit einem bestehenden linuxmuster.net-Server als "Authority" (Datenquelle):

- **Cursor-basierter Delta-Feed:** Nur Aenderungen seit dem letzten Sync werden abgerufen (Endpunkt `:8400`)
- **Redis als Cache:** Hosts, Configs und Rooms werden als `sync:host:{mac}`, `sync:config:{group}` etc. gecacht
- **Read-Only fuer LMN-Daten:** Host/Config/Room CRUD-Endpunkte geben `409 SYNC_MODE_ACTIVE` zurueck
- **start.conf server= Umschreibung:** Die Server-IP in heruntergeladenen start.conf-Dateien wird auf die Docker-IP umgeschrieben
- **Operations via Redis:** Im Sync-Modus werden Operationen ausschliesslich in Redis gespeichert (kein PostgreSQL)
- **Toggle per API:** `sync_enabled` kann als Runtime-Setting umgeschaltet werden

Routing im Sync-Modus (aus `routes/index.js`):
```
Immer aktiv: auth, sync, internal, system, patchclass, settings, terminal, images
Sync-Modus:  hosts/rooms/configs/stats/dhcp -> 409 SYNC_MODE_ACTIVE
             operations -> sync-operations (Redis-only)
Standalone:  Alle Routen mit vollem Prisma-Support
```

**Warum es noetig war:**
LINBO Docker soll als Ergaenzung zu einem bestehenden linuxmuster.net-Server betrieben werden koennen, ohne die Host- und Konfigurationsdaten doppelt pflegen zu muessen. Der Sync-Modus macht LINBO Docker zum "Satellite-Server".

**Was Vanilla-LINBO stattdessen macht:**
Kein Multi-Server-Konzept. LINBO ist integraler Bestandteil des linuxmuster.net-Servers. Es gibt keine Authority-API, keinen Delta-Feed und keinen Read-Only-Modus.

**Auswirkung wenn fehlend:**
LINBO Docker kann nur standalone betrieben werden. Alle Hosts und Konfigurationen muessen manuell angelegt werden, auch wenn bereits ein linuxmuster.net-Server existiert.

---

## 3. Infrastruktur-Verbesserungen

### 3.1 Auto-Key-Provisioning

**Was es macht:**
Der SSH-Container generiert beim Start automatisch alle fehlenden kryptographischen Schluessel:

```bash
# Aus containers/ssh/entrypoint.sh:
# 1. SSH Host Keys (RSA + Ed25519)
ssh-keygen -t rsa -b 4096 -f /etc/linuxmuster/linbo/ssh_host_rsa_key -N ""
ssh-keygen -t ed25519 -f /etc/linuxmuster/linbo/ssh_host_ed25519_key -N ""

# 2. Dropbear Host Keys (fuer LINBO-Client-SSH-Daemon)
dropbearkey -t rsa -f /etc/linuxmuster/linbo/dropbear_rsa_host_key
dropbearkey -t dss -f /etc/linuxmuster/linbo/dropbear_dss_host_key

# 3. LINBO Client Key (API -> Client SSH-Verbindungen)
ssh-keygen -t rsa -b 4096 -f /etc/linuxmuster/linbo/linbo_client_key -N ""

# 4. server_id_rsa.pub (Kompatibilitaet mit update-linbofs.sh)
cp linbo_client_key.pub server_id_rsa.pub
```

Alle Keys werden im `linbo_config` Docker Volume gespeichert und ueberleben Container-Neustarts.

**Warum es noetig war:**
Problem: Die SSH-Keys sind in `.gitignore` gelistet (sie gehoeren nicht ins Repository). Bei einem frischen `git clone` existieren die Key-Dateien nicht. Docker-Bind-Mounts erzeugen in diesem Fall leere Dateien statt Verzeichnisse, was zu stillen Fehlern fuehrt:
- Dropbear im LINBO-Client startet nicht (leerer Host-Key)
- SSH von API zu Client schlaegt fehl (leerer Client-Key)
- `update-linbofs.sh` injiziert leere Keys ins Initramfs

**Was Vanilla-LINBO stattdessen macht:**
Keys werden einmalig bei der linuxmuster.net-Installation generiert (`linuxmuster-setup`). Bei Verlust muessen sie manuell neu generiert werden. Es gibt keine automatische Erkennung fehlender Keys.

**Auswirkung wenn fehlend:**
Nach `git clone && docker compose up` funktioniert SSH nicht:
- Kein Dropbear auf LINBO-Clients (kein `linbo-ssh`)
- Kein Web-Terminal
- Kein Remote-Management (Operationen wie sync, start, shutdown)

---

### 3.2 TFTP Race Condition Fix

**Was es macht:**
Der TFTP-Container wartet auf ein Marker-File (`.linbofs-patch-status`), bevor er Clients bedient:

```bash
# Aus containers/tftp/entrypoint.sh:
MARKER="/srv/linbo/.linbofs-patch-status"
TIMEOUT=300  # 5 Minuten max

if [ -f "$MARKER" ]; then
    # Bestehende Installation: sofort starten
    exec "$@"
fi

# Frischer Deploy: warten bis API linbofs64 gebaut hat
while [ ! -f "$MARKER" ] && [ $elapsed -lt $TIMEOUT ]; do
    sleep 2
    elapsed=$((elapsed + 2))
done
exec "$@"
```

Zusaetzlich in `docker-compose.yml`: `depends_on: api`

**Warum es noetig ist:**
Bei einem frischen Deploy muss die API zuerst `update-linbofs.sh` ausfuehren (SSH-Keys und Kernel-Module injizieren). Ohne den Marker serviert TFTP eine linbofs64 ohne SSH-Keys.

**Was Vanilla-LINBO stattdessen macht:**
Nicht anwendbar. In Vanilla-LINBO gibt es keine Container. Der TFTP-Server (atftpd) wird nach der Paketinstallation gestartet.

---

## 4. Boot-Kompatibilitaet

### Vanilla LINBO funktioniert ohne Patches

**Verifiziert am 2026-03-05** auf realer Hardware (Intel Core Ultra 5 125U, NVMe SSD, Intel NIC):
Vanilla LINBO bootet korrekt mit dem Host-Kernel. Alle Funktionen funktionieren:
- Netzwerk (DHCP, rsync, start.conf-Download)
- GUI (Buttons klickbar, Maus/Tastatur)
- SSH (PTY-Allokation, devpts)
- Block-Device-Symlinks (NVMe disk0pN + disk0N)
- Storage-Module (vom Host-Kernel automatisch geladen)

### Was `update-linbofs.sh` macht

Das Build-Script injiziert nur noch:
1. **SSH-Keys** (Dropbear Host-Keys, Authorized Keys)
2. **Passwort-Hash** (Argon2, fuer linbo-Zugang)
3. **Host-Kernel-Module** (aus `/lib/modules/$(uname -r)`)
4. **Firmware** (optional, aus `/etc/linuxmuster/linbo/firmware`)
5. **GUI-Themes** (optional)
6. **wpa_supplicant.conf** (optional, fuer WLAN)

Keine Vanilla-Dateien (`init.sh`, `linbo.sh`, `linbo_link_blkdev`) werden modifiziert.

### Host-Kernel ist kein Docker-Spezifikum

Die Nutzung des Host-Kernels statt des Paket-Kernels ist **kein** Docker-spezifischer Hack. Das produktive linuxmuster.net macht exakt das Gleiche — `update-linbofs.sh` kopiert `/boot/vmlinuz` nach `/srv/linbo/linbo64`. LINBO Docker macht dies nur expliziter und schuetzt aktiv gegen versehentliches Ueberschreiben.

---

## 5. Build-Pipeline: Strukturelle Unterschiede (update-linbofs.sh)

Die folgende Tabelle zeigt alle strukturellen Unterschiede zwischen dem originalen LMN `update-linbofs` Script (Paket `linuxmuster-cachingserver-linbo7` v4.3.31) und der Docker-Variante (`scripts/server/update-linbofs.sh`). Das LMN-Original ist als Referenz gepinnt unter `scripts/server/update-linbofs-lmn-original.sh`.

> **Hinweis:** Diese Tabelle betrifft nur den Build-Prozess (update-linbofs.sh), nicht die Docker-exklusiven Features (Patchclass, Firmware-Scan, Web-UI etc.), die in den obigen Abschnitten beschrieben sind.

| # | Bereich | LMN Original | Docker | Begruendung |
|---|---------|-------------|--------|-------------|
| 1 | Abhaengigkeiten | `source helperfunctions.sh` (braucht vollen LMN-Stack) | Eigenstaendiger Config-Block | Docker hat kein linuxmuster-base7-Paket |
| 2 | Lock-Mechanismus | Datei-basiert (`/tmp/.update-linbofs.lock`, touch+rm) | flock-basiert (fd 8, `CONFIG_DIR/.rebuild.lock`) | Race-Condition-sicher fuer shared Docker Volumes |
| 3 | Firmware-Provisioning | Download von kernel.org + Parsen von LINBO-Client-Logs | Config-Datei-basiert mit Pfad-Traversal-Schutz, zst-Dekompression, Symlink-Checks | Kein Client-Log-Zugriff in Docker; Security-gehaertet |
| 4 | Locale-Injection | `copy_locale()` -- volle Locale-Unterstuetzung mit chroot locale-gen | Via Hook `00_inject-locale` aus Ubuntu-Container (locale-archive, i18n, timezone) | **KRITISCH:** Ohne Locale crashed `linbo_gui` (Qt6) lautlos → Black Screen. Siehe `docs/POSTMORTEM-LINBOFS64-BOOT.md` |
| 5 | CPIO-Format | Ein XZ-Segment: `find . \| cpio \| xz` | Ein XZ-Segment via fakeroot (identisch zu LMN). Fallback: Zwei Segmente ohne fakeroot | fakeroot emuliert Root-Rechte, Device-Nodes werden normal erstellt |
| 6 | CPIO-Ownership | Laeuft als root, kein --owner-Flag noetig | fakeroot: kein Flag noetig (wie LMN). Fallback: `--owner 0:0` | fakeroot macht Build identisch zu nativem LMN |
| 7 | GUI-Themes | Paket-Themes, kein Injektionsmechanismus | Theme-Injection aus `$LINBO_DIR/gui-themes/` | Docker unterstuetzt Custom-Branding |
| 8 | Custom linbo_gui | Kein Custom-Binary-Support | Optionaler Binary-Override aus `$CONFIG_DIR/linbo_gui` | Docker unterstuetzt Custom-GUI-Builds |
| 9 | Build-Status-Marker | Kein Marker | `.linbofs-patch-status` nach erfolgreichem Build | TFTP-Container wartet auf diesen Marker |
| 10 | Docker-Volume-Sync | Nicht anwendbar | Kopiert zu Docker-Volume-Mountpoint falls abweichend von LINBO_DIR | Stellt sicher, dass TFTP aktualisierte Dateien ausliefert |
| 11 | efipxe devicenames | Kopiert `efipxe` nach `usr/share/linbo` | Nicht kopiert | Docker nutzt GRUB HTTP Boot, efipxe nicht noetig |
| 12 | Custom inittab | Unterstuetzt Anfuegen von `$LINBOSYSDIR/inittab` | Nicht unterstuetzt | Docker-linbofs nutzt Standard-inittab |
| 13 | ISO-Erstellung | Ruft `make-linbo-iso.sh` nach Build auf | Keine ISO-Erstellung | Docker liefert via TFTP/HTTP, kein ISO noetig |
| 14 | Backup vor Rebuild | Kein Backup | Erstellt `linbofs64.bak` vor Rebuild | Rollback-Faehigkeit fuer Docker-Deployments |
| 15 | Groessenverifikation | Keine Groessenpruefung | Minimum 10MB-Check auf neue Datei | Verhindert Deploy von korruptem/leerem linbofs64 |
| 16 | Hook-Ausfuehrung | Unsortiertes find, keine exportierten Vars, Fehler koennen Build stoppen | Sortierte Ausfuehrung, exportierte Vars, Fehler warnen aber stoppen nicht | Verbesserte Zuverlaessigkeit und Hook-Developer-Experience |

---

## 6. Zusammenfassung

### Docker-exklusive Features sind Mehrwert

Die 7 Docker-exklusiven Features (Patchclass, Firmware-Detection, Kernel Switching, Web Terminal, GRUB Theme UI, React Frontend, Sync-Modus) sind keine Abweichungen, sondern zusaetzliche Funktionalitaet. Sie aendern kein Vanilla-LINBO-Verhalten und koennen potenziell als Upstream-Beitraege in linuxmuster-linbo7 einfliessen.

### Keine Patches noetig

LINBO Docker modifiziert **keine einzige Vanilla-Datei** im linbofs64-Archiv. Das Build-Script injiziert nur Keys, Module und optionale Konfiguration. Alles andere (REST-API, Frontend, Sync-Modus) laeuft serverseitig in Docker-Containern.

### Container-Basis: Ubuntu/Debian (kein Alpine)

Alle Docker-Container basieren auf **Debian Bookworm** oder **Ubuntu 24.04** (kein Alpine Linux). Grund: Der `update-linbofs.sh`-Build laeuft im API-Container und benoetigt glibc-basierte Locale-Dateien (`locale-archive`, `locale-gen`), die Alpine (musl libc) nicht hat. Ohne Locale crashed die Qt6-GUI (`linbo_gui`) im linbofs64 lautlos. Siehe `docs/POSTMORTEM-LINBOFS64-BOOT.md` fuer Details.

### Hook-System fuer linbofs64-Anpassungen

Inhaltliche Aenderungen am linbofs64 erfolgen ausschliesslich ueber Pre-Repack-Hooks in `config/hooks/update-linbofs.pre.d/`:

| Hook | Funktion |
|------|----------|
| `00_inject-locale` | Locale-Dateien aus Ubuntu-Container ins linbofs64 (entspricht `copy_locale()` im LMN-Original) |
| `01_edulution-plymouth` | Custom Plymouth Splash-Theme (Edulution-Branding) |
| `02_preserve-cmdline-server` | `server=` Parameter aus Kernel-Cmdline in init.sh schuetzen |

### GRUB-Boot: Direkt TFTP, keine Cache-Suche

Docker-Clients booten immer per PXE/TFTP. Die GRUB-Config enthaelt **keine lokale Cache-Partition-Suche** (im Gegensatz zum LMN-Original). `set root="(tftp)"` wird direkt gesetzt, `timeout=0`.

---

*Letzte Aktualisierung: 2026-03-13*
*LINBO Docker Version: Aktueller Stand auf `main` Branch*
