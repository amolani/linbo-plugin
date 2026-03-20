# 08 — Kernel-Architektur (Paket-Kernel mit Varianten)

## Aktuelle Architektur

Docker nutzt den **LINBO-Paket-Kernel** von kernel.org mit Varianten-System:

| Variante | Kernel | Groesse |
|----------|--------|---------|
| **stable** (Default) | 6.17.x | ~4.3 MB |
| longterm | 6.12.x | ~4.1 MB |
| legacy | 6.1.x | ~3.5 MB |

Jede Variante kommt mit vorgebauten `modules.tar.xz` (~18 MB).

---

## Wie es funktioniert

```
Boot-Files (linbo-boot-files.tar.gz)
  └── kernels/
      ├── stable/   (linbo64, modules.tar.xz, version)
      ├── longterm/ (linbo64, modules.tar.xz, version)
      └── legacy/   (linbo64, modules.tar.xz, version)
           │
           ▼
   Init-Container (entrypoint.sh)
     → provision_kernels()
     → Atomic Symlink Swap: /var/lib/linuxmuster/linbo/current → sets/<hash>
           │
           ▼
   update-linbofs.sh
     → Liest custom_kernel (KERNELPATH=stable|longterm|legacy)
     → Injiziert Module aus der gewaehlten Variante
     → Kopiert linbo64 aus der gewaehlten Variante
```

---

## Kernel-Variante wechseln

### Via API
```bash
curl -X POST http://localhost:3000/api/v1/system/kernel-switch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"variant":"longterm"}'
```

### Manuell
```bash
# custom_kernel Datei aendern
echo 'KERNELPATH=longterm' > /etc/linuxmuster/linbo/custom_kernel

# linbofs64 neu bauen
docker exec linbo-api bash /usr/share/linuxmuster/linbo/update-linbofs.sh
```

---

## Diagnose

```bash
# Aktive Variante pruefen
docker exec linbo-api cat /etc/linuxmuster/linbo/custom_kernel

# Kernel-Version im linbofs64
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep 'lib/modules/' | head -1"

# Varianten auflisten
docker exec linbo-api ls -la /var/lib/linuxmuster/linbo/current/
```

---

## Historisch: Host-Kernel-Zwang (entfernt Session 31)

Bis Session 30 erzwang Docker den Host-Kernel (6.8.0-101, 15 MB) mit einem
3-Schichten-Schutz (entrypoint.sh, update-linbofs.sh, linbo-update.service.js).

**Session 30** bewies, dass Vanilla LINBO mit Paket-Kernel einwandfrei bootet.
Die Boot-Fehler waren ein GRUB-Config-Naming-Bug, kein Kernel-Problem.

**Session 31** entfernte den gesamten Host-Kernel-Zwang:
- `restore_host_kernel()` aus entrypoint.sh
- `isHostKernelAvailable()` aus linbo-update.service.js
- `USE_HOST_KERNEL`, `SKIP_KERNEL_COPY`, `HOST_MODULES_PATH` Env-Vars
- Step 7b (Host-Module via rsync) aus update-linbofs.sh
- `/boot:/boot:ro` und `/lib/modules:/lib/modules:ro` Bind-Mounts
