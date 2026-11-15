'use strict';
/* Express API + static frontend. Read-only analytics; writes only via import/matching/settings flows.
   Security: every /api request passes correlation -> authentication -> route authorization.
   Compound scope is always resolved from the authenticated actor, never trusted from the query string. */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');
const { db, migrate, audit, auditEvent } = require('./db');
const { computeDashboard, compareCompounds, periodIdOf, DEFINITIONS } = require('./kpis');
const { qualityReport } = require('./quality');
const { stageUpload, rollbackImport, deletePeriodData, resetDatabase, getImportSummary } = require('./ingest');
const { startImport, isRunning, recoverStuckImports } = require('./jobs/runner');
const { ask } = require('./ai');
const hcpRoutes = require('./hcp/routes');
const { P } = require('./security/catalog');
const { correlation, authenticate, authorizeRoute, rateLimit, deny } = require('./security/middleware');
const authRoutes = require('./security/routes');
const { ensureBootstrapAdmin } = require('./security/bootstrap');
const { resolveRequestedCompound, canAccessCompound, canAccessUser } = require('./security/scope');
const { maskRows } = require('./security/pii');

migrate();
try { ensureBootstrapAdmin(); } catch (e) { console.warn('Bootstrap admin skipped:', e.message); }
try { recoverStuckImports(); } catch (e) { console.warn('Import recovery skipped:', e.message); }
try {
  // Phase 1 connectivity observations: in-process schedule, DNS+TCP+TLS only.
  // HCP_HEALTHCHECK_MS=0 disables. Never establishes tunnels or calls HCP APIs.
  const { startHealthScheduler } = require('./hcp/health');
  const hcMs = process.env.HCP_HEALTHCHECK_MS ? Number(process.env.HCP_HEALTHCHECK_MS) : 300000;
  if (hcMs > 0) startHealthScheduler(db, { intervalMs: hcMs });
} catch (e) { console.warn('HCP health scheduler disabled:', e.message); }

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS: the SPA may be served by XAMPP Apache while the API runs on Node.
// Credentials require an explicit (non-wildcard) origin.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Correlation-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(correlation);
// Everything under /api is authenticated and authorized. Public rules are declared in the catalog.
app.use('/api', authenticate, authorizeRoute);
app.use('/api/auth', authRoutes);
app.use('/api/hcp', hcpRoutes);
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const upload = multer({
  dest: path.join(__dirname, '..', 'data', 'uploads'),
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.zip$/i.test(file.originalname) || /\.(xlsx|xls|csv)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only .zip archives (or .xlsx/.xls/.csv files) are accepted.'));
  },
});

const S = (sql, p) => { try { const r = db.prepare(sql).get(...(p || [])); return r ? Object.values(r)[0] : 0; } catch (e) { return 0; } };
const latestKey = () => { const r = db.prepare('SELECT period_key FROM reporting_periods ORDER BY period_key DESC LIMIT 1').get(); return r ? r.period_key : null; };

/* ------------------------------------------------------------------ *
 * Scope helpers
 * ------------------------------------------------------------------ */
function compoundCtx(req) {
  return resolveRequestedCompound(req.actor.scope, req.query.compound);
}
function rejectCompound(req, res, rc) {
  return res.status(rc.status).json({
    error: rc.error,
    code: rc.status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
    correlationId: req.correlationId,
  });
}
function dashScopeIds(req, rc) {
  if (rc.id != null) return null;
  return req.actor.scope.all ? null : req.actor.scope.ids;
}

function addCond(where, params, cond) {
  if (!cond || !cond.sql) return;
  where.push(cond.sql);
  if (cond.params && cond.params.length) params.push(...cond.params);
}
function directScope(column, ctx) {
  const { scope, compoundId } = ctx;
  if (compoundId != null) return { sql: `${column}=?`, params: [compoundId] };
  if (scope.all) return { sql: '', params: [] };
  if (!scope.ids.length) return { sql: '1=0', params: [] };
  return { sql: `${column} IN (${scope.ids.map(() => '?').join(',')})`, params: [...scope.ids] };
}
function userLinkScope(userColumn, ctx, alias = 'sc') {
  const { scope, compoundId } = ctx;
  if (compoundId != null) {
    return { sql: `${userColumn} IN (SELECT DISTINCT user_id FROM user_units WHERE compound_id=?)`, params: [compoundId] };
  }
  if (scope.all) return { sql: '', params: [] };
  if (!scope.ids.length) return { sql: '1=0', params: [] };
  return {
    sql: `${userColumn} IN (SELECT DISTINCT user_id FROM user_units WHERE compound_id IN (${scope.ids.map(() => '?').join(',')}))`,
    params: [...scope.ids],
  };
}
/* Invitations have no compound column: attribution is provider/member name -> resident -> compound. */
function invitationScope(ctx) {
  const { scope, compoundId } = ctx;
  if (compoundId == null && scope.all) return { sql: '', params: [] };
  const ids = compoundId != null ? [compoundId] : scope.ids;
  if (!ids.length) return { sql: '1=0', params: [] };
  const ph = ids.map(() => '?').join(',');
  const inScope = `SELECT iu.norm_name FROM users iu JOIN user_units iuu ON iuu.user_id=iu.id WHERE iuu.compound_id IN (${ph})`;
  return {
    sql: `(lower(trim(invitations.provider)) IN (${inScope}) OR lower(trim(invitations.member_name)) IN (${inScope}))`,
    params: [...ids, ...ids],
  };
}

function paged(baseSql, countSql, params, page, limit, orderBy, countParams) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(5000, Math.max(1, parseInt(limit, 10) || 50));
  const total = S(countSql, countParams || params);
  const rows = db.prepare(`${baseSql} ${orderBy || ''} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  return { total, page, limit, rows };
}

// ---- shared filter builders (list + export stay consistent) ----
function fUnits(q, ctx) {
  const where = [], params = [];
  addCond(where, params, directScope('u.compound_id', ctx));
  if (q.search) { where.push('(u.unit_number LIKE ? OR u.related_unit LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`); }
  if (q.preset === 'with_users') where.push("EXISTS (SELECT 1 FROM user_units uu WHERE uu.unit_id=u.id AND uu.status='Active')");
  if (q.preset === 'without_users') where.push("NOT EXISTS (SELECT 1 FROM user_units uu WHERE uu.unit_id=u.id AND uu.status='Active')");
  return { w: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}
function fUsers(q, ctx) {
  const where = [], params = [];
  addCond(where, params, userLinkScope('u.id', ctx));
  if (q.status && q.status !== 'all') { where.push('u.status=?'); params.push(q.status); }
  if (q.type && q.type !== 'all') { where.push('u.registered_as=?'); params.push(q.type); }
  if (q.gender && q.gender !== 'all') { where.push('u.gender=?'); params.push(q.gender); }
  if (q.maritalStatus && q.maritalStatus !== 'all') { where.push('u.marital_status=?'); params.push(q.maritalStatus); }
  if (q.search) {
    where.push('(u.name LIKE ? OR u.mobile LIKE ? OR u.email LIKE ? OR u.national_id LIKE ? OR u.passport LIKE ? OR EXISTS (SELECT 1 FROM user_units uu2 WHERE uu2.user_id=u.id AND uu2.unit_ref_raw LIKE ?))');
    params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
  }
  if (q.unit) {
    where.push('EXISTS (SELECT 1 FROM user_units uu3 WHERE uu3.user_id=u.id AND uu3.unit_ref_raw LIKE ?)');
    params.push(`%${q.unit}%`);
  }
  return { w: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}
function vehicleScopeSql(ctx) {
  // Compound membership is established through the CRM owner relation.
  // HCP event data enriches the row, but must not classify a vehicle into a
  // compound when its owner has no unit/access link to that compound.
  return userLinkScope('v.user_id', ctx);
}
function fVehicles(q, ctx) {
  const where = [], params = [];
  addCond(where, params, vehicleScopeSql(ctx));
  if (q.status && q.status !== 'all') { where.push('v.status=?'); params.push(q.status); }
  if (q.search) { where.push('(v.plate_original LIKE ? OR v.plate_norm LIKE ? OR v.make LIKE ? OR v.model LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  return { w: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}
function fGatepass(q, pid, ctx) {
  const where = ['g.period_id=?'], params = [pid];
  addCond(where, params, directScope('g.compound_id', ctx));
  if (q.type && q.type !== 'all') { where.push('g.access_type=?'); params.push(q.type); }
  if (q.search) { where.push('(g.user_name_raw LIKE ? OR g.unit_ref_raw LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`); }
  if (q.from) { where.push('g.entry_date>=?'); params.push(q.from); }
  if (q.to) { where.push('g.entry_date<=?'); params.push(q.to + ' 23:59'); }
  return { w: 'WHERE ' + where.join(' AND '), params };
}
function fInv(q, pid, ctx) {
  const where = ['period_id=?'], params = [pid];
  addCond(where, params, invitationScope(ctx));
  if (q.status && q.status !== 'all') { where.push('status=?'); params.push(q.status); }
  if (q.type && q.type !== 'all') { where.push('type=?'); params.push(q.type); }
  if (q.search) { where.push('(member_name LIKE ? OR provider LIKE ? OR code LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  return { w: 'WHERE ' + where.join(' AND '), params };
}
function fAccess(q, pid, ctx) {
  const where = ['h.period_id=?'], params = [pid];
  addCond(where, params, directScope('h.compound_id', ctx));
  if (q.direction && q.direction !== 'all') { where.push('h.direction=?'); params.push(q.direction); }
  if (q.result && q.result !== 'all') { where.push('h.result=?'); params.push(q.result); }
  if (q.gate && q.gate !== 'all') { where.push('h.gate=?'); params.push(q.gate); }
  if (q.search) { where.push('(h.plate_original LIKE ? OR h.owner_raw LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`); }
  if (q.from) { where.push('COALESCE(h.enter_time,h.exit_time)>=?'); params.push(q.from); }
  if (q.to) { where.push('COALESCE(h.enter_time,h.exit_time)<=?'); params.push(q.to + ' 23:59'); }
  if (q.hour && q.hour !== 'all') { where.push("substr(COALESCE(h.enter_time,h.exit_time),12,2)=?"); params.push(String(q.hour).padStart(2, '0')); }
  return { w: 'WHERE ' + where.join(' AND '), params };
}

/* ------------------------------------------------------------------ *
 * Reference
 * ------------------------------------------------------------------ */
const STARTED_AT = new Date();

app.get('/api/health', (req, res) => {
  let dbOk = true;
  try { db.prepare('SELECT 1').get(); } catch (_) { dbOk = false; }
  let lastImport = null;
  let activeImports = 0;
  let latestPeriod = null;
  let latestSnapshot = null;
  if (dbOk) {
    try {
      const imp = db.prepare('SELECT id, status, detected_period_key, uploaded_at FROM imports ORDER BY id DESC LIMIT 1').get();
      if (imp) lastImport = { id: imp.id, status: imp.status, period: imp.detected_period_key || null, uploadedAt: imp.uploaded_at };
      activeImports = db.prepare("SELECT COUNT(*) c FROM imports WHERE status IN ('staged','UPLOADED','ANALYZING','VALIDATING','PROCESSING','processing')").get().c;
      const p = db.prepare('SELECT period_key, period_name FROM reporting_periods ORDER BY period_key DESC LIMIT 1').get();
      if (p) latestPeriod = { key: p.period_key, name: p.period_name };
      const s = db.prepare('SELECT period_key, created_at FROM period_snapshots ORDER BY id DESC LIMIT 1').get();
      if (s) latestSnapshot = { period: s.period_key, createdAt: s.created_at };
    } catch (e) {
      // Health must never fail because an optional table is missing.
      lastImport = null;
    }
  }
  res.json({
    ok: dbOk,
    version: '1.0.0',
    database: dbOk ? 'ok' : 'unavailable',
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    lastImport,
    activeImports,
    latestPeriod,
    latestSnapshot,
  });
});
app.get('/api/periods', (req, res) => {
  const rows = db.prepare('SELECT p.*, (SELECT COUNT(*) FROM raw_files f WHERE f.period_id=p.id) files FROM reporting_periods p ORDER BY period_key DESC').all();
  res.json(rows);
});
app.get('/api/compounds', (req, res) => {
  const scope = req.actor.scope;
  if (scope.all) return res.json(db.prepare('SELECT id, name FROM compounds ORDER BY name').all());
  if (!scope.ids.length) return res.json([]);
  const ph = scope.ids.map(() => '?').join(',');
  res.json(db.prepare(`SELECT id, name FROM compounds WHERE id IN (${ph}) ORDER BY name`).all(...scope.ids));
});
app.get('/api/kpi-definitions', (req, res) => res.json(DEFINITIONS));

app.get('/api/dashboard', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  res.json(computeDashboard(req.query.period || latestKey(), rc.name || 'all', dashScopeIds(req, rc)));
});
app.get('/api/compare', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const ids = rc.id != null ? [rc.id] : (req.actor.scope.all ? null : req.actor.scope.ids);
  res.json(compareCompounds(req.query.period || latestKey(), ids));
});

/* ------------------------------------------------------------------ *
 * Units
 * ------------------------------------------------------------------ */
app.get('/api/units', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const ctx = { scope: req.actor.scope, compoundId: rc.id };
  const { w, params } = fUnits(req.query, ctx);
  // Whitelisted sortable columns: click a header to toggle asc/desc.
  const sortCols = {
    unit_number: 'u.unit_number',
    related_unit: 'u.related_unit',
    compound: 'c.name',
    users: 'COALESCE(uu.cnt,0)',
    passes: 'COALESCE(gp.cnt,0)',
  };
  let order = 'ORDER BY u.unit_number ASC';
  const sortKey = req.query.sort;
  const sortDir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  if (sortKey && sortCols[sortKey]) {
    order = `ORDER BY ${sortCols[sortKey]} ${sortDir}, u.unit_number ASC, u.id ASC`;
  } else if (req.query.sort === 'unit_desc') {
    order = 'ORDER BY u.unit_number DESC';
  }
  // Counts are pre-aggregated once: correlated per-row subqueries against the 100k-row
  // gate_passes table made a single page view scan ~1B rows and wedged the server.
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const total = S(`SELECT COUNT(*) c FROM units u ${w}`, params);
  const rows = db.prepare(
    `SELECT u.id, u.unit_number, c.name compound, u.related_unit, COALESCE(uu.cnt,0) users, COALESCE(gp.cnt,0) passes
     FROM units u LEFT JOIN compounds c ON c.id=u.compound_id
     LEFT JOIN (SELECT unit_id, COUNT(*) cnt FROM user_units WHERE status='Active' GROUP BY unit_id) uu ON uu.unit_id=u.id
     LEFT JOIN (SELECT unit_id, COUNT(*) cnt FROM gate_passes GROUP BY unit_id) gp ON gp.unit_id=u.id
     ${w} ${order} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  res.json({ total, page, limit, rows });
});
app.get('/api/units/:id', (req, res) => {
  const u = db.prepare('SELECT u.*, c.name compound FROM units u LEFT JOIN compounds c ON c.id=u.compound_id WHERE u.id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Unit not found' });
  if (!canAccessCompound(req.actor.scope, u.compound_id)) {
    return res.status(403).json({ error: 'This unit is outside your assigned scope', code: 'FORBIDDEN', correlationId: req.correlationId });
  }
  let users = db.prepare(`SELECT us.id, us.name, us.mobile, us.status, us.registered_as, uu.access_type, uu.status rel_status FROM user_units uu JOIN users us ON us.id=uu.user_id WHERE uu.unit_id=?`).all(u.id);
  const vehicles = db.prepare(`SELECT v.* FROM vehicles v WHERE v.user_id IN (SELECT user_id FROM user_units WHERE unit_id=?)`).all(u.id);
  const passes = db.prepare('SELECT access_type, COUNT(*) n, MIN(entry_date) first, MAX(entry_date) last FROM gate_passes WHERE unit_id=? GROUP BY access_type').all(u.id);
  const inv = db.prepare(`SELECT status, COUNT(*) n FROM invitations WHERE provider IN (SELECT us.name FROM user_units uu JOIN users us ON us.id=uu.user_id WHERE uu.unit_id=?) GROUP BY status`).all(u.id);
  const ho = db.prepare('SELECT * FROM handover WHERE unit_id=?').all(u.id);
  let hcpEvents = [];
  try {
    const userIds = users.map(x => x.id);
    const plateRows = vehicles.map(v => v.plate_norm).filter(Boolean);
    const plateLatin = vehicles.map(v => v.plate_norm_latin).filter(Boolean);
    const wh = [], pa = [];
    if (userIds.length) { wh.push(`h.owner_user_id IN (${userIds.map(() => '?').join(',')})`); pa.push(...userIds); }
    if (plateRows.length) { wh.push(`h.plate_normalized IN (${plateRows.map(() => '?').join(',')})`); pa.push(...plateRows); }
    if (plateLatin.length) { wh.push(`h.plate_normalized_latin IN (${plateLatin.map(() => '?').join(',')})`); pa.push(...plateLatin); }
    if (wh.length) {
      hcpEvents = db.prepare(`SELECT h.id, h.plate_original, h.direction, h.enter_time, h.exit_time, h.gate, h.method, h.result, h.reason, h.owner_raw, h.owner_user_id, c.name compound FROM hcp_vehicle_events h LEFT JOIN compounds c ON c.id=h.compound_id WHERE (${wh.join(' OR ')}) AND ${req.actor.scope.all ? '1=1' : 'h.compound_id IN (' + req.actor.scope.ids.map(() => '?').join(',') + ')'} ORDER BY COALESCE(h.enter_time,h.exit_time) DESC LIMIT 20`).all(...pa, ...(req.actor.scope.all ? [] : req.actor.scope.ids));
    }
  } catch (_) { hcpEvents = []; }
  // Top Management may open a unit but has no resident-level access: strip direct identifiers.
  if (!req.actor.permissions.has(P.RESIDENT_LIST)) {
    users = users.map(x => ({ id: x.id, status: x.status, registered_as: x.registered_as, access_type: x.access_type, rel_status: x.rel_status }));
    hcpEvents = hcpEvents.map(e => ({ ...e, owner_raw: null }));
  }
  res.json({ unit: u, users, vehicles, passes, invitations: inv, handover: ho, hcpEvents });
});

/* ------------------------------------------------------------------ *
 * Residents
 * ------------------------------------------------------------------ */
app.get('/api/users', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const ctx = { scope: req.actor.scope, compoundId: rc.id };
  const { w, params } = fUsers(req.query, ctx);
  let subScope = '';
  let subParams = [];
  if (rc.id != null) {
    subScope = ' AND uu.compound_id=?';
    subParams = [rc.id, rc.id];
  } else if (!req.actor.scope.all) {
    const ph = req.actor.scope.ids.map(() => '?').join(',');
    subScope = ` AND uu.compound_id IN (${ph})`;
    subParams = [...req.actor.scope.ids, ...req.actor.scope.ids];
  }
  const sortCols = {
    name: 'u.name',
    status: 'u.status',
    registered_as: 'u.registered_as',
    units: 'units',
    national_id: 'u.national_id',
    gender: 'u.gender',
    marital_status: 'u.marital_status',
    created_on: 'u.created_on',
  };
  let orderBy = 'ORDER BY u.name ASC';
  const sortKey = req.query.sort;
  const sortDir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  if (sortKey && sortCols[sortKey]) {
    orderBy = `ORDER BY ${sortCols[sortKey]} ${sortDir}, u.name ASC, u.id ASC`;
  }
  res.json(paged(
    `SELECT u.id, u.name, u.mobile, u.email, u.national_id, u.passport, u.gender, u.marital_status, u.status, u.registered_as, u.created_on, u.first_seen, u.last_seen, (SELECT GROUP_CONCAT(DISTINCT c.name) FROM user_units uu LEFT JOIN compounds c ON c.id=uu.compound_id WHERE uu.user_id=u.id${subScope}) compounds, (SELECT COUNT(*) FROM user_units uu WHERE uu.user_id=u.id${subScope}) units FROM users u ${w}`,
    `SELECT COUNT(*) c FROM users u ${w}`, [...subParams, ...params], req.query.page, req.query.limit, orderBy, params));
});
app.get('/api/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!canAccessUser(req.actor.scope, u.id)) {
    return res.status(403).json({ error: 'This resident is outside your assigned scope', code: 'FORBIDDEN', correlationId: req.correlationId });
  }
  let units;
  if (!req.actor.scope.all) {
    const ph = req.actor.scope.ids.map(() => '?').join(',');
    units = db.prepare(`SELECT uu.*, un.unit_number, c.name compound FROM user_units uu LEFT JOIN units un ON un.id=uu.unit_id LEFT JOIN compounds c ON c.id=uu.compound_id WHERE uu.user_id=? AND uu.compound_id IN (${ph})`).all(u.id, ...req.actor.scope.ids);
  } else {
    units = db.prepare(`SELECT uu.*, un.unit_number, c.name compound FROM user_units uu LEFT JOIN units un ON un.id=uu.unit_id LEFT JOIN compounds c ON c.id=uu.compound_id WHERE uu.user_id=?`).all(u.id);
  }
  const vehicles = db.prepare('SELECT * FROM vehicles WHERE user_id=?').all(u.id);
  const passes = db.prepare(`SELECT COUNT(*) n FROM gate_passes WHERE user_id=?`).get(u.id).n;
  const hcpLinked = db.prepare(`SELECT COUNT(*) n FROM hcp_vehicle_events WHERE owner_user_id=?`).get(u.id).n;
  let hcpEventsList = [];
  try {
    const plateRows = vehicles.map(v => v.plate_norm).filter(Boolean);
    const plateLatin = vehicles.map(v => v.plate_norm_latin).filter(Boolean);
    const wh = [], pa = [];
    if (plateRows.length) { wh.push(`h.plate_normalized IN (${plateRows.map(() => '?').join(',')})`); pa.push(...plateRows); }
    if (plateLatin.length) { wh.push(`h.plate_normalized_latin IN (${plateLatin.map(() => '?').join(',')})`); pa.push(...plateLatin); }
    const matchSql = wh.length ? ` OR (${wh.join(' OR ')})` : '';
    const scopeSql = req.actor.scope.all ? '1=1' : `h.compound_id IN (${req.actor.scope.ids.map(() => '?').join(',')})`;
    const scopeParams = req.actor.scope.all ? [] : req.actor.scope.ids;
    hcpEventsList = db.prepare(`SELECT h.id, h.plate_original, h.direction, h.enter_time, h.exit_time, h.gate, h.method, h.result, h.reason, h.owner_raw, c.name compound FROM hcp_vehicle_events h LEFT JOIN compounds c ON c.id=h.compound_id WHERE (h.owner_user_id=?${matchSql}) AND ${scopeSql} ORDER BY COALESCE(h.enter_time,h.exit_time) DESC LIMIT 20`).all(u.id, ...pa, ...scopeParams);
  } catch (_) { hcpEventsList = []; }
  res.json({ user: u, units, vehicles, gatePasses: passes, hcpEvents: hcpLinked, hcpEventsList });
});
app.put('/api/users/:id/image', (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!canAccessUser(req.actor.scope, u.id)) {
    return res.status(403).json({ error: 'This resident is outside your assigned scope', code: 'FORBIDDEN', correlationId: req.correlationId });
  }
  const { image_url } = req.body || {};
  db.prepare('UPDATE users SET image_url=? WHERE id=?').run(image_url || null, req.params.id);
  auditEvent({ action: 'resident.image.update', targetType: 'user', targetId: req.params.id, result: 'OK', detail: `image_url=${image_url ? 'set' : 'cleared'}` });
  res.json({ ok: true, image_url: image_url || null });
});

/* ------------------------------------------------------------------ *
 * Vehicles
 * ------------------------------------------------------------------ */
app.get('/api/vehicles', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const ctx = { scope: req.actor.scope, compoundId: rc.id };
  const { w, params } = fVehicles(req.query, ctx);
  const canSeeOwner = req.actor.permissions.has(P.RESIDENT_LIST);
  const totalRows = S(`SELECT COUNT(*) c FROM vehicles v ${w}`, params);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const filteredSql = `SELECT v.id, v.plate_original, v.plate_norm, v.plate_norm_latin, v.make, v.model, v.year, v.status, u.name owner, v.user_name_raw owner_raw, v.user_id owner_id
      FROM vehicles v LEFT JOIN users u ON u.id = v.user_id ${w} ORDER BY v.plate_original ASC LIMIT ? OFFSET ?`;
  const rows = db.prepare(`
    WITH filtered AS (
      ${filteredSql}
    )
    SELECT f.id, f.plate_original, f.make, f.model, f.year, f.status, f.owner,
      f.owner_raw, f.owner_id,
      (SELECT GROUP_CONCAT(DISTINCT c.name) FROM user_units uu LEFT JOIN compounds c ON c.id = uu.compound_id WHERE uu.user_id = f.owner_id) compounds,
      (SELECT GROUP_CONCAT(DISTINCT un.unit_number) FROM user_units uu LEFT JOIN units un ON un.id = uu.unit_id WHERE uu.user_id = f.owner_id) units,
      hcp.events hcp_events, hcp.last_event hcp_last_event, hcp.compounds hcp_compounds,
      hcp.owner_name hcp_owner_name
    FROM filtered f
    LEFT JOIN (
      SELECT h.plate_normalized || '|' || h.plate_normalized_latin key,
        COUNT(*) events,
        MAX(COALESCE(h.enter_time, h.exit_time)) last_event,
        GROUP_CONCAT(DISTINCT hc.name) compounds,
        (SELECT x.owner_raw FROM hcp_vehicle_events x WHERE x.plate_normalized = h.plate_normalized AND x.plate_normalized_latin = h.plate_normalized_latin AND x.owner_raw IS NOT NULL ORDER BY COALESCE(x.enter_time, x.exit_time) DESC LIMIT 1) owner_name
      FROM hcp_vehicle_events h
      LEFT JOIN compounds hc ON hc.id = h.compound_id
      WHERE h.plate_normalized IN (SELECT plate_norm FROM filtered WHERE plate_norm IS NOT NULL)
        AND h.plate_normalized_latin IN (SELECT plate_norm_latin FROM filtered WHERE plate_norm_latin IS NOT NULL)
      GROUP BY h.plate_normalized, h.plate_normalized_latin
    ) hcp ON hcp.key = (f.plate_norm || '|' || f.plate_norm_latin)
    ORDER BY f.plate_original ASC`).all(...params, limit, offset);
  const rowsResult = { total: totalRows, page, limit, rows };
  if (!canSeeOwner) rowsResult.rows = rowsResult.rows.map(r => ({ ...r, owner: null, compounds: null, units: null, hcp_owner_name: null }));
  res.json(rowsResult);
});
app.get('/api/vehicles/stats', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const ctx = { scope: req.actor.scope, compoundId: rc.id };
  const where = [], params = [];
  addCond(where, params, vehicleScopeSql(ctx));
  if (req.query.search) { where.push('(v.plate_original LIKE ? OR v.make LIKE ? OR v.model LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`); }
  const base = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sf = s => `${base ? base + ' AND' : 'WHERE'} v.status=?`;
  const statusRow = db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN v.status='Approved By PHD' THEN 1 ELSE 0 END) approved,
    SUM(CASE WHEN v.status='Under Review' THEN 1 ELSE 0 END) underReview,
    SUM(CASE WHEN v.status='Deactivated' THEN 1 ELSE 0 END) deactivated,
    SUM(CASE WHEN v.status='Rejected' THEN 1 ELSE 0 END) rejected
    FROM vehicles v ${base}`).get(...params);
  const total = statusRow.total || 0;
  const approved = statusRow.approved || 0;
  const underReview = statusRow.underReview || 0;
  const deactivated = statusRow.deactivated || 0;
  const rejected = statusRow.rejected || 0;
  const withActivity = S(`SELECT COUNT(*) c FROM vehicles v ${base ? base + ' AND' : 'WHERE'} EXISTS (SELECT 1 FROM hcp_vehicle_events h WHERE h.plate_normalized=v.plate_norm AND h.plate_normalized_latin=v.plate_norm_latin OR (v.user_id IS NOT NULL AND h.owner_user_id=v.user_id))`, params);
  res.json({ total, approved, underReview, deactivated, rejected, withActivity });
});
app.get('/api/vehicles/:id', (req, res) => {
  const v = db.prepare('SELECT v.*, u.name owner, u.mobile owner_mobile, u.national_id owner_national_id, u.status owner_status FROM vehicles v LEFT JOIN users u ON u.id=v.user_id WHERE v.id=?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Vehicle not found' });
  if (!req.actor.scope.all && (!v.user_id || !canAccessUser(req.actor.scope, v.user_id))) {
    const ids = req.actor.scope.ids || [];
    const ph = ids.length ? ids.map(() => '?').join(',') : '';
    const linkedByEvent = ids.length && (v.plate_norm || v.plate_norm_latin) ? db.prepare(`SELECT 1 FROM hcp_vehicle_events WHERE plate_normalized=? AND plate_normalized_latin=? AND compound_id IN (${ph}) LIMIT 1`).get(v.plate_norm, v.plate_norm_latin, ...ids) : null;
    if (!linkedByEvent) return res.status(403).json({ error: 'This vehicle is outside your assigned scope', code: 'FORBIDDEN', correlationId: req.correlationId });
  }
  const events = db.prepare('SELECT h.*, c.name compound FROM hcp_vehicle_events h LEFT JOIN compounds c ON c.id=h.compound_id WHERE (h.plate_normalized=? AND h.plate_normalized_latin=?) OR h.owner_user_id=? ORDER BY COALESCE(h.enter_time,h.exit_time) DESC LIMIT 200').all(v.plate_norm, v.plate_norm_latin, v.user_id);
  const ownerUnits = v.user_id ? db.prepare('SELECT uu.*, un.unit_number, c.name compound FROM user_units uu LEFT JOIN units un ON un.id=uu.unit_id LEFT JOIN compounds c ON c.id=uu.compound_id WHERE uu.user_id=? ORDER BY un.unit_number').all(v.user_id) : [];
  const canSeeOwner = req.actor.permissions.has(P.RESIDENT_LIST);
  res.json({
    vehicle: canSeeOwner ? v : { ...v, owner: null },
    events: canSeeOwner ? events : events.map(e => ({ ...e, owner_raw: null, owner_user_id: null })),
    ownerUnits: canSeeOwner ? ownerUnits : [],
  });
});

/* ------------------------------------------------------------------ *
 * Gate passes / invitations / HCP access
 * ------------------------------------------------------------------ */
app.get('/api/gatepasses', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const pid = (periodIdOf(req.query.period || latestKey()) || {}).id;
  if (!pid) return res.json({ total: 0, rows: [] });
  const ctx = { scope: req.actor.scope, compoundId: rc.id };
  const { w, params } = fGatepass(req.query, pid, ctx);
  res.json(paged(`SELECT g.id, g.user_name_raw user, g.unit_ref_raw unit, c.name compound, g.access_type, g.entry_date, g.valid_until FROM gate_passes g LEFT JOIN compounds c ON c.id=g.compound_id ${w}`,
    `SELECT COUNT(*) c FROM gate_passes g ${w}`, params, req.query.page, req.query.limit, 'ORDER BY g.entry_date DESC'));
});
app.get('/api/invitations', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const pid = (periodIdOf(req.query.period || latestKey()) || {}).id;
  if (!pid) return res.json({ total: 0, rows: [] });
  const ctx = { scope: req.actor.scope, compoundId: rc.id };
  const { w, params } = fInv(req.query, pid, ctx);
  res.json(paged('SELECT id, code, provider, invite_to, member_name, member_mobile, type, status, created_on FROM invitations ' + w,
    'SELECT COUNT(*) c FROM invitations ' + w, params, req.query.page, req.query.limit, 'ORDER BY created_on DESC'));
});
app.get('/api/access', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const pid = (periodIdOf(req.query.period || latestKey()) || {}).id;
  if (!pid) return res.json({ total: 0, rows: [] });
  const ctx = { scope: req.actor.scope, compoundId: rc.id };
  const { w, params } = fAccess(req.query, pid, ctx);
  const canSeeOwner = req.actor.permissions.has(P.RESIDENT_LIST);
  const result = paged(`SELECT h.id, h.plate_original plate, h.plate_normalized_latin, h.direction, h.enter_time, h.exit_time, h.gate, h.method, h.result, h.reason, h.vehicle_list, h.owner_raw, h.owner_user_id, u.name owner_matched, h.vehicle_type, h.color, h.brand, c.name compound FROM hcp_vehicle_events h LEFT JOIN users u ON u.id=h.owner_user_id LEFT JOIN compounds c ON c.id=h.compound_id ${w}`,
    `SELECT COUNT(*) c FROM hcp_vehicle_events h ${w}`, params, req.query.page, req.query.limit, 'ORDER BY COALESCE(h.enter_time,h.exit_time) ' + (req.query.dir === 'asc' ? 'ASC' : 'DESC'));
  if (!canSeeOwner) result.rows = result.rows.map(r => ({ ...r, owner_matched: null }));
  res.json(result);
});
app.get('/api/access/hourly', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const pid = (periodIdOf(req.query.period || latestKey()) || {}).id;
  if (!pid) return res.json([]);
  const where = ['h.period_id=?'], params = [pid];
  addCond(where, params, directScope('h.compound_id', { scope: req.actor.scope, compoundId: rc.id }));
  res.json(db.prepare(`SELECT substr(COALESCE(h.enter_time,h.exit_time),12,2) hh, COUNT(*) v FROM hcp_vehicle_events h WHERE ${where.join(' AND ')} AND COALESCE(h.enter_time,h.exit_time) IS NOT NULL GROUP BY hh ORDER BY hh`).all(...params));
});
app.get('/api/access/heatmap', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const pid = (periodIdOf(req.query.period || latestKey()) || {}).id;
  if (!pid) return res.json([]);
  const where = ['h.period_id=?'], params = [pid];
  addCond(where, params, directScope('h.compound_id', { scope: req.actor.scope, compoundId: rc.id }));
  res.json(db.prepare(`SELECT substr(COALESCE(h.enter_time,h.exit_time),1,10) d, substr(COALESCE(h.enter_time,h.exit_time),12,2) hh, COUNT(*) v FROM hcp_vehicle_events h WHERE ${where.join(' AND ')} AND COALESCE(h.enter_time,h.exit_time) IS NOT NULL GROUP BY d, hh`).all(...params));
});

/* ------------------------------------------------------------------ *
 * Trends (snapshot metrics)
 * ------------------------------------------------------------------ */
app.get('/api/trends', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const metric = req.query.metric || 'active_units';
  const periods = db.prepare('SELECT * FROM reporting_periods ORDER BY period_key').all();
  const valueFor = (pid) => {
    if (rc.id != null) {
      const r = db.prepare('SELECT value_num v FROM period_metrics WHERE period_id=? AND metric_key=? AND compound_id=?').get(pid, metric, rc.id);
      return r ? r.v : null;
    }
    if (req.actor.scope.all) {
      const r = db.prepare('SELECT value_num v FROM period_metrics WHERE period_id=? AND metric_key=? AND compound_id IS NULL').get(pid, metric);
      return r ? r.v : null;
    }
    const ids = req.actor.scope.ids;
    if (!ids.length) return null;
    const ph = ids.map(() => '?').join(',');
    const r = db.prepare(`SELECT SUM(value_num) v FROM period_metrics WHERE period_id=? AND metric_key=? AND compound_id IN (${ph})`).get(pid, metric, ...ids);
    return r && r.v != null ? r.v : null;
  };
  res.json(periods.map(p => ({ period: p.period_key, name: p.period_name, value: valueFor(p.id) })));
});

/* ------------------------------------------------------------------ *
 * Quality / matching / insights
 * ------------------------------------------------------------------ */
app.get('/api/quality', (req, res) => {
  const report = qualityReport(req.query.period || latestKey());
  // Record-level samples can contain identifiers from outside a scoped actor's communities.
  if (!req.actor.scope.all) report.records = report.records.map(r => ({ ...r, sample: [] }));
  res.json(report);
});

function ownerInScope(scope, name) {
  if (scope.all) return true;
  if (!scope.ids.length) return false;
  const key = String(name == null ? '' : name).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!key) return false;
  const ph = scope.ids.map(() => '?').join(',');
  return !!db.prepare(`SELECT 1 FROM hcp_vehicle_events h WHERE lower(trim(h.owner_raw))=? AND h.compound_id IN (${ph}) LIMIT 1`).get(key, ...scope.ids);
}

app.get('/api/matching', (req, res) => {
  const scope = req.actor.scope;
  const matched = S("SELECT COUNT(*) c FROM identity_maps WHERE source_kind='hcp_owner' AND status='MATCHED'");
  let possible = db.prepare("SELECT source_key FROM identity_maps WHERE source_kind='hcp_owner' AND status='POSSIBLE_MATCH'").all().map(r => r.source_key);
  let unmatched = db.prepare("SELECT source_key FROM identity_maps WHERE source_kind='hcp_owner' AND status='UNMATCHED'").all().map(r => r.source_key);
  if (!scope.all) {
    possible = possible.filter(n => ownerInScope(scope, n));
    unmatched = unmatched.filter(n => ownerInScope(scope, n));
  }
  const optsCtx = { scope, compoundId: null };
  const withOptions = (name) => {
    const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
    const sc = userLinkScope('u.id', optsCtx, 'mo');
    const where = sc.sql ? `WHERE u.norm_name=? AND ${sc.sql}` : 'WHERE u.norm_name=?';
    return db.prepare(`SELECT u.id, u.name, u.mobile, u.status, u.registered_as, (SELECT GROUP_CONCAT(un.unit_number) FROM user_units uu LEFT JOIN units un ON un.id=uu.unit_id WHERE uu.user_id=u.id) units, (SELECT GROUP_CONCAT(DISTINCT c.name) FROM user_units uu LEFT JOIN compounds c ON c.id=uu.compound_id WHERE uu.user_id=u.id) compounds FROM users u ${where} LIMIT 5`).all(key, ...sc.params);
  };
  res.json({ matched, possible: possible.map(n => ({ hcpName: n, options: withOptions(n) })), unmatched: unmatched.map(n => ({ hcpName: n, options: withOptions(n) })) });
});
app.post('/api/matching', (req, res) => {
  const { hcpName, userId, action } = req.body || {};
  if (!hcpName) return res.status(400).json({ error: 'hcpName required', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  const key = String(hcpName).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!ownerInScope(req.actor.scope, key)) {
    return res.status(403).json({ error: 'This HCP owner is outside your assigned scope', code: 'FORBIDDEN', correlationId: req.correlationId });
  }
  if (action === 'reject') {
    db.prepare("UPDATE identity_maps SET status='UNMATCHED', crm_user_id=NULL WHERE source_kind='hcp_owner' AND source_key=?").run(key);
    auditEvent({ action: 'identity.reject', targetType: 'identity', targetId: key, result: 'OK' });
  } else {
    if (!userId) return res.status(400).json({ error: 'userId required to confirm', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
    if (!canAccessUser(req.actor.scope, userId)) {
      return res.status(403).json({ error: 'The target resident is outside your assigned scope', code: 'FORBIDDEN', correlationId: req.correlationId });
    }
    db.prepare(`INSERT INTO identity_maps(source_kind,source_key,crm_user_id,match_method,confidence,status,created_at) VALUES('hcp_owner',?,?,'MANUAL',1.0,'MATCHED',datetime('now'))
      ON CONFLICT(source_kind,source_key) DO UPDATE SET crm_user_id=excluded.crm_user_id, match_method='MANUAL', confidence=1.0, status='MATCHED'`).run(key, userId);
    db.prepare('UPDATE hcp_vehicle_events SET owner_user_id=? WHERE owner_raw=?').run(userId, hcpName);
    auditEvent({ action: 'identity.confirm', targetType: 'identity', targetId: key, result: 'OK', detail: `user=${userId}` });
  }
  res.json({ ok: true });
});
app.get('/api/insights', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const key = req.query.period || latestKey();
  const d = computeDashboard(key, rc.name || 'all', dashScopeIds(req, rc));
  const get = id => (d.cards.find(c => c.id === id) || {}).value || 0;
  const q = qualityReport(key);
  const insights = [
    `Registration coverage is ${d.cards.find(c => c.id === 'coverage_pct').value}% (${get('units_with_users')} of ${get('active_units')} units with users).`,
    `HCP observed ${get('hcp_unique')} unique vehicles (${get('hcp_events')} events); automatic openings ${get('hcp_auto_open')} by ${get('hcp_auto_unique')} vehicles.`,
    `Invitations: ${get('invitations')} requests; gate passes: ${get('gatepass')} (visitor proxy — no HCP visitor file provided).`,
    `Face recognition: unavailable — no HCP person-authentication file in this upload.`,
  ];
  for (const w of d.warnings) insights.push(w);
  for (const f of q.fileIssues.filter(f => f.severity !== 'info')) insights.push(`[${f.severity.toUpperCase()}] ${f.message}`);
  res.json({ period: d.period, insights });
});

/* ------------------------------------------------------------------ *
 * AI
 * ------------------------------------------------------------------ */
app.post('/api/ai/ask', rateLimit('ai', 30, 60 * 1000), async (req, res) => {
  const { question, periodKey, context } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const scopeIds = rc.id != null ? [rc.id] : (req.actor.scope.all ? null : req.actor.scope.ids);
  try {
    const r = await ask(question, {
      periodKey: periodKey || latestKey(),
      context: { ...(context || {}), compound: rc.name || 'all' },
      scopeIds,
    });
    auditEvent({ action: 'ai.ask', targetType: 'ai', targetId: null, result: 'OK', detail: String(question).slice(0, 200) });
    res.json(r);
  } catch (e) { res.status(500).json({ error: String(e.message || e), code: 'INTERNAL', correlationId: req.correlationId }); }
});

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */
function toWorkbook(entity, rows) { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), entity); return wb; }
app.get('/api/export', rateLimit('export', 30, 60 * 1000), (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const { entity, scope } = req.query;
  // Hard cap keeps a single XLSX build inside safe memory limits (a 200k-row
  // workbook previously killed the process). Callers should filter or page.
  const limit = scope === 'all' ? 10000 : 5000;
  const pid = (periodIdOf(req.query.period || latestKey()) || {}).id;
  const ctx = { scope: req.actor.scope, compoundId: rc.id };
  const q = { ...req.query };
  delete q.entity; delete q.scope; delete q.page; delete q.limit;
  let rows = [];
  try {
    if (entity === 'users') { const { w, params } = fUsers(q, ctx); rows = db.prepare(`SELECT u.id, u.name, u.mobile, u.email, u.status, u.registered_as, u.national_id, u.created_on FROM users u ${w} LIMIT ?`).all(...params, limit); }
    else if (entity === 'units') { const { w, params } = fUnits(q, ctx); rows = db.prepare(`SELECT u.id, u.unit_number, c.name compound, u.related_unit, u.gate_suspension FROM units u LEFT JOIN compounds c ON c.id=u.compound_id ${w} LIMIT ?`).all(...params, limit); }
    else if (entity === 'vehicles') { const { w, params } = fVehicles(q, ctx); rows = db.prepare(`SELECT v.id, v.plate_original, v.make, v.model, v.year, v.status, u.name owner FROM vehicles v LEFT JOIN users u ON u.id=v.user_id ${w} LIMIT ?`).all(...params, limit); }
    else if (entity === 'invitations' && pid) { const { w, params } = fInv(q, pid, ctx); rows = db.prepare(`SELECT id, code, provider, invite_to, member_name, member_mobile, type, status, created_on FROM invitations ${w} LIMIT ?`).all(...params, limit); }
    else if (entity === 'gatepasses' && pid) { const { w, params } = fGatepass(q, pid, ctx); rows = db.prepare(`SELECT g.id, g.user_name_raw, g.unit_ref_raw, c.name compound, g.access_type, g.entry_date, g.valid_until FROM gate_passes g LEFT JOIN compounds c ON c.id=g.compound_id ${w} LIMIT ?`).all(...params, limit); }
    else if (entity === 'access' && pid) { const { w, params } = fAccess(q, pid, ctx); rows = db.prepare(`SELECT h.id, h.plate_original, h.direction, h.enter_time, h.exit_time, h.gate, h.method, h.result, h.reason, h.vehicle_list, h.owner_raw, h.vehicle_type, h.color, h.brand FROM hcp_vehicle_events h ${w} LIMIT ?`).all(...params, limit); }
    else return res.status(400).json({ error: 'Unknown entity', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  } catch (e) { return res.status(500).json({ error: e.message, code: 'INTERNAL', correlationId: req.correlationId }); }

  const canUnmask = req.actor.permissions.has(P.PII_EXPORT) && req.actor.permissions.has(P.PII_UNMASK);
  if (!canUnmask) rows = maskRows(rows);
  const wb = toWorkbook(entity, rows);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  auditEvent({
    action: 'export.data', targetType: entity, targetId: req.query.period || latestKey(), result: 'OK',
    detail: `${rows.length} rows; limit=${limit}; scope=${rc.name || (req.actor.scope.all ? 'all' : req.actor.scope.ids.join(','))}; unmasked=${canUnmask}`,
  });
  if (rows.length === limit) res.setHeader('X-Export-Truncated', 'true');
  res.setHeader('X-Export-Row-Count', String(rows.length));
  res.setHeader('Content-Disposition', `attachment; filename="${entity}-${req.query.period || latestKey()}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});
app.get('/api/report.xlsx', (req, res) => {
  const rc = compoundCtx(req);
  if (!rc.ok) return rejectCompound(req, res, rc);
  const key = req.query.period || latestKey();
  const compound = rc.name || 'all';
  const ids = rc.id != null ? [rc.id] : (req.actor.scope.all ? null : req.actor.scope.ids);
  const d = computeDashboard(key, compound, dashScopeIds(req, rc));
  const cmp = compareCompounds(key, ids);
  const q = qualityReport(key);
  const wb = XLSX.utils.book_new();
  const add = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  add('Executive Summary', [['Palm Hills Developments — Community Operations Monthly Report'], ['Reporting Period', d.period ? d.period.name : key], ['Scope', compound], [], ['KPI', 'Value'], ...d.cards.map(c => [c.label, c.value + (c.suffix || '') + (c.sub ? ` (${c.sub})` : '')])]);
  add('Compound Comparison', [['Compound', 'Active Units', 'Units w/ Users', 'Coverage %', 'Active Users', 'Unique Vehicles', 'Auto Openings', 'Gate Passes'], ...cmp.rows.map(r => [r.compound, r.activeUnits, r.unitsWithUsers, r.coverage, r.activeUsers, r.hcpUnique, r.hcpAuto, r.gatepasses])]);
  add('Users by Type', [['Type', 'Count'], ...d.charts.usersByType.map(b => [b.label, b.value])]);
  add('Invitations by Status', [['Status', 'Count'], ...d.charts.invByStatus.map(b => [b.label, b.value])]);
  add('Gate Passes by Type', [['Type', 'Count'], ...d.charts.gpByType.map(b => [b.label, b.value])]);
  add('Access by Day', [['Date', 'Events'], ...d.charts.accessByDay.map(b => [b.label, b.value])]);
  add('Data Quality', [['Severity', 'Area', 'Message', 'Count'], ...q.fileIssues.map(f => [f.severity, f.area, f.message, '']), ...q.records.map(r => [r.severity, r.area, r.message, r.count])]);
  add('KPI Definitions', [['KPI', 'Definition', 'Formula', 'Sources'], ...DEFINITIONS.map(x => [x.name, x.definition, x.formula, x.sources.join(', ')])]);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  auditEvent({ action: 'report.executive', targetType: 'period', targetId: key, result: 'OK', detail: `scope=${compound}` });
  res.setHeader('Content-Disposition', `attachment; filename="PH-Community-Report-${key}-${compound}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

/* ------------------------------------------------------------------ *
 * Uploads / imports
 * ------------------------------------------------------------------ */
app.post('/api/uploads', rateLimit('upload', 10, 10 * 60 * 1000), (req, res) => {
  upload.single('zip')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR', correlationId: req.correlationId });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
    try {
      const staged = stageUpload({ filePath: req.file.path, originalName: req.file.originalname, uploadedBy: req.actor.email });
      auditEvent({ action: 'import.upload', targetType: 'import', targetId: staged.importId, result: 'OK', detail: req.file.originalname });
      res.json({ importId: staged.importId, files: staged.files.map(f => ({ filename: f.originalName, dataset: f.dataset, label: f.label, confidence: f.confidence, status: f.status, rows: f.rowCount, truncated: f.truncated, candidates: f.candidates })), detected: staged.detected });
    } catch (e) { res.status(500).json({ error: e.message, code: 'INTERNAL', correlationId: req.correlationId }); }
  });
});
app.post('/api/crm-uploads', rateLimit('upload', 10, 10 * 60 * 1000), (req, res) => {
  upload.single('zip')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR', correlationId: req.correlationId });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
    try {
      const staged = stageUpload({ filePath: req.file.path, originalName: req.file.originalname, sourceKind: 'CRM_UPLOAD', uploadedBy: req.actor.email });
      auditEvent({ action: 'import.crm_upload', targetType: 'import', targetId: staged.importId, result: 'OK', detail: req.file.originalname });
      res.json({ importId: staged.importId, files: staged.files.map(f => ({ filename: f.originalName, dataset: f.dataset, label: f.label, confidence: f.confidence, status: f.status, rows: f.rowCount, truncated: f.truncated, candidates: f.candidates })), detected: staged.detected });
    } catch (e) { res.status(400).json({ error: e.message, code: 'VALIDATION_ERROR', correlationId: req.correlationId }); }
  });
});
app.post('/api/hcp-uploads', rateLimit('upload', 10, 10 * 60 * 1000), (req, res) => {
  upload.single('zip')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR', correlationId: req.correlationId });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
    const rawCompoundId = req.body && req.body.compoundId;
    const compoundId = Number(rawCompoundId);
    if (!rawCompoundId || !Number.isInteger(compoundId) || compoundId <= 0) {
      return res.status(400).json({ error: 'A compound must be selected from the existing list.', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
    }
    const compound = db.prepare('SELECT id FROM compounds WHERE id=?').get(compoundId);
    if (!compound) return res.status(404).json({ error: 'Unknown compound. Select an existing compound from the list.', code: 'NOT_FOUND', correlationId: req.correlationId });
    if (!canAccessCompound(req.actor.scope, compoundId)) return res.status(403).json({ error: 'That compound is outside your assigned scope.', code: 'FORBIDDEN', correlationId: req.correlationId });
    try {
      const staged = stageUpload({ filePath: req.file.path, originalName: req.file.originalname, sourceKind: 'HCP_MANUAL_UPLOAD', compoundId, uploadedBy: req.actor.email });
      auditEvent({ action: 'import.hcp_upload', targetType: 'import', targetId: staged.importId, result: 'OK', detail: `${req.file.originalname} compound=${compoundId}` });
      res.json({ importId: staged.importId, files: staged.files.map(f => ({ filename: f.originalName, dataset: f.dataset, label: f.label, confidence: f.confidence, status: f.status, rows: f.rowCount, truncated: f.truncated, candidates: f.candidates })), detected: staged.detected, compoundId });
    } catch (e) { res.status(400).json({ error: e.message, code: 'VALIDATION_ERROR', correlationId: req.correlationId }); }
  });
});
function importVisible(req, imp) {
  if (req.actor.scope.all) return true;
  if (!imp) return false;
  if (imp.source_kind === 'HCP_MANUAL_UPLOAD') return canAccessCompound(req.actor.scope, imp.compound_id);
  return true;
}
app.get('/api/imports', (req, res) => {
  let rows = db.prepare('SELECT * FROM imports ORDER BY id DESC LIMIT 50').all();
  if (req.query.sourceKind) rows = rows.filter(r => r.source_kind === req.query.sourceKind);
  if (!req.actor.scope.all) {
    rows = rows.filter(imp => importVisible(req, imp));
  }
  res.json(rows);
});
app.get('/api/imports/:id/preview', (req, res) => {
  const imp = db.prepare('SELECT * FROM imports WHERE id=?').get(req.params.id);
  if (!imp) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND', correlationId: req.correlationId });
  if (!importVisible(req, imp)) return res.status(403).json({ error: 'This import is outside your assigned scope', code: 'FORBIDDEN', correlationId: req.correlationId });
  const files = db.prepare('SELECT * FROM raw_files WHERE import_id=?').all(imp.id);
  const sources = db.prepare('SELECT * FROM source_files WHERE import_id=?').all(imp.id);
  const compound = imp.compound_id != null ? db.prepare('SELECT id, name FROM compounds WHERE id=?').get(imp.compound_id) : null;
  const validation = files.map(f => ({ filename: f.filename, dataset: f.dataset_type, rows: f.row_count, status: f.status, error: f.error || null }));
  const totals = {
    files: files.length,
    records: files.reduce((s, f) => s + (f.row_count || 0), 0),
    validFiles: files.filter(f => f.status === 'ok').length,
    invalidFiles: files.filter(f => f.status !== 'ok').length,
  };
  res.json({ import: imp, compound, files, sources, validation, totals });
});
app.get('/api/imports/:id', (req, res) => {
  const imp = db.prepare('SELECT * FROM imports WHERE id=?').get(req.params.id);
  if (!imp) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND', correlationId: req.correlationId });
  if (!importVisible(req, imp)) return res.status(403).json({ error: 'This import is outside your assigned scope', code: 'FORBIDDEN', correlationId: req.correlationId });
  const files = db.prepare('SELECT * FROM raw_files WHERE import_id=?').all(imp.id);
  const sources = db.prepare('SELECT * FROM source_files WHERE import_id=?').all(imp.id);
  res.json({ ...imp, progress: imp.progress ? JSON.parse(imp.progress) : null, files, sources });
});
app.get('/api/imports/:id/summary', (req, res) => {
  try { res.json(getImportSummary(req.params.id)); }
  catch (e) { res.status(404).json({ error: e.message, code: 'NOT_FOUND', correlationId: req.correlationId }); }
});
app.get('/api/imports/:id/log', (req, res) =>
  res.json(db.prepare('SELECT * FROM import_log WHERE import_id=? ORDER BY id').all(req.params.id)));
function paged2(table, importId, page, limit, entity) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
  const args = entity && entity !== 'all' ? [importId, entity] : [importId];
  const ef = entity && entity !== 'all' ? (table === 'duplicate_records' ? 'AND dataset_type=?' : 'AND entity_type=?') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE import_id=? ${ef}`).get(...args).c;
  const rows = db.prepare(`SELECT * FROM ${table} WHERE import_id=? ${ef} ORDER BY id LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit);
  return { total, page, limit, rows };
}
app.get('/api/imports/:id/duplicates', (req, res) =>
  res.json(paged2('duplicate_records', req.params.id, req.query.page, req.query.limit, req.query.dataset || 'all')));
app.get('/api/imports/:id/changes', (req, res) =>
  res.json(paged2('changed_records', req.params.id, req.query.page, req.query.limit, req.query.entity || 'all')));
app.post('/api/imports/:id/process', (req, res) => {
  const id = req.params.id;
  const imp = db.prepare('SELECT * FROM imports WHERE id=?').get(id);
  if (!imp) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND', correlationId: req.correlationId });
  if (!importVisible(req, imp)) return res.status(403).json({ error: 'This import is outside your assigned scope', code: 'FORBIDDEN', correlationId: req.correlationId });
  if (imp.source_kind === 'HCP_MANUAL_UPLOAD' && !canAccessCompound(req.actor.scope, imp.compound_id)) return res.status(403).json({ error: 'That compound is outside your assigned scope.', code: 'FORBIDDEN', correlationId: req.correlationId });
  if (['PROCESSING', 'VALIDATING'].includes(imp.status) || isRunning(id)) {
    return res.status(409).json({ error: 'Import is already processing.', code: 'CONFLICT', correlationId: req.correlationId });
  }
  const { periodKey, overrides } = req.body || {};
  const started = startImport(Number(id), periodKey, overrides || {});
  if (!started.started) return res.status(409).json({ error: 'Import is already processing.', code: 'CONFLICT', correlationId: req.correlationId });
  auditEvent({ action: 'import.process_requested', targetType: 'import', targetId: id, result: 'OK', detail: `period=${periodKey || '(detected)'}` });
  res.status(202).json({ ok: true, message: 'Processing started', pid: started.pid });
});
app.post('/api/imports/:id/reprocess', (req, res) => {
  const id = req.params.id;
  const imp = db.prepare('SELECT * FROM imports WHERE id=?').get(id);
  if (!imp) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND', correlationId: req.correlationId });
  if (!importVisible(req, imp)) return res.status(403).json({ error: 'This import is outside your assigned scope', code: 'FORBIDDEN', correlationId: req.correlationId });
  if (imp.status === 'DELETED') return res.status(400).json({ error: 'This import was deleted with its month. Upload the month again instead.', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  if (['PROCESSING', 'VALIDATING'].includes(imp.status) || isRunning(id)) {
    return res.status(409).json({ error: 'Import is already processing.', code: 'CONFLICT', correlationId: req.correlationId });
  }
  const started = startImport(Number(id), imp.reporting_period || imp.detected_period_key, {});
  if (!started.started) return res.status(409).json({ error: 'Import is already processing.', code: 'CONFLICT', correlationId: req.correlationId });
  auditEvent({ action: 'import.reprocess_requested', targetType: 'import', targetId: id, result: 'OK' });
  res.status(202).json({ ok: true, message: 'Reprocessing started (idempotent — fingerprints absorb repeats)', pid: started.pid });
});
app.post('/api/imports/:id/cancel', (req, res) => {
  const imp = db.prepare('SELECT * FROM imports WHERE id=?').get(req.params.id);
  if (!imp) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND', correlationId: req.correlationId });
  if (['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED', 'ROLLED_BACK', 'DELETED'].includes(imp.status)) return res.status(400).json({ error: `Cannot cancel a ${imp.status} import`, code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  db.prepare('UPDATE imports SET status=? WHERE id=?').run('CANCELLED', req.params.id);
  auditEvent({ action: 'import.cancel_requested', targetType: 'import', targetId: req.params.id, result: 'OK' });
  res.json({ ok: true });
});
app.post('/api/imports/:id/rollback', (req, res) => {
  // Permission is enforced by the route map (import.rollback). Confirmation is an extra guard.
  if (!req.body || req.body.confirm !== true) return res.status(400).json({ error: 'Rollback requires { "confirm": true }', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  try {
    const r = rollbackImport(req.params.id, req.actor.email);
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message, code: 'VALIDATION_ERROR', correlationId: req.correlationId }); }
});
app.post('/api/periods/:period/delete', (req, res) => {
  // Permission: period.delete. Typed confirmation plus the period key echoed back.
  if (!req.body || req.body.confirm !== true || req.body.period !== req.params.period) {
    return res.status(400).json({ error: 'Month deletion requires { "confirm": true, "period": "<YYYY-MM>" } matching the URL', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  }
  try {
    res.json(deletePeriodData(req.params.period, req.actor.email));
  } catch (e) { res.status(400).json({ error: e.message, code: 'VALIDATION_ERROR', correlationId: req.correlationId }); }
});
app.post('/api/admin/reset', (req, res) => {
  // Permission: system.reset. Typed phrase guard remains.
  if (!req.body || req.body.confirm !== true || req.body.phrase !== 'RESET ALL DATA') {
    return res.status(400).json({ error: 'Full reset requires { "confirm": true, "phrase": "RESET ALL DATA" }', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  }
  try {
    res.json(resetDatabase(req.actor.email));
  } catch (e) { res.status(400).json({ error: e.message, code: 'VALIDATION_ERROR', correlationId: req.correlationId }); }
});
app.get('/api/snapshots', (req, res) =>
  res.json(db.prepare('SELECT id, period_key, import_id, created_at FROM period_snapshots ORDER BY period_key DESC').all()));
app.get('/api/snapshots/:period', (req, res) => {
  const rows = db.prepare('SELECT * FROM period_snapshots WHERE period_key=? ORDER BY id DESC').all(req.params.period);
  if (!rows.length) return res.status(404).json({ error: 'No snapshot for this period', code: 'NOT_FOUND', correlationId: req.correlationId });
  const r = rows[0];
  const scope = req.actor.scope;
  let metrics = r.metrics ? JSON.parse(r.metrics) : null;
  if (!scope.all && Array.isArray(metrics)) {
    metrics = metrics.filter(m => m.compound_id != null && scope.ids.includes(Number(m.compound_id)));
  }
  res.json({
    ...r,
    master_counts: scope.all && r.master_counts ? JSON.parse(r.master_counts) : null,
    metrics,
    history: rows.length,
  });
});

/* ------------------------------------------------------------------ *
 * Settings / audit
 * ------------------------------------------------------------------ */
const SYSTEM_SETTING_KEYS = new Set(['ai_api_key', 'ai_provider', 'ai_model', 'ai_endpoint', 'processing_version']);

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const o = {};
  for (const r of rows) o[r.key] = r.key === 'ai_api_key' && r.value ? '***set***' : r.value;
  res.json(o);
});
app.put('/api/settings', (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ error: 'No settings supplied', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  if (keys.some(k => SYSTEM_SETTING_KEYS.has(k)) && !req.actor.permissions.has(P.SETTINGS_SYSTEM)) {
    return res.status(403).json({ error: 'System settings require the settings.system permission', code: 'FORBIDDEN', correlationId: req.correlationId });
  }
  const before = {};
  for (const k of keys) {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
    before[k] = row ? (k === 'ai_api_key' && row.value ? '***set***' : row.value) : null;
  }
  for (const [k, v] of Object.entries(body)) {
    if (k === 'ai_api_key' && v === '***set***') continue;
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const after = {};
  for (const k of keys) after[k] = k === 'ai_api_key' ? '***set***' : body[k];
  auditEvent({ action: 'settings.update', targetType: 'settings', targetId: keys.join(','), result: 'OK', before, after });
  res.json({ ok: true });
});
app.get('/api/audit', (req, res) => {
  const scope = req.actor.scope;
  let rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500').all();
  if (!scope.all) {
    const ids = scope.ids.map(String);
    const names = scope.names || [];
    const self = `${req.actor.id}:`;
    rows = rows.filter(r =>
      (r.actor && String(r.actor).startsWith(self)) ||
      (r.target_id && ids.includes(String(r.target_id))) ||
      (r.detail && names.some(n => String(r.detail).includes(n)))
    );
  }
  res.json(rows.slice(0, 200));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

/* Global error handler: never leak a stack trace. */
app.use((err, req, res, next) => {
  console.error('Unhandled request error:', err && err.message);
  if (res.headersSent) return next(err);
  const status = err && err.status ? err.status : 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : String(err.message || err),
    code: status === 500 ? 'INTERNAL' : 'REQUEST_ERROR',
    correlationId: req.correlationId,
  });
});

const PORT = process.env.PORT || 2020;
app.listen(PORT, () => console.log(`Community Intelligence running on http://localhost:${PORT}`));
module.exports = app;
