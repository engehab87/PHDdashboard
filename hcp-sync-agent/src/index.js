#!/usr/bin/env node
'use strict';
/* HCP Sync Agent — entry point.
   Pulls records from Hikvision HikCentral Professional (OpenAPI/Artemis v2.6)
   and upserts them into a cloud PostgreSQL database.

   Usage:
     node src/index.js              # continuous scheduler
     node src/index.js --once       # single sync run then exit
     node src/index.js --help       # show help
*/

const config = require('./config');
const { startScheduler } = require('./sync');
const log = require('./logger');

function showHelp() {
  console.log(`
HCP Sync Agent v1.0.0
Usage: node src/index.js [options]

Options:
  --once        Run a single sync and exit (default: continuous scheduler)
  --help        Show this help

Environment variables (copy .env.example to .env):
  HCP_HOST, HCP_PORT, HCP_HTTPS, HCP_TLS_VERIFY, HCP_TLS_CA, HCP_READ_TIMEOUT_MS
  HCP_APP_KEY, HCP_APP_SECRET, HCP_CAMERA_INDEX_CODE, HCP_SYNC_LOOKBACK_DAYS
  DATABASE_URL
  SYNC_INTERVAL_MS, SYNC_ENABLED_CATEGORIES, LOG_LEVEL, LOG_FORMAT

Example:
  HCP_HOST=192.168.15.15 HCP_APP_KEY=... HCP_APP_SECRET=... \
  DATABASE_URL="postgresql://user:pass@db:5432/hcp_sync" node src/index.js --once
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  const once = args.includes('--once');

  log.info('HCP Sync Agent starting', {
    version: '1.0.0',
    node: process.version,
    hcpHost: config.hcp.host,
    hcpPort: config.hcp.port,
    dbConfigured: !!config.db.connectionString,
    intervalMs: config.agent.syncIntervalMs,
    once,
    categories: config.agent.enabledCategories,
  });

  startScheduler({
    config,
    dbUrl: config.db.connectionString,
    compoundId: process.env.HCP_COMPOUND_ID || 'default',
    categories: config.agent.enabledCategories,
    once,
  }).catch((err) => {
    log.error('fatal startup error', { error: String(err.message || err), stack: err.stack });
    process.exit(1);
  });
}

main();
