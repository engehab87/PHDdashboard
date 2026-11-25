'use strict';
/* Dedicated PostgreSQL connection owner.
   The main thread dispatches synchronous query requests through a
   SharedArrayBuffer; this worker holds the pg Pool (max 1 client so
   transactions and LASTVAL() behave like the old single SQLite connection). */
const { workerData } = require('worker_threads');
const { Pool, types } = require('pg');
const { translate } = require('./pg-dialect');

// Match node:sqlite's numeric behaviour: COUNT(*) (int8) and SUM/REAL aggregates
// (numeric) otherwise arrive as strings from node-postgres.
types.setTypeParser(20, (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value;
});
types.setTypeParser(1700, (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
});

const HEADER_INTS = 8;
const header = new Int32Array(workerData.sab, 0, HEADER_INTS);
const payload = new Uint8Array(workerData.sab, HEADER_INTS * 4);

const pool = new Pool({
  connectionString: workerData.connectionString,
  ssl: workerData.ssl,
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Tables with an `id` identity column: INSERT ... can use RETURNING id to
// reproduce node:sqlite's `lastInsertRowid`.
const ID_TABLES = new Set([
  'reporting_periods', 'imports', 'raw_files', 'compounds', 'units', 'users',
  'user_units', 'vehicles', 'invitations', 'gate_passes', 'hcp_vehicle_events',
  'handover', 'identity_maps', 'audit_log', 'dashboard_users', 'source_files',
  'import_log', 'event_fingerprints', 'user_history', 'unit_history',
  'vehicle_history', 'user_unit_history', 'duplicate_records', 'changed_records',
  'period_snapshots', 'hcp_test_runs', 'hcp_test_stages', 'hcp_sync_runs',
  'hcp_live_persons', 'hcp_live_vehicles', 'hcp_live_events', 'connectivity_checks',
]);

function respond(obj, state) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  if (buf.length > payload.length) {
    header[1] = 0;
    Atomics.store(header, 0, 3);
    Atomics.notify(header, 0);
    return;
  }
  payload.set(buf);
  header[1] = buf.length;
  Atomics.store(header, 0, state);
  Atomics.notify(header, 0);
}

async function runRequest(req) {
  const { sql, count } = translate(req.sql);
  const values = req.params || [];
  if (count !== values.length) {
    throw new Error(`SQL expects ${count} parameter(s) but got ${values.length}: ${sql.slice(0, 160)}`);
  }

  if (req.mode === 'exec') {
    await pool.query(sql);
    return { changes: 0, rows: [], lastInsertRowid: null };
  }

  let text = sql;
  let returningTried = false;
  if (req.mode === 'run' && /^\s*INSERT\b/i.test(text) && !/RETURNING\b/i.test(text)) {
    const m = /INSERT\s+INTO\s+"?([A-Za-z0-9_]+)"?/i.exec(text);
    if (m && ID_TABLES.has(m[1])) {
      text = text.trim().replace(/;?\s*$/, '') + ' RETURNING id';
      returningTried = true;
    }
  }

  try {
    const result = await pool.query(text, values);
    const first = result.rows && result.rows[0] ? result.rows[0] : null;
    return {
      rows: req.mode === 'get' ? (first ? [first] : []) : (result.rows || []),
      changes: result.rowCount == null ? 0 : Number(result.rowCount),
      lastInsertRowid: first && first.id != null ? Number(first.id) : null,
    };
  } catch (e) {
    if (returningTried) {
      // Defensive fallback: some composite-key inserts may not support RETURNING id.
      const result = await pool.query(sql, values);
      return {
        rows: result.rows || [],
        changes: result.rowCount == null ? 0 : Number(result.rowCount),
        lastInsertRowid: null,
      };
    }
    throw e;
  }
}

(async function loop() {
  for (;;) {
    Atomics.wait(header, 0, 0); // main thread sets 0 when it is ready for a request
    if (Atomics.load(header, 0) !== 1) {
      // Spurious wake or a reset; go back to sleep.
      continue;
    }
    const len = header[1];
    let req;
    try {
      req = JSON.parse(Buffer.from(payload.buffer, payload.byteOffset, len).toString('utf8'));
      const res = await runRequest(req);
      respond({ mode: req.mode, data: res }, 2);
    } catch (e) {
      respond({ message: String(e && e.message || e), code: e && e.code }, 3);
    }
  }
})().catch((e) => {
  respond({ message: 'PostgreSQL worker fatal: ' + String(e && e.message || e) }, 3);
});
