'use strict';
/* First-run bootstrap: create a Super Admin when no dashboard users exist.
   Credentials come from the environment; otherwise a random password is
   generated once and written to data/bootstrap-admin.txt (owner read/write). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, auditEvent } = require('../db');
const { hashPassword } = require('./passwords');

function ensureBootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) c FROM dashboard_users').get().c;
  if (count > 0) return { created: false };

  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@palmhills.local').trim().toLowerCase();
  const fromEnv = !!process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const password = fromEnv
    ? String(process.env.BOOTSTRAP_ADMIN_PASSWORD)
    : crypto.randomBytes(18).toString('base64url');

  if (password.length < 10) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters');
  }

  const { hash, salt } = hashPassword(password);
  const info = db.prepare(`INSERT INTO dashboard_users(email,display_name,role,status,password_hash,password_salt,auth_source)
    VALUES(?,?,?,'active',?,?,'local')`).run(email, 'Bootstrap Super Admin', 'Super Admin', hash, salt);

  const dataDir = path.join(__dirname, '..', '..', 'data');
  const file = path.join(dataDir, 'bootstrap-admin.txt');
  if (!fromEnv) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, [
      'Palm Hills Community Intelligence — bootstrap administrator',
      'Generated: ' + new Date().toISOString(),
      'Email: ' + email,
      'Password: ' + password,
      '',
      'Sign in, create your real accounts, then delete this file and change/disable this account.',
      ''
    ].join('\n'), { mode: 0o600 });
    console.warn('[security] Bootstrap Super Admin created. Credentials written to ' + file);
  } else {
    console.warn('[security] Bootstrap Super Admin created from environment credentials: ' + email);
  }

  auditEvent({
    action: 'user.bootstrap',
    result: 'OK',
    targetType: 'user',
    targetId: info.lastInsertRowid,
    detail: 'Initial Super Admin created' + (fromEnv ? ' from environment' : ' with generated password file'),
  });

  return { created: true, email, passwordFile: fromEnv ? null : file };
}

module.exports = { ensureBootstrapAdmin };
