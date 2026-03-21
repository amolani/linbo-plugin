/**
 * LINBO Plugin - Structured Logger (pino)
 *
 * Central logger instance. Use instead of console.log/warn/error.
 * In production: JSON output. In development: pretty-printed.
 *
 * Usage:
 *   const log = require('./lib/logger');
 *   log.info('Server started');
 *   log.info({ port: 3000 }, 'Server started');
 *   log.error({ err }, 'Failed to connect');
 */

'use strict';

const pino = require('pino');

const isDev = (process.env.NODE_ENV || 'development') !== 'production';
const isTest = process.env.NODE_ENV === 'test';

const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : isDev ? 'debug' : 'info'),
  ...(isDev && !isTest
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

module.exports = logger;
