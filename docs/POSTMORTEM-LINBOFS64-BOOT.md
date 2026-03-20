# Postmortem: linbofs64 Boot-Fehler (Black Screen)

**Datum:** 2026-03-13
**Schweregrad:** Kritisch — Clients konnten nicht PXE-booten
**Status:** Behoben

---

## Symptom

LINBO-Clients zeigen nach PXE-Boot einen **schwarzen Bildschirm** (kein Output, nicht pingbar, keine SSH-Verbindung). GRUB laedt Kernel und Initramfs erfolgreich, aber nach Kernel-Start passiert nichts sichtbares.

Auf der Referenz-Installation (nativer LMN-Server 10.0.0.14, LINBO 4.3.31) bootet derselbe Client einwandfrei.

## Ursache

### Primaer: Fehlende Locale-Dateien im linbofs64

Die linbofs64-Datei (Initramfs) wird von `update-linbofs.sh` aus einem Template gebaut. Das Template (`linbofs64.xz`) aus dem linbo7-Paket ist **absichtlich unvollstaendig** — es erwartet, dass `update-linbofs` Locale-Dateien vom Host-System hinzufuegt.

**Das originale LMN-Script** (`/usr/sbin/update-linbofs`, Zeile 341) hat eine `copy_locale()` Funktion, die:
- `/usr/lib/locale/locale-archive` ins linbofs kopiert
- `/usr/share/i18n/` kopiert
- `locale-gen de_DE.UTF-8` im linbofs ausfuehrt
- `/etc/locale.conf`, `/etc/localtime`, `/etc/vconsole.conf` erstellt

**Unser Docker-Script** hatte diese Funktion **nicht**. Das war bisher kein Problem, weil...

### Sekundaer: Alpine Linux als Container-Basis

Der API-Container (in dem `update-linbofs.sh` laeuft) basierte auf **Alpine Linux**. Alpine hat:
- **Kein `locale-gen`** (Alpine nutzt musl libc, nicht glibc)
- **Kein `/usr/lib/locale/locale-archive`**
- **Keine `/usr/share/i18n/` Dateien**
- **Kein `/usr/share/zoneinfo/`** (nur mit Paket `tzdata`)

Selbst wenn wir `copy_locale()` implementiert haetten, waere sie auf Alpine ins Leere gelaufen.

### Warum Black Screen?

Die Boot-Kette bei fehlendem Locale:
1. Kernel startet korrekt (Module laden, Hardware erkennen)
2. `init.sh` startet (als PID 1)
3. Kernel-Cmdline hat `quiet splash`:
   - `quiet` unterdrueckt Kernel-Meldungen
   - `splash` erwartet Plymouth fuer Splash-Screen
4. Plymouth startet, kann aber ohne Locale nicht korrekt rendern
5. `linbo_gui` (Qt6-Anwendung) crashed lautlos — Qt benoetigt `locale-archive` fuer Text-Rendering
6. **Ergebnis: Schwarzer Bildschirm ohne jede Ausgabe**

### Datei-Vergleich Docker vs. Referenz

| Metrik | Docker (Alpine) | Referenz (Ubuntu) |
|--------|-----------------|-------------------|
| Dateien im linbofs64 | 2.431 | 2.482 |
| Groesse | 45.9 MB | 47.6 MB |
| Fehlende Dateien | 51 | 0 |

**Fehlende Dateien (alle Locale/i18n):**
- `usr/lib/locale/locale-archive` (kritisch)
- `etc/locale.alias`, `etc/locale.conf`, `etc/locale.gen`
- `etc/localtime`, `etc/vconsole.conf`
- `usr/bin/locale`
- `usr/share/i18n/charmaps/UTF-8.gz`
- `usr/share/i18n/locales/*` (30+ Dateien)
- `usr/share/locale/de/*` (Deutsche Lokalisierung)
- Plymouth-Theme-Dateien in `usr/share/plymouth/`

### Zusaetzlich: GRUB Cache-Suche

Die GRUB-Konfiguration (`grub.cfg.global`) suchte beim Boot nach einer lokalen Cache-Partition:
```grub
search --label "cache" --set cacheroot    # -> error: no such device
search --file /start.conf --set cacheroot  # -> error: no such device
search --file /linbofs64 --set cacheroot   # -> error: no such device
set root="(hd0,4)"                         # -> error: disk not found
```
Diese Fehler waren kosmetisch (Boot funktionierte danach per TFTP-Fallback), aber stoerend.

---

## Diagnose-Methode

### Schritt 1: Referenz-linbofs64 im Docker-Volume testen
```bash
scp root@10.0.0.14:/srv/linbo/linbofs64 /tmp/ref-linbofs64
docker cp /tmp/ref-linbofs64 linbo-api:/srv/linbo/linbofs64
# MD5 aktualisieren
docker exec linbo-api bash -c "md5sum /srv/linbo/linbofs64 | cut -d' ' -f1 > /srv/linbo/linbofs64.md5"
# Client PXE-booten -> BOOTET! -> Beweis: linbofs64-Build ist das Problem
```

### Schritt 2: Datei-Diff
```bash
# Referenz
ssh root@10.0.0.14 'xzcat /srv/linbo/linbofs64 | cpio -t 2>/dev/null | sort' > /tmp/ref.txt
# Docker
docker exec linbo-api bash -c 'xzcat /srv/linbo/linbofs64 | cpio -t 2>/dev/null | sort' > /tmp/docker.txt
diff /tmp/ref.txt /tmp/docker.txt
# -> 51 fehlende Locale/i18n-Dateien
```

### Schritt 3: Referenz-Script analysieren
```bash
ssh root@10.0.0.14 'grep -n "copy_locale\|locale" /usr/sbin/update-linbofs'
# -> Zeile 341: copy_locale() — kopiert Locale vom Ubuntu-Host
```

---

## Behebung

### 1. Alpine komplett durch Ubuntu/Debian ersetzt

| Container | Vorher (Alpine) | Nachher (Debian/Ubuntu) |
|-----------|-----------------|------------------------|
| API | `node:20.19.6-alpine3.21` | `node:20-bookworm-slim` |
| Init (Runtime) | `alpine:3.19.9` | `ubuntu:24.04` |
| Web (Builder) | `node:20.19.6-alpine3.21` | `node:20-bookworm` |
| Web (Runtime) | `nginx:1.29.5-alpine` | `nginx:1.27-bookworm` |
| DHCP | `alpine:3.19.9` | `ubuntu:24.04` |
| TFTP | `ubuntu:24.04` | (bereits Ubuntu) |
| SSH | `ubuntu:24.04` | (bereits Ubuntu) |
| Rsync | `ubuntu:24.04` | (bereits Ubuntu) |

### 2. Locale im API-Container generiert

Im `containers/api/Dockerfile`:
```dockerfile
RUN apt-get install -y --no-install-recommends locales tzdata
RUN sed -i '/de_DE.UTF-8/s/^# //' /etc/locale.gen && locale-gen de_DE.UTF-8
ENV LANG=de_DE.UTF-8
```

### 3. Locale-Hook fuer linbofs64

Neuer Hook `config/hooks/update-linbofs.pre.d/00_inject-locale`:
```bash
#!/bin/bash
# Inject locale from Ubuntu container into linbofs64
# Entspricht copy_locale() im LMN-Original
cp /usr/lib/locale/locale-archive usr/lib/locale/
cp -r /usr/share/i18n/* usr/share/i18n/
echo "LANG=de_DE.UTF-8" > etc/locale.conf
echo "KEYMAP=de-latin1" > etc/vconsole.conf
cp /usr/share/zoneinfo/Europe/Berlin etc/localtime
```

### 4. GRUB Cache-Suche entfernt

In `containers/api/src/templates/grub/grub.cfg.global`:
```grub
# Vorher (14 Zeilen Cache-Suche mit Fehlern):
search --label "cache" --set cacheroot
...

# Nachher (1 Zeile, direkt TFTP):
set root="(tftp)"
```

Zusaetzlich: `timeout=0` (kein GRUB-Menue-Warten), `gfxpayload=keep` (statt `text`).

### 5. Debug-Hooks entfernt

Folgende temporaere Debug-Hooks wurden entfernt:
- `03_fix_udhcpc_decline` — ip addr flush Hack
- `04_debug_remote_control` — Netzwerk-Diagnostik im Console-Screen
- `05_modprobe_virtio` — Explizites modprobe fuer NIC-Treiber

Diese waren Workarounds, die die Referenz-Installation nicht braucht.

---

## Hook-Reihenfolge (final)

```
config/hooks/update-linbofs.pre.d/
  00_inject-locale             # Locale-Dateien aus Ubuntu-Container
  01_edulution-plymouth        # Edulution Plymouth Splash-Theme
  02_preserve-cmdline-server   # server= Parameter in init.sh schuetzen
```

---

## Verhinderung bei Neuinstallation

### Automatische Absicherung (bereits implementiert)

1. **Dockerfile**: Der API-Container installiert `locales` und `tzdata` und generiert `de_DE.UTF-8`. Wenn der Container gebaut wird, sind Locale-Dateien automatisch vorhanden.

2. **Hook `00_inject-locale`**: Wird bei JEDEM `update-linbofs.sh`-Lauf ausgefuehrt und kopiert Locale ins linbofs64. Der Hook liegt im Git-Repository unter `config/hooks/` und ist Teil des Deployments.

3. **GRUB-Template**: Die Cache-Suche ist permanent aus dem Template entfernt. Neue GRUB-Configs werden ohne Cache-Suche generiert.

### Checkliste fuer Neuinstallation

- [ ] Alle Container-Images basieren auf Debian/Ubuntu (KEIN Alpine)
- [ ] API-Container hat `locales` und `tzdata` installiert
- [ ] `locale-gen de_DE.UTF-8` wurde im Dockerfile ausgefuehrt
- [ ] Hook `00_inject-locale` existiert und ist executable
- [ ] Hook `01_edulution-plymouth` existiert (fuer Custom-Branding)
- [ ] Hook `02_preserve-cmdline-server` existiert (fuer Docker server= Parameter)
- [ ] Keine Debug-Hooks (03_*, 04_*, 05_*) vorhanden
- [ ] GRUB-Template hat `set root="(tftp)"` (keine Cache-Suche)
- [ ] GRUB-Template hat `set timeout=0`
- [ ] GRUB-Template hat `set gfxpayload=keep` (nicht `text`)

### Warnsignale (wenn der Fehler zurueckkehrt)

- `apk add` in einem Dockerfile → **Alpine-Basis!** Sofort auf `apt-get` + Debian/Ubuntu umstellen
- `update-linbofs.sh` Build-Output zeigt "0 locale files" oder fehlt "Locale injection"
- linbofs64-Groesse unter 48 MB (Referenz: ~50 MB mit Locale, ohne: ~46 MB)
- Client zeigt schwarzen Bildschirm nach Kernel-Load

---

## Zeitlinie

| Datum | Ereignis |
|-------|----------|
| 2026-03-05 | Erster erfolgreicher PXE-Boot mit Host-Kernel |
| 2026-03-10 | linbofs64 crasht nach Kernel-Start (garbled display) |
| 2026-03-12 | Debug-Hooks eingefuehrt (udhcpc, modprobe, diagnostics) |
| 2026-03-13 | Build ohne Hooks → immer noch Black Screen |
| 2026-03-13 | Referenz-linbofs64 in Docker → BOOTET! → Root Cause gefunden |
| 2026-03-13 | Alpine → Ubuntu Migration durchgefuehrt |
| 2026-03-13 | Locale-Hook erstellt, GRUB-Config gefixt |
| 2026-03-13 | Client bootet mit Docker-gebautem linbofs64 + Edulution-GUI |

---

*Dieses Dokument ist Teil des LINBO Docker Projekts und sollte bei jeder Neuinstallation oder Migration konsultiert werden.*