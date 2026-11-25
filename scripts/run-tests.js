#!/usr/bin/env node
'use strict';
/* Cross-platform PostgreSQL test launcher.
 *
 * Sets NODE_ENV=test so backend/db.js refuses to run against the production
 * DATABASE_URL, then gives every test file its own database cloned from one
 * of two templates:
 *   - empty schema  (most tests build their own fixtures)
 *   - seeded data   (kpi.test.js needs the legacy September 2026 dataset)
 *
 * This avoids node --test's default parallel processes racing on DDL and on
 * each other's rows. TEST_DATABASE_URL must point at a disposable database on
 * a server where the user can CREATE/DROP databases.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const root = path.join(__dirname, '..');
const files = [
  'tests/ingest.test.js',
  'tests/kpi.test.js',
  'tests/phase2.test.js',
  'tests/crm-hcp-import.test.js',
  'tests/hcp.test.js',
  'tests/hcp-tls.test.js',
  'tests/hcp-phase1.test.js',
  'tests/hcp-vpn.test.js',
  'tests/hcp-artemis-v26.test.js',
];
const SEEDED_FILES = new Set(['tests/kpi.test.js']);

if (!process.env.TEST_DATABASE_URL) {
  console.error('Set TEST_DATABASE_URL to a disposable PostgreSQL database before running npm test.');
  process.exit(1);
}

const baseUrl = new URL(process.env.TEST_DATABASE_URL);
const runTag = `${Date.now().toString(36)}_${process.pid}`;
const dbName = (suffix) => `pht_${runTag}_${suffix}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 63);
const ident = (name) => `"${name.replace(/"/g, '')}"`;

function urlFor(name) {
  const u = new URL(baseUrl.toString());
  u.pathname = `/${name}`;
  return u.toString();
}
function adminUrl() {
  const u = new URL(baseUrl.toString());
  u.pathname = '/postgres';
  return u.toString();
}

const admin = new Client({ connectionString: adminUrl() });
const created = [];

async function createDatabase(name, template) {
  if (template) await admin.query(`CREATE DATABASE ${ident(name)} TEMPLATE ${ident(template)}`);
  else await admin.query(`CREATE DATABASE ${ident(name)}`);
  created.push(name);
}
async function dropDatabase(name) {
  await admin.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
}

function testEnv(databaseUrl) {
  return { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: databaseUrl };
}
function runSetup(args, databaseUrl, label) {
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    env: testEnv(databaseUrl),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`${label} failed (exit ${r.status})`);
    if (r.stdout) console.error(r.stdout.slice(-4000));
    if (r.stderr) console.error(r.stderr.slice(-4000));
    throw new Error(label + ' failed');
  }
}
function runTest(file, databaseUrl) {
  const r = spawnSync(process.execPath, ['--test', file], {
    cwd: root,
    env: testEnv(databaseUrl),
    stdio: 'inherit',
  });
  return r.status == null ? 1 : r.status;
}

async function main() {
  await admin.connect();
  try {
    const emptyTemplate = dbName('empty');
    const seededTemplate = dbName('seed');

    console.log(`Preparing isolated PostgreSQL test databases on ${baseUrl.hostname}:${baseUrl.port || 5432} ...`);
    await createDatabase(emptyTemplate);
    await createDatabase(seededTemplate);

    runSetup(['-e', "require('./backend/db').migrate()"], urlFor(emptyTemplate), 'Empty template schema');
    runSetup(['scripts/migrate-sqlite-to-postgres.js'], urlFor(seededTemplate), 'Seeded template data');
    runSetup(['-e', "require('./backend/db').db.exec('ANALYZE')"], urlFor(seededTemplate), 'Seeded template statistics');

    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = dbName(`t${String(i + 1).padStart(2, '0')}`);
      const seeded = SEEDED_FILES.has(file);
      await createDatabase(name, seeded ? seededTemplate : emptyTemplate);
      console.log(`\n=== ${file} (${seeded ? 'seeded data' : 'empty schema'}) ===`);
      if (runTest(file, urlFor(name)) !== 0) failed++;
      await dropDatabase(name);
    }

    await dropDatabase(emptyTemplate);
    await dropDatabase(seededTemplate);

    if (failed) {
      console.error(`\n${failed} test file(s) failed.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll test files passed.');
    }
  } finally {
    for (const name of created.slice().reverse()) {
      try { await dropDatabase(name); } catch (_) { /* best effort */ }
    }
    await admin.end();
  }
}

main().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
