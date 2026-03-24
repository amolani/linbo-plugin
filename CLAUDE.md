# Claude Project Instructions – LINBO Docker

## CRITICAL: Quality Standard — State of the Art

**Immer die sauberste, modernste Lösung wählen — auch wenn sie mehr Arbeit bedeutet.**
Niemals "schnell-schnell"-Lösungen. Lieber einmal richtig als zweimal nachbessern.

## Shared Knowledge Base — Obsidian Vault (`/root/obsidian-linbo/`)

Der Vault ist eine **lebendige Wissensdatenbank** — kein statisches Archiv.
Einstieg: `00-MOC/Home.md`

### Pflicht: Wissen aktiv pflegen
Während der Arbeit **kontinuierlich** neue Erkenntnisse eintragen:
- **Bug gefunden?** → Lösung in `05-Wissen/` dokumentieren, `[[Backlinks]]` zu betroffenen Projekten/Servern setzen
- **Architektur-Entscheidung getroffen?** → ADR in `04-Entscheidungen/` anlegen
- **Neues über einen Server gelernt?** → Server-Seite in `03-Server/` aktualisieren
- **Projekt-Feature gebaut?** → Projekt-Seite in `01-Projekte/` ergänzen
- **Konzept vertieft?** → Architektur-Seite in `02-Architektur/` erweitern oder neue anlegen

### Regeln
- Jede neue Seite bekommt YAML-Frontmatter (`created`, `updated`, `tags`)
- Immer `[[Backlinks]]` setzen zu verwandten Seiten
- Tags hierarchisch: `#projekt/linb-amo`, `#server/10-40-0-10`, `#architektur`
- Veraltete Infos in bestehenden Seiten aktualisieren, nicht stehen lassen
- Am Session-Ende: Eintrag in `07-Sessions/` mit Zusammenfassung

## CRITICAL: Session Start

### 1. Agents laden
```bash
cat docs/agents/CLAUDE.md
cat docs/agents/agents/<relevante-rolle>.md
```
**Ohne gelesene Agent-Datei nicht in der Rolle arbeiten.**

### 2. Aktuelle Docs lesen (letzte 7 Tage)
```bash
find docs/ -type f -name "*.md" -newer $(date -d '7 days ago' +%Y-%m-%d) | sort
```
Alle gefundenen Dateien vollständig lesen.

### 3. Plan Mode – Pflicht vor jeder Implementierung
**Niemals direkt mit Code beginnen.**
1. `EnterPlanMode`
2. Codebase explorieren & Plan erstellen
3. Plan mit User besprechen
4. Erst nach Freigabe implementieren

### 4. Deployment-Reihenfolge – Pflicht
```
Hauptserver (10.0.0.11) → implementieren & verifizieren
Testserver  (10.0.0.13) → erst danach ausrollen
```
**Niemals direkt auf dem Testserver implementieren.**

### 5. linbofs64-Änderungen – nur über Hooks
**Niemals `update-linbofs.sh` direkt modifizieren** für inhaltliche Anpassungen am linbofs64.
Stattdessen Hook-Scripts verwenden:
```
/etc/linuxmuster/linbo/hooks/update-linbofs.pre.d/   # VOR Repack (Dateien im linbofs ändern)
/etc/linuxmuster/linbo/hooks/update-linbofs.post.d/   # NACH Repack (Notifications etc.)
```
- Pre-Hooks laufen im extrahierten linbofs-Root (relative Pfade wie `usr/share/...` funktionieren)
- Nummerierte Präfixe für Reihenfolge: `01_theme`, `02_patch`, ...
- Doku: `docs/hooks.md`
- `update-linbofs.sh` selbst nur ändern bei Bugs im Build-Prozess, nicht für Inhalte.
