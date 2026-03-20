# LINBO Docker – Projekt-Setup für Claude Code

## Projektübersicht

Dieses Projekt ist eine standalone Docker-Implementierung des LINBO-Systems (Linux-basierte Netzwerk-Boot-Umgebung) von linuxmuster.net. Kernfunktionen:
- PXE-Boot-Infrastruktur (TFTP, GRUB, Kernel, linbofs64)
- Host-/Raum-/Config-Verwaltung via REST-API
- Echtzeit-Monitoring via WebSocket (Host-Status, Operations)
- Image-Management (QCOW2-Sync vom LMN-Server)
- SSH-Terminal zu LINBO-Clients
- Sync-Modus (read-only) mit linuxmuster.net 7.3 Authority API
- Patchclass-System für Treiber und Postsync-Skripte

## Rollen & Agenten

Dieses Projekt nutzt spezialisierte Agenten. Jeder Agent hat eine eigene Datei im Verzeichnis `agents/`. Lies die jeweilige Datei, bevor du in der entsprechenden Rolle arbeitest.

| Rolle | Datei | Zuständigkeit |
|---|---|---|
| Projektmanager | `agents/projektmanager.md` | Planung, Koordination, Meilensteine |
| Softwarearchitekt | `agents/softwarearchitekt.md` | Systemdesign, Container-Architektur, Entscheidungen |
| Backend-Entwickler | `agents/backend-entwickler.md` | Express.js API, Services, Redis, Prisma |
| Frontend-Entwickler | `agents/frontend-entwickler.md` | React Dashboard, Stores, API-Module |
| DevOps-Engineer | `agents/devops-engineer.md` | Docker Compose, Deployment, Infrastruktur |
| Security-Engineer | `agents/security-engineer.md` | SSH-Keys, JWT, API-Keys, Boot-Sicherheit |
| Tester / QA-Engineer | `agents/tester.md` | Jest/Vitest, Teststrategien, Qualitätssicherung |
| Datenbank-Spezialist | `agents/datenbank-spezialist.md` | PostgreSQL/Prisma, Redis, Schema-Design |
| UX-Designer | `agents/ux-designer.md` | Dashboard-Design, Dark Theme, Komponenten |
| Tech-Lead | `agents/tech-lead.md` | Code-Reviews, Standards, technische Entscheidungen |
| Boot-Spezialist | `agents/boot-spezialist.md` | PXE, GRUB, Kernel, linbofs64, Init-Patches |

## Arbeitsweise

1. **Rolle aktivieren**: Sag z.B. "Arbeite als Boot-Spezialist" -- Claude liest dann die entsprechende Datei und arbeitet in dieser Rolle.
2. **Rollenwechsel**: Jederzeit moeglich durch einfache Anweisung.
3. **Mehrere Rollen**: Du kannst Claude bitten, mehrere Perspektiven einzunehmen, z.B. "Bewerte als Security-Engineer den Entwurf des Architekten."

## Referenzdokumente

Im Verzeichnis `references/` liegen ergaenzende Dokumente:
- `references/tech-stack.md` -- Tatsaechlicher Tech-Stack
- `references/projektstruktur.md` -- Verzeichnis- und Codestruktur
- `references/api-conventions.md` -- API-Design-Richtlinien
- `references/security-guidelines.md` -- Sicherheitsrichtlinien

## Quick Start

```
Ich moechte den aktuellen Projektstatus reviewen. Arbeite als Projektmanager.
```

```
Entwirf eine Loesung fuer Multicast-Support. Arbeite als Softwarearchitekt.
```

```
Implementiere einen neuen API-Endpunkt. Arbeite als Backend-Entwickler.
```

```
Debugge ein Boot-Problem mit einem Client. Arbeite als Boot-Spezialist.
```
