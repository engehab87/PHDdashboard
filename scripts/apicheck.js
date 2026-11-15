'use strict';
const B = 'http://localhost:2020';
async function get(p) { const r = await fetch(B + p); if (!r.ok) throw new Error(p + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200)); return r.json(); }
async function post(p, body) { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(p + ' -> ' + r.status); return r.json(); }
(async () => {
  const periods = await get('/api/periods');
  console.log('periods:', JSON.stringify(periods.map(p => p.period_key)));
  const d = await get('/api/dashboard?period=2026-09&compound=all');
  console.log('dashboard cards:', JSON.stringify(d.cards.map(c => [c.label, c.value])));
  console.log('warnings:', d.warnings.length);
  const db2 = await get('/api/dashboard?period=2026-09&compound=Badya');
  console.log('badya cards:', JSON.stringify(db2.cards.map(c => [c.label, c.value])));
  const cmp = await get('/api/compare?period=2026-09');
  console.log('compare rows:', cmp.rows.length, 'sample:', JSON.stringify(cmp.rows.slice(0, 2)));
  const q = await get('/api/quality?period=2026-09');
  console.log('quality score:', q.score, 'fileIssues:', q.fileIssues.length, 'records:', q.records.length, 'recon:', q.reconciliation.length);
  const m = await get('/api/matching?period=2026-09');
  console.log('matching: matched=', m.matched, 'possible=', m.possible.length, 'unmatched=', m.unmatched.length);
  const t = await get('/api/trends?metric=active_units&compound=all');
  console.log('trends:', JSON.stringify(t));
  const u = await get('/api/users?search=mohamed&limit=3');
  console.log('user search total:', u.total);
  const un = await get('/api/units?preset=without_users&limit=2');
  console.log('units w/o users total:', un.total);
  const ai1 = await post('/api/ai/ask', { question: 'Which compound has the highest registration coverage?', periodKey: '2026-09' });
  console.log('AI1:', ai1.answer.slice(0, 300));
  const ai2 = await post('/api/ai/ask', { question: 'How many?', periodKey: '2026-09', context: { compound: ai1.compound, metric: ai1.metric } });
  console.log('AI2(followup):', ai2.answer.slice(0, 200));
  const ai3 = await post('/api/ai/ask', { question: 'How many vehicles opened the barrier automatically?', periodKey: '2026-09' });
  console.log('AI3:', ai3.answer.slice(0, 250));
  const ai4 = await post('/api/ai/ask', { question: 'What about face recognition?', periodKey: '2026-09' });
  console.log('AI4:', ai4.answer.slice(0, 250));
  // export smoke test
  const ex = await fetch(B + '/api/export?entity=users&scope=view&period=2026-09');
  console.log('export users:', ex.status, ex.headers.get('content-type'));
  const rep = await fetch(B + '/api/report.xlsx?period=2026-09&compound=all');
  console.log('report:', rep.status, (await rep.arrayBuffer()).byteLength, 'bytes');
  console.log('ALL API CHECKS DONE');
})().catch(e => { console.error('API CHECK FAILED:', e.message); process.exit(1); });
