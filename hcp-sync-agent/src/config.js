'use strict';
/* Configuration loader with validation. Reads .env via dotenv, validates required
   values, and exports a frozen config object. */

require('dotenv').config();

const required = ['HCP_HOST', 'HCP_APP_KEY', 'HCP_APP_SECRET', 'DATABASE_URL'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[config] Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

function envBool(k, def) {
  const v = process.env[k];
  if (v === undefined || v === null) return def;
  return String(v).toLowerCase() === 'true';
}

function envInt(k, def) {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : def;
}

function envList(k, def) {
  const v = process.env[k];
  if (!v) return def;
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

const config = {
  hcp: {
    host: process.env.HCP_HOST,
    port: envInt('HCP_PORT', 443),
    https: envBool('HCP_HTTPS', true),
    tlsVerify: envBool('HCP_TLS_VERIFY', true),
    tlsCa: process.env.HCP_TLS_CA || undefined,
    readTimeoutMs: envInt('HCP_READ_TIMEOUT_MS', 15000),
    appKey: process.env.HCP_APP_KEY,
    appSecret: process.env.HCP_APP_SECRET,
    cameraIndexCode: process.env.HCP_CAMERA_INDEX_CODE || undefined,
    syncLookbackDays: envInt('HCP_SYNC_LOOKBACK_DAYS', 30),
  },
  db: {
    connectionString: process.env.DATABASE_URL,
  },
  agent: {
    syncIntervalMs: envInt('SYNC_INTERVAL_MS', 300000),
    enabledCategories: envList('SYNC_ENABLED_CATEGORIES', [
      'persons', 'vehicles', 'access-events', 'visitors',
    ]),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'text',
  },
};

Object.freeze(config);
module.exports = config;
