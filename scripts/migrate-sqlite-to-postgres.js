#!/usr/bin/env node
'use strict';
/* One-time logical migration from the legacy SQLite file to Azure PostgreSQL.
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-postgres.js --dry-run
 *   node scripts/migrate-sqlite-to-postgres.js
 *   node scripts/migrate-sqlite-to-postgres.js --truncate   (destructive)
 *
 * Source: SQLITE_SOURCE | DB_PATH | data/app.db
 * Target: DATABASE_URL (or PG* vars), via backend/db.js
 *
 * Inserts explicit primary keys, honours foreign-key order from the SQLite
 * schema, nulls self-referential keys during insert and restores them after,
 * then resets PostgreSQL identity sequences. Existing target rows are kept
 * unless --truncate is supplied; conflicts are skipped with ON CONFLICT DO NOTHING.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TRUNCATE = args.includes('--truncate');
const SOURCE = process.env.SQLITE_SOURCE || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
const BATCH_ROWS = Math.max(1, Number(process.env.MIGRATE_BATCH_ROWS || 200));
const BATCH_BYTES = Math.max(64 * 1024, Number(process.env.MIGRATE_BATCH_BYTES || 8 * 1024 * 1024));

function ident(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Unsafe SQL identifier: ' + name);
  return `"${name}"`;
}

function openSource() {
  if (!fs.existsSync(SOURCE)) throw new Error('SQLite source not found: ' + SOURCE);
  try { return new DatabaseSync(SOURCE, { readOnly: true }); }
  catch (_) { return new DatabaseSync(SOURCE); }
}

function introspect(src) {
  const tables = src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(r => String(r.name));
  const columns = {};
  const fks = {};
  const counts = {};
  for (const t of tables) {
    const q = ident(t);
    columns[t] = src.prepare(`PRAGMA table_info(${q})`).all().map(c => String(c.name));
    fks[t] = src.prepare(`PRAGMA foreign_key_list(${q})`).all().map(f => ({
      table: String(f.table), from: String(f.from), to: String(f.to),
    }));
    counts[t] = Number(src.prepare(`SELECT COUNT(*) c FROM ${q}`).get().c);
  }
  return { tables, columns, fks, counts, order: topoSort(tables, fks) };
}

function topoSort(tables, fks) {
  const set = new Set(tables);
  const deps = new Map(tables.map(t => [t, new Set()]));
  for (const [table, list] of Object.entries(fks)) {
    for (const fk of list) {
      if (set.has(fk.table) && fk.table !== table) deps.get(table).add(fk.table);
    }
  }
  const ordered = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    let progressed = false;
    for (const t of tables) {
      if (!remaining.has(t)) continue;
      if ([...deps.get(t)].every(d => !remaining.has(d))) {
        ordered.push(t);
        remaining.delete(t);
        progressed = true;
      }
    }
    if (!progressed) {
      console.warn('WARNING: foreign-key cycle detected; appending remaining tables in source order:', [...remaining].join(', '));
      for (const t of remaining) ordered.push(t);
      break;
    }
  }
  return ordered;
}

function normalize(value) {
  if (value === undefined) return null;
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value) : value.toString();
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  return value;
}

function dryRun(info) {
  console.log(JSON.stringify({
    source: SOURCE,
    mode: 'dry-run',
    insertOrder: info.order,
    tables: info.tables.map(t => ({
      table: t,
      rows: info.counts[t],
      columns: info.columns[t].length,
      foreignKeys: info.fks[t].length,
    })),
  }, null, 2));
}

function flush(db, table, cols, batch) {
  if (!batch.length) return 0;
  const placeholders = batch.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
  const colList = cols.map(ident).join(',');
  const sql = `INSERT INTO ${ident(table)}(${colList}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;
  const flat = [];
  for (const row of batch) for (const value of row) flat.push(value);
  db.prepare(sql).run(...flat);
  const n = batch.length;
  batch.length = 0;
  return n;
}

function resetSequences(db, tableColumns, tables) {
  for (const t of tables) {
    const identityCols = db.prepare(
      "SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=? AND is_identity='YES'"
    ).all(t).map(r => r.name);
    for (const col of identityCols) {
      const seq = db.prepare('SELECT pg_get_serial_sequence(?,?) AS seq').get(t, col).seq;
      if (!seq) continue;
      db.prepare(`SELECT setval(?, COALESCE((SELECT MAX(${ident(col)}) FROM ${ident(t)}), 0) + 1, false)`).run(seq);
    }
  }
}

function run(info) {
  const { db, migrate, tableColumns } = require('../backend/db');
  console.log('Ensuring PostgreSQL schema exists...');
  migrate();

  if (TRUNCATE) {
    console.warn('WARNING: --truncate supplied; deleting all rows in migrated tables');
    db.exec('BEGIN');
    for (const t of [...info.order].reverse()) db.exec(`TRUNCATE TABLE ${ident(t)} RESTART IDENTITY CASCADE`);
    db.exec('COMMIT');
  }

  const selfUpdates = [];
  let totalInserted = 0;
  let selfRestored = 0;
  let selfFailed = 0;

  for (const t of info.order) {
    const sourceCols = info.columns[t];
    const targetCols = new Set(tableColumns(t));
    const cols = sourceCols.filter(c => targetCols.has(c));
    const missing = sourceCols.filter(c => !targetCols.has(c));
    if (missing.length) console.warn(`  ${t}: skipping source-only columns: ${missing.join(', ')}`);
    if (!cols.length) {
      console.warn(`  ${t}: no matching target columns; skipped`);
      continue;
    }
    const selfCols = (info.fks[t] || [])
      .filter(f => f.table === t && f.from !== f.to && cols.includes(f.from))
      .map(f => f.from);
    if (selfCols.length && !cols.includes('id')) {
      console.warn(`  ${t}: self-referential keys found but no id column; they will remain NULL`);
    }

    const stmt = (() => {
      const list = cols.map(ident).join(',');
      return src.prepare(`SELECT ${list} FROM ${ident(t)}`);
    })();
    const iterator = typeof stmt.iterate === 'function' ? stmt.iterate() : stmt.all()[Symbol.iterator]();
    const batch = [];
    let batchBytes = 0;
    let inserted = 0;

    for (const row of iterator) {
      const values = cols.map(c => normalize(row[c]));
      if (selfCols.length && cols.includes('id') && values[cols.indexOf('id')] != null) {
        const id = values[cols.indexOf('id')];
        for (const c of selfCols) {
          const i = cols.indexOf(c);
          if (values[i] != null) {
            selfUpdates.push({ table: t, column: c, value: values[i], id });
            values[i] = null;
          }
        }
      }
      const approx = JSON.stringify(values).length;
      if (batch.length >= BATCH_ROWS || batchBytes + approx > BATCH_BYTES) {
        inserted += flush(db, t, cols, batch);
        batchBytes = 0;
      }
      batch.push(values);
      batchBytes += approx;
    }
    inserted += flush(db, t, cols, batch);
    totalInserted += inserted;
    console.log(`  ${t}: ${info.counts[t]} source rows, ${inserted} inserted`);
  }

  if (selfUpdates.length) {
    console.log(`Restoring ${selfUpdates.length} self-referential key(s)...`);
    const cache = new Map();
    for (const u of selfUpdates) {
      const key = `${u.table}|${u.column}`;
      if (!cache.has(key)) cache.set(key, db.prepare(`UPDATE ${ident(u.table)} SET ${ident(u.column)}=? WHERE id=?`));
      try { cache.get(key).run(u.value, u.id); selfRestored++; }
      catch (e) { selfFailed++; }
    }
  }

  console.log('Resetting PostgreSQL identity sequences...');
  resetSequences(db, tableColumns, info.order);
  console.log('Re-running migrate() for canonicalization and final guards...');
  migrate();

  console.log(JSON.stringify({
    source: SOURCE,
    inserted: totalInserted,
    selfReferencesRestored: selfRestored,
    selfReferencesSkipped: selfFailed,
    tables: info.order.length,
  }, null, 2));
}

let src;
try {
  src = openSource();
  const info = introspect(src);
  if (DRY_RUN) dryRun(info);
  else {
    console.log(`Migrating ${info.tables.length} tables from ${SOURCE} to PostgreSQL...`);
    run(info);
  }
} catch (e) {
  console.error('Migration failed:', e && e.stack || e);
  process.exitCode = 1;
} finally {
  if (src) src.close();
}
