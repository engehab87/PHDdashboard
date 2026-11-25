#!/usr/bin/env node
/**
 * Palm Hills HCP Dashboard — Cross-platform setup helper
 *
 * Usage:
 *   node setup-dashboard.js                  # generate .env + check environment
 *   node setup-dashboard.js --enable-vpn     # also set FORTICLIENT_ENABLED=true
 *   node setup-dashboard.js --start          # after setup, try to start the server
 *
 * Works on Windows, macOS and Linux. FortiClient CLI control is only meaningful
 * on Windows; on other platforms the script still creates a valid .env and
 * reminds you to connect the VPN manually.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

const args = process.argv.slice(2);
const ENABLE_VPN = args.includes('--enable-vpn');
const START      = args.includes('--start');
const PROJECT_ROOT = process.cwd();

const COLORS = {
  reset:  '\x1b[0m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
};

function step(msg)  { console.log(`\n${COLORS.cyan}==> ${msg}${COLORS.reset}`); }
function ok(msg)    { console.log(`    ${COLORS.green}[OK]${COLORS.reset} ${msg}`); }
function warn(msg)  { console.log(`    ${COLORS.yellow}[!]${COLORS.reset}  ${msg}`); }
function fail(msg)  { console.log(`    ${COLORS.red}[X]${COLORS.reset}  ${msg}`); }

function which(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function generateVaultKey() {
  return crypto.randomBytes(32).toString('hex');
}

function readExistingEnv(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) map[m[1].trim()] = m[2].trim();
  }
  return map;
}

function get(existing, key, fallback) {
  if (existing[key] !== undefined && existing[key] !== '') return existing[key];
  return fallback;
}

// ---------------------------------------------------------------------------
// 1. Project root
// ---------------------------------------------------------------------------
step(`Project root: ${PROJECT_ROOT}`);

// ---------------------------------------------------------------------------
// 2. Node version
// ---------------------------------------------------------------------------
step('Checking Node.js');
const nodeVer = process.versions.node;
ok(`Node.js ${nodeVer}`);
const major = parseInt(nodeVer.split('.')[0], 10);
if (major < 20) {
  warn(`Recommended version is Node.js 24.x (per API spec). You have ${nodeVer}.`);
}
if (!which('npm')) {
  fail('npm not found on PATH');
  process.exit(1);
}
ok(`npm available`);

// ---------------------------------------------------------------------------
// 3. Data directory
// ---------------------------------------------------------------------------
step('Creating data directory');
const dataDir = path.join(PROJECT_ROOT, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  ok(`Created ${dataDir}`);
} else {
  ok('Data directory already exists');
}

// ---------------------------------------------------------------------------
// 4. .env
// ---------------------------------------------------------------------------
step('Preparing .env file');
const envPath = path.join(PROJECT_ROOT, '.env');
const existing = readExistingEnv(envPath);

let vaultKey = existing.HCP_VAULT_KEY;
if (!vaultKey) {
  vaultKey = generateVaultKey();
  ok('Generated new HCP_VAULT_KEY (keep this secret!)');
} else {
  ok('Re-using existing HCP_VAULT_KEY');
}

const defaultFortiCli = process.platform === 'win32'
  ? 'C:\\Program Files\\Fortinet\\FortiClient\\forticli.exe'
  : '/opt/forticlient/forticli';   // unlikely; adjust if you have a Linux client

const envBody = `# ---------------------------------------------------------------------------
# Palm Hills HCP Dashboard — Environment (generated ${new Date().toISOString()})
# ---------------------------------------------------------------------------

# REQUIRED: 64-hex AES-256-GCM key for encrypting app_secret / vpn_password
# Changing this key orphans previously stored secrets — you must re-enter them.
HCP_VAULT_KEY=${get(existing, 'HCP_VAULT_KEY', vaultKey)}

# Backend
PORT=${get(existing, 'PORT', '2020')}

# REQUIRED: Azure Database for PostgreSQL connection string.
# No local PostgreSQL server is installed or required.
DATABASE_URL=${get(existing, 'DATABASE_URL', 'postgresql://REPLACE_WITH_USER:REPLACE_WITH_PASSWORD@REPLACE_WITH_HOST.postgres.database.azure.com:5432/REPLACE_WITH_DB?sslmode=require')}
PGSSLMODE=${get(existing, 'PGSSLMODE', 'require')}

# Optional synchronous DB RPC tuning.
DB_RPC_BUFFER_MB=${get(existing, 'DB_RPC_BUFFER_MB', '64')}
DB_QUERY_TIMEOUT_MS=${get(existing, 'DB_QUERY_TIMEOUT_MS', '120000')}

# FortiClient VPN control (disabled by default — safer for first runs)
# Set FORTICLIENT_ENABLED=true only after the CLI path and tunnel name are verified.
FORTICLIENT_ENABLED=${get(existing, 'FORTICLIENT_ENABLED', ENABLE_VPN ? 'true' : 'false')}
FORTICLIENT_CLI=${get(existing, 'FORTICLIENT_CLI', defaultFortiCli)}
FORTICLIENT_TUNNEL=${get(existing, 'FORTICLIENT_TUNNEL', 'PHNC-Tunnel')}

# Health-check interval (ms). 0 disables the periodic checker.
HCP_HEALTHCHECK_MS=${get(existing, 'HCP_HEALTHCHECK_MS', '300000')}
`;

fs.writeFileSync(envPath, envBody, 'utf8');
ok(`Wrote ${envPath}`);

// ---------------------------------------------------------------------------
// 5. FortiClient check (Windows only meaningful)
// ---------------------------------------------------------------------------
step('Checking FortiClient CLI');
const cliPath = get(existing, 'FORTICLIENT_CLI', defaultFortiCli);
if (fs.existsSync(cliPath)) {
  ok(`Found CLI at ${cliPath}`);
  if (process.platform === 'win32') {
    try {
      const out = execSync(`"${cliPath}" -vpnstatus`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`${COLORS.gray}    Current VPN status:${COLORS.reset}`);
      out.split(/\r?\n/).forEach(l => console.log(`${COLORS.gray}      ${l}${COLORS.reset}`));
    } catch (e) {
      warn('Could not execute -vpnstatus (permissions or different CLI version)');
    }
  }
} else {
  warn(`CLI not found at: ${cliPath}`);
  console.log(`    Connect the VPN manually with the FortiClient GUI before running a sync.`);
  console.log(`    Update FORTICLIENT_CLI in .env once you locate the binary.`);
}

// ---------------------------------------------------------------------------
// 6. npm install
// ---------------------------------------------------------------------------
step('Dependencies');
const pkgPath = path.join(PROJECT_ROOT, 'package.json');
if (fs.existsSync(pkgPath)) {
  try {
    console.log('    Running npm install ...');
    execSync('npm install', { stdio: 'inherit', cwd: PROJECT_ROOT });
    ok('npm install completed');
  } catch {
    fail('npm install failed');
    process.exit(1);
  }
} else {
  warn('No package.json found in the current directory');
  console.log(`    Place this script inside the real project root (the folder that contains`);
  console.log(`    backend/, package.json, etc.) and re-run, or run 'npm install' manually.`);
}

// ---------------------------------------------------------------------------
// 7. Next steps
// ---------------------------------------------------------------------------
step('Next steps (manual)');
console.log(`
  1. Connect FortiClient tunnel manually (recommended for first runs)
       Open FortiClient → select the profile that already works → Connect.
       Confirm you can reach the HCP host (ping / browser / curl).

  2. Start the backend (from project root):
       npm start
       # or:  node backend/server.js   (adjust to actual entry point)
       # or:  node setup-dashboard.js --start

  3. Open the dashboard UI
       http://localhost:2020   or   http://localhost

  4. Create / configure a compound:
       - host / port / HTTPS
       - hcp_version   = 2.6.0
       - openapi_version = 2.6
       - app_key + app_secret
       - camera_index_code (required for vehicle events)

  5. Run the 9-stage diagnostic:
       POST /api/hcp/compounds/:id/test
       then poll GET /api/hcp/runs/:runId

  6. Only after the diagnostic is green and the adapter is verified,
     start a sync:  POST /api/hcp/compounds/:id/sync

  IMPORTANT current blockers (from the API spec):
    • Adapter hcp-artemis-v26 is still verified:false → sync gate blocks live sync
    • TLS cert on the HCP host may have CN=127.0.0.1 — pin a CA or ask IT to re-issue
    • cameraIndexCode must be set for vehicle / access-event categories
`);

// ---------------------------------------------------------------------------
// 8. Optional start
// ---------------------------------------------------------------------------
if (START) {
  step('Starting backend server');
  if (!fs.existsSync(pkgPath)) {
    fail('No package.json — cannot auto-start');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.scripts && pkg.scripts.start) {
    const child = spawn('npm', ['start'], { stdio: 'inherit', cwd: PROJECT_ROOT, shell: true });
    child.on('exit', code => process.exit(code ?? 0));
  } else {
    const candidates = [
      'backend/server.js', 'backend/index.js',
      'src/server.js', 'server.js', 'index.js'
    ];
    let found = null;
    for (const c of candidates) {
      const full = path.join(PROJECT_ROOT, c);
      if (fs.existsSync(full)) { found = full; break; }
    }
    if (found) {
      ok(`Launching node ${found}`);
      const child = spawn(process.execPath, [found], { stdio: 'inherit', cwd: PROJECT_ROOT });
      child.on('exit', code => process.exit(code ?? 0));
    } else {
      fail('Could not locate server entry point. Start it manually.');
      process.exit(1);
    }
  }
} else {
  console.log(`${COLORS.green}Setup finished.${COLORS.reset}\n`);
}
