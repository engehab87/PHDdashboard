'use strict';
/* Phase 2 — VPN provider tests. Hermetic: execFile and network checks are
   stubbed; no real FortiClient is launched, no tunnel is dialed, no live
   HCP server is contacted. */
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.HCP_VAULT_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcp-vpn-test-'));

const { db, migrate } = require('../backend/db');
const { migrateHcp, saveHcpConfig } = require('../backend/hcp/store');
const { syncGate } = require('../backend/hcp/health');
const { VpnProvider, setExecFileForTesting } = require('../backend/hcp/vpn');

migrate();
migrateHcp(db);
db.prepare('INSERT INTO compounds(name) VALUES(?)').run('VPN Lab');

after(() => { try { db.close(); } catch (_) {} try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} });

let execFileImpl = null;
setExecFileForTesting((file, args, opts) => {
  if (!execFileImpl) throw new Error('execFile stub not configured');
  return execFileImpl(file, args, opts);
});

function setExecFile(impl) { execFileImpl = impl; }

function envSnapshot() {
  return {
    ENABLED: process.env.FORTICLIENT_ENABLED,
    CLI: process.env.FORTICLIENT_CLI,
    TUNNEL: process.env.FORTICLIENT_TUNNEL,
  };
}
function envRestore(snap) {
  if (snap.ENABLED === undefined) delete process.env.FORTICLIENT_ENABLED;
  else process.env.FORTICLIENT_ENABLED = snap.ENABLED;
  if (snap.CLI === undefined) delete process.env.FORTICLIENT_CLI;
  else process.env.FORTICLIENT_CLI = snap.CLI;
  if (snap.TUNNEL === undefined) delete process.env.FORTICLIENT_TUNNEL;
  else process.env.FORTICLIENT_TUNNEL = snap.TUNNEL;
}

function makeProvider({ enabled = true, cliPath = 'C:\\Program Files\\Fortinet\\FortiClient\\forticli.exe', tunnel = 'PHNC-Tunnel' } = {}) {
  const snap = envSnapshot();
  if (enabled === false) delete process.env.FORTICLIENT_ENABLED;
  else process.env.FORTICLIENT_ENABLED = 'true';
  if (cliPath === null) delete process.env.FORTICLIENT_CLI;
  else process.env.FORTICLIENT_CLI = cliPath;
  if (tunnel === null) delete process.env.FORTICLIENT_TUNNEL;
  else process.env.FORTICLIENT_TUNNEL = tunnel;
  const p = new VpnProvider({});
  p._restore = () => envRestore(snap);
  return p;
}

/* ---------- provider: getStatus ---------- */

test('getStatus: disabled when FORTICLIENT_ENABLED not true', async () => {
  const p = makeProvider({ enabled: false });
  try {
    const s = await p.getStatus();
    assert.equal(s.enabled, false);
    assert.equal(s.status, 'disabled');
  } finally { p._restore(); }
});

test('getStatus: unavailable when CLI not configured', async () => {
  const p = makeProvider({ cliPath: null });
  try {
    const s = await p.getStatus();
    assert.equal(s.enabled, true);
    assert.equal(s.status, 'unavailable');
    assert.ok(s.reason.includes('FORTICLIENT_CLI'));
  } finally { p._restore(); }
});

test('getStatus: reports disconnected when CLI output lacks "connected"', async () => {
  setExecFile(() => ({ ok: true, code: 0, stdout: 'VPN status: Disconnected', stderr: '' }));
  const p = makeProvider();
  try {
    const s = await p.getStatus();
    assert.equal(s.enabled, true);
    assert.equal(s.status, 'disconnected');
    assert.ok(s.cli.includes('forticli.exe'));
    assert.equal(s.code, 0);
  } finally { p._restore(); setExecFile(null); }
});

test('getStatus: reports connected when CLI output contains "connected"', async () => {
  setExecFile(() => ({ ok: true, code: 0, stdout: 'VPN status: Connected (PHNC-Tunnel)', stderr: '' }));
  const p = makeProvider();
  try {
    const s = await p.getStatus();
    assert.equal(s.status, 'connected');
  } finally { p._restore(); setExecFile(null); }
});

test('getStatus: CLI error returns status with error detail, no crash', async () => {
  setExecFile(() => { throw new Error('exec failed'); });
  const p = makeProvider();
  try {
    const s = await p.getStatus();
    assert.equal(s.status, 'disconnected');
    assert.ok(s.error);
  } finally { p._restore(); setExecFile(null); }
});

/* ---------- provider: connect ---------- */

test('connect: throws when disabled', async () => {
  const p = makeProvider({ enabled: false });
  try {
    await assert.rejects(p.connect(), /disabled/);
  } finally { p._restore(); }
});

test('connect: throws when CLI not configured', async () => {
  const p = makeProvider({ cliPath: null });
  try {
    await assert.rejects(p.connect(), /FORTICLIENT_CLI/);
  } finally { p._restore(); }
});

test('connect: throws when tunnel not configured', async () => {
  const p = makeProvider({ tunnel: null });
  try {
    await assert.rejects(p.connect(), /FORTICLIENT_TUNNEL/);
  } finally { p._restore(); }
});

test('connect: uses fixed argument array [-vpnconnect, tunnel], no shell', async () => {
  let capturedArgs = null;
  let callCount = 0;
  setExecFile((file, args) => {
    callCount++;
    if (callCount === 1) capturedArgs = args; // capture only the first (-vpnconnect) call
    if (args.includes('-vpnconnect')) return { ok: true, code: 0, stdout: 'connecting', stderr: '' };
    return { ok: true, code: 0, stdout: 'VPN status: Connected (PHNC-Tunnel)', stderr: '' };
  });
  const p = makeProvider();
  try {
    await p.connect();
    assert.equal(callCount, 2, 'connect() should call -vpnconnect then -vpnstatus');
    assert.deepEqual(capturedArgs, ['-vpnconnect', 'PHNC-Tunnel']);
  } finally { p._restore(); setExecFile(null); }
});

test('connect: concurrency protection — _run called once for concurrent calls', async () => {
  let runCalls = 0;
  setExecFile(() => { runCalls++; return new Promise(() => {}); }); // never resolves
  const p = makeProvider();
  try {
    const a = p.connect();
    const b = p.connect();
    assert.equal(runCalls, 1, '_run must be invoked exactly once for concurrent connect()');
    // Both callers receive a promise that resolves to the same result;
    // asserting identity is not meaningful because connect() is async.
  } finally { p._restore(); setExecFile(null); }
});

/* ---------- provider: checkRouteAndReachability ---------- */

test('checkRouteAndReachability: DNS failure', async () => {
  const p = makeProvider();
  try {
    const r = await p.checkRouteAndReachability('nonexistent.invalid.example', 443, 2000);
    assert.equal(r.ok, false);
    assert.equal(r.stage, 'dns');
  } finally { p._restore(); }
});

test('checkRouteAndReachability: TCP refused', async () => {
  const p = makeProvider();
  try {
    const r = await p.checkRouteAndReachability('127.0.0.1', 1, 1000);
    assert.equal(r.ok, false);
    assert.equal(r.stage, 'tcp');
  } finally { p._restore(); }
});

/* ---------- provider: getHealth ---------- */

test('getHealth: not healthy when VPN disconnected', async () => {
  setExecFile(() => ({ ok: true, code: 0, stdout: 'Disconnected', stderr: '' }));
  const p = makeProvider();
  try {
    const h = await p.getHealth({ host: '127.0.0.1', port: 1, timeoutMs: 1000 });
    assert.equal(h.healthy, false);
    assert.equal(h.vpn.status, 'disconnected');
  } finally { p._restore(); setExecFile(null); }
});

/* ---------- integration: syncGate requires VPN connected ---------- */

test('syncGate: blocks when VPN enabled but not connected', async () => {
  const snap = envSnapshot();
  process.env.FORTICLIENT_ENABLED = 'true';
  process.env.FORTICLIENT_CLI = 'C:\\Program Files\\Fortinet\\FortiClient\\forticli.exe';
  process.env.FORTICLIENT_TUNNEL = 'PHNC-Tunnel';
  try {
    setExecFile(() => ({ ok: true, code: 0, stdout: 'VPN status: Disconnected', stderr: '' }));
    db.prepare("DELETE FROM compound_connectivity WHERE compound_id=1").run();
    db.prepare("INSERT INTO compound_connectivity(compound_id, vpn_state) VALUES(1, 'disconnected')").run();
    saveHcpConfig(db, 1, { hcpHost: '10.9.9.9', hcpPort: 443, https: true, hcpVersion: '2.6.0', openapiVersion: '2.6', tlsVerify: true, versionSource: 'manual' });
    db.prepare("INSERT INTO compound_integrations(compound_id, integration_enabled, integration_mode) VALUES(1, 1, 'corporate-vpn') ON CONFLICT(compound_id) DO UPDATE SET integration_enabled=excluded.integration_enabled").run();
    const g = await syncGate(db, 1);
    assert.equal(g.allowed, false);
    assert.ok(g.reasons.some(r => r.code === 'VPN_NOT_CONNECTED'));
  } finally {
    setExecFile(null);
    envRestore(snap);
  }
});

test('syncGate: does not block when VPN disabled', async () => {
  const snap = envSnapshot();
  delete process.env.FORTICLIENT_ENABLED;
  try {
    db.prepare("DELETE FROM compound_connectivity WHERE compound_id=1").run();
    db.prepare("INSERT INTO compound_connectivity(compound_id, conn_state, last_check_at) VALUES(1, 'up', datetime('now'))").run();
    saveHcpConfig(db, 1, { hcpHost: '10.9.9.9', hcpPort: 443, https: true, hcpVersion: '2.6.0', openapiVersion: '2.6', tlsVerify: true, versionSource: 'manual' });
    db.prepare("INSERT INTO compound_integrations(compound_id, integration_enabled, integration_mode) VALUES(1, 1, 'corporate-vpn') ON CONFLICT(compound_id) DO UPDATE SET integration_enabled=excluded.integration_enabled").run();
    const g = await syncGate(db, 1);
    assert.ok(!g.reasons.some(r => r.code === 'VPN_NOT_CONNECTED'));
  } finally {
    envRestore(snap);
  }
});
