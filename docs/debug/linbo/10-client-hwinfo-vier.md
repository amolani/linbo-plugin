# 10 — Client Hardware-Info: vier (10.0.150.2)

Erhoben am 2026-03-13 via SSH (Referenz-linbofs64).

## Hardware

| Eigenschaft | Wert |
|---|---|
| **DMI** | QEMU Standard PC (Q35 + ICH9, 2009) |
| **BIOS** | Proxmox EDK II (EFI) |
| **CPU** | Intel Xeon E5-2650 v4 @ 2.20GHz, 8 Cores (KVM) |
| **RAM** | 8 GB |
| **Disk** | QEMU HDD, 100 GB, unpartitioniert |
| **NIC** | virtio_net (1af4:1000) @ PCI 0000:06:12.0, MAC BC:24:11:5C:25:09 |
| **GPU** | QEMU Bochs VGA (1234:1111) @ PCI 0000:00:01.0 |
| **Hypervisor** | KVM |

## Video-Kette (funktioniert mit Referenz-linbofs64)

```
1. efifb probt: framebuffer @ 0x80000000, 1280x800x32
2. fbcon deferred → takes over console
3. bochs-drm: Found bochs VGA, ID 0xb0c5, Framebuffer 524288 kB
4. /dev/fb0 + /dev/dri/card0 vorhanden
```

## Geladene Module (Referenz-Boot)

```
bochs, drm, drm_client_lib, drm_shmem_helper, drm_kms_helper
virtio_net, net_failover, failover
ahci, libahci, libata, scsi_mod, sd_mod, sr_mod, cdrom
ehci_hcd, ehci_pci, uhci_hcd, xhci_hcd, xhci_pci
i2c_i801, i2c_smbus, intel_agp, intel_gtt, agpgart
efivarfs, uinput, ntfs3
```

## Kernel / LINBO

- Kernel: 6.18.4 (identisch Docker + Referenz)
- LINBO: 4.3.31-0 "Psycho Killer"
- linbo_gui: /usr/bin/linbo_gui (20 MB, Oct 4 2025)
- init.sh: busybox 1.1.3 init
- Cmdline: `quiet splash dhcpretry=9 forcegrub noefibootmgr server=10.0.0.13 group=win11_pro hostgroup=win11_pro netboot`

## linbofs64 Vergleich Docker vs Referenz

| | Docker | Referenz |
|---|---|---|
| Komprimiert | 45.8 MB (9 Blocks) | 47.6 MB (10 Blocks) |
| Entpackt | 211.6 MB | 221.7 MB |
| Dateien | 1733 | 1789 |
| Module (.ko) | 720 | 720 |
| Kernel-Module-Dir | 6.18.4 | 6.18.4 |
| XZ Check | None | None |

### Fehlende Dateien in Docker (vs Referenz)

- Locale-Dateien (de_DE, i18n, LC_MESSAGES) — 40+ Dateien
- Plymouth arrows (arrows-1..18.png)
- `/etc/ssh/ssh_host_dsa_key` (Docker nutzt ed25519)
- `/usr/share/linbo/efipxe`
- `/etc/locale.conf`, `/etc/vconsole.conf`, `/etc/localtime`

### Extra in Docker

- ed25519 SSH Key, modules.weakdep, linbo-modern Theme, show_diagnostics.sh

### init.sh Patches (Docker-Hooks)

1. **02_preserve-cmdline-server**: LINBOSERVER nur ueberschreiben wenn server= NICHT in cmdline
2. **05_modprobe_virtio**: Explizites `modprobe virtio_net e1000 ...` + sleep 1 vor DHCP
3. **04_debug_remote_control**: show_diagnostics.sh im Remote-Control-Screen

### Video-Module: IDENTISCH (bochs.ko, drm.ko, etc.)

## Naechster Debug-Schritt

Docker-linbofs64 crasht mit garbled display (w18.png), Referenz bootet OK.
Module identisch, Dateien fast identisch. Verdacht:
1. XZ-Komprimierung (-e flag) inkompatibel mit Kernel-Decompressor?
2. CPIO-Format-Problem?
3. Hook-Patches brechen fruehen Boot?

**Test:** Docker-linbofs64 OHNE Hooks neu bauen und testen.
