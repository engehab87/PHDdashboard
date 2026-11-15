'use strict';
/* Central PII masking. Applied once at the API boundary and to exports.
   Tier 1: mobile, email, national id. Tier 2: vehicle plates, raw owner text.
   Names are retained for operational roles inside their compound scope (Tier 3);
   Top Management has no resident-level access at all, so it never receives them. */

const BULLET = '\u2022';

const TIER1_KEYS = new Set([
  'mobile', 'norm_mobile', 'owner_mobile', 'member_mobile', 'phone',
  'email', 'owner_email',
  'national_id', 'owner_national_id', 'nationalid', 'nin',
]);

const TIER2_KEYS = new Set([
  'plate', 'plate_original', 'plate_normalized', 'plate_normalized_latin',
  'plate_norm', 'plate_norm_latin', 'owner_raw',
]);

const PLATE_LIKE = /[0-9]/;

function maskMobile(value) {
  const s = String(value == null ? '' : value).replace(/\s+/g, '');
  if (!s) return value;
  if (s.length <= 4) return BULLET.repeat(4);
  return BULLET.repeat(Math.min(6, Math.max(3, s.length - 4))) + s.slice(-4);
}

function maskEmail(value) {
  const s = String(value == null ? '' : value);
  const at = s.indexOf('@');
  if (at <= 0) return BULLET.repeat(6);
  const local = s.slice(0, at);
  const domain = s.slice(at);
  const keep = local.slice(0, 1);
  return keep + BULLET.repeat(3) + domain;
}

function maskNationalId(value) {
  const s = String(value == null ? '' : value);
  if (!s) return value;
  return BULLET.repeat(Math.min(14, Math.max(8, s.length)));
}

function maskPlate(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return value;
  if (s.length <= 4) return BULLET.repeat(4);
  return s.slice(0, 2) + BULLET.repeat(3) + s.slice(-2);
}

function maskOwner(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return value;
  if (PLATE_LIKE.test(s) && s.length <= 14) return maskPlate(s);
  const first = s.split(/\s+/)[0] || '';
  return first ? first + ' ' + BULLET.repeat(3) : BULLET.repeat(4);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v);
}

/**
 * Return a masked deep copy. Never mutates the input.
 * @param {*} value
 * @param {number} depth guard
 */
function maskValue(value, depth = 0) {
  if (depth > 12 || value == null) return value;
  if (Array.isArray(value)) return value.map(v => maskValue(v, depth + 1));
  if (!isPlainObject(value)) return value;

  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw == null) { out[key] = raw; continue; }
    if (typeof raw !== 'string') { out[key] = maskValue(raw, depth + 1); continue; }
    if (raw === '') { out[key] = raw; continue; }
    const k = key.toLowerCase();
    if (TIER1_KEYS.has(k)) {
      if (k.includes('email')) out[key] = maskEmail(raw);
      else if (k.includes('national') || k === 'nin' || k === 'nationalid') out[key] = maskNationalId(raw);
      else out[key] = maskMobile(raw);
    } else if (TIER2_KEYS.has(k)) {
      out[key] = k === 'owner_raw' ? maskOwner(raw) : maskPlate(raw);
    } else {
      out[key] = maskValue(raw, depth + 1);
    }
  }
  return out;
}

/** Mask an array of plain rows (used by exports before workbook creation). */
function maskRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(r => maskValue(r));
}

/** Wrap res.json so every JSON response is masked for actors without pii.unmask. */
function installResponseMasker(req, res) {
  const canUnmask = !!(req.actor && req.actor.permissions && req.actor.permissions.has('pii.unmask'));
  if (canUnmask) return;
  const original = res.json.bind(res);
  res.json = (body) => original(maskValue(body));
}

module.exports = {
  maskMobile, maskEmail, maskNationalId, maskPlate, maskOwner,
  maskValue, maskRows, installResponseMasker,
  TIER1_KEYS, TIER2_KEYS,
};
