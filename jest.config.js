/**
 * LINBO Plugin - Jest Configuration
 * Two test suites: legacy (tests/) and new (__tests__/)
 */

module.exports = {
  projects: [
    // Legacy test suite (tests/api/)
    {
      displayName: 'legacy',
      testEnvironment: 'node',
      testMatch: ['**/tests/**/*.test.js'],
      testPathIgnorePatterns: ['/node_modules/', 'ssh.service.test.js'],
      setupFilesAfterEnv: ['./tests/setup.js'],
      globalSetup: './tests/globalSetup.js',
      globalTeardown: './tests/globalTeardown.js',
    },
    // New test suite (__tests__/)
    {
      displayName: 'v2',
      testEnvironment: 'node',
      testMatch: ['**/__tests__/**/*.test.js'],
      testPathIgnorePatterns: ['/node_modules/'],
      setupFilesAfterEnv: ['./__tests__/setup/jest.setup.js'],
    },
  ],
  collectCoverageFrom: ['src/**/*.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 10000,
  forceExit: true,
};
