'use strict';
/* Import worker: runs ONE monthly import in its own process so the Express
   event loop stays responsive. Progress/logs are written to SQLite by the
   ingest layer; this process only reports failure. */
const importId = Number(process.argv[2]);
const periodKey = process.argv[3] || undefined;
let overrides = {};
try { overrides = process.env.IMPORT_OVERRIDES ? JSON.parse(process.env.IMPORT_OVERRIDES) : {}; } catch (_) { overrides = {}; }

function markFailed(message) {
  try {
    const { db } = require('../db');
    db.prepare("UPDATE imports SET status='FAILED', log=?, completed_at=datetime('now'), runner_pid=NULL WHERE id=?")
      .run(String(message || 'Import failed').slice(0, 1000), importId);
    db.prepare("INSERT INTO import_log(import_id,ts,level,phase,message) VALUES(?,datetime('now'),'error','process',?)")
      .run(importId, String(message || 'Import failed').slice(0, 1000));
  } catch (e) { /* database unavailable — nothing else we can do */ }
}

if (!Number.isInteger(importId) || importId <= 0) {
  console.error('Invalid import id');
  process.exit(2);
}

try {
  const { processImport } = require('../ingest');
  processImport(importId, periodKey, overrides);
  process.exit(0);
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  markFailed(msg);
  console.error(msg);
  process.exit(1);
}
