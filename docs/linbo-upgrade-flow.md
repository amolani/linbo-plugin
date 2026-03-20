# LINBO Upgrade Flow

Dokumentation des vollstaendigen Upgrade-Ablaufs wenn eine neue `linuxmuster-linbo7` Version verfuegbar wird.

## Uebersicht

Docker installiert das .deb-Paket **niemals** via `dpkg -i` oder `apt`. Stattdessen wird das Paket nur heruntergeladen und mit `dpkg-deb -x` entpackt. Dadurch laufen keine postinst-Scripts und es gibt keine Seiteneffekte auf das Host-System.

## Ablaufdiagramm

```
                         +---------------------------+
                         |   APT Repo Check          |
                         |   (deb.linuxmuster.net)   |
                         +-------------+-------------+
                                       |
                              Neue Version?
                              /            \
                           Nein             Ja
                            |                |
                         [Ende]              v
                         +---------------------------+
                         |  Phase 0: Preflight       |
                         |  - Disk Space pruefen     |
                         |  - Lock erwerben (Redis)  |
                         |  - Work-Dir anlegen       |
                         +-------------+-------------+
                                       |
                                       v
                         +---------------------------+
                         |  Phase 1: Download        |
                         |  - .deb von APT-Repo      |
                         |  - Streaming mit Progress  |
                         |  - SHA256-Hash berechnen   |
                         +-------------+-------------+
                                       |
                                       v
                         +---------------------------+
                         |  Phase 1b: Verify         |
                         |  - SHA256 vergleichen     |
                         |  - Groesse pruefen        |
                         |  - Bei Mismatch: Abbruch  |
                         +-------------+-------------+
                                       |
                                       v
                         +---------------------------+
                         |  Phase 2: Extract         |
                         |  - dpkg-deb -x            |
                         |  - KEIN dpkg -i!          |
                         |  - Kein postinst!         |
                         +-------------+-------------+
                                       |
                                       v
                  +------+-------------+-------------+------+
                  |      |                           |      |
                  v      v                           v      v
          +-----------+ +-----------+        +-----------+ +-----------+
          | GUI Files | | Icons     |        | GRUB      | | Kernel    |
          | tar.lz    | | kopieren  |        | Merge     | | Variants  |
          | + Symlinks| |           |        | (safe)    | | (atomic)  |
          +-----------+ +-----------+        +-----------+ +-----------+
                  |      |                           |      |
                  +------+-------------+-------------+------+
                                       |
                                       v
                         +---------------------------+
                         |  Phase 3: Boot Files      |
                         |  Provisioning             |
                         +---------------------------+
                         |                           |
                         |  GUI:                     |
                         |  - linbo_gui64_7.tar.lz   |
                         |  - gui/ Symlinks          |
                         |                           |
                         |  GRUB (mergeGrubFiles):   |
                         |  - Neue Dateien kopieren  |
                         |  - x86_64-efi/ GESCHUETZT |
                         |  - i386-pc/    GESCHUETZT |
                         |  - Nur ADD, kein DELETE   |
                         |                           |
                         |  Icons:                   |
                         |  - Rekursiv kopieren      |
                         +-------------+-------------+
                                       |
                                       v
                         +---------------------------+
                         |  Phase 3b: Kernel         |
                         |  Provisioning             |
                         +---------------------------+
                         |                           |
                         |  Fuer jede Variante:      |
                         |  stable / longterm /      |
                         |  legacy                   |
                         |                           |
                         |  1. Kopiere in temp Set:  |
                         |     .tmp-{HASH}/          |
                         |     - linbo64             |
                         |     - modules.tar.xz      |
                         |     - version             |
                         |                           |
                         |  2. linbofs64.xz Template |
                         |     ins Set kopieren      |
                         |                           |
                         |  3. manifest.json mit     |
                         |     SHA256 pro Datei      |
                         |                           |
                         |  4. Atomic Rename:        |
                         |     .tmp-HASH -> HASH     |
                         |                           |
                         |  5. Symlink Swap:         |
                         |     current -> sets/HASH  |
                         |                           |
                         |  6. Alte Sets loeschen    |
                         +-------------+-------------+
                                       |
                                       v
                         +---------------------------+
                         |  Phase 4: Rebuild         |
                         |  linbofs64                 |
                         +---------------------------+
                         |                           |
                         |  update-linbofs.sh:       |
                         |                           |
                         |  1. linbofs64.xz Template |
                         |     entpacken (cpio)      |
                         |                           |
                         |  2. Kernel Modules aus    |
                         |     current/{variant}/    |
                         |     injizieren            |
                         |                           |
                         |  3. SSH Keys +            |
                         |     Dropbear Keys         |
                         |                           |
                         |  4. Passwort-Hash         |
                         |     (argon2)              |
                         |                           |
                         |  5. Firmware              |
                         |     (aus /lib/firmware)   |
                         |                           |
                         |  6. GUI Themes            |
                         |                           |
                         |  7. Pre-Hooks ausfuehren  |
                         |                           |
                         |  8. Repack:               |
                         |     cpio + xz + devnodes  |
                         |                           |
                         |  9. Size-Check (>10MB)    |
                         |                           |
                         | 10. Post-Hooks            |
                         +-------------+-------------+
                                       |
                                       v
                         +---------------------------+
                         |  Phase 4b: GRUB Configs   |
                         |  regenerieren             |
                         |  - Alle start.conf-Dateien|
                         |    neu nach GRUB uebersetzen
                         |  - Non-fatal bei Fehler   |
                         +-------------+-------------+
                                       |
                                       v
                         +---------------------------+
                         |  Phase 5: Finalize        |
                         |  (Version zuletzt!)       |
                         +---------------------------+
                         |                           |
                         |  1. linbo-version.txt     |
                         |     schreiben             |
                         |                           |
                         |  2. .boot-files-installed |
                         |     Marker setzen         |
                         |                           |
                         |  3. Work-Dir loeschen     |
                         |                           |
                         |  4. WebSocket Broadcast:  |
                         |     - linbo.update.status |
                         |     - kernel_variants_    |
                         |       changed             |
                         |                           |
                         |  5. Redis Lock freigeben  |
                         +---------------------------+
```

## Dateisystem-Aenderungen

### Vorher → Nachher

```
/srv/linbo/
  linbo64                    <-- Kernel (aus aktiver Variante)
  linbo64.md5
  linbofs64                  <-- Neu gebaut mit Keys/Modules/Hooks
  linbofs64.md5
  linbo-version.txt          <-- Zuletzt geschrieben (Crash-Safety)
  .boot-files-installed      <-- Marker
  linbo_gui64_7.tar.lz       <-- Aus .deb
  linbo_gui64_7.tar.lz.md5
  gui/
    linbo_gui64_7.tar.lz     --> ../linbo_gui64_7.tar.lz (Symlink)
    icons/                   --> ../icons/ (Symlink)
  icons/                     <-- Aus .deb
  boot/grub/
    shldr, grub.exe, ...     <-- Merged (Package-Dateien ueberschrieben)
    x86_64-efi/              <-- GESCHUETZT (nur neue Dateien hinzugefuegt)
    i386-pc/                 <-- GESCHUETZT
  kernels/
    stable/                  <-- Aus .deb extrahiert
    longterm/
    legacy/
    manifest.json

/var/lib/linuxmuster/linbo/
  sets/
    {HASH}/                  <-- Aktives Kernel-Set
      stable/
        linbo64
        modules.tar.xz
        version
      longterm/
        ...
      legacy/
        ...
      linbofs64.xz           <-- Template fuer Rebuilds
      manifest.json
  current -> sets/{HASH}     <-- Atomic Symlink
```

## Schutzmechanismen

| Mechanismus | Zweck | Implementierung |
|-------------|-------|-----------------|
| **SHA256-Verify** | Korrupte Downloads erkennen | `downloadAndVerify()` prueft Hash + Groesse |
| **GRUB-Merge** | GRUB-Module nicht loeschen | `mergeGrubFiles()` schuetzt `x86_64-efi/` und `i386-pc/` |
| **Atomic Symlink** | Crash-Safety bei Kernel-Switch | `current.new` → `mv` → `current` |
| **Version zuletzt** | UI zeigt "alt" bis alles fertig | `linbo-version.txt` wird als allerletztes geschrieben |
| **Redis Lock** | Kein paralleles Update | `NX` + TTL + Heartbeat |
| **Size-Check** | Kaputtes linbofs64 erkennen | Minimum 10MB nach Repack |
| **Backup** | Rollback moeglich | `linbofs64.bak` vor jedem Rebuild |
| **Cancel-Support** | User kann abbrechen | `AbortController` + `checkCancel()` zwischen Phasen |
| **flock** | Kein paralleler Rebuild | `update-linbofs.sh` nutzt flock auf fd 8 |

## Potenzielle Risiken bei Upstream-Aenderungen

| Risiko | Wahrscheinlichkeit | Auswirkung | Erkennung |
|--------|-------------------|------------|-----------|
| linbofs64 Format-Aenderung (nicht mehr cpio+xz) | Gering | update-linbofs.sh schlaegt fehl | Repack-Fehler, Size-Check |
| Interne Pfade aendern sich (z.B. `etc/linbo_pwhash`) | Mittel | Keys/Hash werden nicht gefunden | Client kann sich nicht verbinden |
| GRUB-Config-Syntax aendert sich | Mittel | Boot-Menue fehlerhaft | Clients booten nicht korrekt |
| Neues Kernel-Modul-Format | Gering | `depmod` schlaegt fehl | Kernel-Module fehlen im Client |
| Neue Abhaengigkeit im .deb | Gering | Kein Effekt (kein dpkg -i) | Keine — irrelevant fuer Docker |

## Manueller Upgrade-Trigger

```bash
# Via API
curl -X POST http://localhost:3000/api/v1/system/linbo-update \
  -H "Authorization: Bearer <token>"

# Via Dashboard
# System -> LINBO Update -> "Update starten"

# Status abfragen
curl http://localhost:3000/api/v1/system/linbo-update/status \
  -H "Authorization: Bearer <token>"
```

## Vergleich: LMN-Standard vs Docker-Upgrade

| Aspekt | LMN Standard | Docker |
|--------|-------------|--------|
| **Installation** | `apt upgrade linuxmuster-linbo7` | `dpkg-deb -x` (nur Extract) |
| **postinst** | Laeuft (ruft `update-linbofs` auf) | Laeuft NICHT |
| **Kernel-Provisioning** | Direkt in `/var/lib/linuxmuster/linbo/` | Atomic Symlink-Swap mit Sets |
| **linbofs64 Rebuild** | `/usr/sbin/update-linbofs` (LMN-Script) | Eigenes `update-linbofs.sh` im Container |
| **GRUB-Module** | Kommen aus separatem grub-Paket | Merge-Strategie (schuetzt bestehende) |
| **Rollback** | `apt install linuxmuster-linbo7=<version>` | `linbofs64.bak` + alte Kernel-Sets |
| **Trigger** | `apt upgrade` oder `update-linbofs` manuell | API-Endpunkt oder Dashboard |

## Boot-Test Runbook (Post-Update Verification)

Checklist to verify a linbo7 package update succeeded end-to-end.

### Pre-Boot Checks (on Docker host)

1. **Build status:** `make doctor` -- all checks pass, especially linbofs64 build status
2. **Audit linbofs64:** `make linbofs-audit` -- verify kernel version, module count, SSH keys present
3. **Check build manifest:** `docker exec linbo-api cat /srv/linbo/.linbofs-build-manifest.json` -- hookCount, hookWarnings as expected
4. **Size sanity:** linbofs64 should be ~55MB (check audit output)
5. **Module diff (optional):** `make module-diff` -- compare against LMN reference if available

### PXE Boot Test

1. Boot a test client via PXE
2. Verify GRUB menu appears (correct entries for configured groups)
3. Verify LINBO GUI loads (not stuck at "Loading..." or kernel panic)
4. Verify network connectivity (client can reach LINBO server for rsync)

### Functional Test

1. Start an OS from the LINBO GUI
2. Sync/restore an image (if safe to do on test machine)
3. Verify remote control from Dashboard (host appears online, can send commands)

### Rollback

If boot fails:
```bash
# Restore backup linbofs64
docker exec linbo-api cp /srv/linbo/linbofs64.bak /srv/linbo/linbofs64
docker exec linbo-api md5sum /srv/linbo/linbofs64 | awk '{print $1}' > /srv/linbo/linbofs64.md5
```
