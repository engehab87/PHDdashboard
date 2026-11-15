'use strict';
const B = 'http://localhost:2020';
const XLSX = require('xlsx');
(async () => {
  const checks = [
    '/api/users?status=Active&limit=2',
    '/api/units?compound=Badya&preset=with_users&limit=2',
    '/api/vehicles?status=Approved%20By%20PHD&limit=2',
    '/api/gatepasses?period=2026-09&type=Beach%20Access&limit=2',
    '/api/invitations?period=2026-09&status=Completed&limit=2',
    '/api/access?period=2026-09&result=PASS&limit=2',
  ];
  for (const p of checks) {
    const r = await fetch(B + p);
    const j = await r.json();
    console.log(p.slice(0, 60), '->', r.status, 'total=', j.total, 'rows=', (j.rows || []).length);
    if (!r.ok || !j.rows) throw new Error('list failed: ' + p);
  }
  // filtered export: Badya units, must all be Badya
  const ex = await fetch(B + '/api/export?entity=units&scope=all&period=2026-09&compound=Badya');
  const buf = Buffer.from(await ex.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  console.log('export units Badya rows:', rows.length, 'allBadya:', rows.every(r => r.compound === 'Badya'));
  if (!rows.length || !rows.every(r => r.compound === 'Badya')) throw new Error('filtered export wrong');
  // filtered export: PASS-only access
  const ex2 = await fetch(B + '/api/export?entity=access&scope=all&period=2026-09&result=PASS');
  const wb2 = XLSX.read(Buffer.from(await ex2.arrayBuffer()), { type: 'buffer' });
  const rows2 = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]]);
  console.log('export access PASS rows:', rows2.length, 'allPass:', rows2.every(r => r.result === 'PASS'));
  if (!rows2.length || !rows2.every(r => r.result === 'PASS')) throw new Error('filtered export wrong');
  console.log('FILTER CHECKS PASSED');
})().catch(e => { console.error('FILTER CHECK FAILED:', e.message); process.exit(1); });
