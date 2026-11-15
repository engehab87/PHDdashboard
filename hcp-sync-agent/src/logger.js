'use strict';
/* Minimal structured logger. Supports text and JSON output with level filtering. */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const config = require('./config');

function isJson() {
  return config.log.format === 'json';
}

function log(level, message, meta = {}) {
  if (LEVELS[level] > LEVELS[config.log.level]) return;
  const ts = new Date().toISOString();
  const base = { level, message, ts, ...meta };
  if (isJson()) {
    console.log(JSON.stringify(base));
  } else {
    const pad = (s) => String(s).toUpperCase().padEnd(5);
    const extra = Object.entries(meta).length
      ? ' ' + Object.entries(meta)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(' ')
      : '';
    console.log(`${ts} [${pad(level)}] ${message}${extra}`);
  }
}

module.exports = {
  error: (m, meta) => log('error', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  info: (m, meta) => log('info', m, meta),
  debug: (m, meta) => log('debug', m, meta),
};
