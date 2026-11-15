'use strict';
/* HCP TLS-transport + HTTPS-config tests. Offline and hermetic: certificates
   come from tests/helpers/makecerts.js (in-memory only) and the database is a
   temp file (DB_PATH set before requiring backend/db, isolated per process).
   No live HCP server is contacted; nothing here proves production connectivity. */
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcp-tls-test-'));
process.env.DB_PATH = path.join(tmpDir, 't.db');

const { db, migrate } = require('../backend/db');
const { migrateHcp, validateHcpConfig, saveHcpConfig, getHcpConfig } = require('../backend/hcp/store');
const { httpsGet, createTlsAgent } = require('../backend/hcp/netcheck');
const { makeLab } = require('./helpers/makecerts');

migrate();
migrateHcp(db);
db.prepare('INSERT INTO compounds(name) VALUES(?)').run('TLS Lab');

after(() => { try { db.close(); } catch (_) {} try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} });

const lab = makeLab();

function serveTLS(cert, key) {
  let hits = 0;
  const srv = https.createServer({ key, cert }, (req, res) => { hits++; res.end('tls-ok'); });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, hits: () => hits })));
}
test('correct CA certificate is accepted', async () => {
  const { srv, port } = await serveTLS(lab.serverCert, lab.serverKey);
  try {
    const r = await httpsGet(`https://127.0.0.1:${port}`, '/', null, 8000, true, lab.caCert);
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.match(r.bodyPreview, /tls-ok/);
  } finally { srv.close(); }
});

test('untrusted certificate is rejected', async () => {
  const { srv, port } = await serveTLS(lab.serverCert, lab.serverKey);
  try {
    const r = await httpsGet(`https://127.0.0.1:${port}`, '/', null, 8000, true, lab.decoyCaCert);
    assert.equal(r.ok, false);
    assert.match(String(r.error), /verify|certificate|self-signed|unable/i);
  } finally { srv.close(); }
});

test('default (unspecified) verification still rejects untrusted certificates', async () => {
  const { srv, port } = await serveTLS(lab.serverCert, lab.serverKey);
  try {
    const r = await httpsGet(`https://127.0.0.1:${port}`, '/', null, 8000, undefined, lab.decoyCaCert);
    assert.equal(r.ok, false);
  } finally { srv.close(); }
});

test('hostname/IP mismatch is rejected even with the correct CA', async () => {
  const { srv, port } = await serveTLS(lab.mismatchCert, lab.mismatchKey);
  try {
    const r = await httpsGet(`https://127.0.0.1:${port}`, '/', null, 8000, true, lab.caCert);
    assert.equal(r.ok, false);
    assert.match(String(r.error), /altname|match|verify|certificate/i);
  } finally { srv.close(); }
});

test('explicit verify=false is fail-closed: no socket is opened', async () => {
  const { srv, port, hits } = await serveTLS(lab.serverCert, lab.serverKey);
  try {
    const r = await httpsGet(`https://127.0.0.1:${port}`, '/', null, 8000, false, null);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'TLS_POLICY');
    assert.equal(hits(), 0);
  } finally { srv.close(); }
});

test('process-wide TLS bypass env cannot weaken the per-compound agent', async () => {
  const saved = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const agent = createTlsAgent({ verify: true, caPem: lab.decoyCaCert });
    assert.equal(agent.options.rejectUnauthorized, true);
    const { srv, port } = await serveTLS(lab.serverCert, lab.serverKey);
    try {
      const r = await httpsGet(`https://127.0.0.1:${port}`, '/', null, 8000, true, lab.decoyCaCert);
      assert.equal(r.ok, false);
    } finally { srv.close(); }
  } finally {
    if (saved === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved;
  }
});

test('agent pins approved CA without disabling verification', () => {
  const a = createTlsAgent({ verify: true, caPem: lab.caCert });
  assert.equal(a.options.rejectUnauthorized, true);
  assert.ok(a.options.ca);
  const d = createTlsAgent();
  assert.equal(d.options.rejectUnauthorized, true);
});

test('HTTPS disabled with port 443 generates a warning (setting preserved)', () => {
  const { warnings } = validateHcpConfig({ hcpHost: '192.168.15.15', hcpPort: 443, https: false });
  assert.ok(warnings.some(w => w.code === 'HTTPS_DISABLED_ON_443'));
});

test('HTTPS enabled on 443 and plaintext on 80 generate no such warning', () => {
  assert.deepEqual(validateHcpConfig({ hcpHost: 'h', hcpPort: 443, https: true }).warnings.filter(w => w.code === 'HTTPS_DISABLED_ON_443'), []);
  assert.deepEqual(validateHcpConfig({ hcpHost: 'h', hcpPort: 80, https: false }).warnings.filter(w => w.code === 'HTTPS_DISABLED_ON_443'), []);
});

test('disabled verification and non-PEM CA are flagged', () => {
  const { errors } = validateHcpConfig({ hcpHost: 'h', hcpPort: 443, https: true, tlsVerify: false, tlsCa: 'not-a-cert' });
  assert.ok(errors.some(w => w.code === 'TLS_VERIFY_DISABLED'));
  assert.ok(errors.some(w => w.code === 'TLS_CA_INVALID'));
});

test('HTTPS and TLS settings persist correctly (round-trip)', () => {
  saveHcpConfig(db, 1, { hcpHost: '10.9.9.9', hcpPort: 443, https: true, hcpVersion: '2.6.0', openapiVersion: '2.6', tlsVerify: true, tlsCa: lab.caCert, versionSource: 'manual' });
  let got = getHcpConfig(db, 1);
  assert.equal(got.hcp_host, '10.9.9.9');
  assert.equal(got.hcp_port, 443);
  assert.equal(got.https, 1);
  assert.equal(got.tls_verify, 1);
  assert.equal(got.tls_ca, lab.caCert);
  assert.equal(got.hcp_version, '2.6.0');
  // Explicitly saved https=false must persist as 0 (never silently rewritten).
  saveHcpConfig(db, 1, { hcpHost: '10.9.9.9', hcpPort: 443, https: false, tlsVerify: true, versionSource: 'manual' });
  got = getHcpConfig(db, 1);
  assert.equal(got.https, 0);
  assert.equal(got.hcp_port, 443);
  const { warnings } = validateHcpConfig({ hcpHost: got.hcp_host, hcpPort: got.hcp_port, https: got.https === 0 ? false : true });
  assert.ok(warnings.some(w => w.code === 'HTTPS_DISABLED_ON_443'));
});
