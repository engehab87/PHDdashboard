'use strict';
/* CRM vs HCP workflow separation: source classification, mandatory compound,
   compound ID persistence, cross-workflow rejection, dedup, rollback.
   Runs against TEST_DATABASE_URL (disposable PostgreSQL DB, never production). */
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-crm-hcp-'));

const AdmZip = require('adm-zip');
const XLSX = require('xlsx');
const { migrate, db } = require('../backend/db');
const { stageUpload, processImport, rollbackImport, workflowForDataset } = require('../backend/ingest');

const COLS = {
  users: ['(Do Not Modify) User', 'Name', 'Mobile Number', 'Email', 'User Status', 'Registered As', 'Created On'],
  units: ['(Do Not Modify) Unit', 'Name', 'Compound', 'Related Unit'],
  hcp: ['License Plate No.', 'Parking Lot', 'Enter or Exit', 'Entering Time', 'Departure Time', 'Entrance/Exit', 'Entry and Exit Method', 'Entry and Exit Result', 'Vehicle Owner'],
  regveh: ['*License plate No.', "Owner's Last Name", "Owner's First Name", 'Phone', 'Start Time of Effective Period', 'End Time of Effective Period', 'Vehicle Type', 'Brand', 'Vehicle Color', 'Vehicle Owner ID', 'Card', 'Vehicle List', 'Parking Lot', 'Start Time of Parking Lot Validity Period', 'End Time of Parking Lot Validity Period'],
};
const U = (id, name) => [id, name, '01220000001', 'x@x.com', 'Active', 'Owner', 46297];
const HCP = (plate, dt, dir) => [plate, 'Main Gate', dir, dir === 'Entering' ? dt : '', dir === 'Exit' ? dt : '', 'G1', dir === 'Entering' ? 'Auto Entry & Exit' : 'Barrier Not Open', dir === 'Entering' ? 'Pass' : 'Not Passed', ''];
const REG = (plate, first, last) => [plate, last, first, '+20120000011', '2024/01/01 00:00:00', '2030/01/01 00:00:00', '', 'Toyota', '', 'reg-1', '', 'Badya', 'Main Gate', '|', '|'];

function wbFile(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const p = path.join(TMP, `f${Math.random().toString(36).slice(2)}.xlsx`);
  XLSX.writeFile(wb, p);
  return p;
}
function makeZip(name, files) {
  const z = new AdmZip();
  for (const [entry, fp] of files) z.addFile(entry, fs.readFileSync(fp));
  const zp = path.join(TMP, name);
  z.writeZip(zp);
  return zp;
}

let badyaId;

before(() => {
  migrate();
  db.prepare('INSERT INTO compounds(name) VALUES(?)').run('Badya');
  badyaId = db.prepare("SELECT id FROM compounds WHERE name='Badya'").get().id;
});

test('workflow classification maps datasets correctly', () => {
  assert.equal(workflowForDataset('ALL_USERS'), 'CRM');
  assert.equal(workflowForDataset('VEHICLES'), 'CRM');
  assert.equal(workflowForDataset('HCP_VEHICLE_ACCESS'), 'HCP');
  assert.equal(workflowForDataset('HCP_REGISTERED_VEHICLES'), 'HCP');
  assert.equal(workflowForDataset('HANDOVER'), 'OPS');
  assert.equal(workflowForDataset('UNKNOWN'), null);
});

test('HCP staging requires an existing compound (never a typed name)', () => {
  const zp = makeZip('hcp1.zip', [['hcp.xlsx', wbFile([COLS.hcp, HCP('WF1', '2026/09/05 10:01:00', 'Entering')])]]);
  assert.throws(() => stageUpload({ filePath: zp, originalName: 'hcp1.zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: null }), /compound/i);
  assert.throws(() => stageUpload({ filePath: zp, originalName: 'hcp1.zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: 99999 }), /Unknown compound/i);
  const staged = stageUpload({ filePath: zp, originalName: 'hcp1.zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: badyaId, uploadedBy: 'tester' });
  const imp = db.prepare('SELECT * FROM imports WHERE id=?').get(staged.importId);
  assert.equal(imp.source_kind, 'HCP_MANUAL_UPLOAD');
  assert.equal(imp.compound_id, badyaId);
  assert.equal(imp.uploaded_by, 'tester');
});

test('CRM staging persists CRM_UPLOAD with no compound', () => {
  const zp = makeZip('crm1.zip', [['users.xlsx', wbFile([COLS.users, U('cu-1', 'Wf Crm User')])]]);
  const staged = stageUpload({ filePath: zp, originalName: 'crm1.zip', sourceKind: 'CRM_UPLOAD', uploadedBy: 'tester' });
  const imp = db.prepare('SELECT * FROM imports WHERE id=?').get(staged.importId);
  assert.equal(imp.source_kind, 'CRM_UPLOAD');
  assert.equal(imp.compound_id, null);
});

test('CRM import never ingests HCP rows (workflow separation)', () => {
  const zp = makeZip('crmixed.zip', [
    ['users.xlsx', wbFile([COLS.users, U('cu-2', 'Wf Mixed')])],
    ['hcp.xlsx', wbFile([COLS.hcp, HCP('WF2', '2026/09/05 10:01:00', 'Entering')])],
  ]);
  const staged = stageUpload({ filePath: zp, originalName: 'crmixed.zip', sourceKind: 'CRM_UPLOAD' });
  processImport(staged.importId, '2026-09');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM hcp_vehicle_events WHERE plate_normalized LIKE '%WF2%' OR plate_original='WF2'").get().c, 0);
  const rf = db.prepare("SELECT dataset_type, status FROM raw_files WHERE import_id=? AND dataset_type='HCP_VEHICLE_ACCESS'").get(staged.importId);
  assert.equal(rf.status, 'validation_failed');
});

test('HCP import persists compound ID, source kind and blocks CRM masters', () => {
  const zp = makeZip('hcp2.zip', [
    ['users.xlsx', wbFile([COLS.users, U('hu-1', 'Wf Hcp User')])],
    ['hcp.xlsx', wbFile([COLS.hcp, HCP('WF3', '2026/09/05 10:01:00', 'Entering'), HCP('WF4', '2026/09/05 12:00:00', 'Exit')])],
  ]);
  const staged = stageUpload({ filePath: zp, originalName: 'hcp2.zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: badyaId });
  processImport(staged.importId, '2026-09');
  const ev = db.prepare("SELECT * FROM hcp_vehicle_events WHERE plate_original='WF3'").get();
  assert.ok(ev);
  assert.equal(ev.compound_id, badyaId);
  assert.equal(ev.source_kind, 'HCP_MANUAL_UPLOAD');
  assert.equal(ev.import_id, staged.importId);
  const us = db.prepare("SELECT COUNT(*) c FROM users WHERE external_id='hu-1'").get().c;
  assert.equal(us, 0);
  const rf = db.prepare("SELECT status FROM raw_files WHERE import_id=? AND dataset_type='ALL_USERS'").get(staged.importId);
  assert.equal(rf.status, 'validation_failed');
});

test('duplicate HCP file does not duplicate events (fingerprint dedup)', () => {
  const zp = makeZip('hcpdup.zip', [['hcp.xlsx', wbFile([COLS.hcp, HCP('WF3', '2026/09/05 10:01:00', 'Entering'), HCP('WF4', '2026/09/05 12:00:00', 'Exit')])]]);
  const staged = stageUpload({ filePath: zp, originalName: 'hcpdup.zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: badyaId });
  processImport(staged.importId, '2026-09');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM hcp_vehicle_events WHERE plate_original='WF3'").get().c, 1);
});

test('HCP import creates no new compounds', () => {
  const before = db.prepare('SELECT COUNT(*) c FROM compounds').get().c;
  const zp = makeZip('hcp3.zip', [['hcp.xlsx', wbFile([COLS.hcp, HCP('WF5', '2026/09/06 09:00:00', 'Entering')])]]);
  const staged = stageUpload({ filePath: zp, originalName: 'hcp3.zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: badyaId });
  processImport(staged.importId, '2026-09');
  const after = db.prepare('SELECT COUNT(*) c FROM compounds').get().c;
  assert.equal(after, before);
});

test('rollback removes HCP rows but keeps the workflow import history', () => {
  const zp = makeZip('hcproll.zip', [['hcp.xlsx', wbFile([COLS.hcp, HCP('WF6', '2026/09/07 09:00:00', 'Entering')])]]);
  const staged = stageUpload({ filePath: zp, originalName: 'hcproll.zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: badyaId });
  processImport(staged.importId, '2026-09');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM hcp_vehicle_events WHERE plate_original='WF6'").get().c, 1);
  rollbackImport(staged.importId, 'tester');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM hcp_vehicle_events WHERE plate_original='WF6'").get().c, 0);
  const imp = db.prepare('SELECT status, source_kind FROM imports WHERE id=?').get(staged.importId);
  assert.equal(imp.source_kind, 'HCP_MANUAL_UPLOAD');
});

test('HCP registered vehicles are classified and ingested (not empty)', () => {
  const zp = makeZip('Registered Vehicle (1).zip', [['Registered Vehicle (1).xlsx', wbFile([COLS.regveh, REG('NWR111', 'Mahmoud', 'Osman'), REG('NWR222', 'Sara', 'Naguib')])]]);
  const staged = stageUpload({ filePath: zp, originalName: 'Registered Vehicle (1).zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: badyaId });
  const dataset = db.prepare("SELECT dataset_type FROM raw_files WHERE import_id=?").get(staged.importId).dataset_type;
  assert.equal(dataset, 'HCP_REGISTERED_VEHICLES');
  processImport(staged.importId, '2026-09');
  const count = db.prepare("SELECT COUNT(*) c FROM vehicles WHERE plate_original IN ('NWR111','NWR222')").get().c;
  assert.equal(count, 2);
});

test('HCP registered owner links prefer the uploaded compound (name->compound relation)', () => {
  db.prepare("INSERT INTO users(external_id, name, norm_name, mobile, norm_mobile, status, registered_as, first_seen, last_seen) VALUES(?,?,?,?,?,?,?,?,?)")
    .run('cr-1', 'Nora Test', 'nora test', '01220000030', '+201220000030', 'Active', 'Owner', '2026-09', '2026-09');
  const uid = db.prepare("SELECT id FROM users WHERE external_id='cr-1'").get().id;
  const unitId = db.prepare("INSERT INTO units(external_id, unit_number, norm_unit, compound_id, first_seen, last_seen) VALUES(?,?,?,?,?,?)")
    .run('cr-unit-1', 'NORA-1', 'NORA-1', badyaId, '2026-09', '2026-09').lastInsertRowid;
  db.prepare("INSERT INTO user_units(external_id, user_id, user_name_raw, unit_id, unit_ref_raw, compound_id, compound_raw, access_type, status, first_seen, last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run('cr-uu-1', uid, 'Nora Test', unitId, 'NORA-1', badyaId, 'Badya', 'Owner', 'Active', '2026-09', '2026-09');
  const zp = makeZip('reg-badya.zip', [['Registered Vehicle (1).xlsx', wbFile([COLS.regveh, REG('NORA900', 'Nora', 'Test')])]]);
  const staged = stageUpload({ filePath: zp, originalName: 'Registered Vehicle (1).zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: badyaId });
  processImport(staged.importId, '2026-09');
  const row = db.prepare("SELECT user_id FROM vehicles WHERE plate_original='NORA900'").get();
  assert.equal(row.user_id, uid);
  const inBadya = db.prepare('SELECT COUNT(*) c FROM vehicles v WHERE v.plate_original=? AND EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id=v.user_id AND uu.compound_id=?)').get('NORA900', badyaId).c;
  assert.equal(inBadya, 1);
});

test('HCP registered duplicate plate is skipped without a foreign-key failure', () => {
  db.prepare("INSERT INTO vehicles(external_id, make, model, year, plate_original, plate_norm, user_name_raw, status) VALUES(?,?,?,?,?,?,?,?)")
    .run('cr-veh-1', 'Toyota', 'Corolla', '2024', 'NORA999', 'nora999', null, 'Approved By PHD');
  const zp = makeZip('reg-dup.zip', [['Registered Vehicle (1).xlsx', wbFile([COLS.regveh, REG('NORA999', 'Nora', 'Test')])]]);
  const staged = stageUpload({ filePath: zp, originalName: 'Registered Vehicle (1).zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: badyaId });
  processImport(staged.importId, '2026-09');
  const count = db.prepare("SELECT COUNT(*) c FROM vehicles WHERE plate_norm='nora999'").get().c;
  assert.equal(count, 1);
  const imp = db.prepare('SELECT status FROM imports WHERE id=?').get(staged.importId);
  assert.match(imp.status, /COMPLETED/);
});

test('staged UNKNOWN file is reclassified at processing time', () => {
  const zp = makeZip('reg-reclass.zip', [['Registered Vehicle (1).xlsx', wbFile([COLS.regveh, REG('NORA800', 'Nora', 'Test')])]]);
  const staged = stageUpload({ filePath: zp, originalName: 'Registered Vehicle (1).zip', sourceKind: 'HCP_MANUAL_UPLOAD', compoundId: badyaId });
  db.prepare("UPDATE raw_files SET dataset_type='UNKNOWN', sheet=NULL, status='unknown' WHERE import_id=?").run(staged.importId);
  processImport(staged.importId, '2026-09');
  const count = db.prepare("SELECT COUNT(*) c FROM vehicles WHERE plate_original='NORA800'").get().c;
  assert.equal(count, 1);
});

test('canonical migration merges one-real resident duplicates and restores compound relations', () => {
  const { migrate } = require('../backend/db');
  const real = db.prepare("INSERT INTO users(external_id, name, norm_name, mobile, norm_mobile, status, registered_as, first_seen, last_seen) VALUES(?,?,?,?,?,?,?,?,?)")
    .run('can-1', 'Lina Canonical', 'lina canonical', '01220000040', '+201220000040', 'Active', 'Owner', '2026-09', '2026-09').lastInsertRowid;
  const stub = db.prepare("INSERT INTO users(name, norm_name, first_seen, last_seen) VALUES(?,?,?,?)")
    .run('Lina Canonical', 'lina canonical', '2026-09', '2026-09').lastInsertRowid;
  const unit = db.prepare("INSERT INTO units(external_id, unit_number, norm_unit, compound_id, first_seen, last_seen) VALUES(?,?,?,?,?,?)")
    .run('can-unit-1', 'LINA-1', 'LINA-1', badyaId, '2026-09', '2026-09').lastInsertRowid;
  db.prepare("INSERT INTO user_units(external_id, user_id, user_name_raw, unit_id, unit_ref_raw, compound_id, compound_raw, access_type, status, first_seen, last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run('can-uu-1', stub, 'Lina Canonical', unit, 'LINA-1', badyaId, 'Badya', 'Owner', 'Active', '2026-09', '2026-09');
  db.prepare("INSERT INTO vehicles(external_id, make, model, year, plate_original, plate_norm, user_name_raw, status) VALUES(?,?,?,?,?,?,?,?)")
    .run('can-veh-1', 'Toyota', 'Corolla', '2024', 'LINABADYA', 'linabadya', 'Lina Canonical', 'Approved By PHD');
  migrate();
  const state = db.prepare('SELECT canonical_user_id, is_canonical FROM users WHERE id=?').get(stub);
  assert.equal(state.canonical_user_id, real);
  assert.equal(state.is_canonical, 0);
  const relinked = db.prepare('SELECT user_id, compound_id FROM user_units WHERE external_id=?').get('can-uu-1');
  assert.equal(relinked.user_id, real);
  assert.equal(relinked.compound_id, badyaId);
  const vehicle = db.prepare('SELECT user_id FROM vehicles WHERE external_id=?').get('can-veh-1');
  assert.equal(vehicle.user_id, real);
});
