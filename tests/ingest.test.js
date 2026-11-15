'use strict';
/* Ingestion tests: classification, validation, normalization. */
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyFile } = require('../backend/datasets');
const N = require('../backend/normalize');

test('classify ALL_USERS by columns even with renamed file', () => {
  const r = classifyFile('random-export-99.xlsx', [{ name: 'Sheet1', header: ['(Do Not Modify) User', 'Name', 'Mobile Number', 'User Status', 'Registered As', 'Created On'] }]);
  assert.equal(r.dataset, 'ALL_USERS');
  assert.equal(r.status, 'identified');
});

test('classify HCP vehicle by columns even with unknown filename', () => {
  const r = classifyFile('download (7).xlsx', [{ name: 'data', header: ['License Plate No.', 'Enter or Exit', 'Entrance/Exit', 'Entry and Exit Method', 'Entry and Exit Result', 'Parking Lot'] }]);
  assert.equal(r.dataset, 'HCP_VEHICLE_ACCESS');
});

test('classify gate passes vs unit access distinctly', () => {
  const gp = classifyFile('x.xlsx', [{ name: 's', header: ['(Do Not Modify) Gate Pass', 'Compound Ref', 'Unit Ref.', 'User Ref.', 'Access Type', 'Entry Date'] }]);
  assert.equal(gp.dataset, 'ACTIVE_GATE_PASSES');
  const ua = classifyFile('x.xlsx', [{ name: 's', header: ['(Do Not Modify) Unit User', 'Compound (Unit) (Unit)', 'Unit', 'User', 'Access Type', 'Status'] }]);
  assert.equal(ua.dataset, 'UNIT_ACCESS');
});

test('unknown file stays unknown', () => {
  const r = classifyFile('Ow98234.xlsx', [{ name: 's', header: ['Foo', 'Bar', 'Baz', 'Qux'] }]);
  assert.equal(r.dataset, 'UNKNOWN');
  assert.equal(r.status, 'unknown');
});

test('arabic plate normalization preserves original, matches across formats', () => {
  const a = N.normalizePlate('س أ ص ٨٨٧٩');
  const b = N.normalizePlate('سأص8879');
  assert.equal(a.norm, b.norm);
  assert.ok(a.norm && a.norm.length > 0);
  const unk = N.normalizePlate('Unknown');
  assert.equal(unk.norm, null);
});

test('phone normalization', () => {
  assert.equal(N.normalizePhone('+201223901967').norm, '+201223901967');
  assert.equal(N.normalizePhone('01223901967').norm, '+201223901967');
  assert.equal(N.normalizePhone('+20').norm, null);
  assert.equal(N.normalizePhone('0000').norm, null);
});

test('excel serial to ISO', () => {
  const iso = N.excelSerialToISO(46297.5);
  assert.match(iso, /^2026-10-02/);
  assert.equal(N.excelSerialToISO('2026/09/30 23:51:58'), '2026-09-30 23:51');
  assert.equal(N.periodKeyFromISO('2026-09-30 23:51'), '2026-09');
});

test('name normalization is case/space insensitive', () => {
  assert.equal(N.normalizeName('  Mohamed   Essam '), N.normalizeName('mohamed essam'));
});
