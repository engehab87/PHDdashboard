'use strict';
/* KPI + AI groundedness tests against the real September 2026 database. */
const { test } = require('node:test');
const assert = require('node:assert');
const { db } = require('../backend/db');
const { computeDashboard, compareCompounds, DEFINITIONS } = require('../backend/kpis');
const { answer } = require('../backend/ai');
const { qualityReport } = require('../backend/quality');

const P = '2026-09';
const hasData = db.prepare('SELECT COUNT(*) c FROM reporting_periods WHERE period_key=?').get(P).c > 0;

test('september period loaded', () => { assert.ok(hasData, 'run scripts/import-sep2026.js first'); });
test('every KPI has definition/formula/sources', () => {
  for (const d of DEFINITIONS) {
    assert.ok(d.id && d.name && d.definition && d.formula && Array.isArray(d.sources), d.id);
  }
});
test('active units = 25395-file + stubs only from refs; units-with-users counts units not users', () => {
  const d = computeDashboard(P, 'all');
  const get = id => (d.cards.find(c => c.id === id) || {}).value;
  const withUsers = get('units_with_users');
  const relCount = db.prepare("SELECT COUNT(*) c FROM user_units WHERE status='Active'").get().c;
  assert.ok(withUsers < relCount, 'must count distinct units, not relationships');
  assert.equal(get('coverage_pct'), +((withUsers / get('active_units')) * 100).toFixed(2));
});
test('registered vehicles != accessed vehicles (never mixed)', () => {
  const d = computeDashboard(P, 'all');
  const get = id => (d.cards.find(c => c.id === id) || {}).value;
  assert.notEqual(get('vehicles_registered'), get('hcp_unique'));
  assert.ok(get('hcp_events') >= get('hcp_unique'));
  assert.ok(get('hcp_auto_open') >= get('hcp_auto_unique'));
});
test('truncation warnings surfaced, never silent', () => {
  const d = computeDashboard(P, 'all');
  assert.ok(d.warnings.length >= 2, 'two 100k files must raise warnings');
  assert.match(d.warnings.join(' '), /100,?000/);
});
test('compare covers all compounds; unassigned units explain the difference to portfolio total', () => {
  const cmp = compareCompounds(P);
  const nComp = db.prepare('SELECT COUNT(*) c FROM compounds').get().c;
  assert.equal(cmp.rows.length, nComp + 1); // compare adds an explicit Unassigned row
  const unassignedRow = cmp.rows.find(r => r.unassigned);
  assert.ok(unassignedRow, 'Unassigned row must be present');
  const sumUnits = cmp.rows.reduce((s, r) => s + r.activeUnits, 0);
  const total = computeDashboard(P, 'all').cards.find(c => c.id === 'active_units').value;
  const unassigned = db.prepare('SELECT COUNT(*) c FROM units WHERE compound_id IS NULL').get().c;
  assert.equal(unassignedRow.activeUnits, unassigned);
  assert.equal(sumUnits, total);
});
test('quality report flags missing HCP person data instead of inventing', () => {
  const q = qualityReport(P);
  assert.ok(q.fileIssues.some(f => /HCP_PERSON_AUTH/.test(f.message)));
  assert.ok(q.reconciliation.length >= 8);
});
test('AI answers from DB: barrier numbers match KPI engine', async () => {
  const r = await answer('How many vehicles opened the barrier automatically?', { periodKey: P });
  const d = computeDashboard(P, 'all');
  const auto = d.cards.find(c => c.id === 'hcp_auto_open').value;
  assert.match(r.answer, new RegExp(auto.toLocaleString('en-US').replace(/,/g, ',?')));
  assert.ok(r.explanation && r.explanation.length > 10);
});
test('AI refuses to fabricate face recognition', async () => {
  const r = await answer('Which units had face recognition access during September?', { periodKey: P });
  assert.match(r.answer.toLowerCase(), /unavailable|no .* file|not.*provided/);
  assert.ok(!/\d{1,3}(,\d{3})+/.test(r.answer), 'must not contain invented thousand-scale numbers');
});
test('AI visitor question uses documented proxy', async () => {
  const r = await answer('Which compound had the highest number of visitors?', { periodKey: P });
  assert.match(r.answer.toLowerCase(), /gate pass|proxy/);
});
test('AI handles follow-up context', async () => {
  const r1 = await answer('Which compound has the highest visitor activity?', { periodKey: P });
  assert.ok(r1.compound && r1.compound !== 'all');
  const r2 = await answer('How many?', { periodKey: P, context: { compound: r1.compound, metric: r1.metric } });
  assert.match(r2.answer, new RegExp(r1.compound.split(' ')[0]));
});
