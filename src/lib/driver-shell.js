/**
 * LINBO Plugin - Driver Shell Escaping Utilities
 * Shell pattern character escaping for case statement generation
 */

/**
 * Escape shell pattern characters for exact match in case statement
 * Escapes: \ * ? [ ]
 * @param {string} str
 * @returns {string}
 */
function shellEscapeExact(str) {
  // eslint-disable-next-line no-useless-escape
  return str.replace(/([\\*?\[\]])/g, '\\$1');
}

/**
 * Escape shell pattern characters for contains match (inner text only)
 * The * wildcards are added around, inner text is escaped
 * @param {string} str
 * @returns {string}
 */
function shellEscapeContains(str) {
  return '*' + shellEscapeExact(str) + '*';
}

/**
 * Validate a match.conf value (vendor/product) for dangerous characters.
 * Returns null if safe, error message string if dangerous.
 */
const SHELL_DANGEROUS = /[`$'";&|<>{}\n\r\x00]/;
const MATCH_VALUE_SAFE = /^[a-zA-Z0-9 .,()/_+#-]*$/;

function validateMatchValue(value) {
  if (!value || typeof value !== 'string') return null;
  if (SHELL_DANGEROUS.test(value)) {
    return `Value contains dangerous characters: "${value.replace(/[\n\r]/g, '\\n')}"`;
  }
  if (!MATCH_VALUE_SAFE.test(value)) {
    return `Value contains disallowed characters: "${value}"`;
  }
  return null;
}

module.exports = {
  shellEscapeExact,
  shellEscapeContains,
  validateMatchValue,
  SHELL_DANGEROUS,
  MATCH_VALUE_SAFE,
};
