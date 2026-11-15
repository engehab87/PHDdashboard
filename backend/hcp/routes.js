'use strict';
/* HCP integration REST API (mounted at /api/hcp).
   Auth model: the app has no login layer (trusted intranet, see SRS §3).
   State-changing endpoints require { confirm:true }-style explicit intent where
   destructive, are audit-logged, and never return secrets. Deployment behind
   the internet MUST add real authN/Z in front (documented in HCP_INTEGRATION.md). */
const express = require('express');
const { db, audit } = require('../db');
const { encrypt, decrypt, vaultAvailable, keyInstructions } = require('./crypto');
const { sanitize, validateHcpConfig, saveHcpConfig, getHcpConfig } = require('./store');
const { resolveAdapter, normVersion } = require('./registry');
const { dnsLookup, tcpConnect, tlsHandshake, tlsInspect, httpsGet } = require('./netcheck');
const { withRetry } = require('./adapters/generic');
const { HcpArtemisV26Adapter, artemisRequest } = require('./adapters/artemis-v26');
const { ensureConnectivityRow, getConnectivity, recentChecks, checkConnectivity, syncGate } = require('./health');
const { VpnProvider } = require('./vpn');

const router = express.Router();
/* Phase 1 diagnostic stages — exactly these nine, in order. Later stages never
   claim what earlier ones did not prove: TCP success is not API
   compatibility, and a web-UI HTTP response is not API compatibility. */
const STAGES = ['vpn-state', 'route-tcp', 'tls', 'service-reach',
  'version-identify', 'adapter-compat', 'auth', 'readonly-op', 'sync-state'];

/* Adapter class map: registry adapterId -> adapter class. Only verified or
   verifiable adapters are listed. The GenericAdapter is a docs-pending stub
   and is never instantiated for live use. */
const ADAPTER_CLASSES = {
  'hcp-artemis-v26': HcpArtemisV26Adapter,
  'hcp-artemis-v30': HcpArtemisV26Adapter,
  'hcp-artemis-v31': HcpArtemisV26Adapter,
  'hcp-artemis-v32': HcpArtemisV26Adapter,
};

function adapterClassFor(adapterId) {
  return ADAPTER_CLASSES[adapterId] || null;
}

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function getFull(compoundId) {
  const compound = db.prepare('SELECT id, name, code FROM compounds WHERE id=?').get(compoundId);
  if (!compound) return null;
  const integ = db.prepare('SELECT * FROM compound_integrations WHERE compound_id=?').get(compoundId) || {};
  const net = db.prepare('SELECT * FROM compound_network WHERE compound_id=?').get(compoundId) || {};
  const conn = db.prepare('SELECT * FROM compound_connectivity WHERE compound_id=?').get(compoundId) || {};
  const hcp = db.prepare('SELECT * FROM compound_hcp WHERE compound_id=?').get(compoundId) || {};
  const cred = db.prepare('SELECT * FROM compound_credentials WHERE compound_id=?').get(compoundId) || {};
  const caps = db.prepare('SELECT category, state, detail, updated_at FROM hcp_capabilities WHERE compound_id=?').all(compoundId);
  const lastRun = db.prepare('SELECT * FROM hcp_test_runs WHERE compound_id=? ORDER BY id DESC LIMIT 1').get(compoundId) || null;
  const lastSync = db.prepare('SELECT * FROM hcp_sync_runs WHERE compound_id=? ORDER BY id DESC LIMIT 1').get(compoundId) || null;
  return sanitize({ compound, integ, net, conn, hcp, cred, caps, lastRun, lastSync,
    liveCounts: {
      persons: count('hcp_live_persons', compoundId), vehicles: count('hcp_live_vehicles', compoundId),
      events: count('hcp_live_events', compoundId),
    }});
}
function count(t, cid) { try { return db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE compound_id=?`).get(cid).c; } catch (_) { return 0; } }

/* ---------- overview: one row per compound ---------- */
router.get('/compounds', (req, res) => {
  const comps = db.prepare('SELECT id, name FROM compounds ORDER BY name').all();
  res.json(comps.map(c => {
    const f = getFull(c.id);
    return {
      id: c.id, name: c.name,
      integrationMode: (f.integ && f.integ.integration_mode) || 'corporate-vpn',
      enabled: !!(f.integ && f.integ.integration_enabled),
      configStatus: (f.integ && f.integ.config_status) || 'draft',
      netStatus: (f.conn && (f.conn.conn_state || f.conn.vpn_state)) || (f.net && f.net.net_status) || 'unknown',
      hcpHost: (f.hcp && f.hcp.hcp_host) || null,
      hcpVersion: (f.hcp && f.hcp.hcp_version) || null,
      detectedHcp: (f.hcp && f.hcp.detected_hcp_version) || null,
      openapiVersion: (f.hcp && f.hcp.openapi_version) || null,
      versionStatus: (f.hcp && f.hcp.version_status) || 'unverified',
      authStatus: (f.cred && f.cred.auth_status) || 'unknown',
      permStatus: (f.cred && f.cred.perm_status) || 'unknown',
      caps: f.caps, lastTest: f.lastRun, lastSync: f.lastSync,
    };
  }));
});

/* ---------- create compound (reuses compounds table) ---------- */
router.post('/compounds', (req, res) => {
  const { name, description } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Compound name required.' });
  try {
    const r = db.prepare('INSERT INTO compounds(name) VALUES(?)').run(String(name).trim());
    db.prepare('INSERT OR IGNORE INTO compound_integrations(compound_id, notes) VALUES(?,?)').run(r.lastInsertRowid, description || null);
    audit('hcp.compound.create', `compound ${r.lastInsertRowid} (${name})`);
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(400).json({ error: 'A compound with this name already exists — edit it instead.' });
    res.status(500).json({ error: e.message });
  }
});

/* ---------- detail ---------- */
router.get('/compounds/:id', (req, res) => {
  const f = getFull(req.params.id);
  if (!f) return res.status(404).json({ error: 'Compound not found' });
  res.json(f);
});

/* ---------- update (blank secret fields preserve existing) ---------- */
router.put('/compounds/:id', (req, res) => {
  const cid = Number(req.params.id);
  const compound = db.prepare('SELECT id FROM compounds WHERE id=?').get(cid);
  if (!compound) return res.status(404).json({ error: 'Compound not found' });
  const b = req.body || {};
  try {
    if (b.name) db.prepare('UPDATE compounds SET name=? WHERE id=?').run(String(b.name).trim(), cid);
    db.prepare(`INSERT INTO compound_integrations(compound_id, integration_enabled, integration_mode, config_status, notes, updated_at)
      VALUES(?,?,?,?,?,datetime('now')) ON CONFLICT(compound_id) DO UPDATE SET
      integration_enabled=excluded.integration_enabled, integration_mode=excluded.integration_mode,
      config_status=excluded.config_status, notes=excluded.notes, updated_at=datetime('now')`)
      .run(cid, b.enabled ? 1 : 0, b.integrationMode || 'corporate-vpn', b.configStatus || 'draft', b.notes || null);
    const n = b.network || {};
    const prevNet = db.prepare('SELECT vpn_password_enc FROM compound_network WHERE compound_id=?').get(cid);
    let pwdEnc = prevNet ? prevNet.vpn_password_enc : null;
    if (n.vpnPassword && n.vpnPassword !== '***set***') {
      if (!vaultAvailable()) return res.status(503).json({ error: keyInstructions() });
      pwdEnc = encrypt(n.vpnPassword);
    }
    db.prepare(`INSERT INTO compound_network(compound_id, vpn_host, vpn_port, vpn_protocol, vpn_username, vpn_password_enc, extra_config, conn_timeout_ms)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(compound_id) DO UPDATE SET vpn_host=excluded.vpn_host, vpn_port=excluded.vpn_port,
      vpn_protocol=excluded.vpn_protocol, vpn_username=excluded.vpn_username, vpn_password_enc=excluded.vpn_password_enc,
      extra_config=excluded.extra_config, conn_timeout_ms=excluded.conn_timeout_ms`)
      .run(cid, n.vpnHost || null, n.vpnPort || null, n.vpnProtocol || 'corporate-vpn',
        n.vpnUsername || null, pwdEnc, n.extraConfig ? JSON.stringify(n.extraConfig) : null, n.connTimeoutMs || 8000);
    const h = b.hcp || {};
    const { warnings, errors } = validateHcpConfig(h);
    if (errors.length) {
      return res.status(400).json({ error: 'Invalid HCP configuration: ' + errors.map(e => e.message).join(' '), errors });
    }
    saveHcpConfig(db, cid, h);
    const cr = b.creds || {};
    const prevCr = db.prepare('SELECT app_secret_enc, cred_updated_at FROM compound_credentials WHERE compound_id=?').get(cid);
    let secEnc = prevCr ? prevCr.app_secret_enc : null;
    let credChanged = false;
    if (cr.appSecret && cr.appSecret !== '***set***') {
      if (!vaultAvailable()) return res.status(503).json({ error: keyInstructions() });
      secEnc = encrypt(cr.appSecret); credChanged = true;
    }
    db.prepare(`INSERT INTO compound_credentials(compound_id, app_key, app_secret_enc, cred_updated_at)
      VALUES(?,?,?,?) ON CONFLICT(compound_id) DO UPDATE SET app_key=excluded.app_key,
      app_secret_enc=excluded.app_secret_enc, cred_updated_at=excluded.cred_updated_at`)
      .run(cid, cr.appKey || null, secEnc, credChanged ? now() : (prevCr ? prevCr.cred_updated_at : null));
    if (credChanged) db.prepare('UPDATE compound_credentials SET cred_updated_at=datetime(?) WHERE compound_id=?').run(now(), cid);
    audit('hcp.compound.update', `compound ${cid}${credChanged ? ' (credentials replaced)' : ''}`);
    res.json({ ok: true, warnings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- connection test (async job + polling) ---------- */
router.post('/compounds/:id/test', (req, res) => {
  const cid = Number(req.params.id);
  if (!db.prepare('SELECT id FROM compounds WHERE id=?').get(cid)) return res.status(404).json({ error: 'Compound not found' });
  const run = db.prepare('INSERT INTO hcp_test_runs(compound_id, kind) VALUES(?,?)').run(cid, (req.body && req.body.kind) || 'connection');
  const runId = Number(run.lastInsertRowid);
  setImmediate(() => runConnectionTest(cid, runId).catch(e => finishRun(runId, 'failed', String(e.message || e).slice(0, 1000))));
  audit('hcp.test.start', `compound ${cid} run ${runId}`);
  res.status(202).json({ ok: true, runId });
});

router.get('/runs/:runId', (req, res) => {
  const run = db.prepare('SELECT * FROM hcp_test_runs WHERE id=?').get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const stages = db.prepare('SELECT stage, status, started_at, duration_ms, message, action FROM hcp_test_stages WHERE run_id=? ORDER BY id').all(run.id);
  res.json({ ...run, stages });
});

router.get('/compounds/:id/history', (req, res) => {
  const runs = db.prepare('SELECT * FROM hcp_test_runs WHERE compound_id=? ORDER BY id DESC LIMIT 20').all(req.params.id);
  const syncs = db.prepare('SELECT * FROM hcp_sync_runs WHERE compound_id=? ORDER BY id DESC LIMIT 20').all(req.params.id);
  res.json({ tests: runs, syncs });
});

async function stage(runId, name, fn) {
  const t0 = Date.now();
  db.prepare("INSERT INTO hcp_test_stages(run_id, stage, status, started_at) VALUES(?,?,'running',datetime('now'))").run(runId, name);
  const sid = Number(db.prepare('SELECT last_insert_rowid() id').get().id);
  try {
    const r = await fn();
    db.prepare('UPDATE hcp_test_stages SET status=?, duration_ms=?, message=?, action=? WHERE id=?')
      .run(r.status || 'success', Date.now() - t0, (r.message || '').slice(0, 1000), r.action || null, sid);
    return r;
  } catch (e) {
    db.prepare('UPDATE hcp_test_stages SET status=?, duration_ms=?, message=?, action=? WHERE id=?')
      .run('failed', Date.now() - t0, String(e.message || e).slice(0, 1000), e.action || null, sid);
    throw e;
  }
}

function finishRun(runId, status, summary) {
  db.prepare("UPDATE hcp_test_runs SET status=?, finished_at=datetime('now'), summary=? WHERE id=?").run(status, (summary || '').slice(0, 2000), runId);
}

async function runConnectionTest(cid, runId) {
  const net = db.prepare('SELECT * FROM compound_network WHERE compound_id=?').get(cid) || {};
  const hcp = db.prepare('SELECT * FROM compound_hcp WHERE compound_id=?').get(cid) || {};
  const cred = db.prepare('SELECT * FROM compound_credentials WHERE compound_id=?').get(cid) || {};
  const fail = (msg) => { finishRun(runId, 'failed', msg); audit('hcp.test.result', `compound ${cid} run ${runId}: FAILED — ${msg}`); };
  const ctx = {};

  await stage(runId, 'vpn-state', async () => {
    if (!hcp.hcp_host) { const e = new Error('HCP host not configured.'); e.action = 'Enter the internal HCP hostname/IP on the compound page.'; throw e; }
    ensureConnectivityRow(db, cid);
    const conn = getConnectivity(db, cid) || {};
    const link = conn.link_ref || (net.vpn_protocol || 'corporate-vpn');
    const st = conn.conn_state || 'unknown';
    const insecureCombo = hcp.https === 0 && (hcp.hcp_port || 443) === 443;
    const status = st === 'up' && !insecureCombo ? 'success' : 'warning';
    return { status,
      message: `host=${hcp.hcp_host} port=${hcp.hcp_port || 443} https=${hcp.https !== 0} link=${link} connectivity=${st}` +
        (conn.last_check_at ? ` last-check=${conn.last_check_at}` : ' (never observed)') +
        (conn.last_up_at ? ` last-up=${conn.last_up_at}` : '') +
        (insecureCombo ? ' — HTTPS disabled while port 443 (TLS) is configured' : '') +
        ' — backend manages no tunnels; state reflects independent connectivity assigned to this compound.',
      action: st === 'down' ? 'Restore the assigned VPN/tunnel for this compound, then re-test. Existing dashboard data is retained meanwhile.'
        : insecureCombo ? 'Re-enable HTTPS unless the server genuinely serves plaintext HTTP on 443.' : null };
  }).catch(() => fail('Invalid configuration.'));
  if ((db.prepare('SELECT status FROM hcp_test_runs WHERE id=?').get(runId) || {}).status === 'failed') return;

  const routeR = await stage(runId, 'route-tcp', async () => {
    const dns = await dnsLookup(hcp.hcp_host);
    if (!dns.ok) { const e = new Error(`DNS resolution failed: ${dns.error}`); e.action = 'Check the hostname spelling, or add a host entry / use the internal IP.'; throw e; }
    ctx.addrs = dns.addresses;
    const r = await tcpConnect(hcp.hcp_host, hcp.hcp_port || 443, net.conn_timeout_ms || 8000);
    if (!r.ok) { const e = new Error(`${r.code === 'PORT_REFUSED' ? 'Port refused/unreachable' : 'Network route unavailable'}: ${r.error}`); e.action = 'Confirm the assigned VPN/tunnel is up, the firewall allows this host, and the HCP port is correct.'; throw e; }
    return { message: `resolved to ${(dns.addresses || []).join(', ')}; TCP ${hcp.hcp_host}:${hcp.hcp_port || 443} open in ${r.ms}ms (route only — not API compatibility)` };
  }).catch(() => null);
  if (!routeR) return fail('Route/TCP unreachable.');
  db.prepare('UPDATE compound_network SET net_status=?, last_test_at=datetime(?), last_success_at=datetime(?) WHERE compound_id=?').run('reachable', now(), now(), cid);
  db.prepare('UPDATE compound_integrations SET last_test_at=datetime(?), last_success_at=datetime(?) WHERE compound_id=?').run(now(), now(), cid);

  if (hcp.https !== 0) {
    const tlsR = await stage(runId, 'tls', async () => {
      const r = await tlsHandshake(hcp.hcp_host, hcp.hcp_port || 443, hcp.conn_timeout_ms || 8000, hcp.tls_verify !== 0, hcp.tls_ca || null);
      if (!r.ok) {
        let action = 'Install the corporate CA or fix the server certificate; do not disable verification without approval.';
        let detail = r.error;
        if (/self-signed|unable to verify|self signed|certificate/i.test(r.error || '')) {
          // Inspect-only handshake (no app data sent) so the admin sees the exact cert.
          let fp = '';
          try {
            const info = await tlsInspect(hcp.hcp_host, hcp.hcp_port || 443, hcp.conn_timeout_ms || 8000);
            if (info && info.fingerprint256) {
              fp = ` Presented cert: subject=${info.subject} issuer=${info.issuer} valid ${info.validFrom} → ${info.validTo} SHA256=${info.fingerprint256}.`;
            }
          } catch (_) { /* inspect is best-effort */ }
          detail = `${r.error}.${fp}`;
          action = 'Self-signed/private CA: confirm the SHA-256 fingerprint above with Palm Hills IT out-of-band, then paste the CA certificate (PEM) into Configuration → HCP Server → Custom CA and re-test. Do not uncheck TLS verification.';
        }
        const e = new Error(`TLS/certificate error: ${detail}`); e.action = action; throw e;
      }
      return { message: `TLS ok${r.subject ? ` (${r.subject})` : ''}${r.validTo ? ` valid to ${r.validTo}` : ''}${hcp.tls_ca ? ' [custom CA pinned]' : ''}` };
    }).catch(() => null);
    if (!tlsR) return fail('TLS validation failed.');
  } else {
    await stage(runId, 'tls', async () => ({ status: 'warning', message: 'HTTPS disabled — traffic is unencrypted. Enable HTTPS.', action: 'Switch the HCP entry to HTTPS.' }));
  }

  const base = hcp.base_url || `${hcp.https === 0 ? 'http' : 'https'}://${hcp.hcp_host}:${hcp.hcp_port || 443}`;
  await stage(runId, 'service-reach', async () => {
    // Real API transport: honors this compound's verification setting + approved CA (fail-closed).
    const r = await httpsGet(base, '/', null, hcp.read_timeout_ms || 15000, hcp.tls_verify !== 0, hcp.tls_ca || null);
    // Any HTTP response (even 401/404) proves the web service answers — it says
    // NOTHING about OpenAPI compatibility; that verdict belongs to later stages.
    if (r.status) return { status: 'success', message: `HTTP ${r.status} from server root in ${r.ms}ms (web service only — not API compatibility)` };
    const e = new Error(`HCP web service unreachable despite open route: ${r.error}`); e.action = 'Check the API base URL / port and that the HCP web service is running.'; throw e;
  }).catch(() => null);

  await stage(runId, 'version-identify', async () => {
    // Auto-detect HCP platform version via the documented discovery endpoint.
    // Calls POST /artemis/api/common/v1/version with the compound's AK/SK
    // credentials and updates the compound config with the detected version.
    const cred = db.prepare('SELECT * FROM compound_credentials WHERE compound_id=?').get(cid) || {};
    let secret = null;
    if (cred.app_secret_enc) {
      try { secret = decrypt(cred.app_secret_enc); } catch (_) { secret = null; }
    }
    if (!cred.app_key || !secret) {
      return { status: 'blocked', message: 'Credentials not configured — cannot auto-detect HCP version. Enter app key/secret on the compound page.' };
    }
    const r = await artemisRequest({
      creds: { appKey: cred.app_key, appSecret: secret },
      hcp: {
        hcp_host: hcp.hcp_host, hcp_port: hcp.hcp_port || 443,
        https: hcp.https !== 0 ? 1 : 0, tls_verify: hcp.tls_verify, tls_ca: hcp.tls_ca || null,
      },
      path: '/artemis/api/common/v1/version',
      body: {},
    });
    if (!r.ok) {
      return { status: 'warning', message: `Version discovery failed: HTTP ${r.status || '?'}${r.error ? ' — ' + r.error : ''}. Using configured HCP ${hcp.hcp_version || '?'}.` };
    }
    let parsed;
    try { parsed = JSON.parse(r.body || '{}'); } catch (_) { parsed = {}; }
    const softVersion = (parsed.data && parsed.data.softVersion) || null;
    const detectedOpenapi = (parsed.data && parsed.data.openapiVersion) || null;
    if (softVersion) {
      const norm = normVersion(softVersion);
      let normO = null;
      if (detectedOpenapi) {
        normO = normVersion(detectedOpenapi);
        db.prepare('UPDATE compound_hcp SET detected_openapi_version=?, openapi_version=? WHERE compound_id=?')
          .run(normO, normO, cid);
      }
      db.prepare('UPDATE compound_hcp SET detected_hcp_version=?, hcp_version=?, version_source=?, version_status=? WHERE compound_id=?')
        .run(norm, norm, 'auto-detect', 'detected', cid);
      hcp.hcp_version = norm;
      hcp.openapi_version = normO || hcp.openapi_version;
      return { status: 'success', message: `Auto-detected HCP version ${softVersion} (OpenAPI ${detectedOpenapi || '?'}) — config updated.` };
    }
    return { status: 'warning', message: 'Version discovery returned no version; using configured version.' };
  });

  const adapter = await stage(runId, 'adapter-compat', async () => {
    const a = resolveAdapter({ hcpVersion: hcp.hcp_version, openapiVersion: hcp.openapi_version });
    if (!a) { const e = new Error(`No compatible adapter for HCP ${hcp.hcp_version || '?'} / OpenAPI ${hcp.openapi_version || '?'}. Exact version match required — no fallback attempted.`); e.action = 'Implement the version-specific, guide-backed adapter for this release (Phase 2).'; throw e; }
    ctx.adapter = a;
    return { status: a.verified ? 'success' : 'blocked', message: `selected ${a.adapterId}${a.fallback ? ' (fallback for ' + a.fallbackFrom + ')' : ''} - ${a.verified ? 'verified' : 'UNVERIFIED: live API blocked until proven against the official guide'}` };
  }).catch(() => null);
  if (!ctx.adapter) return fail('No compatible adapter.');

  await stage(runId, 'auth', async () => {
    if (!cred.app_key) { const e = new Error('OpenAPI application key not configured.'); e.action = 'Paste the authorized application key/secret for this compound.'; throw e; }
    let secret = null;
    try { secret = cred.app_secret_enc ? decrypt(cred.app_secret_enc) : null; } catch (e) { const er = new Error('Stored secret cannot be decrypted — HCP_VAULT_KEY may have changed.'); er.action = 'Re-enter the application secret.'; throw er; }
    if (!secret) { const e = new Error('OpenAPI application secret not configured.'); e.action = 'Paste the authorized application secret for this compound.'; throw e; }
    const AdapterCls = adapterClassFor(ctx.adapter && ctx.adapter.adapterId);
    if (!AdapterCls) { const e = new Error(`No adapter class registered for ${ctx.adapter && ctx.adapter.adapterId}.`); e.action = 'Implement the version-specific adapter class.'; throw e; }
    const ga = new AdapterCls({ compound: cid, hcp, creds: { appKey: cred.app_key, appSecret: secret }, net });
    ctx.secret = secret;
    const r = await ga.authenticate();
    if (r.ok) {
      db.prepare('UPDATE compound_credentials SET auth_status=?, last_auth_ok_at=datetime(?), last_auth_error=NULL WHERE compound_id=?').run('authenticated', now(), cid);
      return { status: 'success', message: `Live authentication succeeded (${r.message}). Adapter ${ctx.adapter && ctx.adapter.verified ? 'verified' : 'UNVERIFIED - sync blocked'}.` };
    }
    db.prepare('UPDATE compound_credentials SET auth_status=?, last_auth_error=? WHERE compound_id=?').run('failed', r.message, cid);
    return { status: 'failed', message: `Live authentication failed: ${r.message}` };
  });

  await stage(runId, 'readonly-op', async () => {
    // Perform actual read-only operations against the HCP Artemis API to
    // retrieve stored vehicle/access events, persons, and visitors.
    const AdapterCls = adapterClassFor(ctx.adapter && ctx.adapter.adapterId);
    if (!AdapterCls) {
      return { status: 'blocked', message: 'No adapter class registered for read operations.' };
    }
    if (!ctx.secret) {
      return { status: 'blocked', message: 'Secret not available — cannot perform read operations.' };
    }
    const ga = new AdapterCls({ compound: cid, hcp, creds: { appKey: cred.app_key, appSecret: ctx.secret }, net: {} });
    const results = {};
    for (const cat of ['persons', 'vehicles', 'visitors']) {
      try {
        const page = await ga.fetchCategory(cat, { limit: 5 });
        results[cat] = page.ok
          ? 'fetched ' + page.records.length + ' records' + (page.hasMore ? ' (more available)' : '')
          : 'blocked: ' + page.blocked + ' - ' + page.message;
      } catch (e) {
        results[cat] = 'error: ' + String(e.message || e).slice(0, 200);
      }
    }
    // Auto-discover camera index codes so vehicle/access events can be synced
    // without manual entry. Only writes when none are configured yet.
    try {
      const cam = await ga.fetchCameras({ pageSize: 500 });
      if (cam.ok && cam.records.length) {
        const codes = cam.records.map(c => c.indexCode).filter(Boolean);
        const existing = (hcp.camera_index_codes || hcp.camera_index_code || '').toString().trim();
        if (codes.length && !existing) {
          const joined = codes.join(',');
          db.prepare('UPDATE compound_hcp SET camera_index_code=?, camera_index_codes=? WHERE compound_id=?').run(codes[0], joined, cid);
          hcp.camera_index_code = codes[0];
          hcp.camera_index_codes = joined;
          results.cameras = 'discovered ' + codes.length + ' camera(s); auto-configured: ' + joined;
        } else {
          results.cameras = 'discovered ' + codes.length + ' camera(s)' + (existing ? '; existing config retained' : '');
        }
      } else {
        results.cameras = cam.blocked ? 'blocked: ' + cam.blocked + ' - ' + cam.message : 'discovered 0 cameras';
      }
    } catch (e) {
      results.cameras = 'error: ' + String(e.message || e).slice(0, 200);
    }
    // Auto-discover vehicle groups so HCP vehicle counts can be synced.
    try {
      const vg = await ga.fetchVehicleGroups({ pageSize: 100 });
      if (vg.ok && vg.records.length) {
        const codes = vg.records.map(g => g.indexCode).filter(Boolean);
        const existing = (hcp.vehicle_group_index_codes || '').toString().trim();
        if (codes.length && !existing) {
          const joined = codes.join(',');
          db.prepare('UPDATE compound_hcp SET vehicle_group_index_codes=? WHERE compound_id=?').run(joined, cid);
          hcp.vehicle_group_index_codes = joined;
          results.vehicleGroups = 'discovered ' + codes.length + ' group(s); auto-configured: ' + joined;
        } else {
          results.vehicleGroups = 'discovered ' + codes.length + ' group(s)' + (existing ? '; existing config retained' : '');
        }
      } else {
        results.vehicleGroups = vg.blocked ? 'blocked: ' + vg.blocked + ' - ' + vg.message : 'discovered 0 groups';
      }
    } catch (e) {
      results.vehicleGroups = 'error: ' + String(e.message || e).slice(0, 200);
    }

    // Auto-discover parking lots so passageway records can be synced.
    try {
      const pl = await ga.fetchParkingLots();
      if (pl.ok && pl.records.length) {
        const codes = pl.records.map(l => l.indexCode).filter(Boolean);
        const existing = (hcp.parking_lot_index_codes || '').toString().trim();
        if (codes.length && !existing) {
          const joined = codes.join(',');
          db.prepare('UPDATE compound_hcp SET parking_lot_index_codes=? WHERE compound_id=?').run(joined, cid);
          hcp.parking_lot_index_codes = joined;
          results.parkingLots = 'discovered ' + codes.length + ' lot(s); auto-configured: ' + joined;
        } else {
          results.parkingLots = 'discovered ' + codes.length + ' lot(s)' + (existing ? '; existing config retained' : '');
        }
      } else {
        results.parkingLots = pl.blocked ? 'blocked: ' + pl.blocked + ' - ' + pl.message : 'discovered 0 lots';
      }
    } catch (e) {
      results.parkingLots = 'error: ' + String(e.message || e).slice(0, 200);
    }

    return { status: 'success', message: 'Read-only operations completed - ' + JSON.stringify(results) };
  });

  await stage(runId, 'sync-state', async () => {
    const gate = await syncGate(db, cid);
    if (gate.allowed) return { status: 'success', message: 'Sync gate: all conditions hold (connectivity up, verified adapter, credentials established).' };
    return { status: 'warning', message: 'Sync gate BLOCKED: ' + gate.reasons.map(r => `${r.code}: ${r.message}`).join(' | ') };
  });
  const gateFinal = await syncGate(db, cid);
  finishRun(runId, 'completed', gateFinal.allowed
    ? 'Diagnostics complete; sync gate open.'
    : 'Diagnostics complete; sync gate blocked — ' + gateFinal.reasons.map(r => r.code).join(', ') + ' (see sync-state stage).');
  db.prepare('UPDATE compound_hcp SET last_api_ok_at=NULL WHERE compound_id=?').run(cid);
  audit('hcp.test.result', `compound ${cid} run ${runId}: phase-1 diagnostics, gate=${gateFinal.allowed ? 'open' : 'blocked'}`);
}

/* ---------- connectivity state & on-demand health observation ---------- */
router.get('/compounds/:id/connectivity', async (req, res) => {
  const cid = Number(req.params.id);
  if (!db.prepare('SELECT id FROM compounds WHERE id=?').get(cid)) return res.status(404).json({ error: 'Compound not found' });
  ensureConnectivityRow(db, cid);
  const gate = await syncGate(db, cid);
  res.json({ state: getConnectivity(db, cid), checks: recentChecks(db, cid, 20), gate: gate.allowed ? 'open' : 'blocked' });
});

router.post('/compounds/:id/check', async (req, res) => {
  const cid = Number(req.params.id);
  if (!db.prepare('SELECT id FROM compounds WHERE id=?').get(cid)) return res.status(404).json({ error: 'Compound not found' });
  try {
    const r = await checkConnectivity(db, cid); // explicit admin action: always runs, bypasses backoff
    audit('hcp.health.check', `compound ${cid}: ${r.state}`);
    res.json(r);
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 300) }); }
});

/* ---------- VPN (FortiClient) provider endpoints ---------- */
/* VPN endpoints are state-changing (connect) and are audit-logged. The app
   has no login layer (trusted intranet, SRS §3); deployment MUST add real
   authN/Z in front (see HCP_INTEGRATION.md). No credentials are accepted
   from browser requests — all VPN configuration comes from environment
   variables. */
router.get('/vpn/status', async (req, res) => {
  try {
    const vpn = new VpnProvider({});
    const status = await vpn.getStatus();
    audit('hcp.vpn.status');
    res.json(status);
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 300) }); }
});

router.post('/vpn/connect', async (req, res) => {
  try {
    // State-changing VPN operation requires explicit confirmation,
    // matching the confirm:true pattern used by rollback/delete/reset.
    if (!req.body || req.body.confirm !== true) {
      return res.status(400).json({ error: 'VPN connect requires { "confirm": true }' });
    }
    const vpn = new VpnProvider({});
    const r = await vpn.connect({
      host: req.body && req.body.host,
      port: req.body && req.body.port,
    });
    audit('hcp.vpn.connect', r.ok ? 'connected' : `failed: ${(r.error || 'unknown error').slice(0, 200)}`);
    if (r.ok) {
      // Independently verify route + TCP + TLS to the compound's HCP endpoint
      // so we never report Connected merely because the CLI accepted the request.
      const hcp = getHcpConfig(req.body && req.body.compoundId) || {};
      let verify = null;
      if (hcp.hcp_host) {
        try {
          verify = await vpn.verifyEndpoint({ host: hcp.hcp_host, port: hcp.hcp_port || 443, caPem: hcp.tls_ca || null });
        } catch (e) {
          verify = { ok: false, error: String(e.message || e).slice(0, 300) };
        }
      }
      // Refresh observed connectivity state after connect attempt.
      const cid = Number(req.body && req.body.compoundId);
      if (cid && db.prepare('SELECT id FROM compounds WHERE id=?').get(cid)) {
        try { await checkConnectivity(db, cid); } catch (_) { /* best-effort refresh */ }
      }
      res.json({
        ok: true,
        status: verify && verify.ok ? 'connected' : 'connected-unverified',
        detail: r.stdout ? r.stdout.slice(0, 500) : '',
        verification: verify || { ok: null, message: 'No HCP host configured; endpoint verification skipped.' },
      });
    } else {
      res.status(400).json({ ok: false, error: r.error || 'VPN connect failed', code: r.code });
    }
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 300) }); }
});

/* ---------- capabilities ---------- */
router.get('/compounds/:id/capabilities', (req, res) => {
  res.json(db.prepare('SELECT category, state, detail, updated_at FROM hcp_capabilities WHERE compound_id=?').all(req.params.id));
});

/* ---------- manual sync (fail-closed gate; production sync stays off in Phase 1) ---------- */
router.post('/compounds/:id/sync', async (req, res) => {
  const cid = Number(req.params.id);
  const gate = await syncGate(db, cid);
  if (!gate.allowed) {
    audit('hcp.sync.blocked', `compound ${cid}: ` + gate.reasons.map(r => r.code).join(', '));
    return res.status(400).json({ error: 'Sync blocked: ' + gate.reasons.map(r => r.message).join(' '), reasons: gate.reasons });
  }
  const adapter = gate.adapter;
  const run = db.prepare('INSERT INTO hcp_sync_runs(compound_id, adapter_id, schema_version) VALUES(?,?,?)').run(cid, adapter.adapterId, 'hcp-normalized/1.0.0');
  const runId = Number(run.lastInsertRowid);
  setImmediate(() => doSync(cid, runId, adapter).catch(e =>
    db.prepare('UPDATE hcp_sync_runs SET status=?, finished_at=datetime(?), error_summary=? WHERE id=?').run('failed', now(), String(e.message || e).slice(0, 1000), runId)));
  audit('hcp.sync.start', `compound ${cid} run ${runId}`);
  res.status(202).json({ ok: true, runId });
});

async function doSync(cid, runId, adapter) {
  // A blocked fetch is NEVER recorded as a successful zero-record sync:
  // blocked runs are marked 'blocked' with reasons, and last_sync_at is
  // updated only when records were actually retrieved.
  const t0 = Date.now();
  const AdapterCls = adapterClassFor(adapter.adapterId);
  if (!AdapterCls) {
    db.prepare('UPDATE hcp_sync_runs SET status=?, finished_at=datetime(?), duration_ms=?, retrieved=?, inserted=?, duplicates=?, failed=?, error_summary=? WHERE id=?')
      .run('blocked', now(), 0, 0, 0, 0, 0, `No adapter class registered for ${adapter.adapterId}. Nothing was written; historical data untouched.`, runId);
    audit('hcp.sync.result', `compound ${cid} run ${runId} blocked: no adapter class`);
    return;
  }
  const hcp = getHcpConfig(db, cid) || {};
  const cred = db.prepare('SELECT * FROM compound_credentials WHERE compound_id=?').get(cid) || {};
  let secret = null;
  if (cred.app_secret_enc) {
    try { secret = decrypt(cred.app_secret_enc); } catch (_) { secret = null; }
  }
  const ga = new AdapterCls({ compound: cid, hcp, creds: { appKey: cred.app_key || null, appSecret: secret }, net: {} });
  const ctx = {
    compoundId: cid,
    hcpVersion: hcp.hcp_version,
    openapiVersion: hcp.openapi_version,
  };
  let retrieved = 0, inserted = 0, dups = 0, failed = 0, blocked = 0;
  try {
    const cats = Array.isArray(adapter.categories) ? adapter.categories : JSON.parse(adapter.categories || '[]');
    // Parse camera index codes from compound config (comma-separated)
    const cameraCodes = (hcp.camera_index_codes || hcp.camera_index_code || '')
      .toString()
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    for (const cat of cats) {
      if (cat === 'access-events' || cat === 'vehicles') {
        // Fetch from every camera index code for this compound
        for (const camCode of cameraCodes) {
          const page = await withRetry(() => ga.fetchCategory(cat, { cameraIndexCode: camCode }), { tries: 3 });
          if (page.blocked) { blocked++; continue; }
          const records = page.records || [];
          retrieved += records.length;
          for (const norm of records) {
            try {
              const r = db.prepare(`INSERT OR IGNORE INTO hcp_live_events(compound_id, category, source_id, event_time, gate, direction, result, method, ref_person, ref_plate, hcp_version, openapi_version, adapter_id, schema_version, retrieved_at, provenance, raw_json)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                .run(
                  norm.compound_id, norm.source_entity, norm.source_id,
                  norm.data.event_time || null, norm.data.gate || null, norm.data.direction || null,
                  norm.data.result || null, norm.data.method || null, norm.data.ownerRef || null, norm.data.plate || null,
                  norm.hcp_version, norm.openapi_version, norm.adapter_id, norm.adapter_version,
                  norm.retrieved_at, norm.provenance, JSON.stringify(norm)
                );
              if (r.changes > 0) inserted++; else dups++;
            } catch (e) { failed++; }
          }
        }
      } else {
        const page = await withRetry(() => ga.fetchCategory(cat), { tries: 3 });
        if (page.blocked) { blocked++; continue; }
        const records = page.records || [];
        retrieved += records.length;
        for (const norm of records) {
          try {
            if (cat === 'persons') {
              const r = db.prepare(`INSERT OR IGNORE INTO hcp_live_persons(compound_id, source_id, name, user_type, unit_ref, hcp_version, openapi_version, adapter_id, schema_version, source_time, retrieved_at, provenance)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
                .run(
                  norm.compound_id, norm.source_id, norm.data.name || null, norm.data.userType || null,
                  norm.data.unitRef || null, norm.hcp_version, norm.openapi_version, norm.adapter_id,
                  norm.adapter_version, norm.data.event_time || null, norm.retrieved_at, norm.provenance
                );
              if (r.changes > 0) inserted++; else dups++;
            } else if (cat === 'visitors') {
              const r = db.prepare(`INSERT OR IGNORE INTO hcp_live_events(compound_id, category, source_id, event_time, gate, direction, result, method, ref_person, ref_plate, hcp_version, openapi_version, adapter_id, schema_version, retrieved_at, provenance, raw_json)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                .run(
                  norm.compound_id, norm.source_entity, norm.source_id,
                  norm.data.validFrom || null, null, null, norm.data.status || null, null,
                  norm.data.hostRef || null, null, norm.hcp_version, norm.openapi_version,
                  norm.adapter_id, norm.adapter_version, norm.retrieved_at, norm.provenance, JSON.stringify(norm)
                );
              if (r.changes > 0) inserted++; else dups++;
            }
          } catch (e) { failed++; }
        }
      }
    }
    // Sync HCP-registered vehicles (from vehicleList endpoint) per vehicle group.
    const vgCodes = (hcp.vehicle_group_index_codes || '')
      .toString().split(',').map(x => x.trim()).filter(Boolean);
    if (vgCodes.length) {
      for (const vgCode of vgCodes) {
        try {
          let pageNo = 1, hasMore = true;
          while (hasMore) {
            const page = await withRetry(() => ga.fetchVehicles({ vehicleGroupIndexCode: vgCode, pageNo, pageSize: 500 }), { tries: 3 });
            if (page.blocked) { blocked++; break; }
            const records = page.records || [];
            retrieved += records.length;
            for (const norm of records) {
              try {
                const r = db.prepare(`INSERT OR IGNORE INTO hcp_live_vehicles(compound_id, source_id, plate, owner_ref, hcp_version, adapter_id, schema_version, source_time, retrieved_at, provenance)
                  VALUES(?,?,?,?,?,?,?,?,?,?)`)
                  .run(
                    norm.compound_id, norm.source_id, norm.data.plate || null, norm.data.ownerRef || null,
                    norm.hcp_version, norm.adapter_id, norm.adapter_version,
                    norm.data.effectiveDate || null, norm.retrieved_at, norm.provenance
                  );
                if (r.changes > 0) inserted++; else dups++;
              } catch (e) { failed++; }
            }
            hasMore = page.hasMore;
            pageNo++;
            if (pageNo > 100) break; // safety
          }
        } catch (e) { failed++; }
      }
    }

    // Sync parking passageway records (vehicle passing at parking lots).
    const plCodes = (hcp.parking_lot_index_codes || '')
      .toString().split(',').map(x => x.trim()).filter(Boolean);
    if (plCodes.length) {
      for (const plCode of plCodes) {
        try {
          let pageNo = 1, hasMore = true;
          const now = new Date();
          const endTime = now.toISOString().replace(/\.\d+Z$/, '') + '+00:00';
          const startTime = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '') + '+00:00';
          while (hasMore) {
            const page = await withRetry(() => ga.fetchParkingPassagewayRecords({ parkingLotIndexCode: plCode, beginTime: startTime, endTime, pageNo, pageSize: 500 }), { tries: 3 });
            if (page.blocked) { blocked++; break; }
            const records = page.records || [];
            retrieved += records.length;
            for (const norm of records) {
              try {
                const r = db.prepare(`INSERT OR IGNORE INTO hcp_live_events(compound_id, category, source_id, event_time, gate, direction, result, method, ref_person, ref_plate, hcp_version, openapi_version, adapter_id, schema_version, retrieved_at, provenance, raw_json)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                  .run(
                    norm.compound_id, 'passageway', norm.source_id,
                    norm.data.event_time || null, norm.data.gate || null, norm.data.direction || null,
                    norm.data.result || null, null, norm.data.ownerRef || null, norm.data.plate || null,
                    norm.hcp_version, norm.openapi_version, norm.adapter_id, norm.adapter_version,
                    norm.retrieved_at, norm.provenance, JSON.stringify(norm)
                  );
                if (r.changes > 0) inserted++; else dups++;
              } catch (e) { failed++; }
            }
            hasMore = page.hasMore;
            pageNo++;
            if (pageNo > 200) break;
          }
        } catch (e) { failed++; }
      }
    }

    // Sync door access events (card swiping at gates).
    try {
      let pageNo = 1, hasMore = true;
      const now = new Date();
      const endTime = now.toISOString().replace(/\.\d+Z$/, '') + '+00:00';
      const startTime = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '') + '+00:00';
      while (hasMore) {
        const page = await withRetry(() => ga.fetchDoorEvents({ startTime, endTime, pageNo, pageSize: 500 }), { tries: 3 });
        if (page.blocked) { blocked++; break; }
        const records = page.records || [];
        retrieved += records.length;
        for (const norm of records) {
          try {
            const r = db.prepare(`INSERT OR IGNORE INTO hcp_live_events(compound_id, category, source_id, event_time, gate, direction, result, method, ref_person, ref_plate, hcp_version, openapi_version, adapter_id, schema_version, retrieved_at, provenance, raw_json)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(
                norm.compound_id, 'door-event', norm.source_id,
                norm.data.eventTime || null, norm.data.doorName || null, null,
                null, null, norm.data.personName || null, null,
                norm.hcp_version, norm.openapi_version, norm.adapter_id, norm.adapter_version,
                norm.retrieved_at, norm.provenance, JSON.stringify(norm)
              );
            if (r.changes > 0) inserted++; else dups++;
          } catch (e) { failed++; }
        }
        hasMore = page.hasMore;
        pageNo++;
        if (pageNo > 200) break;
      }
    } catch (e) { failed++; }

    if (retrieved === 0 && failed === 0) {
      db.prepare('UPDATE hcp_sync_runs SET status=?, finished_at=datetime(?), duration_ms=?, retrieved=?, inserted=?, duplicates=?, failed=?, error_summary=? WHERE id=?')
        .run('blocked', now(), Date.now() - t0, 0, 0, 0, 0, `No records fetched: ${blocked} categor${blocked === 1 ? 'y' : 'ies'} blocked pending a verified adapter. Nothing was written; historical data untouched.`, runId);
    } else {
      db.prepare("UPDATE hcp_sync_runs SET status='completed', finished_at=datetime(?), duration_ms=?, retrieved=?, inserted=?, duplicates=?, failed=? WHERE id=?")
        .run(now(), Date.now() - t0, retrieved, inserted, dups, failed, runId);
      if (inserted > 0) db.prepare('UPDATE compound_integrations SET last_sync_at=datetime(?) WHERE compound_id=?').run(now(), cid);
    }
  } catch (e) {
    db.prepare('UPDATE hcp_sync_runs SET status=?, finished_at=datetime(?), duration_ms=?, error_summary=? WHERE id=?')
      .run('failed', now(), Date.now() - t0, String(e.message || e).slice(0, 1000), runId);
  }
  audit('hcp.sync.result', `compound ${cid} run ${runId} retrieved=${retrieved} inserted=${inserted} dups=${dups} failed=${failed} blocked=${blocked}`);
}

router.get('/sync/:runId', (req, res) => {
  const r = db.prepare('SELECT * FROM hcp_sync_runs WHERE id=?').get(req.params.runId);
  if (!r) return res.status(404).json({ error: 'Sync run not found' });
  res.json(r);
});

/* ---------- live data browser (provenance-labelled) ---------- */
router.get('/compounds/:id/live/:category', (req, res) => {
  const cid = Number(req.params.id);
  const cat = req.params.category;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const table = cat === 'persons' ? 'hcp_live_persons' : cat === 'vehicles' ? 'hcp_live_vehicles' : cat === 'events' ? 'hcp_live_events' : null;
  if (!table) return res.status(400).json({ error: 'Unknown category (persons|vehicles|events).' });
  const total = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE compound_id=?`).get(cid).c;
  const orderCol = table === 'hcp_live_events' ? 'event_time' : (table === 'hcp_live_vehicles' ? 'retrieved_at' : (table === 'hcp_live_persons' ? 'retrieved_at' : 'id'));
  const rows = db.prepare(`SELECT * FROM ${table} WHERE compound_id=? ORDER BY ${orderCol} DESC, id DESC LIMIT ? OFFSET ?`).all(cid, limit, (page - 1) * limit);
  res.json({ total, page, limit, rows, provenance: 'live-hcp (cached from read-only sync; never mixed with uploads or samples)' });
});

/* ---------- live heatmap (HCP events by date x hour) ---------- */
router.get('/compounds/:id/live-heatmap', (req, res) => {
  const cid = Number(req.params.id);
  if (!db.prepare('SELECT id FROM compounds WHERE id=?').get(cid)) return res.status(404).json({ error: 'Compound not found' });
  const rows = db.prepare(`SELECT substr(event_time,1,10) d, substr(event_time,12,2) hh, COUNT(*) v FROM hcp_live_events WHERE compound_id=? AND event_time IS NOT NULL GROUP BY d, hh`).all(cid);
  res.json(rows);
});

/* ---------- live hourly distribution (HCP events by hour) ---------- */
router.get('/compounds/:id/live-hourly', (req, res) => {
  const cid = Number(req.params.id);
  if (!db.prepare('SELECT id FROM compounds WHERE id=?').get(cid)) return res.status(404).json({ error: 'Compound not found' });
  const rows = db.prepare(`SELECT substr(event_time,12,2) hh, COUNT(*) v FROM hcp_live_events WHERE compound_id=? AND event_time IS NOT NULL GROUP BY hh ORDER BY hh`).all(cid);
  res.json(rows);
});

/* ---------- live summary for dashboard ---------- */
/* Aggregates live HCP data + connectivity state for the executive dashboard.
   Read-only; never mutates. Returns honoured provenance labels. */
router.get('/compounds/:id/live-summary', (req, res) => {
  const cid = Number(req.params.id);
  if (!db.prepare('SELECT id FROM compounds WHERE id=?').get(cid)) return res.status(404).json({ error: 'Compound not found' });
  const conn = getConnectivity(db, cid) || {};
  const integ = db.prepare('SELECT * FROM compound_integrations WHERE compound_id=?').get(cid) || {};
  const hcp = getHcpConfig(db, cid) || {};
  const cred = db.prepare('SELECT * FROM compound_credentials WHERE compound_id=?').get(cid) || {};
  const lastSync = db.prepare('SELECT * FROM hcp_sync_runs WHERE compound_id=? ORDER BY id DESC LIMIT 1').get(cid) || null;
  const persons = db.prepare('SELECT COUNT(*) c FROM hcp_live_persons WHERE compound_id=?').get(cid).c;
  const vehicles = db.prepare('SELECT COUNT(*) c FROM hcp_live_vehicles WHERE compound_id=?').get(cid).c;
  const events = db.prepare('SELECT COUNT(*) c FROM hcp_live_events WHERE compound_id=?').get(cid).c;
  const eventsByDay = db.prepare(`SELECT substr(event_time,1,10) d, COUNT(*) v FROM hcp_live_events WHERE compound_id=? AND event_time IS NOT NULL GROUP BY d ORDER BY d DESC LIMIT 30`).all(cid);
  res.json({
    compound_id: cid,
    connectivity: { state: conn.conn_state, vpn_state: conn.vpn_state, last_check: conn.last_check_at, last_up: conn.last_up_at, fail_count: conn.fail_count },
    https: hcp.https !== 0,
    tls_verify: hcp.tls_verify !== 0,
    hcp_version: hcp.hcp_version,
    openapi_version: hcp.openapi_version,
    integration_enabled: !!integ.integration_enabled,
    integration_mode: integ.integration_mode,
    config_status: integ.config_status,
    auth_status: cred.auth_status,
    perm_status: cred.perm_status,
    last_sync: lastSync ? { id: lastSync.id, status: lastSync.status, retrieved: lastSync.retrieved, inserted: lastSync.inserted, failed: lastSync.failed, finished_at: lastSync.finished_at, error_summary: lastSync.error_summary } : null,
    counts: { persons, vehicles, events },
    events_by_day: eventsByDay,
    provenance: 'live-hcp',
  });
});

/* ---------- registry (honest) ---------- */
router.get('/registry', (req, res) => {
  res.json(db.prepare('SELECT * FROM hcp_adapter_registry').all().map(sanitize));
});

/* ---------- vehicle count comparison: CRM vs HCP per compound ---------- */
router.get('/vehicle-comparison', (req, res) => {
  const compounds = db.prepare('SELECT id, name FROM compounds ORDER BY name').all();
  // Total CRM vehicles
  const totalCrm = db.prepare('SELECT COUNT(*) c FROM vehicles').get().c;
  // CRM plates for matching
  const crmPlates = new Set(db.prepare('SELECT plate_norm, plate_norm_latin FROM vehicles').all().flatMap(v => [v.plate_norm, v.plate_norm_latin].filter(Boolean)));
  const result = compounds.map(c => {
    const hcpCount = db.prepare('SELECT COUNT(*) c FROM hcp_live_vehicles WHERE compound_id=?').get(c.id).c;
    const hcpGroups = db.prepare('SELECT vehicle_group_index_codes FROM compound_hcp WHERE compound_id=?').get(c.id);
    const groups = hcpGroups && hcpGroups.vehicle_group_index_codes ? hcpGroups.vehicle_group_index_codes.split(',').map(x => x.trim()).filter(Boolean) : [];
    // Count HCP vehicles whose plate matches a CRM vehicle
    const hcpPlates = db.prepare('SELECT plate FROM hcp_live_vehicles WHERE compound_id=?').all(c.id).map(r => r.plate);
    const matched = hcpPlates.filter(p => crmPlates.has(p)).length;
    return {
      compound_id: c.id,
      compound: c.name,
      crm_vehicles: 0, // CRM vehicles are not compound-linked in the data model
      hcp_vehicles: hcpCount,
      hcp_vehicle_groups: groups.length,
      hcp_matched_crm: matched,
      hcp_unmatched: hcpCount - matched,
    };
  }).filter(r => r.hcp_vehicles > 0);
  res.json({ compounds: result, total_crm: totalCrm, total_hcp: result.reduce((s, r) => s + r.hcp_vehicles, 0), total_matched: result.reduce((s, r) => s + r.hcp_matched_crm, 0) });
});

module.exports = router;
// Test seams (no server start on require): policy + pipeline pieces for hermetic tests.
module.exports.doSync = doSync;
module.exports.ADAPTER_CLASSES = ADAPTER_CLASSES;
module.exports.adapterClassFor = adapterClassFor;
