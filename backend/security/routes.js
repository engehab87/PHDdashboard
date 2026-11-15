'use strict';
/* Authentication and user/role/scope administration routes. */
const express = require('express');
const { db, auditEvent } = require('../db');
const { ROLES, isValidRole, permissionsForRole } = require('./catalog');
const { hashPassword, verifyPassword, newToken, sha256 } = require('./passwords');
const { loadScope } = require('./scope');
const {
  SESSION_COOKIE, CSRF_COOKIE, ABSOLUTE_MS,
  clientIp, rateLimit, clearRateLimit, deny,
} = require('./middleware');

const router = express.Router();
const isProd = process.env.NODE_ENV === 'production';
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

function cookieOptions(maxAge) {
  return { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/', maxAge };
}

function normalizeEmail(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

function publicActor(actor) {
  const compounds = actor.scope.all
    ? db.prepare('SELECT id, name FROM compounds ORDER BY name').all()
    : actor.scope.ids.map((id) => {
        const r = db.prepare('SELECT id, name FROM compounds WHERE id=?').get(id);
        return r || { id, name: String(id) };
      });
  return {
    id: actor.id,
    email: actor.email,
    displayName: actor.displayName,
    role: actor.role,
    permissions: Array.from(actor.permissions).sort(),
    scope: { all: !!actor.scope.all, compounds },
    csrfToken: actor.csrfToken,
  };
}

function issueSession(user, req, res) {
  const raw = newToken(32);
  const tokenHash = sha256(raw);
  const csrf = newToken(24);
  const id = require('crypto').randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + ABSOLUTE_MS);
  db.prepare(`INSERT INTO user_sessions(id,user_id,token_hash,csrf_token,created_at,expires_at,last_seen_at,ip,user_agent)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
    id, user.id, tokenHash, csrf, now.toISOString(), expires.toISOString(), now.toISOString(),
    clientIp(req), String(req.headers['user-agent'] || '').slice(0, 500)
  );
  res.cookie(SESSION_COOKIE, raw, cookieOptions(ABSOLUTE_MS));
  // Readable by the SPA so it can send the header; the value is validated against the session row.
  res.cookie(CSRF_COOKIE, csrf, { httpOnly: false, sameSite: 'lax', secure: isProd, path: '/', maxAge: ABSOLUTE_MS });
  return { id, csrf };
}

/* ------------------------------------------------------------------ */
const loginKey = req => (clientIp(req) || 'unknown') + ':' + normalizeEmail(req.body && req.body.email);

router.post('/login', rateLimit('login', 5, 15 * 60 * 1000, loginKey), (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required', code: 'VALIDATION_ERROR', correlationId: req.correlationId });

  const user = db.prepare('SELECT * FROM dashboard_users WHERE email = ?').get(email);
  if (!user) {
    auditEvent({ action: 'auth.login', result: 'DENIED', detail: 'unknown email', targetType: 'user', targetId: email, ip: clientIp(req) });
    return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS', correlationId: req.correlationId });
  }
  if (user.status !== 'active') {
    auditEvent({ action: 'auth.login', result: 'DENIED', detail: 'account disabled', targetType: 'user', targetId: user.id, ip: clientIp(req) });
    return res.status(403).json({ error: 'Account is disabled', code: 'ACCOUNT_DISABLED', correlationId: req.correlationId });
  }
  if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
    auditEvent({ action: 'auth.login', result: 'DENIED', detail: 'account locked', targetType: 'user', targetId: user.id, ip: clientIp(req) });
    return res.status(429).json({ error: 'Account temporarily locked. Try again later.', code: 'ACCOUNT_LOCKED', correlationId: req.correlationId });
  }
  if (!verifyPassword(password, user.password_salt, user.password_hash)) {
    const failed = Number(user.failed_attempts || 0) + 1;
    const locked = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    db.prepare('UPDATE dashboard_users SET failed_attempts=?, locked_until=?, updated_at=datetime(\'now\') WHERE id=?').run(failed, locked, user.id);
    auditEvent({ action: 'auth.login', result: 'DENIED', detail: 'bad password', targetType: 'user', targetId: user.id, ip: clientIp(req) });
    return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS', correlationId: req.correlationId });
  }
  if (!isValidRole(user.role)) {
    return res.status(403).json({ error: 'Account role is not configured', code: 'ROLE_INVALID', correlationId: req.correlationId });
  }

  db.prepare('UPDATE dashboard_users SET failed_attempts=0, locked_until=NULL, last_login_at=datetime(\'now\'), updated_at=datetime(\'now\') WHERE id=?').run(user.id);
  const session = issueSession(user, req, res);
  clearRateLimit('login', req, loginKey(req));

  const permissions = permissionsForRole(user.role);
  const scope = loadScope(user.id, permissions);
  const actor = {
    id: user.id, email: user.email, displayName: user.display_name, role: user.role,
    permissions, scope, csrfToken: session.csrf,
  };
  auditEvent({ action: 'auth.login', result: 'OK', targetType: 'user', targetId: user.id, detail: `role=${user.role}` });
  res.json({ user: publicActor(actor), csrfToken: session.csrf });
});

router.post('/logout', (req, res) => {
  if (req.actor && req.actor.sessionId) {
    db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ?").run(req.actor.sessionId);
  }
  auditEvent({ action: 'auth.logout', result: 'OK', targetType: 'session', targetId: req.actor && req.actor.sessionId });
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.actor) return deny(req, res, 401, 'UNAUTHENTICATED', 'Authentication required');
  res.json({ user: publicActor(req.actor), csrfToken: req.actor.csrfToken });
});

/* ---- user administration ---- */
router.get('/users', (req, res) => {
  const rows = db.prepare('SELECT id, email, display_name, role, status, last_login_at, created_at FROM dashboard_users ORDER BY email').all();
  const scopes = db.prepare('SELECT s.user_id, c.id, c.name FROM user_compound_scopes s JOIN compounds c ON c.id=s.compound_id ORDER BY c.name').all();
  const byUser = new Map();
  for (const s of scopes) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id).push({ id: s.id, name: s.name });
  }
  res.json({ rows: rows.map(u => ({ ...u, compounds: byUser.get(u.id) || [] })), roles: ROLES });
});

router.post('/users', (req, res) => {
  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const role = body.role;
  const password = String(body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  if (!isValidRole(role)) return res.status(400).json({ error: 'Unknown role', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  if (db.prepare('SELECT 1 FROM dashboard_users WHERE email=?').get(email)) {
    return res.status(409).json({ error: 'A user with this email already exists', code: 'CONFLICT', correlationId: req.correlationId });
  }
  const { hash, salt } = hashPassword(password);
  const info = db.prepare(`INSERT INTO dashboard_users(email,display_name,role,status,password_hash,password_salt)
    VALUES(?,?,?,'active',?,?)`).run(email, String(body.displayName || email), role, hash, salt);
  const id = Number(info.lastInsertRowid);
  const scopes = Array.isArray(body.compoundIds) ? body.compoundIds.map(Number).filter(Number.isFinite) : [];
  if (!permissionsForRole(role).has('scope.all')) {
    for (const cid of scopes) {
      if (db.prepare('SELECT 1 FROM compounds WHERE id=?').get(cid)) {
        db.prepare('INSERT OR IGNORE INTO user_compound_scopes(user_id,compound_id) VALUES(?,?)').run(id, cid);
      }
    }
  }
  auditEvent({ action: 'user.create', result: 'OK', targetType: 'user', targetId: id, detail: `email=${email} role=${role} scopes=${scopes.join(',')}` });
  res.status(201).json({ ok: true, id });
});

router.put('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM dashboard_users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND', correlationId: req.correlationId });
  const body = req.body || {};
  const before = { displayName: user.display_name, role: user.role, status: user.status };
  const next = {
    displayName: body.displayName == null ? user.display_name : String(body.displayName),
    role: body.role == null ? user.role : body.role,
    status: body.status == null ? user.status : body.status,
  };
  if (!isValidRole(next.role)) return res.status(400).json({ error: 'Unknown role', code: 'VALIDATION_ERROR', correlationId: req.correlationId });
  if (!['active', 'disabled'].includes(next.status)) return res.status(400).json({ error: 'status must be active or disabled', code: 'VALIDATION_ERROR', correlationId: req.correlationId });

  // Never leave the system without an active Super Admin.
  if (user.role === 'Super Admin' && (next.role !== 'Super Admin' || next.status !== 'active')) {
    const others = db.prepare("SELECT COUNT(*) c FROM dashboard_users WHERE role='Super Admin' AND status='active' AND id<>?").get(id).c;
    if (!others) return res.status(409).json({ error: 'At least one active Super Admin must remain', code: 'CONFLICT', correlationId: req.correlationId });
  }

  db.prepare("UPDATE dashboard_users SET display_name=?, role=?, status=?, updated_at=datetime('now') WHERE id=?")
    .run(next.displayName, next.role, next.status, id);
  if (next.status === 'disabled') {
    db.prepare("UPDATE user_sessions SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL").run(id);
  }
  auditEvent({ action: 'user.update', result: 'OK', targetType: 'user', targetId: id, before, after: next });
  res.json({ ok: true });
});

router.put('/users/:id/scopes', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM dashboard_users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND', correlationId: req.correlationId });
  const compoundIds = Array.isArray(req.body && req.body.compoundIds) ? req.body.compoundIds.map(Number).filter(Number.isFinite) : [];
  const before = db.prepare('SELECT compound_id FROM user_compound_scopes WHERE user_id=?').all(id).map(r => r.compound_id);
  db.prepare('DELETE FROM user_compound_scopes WHERE user_id=?').run(id);
  for (const cid of compoundIds) {
    if (db.prepare('SELECT 1 FROM compounds WHERE id=?').get(cid)) {
      db.prepare('INSERT OR IGNORE INTO user_compound_scopes(user_id,compound_id) VALUES(?,?)').run(id, cid);
    }
  }
  auditEvent({ action: 'user.scopes.update', result: 'OK', targetType: 'user', targetId: id, before: { compoundIds: before }, after: { compoundIds } });
  res.json({ ok: true, compoundIds });
});

router.post('/users/:id/revoke-sessions', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT id FROM dashboard_users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND', correlationId: req.correlationId });
  const info = db.prepare("UPDATE user_sessions SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL").run(id);
  auditEvent({ action: 'user.sessions.revoke', result: 'OK', targetType: 'user', targetId: id, detail: `${info.changes} session(s)` });
  res.json({ ok: true, revoked: Number(info.changes || 0) });
});

module.exports = router;
