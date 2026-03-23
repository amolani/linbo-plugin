# Tech-Stack -- LINBO Docker

## Backend (API)

| Bereich | Technologie | Begruendung |
|---|---|---|
| Runtime | Node.js 20 LTS | Async I/O, gute WebSocket-Unterstuetzung |
| Sprache | JavaScript (ES2022) | Einfachheit, kein Build-Step noetig |
| Framework | Express.js 4 | Bewahrt, grosse Middleware-Auswahl |
| WebSocket | ws | Leichtgewichtig, native WebSocket |
| ORM | Prisma 5 | Type-safe DB-Zugriff, Schema-Management |
| Validierung | Zod | Runtime-Validierung mit klaren Fehlermeldungen |
| Cache | Redis 7 | In-Memory-Cache, Pub/Sub, Settings-Store |
| Datenbank | PostgreSQL 15 | ACID, bewaehrt, Prisma-Support |
| Auth | JWT (jsonwebtoken) | Standard-Token-Format |
| SSH | ssh2 | SSH-Client fuer Terminal-Proxy |
| Testing | Jest + Supertest | Unit + API-Integration-Tests |

## Frontend (Web)

| Bereich | Technologie | Begruendung |
|---|---|---|
| Framework | React 18 | Komponentenbasiert, grosse Community |
| Sprache | TypeScript (strict) | Typsicherheit im Frontend |
| Build | Vite 5 | Schnelle Builds, HMR |
| Styling | Tailwind CSS 3 | Utility-first, Dark Theme |
| UI Components | Headless UI | Zugaengliche, unstyled Basis-Komponenten |
| State | Zustand 4 | Leichtgewichtig, einfache API |
| HTTP Client | Axios | Interceptors, Token-Management |
| Terminal | xterm.js | Terminal-Emulation im Browser |
| Testing | Vitest | Schnell, Vite-kompatibel |

## Infrastruktur

| Bereich | Technologie | Begruendung |
|---|---|---|
| Container | Docker + Compose | Standard, einfaches Setup |
| Reverse Proxy | nginx | Web-Server + API-Proxy |
| PXE Boot | GRUB 2 | Standard-Bootloader |
| TFTP | tftp-hpa | Zuverlaessiger TFTP-Server |
| DHCP | isc-dhcp-server | Standard, konfigurierbar |
| Rsync | rsyncd | Image-Sync, Datei-Transfer |
| SSH | Dropbear | Leichtgewichtiger SSH-Server (Client-Seite) |
| SSH | OpenSSH | SSH-Server (Docker-Container) |

## LINBO-spezifisch

| Bereich | Technologie | Begruendung |
|---|---|---|
| Kernel | Linux Host-Kernel | Volle Hardware-Kompatibilitaet (~6000 Module) |
| Initramfs | linbofs64 (XZ-cpio) | LINBO-Dateisystem mit Patches |
| GUI | linbo_gui (Qt) | Native LINBO-Benutzeroberflaeche |
| Images | QCOW2 | Standard-Disk-Image-Format |
| Config | start.conf | LINBO-Konfigurationsdateien |

## Authority API (extern)

| Bereich | Technologie | Begruendung |
|---|---|---|
| Framework | Python FastAPI | Schnell, async, OpenAPI-Docs |
| Datenbank | SQLite | Einfach, serverless |
| Auth | Bearer Token + IP Allowlist | Sicher, einfach |
| Deployment | systemd | Standard Linux Service |
