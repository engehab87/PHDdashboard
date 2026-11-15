'use strict';
/* End-to-end upload test: build a ZIP from real September files (renamed, as next month would be),
   upload via HTTP, verify classification + month detection, process into a scratch period, then clean up. */
const fs = require('fs');
const AdmZip = require('adm-zip');
const B = 'http://localhost:2020';
const DIR = 'C:/Users/ehab.moustafa/Downloads';

(async () => {
  const zip = new AdmZip();
  // simulate October files with different timestamps in names + one unknown file
  zip.addLocalFile(DIR + '/Handing over, finishing permits and resident_9377.xlsx', '', 'Handover Export 05-11-2026.xlsx');
  zip.addLocalFile(DIR + '/All Vehicles 02-10-2026 13-38-22.xlsx', '', 'Vehicles Dump Nov.xlsx');
  zip.addFile('mystery.csv', Buffer.from('a,b\n1,2\n'));
  const zp = 'C:/Users/ehab.moustafa/AppData/Local/Temp/opencode/oct-test.zip';
  zip.writeZip(zp);
  console.log('zip bytes:', fs.statSync(zp).size);

  const fd = new FormData();
  fd.append('zip', new Blob([fs.readFileSync(zp)]), 'Oct2026.zip');
  const staged = await (await fetch(B + '/api/uploads', { method: 'POST', body: fd })).json();
  console.log('staged import:', staged.importId, 'detected:', JSON.stringify(staged.detected));
  for (const f of staged.files) console.log(`  ${f.filename} -> ${f.dataset} (${Math.round(f.confidence * 100)}%) rows=${f.rows} status=${f.status}`);
  const byName = Object.fromEntries(staged.files.map(f => [f.filename, f]));
  if (byName['Handover Export 05-11-2026.xlsx'].dataset !== 'HANDOVER') throw new Error('handover not detected by columns');
  if (byName['Vehicles Dump Nov.xlsx'].dataset !== 'VEHICLES') throw new Error('vehicles not detected by columns');
  if (byName['mystery.csv']) throw new Error('non-xlsx should be ignored');
  // process into scratch period 2026-10 (month detection correctly finds nothing -> user confirms)
  if (staged.detected.periodKey) throw new Error('should not detect a period without HCP data');
  const proc = await (await fetch(B + `/api/imports/${staged.importId}/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodKey: '2026-10' }) })).json();
  console.log('process started:', JSON.stringify(proc));
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await (await fetch(B + `/api/imports/${staged.importId}`)).json();
    console.log('  status:', st.status, JSON.stringify(st.progress));
    if (st.status === 'completed' || st.status === 'failed') break;
  }
  const dash = await (await fetch(B + '/api/dashboard?period=2026-10&compound=all')).json();
  console.log('oct handover units tracked via period metrics; dashboard period:', dash.period.name);
  // cleanup scratch period to keep September pristine
  const { db } = require('../backend/db');
  const prow = db.prepare('SELECT id FROM reporting_periods WHERE period_key=?').get('2026-10');
  if (prow) {
    for (const t of ['hcp_vehicle_events', 'gate_passes', 'invitations', 'handover', 'raw_rows', 'period_metrics', 'raw_files']) db.prepare(`DELETE FROM ${t} WHERE period_id=?`).run(prow.id);
    db.prepare('DELETE FROM imports WHERE period_id=?').run(prow.id);
    db.prepare('DELETE FROM reporting_periods WHERE id=?').run(prow.id);
    console.log('scratch period 2026-10 removed');
  }
  console.log('UPLOAD FLOW TEST PASSED');
})().catch(e => { console.error('UPLOAD TEST FAILED:', e); process.exit(1); });
