/**
 * LINBO Docker - Driver Shell Escaping Utilities
 * Shell pattern character escaping for case statement generation
 */

/**
 * Escape shell pattern characters for exact match in case statement
 * Escapes: \ * ? [ ]
 * @param {string} str
 * @returns {string}
 */
function shellEscapeExact(str) {
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

module.exports = {
  shellEscapeExact,
  shellEscapeContains,
};
