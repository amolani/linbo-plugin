# LINBO Docker - Test Coverage Plan

**Erstellt:** 2026-02-05
**Status:** Implementiert

---

## Übersicht

Diese Dokumentation beschreibt die Test-Suite für die LINBO Docker API Services.

---

## 1. Bestehende Tests

### 1.1 API Integration Tests
**Datei:** `tests/api.test.js`

| Test-Suite | Tests | Beschreibung |
|------------|-------|--------------|
| Health Checks | 2 | `/health`, `/ready` Endpoints |
| Authentication | 6 | Login, Logout, Token-Validation |
| Rooms CRUD | 5 | Create, Read, Update, Delete, Duplicate |
| Groups CRUD | 5 | Create, Read, Update, Delete |
| Hosts CRUD | 10 | Create, Read, Update, Delete, MAC-Lookup, Filter |
| Stats | 1 | Dashboard-Statistiken |
| Configs | 5 | Create, Read, Delete, Preview |
| Images | 1 | List Images |
| API Info | 1 | API-Dokumentation |
| Error Handling | 4 | 404, Invalid JSON, etc. |

**Gesamt:** 39 Tests

---

## 2. Neue Service Unit Tests

### 2.1 Config Service Tests
**Datei:** `tests/services/config.service.test.js`

| Funktion | Tests | Beschreibung |
|----------|-------|--------------|
| `generateStartConf` | 7 | start.conf Generierung |
| `deployConfig` | 3 | Deployment und MD5-Hash |
| `createHostSymlinks` | 3 | IP-basierte Symlinks |
| `cleanupOrphanedSymlinks` | 2 | Orphaned Cleanup |
| `listDeployedConfigs` | 3 | Listing und Metadaten |

**Gesamt:** 18 Tests

### 2.2 GRUB Service Tests
**Datei:** `tests/services/grub.service.test.js`

| Funktion | Tests | Beschreibung |
|----------|-------|--------------|
| `generateGroupGrubConfig` | 5 | Gruppen-GRUB-Config |
| `generateHostGrubConfig` | 4 | Host-GRUB-Config |
| `generateMainGrubConfig` | 5 | Haupt-grub.cfg |
| `regenerateAllGrubConfigs` | 3 | Vollständige Regenerierung |
| `deleteGroupGrubConfig` | 2 | Gruppen-Config löschen |
| `deleteHostGrubConfig` | 1 | Host-Config löschen |
| `listGrubConfigs` | 2 | Configs auflisten |
| `cleanupOrphanedConfigs` | 3 | Orphaned Cleanup |

**Gesamt:** 25 Tests

### 2.3 WoL Service Tests
**Datei:** `tests/services/wol.service.test.js`

| Funktion | Tests | Beschreibung |
|----------|-------|--------------|
| `createMagicPacket` | 5 | Magic Packet Erstellung |
| `isValidMac` | 2 | MAC-Validierung |
| `normalizeMac` | 4 | MAC-Normalisierung |
| `sendWakeOnLan` | 3 | WoL-Versand |
| `sendWakeOnLanBulk` | 3 | Bulk-WoL |
| `sendWakeOnLanToSubnet` | 1 | Subnet-WoL |

**Gesamt:** 18 Tests

### 2.4 SSH Service Tests
**Datei:** `tests/services/ssh.service.test.js`

| Funktion | Tests | Beschreibung |
|----------|-------|--------------|
| `executeCommand` | 5 | Befehlsausführung |
| `executeCommands` | 4 | Sequentielle Ausführung |
| `executeWithTimeout` | 2 | Timeout-Handling |
| `testConnection` | 2 | Verbindungstest |
| `executeLinboCommand` | 10 | LINBO-Befehle |
| `getLinboStatus` | 2 | Status-Abfrage |
| `streamCommand` | 2 | Output-Streaming |

**Gesamt:** 27 Tests

### 2.5 Host Service Tests
**Datei:** `tests/services/host.service.test.js`

| Funktion | Tests | Beschreibung |
|----------|-------|--------------|
| `getHostById` | 3 | Host per ID |
| `getHostByHostname` | 2 | Host per Hostname |
| `getHostByMac` | 2 | Host per MAC |
| `updateHostStatus` | 3 | Status-Updates |
| `bulkUpdateStatus` | 2 | Bulk-Updates |
| `getStaleHosts` | 2 | Stale Host Detection |
| `markStaleHostsOffline` | 2 | Stale Hosts offline |
| `getHostConfig` | 4 | Host-Konfiguration |
| `getSyncProgress` | 2 | Sync-Fortschritt |
| `getHostsByRoom` | 2 | Hosts nach Raum |
| `getHostsByGroup` | 1 | Hosts nach Gruppe |

**Gesamt:** 25 Tests

### 2.6 Linbofs Service Tests
**Datei:** `tests/services/linbofs.service.test.js`

| Funktion | Tests | Beschreibung |
|----------|-------|--------------|
| `updateLinbofs` | 4 | Update-Script |
| `updateLinbofsStream` | 2 | Streaming-Update |
| `verifyLinbofs` | 2 | Linbofs-Verifikation |
| `getLinbofsInfo` | 3 | Datei-Info |
| `checkKeyFiles` | 2 | Key-File-Check |
| `generateSshKeyPair` | 3 | SSH-Key-Generierung |
| `generateDropbearKey` | 2 | Dropbear-Key |
| `initializeKeys` | 3 | Key-Initialisierung |

**Gesamt:** 21 Tests

---

## 3. Test-Statistiken

### Gesamt-Übersicht

| Kategorie | Tests | Status |
|-----------|-------|--------|
| API Integration | 39 | ✅ Bestehend |
| Config Service | 18 | ✅ Neu |
| GRUB Service | 25 | ✅ Neu |
| WoL Service | 18 | ✅ Neu |
| SSH Service | 27 | ✅ Neu |
| Host Service | 25 | ✅ Neu |
| Linbofs Service | 21 | ✅ Neu |
| **Gesamt** | **173** | |

### Coverage-Ziele

| Metrik | Ziel | Aktuell |
|--------|------|---------|
| Lines | 70% | ~75% |
| Functions | 70% | ~80% |
| Branches | 60% | ~65% |
| Statements | 70% | ~75% |

---

## 4. Test-Ausführung

### Alle Tests ausführen
```bash
cd /root/linbo-docker/containers/api
npm test
```

### Nur Service-Tests
```bash
npm test -- --testPathPattern="services"
```

### Mit Coverage
```bash
npm run test:coverage
```

### Watch-Mode für Entwicklung
```bash
npm run test:watch
```

### Einzelne Test-Suite
```bash
npm test -- --testPathPattern="config.service"
```

---

## 5. Mock-Strategie

### Prisma (Datenbank)
Alle Prisma-Funktionen werden gemockt, um Datenbank-Unabhängigkeit zu gewährleisten.

```javascript
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    host: { findUnique: jest.fn(), ... },
    config: { findUnique: jest.fn(), ... },
  },
}));
```

### Redis (Cache)
Redis-Operationen werden gemockt für deterministische Tests.

```javascript
jest.mock('../../src/lib/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}));
```

### SSH2
SSH-Verbindungen werden vollständig gemockt.

```javascript
jest.mock('ssh2', () => ({
  Client: jest.fn().mockImplementation(() => { ... }),
}));
```

### Filesystem
Temporäre Verzeichnisse für File-System-Tests:
- `/tmp/linbo-test/`
- `/tmp/linbo-grub-test/`
- `/tmp/linbofs-test/`

---

## 6. Fehlende Tests (TODO)

### High Priority
- [ ] Operation Worker Tests
- [ ] Internal Routes Tests (RSYNC Hooks)
- [ ] System Routes Tests

### Medium Priority
- [ ] Middleware Tests (Auth, Validate, Audit)
- [ ] WebSocket Events Tests
- [ ] Rate Limiting Tests

### Low Priority
- [ ] E2E Tests mit echter Datenbank
- [ ] Performance/Load Tests
- [ ] Real Hardware Boot Tests

---

## 7. CI/CD Integration

### GitHub Actions Workflow
```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npm ci
    - run: npm run test:coverage
    - uses: codecov/codecov-action@v3
```

### Pre-Commit Hook (Optional)
```bash
npm test -- --onlyChanged
```

---

## 8. Troubleshooting

### Tests schlagen fehl wegen Mock-Problemen
```bash
# Mocks zurücksetzen
npm test -- --clearCache
```

### Timeout-Fehler
```bash
# Timeout erhöhen
npm test -- --testTimeout=60000
```

### Parallelisierungsprobleme
```bash
# Sequentiell ausführen
npm test -- --runInBand
```
