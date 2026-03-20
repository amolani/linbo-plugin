/**
 * LINBO Plugin - Command Parsing Utilities
 * Pure functions for parsing and validating LINBO command strings.
 * Command parsing and validation utilities (no DB dependency).
 */

const path = require('path');
const fs = require('fs').promises;

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const LINBOCMD_DIR = path.join(LINBO_DIR, 'linbocmd');

// Bekannte LINBO-Befehle
const KNOWN_COMMANDS = [
  'label', 'partition', 'format', 'initcache', 'new', 'sync',
  'postsync', 'start', 'prestart', 'create_image', 'create_qdiff',
  'upload_image', 'upload_qdiff', 'reboot', 'halt', 'poweroff',
];

// Commands that terminate the SSH connection (no exit code expected)
const FIRE_AND_FORGET = ['reboot', 'halt', 'poweroff'];

const DOWNLOAD_TYPES = ['multicast', 'rsync', 'torrent'];
const SPECIAL_FLAGS = ['noauto', 'disablegui'];

/**
 * Parse a command string into individual commands.
 * @param {string} commandString - e.g. "sync:1,start:1"
 * @returns {Array<{command: string, params: Array}>}
 */
function parseCommands(commandString) {
  if (!commandString || typeof commandString !== 'string') {
    throw new Error('Invalid command string');
  }

  const commands = [];
  let remaining = commandString.trim();

  while (remaining.length > 0) {
    const colonIdx = remaining.indexOf(':');
    const commaIdx = remaining.indexOf(',');

    let cmdEnd;
    if (colonIdx === -1 && commaIdx === -1) cmdEnd = remaining.length;
    else if (colonIdx === -1) cmdEnd = commaIdx;
    else if (commaIdx === -1) cmdEnd = colonIdx;
    else cmdEnd = Math.min(colonIdx, commaIdx);

    const cmd = remaining.substring(0, cmdEnd).toLowerCase();
    remaining = remaining.substring(cmdEnd);

    if (!KNOWN_COMMANDS.includes(cmd) && !SPECIAL_FLAGS.includes(cmd)) {
      throw new Error(`Unknown command: ${cmd}`);
    }

    const parsedCmd = { command: cmd, params: [] };

    if (remaining.startsWith(':')) {
      remaining = remaining.substring(1);

      let paramEnd = remaining.indexOf(',');
      if (paramEnd === -1) paramEnd = remaining.length;

      for (const knownCmd of [...KNOWN_COMMANDS, ...SPECIAL_FLAGS]) {
        const cmdIdx = remaining.indexOf(knownCmd);
        if (cmdIdx !== -1 && cmdIdx < paramEnd) {
          const commaBeforeCmd = remaining.lastIndexOf(',', cmdIdx);
          if (commaBeforeCmd !== -1) paramEnd = commaBeforeCmd;
        }
      }

      const param = remaining.substring(0, paramEnd);
      remaining = remaining.substring(paramEnd);

      switch (cmd) {
        case 'format':
          if (param) {
            const nr = parseInt(param, 10);
            if (isNaN(nr) || nr < 1) throw new Error(`Invalid partition number for format: ${param}`);
            parsedCmd.params.push(nr);
          }
          break;
        case 'new': case 'sync': case 'postsync': case 'start': case 'prestart':
        case 'upload_image': case 'upload_qdiff': {
          const osNr = parseInt(param, 10);
          if (isNaN(osNr) || osNr < 1) throw new Error(`Invalid OS number for ${cmd}: ${param}`);
          parsedCmd.params.push(osNr);
          break;
        }
        case 'initcache':
          if (param && !DOWNLOAD_TYPES.includes(param.toLowerCase())) {
            throw new Error(`Invalid download type for initcache: ${param}`);
          }
          if (param) parsedCmd.params.push(param.toLowerCase());
          break;
        case 'create_image': case 'create_qdiff': {
          const parts = param.split(':');
          const imageOsNr = parseInt(parts[0], 10);
          if (isNaN(imageOsNr) || imageOsNr < 1) throw new Error(`Invalid OS number for ${cmd}: ${parts[0]}`);
          parsedCmd.params.push(imageOsNr);
          if (parts[1]) parsedCmd.params.push(parts[1].replace(/^["']|["']$/g, ''));
          break;
        }
      }
    }

    commands.push(parsedCmd);
    if (remaining.startsWith(',')) remaining = remaining.substring(1);
  }

  return commands;
}

function validateCommandString(commandString) {
  try {
    const commands = parseCommands(commandString);
    return { valid: true, commands };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function formatCommandsForWrapper(commands) {
  return commands
    .map(cmd => {
      if (cmd.params.length === 0) return cmd.command;
      if ((cmd.command === 'create_image' || cmd.command === 'create_qdiff') && cmd.params.length > 1) {
        return `${cmd.command}:${cmd.params[0]}:\\"${cmd.params[1]}\\"`;
      }
      return `${cmd.command}:${cmd.params.join(':')}`;
    })
    .join(',');
}

function getOnbootCmdPath(hostname) {
  return path.join(LINBOCMD_DIR, `${hostname}.cmd`);
}

async function listScheduledCommands() {
  try {
    await fs.mkdir(LINBOCMD_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  const files = await fs.readdir(LINBOCMD_DIR);
  const cmdFiles = files.filter(f => f.endsWith('.cmd'));
  const scheduled = [];

  for (const file of cmdFiles) {
    const hostname = file.replace('.cmd', '');
    const filePath = path.join(LINBOCMD_DIR, file);
    try {
      const [content, stats] = await Promise.all([
        fs.readFile(filePath, 'utf8'),
        fs.stat(filePath),
      ]);
      scheduled.push({
        hostname,
        commands: content.trim(),
        createdAt: stats.mtime,
        filepath: filePath,
      });
    } catch {
      continue;
    }
  }

  return scheduled;
}

/**
 * Map command name to the actual shell command for linbo_wrapper.
 * 'halt' → 'poweroff' (clean ACPI shutdown instead of CPU halt)
 */
function mapCommand(cmd) {
  if (cmd === 'halt') return 'poweroff';
  return cmd;
}

module.exports = {
  parseCommands,
  validateCommandString,
  formatCommandsForWrapper,
  getOnbootCmdPath,
  listScheduledCommands,
  mapCommand,
  KNOWN_COMMANDS,
  DOWNLOAD_TYPES,
  SPECIAL_FLAGS,
  FIRE_AND_FORGET,
};
