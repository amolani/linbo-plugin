/**
 * LINBO Docker - Jest Global Teardown
 * Wird einmal nach allen Tests ausgeführt
 */

module.exports = async () => {
  console.log('\n✅ All tests completed\n');
};
