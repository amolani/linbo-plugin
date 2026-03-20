'use strict';

/**
 * Tests for devices-csv-reader — parses /etc/linuxmuster/sophomorix/default-school/devices.csv
 */
const path = require('path');
const fsp = require('fs/promises');
const os = require('os');

const { readHostsFromDevicesCsv } = require('../../../src/lib/devices-csv-reader');

describe('readHostsFromDevicesCsv', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'csv-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('should return [] for ENOENT (file does not exist)', async () => {
    const result = await readHostsFromDevicesCsv('/nonexistent/path/devices.csv');
    expect(result).toEqual([]);
  });

  it('should return [] for an empty file', async () => {
    const csvPath = path.join(tmpDir, 'devices.csv');
    await fsp.writeFile(csvPath, '');
    const result = await readHostsFromDevicesCsv(csvPath);
    expect(result).toEqual([]);
  });

  it('should skip comment lines starting with #', async () => {
    const csvPath = path.join(tmpDir, 'devices.csv');
    await fsp.writeFile(csvPath, '# This is a comment\n# Another comment\n');
    const result = await readHostsFromDevicesCsv(csvPath);
    expect(result).toEqual([]);
  });

  it('should parse a valid line into { room, hostname, hostgroup, mac, ip }', async () => {
    const csvPath = path.join(tmpDir, 'devices.csv');
    await fsp.writeFile(csvPath, 'raum1;pc01;win11;aa:bb:cc:dd:ee:ff;10.0.1.1;extra\n');
    const result = await readHostsFromDevicesCsv(csvPath);
    expect(result).toEqual([
      { room: 'raum1', hostname: 'pc01', hostgroup: 'win11', mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.1.1' },
    ]);
  });

  it('should always lowercase mac addresses', async () => {
    const csvPath = path.join(tmpDir, 'devices.csv');
    await fsp.writeFile(csvPath, 'raum1;pc01;win11;AA:BB:CC:DD:EE:FF;10.0.1.1\n');
    const result = await readHostsFromDevicesCsv(csvPath);
    expect(result[0].mac).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('should filter out rows missing mac', async () => {
    const csvPath = path.join(tmpDir, 'devices.csv');
    await fsp.writeFile(csvPath, 'raum1;pc01;win11;;10.0.1.1\n');
    const result = await readHostsFromDevicesCsv(csvPath);
    expect(result).toEqual([]);
  });

  it('should filter out rows missing hostname', async () => {
    const csvPath = path.join(tmpDir, 'devices.csv');
    await fsp.writeFile(csvPath, 'raum1;;win11;aa:bb:cc:dd:ee:ff;10.0.1.1\n');
    const result = await readHostsFromDevicesCsv(csvPath);
    expect(result).toEqual([]);
  });

  it('should handle multiple valid rows', async () => {
    const csvPath = path.join(tmpDir, 'devices.csv');
    await fsp.writeFile(csvPath, [
      '# comment line',
      'raum1;pc01;win11;aa:bb:cc:dd:ee:01;10.0.1.1',
      'raum2;pc02;ubuntu;aa:bb:cc:dd:ee:02;10.0.1.2;extra;fields',
      '',
      'raum3;pc03;win10;aa:bb:cc:dd:ee:03;10.0.1.3',
    ].join('\n'));
    const result = await readHostsFromDevicesCsv(csvPath);
    expect(result).toHaveLength(3);
    expect(result[0].hostname).toBe('pc01');
    expect(result[1].hostname).toBe('pc02');
    expect(result[2].hostname).toBe('pc03');
  });

  it('should trim whitespace from fields', async () => {
    const csvPath = path.join(tmpDir, 'devices.csv');
    await fsp.writeFile(csvPath, ' raum1 ; pc01 ; win11 ; AA:BB:CC:DD:EE:FF ; 10.0.1.1 \n');
    const result = await readHostsFromDevicesCsv(csvPath);
    expect(result[0]).toEqual({
      room: 'raum1',
      hostname: 'pc01',
      hostgroup: 'win11',
      mac: 'aa:bb:cc:dd:ee:ff',
      ip: '10.0.1.1',
    });
  });

  it('should re-throw non-ENOENT errors', async () => {
    // A directory path will cause EISDIR when trying to readFile
    await expect(readHostsFromDevicesCsv(tmpDir)).rejects.toThrow();
  });
});
