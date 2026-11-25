'use strict';
/* Logical backup of the dashboard PostgreSQL database.
   Usage: node scripts/backup-db.js [destination-file.json]
   Runs against DATABASE_URL / PG* settings; no local PostgreSQL installation
   or pg_dump binary is required. */
const path = require('path');
const fs = require('fs');
const { db } = require('../backend/db');

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const fallback = path.join(__dirname, '..', 'data', 'backups', 'app-' + stamp + '.json');
const dest = path.resolve(process.argv[2] || fallback);

fs.mkdirSync(path.dirname(dest), { recursive: true });
if (fs.existsSync(dest)) {
  console.error('Refusing to overwrite existing file: ' + dest);
  process.exit(1);
}

const started = Date.now();
const tables = db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name").all().map(r => r.name);
const dump = { createdAt: new Date().toISOString(), source: 'Azure PostgreSQL', tables: {} };
for (const t of tables) {
  dump.tables[t] = db.prepare(`SELECT * FROM "${t}"`).all();
}
fs.writeFileSync(dest, JSON.stringify(dump, null, 2));
console.log(JSON.stringify({
  backup: dest,
  tables: tables.length,
  bytes: fs.statSync(dest).size,
  seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
}, null, 2));
