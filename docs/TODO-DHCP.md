# TODO: DHCP Integration für LINBO Docker

**Priorität:** HOCH
**Status:** Offen
**Erstellt:** 2026-02-05

## Warum ist DHCP kritisch?

DHCP ist das **Herzstück** der LINBO-Client-Konfiguration. Ohne korrekte DHCP-Konfiguration:
- Können Clients nicht PXE-booten
- Wissen Clients nicht, welche Config sie verwenden sollen
- Funktioniert die Host-Erkennung nicht

### Was DHCP für LINBO liefert:

| DHCP Option | Zweck | Beispiel |
|-------------|-------|----------|
| `next-server` | TFTP-Server IP | 10.0.0.11 |
| `filename` | Boot-Datei | `boot/grub/i386-pc/core.0` (BIOS) oder `boot/grub/x86_64-efi/core.efi` (UEFI) |
| `option 40` (nis-domain) | **Config-Name!** | `win11_efi_sata` |
| IP-Adresse | Client-IP | Per MAC-Reservierung |

## Wie funktioniert es in Production?

### linuxmuster.net 7.3 DHCP-Konfiguration

```
# /etc/dhcp/dhcpd.conf (Auszug)

subnet 10.0.0.0 netmask 255.255.0.0 {
    option routers 10.0.0.254;
    option domain-name-servers 10.0.0.1;
    next-server 10.0.0.1;

    # BIOS PXE
    if option arch = 00:00 {
        filename "boot/grub/i386-pc/core.0";
    }
    # UEFI PXE
    else if option arch = 00:07 or option arch = 00:09 {
        filename "boot/grub/x86_64-efi/core.efi";
    }
}

# Host-spezifische Einträge (aus devices.csv generiert)
host pc-r101-01 {
    hardware ethernet aa:bb:cc:dd:ee:01;
    fixed-address 10.0.0.101;
    option host-name "pc-r101-01";
    option nis-domain "win11_efi_sata";  # <-- Config-Name!
}
```

### Der Ablauf:

```
1. Client startet PXE-Boot
   └─> DHCP Request (mit MAC-Adresse)

2. DHCP-Server antwortet mit:
   ├─> IP-Adresse
   ├─> next-server (TFTP)
   ├─> filename (GRUB)
   └─> nis-domain (Config-Name!)

3. Client lädt GRUB via TFTP
   └─> grub.cfg erkennt nis-domain Variable

4. GRUB lädt passende start.conf
   └─> /srv/linbo/start.conf.{nis-domain}

5. LINBO startet mit korrekter Konfiguration
```

## Optionen für Docker-Integration

### Option A: Externer DHCP-Server (Empfohlen für Production)

**Vorteile:**
- Bestehende Infrastruktur nutzen
- Keine Konflikte mit vorhandenem DHCP
- Bewährt und stabil

**Implementierung:**
1. API-Endpoint zum Generieren der DHCP-Konfiguration
2. Export als `dhcpd.conf` Fragment oder ISC DHCP include
3. Dokumentation für verschiedene DHCP-Server

```javascript
// GET /api/v1/export/dhcp
// Generiert DHCP-Konfiguration für alle Hosts

host pc-r101-01 {
    hardware ethernet aa:bb:cc:dd:ee:01;
    fixed-address 10.0.0.101;
    option host-name "pc-r101-01";
    option nis-domain "win11_efi_sata";
}
```

### Option B: Integrierter DHCP-Container

**Vorteile:**
- Alles-in-einem Lösung
- Automatische Synchronisation
- Einfacher Setup

**Nachteile:**
- Kann mit bestehendem DHCP kollidieren
- Benötigt Host-Network oder spezielle Ports
- Komplexer zu debuggen

**Implementierung:**
1. Neuer Container `linbo-dhcp` mit ISC DHCP oder dnsmasq
2. API generiert Config automatisch bei Host-Änderungen
3. Container-Neustart bei Config-Änderungen

### Option C: dnsmasq Proxy-DHCP

**Vorteile:**
- Funktioniert neben bestehendem DHCP
- Nur PXE-relevante Optionen
- Kein IP-Konflikt

**Implementierung:**
```
# dnsmasq.conf
port=0  # Kein DNS
dhcp-range=10.0.0.0,proxy  # Proxy-Modus
pxe-service=x86PC,"LINBO",boot/grub/i386-pc/core.0
pxe-service=x86-64_EFI,"LINBO",boot/grub/x86_64-efi/core.efi
```

## Empfohlene Implementierung

### Phase 1: DHCP-Export API (Minimal)

```javascript
// containers/api/src/routes/export.js

/**
 * GET /api/v1/export/dhcp
 * Generiert DHCP-Konfiguration im ISC DHCP Format
 */
router.get('/dhcp', async (req, res) => {
  const hosts = await prisma.host.findMany({
    include: { config: true },
  });

  let config = `# LINBO Docker - DHCP Configuration
# Generated: ${new Date().toISOString()}
# Include this file in your dhcpd.conf

`;

  for (const host of hosts) {
    if (!host.macAddress) continue;

    config += `host ${host.hostname} {\n`;
    config += `    hardware ethernet ${host.macAddress};\n`;

    if (host.ipAddress) {
      config += `    fixed-address ${host.ipAddress};\n`;
    }

    config += `    option host-name "${host.hostname}";\n`;

    if (host.config) {
      config += `    option nis-domain "${host.config.name}";\n`;
    }

    config += `}\n\n`;
  }

  res.type('text/plain').send(config);
});

/**
 * GET /api/v1/export/dhcp/dnsmasq
 * Generiert DHCP-Konfiguration für dnsmasq
 */
router.get('/dhcp/dnsmasq', async (req, res) => {
  const hosts = await prisma.host.findMany({
    include: { config: true },
  });

  let config = `# LINBO Docker - dnsmasq DHCP Configuration
# Generated: ${new Date().toISOString()}

`;

  for (const host of hosts) {
    if (!host.macAddress) continue;

    // dhcp-host=mac,ip,hostname,lease-time
    const parts = [host.macAddress];
    if (host.ipAddress) parts.push(host.ipAddress);
    parts.push(host.hostname);
    parts.push('infinite');

    config += `dhcp-host=${parts.join(',')}\n`;

    // Tag für nis-domain
    if (host.config) {
      config += `dhcp-host=${host.macAddress},set:${host.config.name}\n`;
      config += `dhcp-option=tag:${host.config.name},40,${host.config.name}\n`;
    }
  }

  res.type('text/plain').send(config);
});
```

### Phase 2: Frontend Integration

```tsx
// Neuer Tab auf der Hosts-Seite oder System-Seite

<Button onClick={() => downloadDhcpConfig()}>
  DHCP-Konfiguration exportieren
</Button>

// Oder in System-Settings:
<Card>
  <h3>DHCP Integration</h3>
  <p>Exportieren Sie die DHCP-Konfiguration für Ihren DHCP-Server.</p>
  <Select>
    <option value="isc">ISC DHCP (dhcpd.conf)</option>
    <option value="dnsmasq">dnsmasq</option>
    <option value="windows">Windows DHCP</option>
  </Select>
  <Button>Download</Button>
</Card>
```

### Phase 3: Optionaler DHCP-Container

```yaml
# docker-compose.yml (optional)

services:
  dhcp:
    image: networkboot/dhcpd
    container_name: linbo-dhcp
    network_mode: host  # Wichtig für DHCP!
    volumes:
      - ./dhcpd.conf:/etc/dhcp/dhcpd.conf:ro
      - dhcp_leases:/var/lib/dhcp
    depends_on:
      - api
    profiles:
      - dhcp  # Nur mit --profile dhcp starten
```

## Sofort-Workaround

Bis zur Implementierung kann der Benutzer manuell:

1. **Hosts aus DB exportieren:**
   ```bash
   docker exec linbo-db psql -U linbo -c "
     SELECT h.hostname, h.mac_address, h.ip_address, c.name as config
     FROM hosts h
     LEFT JOIN configs c ON h.config_id = c.id
   " --csv > hosts.csv
   ```

2. **DHCP-Config manuell erstellen:**
   ```bash
   # Script das CSV in dhcpd.conf konvertiert
   while IFS=, read -r hostname mac ip config; do
     echo "host $hostname {"
     echo "    hardware ethernet $mac;"
     echo "    fixed-address $ip;"
     echo "    option nis-domain \"$config\";"
     echo "}"
   done < hosts.csv >> /etc/dhcp/dhcpd.conf.d/linbo-hosts.conf
   ```

3. **DHCP neustarten:**
   ```bash
   systemctl restart isc-dhcp-server
   ```

## Offene Fragen

1. **Soll der DHCP-Container Standard sein oder optional?**
   - Empfehlung: Optional mit `--profile dhcp`

2. **Wie mit bestehenden DHCP-Servern umgehen?**
   - Dokumentation für Integration
   - Import-Funktion für bestehende Leases?

3. **Automatische Synchronisation?**
   - Webhook bei Host-Änderungen?
   - Cron-Job für Config-Update?

4. **Windows DHCP Server Support?**
   - PowerShell-Script zum Import?
   - Netsh-Befehle generieren?

## Akzeptanzkriterien

- [ ] API-Endpoint `/api/v1/export/dhcp` funktioniert
- [ ] Export für ISC DHCP Format
- [ ] Export für dnsmasq Format
- [ ] Frontend-Button zum Download
- [ ] Dokumentation für manuelle Integration
- [ ] Optional: DHCP-Container mit docker-compose Profile
- [ ] Tests für Export-Funktionen

## Referenzen

- [ISC DHCP Manual](https://kb.isc.org/docs/isc-dhcp-44-manual-pages-dhcpdconf)
- [dnsmasq Manual](https://thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html)
- [linuxmuster.net DHCP Doku](https://docs.linuxmuster.net/)
- [PXE Boot Process](https://wiki.syslinux.org/wiki/index.php?title=PXELINUX)
