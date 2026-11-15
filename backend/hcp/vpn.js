'use strict';
/* Phase 2 — VPN provider abstraction: FortiClient (Windows).
   FortiClient-specific code lives here, separate from HCP API code.
   Uses child_process.execFile with a fixed executable path and fixed
   argument arrays — never shell command strings, never arbitrary
   arguments supplied through HTTP requests.
   Configuration comes ONLY from environment variables:
     FORTICLIENT_CLI   — full path to forticli.exe (required when enabled)
     FORTICLIENT_TUNNEL — tunnel/profile name to connect (required for connect)
     FORTICLIENT_ENABLED — 'true' to enable VPN control (default: disabled)
   No credentials are embedded in source code, accepted from browser
   requests, or written to logs. The CLI syntax below is the commonly
   documented FortiClient syntax; it MUST be verified against the
   installed FortiClient edition/version before any real connection is
   attempted (see HCP_INTEGRATION.md IT prerequisites). */

const { execFile: realExecFile } = require('child_process');
const { dnsLookup, tcpConnect, tlsHandshake } = require('./netcheck');

/* Test seam: allows unit tests to inject a stub execFile without spawning
   real processes. Production use leaves this as the real execFile.
   The implementation is promise-based (no callback juggling). */
let _execFileImpl = null;
async function _execFile(file, args, opts = {}) {
  if (_execFileImpl) return _execFileImpl(file, args, opts);
  return new Promise((resolve, reject) => {
    realExecFile(file, args, opts, (err, stdout, stderr) => {
      if (err) reject(err); else resolve({ stdout, stderr });
    });
  });
}

/* Test-only: replace the execFile implementation. Call with null to restore. */
function setExecFileForTesting(impl) {
  _execFileImpl = impl;
}

const DEFAULT_CLI_PATHS = [
  'C:\\Program Files\\Fortinet\\FortiClient\\forticli.exe',
  'C:\\Program Files (x86)\\Fortinet\\FortiClient\\forticli.exe',
];

function resolveCliPath() {
  const envPath = process.env.FORTICLIENT_CLI;
  if (envPath && typeof envPath === 'string' && envPath.trim()) return envPath.trim();
  return null;
}

function isEnabled() {
  return String(process.env.FORTICLIENT_ENABLED || '').toLowerCase() === 'true';
}

function getTunnelName() {
  const t = process.env.FORTICLIENT_TUNNEL;
  return t && typeof t === 'string' && t.trim() ? t.trim() : null;
}

function maskCliPath(path) {
  if (!path) return '(not configured)';
  // Never log the full path in a way that could reveal install structure
  // beyond what the admin already configured; keep it for diagnostics only.
  return path;
}

/* Provider contract. Implementations must not accept runtime-supplied
   executable paths or arguments — those are fixed at construction from
   environment configuration. */
class VpnProvider {
  constructor({ cliPath, tunnelName } = {}) {
    this.cliPath = cliPath || resolveCliPath();
    this.tunnelName = tunnelName || getTunnelName();
    this.enabled = isEnabled();
    this._connectLock = null;
  }

  async _run(args, timeoutMs = 30000) {
    if (!this.cliPath) {
      return { ok: false, code: 'CLI_NOT_CONFIGURED',
        error: 'FORTICLIENT_CLI is not set. Set it to the forticli.exe path (e.g. C:\\Program Files\\Fortinet\\FortiClient\\forticli.exe).' };
    }
    try {
      const { stdout, stderr } = await _execFile(this.cliPath, args, { timeout: timeoutMs });
      return { ok: true, code: 0, stdout: stdout || '', stderr: stderr || '' };
    } catch (e) {
      return { ok: false, code: e.code || 'UNKNOWN', stdout: e.stdout || '', stderr: e.stderr || '',
        error: String(e.message || e).slice(0, 300) };
    }
  }

  /* Return the VPN tunnel status observed from the CLI. Never emits
     credentials or secrets. */
  async getStatus() {
    if (!this.enabled) {
      return { enabled: false, status: 'disabled',
        reason: 'FORTICLIENT_ENABLED is not set to true' };
    }
    if (!this.cliPath) {
      return { enabled: true, status: 'unavailable',
        reason: 'FORTICLIENT_CLI is not configured' };
    }
    const r = await this._run(['-vpnstatus']);
    // Match the whole word "connected" so "Disconnected" does not match.
    const connected = /\bconnected\b/i.test(r.stdout) || /\b连接\b/i.test(r.stdout);
    return {
      enabled: true,
      status: connected ? 'connected' : 'disconnected',
      cli: maskCliPath(this.cliPath),
      code: r.code,
      raw: r.stdout ? r.stdout.slice(0, 500) : '',
      error: r.error || null,
    };
  }

  /* Connect to the configured tunnel using -vpnconnect with a fixed
     argument array. Concurrency-protected: a second call while one is
     in-flight returns the same promise.
     Does NOT report Connected merely because the CLI accepted the request:
     after dispatching -vpnconnect we poll getStatus() with bounded retries
     and then independently verify route/TCP/TLS to the HCP endpoint. */
  async connect({ host, port, timeoutMs = 30000, pollIntervalMs = 2000, maxPollMs = 30000 } = {}) {
    if (!this.enabled) {
      throw new Error('VPN provider is disabled (FORTICLIENT_ENABLED is not true)');
    }
    if (!this.cliPath) {
      throw new Error('FORTICLIENT_CLI is not configured');
    }
    if (!this.tunnelName) {
      throw new Error('FORTICLIENT_TUNNEL is not configured');
    }
    if (this._connectLock) return this._connectLock;
    this._connectLock = (async () => {
      try {
        await this._run(['-vpnconnect', this.tunnelName], timeoutMs);
      } catch (e) {
        // CLI may return non-zero while still connecting; poll status anyway.
      }
      // Bounded poll: wait for the CLI to report connected.
      const deadline = Date.now() + maxPollMs;
      let status = 'disconnected';
      let detail = '';
      while (Date.now() < deadline) {
        const s = await this.getStatus();
        status = s.status;
        detail = s.reason || '';
        if (status === 'connected') break;
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      if (status !== 'connected') {
        const err = new Error(`VPN connect did not reach Connected state (last: ${status}).${detail ? ' ' + detail : ''}`);
        err.code = 'VPN_NOT_CONNECTED';
        throw err;
      }
      return { ok: true, code: 0, stdout: `VPN tunnel ${this.tunnelName} connected`, stderr: '', status };
    })().finally(() => { this._connectLock = null; });
    return this._connectLock;
  }

  /* After a connect, independently verify route + TCP + TLS to an HCP
     endpoint. Used by the connect endpoint to confirm actual connectivity. */
  async verifyEndpoint({ host, port, timeoutMs = 15000, caPem } = {}) {
    if (!host) throw new Error('HCP host is required for endpoint verification.');
    const route = await this.checkRouteAndReachability(host, port || 443, timeoutMs);
    if (!route.ok) return { ok: false, stage: route.stage, error: route.error };
    let tls = null;
    if (port && port !== 443) {
      // TLS check on the actual HCP port.
      tls = await this._tlsHandshake(host, port || 443, timeoutMs, caPem);
    } else {
      tls = await this._tlsHandshake(host, 443, timeoutMs, caPem);
    }
    if (!tls || !tls.ok) return { ok: false, stage: 'tls', error: tls ? tls.error : 'TLS handshake failed' };
    return { ok: true, stage: 'tls', addresses: route.addresses, latencyMs: route.latencyMs, tls };
  }

  async _tlsHandshake(host, port, timeoutMs, caPem) {
    const { tlsHandshake } = require('./netcheck');
    return tlsHandshake(host, port, timeoutMs, true, caPem || null);
  }

  /* Independent route/TCP reachability check to an HCP endpoint.
     Does not depend on VPN status — reports what is observable through
     the current network stack. */
  async checkRouteAndReachability(host, port, timeoutMs) {
    const dns = await dnsLookup(host);
    if (!dns.ok) return { ok: false, stage: 'dns', error: dns.error };
    const tcp = await tcpConnect(host, port || 443, timeoutMs || 8000);
    if (!tcp.ok) return { ok: false, stage: 'tcp', error: tcp.error };
    return { ok: true, stage: 'tcp', addresses: dns.addresses, latencyMs: tcp.ms };
  }

  /* Combined health observation: VPN state -> route/TCP -> TLS handshake.
     TLS verification is always enabled; a pinned CA may be supplied.
     No HTTP request is sent, no application data is transmitted. */
  async getHealth({ host, port, timeoutMs, caPem } = {}) {
    const vpn = await this.getStatus();
    const route = await this.checkRouteAndReachability(host || '127.0.0.1', port || 443, timeoutMs);
    let tls = null;
    if (route.ok) {
      tls = await tlsHandshake(host || '127.0.0.1', port || 443, timeoutMs || 8000, true, caPem || null);
    }
    const healthy = vpn.status === 'connected' && route.ok && tls && tls.ok;
    return { vpn, route, tls, healthy };
  }
}

module.exports = { VpnProvider, resolveCliPath, isEnabled, getTunnelName, DEFAULT_CLI_PATHS, setExecFileForTesting };
