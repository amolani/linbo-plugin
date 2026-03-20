# Sicherheitsbefund: Unauthentifizierter rsync-Zugriff auf LINBO Images

**Datum:** 19. März 2026
**Schweregrad:** Hoch
**Betrifft:** Alle Standard-linuxmuster.net 7.x Installationen
**Verifiziert auf:** linuxmuster.net 7.3, Ubuntu 24.04, linuxmuster-linbo7 4.3.31

---

## Zusammenfassung

Der rsync-Share `[linbo]` auf dem linuxmuster.net Server ist standardmäßig **ohne Authentifizierung** konfiguriert. Jedes Gerät im Schulnetzwerk kann über `rsync rsync://<server-ip>/linbo/` sämtliche LINBO-Dateien herunterladen — einschließlich kompletter Betriebssystem-Images (`.qcow2`), Boot-Konfigurationen und GRUB-Configs.

Dies ist **kein Konfigurationsfehler einzelner Installationen**, sondern eine Design-Entscheidung im Standard-LMN-Template, die alle Installationen betrifft.

---

## Betroffene Konfiguration

Die Datei `/etc/rsyncd.conf` wird vom Paket `linuxmuster-linbo7` aus dem Template `/usr/share/linuxmuster/templates/rsyncd.conf` erzeugt:

```ini
[linbo]
comment = LINBO Image directory (read-only)
path = /srv/linbo
use chroot = no
lock file = /var/lock/rsyncd
read only = yes
list = yes
uid = nobody
gid = nogroup
dont compress = *.qcow2 *.cloop *.rsync *.gz *.lz
pre-xfer exec = /usr/share/linuxmuster/linbo/rsync-pre-download.sh
post-xfer exec = /usr/share/linuxmuster/linbo/rsync-post-download.sh
```

**Fehlende Einträge:** `auth users` und `secrets file` — der Share ist vollständig offen.

Zum Vergleich: Der Upload-Share `[linbo-upload]` hat Authentifizierung:

```ini
[linbo-upload]
auth users = linbo
secrets file = /etc/rsyncd.secrets
```

---

## Verifizierung

### Getestet auf frisch installiertem Referenzserver (10.0.0.14)

```bash
# 1. Dateiliste OHNE Authentifizierung abrufen
$ rsync --list-only rsync://10.0.0.14/linbo/
drwxr-xr-x   4.096 2026/03/05 14:38:10 .
-rw-r--r--   4.527.104 2026/03/05 14:01:35 linbo64
-rw-r--r--  47.579.612 2026/03/05 14:01:35 linbofs64
-rw-r--r--   9.334.860 2025/10/04 13:44:23 linbo_gui64_7.tar.lz
-rw-r--r--   1.218 2026/03/05 14:33:06 start.conf.win11_pro
drwxr-xr-x   4.096 2026/03/05 14:02:51 boot
drwxr-xr-x   4.096 2026/01/12 15:53:10 images
# ... (weitere Dateien)

# 2. Datei-Download OHNE Authentifizierung
$ rsync rsync://10.0.0.14/linbo/linbo-version /tmp/test
$ cat /tmp/test
LINBO 4.3.31-0: Psycho Killer    ← Erfolgreich ohne Passwort

# 3. start.conf (enthält Server-IP, Partitions-Layout)
$ rsync rsync://10.0.0.14/linbo/start.conf.win11_pro /tmp/test
$ head -3 /tmp/test
[LINBO]
Server = 10.0.0.14
Group = win11_pro                 ← Erfolgreich ohne Passwort

# 4. GRUB-Konfigurationen
$ rsync --list-only rsync://10.0.0.14/linbo/boot/grub/
-rw-r--r--   3.967 grub.cfg
-rw-r--r--   4.929 win11_pro.cfg  ← Einsehbar ohne Passwort

# 5. Images (auf Produktionsserver mit Images):
$ rsync --list-only rsync://10.0.0.11/linbo/images/win11_pro_edu/
-rw-rw-r-- 27.000.000.000 win11_pro_edu.qcow2  ← Downloadbar ohne Passwort
```

### Positiver Befund: .macct-Dateien sind geschützt

Die Machine-Account-Dateien (`.macct`) haben `chmod 600` (nur root lesbar). Da der rsync-Share als `uid=nobody` läuft, können diese Dateien **nicht** über rsync heruntergeladen werden. Die Samba-AD-Credentials sind somit nicht direkt betroffen.

---

## Angriffszenario

**Voraussetzung:** Zugang zum Schulnetzwerk (z.B. als Schüler mit eigenem Linux-Laptop oder Linux-Boot-Stick)

1. **Image herunterladen:**
   ```bash
   rsync -avP rsync://10.0.0.1/linbo/images/win11_pro_edu/win11_pro_edu.qcow2 /tmp/
   ```

2. **Image zu Hause mounten:**
   ```bash
   sudo modprobe nbd
   sudo qemu-nbd -c /dev/nbd0 win11_pro_edu.qcow2
   sudo mount /dev/nbd0p3 /mnt
   ```

3. **Sensible Daten extrahieren:**

   | Daten | Pfad | Risiko |
   |-------|------|--------|
   | Windows lokale Passwort-Hashes | `Windows/System32/config/SAM` + `SYSTEM` | Offline-Cracking möglich |
   | WLAN-Passwörter (Klartext) | `ProgramData/Microsoft/Wlansvc/Profiles/` | Direkter Zugang zum Schul-WLAN |
   | Linux Passwort-Hashes | `/etc/shadow` | Hash des linuxadmin crackbar |
   | SSH Keys | `/root/.ssh/`, `/home/*/.ssh/` | Zugang zu anderen Systemen |
   | VPN-Konfigurationen | Diverse Pfade | Netzwerkzugang von extern |
   | Browser-Passwörter | Profilverzeichnisse | Falls im Image gespeichert |
   | Zertifikate | Diverse Pfade | Man-in-the-Middle möglich |

---

## Betroffene Systeme

| System | Betroffen? | Begründung |
|--------|------------|------------|
| **Standard-LMN 7.x (alle Versionen)** | **Ja** | Template enthält keinen Auth-Schutz auf `[linbo]` Share |
| **linuxmuster-cachingserver-satellite** | **Nein** | Caching-Server Shares haben `auth users = cach*` |
| **LINBO Docker** | **Nein** | Nutzt HTTP/Authority API statt offenen rsync |
| **Firewall-geschützte Installationen** | **Bedingt** | Wenn Port 873 nicht aus dem Schüler-Netz erreichbar ist → geschützt |

---

## Ursache

Die Design-Entscheidung ist historisch begründet: LINBO-Clients müssen beim PXE-Boot ohne Credentials auf Boot-Dateien, Kernel, linbofs64 und Images zugreifen können. Der rsync-Share wurde daher bewusst offen gelassen.

Das Problem ist, dass **derselbe Share** sowohl für PXE-Boot-Dateien (müssen offen sein) als auch für Images (sollten geschützt sein) verwendet wird.

---

## Empfohlene Mitigationen

### Kurzfristig (sofort umsetzbar)

**1. Firewall-Regel: rsync nur für LINBO-Clients**
```bash
# Auf der OPNsense/Firewall:
# Port 873 (rsync) nur aus dem LINBO-Client-Subnet erlauben
# Nicht aus dem allgemeinen Schüler-WLAN oder Lehrer-Netz
```

**2. hosts allow in rsyncd.conf**
```ini
[linbo]
# ... bestehende Config ...
hosts allow = 10.0.0.0/24     # Nur das Client-Subnet
hosts deny = *                  # Alles andere blockieren
```

### Mittelfristig

**3. VLAN-Segmentierung**
- LINBO-Clients in eigenes VLAN (z.B. VLAN 10)
- rsync Port 873 nur in diesem VLAN erreichbar
- Schüler-WLAN und Lehrer-Netz in separaten VLANs ohne rsync-Zugang

**4. Caching-Server / LINBO Docker einsetzen**
- Clients pullen von Caching-Server/Docker (mit Auth) statt direkt vom LMN-Server
- LMN-Server rsync nur noch für Caching-Server erreichbar

### Langfristig (Upstream-Änderung nötig)

**5. Getrennte rsync-Shares für Boot vs. Images**
```ini
[linbo-boot]     # Offen — nur Boot-Dateien (Kernel, linbofs64, GRUB)
path = /srv/linbo/boot

[linbo-images]   # Authentifiziert — Images mit sensiblen Daten
path = /srv/linbo/images
auth users = linbo
secrets file = /etc/rsyncd.secrets
```

**6. Upstream-Meldung an linuxmuster.net**
- Template `/usr/share/linuxmuster/templates/rsyncd.conf` anpassen
- Separate Shares für Boot-Dateien vs. Images
- Dokumentation ergänzen

---

## Hinweis

Dieses Dokument beschreibt eine architekturbedingte Eigenschaft von linuxmuster-linbo7, keine Fehlkonfiguration des Kunden. Die Empfehlung ist, kurzfristig Firewall-Regeln einzusetzen und mittelfristig auf VLAN-Segmentierung oder Caching-Server/LINBO Docker umzusteigen.
