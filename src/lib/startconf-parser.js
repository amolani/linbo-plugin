'use strict';

/**
 * LINBO Native - start.conf Parser
 *
 * Parses the INI-style start.conf format into a structured object.
 * Pure synchronous function -- no I/O, no external dependencies.
 *
 * @module startconf-parser
 */

/**
 * Parse a start.conf file content into a structured object.
 *
 * @param {string} content - Raw start.conf file content
 * @returns {{ linbo: Object, partitions: Array<Object>, os: Array<Object> }}
 */
function parseStartConf(content) {
  const result = { linbo: {}, partitions: [], os: [] };

  if (!content) return result;

  const lines = content.split('\n');
  let currentObj = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    // Section headers
    if (/^\[LINBO\]/i.test(line)) {
      currentObj = result.linbo;
      continue;
    }
    if (/^\[Partition\]/i.test(line)) {
      const partition = {};
      result.partitions.push(partition);
      currentObj = partition;
      continue;
    }
    if (/^\[OS\]/i.test(line)) {
      const os = {};
      result.os.push(os);
      currentObj = os;
      continue;
    }

    // Key=value pairs (only if we're inside a known section)
    if (currentObj && line.includes('=')) {
      const eqIdx = line.indexOf('=');
      const key = line.slice(0, eqIdx).trim();
      const value = line.slice(eqIdx + 1).trim();
      currentObj[key.toLowerCase()] = value;
    }
  }

  return result;
}

module.exports = { parseStartConf };
