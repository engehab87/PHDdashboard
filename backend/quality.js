'use strict';
/* Data-quality engine: file quality, record quality, export completeness, reconciliation. */
const { db } = require('./db');

const EXPECTED = ['ALL_USERS', 'ACTIVE_UNITS', 'UNIT_ACCESS', 'VEHICLES', 'INVITATION_REQUESTS', 'ACTIVE_GATE_PASSES', 'HCP_VEHICLE_ACCESS'];
const EXPECTED_HCP_MISSING = ['HCP_PERSON_AUTH', 'HCP_VISITOR_AUTH', 'HCP_PERSON_INFORMATION'];

function qualityReport(periodKey) {
  let period = periodKey
    ? db.prepare('SELECT * FROM reporting_periods WHERE period_key=?').get(periodKey)
    : db.prepare('SELECT * FROM reporting_periods ORDER BY period_key DESC LIMIT 1').get();
  if (!period) {
    try { period = db.prepare('SELECT * FROM reporting_periods ORDER BY period_key DESC LIMIT 1').get() || null; } catch (_) { period = null; }
  }
  if (!period) return { period: null, score: 0, fileIssues: [], files: [], records: [], reconciliation: [] };
  const pid = period.id;
  const files = db.prepare('SELECT * FROM raw_files WHERE period_id=?').all(pid);
  const present = new Set(files.map(f => f.dataset_type));

  const fileIssues = [];
  for (const e of EXPECTED) if (!present.has(e)) fileIssues.push({ severity: 'warning', area: 'files', message: `Expected dataset missing: ${e}. Related KPIs will be unavailable.` });
  for (const e of EXPECTED_HCP_MISSING) fileIssues.push({ severity: 'info', area: 'files', message: `HCP dataset not provided: ${e}. Face-recognition and visitor-authentication analytics are unavailable (not fabricated).` });
  for (const f of files) {
    if (f.status === 'failed' || f.status === 'error') fileIssues.push({ severity: 'error', area: 'files', message: `"${f.filename}" failed: ${f.error || 'unknown error'}` });
    if (f.status === 'unknown') fileIssues.push({ severity: 'warning', area: 'files', message: `"${f.filename}" could not be classified. Assign a dataset type to include it.` });
    if (f.row_count === 0) fileIssues.push({ severity: 'warning', area: 'files', message: `"${f.filename}" is empty (0 rows).` });
    if (f.row_count === 100000) fileIssues.push({ severity: 'warning', area: 'completeness', message: `Potentially incomplete dataset "${f.filename}": source returned exactly 100,000 records (possible export limit). Treat totals as a lower bound.` });
  }

  const S = (sql, p) => db.prepare(sql).get(...(sql.includes('?') ? (p || [pid]) : [])).c;
  const R = (severity, area, message, count, sampleSql, sampleParams) => {
    let sample = [];
    try { if (sampleSql) sample = db.prepare(sampleSql).all(...(sampleParams || [])); } catch (e) { /* ignore */ }
    return { severity, area, message, count, sample };
  };
  const records = [
    R('warning', 'users', 'CRM users with no name (cannot be matched reliably).', S("SELECT COUNT(*) c FROM users WHERE norm_name IS NULL"), "SELECT id, mobile, email, status FROM users WHERE norm_name IS NULL LIMIT 20"),
    R('warning', 'users', 'Users with placeholder mobile numbers (e.g. +20, 0, 0000).', S("SELECT COUNT(*) c FROM users WHERE norm_mobile IS NULL AND mobile IS NOT NULL"), "SELECT name, mobile FROM users WHERE norm_mobile IS NULL AND mobile IS NOT NULL LIMIT 20"),
    R('info', 'users', 'Users with no status (auto-created stubs from relationship references, pending CRM review).', S('SELECT COUNT(*) c FROM users WHERE status IS NULL'), "SELECT name, registered_as FROM users WHERE status IS NULL LIMIT 20"),
    R('warning', 'relationships', 'Unit-access rows with no linked user.', S("SELECT COUNT(*) c FROM user_units WHERE user_id IS NULL"), "SELECT unit_ref_raw, compound_raw, access_type FROM user_units WHERE user_id IS NULL LIMIT 20"),
    R('warning', 'relationships', 'Unit-access rows with no linked unit.', S("SELECT COUNT(*) c FROM user_units WHERE unit_id IS NULL"), "SELECT user_name_raw, unit_ref_raw, compound_raw FROM user_units WHERE unit_id IS NULL LIMIT 20"),
    R('warning', 'units', 'Units with no compound assigned.', S('SELECT COUNT(*) c FROM units WHERE compound_id IS NULL'), "SELECT unit_number FROM units WHERE compound_id IS NULL LIMIT 20"),
    R('warning', 'units', 'Duplicate unit numbers (same number, different CRM records).', S('SELECT COUNT(*) c FROM (SELECT norm_unit FROM units WHERE norm_unit IS NOT NULL GROUP BY norm_unit HAVING COUNT(*)>1)'), "SELECT norm_unit, COUNT(*) n FROM units WHERE norm_unit IS NOT NULL GROUP BY norm_unit HAVING COUNT(*)>1 ORDER BY n DESC LIMIT 20"),
    R('warning', 'gate_passes', 'Gate passes with no compound.', S('SELECT COUNT(*) c FROM gate_passes WHERE period_id=? AND compound_id IS NULL'), "SELECT unit_ref_raw, user_name_raw FROM gate_passes WHERE period_id=? AND compound_id IS NULL LIMIT 20", [pid, pid]),
    R('warning', 'gate_passes', 'Gate passes with no unit reference.', S('SELECT COUNT(*) c FROM gate_passes WHERE period_id=? AND unit_id IS NULL'), "SELECT compound_raw, user_name_raw, access_type FROM gate_passes WHERE period_id=? AND unit_id IS NULL LIMIT 20", [pid, pid]),
    R('info', 'hcp', 'HCP events with unreadable plate ("Unknown").', S("SELECT COUNT(*) c FROM hcp_vehicle_events WHERE period_id=? AND plate_normalized IS NULL"), "SELECT parking_lot, gate, direction, COALESCE(enter_time,exit_time) t FROM hcp_vehicle_events WHERE period_id=? AND plate_normalized IS NULL LIMIT 20", [pid, pid]),
    R('warning', 'matching', 'HCP vehicle owners with no CRM match.', S("SELECT COUNT(*) c FROM identity_maps WHERE source_kind='hcp_owner' AND status='UNMATCHED'"), "SELECT source_key FROM identity_maps WHERE source_kind='hcp_owner' AND status='UNMATCHED' LIMIT 20"),
    R('info', 'matching', 'HCP vehicle owners needing manual review (ambiguous).', S("SELECT COUNT(*) c FROM identity_maps WHERE source_kind='hcp_owner' AND status='POSSIBLE_MATCH'"), "SELECT source_key FROM identity_maps WHERE source_kind='hcp_owner' AND status='POSSIBLE_MATCH' LIMIT 20"),
    R('info', 'vehicles', 'Registered CRM vehicles never observed in HCP access data.', S('SELECT COUNT(*) c FROM vehicles v LEFT JOIN (SELECT DISTINCT plate_normalized p FROM hcp_vehicle_events) h ON h.p=v.plate_norm LEFT JOIN (SELECT DISTINCT plate_normalized_latin p FROM hcp_vehicle_events) l ON l.p=v.plate_norm_latin WHERE h.p IS NULL AND (l.p IS NULL OR v.plate_norm_latin IS NULL)'), "SELECT plate_original, make, model FROM vehicles v LEFT JOIN (SELECT DISTINCT plate_normalized p FROM hcp_vehicle_events) h ON h.p=v.plate_norm WHERE h.p IS NULL LIMIT 20"),
  ];

  // reconciliation from latest import log
  let reconciliation = [];
  try {
    const imp = db.prepare("SELECT log FROM imports WHERE period_id=? AND LOWER(status) LIKE 'completed%' ORDER BY id DESC LIMIT 1").get(pid);
    if (imp && imp.log) {
      const s = JSON.parse(imp.log);
      reconciliation = (s.files || []).map(f => ({ file: f.filename, dataset: f.dataset, status: f.status, source: f.sourceRows || 0, processed: f.processed || 0, rejected: f.rejected || 0, duplicates: f.duplicates || 0, reason: f.reason || null }));
    }
  } catch (e) { /* ignore */ }

  const errors = fileIssues.filter(i => i.severity === 'error').length + records.filter(i => i.severity === 'error' && i.count > 0).length;
  const warnings = fileIssues.filter(i => i.severity === 'warning').length + records.filter(i => i.severity === 'warning' && i.count > 0).length;
  return { period: { key: period.period_key, name: period.period_name }, score: Math.max(0, 100 - errors * 10 - warnings * 2), fileIssues, records: records.filter(r => r.count > 0), reconciliation };
}

module.exports = { qualityReport, EXPECTED };
