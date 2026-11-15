'use strict';
/* Normalization helpers. Raw values are always preserved alongside normalized ones. */

const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
// Arabic-Indic + Eastern variants sometimes appear (ی, ھ, ٤ etc.)
function asciiDigits(s) {
  return String(s == null ? '' : s).replace(/[٠-٩]/g, d => AR_DIGITS[d]);
}

// Arabic letter -> latin transliteration for Egyptian plates
const AR_LETTER_LATIN = {
  'ا': 'a', 'أ': 'a', 'إ': 'a', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'g',
  'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
  'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ة': 'h', 'و': 'w', 'ى': 'a',
  'ي': 'y', 'ی': 'y', 'ھ': 'h', 'ؤ': 'o', 'ئ': 'e', 'ء': '',
};

function normalizePlate(raw) {
  if (raw == null) return { norm: null, latin: null };
  let s = asciiDigits(String(raw)).trim();
  if (!s || /^unknown$/i.test(s)) return { norm: null, latin: null };
  const lettersAr = [];
  const latin = [];
  for (const ch of s) {
    if (/[0-9]/.test(ch)) { latin.push(ch); continue; }
    if (AR_LETTER_LATIN[ch] !== undefined) { lettersAr.push(ch === 'ی' ? 'ي' : ch === 'ھ' ? 'ه' : ch); latin.push(AR_LETTER_LATIN[ch]); continue; }
    if (/[a-zA-Z]/.test(ch)) { latin.push(ch.toLowerCase()); continue; }
    // ignore spaces, dashes, dots, slashes
  }
  const digits = (s.match(/[0-9]/g) || []).join('');
  const norm = lettersAr.join('') + digits;
  const lat = latin.join('');
  if (!norm && !lat) return { norm: null, latin: null };
  return { norm: norm || null, latin: lat || null };
}

function normalizeName(name) {
  if (name == null) return null;
  const s = String(name).replace(/\s+/g, ' ').trim().toLowerCase();
  return s || null;
}

function normalizePhone(raw) {
  if (raw == null) return { display: null, norm: null };
  let s = asciiDigits(String(raw)).replace(/[^0-9+]/g, '');
  if (!s || /^(0+|\+?20?|\+)$/.test(s)) return { display: String(raw).trim() || null, norm: null };
  let d = s.replace(/^\+/, '');
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length > 11) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  if (/^1[0-9]{9}$/.test(d)) d = '20' + d; // Egyptian mobile without country code
  if (!/^[0-9]{6,15}$/.test(d)) return { display: String(raw).trim(), norm: null };
  return { display: String(raw).trim(), norm: '+' + d };
}

function normalizeCompound(name) {
  if (name == null) return null;
  const s = String(name).replace(/\s+/g, ' ').trim();
  return s || null;
}

function normalizeUnitNumber(u) {
  if (u == null) return null;
  const s = String(u).replace(/\s+/g, '').trim().toUpperCase();
  return s || null;
}

// Excel serial (Dynamics exports) -> 'YYYY-MM-DD HH:mm' (Africa/Cairo wall time kept as-is)
function excelSerialToISO(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    let m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4] || '00'}:${m[5] || '00'}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')} 00:00`;
    const t = Date.parse(s);
    if (!isNaN(t)) { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  }
  return null;
}

function displayDate(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ' ' + m[4] + ':' + m[5] : ''}`;
}

function periodKeyFromISO(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

module.exports = { normalizePlate, normalizeName, normalizePhone, normalizeCompound, normalizeUnitNumber, excelSerialToISO, displayDate, periodKeyFromISO };
