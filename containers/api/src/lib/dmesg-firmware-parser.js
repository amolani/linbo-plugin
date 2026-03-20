/**
 * LINBO Docker - dmesg Firmware Parser
 * Pure parser for extracting firmware events from dmesg output.
 * No I/O dependencies — only string processing.
 */

// Patterns that indicate missing firmware
const MISSING_PATTERNS = [
  // "firmware: failed to load <filename>"
  /firmware:\s+failed to load\s+(\S+)/gi,
  // "Direct firmware load for <filename> failed"
  /Direct firmware load for\s+(\S+)\s+failed/gi,
  // "request_firmware failed: <filename>"
  /request_firmware\s+failed.*?:\s+(\S+)/gi,
];

// Pattern that indicates loaded firmware (info only)
const LOADED_PATTERN = /loaded firmware\s+(?:version\s+)?(\S+)/gi;

// Pattern to extract driver name from dmesg line context
// e.g. "[  1.234] i915 0000:00:02.0: firmware: ..." → "i915"
const DRIVER_PATTERN = /\]\s+(\S+)\s+\S+:\s+(?:firmware|Direct firmware)/;

/**
 * Parse dmesg output and extract firmware events.
 * @param {string} output - Raw dmesg output (or grep-filtered)
 * @returns {Array<{filename: string, driver: string|null, status: 'missing'|'loaded'}>}
 */
function parseDmesgFirmware(output) {
  if (!output || typeof output !== 'string') return [];

  const lines = output.split('\n');
  const events = [];
  const seen = new Set();

  for (const line of lines) {
    if (!line.trim()) continue;

    // Try missing patterns
    let matched = false;
    for (const pattern of MISSING_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        const filename = cleanFilename(match[1]);
        const driver = extractDriver(line);
        const key = `missing:${filename}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push({ filename, driver, status: 'missing' });
        }
        matched = true;
        break;
      }
    }

    if (matched) continue;

    // Try loaded pattern
    LOADED_PATTERN.lastIndex = 0;
    const loadedMatch = LOADED_PATTERN.exec(line);
    if (loadedMatch) {
      const filename = cleanFilename(loadedMatch[1]);
      const driver = extractDriver(line);
      const key = `loaded:${filename}`;
      if (!seen.has(key)) {
        seen.add(key);
        events.push({ filename, driver, status: 'loaded' });
      }
    }
  }

  return events;
}

/**
 * Extract only missing firmware file paths from dmesg output.
 * Deduplicated and sorted.
 * @param {string} output - Raw dmesg output
 * @returns {string[]} Deduplicated missing firmware file paths
 */
function extractMissingFirmwarePaths(output) {
  const events = parseDmesgFirmware(output);
  const missing = events
    .filter(e => e.status === 'missing')
    .map(e => e.filename);
  return [...new Set(missing)].sort();
}

/**
 * Clean up a firmware filename from dmesg.
 * Strips /lib/firmware/ prefix if present, removes trailing punctuation.
 * @param {string} raw
 * @returns {string}
 */
function cleanFilename(raw) {
  let name = raw;
  // Strip /lib/firmware/ prefix
  if (name.startsWith('/lib/firmware/')) {
    name = name.slice('/lib/firmware/'.length);
  }
  // Remove trailing punctuation that dmesg sometimes appends
  name = name.replace(/[,;:)]+$/, '');
  return name;
}

/**
 * Try to extract the kernel driver name from a dmesg line.
 * @param {string} line
 * @returns {string|null}
 */
function extractDriver(line) {
  const match = DRIVER_PATTERN.exec(line);
  return match ? match[1] : null;
}

module.exports = {
  parseDmesgFirmware,
  extractMissingFirmwarePaths,
};
