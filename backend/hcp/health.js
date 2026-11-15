'use strict';
/* Phase 1 compound-connectivity layer (Oct 2026).
   What this module is: per-compound observed connectivity state (up /
   degraded / down / unknown), scheduled health observations, backoff, and the
   fail-closed sync gate.
   What it is NOT: a VPN client. The backend cannot establish tunnels or
   change routes. State here means "the HCP endpoint was/was-not reachable
   through the independently-managed connectivity this compound is assigned
   to". Probes are DNS + TCP + TLS-handshake only — no HTTP, no credentials,
   no live API calls. */
const { dnsLookup, tcpConnect, tlsHandshake } = require('./netcheck');
const { resolveAdapter } = require('./registry');
const { decrypt } = require('./crypto');
const { getHcpConfig } = require('./store');
const { VpnProvider } = require('./vpn');

const MAX_BACKOFF_S = 1800;

/* Build a per-compound VPN provider from environment configuration.
   Disabled when FORTICLIENT_ENABLED != true — no tunnel is ever created
   or dialed by this backend. */
function buildVpnProvider() {
  return new VpnProvider({});
}

function ensureConnectivityRow(db, cid) {
  db.prepare('INSERT OR IGNORE INTO compound_connectivity(compound_id) VALUES(?)').run(cid);
  // Record the configured VPN tunnel reference (never credentials).
  const vpn = buildVpnProvider();
  const tunnel = vpn.tunnelName;
  if (tunnel) {
    db.prepare('UPDATE compound_connectivity SET vpn_tunnel=? WHERE compound_id=? AND (vpn_tunnel IS NULL OR vpn_tunnel="")').run(tunnel, cid);
  }
  return getConnectivity(db, cid);
}

function getConnectivity(db, cid) {
  return db.prepare('SELECT * FROM compound_connectivity WHERE compound_id=?').get(cid) || null;
}

function recentChecks(db, cid, limit = 20) {
  return db.prepare('SELECT checked_at, state, latency_ms, detail FROM connectivity_checks WHERE compound_id=? ORDER BY id DESC LIMIT ?').all(cid, limit);
}

/* Pure state transition. up: reset. degraded: reachable but identity or
   posture unproven — recorded, no backoff (keep observing). down: backoff
   grows exponentially (60s, 120s, ... capped at 30 min). */
function nextConnState(prev, outcome) {
  const fails = (prev && prev.fail_count) || 0;
  if (outcome === 'up') return { state: 'up', fail_count: 0, backoff_s: 0 };
  if (outcome === 'degraded') return { state: 'degraded', fail_count: fails, backoff_s: 0 };
  const n = fails + 1;
  return { state: 'down', fail_count: n, backoff_s: Math.min(60 * Math.pow(2, n - 1), MAX_BACKOFF_S) };
}

function dueForCheck(row, nowMs) {
  if (!row || !row.backoff_until) return true;
  const t = Date.parse(String(row.backoff_until).replace(' ', 'T').replace(/$/, 'Z').replace(/ZZ$/, 'Z'));
  if (Number.isNaN(t)) return true;
  return (nowMs || Date.now()) >= t;
}

/* One health observation: VPN state -> DNS + TCP + (if https) TLS handshake.
   Never sends HTTP or credentials. Writes VPN + network state + history;
   prunes history to 200 rows. VPN state is recorded independently of network
   reachability so an administrator can see whether the tunnel is up even
   when the HCP endpoint is not yet reachable. */
async function checkConnectivity(db, cid, opts = {}) {
  ensureConnectivityRow(db, cid);
  const t0 = Date.now();
  const hcp = getHcpConfig(db, cid) || {};
  const timeout = opts.timeoutMs || hcp.conn_timeout_ms || 8000;
  const vpn = buildVpnProvider();
  const vpnStatus = await vpn.getStatus();
  const nowIso = new Date().toISOString();
  // Persist VPN state independently.
  db.prepare(`UPDATE compound_connectivity SET vpn_state=?, vpn_last_check=? WHERE compound_id=?`)
    .run(vpnStatus.status, nowIso, cid);
  let overall = 'down';
  let detail = '';
  if (!hcp.hcp_host) {
    detail = 'HCP host not configured.';
  } else if (vpn.enabled && vpnStatus.status !== 'connected') {
    // VPN is enabled but not connected — record this; route/TLS checks still
    // run so the admin can see whether the failure is tunnel or endpoint.
    detail = `VPN tunnel ${vpnStatus.status} (${vpnStatus.reason || 'not connected'}); HCP reachability not proven through tunnel.`;
  } else {
    const dns = await dnsLookup(hcp.hcp_host);
    if (!dns.ok) {
      detail = `DNS resolution failed: ${dns.error}`;
    } else {
      const tcp = await tcpConnect(hcp.hcp_host, hcp.hcp_port || 443, timeout);
      if (!tcp.ok) {
        detail = `TCP unreachable: ${tcp.error}`;
      } else if (!hcp.https) {
        overall = 'degraded';
        detail = `TCP open in ${tcp.ms}ms but HTTPS is disabled — API traffic would be unencrypted plaintext.`;
      } else {
        const tls = await tlsHandshake(hcp.hcp_host, hcp.hcp_port || 443, timeout, hcp.tls_verify !== 0, hcp.tls_ca || null);
        if (tls.ok) {
          overall = 'up';
          detail = `TLS verified in ${tls.ms}ms${tls.subject ? ` (${tls.subject})` : ''}.`;
        } else {
          overall = 'degraded';
          detail = `TCP open but TLS identity unproven: ${tls.error}`;
        }
      }
    }
  }
  const prev = getConnectivity(db, cid);
  const next = nextConnState({ state: prev && prev.conn_state, fail_count: prev && prev.fail_count }, overall);
  db.prepare(`UPDATE compound_connectivity SET conn_state=?, last_check_at=?,
    last_up_at=CASE WHEN ?='up' THEN ? ELSE last_up_at END,
    fail_count=?, backoff_until=? WHERE compound_id=?`)
    .run(next.state, nowIso, overall, nowIso, next.fail_count,
      next.backoff_s > 0 ? new Date(Date.now() + next.backoff_s * 1000).toISOString() : null, cid);
  db.prepare('INSERT INTO connectivity_checks(compound_id, state, latency_ms, detail) VALUES(?,?,?,?)')
    .run(cid, next.state, Date.now() - t0, String(detail).slice(0, 1000));
  db.prepare(`DELETE FROM connectivity_checks WHERE compound_id=? AND id NOT IN
    (SELECT id FROM connectivity_checks WHERE compound_id=? ORDER BY id DESC LIMIT 200)`).run(cid, cid);
  return {
    compound_id: cid, state: next.state, detail, checked_at: nowIso, fail_count: next.fail_count,
    vpn: { status: vpnStatus.status, enabled: vpn.enabled, reason: vpnStatus.reason },
  };
}

/* Fail-closed sync gate. Allowed ONLY when every condition holds; otherwise
   returns machine-readable reasons. Never writes sync history itself. */
async function syncGate(db, cid, opts = {}) {
  const reasons = [];
  const integ = db.prepare('SELECT * FROM compound_integrations WHERE compound_id=?').get(cid);
  if (!integ || !integ.integration_enabled) {
    reasons.push({ code: 'SYNC_DISABLED', message: 'Live synchronization is disabled for this compound.' });
  }
  const conn = getConnectivity(db, cid);
  if (!conn || conn.conn_state === 'unknown' || !conn.last_check_at) {
    reasons.push({ code: 'CONNECTIVITY_UNKNOWN', message: 'Connectivity was never observed — run a connectivity check first.' });
  } else if (conn.conn_state === 'down') {
    reasons.push({ code: 'CONNECTIVITY_DOWN', message: `Connectivity is down (last check ${conn.last_check_at}). Sync paused until recovery; existing data is retained.` });
  } else if (conn.conn_state === 'degraded') {
    reasons.push({ code: 'CONNECTIVITY_DEGRADED', message: 'Endpoint reachable but TLS identity unproven — sync refused until verification succeeds.' });
  }
  // VPN gate: when VPN control is enabled, the tunnel must be connected.
  const vpn = buildVpnProvider();
  if (vpn.enabled) {
    const vpnStatus = await vpn.getStatus();
    if (vpnStatus.status !== 'connected') {
      reasons.push({ code: 'VPN_NOT_CONNECTED',
        message: `VPN tunnel ${vpnStatus.status || 'unknown'} (${vpnStatus.reason || 'not connected'}). Sync requires the assigned VPN tunnel to be connected.` });
    }
  }
  const hcp = getHcpConfig(db, cid) || {};
  const adapter = opts.adapter !== undefined ? opts.adapter : resolveAdapter({ hcpVersion: hcp.hcp_version, openapiVersion: hcp.openapi_version });
  if (!adapter) {
    reasons.push({ code: 'NO_ADAPTER', message: `No compatible adapter for HCP ${hcp.hcp_version || '?'} / OpenAPI ${hcp.openapi_version || '?'}. No fallback is attempted.` });
  } else if (!adapter.verified) {
    reasons.push({ code: 'ADAPTER_UNVERIFIED', message: `Adapter ${adapter.adapterId} matches but is not verified against the official guide — live use blocked.` });
  }
  const cred = db.prepare('SELECT * FROM compound_credentials WHERE compound_id=?').get(cid) || {};
  if (!cred.app_key) {
    reasons.push({ code: 'AUTH_MISSING', message: 'OpenAPI application key not configured.' });
  } else {
    try {
      const secret = cred.app_secret_enc ? decrypt(cred.app_secret_enc) : null;
      if (!secret) reasons.push({ code: 'AUTH_MISSING', message: 'OpenAPI application secret not configured.' });
    } catch (e) {
      reasons.push({ code: 'AUTH_UNDECRYPTABLE', message: 'Stored secret cannot be decrypted — HCP_VAULT_KEY may have changed. Re-enter the secret.' });
    }
  }
  return { allowed: reasons.length === 0, reasons, adapter: adapter || null };
}

/* In-process scheduled health observations. Explicit start only (called from
   server.js); never auto-starts on require so tests stay hermetic. Overlap is
   guarded per compound; backoff rows are skipped; timer is unref'd. */
function startHealthScheduler(db, opts = {}) {
  const intervalMs = opts.intervalMs || 300000;
  const running = new Set();
  const ensureAll = () => {
    try {
      db.prepare(`INSERT OR IGNORE INTO compound_connectivity(compound_id)
        SELECT id FROM compounds WHERE id IN (SELECT compound_id FROM compound_hcp) OR id IN (SELECT compound_id FROM compound_integrations)`).run();
    } catch (_) { /* schema not migrated yet — next tick retries */ }
  };
  const tick = async () => {
    ensureAll();
    let rows = [];
    try { rows = db.prepare('SELECT compound_id FROM compound_connectivity').all(); } catch (_) { return; }
    for (const r of rows) {
      if (running.has(r.compound_id)) continue;
      const st = getConnectivity(db, r.compound_id);
      if (st && !dueForCheck(st)) continue;
      running.add(r.compound_id);
      checkConnectivity(db, r.compound_id).catch(() => {}).finally(() => running.delete(r.compound_id));
    }
  };
  ensureAll();
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  const primer = setTimeout(tick, 5000);
  if (primer.unref) primer.unref();
  return { stop: () => { clearInterval(timer); clearTimeout(primer); } };
}

module.exports = { ensureConnectivityRow, getConnectivity, recentChecks, nextConnState, dueForCheck, checkConnectivity, syncGate, startHealthScheduler, MAX_BACKOFF_S };
