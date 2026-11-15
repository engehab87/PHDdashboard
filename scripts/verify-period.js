'use strict';
/* Read-only verification of period readiness and reconciliation for the audit.
   Usage: DB_PATH=... node scripts/verify-period.js [periodKey] */
const path = require('path');
const { db } = require(path.join(__dirname, '..', 'backend', 'db'));

const periodKey = process.argv[2] || '2026-10';
const period = db.prepare('SELECT * FROM reporting_periods WHERE period_key=?').get(periodKey);

const out = { periodKey, period: period || null, imports: [], counts: {}, reconciliation: {}, kpis: null };

if (period) {
  out.imports = db.prepare('SELECT id,status,reporting_period,successful_files,failed_files,warning_count,error_count FROM imports WHERE reporting_period=? ORDER BY id').all(periodKey);
  out.counts = {
    units: db.prepare('SELECT COUNT(*) c FROM units').get().c,
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    vehicles: db.prepare('SELECT COUNT(*) c FROM vehicles').get().c,
    user_units: db.prepare('SELECT COUNT(*) c FROM user_units').get().c,
    invitations: db.prepare('SELECT COUNT(*) c FROM invitations WHERE period_id=?').get(period.id).c,
    gate_passes: db.prepare('SELECT COUNT(*) c FROM gate_passes WHERE period_id=?').get(period.id).c,
    hcp_events: db.prepare('SELECT COUNT(*) c FROM hcp_vehicle_events WHERE period_id=?').get(period.id).c,
    handover: db.prepare('SELECT COUNT(*) c FROM handover WHERE period_id=?').get(period.id).c,
    snapshots: db.prepare('SELECT COUNT(*) c FROM period_snapshots WHERE period_key=?').get(periodKey).c,
    metrics: db.prepare('SELECT COUNT(*) c FROM period_metrics WHERE period_id=?').get(period.id).c,
  };

  // Reconciliation: total units vs sum over compounds incl. null compound.
  const totalUnits = db.prepare('SELECT COUNT(*) c FROM units').get().c;
  const byCompound = db.prepare('SELECT compound_id, COUNT(*) c FROM units GROUP BY compound_id').all();
  const sumCompounds = byCompound.filter(r => r.compound_id != null).reduce((a, r) => a + r.c, 0);
  const unassigned = byCompound.filter(r => r.compound_id == null).reduce((a, r) => a + r.c, 0);
  out.reconciliation.units = { total: totalUnits, sumCompounds, unassigned, reconciles: totalUnits === sumCompounds + unassigned, groups: byCompound.length };

  // Reconciliation for period-scoped events.
  const totalEvents = db.prepare('SELECT COUNT(*) c FROM hcp_vehicle_events WHERE period_id=?').get(period.id).c;
  const evByCompound = db.prepare('SELECT compound_id, COUNT(*) c FROM hcp_vehicle_events WHERE period_id=? GROUP BY compound_id').all(period.id);
  const evSum = evByCompound.filter(r => r.compound_id != null).reduce((a, r) => a + r.c, 0);
  const evUnassigned = evByCompound.filter(r => r.compound_id == null).reduce((a, r) => a + r.c, 0);
  out.reconciliation.hcp_events = { total: totalEvents, sumCompounds: evSum, unassigned: evUnassigned, reconciles: totalEvents === evSum + evUnassigned };

  // Compare locked snapshot to live computation.
  const snap = db.prepare('SELECT * FROM period_snapshots WHERE period_key=? ORDER BY id DESC LIMIT 1').get(periodKey);
  if (snap) {
    let metrics = null;
    try { metrics = JSON.parse(snap.metrics || 'null'); } catch (e) { metrics = { parseError: e.message }; }
    let masterCounts = null;
    try { masterCounts = JSON.parse(snap.master_counts || 'null'); } catch (e) { masterCounts = { parseError: e.message }; }
    out.snapshot = { id: snap.id, period_key: snap.period_key, import_id: snap.import_id, created_at: snap.created_at, masterCounts, metricKeys: metrics && typeof metrics === 'object' ? Object.keys(metrics).slice(0, 40) : null, metricsSample: metrics && typeof metrics === 'object' ? Object.fromEntries(Object.entries(metrics).slice(0, 12)) : metrics };
  }
  out.kpis = db.prepare('SELECT metric_key, compound_id, value_num, value_text FROM period_metrics WHERE period_id=? AND compound_id IS NULL ORDER BY metric_key').all(period.id);
}

console.log(JSON.stringify(out, null, 2));
