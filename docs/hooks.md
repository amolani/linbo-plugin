# update-linbofs Hook-System

## Übersicht

`update-linbofs.sh` unterstützt Pre- und Post-Hooks — kompatibel mit dem
linuxmuster.net Hook-Mechanismus (`/var/lib/linuxmuster/hooks/`).

## Hook-Verzeichnisse

```
/etc/linuxmuster/linbo/hooks/
├── update-linbofs.pre.d/    # VOR dem Repack (cpio/xz)
│   └── 01_edulution-plymouth
└── update-linbofs.post.d/   # NACH dem Repack
```

Konfigurierbar via `HOOKSDIR` Environment-Variable (Default: `/etc/linuxmuster/linbo/hooks`).

## Ausführungsregeln

| Eigenschaft | Wert |
|-------------|------|
| **Sortierung** | Alphabetisch (`sort`) — Nummernpräfix empfohlen (`01_`, `02_`, ...) |
| **Berechtigung** | Nur executable Dateien (`chmod +x`) werden ausgeführt |
| **Fehlerbehandlung** | Hook-Fehler erzeugen WARNING, brechen Build **nicht** ab |
| **Sprache** | Beliebig (bash, python, etc.) — muss Shebang haben |

## Pre-Hooks (`update-linbofs.pre.d/`)

Laufen **nach** allen Standard-Injektionen (Keys, Module, Firmware, GUI) aber
**vor** dem CPIO-Repack. Das ist der richtige Ort, um Dateien im linbofs zu
modifizieren.

**Working Directory:** Das extrahierte linbofs-Root (`$WORKDIR`).
Relative Pfade wie `usr/share/plymouth/themes/` funktionieren direkt.

**Exportierte Variablen:**

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `LINBO_DIR` | LINBO Boot-Dateien | `/srv/linbo` |
| `CONFIG_DIR` | LINBO Konfiguration | `/etc/linuxmuster/linbo` |
| `CACHE_DIR` | Build-Cache | `/var/cache/linbo` |
| `KTYPE` | Kernel-Variante | `stable`, `longterm`, `legacy` |
| `KVERS` | Kernel-Version | `6.18.4` (leer wenn kein Kernel) |
| `WORKDIR` | Extrahiertes linbofs | `/var/cache/linbo/linbofs-build.XXXXXX` |

### Typische Anwendungsfälle

- Plymouth-Theme ersetzen (Branding)
- Zusätzliche Konfigurationsdateien injizieren
- init.sh patchen (nur wenn nötig)
- Eigene Binaries hinzufügen

## Post-Hooks (`update-linbofs.post.d/`)

Laufen **nach** Repack, Verifikation und Kernel-Kopie — aber **vor** dem
Summary-Output. Können das fertige linbofs64 nicht mehr modifizieren.

**Typische Anwendungsfälle:**

- Benachrichtigungen (Webhook, Mail)
- Zusätzliche Checksummen erzeugen
- Deployment-Trigger (rsync zu anderem Server)

## Beispiel: Plymouth-Theme (edulution)

```bash
#!/bin/bash
# /etc/linuxmuster/linbo/hooks/update-linbofs.pre.d/01_edulution-plymouth
#
# Ersetzt das Standard-Plymouth-Splash-Theme mit edulution-Branding.
# CWD = extrahiertes linbofs-Root

THEME_SRC="/root/linbo-docker/plymouth/linbo-splash"
THEME_DST="usr/share/plymouth/themes/linbo-splash"

[ -d "$THEME_SRC" ] || exit 0
[ -d "$THEME_DST" ] || exit 0

echo "  - Injecting edulution Plymouth theme..."
cp "$THEME_SRC/linbo-splash.script" "$THEME_DST/linbo-splash.script"
cp "$THEME_SRC/logo_no_arrows.png" "$THEME_DST/logo_no_arrows.png"
rm -f "$THEME_DST"/arrows-*.png
echo "  - edulution theme injected"
```

## Kompatibilität mit linuxmuster.net

| Aspekt | LMN Original | Docker |
|--------|-------------|--------|
| **Hook-Verzeichnis** | `/var/lib/linuxmuster/hooks/` | `/etc/linuxmuster/linbo/hooks/` |
| **Variablen exportiert** | Nein (Hooks müssen `helperfunctions.sh` sourcen) | Ja (`LINBO_DIR`, `KTYPE` etc.) |
| **Sortierung** | Nicht garantiert (`find` ohne `sort`) | Alphabetisch sortiert |
| **Fehler** | Unbehandelt (Hook-Exit stoppt ggf. Build) | WARNING, Build läuft weiter |

Docker-Hooks sind eine Verbesserung: exportierte Variablen, garantierte Sortierung,
robustere Fehlerbehandlung.
