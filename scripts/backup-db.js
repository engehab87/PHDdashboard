'use strict';
/* Consistent online backup of the dashboard SQLite database.
   Usage: node scripts/backup-db.js [destination-file]
   VACUUM INTO produces a transactionally consistent copy including WAL content,
   so it is safe to run while the server is serving requests. */
const path = require('path');
const fs = require('fs');
const { db } = require('../backend/db');

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const fallback = path.join(__dirname, '..', 'data', 'backups', 'app-' + stamp + '.db');
const dest = path.resolve(process.argv[2] || fallback);

fs.mkdirSync(path.dirname(dest), { recursive: true });
if (fs.existsSync(dest)) {
  console.error('Refusing to overwrite existing file: ' + dest);
  process.exit(1);
}

const started = Date.now();
// Escape single quotes for the SQL string literal.
db.exec("VACUUM INTO '" + dest.replace(/'/g, "''") + "'");
const size = fs.statSync(dest).size;
console.log(JSON.stringify({
  backup: dest,
  bytes: size,
  seconds: Number(((Date.now() - started) / 1000).toFixed(1))
}, null, 2));
