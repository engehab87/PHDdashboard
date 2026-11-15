'use strict';
/* Central KPI calculation layer. UI must never compute KPIs itself.
   Every KPI: unique id, definition, formula, sources, filters, drill-down.

   Scope: compoundName is a single validated compound, while scopeIds is the
   actor's allowed compound id list (null = portfolio-wide). The server must
   validate compoundName against scope before calling these functions. */
const { db } = require('./db');

const DEFINITIONS = [
  { id: 'active_units', name: 'Active Units', definition: 'Distinct units present in the CRM Active Units export for the reporting snapshot.', formula: 'COUNT(DISTINCT units.id)', sources: ['ACTIVE_UNITS'], filters: ['compound'], drill: { entity: 'units' } },
  { id: 'units_with_users', name: 'Units With Registered Users', definition: 'Distinct units having at least one Active user-unit relationship.', formula: 'COUNT(DISTINCT user_units.unit_id WHERE status=Active)', sources: ['UNIT_ACCESS'], filters: ['compound'], drill: { entity: 'units', preset: 'with_users' } },
  { id: 'coverage_pct', name: 'Registration Coverage %', definition: 'Share of active units that have at least one active registered user.', formula: 'units_with_users / active_units * 100', sources: ['ACTIVE_UNITS', 'UNIT_ACCESS'], filters: ['compound'], drill: { entity: 'units' } },
  { id: 'users_active', name: 'Active Registered Users', definition: 'Distinct users with status Active and at least one Active unit relationship (per compound). Portfolio total = users with status Active.', formula: 'COUNT(DISTINCT user_id)', sources: ['ALL_USERS', 'UNIT_ACCESS'], filters: ['compound'], drill: { entity: 'users', preset: 'active' } },
  { id: 'users_by_type', name: 'Users by Registered Type', definition: 'Active users grouped by CRM Registered As value (dynamic, not hardcoded).', formula: 'GROUP BY registered_as', sources: ['ALL_USERS'], filters: ['compound'], drill: { entity: 'users' } },
  { id: 'vehicles_registered', name: 'Registered Vehicles', definition: 'Vehicles present in the CRM All Vehicles export. Distinct from vehicles observed accessing compounds.', formula: 'COUNT(vehicles.id)', sources: ['VEHICLES'], filters: [], drill: { entity: 'vehicles' } },
  { id: 'hcp_events', name: 'Vehicle Access Events', definition: 'HCP vehicle entry/exit records in period. Total events — NOT unique vehicles.', formula: 'COUNT(hcp_vehicle_events.id)', sources: ['HCP_VEHICLE_ACCESS'], filters: ['compound', 'direction', 'result', 'date'], drill: { entity: 'access' } },
  { id: 'hcp_unique', name: 'Unique Vehicles Accessing', definition: 'Distinct normalized plates observed in HCP events.', formula: 'COUNT(DISTINCT plate_normalized)', sources: ['HCP_VEHICLE_ACCESS'], filters: ['compound', 'direction', 'date'], drill: { entity: 'access', preset: 'unique' } },
  { id: 'hcp_auto_open', name: 'Automatic Barrier Openings', definition: 'HCP events with successful pass result (Vehicle in List: Auto-Open Barrier).', formula: 'COUNT WHERE result=PASS', sources: ['HCP_VEHICLE_ACCESS'], filters: ['compound', 'date'], drill: { entity: 'access', preset: 'auto' } },
  { id: 'hcp_auto_unique', name: 'Unique Vehicles, Automatic Opening (detail)', definition: 'Distinct normalized plates with at least one automatic barrier opening. See hcp_auto_open.', formula: 'COUNT(DISTINCT plate_normalized WHERE result=PASS)', sources: ['HCP_VEHICLE_ACCESS'], filters: ['compound', 'date'], drill: { entity: 'access', preset: 'auto' } },
  { id: 'invitations', name: 'Invitations', definition: 'Invitation requests by status and type (statuses discovered from source, never invented).', formula: 'GROUP BY status, type', sources: ['INVITATION_REQUESTS'], filters: ['compound'], drill: { entity: 'invitations' } },
  { id: 'gatepass', name: 'Guest / Gate Passes', definition: 'Active gate passes by access type (Guest, Beach, Commercial Entity). Proxy for visitor activity; HCP visitor authentication file was not provided.', formula: 'GROUP BY access_type', sources: ['ACTIVE_GATE_PASSES'], filters: ['compound'], drill: { entity: 'gatepasses' } },
  { id: 'face', name: 'Face Recognition', definition: 'Requires HCP person/visitor authentication data. Not present in the September 2026 upload — shown as unavailable, never fabricated.', formula: 'n/a', sources: [], filters: [], drill: null },
];

function periodIdOf(key) {
  if (!key) { const r = db.prepare('SELECT * FROM reporting_periods ORDER BY period_key DESC LIMIT 1').get(); return r || null; }
  return db.prepare('SELECT * FROM reporting_periods WHERE period_key=?').get(key) || null;
}
function compoundIdOf(name) {
  if (!name || name === 'all') return null;
  const r = db.prepare('SELECT id FROM compounds WHERE name=?').get(name);
  if (r) return r.id;
  const a = db.prepare('SELECT compound_id id FROM compound_aliases WHERE alias=?').get(name);
  return a ? a.id : null;
}
const S = (sql, p) => { const r = db.prepare(sql).get(...(p || [])); return r ? Object.values(r)[0] : 0; };
const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Resolve the compound filter for a query.
 * @returns {{sql:string, params:any[], denied:boolean}}
 */
function compoundFilter(compoundId, scopeIds) {
  if (compoundId != null) return { sql: ' AND compound_id=?', params: [compoundId], denied: false };
  if (Array.isArray(scopeIds)) {
    if (!scopeIds.length) return { sql: ' AND 1=0', params: [], denied: true };
    return { sql: ` AND compound_id IN (${scopeIds.map(() => '?').join(',')})`, params: [...scopeIds], denied: false };
  }
  return { sql: '', params: [], denied: false };
}

/** Build the normalized-name set used to attribute invitations to compounds. */
function namesForCompounds(ids) {
  if (!ids.length) return new Set();
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT DISTINCT u.norm_name n FROM user_units uu JOIN users u ON u.id=uu.user_id
    WHERE uu.compound_id IN (${ph}) AND u.norm_name IS NOT NULL`).all(...ids);
  return new Set(rows.map(r => r.n));
}

/** Invitations attributed to a compound (or set of compounds). null = all. */
function attributedInvitations(pid, compoundId, scopeIds) {
  const rows = db.prepare('SELECT id, status, type, provider, member_name FROM invitations WHERE period_id=?').all(pid);
  let ids = null;
  if (compoundId != null) ids = [compoundId];
  else if (Array.isArray(scopeIds)) ids = scopeIds;
  if (ids == null) return rows;
  const names = namesForCompounds(ids);
  if (!names.size) return [];
  return rows.filter(r => (r.provider && names.has(norm(r.provider))) || (r.member_name && names.has(norm(r.member_name))));
}

function emptyDashboard(period) {
  return {
    period: period ? { key: period.period_key, name: period.period_name } : null,
    cards: [],
    charts: { usersByType: [], usersByStatus: [], invByStatus: [], gpByType: [], accessByDay: [], accessByGate: [], entryExit: [], topCompounds: [] },
    warnings: period ? ['No data is visible in your assigned scope.'] : ['No reporting period available. Upload a monthly ZIP first.'],
  };
}

function computeDashboard(periodKey, compoundName, scopeIds) {
  let period = periodIdOf(periodKey);
  if (!period) {
    try {
      const latest = db.prepare('SELECT * FROM reporting_periods ORDER BY period_key DESC LIMIT 1').get();
      if (latest) period = latest;
    } catch (_) { /* fall through */ }
  }
  if (!period) return emptyDashboard(null);

  const cid = compoundIdOf(compoundName);
  const cf = compoundFilter(cid, scopeIds);
  if (cf.denied) return emptyDashboard(period);
  const cParams = cf.params;
  const pfx = (sql) => sql + cf.sql.replace(/\bcompound_id\b/g, 'compound_id');
  const pid = period.id;

  const activeUnits = S('SELECT COUNT(*) v FROM units WHERE 1=1' + cf.sql, cParams);
  const unitsWith = S("SELECT COUNT(DISTINCT unit_id) v FROM user_units WHERE status='Active'" + cf.sql, cParams);
  const coverage = activeUnits ? +(unitsWith / activeUnits * 100).toFixed(2) : 0;

  const restrictedIds = cid != null ? [cid] : (Array.isArray(scopeIds) ? scopeIds : null);
  const usersActive = restrictedIds
    ? S(`SELECT COUNT(DISTINCT uu.user_id) v FROM user_units uu JOIN users u ON u.id=uu.user_id
         WHERE uu.status='Active' AND u.status='Active' AND uu.compound_id IN (${restrictedIds.map(() => '?').join(',')})`, restrictedIds)
    : S("SELECT COUNT(*) v FROM users WHERE status='Active'");
  const usersTotal = restrictedIds
    ? S(`SELECT COUNT(DISTINCT user_id) v FROM user_units WHERE compound_id IN (${restrictedIds.map(() => '?').join(',')})`, restrictedIds)
    : S('SELECT COUNT(*) v FROM users');
  const vehiclesReg = restrictedIds
    ? S(`SELECT COUNT(DISTINCT v.id) v FROM vehicles v WHERE EXISTS (
         SELECT 1 FROM user_units uu WHERE uu.user_id=v.user_id AND uu.compound_id IN (${restrictedIds.map(() => '?').join(',')}))`, restrictedIds)
    : S('SELECT COUNT(*) v FROM vehicles');

  const hcpEvents = S('SELECT COUNT(*) v FROM hcp_vehicle_events WHERE period_id=?' + cf.sql, [pid, ...cParams]);
  const hcpUnique = S('SELECT COUNT(DISTINCT plate_normalized) v FROM hcp_vehicle_events WHERE period_id=? AND plate_normalized IS NOT NULL' + cf.sql, [pid, ...cParams]);
  const hcpAuto = S("SELECT COUNT(*) v FROM hcp_vehicle_events WHERE period_id=? AND result='PASS'" + cf.sql, [pid, ...cParams]);
  const hcpAutoU = S("SELECT COUNT(DISTINCT plate_normalized) v FROM hcp_vehicle_events WHERE period_id=? AND result='PASS' AND plate_normalized IS NOT NULL" + cf.sql, [pid, ...cParams]);

  const invRows = attributedInvitations(pid, cid, scopeIds);
  const invTotal = invRows.length;
  const gpTotal = S('SELECT COUNT(*) v FROM gate_passes WHERE period_id=?' + cf.sql, [pid, ...cParams]);

  const trunc = db.prepare('SELECT filename, row_count FROM raw_files WHERE period_id=? AND row_count=100000').all(pid);

  const cards = [
    { id: 'active_units', label: 'Active Units', value: activeUnits, drill: 'units' },
    { id: 'units_with_users', label: 'Units With Users', value: unitsWith, drill: 'units?preset=with_users' },
    { id: 'coverage_pct', label: 'Registration Coverage', value: coverage, suffix: '%', drill: 'units' },
    { id: 'users_active', label: 'Active Users', value: usersActive, sub: `of ${usersTotal} registered`, drill: 'users?status=Active' },
    { id: 'vehicles_registered', label: 'Registered Vehicles', value: vehiclesReg, drill: 'vehicles' },
    { id: 'hcp_unique', label: 'Unique Vehicles Accessing', value: hcpUnique, sub: `${hcpEvents} events`, drill: 'access' },
    { id: 'hcp_events', label: 'Vehicle Access Events', value: hcpEvents, drill: 'access' },
    { id: 'hcp_auto_open', label: 'Automatic Openings', value: hcpAuto, sub: `${hcpAutoU} unique vehicles`, drill: 'access?result=PASS' },
    { id: 'hcp_auto_unique', label: 'Unique Auto Vehicles', value: hcpAutoU, drill: 'access?result=PASS' },
    { id: 'invitations', label: 'Invitations', value: invTotal, drill: 'invitations' },
    { id: 'gatepass', label: 'Gate Passes', value: gpTotal, drill: 'gatepasses' },
  ];

  const charts = {};
  charts.usersByType = (restrictedIds
    ? db.prepare(`SELECT uu.access_type k, COUNT(DISTINCT uu.user_id) v FROM user_units uu JOIN users u ON u.id=uu.user_id
        WHERE uu.status='Active' AND u.status='Active' AND uu.compound_id IN (${restrictedIds.map(() => '?').join(',')}) GROUP BY k ORDER BY v DESC`).all(...restrictedIds)
    : db.prepare("SELECT registered_as k, COUNT(*) v FROM users WHERE status='Active' GROUP BY k ORDER BY v DESC").all()
  ).map(r => ({ label: r.k || 'Unknown', value: r.v }));

  charts.usersByStatus = (restrictedIds
    ? db.prepare(`SELECT u.status k, COUNT(*) v FROM users u
        WHERE u.id IN (SELECT user_id FROM user_units WHERE compound_id IN (${restrictedIds.map(() => '?').join(',')}))
        GROUP BY u.status ORDER BY v DESC`).all(...restrictedIds)
    : db.prepare('SELECT status k, COUNT(*) v FROM users GROUP BY status ORDER BY v DESC').all()
  ).map(r => ({ label: r.k || 'Unknown', value: r.v }));

  const invStatus = new Map();
  for (const r of invRows) invStatus.set(r.status || 'Unknown', (invStatus.get(r.status || 'Unknown') || 0) + 1);
  charts.invByStatus = Array.from(invStatus.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  charts.gpByType = db.prepare('SELECT access_type k, COUNT(*) v FROM gate_passes WHERE period_id=?' + cf.sql + ' GROUP BY access_type ORDER BY v DESC').all(pid, ...cParams).map(r => ({ label: r.k || 'Unknown', value: r.v }));
  charts.accessByDay = db.prepare(`SELECT substr(COALESCE(enter_time,exit_time),1,10) d, COUNT(*) v FROM hcp_vehicle_events WHERE period_id=?${cf.sql} GROUP BY d ORDER BY d`).all(pid, ...cParams).map(r => ({ label: r.d, value: r.v }));
  charts.accessByGate = db.prepare(`SELECT gate k, COUNT(*) v FROM hcp_vehicle_events WHERE period_id=?${cf.sql} GROUP BY gate ORDER BY v DESC`).all(pid, ...cParams).map(r => ({ label: r.k || 'Unknown', value: r.v }));
  charts.entryExit = db.prepare(`SELECT direction k, COUNT(*) v FROM hcp_vehicle_events WHERE period_id=?${cf.sql} GROUP BY direction`).all(pid, ...cParams).map(r => ({ label: r.k, value: r.v }));
  charts.topCompounds = db.prepare(`SELECT c.name k, COUNT(DISTINCT h.plate_normalized) v FROM hcp_vehicle_events h JOIN compounds c ON c.id=h.compound_id
    WHERE h.period_id=? AND h.plate_normalized IS NOT NULL${cf.sql.replace(/\bcompound_id\b/g, 'h.compound_id')} GROUP BY c.name ORDER BY v DESC LIMIT 10`).all(pid, ...cParams).map(r => ({ label: r.k, value: r.v }));

  return { period: { key: period.period_key, name: period.period_name }, compound: compoundName || 'all', cards, charts, warnings: trunc.map(t => `Potentially incomplete dataset "${t.filename}": source returned exactly ${t.row_count} records (possible export limit).`) };
}

function compareCompounds(periodKey, scopeIds) {
  const period = periodIdOf(periodKey);
  if (!period) return { period: null, rows: [], totals: null };
  const pid = period.id;
  let comps = db.prepare('SELECT id, name FROM compounds ORDER BY name').all();
  if (Array.isArray(scopeIds)) comps = comps.filter(c => scopeIds.includes(c.id));

  const byId = (rows, k, v) => { const m = new Map(); for (const r of rows) m.set(r[k], r[v]); return m; };
  const mUnits = byId(db.prepare('SELECT compound_id k, COUNT(*) v FROM units GROUP BY compound_id').all(), 'k', 'v');
  const mWith = byId(db.prepare("SELECT compound_id k, COUNT(DISTINCT unit_id) v FROM user_units WHERE status='Active' GROUP BY compound_id").all(), 'k', 'v');
  const mUsers = byId(db.prepare("SELECT uu.compound_id k, COUNT(DISTINCT uu.user_id) v FROM user_units uu JOIN users u ON u.id=uu.user_id WHERE uu.status='Active' AND u.status='Active' GROUP BY uu.compound_id").all(), 'k', 'v');
  const mHcp = new Map();
  for (const r of db.prepare("SELECT compound_id k, COUNT(*) n, COUNT(DISTINCT plate_normalized) u, SUM(CASE WHEN result='PASS' THEN 1 ELSE 0 END) a FROM hcp_vehicle_events WHERE period_id=? GROUP BY compound_id").all(pid)) mHcp.set(r.k, r);
  const mGp = byId(db.prepare('SELECT compound_id k, COUNT(*) v FROM gate_passes WHERE period_id=? GROUP BY compound_id').all(pid), 'k', 'v');

  // Invitations are attributed via provider/member name -> user -> compound (deduplicated).
  const invRows = db.prepare('SELECT id, provider, member_name FROM invitations WHERE period_id=?').all(pid);
  const userComp = new Map();
  for (const r of db.prepare('SELECT u.norm_name n, uu.compound_id c FROM user_units uu JOIN users u ON u.id=uu.user_id WHERE u.norm_name IS NOT NULL').all()) {
    if (!userComp.has(r.n)) userComp.set(r.n, new Set());
    userComp.get(r.n).add(r.c);
  }
  const mInv = new Map();
  const attributedInvIds = new Set();
  for (const r of invRows) {
    const names = [r.provider, r.member_name].map(norm).filter(Boolean);
    const hit = new Set();
    for (const nm of names) { const s = userComp.get(nm); if (s) for (const c of s) hit.add(c); }
    for (const c of hit) { mInv.set(c, (mInv.get(c) || 0) + 1); attributedInvIds.add(r.id); }
  }

  const rows = comps.map(c => {
    const au = mUnits.get(c.id) || 0, wu = mWith.get(c.id) || 0;
    const h = mHcp.get(c.id) || { n: 0, u: 0, a: 0 };
    return { compound: c.name, activeUnits: au, unitsWithUsers: wu, coverage: au ? +((wu / au) * 100).toFixed(2) : 0, activeUsers: mUsers.get(c.id) || 0, hcpUnique: h.u || 0, hcpAuto: h.a || 0, gatepasses: mGp.get(c.id) || 0, invitations: mInv.get(c.id) || 0, unassigned: false };
  });

  // Portfolio reconciliation: Unassigned is a real row, never silently dropped.
  if (!Array.isArray(scopeIds)) {
    const uAu = mUnits.get(null) || 0, uWu = mWith.get(null) || 0;
    const uh = mHcp.get(null) || { n: 0, u: 0, a: 0 };
    rows.push({
      compound: 'Unassigned', activeUnits: uAu, unitsWithUsers: uWu,
      coverage: uAu ? +((uWu / uAu) * 100).toFixed(2) : 0,
      activeUsers: mUsers.get(null) || 0, hcpUnique: uh.u || 0, hcpAuto: uh.a || 0,
      gatepasses: mGp.get(null) || 0,
      invitations: Math.max(0, invRows.length - attributedInvIds.size),
      unassigned: true,
    });
  }

  const totals = rows.reduce((a, r) => ({
    activeUnits: a.activeUnits + r.activeUnits,
    unitsWithUsers: a.unitsWithUsers + r.unitsWithUsers,
    activeUsers: a.activeUsers + r.activeUsers,
    hcpUnique: a.hcpUnique + r.hcpUnique,
    hcpAuto: a.hcpAuto + r.hcpAuto,
    gatepasses: a.gatepasses + r.gatepasses,
    invitations: a.invitations + r.invitations,
  }), { activeUnits: 0, unitsWithUsers: 0, activeUsers: 0, hcpUnique: 0, hcpAuto: 0, gatepasses: 0, invitations: 0 });

  return { period: { key: period.period_key, name: period.period_name }, rows, totals };
}

module.exports = { DEFINITIONS, computeDashboard, compareCompounds, periodIdOf, compoundIdOf, compoundFilter, attributedInvitations };
