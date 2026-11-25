'use strict';
/* Data-grounded AI analyst. All numbers come from DB queries via the KPI layer.
   Optional LLM provider only verbalizes pre-computed results (never raw DB, never writes). */
const { db } = require('./db');
const { computeDashboard, compareCompounds, periodIdOf, compoundIdOf, attributedInvitations } = require('./kpis');
const { qualityReport } = require('./quality');
const N = require('./normalize');

const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct1 = n => (n == null ? '—' : Number(n).toFixed(2) + '%');

function allCompounds() { return db.prepare('SELECT id, name FROM compounds ORDER BY name').all(); }
function findCompounds(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  const out = [];
  for (const c of allCompounds()) {
    const n = c.name.toLowerCase();
    if (t.includes(n)) { out.push(c); continue; }
    // common shorthands
    if (/\bphnc\b/.test(t) && n.includes('new cairo')) out.push(c);
    if (/\bbadya\b/.test(t) && n === 'badya') out.push(c);
  }
  return [...new Map(out.map(c => [c.id, c])).values()];
}

function topN(text) {
  const m = String(text).match(/top\s+(\d+)/i);
  return m ? Math.min(100, parseInt(m[1], 10)) : 20;
}
function S_ctxMetric(ctx) {
  const m = (ctx && ctx.metric) || '';
  if (m === 'vehicles_access' || m === 'barrier') return 'hcpUnique';
  if (m === 'visitors') return 'gatepasses';
  if (m === 'users_by_type') return 'activeUsers';
  if (m === 'coverage' || m === 'active_units' || m === 'summary') return 'coverage';
  return null;
}

function base(periodKey) {
  const p = periodIdOf(periodKey);
  return p || periodIdOf(null);
}

function answer(question, opts = {}) {
  const q = String(question || '');
  const ql = q.toLowerCase();
  const ctx = opts.context || {};
  const period = base(opts.periodKey);
  if (!period) return { answer: 'No reporting data is available yet. Please upload a monthly ZIP first.', definition: null, explanation: null, table: null };
  const comps = findCompounds(ql);
  const compound = comps.length ? comps[0].name : (ctx.compound || 'all');
  const scopeIds = Array.isArray(opts.scopeIds) ? opts.scopeIds : null;
  const n = topN(ql);
  const P = period.period_key;
  const src = `Source: ${period.period_name} data.`;
  const R = (text, extra = {}) => ({ answer: text, table: null, definition: null, explanation: null, metric: null, compound, period: P, ...extra });

  // Scope enforcement: never answer about a compound outside the actor's assigned set.
  const requestedCid = compound !== 'all' ? compoundIdOf(compound) : null;
  if (scopeIds && !scopeIds.length) {
    return R('No communities are assigned to your account, so there is no data to report.', { metric: null });
  }
  if (scopeIds && requestedCid != null && !scopeIds.includes(requestedCid)) {
    return R(`I cannot report on ${compound}: it is outside your assigned communities.`, { metric: null });
  }

  const directScope = (col) => {
    if (!scopeIds) return { sql: '', params: [] };
    if (!scopeIds.length) return { sql: ' AND 1=0', params: [] };
    return { sql: ` AND ${col} IN (${scopeIds.map(() => '?').join(',')})`, params: [...scopeIds] };
  };
  const compoundScope = (col) => {
    if (requestedCid != null) return { sql: ` AND ${col}=?`, params: [requestedCid] };
    return directScope(col);
  };
  const metricValue = (pid, k) => {
    if (requestedCid != null) {
      const r = db.prepare('SELECT value_num v FROM period_metrics WHERE period_id=? AND metric_key=? AND compound_id=?').get(pid, k, requestedCid);
      return r ? r.v : null;
    }
    if (!scopeIds) {
      const r = db.prepare('SELECT value_num v FROM period_metrics WHERE period_id=? AND metric_key=? AND compound_id IS NULL').get(pid, k);
      return r ? r.v : null;
    }
    if (!scopeIds.length) return null;
    const ph = scopeIds.map(() => '?').join(',');
    const r = db.prepare(`SELECT SUM(value_num) v FROM period_metrics WHERE period_id=? AND metric_key=? AND compound_id IN (${ph})`).get(pid, k, ...scopeIds);
    return r && r.v != null ? r.v : null;
  };

  const has = (...words) => words.some(w => ql.includes(w));

  // ---- data quality ----
  if (has('data quality', 'quality problem', 'quality issue', 'problem', 'warning', 'missing data', 'incomplete')) {
    const rep = qualityReport(P);
    if (scopeIds) rep.records = rep.records.map(r => ({ ...r, sample: [] }));
    const lines = [`Data-quality summary for ${period.period_name} (score ${rep.score}/100):`];
    for (const f of rep.fileIssues) lines.push(`• [${f.severity.toUpperCase()}] ${f.message}`);
    for (const r of rep.records) lines.push(`• [${r.severity.toUpperCase()}] ${r.message} Count: ${fmt(r.count)}.`);
    if (!rep.fileIssues.length && !rep.records.length) lines.push('• No issues detected.');
    return R(lines.join('\n'), { definition: 'Counts of failed validations across files and records.', explanation: 'Computed by the data-quality engine over the current import (see Data Quality page).', metric: 'quality' });
  }

  // ---- face recognition (no dataset) ----
  if (has('face recognition', 'face auth', 'facial')) {
    if (has('unit') && has('which')) {
      return R(`I cannot answer this: no HCP person/visitor authentication file was included in the ${period.period_name} upload, so no face-recognition events exist in the database. Unit-level face analysis requires the HCP Person Authentication export.\n${src}`, { definition: 'Face recognition requires HCP person authentication records (absent).', explanation: 'The September 2026 upload contained HCP vehicle events only; no person-authentication file was provided, so the engine refuses to fabricate values.', metric: 'face' });
    }
    return R(`Face-recognition analytics are unavailable for ${period.period_name}: the upload did not include an HCP person/visitor authentication file. No values are estimated or fabricated.\n${src}`, { definition: 'Face recognition requires HCP person authentication records (absent).', explanation: 'Expected datasets HCP_PERSON_AUTH / HCP_VISITOR_AUTH are missing (see Data Quality page).', metric: 'face' });
  }

  // ---- visitors ----
  if (has('visitor')) {
    if (has('highest') || has('lowest') || has('most') || has('which compound')) {
      const vs = compoundScope('g.compound_id');
      const rows = db.prepare(`SELECT c.name k, COUNT(*) v FROM gate_passes g LEFT JOIN compounds c ON c.id=g.compound_id WHERE g.period_id=?${vs.sql} GROUP BY c.name ORDER BY v DESC`).all(period.id, ...vs.params);
      const top = rows[0] || { k: '—', v: 0 };
      return R(`The compound with the highest visitor activity (CRM gate passes as proxy — no HCP visitor file was provided) in ${period.period_name} is ${top.k} with ${fmt(top.v)} passes.\n${src}`,
        { table: { columns: ['Compound', 'Gate passes'], rows: rows.slice(0, 15).map(r => [r.k || 'Unknown', r.v]) }, definition: 'Gate passes by compound (Guest, Beach, Commercial Entity). HCP visitor authentication was not provided.', explanation: `COUNT GROUP BY compound over gate_passes for period ${P}.`, metric: 'visitors', compound: top.k });
    }
    const d = computeDashboard(P, compound, scopeIds);
    const gp = d.cards.find(c => c.id === 'gatepass').value;
    const byType = d.charts.gpByType;
    const scope = compound === 'all' ? 'all compounds' : compound;
    return R(`Visitor activity (via CRM gate passes as proxy — no HCP visitor file was provided) in ${scope}: ${fmt(gp)} passes.\nBreakdown: ${byType.map(b => `${b.label}: ${fmt(b.value)}`).join('; ')}.\n${src}`,
      { definition: 'Gate passes by access type (Guest, Beach, Commercial Entity). HCP visitor authentication was not provided, so passes are used as the documented proxy.', explanation: `Counts gate_passes rows for period ${P}${compound === 'all' ? '' : ' filtered to compound=' + compound}.`, table: { columns: ['Access type', 'Passes'], rows: byType.map(b => [b.label, b.value]) }, metric: 'visitors' });
  }

  // ---- compare compounds ----
  if (has('compare') || has(' vs ') || (has('highest') || has('lowest') || has('best') || has('highest number'))) {
    const cmp = compareCompounds(P, scopeIds);
    if (comps.length >= 2) {
      const rows = cmp.rows.filter(r => comps.some(c => c.name === r.compound));
      return R(`Comparison (${period.period_name}):\n` + rows.map(r => `• ${r.compound}: ${fmt(r.activeUnits)} active units, ${fmt(r.unitsWithUsers)} with users (${pct1(r.coverage)}), ${fmt(r.activeUsers)} active users, ${fmt(r.hcpUnique)} unique vehicles, ${fmt(r.hcpAuto)} auto openings.`).join('\n') + `\n${src}`,
        { table: { columns: ['Compound', 'Active units', 'Units w/ users', 'Coverage %', 'Active users', 'Unique vehicles', 'Auto openings'], rows: rows.map(r => [r.compound, r.activeUnits, r.unitsWithUsers, r.coverage, r.activeUsers, r.hcpUnique, r.hcpAuto]) }, definition: 'Side-by-side KPI comparison.', explanation: 'Each column computed per compound with the same KPI definitions as the dashboard.', metric: 'compare' });
    }
    // highest/lowest by metric (compounds with >=100 active units, to avoid trivial small bases)
    const metric = has('coverage') ? 'coverage' : has('visitor') ? 'gatepasses' : has('vehicle') ? 'hcpUnique' : has('user') ? 'activeUsers' : (S_ctxMetric(ctx) || 'coverage');
    const eligible = cmp.rows.filter(r => r.activeUnits >= 100);
    const pool = eligible.length ? eligible : cmp.rows;
    const sorted = [...pool].sort((a, b) => b[metric] - a[metric]);
    const top = sorted[0], low = sorted[sorted.length - 1];
    const dir = has('lowest') ? low : top;
    const label = { coverage: 'registration coverage', gatepasses: 'visitor (gate pass) activity', hcpUnique: 'unique vehicle activity', activeUsers: 'active users' }[metric];
    return R(`The compound with the ${has('lowest') ? 'lowest' : 'highest'} ${label} in ${period.period_name} is ${dir.compound} (${metric === 'coverage' ? pct1(dir.coverage) : fmt(dir[metric])}).\n${eligible.length ? 'Ranked among compounds with ≥100 active units.' : 'Note: no compound has ≥100 active units, so all compounds were ranked.'}\n${src}`,
      { table: { columns: ['Compound', 'Coverage %', 'Active users', 'Unique vehicles', 'Gate passes'], rows: sorted.slice(0, 10).map(r => [r.compound, r.coverage, r.activeUsers, r.hcpUnique, r.gatepasses]) }, definition: 'Ranking across compounds for the requested metric.', explanation: 'Ranked from the compound-comparison table (same KPI definitions).', metric: 'compare', compound: dir.compound });
  }

  // ---- registration coverage / units without users ----
  if (has('coverage') || has('no registered users') || has('without users') || has('registration')) {
    const d = computeDashboard(P, compound, scopeIds);
    const get = id => (d.cards.find(c => c.id === id) || {}).value || 0;
    const scope = compound === 'all' ? 'the portfolio' : compound;
    let extra = '';
    if (has('no registered') || has('without')) {
      const without = get('active_units') - get('units_with_users');
      extra = `\nUnits with no registered users: ${fmt(without)}.`;
    }
    return R(`Registration coverage in ${scope} (${period.period_name}): ${pct1(get('coverage_pct'))} — ${fmt(get('units_with_users'))} of ${fmt(get('active_units'))} active units have at least one active registered user.${extra}\n${src}`,
      { definition: 'units_with_users / active_units × 100. A unit counts when it has ≥1 Active user-unit relationship.', explanation: `Active units from ACTIVE_UNITS snapshot; units-with-users from UNIT_ACCESS (status=Active)${compound === 'all' ? '' : ', filtered to ' + compound}.`, metric: 'coverage' });
  }

  // ---- active units ----
  if (has('active unit')) {
    const d = computeDashboard(P, compound, scopeIds);
    const get = id => (d.cards.find(c => c.id === id) || {}).value || 0;
    const scope = compound === 'all' ? 'the portfolio' : compound;
    return R(`Active units in ${scope}: ${fmt(get('active_units'))} (${period.period_name}). Of these, ${fmt(get('units_with_users'))} have registered users.\n${src}`,
      { definition: 'Distinct units in the CRM Active Units export.', explanation: 'COUNT(DISTINCT units.id), snapshot scope.', metric: 'active_units' });
  }

  // ---- users ----
  if (has('tenant') || has('family member') || has('helper') || has('owner') || has('ref') || has('user') || has('resident') || has('people')) {
    const d = computeDashboard(P, compound, scopeIds);
    const scope = compound === 'all' ? 'the portfolio' : compound;
    if (has('tenant') && !has('owner')) {
      const ts = directScope('uu.compound_id');
      const rows = scopeIds
        ? db.prepare(`SELECT u.registered_as k, COUNT(DISTINCT u.id) v FROM users u WHERE u.status='Active' AND u.registered_as LIKE '%Tenant%' AND EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id=u.id${ts.sql}) GROUP BY k`).all(...ts.params)
        : db.prepare(`SELECT u.registered_as k, COUNT(*) v FROM users u WHERE u.status='Active' AND u.registered_as LIKE '%Tenant%' GROUP BY k`).all();
      const total = rows.reduce((s, r) => s + r.v, 0);
      return R(`Active users registered as Tenant / Tenant Family Member in ${scope}: ${fmt(total)}.\n${rows.map(r => `• ${r.k}: ${fmt(r.v)}`).join('\n')}\n${src}`,
        { table: { columns: ['Registered as', 'Active users'], rows: rows.map(r => [r.k, r.v]) }, definition: 'Active CRM users whose Registered As contains "Tenant".', explanation: 'Filtered users.status=Active GROUP BY registered_as.', metric: 'users_by_type' });
    }
    const byType = d.charts.usersByType;
    const act = d.cards.find(c => c.id === 'users_active').value;
    return R(`Active registered users in ${scope}: ${fmt(act)} (${period.period_name}).\nBreakdown: ${byType.map(b => `${b.label}: ${fmt(b.value)}`).join('; ')}.\n${src}`,
      { table: { columns: ['Registered type', 'Active users'], rows: byType.map(b => [b.label, b.value]) }, definition: 'Distinct active users with a valid unit relationship (per compound); portfolio total = users with status Active.', explanation: 'Users by Registered As (dynamic values from source).', metric: 'users_by_type' });
  }

  // ---- automatic barrier ----
  if (has('barrier') || has('automatic') || has('auto-open') || has('auto open') || has('lpr')) {
    const d = computeDashboard(P, compound, scopeIds);
    const get = id => (d.cards.find(c => c.id === id) || {}).value || 0;
    const scope = compound === 'all' ? 'the portfolio' : compound;
    return R(`Automatic barrier openings in ${scope} (${period.period_name}): ${fmt(get('hcp_auto_open'))} events by ${fmt(get('hcp_auto_unique'))} unique vehicles.\n${src}`,
      { definition: 'HCP events with result PASS (Vehicle in List: Auto-Open Barrier); unique = distinct normalized plates.', explanation: `HCP vehicle events, period ${P}${compound === 'all' ? '' : ', compound=' + compound}. Total events and distinct plates are reported separately (never mixed).`, metric: 'barrier' });
  }

  // ---- registered vehicles (CRM) ----
  if ((ql.includes('veh') || ql.includes('car') || ql.includes('plate')) && (ql.includes('register') || ql.includes('regist') || ql.includes('owned'))) {
    const cnt = db.prepare('SELECT COUNT(*) c FROM vehicles').get().c;
    const comps = findCompounds(ql);
    if (comps.length) {
      const comp = comps[0];
      const cid = compoundIdOf(comp.name);
      const v = db.prepare('SELECT COUNT(*) c FROM vehicles v JOIN user_units uu ON uu.user_id=v.user_id WHERE uu.compound_id=?').get(cid).c;
      return R('Registered vehicles in ' + comp.name + ': ' + fmt(v) + ' (of ' + fmt(cnt) + ' total registered vehicles portfolio-wide).', { definition: 'Vehicles in the CRM All Vehicles export linked to the compound via user_units.', explanation: 'COUNT(vehicles) joined to user_units for the compound.', metric: 'vehicles_registered', compound: comp.name });
    }
    return R('Registered vehicles (CRM): ' + fmt(cnt) + ' total across all compounds.', { definition: 'Vehicles in the CRM All Vehicles export.', explanation: 'COUNT(vehicles).', metric: 'vehicles_registered', compound: 'all' });
  }

  // ---- vehicles accessing ----
  if (has('car') || has('vehicle') || has('plate') || has('access') || has('enter') || has('exit') || has('gate ') || has('traffic')) {
    const d = computeDashboard(P, compound, scopeIds);
    const get = id => (d.cards.find(c => c.id === id) || {}).value || 0;
    const scope = compound === 'all' ? 'the portfolio' : compound;
    if (has('register') || has('registered') || has('owned')) {
      return R(`Registered vehicles (CRM): ${fmt(get('vehicles_registered'))}. This is separate from vehicles actually observed accessing compounds (${fmt(get('hcp_unique'))} unique plates in HCP data).\n${src}`,
        { definition: 'Vehicles in the CRM All Vehicles export — distinct from observed access.', explanation: 'COUNT(vehicles). Never mixed with HCP observations.', metric: 'vehicles_registered' });
    }
    const ee = d.charts.entryExit;
    return R(`Vehicle access in ${scope} (${period.period_name}): ${fmt(get('hcp_events'))} total events (entries/exits) by ${fmt(get('hcp_unique'))} unique vehicles.\n${ee.map(b => `• ${b.label}: ${fmt(b.value)}`).join('\n')}\nTo be explicit: "total events" counts every pass; "unique vehicles" counts distinct plates once.\n${src}`,
      { definition: 'Total events vs distinct normalized plates (reported separately).', explanation: `HCP vehicle events, period ${P}${compound === 'all' ? '' : ', compound=' + compound}.`, metric: 'vehicles_access' });
  }

  // ---- invitations ----
  if (has('qr') || has('invitation') || has('invite')) {
    const d = computeDashboard(P, compound, scopeIds);
    const byStatus = d.charts.invByStatus;
    const total = byStatus.reduce((s, r) => s + r.value, 0);
    const invRows = attributedInvitations(period.id, requestedCid, scopeIds);
    const typeCounts = new Map();
    for (const r of invRows) typeCounts.set(r.type || 'Unknown', (typeCounts.get(r.type || 'Unknown') || 0) + 1);
    const byType = Array.from(typeCounts.entries()).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
    return R(`Invitations (${period.period_name}): ${fmt(total)} total.\nBy status: ${byStatus.map(b => `${b.label}: ${fmt(b.value)}`).join('; ')}.\nBy type: ${byType.map(b => `${b.label || 'Unknown'}: ${fmt(b.v)}`).join('; ')}.\nNote: only statuses present in the source are reported (Generated/Used are not CRM statuses and are not invented).\n${src}`,
      { table: { columns: ['Status', 'Count'], rows: byStatus.map(b => [b.label, b.value]) }, definition: 'Invitation requests grouped by source status and type.', explanation: `COUNT GROUP BY status over invitations for period ${P}.`, metric: 'invitations' });
  }

  // ---- top units ----
  if (has('top') && has('unit')) {
    const us = compoundScope('g.compound_id');
    const rows = db.prepare(`SELECT u.unit_number unit, c.name comp, COUNT(*) n FROM gate_passes g LEFT JOIN units u ON u.id=g.unit_id LEFT JOIN compounds c ON c.id=g.compound_id WHERE g.period_id=?${us.sql} GROUP BY g.unit_id ORDER BY n DESC LIMIT ?`).all(period.id, ...us.params, n);
    return R(`Top ${rows.length} units by gate-pass volume (${period.period_name}):\n` + rows.map((r, i) => `${i + 1}. ${r.unit || '—'} (${r.comp || '—'}): ${fmt(r.n)}`).join('\n') + `\n${src}\nNote: HCP vehicle events carry no unit link, so unit attribution uses CRM gate passes.`,
      { table: { columns: ['Unit', 'Compound', 'Gate passes'], rows: rows.map(r => [r.unit || '—', r.comp || '—', r.n]) }, definition: 'Units ranked by gate-pass count.', explanation: 'GROUP BY unit over gate_passes for the period (HCP events have no unit attribution).', metric: 'top_units' });
  }

  // ---- handover ----
  if (has('handover') || has('handing') || has('finishing') || has('resident ') || has('delivery')) {
    const hs = directScope('hu.compound_id');
    const handoverFrom = scopeIds
      ? `FROM handover ho JOIN units hu ON hu.id=ho.unit_id WHERE ho.period_id=?${hs.sql}`
      : 'FROM handover ho WHERE ho.period_id=?';
    const hp = scopeIds ? [period.id, ...hs.params] : [period.id];
    const tot = db.prepare(`SELECT COUNT(*) c ${handoverFrom}`).get(...hp).c;
    const fin = db.prepare(`SELECT COUNT(*) c ${handoverFrom} AND ho.finishing='DONE'`).get(...hp).c;
    const res = db.prepare(`SELECT COUNT(*) c ${handoverFrom} AND ho.resident='DONE'`).get(...hp).c;
    const ho = db.prepare(`SELECT COUNT(*) c ${handoverFrom} AND ho.handover_date IS NOT NULL`).get(...hp).c;
    return R(`Handover / finishing / resident (${period.period_name}, Alexandria scope file): ${fmt(tot)} units tracked — handed over: ${fmt(ho)}, finishing DONE: ${fmt(fin)}, resident DONE: ${fmt(res)}.\n${src}`,
      { definition: 'Unit-area tracking file: handover dates, finishing DONE flags, resident DONE flags.', explanation: 'Counts over the handover dataset for the period.', metric: 'handover' });
  }

  // ---- trends ----
  if (has('trend') || has('growth') || has('change') || has('month') && has('over')) {
    const periods = db.prepare('SELECT * FROM reporting_periods ORDER BY period_key').all();
    if (periods.length < 2) return R(`No previous-period comparison available — only ${period.period_name} has been uploaded so far. Upload another month to enable trends.`, { metric: 'trends' });
    const keys = ['active_units', 'users_active', 'hcp_unique', 'hcp_auto_open', 'invitations_total', 'gatepass_total'];
    const lines = ['Month-over-month:'];
    for (const k of keys) {
      const vals = periods.map(p => ({ p: p.period_name, v: metricValue(p.id, k) }));
      const last = vals[vals.length - 1], prev = vals[vals.length - 2];
      const ch = prev.v ? (((last.v - prev.v) / prev.v) * 100).toFixed(2) + '%' : 'n/a';
      lines.push(`• ${k}: ${fmt(prev.v)} → ${fmt(last.v)} (${ch})`);
    }
    return R(lines.join('\n') + `\n${src}`, { definition: 'Snapshot metric comparison between the two latest periods.', explanation: 'Values read from period_metrics snapshots taken at import time.', metric: 'trends' });
  }

  // ---- summary ----
  if (has('summary') || has('overview') || has('highlight') || has('report') || ql.trim().split(/\s+/).length <= 3) {
    const d = computeDashboard(P, compound, scopeIds);
    const get = id => (d.cards.find(c => c.id === id) || {}).value || 0;
    const scope = compound === 'all' ? 'Portfolio' : compound;
    return R(`${scope} — ${period.period_name} summary:\n• Active units: ${fmt(get('active_units'))} (${pct1(get('coverage_pct'))} with users)\n• Active users: ${fmt(get('users_active'))}\n• Unique vehicles accessing: ${fmt(get('hcp_unique'))} (${fmt(get('hcp_events'))} events)\n• Automatic openings: ${fmt(get('hcp_auto_open'))} by ${fmt(get('hcp_auto_unique'))} vehicles\n• Invitations: ${fmt(get('invitations'))}\n• Gate passes: ${fmt(get('gatepass'))}\n${src}`,
      { definition: 'Headline KPIs with dashboard definitions.', explanation: 'Same calculations as the executive dashboard.', metric: 'summary' });
  }

  // ---- fallback ----
  return R(`I can answer questions about: active units, registration coverage, users (by type/status), registered vs accessing vehicles, automatic barrier openings, invitations, gate passes (visitor proxy), handover, compound comparison, top units, trends and data quality — for ${period.period_name}.\nTry: "Which compound has the highest registration coverage?" or "How many unique vehicles accessed Badya in September?"`, { metric: null });
}

async function ask(question, opts = {}) {
  opts = opts || {};
  let provider = 'local', apiKey = '', model = '', endpoint = '';
  try {
    const prow = db.prepare("SELECT value FROM settings WHERE key='ai_provider'").get();
    const krow = db.prepare("SELECT value FROM settings WHERE key='ai_api_key'").get();
    const mrow = db.prepare("SELECT value FROM settings WHERE key='ai_model'").get();
    const erow = db.prepare("SELECT value FROM settings WHERE key='ai_endpoint'").get();
    provider = (prow && prow.value) || 'local';
    apiKey = (krow && krow.value) || '';
    model = (mrow && mrow.value) || '';
    endpoint = (erow && erow.value) || '';
  } catch (_) {}

  const period = base(opts.periodKey);

  if (provider === 'local' || !apiKey) {
    return answer(question, opts);
  }

  const context = gatherContext(question, opts, period);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const url = endpoint ? (endpoint.replace(/\/$/, '') + '/responses') : 'https://api.openai.com/v1/responses';
    const resp = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey, 'HTTP-Referer': 'http://localhost:2020', 'X-OpenRouter-Title': 'Palm Hills Dashboard' },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        max_tokens: 400,
        instructions: 'You are a data analyst for Palm Hills Developments. Answer the user question using ONLY the provided database context. Never invent numbers, compounds, or facts. If the data does not contain the answer, say so clearly. Keep answers concise. Format numbers with thousand separators.',
        input: 'DATABASE CONTEXT:\n' + context + '\n\nQUESTION: ' + question,
      }),
    });
    clearTimeout(t);
    if (resp && resp.ok) {
      const j = await resp.json();
      let txt = null;
      if (Array.isArray(j.output)) {
        for (const item of j.output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            const part = item.content.find(p => p.type === 'output_text' || p.type === 'text');
            if (part) { txt = part.text || part.content; break; }
          }
          if (typeof item.text === 'string') { txt = item.text; break; }
        }
      }
      if (!txt && j.choices && j.choices[0] && j.choices[0].message) {
        txt = j.choices[0].message.content;
      }
      if (txt) {
        return { answer: txt, table: null, definition: null, explanation: null, metric: null, compound: (opts.context && opts.context.compound) || 'all', period: period ? period.period_key : null, verbalized: true };
      }
    } else {
      const errText = await resp.text().catch(() => '');
      console.warn('AI provider error:', resp && resp.status, String(errText).slice(0, 200));
    }
  } catch (e) {
    console.warn('AI provider call failed:', e && e.message);
  }

  return answer(question, opts);
}

function gatherContext(question, opts, period) {
  const lines = [];
  lines.push('DATABASE SCHEMA (PostgreSQL):');
  const tables = db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT LIKE 'sqlite_%' ORDER BY table_name").all().map(r => r.name);
  for (const t of tables) {
    const cols = db.prepare("SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position", [t]).all().map(col => col.name + (col.type ? ':' + col.type : ''));
    let cnt = 0;
    try { cnt = db.prepare('SELECT COUNT(*) c FROM ' + t).get().c; } catch (_) {}
    lines.push('- ' + t + ' (' + cnt + ' rows): ' + cols.join(', '));
  }
  lines.push('');
  lines.push('COMPOUNDS:');
  lines.push(allCompounds().map(c => c.name).join(', '));
  lines.push('');
  if (period) {
    lines.push('CURRENT PERIOD: ' + period.period_name + ' (' + period.period_key + ')');
    lines.push('PERIOD KPIs (portfolio):');
    try {
      const d = computeDashboard(period.period_key, 'all', null);
      for (const card of (d.cards || [])) lines.push('  - ' + card.label + ': ' + fmt(card.value) + (card.suffix || ''));
      if (d.charts) {
        for (const [k, v] of Object.entries(d.charts)) {
          if (Array.isArray(v)) lines.push('  - ' + k + ': ' + v.map(b => (b.label || b.k) + '=' + fmt(b.value)).join(', '));
        }
      }
    } catch (e) { lines.push('  (KPI computation failed: ' + (e && e.message) + ')'); }
    lines.push('');
  }
  const sampleTables = ['users', 'units', 'vehicles', 'compounds'];
  for (const t of sampleTables) {
    if (!tables.includes(t)) continue;
    try {
      const rows = db.prepare('SELECT * FROM ' + t + ' LIMIT 2').all();
      lines.push('SAMPLE ' + t + ' (first 2 rows):');
      lines.push(JSON.stringify(rows).slice(0, 600));
      lines.push('');
    } catch (_) {}
  }
  try {
    const hcpCounts = db.prepare('SELECT compound_id, COUNT(*) c FROM hcp_live_events GROUP BY compound_id').all();
    if (hcpCounts.length) {
      lines.push('HCP LIVE EVENTS (count by compound_id):');
      for (const r of hcpCounts) lines.push('  compound ' + r.compound_id + ': ' + r.c + ' events');
      lines.push('');
    }
    const hcpVehicles = db.prepare('SELECT compound_id, COUNT(*) c FROM hcp_live_vehicles GROUP BY compound_id').all();
    if (hcpVehicles.length) {
      lines.push('HCP LIVE VEHICLES (count by compound_id):');
      for (const r of hcpVehicles) lines.push('  compound ' + r.compound_id + ': ' + r.c + ' vehicles');
      lines.push('');
    }
    const hcpPersons = db.prepare('SELECT compound_id, COUNT(*) c FROM hcp_live_persons GROUP BY compound_id').all();
    if (hcpPersons.length) {
      lines.push('HCP LIVE PERSONS (count by compound_id):');
      for (const r of hcpPersons) lines.push('  compound ' + r.compound_id + ': ' + r.c + ' persons');
      lines.push('');
    }
  } catch (_) {}
  if (opts.scopeIds && opts.scopeIds.length) {
    lines.push('ACTOR SCOPE: compound ids ' + opts.scopeIds.join(', ') + '. Only answer about these compounds.');
    lines.push('');
  }
  if (opts.context && opts.context.compound && opts.context.compound !== 'all') {
    lines.push('SELECTED COMPOUND: ' + opts.context.compound);
  }
  return lines.join('\n');
}

module.exports = { ask, answer };
