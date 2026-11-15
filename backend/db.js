'use strict';
/* SQLite data-access layer (node:sqlite, built-in). Swappable for Postgres later. */
const { DatabaseSync } = require('node:sqlite');
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('fs');
const path = require('path');

const auditContext = new AsyncLocalStorage();

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 30000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reporting_periods(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER REFERENCES reporting_periods(id),
  detected_period_key TEXT,
  uploaded_at TEXT NOT NULL,
  source_filename TEXT,
  status TEXT DEFAULT 'staged',
  progress TEXT,
  log TEXT
);
CREATE TABLE IF NOT EXISTS raw_files(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  code TEXT,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS compound_aliases(
  alias TEXT PRIMARY KEY,
  compound_id INTEGER NOT NULL REFERENCES compounds(id)
);
CREATE TABLE IF NOT EXISTS units(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  is_canonical INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_users_normname ON users(norm_name);
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(norm_mobile);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE TABLE IF NOT EXISTS user_units(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
CREATE TABLE IF NOT EXISTS vehicles(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
CREATE TABLE IF NOT EXISTS hcp_vehicle_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
CREATE TABLE IF NOT EXISTS handover(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER REFERENCES reporting_periods(id),
  unit_code TEXT,
  unit_id INTEGER REFERENCES units(id),
  category TEXT, zone TEXT,
  handover_date TEXT,
  finishing TEXT, resident TEXT,
  planned_delivery TEXT
);
CREATE TABLE IF NOT EXISTS identity_maps(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  value_text TEXT,
  PRIMARY KEY(period_id, metric_key, compound_id)
);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT DEFAULT 'system',
  action TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT
);
/* ---- Security: local identity, sessions and compound scope ---- */
CREATE TABLE IF NOT EXISTS dashboard_users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_sessions(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES dashboard_users(id),
  token_hash TEXT UNIQUE NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE TABLE IF NOT EXISTS user_compound_scopes(
  user_id INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  compound_id INTEGER NOT NULL REFERENCES compounds(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, compound_id)
);
/* ---- Phase 2: monthly import engine ---- */
CREATE TABLE IF NOT EXISTS source_files(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES imports(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT DEFAULT 'info',
  phase TEXT,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_log_import ON import_log(import_id);
CREATE TABLE IF NOT EXISTS event_fingerprints(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  import_id INTEGER REFERENCES imports(id),
  period_key TEXT,
  change_type TEXT NOT NULL,
  name TEXT, mobile TEXT, email TEXT, national_id TEXT, marital_status TEXT,
  status TEXT, registered_as TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_hist_user ON user_history(user_id);
CREATE TABLE IF NOT EXISTS unit_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  import_id INTEGER REFERENCES imports(id),
  period_key TEXT,
  change_type TEXT NOT NULL,
  unit_number TEXT, compound_id INTEGER, related_unit TEXT,
  gate_suspension TEXT, rent_suspension TEXT, maint_fees TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_unit_hist_unit ON unit_history(unit_id);
CREATE TABLE IF NOT EXISTS vehicle_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  import_id INTEGER REFERENCES imports(id),
  period_key TEXT,
  change_type TEXT NOT NULL,
  make TEXT, model TEXT, year TEXT, plate_original TEXT,
  user_id INTEGER, status TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicle_hist_vehicle ON vehicle_history(vehicle_id);
CREATE TABLE IF NOT EXISTS user_unit_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_unit_id INTEGER NOT NULL,
  import_id INTEGER REFERENCES imports(id),
  period_key TEXT,
  change_type TEXT NOT NULL,
  user_id INTEGER, unit_id INTEGER, compound_id INTEGER,
  access_type TEXT, invitation_provider TEXT, status TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_uu_hist_uu ON user_unit_history(user_unit_id);
CREATE TABLE IF NOT EXISTS duplicate_records(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES imports(id),
  filename TEXT,
  dataset_type TEXT,
  record_key TEXT,
  reason TEXT NOT NULL,
  original_import_id INTEGER REFERENCES imports(id),
  action TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dup_import ON duplicate_records(import_id);
CREATE TABLE IF NOT EXISTS changed_records(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES imports(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  entity_key TEXT,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chg_import ON changed_records(import_id, entity_type);
CREATE TABLE IF NOT EXISTS period_snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_key TEXT NOT NULL,
  import_id INTEGER REFERENCES imports(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  master_counts TEXT,
  metrics TEXT,
  UNIQUE(period_key, import_id)
);
`;

/* Canonical-resident consolidation.
   A normalized resident name may have one real CRM identity (external_id)
   plus import-created stub rows without an external CRM id. The real CRM
   record is the unique operational reference: move unit, vehicle, event
   and history links from the stubs to it. Groups with multiple real CRM
   identities are ambiguous and are never merged automatically. */
function consolidateCanonicalResidents() {
  const mappings = db.prepare(`
    WITH real AS (
      SELECT norm_name, MIN(id) AS canonical_id
      FROM users
      WHERE norm_name IS NOT NULL AND TRIM(IFNULL(external_id, '')) <> ''
      GROUP BY norm_name
      HAVING COUNT(*) = 1
    )
    SELECT aliasUser.id AS stub_id, real.canonical_id AS canonical_id, real.norm_name AS norm_name
    FROM users aliasUser
    JOIN real ON real.norm_name = aliasUser.norm_name
    WHERE TRIM(IFNULL(aliasUser.external_id, '')) = ''
      AND aliasUser.id <> real.canonical_id
      AND (aliasUser.canonical_user_id IS NULL OR aliasUser.canonical_user_id <> real.canonical_id)
  `).all();
  if (!mappings.length) return { mappings: 0 };

  const backupDir = path.join(DATA_DIR, 'backups');
  try {
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(backupDir, `app-before-canonical-residents-${ts}.db`);
    if (!fs.existsSync(target)) {
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (_) {}
      fs.copyFileSync(DB_PATH, target);
    }
  } catch (e) {
    console.warn('Canonical-resident backup skipped:', e.message);
  }

  const relinks = [
    ['user_units', 'user_id'],
    ['vehicles', 'user_id'],
    ['gate_passes', 'user_id'],
    ['hcp_vehicle_events', 'owner_user_id'],
    ['identity_maps', 'crm_user_id'],
  ];
  let users = 0, relations = 0;
  db.exec('BEGIN');
  try {
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
    for (const m of mappings) {
      userStmt.run(m.canonical_id, m.stub_id);
      users++;
    }
    db.exec('DROP TABLE IF EXISTS canonical_resident_names');
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
  db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('resident_identity_canonicalization',?)")
    .run(`merged=${users};relations=${relations};at=${new Date().toISOString()}`);
  try { audit('resident.identity.canonicalized', `Canonicalized ${users} duplicate resident stubs and relinked ${relations} relationships`); } catch (_) {}
  return { mappings: users, relations };
}

function migrate() {
  db.exec(SCHEMA);
// Non-destructive column additions for resident filters (gender, passport).
try {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(r => r.name);
  if (cols.indexOf('gender') === -1) db.exec('ALTER TABLE users ADD COLUMN gender TEXT');
  if (cols.indexOf('passport') === -1) db.exec('ALTER TABLE users ADD COLUMN passport TEXT');
} catch (e) { console.warn('users column migration:', e.message); }

  try { require('./hcp/store').migrateHcp(db); } catch (e) { console.warn('HCP migration:', e.message); }
  // Phase 2: additive columns on pre-existing tables (guarded — live DB safe).
  const ensureCol = (table, col, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  ensureCol('imports', 'file_hash', `file_hash TEXT`);
  ensureCol('imports', 'reporting_period', `reporting_period TEXT`);
  ensureCol('imports', 'started_at', `started_at TEXT`);
  ensureCol('imports', 'completed_at', `completed_at TEXT`);
  ensureCol('imports', 'successful_files', `successful_files INTEGER DEFAULT 0`);
  ensureCol('imports', 'failed_files', `failed_files INTEGER DEFAULT 0`);
  ensureCol('imports', 'warning_count', `warning_count INTEGER DEFAULT 0`);
  ensureCol('imports', 'error_count', `error_count INTEGER DEFAULT 0`);
  ensureCol('imports', 'reversed_by_import_id', `reversed_by_import_id INTEGER`);
  ensureCol('imports', 'runner_pid', `runner_pid INTEGER`);
  ensureCol('hcp_vehicle_events', 'event_hash', `event_hash TEXT`);
  ensureCol('hcp_vehicle_events', 'import_id', `import_id INTEGER REFERENCES imports(id)`);
  ensureCol('handover', 'event_hash', `event_hash TEXT`);
  ensureCol('handover', 'import_id', `import_id INTEGER REFERENCES imports(id)`);
  ensureCol('invitations', 'import_id', `import_id INTEGER REFERENCES imports(id)`);
  ensureCol('gate_passes', 'import_id', `import_id INTEGER REFERENCES imports(id)`);
  // Audit governance columns (additive; legacy rows keep NULL).
  ensureCol('audit_log', 'actor_role', `actor_role TEXT`);
  ensureCol('audit_log', 'target_type', `target_type TEXT`);
  ensureCol('audit_log', 'target_id', `target_id TEXT`);
  ensureCol('audit_log', 'result', `result TEXT`);
  ensureCol('audit_log', 'correlation_id', `correlation_id TEXT`);
  ensureCol('audit_log', 'ip', `ip TEXT`);
  ensureCol('audit_log', 'before_json', `before_json TEXT`);
  ensureCol('audit_log', 'after_json', `after_json TEXT`);
  ensureCol('imports', 'uploaded_by', `uploaded_by TEXT`);
  ensureCol('imports', 'source_kind', `source_kind TEXT`);
  ensureCol('imports', 'compound_id', `compound_id INTEGER REFERENCES compounds(id)`);
  ensureCol('hcp_vehicle_events', 'source_kind', `source_kind TEXT`);
  ensureCol('hcp_vehicle_events', 'external_id', `external_id TEXT`);
  ensureCol('users', 'canonical_user_id', `canonical_user_id INTEGER REFERENCES users(id)`);
  ensureCol('users', 'is_canonical', `is_canonical INTEGER NOT NULL DEFAULT 1`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_canonical ON users(canonical_user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_norm_canonical ON users(norm_name, is_canonical)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source_kind, compound_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_hcp_event_hash ON hcp_vehicle_events(event_hash)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ho_event_hash ON handover(event_hash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_hcp_import ON hcp_vehicle_events(import_id)');
  // Per-row lookup indexes: list/search pages run these per displayed row; without
  // them a single page view triggers full scans of the 100k-row event tables and
  // blocks the single-threaded server for minutes.
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
}

/**
 * Append an audit event. Actor/role/correlation/IP are taken from the request
 * context when present, so existing `audit(action, detail)` call sites are
 * automatically attributed to the authenticated user.
 */
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
      VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
    // Auditing must never break a request; surface on stderr for operations.
    console.error('audit write failed:', err.message);
  }
}

function audit(action, detail, actor = 'system') {
  auditEvent({ action, detail, actor });
}

module.exports = { db, migrate, audit, auditEvent, auditContext, DB_PATH, DATA_DIR };
