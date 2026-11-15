'use strict';
/* Sync orchestrator: fetches categories from HCP, normalizes, and upserts
   into the cloud database. Idempotent per (compound, source_entity, source_id).
   Tracks sync runs and cursors for incremental resume.
*/

const { version, vehicleEvents, persons, visitors } = require('./hcp-client');
const {
  initDb,
  recordSyncRun,
  updateSyncRun,
  upsertRecords,
  getCursor,
  setCursor,
  audit,
  closePool,
} = require('./db');
const { normalizeBatch } = require('./normalizer');
const log = require('./logger');

const CATEGORY_ENDPOINTS = {
  persons: 'persons',
  vehicles: 'access-events',
  'access-events': 'access-events',
  visitors: 'visitors',
};

const DEFAULT_PAGE_SIZE = 500;

function nowIso() {
  return new Date().toISOString();
}

async function runOnce({ config, dbUrl, compoundId = 'default', categories }) {
  const enabled = categories || config.agent.enabledCategories;
  log.info('sync run starting', { compoundId, categories: enabled });

  await initDb(dbUrl);

  // Auth / version discovery
  const auth = await version({ config });
  if (!auth.ok) {
    log.error('auth/version discovery failed', { message: auth.message });
    await recordSyncRun({ connectionString: dbUrl, run: { status: 'failed', category: null, errorSummary: auth.message } });
    await audit({ connectionString: dbUrl, action: 'sync.auth_failed', detail: auth.message });
    return { ok: false, blocked: 'auth-failure', message: auth.message };
  }
  log.info('auth succeeded', { detectedHcpVersion: auth.detectedHcpVersion });

  const startedAt = nowIso();
  let totalRetrieved = 0, totalInserted = 0, totalUpdated = 0, totalFailed = 0, totalBlocked = 0;
  const results = {};

  for (const category of enabled) {
    const catStart = Date.now();
    let result;

    try {
      switch (category) {
        case 'access-events':
        case 'vehicles': {
          result = await vehicleEvents({
            config,
            pageNo: 1,
            pageSize: DEFAULT_PAGE_SIZE,
            lookbackDays: config.hcp.syncLookbackDays,
            cameraIndexCode: config.hcp.cameraIndexCode,
          });
          break;
        }
        case 'persons': {
          result = await persons({ config, pageNo: 1, pageSize: DEFAULT_PAGE_SIZE });
          break;
        }
        case 'visitors': {
          result = await visitors({ config, pageNo: 1, pageSize: DEFAULT_PAGE_SIZE });
          break;
        }
        default: {
          result = { ok: false, blocked: 'unsupported-category', message: `Unknown category: ${category}`, records: [] };
        }
      }
    } catch (e) {
      result = { ok: false, blocked: 'api-error', message: String(e.message || e), records: [] };
      totalFailed++;
    }

    if (!result.ok) {
      log.warn(`category ${category} blocked`, { blocked: result.blocked, message: result.message });
      totalBlocked++;
      results[category] = { ok: false, blocked: result.blocked, message: result.message, retrieved: 0, inserted: 0, updated: 0 };
      continue;
    }

    const records = normalizeBatch(category, result.records || [], {
      compoundId,
      hcpVersion: config.hcp.host, // placeholder; ideally from auth.detectedHcpVersion
      openapiVersion: '2.6',
    });

    const dbResult = await upsertRecords({ connectionString: dbUrl, records });
    totalRetrieved += records.length;
    totalInserted += dbResult.inserted;
    totalUpdated += dbResult.updated;

    log.info(`category ${category} synced`, {
      retrieved: records.length,
      inserted: dbResult.inserted,
      updated: dbResult.updated,
      durationMs: Date.now() - catStart,
    });

    results[category] = {
      ok: true,
      retrieved: records.length,
      inserted: dbResult.inserted,
      updated: dbResult.updated,
      hasMore: result.hasMore,
      total: result.total,
    };
  }

  const finishedAt = nowIso();
  const durationMs = Date.now() - new Date(startedAt).getTime();
  const status = totalBlocked > 0 && totalRetrieved === 0 ? 'blocked' : 'completed';

  await recordSyncRun({
    connectionString: dbUrl,
    run: {
      startedAt,
      status,
      category: enabled.join(','),
      retrieved: totalRetrieved,
      inserted: totalInserted,
      updated: totalUpdated,
      duplicates: 0,
      failed: totalFailed,
      blocked: totalBlocked,
      errorSummary: totalBlocked > 0 ? `${totalBlocked} category/categories blocked` : null,
      durationMs,
      schemaVersion: 'hcp-normalized/1.0.0',
    },
  });

  await audit({ connectionString: dbUrl, action: 'sync.completed', detail: `retrieved=${totalRetrieved} inserted=${totalInserted} updated=${totalUpdated} blocked=${totalBlocked}` });

  log.info('sync run finished', { status, retrieved: totalRetrieved, inserted: totalInserted, updated: totalUpdated, blocked: totalBlocked, durationMs });

  return {
    ok: status !== 'failed',
    status,
    retrieved: totalRetrieved,
    inserted: totalInserted,
    updated: totalUpdated,
    blocked: totalBlocked,
    failed: totalFailed,
    durationMs,
    results,
    detectedHcpVersion: auth.detectedHcpVersion,
  };
}

async function startScheduler({ config, dbUrl, compoundId, categories, once }) {
  if (once) {
    const result = await runOnce({ config, dbUrl, compoundId, categories });
    await closePool();
    process.exit(result.ok ? 0 : 1);
  }

  const intervalMs = config.agent.syncIntervalMs;
  if (intervalMs <= 0) {
    log.info('auto-sync disabled (SYNC_INTERVAL_MS <= 0); run with --once for a manual sync');
    return;
  }

  log.info('scheduler started', { intervalMs });
  // Run immediately, then on interval
  await runOnce({ config, dbUrl, compoundId, categories });
  setInterval(async () => {
    try {
      await runOnce({ config, dbUrl, compoundId, categories });
    } catch (e) {
      log.error('scheduled sync error', { error: String(e.message || e) });
    }
  }, intervalMs);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    log.info('shutting down');
    await closePool();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    log.info('shutting down');
    await closePool();
    process.exit(0);
  });
}

module.exports = {
  runOnce,
  startScheduler,
};
