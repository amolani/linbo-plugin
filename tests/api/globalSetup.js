/**
 * LINBO Docker - Jest Global Setup
 * Wird einmal vor allen Tests ausgeführt
 */

module.exports = async () => {
  // Setze Test-Umgebungsvariablen
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_jwt_secret_for_testing_only';
  process.env.JWT_EXPIRES_IN = '1h';

  console.log('\n🧪 Starting LINBO Docker API Tests...\n');
};
