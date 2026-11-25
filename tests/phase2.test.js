'use strict';
/* Phase 2 acceptance tests: monthly ZIP import, fingerprints, UPSERT+history,
   event dedup, cumulative exports, reprocess idempotency, rollback.
   Runs against TEST_DATABASE_URL (disposable PostgreSQL DB, never production). */
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-phase2-'));

const AdmZip = require('adm-zip');
const XLSX = require('xlsx');
const { migrate, db } = require('../backend/db');
const { stageUpload, processImport, rollbackImport, hcpEventHash, sha256Str } = require('../backend/ingest');

const COLS = {
  users: ['(Do Not Modify) User', 'Name', 'Mobile Number', 'Email', 'User Status', 'Registered As', 'Created On'],
  units: ['(Do Not Modify) Unit', 'Name', 'Compound', 'Related Unit'],
  access: ['(Do Not Modify) Unit User', 'Compound (Unit) (Unit)', 'Unit', 'User', 'Access Type', 'Status'],
  vehicles: ['(Do Not Modify) Vehicle', 'Make', 'Model', 'Palette Code', 'Related User', 'Status Reason'],
  inv: ['(Do Not Modify) Invitation Request', 'Invitation Provider', 'Invited Member Name', 'Type', 'Status Reason', 'Code'],
  gp: ['(Do Not Modify) Gate Pass', 'Compound Ref', 'Unit Ref.', 'User Ref.', 'Access Type', 'Entry Date', 'Valid Until'],
  hcp: ['License Plate No.', 'Parking Lot', 'Enter or Exit', 'Entering Time', 'Departure Time', 'Entrance/Exit', 'Entry and Exit Method', 'Entry and Exit Result', 'Vehicle Owner'],
  ho: ['Unit Code', 'Category', 'Zone', 'Handing over', 'Finishing permit', 'resident'],
};

function wbFile(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const p = path.join(TMP, `f${Math.random().toString(36).slice(2)}.xlsx`);
  XLSX.writeFile(wb, p);
  return p;
}
function makeZip(name, files) {
  // files: [[zipEntryName, xlsxPath]]
  const z = new AdmZip();
  for (const [entry, fp] of files) z.addFile(entry, fs.readFileSync(fp));
  const zp = path.join(TMP, name);
  z.writeZip(zp);
  return zp;
}
const U = (id, name, status) => [id, name, '01220000001', `${name.replace(/ /g, '.')}@x.com`, status, 'Owner', 46297];
const HCP = (plate, dt, dir, owner) => [plate, 'Main Gate', dir, dir === 'Entering' ? dt : '', dir === 'Exit' ? dt : '', 'G1', dir === 'Entering' ? 'Auto Entry & Exit' : 'Barrier Not Open', dir === 'Entering' ? 'Pass' : 'Not Passed', owner || ''];

let sepImport, octImport, sepCounts;
before(() => { migrate(); });

test('deterministic event fingerprints (no row numbers, no UUIDs)', () => {
  const a = hcpEventHash({ normPlate: 'x123', enterTime: '2026-09-01 10:00', exitTime: '', gate: 'G1', direction: 'ENTRY', method: 'Auto Entry & Exit', result: 'PASS', ownerNorm: 'ahmed' });
  const b = hcpEventHash({ normPlate: 'x123', enterTime: '2026-09-01 10:00', exitTime: '', gate: 'G1', direction: 'ENTRY', method: 'Auto Entry & Exit', result: 'PASS', ownerNorm: 'ahmed' });
  const c = hcpEventHash({ normPlate: 'x124', enterTime: '2026-09-01 10:00', exitTime: '', gate: 'G1', direction: 'ENTRY', method: 'Auto Entry & Exit', result: 'PASS', ownerNorm: 'ahmed' });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
  assert.ok(sha256Str('x'));
});

test('september import: masters created, events inserted, snapshot written', () => {
  const files = [
    ['users.xlsx', wbFile([COLS.users, U('u-1', 'Ahmed Ali', 'Pending'), U('u-2', 'Sara Naguib', 'Active'), U('u-3', 'Omar Adel', 'Active')])],
    ['units.xlsx', wbFile([COLS.units, ['t-1', 'BAD-1001', 'Badya', 'BAD-1001'], ['t-2', 'BAD-1002', 'Badya', 'BAD-1002']])],
    ['access.xlsx', wbFile([COLS.access, ['a-1', 'Badya', 'BAD-1001', 'Ahmed Ali', 'Owner', 'Active'], ['a-2', 'Badya', 'BAD-1002', 'Sara Naguib', 'Owner', 'Active']])],
    ['vehicles.xlsx', wbFile([COLS.vehicles, ['v-1', 'Toyota', 'Corolla', 'ABC123', 'Ahmed Ali', 'Approved By PHD']])],
    ['inv.xlsx', wbFile([COLS.inv, ['i-1', 'Ahmed Ali', 'Guest One', 'New User', 'Completed', 'C1'], ['i-2', 'Sara Naguib', 'Guest Two', 'New User', 'Confirmed', 'C2']])],
    ['gp.xlsx', wbFile([COLS.gp, ['p-1', 'Badya', 'BAD-1001', 'Ahmed Ali', 'Guest Access', '2026/09/05 10:00:00', '2026/09/05 20:00:00']])],
    ['hcp.xlsx', wbFile([COLS.hcp, HCP('ABC123', '2026/09/05 10:01:00', 'Entering', 'Ahmed Ali'), HCP('XYZ999', '2026/09/05 11:00:00', 'Exit', ''), HCP('ABC123', '2026/09/05 12:00:00', 'Exit', ''), HCP('LMN456', '2026/09/06 09:00:00', 'Entering', '')])],
    ['ho.xlsx', wbFile([COLS.ho, ['ALX-1', 'Cat A', 'Z1', '', 'DONE', '']])],
  ];
  const zp = makeZip('Sep2026.zip', files);
  const st = stageUpload({ filePath: zp, originalName: 'Sep2026.zip' });
  sepImport = st.importId;
  assert.ok(st.detected.periodKey === '2026-09', 'HCP dates detect September, got ' + st.detected.periodKey);
  const s = processImport(sepImport, '2026-09');
  assert.equal(s.masters.newUsers, 3);
  assert.equal(s.masters.newUnits, 2);
  assert.equal(s.masters.newRelations, 2);
  assert.equal(s.masters.newVehicles, 1);
  assert.equal(s.events.newVehicleEvents, 4);
  assert.equal(s.events.newInvitations, 2);
  assert.equal(s.events.newGatePasses, 1);
  assert.equal(s.events.newHandovers, 1);
  const imp = db.prepare('SELECT status FROM imports WHERE id=?').get(sepImport);
  assert.equal(imp.status, 'COMPLETED');
  assert.ok(db.prepare('SELECT COUNT(*) c FROM period_snapshots WHERE period_key=?').get('2026-09').c >= 1);
  assert.ok(db.prepare('SELECT COUNT(*) c FROM import_log WHERE import_id=?').get(sepImport).c > 5);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM user_history WHERE change_type='CREATED'").get().c, 3);
  sepCounts = { users: db.prepare('SELECT COUNT(*) c FROM users').get().c, hcp: db.prepare('SELECT COUNT(*) c FROM hcp_vehicle_events').get().c };
});

test('same september ZIP again: zero new records, dashboard unchanged', () => {
  const zp = path.join(TMP, 'Sep2026.zip'); // identical bytes
  const st = stageUpload({ filePath: zp, originalName: 'Sep2026.zip' });
  const dupId = st.importId;
  const dupFiles = db.prepare("SELECT COUNT(*) c FROM source_files WHERE import_id=? AND processing_status='EXACT_DUPLICATE_FILE'").get(dupId).c;
  assert.ok(dupFiles >= 8, `all files flagged EXACT_DUPLICATE_FILE, got ${dupFiles}`);
  const s = processImport(dupId, '2026-09');
  const evNew = s.events.newVehicleEvents + s.events.newInvitations + s.events.newGatePasses + s.events.newHandovers;
  assert.equal(evNew, 0);
  assert.equal(s.masters.newUsers + s.masters.newUnits + s.masters.newVehicles + s.masters.newRelations, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, sepCounts.users);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM hcp_vehicle_events').get().c, sepCounts.hcp);
});

test('october cumulative ZIP: new added, changed masters updated, september intact', () => {
  const files = [
    ['users.xlsx', wbFile([COLS.users, U('u-1', 'Ahmed Ali', 'Active'), U('u-2', 'Sara Naguib', 'Active'), U('u-3', 'Omar Adel', 'Active'), U('u-4', 'New Guy', 'Active')])],
    ['hcp.xlsx', wbFile([COLS.hcp,
      HCP('ABC123', '2026/09/05 10:01:00', 'Entering', 'Ahmed Ali'), // overlap from Sep
      HCP('XYZ999', '2026/09/05 11:00:00', 'Exit', ''),              // overlap from Sep
      HCP('NEW111', '2026/10/03 10:00:00', 'Entering', ''),           // new
      HCP('NEW222', '2026/10/03 11:00:00', 'Exit', '')])],           // new
  ];
  const zp = makeZip('Oct2026.zip', files);
  const st = stageUpload({ filePath: zp, originalName: 'Oct2026.zip' });
  octImport = st.importId;
  const s = processImport(octImport, '2026-10');
  assert.equal(s.masters.newUsers, 1);
  assert.equal(s.masters.updatedUsers, 1, 'Ahmed Ali Pending->Active is an update, not a duplicate');
  assert.equal(s.masters.unchangedUsers, 2);
  assert.equal(s.events.newVehicleEvents, 2);
  assert.equal(s.events.dupVehicleEvents, 2, 'overlapping September events skipped');
  const chg = db.prepare("SELECT * FROM changed_records WHERE import_id=? AND entity_type='user' AND field_name='status'").get(octImport);
  assert.ok(chg, 'status change recorded');
  assert.equal(chg.old_value, 'Pending');
  assert.equal(chg.new_value, 'Active');
  assert.ok(db.prepare("SELECT COUNT(*) c FROM user_history WHERE import_id=? AND change_type='UPDATED'").get(octImport).c >= 1);
  // September snapshot/history intact
  assert.ok(db.prepare('SELECT COUNT(*) c FROM period_snapshots WHERE period_key=?').get('2026-09').c >= 1);
  assert.ok(db.prepare('SELECT COUNT(*) c FROM period_snapshots WHERE period_key=?').get('2026-10').c >= 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM hcp_vehicle_events WHERE period_id=(SELECT id FROM reporting_periods WHERE period_key='2026-09')").get().c, 4);
});

test('reprocess october: idempotent, counts identical', () => {
  const before = { hcp: db.prepare('SELECT COUNT(*) c FROM hcp_vehicle_events').get().c, users: db.prepare('SELECT COUNT(*) c FROM users').get().c };
  const { processImport: pi } = require('../backend/ingest');
  const s = pi(octImport, '2026-10');
  const evNew = s.events.newVehicleEvents + s.events.newInvitations + s.events.newGatePasses + s.events.newHandovers;
  assert.equal(evNew, 0);
  assert.equal(s.masters.newUsers, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM hcp_vehicle_events').get().c, before.hcp);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before.users);
});

test('rollback october: events removed, master restored, september preserved', () => {
  const r = rollbackImport(octImport, 'test');
  assert.ok(r.removedEvents >= 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM hcp_vehicle_events').get().c, sepCounts.hcp);
  assert.equal(db.prepare('SELECT status FROM users WHERE external_id=?').get('u-1').status, 'Pending');
  assert.ok(!db.prepare('SELECT * FROM users WHERE external_id=?').get('u-4'), 'user created by rolled-back import removed');
  assert.equal(db.prepare('SELECT status FROM imports WHERE id=?').get(octImport).status, 'ROLLED_BACK');
  assert.equal(db.prepare('SELECT status FROM users WHERE external_id=?').get('u-2').status, 'Active', 'untouched users preserved');
});

test('delete month: data removed cleanly, re-upload restores fully', () => {
  const { deletePeriodData } = require('../backend/ingest');
  // build a fresh month (November) so Sep fixtures stay intact for other assertions
  const files = [
    ['users.xlsx', wbFile([COLS.users, U('u-9', 'Nov User', 'Active')])],
    ['hcp.xlsx', wbFile([COLS.hcp, HCP('NOV111', '2026/11/04 10:00:00', 'Entering', ''), HCP('NOV222', '2026/11/04 11:00:00', 'Exit', '')])],
  ];
  const zp = makeZip('Nov2026.zip', files);
  const st = stageUpload({ filePath: zp, originalName: 'Nov2026.zip' });
  const novImport = st.importId;
  const s1 = processImport(novImport, '2026-11');
  assert.equal(s1.events.newVehicleEvents, 2);
  assert.equal(s1.masters.newUsers, 1);
  const hcpAfter = db.prepare('SELECT COUNT(*) c FROM hcp_vehicle_events').get().c;
  const r = deletePeriodData('2026-11', 'test');
  assert.ok(r.ok);
  assert.equal(r.deleted.hcp_vehicle_events, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM hcp_vehicle_events').get().c, hcpAfter - 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM event_fingerprints WHERE first_seen_import_id=?").get(novImport).c, 0);
  assert.equal(db.prepare('SELECT status FROM imports WHERE id=?').get(novImport).status, 'DELETED');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM period_snapshots WHERE period_key=?').get('2026-11').c, 0);
  assert.ok(db.prepare('SELECT * FROM users WHERE external_id=?').get('u-9'), 'cumulative masters preserved');
  // re-upload identical files: NOT flagged duplicate, everything re-inserted
  const st2 = stageUpload({ filePath: zp, originalName: 'Nov2026.zip' });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM source_files WHERE import_id=? AND processing_status='EXACT_DUPLICATE_FILE'").get(st2.importId).c, 0);
  const s2 = processImport(st2.importId, '2026-11');
  assert.equal(s2.events.newVehicleEvents, 2);
  assert.equal(s2.masters.updatedUsers + s2.masters.unchangedUsers, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM hcp_vehicle_events').get().c, hcpAfter);
});

test('delete rejects bad input and unknown periods', () => {
  const { deletePeriodData } = require('../backend/ingest');
  assert.throws(() => deletePeriodData('nope', 'test'), /Invalid/);
  assert.throws(() => deletePeriodData('1999-01', 'test'), /not found/i);
});

test('malicious ZIP filenames are blocked', () => {
  const { assertSafeEntry, extractZip } = require('../backend/ingest');
  assert.throws(() => assertSafeEntry('../evil.xlsx'), /Blocked/i);
  assert.throws(() => assertSafeEntry('..\\evil.xlsx'), /Blocked/i);
  assert.throws(() => assertSafeEntry('/abs/path.xlsx'), /Blocked/i);
  assert.throws(() => assertSafeEntry('C:\\files\\x.xlsx'), /Blocked/i);
  // end-to-end: a zip whose entry escapes the destination is rejected, original untouched
  const z = new AdmZip();
  z.addFile('..\\evil.xlsx', Buffer.from('x'));
  const names = z.getEntries().map(e => e.entryName);
  if (names.some(n => n.includes('..'))) {
    const zp = path.join(TMP, 'evil.zip');
    z.writeZip(zp);
    assert.throws(() => stageUpload({ filePath: zp, originalName: 'evil.zip' }), /unsafe|traversal|Blocked/i);
  }
});

test('genuine vehicle owners: unique links, ambiguous left unlinked, unknown stubbed', () => {
  const { repairVehicleOwnerLinks } = require('../backend/ingest');
  const files = [
    ['users.xlsx', wbFile([COLS.users,
      ['u-a1', 'Same Name', '01110000001', 'a1@x.com', 'Active', 'Owner', 46297],
      ['u-a2', 'Same Name', '01120000002', 'a2@x.com', 'Active', 'Owner', 46297],
      U('u-b1', 'Only One', 'Active')])],
    ['vehicles.xlsx', wbFile([COLS.vehicles,
      ['v-a', 'Toyota', 'Corolla', 'PLT-A', 'Same Name', 'Approved By PHD'],
      ['v-b', 'Honda', 'Civic', 'PLT-B', 'Only One', 'Approved By PHD'],
      ['v-c', 'Kia', 'Rio', 'PLT-C', 'Nobody Here', 'Approved By PHD']])],
  ];
  const zp = makeZip('Owners2026.zip', files);
  const st = stageUpload({ filePath: zp, originalName: 'Owners2026.zip' });
  const s = processImport(st.importId, '2026-12');
  assert.equal(s.events.newVehicleEvents || 0, 0);
  const va = db.prepare('SELECT * FROM vehicles WHERE external_id=?').get('v-a');
  const vb = db.prepare('SELECT * FROM vehicles WHERE external_id=?').get('v-b');
  const vc = db.prepare('SELECT * FROM vehicles WHERE external_id=?').get('v-c');
  assert.equal(va.user_id, null, 'ambiguous name (2 real users) must NOT link');
  assert.ok(vb.user_id, 'unique name links');
  assert.equal(db.prepare('SELECT external_id FROM users WHERE id=?').get(vb.user_id).external_id, 'u-b1', 'links to the right user');
  assert.ok(vc.user_id, 'unknown name gets honest stub');
  assert.equal(db.prepare('SELECT external_id FROM users WHERE id=?').get(vc.user_id).external_id, null, 'stub has no CRM identity');
  assert.ok(db.prepare("SELECT * FROM identity_maps WHERE source_kind='vehicle_owner' AND status='POSSIBLE_MATCH'").get(), 'ambiguous name flagged for review');
  assert.ok((s.ambiguousOwners || 0) >= 1, 'import stats report ambiguous owners');
  // repair is a safe no-op here and keeps genuine links
  const r = repairVehicleOwnerLinks('test');
  assert.equal(db.prepare('SELECT user_id FROM vehicles WHERE external_id=?').get('v-b').user_id, vb.user_id);
  assert.equal(db.prepare('SELECT user_id FROM vehicles WHERE external_id=?').get('v-a').user_id, null);
  assert.ok(r.checked >= 3);
});

test('ZZ reset wipes everything but settings, then re-import works', () => {
  const { resetDatabase } = require('../backend/ingest');
  const before = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  assert.ok(before > 0, 'needs data to wipe');
  // FK trap: a MATCHED identity row referencing a user must not break the wipe
  // (regression: identity_maps was deleted after users -> FOREIGN KEY failure).
  const tu = db.prepare("INSERT INTO users(external_id,name,norm_name,status,first_seen,last_seen) VALUES('t-fk','FK User','fk user','Active','2026-01','2026-01')").run();
  db.prepare("INSERT INTO identity_maps(source_kind,source_key,crm_user_id,match_method,confidence,status,created_at) VALUES('hcp_owner','fk user',?,'TEST',1.0,'MATCHED',datetime('now'))").run(Number(tu.lastInsertRowid));
  const r = resetDatabase('test');
  assert.ok(r.ok);
  for (const t of ['users', 'units', 'user_units', 'vehicles', 'invitations', 'gate_passes', 'hcp_vehicle_events', 'handover', 'imports', 'reporting_periods', 'event_fingerprints', 'period_snapshots', 'audit_log']) {
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c, t === 'audit_log' ? 1 : 0, t + ' cleared');
  }
  assert.ok(db.prepare("SELECT COUNT(*) c FROM settings").get().c > 0, 'settings kept');
  assert.ok(db.prepare("SELECT value FROM settings WHERE key='parking_lot_compound'").get(), 'mappings kept');
  // fresh start works: import again into the wiped DB
  const zp = makeZip('Fresh2026.zip', [['users.xlsx', wbFile([COLS.users, U('u-1', 'Fresh User', 'Active')])]]);
  const st = stageUpload({ filePath: zp, originalName: 'Fresh2026.zip' });
  const s = processImport(st.importId, '2026-01');
  assert.equal(s.masters.newUsers, 1);
});
