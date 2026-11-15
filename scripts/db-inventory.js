'use strict';
/* Read-only database inventory: table row counts, periods and import status.
   Usage: node scripts/db-inventory.js  (honours DB_PATH) */
const { db, DB_PATH } = require('../backend/db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);

console.log('DB_PATH: ' + DB_PATH);
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
