'use strict';
const { computeDashboard } = require('../backend/kpis');
// simulate answer() variable resolution for 'How many?'
const ql = 'how many?';
console.log('words:', ql.trim().split(/\s+/).length);
const d = computeDashboard('2026-09', '97 hills');
console.log('ids:', d.cards.map(c => c.id).join(','));
for (const id of ['active_units', 'coverage_pct', 'users_active', 'hcp_unique', 'hcp_events', 'hcp_auto_open', 'hcp_auto_unique', 'invitations', 'gatepass']) {
  const f = d.cards.find(c => c.id === id);
  console.log(id, '->', f ? f.value : 'MISSING');
}
