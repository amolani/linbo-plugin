/**
 * LINBO Docker - Jest Setup
 * Wird vor jedem Test-File ausgeführt
 */

// Erhöhe Timeout für API-Tests
jest.setTimeout(30000);

// Unterdrücke Console-Logs in Tests (außer Errors)
if (process.env.SUPPRESS_LOGS !== 'false') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    // warn und error weiterhin anzeigen
  };
}
