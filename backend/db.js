'use strict';
/* PostgreSQL data-access layer for Azure Database for PostgreSQL.
 *
 * The application was originally written against node:sqlite with a fully
 * synchronous API (db.prepare(...).get/all/run()).  Rewriting every call site
 * would be a large, risky change, so this layer keeps that exact API and
 * dispatches queries to a dedicated worker thread which owns a `pg` Pool.
 * The worker uses a single client, so transactions and LASTVAL() behave like
 * the old single SQLite connection.  No PostgreSQL server is installed
 * locally: all traffic goes to DATABASE_URL (Azure App Service convention).
 */
const { Worker } = require('worker_threads');
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('fs');
const path = require('path');

const auditContext = new AsyncLocalStorage();

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db'); // legacy label only
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

if (process.env.NODE_ENV === 'test' && !process.env.TEST_DATABASE_URL && process.env.ALLOW_TESTS_ON_DATABASE_URL !== '1') {
  throw new Error('Database tests require TEST_DATABASE_URL pointing at a disposable PostgreSQL database. Set ALLOW_TESTS_ON_DATABASE_URL=1 only for an isolated target.');
}
const connectionString = (process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL)
  ? process.env.TEST_DATABASE_URL
  : (process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING ||
    `postgresql://${process.env.PGUSER || 'postgres'}:${encodeURIComponent(process.env.PGPASSWORD || 'postgres')}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'palm_hills'}`);
const sslMode = (process.env.PGSSLMODE || /sslmode=(\w+)/i.exec(connectionString)?.[1] || '').toLowerCase();
const ssl = sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full'
  ? { rejectUnauthorized: sslMode !== 'require' }
  : false;

const HEADER_INTS = 8;
const BUFFER_BYTES = Math.max(1024 * 1024, Number(process.env.DB_RPC_BUFFER_MB || 64) * 1024 * 1024);
const sab = new SharedArrayBuffer(HEADER_INTS * 4 + BUFFER_BYTES);
const header = new Int32Array(sab, 0, HEADER_INTS);
const payload = new Uint8Array(sab, HEADER_INTS * 4);

let workerError = null;
const worker = new Worker(path.join(__dirname, 'pg-worker.js'), {
  workerData: { sab, connectionString, ssl },
});
worker.on('error', (e) => { workerError = e; });
worker.on('exit', (code) => {
  if (!workerError) workerError = new Error('PostgreSQL worker exited unexpectedly (code ' + code + ')');
});
worker.unref(); // short-lived scripts must be able to exit

let requestId = 0;
const RPC_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS || 120000);

/** Synchronous request/response over the shared buffer. */
function rpc(sql, params, mode) {
  if (workerError) throw new Error('PostgreSQL worker error: ' + workerError.message);
  const req = JSON.stringify({ id: ++requestId, sql, params: params || [], mode });
  const bytes = Buffer.from(req, 'utf8');
  if (bytes.length > BUFFER_BYTES) {
    throw new Error(`DB request too large (${bytes.length} bytes; limit ${BUFFER_BYTES}). Increase DB_RPC_BUFFER_MB.`);
  }
  payload.set(bytes);
  header[1] = bytes.length;
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0);

  let state;
  for (;;) {
    const outcome = Atomics.wait(header, 0, 1, RPC_TIMEOUT_MS);
    if (outcome === 'timed-out') {
      // The worker may still be mid-query; make the bridge unusable rather than
      // letting a later request reuse a buffer that the worker still owns.
      workerError = new Error(`PostgreSQL query timed out after ${RPC_TIMEOUT_MS}ms: ${String(sql).slice(0, 120)}`);
      worker.terminate();
      throw workerError;
    }
    state = Atomics.load(header, 0);
    if (state !== 1) break;
    // Spurious wake-up: keep waiting for the worker's response.
  }
  if (workerError) throw new Error('PostgreSQL worker error: ' + workerError.message);


  const len = header[1];
  const text = Buffer.from(payload.buffer, payload.byteOffset, len).toString('utf8');
  Atomics.store(header, 0, 0); // release the worker for the next request
  Atomics.notify(header, 0);

  if (state === 3) {
    let msg = text;
    try { msg = JSON.parse(text).message; } catch (_) { /* keep raw */ }
    throw new Error(msg || 'PostgreSQL query failed');
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error('Invalid PostgreSQL response: ' + text.slice(0, 200)); }
  return parsed.data;
}

const statementCache = new Map();
const db = {
  prepare(sql) {
    let stmt = statementCache.get(sql);
    if (!stmt) {
      stmt = {
        get: (...params) => rpc(sql, params, 'get').rows[0] || null,
        all: (...params) => rpc(sql, params, 'all').rows,
        run: (...params) => {
          const r = rpc(sql, params, 'run');
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
      };
      statementCache.set(sql, stmt);
    }
    return stmt;
  },
  exec(sql) { return rpc(sql, [], 'exec'); },
  transaction(fn) {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw e;
    }
  },
  close() { worker.terminate(); },
};

function tableColumns(table) {
  return db.prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=?")
    .all(table).map(r => r.name);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reporting_periods(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  period_key TEXT UNIQUE NOT NULL,
  period_name TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  source_filename TEXT,
  status TEXT DEFAULT 'active',
  processing_version TEXT DEFAULT '1.0.0'
);
CREATE TABLE IF NOT EXISTS imports(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  period_id INTEGER REFERENCES reporting_periods(id),
  detected_period_key TEXT,
  uploaded_at TEXT NOT NULL,
  source_filename TEXT,
  status TEXT DEFAULT 'staged',
  progress TEXT,
  log TEXT
);
CREATE TABLE IF NOT EXISTS raw_files(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  import_id INTEGER REFERENCES imports(id),
  period_id INTEGER REFERENCES reporting_periods(id),
  filename TEXT NOT NULL,
  dataset_type TEXT NOT NULL,
  sheet TEXT,
  row_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ok',
  error TEXT
);
CREATE TABLE IF NOT EXISTS raw_rows(
  import_id INTEGER NOT NULL,
  period_id INTEGER,
  dataset_type TEXT NOT NULL,
  row_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_rows_ds ON raw_rows(dataset_type, period_id);
CREATE TABLE IF NOT EXISTS compounds(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  code TEXT,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS compound_aliases(
  alias TEXT PRIMARY KEY,
  compound_id INTEGER NOT NULL REFERENCES compounds(id)
);
CREATE TABLE IF NOT EXISTS units(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  external_id TEXT UNIQUE,
  unit_number TEXT NOT NULL,
  norm_unit TEXT NOT NULL,
  compound_id INTEGER REFERENCES compounds(id),
  related_unit TEXT,
  gate_suspension TEXT,
  rent_suspension TEXT,
  maint_fees TEXT,
  created_on TEXT,
  first_seen TEXT,
  last_seen TEXT
);
CREATE INDEX IF NOT EXISTS idx_units_compound ON units(compound_id);
CREATE INDEX IF NOT EXISTS idx_units_norm ON units(norm_unit);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  external_id TEXT UNIQUE,
  name TEXT,
  norm_name TEXT,
  mobile TEXT,
  norm_mobile TEXT,
  email TEXT,
  national_id TEXT,
  marital_status TEXT,
  status TEXT,
  registered_as TEXT,
  created_on TEXT,
  first_seen TEXT,
  last_seen TEXT,
  canonical_user_id INTEGER REFERENCES users(id),
  is_canonical INTEGER NOT NULL DEFAULT 1,
  image_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_normname ON users(norm_name);
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(norm_mobile);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_canonical ON users(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_users_norm_canonical ON users(norm_name, is_canonical);
CREATE TABLE IF NOT EXISTS user_units(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  external_id TEXT UNIQUE,
  user_id INTEGER REFERENCES users(id),
  user_name_raw TEXT,
  unit_id INTEGER REFERENCES units(id),
  unit_ref_raw TEXT,
  compound_id INTEGER REFERENCES compounds(id),
  compound_raw TEXT,
  access_type TEXT,
  invitation_provider TEXT,
  status TEXT,
  created_on TEXT,
  first_seen TEXT,
  last_seen TEXT
);
CREATE INDEX IF NOT EXISTS idx_uu_user ON user_units(user_id);
CREATE INDEX IF NOT EXISTS idx_uu_unit ON user_units(unit_id);
CREATE INDEX IF NOT EXISTS idx_uu_compound ON user_units(compound_id);
CREATE INDEX IF NOT EXISTS idx_uu_status_unit ON user_units(status, unit_id);
CREATE INDEX IF NOT EXISTS idx_uu_status_user ON user_units(status, user_id);
CREATE TABLE IF NOT EXISTS vehicles(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  external_id TEXT UNIQUE,
  make TEXT, model TEXT, year TEXT,
  plate_original TEXT,
  plate_norm TEXT,
  plate_norm_latin TEXT,
  user_id INTEGER REFERENCES users(id),
  user_name_raw TEXT,
  status TEXT,
  created_on TEXT,
  first_seen TEXT, last_seen TEXT
);
CREATE INDEX IF NOT EXISTS idx_veh_plate ON vehicles(plate_norm);
CREATE INDEX IF NOT EXISTS idx_veh_plate_latin ON vehicles(plate_norm_latin);
CREATE TABLE IF NOT EXISTS invitations(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  external_id TEXT UNIQUE,
  code TEXT,
  provider TEXT,
  invite_to TEXT,
  member_name TEXT,
  member_mobile TEXT,
  type TEXT,
  status TEXT,
  created_on TEXT,
  period_id INTEGER REFERENCES reporting_periods(id)
);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invitations(status);
CREATE TABLE IF NOT EXISTS gate_passes(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  external_id TEXT UNIQUE,
  compound_id INTEGER REFERENCES compounds(id),
  compound_raw TEXT,
  unit_id INTEGER REFERENCES units(id),
  unit_ref_raw TEXT,
  user_id INTEGER REFERENCES users(id),
  user_name_raw TEXT,
  access_type TEXT,
  entry_date TEXT,
  valid_until TEXT,
  created_on TEXT,
  period_id INTEGER REFERENCES reporting_periods(id)
);
CREATE INDEX IF NOT EXISTS idx_gp_compound ON gate_passes(compound_id);
CREATE INDEX IF NOT EXISTS idx_gp_entry ON gate_passes(entry_date);
CREATE INDEX IF NOT EXISTS idx_gp_unit ON gate_passes(unit_id);
CREATE INDEX IF NOT EXISTS idx_gp_user ON gate_passes(user_id);
CREATE TABLE IF NOT EXISTS hcp_vehicle_events(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  period_id INTEGER REFERENCES reporting_periods(id),
  plate_original TEXT,
  plate_normalized TEXT,
  plate_normalized_latin TEXT,
  parking_lot TEXT,
  compound_id INTEGER REFERENCES compounds(id),
  direction TEXT,
  enter_time TEXT,
  exit_time TEXT,
  gate TEXT,
  method TEXT,
  result TEXT,
  reason TEXT,
  vehicle_list TEXT,
  owner_raw TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  country TEXT,
  vehicle_type TEXT,
  color TEXT,
  brand TEXT
);
CREATE INDEX IF NOT EXISTS idx_hcp_period ON hcp_vehicle_events(period_id);
CREATE INDEX IF NOT EXISTS idx_hcp_plate ON hcp_vehicle_events(plate_normalized);
CREATE INDEX IF NOT EXISTS idx_hcp_time ON hcp_vehicle_events(enter_time, exit_time);
CREATE INDEX IF NOT EXISTS idx_hcp_compound ON hcp_vehicle_events(compound_id);
CREATE INDEX IF NOT EXISTS idx_hcp_owner ON hcp_vehicle_events(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_hcp_plate_latin ON hcp_vehicle_events(plate_normalized_latin);
CREATE TABLE IF NOT EXISTS handover(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  period_id INTEGER REFERENCES reporting_periods(id),
  unit_code TEXT,
  unit_id INTEGER REFERENCES units(id),
  category TEXT, zone TEXT,
  handover_date TEXT,
  finishing TEXT, resident TEXT,
  planned_delivery TEXT
);
CREATE TABLE IF NOT EXISTS identity_maps(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_key TEXT NOT NULL,
  crm_user_id INTEGER REFERENCES users(id),
  match_method TEXT,
  confidence REAL,
  status TEXT DEFAULT 'MATCHED',
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_kind, source_key)
);
CREATE TABLE IF NOT EXISTS period_metrics(
  period_id INTEGER REFERENCES reporting_periods(id),
  metric_key TEXT NOT NULL,
  compound_id INTEGER REFERENCES compounds(id),
  value_num REAL,
  value_text TEXT
);
-- COALESCE keeps the portfolio (NULL compound) row unique, matching the
-- old SQLite snapshot semantics while allowing ON CONFLICT upserts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_period_metrics_key ON period_metrics(period_id, metric_key, COALESCE(compound_id, 0));
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT DEFAULT 'system',
  action TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS dashboard_users(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  password_hash TEXT,
  password_salt TEXT,
  failed_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  auth_source TEXT DEFAULT 'local',
  entra_object_id TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  updated_at TEXT NOT NULL DEFAULT (NOW()::text)
);
CREATE TABLE IF NOT EXISTS user_sessions(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES dashboard_users(id),
  token_hash TEXT UNIQUE NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (NOW()::text),
  revoked_at TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE TABLE IF NOT EXISTS user_compound_scopes(
  user_id INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  compound_id INTEGER NOT NULL REFERENCES compounds(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  PRIMARY KEY(user_id, compound_id)
);
CREATE TABLE IF NOT EXISTS source_files(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  import_id INTEGER REFERENCES imports(id),
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  dataset_type TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  row_count INTEGER DEFAULT 0,
  sheet_name TEXT,
  reporting_period TEXT,
  processing_status TEXT DEFAULT 'NEW',
  error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_files_hash ON source_files(import_id, file_hash);
CREATE INDEX IF NOT EXISTS idx_source_files_import ON source_files(import_id);
CREATE TABLE IF NOT EXISTS import_log(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES imports(id),
  ts TEXT NOT NULL DEFAULT (NOW()::text),
  level TEXT DEFAULT 'info',
  phase TEXT,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_log_import ON import_log(import_id);
CREATE TABLE IF NOT EXISTS event_fingerprints(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_type TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_event_id TEXT,
  event_hash TEXT NOT NULL,
  event_row_id INTEGER,
  first_seen_import_id INTEGER REFERENCES imports(id),
  first_seen_at TEXT NOT NULL,
  UNIQUE(event_type, source_system, event_hash)
);
CREATE INDEX IF NOT EXISTS idx_evt_fp_hash ON event_fingerprints(event_hash);
CREATE TABLE IF NOT EXISTS user_history(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  import_id INTEGER REFERENCES imports(id),
  period_key TEXT,
  change_type TEXT NOT NULL,
  name TEXT, mobile TEXT, email TEXT, national_id TEXT, marital_status TEXT,
  status TEXT, registered_as TEXT,
  changed_at TEXT NOT NULL DEFAULT (NOW()::text)
);
CREATE INDEX IF NOT EXISTS idx_user_hist_user ON user_history(user_id);
CREATE TABLE IF NOT EXISTS unit_history(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  unit_id INTEGER NOT NULL,
  import_id INTEGER REFERENCES imports(id),
  period_key TEXT,
  change_type TEXT NOT NULL,
  unit_number TEXT, compound_id INTEGER, related_unit TEXT,
  gate_suspension TEXT, rent_suspension TEXT, maint_fees TEXT,
  changed_at TEXT NOT NULL DEFAULT (NOW()::text)
);
CREATE INDEX IF NOT EXISTS idx_unit_hist_unit ON unit_history(unit_id);
CREATE TABLE IF NOT EXISTS vehicle_history(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  vehicle_id INTEGER NOT NULL,
  import_id INTEGER REFERENCES imports(id),
  period_key TEXT,
  change_type TEXT NOT NULL,
  make TEXT, model TEXT, year TEXT, plate_original TEXT,
  user_id INTEGER, status TEXT,
  changed_at TEXT NOT NULL DEFAULT (NOW()::text)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_hist_vehicle ON vehicle_history(vehicle_id);
CREATE TABLE IF NOT EXISTS user_unit_history(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_unit_id INTEGER NOT NULL,
  import_id INTEGER REFERENCES imports(id),
  period_key TEXT,
  change_type TEXT NOT NULL,
  user_id INTEGER, unit_id INTEGER, compound_id INTEGER,
  access_type TEXT, invitation_provider TEXT, status TEXT,
  changed_at TEXT NOT NULL DEFAULT (NOW()::text)
);
CREATE INDEX IF NOT EXISTS idx_uu_hist_uu ON user_unit_history(user_unit_id);
CREATE TABLE IF NOT EXISTS duplicate_records(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES imports(id),
  filename TEXT,
  dataset_type TEXT,
  record_key TEXT,
  reason TEXT NOT NULL,
  original_import_id INTEGER REFERENCES imports(id),
  action TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);
CREATE INDEX IF NOT EXISTS idx_dup_import ON duplicate_records(import_id);
CREATE TABLE IF NOT EXISTS changed_records(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES imports(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  entity_key TEXT,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT NOT NULL DEFAULT (NOW()::text)
);
CREATE INDEX IF NOT EXISTS idx_chg_import ON changed_records(import_id, entity_type);
CREATE TABLE IF NOT EXISTS period_snapshots(
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  period_key TEXT NOT NULL,
  import_id INTEGER REFERENCES imports(id),
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  master_counts TEXT,
  metrics TEXT,
  UNIQUE(period_key, import_id)
);
`;

/* Canonical-resident consolidation (PostgreSQL edition). */
function consolidateCanonicalResidents() {
  const mappings = db.prepare(`
    WITH real AS (
      SELECT norm_name, MIN(id) AS canonical_id
      FROM users
      WHERE norm_name IS NOT NULL AND TRIM(COALESCE(external_id, '')) <> ''
      GROUP BY norm_name
      HAVING COUNT(*) = 1
    )
    SELECT aliasUser.id AS stub_id, real.canonical_id AS canonical_id, real.norm_name AS norm_name
    FROM users aliasUser
    JOIN real ON real.norm_name = aliasUser.norm_name
    WHERE TRIM(COALESCE(aliasUser.external_id, '')) = ''
      AND aliasUser.id <> real.canonical_id
      AND (aliasUser.canonical_user_id IS NULL OR aliasUser.canonical_user_id <> real.canonical_id)
  `).all();
  if (!mappings.length) return { mappings: 0 };

  const relinks = [
    ['user_units', 'user_id'],
    ['vehicles', 'user_id'],
    ['gate_passes', 'user_id'],
    ['hcp_vehicle_events', 'owner_user_id'],
    ['identity_maps', 'crm_user_id'],
  ];
  let users = 0, relations = 0;
  return db.transaction(() => {
    db.exec('CREATE TEMP TABLE canonical_resident_names(norm_name TEXT PRIMARY KEY, canonical_id INTEGER NOT NULL)');
    const nameStmt = db.prepare('INSERT INTO canonical_resident_names(norm_name, canonical_id) VALUES(?,?)');
    for (const m of mappings) nameStmt.run(m.norm_name, m.canonical_id);
    const relinkStmts = relinks.map(([table, column]) => db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`));
    for (const m of mappings) {
      for (const stmt of relinkStmts) relations += Number(stmt.run(m.canonical_id, m.stub_id).changes || 0);
    }
    relations += Number(db.prepare('UPDATE vehicles SET user_id=(SELECT canonical_id FROM canonical_resident_names WHERE norm_name=LOWER(TRIM(user_name_raw))) WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM canonical_resident_names WHERE norm_name=LOWER(TRIM(user_name_raw)))').run().changes || 0);
    relations += Number(db.prepare('UPDATE user_units SET user_id=(SELECT canonical_id FROM canonical_resident_names WHERE norm_name=LOWER(TRIM(user_name_raw))) WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM canonical_resident_names WHERE norm_name=LOWER(TRIM(user_name_raw)))').run().changes || 0);
    relations += Number(db.prepare('UPDATE hcp_vehicle_events SET owner_user_id=(SELECT canonical_id FROM canonical_resident_names WHERE norm_name=LOWER(TRIM(owner_raw))) WHERE owner_user_id IS NULL AND EXISTS (SELECT 1 FROM canonical_resident_names WHERE norm_name=LOWER(TRIM(owner_raw)))').run().changes || 0);
    const userStmt = db.prepare('UPDATE users SET canonical_user_id=?, is_canonical=0 WHERE id=?');
    for (const m of mappings) { userStmt.run(m.canonical_id, m.stub_id); users++; }
    db.exec('DROP TABLE IF EXISTS canonical_resident_names');
    db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('resident_identity_canonicalization',?)")
      .run(`merged=${users};relations=${relations};at=${new Date().toISOString()}`);
    try { audit('resident.identity.canonicalized', `Canonicalized ${users} duplicate resident stubs and relinked ${relations} relationships`); } catch (_) { /* ignore */ }
    return { mappings: users, relations };
  });
}

function migrate() {
  // Serialize DDL across processes/instances. Concurrent CREATE OR REPLACE
  // FUNCTION / CREATE TABLE IF NOT EXISTS calls race on PostgreSQL catalog
  // rows even though each statement is individually idempotent.
  const lockKey = 0x50414c4d; // "PALM"
  db.prepare('SELECT pg_advisory_lock(?)').get(lockKey);
  try {
  db.exec(SCHEMA);
  // datetime() compatibility helper for legacy SQL defaults/functions.
  db.exec(`CREATE OR REPLACE FUNCTION datetime(x text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
    BEGIN
      IF x = 'now' THEN RETURN to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'); END IF;
      RETURN x;
    END $$;`);
  try {
    const cols = tableColumns('users');
    if (!cols.includes('gender')) db.exec('ALTER TABLE users ADD COLUMN gender TEXT');
    if (!cols.includes('passport')) db.exec('ALTER TABLE users ADD COLUMN passport TEXT');
    if (!cols.includes('image_url')) db.exec('ALTER TABLE users ADD COLUMN image_url TEXT');
  } catch (e) { console.warn('users column migration:', e.message); }

  try { require('./hcp/store').migrateHcp(db, tableColumns); } catch (e) { console.warn('HCP migration:', e.message); }

  const ensureCol = (table, col, ddl) => {
    if (!tableColumns(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  ensureCol('imports', 'file_hash', 'file_hash TEXT');
  ensureCol('imports', 'reporting_period', 'reporting_period TEXT');
  ensureCol('imports', 'started_at', 'started_at TEXT');
  ensureCol('imports', 'completed_at', 'completed_at TEXT');
  ensureCol('imports', 'successful_files', 'successful_files INTEGER DEFAULT 0');
  ensureCol('imports', 'failed_files', 'failed_files INTEGER DEFAULT 0');
  ensureCol('imports', 'warning_count', 'warning_count INTEGER DEFAULT 0');
  ensureCol('imports', 'error_count', 'error_count INTEGER DEFAULT 0');
  ensureCol('imports', 'reversed_by_import_id', 'reversed_by_import_id INTEGER');
  ensureCol('imports', 'runner_pid', 'runner_pid INTEGER');
  ensureCol('hcp_vehicle_events', 'event_hash', 'event_hash TEXT');
  ensureCol('hcp_vehicle_events', 'import_id', 'import_id INTEGER REFERENCES imports(id)');
  ensureCol('handover', 'event_hash', 'event_hash TEXT');
  ensureCol('handover', 'import_id', 'import_id INTEGER REFERENCES imports(id)');
  ensureCol('invitations', 'import_id', 'import_id INTEGER REFERENCES imports(id)');
  ensureCol('gate_passes', 'import_id', 'import_id INTEGER REFERENCES imports(id)');
  ensureCol('audit_log', 'actor_role', 'actor_role TEXT');
  ensureCol('audit_log', 'target_type', 'target_type TEXT');
  ensureCol('audit_log', 'target_id', 'target_id TEXT');
  ensureCol('audit_log', 'result', 'result TEXT');
  ensureCol('audit_log', 'correlation_id', 'correlation_id TEXT');
  ensureCol('audit_log', 'ip', 'ip TEXT');
  ensureCol('audit_log', 'before_json', 'before_json TEXT');
  ensureCol('audit_log', 'after_json', 'after_json TEXT');
  ensureCol('imports', 'uploaded_by', 'uploaded_by TEXT');
  ensureCol('imports', 'source_kind', 'source_kind TEXT');
  ensureCol('imports', 'compound_id', 'compound_id INTEGER REFERENCES compounds(id)');
  ensureCol('hcp_vehicle_events', 'source_kind', 'source_kind TEXT');
  ensureCol('hcp_vehicle_events', 'external_id', 'external_id TEXT');
  ensureCol('users', 'canonical_user_id', 'canonical_user_id INTEGER REFERENCES users(id)');
  ensureCol('users', 'is_canonical', 'is_canonical INTEGER NOT NULL DEFAULT 1');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_canonical ON users(canonical_user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_norm_canonical ON users(norm_name, is_canonical)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source_kind, compound_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_hcp_event_hash ON hcp_vehicle_events(event_hash)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ho_event_hash ON handover(event_hash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_hcp_import ON hcp_vehicle_events(import_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_gp_unit ON gate_passes(unit_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_gp_user ON gate_passes(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_hcp_owner ON hcp_vehicle_events(owner_user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_hcp_plate_latin ON hcp_vehicle_events(plate_normalized_latin)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_uu_status_unit ON user_units(status, unit_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_uu_status_user ON user_units(status, user_id)');
  const seed = {
    processing_version: '1.0.0',
    timezone: 'Africa/Cairo',
    parking_lot_compound: JSON.stringify({ 'Main Gate': 'Badya', D1V1A: 'Badya', D1V2A: 'Badya', D1V1B: 'Badya' }),
    ai_provider: 'local',
    ai_api_key: '',
    ai_model: '',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for (const [k, v] of Object.entries(seed)) ins.run(k, v);
  try { consolidateCanonicalResidents(); } catch (e) { console.warn('Resident canonicalization skipped:', e.message); }
  } finally {
    try { db.prepare('SELECT pg_advisory_unlock(?)').get(lockKey); } catch (_) { /* ignore */ }
  }
}

/** Append an audit event with request context when available. */
function auditEvent(event) {
  const ctx = auditContext.getStore() || {};
  const e = event || {};
  const actor = ctx.actor ? String(ctx.actor) : (e.actor && e.actor !== 'system' ? String(e.actor) : 'system');
  const actorRole = ctx.actorRole || e.actorRole || null;
  const correlationId = ctx.correlationId || e.correlationId || null;
  const ip = ctx.ip || e.ip || null;
  try {
    db.prepare(`INSERT INTO audit_log
      (ts, actor, actor_role, action, target_type, target_id, result, correlation_id, ip, detail, before_json, after_json)
      VALUES (NOW()::text, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        actor,
        actorRole,
        String(e.action || 'unknown'),
        e.targetType == null ? null : String(e.targetType),
        e.targetId == null ? null : String(e.targetId),
        e.result || 'OK',
        correlationId,
        ip,
        e.detail == null ? null : String(e.detail).slice(0, 4000),
        e.before == null ? null : JSON.stringify(e.before).slice(0, 8000),
        e.after == null ? null : JSON.stringify(e.after).slice(0, 8000)
      );
  } catch (err) {
    console.error('audit write failed:', err.message);
  }
}

function audit(action, detail, actor = 'system') {
  auditEvent({ action, detail, actor });
}

module.exports = { db, migrate, audit, auditEvent, auditContext, tableColumns, DB_PATH, DATA_DIR };
