/**
 * LINBO Docker - start.conf Server Field Rewriter
 * Rewrites Server= and server= only within the [LINBO] section block.
 */

/**
 * Rewrite the Server field and server= in KernelOptions within the [LINBO] section only.
 * Does NOT touch [Partition], [OS], or other sections.
 *
 * @param {string} content - Raw start.conf file content
 * @param {string} newServerIp - New server IP to substitute (e.g., '10.0.0.13')
 * @returns {string} Rewritten content
 */
function rewriteServerField(content, newServerIp) {
  if (!content || !newServerIp) return content;

  const lines = content.split('\n');
  let inLinboSection = false;

  const result = lines.map(line => {
    // Track which section we're in
    if (/^\s*\[LINBO\]/i.test(line)) {
      inLinboSection = true;
    } else if (/^\s*\[/.test(line)) {
      inLinboSection = false;
    }

    if (!inLinboSection) return line;

    // Server = X.X.X.X (direct field in [LINBO] block)
    if (/^\s*Server\s*=/i.test(line)) {
      return line.replace(/^(\s*Server\s*=\s*)\S+/i, `$1${newServerIp}`);
    }

    // KernelOptions = ... server=X.X.X.X ... (embedded in kernel options)
    if (/^\s*KernelOptions\s*=/i.test(line) && /server=\S+/.test(line)) {
      return line.replace(/server=\S+/g, `server=${newServerIp}`);
    }

    return line;
  });

  return result.join('\n');
}

module.exports = { rewriteServerField };
