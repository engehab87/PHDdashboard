'use strict';
const B = 'http://localhost:2020';
(async () => {
  for (const p of ['/', '/app.js', '/app-pages.js', '/styles.css', '/index.html']) {
    const r = await fetch(B + p);
    const t = await r.text();
    console.log(p, r.status, t.length, 'bytes');
    if (p === '/app.js' && !t.includes('pageDashboard')) throw new Error('app.js incomplete');
    if (p === '/app-pages.js' && !t.includes('pageAI')) throw new Error('app-pages.js incomplete');
  }
  console.log('STATIC OK');
})().catch(e => { console.error('STATIC FAILED:', e.message); process.exit(1); });
