'use strict';
/* HCP integration persistence: additive, non-destructive migrations on the
   existing SQLite DB. Reuses the existing `compounds` table — no parallel
   compound system. Secrets stored only as vault payloads (v1:...). */
const { encrypt, decrypt, vaultAvailable } = require('./crypto');
const { ADAPTERS, KNOWN_CATEGORIES } = require('./registry');

function migrateHcp(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS compound_integrations(
    compound_id INTEGER PRIMARY KEY REFERENCES compounds(id) ON DELETE CASCADE,
    integration_enabled INTEGER DEFAULT 0,
    integration_mode TEXT DEFAULT 'corporate-vpn',
    config_status TEXT DEFAULT 'draft',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_test_at TEXT, last_success_at TEXT, last_sync_at TEXT
  );
  CREATE TABLE IF NOT EXISTS compound_network(
    compound_id INTEGER PRIMARY KEY REFERENCES compounds(id) ON DELETE CASCADE,
    vpn_host TEXT, vpn_port INTEGER, vpn_protocol TEXT DEFAULT 'corporate-vpn',
    vpn_username TEXT, vpn_password_enc TEXT, extra_config TEXT,
    conn_timeout_ms INTEGER DEFAULT 8000,
    net_status TEXT DEFAULT 'unknown', last_test_at TEXT, last_success_at TEXT
  );
  CREATE TABLE IF NOT EXISTS compound_hcp(
    compound_id INTEGER PRIMARY KEY REFERENCES compounds(id) ON DELETE CASCADE,
    hcp_host TEXT, hcp_port INTEGER DEFAULT 443, https INTEGER DEFAULT 1,
    hcp_version TEXT, hcp_build TEXT, openapi_version TEXT, openapi_build TEXT,
    base_url TEXT, conn_timeout_ms INTEGER DEFAULT 8000, read_timeout_ms INTEGER DEFAULT 15000,
    tls_verify INTEGER DEFAULT 1, tls_ca TEXT,
    version_source TEXT DEFAULT 'manual', detected_hcp_version TEXT,
    detected_openapi_version TEXT, version_status TEXT DEFAULT 'unverified',
    last_api_ok_at TEXT
  );
  CREATE TABLE IF NOT EXISTS compound_credentials(
    compound_id INTEGER PRIMARY KEY REFERENCES compounds(id) ON DELETE CASCADE,
    app_key TEXT, app_secret_enc TEXT, auth_status TEXT DEFAULT 'unknown',
    last_auth_ok_at TEXT, last_auth_error TEXT, perm_status TEXT DEFAULT 'unknown',
    cred_updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS hcp_adapter_registry(
    adapter_id TEXT PRIMARY KEY, label TEXT, hcp_versions TEXT, openapi_versions TEXT,
    doc_title TEXT, doc_location TEXT, doc_revision TEXT, auth TEXT,
    categories TEXT, limitations TEXT, verified INTEGER DEFAULT 0, last_verified TEXT
  );
  CREATE TABLE IF NOT EXISTS hcp_test_runs(
    id INTEGER PRIMARY KEY AUTOINCREMENT, compound_id INTEGER REFERENCES compounds(id),
    kind TEXT DEFAULT 'connection', status TEXT DEFAULT 'running',
    started_at TEXT DEFAULT (datetime('now')), finished_at TEXT, summary TEXT
  );
  CREATE TABLE IF NOT EXISTS hcp_test_stages(
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER REFERENCES hcp_test_runs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL, status TEXT DEFAULT 'pending',
    started_at TEXT, duration_ms INTEGER, message TEXT, action TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_hcp_stages_run ON hcp_test_stages(run_id);
  CREATE TABLE IF NOT EXISTS hcp_sync_runs(
    id INTEGER PRIMARY KEY AUTOINCREMENT, compound_id INTEGER REFERENCES compounds(id),
    adapter_id TEXT, schema_version TEXT, status TEXT DEFAULT 'running',
    started_at TEXT DEFAULT (datetime('now')), finished_at TEXT, duration_ms INTEGER,
    retrieved INTEGER DEFAULT 0, inserted INTEGER DEFAULT 0, duplicates INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0, error_summary TEXT
  );
  CREATE TABLE IF NOT EXISTS hcp_capabilities(
    compound_id INTEGER REFERENCES compounds(id) ON DELETE CASCADE,
    adapter_id TEXT, category TEXT, state TEXT DEFAULT 'unknown', detail TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(compound_id, category)
  );
  CREATE TABLE IF NOT EXISTS hcp_live_persons(
    id INTEGER PRIMARY KEY AUTOINCREMENT, compound_id INTEGER REFERENCES compounds(id),
    source_id TEXT, name TEXT, user_type TEXT, unit_ref TEXT,
    hcp_version TEXT, openapi_version TEXT, adapter_id TEXT, schema_version TEXT,
    source_time TEXT, retrieved_at TEXT, provenance TEXT DEFAULT 'live-hcp',
    UNIQUE(compound_id, source_id)
  );
  CREATE TABLE IF NOT EXISTS hcp_live_vehicles(
    id INTEGER PRIMARY KEY AUTOINCREMENT, compound_id INTEGER REFERENCES compounds(id),
    source_id TEXT, plate TEXT, owner_ref TEXT,
    hcp_version TEXT, adapter_id TEXT, schema_version TEXT,
    source_time TEXT, retrieved_at TEXT, provenance TEXT DEFAULT 'live-hcp',
    UNIQUE(compound_id, source_id)
  );
  CREATE TABLE IF NOT EXISTS hcp_live_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT, compound_id INTEGER REFERENCES compounds(id),
    category TEXT, source_id TEXT, event_time TEXT, gate TEXT, direction TEXT,
    result TEXT, method TEXT, ref_person TEXT, ref_plate TEXT,
    hcp_version TEXT, openapi_version TEXT, adapter_id TEXT, schema_version TEXT,
    retrieved_at TEXT, provenance TEXT DEFAULT 'live-hcp', raw_json TEXT,
    UNIQUE(compound_id, category, source_id)
  );
  CREATE INDEX IF NOT EXISTS idx_live_events_compound ON hcp_live_events(compound_id, event_time);
  /* ---- Phase 1: independently-managed connectivity state (Oct 2026) ----
     The backend cannot establish VPN tunnels; this layer records WHICH
     tunnel/gateway each compound must use (link_ref, reference only — never
     secrets), the observed state, and health-check history. Sync gates read
     this state. All tables are additive; existing rows are never rewritten
     except the retired generic registry claim below. */
  CREATE TABLE IF NOT EXISTS compound_connectivity(
    compound_id INTEGER PRIMARY KEY REFERENCES compounds(id) ON DELETE CASCADE,
    link_ref TEXT,
    vpn_state TEXT DEFAULT 'unknown',
    vpn_tunnel TEXT,
    vpn_last_check TEXT,
    conn_state TEXT DEFAULT 'unknown',
    last_check_at TEXT,
    last_up_at TEXT,
    fail_count INTEGER DEFAULT 0,
    backoff_until TEXT,
    check_interval_s INTEGER DEFAULT 300,
    timeout_ms INTEGER DEFAULT 8000
  );
  CREATE TABLE IF NOT EXISTS connectivity_checks(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compound_id INTEGER REFERENCES compounds(id) ON DELETE CASCADE,
    checked_at TEXT DEFAULT (datetime('now')),
    state TEXT,
    latency_ms INTEGER,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_conn_checks_compound ON connectivity_checks(compound_id);
  /* Sync cursors for incremental resume after outages (consumed by Phase 2
     adapters; created now so the schema is stable before any live sync). */
  CREATE TABLE IF NOT EXISTS hcp_sync_cursors(
    compound_id INTEGER REFERENCES compounds(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    cursor TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(compound_id, category)
  );
  `);
  const ins = db.prepare(`INSERT OR IGNORE INTO hcp_adapter_registry
    (adapter_id,label,hcp_versions,openapi_versions,doc_title,doc_location,doc_revision,auth,categories,limitations,verified,last_verified)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const a of ADAPTERS) {
    ins.run(a.adapterId, a.label, JSON.stringify(a.hcpVersions), JSON.stringify(a.openapiVersions),
      a.docTitle, a.docLocation, a.docRevision, a.auth, JSON.stringify(a.categories),
      a.limitations, a.verified ? 1 : 0, a.lastVerified);
  }
  // Phase 1 data migration: withdraw the retired generic 2.x/1.x claim on
  // databases seeded earlier. Only touches the unverified template row;
  // verified or administrator-edited rows are never rewritten.
  db.prepare(`UPDATE hcp_adapter_registry SET hcp_versions=?, openapi_versions=?, label=?, limitations=?
    WHERE adapter_id='hcp-openapi-v1-generic' AND (verified=0 OR verified IS NULL)`).run(
    '[]', '[]',
    'RETIRED template — matches nothing (former unverified 2.x/1.x claim withdrawn)',
    'Retired Phase-1: this template previously claimed unverified HCP 2.x compatibility and now matches no version. Live API remains blocked until a version-specific, guide-backed adapter is implemented.');

  // Phase 2: additive columns on pre-existing connectivity table (live-DB safe).
  const ensureCol = (table, col, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  ensureCol('compound_connectivity', 'vpn_state', `vpn_state TEXT DEFAULT 'unknown'`);
  ensureCol('compound_connectivity', 'vpn_tunnel', `vpn_tunnel TEXT`);
  ensureCol('compound_connectivity', 'vpn_last_check', `vpn_last_check TEXT`);
  // HCP camera index code required by crossRecords/page; additive.
  ensureCol('compound_hcp', 'camera_index_code', `camera_index_code TEXT`);
  ensureCol('compound_hcp', 'camera_index_codes', `camera_index_codes TEXT`);
  ensureCol('compound_hcp', 'vehicle_group_index_codes', `vehicle_group_index_codes TEXT`);
  ensureCol('compound_hcp', 'parking_lot_index_codes', `parking_lot_index_codes TEXT`);
}

function maskSecrets(obj) {
  if (Array.isArray(obj)) return obj.map(maskSecrets);
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (/secret|password|token/i.test(k)) {
      out[k] = out[k] ? '***set***' : null;
    } else if (out[k] && typeof out[k] === 'object') {
      out[k] = maskSecrets(out[k]);
    }
  }
  return out;
}
function sanitize(row) {
  // Strip anything secret-like before returning to frontend / audit.
  return maskSecrets(row);
}

function maskHost(host, isAdmin) {
  if (isAdmin) return host;
  if (!host) return host;
  // Non-admins see only zone hint, not internal IPs.
  return 'internal-host (masked)';
}

/* Pure configuration validation. Never rewrites anything — returns warnings
   for the UI and the connection test to display. The saved setting is always
   preserved as the administrator entered it. */
function validateHcpConfig(h) {
  const errors = [];
  const warnings = [];
  const cfg = h || {};
  const port = Number(cfg.hcpPort || cfg.hcp_port || 443);
  const https = cfg.https === false || cfg.https === 0 ? false : true;
  if (!https && port === 443) {
    warnings.push({ code: 'HTTPS_DISABLED_ON_443',
      message: 'HTTPS is disabled while port 443 (the TLS port) is configured. A TLS-speaking server will reject plaintext HTTP (typically HTTP 400). Re-enable HTTPS unless the server genuinely serves plaintext HTTP on 443.' });
  }
  const tlsVerify = cfg.tlsVerify === false || cfg.tls_verify === 0 ? false : true;
  if (tlsVerify === false) {
    warnings.push({ code: 'TLS_VERIFY_DISABLED',
      message: 'TLS certificate verification is disabled. VPN tunnel provides transport encryption; API requests proceed without certificate validation.' });
  }
  const ca = cfg.tlsCa != null ? cfg.tlsCa : cfg.tls_ca;
  if (ca && !String(ca).includes('BEGIN CERTIFICATE')) {
    errors.push({ code: 'TLS_CA_INVALID',
      message: 'Custom CA does not look like PEM (missing BEGIN CERTIFICATE) and will be ignored. Paste the full PEM block.' });
  }
  return { errors, warnings };
}

/* Persist the compound_hcp row. Extracted so routes and tests share one path.
   `h` uses the PUT-body shape ({ hcpHost, hcpPort, https, ..., tlsCa }). */
function saveHcpConfig(db, cid, h) {
  const c = h || {};
  db.prepare(`INSERT INTO compound_hcp(compound_id, hcp_host, hcp_port, https, hcp_version, hcp_build, openapi_version, openapi_build,
    base_url, conn_timeout_ms, read_timeout_ms, tls_verify, tls_ca, version_source)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(compound_id) DO UPDATE SET hcp_host=excluded.hcp_host, hcp_port=excluded.hcp_port,
    https=excluded.https, hcp_version=excluded.hcp_version, hcp_build=excluded.hcp_build, openapi_version=excluded.openapi_version,
    openapi_build=excluded.openapi_build, base_url=excluded.base_url, conn_timeout_ms=excluded.conn_timeout_ms,
    read_timeout_ms=excluded.read_timeout_ms, tls_verify=excluded.tls_verify, tls_ca=excluded.tls_ca, version_source=excluded.version_source`)
    .run(cid, c.hcpHost || null, c.hcpPort || 443, c.https === false ? 0 : 1, c.hcpVersion || null,
      c.hcpBuild || null, c.openapiVersion || null, c.openapiBuild || null, c.baseUrl || null,
      c.connTimeoutMs || 8000, c.readTimeoutMs || 15000, (c.tlsVerify === false || c.tlsVerify === 0) ? 0 : 1,
      c.tlsCa || null, c.versionSource || 'manual');
}

function getHcpConfig(db, cid) {
  return db.prepare('SELECT * FROM compound_hcp WHERE compound_id=?').get(cid) || null;
}

module.exports = { migrateHcp, sanitize, maskHost, KNOWN_CATEGORIES, encrypt, decrypt, vaultAvailable, validateHcpConfig, saveHcpConfig, getHcpConfig };
