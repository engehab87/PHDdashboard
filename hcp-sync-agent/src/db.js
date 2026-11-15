'use strict';
/* Cloud database (PostgreSQL) layer for the HCP sync agent.

   Creates the sync schema (idempotent), stores normalized HCP records, and
   tracks sync runs / cursors for incremental resume. Uses `pg` (node-postgres).
   All writes are parameterized. The agent is read-only toward HCP and
   write-only toward the cloud DB.
*/

const { Pool } = require('pg');
const log = require('./logger');

const SCHEMA_SQL = `
-- Core sync metadata
CREATE TABLE IF NOT EXISTS hcp_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running', -- running|completed|failed|blocked
  category TEXT,
  retrieved INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  duration_ms BIGINT,
  schema_version TEXT NOT NULL DEFAULT 'hcp-normalized/1.0.0'
);

CREATE INDEX IF NOT EXISTS idx_hcp_sync_runs_status ON hcp_sync_runs(status);
CREATE INDEX IF NOT EXISTS idx_hcp_sync_runs_started_at ON hcp_sync_runs(started_at DESC);

-- Per-compound sync cursors for incremental resume
CREATE TABLE IF NOT EXISTS hcp_sync_cursors (
  compound_id TEXT NOT NULL,
  category TEXT NOT NULL,
  last_cursor TEXT,
  last_sync_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (compound_id, category)
);

-- Normalized HCP live records (provenance-labelled)
CREATE TABLE IF NOT EXISTS hcp_live_records (
  id BIGSERIAL PRIMARY KEY,
  compound_id TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'hcp-live',
  hcp_version TEXT,
  openapi_version TEXT,
  adapter_id TEXT NOT NULL DEFAULT 'hcp-artemis-v26',
  adapter_version TEXT NOT NULL DEFAULT 'hcp-normalized/1.0.0',
  source_entity TEXT NOT NULL, -- persons|vehicles|access-events|visitors
  source_id TEXT NOT NULL,
  event_time TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provenance TEXT NOT NULL DEFAULT 'live-hcp',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_hcp_live_records_unique
  ON hcp_live_records(compound_id, source_entity, source_id);
CREATE INDEX IF NOT EXISTS idx_hcp_live_records_entity ON hcp_live_records(source_entity);
CREATE INDEX IF NOT EXISTS idx_hcp_live_records_compound ON hcp_live_records(compound_id);
CREATE INDEX IF NOT EXISTS idx_hcp_live_records_event_time ON hcp_live_records(event_time);

-- Sync audit log
CREATE TABLE IF NOT EXISTS hcp_sync_audit (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_hcp_sync_audit_ts ON hcp_sync_audit(ts DESC);
`;

let pool = null;

function getPool(connectionString) {
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => log.error('postgres idle client error', { error: String(err.message || err) }));
  }
  return pool;
}

async function initDb(connectionString) {
  const p = getPool(connectionString);
  const client = await p.connect();
  try {
    await client.query(SCHEMA_SQL);
    log.info('database schema initialized', { schema: 'hcp_sync' });
  } finally {
    client.release();
  }
}

async function audit({ connectionString, action, detail }) {
  const p = getPool(connectionString);
  await p.query('INSERT INTO hcp_sync_audit(action, detail) VALUES($1, $2)', [action, detail || '']);
}

async function recordSyncRun({ connectionString, run, client }) {
  const exec = client || getPool(connectionString);
  const res = await exec.query(
    `INSERT INTO hcp_sync_runs(started_at, status, category, retrieved, inserted, updated, duplicates, failed, blocked, error_summary, duration_ms, schema_version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [run.startedAt, run.status, run.category || null, run.retrieved || 0, run.inserted || 0, run.updated || 0, run.duplicates || 0, run.failed || 0, run.blocked || 0, run.errorSummary || null, run.durationMs || null, run.schemaVersion || 'hcp-normalized/1.0.0']
  );
  return res.rows[0].id;
}

async function updateSyncRun({ connectionString, runId, updates, client }) {
  const exec = client || getPool(connectionString);
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(updates)) {
    sets.push(`${k} = $${i++}`);
    vals.push(v);
  }
  vals.push(runId);
  await exec.query(`UPDATE hcp_sync_runs SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

async function upsertRecords({ connectionString, records, client }) {
  const exec = client || getPool(connectionString);
  let inserted = 0, updated = 0, duplicates = 0;

  for (const rec of records) {
    const res = await exec.query(
      `INSERT INTO hcp_live_records(compound_id, source_system, hcp_version, openapi_version, adapter_id, adapter_version, source_entity, source_id, event_time, retrieved_at, provenance, data, created_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (compound_id, source_entity, source_id)
       DO UPDATE SET
         source_system = EXCLUDED.source_system,
         hcp_version = EXCLUDED.hcp_version,
         openapi_version = EXCLUDED.openapi_version,
         adapter_id = EXCLUDED.adapter_id,
         adapter_version = EXCLUDED.adapter_version,
         event_time = EXCLUDED.event_time,
         retrieved_at = EXCLUDED.retrieved_at,
         provenance = EXCLUDED.provenance,
         data = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at
       RETURNING (xmax = 0) AS inserted`,
      [
        rec.compoundId,
        rec.sourceSystem || 'hcp-live',
        rec.hcpVersion || null,
        rec.openapiVersion || null,
        rec.adapterId || 'hcp-artemis-v26',
        rec.adapterVersion || 'hcp-normalized/1.0.0',
        rec.sourceEntity,
        rec.sourceId,
        rec.eventTime || null,
        rec.retrievedAt || new Date().toISOString(),
        rec.provenance || 'live-hcp',
        JSON.stringify(rec.data || {}),
        rec.createdAt || new Date().toISOString(),
        new Date().toISOString(),
      ]
    );
    const row = res.rows[0];
    if (row.inserted) inserted++;
    else updated++;
  }

  return { inserted, updated, duplicates };
}

async function getCursor({ connectionString, compoundId, category, client }) {
  const exec = client || getPool(connectionString);
  const res = await exec.query(
    'SELECT last_cursor, last_sync_at FROM hcp_sync_cursors WHERE compound_id = $1 AND category = $2',
    [compoundId, category]
  );
  return res.rows[0] || null;
}

async function setCursor({ connectionString, compoundId, category, cursor, client }) {
  const exec = client || getPool(connectionString);
  await exec.query(
    `INSERT INTO hcp_sync_cursors(compound_id, category, last_cursor, last_sync_at, updated_at)
     VALUES($1,$2,$3,NOW(),NOW())
     ON CONFLICT (compound_id, category)
     DO UPDATE SET last_cursor = EXCLUDED.last_cursor, last_sync_at = EXCLUDED.last_sync_at, updated_at = EXCLUDED.updated_at`,
    [compoundId, category, cursor || null]
  );
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  initDb,
  audit,
  recordSyncRun,
  updateSyncRun,
  upsertRecords,
  getCursor,
  setCursor,
  closePool,
};
