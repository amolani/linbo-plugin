/**
 * LINBO Docker - Kernel Service
 * Manages kernel variant switching (stable, longterm, legacy)
 */

const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// =============================================================================
// Constants
// =============================================================================

const KERNEL_VAR_DIR = process.env.KERNEL_VAR_DIR || '/var/lib/linuxmuster/linbo/current';
const CONFIG_DIR = process.env.CONFIG_DIR || process.env.LINBO_CONFIG_DIR || '/etc/linuxmuster/linbo';
const LINBO_DIR = process.env.LINBO_DIR || process.env.LINBO_DATA_DIR || '/srv/linbo';

const VALID_VARIANTS = ['stable', 'longterm', 'legacy'];
const CUSTOM_KERNEL_FILE = path.join(CONFIG_DIR, 'custom_kernel');
const KERNEL_STATE_FILE = path.join(CONFIG_DIR, 'kernel_state.json');
const REBUILD_LOCK = path.join(CONFIG_DIR, '.rebuild.lock');
const PROVISION_LOCK = path.join(KERNEL_VAR_DIR, '..', '.provision.lock');

const DEFAULT_STATE = {
  lastSwitchAt: null,
  lastError: null,
  lastRequestedVariant: null,
  lastSuccessfulVariant: null,
  lastJobId: null,
  rebuildStatus: 'completed',
};

// =============================================================================
// State Persistence (crash-safe JSON writes)
// =============================================================================

// Track whether a rebuild is in-progress in THIS process (prevents false restart detection)
let _rebuildActiveInProcess = false;

async function readKernelState() {
  try {
    const raw = await fs.readFile(KERNEL_STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    // After container restart: if rebuild was "running" but NOT started by this process,
    // it means the previous process was interrupted
    if (state.rebuildStatus === 'running' && !_rebuildActiveInProcess) {
      state.rebuildStatus = 'failed';
      state.lastError = 'Rebuild interrupted (container restart)';
      await writeKernelState(state);
    }
    return { ...DEFAULT_STATE, ...state };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ...DEFAULT_STATE };
    }
    throw err;
  }
}

async function writeKernelState(updates) {
  let state;
  try {
    const raw = await fs.readFile(KERNEL_STATE_FILE, 'utf-8');
    state = { ...DEFAULT_STATE, ...JSON.parse(raw), ...updates };
  } catch {
    state = { ...DEFAULT_STATE, ...updates };
  }
  const tmp = KERNEL_STATE_FILE + '.tmp.' + process.pid;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, KERNEL_STATE_FILE);
  return state;
}

// =============================================================================
// Custom Kernel Config (tolerant read, strict write)
// =============================================================================

async function readCustomKernelConfig() {
  try {
    const raw = await fs.readFile(CUSTOM_KERNEL_FILE, 'utf-8');
    const lines = raw.split('\n').filter(l => !l.trim().startsWith('#') && l.trim().length > 0);
    const kernelPathLines = lines.filter(l => l.match(/^\s*KERNELPATH=/));
    if (kernelPathLines.length === 0) {
      return { variant: 'stable', raw, valid: true, warning: null };
    }
    // Take last KERNELPATH= line
    const lastLine = kernelPathLines[kernelPathLines.length - 1];
    const value = lastLine.replace(/.*=/, '').replace(/[" ]/g, '').trim();
    if (VALID_VARIANTS.includes(value)) {
      return { variant: value, raw, valid: true, warning: null };
    }
    if (value === '') {
      return { variant: 'stable', raw, valid: true, warning: null };
    }
    return {
      variant: value,
      raw,
      valid: false,
      warning: `Unknown KERNELPATH: '${value}'. Valid values: ${VALID_VARIANTS.join(', ')}`,
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { variant: 'stable', raw: '', valid: true, warning: null };
    }
    throw err;
  }
}

async function writeCustomKernelConfig(variant) {
  if (!VALID_VARIANTS.includes(variant)) {
    throw new Error(`Invalid variant: ${variant}. Must be one of: ${VALID_VARIANTS.join(', ')}`);
  }
  const content = `# LINBO kernel variant - managed by linbo-docker\n# Do not edit manually. Use API: POST /system/kernel-switch\nKERNELPATH="${variant}"\n`;
  const tmp = CUSTOM_KERNEL_FILE + '.tmp.' + process.pid;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, CUSTOM_KERNEL_FILE);
}

// =============================================================================
// Kernel Variant Discovery
// =============================================================================

async function listKernelVariants() {
  const config = await readCustomKernelConfig();
  const activeVariant = config.valid ? config.variant : 'stable';
  const variants = [];

  for (const name of VALID_VARIANTS) {
    const varDir = path.join(KERNEL_VAR_DIR, name);
    const entry = {
      name,
      version: 'unknown',
      kernelSize: 0,
      modulesSize: 0,
      isActive: name === activeVariant,
      available: false,
    };

    try {
      await fs.access(varDir);
      const requiredFiles = ['linbo64', 'modules.tar.xz', 'version'];
      let allPresent = true;

      for (const f of requiredFiles) {
        try {
          const st = await fs.stat(path.join(varDir, f));
          if (f === 'linbo64') entry.kernelSize = st.size;
          if (f === 'modules.tar.xz') entry.modulesSize = st.size;
          if (f === 'version') {
            entry.version = (await fs.readFile(path.join(varDir, f), 'utf-8')).trim();
          }
        } catch {
          allPresent = false;
        }
      }

      entry.available = allPresent;
    } catch {
      // Directory doesn't exist
    }

    variants.push(entry);
  }

  return variants;
}

async function getActiveKernel() {
  const config = await readCustomKernelConfig();
  const variant = config.valid ? config.variant : 'stable';
  let version = 'unknown';

  try {
    const versionFile = path.join(KERNEL_VAR_DIR, variant, 'version');
    version = (await fs.readFile(versionFile, 'utf-8')).trim();
  } catch {
    // Version file not found
  }

  return {
    variant,
    version,
    configValid: config.valid,
    configWarning: config.warning,
  };
}

// =============================================================================
// Linbo64 Info
// =============================================================================

async function getLinbo64Info() {
  const linbo64Path = path.join(LINBO_DIR, 'linbo64');
  try {
    const stat = await fs.stat(linbo64Path);
    let md5 = null;
    try {
      md5 = (await fs.readFile(linbo64Path + '.md5', 'utf-8')).trim();
    } catch { /* no md5 file */ }
    return {
      size: stat.size,
      md5,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { size: 0, md5: null, modifiedAt: null };
  }
}

// =============================================================================
// Rebuild Status
// =============================================================================

async function isRebuildRunning() {
  try {
    const state = await readKernelState();
    return state.rebuildStatus === 'running';
  } catch {
    return false;
  }
}

async function hasTemplate() {
  try {
    await fs.access(path.join(KERNEL_VAR_DIR, 'linbofs64.xz'));
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Kernel Switch
// =============================================================================

async function switchKernel(variant) {
  if (!VALID_VARIANTS.includes(variant)) {
    throw Object.assign(new Error(`Invalid variant: ${variant}`), { statusCode: 400 });
  }

  // Check if rebuild already running
  const state = await readKernelState();
  if (state.rebuildStatus === 'running') {
    throw Object.assign(new Error('Kernel rebuild already in progress'), { statusCode: 409 });
  }

  // Check variant availability
  const variants = await listKernelVariants();
  const target = variants.find(v => v.name === variant);
  if (target && !target.available) {
    const varDir = path.join(KERNEL_VAR_DIR, variant);
    const missing = [];
    for (const f of ['linbo64', 'modules.tar.xz', 'version']) {
      try {
        await fs.access(path.join(varDir, f));
      } catch {
        missing.push(f);
      }
    }
    throw Object.assign(
      new Error(`Variant '${variant}' incomplete: missing ${missing.join(', ')}`),
      { statusCode: 400 }
    );
  }

  const jobId = `ks-${Date.now()}`;
  const startedAt = new Date().toISOString();

  // Write config + state
  await writeCustomKernelConfig(variant);
  _rebuildActiveInProcess = true;
  await writeKernelState({
    rebuildStatus: 'running',
    lastRequestedVariant: variant,
    lastJobId: jobId,
    lastSwitchAt: startedAt,
    lastError: null,
  });

  // Trigger rebuild asynchronously
  triggerRebuild(variant, jobId).catch(() => {
    // Error handling is in triggerRebuild
  });

  return { jobId, startedAt, requestedVariant: variant };
}

async function triggerRebuild(variant, jobId) {
  const scriptPath = process.env.UPDATE_LINBOFS_SCRIPT ||
    '/usr/share/linuxmuster/linbo/update-linbofs.sh';

  try {
    const env = {
      ...process.env,
      LINBO_DIR,
      CONFIG_DIR,
      KERNEL_VAR_DIR,
    };

    const { stdout, stderr } = await execFileAsync('bash', [scriptPath], {
      env,
      timeout: 300000, // 5 minutes
    });

    _rebuildActiveInProcess = false;
    await writeKernelState({
      rebuildStatus: 'completed',
      lastSuccessfulVariant: variant,
      lastError: null,
    });

    return { success: true, output: stdout + stderr };
  } catch (err) {
    _rebuildActiveInProcess = false;
    const errorMsg = err.message || 'Unknown error during rebuild';
    await writeKernelState({
      rebuildStatus: 'failed',
      lastError: errorMsg,
    });
    throw err;
  }
}

// =============================================================================
// Combined Status
// =============================================================================

async function getKernelStatus() {
  const [variants, active, linbo64Info, state, templateExists] = await Promise.all([
    listKernelVariants(),
    getActiveKernel(),
    getLinbo64Info(),
    readKernelState(),
    hasTemplate(),
  ]);

  return {
    variants,
    activeVariant: active.variant,
    activeVersion: active.version,
    configValid: active.configValid,
    configWarning: active.configWarning,
    hasTemplate: templateExists,
    rebuildRunning: state.rebuildStatus === 'running',
    lastSwitchAt: state.lastSwitchAt,
    lastError: state.lastError,
    currentLinbo64: linbo64Info,
  };
}

// =============================================================================
// Repair
// =============================================================================

async function repairConfig() {
  await writeCustomKernelConfig('stable');
  await writeKernelState({
    lastError: null,
  });
  return { variant: 'stable' };
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Constants (for testing)
  VALID_VARIANTS,
  KERNEL_VAR_DIR,
  CONFIG_DIR,
  CUSTOM_KERNEL_FILE,
  KERNEL_STATE_FILE,
  REBUILD_LOCK,
  // For testing: set/reset in-process rebuild flag
  _setRebuildActive(val) { _rebuildActiveInProcess = val; },
  // Functions
  listKernelVariants,
  getActiveKernel,
  switchKernel,
  getKernelStatus,
  readCustomKernelConfig,
  writeCustomKernelConfig,
  getLinbo64Info,
  isRebuildRunning,
  hasTemplate,
  readKernelState,
  writeKernelState,
  repairConfig,
  triggerRebuild,
};
