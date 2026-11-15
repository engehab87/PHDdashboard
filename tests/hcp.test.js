'use strict';
/* HCP integration tests — SIMULATED (mocked fixtures, no live server).
   A pass here NEVER means a live HCP server is connected; live results are
   reported separately from /api/hcp test runs. Run: npm test */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.HCP_VAULT_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { encrypt, decrypt, vaultAvailable, isVaultPayload } = require('../backend/hcp/crypto');
const { resolveAdapter, ADAPTERS } = require('../backend/hcp/registry');
const { GenericAdapter, withRetry, paginateParams } = require('../backend/hcp/adapters/generic');
const netcheck = require('../backend/hcp/netcheck');

test('vault encrypt/decrypt round-trips; payload never plaintext', () => {
  assert.ok(vaultAvailable());
  const enc = encrypt('s3cr3t-app-secret');
  assert.ok(isVaultPayload(enc));
  assert.ok(!enc.includes('s3cr3t'));
  assert.equal(decrypt(enc), 's3cr3t-app-secret');
});

test('vault missing key fails secure (no silent plaintext)', () => {
  const saved = process.env.HCP_VAULT_KEY;
  delete process.env.HCP_VAULT_KEY;
  assert.throws(() => encrypt('x'), /HCP_VAULT_KEY/);
  process.env.HCP_VAULT_KEY = saved;
});

test('adapter resolution: retired template matches nothing, even plausible versions', () => {
  assert.equal(resolveAdapter({ hcpVersion: '2.3', openapiVersion: '1.2' }), null);
});

test('adapter resolution: HCP 2.6.0 / OpenAPI 2.6 resolves to hcp-artemis-v26 (unverified)', () => {
  const a = resolveAdapter({ hcpVersion: '2.6.0', openapiVersion: '2.6' });
  assert.ok(a);
  assert.equal(a.adapterId, 'hcp-artemis-v26');
  assert.equal(a.verified, false);
});

test('adapter resolution: unknown version returns null (no silent fallback)', () => {
  assert.equal(resolveAdapter({ hcpVersion: '9.9', openapiVersion: '9.9' }), null);
});

test('registry honesty: no adapter verified without official docs', () => {
  assert.ok(ADAPTERS.every(a => a.verified === false));
});

test('generic adapter refuses live auth/fetch without docs (no fabricated endpoints)', async () => {
  const ga = new GenericAdapter({ compound: 1 });
  const auth = await ga.authenticate();
  assert.equal(auth.ok, false);
  assert.equal(auth.blocked, 'pending-docs');
  const fetch = await ga.fetchCategory('access-events');
  assert.equal(fetch.ok, false);
  assert.deepEqual(fetch.records, []);
});

test('normalize maps access-event fixture, preserves provenance, no biometric material', () => {
  const ga = new GenericAdapter({ compound: 1 });
  const n = ga.normalize('access-events',
    { eventId: 'EV-1', plateNo: 'ABC123', direction: 'ENTRY', gate: 'G1', result: 'PASS', eventTime: '2026-10-01 08:00' },
    { compoundId: 7, hcpVersion: '2.3', openapiVersion: '1.2' });
  assert.equal(n.compound_id, 7);
  assert.equal(n.source_system, 'hcp-live');
  assert.equal(n.provenance, 'live-hcp');
  assert.equal(n.data.plate, 'ABC123');
  assert.ok(!JSON.stringify(n).match(/template|image|biometric/i));
});

test('normalize never fabricates missing visitor fields', () => {
  const ga = new GenericAdapter({ compound: 1 });
  const n = ga.normalize('visitors', { code: 'V-9' }, { compoundId: 1 });
  assert.equal(n.data.hostRef, null);
  assert.equal(n.data.validUntil, null);
});

test('retry helper retries 429/5xx then succeeds; does not retry 4xx', async () => {
  let n = 0;
  const r = await withRetry(async () => { if (++n < 3) { const e = new Error('busy'); e.status = 503; throw e; } return 'ok'; });
  assert.equal(r, 'ok');
  assert.equal(n, 3);
  await assert.rejects(() => withRetry(async () => { const e = new Error('denied'); e.status = 403; throw e; }), /denied/);
});

test('pagination helper bounds page size', () => {
  assert.deepEqual(paginateParams(0, 99999), { pageNo: 1, pageSize: 1000 });
});

test('netcheck exposes real diagnostics functions (no fabricated results)', () => {
  for (const fn of ['dnsLookup', 'tcpConnect', 'tlsHandshake', 'tlsInspect', 'httpsGet']) assert.equal(typeof netcheck[fn], 'function');
});

test('tlsInspect never rejects; reports clean error when nothing listens (simulated)', async () => {
  const { tlsInspect } = require('../backend/hcp/netcheck');
  const r = await tlsInspect('127.0.0.1', 1, 2000);
  assert.equal(typeof r, 'object');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('sanitize masks nested credential objects (detail endpoint shape)', () => {
  const { sanitize } = require('../backend/hcp/store');
  const out = sanitize({ compound: { name: 'X' }, cred: { app_key: 'K', app_secret_enc: 'v1:abc' }, net: { vpn_password_enc: 'v1:def' } });
  assert.equal(out.cred.app_key, 'K');
  assert.equal(out.cred.app_secret_enc, '***set***');
  assert.equal(out.net.vpn_password_enc, '***set***');
});
test('sanitize masks secrets before frontend/audit', () => {
  const { sanitize } = require('../backend/hcp/store');
  const out = sanitize({ app_key: 'visible', app_secret_enc: 'v1:xx', vpn_password_enc: 'v1:yy' });
  assert.equal(out.app_key, 'visible');
  assert.equal(out.app_secret_enc, '***set***');
  assert.equal(out.vpn_password_enc, '***set***');
});
