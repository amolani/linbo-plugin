# LINBO Docker - Boot-Dateien Problem

**Erstellt:** 2026-02-03 (Session 4)
**Status:** OFFEN - Kritisch für Standalone-Betrieb

---

## Problem-Beschreibung

Die LINBO Docker Container benötigen Boot-Dateien, die aktuell **nicht** im Deployment-Paket enthalten sind:

```
/srv/linbo/
├── linbo64              # LINBO Kernel (~8 MB)
├── linbofs64            # LINBO initramfs (~50 MB)
├── boot/
│   └── grub/
│       ├── grub.cfg     # GRUB Konfiguration
│       ├── x86_64-efi/  # EFI Module
│       ├── i386-pc/     # BIOS Module
│       └── fonts/       # GRUB Fonts
├── icons/               # OS Icons für GUI
└── images/              # qcow2/qdiff Images
```

### Aktueller Zustand

Nach Installation des Deployment-Pakets auf einer frischen VM:
- `/srv/linbo/` ist **leer**
- TFTP-Container kann keine Boot-Dateien liefern
- PXE-Boot funktioniert nicht

### Warum ist das ein Problem?

Das Projekt soll **standalone** funktionieren - ohne einen linuxmuster.net Server. Aktuell müssen die Boot-Dateien manuell von einem bestehenden Server kopiert werden:

```bash
# Aktueller Workaround (erfordert linuxmuster.net Server)
scp /srv/linbo/linbo64 /srv/linbo/linbofs64 root@test-vm:/srv/linbo/
scp -r /srv/linbo/boot/grub/* root@test-vm:/srv/linbo/boot/grub/
```

---

## Lösungsvorschläge

### Option 1: Boot-Dateien im Container einbetten (empfohlen)

Die Boot-Dateien werden direkt in den TFTP-Container eingebettet.

**Vorteile:**
- Sofort einsatzbereit nach `docker compose up`
- Keine externe Abhängigkeit
- Versionierung der Boot-Dateien

**Nachteile:**
- Container-Image wird größer (~60 MB mehr)
- Updates erfordern neuen Container-Build

**Umsetzung:**
```dockerfile
# containers/tftp/Dockerfile
FROM ubuntu:22.04

# Boot-Dateien aus linuxmuster-linbo7 Paket extrahieren
COPY boot-files/ /srv/linbo/

# Oder: Download beim Build
RUN wget -O /tmp/linbo.deb https://archive.linuxmuster.net/linbo/linuxmuster-linbo7_latest.deb \
    && dpkg-deb -x /tmp/linbo.deb /tmp/linbo \
    && cp -r /tmp/linbo/srv/linbo/* /srv/linbo/ \
    && rm -rf /tmp/linbo*
```

---

### Option 2: Separates Boot-Files Paket

Ein zusätzliches Archiv `linbo-boot-files.tar.gz` wird bereitgestellt.

**Vorteile:**
- Container bleibt klein
- Boot-Dateien können unabhängig aktualisiert werden

**Nachteile:**
- Zusätzlicher Download-/Installations-Schritt
- Benutzer muss wissen, dass er es braucht

**Umsetzung:**
```bash
# install.sh erweitern
if [ ! -f /srv/linbo/linbo64 ]; then
    echo "Lade Boot-Dateien herunter..."
    wget -O /tmp/linbo-boot-files.tar.gz \
        https://github.com/YOUR_REPO/releases/download/v1.0/linbo-boot-files.tar.gz
    tar -xzf /tmp/linbo-boot-files.tar.gz -C /srv/linbo/
fi
```

---

### Option 3: Init-Container / Sidecar

Ein separater Container lädt beim ersten Start die Boot-Dateien herunter.

**Vorteile:**
- Hauptcontainer bleibt klein
- Automatischer Download
- Kann auf Updates prüfen

**Nachteile:**
- Komplexere Architektur
- Erfordert Internet beim ersten Start

**Umsetzung:**
```yaml
# docker-compose.yml
services:
  boot-init:
    image: linbo-docker-boot-init
    volumes:
      - linbo_srv_data:/srv/linbo
    command: |
      if [ ! -f /srv/linbo/linbo64 ]; then
        wget -qO- https://example.com/linbo-boot.tar.gz | tar -xz -C /srv/linbo/
      fi
    restart: "no"

  tftp:
    depends_on:
      boot-init:
        condition: service_completed_successfully
```

---

### Option 4: Build from Source

Die Boot-Dateien werden aus dem Original-Repository gebaut.

**Vorteile:**
- Volle Kontrolle über den Build-Prozess
- Anpassungen möglich

**Nachteile:**
- Komplexer Build-Prozess
- Erfordert Build-Tools und Zeit

**Umsetzung:**
```bash
# Build linbofs64 from source
git clone https://github.com/linuxmuster/linuxmuster-linbo7
cd linuxmuster-linbo7
make linbofs64
```

---

## Empfehlung

**Option 1 (Boot-Dateien im Container)** für die erste stabile Version:

1. Extrahiere Boot-Dateien aus dem offiziellen linuxmuster-linbo7 Paket
2. Erstelle Verzeichnis `containers/tftp/boot-files/`
3. Füge die Dateien zum Git-Repository hinzu (oder LFS für große Dateien)
4. Aktualisiere das Dockerfile

Später kann **Option 3 (Init-Container)** für automatische Updates implementiert werden.

---

## Benötigte Dateien (Mindestanforderung)

| Datei | Größe | Beschreibung |
|-------|-------|--------------|
| `linbo64` | ~8 MB | Linux Kernel für LINBO |
| `linbofs64` | ~50 MB | initramfs mit LINBO-Tools |
| `boot/grub/grub.cfg` | ~2 KB | GRUB Hauptkonfiguration |
| `boot/grub/x86_64-efi/` | ~5 MB | EFI Boot-Module |
| `boot/grub/i386-pc/` | ~3 MB | BIOS Boot-Module |
| `boot/grub/fonts/` | ~1 MB | GRUB Fonts |
| `icons/*.svg` | ~100 KB | OS Icons für GUI |

**Gesamt:** ~70 MB

---

## Lizenz-Hinweis

Die LINBO Boot-Dateien stehen unter **GPL v3** (linuxmuster-linbo7).
Bei Redistribution muss die Lizenz eingehalten werden.

Quelle: https://github.com/linuxmuster/linuxmuster-linbo7

---

## Aufgaben (TODO)

- [ ] Boot-Dateien aus linuxmuster-linbo7 extrahieren
- [ ] Entscheidung: Option 1, 2, 3 oder 4?
- [ ] Dockerfile für TFTP-Container anpassen
- [ ] install.sh erweitern (falls Option 2)
- [ ] Dokumentation aktualisieren
- [ ] Testen auf frischer VM ohne linuxmuster.net

---

## Temporärer Workaround

Bis das Problem gelöst ist, können die Dateien manuell kopiert werden:

```bash
# Von einem bestehenden linuxmuster.net Server (10.0.0.1)
# Zur Test-VM (10.0.10.1)

# 1. Verzeichnisse erstellen
ssh root@10.0.10.1 'mkdir -p /var/lib/docker/volumes/linbo_srv_data/_data/boot/grub'

# 2. Kernel und initramfs kopieren
scp /srv/linbo/linbo64 /srv/linbo/linbofs64 \
    root@10.0.10.1:/var/lib/docker/volumes/linbo_srv_data/_data/

# 3. GRUB-Dateien kopieren
scp -r /srv/linbo/boot/grub/* \
    root@10.0.10.1:/var/lib/docker/volumes/linbo_srv_data/_data/boot/grub/

# 4. Icons kopieren (optional, für GUI)
scp -r /srv/linbo/icons \
    root@10.0.10.1:/var/lib/docker/volumes/linbo_srv_data/_data/

# 5. Verifizieren
ssh root@10.0.10.1 'docker exec linbo-tftp ls -la /srv/linbo/'
```

---

## Verwandte Dokumente

- [06-implementation-status.md](./06-implementation-status.md) - Aktueller Status
- [02-minimal-server.md](./02-minimal-server.md) - Minimal Server Setup
