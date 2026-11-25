'use strict';
/* Read-only database inventory: table row counts, periods and import status.
   Usage: node scripts/db-inventory.js  (honours DATABASE_URL / PG* vars) */
const { db } = require('../backend/db');

const tables = db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT LIKE 'sqlite_%' ORDER BY table_name").all().map(r => r.name);

let dbLabel;
const rawUrl = process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING;
if (rawUrl) {
  try {
    const u = new URL(rawUrl);
    dbLabel = `${u.hostname}:${u.port || 5432}/${u.pathname.replace(/^\//, '')}`;
  } catch (_) {
    dbLabel = 'DATABASE_URL (configured)';
  }
} else {
  dbLabel = `${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'palm_hills'}`;
}
console.log('DATABASE: ' + dbLabel);
console.log('\nTABLE ROW COUNTS');
for (const t of tables) {
  try {
    const c = db.prepare('SELECT COUNT(*) c FROM "' + t + '"').get().c;
    console.log('  ' + t.padEnd(26) + c);
  } catch (e) {
    console.log('  ' + t.padEnd(26) + 'ERROR: ' + e.message);
  }
}

console.log('\nREPORTING PERIODS');
const periods = db.prepare('SELECT id, period_key, period_name, period_start, period_end, status FROM reporting_periods ORDER BY period_key').all();
for (const p of periods) console.log('  ' + JSON.stringify(p));

console.log('\nIMPORTS');
const imports = db.prepare('SELECT id, status, reporting_period, source_filename, successful_files, warning_count, error_count FROM imports ORDER BY id').all();
for (const i of imports) console.log('  ' + JSON.stringify(i));
