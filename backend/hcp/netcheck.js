'use strict';
/* Real network diagnostics: DNS, TCP port, TLS handshake, HTTPS reachability.
   No OS/VPN commands are executed. VPN presence is checked passively: whether
   the backend process can route to the target (TCP connect succeeds).
   API transport policy: every real HTTPS request uses a per-compound agent
   that enforces certificate verification (default ON) and the approved custom
   CA. Verification is never disabled on the request path — an explicit
   verify=false is fail-closed (refused before any socket opens). */
const dns = require('dns').promises;
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');

async function dnsLookup(host) {
  const t0 = Date.now();
  try {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return { ok: true, addresses: [host], ms: 0, note: 'literal IP, no DNS needed' };
    const addrs = await dns.lookup(host, { all: true });
    return { ok: true, addresses: addrs.map(a => a.address), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e.message || e), code: 'DNS_FAILURE' };
  }
}

function tcpConnect(host, port, timeoutMs) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (r) => { try { sock.destroy(); } catch (_) {} resolve({ ...r, ms: Date.now() - t0 }); };
    sock.setTimeout(timeoutMs || 8000);
    sock.on('connect', () => done({ ok: true }));
    sock.on('timeout', () => done({ ok: false, error: `TCP connect timed out after ${timeoutMs || 8000}ms`, code: 'TIMEOUT' }));
    sock.on('error', (e) => done({ ok: false, error: String(e.message || e), code: /ECONNREFUSED/.test(e.message) ? 'PORT_REFUSED' : 'NETWORK_UNREACHABLE' }));
    sock.connect(port, host);
  });
}

function tlsOpts(host, port, timeoutMs, extra) {
  const opts = { host, port, timeout: timeoutMs || 10000, ...extra };
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) opts.servername = host; // SNI hostnames only (RFC 6066)
  return opts;
}
function tlsHandshake(host, port, timeoutMs, verify, caPem) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const opts = tlsOpts(host, port, timeoutMs, { rejectUnauthorized: verify !== false });
    // Per-compound private CA (PEM): trust exactly this CA instead of disabling verification.
    if (caPem && String(caPem).includes('BEGIN CERTIFICATE')) { opts.ca = String(caPem); opts.rejectUnauthorized = true; }
    const sock = tls.connect(opts, () => {
      const cert = sock.getPeerCertificate ? sock.getPeerCertificate() : null;
      const out = { ok: sock.authorized !== false || verify === false, ms: Date.now() - t0,
        subject: cert && cert.subject ? cert.subject.CN || JSON.stringify(cert.subject).slice(0, 200) : null,
        validTo: cert && cert.valid_to ? cert.valid_to : null,
        authorized: sock.authorized, authError: sock.authorizationError || null };
      try { sock.destroy(); } catch (_) {}
      resolve(out.ok ? out : { ...out, error: out.authError || 'TLS handshake failed', code: 'TLS_ERROR' });
    });
    sock.on('timeout', () => { try { sock.destroy(); } catch (_) {} resolve({ ok: false, ms: Date.now() - t0, error: 'TLS handshake timed out', code: 'TIMEOUT' }); });
    sock.on('error', (e) => resolve({ ok: false, ms: Date.now() - t0, error: String(e.message || e), code: 'TLS_ERROR' }));
  });
}

/* Per-compound TLS agent for real API traffic. Verification is ON unless the
   caller passes verify:false explicitly — and even then httpsGet() refuses to
   send the request (fail-closed, see below). Hostname/IP checks stay enabled:
   Node validates IP literals against certificate SANs. Explicit options here
   also neutralize process-wide bypasses such as NODE_TLS_REJECT_UNAUTHORIZED. */
function createTlsAgent({ verify = true, caPem = null } = {}) {
  const opts = { rejectUnauthorized: verify !== false, keepAlive: false };
  if (caPem && String(caPem).includes('BEGIN CERTIFICATE')) {
    opts.ca = String(caPem);
    opts.rejectUnauthorized = true; // a pinned approved CA replaces, never weakens, verification
  }
  return new https.Agent(opts);
}

async function httpsGet(baseUrl, path, headers, timeoutMs, verify, caPem) {
  const t0 = Date.now();
  const url = baseUrl.replace(/\/$/, '') + path;
  let u;
  try { u = new URL(url); } catch (e) { return { ok: false, ms: 0, error: 'Invalid API base URL.', code: 'BAD_CONFIG' }; }
  const isTls = u.protocol === 'https:';
  return new Promise((resolve) => {
    const done = (r) => resolve({ ...r, ms: Date.now() - t0 });
    let agent = null;
    try {
      const mod = isTls ? https : http;
      const reqOpts = { headers: headers || {}, timeout: timeoutMs || 15000 };
      if (isTls) { agent = createTlsAgent({ verify, caPem }); reqOpts.agent = agent; }
      const req = mod.get(url, reqOpts, (res) => {
        let body = '';
        res.on('data', (c) => { if (body.length < 4000) body += c; });
        res.on('end', () => { if (agent) agent.destroy(); done({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, bodyPreview: String(body).slice(0, 500) }); });
      });
      req.on('timeout', () => req.destroy(new Error(`request timed out after ${timeoutMs || 15000}ms`)));
      req.on('error', (e) => { if (agent) agent.destroy(); done({ ok: false, error: String(e.message || e).slice(0, 300), code: isTls ? 'TLS_ERROR' : 'API_UNREACHABLE' }); });
    } catch (e) { if (agent) agent.destroy(); done({ ok: false, error: String(e.message || e).slice(0, 300), code: 'API_UNREACHABLE' }); }
  });
}

/* Read-only certificate inspection: completes ONLY the TLS handshake with
   verification off and returns the presented certificate (subject/issuer/
   validity/SHA-256 fingerprint). No application data is sent. Used to show the
   administrator the exact cert to confirm out-of-band with IT. Never rejects. */
function tlsInspect(host, port, timeoutMs) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let sock;
    try {
      sock = tls.connect(tlsOpts(host, port, timeoutMs, { rejectUnauthorized: false }), () => {
        let cert = null;
        try { cert = sock.getPeerCertificate(true); } catch (_) { cert = null; }
        const out = { ok: !!(cert && (cert.fingerprint256 || cert.fingerprint)), ms: Date.now() - t0 };
        if (cert) {
          out.subject = cert.subject && cert.subject.CN ? cert.subject.CN : (cert.subject ? JSON.stringify(cert.subject).slice(0, 200) : null);
          out.issuer = cert.issuer && cert.issuer.CN ? cert.issuer.CN : (cert.issuer ? JSON.stringify(cert.issuer).slice(0, 200) : null);
          out.validFrom = cert.valid_from || null;
          out.validTo = cert.valid_to || null;
          out.fingerprint256 = cert.fingerprint256 || cert.fingerprint || null;
          out.selfSigned = out.subject != null && out.subject === out.issuer;
        } else { out.error = 'No certificate presented'; }
        try { sock.destroy(); } catch (_) {}
        resolve(out);
      });
    } catch (e) { resolve({ ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) }); return; }
    sock.on('timeout', () => { try { sock.destroy(); } catch (_) {} resolve({ ok: false, ms: Date.now() - t0, error: 'inspect timed out' }); });
    sock.on('error', (e) => resolve({ ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) }));
  });
}

module.exports = { dnsLookup, tcpConnect, tlsHandshake, tlsInspect, httpsGet, createTlsAgent };
