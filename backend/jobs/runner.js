'use strict';
/* Background import runner.
   - Starts each import in a child Node process (see run-import.js) so long
     synchronous SQLite/Excel work never blocks dashboard API requests.
   - De-duplicates concurrent starts for the same import id.
   - Records the worker PID so a restart can distinguish a live orphan worker
     from an interrupted import. */
const { spawn } = require('child_process');
const path = require('path');
const { db } = require('../db');

const RUNNER = path.join(__dirname, 'run-import.js');
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const active = new Map(); // importId(string) -> ChildProcess

function ilog(importId, level, phase, message) {
  try {
    db.prepare("INSERT INTO import_log(import_id,ts,level,phase,message) VALUES(?,datetime('now'),?,?,?)")
      .run(importId, level || 'info', phase || 'process', String(message).slice(0, 2000));
  } catch (_) { /* ignore logging failures */ }
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}

function isRunning(importId) {
  return active.has(String(importId));
}

function startImport(importId, periodKey, overrides) {
  const key = String(importId);
  if (active.has(key)) return { started: false, reason: 'already-running' };
  const args = [RUNNER, String(importId)];
  if (periodKey) args.push(String(periodKey));
  const env = { ...process.env };
  if (overrides && Object.keys(overrides).length) env.IMPORT_OVERRIDES = JSON.stringify(overrides);

  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  active.set(key, child);
  try { db.prepare('UPDATE imports SET runner_pid=? WHERE id=?').run(child.pid, importId); } catch (_) {}

  let stderr = '';
  child.stderr.on('data', d => { stderr += String(d); if (stderr.length > 8000) stderr = stderr.slice(-8000); });

  child.on('error', (e) => {
    active.delete(key);
    const msg = 'Could not start import worker: ' + (e && e.message ? e.message : e);
    ilog(importId, 'error', 'process', msg);
    try {
      const imp = db.prepare('SELECT status FROM imports WHERE id=?').get(importId);
      if (imp && !['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED', 'ROLLED_BACK', 'DELETED'].includes(imp.status)) {
        db.prepare("UPDATE imports SET status='FAILED', log=?, completed_at=datetime('now'), runner_pid=NULL WHERE id=?").run(msg, importId);
      }
    } catch (_) {}
  });

  child.on('exit', (code, signal) => {
    active.delete(key);
    try { db.prepare('UPDATE imports SET runner_pid=NULL WHERE id=?').run(importId); } catch (_) {}
    if (code === 0) return;
    const msg = ('Import worker exited unexpectedly (' + (signal || ('code ' + code)) + ')'
      + (stderr ? ': ' + stderr.trim().split('\n').slice(-3).join(' | ') : '')).slice(0, 1000);
    ilog(importId, 'error', 'process', msg);
    try {
      const imp = db.prepare('SELECT status FROM imports WHERE id=?').get(importId);
      if (imp && !['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED', 'ROLLED_BACK', 'DELETED'].includes(imp.status)) {
        db.prepare("UPDATE imports SET status='FAILED', log=?, completed_at=datetime('now') WHERE id=?").run(msg, importId);
      }
    } catch (_) {}
  });

  return { started: true, pid: child.pid };
}

/* Startup recovery: an import left in PROCESSING/VALIDATING survived a restart.
   If its worker is still alive (orphan), leave it alone; otherwise mark it
   FAILED so the operator can Retry — reprocessing is idempotent. */
function recoverStuckImports() {
  let rows = [];
  try {
    rows = db.prepare("SELECT id,status,runner_pid FROM imports WHERE status IN ('PROCESSING','VALIDATING')").all();
  } catch (_) { return { recovered: 0 }; }
  let recovered = 0;
  for (const r of rows) {
    if (isAlive(r.runner_pid)) continue;
    const msg = 'Processing was interrupted (server restart). Click Retry to resume — re-processing is idempotent and will not duplicate records.';
    try {
      db.prepare("UPDATE imports SET status='FAILED', log=?, completed_at=datetime('now'), runner_pid=NULL WHERE id=?").run(msg, r.id);
      ilog(r.id, 'warn', 'recovery', msg);
      recovered++;
    } catch (_) {}
  }
  return { recovered };
}

module.exports = { startImport, isRunning, recoverStuckImports };
