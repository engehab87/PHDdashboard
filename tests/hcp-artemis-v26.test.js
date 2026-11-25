'use strict';
/* Phase 3 — Hikvision Artemis v26 adapter tests. Hermetic: no live HCP
   server is contacted. All signature, normalization, and selection logic is
   tested with documentation-derived fixtures and stubs. */
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.HCP_VAULT_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcp-artemis-v26-test-'));

const { resolveAdapter, matchAdapter, normVersion } = require('../backend/hcp/registry');
const { HcpArtemisV26Adapter, buildSignatureString, signRequest } = require('../backend/hcp/adapters/artemis-v26');
const { ADAPTER_CLASSES } = require('../backend/hcp/routes');

after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} });

/* ---------- signature string building ---------- */

test('signature string: method, headers, URI are concatenated with newlines', () => {
  const headers = {
    accept: 'application/json',
    'content-md5': 'abc123',
    'content-type': 'application/json;charset=UTF-8',
    date: 'Thu, 24 Nov 2016 03:12:25 GMT',
    'x-ca-key': 'appKey123',
    'x-ca-timestamp': '1479956865000',
    'x-ca-nonce': 'uuid-123',
  };
  const s = buildSignatureString({
    method: 'POST',
    uri: '/artemis/api/common/v1/version',
    headers,
    signedHeaders: ['x-ca-key', 'x-ca-timestamp', 'x-ca-nonce'],
  });
  const lines = s.split('\n');
  assert.equal(lines[0], 'POST');
  assert.equal(lines[1], 'application/json');
  assert.equal(lines[2], 'abc123');
  assert.equal(lines[3], 'application/json;charset=UTF-8');
  assert.equal(lines[4], 'Thu, 24 Nov 2016 03:12:25 GMT');
  assert.equal(lines[5], 'x-ca-key:appKey123');
  assert.equal(lines[6], 'x-ca-nonce:uuid-123');
  assert.equal(lines[7], 'x-ca-timestamp:1479956865000');
  assert.equal(lines[8], '/artemis/api/common/v1/version');
});

test('signature string: signed headers are sorted alphabetically', () => {
  const headers = {
    accept: '*/*',
    'content-md5': '',
    'content-type': '',
    date: '',
    'x-ca-key': 'k1',
    'x-ca-timestamp': 't1',
    'x-ca-nonce': 'n1',
  };
  const s = buildSignatureString({
    method: 'POST',
    uri: '/artemis/api/pms/v1/crossRecords/page',
    headers,
    signedHeaders: ['x-ca-nonce', 'x-ca-key', 'x-ca-timestamp'], // unsorted input
  });
  const lines = s.split('\n');
  assert.equal(lines[5], 'x-ca-key:k1');
  assert.equal(lines[6], 'x-ca-nonce:n1');
  assert.equal(lines[7], 'x-ca-timestamp:t1');
});

/* ---------- signature calculation ---------- */

test('signRequest: HMAC-SHA256 + base64 produces deterministic output', () => {
  const sig = signRequest({ secret: 'mySecret', signatureString: 'POST\n*/*\n\n\n\nx-ca-key:key1\n/artemis/api/test' });
  assert.equal(typeof sig, 'string');
  assert.ok(sig.length > 0);
  // Same input → same output
  assert.equal(signRequest({ secret: 'mySecret', signatureString: 'same' }), signRequest({ secret: 'mySecret', signatureString: 'same' }));
  // Different secret → different output
  assert.notEqual(signRequest({ secret: 'secret1', signatureString: 'same' }), signRequest({ secret: 'secret2', signatureString: 'same' }));
});

/* ---------- adapter registry ---------- */

test('adapter class map: hcp-artemis-v26 maps to HcpArtemisV26Adapter', () => {
  assert.ok(ADAPTER_CLASSES['hcp-artemis-v26']);
  assert.equal(ADAPTER_CLASSES['hcp-artemis-v26'], HcpArtemisV26Adapter);
});

test('adapterClassFor: returns null for unknown adapterId', () => {
  const { adapterClassFor } = require('../backend/hcp/routes');
  assert.equal(adapterClassFor('nonexistent-adapter'), null);
});

/* ---------- normalize ---------- */

test('normalize: access-event maps crossRecordSyscode as source_id, plate as plateNo', () => {
  const adapter = new HcpArtemisV26Adapter({ compound: 3, hcp: { hcp_version: '2.6.0', openapi_version: '2.6' }, creds: {}, net: {} });
  const raw = {
    crossRecordSyscode: '74554754035654645',
    cameraIndexCode: '1',
    plateNo: 'a123456',
    ownerName: 'aaa',
    contact: '123',
    vehicleType: 1,
    vehicleColor: 3,
    vehicleBrand: 5,
    vehicleSpeed: 50,
    crossTime: '2018-07-26T15:00:00+08:00',
    createTime: '2018-07-26T15:00:00+08:00',
    vehicleDirectionType: 1,
    plateCategory: 'private',
    plateSize: 2,
    plateType: 'unknown',
    plateColor: 'blue',
    country: 5,
    combinePlateLicense: 'a123456',
  };
  const n = adapter.normalize('access-events', raw, {
    compoundId: 3,
    hcpVersion: '2.6.0',
    openapiVersion: '2.6',
  });
  assert.equal(n.compound_id, 3);
  assert.equal(n.source_system, 'hcp-live');
  assert.equal(n.provenance, 'live-hcp');
  assert.equal(n.adapter_id, 'hcp-artemis-v26');
  assert.equal(n.source_entity, 'access-events');
  assert.equal(n.source_id, '74554754035654645');
  assert.equal(n.data.plate, 'a123456');
  assert.equal(n.data.direction, 'EXIT'); // vehicleDirectionType === 1
  assert.equal(n.data.gate, '1');
  assert.equal(n.data.ownerRef, 'aaa');
  assert.equal(n.data.event_time, '2018-07-26T15:00:00+08:00');
  // No biometric material
  assert.ok(!JSON.stringify(n).match(/biometric|template|image/i));
});

test('normalize: vehicleDirectionType 2 maps to ENTRY', () => {
  const adapter = new HcpArtemisV26Adapter({ compound: 3, hcp: {}, creds: {}, net: {} });
  const n = adapter.normalize('access-events', { vehicleDirectionType: 2, crossRecordSyscode: 'x1' }, { compoundId: 3 });
  assert.equal(n.data.direction, 'ENTRY');
});

test('normalize: persons maps personId as source_id', () => {
  const adapter = new HcpArtemisV26Adapter({ compound: 3, hcp: {}, creds: {}, net: {} });
  const n = adapter.normalize('persons', { personId: 'P-1', name: 'John Doe', personType: 'Owner' }, { compoundId: 3 });
  assert.equal(n.source_id, 'P-1');
  assert.equal(n.data.name, 'John Doe');
  assert.equal(n.data.userType, 'Owner');
});

test('normalize: visitors maps visitorName and source_id', () => {
  const adapter = new HcpArtemisV26Adapter({ compound: 3, hcp: {}, creds: {}, net: {} });
  const n = adapter.normalize('visitors', { visitorName: 'Jane Visitor', visitorId: 'V-9', status: 'Approved' }, { compoundId: 3 });
  assert.equal(n.source_id, 'V-9');
  assert.equal(n.data.visitor, 'Jane Visitor');
  assert.equal(n.data.status, 'Approved');
});

test('normalize: face-events has no biometric data', () => {
  const adapter = new HcpArtemisV26Adapter({ compound: 3, hcp: {}, creds: {}, net: {} });
  const n = adapter.normalize('face-events', { personId: 'F-1', result: 'Matched' }, { compoundId: 3 });
  assert.equal(n.source_id, 'F-1');
  assert.equal(n.data.personRef, 'F-1');
  assert.equal(n.data.device, null);
  assert.ok(!JSON.stringify(n).match(/biometric|template|image/i));
});

/* ---------- authenticate: blocked without credentials ---------- */

test('authenticate: returns blocked-pending-adapter when no appKey', async () => {
  const adapter = new HcpArtemisV26Adapter({ compound: 3, hcp: {}, creds: {}, net: {} });
  const r = await adapter.authenticate();
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'missing-credentials');
});

test('authenticate: returns blocked-pending-adapter when no appSecret', async () => {
  const adapter = new HcpArtemisV26Adapter({ compound: 3, hcp: {}, creds: { appKey: 'key1' }, net: {} });
  const r = await adapter.authenticate();
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'missing-credentials');
});

/* ---------- fetchCategory: unsupported category ---------- */

test('fetchCategory: unsupported category returns blocked', async () => {
  const adapter = new HcpArtemisV26Adapter({ compound: 3, hcp: {}, creds: {}, net: {} });
  const r = await adapter.fetchCategory('face-events');
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'unsupported-category');
  assert.deepEqual(r.records, []);
});
