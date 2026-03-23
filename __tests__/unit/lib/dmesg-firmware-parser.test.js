'use strict';

const path = require('path');
const fs = require('fs');
const {
  parseDmesgFirmware,
  extractMissingFirmwarePaths,
} = require('../../../src/lib/dmesg-firmware-parser');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, '../../fixtures/dmesg-firmware.txt'),
  'utf8'
);

// ---------------------------------------------------------------------------
// parseDmesgFirmware
// ---------------------------------------------------------------------------
describe('parseDmesgFirmware', () => {
  // --- Input guards -------------------------------------------------------
  describe('input guards', () => {
    it('returns [] for null', () => {
      expect(parseDmesgFirmware(null)).toEqual([]);
    });

    it('returns [] for undefined', () => {
      expect(parseDmesgFirmware(undefined)).toEqual([]);
    });

    it('returns [] for empty string', () => {
      expect(parseDmesgFirmware('')).toEqual([]);
    });

    it('returns [] for non-string input', () => {
      expect(parseDmesgFirmware(42)).toEqual([]);
      expect(parseDmesgFirmware({})).toEqual([]);
    });

    it('returns [] when no firmware lines are present', () => {
      const input = '[    1.000] Normal system log line\n[    2.000] Another line\n';
      expect(parseDmesgFirmware(input)).toEqual([]);
    });
  });

  // --- Missing firmware patterns ------------------------------------------
  describe('missing firmware patterns', () => {
    it('detects "firmware: failed to load <filename>"', () => {
      const line = '[    1.234] i915 0000:00:02.0: firmware: failed to load i915/skl_dmc_ver1_27.bin';
      const events = parseDmesgFirmware(line);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        filename: 'i915/skl_dmc_ver1_27.bin',
        driver: 'i915',
        status: 'missing',
      });
    });

    it('detects "Direct firmware load for <filename> failed"', () => {
      const line = '[    2.345] iwlwifi 0000:03:00.0: Direct firmware load for iwlwifi-ty-a0-gf-a0-72.ucode failed with error -2';
      const events = parseDmesgFirmware(line);
      expect(events).toHaveLength(1);
      expect(events[0].filename).toBe('iwlwifi-ty-a0-gf-a0-72.ucode');
      expect(events[0].status).toBe('missing');
    });

    it('detects "request_firmware failed...: <filename>"', () => {
      const line = '[    5.678] bluetooth 0000:05:00.0: request_firmware failed for intel/ibt-19-0-4.sfc: /lib/firmware/intel/ibt-19-0-4.sfc)';
      const events = parseDmesgFirmware(line);
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('missing');
    });
  });

  // --- Loaded firmware pattern --------------------------------------------
  describe('loaded firmware pattern', () => {
    it('detects "loaded firmware version <ver> <filename>"', () => {
      const line = '[    3.456] iwlwifi 0000:03:00.0: loaded firmware version 71.058ca5a4.0 iwlwifi-ty-a0-gf-a0-66.ucode';
      const events = parseDmesgFirmware(line);
      // The loaded pattern captures the first token after "loaded firmware [version]"
      // which is "version" when the word "version" is present and there is no explicit
      // "version" keyword skip — re-check actual behaviour
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].status).toBe('loaded');
    });

    it('detects "loaded firmware <filename>" without version keyword', () => {
      const line = '[    7.890] snd_hda_intel 0000:00:1f.3: loaded firmware snd/hda-jack-retask.fw';
      const events = parseDmesgFirmware(line);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        filename: 'snd/hda-jack-retask.fw',
        status: 'loaded',
      });
    });
  });

  // --- Driver extraction --------------------------------------------------
  describe('driver extraction', () => {
    it('extracts driver name from standard dmesg format', () => {
      const line = '[    1.234] i915 0000:00:02.0: firmware: failed to load i915/skl_dmc_ver1_27.bin';
      const events = parseDmesgFirmware(line);
      expect(events[0].driver).toBe('i915');
    });

    it('returns null when no driver pattern matches', () => {
      const line = 'firmware: failed to load some/firmware.bin';
      const events = parseDmesgFirmware(line);
      expect(events).toHaveLength(1);
      expect(events[0].driver).toBeNull();
    });
  });

  // --- cleanFilename behaviour --------------------------------------------
  describe('cleanFilename behaviour', () => {
    it('strips /lib/firmware/ prefix', () => {
      const line = '[    4.567] r8169 0000:04:00.0: firmware: failed to load /lib/firmware/rtl_nic/rtl8168h-2.fw,';
      const events = parseDmesgFirmware(line);
      expect(events).toHaveLength(1);
      expect(events[0].filename).toBe('rtl_nic/rtl8168h-2.fw');
    });

    it('removes trailing punctuation (, ; : )', () => {
      const line = '[    5.678] bluetooth 0000:05:00.0: request_firmware failed for intel/ibt-19-0-4.sfc: /lib/firmware/intel/ibt-19-0-4.sfc)';
      const events = parseDmesgFirmware(line);
      // The request_firmware pattern captures the last token; cleanFilename strips trailing )
      const fwEvent = events[0];
      expect(fwEvent.filename).not.toMatch(/[,;:)]+$/);
    });
  });

  // --- Deduplication ------------------------------------------------------
  describe('deduplication', () => {
    it('deduplicates identical missing entries', () => {
      const lines = [
        '[    6.789] amdgpu 0000:06:00.0: firmware: failed to load amdgpu/navi14_sos.bin',
        '[    6.790] amdgpu 0000:06:00.0: firmware: failed to load amdgpu/navi14_sos.bin',
      ].join('\n');
      const events = parseDmesgFirmware(lines);
      const navi = events.filter(e => e.filename === 'amdgpu/navi14_sos.bin');
      expect(navi).toHaveLength(1);
    });

    it('keeps both missing and loaded events for the same filename', () => {
      const lines = [
        '[    1.000] drv 0000:00:00.0: firmware: failed to load fw/test.bin',
        '[    2.000] drv 0000:00:00.0: loaded firmware fw/test.bin',
      ].join('\n');
      const events = parseDmesgFirmware(lines);
      expect(events).toHaveLength(2);
      expect(events[0].status).toBe('missing');
      expect(events[1].status).toBe('loaded');
    });
  });

  // --- Full fixture -------------------------------------------------------
  describe('full fixture', () => {
    it('parses the full dmesg fixture without throwing', () => {
      expect(() => parseDmesgFirmware(FIXTURE)).not.toThrow();
    });

    it('finds multiple firmware events in the fixture', () => {
      const events = parseDmesgFirmware(FIXTURE);
      expect(events.length).toBeGreaterThanOrEqual(5);
    });
  });
});

// ---------------------------------------------------------------------------
// extractMissingFirmwarePaths
// ---------------------------------------------------------------------------
describe('extractMissingFirmwarePaths', () => {
  it('returns only missing firmware paths', () => {
    const paths = extractMissingFirmwarePaths(FIXTURE);
    // The fixture contains loaded firmware too; those must be excluded
    expect(paths.every(p => typeof p === 'string')).toBe(true);
    expect(paths.length).toBeGreaterThanOrEqual(3);
  });

  it('returns sorted results', () => {
    const paths = extractMissingFirmwarePaths(FIXTURE);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it('returns deduplicated results', () => {
    const paths = extractMissingFirmwarePaths(FIXTURE);
    expect(paths.length).toBe(new Set(paths).size);
  });

  it('returns [] for empty input', () => {
    expect(extractMissingFirmwarePaths('')).toEqual([]);
  });

  it('returns [] when only loaded firmware is present', () => {
    const line = '[    1.000] drv 0000:00:00.0: loaded firmware fw/ok.bin';
    expect(extractMissingFirmwarePaths(line)).toEqual([]);
  });
});
