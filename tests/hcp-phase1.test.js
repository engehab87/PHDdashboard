'use strict';
/* Phase 1 tests: hardened adapter selection, connectivity state machine,
   health-check failure/recovery, fail-closed sync gate, blocked-sync
   recording, and historical-data preservation.
   Hermetic: temp DB file + in-memory fixture certificates + loopback stubs.
   No live HCP server is contacted. */
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');

process.env.HCP_VAULT_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcp-phase1-test-'));
process.env.DB_PATH = path.join(tmpDir, 't.db');

const { db, migrate } = require('../backend/db');
const { migrateHcp, saveHcpConfig } = require('../backend/hcp/store');
const { matchAdapter, normVersion, resolveAdapter } = require('../backend/hcp/registry');
const { nextConnState, dueForCheck, checkConnectivity, getConnectivity, syncGate, startHealthScheduler } = require('../backend/hcp/health');
const { doSync } = require('../backend/hcp/routes');
const { makeLab } = require('./helpers/makecerts');

migrate();
migrateHcp(db);
db.prepare('INSERT INTO compounds(name) VALUES(?)').run('Phase1 Lab');
db.prepare('INSERT INTO compounds(name) VALUES(?)').run('Phase1 Sched');

after(() => { try { db.close(); } catch (_) {} try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} });

const lab = makeLab();

function serveTLS(cert, key) {
  const srv = https.createServer({ key, cert }, (req, res) => res.end('tls-ok'));
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}
function freePort() {
  const net = require('net');
  const s = net.createServer();
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }));
}

/* ---------- registry hardening ---------- */

test('selection is exact: no major-version prefix matching', () => {
  const entries = [{ adapterId: 'v2', hcpVersions: ['2.6.0'], openapiVersions: ['2.6'], verified: true }];
  assert.ok(matchAdapter(entries, { hcpVersion: '2.6.0', openapiVersion: '2.6' }));
  assert.equal(matchAdapter(entries, { hcpVersion: '2.6.1', openapiVersion: '2.6' }), null);
  assert.equal(matchAdapter(entries, { hcpVersion: '2.6', openapiVersion: '2.6' }), null);
  assert.equal(matchAdapter(entries, { hcpVersion: '2.6.0', openapiVersion: '2.7' }), null);
});

test('leading V prefix is normalized, matching stays exact', () => {
  assert.equal(normVersion('V2.6.0'), '2.6.0');
  const entries = [{ adapterId: 'v2', hcpVersions: ['2.6.0'], openapiVersions: [], verified: true }];
  assert.ok(matchAdapter(entries, { hcpVersion: 'V2.6.0', openapiVersion: '' }));
});

test('retired/empty entries match nothing; missing HCP version matches nothing', () => {
  assert.equal(matchAdapter([{ adapterId: 'retired', hcpVersions: [], openapiVersions: [] }], { hcpVersion: '2.6.0', openapiVersion: '' }), null);
  assert.equal(matchAdapter([{ adapterId: 'v2', hcpVersions: ['2.6.0'], openapiVersions: [] }], { hcpVersion: '', openapiVersion: '' }), null);
});

test('unidentified OpenAPI version allows HCP-only match; identified mismatch rejects', () => {
  const entries = [{ adapterId: 'v2', hcpVersions: ['2.6.0'], openapiVersions: ['2.6'], verified: false }];
  assert.ok(matchAdapter(entries, { hcpVersion: '2.6.0', openapiVersion: '' }));
  assert.equal(matchAdapter(entries, { hcpVersion: '2.6.0', openapiVersion: '3.1' }), null);
});

test('live registry: HCP 2.6.0 / OpenAPI 2.6 resolves to hcp-artemis-v26 (unverified)', () => {
  const a = resolveAdapter({ hcpVersion: '2.6.0', openapiVersion: '2.6' });
  assert.ok(a);
  assert.equal(a.adapterId, 'hcp-artemis-v26');
  assert.equal(a.verified, false);
});

test('migration neutralizes the retired generic claim on previously seeded DBs', () => {
  db.prepare(`UPDATE hcp_adapter_registry SET hcp_versions=?, openapi_versions=? WHERE adapter_id='hcp-openapi-v1-generic'`)
    .run('["2.x"]', '["1.x"]');
  migrateHcp(db);
  const row = db.prepare(`SELECT hcp_versions, openapi_versions, verified FROM hcp_adapter_registry WHERE adapter_id='hcp-openapi-v1-generic'`).get();
  assert.equal(row.hcp_versions, '[]');
  assert.equal(row.openapi_versions, '[]');
  assert.equal(row.verified, 0);
  assert.equal(resolveAdapter({ hcpVersion: '2.3', openapiVersion: '1.2' }), null);
});

/* ---------- connectivity state machine ---------- */

test('nextConnState: up resets, degraded observes, down backs off with cap', () => {
  assert.deepEqual(nextConnState({ state: 'down', fail_count: 3 }, 'up'), { state: 'up', fail_count: 0, backoff_s: 0 });
  assert.deepEqual(nextConnState({ state: 'up', fail_count: 0 }, 'degraded'), { state: 'degraded', fail_count: 0, backoff_s: 0 });
  assert.deepEqual(nextConnState({ state: 'unknown', fail_count: 0 }, 'down'), { state: 'down', fail_count: 1, backoff_s: 60 });
  assert.deepEqual(nextConnState({ state: 'down', fail_count: 1 }, 'down'), { state: 'down', fail_count: 2, backoff_s: 120 });
  assert.deepEqual(nextConnState({ state: 'down', fail_count: 99 }, 'down').backoff_s, 1800);
});

test('dueForCheck honors backoff and tolerates missing/garbage values', () => {
  assert.equal(dueForCheck(null), true);
  assert.equal(dueForCheck({}), true);
  assert.equal(dueForCheck({ backoff_until: 'not-a-date' }), true);
  const future = new Date(Date.now() + 60000).toISOString();
  const past = new Date(Date.now() - 60000).toISOString();
  assert.equal(dueForCheck({ backoff_until: future }), false);
  assert.equal(dueForCheck({ backoff_until: past }), true);
});

/* ---------- health observations against loopback stubs ---------- */

test('unreachable endpoint transitions to down with backoff and history', async () => {
  const port = await freePort();
  saveHcpConfig(db, 1, { hcpHost: '127.0.0.1', hcpPort: port, https: true, hcpVersion: '2.6.0', openapiVersion: '2.6', tlsVerify: true, versionSource: 'manual' });
  const r = await checkConnectivity(db, 1);
  assert.equal(r.state, 'down');
  assert.equal(r.fail_count, 1);
  const st = getConnectivity(db, 1);
  assert.equal(st.conn_state, 'down');
  assert.ok(st.backoff_until);
  assert.equal(st.last_up_at, null);
  const checks = db.prepare('SELECT COUNT(*) c FROM connectivity_checks WHERE compound_id=1').get().c;
  assert.ok(checks >= 1);
});

test('recovery: reachable verified endpoint transitions to up and resets', async () => {
  const { srv, port } = await serveTLS(lab.serverCert, lab.serverKey);
  try {
    saveHcpConfig(db, 1, { hcpHost: '127.0.0.1', hcpPort: port, https: true, hcpVersion: '2.6.0', openapiVersion: '2.6', tlsVerify: true, tlsCa: lab.caCert, versionSource: 'manual' });
    const r = await checkConnectivity(db, 1);
    assert.equal(r.state, 'up');
    assert.equal(r.fail_count, 0);
    const st = getConnectivity(db, 1);
    assert.equal(st.conn_state, 'up');
    assert.equal(st.backoff_until, null);
    assert.ok(st.last_up_at);
  } finally { srv.close(); }
});

test('unverifiable TLS is degraded, not up and not down', async () => {
  const { srv, port } = await serveTLS(lab.serverCert, lab.serverKey);
  try {
    saveHcpConfig(db, 1, { hcpHost: '127.0.0.1', hcpPort: port, https: true, hcpVersion: '2.6.0', openapiVersion: '2.6', tlsVerify: true, tlsCa: lab.decoyCaCert, versionSource: 'manual' });
    const r = await checkConnectivity(db, 1);
    assert.equal(r.state, 'degraded');
  } finally { srv.close(); }
});

/* ---------- fail-closed sync gate ---------- */

function gateSetup({ enabled = false, versions = true } = {}) {
  db.prepare(`INSERT INTO compound_integrations(compound_id, integration_enabled, integration_mode)
    VALUES(1,?, 'corporate-vpn') ON CONFLICT(compound_id) DO UPDATE SET integration_enabled=excluded.integration_enabled`).run(enabled ? 1 : 0);
  if (versions) saveHcpConfig(db, 1, { hcpHost: '127.0.0.1', hcpPort: 443, https: true, hcpVersion: '2.6.0', openapiVersion: '2.6', tlsVerify: true, versionSource: 'manual' });
}

test('gate blocks disabled integration, unknown/down connectivity, missing adapter, missing auth', async () => {
  db.prepare('DELETE FROM compound_connectivity WHERE compound_id=1').run();
  gateSetup({ enabled: false });
  let g = await syncGate(db, 1);
  assert.equal(g.allowed, false);
  assert.ok(g.reasons.some(r => r.code === 'SYNC_DISABLED'));
  assert.ok(g.reasons.some(r => r.code === 'CONNECTIVITY_UNKNOWN'));

  gateSetup({ enabled: true });
  db.prepare('INSERT OR IGNORE INTO compound_connectivity(compound_id) VALUES(1)').run();
  db.prepare(`UPDATE compound_connectivity SET conn_state='down', last_check_at=datetime('now') WHERE compound_id=1`).run();
  g = await syncGate(db, 1);
  assert.equal(g.allowed, false);
  assert.ok(g.reasons.some(r => r.code === 'CONNECTIVITY_DOWN'));

  db.prepare(`UPDATE compound_connectivity SET conn_state='up', last_check_at=datetime('now'), backoff_until=NULL WHERE compound_id=1`).run();
  g = await syncGate(db, 1);
  assert.equal(g.allowed, false);
  assert.ok(g.reasons.some(r => r.code === 'ADAPTER_UNVERIFIED'));
  assert.ok(g.reasons.some(r => r.code === 'AUTH_MISSING'));
});

test('gate blocks degraded connectivity and unverified adapters', async () => {
  gateSetup({ enabled: true });
  db.prepare('INSERT OR IGNORE INTO compound_connectivity(compound_id) VALUES(1)').run();
  db.prepare(`UPDATE compound_connectivity SET conn_state='degraded', last_check_at=datetime('now') WHERE compound_id=1`).run();
  const g = await syncGate(db, 1, { adapter: { adapterId: 'candidate', verified: false } });
  assert.equal(g.allowed, false);
  assert.ok(g.reasons.some(r => r.code === 'CONNECTIVITY_DEGRADED'));
  assert.ok(g.reasons.some(r => r.code === 'ADAPTER_UNVERIFIED'));
});

/* ---------- blocked sync is never recorded as success ---------- */

test('blocked fetch is recorded as blocked with zero records, history untouched', async () => {
  const before = {
    events: db.prepare('SELECT COUNT(*) c FROM hcp_live_events').get().c,
    persons: db.prepare('SELECT COUNT(*) c FROM hcp_live_persons').get().c,
  };
  const run = db.prepare(`INSERT INTO hcp_sync_runs(compound_id, adapter_id, schema_version) VALUES(1,'hcp-artemis-v26','hcp-normalized/1.0.0')`).run();
  const runId = Number(run.lastInsertRowid);
  await doSync(1, runId, { adapterId: 'hcp-artemis-v26', categories: '["persons","vehicles"]' });
  const row = db.prepare('SELECT status, retrieved, inserted, error_summary FROM hcp_sync_runs WHERE id=?').get(runId);
  assert.equal(row.status, 'blocked');
  assert.equal(row.retrieved, 0);
  assert.equal(row.inserted, 0);
  assert.match(row.error_summary, /blocked/i);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM hcp_live_events').get().c, before.events);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM hcp_live_persons').get().c, before.persons);
  assert.equal(db.prepare('SELECT last_sync_at FROM compound_integrations WHERE compound_id=1').get().last_sync_at, null);
});

/* ---------- historical data preservation ---------- */

test('health checks, gates and blocked syncs preserve existing data', async () => {
  db.prepare(`INSERT INTO reporting_periods(period_key, period_name, period_start, period_end, uploaded_at) VALUES('2026-09','x','2026-09-01','2026-09-30',datetime('now'))`).run();
  db.prepare(`INSERT INTO users(external_id, name) VALUES('u-1','Hist User')`).run();
  db.prepare(`INSERT INTO hcp_live_events(compound_id, category, source_id, event_time, provenance) VALUES(1,'access-events','ev-1','2026-09-01 10:00','live-hcp')`).run();
  const before = {
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    periods: db.prepare('SELECT COUNT(*) c FROM reporting_periods').get().c,
    live: db.prepare('SELECT COUNT(*) c FROM hcp_live_events').get().c,
  };
  const port = await freePort();
  saveHcpConfig(db, 1, { hcpHost: '127.0.0.1', hcpPort: port, https: true, hcpVersion: '2.6.0', openapiVersion: '2.6', tlsVerify: true, versionSource: 'manual' });
  await checkConnectivity(db, 1);
  const g = await syncGate(db, 1);
  assert.equal(g.allowed, false);
  const run = db.prepare(`INSERT INTO hcp_sync_runs(compound_id, adapter_id, schema_version) VALUES(1,'probe','hcp-normalized/1.0.0')`).run();
  await doSync(1, Number(run.lastInsertRowid), { adapterId: 'probe', categories: '["events"]' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before.users);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reporting_periods').get().c, before.periods);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM hcp_live_events').get().c, before.live);
});

/* ---------- scheduler ---------- */

test('scheduler observes on interval, backs off, and stops cleanly', async () => {
  const port = await freePort();
  saveHcpConfig(db, 2, { hcpHost: '127.0.0.1', hcpPort: port, https: true, tlsVerify: true, versionSource: 'manual' });
  db.prepare('DELETE FROM connectivity_checks WHERE compound_id=2').run();
  const sched = startHealthScheduler(db, { intervalMs: 120 });
  try {
    let st = null;
    for (let i = 0; i < 40 && (!st || st.fail_count < 1); i++) {
      await new Promise(r => setTimeout(r, 100));
      st = getConnectivity(db, 2);
    }
    assert.ok(st, 'scheduler produced a state row');
    assert.equal(st.conn_state, 'down');
    assert.equal(st.fail_count, 1); // backoff (60s) suppresses further ticks
    const checks = db.prepare('SELECT COUNT(*) c FROM connectivity_checks WHERE compound_id=2').get().c;
    assert.ok(checks >= 1);
    await new Promise(r => setTimeout(r, 400));
    assert.equal(getConnectivity(db, 2).fail_count, 1);
  } finally { sched.stop(); }
});
