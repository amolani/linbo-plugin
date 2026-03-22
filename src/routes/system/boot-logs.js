/**
 * LINBO Plugin - Boot Log Routes
 * Read/delete client boot logs from /var/log/linuxmuster/linbo/
 *
 * Endpoints:
 *   GET    /boot-logs              — List all log files
 *   GET    /boot-logs/:filename    — Read log content
 *   DELETE /boot-logs/:filename    — Delete log file
 */

'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { authenticateToken, requireRole } = require('../../middleware/auth');

const LOG_DIR = process.env.LINBO_LOG_DIR || '/var/log/linuxmuster/linbo';
const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB read limit

function validateFilename(name) {
  if (!name || !SAFE_FILENAME_RE.test(name)) {
    throw Object.assign(new Error('Invalid log filename'), { statusCode: 400 });
  }
  // Extra traversal check
  const resolved = path.resolve(LOG_DIR, name);
  if (!resolved.startsWith(path.resolve(LOG_DIR) + path.sep)) {
    throw Object.assign(new Error('Path traversal detected'), { statusCode: 400 });
  }
  return resolved;
}

/**
 * @openapi
 * /system/boot-logs:
 *   get:
 *     tags: [Infrastructure]
 *     summary: List all LINBO boot log files
 *     responses:
 *       200: { description: Array of log file metadata }
 */
router.get('/boot-logs', authenticateToken, async (req, res, next) => {
  try {
    let entries;
    try {
      entries = await fs.readdir(LOG_DIR, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return res.json({ data: [] });
      throw err;
    }

    const logs = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(path.join(LOG_DIR, entry.name));
        logs.push({
          filename: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch { continue; }
    }

    // Sort by modified date (newest first)
    logs.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    res.json({ data: logs });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/boot-logs/{filename}:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Read a boot log file
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: lines
 *         schema: { type: integer, default: 200 }
 *         description: Number of lines to return (from end)
 *       - in: query
 *         name: tail
 *         schema: { type: string, enum: ["true", "false"], default: "true" }
 *         description: Return last N lines (true) or first N lines (false)
 *     responses:
 *       200: { description: Log content }
 *       404: { description: Log file not found }
 */
router.get('/boot-logs/:filename', authenticateToken, async (req, res, next) => {
  try {
    const filePath = validateFilename(req.params.filename);
    const maxLines = Math.min(parseInt(req.query.lines, 10) || 200, 5000);
    const fromTail = req.query.tail !== 'false';

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Log file not found' } });
    }

    if (stat.size > MAX_LOG_SIZE) {
      return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Log file exceeds 5MB read limit' } });
    }

    const content = await fs.readFile(filePath, 'utf8');
    const allLines = content.split('\n');

    const lines = fromTail
      ? allLines.slice(-maxLines)
      : allLines.slice(0, maxLines);

    res.json({
      data: {
        filename: req.params.filename,
        totalLines: allLines.length,
        returnedLines: lines.length,
        truncated: allLines.length > maxLines,
        content: lines.join('\n'),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      },
    });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/boot-logs/{filename}:
 *   delete:
 *     tags: [Infrastructure]
 *     summary: Delete a boot log file
 *     responses:
 *       200: { description: Log file deleted }
 *       404: { description: Log file not found }
 */
router.delete('/boot-logs/:filename', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  try {
    const filePath = validateFilename(req.params.filename);

    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Log file not found' } });
      }
      throw err;
    }

    res.json({ data: { message: `Log file ${req.params.filename} deleted` } });
  } catch (error) { next(error); }
});

module.exports = router;
