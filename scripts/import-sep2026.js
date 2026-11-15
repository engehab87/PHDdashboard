'use strict';
/* One-shot loader for the real September 2026 dataset (dev/test fixture). */
const fs = require('fs');
const path = require('path');
const { migrate, db } = require('../backend/db');
const { processImport, ingestFile, getOrCreatePeriod, autoMatch, snapshotMetrics, EXPORT_LIMITS } = require('../backend/ingest');

const DIR = 'C:/Users/ehab.moustafa/Downloads';
const FILES = [
  ['Active Units 02-10-2026 13-39-39.xlsx', 'Active Units', 'ACTIVE_UNITS'],
  ['All Users 02-10-2026 13-35-15.xlsx', 'All Users', 'ALL_USERS'],
  ['All Units Access 02-10-2026 13-38-57.xlsx', 'All Units Access', 'UNIT_ACCESS'],
  ['All Vehicles 02-10-2026 13-38-22.xlsx', 'All Vehicles', 'VEHICLES'],
  ['All Invitation Requests 02-10-2026 13-36-09.xlsx', 'All Invitation Requests', 'INVITATION_REQUESTS'],
  ['Active Gate Passes 02-10-2026 13-38-00.xlsx', 'Active Gate Passes', 'ACTIVE_GATE_PASSES'],
  ['Entrance and Exit Retrieval_20261002125636.xlsx', 'Entrance and Exit Retrieval', 'HCP_VEHICLE_ACCESS'],
  ['Handing over, finishing permits and resident_9377.xlsx', null, 'HANDOVER'],
];

async function main() {
  migrate();
  const period = getOrCreatePeriod('2026-09', 'Sep2026.zip (Sept 2026 real dataset)');
  const imp = db.prepare("INSERT INTO imports(period_id,detected_period_key,uploaded_at,source_filename,status) VALUES(?,? ,datetime('now'),?,'processing')").run(period.id, '2026-09', 'Sep2026.zip');
  const importId = Number(imp.lastInsertRowid);
  // wipe period-scoped tables for idempotent reload
  for (const t of ['hcp_vehicle_events', 'gate_passes', 'invitations', 'handover']) db.prepare(`DELETE FROM ${t} WHERE period_id=?`).run(period.id);
  db.prepare('DELETE FROM raw_rows WHERE period_id=?').run(period.id);
  const t0 = Date.now();
  const fileSummaries = [];
  for (const [file, sheet, dataset] of FILES) {
    const fp = path.join(DIR, file);
    if (!fs.existsSync(fp)) { console.log('SKIP (missing): ' + file); continue; }
    let sheetName = sheet;
    if (!sheetName) {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(fp, { sheetRows: 5 });
      sheetName = wb.SheetNames.find(s => !/^hidden/i.test(s));
    }
    console.log(`ingesting ${dataset} ...`);
    const t = Date.now();
    const stats = ingestFile(fp, sheetName, dataset, period, importId);
    console.log(`  ${dataset}: source=${stats.sourceRows} processed=${stats.processed} rejected=${stats.rejected} dups=${stats.duplicates} truncated=${!!stats.truncated} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    fileSummaries.push({ filename: file, dataset, status: 'ok', sourceRows: stats.sourceRows, processed: stats.processed, rejected: stats.rejected, duplicates: stats.duplicates });
    db.prepare('INSERT INTO raw_files(import_id,period_id,filename,dataset_type,sheet,row_count,status) VALUES(?,?,?,?,?,?,?)')
      .run(importId, period.id, file, dataset, sheetName, stats.sourceRows, 'ok');
  }
  snapshotMetrics(period.id, '2026-09');
  const m = autoMatch(period.id);
  console.log('matching:', JSON.stringify(m));
  db.prepare('UPDATE imports SET status=?, log=? WHERE id=?').run('completed', JSON.stringify({ period: '2026-09', files: fileSummaries }), importId);
  console.log('TOTAL ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  // verification counts
  for (const t of ['compounds', 'units', 'users', 'user_units', 'vehicles', 'invitations', 'gate_passes', 'hcp_vehicle_events', 'handover', 'raw_rows']) {
    console.log(t.padEnd(20), db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
  }
}
main().catch(e => { console.error('FAILED:', e); process.exit(1); });
