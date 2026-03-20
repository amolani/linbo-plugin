# Patchclass-Treiber-Pipeline — Vollständige Dokumentation

> Automatische Windows-Treiberinstallation via LINBO Postsync
> Stand: 2026-03-04

## Inhaltsverzeichnis

1. [Übersicht](#1-übersicht)
2. [Architektur-Diagramm](#2-architektur-diagramm)
3. [Server-Architektur](#3-server-architektur)
4. [Frontend-Workflow](#4-frontend-workflow)
5. [Client-Ablauf (Postsync)](#5-client-ablauf-postsync)
6. [End-to-End Sequenzdiagramm](#6-end-to-end-sequenzdiagramm)
7. [Datenformate](#7-datenformate)
8. [Fehlerbehebung](#8-fehlerbehebung)
9. [Bekannte Bugs und Fixes](#9-bekannte-bugs-und-fixes)

---

## 1. Übersicht

### Zweck

Die Patchclass-Pipeline ermöglicht die **automatische Installation von Windows-Treibern** auf LINBO-verwalteten Clients. Nach jedem Image-Sync erkennt das System die Hardware des Clients (DMI, PCI/USB-IDs) und installiert die passenden Treiber — vollautomatisch, ohne manuellen Eingriff.

### Kernkonzepte

| Begriff | Beschreibung |
|---------|-------------|
| **Patchclass** | Container für Hardware-Modelle, Treiber-Sets und Matching-Regeln (z.B. `lenovo`) |
| **Treiber-Set** | Verzeichnis mit Windows-Treiberdateien (.inf/.sys/.cat) für ein Modell (z.B. `L16`) |
| **Driver Map** | JSON-Konfiguration: welche Hardware welche Treiber-Sets bekommt |
| **Driver Rules** | Auto-generiertes Shell-Script mit `case`-Statement für DMI-Matching |
| **Postsync** | Shell-Script das nach jedem Image-Sync auf dem Client ausgeführt wird |
| **Manifest** | JSON mit Hashes für inkrementellen Download (nur geänderte Sets) |

### Protokolle

| Phase | Protokoll | Port | Beschreibung |
|-------|-----------|------|-------------|
| Treiber-Download | rsync | 873/tcp | Server → Client-Cache (Modul `::drivers`) |
| Kopie auf NTFS | lokal (cp) | — | Cache → gemountete Windows-Partition |
| Treiberinstallation | pnputil | — | Windows installiert .inf beim nächsten Boot |

---

## 2. Architektur-Diagramm

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LINBO Docker Server                          │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────────┐    │
│  │   Frontend    │    │   API (3000)  │    │  rsync (873)       │    │
│  │   (React)     │───▶│   Express.js  │    │  ::drivers (ro)    │    │
│  │               │    │              │    │  ::linbo   (ro)    │    │
│  │  Patchclass-  │    │  patchclass  │    │                    │    │
│  │  Manager.tsx  │    │  .service.js │    │  /var/lib/linbo/   │    │
│  └──────────────┘    └──────┬───────┘    │    drivers/         │    │
│                             │            └─────────┬──────────┘    │
│                             │                      │               │
│                             ▼                      │               │
│  ┌──────────────────────────────────────┐         │               │
│  │  /var/lib/linbo/drivers/<patchclass>/ │◀────────┘               │
│  │                                       │                         │
│  │  driver-map.json     (Konfiguration)  │                         │
│  │  driver-rules.sh     (Auto-generiert) │                         │
│  │  driver-manifest.json (Hashes)        │                         │
│  │  drivers/                             │                         │
│  │    L16/              (Treiber-Set)    │                         │
│  │      *.inf, *.sys, *.cat              │                         │
│  │    _generic/         (Default-Set)    │                         │
│  │  common/                              │                         │
│  │    postsync.d/                        │                         │
│  │      00-match-drivers.sh              │                         │
│  └──────────────────────────────────────┘                         │
│                                                                     │
│  ┌──────────────────────────────────────┐                         │
│  │  /srv/linbo/images/<image>/           │                         │
│  │    win11_pro_edu.postsync (deployed)  │                         │
│  │    win11_pro_edu.qcow2    (Image)     │                         │
│  └──────────────────────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────┘

        rsync ::drivers (Port 873)          rsync ::linbo (Port 873)
                │                                    │
                ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        LINBO Client (PXE)                           │
│                                                                     │
│  linbo_sync restores Image → sources postsync                      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  /cache/linbo-drivers/<patchclass>/                       │      │
│  │                                                           │      │
│  │  driver-rules.sh        ◀── rsync ::drivers/.../          │      │
│  │  driver-manifest.json   ◀── rsync ::drivers/.../          │      │
│  │  .repohash              (lokaler Cache-Hash)              │      │
│  │  common/postsync.d/                                       │      │
│  │    00-match-drivers.sh  ◀── rsync ::drivers/.../common/   │      │
│  │  drivers/                                                 │      │
│  │    L16/                 ◀── rsync ::drivers/.../drivers/   │      │
│  │      .sethash           (lokaler Set-Hash)                │      │
│  │      *.inf, *.sys, *.cat                                  │      │
│  └──────────────────────────────────────────────────────────┘      │
│                          │                                          │
│                          │ cp -ar                                   │
│                          ▼                                          │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  /mnt/ (gemountete Windows-NTFS-Partition)                │      │
│  │                                                           │      │
│  │  Drivers/LINBO/                                           │      │
│  │    L16/                                                   │      │
│  │      *.inf, *.sys, *.cat                                  │      │
│  │    pnputil-install.cmd  (RunOnce-Script)                  │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  Registry RunOnce → beim nächsten Windows-Boot:                    │
│    pnputil /add-driver C:\Drivers\LINBO\*.inf /subdirs /install    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Server-Architektur

### 3.1 API-Routen

**Datei:** `containers/api/src/routes/patchclass.js`

#### Patchclass CRUD

| HTTP | Route | Beschreibung |
|------|-------|-------------|
| GET | `/patchclass` | Alle Patchclasses auflisten |
| POST | `/patchclass` | Neue Patchclass erstellen |
| GET | `/patchclass/:name` | Detail-Info (Models, Sets, Size) |
| DELETE | `/patchclass/:name` | Patchclass komplett löschen |

#### Driver Map & Models

| HTTP | Route | Beschreibung |
|------|-------|-------------|
| GET | `/patchclass/:name/driver-map` | Driver Map lesen |
| PUT | `/patchclass/:name/driver-map` | Driver Map aktualisieren → Rules regenerieren |

#### Treiber-Sets

| HTTP | Route | Beschreibung |
|------|-------|-------------|
| GET | `/patchclass/:name/driver-sets` | Alle Sets auflisten |
| POST | `/patchclass/:name/driver-sets` | Neues Set erstellen |
| DELETE | `/patchclass/:name/driver-sets/:set` | Set löschen |
| GET | `/patchclass/:name/driver-sets/:set/files` | Dateien im Set auflisten |
| POST | `/patchclass/:name/driver-sets/:set/upload` | Einzeldatei hochladen (multipart) |
| POST | `/patchclass/:name/driver-sets/:set/extract` | Archiv entpacken (ZIP/7z/EXE) |
| DELETE | `/patchclass/:name/driver-sets/:set/files` | Datei löschen |

#### Device Rules (PCI/USB-ID Matching)

| HTTP | Route | Beschreibung |
|------|-------|-------------|
| POST | `/patchclass/:name/device-rules` | PCI/USB-Regel hinzufügen |
| DELETE | `/patchclass/:name/device-rules/:ruleName` | Regel entfernen |

#### Postsync & Scan

| HTTP | Route | Beschreibung |
|------|-------|-------------|
| GET | `/patchclass/:name/deployed-postsyncs` | Aktive Postsyncs auflisten |
| POST | `/patchclass/:name/deploy-postsync/:image` | Postsync zu Image deployen |
| POST | `/patchclass/scan-client` | Hardware-Scan via SSH |
| GET | `/patchclass/catalog` | Treiber-Katalog (Kategorien + Einträge) |
| GET | `/patchclass/catalog/search?q=intel` | Katalog durchsuchen |

### 3.2 Service-Layer

**Datei:** `containers/api/src/services/patchclass.service.js` (~1009 Zeilen)

#### Kernfunktionen

**`regenerateRules(pcName)`** — Herzstück der DMI-Matching-Engine

Liest `driver-map.json` und generiert `driver-rules.sh`:

```bash
match_drivers() {
  local vendor="$1"
  local product="$2"
  case "$vendor::$product" in      # :: als Separator (NICHT |, siehe Bug #1)
    LENOVO::21L4S00P00)
      DRIVER_SETS="L16"
      ;;
    *)
      DRIVER_SETS="_generic"        # Default-Sets
      ;;
  esac
}
```

Zusätzlich wird `match_device_drivers()` generiert (PCI/USB-ID Matching), falls `deviceRules` vorhanden.

**`deployPostsyncToImage(pcName, imageName)`**

1. Auto-append `.qcow2` wenn keine Extension
2. Generiert Postsync-Script aus Template (`{{PATCHCLASS}}`, `{{IMAGENAME}}`)
3. Schreibt nach `images/<imageBase>/<imageBase>.postsync`
4. Broadcast WebSocket-Event

**`extractDriverZip(pcName, setName, archivePath)`**

1. Erkennt Format: `.zip` → unzip, `.7z`/`.exe` → 7z
2. Sicherheitschecks: max 50.000 Einträge, max 4 GB, keine Path-Traversal
3. **Inno Setup Fallback:** Wenn 7z nur PE-Sections entpackt (.text, .rsrc) → `innoextract` als Fallback
4. Auto-Flatten: Wenn genau 1 Wrapper-Verzeichnis (z.B. `code$GetExtractPath$/`) → Inhalte hochziehen
5. Symlinks entfernen, Manifest regenerieren

**`listDeployedPostsyncs(pcName)`**

Scannt `/srv/linbo/images/*/` nach `*.postsync`-Dateien die `PATCHCLASS="<pcName>"` enthalten.

### 3.3 Pfad-Sicherheit

**Datei:** `containers/api/src/lib/driver-path.js`

| Konstante | Wert | Beschreibung |
|-----------|------|-------------|
| `PATCHCLASS_BASE` | `/var/lib/linbo/drivers` | Basis für alle Patchclass-Daten |
| `IMAGE_DIR` | `/srv/linbo/images` | LINBO Image-Verzeichnis |
| `MAX_ZIP_ENTRIES` | 50.000 | Maximale Einträge pro Archiv |
| `MAX_ZIP_SIZE` | 4 GB | Maximale entpackte Größe |

**Sicherheitsfunktionen:**
- `sanitizeName()` — Regex `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$`
- `sanitizeRelativePath()` — Keine absoluten Pfade, kein `..`, keine Backslashes
- `resolveAndValidate()` — Realpath-Check verhindert Symlink-Ausbruch

### 3.4 rsync-Konfiguration

**Modul `[drivers]`** in `config/rsyncd.conf`:

```conf
[drivers]
comment = LINBO Driver repository (read-only, per-patchclass)
path = /var/lib/linbo/drivers
use chroot = no
read only = yes
list = yes
```

Clients greifen zu über: `rsync://server/drivers/<patchclass>/...`

### 3.5 Templates

**`postsync-patchclass.sh`** — Wird als `<imageBase>.postsync` deployt

Variablen: `{{PATCHCLASS}}`, `{{IMAGENAME}}` werden bei Deploy ersetzt.

5 Phasen:
1. rsync Manifest + Rules vom Server
2. rsync Common-Overlays + Ausführung postsync.d Scripts
3. Common-Overlays nach /mnt kopieren (ohne drivers/, postsync.d/, tarpacks/)
4. Timestamp schreiben
5. Self-Update: neueste Postsync-Version vom Server holen

**`00-match-drivers.sh`** — Wird in `common/postsync.d/` kopiert

Das eigentliche Matching-Script (siehe [Abschnitt 5](#5-client-ablauf-postsync)).

---

## 4. Frontend-Workflow

### 4.1 Komponenten-Übersicht

**Datei:** `containers/web/frontend/src/components/drivers/PatchclassManager.tsx`

```
PatchclassManager (Hauptkomponente)
├── Patchclass-Selector (Auswahl + Erstellen)
├── DriverScanCard (Hardware-Scan)
└── Detail-Grid (bei ausgewählter Patchclass):
    ├── DriverSetsCard (Treiber-Sets verwalten)
    ├── DriverMapCard (Hardware-Modelle + DMI-Matching)
    ├── DeviceRulesCard (PCI/USB-ID Regeln)
    └── DeployCard (Postsync zu Image deployen)
```

### 4.2 DriverScanCard — Hardware erkennen

1. IP-Adresse eingeben (oder Online-Host aus Dropdown wählen)
2. Klick "Scannen" → SSH zum Client, liest DMI-Daten
3. Ergebnis: `sys_vendor` + `product_name` + bestehende Matches
4. **"Übernehmen"-Button** → füllt DriverMapCard automatisch

### 4.3 DriverMapCard — Hardware-Modelle konfigurieren

**Manuell:**
1. Klick "+ Modell"
2. Formular: Name, sys_vendor, product_name, Match-Typ (Exact/Contains)
3. Treiber-Sets per Button-Toggle auswählen
4. "Hinzufügen" → Server regeneriert Rules

**Auto-Fill (nach Scan):**
1. Scan → "Übernehmen" → `scanDmi` State gesetzt
2. `useEffect(prefillDmi)` feuert:
   - `sysVendor`, `productName`, `modelName` vorausgefüllt
   - Alle verfügbaren Treiber-Sets automatisch ausgewählt
   - Formular öffnet sich
3. User kann anpassen oder direkt speichern

**Default-Treiber:** Kommagetrennte Liste von Sets die IMMER installiert werden (z.B. `_generic`).

### 4.4 DriverSetsCard — Treiber-Dateien verwalten

- **Set erstellen:** Name eingeben → leeres Verzeichnis wird angelegt
- **Einzeldatei hochladen:** Klick "Datei" → Upload
- **Archiv entpacken:** Klick "Archiv" → ZIP/7z/EXE → Progress-Bar → Entpacken
  - Unterstützt: `.zip`, `.7z`, `.exe` (inkl. Inno Setup wie Lenovo SCCM-Pakete)
- **Dateiliste:** Set aufklappen → zeigt alle Dateien mit Größe
- **Set löschen:** Trash-Icon → Bestätigung → rekursives Löschen

### 4.5 DeployCard — Postsync aktivieren

1. **Image-Dropdown** zeigt alle verfügbaren Images (aus `imagesApi.list()`)
2. Klick "Deploy" → Server erstellt Postsync-Script im Image-Verzeichnis
3. **Aktive Postsyncs:** Liste mit grünem Häkchen zeigt deployete Postsyncs (Image, Pfad, Größe, Datum)

### 4.6 DeviceRulesCard — PCI/USB-ID Matching

- **Katalog:** Vorgefertigte Treiber-Einträge nach Hersteller/Gerät durchsuchen
- **Kategorien ignorieren:** z.B. "USB" ausblenden → diese Geräte werden nicht gematcht
- **Manuelle Regeln:** PCI/USB Vendor:Device ID → Treiber-Set zuordnen

### 4.7 API-Client

**Datei:** `containers/web/frontend/src/api/patchclass.ts`

20 Methoden für CRUD, Upload, Extract, Deploy, Scan — alle mit Axios + JWT-Auth.

---

## 5. Client-Ablauf (Postsync)

### 5.1 Auslösung

```
LINBO GUI → "Sync" Button → linbo_cmd synconly
  → Image wird aus Cache nach /dev/nvme0n1p3 restauriert
  → NTFS-Partition wird nach /mnt gemountet (read-write)
  → postsync-patchclass.sh wird gesourced
```

### 5.2 Postsync-Phasen (postsync-patchclass.sh)

**Umgebungsvariablen (vom LINBO-System gesetzt):**

| Variable | Beispiel | Quelle |
|----------|----------|--------|
| `LINBOSERVER` | `10.0.0.13` | LINBO Environment (/.env) |
| `HOSTNAME` | `pc100` | LINBO Environment |
| `HOSTGROUP` | `win11_pro` | LINBO Environment |

**Vom Template gesetzte Variablen:**

| Variable | Beispiel | Quelle |
|----------|----------|--------|
| `PATCHCLASS` | `lenovo` | Template-Substitution `{{PATCHCLASS}}` |
| `IMAGENAME` | `win11_pro_edu.qcow2` | Template-Substitution `{{IMAGENAME}}` |
| `CACHE` | `/cache/linbo-drivers/lenovo` | Abgeleitet aus PATCHCLASS |

#### Phase 1: Manifest + Rules holen

```bash
rsync -q "${SERVERIP}::drivers/${PATCHCLASS}/driver-manifest.json" "$CACHE/"
rsync -q "${SERVERIP}::drivers/${PATCHCLASS}/driver-rules.sh" "$CACHE/"
```

Wenige KB — immer frisch vom Server geholt.

#### Phase 2: Common-Overlays + postsync.d

```bash
rsync -r "${SERVERIP}::drivers/${PATCHCLASS}/common/" "$CACHE/common/"

# Alle Scripts in postsync.d/ ausführen
for SCRIPT in "$CACHE/common/postsync.d"/*; do
    sh "$SCRIPT"    # → 00-match-drivers.sh
done
```

Hier wird `00-match-drivers.sh` ausgeführt (siehe [5.3](#53-driver-matching-00-match-driverssh)).

#### Phase 3: Common-Overlays kopieren

Dateien aus `common/` (außer `drivers/`, `postsync.d/`, `tarpacks/`) nach `/mnt/` kopieren. Erlaubt z.B. Registry-Patches, Konfigurationsdateien etc.

#### Phase 4: Tarpacks entpacken

Falls `common/tarpacks/` existiert: `.tar.gz`-Archive nach `/mnt/` entpacken.

#### Phase 5: Self-Update

```bash
rsync -q "${SERVERIP}::linbo/images/${IMAGEBASE}/${IMAGEBASE}.postsync" /cache/
```

Holt die neueste Version des Postsync-Scripts vom Server.

### 5.3 Driver-Matching (00-match-drivers.sh)

Das Herzstück der Pipeline — 5 Sub-Phasen:

#### Sub-Phase 1: Manifest-Hash-Check

```bash
REPO_HASH=$(sed -n 's/.*"repoHash"...\([0-9a-f]*\).*/\1/p' "$CACHE/driver-manifest.json")
CACHED_HASH=$(cat "$CACHE/.repohash")

if [ "$REPO_HASH" = "$CACHED_HASH" ]; then
    NEED_SYNC=0    # Keine Änderungen → Download überspringen
fi
```

**Optimierung:** Wenn der Manifest-Hash identisch ist, werden keine Treiber-Sets heruntergeladen. Nur bei Änderungen am Server wird rsync ausgelöst.

#### Sub-Phase 2: DMI-Matching

```bash
# Hardware-Daten lesen (aus BIOS/UEFI)
SYS_VENDOR=$(cat /sys/class/dmi/id/sys_vendor | tr -d '\n\r')
PRODUCT_NAME=$(cat /sys/class/dmi/id/product_name | tr -d '\n\r')

# Trailing Whitespace entfernen (Sicherheit)
SYS_VENDOR=$(printf '%s' "$SYS_VENDOR" | tr -d '\r' | sed 's/[[:space:]]*$//')
PRODUCT_NAME=$(printf '%s' "$PRODUCT_NAME" | tr -d '\r' | sed 's/[[:space:]]*$//')

# Regeln laden und matchen
. "$CACHE/driver-rules.sh"
match_drivers "$SYS_VENDOR" "$PRODUCT_NAME"
```

`match_drivers()` setzt `DRIVER_SETS` basierend auf dem `case`-Statement in `driver-rules.sh`:

```bash
case "$vendor::$product" in
    LENOVO::21L4S00P00)  DRIVER_SETS="L16" ;;
    Dell Inc.::*Latitude*5540*)  DRIVER_SETS="Lat5540" ;;
    *)  DRIVER_SETS="_generic" ;;
esac
```

#### Sub-Phase 3: PCI/USB-ID Detection

```bash
# PCI-Geräte aus sysfs lesen
for dev in /sys/bus/pci/devices/*; do
    v=$(sed 's/^0x//' "$dev/vendor")
    d=$(sed 's/^0x//' "$dev/device")
    echo "${v}:${d}"
done

# USB-Geräte
for dev in /sys/bus/usb/devices/*; do
    v=$(cat "$dev/idVendor")
    p=$(cat "$dev/idProduct")
    echo "${v}:${p}"
done

# Matching (falls match_device_drivers() in driver-rules.sh definiert)
DEVICE_SETS=$(match_device_drivers "$ALL_HW_IDS")

# DMI + Device Sets zusammenführen (dedupliziert)
DRIVER_SETS="$DMI_SETS $DEVICE_SETS"
```

#### Sub-Phase 4: Selektiver rsync

```bash
for SET in $DRIVER_SETS; do
    # Per-Set Hash-Check
    SET_HASH=$(...)     # Aus driver-manifest.json
    CACHED_SET_HASH=$(cat "$CACHE/drivers/${SET}/.sethash")

    if [ "$SET_HASH" = "$CACHED_SET_HASH" ]; then
        continue    # Set unverändert → überspringen
    fi

    # Nur geänderte Sets herunterladen
    rsync --delete -r "${SERVERIP}::drivers/${PATCHCLASS}/drivers/${SET}/" \
                      "$CACHE/drivers/${SET}/"
done
```

**Zweistufiges Caching:**
1. `repoHash` → wenn gleich: KEIN rsync für irgendein Set
2. Per-Set `sethash` → nur geänderte Sets werden synchronisiert

#### Sub-Phase 5: Kopie + pnputil-Setup

```bash
# Treiber in Windows-Partition kopieren
for SET in $DRIVER_SETS; do
    mkdir -p "/mnt/Drivers/LINBO/$SET"
    cp -ar "$CACHE/drivers/$SET"/* "/mnt/Drivers/LINBO/$SET/"
done

# pnputil Batch-Script erstellen (CRLF für Windows)
printf '@echo off\r\n' > "/mnt/Drivers/LINBO/pnputil-install.cmd"
printf 'pnputil /add-driver C:\\Drivers\\LINBO\\*.inf /subdirs /install\r\n' >> ...

# Registry RunOnce Key setzen (offline)
cat > /tmp/linbo-driver-install.reg << 'REG'
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce]
"LinboDriverInstall"="C:\\Drivers\\LINBO\\pnputil-install.cmd"
REG

linbo_patch_registry /tmp/linbo-driver-install.reg
```

**Was passiert beim nächsten Windows-Boot:**
1. Windows liest `RunOnce` Registry Key
2. Führt `C:\Drivers\LINBO\pnputil-install.cmd` aus
3. `pnputil /add-driver *.inf /subdirs /install` installiert alle Treiber
4. Das Batch-Script löscht sich selbst (`del "%~f0"`)
5. RunOnce-Key wird automatisch von Windows entfernt

---

## 6. End-to-End Sequenzdiagramm

```
┌──────┐     ┌──────────┐     ┌───────────┐     ┌──────────┐     ┌─────────┐
│ Admin │     │ Frontend  │     │  API/Svc   │     │  rsync   │     │ Client  │
└──┬───┘     └────┬─────┘     └─────┬─────┘     └────┬─────┘     └────┬────┘
   │              │                  │                 │                │
   │ ═══════════ EINRICHTUNG (einmalig) ═══════════   │                │
   │              │                  │                 │                │
   │─ Patchclass ─▶                 │                 │                │
   │  "lenovo"    │── POST ────────▶│                 │                │
   │  erstellen   │                 │── mkdir ───────▶│                │
   │              │                 │  drivers/lenovo/ │                │
   │              │◀── 201 ────────│                 │                │
   │              │                  │                 │                │
   │─ Set "L16" ──▶                 │                 │                │
   │  erstellen   │── POST ────────▶│                 │                │
   │              │                 │── mkdir ───────▶│                │
   │              │◀── 201 ────────│  drivers/L16/    │                │
   │              │                  │                 │                │
   │─ Treiber ────▶                 │                 │                │
   │  hochladen   │── POST extract─▶│                 │                │
   │  (Lenovo.exe)│                 │── innoextract ─▶│                │
   │              │                 │  171 INF files   │                │
   │              │◀── 200 ────────│                 │                │
   │              │                  │                 │                │
   │─ Hardware ───▶                 │                 │                │
   │  Scan        │── POST scan ───▶│                 │                │
   │              │                 │── SSH ──────────────────────────▶│
   │              │                 │  cat /sys/class/dmi/id/...      │
   │              │                 │◀── LENOVO, 21L4S00P00 ─────────│
   │              │◀── DriverScan──│                 │                │
   │              │                  │                 │                │
   │─ "Überneh- ─▶                 │                 │                │
   │   men"       │── PUT map ─────▶│                 │                │
   │ (Auto-Fill)  │                 │── regenerate ──▶│                │
   │              │                 │  driver-rules.sh │                │
   │              │                 │  manifest.json   │                │
   │              │◀── 200 ────────│                 │                │
   │              │                  │                 │                │
   │─ Deploy ─────▶                 │                 │                │
   │  Postsync    │── POST deploy──▶│                 │                │
   │              │                 │── write ───────▶│                │
   │              │                 │  images/win11/   │                │
   │              │                 │  .postsync       │                │
   │              │◀── 200 ────────│                 │                │
   │              │                  │                 │                │
   │ ═══════════ CLIENT SYNC (bei jedem Sync) ═══════ │                │
   │              │                  │                 │                │
   │              │                  │                 │      ┌────────┤
   │              │                  │                 │      │ LINBO  │
   │              │                  │                 │      │ "Sync" │
   │              │                  │                 │      └────┬───┤
   │              │                  │                 │           │    │
   │              │                  │                 │     Image │    │
   │              │                  │                 │  restored │    │
   │              │                  │                 │           │    │
   │              │                  │                 │◀── rsync ─┤    │
   │              │                  │                 │  manifest │    │
   │              │                  │                 │  + rules  │    │
   │              │                  │                 │           │    │
   │              │                  │                 │◀── rsync ─┤    │
   │              │                  │                 │  common/  │    │
   │              │                  │                 │           │    │
   │              │                  │                 │     DMI   │    │
   │              │                  │                 │   match   │    │
   │              │                  │                 │  → "L16"  │    │
   │              │                  │                 │           │    │
   │              │                  │                 │◀── rsync ─┤    │
   │              │                  │                 │  drivers/ │    │
   │              │                  │                 │  L16/     │    │
   │              │                  │                 │           │    │
   │              │                  │                 │     cp →  │    │
   │              │                  │                 │   /mnt/   │    │
   │              │                  │                 │  Drivers/ │    │
   │              │                  │                 │           │    │
   │              │                  │                 │  Registry │    │
   │              │                  │                 │  RunOnce  │    │
   │              │                  │                 │           │    │
   │              │                  │                 │  ┌────────┤    │
   │              │                  │                 │  │Windows │    │
   │              │                  │                 │  │ Boot   │    │
   │              │                  │                 │  │pnputil │    │
   │              │                  │                 │  │installs│    │
   │              │                  │                 │  │drivers │    │
   │              │                  │                 │  └────────┤    │
```

---

## 7. Datenformate

### 7.1 driver-map.json

```json
{
  "version": 1,
  "defaultDrivers": ["_generic"],
  "ignoredCategories": ["usb"],
  "models": [
    {
      "name": "LENOVO 21L4S00P00",
      "match": {
        "sys_vendor": "LENOVO",
        "product_name": "21L4S00P00"
      },
      "drivers": ["L16"]
    },
    {
      "name": "Dell Latitude 5540",
      "match": {
        "sys_vendor": "Dell Inc.",
        "product_name_contains": "Latitude 5540"
      },
      "drivers": ["Lat5540", "_generic"]
    }
  ],
  "deviceRules": [
    {
      "name": "Intel WiFi 6E AX211",
      "category": "wifi",
      "match": {
        "type": "pci",
        "vendor": "8086",
        "device": "51f0"
      },
      "drivers": ["Intel_WiFi"]
    }
  ]
}
```

**Felder:**

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `version` | number | Schema-Version (aktuell 1) |
| `defaultDrivers` | string[] | Sets die IMMER installiert werden (Fallback) |
| `ignoredCategories` | string[] | Kategorien die beim PCI/USB-Matching übersprungen werden |
| `models[].match.sys_vendor` | string | Exakter Match gegen `/sys/class/dmi/id/sys_vendor` |
| `models[].match.product_name` | string | Exakter Match gegen `/sys/class/dmi/id/product_name` |
| `models[].match.product_name_contains` | string | Substring-Match (wird zu `*...*` Glob) |
| `models[].drivers` | string[] | Zugeordnete Treiber-Set-Namen |
| `deviceRules[].match.type` | "pci"\|"usb" | Bus-Typ |
| `deviceRules[].match.vendor` | string | Hex Vendor-ID (z.B. "8086" für Intel) |
| `deviceRules[].match.device` | string | Hex Device-ID |
| `deviceRules[].match.subvendor` | string? | Optional: Subsystem Vendor-ID (spezifischerer Match) |
| `deviceRules[].match.subdevice` | string? | Optional: Subsystem Device-ID |

### 7.2 driver-manifest.json

```json
{
  "repoHash": "bfc56796d2d262012a0e704c77a31ebd",
  "mapHash": "a1b2c3d4e5f6...",
  "sets": {
    "L16": {
      "hash": "d4e5f6a1b2c3...",
      "fileCount": 267,
      "totalSize": 2147483648
    },
    "_generic": {
      "hash": "f6a1b2c3d4e5...",
      "fileCount": 12,
      "totalSize": 1048576
    }
  },
  "generatedAt": "2026-03-04T15:18:14.260Z"
}
```

**Hash-Berechnung:**
- `setHash` = MD5(sortierte `path+size+mtime` aller Dateien im Set)
- `repoHash` = MD5(`mapHash` + sortierte `setHashes`)

**Verwendung auf dem Client:**
1. `repoHash` ≠ cached → mindestens ein Set hat sich geändert
2. Per-Set `setHash` ≠ cached → dieses Set rsync'en

### 7.3 driver-rules.sh (Auto-generiert)

```bash
# Auto-generated by LINBO Docker API — DO NOT EDIT
# Source: driver-map.json, generated 2026-03-04T15:18:14.260Z
# Hash: bfc56796d2d262012a0e704c77a31ebd

match_drivers() {
  local vendor="$1"
  local product="$2"
  case "$vendor::$product" in
    LENOVO::21L4S00P00)
      DRIVER_SETS="L16"
      ;;
    Dell\ Inc.::*Latitude*5540*)
      DRIVER_SETS="Lat5540 _generic"
      ;;
    *)
      DRIVER_SETS="_generic"
      ;;
  esac
}

# PCI/USB-ID based device matching (nur wenn deviceRules vorhanden)
match_device_drivers() {
  local hw_ids="$1"
  local EXTRA_SETS=""
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    case "$id" in
      # Intel WiFi 6E AX211 (subsystem match)
      8086:51f0:8086:0094) EXTRA_SETS="$EXTRA_SETS Intel_WiFi" ;;
      # Intel WiFi 6E AX211
      8086:51f0) EXTRA_SETS="$EXTRA_SETS Intel_WiFi" ;;
      *) ;;
    esac
  done <<EOF
$hw_ids
EOF
  echo "$EXTRA_SETS" | tr ' ' '\n' | sort -u | tr '\n' ' '
}
```

**Wichtig:** Separator ist `::` (nicht `|`), da `|` in `case`-Statements als OR-Operator interpretiert wird.

---

## 8. Fehlerbehebung

### Client-Logs prüfen

```bash
# SSH zum LINBO-Client (vom Docker-Server)
docker compose exec ssh ssh -i /etc/linuxmuster/linbo/ssh_host_rsa_key \
  -p 2222 root@<CLIENT_IP>

# Postsync-Log
cat /tmp/linbo-postsync.log

# Driver-Matching-Log
cat /tmp/linbo-drivers.log

# Allgemeines LINBO-Log
cat /tmp/linbo.log
```

### Häufige Probleme

| Symptom | Ursache | Lösung |
|---------|---------|--------|
| "WARN: No driver-rules.sh" | rsync konnte Rules nicht holen | Prüfe rsync-Container: `docker compose ps rsync` |
| "DMI matched sets: _generic" | Kein Model-Match für diese Hardware | Hardware-Scan → Modell hinzufügen |
| "No INF files found" | Treiber-Set leer oder falsches Set gematcht | Prüfe Set-Inhalt: `find drivers/L16 -name '*.inf'` |
| "Read-only file system" | NTFS nicht rw gemountet | Nur bei manuellem Test — LINBO mountet rw |
| "Repo unchanged, skipping" | Cache-Hash aktuell | Normal — bedeutet keine Server-Änderungen |
| Treiber nicht installiert | RunOnce nicht ausgeführt | Prüfe Registry: `HKLM\...\RunOnce\LinboDriverInstall` |
| EXE-Extraktion liefert PE-Sections | Inno Setup statt normales Archiv | `innoextract` muss im Docker-Image sein |

### Server-seitig debuggen

```bash
# Patchclass-Verzeichnis prüfen
docker compose exec api ls -la /var/lib/linbo/drivers/lenovo/

# Rules ansehen
docker compose exec api cat /var/lib/linbo/drivers/lenovo/driver-rules.sh

# Manifest prüfen
docker compose exec api cat /var/lib/linbo/drivers/lenovo/driver-manifest.json

# Postsync prüfen
docker compose exec api cat /srv/linbo/images/win11_pro_edu/win11_pro_edu.postsync

# INF-Dateien zählen
docker compose exec api find /var/lib/linbo/drivers/lenovo/drivers/L16 -iname '*.inf' | wc -l

# API-Logs
docker compose logs api --tail=50

# rsync-Zugriff testen (von außen)
rsync rsync://10.0.0.13/drivers/lenovo/
```

### Rules manuell regenerieren

```bash
curl -X PUT -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/v1/patchclass/lenovo/driver-map \
  -d @/var/lib/linbo/drivers/lenovo/driver-map.json
```

---

## 9. Bekannte Bugs und Fixes

### Bug 1: `|` als OR-Operator in case-Statement (Kritisch)

**Problem:** Der generierte `driver-rules.sh` nutzte `|` als Separator zwischen Vendor und Product:
```bash
case "$vendor|$product" in
    LENOVO|21L4S00P00)    # BUG: | ist OR → matched "LENOVO" ODER "21L4S00P00"
```

**Symptom:** DMI-Matching fällt immer durch zum Default `*)`, egal welche Hardware.

**Fix:** Separator von `|` auf `::` geändert:
```bash
case "$vendor::$product" in
    LENOVO::21L4S00P00)   # OK: :: hat keine Sonderbedeutung in case
```

**Betroffene Dateien:**
- `patchclass.service.js` (Zeilen 716, 731)
- `00-match-drivers.sh` (DMI-Lese-Logik)

### Bug 2: Postsync-Deploy-Pfad falsch

**Problem:** API schrieb nach `images/win11_pro_edu.postsync` (flach).

**Fix:** Korrekter Pfad: `images/win11_pro_edu/win11_pro_edu.postsync` (Unterverzeichnis).

### Bug 3: Quoted Case-Patterns

**Problem:** Generierte Patterns waren in Anführungszeichen: `"LENOVO|*21L4*"` → deaktiviert Glob-Expansion.

**Fix:** Patterns ohne Quotes generieren.

### Bug 4: Inno Setup EXE-Extraktion

**Problem:** 7z entpackt Inno-Setup-EXE in PE-Sections (.text, .rsrc, .rdata) statt echte Dateien.

**Fix:** Erkennung von PE-Sections → Fallback auf `innoextract`. `innoextract` im Dockerfile hinzugefügt. Auto-Flatten von Single-Wrapper-Verzeichnissen.

### Bug 5: Self-Update Pfad im Postsync

**Problem:** `rsync ... ::linbo/images/${IMAGENAME%.qcow2}.postsync` (falscher Pfad).

**Fix:** Korrekter Pfad mit Unterverzeichnis:
```bash
IMAGEBASE="${IMAGENAME%.qcow2}"
rsync -q "${SERVERIP}::linbo/images/${IMAGEBASE}/${IMAGEBASE}.postsync" /cache/
```

### Bug 6: DMI-Daten mit Whitespace/CR

**Problem:** `/sys/class/dmi/id/product_name` kann `\r` oder trailing Whitespace enthalten → Case-Match schlägt fehl.

**Fix:** Doppeltes Stripping:
```bash
SYS_VENDOR=$(cat /sys/class/dmi/id/sys_vendor | tr -d '\n\r')
SYS_VENDOR=$(printf '%s' "$SYS_VENDOR" | tr -d '\r' | sed 's/[[:space:]]*$//')
```
