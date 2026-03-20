# 11 — Reboot-Hang nach Remote-Befehlen

## Symptom

Nach bestimmten Remote-Befehlen (halt, poweroff, reboot via linbo_wrapper, partition, format) bleibt der Client beim naechsten PXE-Boot haengen. Die Haenge-Stelle variiert:

- "Starting time sync..." (ntpd -q haengt)
- "IP: 10.0.152.111 hostname: pc100 MAC: 84:ba:59:..." (init.sh Network-Phase)

Ein manueller Power-Cycle (Strom aus/ein) behebt das Problem immer.

## Betroffene Hardware

| Eigenschaft | Wert |
|---|---|
| Client | 10.0.152.111 (pc100) |
| Disk | NVMe KBG6AZNV512G (Kioxia) |
| NIC | Onboard (PXE-faehig) |
| Boot | UEFI PXE von 10.0.0.13 |
| LINBO | 4.3.31, Kernel 6.18.4 |

## Reproduktion

### Haengt IMMER:
1. `linbo_wrapper halt` → naechster Boot haengt
2. `linbo_wrapper poweroff` → naechster Boot haengt (poweroff ist kein gueltiger linbo_wrapper Befehl!)
3. `linbo_wrapper partition` → danach `linbo_wrapper reboot` → naechster Boot haengt
4. `linbo_wrapper format:1` → danach reboot → naechster Boot haengt
5. `.cmd` Datei mit `reboot` → beim Boot ausgefuehrt → Reboot-Loop, haengt

### Funktioniert IMMER:
1. `linbo_wrapper reboot` (ohne vorherige Disk-Operationen) → Client bootet sauber
2. `poweroff` direkt via SSH (ohne linbo_wrapper) → Client faehrt sauber runter, naechster Boot OK
3. Manueller Power-Cycle → Boot immer OK
4. `.cmd` Datei mit `sync:1` → sync laeuft, kein Hang

## Analyse

### Theorie 1: linbo_wrapper halt ist kein sauberer Shutdown
- `linbo_wrapper halt` ruft intern vermutlich `halt` auf (CPU stopp, kein ACPI poweroff)
- NIC bleibt im Halbzustand → PXE-Boot beim naechsten Einschalten defekt
- **Evidenz:** Direktes `poweroff` via SSH funktioniert sauber

### Theorie 2: Disk-Operationen + Reboot = unflushed Caches
- `partition` und `format` schreiben auf NVMe
- Sofortiger `reboot` danach → Disk-Caches nicht geflusht
- UEFI findet inkonsistente GPT beim naechsten Boot → haengt
- **Evidenz:** Reboot ohne vorherige Disk-Ops funktioniert

### Theorie 3: linbo_wrapper kennt poweroff nicht
- KNOWN_COMMANDS in LINBO: halt, reboot (kein poweroff)
- `linbo_wrapper poweroff` → unbekannter Befehl → undefiniertes Verhalten
- **Evidenz:** `linbo_wrapper poweroff` zeigt gleiches Haenge-Verhalten wie `halt`

### Theorie 4: NTP-Timeout nach unsauberem Shutdown
- init.sh Zeile 488: `ntpd -q -p "$NTPSRV"` — blockiert bis NTP sync
- Nach unsauberem Shutdown antwortet NTP-Server nicht rechtzeitig
- **Evidenz:** Haenge-Stelle ist oft "Starting time sync..."

## Aktueller Workaround

```javascript
// sync-operations.service.js
// halt/reboot/poweroff werden DIREKT via SSH gesendet, nicht ueber linbo_wrapper
const sshCommand = isFireAndForget
  ? mapCommand(validation.commands[0].command)  // "halt" → "poweroff"
  : `/usr/bin/linbo_wrapper ${wrapperCommands}`;
```

- `halt` wird auf `poweroff` gemappt und direkt via SSH gesendet
- `reboot` wird direkt via SSH gesendet
- Kein `linbo_wrapper` fuer Shutdown-Befehle

## Offene Fragen

1. **Was macht `linbo_wrapper halt` genau?**
   - Quellcode von linbo_wrapper analysieren (binary, nicht script)
   - Ruft es `halt`, `halt -p`, `poweroff` oder etwas anderes auf?

2. **Warum haengt der Boot nach partition/format + reboot?**
   - Braucht es ein `sync` (Disk-Flush) zwischen partition und reboot?
   - Hilft `linbo_wrapper partition && sync && linbo_wrapper reboot`?

3. **Ist das Hardware-spezifisch?**
   - Auf anderem Client (VM vier / 10.0.150.2) testen
   - UEFI vs BIOS Unterschied?

4. **NTP-Timeout: Kann init.sh gepatcht werden?**
   - `ntpd -q -p "$NTPSRV"` hat keinen Timeout → haengt ewig
   - LMN-natives Verhalten pruefen (hat init.sh einen NTP-Timeout?)
   - Hook-Patch: `timeout 10 ntpd -q -p "$NTPSRV" || true`

## Update 2026-03-16 (spaet)

### Neue Erkenntnisse:
1. **NTP-Timeout Hook installiert** (03_fix-ntp-timeout) — `timeout 10 ntpd ... ; true`
   - sed-Delimiter war falsch (| vs @), gefixt
   - Patch verifiziert im linbofs64
2. **Hang passiert auch bei manuellem Restart** — NICHT nur nach SSH-poweroff
3. **Root Cause gefunden: `linbo_mountcache` → `findcache()`**
   - Nach `partition` + `format` ist die Cache-Partition leer
   - `findcache()` iteriert ueber ALLE `/dev/disk/by-id/*part*` und mountet jede
   - Auf NVMe mit leeren/frisch formatierten Partitionen blockiert das intermittent
   - Erklaert warum VM nie betroffen ist (andere Disk-Architektur)
4. **Alle rsync-Hooks bereinigt** — kein curl in keinem Hook mehr
   - Download-Hooks: nur .cmd Cleanup via Marker-Mechanismus
   - Upload-Hooks: komplett leer (nur exit 0)
5. **halt/reboot direkt via SSH** statt linbo_wrapper — funktioniert sauber

### Fix-Ansatz:
- `initcache` auf dem Client ausfuehren → Cache-Partition mit linbo64 fuellen
- Dann sollte `findcache()` sofort die richtige Partition finden statt alle durchzuprobieren
- Alternativ: Cache-Device explizit in start.conf setzen (kein findcache noetig)

## Naechste Schritte

- [ ] `initcache` auf Hardware-Client ausfuehren (Cache-Partition fuellen)
- [ ] 10/10 halt-Tests auf Hardware nach initcache wiederholen
- [ ] 10/10 halt-Tests auf VM vier (10.0.150.2) als Kontrollgruppe
- [ ] Pruefen ob Cache-Device in start.conf explizit gesetzt ist
- [ ] Testen ob das Hang-Problem nach initcache verschwindet

## Betroffene Dateien

- `containers/api/src/services/sync-operations.service.js` — Befehl-Routing
- `containers/api/src/lib/linbo-commands.js` — halt→poweroff Mapping, FIRE_AND_FORGET
- `containers/rsync/scripts/rsync-pre-download-api.sh` — .cmd Marker
- `containers/rsync/scripts/rsync-post-download-api.sh` — .cmd Cleanup

## Timeline

| Datum | Ereignis |
|-------|----------|
| 2026-03-16 | Erster erfolgreicher reboot via API |
| 2026-03-16 | halt via API → Client haengt beim naechsten Boot |
| 2026-03-16 | poweroff direkt via SSH → funktioniert sauber |
| 2026-03-16 | partition + format → naechster reboot haengt |
| 2026-03-16 | .cmd reboot → Reboot-Loop |
| 2026-03-16 | Fix: halt/reboot direkt via SSH statt linbo_wrapper |
| 2026-03-16 | Fix: .cmd Cleanup via pre/post Marker-Mechanismus |
