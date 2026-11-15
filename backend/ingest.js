'use strict';
/* Phase 2 ingestion pipeline: ZIP upload -> validate -> fingerprint -> stage ->
   validate -> deduplicate -> normalize -> merge -> snapshot.
   - Master data (users/units/vehicles/user_units): UPSERT + history + changed_records.
   - Events (invitations/gate_passes/hcp/handover): immutable, deterministic
     fingerprints in event_fingerprints; re-uploads are skipped, never double-counted.
   - Cumulative exports supported: only genuinely new records are inserted.
   - Reprocessing the same import is idempotent; rollback reverses one import. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');
const { db, audit } = require('./db');
const { DATASETS, classifyFile } = require('./datasets');
const N = require('./normalize');

const SOURCE_KINDS = ['CRM_UPLOAD', 'HCP_MANUAL_UPLOAD', 'HCP_API_SYNC'];
const CRM_DATASETS = new Set(['ALL_USERS', 'ACTIVE_UNITS', 'UNIT_ACCESS', 'ACTIVE_GATE_PASSES', 'INVITATION_REQUESTS', 'VEHICLES']);
const HCP_DATASETS = new Set(['HCP_VEHICLE_ACCESS', 'HCP_REGISTERED_VEHICLES']);
const HCP_RECOGNIZED = new Set(['HCP_VEHICLE_ACCESS', 'HCP_REGISTERED_VEHICLES', 'HCP_PERSON_AUTH', 'HCP_VISITOR_AUTH', 'HCP_PERSON_INFORMATION']);
function workflowForDataset(dataset) {
  if (CRM_DATASETS.has(dataset)) return 'CRM';
  if (HCP_RECOGNIZED.has(dataset)) return 'HCP';
  if (dataset === 'HANDOVER') return 'OPS';
  return null;
}
const RAW_DIR = path.join(__dirname, '..', 'data', 'raw');
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
const EXPORT_LIMITS = [100000]; // known system/export caps that imply truncation
const PROCESSING_VERSION = '2.0.0';
const SINGLE_FILE_EXTS = ['.xlsx', '.xls', '.csv'];
const TERMINAL_STATUSES = ['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED', 'ROLLED_BACK'];

function listSheets(wb) {
  return wb.SheetNames.map(n => {
    const ws = wb.Sheets[n];
    let header = [];
    try {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false, range: 0 });
      for (const r of rows.slice(0, 15)) {
        const cells = (r || []).map(c => (c === null || c === undefined ? '' : String(c).trim()));
        if (cells.filter(c => c !== '').length >= 3) { header = cells; break; }
      }
      if (!header.length && rows.length) header = (rows[0] || []).map(c => String(c == null ? '' : c).trim());
    } catch (e) { /* ignore */ }
    return { name: n, header };
  });
}

function readSheetRows(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { header: [], data: [] };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
  if (!rows.length) return { header: [], data: [] };
  let hi = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(c => (c === null || c === undefined ? '' : String(c).trim()));
    if (cells.filter(c => c !== '').length >= 3) { hi = i; break; }
  }
  const header = (rows[hi] || []).map(c => (c === null || c === undefined ? '' : String(c).trim()));
  return { header, data: rows.slice(hi + 1) };
}

function headerIndex(header) {
  const idx = {};
  header.forEach((h, i) => { if (!(h in idx)) idx[h] = i; });
  return idx;
}
function cell(row, idx, name) {
  const i = idx[name];
  if (i == null || i >= row.length) return null;
  const v = row[i];
  return v === undefined ? null : v;
}
function str(v) { return v == null ? null : String(v).trim() || null; }

const stmtCache = {};
function ps(sql) { return stmtCache[sql] || (stmtCache[sql] = db.prepare(sql)); }
function withTx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}
function multiInsert(table, cols, rows, orReplace) {
  if (!rows.length) return;
  const CH = 500;
  for (let i = 0; i < rows.length; i += CH) {
    const slice = rows.slice(i, i + CH);
    const ph = slice.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    const flat = [];
    for (const r of slice) for (const v of r) flat.push(v === undefined ? null : v);
    db.prepare(`INSERT ${orReplace ? 'OR REPLACE' : ''} INTO ${table}(${cols.join(',')}) VALUES ${ph}`.replace('  ', ' ')).run(...flat);
  }
}

// ---------- hashing / fingerprints ----------
function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}
function sha256Str(s) { return crypto.createHash('sha256').update(String(s == null ? '' : s), 'utf8').digest('hex'); }

/* Genuine vehicle-owner resolution: link ONLY on exactly one real CRM user
   (external_id NOT NULL) with the normalized name. Zero hits -> honest stub
   placeholder (no details, never wrong). Multiple hits -> NULL (never guess),
   flagged in identity_maps for manual review.
   Compound-prefixed variant (HCP registered vehicles): first prefer users with
   a unit row in the target compound — for compound-scoped uploads the compound
   is the relationship, and the upload is only accepted for that compound. */
function resolveVehicleOwner(userName, periodKey, M, importId, stats, preferredCompoundId) {
  const n = N.normalizeName(userName);
  if (!n) return null;
  if (preferredCompoundId != null) {
    const inCompound = ps('SELECT id FROM users WHERE norm_name=? AND EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id=users.id AND uu.compound_id=?)').all(n, preferredCompoundId);
    if (inCompound.length === 1) return inCompound[0].id;
    if (inCompound.length > 1) {
      stats.ambiguousOwners = (stats.ambiguousOwners || 0) + 1;
      ps(`INSERT OR IGNORE INTO identity_maps(source_kind,source_key,match_method,confidence,status,created_at)
        VALUES('vehicle_owner',?,'NAME_AMBIGUOUS',0,'POSSIBLE_MATCH',datetime('now'))`).run(n);
      return null;
    }
  }
  const hits = ps('SELECT id FROM users WHERE norm_name=? AND external_id IS NOT NULL').all(n);
  if (hits.length === 1) return hits[0].id;
  if (hits.length === 0) return resolveUser(M, String(userName).trim(), periodKey, {});
  stats.ambiguousOwners = (stats.ambiguousOwners || 0) + 1;
  ps(`INSERT OR IGNORE INTO identity_maps(source_kind,source_key,match_method,confidence,status,created_at)
    VALUES('vehicle_owner',?,'NAME_AMBIGUOUS',0,'POSSIBLE_MATCH',datetime('now'))`).run(n);
  return null;
}

/* One-time repair: re-evaluate every vehicle owner link under the genuine rule.
   Wrong/ambiguous links are removed (raw name kept); single-hit links fixed. */
function repairVehicleOwnerLinks(actor = 'admin') {
  const res = { checked: 0, kept: 0, fixed: 0, unlinked: 0, stubbed: 0 };
  const rows = db.prepare('SELECT id, user_name_raw, user_id FROM vehicles').all();
  const setOwner = ps('UPDATE vehicles SET user_id=? WHERE id=?');
  const addHist = ps(`INSERT INTO vehicle_history(vehicle_id,import_id,period_key,change_type,make,model,year,plate_original,user_id,status)
    SELECT id,NULL,NULL,'REPAIRED',make,model,year,plate_original,user_id,status FROM vehicles WHERE id=?`);
  withTx(() => {
    for (const v of rows) {
      const n = N.normalizeName(v.user_name_raw);
      if (!n || !v.user_id) continue;
      res.checked++;
      const hits = db.prepare('SELECT id FROM users WHERE norm_name=? AND external_id IS NOT NULL').all(n);
      if (hits.length === 1 && hits[0].id === v.user_id) { res.kept++; continue; }
      addHist.run(v.id);
      if (hits.length === 1) {
        setOwner.run(hits[0].id, v.id);
        res.fixed++;
      } else {
        setOwner.run(null, v.id);
        if (hits.length > 1) {
          db.prepare(`INSERT OR IGNORE INTO identity_maps(source_kind,source_key,match_method,confidence,status,created_at)
            VALUES('vehicle_owner',?,'NAME_AMBIGUOUS',0,'POSSIBLE_MATCH',datetime('now'))`).run(n);
        }
        res.unlinked++;
      }
    }
  });
  audit('owners.repaired', `Vehicle owner links repaired by ${actor}: ${JSON.stringify(res)}`, actor);
  return res;
}

/* Deterministic HCP vehicle-event fingerprint (spec Level 2 — no row numbers, no UUIDs). */
function hcpEventHash({ normPlate, enterTime, exitTime, gate, direction, method, result, ownerNorm }) {
  return sha256Str(['hcp', enterTime || '', exitTime || '', normPlate || '', gate || '', direction || '', method || '', result || '', ownerNorm || ''].join('|'));
}
function handoverEventHash({ unitCode, category, zone, handoverDate, finishing, resident, planned }) {
  return sha256Str(['handover', unitCode || '', category || '', zone || '', handoverDate || '', finishing || '', resident || '', planned || ''].join('|'));
}
const crmEventHash = (prefix, externalId) => sha256Str([prefix, externalId].join('|'));

// ---------- import log ----------
function ilog(importId, level, phase, message) {
  try { ps('INSERT INTO import_log(import_id,level,phase,message) VALUES(?,?,?,?)').run(importId, level, phase || null, String(message == null ? '' : message).slice(0, 2000)); } catch (e) { /* ignore */ }
}

// ---------- in-memory resolution maps ----------
function loadMaps() {
  const M = {
    compounds: new Map(), usersByExt: new Map(), usersByName: new Map(),
    unitsByExt: new Map(), unitByKey: new Map(), unitByNorm: new Map(),
  };
  for (const r of db.prepare('SELECT id, name FROM compounds').all()) M.compounds.set(r.name, r.id);
  for (const r of db.prepare('SELECT id, external_id, norm_name, is_canonical FROM users ORDER BY COALESCE(is_canonical, 1) DESC, CASE WHEN TRIM(IFNULL(external_id, \'\')) = \'\' THEN 1 ELSE 0 END, id ASC').all()) {
    if (r.external_id) M.usersByExt.set(String(r.external_id), r.id);
    if (r.norm_name && !M.usersByName.has(r.norm_name) && (r.is_canonical == null || r.is_canonical !== 0)) M.usersByName.set(r.norm_name, r.id);
  }
  for (const r of db.prepare('SELECT id, external_id, norm_unit, compound_id FROM units').all()) {
    if (r.external_id) M.unitsByExt.set(String(r.external_id), r.id);
    if (r.norm_unit) {
      if (r.compound_id != null) M.unitByKey.set(r.norm_unit + '|' + r.compound_id, r.id);
      if (!M.unitByNorm.has(r.norm_unit)) M.unitByNorm.set(r.norm_unit, r.id);
    }
  }
  return M;
}

/* Extended maps with full master rows for change detection (UPSERT diff). */
function loadMasterMaps() {
  const M = loadMaps();
  M.usersFull = new Map();
  M.unitsFull = new Map();
  M.uuFull = new Map();
  M.vehFull = new Map();
  for (const r of db.prepare('SELECT * FROM users').all()) if (r.external_id) M.usersFull.set(String(r.external_id), r);
  for (const r of db.prepare('SELECT * FROM units').all()) if (r.external_id) M.unitsFull.set(String(r.external_id), r);
  for (const r of db.prepare('SELECT * FROM user_units').all()) if (r.external_id) M.uuFull.set(String(r.external_id), r);
  for (const r of db.prepare('SELECT * FROM vehicles').all()) if (r.external_id) M.vehFull.set(String(r.external_id), r);
  return M;
}

/* Existing event identities for dedup: fingerprint sets + source-GUID sets. */
function loadEventSets() {
  const S = {
    hcp: new Set(), ho: new Set(), inv: new Map(), gp: new Map(),
  };
  for (const r of db.prepare('SELECT event_hash, first_seen_import_id FROM event_fingerprints').all()) {
    if (r.event_hash) { S.hcp.add(r.event_hash); S.ho.add(r.event_hash); }
  }
  for (const r of db.prepare('SELECT external_id, import_id FROM invitations WHERE external_id IS NOT NULL').all()) S.inv.set(String(r.external_id), r.import_id);
  for (const r of db.prepare('SELECT external_id, import_id FROM gate_passes WHERE external_id IS NOT NULL').all()) S.gp.set(String(r.external_id), r.import_id);
  return S;
}

function ensureCompound(M, name) {
  const norm = N.normalizeCompound(name);
  if (!norm) return null;
  let id = M.compounds.get(norm);
  if (id) return id;
  let row = ps('SELECT id FROM compounds WHERE name=?').get(norm);
  if (!row) {
    const r = ps('INSERT INTO compounds(name) VALUES(?)').run(norm);
    id = Number(r.lastInsertRowid);
  } else id = row.id;
  ps('INSERT OR IGNORE INTO compound_aliases(alias,compound_id) VALUES(?,?)').run(norm, id);
  M.compounds.set(norm, id);
  return id;
}

function createStubUser(M, name, extra, periodKey) {
  const normN = N.normalizeName(name);
  const r = ps(`INSERT INTO users(external_id,name,norm_name,mobile,norm_mobile,email,national_id,marital_status,
    status,registered_as,created_on,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(null, name || null, normN, null, null, null, null, null,
      (extra && extra.status) || null, (extra && extra.regAs) || null, null, periodKey, periodKey);
  const id = Number(r.lastInsertRowid);
  if (normN && !M.usersByName.has(normN)) M.usersByName.set(normN, id);
  return id;
}

function createStubUnit(M, unitRef, compoundId, periodKey) {
  const normU = N.normalizeUnitNumber(unitRef);
  if (!normU) return null;
  const r = ps('INSERT INTO units(external_id,unit_number,norm_unit,compound_id,first_seen,last_seen) VALUES(?,?,?,?,?,?)')
    .run(null, unitRef, normU, compoundId, periodKey, periodKey);
  const id = Number(r.lastInsertRowid);
  if (compoundId != null) M.unitByKey.set(normU + '|' + compoundId, id);
  if (!M.unitByNorm.has(normU)) M.unitByNorm.set(normU, id);
  return id;
}

function resolveUnit(M, unitRef, compoundId, periodKey) {
  if (unitRef == null || unitRef === '') return null;
  const normU = N.normalizeUnitNumber(unitRef);
  if (!normU) return null;
  let id = compoundId != null ? M.unitByKey.get(normU + '|' + compoundId) : null;
  if (!id) id = M.unitByNorm.get(normU);
  if (!id) id = createStubUnit(M, unitRef, compoundId, periodKey);
  return id || null;
}

function resolveUser(M, name, periodKey, extra) {
  const n = N.normalizeName(name);
  if (!n) return null;
  let id = M.usersByName.get(n);
  if (!id) id = createStubUser(M, String(name).trim(), extra, periodKey);
  return id;
}

// ---------- change tracking / history ----------
function recordChange(importId, entityType, entityId, entityKey, field, oldV, newV) {
  ps(`INSERT INTO changed_records(import_id,entity_type,entity_id,entity_key,field_name,old_value,new_value)
    VALUES(?,?,?,?,?,?,?)`).run(importId, entityType, entityId, entityKey == null ? null : String(entityKey).slice(0, 300),
    field, oldV == null ? null : String(oldV).slice(0, 1000), newV == null ? null : String(newV).slice(0, 1000));
}
function recordDuplicate(importId, filename, dataset, recordKey, reason, originalImportId, action) {
  ps(`INSERT INTO duplicate_records(import_id,filename,dataset_type,record_key,reason,original_import_id,action)
    VALUES(?,?,?,?,?,?,?)`).run(importId, filename || null, dataset || null,
    recordKey == null ? null : String(recordKey).slice(0, 300), reason, originalImportId || null, action || 'skipped');
}
const sameVal = (a, b) => (a == null ? null : String(a)) === (b == null ? null : String(b));

// ---------- period ----------
function getOrCreatePeriod(periodKey, sourceFilename) {
  const [y, m] = periodKey.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const lastDay = new Date(y, m, 0).getDate();
  const p = n => String(n).padStart(2, '0');
  let row = ps('SELECT * FROM reporting_periods WHERE period_key=?').get(periodKey);
  if (row) return row;
  const r = ps(`INSERT INTO reporting_periods(period_key,period_name,period_start,period_end,uploaded_at,source_filename,processing_version)
    VALUES(?,?,?,?,?, ?, (SELECT value FROM settings WHERE key='processing_version'))`)
    .run(periodKey, `${names[m - 1]} ${y}`, `${y}-${p(m)}-01`, `${y}-${p(m)}-${lastDay}`, new Date().toISOString(), sourceFilename);
  return ps('SELECT * FROM reporting_periods WHERE id=?').get(Number(r.lastInsertRowid));
}

function detectPeriodFromRows(fileAnalyses) {
  const votes = {};
  for (const fa of fileAnalyses) {
    if (fa.dataset === 'HCP_VEHICLE_ACCESS') {
      for (const iso of fa.sampleTimes || []) {
        const k = N.periodKeyFromISO(iso);
        if (k) votes[k] = (votes[k] || 0) + (fa.eventWeight || 1);
      }
    }
  }
  const keys = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  if (!keys.length) return { periodKey: null, votes, conflict: false };
  const total = keys.reduce((s, k) => s + k[1], 0);
  return { periodKey: keys[0][0], votes, conflict: keys.length > 1 && keys[1][1] / total > 0.15, runnerUp: keys[1] && keys[1][0] };
}

// ---------- upload staging ----------
function assertSafeEntry(entryName) {
  // Spec: validate ZIP, reject malicious / path-traversal filenames. Never modify the original ZIP.
  if (!entryName || /^\s*$/.test(entryName)) throw new Error('Empty entry name in ZIP');
  const n = entryName.replace(/\\/g, '/');
  if (n.includes('..') || n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.includes('\0')) {
    throw new Error('Blocked unsafe filename in ZIP: ' + entryName);
  }
}
const ZIP_LIMITS = {
  maxEntries: 500,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxNameLength: 512,
};

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length > ZIP_LIMITS.maxEntries) {
    throw new Error(`ZIP contains ${entries.length} entries; the limit is ${ZIP_LIMITS.maxEntries}.`);
  }
  const out = [];
  let skipped = 0;
  let declaredTotal = 0;
  let actualTotal = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    if (String(e.entryName || '').length > ZIP_LIMITS.maxNameLength) {
      throw new Error('Blocked over-long filename in ZIP');
    }
    assertSafeEntry(e.entryName);
    const declared = Number(e.header && e.header.size) || 0;
    if (declared > ZIP_LIMITS.maxEntryBytes) {
      throw new Error(`ZIP entry "${e.entryName}" declares ${declared} bytes; the per-file limit is ${ZIP_LIMITS.maxEntryBytes}.`);
    }
    declaredTotal += declared;
    if (declaredTotal > ZIP_LIMITS.maxTotalBytes) {
      throw new Error(`ZIP declares more than ${ZIP_LIMITS.maxTotalBytes} uncompressed bytes; refusing to extract.`);
    }
    const base = path.basename(e.entryName.replace(/\\/g, '/'));
    if (!base) continue;
    if (!/\.(xlsx|xls|csv)$/i.test(base)) { skipped++; continue; }
    const target = path.join(destDir, base);
    if (path.relative(destDir, target).startsWith('..')) throw new Error('Blocked path-traversal filename in ZIP: ' + e.entryName);
    const data = e.getData();
    if (data.length > ZIP_LIMITS.maxEntryBytes) {
      throw new Error(`ZIP entry "${e.entryName}" expanded to ${data.length} bytes; the per-file limit is ${ZIP_LIMITS.maxEntryBytes}.`);
    }
    actualTotal += data.length;
    if (actualTotal > ZIP_LIMITS.maxTotalBytes) {
      throw new Error(`ZIP expanded beyond ${ZIP_LIMITS.maxTotalBytes} bytes; refusing to extract more.`);
    }
    fs.writeFileSync(target, data);
    out.push({ path: target, originalName: base });
  }
  return { files: out, skipped };
}
function readWorkbook(fp) {
  return XLSX.readFile(fp, { cellDates: false });
}

function analyzeFile(f) {
  // f: {path, originalName}
  const size = fs.statSync(f.path).size;
  const hash = sha256File(f.path);
  let wb;
  try { wb = readWorkbook(f.path); }
  catch (e) { return { ...f, fileSize: size, fileHash: hash, error: 'Unreadable Excel file: ' + e.message, dataset: 'UNKNOWN' }; }
  const sheets = listSheets(wb);
  const cls = classifyFile(f.originalName, sheets);
  let rowCount = 0, sampleTimes = [];
  try {
    if (cls.sheetName && wb.Sheets[cls.sheetName]) {
      const { header, data } = readSheetRows(wb, cls.sheetName);
      rowCount = data.length;
      cls.header = header;
      if (cls.dataset === 'HCP_VEHICLE_ACCESS') {
        const def = DATASETS.HCP_VEHICLE_ACCESS;
        const idx = headerIndex(header);
        const take = [def.map.enterTime, def.map.exitTime].map(c => idx[c]).filter(i => i != null);
        let n = 0;
        for (const row of data) {
          for (const i of take) { const iso = N.excelSerialToISO(row[i]); if (iso) { sampleTimes.push(iso); n++; } }
          if (n >= 4000) break;
        }
        cls.eventWeight = Math.min(4000, Math.max(1, n));
      }
    }
  } catch (e) { /* ignore */ }
  return { ...f, fileSize: size, fileHash: hash, dataset: cls.dataset, label: cls.label, confidence: cls.confidence, status: cls.status, sheet: cls.sheetName, rowCount, truncated: EXPORT_LIMITS.includes(rowCount), sampleTimes, eventWeight: cls.eventWeight || 0, candidates: cls.candidates };
}

function stageUpload({ filePath, originalName, sourceKind = null, compoundId = null, uploadedBy = null }) {
  const normalizedKind = sourceKind === undefined ? null : sourceKind;
  if (normalizedKind !== null && !SOURCE_KINDS.includes(normalizedKind)) throw new Error('Unknown source kind — expected CRM_UPLOAD, HCP_MANUAL_UPLOAD, or HCP_API_SYNC.');
  let compound = null;
  if (normalizedKind === 'HCP_MANUAL_UPLOAD') {
    if (compoundId == null) throw new Error('An existing compound must be selected for an HCP upload.');
    compound = ps('SELECT id, name FROM compounds WHERE id=?').get(Number(compoundId));
    if (!compound) throw new Error('Unknown compound. Select an existing compound from the list, not a typed name.');
  } else if (compoundId != null) {
    throw new Error('A CRM upload does not take a compound. Select a compound only for HCP uploads.');
  }
  const isZip = /\.zip$/i.test(originalName || '');
  const ext = (path.extname(originalName || '').toLowerCase() || '');
  if (!isZip && !SINGLE_FILE_EXTS.includes(ext)) throw new Error('Only .zip archives (or .xlsx/.xls/.csv files) are accepted.');
  const zipHash = sha256File(filePath);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const row = ps(`INSERT INTO imports(detected_period_key,uploaded_at,source_filename,status,progress,file_hash,started_at,source_kind,compound_id,uploaded_by)
    VALUES(NULL,datetime('now'),?,'UPLOADED','{}',?,?,?,?,?)`).run(originalName, zipHash, now, normalizedKind, compound ? compound.id : null, uploadedBy || null);
  const importId = Number(row.lastInsertRowid);
  ilog(importId, 'info', 'upload', `Upload started: ${originalName} (sha256 ${zipHash.slice(0, 12)}…) source=${normalizedKind || 'LEGACY'}${compound ? ` compound=${compound.id} (${compound.name})` : ''}`);
  const destDir = path.join(RAW_DIR, `import_${importId}`);
  fs.mkdirSync(destDir, { recursive: true });
  let extracted;
  try {
    if (isZip) {
      extracted = extractZip(filePath, destDir);
      ilog(importId, 'info', 'upload', `ZIP extracted to import_${importId}: ${extracted.files.length} Excel files${extracted.skipped ? `, ${extracted.skipped} non-Excel entries skipped` : ''}`);
    } else {
      const base = path.basename(originalName);
      const target = path.join(destDir, base);
      fs.copyFileSync(filePath, target);
      extracted = { files: [{ path: target, originalName: base }], skipped: 0 };
      ilog(importId, 'info', 'upload', `Single file staged: ${base}`);
    }
  } catch (e) {
    ps('UPDATE imports SET status=? WHERE id=?').run('FAILED', importId);
    ilog(importId, 'error', 'upload', 'Extraction failed: ' + String(e.message || e).slice(0, 500));
    throw e;
  }
  ps('UPDATE imports SET status=? WHERE id=?').run('ANALYZING', importId);
  const analyses = [];
  for (const f of extracted.files) analyses.push(analyzeFile(f));
  const det = detectPeriodFromRows(analyses);
  ps('UPDATE imports SET detected_period_key=?, progress=? WHERE id=?')
    .run(det.periodKey, JSON.stringify({ phase: 'staged', files: analyses.length }), importId);
  ilog(importId, 'info', 'analyze', `Dataset classification complete: ${analyses.length} files, detected period=${det.periodKey || 'unknown'}${det.conflict ? ' (CONFLICT — months disagree)' : ''}`);
  for (const a of analyses) {
    const dup = a.fileHash ? ps('SELECT id, import_id FROM source_files WHERE file_hash=? AND processing_status IN (\'PROCESSED\',\'PROCESSED_WITH_WARNINGS\')').get(a.fileHash) : null;
    const status = a.error ? 'error' : (a.dataset === 'UNKNOWN' ? 'unknown' : (dup ? 'duplicate_file' : 'ok'));
    ps(`INSERT INTO raw_files(import_id,filename,dataset_type,sheet,row_count,status,error)
      VALUES(?,?,?,?,?,?,?)`)
      .run(importId, a.originalName, a.dataset, a.sheet || null, a.rowCount || 0, status, a.error || null);
    ps(`INSERT OR IGNORE INTO source_files(import_id,filename,file_hash,dataset_type,file_size,row_count,sheet_name,reporting_period,processing_status,error)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(importId, a.originalName, a.fileHash || sha256Str(a.originalName), a.dataset, a.fileSize || 0, a.rowCount || 0,
        a.sheet || null, det.periodKey, dup ? 'EXACT_DUPLICATE_FILE' : (status === 'ok' ? 'NEW' : status.toUpperCase()), a.error || null);
    if (dup) ilog(importId, 'warn', 'analyze', `EXACT_DUPLICATE_FILE: "${a.originalName}" already imported (first seen in import #${dup.import_id}). It will be skipped — this file contains no new data.`);
  }
  audit('upload.staged', `${originalName}: ${analyses.length} files, detected period=${det.periodKey || 'unknown'}`);
  return { importId, files: analyses, detected: det };
}

function setProgress(importId, phase, pct, detail) {
  ps('UPDATE imports SET progress=? WHERE id=?').run(JSON.stringify({ phase, pct, detail }), importId);
}
function isCancelled(importId) {
  const r = ps('SELECT status FROM imports WHERE id=?').get(importId);
  return r && r.status === 'CANCELLED';
}

/* One-time backfill: fingerprint pre-Phase-2 event rows so re-uploads dedup correctly. */
function backfillEventFingerprints(importId) {
  const fpCount = ps('SELECT COUNT(*) c FROM event_fingerprints').get().c;
  if (fpCount > 0) return { backfilled: 0 };
  const hcpTotal = ps('SELECT COUNT(*) c FROM hcp_vehicle_events').get().c;
  const hoTotal = ps('SELECT COUNT(*) c FROM handover').get().c;
  if (!hcpTotal && !hoTotal) return { backfilled: 0 };
  ilog(importId, 'info', 'dedup', `Backfilling fingerprints for ${hcpTotal + hoTotal} pre-existing event rows (one-time migration)…`);
  let n = 0;
  const CH = 2000;
  const insFp = ps(`INSERT OR IGNORE INTO event_fingerprints(event_type,source_system,source_event_id,event_hash,event_row_id,first_seen_import_id,first_seen_at)
    VALUES(?,?,?,?,?,NULL,datetime('now'))`);
  for (let off = 0; off < hcpTotal; off += CH) {
    const rows = db.prepare(`SELECT id, plate_normalized, enter_time, exit_time, gate, direction, method, result, owner_raw FROM hcp_vehicle_events LIMIT ? OFFSET ?`).all(CH, off);
    withTx(() => {
      for (const r of rows) {
        const h = hcpEventHash({ normPlate: r.plate_normalized, enterTime: r.enter_time, exitTime: r.exit_time, gate: r.gate, direction: r.direction, method: r.method, result: r.result, ownerNorm: N.normalizeName(r.owner_raw) });
        ps('UPDATE hcp_vehicle_events SET event_hash=? WHERE id=?').run(h, r.id);
        insFp.run('HCP_VEHICLE_ACCESS', 'hcp', null, h, r.id);
        n++;
      }
    });
  }
  const hoRows = db.prepare('SELECT id, unit_code, category, zone, handover_date, finishing, resident, planned_delivery FROM handover').all();
  withTx(() => {
    for (const r of hoRows) {
      const h = handoverEventHash({ unitCode: r.unit_code, category: r.category, zone: r.zone, handoverDate: r.handover_date, finishing: r.finishing, resident: r.resident, planned: r.planned_delivery });
      ps('UPDATE handover SET event_hash=? WHERE id=?').run(h, r.id);
      insFp.run('HANDOVER', 'crm', null, h, r.id);
      n++;
    }
  });
  for (const r of db.prepare('SELECT external_id FROM invitations WHERE external_id IS NOT NULL').all()) {
    insFp.run('INVITATION', 'crm', String(r.external_id), crmEventHash('inv', String(r.external_id)), null);
    n++;
  }
  for (const r of db.prepare('SELECT external_id FROM gate_passes WHERE external_id IS NOT NULL').all()) {
    insFp.run('GATE_PASS', 'crm', String(r.external_id), crmEventHash('gp', String(r.external_id)), null);
    n++;
  }
  ilog(importId, 'info', 'dedup', `Backfill complete: ${n} fingerprints.`);
  return { backfilled: n };
}

function processImport(importId, periodKeyOverride, datasetOverrides = {}) {
  const imp = ps('SELECT * FROM imports WHERE id=?').get(importId);
  if (!imp) throw new Error('Import not found');
  if (imp.status === 'PROCESSING') throw new Error('Import is already processing.');
  if (TERMINAL_STATUSES.includes(imp.status) && imp.status !== 'FAILED') {
    // Reprocess path: re-running a terminal import must stay idempotent (fingerprints absorb it).
    ilog(importId, 'info', 'process', `Reprocess requested for terminal import (status was ${imp.status}). Fingerprints guarantee idempotency.`);
  }
  const files = ps('SELECT * FROM raw_files WHERE import_id=?').all(importId);
  const sourceKind = imp.source_kind || null;
  const workflowCompoundId = imp.compound_id != null ? Number(imp.compound_id) : null;
  if (sourceKind === 'HCP_MANUAL_UPLOAD') {
    if (workflowCompoundId == null) throw new Error('This HCP import has no compound selected. Upload again and select an existing compound.');
    const c = ps('SELECT id FROM compounds WHERE id=?').get(workflowCompoundId);
    if (!c) throw new Error('The selected compound no longer exists. Upload the HCP file again with a current compound.');
  } else if (sourceKind === 'CRM_UPLOAD' && workflowCompoundId != null) {
    throw new Error('CRM imports must not carry a compound. Data error — re-upload through the CRM workflow.');
  }
  const periodKey = periodKeyOverride || imp.detected_period_key || imp.reporting_period;
  if (!periodKey || !/^\d{4}-\d{2}$/.test(periodKey)) throw new Error('No valid reporting period. Please confirm the month.');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const period = getOrCreatePeriod(periodKey, imp.source_filename);
  ps('UPDATE imports SET period_id=?, reporting_period=?, status=?, started_at=?, log=? WHERE id=?')
    .run(period.id, periodKey, 'PROCESSING', now, 'started', importId);
  ilog(importId, 'info', 'process', `Processing started -> period ${periodKey} (${period.period_name})`);
  audit('import.started', `Import #${importId} -> period ${periodKey}`);
  // NOTE (Phase 2): no destructive period wipe. Events dedup via fingerprints;
  // masters UPSERT with history. Re-running is idempotent by construction.

  // ---- VALIDATING pass (schema check before any write) ----
  ps('UPDATE imports SET status=? WHERE id=?').run('VALIDATING', importId);
  ilog(importId, 'info', 'validate', 'Schema validation started.');
  const M0 = loadMaps();
  for (const f of files) {
    let dataset = datasetOverrides[f.filename] || f.dataset_type;
    if (f.status === 'error') { ilog(importId, 'error', 'validate', `"${f.filename}": unreadable (${f.error || 'unknown error'}). Skipped.`); continue; }
    if (dataset === 'UNKNOWN') {
      try {
        const retryPath = path.join(RAW_DIR, `import_${importId}`, f.filename);
        const retryWb = readWorkbook(retryPath);
        const retryCls = classifyFile(f.filename, listSheets(retryWb));
        if (retryCls && retryCls.dataset && retryCls.dataset !== 'UNKNOWN' && retryCls.sheetName) {
          const retrySheet = readSheetRows(retryWb, retryCls.sheetName);
          dataset = retryCls.dataset;
          f.dataset_type = dataset;
          f.sheet = retryCls.sheetName;
          f.row_count = retrySheet.data.length; 
          ps('UPDATE raw_files SET dataset_type=?, sheet=?, row_count=?, status=? WHERE id=?')
            .run(dataset, retryCls.sheetName, retrySheet.data.length, 'ok', f.id);
          ps('UPDATE source_files SET dataset_type=?, row_count=?, processing_status=? WHERE import_id=? AND filename=?')
            .run(dataset, retrySheet.data.length, 'NEW', importId, f.filename);
          ilog(importId, 'info', 'validate', `"${f.filename}": reclassified as ${dataset} at processing time.`);
        }
      } catch (e) { /* fall through to the unknown-dataset skip below */ }
    }
    if (dataset === 'UNKNOWN') { ilog(importId, 'warn', 'validate', `"${f.filename}": unknown dataset — assign a type to include it. Skipped.`); continue; }
    const def = DATASETS[dataset];
    if (!def) { ilog(importId, 'error', 'validate', `"${f.filename}": unsupported dataset type ${dataset}. Skipped.`); continue; }
    const workflow = workflowForDataset(dataset);
    if ((sourceKind === 'CRM_UPLOAD' && workflow === 'HCP') ||
        (sourceKind === 'HCP_MANUAL_UPLOAD' && workflow === 'CRM')) {
      ps('UPDATE raw_files SET status=?, error=? WHERE id=?').run('validation_failed', 'File belongs to the other workflow (CRM and HCP uploads are separate). Use the matching upload.', f.id);
      ilog(importId, 'error', 'validate', `"${f.filename}": ${dataset} is not accepted by ${sourceKind}. Skipped.`);
      continue;
    }
    try {
      const filePath = path.join(RAW_DIR, `import_${importId}`, f.filename);
      const wb = readWorkbook(filePath);
      const { header } = readSheetRows(wb, f.sheet);
      const missing = (def.requiredColumns || []).filter(c => !header.includes(c));
      if (missing.length) {
        ps('UPDATE raw_files SET status=?, error=? WHERE id=?').run('validation_failed', 'Missing required columns: ' + missing.join(', '), f.id);
        ilog(importId, 'error', 'validate', `"${f.filename}": missing columns ${missing.join(', ')}. Skipped.`);
      } else {
        ilog(importId, 'info', 'validate', `"${f.filename}": ${dataset} schema OK.`);
      }
    } catch (e) {
      ps('UPDATE raw_files SET status=?, error=? WHERE id=?').run('validation_failed', String(e.message || e).slice(0, 500), f.id);
      ilog(importId, 'error', 'validate', `"${f.filename}": validation error — ${String(e.message || e).slice(0, 300)}`);
    }
  }
  if (isCancelled(importId)) { ilog(importId, 'warn', 'process', 'Import cancelled during validation.'); return { cancelled: true }; }
  ps('UPDATE imports SET status=? WHERE id=?').run('PROCESSING', importId);

  // ---- fingerprints backfill (one-time for pre-Phase-2 data) ----
  const bf = backfillEventFingerprints(importId);

  const summary = {
    period: periodKey, files: [], warnings: [],
    masters: { newUsers: 0, updatedUsers: 0, unchangedUsers: 0, newUnits: 0, updatedUnits: 0, unchangedUnits: 0, newVehicles: 0, updatedVehicles: 0, unchangedVehicles: 0, newRelations: 0, updatedRelations: 0, unchangedRelations: 0 },
    events: { newVehicleEvents: 0, dupVehicleEvents: 0, newInvitations: 0, dupInvitations: 0, newGatePasses: 0, dupGatePasses: 0, newHandovers: 0, dupHandovers: 0 },
    backfilledFingerprints: bf.backfilled || 0,
  };
  const M = loadMasterMaps();
  const E = loadEventSets();
  let done = 0, okFiles = 0, failFiles = 0;
  for (const f of files) {
    if (isCancelled(importId)) { ilog(importId, 'warn', 'process', 'Import cancelled by user. Partial progress retained; reprocess to resume idempotently.'); break; }
    done++;
    setProgress(importId, 'processing', Math.round((done / files.length) * 90), f.filename);
    const dataset = datasetOverrides[f.filename] || f.dataset_type;
    const cur = ps('SELECT status FROM raw_files WHERE id=?').get(f.id).status;
    if (cur === 'error' || cur === 'validation_failed' || dataset === 'UNKNOWN') {
      summary.files.push({ filename: f.filename, dataset, status: 'skipped', reason: f.error || 'Unknown dataset or failed validation — assign a type to include it.' });
      continue;
    }
    const src = ps('SELECT processing_status FROM source_files WHERE import_id=? AND filename=?').get(importId, f.filename);
    if (src && src.processing_status === 'EXACT_DUPLICATE_FILE') {
      summary.files.push({ filename: f.filename, dataset, status: 'duplicate_file', reason: 'This file has already been imported and contains no new data.' });
      ilog(importId, 'warn', 'process', `"${f.filename}": EXACT_DUPLICATE_FILE — skipped, no new data.`);
      okFiles++;
      continue;
    }
    const filePath = path.join(RAW_DIR, `import_${importId}`, f.filename);
    try {
      const res = ingestFile(filePath, f.sheet, dataset, period, importId, M, E, f.filename, { sourceKind, hcpCompoundId: workflowCompoundId });
      summary.files.push({ filename: f.filename, dataset, status: 'ok', ...res });
      if (res.truncated) summary.warnings.push(`Potentially incomplete dataset "${f.filename}": source returned exactly ${res.sourceRows} records (possible export limit).`);
      ps('UPDATE raw_files SET period_id=?, status=? WHERE id=?').run(period.id, 'ok', f.id);
      ps('UPDATE source_files SET processing_status=?, row_count=?, reporting_period=? WHERE import_id=? AND filename=?')
        .run(res.truncated ? 'PROCESSED_WITH_WARNINGS' : 'PROCESSED', res.sourceRows, periodKey, importId, f.filename);
      for (const k of ['newUsers', 'updatedUsers', 'unchangedUsers', 'newUnits', 'updatedUnits', 'unchangedUnits', 'newVehicles', 'updatedVehicles', 'unchangedVehicles', 'newRelations', 'updatedRelations', 'unchangedRelations']) summary.masters[k] += res[k] || 0;
      for (const k of ['newVehicleEvents', 'dupVehicleEvents', 'newInvitations', 'dupInvitations', 'newGatePasses', 'dupGatePasses', 'newHandovers', 'dupHandovers']) summary.events[k] += res[k] || 0;
      summary.ambiguousOwners = (summary.ambiguousOwners || 0) + (res.ambiguousOwners || 0);
      ilog(importId, res.ambiguousOwners ? 'warn' : 'info', 'process', `"${f.filename}": ${dataset} done — new=${res.newRecords || 0}, updated=${res.updatedRecords || 0}, unchanged=${res.unchangedRecords || 0}, dups=${res.duplicates || 0}, rejected=${res.rejected || 0}${res.ambiguousOwners ? `, AMBIGUOUS OWNERS LEFT UNLINKED=${res.ambiguousOwners} (name shared by several users — see Identity Matching data)` : ''}.`);
      okFiles++;
    } catch (e) {
      failFiles++;
      summary.files.push({ filename: f.filename, dataset, status: 'failed', reason: String(e.message || e).slice(0, 500) });
      ps('UPDATE raw_files SET period_id=?, status=?, error=? WHERE id=?').run(period.id, 'failed', String(e.message || e).slice(0, 1000), f.id);
      ps('UPDATE source_files SET processing_status=? WHERE import_id=? AND filename=?').run('FAILED', importId, f.filename);
      ilog(importId, 'error', 'process', `"${f.filename}": FAILED — ${String(e.message || e).slice(0, 300)} (its partial rows were rolled back; other files unaffected).`);
    }
  }
  if (isCancelled(importId)) {
    ps('UPDATE imports SET status=?, progress=? WHERE id=?').run('CANCELLED', JSON.stringify({ phase: 'cancelled' }), importId);
    audit('import.cancelled', `Import #${importId} cancelled`);
    return { cancelled: true, summary };
  }
  setProgress(importId, 'metrics', 92, 'snapshotting KPIs');
  snapshotMetrics(period.id, periodKey);
  writeSnapshot(periodKey, importId, summary);
  ilog(importId, 'info', 'metrics', 'KPI refresh + monthly snapshot complete.');
  setProgress(importId, 'matching', 96, 'identity resolution');
  summary.matching = autoMatch(period.id, M);
  ilog(importId, 'info', 'matching', `Identity resolution: ${summary.matching.hcpOwnersMatched} owners matched, ${summary.matching.hcpOwnerCandidates} need review.`);
  const warnings = summary.warnings.length;
  const status = (failFiles > 0 || warnings > 0) ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';
  const doneAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  ps(`UPDATE imports SET status=?, progress=?, log=?, completed_at=?, successful_files=?, failed_files=?, warning_count=?, error_count=? WHERE id=?`)
    .run(status, JSON.stringify({ phase: 'done', pct: 100 }), JSON.stringify(summary).slice(0, 60000), doneAt, okFiles, failFiles, warnings, failFiles, importId);
  ilog(importId, status === 'COMPLETED' ? 'info' : 'warn', 'done',
    `Import completed (${status}): ${okFiles} files ok, ${failFiles} failed. Masters new=${summary.masters.newUsers + summary.masters.newUnits + summary.masters.newVehicles + summary.masters.newRelations}, updated=${summary.masters.updatedUsers + summary.masters.updatedUnits + summary.masters.updatedVehicles + summary.masters.updatedRelations}. Events new=${summary.events.newVehicleEvents + summary.events.newInvitations + summary.events.newGatePasses + summary.events.newHandovers}, dups skipped=${summary.events.dupVehicleEvents + summary.events.dupInvitations + summary.events.dupGatePasses + summary.events.dupHandovers}.`);
  audit('import.completed', `Import #${importId} period ${periodKey}: ${okFiles} ok, ${failFiles} failed`);
  return summary;
}

function bulkTouch(table, extList, periodKey) {
  if (!extList.length) return;
  const CH = 500;
  const st = ps(`UPDATE ${table} SET last_seen=? WHERE external_id=?`);
  withTx(() => { for (const e of extList) st.run(periodKey, e); });
}

// ---------- per-file ingestion ----------
function ingestFile(filePath, sheetName, dataset, period, importId, M, E, filename, opts = {}) {
  const wb = readWorkbook(filePath);
  const { header, data } = readSheetRows(wb, sheetName);
  const def = DATASETS[dataset];
  if (!def) throw new Error('Unsupported dataset type: ' + dataset);
  const missing = (def.requiredColumns || []).filter(c => !header.includes(c));
  if (missing.length) throw new Error('Missing required columns: ' + missing.join(', '));
  const sourceKind = opts.sourceKind || null;
  const hcpCompoundId = opts.hcpCompoundId != null ? Number(opts.hcpCompoundId) : null;
  if ((dataset === 'HCP_VEHICLE_ACCESS' || dataset === 'HCP_REGISTERED_VEHICLES') && sourceKind === 'HCP_MANUAL_UPLOAD') {
    if (hcpCompoundId == null) throw new Error('HCP ingest requires a selected compound.');
    if (!ps('SELECT id FROM compounds WHERE id=?').get(hcpCompoundId)) throw new Error('Selected compound does not exist.');
  }
  const idx = headerIndex(header);
  const maps = M || loadMasterMaps();
  const ev = E || loadEventSets();
  const pk = period.period_key;
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const stats = {
    sourceRows: data.length, processed: 0, rejected: 0, duplicates: 0,
    newRecords: 0, updatedRecords: 0, unchangedRecords: 0,
    newUsers: 0, updatedUsers: 0, unchangedUsers: 0,
    newUnits: 0, updatedUnits: 0, unchangedUnits: 0,
    newVehicles: 0, updatedVehicles: 0, unchangedVehicles: 0,
    newRelations: 0, updatedRelations: 0, unchangedRelations: 0,
    newVehicleEvents: 0, dupVehicleEvents: 0, newInvitations: 0, dupInvitations: 0,
    newGatePasses: 0, dupGatePasses: 0, newHandovers: 0, dupHandovers: 0,
  };
  const seen = new Set();
  const touched = { users: [], units: [] };
  const B = { raw: [], uu: [], veh: [], inv: [], gp: [], hcp: [], ho: [], fp: [] };
  const dupBuf = [];
  const DUP_CAP = 2000;
  const noteDup = (recordKey, reason, originalImportId, action) => {
    stats.duplicates++;
    if (dupBuf.length < DUP_CAP) dupBuf.push([importId, filename || path.basename(filePath), dataset, recordKey, reason, originalImportId || null, action || 'skipped']);
  };
  const flushDups = () => {
    if (!dupBuf.length) return;
    const st = ps('INSERT INTO duplicate_records(import_id,filename,dataset_type,record_key,reason,original_import_id,action) VALUES(?,?,?,?,?,?,?)');
    withTx(() => { for (const r of dupBuf) st.run(...r); });
    dupBuf.length = 0;
  };

  const flush = () => withTx(() => {
    multiInsert('raw_rows', ['import_id', 'period_id', 'dataset_type', 'row_json'], B.raw);
    multiInsert('user_units', ['external_id', 'user_id', 'user_name_raw', 'unit_id', 'unit_ref_raw', 'compound_id', 'compound_raw', 'access_type', 'invitation_provider', 'status', 'created_on', 'first_seen', 'last_seen'], B.uu, true);
    multiInsert('vehicles', ['external_id', 'make', 'model', 'year', 'plate_original', 'plate_norm', 'plate_norm_latin', 'user_id', 'user_name_raw', 'status', 'created_on', 'first_seen', 'last_seen'], B.veh, true);
    multiInsert('invitations', ['external_id', 'code', 'provider', 'invite_to', 'member_name', 'member_mobile', 'type', 'status', 'created_on', 'period_id', 'import_id'], B.inv);
    multiInsert('gate_passes', ['external_id', 'compound_id', 'compound_raw', 'unit_id', 'unit_ref_raw', 'user_id', 'user_name_raw', 'access_type', 'entry_date', 'valid_until', 'created_on', 'period_id', 'import_id'], B.gp);
    multiInsert('hcp_vehicle_events', ['period_id', 'plate_original', 'plate_normalized', 'plate_normalized_latin', 'parking_lot', 'compound_id', 'direction', 'enter_time', 'exit_time', 'gate', 'method', 'result', 'reason', 'vehicle_list', 'owner_raw', 'owner_user_id', 'country', 'vehicle_type', 'color', 'brand', 'event_hash', 'import_id', 'source_kind', 'external_id'], B.hcp);
    multiInsert('handover', ['period_id', 'unit_code', 'unit_id', 'category', 'zone', 'handover_date', 'finishing', 'resident', 'planned_delivery', 'event_hash', 'import_id'], B.ho);
    multiInsert('event_fingerprints', ['event_type', 'source_system', 'source_event_id', 'event_hash', 'event_row_id', 'first_seen_import_id', 'first_seen_at'], B.fp);
    B.raw = []; B.uu = []; B.veh = []; B.inv = []; B.gp = []; B.hcp = []; B.ho = []; B.fp = [];
  });
  // File-level atomicity: track everything this file created/changed so a file
  // failure rolls back only its own rows (other files in the import unaffected).
  const fileCreated = { userIds: [], unitIds: [], uuExts: [], vehExts: [], invExts: [], gpExts: [], hcpHashes: [], hoHashes: [] };
  const fileChanged = []; // [{type, id}]
  const trackChanged = (type, id) => fileChanged.push({ type, id });
  const histOf = { user: ['user_history', 'user_id'], unit: ['unit_history', 'unit_id'], vehicle: ['vehicle_history', 'vehicle_id'], user_unit: ['user_unit_history', 'user_unit_id'] };
  const rollbackFile = () => {
    dupBuf.length = 0; // unflushed duplicate audit rows are simply dropped
    try {
      withTx(() => {
        if (fileCreated.hcpHashes.length) {
          const h = fileCreated.hcpHashes;
          for (let i = 0; i < h.length; i += 500) {
            const s = h.slice(i, i + 500);
            const ph = s.map(() => '?').join(',');
            db.prepare(`DELETE FROM hcp_vehicle_events WHERE event_hash IN (${ph})`).run(...s);
            db.prepare(`DELETE FROM event_fingerprints WHERE event_hash IN (${ph})`).run(...s);
            for (const x of s) ev.hcp.delete(x);
          }
        }
        if (fileCreated.hoHashes.length) {
          const h = fileCreated.hoHashes;
          for (let i = 0; i < h.length; i += 500) {
            const s = h.slice(i, i + 500);
            const ph = s.map(() => '?').join(',');
            db.prepare(`DELETE FROM handover WHERE event_hash IN (${ph})`).run(...s);
            db.prepare(`DELETE FROM event_fingerprints WHERE event_hash IN (${ph})`).run(...s);
            for (const x of s) ev.ho.delete(x);
          }
        }
        const delExt = (table, exts) => {
          for (let i = 0; i < exts.length; i += 500) {
            const s = exts.slice(i, i + 500);
            db.prepare(`DELETE FROM ${table} WHERE external_id IN (${s.map(() => '?').join(',')})`).run(...s);
          }
        };
        if (fileCreated.invExts.length) { delExt('invitations', fileCreated.invExts); for (const x of fileCreated.invExts) ev.inv.delete(x); }
        if (fileCreated.gpExts.length) { delExt('gate_passes', fileCreated.gpExts); for (const x of fileCreated.gpExts) ev.gp.delete(x); }
        if (fileCreated.uuExts.length) delExt('user_units', fileCreated.uuExts);
        if (fileCreated.vehExts.length) delExt('vehicles', fileCreated.vehExts);
        for (const id of fileCreated.userIds) {
          db.prepare('DELETE FROM users WHERE id=?').run(id);
          db.prepare('DELETE FROM user_history WHERE import_id=? AND user_id=?').run(importId, id);
        }
        for (const id of fileCreated.unitIds) {
          db.prepare('DELETE FROM units WHERE id=?').run(id);
          db.prepare('DELETE FROM unit_history WHERE import_id=? AND unit_id=?').run(importId, id);
        }
        // update-history + changed_records written by THIS file only (tracked entities)
        for (const { type, id } of fileChanged) {
          const hh = histOf[type];
          if (hh) db.prepare(`DELETE FROM ${hh[0]} WHERE import_id=? AND ${hh[1]}=?`).run(importId, id);
          db.prepare('DELETE FROM changed_records WHERE import_id=? AND entity_type=? AND entity_id=?').run(importId, type, id);
        }
        db.prepare('DELETE FROM duplicate_records WHERE import_id=? AND filename=?').run(importId, filename || path.basename(filePath));
        db.prepare('DELETE FROM raw_rows WHERE import_id=? AND period_id=? AND dataset_type=?').run(importId, period.id, dataset);
      });
    } catch (e) { /* best effort */ }
  };

  let lotMap = {};
  try { lotMap = JSON.parse(ps("SELECT value FROM settings WHERE key='parking_lot_compound'").get().value || '{}'); } catch (e) { lotMap = {}; }

  // Prepared statements for master UPSERT-with-diff
  const updUser = ps('UPDATE users SET name=?,norm_name=?,mobile=?,norm_mobile=?,email=?,national_id=?,marital_status=?,status=?,registered_as=?,created_on=?,last_seen=? WHERE id=?');
  const insUser = ps('INSERT INTO users(external_id,name,norm_name,mobile,norm_mobile,email,national_id,marital_status,status,registered_as,created_on,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const updUnit = ps('UPDATE units SET unit_number=?,norm_unit=?,compound_id=?,related_unit=?,gate_suspension=?,rent_suspension=?,maint_fees=?,created_on=?,last_seen=? WHERE id=?');
  const insUnit = ps('INSERT INTO units(external_id,unit_number,norm_unit,compound_id,related_unit,gate_suspension,rent_suspension,maint_fees,created_on,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?)');

  const USER_FIELDS = ['name', 'mobile', 'email', 'national_id', 'marital_status', 'status', 'registered_as'];
  const UNIT_FIELDS = ['unit_number', 'compound_id', 'related_unit', 'gate_suspension', 'rent_suspension', 'maint_fees'];
  const VEH_FIELDS = ['make', 'model', 'year', 'plate_original', 'user_id', 'status'];
  const UU_FIELDS = ['user_id', 'unit_id', 'compound_id', 'access_type', 'invitation_provider', 'status'];

  try {
    for (const row of data) {
      const g = n => cell(row, idx, def.map[n]);
      const obj = {};
      for (let i = 0; i < header.length; i++) obj[header[i]] = row[i] == null ? null : row[i];
      B.raw.push([importId, period.id, dataset, JSON.stringify(obj)]);
      try {
        let ok = false;
        switch (dataset) {
          case 'ALL_USERS': {
            const ext = str(g('id')); if (!ext) break;
            if (seen.has('u' + ext)) { noteDup(ext, 'DUPLICATE_WITHIN_FILE', importId); ok = true; break; } seen.add('u' + ext);
            const ph = N.normalizePhone(g('mobile'));
            const name = str(g('name')), email = str(g('email')), nat = g('nationalId') ? String(g('nationalId')).trim() : null;
            const vals = { name, norm_name: N.normalizeName(name), mobile: g('mobile') ? String(g('mobile')).trim() : null, norm_mobile: ph.norm, email, national_id: nat, marital_status: str(g('marital')), status: str(g('status')), registered_as: str(g('registeredAs')) };
            const existing = maps.usersFull.get(ext);
            if (existing) {
              const diffs = USER_FIELDS.filter(f => !sameVal(existing[f], vals[f]));
              if (!diffs.length) { stats.unchangedUsers++; stats.unchangedRecords++; touched.users.push(ext); }
              else {
                updUser.run(vals.name, vals.norm_name, vals.mobile, vals.norm_mobile, vals.email, vals.national_id, vals.marital_status, vals.status, vals.registered_as, N.excelSerialToISO(g('createdOn')), pk, existing.id);
                for (const f of diffs) recordChange(importId, 'user', existing.id, name || ext, f, existing[f], vals[f]);
                ps(`INSERT INTO user_history(user_id,import_id,period_key,change_type,name,mobile,email,national_id,marital_status,status,registered_as)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(existing.id, importId, pk, 'UPDATED', existing.name, existing.mobile, existing.email, existing.national_id, existing.marital_status, existing.status, existing.registered_as);
                maps.usersFull.set(ext, { ...existing, ...vals });
                trackChanged('user', existing.id);
                stats.updatedUsers++; stats.updatedRecords++;
              }
            } else {
              const r = insUser.run(ext, vals.name, vals.norm_name, vals.mobile, vals.norm_mobile, vals.email, vals.national_id, vals.marital_status, vals.status, vals.registered_as, N.excelSerialToISO(g('createdOn')), pk, pk);
              const nid = Number(r.lastInsertRowid);
              fileCreated.userIds.push(nid);
              maps.usersByExt.set(ext, nid);
              maps.usersFull.set(ext, { id: nid, external_id: ext, ...vals });
              const nn = vals.norm_name;
              if (nn && !maps.usersByName.has(nn)) maps.usersByName.set(nn, nid);
              ps(`INSERT INTO user_history(user_id,import_id,period_key,change_type,name,mobile,email,national_id,marital_status,status,registered_as)
                VALUES(?,?,?,'CREATED',?,?,?,?,?,?,?)`).run(nid, importId, pk, vals.name, vals.mobile, vals.email, vals.national_id, vals.marital_status, vals.status, vals.registered_as);
              stats.newUsers++; stats.newRecords++;
            }
            ok = true; break;
          }
          case 'ACTIVE_UNITS': {
            const ext = str(g('id')); if (!ext) break;
            if (seen.has('t' + ext)) { noteDup(ext, 'DUPLICATE_WITHIN_FILE', importId); ok = true; break; } seen.add('t' + ext);
            const cid = ensureCompound(maps, str(g('compound')));
            const number = str(g('name'));
            const vals = { unit_number: number, norm_unit: N.normalizeUnitNumber(number), compound_id: cid, related_unit: str(g('related')), gate_suspension: g('gateSusp') ? String(g('gateSusp')).trim() : null, rent_suspension: g('rentSusp') ? String(g('rentSusp')).trim() : null, maint_fees: g('maint') ? String(g('maint')).trim() : null };
            const existing = maps.unitsFull.get(ext);
            if (existing) {
              const diffs = UNIT_FIELDS.filter(f => !sameVal(existing[f], vals[f]));
              if (!diffs.length) { stats.unchangedUnits++; stats.unchangedRecords++; touched.units.push(ext); }
              else {
                updUnit.run(vals.unit_number, vals.norm_unit, vals.compound_id, vals.related_unit, vals.gate_suspension, vals.rent_suspension, vals.maint_fees, N.excelSerialToISO(g('createdOn')), pk, existing.id);
                for (const f of diffs) recordChange(importId, 'unit', existing.id, number || ext, f, existing[f], vals[f]);
                ps(`INSERT INTO unit_history(unit_id,import_id,period_key,change_type,unit_number,compound_id,related_unit,gate_suspension,rent_suspension,maint_fees)
                  VALUES(?,?,?,'UPDATED',?,?,?,?,?,?)`).run(existing.id, importId, pk, existing.unit_number, existing.compound_id, existing.related_unit, existing.gate_suspension, existing.rent_suspension, existing.maint_fees);
                maps.unitsFull.set(ext, { ...existing, ...vals });
                trackChanged('unit', existing.id);
                stats.updatedUnits++; stats.updatedRecords++;
              }
            } else {
              const r = insUnit.run(ext, vals.unit_number, vals.norm_unit, vals.compound_id, vals.related_unit, vals.gate_suspension, vals.rent_suspension, vals.maint_fees, N.excelSerialToISO(g('createdOn')), pk, pk);
              const nid = Number(r.lastInsertRowid);
              fileCreated.unitIds.push(nid);
              maps.unitsByExt.set(ext, nid);
              maps.unitsFull.set(ext, { id: nid, external_id: ext, ...vals });
              const normU = vals.norm_unit;
              if (normU) { if (cid != null) maps.unitByKey.set(normU + '|' + cid, nid); if (!maps.unitByNorm.has(normU)) maps.unitByNorm.set(normU, nid); }
              ps(`INSERT INTO unit_history(unit_id,import_id,period_key,change_type,unit_number,compound_id,related_unit,gate_suspension,rent_suspension,maint_fees)
                VALUES(?, ?,?,'CREATED',?,?,?,?,?,?)`).run(nid, importId, pk, vals.unit_number, vals.compound_id, vals.related_unit, vals.gate_suspension, vals.rent_suspension, vals.maint_fees);
              stats.newUnits++; stats.newRecords++;
            }
            ok = true; break;
          }
          case 'UNIT_ACCESS': {
            const ext = str(g('id')); if (!ext) break;
            if (seen.has('a' + ext)) { noteDup(ext, 'DUPLICATE_WITHIN_FILE', importId); ok = true; break; } seen.add('a' + ext);
            const compRaw = str(g('compound'));
            const cid = ensureCompound(maps, compRaw);
            const unitRef = str(g('unit'));
            const unitId = resolveUnit(maps, unitRef, cid, pk);
            const userName = str(g('user'));
            const userId = resolveUser(maps, userName, pk, { regAs: str(g('accessType')) });
            const vals = { user_id: userId, unit_id: unitId, compound_id: cid, access_type: str(g('accessType')), invitation_provider: str(g('provider')), status: str(g('status')) };
            const existing = maps.uuFull.get(ext);
            if (existing) {
              const diffs = UU_FIELDS.filter(f => !sameVal(existing[f], vals[f]));
              if (!diffs.length) { stats.unchangedRelations++; stats.unchangedRecords++; }
              else {
                ps('UPDATE user_units SET user_id=?,unit_id=?,compound_id=?,access_type=?,invitation_provider=?,status=?,last_seen=? WHERE id=?')
                  .run(vals.user_id, vals.unit_id, vals.compound_id, vals.access_type, vals.invitation_provider, vals.status, pk, existing.id);
                for (const f of diffs) recordChange(importId, 'user_unit', existing.id, `${userName || '?'} ↔ ${unitRef || '?'}`, f, existing[f], vals[f]);
                ps(`INSERT INTO user_unit_history(user_unit_id,import_id,period_key,change_type,user_id,unit_id,compound_id,access_type,invitation_provider,status)
                  VALUES(?,?,?,'UPDATED',?,?,?,?,?,?)`).run(existing.id, importId, pk, existing.user_id, existing.unit_id, existing.compound_id, existing.access_type, existing.invitation_provider, existing.status);
                maps.uuFull.set(ext, { ...existing, ...vals });
                trackChanged('user_unit', existing.id);
                stats.updatedRelations++; stats.updatedRecords++;
              }
            } else {
              B.uu.push([ext, userId, userName, unitId, unitRef, cid, compRaw, vals.access_type, vals.invitation_provider, vals.status, N.excelSerialToISO(g('createdOn')), pk, pk]);
              fileCreated.uuExts.push(ext);
              stats.newRelations++; stats.newRecords++;
            }
            ok = true; break;
          }
          case 'VEHICLES': {
            const ext = str(g('id')); if (!ext) break;
            if (seen.has('v' + ext)) { noteDup(ext, 'DUPLICATE_WITHIN_FILE', importId); ok = true; break; } seen.add('v' + ext);
            const plate = str(g('plate'));
            const { norm, latin } = N.normalizePlate(plate);
            const userName = str(g('user'));
            const userId = resolveVehicleOwner(userName, pk, maps, importId, stats);
            const vals = { make: str(g('make')), model: str(g('model')), year: g('year') ? String(g('year')).trim() : null, plate_original: plate, user_id: userId, status: str(g('status')) };
            const existing = maps.vehFull.get(ext);
            if (existing) {
              const diffs = VEH_FIELDS.filter(f => !sameVal(existing[f], vals[f]));
              if (!diffs.length) { stats.unchangedVehicles++; stats.unchangedRecords++; }
              else {
                ps('UPDATE vehicles SET make=?,model=?,year=?,plate_original=?,plate_norm=?,plate_norm_latin=?,user_id=?,user_name_raw=?,status=?,last_seen=? WHERE id=?')
                  .run(vals.make, vals.model, vals.year, plate, norm, latin, userId, userName, vals.status, pk, existing.id);
                for (const f of diffs) recordChange(importId, 'vehicle', existing.id, plate || ext, f, existing[f], vals[f]);
                ps(`INSERT INTO vehicle_history(vehicle_id,import_id,period_key,change_type,make,model,year,plate_original,user_id,status)
                  VALUES(?,?,?,'UPDATED',?,?,?,?,?,?)`).run(existing.id, importId, pk, existing.make, existing.model, existing.year, existing.plate_original, existing.user_id, existing.status);
                maps.vehFull.set(ext, { ...existing, ...vals, plate_norm: norm, plate_norm_latin: latin });
                trackChanged('vehicle', existing.id);
                stats.updatedVehicles++; stats.updatedRecords++;
              }
            } else {
              B.veh.push([ext, vals.make, vals.model, vals.year, plate, norm, latin, userId, userName, vals.status, N.excelSerialToISO(g('createdOn')), pk, pk]);
              fileCreated.vehExts.push(ext);
              stats.newVehicles++; stats.newRecords++;
            }
            ok = true; break;
          }
          case 'INVITATION_REQUESTS': {
            const ext = str(g('id')); if (!ext) break;
            if (seen.has('i' + ext)) { noteDup(ext, 'DUPLICATE_WITHIN_FILE', importId); ok = true; break; } seen.add('i' + ext);
            const h = crmEventHash('inv', ext);
            if (ev.inv.has(ext) || ev.hcp.has(h) || seen.has('fh' + h)) {
              stats.dupInvitations++; noteDup(ext, 'DUPLICATE_EVENT', ev.inv.get(ext) || importId);
              ok = true; break;
            }
            seen.add('fh' + h);
            const code = g('code') ? String(g('code')).trim() : null;
            B.inv.push([ext, code || null, str(g('provider')), str(g('inviteTo')), str(g('memberName')), g('memberMobile') ? String(g('memberMobile')).trim() : null, str(g('type')), str(g('status')), N.excelSerialToISO(g('createdOn')), period.id, importId]);
            fileCreated.invExts.push(ext);
            B.fp.push(['INVITATION', 'crm', ext, h, null, importId, nowStr]);
            ev.inv.set(ext, importId);
            stats.newInvitations++; stats.newRecords++;
            ok = true; break;
          }
          case 'ACTIVE_GATE_PASSES': {
            const ext = str(g('id')); if (!ext) break;
            if (seen.has('p' + ext)) { noteDup(ext, 'DUPLICATE_WITHIN_FILE', importId); ok = true; break; } seen.add('p' + ext);
            const h = crmEventHash('gp', ext);
            if (ev.gp.has(ext) || ev.hcp.has(h) || seen.has('fh' + h)) {
              stats.dupGatePasses++; noteDup(ext, 'DUPLICATE_EVENT', ev.gp.get(ext) || importId);
              ok = true; break;
            }
            seen.add('fh' + h);
            const compRaw = str(g('compound'));
            const cid = ensureCompound(maps, compRaw);
            const unitRef = str(g('unit'));
            const unitId = resolveUnit(maps, unitRef, cid, pk);
            const userName = str(g('user'));
            const userId = resolveUser(maps, userName, pk, {});
            B.gp.push([ext, cid, compRaw, unitId, unitRef, userId, userName, str(g('accessType')), N.excelSerialToISO(g('entryDate')), N.excelSerialToISO(g('validUntil')), N.excelSerialToISO(g('createdOn')), period.id, importId]);
            fileCreated.gpExts.push(ext);
            B.fp.push(['GATE_PASS', 'crm', ext, h, null, importId, nowStr]);
            ev.gp.set(ext, importId);
            stats.newGatePasses++; stats.newRecords++;
            ok = true; break;
          }
          case 'HCP_REGISTERED_VEHICLES': {
            const plate = str(g('plate'));
            if (!plate) break;
            const { norm, latin } = N.normalizePlate(plate);
            if (!norm) break;
            const ownerId = str(g('ownerId'));
            const ext = `hcp-reg:${sha256Str(norm + '|' + (ownerId || ''))}`;
            if (seen.has('vr' + ext)) { noteDup(plate, 'DUPLICATE_WITHIN_FILE', importId); ok = true; break; }
            seen.add('vr' + ext);
            const existingByExt = maps.vehFull.get(ext);
            if (existingByExt) {
              stats.unchangedVehicles++; stats.unchangedRecords++;
              noteDup(plate, 'DUPLICATE_VEHICLE', null);
              ok = true; break;
            }
            const existingByPlate = ps('SELECT id, external_id FROM vehicles WHERE plate_norm=?').get(norm);
            if (existingByPlate) {
              stats.duplicates++; stats.unchangedVehicles++; stats.unchangedRecords++;
              noteDup(plate, 'DUPLICATE_VEHICLE', null);
              ok = true; break;
            }
            const firstName = str(g('firstName'));
            const lastName = str(g('lastName'));
            const userName = [firstName, lastName].filter(Boolean).join(' ') || null;
            const userId = resolveVehicleOwner(userName, pk, maps, importId, stats, sourceKind === 'HCP_MANUAL_UPLOAD' ? hcpCompoundId : null);
            const validStart = N.excelSerialToISO(g('start'));
            const validEnd = N.excelSerialToISO(g('end'));
            const status = validEnd && validEnd < period.period_end ? 'Deactivated' : 'Approved By PHD';
            const vals = { make: str(g('brand')), model: str(g('vtype')), year: null, plate_original: plate, user_id: userId, status };
            B.veh.push([ext, vals.make, vals.model, vals.year, plate, norm, latin, userId, userName, vals.status, validStart, pk, pk]);
            fileCreated.vehExts.push(ext);
            stats.newVehicles++; stats.newRecords++;
            ok = true; break;
          }
          case 'HCP_VEHICLE_ACCESS': {
            const plate = str(g('plate'));
            const { norm, latin } = N.normalizePlate(plate);
            const lot = str(g('parkingLot'));
            let cid;
            const eventSourceKind = sourceKind === 'HCP_MANUAL_UPLOAD' ? 'HCP_MANUAL_UPLOAD'
              : sourceKind === 'HCP_API_SYNC' ? 'HCP_API_SYNC' : null;
            const fpSystem = eventSourceKind === 'HCP_MANUAL_UPLOAD' ? 'hcp-manual'
              : eventSourceKind === 'HCP_API_SYNC' ? 'hcp-api' : 'hcp';
            if (eventSourceKind === 'HCP_MANUAL_UPLOAD') {
              cid = hcpCompoundId;
            } else {
              const cname = (lot && lotMap[lot]) || lotMap[lot || ''] || 'Badya';
              cid = ensureCompound(maps, cname);
            }
            const dir = /exit/i.test(String(g('direction') || '')) ? 'EXIT' : 'ENTRY';
            const resStr = String(g('result') || '');
            const result = /pass/i.test(resStr) && !/not/i.test(resStr) ? 'PASS' : 'NOT_PASSED';
            const enterISO = N.excelSerialToISO(g('enterTime')), exitISO = N.excelSerialToISO(g('exitTime'));
            const owner = str(g('owner'));
            const h = hcpEventHash({ normPlate: norm, enterTime: enterISO, exitTime: exitISO, gate: str(g('gate')), direction: dir, method: str(g('method')), result, ownerNorm: N.normalizeName(owner) });
            if (seen.has('fh' + h) || ev.hcp.has(h)) {
              stats.dupVehicleEvents++;
              if (!seen.has('fh' + h)) noteDup(`${plate || '?'} @ ${enterISO || exitISO || '?'}`, 'DUPLICATE_EVENT', null);
              else noteDup(`${plate || '?'} @ ${enterISO || exitISO || '?'}`, 'DUPLICATE_WITHIN_FILE', importId);
              ok = true; break;
            }
            seen.add('fh' + h);
            let ownerId = null;
            if (owner) {
              const key = N.normalizeName(owner);
              const hit = ps("SELECT crm_user_id FROM identity_maps WHERE source_kind='hcp_owner' AND source_key=? AND status='MATCHED'").get(key);
              if (hit && hit.crm_user_id) ownerId = hit.crm_user_id;
              else { const uid = maps.usersByName.get(key); if (uid) ownerId = uid; }
            }
            B.hcp.push([period.id, plate, norm, latin, lot, cid, dir, enterISO, exitISO, str(g('gate')), str(g('method')), result, str(g('reason')), str(g('vehicleList')), owner, ownerId, str(g('country')), str(g('vtype')), str(g('color')), str(g('brand')), h, importId, eventSourceKind, null]);
            fileCreated.hcpHashes.push(h);
            B.fp.push(['HCP_VEHICLE_ACCESS', fpSystem, null, h, null, importId, nowStr]);
            ev.hcp.add(h);
            stats.newVehicleEvents++; stats.newRecords++;
            ok = true; break;
          }
          case 'HANDOVER': {
            const unitCode = str(g('unit')); if (!unitCode) break;
            const unitId = resolveUnit(maps, unitCode, null, pk);
            const hd = g('handover');
            const handoverDate = (typeof hd === 'number') ? N.excelSerialToISO(hd) : (hd ? String(hd).trim() : null);
            const pl = g('planned');
            const plannedISO = (typeof pl === 'number') ? N.excelSerialToISO(pl) : str(pl);
            const h = handoverEventHash({ unitCode, category: str(g('category')), zone: str(g('zone')), handoverDate, finishing: str(g('finishing')), resident: str(g('resident')), planned: plannedISO });
            if (seen.has('fh' + h) || ev.ho.has(h)) {
              stats.dupHandovers++; noteDup(unitCode, 'DUPLICATE_EVENT', null);
              ok = true; break;
            }
            seen.add('fh' + h);
            B.ho.push([period.id, unitCode, unitId, str(g('category')), str(g('zone')), handoverDate, str(g('finishing')), str(g('resident')), plannedISO, h, importId]);
            fileCreated.hoHashes.push(h);
            B.fp.push(['HANDOVER', 'crm', unitCode, h, null, importId, nowStr]);
            ev.ho.add(h);
            stats.newHandovers++; stats.newRecords++;
            ok = true; break;
          }
        }
        if (ok) stats.processed++; else stats.rejected++;
      } catch (e) { stats.rejected++; }
      if (B.raw.length >= 5000) flush();
    }
  } catch (fileErr) {
    // File-level atomicity: roll back this file's partial rows, then rethrow.
    rollbackFile();
    throw fileErr;
  }
  flush();
  flushDups();
  bulkTouch('users', touched.users, pk);
  bulkTouch('units', touched.units, pk);
  stats.truncated = EXPORT_LIMITS.includes(stats.sourceRows);
  return stats;
}

// ---------- identity auto-match ----------
function autoMatch(periodId, M) {
  const maps = M || loadMaps();
  let matched = 0; const candidates = [];
  const owners = db.prepare("SELECT DISTINCT owner_raw FROM hcp_vehicle_events WHERE period_id=? AND owner_raw IS NOT NULL").all(periodId);
  // count name frequency for ambiguity
  const nameCount = {};
  for (const r of db.prepare('SELECT norm_name n, COUNT(*) c FROM users WHERE norm_name IS NOT NULL GROUP BY norm_name').all()) nameCount[r.n] = r.c;
  for (const o of owners) {
    const key = N.normalizeName(o.owner_raw);
    const existing = ps("SELECT * FROM identity_maps WHERE source_kind='hcp_owner' AND source_key=?").get(key);
    if (existing) { if (existing.status === 'MATCHED') matched++; continue; }
    if ((nameCount[key] || 0) === 1) {
      const uid = maps.usersByName.get(key);
      ps(`INSERT OR REPLACE INTO identity_maps(source_kind,source_key,crm_user_id,match_method,confidence,status,created_at)
        VALUES('hcp_owner',?,?,'NAME_EXACT_SINGLE',0.9,'MATCHED',datetime('now'))`).run(key, uid);
      ps('UPDATE hcp_vehicle_events SET owner_user_id=? WHERE period_id=? AND owner_raw=?').run(uid, periodId, o.owner_raw);
      matched++;
    } else if ((nameCount[key] || 0) > 1) {
      const opts = ps('SELECT id,name,mobile,status,registered_as FROM users WHERE norm_name=? LIMIT 5').all(key);
      candidates.push({ hcpName: o.owner_raw, options: opts.map(u => ({ id: u.id, name: u.name, mobile: u.mobile, status: u.status, registeredAs: u.registered_as })), confidence: 0.8, method: 'NAME_EXACT_MULTI' });
      ps(`INSERT OR IGNORE INTO identity_maps(source_kind,source_key,match_method,confidence,status,created_at)
        VALUES('hcp_owner',?,'NAME_EXACT_MULTI',0.8,'POSSIBLE_MATCH',datetime('now'))`).run(key);
    } else {
      ps(`INSERT OR IGNORE INTO identity_maps(source_kind,source_key,match_method,confidence,status,created_at)
        VALUES('hcp_owner',?,'NO_MATCH',0,'UNMATCHED',datetime('now'))`).run(key);
      candidates.push({ hcpName: o.owner_raw, options: [], confidence: 0, method: 'NO_MATCH' });
    }
  }
  const hcpPlates = new Set(db.prepare('SELECT DISTINCT plate_normalized p FROM hcp_vehicle_events WHERE plate_normalized IS NOT NULL').all().map(r => r.p));
  const hcpLatin = new Set(db.prepare('SELECT DISTINCT plate_normalized_latin p FROM hcp_vehicle_events WHERE plate_normalized_latin IS NOT NULL').all().map(r => r.p));
  let plateMatches = 0;
  for (const v of db.prepare('SELECT plate_norm, plate_norm_latin FROM vehicles WHERE plate_norm IS NOT NULL').all()) {
    if (hcpPlates.has(v.plate_norm) || (v.plate_norm_latin && hcpLatin.has(v.plate_norm_latin))) plateMatches++;
  }
  return { hcpOwnersMatched: matched, hcpOwnerCandidates: candidates.length, crmVehiclesSeenInHcp: plateMatches };
}

// ---------- metrics snapshot ----------
function snapshotMetrics(periodId, periodKey) {
  const M = [];
  const compounds = db.prepare('SELECT id FROM compounds').all().map(r => r.id);
  const scopes = [null, ...compounds];
  const scalar = (sql, params) => { const r = db.prepare(sql).get(...(params || [])); return r ? Object.values(r)[0] : 0; };
  for (const c of scopes) {
    const put = (key, val) => M.push([periodId, key, c, typeof val === 'number' ? val : null, typeof val === 'number' ? null : String(val == null ? '' : val)]);
    const cf = c == null ? '' : ' AND compound_id=?';
    const cp = c == null ? [] : [c];
    put('active_units', scalar('SELECT COUNT(*) v FROM units WHERE 1=1' + cf, cp));
    if (c == null) {
      put('users_total', scalar('SELECT COUNT(*) v FROM users'));
      put('users_active', scalar("SELECT COUNT(*) v FROM users WHERE status='Active'"));
      put('units_with_users', scalar("SELECT COUNT(DISTINCT unit_id) v FROM user_units WHERE status='Active'"));
      put('vehicles_registered', scalar('SELECT COUNT(*) v FROM vehicles'));
    } else {
      put('users_total', scalar("SELECT COUNT(DISTINCT uu.user_id) v FROM user_units uu WHERE uu.status='Active' AND uu.compound_id=?", [c]));
      put('users_active', scalar("SELECT COUNT(DISTINCT uu.user_id) v FROM user_units uu JOIN users u ON u.id=uu.user_id WHERE uu.status='Active' AND u.status='Active' AND uu.compound_id=?", [c]));
      put('units_with_users', scalar("SELECT COUNT(DISTINCT unit_id) v FROM user_units WHERE status='Active' AND compound_id=?", [c]));
      put('vehicles_registered', 0);
    }
    put('hcp_events', scalar('SELECT COUNT(*) v FROM hcp_vehicle_events WHERE period_id=?' + cf, [periodId, ...cp]));
    put('hcp_unique_vehicles', scalar('SELECT COUNT(DISTINCT plate_normalized) v FROM hcp_vehicle_events WHERE period_id=? AND plate_normalized IS NOT NULL' + cf, [periodId, ...cp]));
    put('hcp_auto_open', scalar("SELECT COUNT(*) v FROM hcp_vehicle_events WHERE period_id=? AND result='PASS'" + cf, [periodId, ...cp]));
    put('hcp_auto_unique', scalar("SELECT COUNT(DISTINCT plate_normalized) v FROM hcp_vehicle_events WHERE period_id=? AND result='PASS' AND plate_normalized IS NOT NULL" + cf, [periodId, ...cp]));
    put('invitations_total', c == null ? scalar('SELECT COUNT(*) v FROM invitations WHERE period_id=?', [periodId]) : 0);
    put('gatepass_total', scalar('SELECT COUNT(*) v FROM gate_passes WHERE period_id=?' + cf, [periodId, ...cp]));
  }
  const ins = ps('INSERT OR REPLACE INTO period_metrics(period_id,metric_key,compound_id,value_num,value_text) VALUES(?,?,?,?,?)');
  withTx(() => { for (const r of M) ins.run(...r); });
}

/* Monthly snapshot: state of the DB at end of the reporting period (spec §14). */
function writeSnapshot(periodKey, importId, summary) {
  const masterCounts = {};
  for (const t of ['compounds', 'units', 'users', 'user_units', 'vehicles', 'invitations', 'gate_passes', 'hcp_vehicle_events', 'handover']) {
    try { masterCounts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch (e) { masterCounts[t] = 0; }
  }
  const period = ps('SELECT id FROM reporting_periods WHERE period_key=?').get(periodKey);
  const metrics = period ? db.prepare('SELECT metric_key, compound_id, value_num FROM period_metrics WHERE period_id=?').all(period.id) : [];
  ps(`INSERT OR REPLACE INTO period_snapshots(period_key,import_id,master_counts,metrics) VALUES(?,?,?,?)`)
    .run(periodKey, importId, JSON.stringify(masterCounts), JSON.stringify(metrics));
  ilog(importId, 'info', 'metrics', `${periodKey} Snapshot written (${Object.entries(masterCounts).map(([k, v]) => `${k}=${v}`).join(', ')}).`);
}

/* Rollback: reverse one import without destroying other months (spec §16). */
function rollbackImport(importId, actor = 'admin') {
  const imp = ps('SELECT * FROM imports WHERE id=?').get(importId);
  if (!imp) throw new Error('Import not found');
  if (!['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'].includes(imp.status)) throw new Error(`Only completed/failed imports can be rolled back (status=${imp.status}).`);
  if (imp.status === 'ROLLED_BACK') throw new Error('Import already rolled back.');
  ilog(importId, 'warn', 'rollback', `Rollback started by ${actor}.`);
  const periodId = imp.period_id;
  let removedEvents = 0;
  withTx(() => {
    for (const t of ['hcp_vehicle_events', 'handover', 'invitations', 'gate_passes']) {
      const r = db.prepare(`DELETE FROM ${t} WHERE import_id=?`).run(importId);
      removedEvents += Number(r.changes || 0);
    }
    db.prepare('DELETE FROM event_fingerprints WHERE first_seen_import_id=?').run(importId);
    // Restore masters changed by this import (only where no later import overwrote them).
    const changes = db.prepare('SELECT * FROM changed_records WHERE import_id=? ORDER BY id').all(importId);
    const byEntity = new Map();
    for (const c of changes) {
      const k = `${c.entity_type}:${c.entity_id}`;
      if (!byEntity.has(k)) byEntity.set(k, []);
      byEntity.get(k).push(c);
    }
    const tableOf = { user: 'users', unit: 'units', vehicle: 'vehicles', user_unit: 'user_units' };
    for (const [key, list] of byEntity) {
      const [etype, eid] = key.split(':');
      const table = tableOf[etype];
      if (!table) continue;
      const cur = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(Number(eid));
      if (!cur) continue;
      // Only restore fields whose current value still equals what this import set (no later change).
      const sets = [];
      for (const c of list) {
        const col = c.field_name;
        if (!(col in cur)) continue;
        if (!sameVal(cur[col], c.new_value)) continue; // later import changed it — keep newer value
        sets.push([col, c.old_value]);
      }
      if (sets.length) {
        db.prepare(`UPDATE ${table} SET ${sets.map(([c]) => `${c}=?`).join(',')} WHERE id=?`)
          .run(...sets.map(([, v]) => v), Number(eid));
      }
    }
    // Delete masters created by this import (CREATED history, untouched since).
    for (const [table, hist] of [['users', 'user_history'], ['units', 'unit_history'], ['vehicles', 'vehicle_history'], ['user_units', 'user_unit_history']]) {
      const rows = db.prepare(`SELECT * FROM ${hist} WHERE import_id=? AND change_type='CREATED'`).all(importId);
      for (const h of rows) {
        const idCol = table === 'user_units' ? 'user_unit_id' : table === 'users' ? 'user_id' : table === 'units' ? 'unit_id' : 'vehicle_id';
        const eid = h[idCol];
        const later = db.prepare(`SELECT COUNT(*) c FROM ${hist} WHERE ${idCol}=? AND id>?`).get(eid, h.id).c;
        if (!later) db.prepare(`DELETE FROM ${table} WHERE id=?`).run(eid);
      }
      db.prepare(`DELETE FROM ${hist} WHERE import_id=?`).run(importId);
    }
    db.prepare('DELETE FROM raw_rows WHERE import_id=?').run(importId);
    db.prepare(`UPDATE imports SET status='ROLLED_BACK', completed_at=datetime('now') WHERE id=?`).run(importId);
  });
  // Refresh KPIs for the affected period.
  if (periodId) {
    const p = ps('SELECT period_key FROM reporting_periods WHERE id=?').get(periodId);
    if (p) snapshotMetrics(periodId, p.period_key);
  }
  ilog(importId, 'warn', 'rollback', `Rollback complete: ${removedEvents} event rows removed, masters restored. Historical data from other imports preserved (soft semantics).`);
  audit('import.rollback', `Import #${importId} rolled back by ${actor}: ${removedEvents} events removed`, actor);
  return { ok: true, removedEvents };
}

/* Delete a whole reporting month so it can be uploaded again after a mistake.
   Removes period-scoped data (events, fingerprints, raw rows/files, file fingerprints,
   snapshots, metrics) and marks the month's imports DELETED (audit rows kept).
   Master records (users/units/vehicles/relations) are cumulative across months and are
   intentionally preserved — re-uploading the corrected files fixes them via UPSERT. */
function deletePeriodData(periodKey, actor = 'admin') {
  if (!periodKey || !/^\d{4}-\d{2}$/.test(periodKey)) throw new Error('Invalid reporting period. Expected YYYY-MM.');
  const period = ps('SELECT * FROM reporting_periods WHERE period_key=?').get(periodKey);
  if (!period) throw new Error('Period not found: ' + periodKey);
  const impIds = db.prepare('SELECT id FROM imports WHERE period_id=? OR reporting_period=? OR detected_period_key=?')
    .all(period.id, periodKey, periodKey).map(r => r.id);
  const deleted = {};
  const delIn = (table, col, vals) => {
    let n = 0;
    for (let i = 0; i < vals.length; i += 500) {
      const s = vals.slice(i, i + 500);
      n += Number(db.prepare(`DELETE FROM ${table} WHERE ${col} IN (${s.map(() => '?').join(',')})`).run(...s).changes || 0);
    }
    return n;
  };
  withTx(() => {
    const hcpHashes = db.prepare('SELECT event_hash FROM hcp_vehicle_events WHERE period_id=? AND event_hash IS NOT NULL').all(period.id).map(r => r.event_hash);
    const hoHashes = db.prepare('SELECT event_hash FROM handover WHERE period_id=? AND event_hash IS NOT NULL').all(period.id).map(r => r.event_hash);
    const invExts = db.prepare('SELECT external_id FROM invitations WHERE period_id=? AND external_id IS NOT NULL').all(period.id).map(r => String(r.external_id));
    const gpExts = db.prepare('SELECT external_id FROM gate_passes WHERE period_id=? AND external_id IS NOT NULL').all(period.id).map(r => String(r.external_id));
    deleted.hcp_vehicle_events = Number(db.prepare('DELETE FROM hcp_vehicle_events WHERE period_id=?').run(period.id).changes || 0);
    deleted.gate_passes = Number(db.prepare('DELETE FROM gate_passes WHERE period_id=?').run(period.id).changes || 0);
    deleted.invitations = Number(db.prepare('DELETE FROM invitations WHERE period_id=?').run(period.id).changes || 0);
    deleted.handover = Number(db.prepare('DELETE FROM handover WHERE period_id=?').run(period.id).changes || 0);
    if (hcpHashes.length) delIn('event_fingerprints', 'event_hash', hcpHashes);
    if (hoHashes.length) delIn('event_fingerprints', 'event_hash', hoHashes);
    for (const ext of invExts) db.prepare("DELETE FROM event_fingerprints WHERE event_type='INVITATION' AND source_event_id=?").run(ext);
    for (const ext of gpExts) db.prepare("DELETE FROM event_fingerprints WHERE event_type='GATE_PASS' AND source_event_id=?").run(ext);
    deleted.event_fingerprints = hcpHashes.length + hoHashes.length + invExts.length + gpExts.length;
    deleted.raw_rows = Number(db.prepare('DELETE FROM raw_rows WHERE period_id=?').run(period.id).changes || 0);
    deleted.raw_files = Number(db.prepare('DELETE FROM raw_files WHERE period_id=?').run(period.id).changes || 0);
    deleted.source_files = 0; deleted.duplicate_records = 0;
    for (const iid of impIds) {
      deleted.source_files += Number(db.prepare('DELETE FROM source_files WHERE import_id=?').run(iid).changes || 0);
      deleted.duplicate_records += Number(db.prepare('DELETE FROM duplicate_records WHERE import_id=?').run(iid).changes || 0);
      ilog(iid, 'warn', 'delete', `Month ${periodKey} deleted by ${actor}: period data removed, import marked DELETED. Re-upload the corrected files to restore it.`);
    }
    deleted.period_snapshots = Number(db.prepare('DELETE FROM period_snapshots WHERE period_key=?').run(periodKey).changes || 0);
    deleted.period_metrics = Number(db.prepare('DELETE FROM period_metrics WHERE period_id=?').run(period.id).changes || 0);
    if (impIds.length) db.prepare(`UPDATE imports SET status='DELETED' WHERE id IN (${impIds.map(() => '?').join(',')})`).run(...impIds);
  });
  audit('period.deleted', `Month ${periodKey} deleted by ${actor}: ${JSON.stringify(deleted)} (${impIds.length} imports marked DELETED)`, actor);
  return { ok: true, period: periodKey, imports: impIds, deleted };
}

/* Full database reset (admin): wipe all imported data for a clean start.
   Refuses while an import is in progress. Settings (mappings, AI config) are kept;
   extracted staging dirs are removed; original uploads are kept on disk. */
function resetDatabase(actor = 'admin') {
  const active = db.prepare("SELECT COUNT(*) c FROM imports WHERE status IN ('PROCESSING','VALIDATING','UPLOADED','ANALYZING','staged','processing')").get().c;
  if (active) throw new Error('Cannot reset while an import is in progress. Cancel or finish it first.');
  const tables = ['event_fingerprints', 'changed_records', 'duplicate_records', 'import_log',
    'identity_maps',
    'user_history', 'unit_history', 'vehicle_history', 'user_unit_history',
    'raw_rows', 'raw_files', 'source_files',
    'hcp_vehicle_events', 'handover', 'invitations', 'gate_passes',
    'user_units', 'vehicles', 'users', 'units',
    'period_metrics', 'period_snapshots',
    'compound_aliases', 'compounds', 'imports', 'reporting_periods', 'audit_log'];
  const deleted = {};
  withTx(() => {
    for (const t of tables) deleted[t] = Number(db.prepare(`DELETE FROM ${t}`).run().changes || 0);
    try { db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${tables.map(t => `'${t}'`).join(',')})`); } catch (e) { /* no autoincrement tracker */ }
  });
  try {
    for (const d of fs.readdirSync(RAW_DIR, { withFileTypes: true })) {
      if (d.isDirectory() && /^import_\d+$/.test(d.name)) fs.rmSync(path.join(RAW_DIR, d.name), { recursive: true, force: true });
    }
  } catch (e) { /* best effort */ }
  audit('db.reset', `Full database cleared by ${actor}`, actor);
  return { ok: true, deleted };
}

function getImportSummary(importId) {
  const imp = ps('SELECT * FROM imports WHERE id=?').get(importId);
  if (!imp) throw new Error('Import not found');
  let summary = null;
  try { summary = imp.log && imp.log.startsWith('{') ? JSON.parse(imp.log) : null; } catch (e) { summary = null; }
  const files = db.prepare('SELECT * FROM raw_files WHERE import_id=?').all(importId);
  const sources = db.prepare('SELECT * FROM source_files WHERE import_id=?').all(importId);
  const log = db.prepare('SELECT * FROM import_log WHERE import_id=? ORDER BY id').all(importId);
  return { import: imp, summary, files, sources, log };
}

module.exports = { stageUpload, processImport, ingestFile, extractZip, assertSafeEntry, listSheets, readSheetRows, getOrCreatePeriod, detectPeriodFromRows, autoMatch, snapshotMetrics, writeSnapshot, rollbackImport, deletePeriodData, resetDatabase, repairVehicleOwnerLinks, resolveVehicleOwner, getImportSummary, backfillEventFingerprints, hcpEventHash, handoverEventHash, crmEventHash, sha256File, sha256Str, workflowForDataset, SOURCE_KINDS, CRM_DATASETS, HCP_DATASETS, EXPORT_LIMITS, ZIP_LIMITS, PROCESSING_VERSION };
