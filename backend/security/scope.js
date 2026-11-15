'use strict';
/* Compound scope resolution and SQL helpers. Scope is always derived from the
   authenticated actor, never from a request parameter alone. */
const { db } = require('../db');

function loadScope(userId, permissions) {
  if (permissions.has('scope.all')) {
    return { all: true, ids: [], names: [] };
  }
  const rows = db.prepare(
    `SELECT c.id, c.name FROM user_compound_scopes s
     JOIN compounds c ON c.id = s.compound_id
     WHERE s.user_id = ? ORDER BY c.name`
  ).all(userId);
  return { all: false, ids: rows.map(r => r.id), names: rows.map(r => r.name) };
}

function compoundIdOfName(name) {
  if (!name || name === 'all') return null;
  const exact = db.prepare('SELECT id FROM compounds WHERE name = ?').get(name);
  if (exact) return exact.id;
  const alias = db.prepare('SELECT compound_id AS id FROM compound_aliases WHERE alias = ?').get(name);
  return alias ? alias.id : null;
}

/**
 * Validate a requested compound against the actor's scope.
 * @returns {{ ok: true, id: number|null, name: string|null } | { ok: false, status: number, error: string }}
 */
function resolveRequestedCompound(scope, requested) {
  if (!requested || requested === 'all') return { ok: true, id: null, name: null };
  const id = compoundIdOfName(requested);
  if (id == null) return { ok: false, status: 404, error: 'Unknown compound' };
  if (!scope.all && !scope.ids.includes(id)) {
    return { ok: false, status: 403, error: 'Requested compound is outside your assigned scope' };
  }
  return { ok: true, id, name: requested };
}

/** Build " AND <column> IN (?,?)" for restricted actors; empty for unrestricted. */
function inClause(column, scope) {
  if (scope.all) return { sql: '', params: [] };
  if (!scope.ids.length) return { sql: ' AND 1=0', params: [] };
  return { sql: ` AND ${column} IN (${scope.ids.map(() => '?').join(',')})`, params: [...scope.ids] };
}

/** Build " AND EXISTS (... user_units ... compound_id IN ...)" for user-linked tables. */
function userScopeClause(scope, userColumn) {
  if (scope.all) return { sql: '', params: [] };
  if (!scope.ids.length) return { sql: ' AND 1=0', params: [] };
  const ph = scope.ids.map(() => '?').join(',');
  return {
    sql: ` AND EXISTS (SELECT 1 FROM user_units su WHERE su.user_id = ${userColumn} AND su.compound_id IN (${ph}))`,
    params: [...scope.ids],
  };
}

/** True when the actor may access a specific compound id. */
function canAccessCompound(scope, compoundId) {
  if (scope.all) return true;
  if (compoundId == null) return false;
  return scope.ids.includes(Number(compoundId));
}

/** True when the actor may access a resident, based on their unit links. */
function canAccessUser(scope, userId) {
  if (scope.all) return true;
  if (!scope.ids.length) return false;
  const ph = scope.ids.map(() => '?').join(',');
  const row = db.prepare(`SELECT 1 AS ok FROM user_units WHERE user_id = ? AND compound_id IN (${ph}) LIMIT 1`).get(userId, ...scope.ids);
  return !!row;
}

module.exports = {
  loadScope, compoundIdOfName, resolveRequestedCompound,
  inClause, userScopeClause, canAccessCompound, canAccessUser,
};
