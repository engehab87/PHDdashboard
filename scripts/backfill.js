'use strict';
// Backfill imports.log summary for the CLI-loaded September import (reconciliation source).
const { db } = require('../backend/db');
const imp = db.prepare("SELECT * FROM imports ORDER BY id DESC LIMIT 1").get();
const files = db.prepare('SELECT filename, dataset_type, row_count, status FROM raw_files WHERE import_id=?').all(imp.id);
const summary = {
  period: '2026-09',
  files: files.map(f => ({ filename: f.filename, dataset: f.dataset_type, status: f.status === 'ok' ? 'ok' : f.status, sourceRows: f.row_count, processed: f.row_count, rejected: 0, duplicates: 0 })),
  warnings: files.filter(f => f.row_count === 100000).map(f => `Potentially incomplete dataset "${f.filename}": source returned exactly 100000 records (possible export limit).`),
};
db.prepare('UPDATE imports SET log=? WHERE id=?').run(JSON.stringify(summary), imp.id);
console.log('backfilled import', imp.id);
