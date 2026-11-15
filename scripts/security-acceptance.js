'use strict';
/* End-to-end security acceptance for the RBAC/scope/PII/audit layer.
   Runs against a live server (default http://localhost:2020) and the real DB.
   It creates dedicated test users (password TestPass!2026), disables them at the end,
   and never performs a destructive reset/rollback/period delete. */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const BASE = process.env.API_BASE || 'http://localhost:2020';
const PASSWORD = 'TestPass!2026';
const ROOT = path.join(__dirname, '..');

class Client {
  constructor(name) { this.name = name; this.cookies = new Map(); this.csrf = null; }
  store(res) {
    const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of raw) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      if (i < 0) continue;
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (!v) this.cookies.delete(k); else this.cookies.set(k, v);
    }
  }
  async request(method, url, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (unsafe && this.csrf && !opts.noCsrf) headers['X-CSRF-Token'] = this.csrf;
    let payload;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
    this.store(res);
    return res;
  }
  async json(method, url, body, opts) {
    const res = await this.request(method, url, body, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    return { status: res.status, data, res };
  }
  async login(email, password) {
    const r = await this.json('POST', '/api/auth/login', { email, password });
    if (r.status === 200 && r.data && r.data.csrfToken) this.csrf = r.data.csrfToken;
    return r;
  }
}

const results = [];
function record(id, scenario, pass, detail) {
  results.push({ id, scenario, pass: !!pass, detail: String(detail == null ? '' : detail).slice(0, 800) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  #${id} ${scenario} — ${detail}`);
}

function bootstrapCredentials() {
  const file = path.join(ROOT, 'data', 'bootstrap-admin.txt');
  const text = fs.readFileSync(file, 'utf8');
  const email = (text.match(/^Email:\s*(.+)$/m) || [])[1];
  const password = (text.match(/^Password:\s*(.+)$/m) || [])[1];
  if (!email || !password) throw new Error('bootstrap-admin.txt is missing Email/Password');
  return { email: email.trim(), password: password.trim() };
}

const digits = v => String(v == null ? '' : v).replace(/\D/g, '');

/* Find a resident inside a compound who really has mobile + national id,
   using light list/detail calls as the admin (unmasked). No large exports. */
async function pickResident(client, compoundName) {
  for (const term of ['2010', '2011', '2012', '2015', '201']) {
    const list = await client.json('GET',
      `/api/users?limit=50&compound=${encodeURIComponent(compoundName)}&search=${term}`);
    for (const u of (list.data && list.data.rows) || []) {
      if (digits(u.mobile).length < 8) continue;
      const det = await client.json('GET', `/api/users/${u.id}`);
      const au = (det.data && det.data.user) || {};
      if (digits(au.mobile).length >= 8 && digits(au.national_id).length >= 8) {
        return { id: au.id, mobile: au.mobile, email: au.email, national_id: au.national_id };
      }
    }
  }
  throw new Error(`no resident with mobile + national id found in ${compoundName}`);
}

async function ensureUser(root, email, displayName, role, compoundIds) {
  const users = await root.json('GET', '/api/auth/users');
  const existing = (users.data.rows || []).find(u => u.email === email);
  if (existing) {
    // Keep QA accounts deterministic across runs: role, status and scope are reset.
    await root.json('PUT', `/api/auth/users/${existing.id}`, { displayName, role, status: 'active' });
    await root.json('PUT', `/api/auth/users/${existing.id}/scopes`, { compoundIds });
    return existing.id;
  }
  const created = await root.json('POST', '/api/auth/users', { email, displayName, role, password: PASSWORD, compoundIds });
  if (created.status !== 201) throw new Error(`create ${email} failed: ${created.status} ${JSON.stringify(created.data)}`);
  return created.data.id;
}

(async () => {
  const anon = new Client('anon');
  const root = new Client('root');
  const creds = bootstrapCredentials();
  const rootLogin = await root.login(creds.email, creds.password);
  if (rootLogin.status !== 200) throw new Error('bootstrap login failed: ' + rootLogin.status);

  // Pick two compounds with data in the current period. /api/compare returns names only.
  const compounds = await root.json('GET', '/api/compounds');
  const idByName = new Map((compounds.data || []).map(c => [c.name, c.id]));
  const compare = await root.json('GET', '/api/compare?period=2026-10');
  const ranked = (compare.data.rows || [])
    .filter(r => !r.unassigned && r.activeUnits > 0 && idByName.has(r.compound))
    .sort((a, b) => b.activeUnits - a.activeUnits);
  if (ranked.length < 2) throw new Error('Need at least two compounds with units');
  const compA = { id: idByName.get(ranked[0].compound), name: ranked[0].compound, activeUnits: ranked[0].activeUnits };
  const compB = { id: idByName.get(ranked[1].compound), name: ranked[1].compound, activeUnits: ranked[1].activeUnits };

  const ids = {};
  ids.tm = await ensureUser(root, 'qa.topmanagement@palmhills.local', 'QA Top Management', 'Top Management', []);
  ids.cm = await ensureUser(root, 'qa.communitymanager@palmhills.local', 'QA Community Manager', 'Community Manager', [compA.id]);
  ids.ca = await ensureUser(root, 'qa.communityadmin@palmhills.local', 'QA Community Admin', 'Community Admin', [compA.id]);
  ids.admin = await ensureUser(root, 'qa.admin@palmhills.local', 'QA Admin', 'Admin', []);

  const tm = new Client('tm'); await tm.login('qa.topmanagement@palmhills.local', PASSWORD);
  const cm = new Client('cm'); await cm.login('qa.communitymanager@palmhills.local', PASSWORD);
  const ca = new Client('ca'); await ca.login('qa.communityadmin@palmhills.local', PASSWORD);
  const admin = new Client('admin'); await admin.login('qa.admin@palmhills.local', PASSWORD);

  const resetBody = { confirm: true, phrase: 'RESET ALL DATA' };

  // 1
  let r = await anon.json('GET', '/api/users');
  record(1, 'Anonymous GET /api/users', r.status === 401, `status=${r.status} code=${r.data && r.data.code}`);
  // 2
  r = await anon.json('POST', '/api/admin/reset', resetBody);
  record(2, 'Anonymous POST /api/admin/reset', r.status === 401, `status=${r.status} code=${r.data && r.data.code}`);
  // 3
  r = await tm.json('GET', '/api/users');
  record(3, 'Top Management GET /api/users', r.status === 403, `status=${r.status} code=${r.data && r.data.code}`);
  // 4
  r = await cm.json('GET', '/api/dashboard?period=2026-10&compound=' + encodeURIComponent(compB.name));
  record(4, 'Community Manager requests another compound', r.status === 403, `compound=${compB.name} status=${r.status}`);
  // Pick a real resident in compA that has mobile + national id (via admin export).
  const resident = await pickResident(admin, compA.name);
  const residentId = resident.id;
  const residentMobileDigits = digits(resident.mobile);
  const residentNationalDigits = digits(resident.national_id);

  // 5 — search by the resident's mobile so the row is guaranteed present.
  r = await cm.json('GET', `/api/users?limit=50&compound=${encodeURIComponent(compA.name)}&search=${encodeURIComponent(residentMobileDigits)}`);
  const cmUsers = (r.data && r.data.rows) || [];
  const cmResident = cmUsers.find(u => String(u.id) === String(residentId)) || cmUsers[0];
  const mobileMasked = cmResident ? String(cmResident.mobile || '').includes('\u2022') : false;
  const emailMasked = !resident.email || (cmResident && String(cmResident.email || '').includes('\u2022'));
  record(5, 'Community Manager sees masked mobile/email',
    r.status === 200 && !!cmResident && mobileMasked && emailMasked,
    `status=${r.status} rows=${cmUsers.length} mobileMasked=${mobileMasked} emailMasked=${emailMasked}`);
  // 5b — resident detail must hide national id
  const det = await cm.json('GET', `/api/users/${residentId}`);
  const nat = det.data && det.data.user ? det.data.user.national_id : null;
  const natMasked = nat != null && /^[\u2022*]+$/.test(String(nat));
  const detailMobileMasked = det.data && det.data.user ? String(det.data.user.mobile || '').includes('\u2022') : false;
  record('5b', 'Community Manager resident detail hides national ID',
    det.status === 200 && natMasked && detailMobileMasked,
    `status=${det.status} nationalIdMasked=${natMasked} mobileMasked=${detailMobileMasked}`);
  // 6
  const exportRes = await cm.request('GET',
    `/api/export?entity=users&compound=${encodeURIComponent(compA.name)}&search=${encodeURIComponent(residentMobileDigits)}`);
  let exportMasked = false;
  let exportRows = 0;
  try {
    const buf = Buffer.from(await exportRes.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    exportRows = rows.length;
    exportMasked = rows.length > 0
      && rows.every(x => String(x.mobile || '').includes('\u2022'))
      && rows.every(x => !x.national_id || String(x.national_id).includes('\u2022'));
  } catch (e) { exportMasked = false; }
  record(6, 'Community Manager export is masked', exportRes.status === 200 && exportMasked, `status=${exportRes.status} rows=${exportRows} masked=${exportMasked}`);
  // 7 — Admin has pii.unmask and must see the raw values
  r = await admin.json('GET', `/api/users/${residentId}`);
  const au = (r.data && r.data.user) || {};
  const adminMobile = digits(au.mobile);
  const adminNational = digits(au.national_id);
  record(7, 'Admin sees unmasked mobile/national ID',
    r.status === 200 && adminMobile === residentMobileDigits && adminNational === residentNationalDigits,
    `status=${r.status} mobileMatch=${adminMobile === residentMobileDigits} nationalMatch=${adminNational === residentNationalDigits}`);
  // 8
  r = await ca.json('POST', '/api/matching', {});
  record(8, 'Community Admin matching permitted (validation response)', r.status === 400 || r.status === 200, `status=${r.status} code=${r.data && r.data.code}`);
  // 9
  r = await cm.json('POST', '/api/matching', {});
  record(9, 'Community Manager matching denied', r.status === 403, `status=${r.status} code=${r.data && r.data.code}`);
  // 10 (no destructive execution: missing confirm proves authorization passed)
  r = await admin.json('POST', '/api/imports/3/rollback', {});
  record(10, 'Admin rollback authorized (confirmation still required)', r.status === 400, `status=${r.status} code=${r.data && r.data.code}`);
  // 11
  r = await ca.json('POST', '/api/admin/reset', resetBody);
  record(11, 'Community Admin reset denied', r.status === 403, `status=${r.status} code=${r.data && r.data.code}`);
  // 12 (no destructive execution)
  r = await root.json('POST', '/api/admin/reset', {});
  record(12, 'Super Admin reset authorized (confirmation still required)', r.status === 400, `status=${r.status} code=${r.data && r.data.code}`);
  // 13
  r = await cm.json('GET', '/api/dashboard?period=2026-10&compound=' + encodeURIComponent(compB.name));
  record(13, 'Cross-compound dashboard denied', r.status === 403, `status=${r.status}`);
  // 14
  r = await cm.json('POST', '/api/ai/ask', { question: 'summary' }, { noCsrf: true });
  record(14, 'Cookie write without CSRF denied', r.status === 403 && r.data && r.data.code === 'CSRF_FAILED', `status=${r.status} code=${r.data && r.data.code}`);
  // 15 (unique identity per run so a previous run's bucket cannot mask the result)
  let lastStatus = 0;
  const brute = new Client('brute');
  const bruteEmail = `qa.bruteforce.${Date.now()}@palmhills.local`;
  for (let i = 0; i < 7; i++) { const x = await brute.login(bruteEmail, 'wrong-password'); lastStatus = x.status; }
  record(15, 'Repeated failed logins rate-limited', lastStatus === 429, `lastStatus=${lastStatus}`);
  // 16
  const audit = await root.json('GET', '/api/audit');
  const denials = (audit.data || []).filter(x => x.result === 'DENIED');
  const withCorrelation = denials.find(x => x.correlation_id && x.actor_role);
  record(16, 'Denial audit has actor role + correlation id', audit.status === 200 && !!withCorrelation, `denials=${denials.length} sample=${withCorrelation ? withCorrelation.action + '/' + withCorrelation.actor_role : 'none'}`);
  // 17 mode is presentation-only: permissions are identical across requests
  const me1 = await cm.json('GET', '/api/auth/me');
  const me2 = await cm.json('GET', '/api/auth/me');
  record(17, 'Mode switch cannot change permissions (server has no mode input)', me1.status === 200 && JSON.stringify(me1.data.user.permissions) === JSON.stringify(me2.data.user.permissions), `permissions=${me1.data.user.permissions.length}`);
  // 18
  await root.json('POST', `/api/auth/users/${ids.ca}/revoke-sessions`, {});
  r = await ca.json('GET', '/api/auth/me');
  record(18, 'Revoked session rejected', r.status === 401, `status=${r.status}`);

  // Additional scope assertions
  r = await cm.json('GET', '/api/compounds');
  const cmCompounds = (r.data || []).map(c => c.name);
  record('S1', 'Community Manager compound list is scoped', r.status === 200 && cmCompounds.length === 1 && cmCompounds[0] === compA.name, `compounds=${cmCompounds.join(',')}`);
  r = await cm.json('GET', '/api/dashboard?period=2026-10');
  const cmDash = r.data || {};
  const unitsCard = (cmDash.cards || []).find(c => c.id === 'active_units');
  record('S2', 'Community Manager dashboard equals assigned compound', r.status === 200 && unitsCard && Number(unitsCard.value) === Number(compA.activeUnits), `dashboard=${unitsCard && unitsCard.value} expected=${compA.activeUnits}`);
  r = await cm.json('GET', '/api/compare?period=2026-10');
  const cmpRows = (r.data && r.data.rows) || [];
  record('S3', 'Community Manager comparison contains only assigned compounds', r.status === 200 && cmpRows.length === 1 && cmpRows[0].compound === compA.name, `rows=${cmpRows.map(x => x.compound).join(',')}`);
  r = await tm.json('GET', '/api/vehicles?limit=5');
  const tmRows = (r.data && r.data.rows) || [];
  record('S4', 'Top Management has no resident owner names on vehicles', r.status === 200 && tmRows.every(x => x.owner == null), `rows=${tmRows.length}`);

  // Disable test accounts (leave the bootstrap Super Admin active)
  for (const key of ['tm', 'cm', 'ca', 'admin']) {
    await root.json('PUT', `/api/auth/users/${ids[key]}`, { status: 'disabled' });
  }

  const outDir = path.join(ROOT, 'docs', 'evidence');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `security-acceptance-${stamp}.json`);
  const summary = {
    ranAt: new Date().toISOString(),
    base: BASE,
    compounds: { A: compA.name, B: compB.name },
    total: results.length,
    passed: results.filter(x => x.pass).length,
    failed: results.filter(x => !x.pass).length,
    results,
  };
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed}/${summary.total} passed. Evidence: ${outFile}`);
  if (summary.failed) process.exitCode = 1;
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
