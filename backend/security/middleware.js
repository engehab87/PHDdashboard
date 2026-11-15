'use strict';
/* Authentication, authorization, CSRF, rate limiting and security headers. */
const crypto = require('crypto');
const { db, auditEvent, auditContext } = require('../db');
const { matchRoute, permissionsForRole, isValidRole } = require('./catalog');
const { sha256 } = require('./passwords');
const { loadScope } = require('./scope');
const { installResponseMasker } = require('./pii');

const SESSION_COOKIE = 'ph_session';
const CSRF_COOKIE = 'ph_csrf';
const IDLE_MS = 8 * 60 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
}

function correlation(req, res, next) {
  const incoming = req.headers['x-correlation-id'];
  req.correlationId = incoming && /^[A-Za-z0-9._-]{8,128}$/.test(String(incoming))
    ? String(incoming)
    : crypto.randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.tailwindcss.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
  next();
}

function deny(req, res, status, code, message, extra) {
  const action = status === 401 ? 'auth.denied' : 'permission.denied';
  auditEvent({
    action,
    targetType: 'route',
    targetId: req.method + ' ' + (req.originalUrl || req.url),
    result: 'DENIED',
    detail: message,
    ip: clientIp(req),
    correlationId: req.correlationId,
  });
  return res.status(status).json({
    error: message,
    code,
    correlationId: req.correlationId,
    ...(extra || {}),
  });
}

function readToken(req) {
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) {
    return { token: auth.replace(/^Bearer\s+/i, '').trim(), method: 'bearer' };
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE]) return { token: cookies[SESSION_COOKIE], method: 'cookie' };
  return null;
}

function loadActorFromToken(token, method, req) {
  const hash = sha256(token);
  const row = db.prepare(
    `SELECT s.id AS session_id, s.user_id, s.csrf_token, s.created_at AS session_created,
            s.expires_at, s.last_seen_at, s.revoked_at,
            u.email, u.display_name, u.role, u.status, u.locked_until
     FROM user_sessions s JOIN dashboard_users u ON u.id = s.user_id
     WHERE s.token_hash = ? LIMIT 1`
  ).get(hash);
  if (!row) return { error: 'SESSION_NOT_FOUND' };
  if (row.revoked_at) return { error: 'SESSION_REVOKED' };
  if (row.status !== 'active') return { error: 'ACCOUNT_DISABLED' };
  if (!isValidRole(row.role)) return { error: 'ROLE_INVALID' };

  const now = Date.now();
  const expires = Date.parse(row.expires_at);
  const lastSeen = Date.parse(row.last_seen_at);
  if (!Number.isFinite(expires) || expires <= now) return { error: 'SESSION_EXPIRED' };
  if (!Number.isFinite(lastSeen) || now - lastSeen > IDLE_MS) return { error: 'SESSION_IDLE' };
  if (row.locked_until && Date.parse(row.locked_until) > now) return { error: 'ACCOUNT_LOCKED' };

  db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), row.session_id);

  const permissions = permissionsForRole(row.role);
  const scope = loadScope(row.user_id, permissions);
  return {
    actor: {
      id: row.user_id,
      sessionId: row.session_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      permissions,
      scope,
      csrfToken: row.csrf_token,
      authMethod: method,
    },
  };
}

function authenticate(req, res, next) {
  const pathname = (req.originalUrl || req.url).split('?')[0];
  const rule = matchRoute(req.method, pathname);
  const baseCtx = { correlationId: req.correlationId, ip: clientIp(req) };

  if (!rule || rule.public) {
    return auditContext.run(baseCtx, () => next());
  }

  const token = readToken(req);
  if (!token) {
    return auditContext.run(baseCtx, () => deny(req, res, 401, 'UNAUTHENTICATED', 'Authentication required'));
  }

  const loaded = loadActorFromToken(token.token, token.method, req);
  if (loaded.error) {
    const message = loaded.error === 'ACCOUNT_DISABLED' ? 'Account is disabled'
      : loaded.error === 'ACCOUNT_LOCKED' ? 'Account is locked'
      : 'Session is invalid or expired';
    return auditContext.run(baseCtx, () => deny(req, res, 401, loaded.error, message));
  }

  req.actor = loaded.actor;
  installResponseMasker(req, res);

  const ctx = {
    ...baseCtx,
    actor: `${loaded.actor.id}:${loaded.actor.email}`,
    actorRole: loaded.actor.role,
  };

  return auditContext.run(ctx, () => {
    // CSRF applies to cookie-authenticated state-changing requests.
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (unsafe && loaded.actor.authMethod === 'cookie') {
      const header = req.headers['x-csrf-token'];
      if (!header || header !== loaded.actor.csrfToken) {
        return deny(req, res, 403, 'CSRF_FAILED', 'Missing or invalid CSRF token');
      }
    }
    next();
  });
}

function authorizeRoute(req, res, next) {
  const pathname = (req.originalUrl || req.url).split('?')[0];
  const rule = matchRoute(req.method, pathname);
  if (!rule) return deny(req, res, 403, 'NO_ROUTE_POLICY', 'No authorization policy for this route');
  if (rule.public) return next();
  if (!req.actor) return deny(req, res, 401, 'UNAUTHENTICATED', 'Authentication required');
  if (rule.authOnly) return next();
  if (!req.actor.permissions.has(rule.permission)) {
    return deny(req, res, 403, 'FORBIDDEN', `Missing permission: ${rule.permission}`, { requiredPermission: rule.permission });
  }
  next();
}

/* ---- rate limiting (in-process; replace with a shared store in production) ---- */
const buckets = new Map();

function rateLimit(name, max, windowMs, keyFn) {
  return function (req, res, next) {
    const key = name + ':' + (keyFn ? keyFn(req) : (clientIp(req) || 'unknown'));
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset <= now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.count += 1;
    if (b.count > max) {
      const retry = Math.ceil((b.reset - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      auditEvent({ action: 'rate_limit.blocked', targetType: 'route', targetId: req.method + ' ' + req.path, result: 'DENIED', detail: key, ip: clientIp(req) });
      return res.status(429).json({ error: 'Too many requests. Try again later.', code: 'RATE_LIMITED', retryAfterSeconds: retry, correlationId: req.correlationId });
    }
    next();
  };
}

function clearRateLimit(name, req, suffix) {
  const key = name + ':' + (suffix || clientIp(req) || 'unknown');
  buckets.delete(key);
}

module.exports = {
  SESSION_COOKIE, CSRF_COOKIE, IDLE_MS, ABSOLUTE_MS,
  parseCookies, clientIp, correlation,
  authenticate, authorizeRoute, deny, rateLimit, clearRateLimit,
};
