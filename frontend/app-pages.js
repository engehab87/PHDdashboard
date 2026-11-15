// ==========================================================================
// Palm Hills Executive Real Estate Intelligence — All Page Renderers
// File: app-pages.js
// Real data is fetched live from the Palm Hills Executive API via PalmApp.
// ==========================================================================

const pEsc = s => String(s == null ? '' : s).replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));
const pFmt = n => n == null ? '—' : Number(n).toLocaleString('en-US');
const pFmtCapture = v => {
  if (v == null || v === '') return '—';
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) return m[1] + ' ' + m[2];
  return s;
};
const pFmtPct = n => n == null ? '—' : Number(n).toFixed(2) + '%';

window.PalmPages = {

  // 1. LOGIN PAGE (Split Visual + Form Layout)
  'login': function() {
    const sessionError = (window.PalmApp && PalmApp.state && PalmApp.state.sessionError) || '';
    return `
      <div style="display:flex; width:100vw; height:100vh; background:var(--background);">
        <!-- Visual Architectural Showcase (Left) -->
        <div style="flex:1.1; background:#1C1B1A; color:#FFF; display:flex; flex-direction:column; justify-content:space-between; padding:56px; position:relative; overflow:hidden;">
          <div style="display:flex; align-items:center; gap:14px; z-index:2;">
            <div style="width:36px; height:36px; background:#C4161C; display:grid; grid-template-columns:1fr 1fr; gap:3px; padding:6px; transform:rotate(45deg);">
              <span style="background:#FFF;"></span><span style="background:#FFF;"></span>
              <span style="background:#FFF;"></span><span style="background:#FFF;"></span>
            </div>
            <div>
              <div style="font-family:var(--font-display); font-weight:800; font-size:16px; letter-spacing:0.04em;">PALM HILLS</div>
              <div class="label-caps" style="color:#C4161C;">EXECUTIVE REAL ESTATE INTELLIGENCE</div>
            </div>
          </div>

          <div style="z-index:2; max-width:560px;">
            <div class="label-caps" style="color:#C4161C; margin-bottom:12px;">PALM HILLS ENTERPRISE CORE</div>
            <h1 class="display-lg" style="color:#FFF; margin-bottom:20px; line-height:1.2;">Architectural Precision. Unified Operations.</h1>
            <p style="color:#9A968F; font-size:15px; line-height:1.6;">Governed access to compound operations, CRM registration and HikCentral access data. Role, compound scope, PII masking and audit are enforced by the API on every request.</p>

            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; margin-top:40px; border-top:1px solid #343230; padding-top:24px;">
              <div>
                <div class="font-mono" style="font-size:22px; font-weight:700; color:#FFF;">5 roles</div>
                <div class="label-caps" style="color:#73706B; font-size:10px;">Top Management to Super Admin</div>
              </div>
              <div>
                <div class="font-mono" style="font-size:22px; font-weight:700; color:#FFF;">Scoped</div>
                <div class="label-caps" style="color:#73706B; font-size:10px;">Compound-level authorization</div>
              </div>
              <div>
                <div class="font-mono" style="font-size:22px; font-weight:700; color:#FFF;">Audited</div>
                <div class="label-caps" style="color:#73706B; font-size:10px;">Privileged actions recorded</div>
              </div>
            </div>
          </div>

          <div class="body-sm" style="color:#5C5A57; z-index:2;">
            Palm Hills Developments Group © 2026 • Confidential Executive Access Tier
          </div>
        </div>

        <!-- Local Credentials Login (Right) -->
        <div style="flex:0.9; display:flex; align-items:center; justify-content:center; padding:48px; background:var(--surface-container-lowest);">
          <div style="width:100%; max-width:420px;">
            <h2 class="headline-md" style="margin-bottom:8px;">Sign In to Executive Core</h2>
            <p class="body-md" style="color:var(--secondary); margin-bottom:24px;">Use your Palm Hills local account. Access is limited to the role and compounds assigned to you.</p>

            <div style="margin-bottom:22px; padding:12px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid var(--hairline-divider); display:flex; gap:10px; align-items:flex-start;">
              <span class="material-symbols-outlined" style="color:var(--secondary); font-size:18px;">info</span>
              <div class="body-sm" style="font-size:11.5px; color:var(--secondary);">Microsoft Entra ID single sign-on is <strong>not enabled</strong> in this Phase 1 build. It is planned for Phase 2; local credentials are used today.</div>
            </div>

            <form id="login-form" onsubmit="return PalmApp.submitLogin(event)" novalidate>
              <div id="login-error" role="alert" style="display:${sessionError ? 'block' : 'none'}; margin-bottom:16px; padding:10px 12px; border-radius:var(--radius-default); border:1px solid var(--status-critical); background:rgba(196,22,28,0.06); color:var(--status-critical); font-size:12.5px;">${pEsc(sessionError)}</div>

              <div style="margin-bottom:16px;">
                <label class="label-md" for="login-email" style="display:block; margin-bottom:6px;">Email</label>
                <input id="login-email" name="email" type="email" class="form-control-input" style="width:100%;" autocomplete="username" required autofocus />
              </div>

              <div style="margin-bottom:24px;">
                <label class="label-md" for="login-password" style="display:block; margin-bottom:6px;">Password</label>
                <input id="login-password" name="password" type="password" class="form-control-input" style="width:100%;" autocomplete="current-password" required />
              </div>

              <button type="submit" class="btn-primary" style="width:100%; justify-content:center; height:44px;">Sign In</button>
            </form>

            <div style="margin-top:24px; padding:12px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid var(--hairline-divider); display:flex; gap:10px; align-items:center;">
              <span class="material-symbols-outlined" style="color:var(--primary-container); font-size:18px;">lock</span>
              <div class="body-sm" style="font-size:11.5px; color:var(--secondary);">Session cookie is HttpOnly and SameSite. Authentication failures and privileged actions are written to the audit log.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
  // 2. EXECUTIVE OVERVIEW (Dashboard) — REAL KPI DATA FROM /api/dashboard
  'overview': async function() {
    let dash = null;
    try { dash = await PalmApp.loadDashboard(); } catch (e) { dash = null; }
    try { PalmApp.state.insights = await PalmApp.loadInsights(); } catch (e) { PalmApp.state.insights = null; }
    const cards = (dash && dash.cards) || [];
    const getCard = id => { const c = cards.find(c => c && c.id === id); return c || {}; };
    const activeUnits = getCard('active_units');
    const unitsWithUsers = getCard('units_with_users');
    const coverage = getCard('coverage_pct');
    const usersActive = getCard('users_active');
    const vehiclesReg = getCard('vehicles_registered');
    const hcpUnique = getCard('hcp_unique');
    const hcpEvents = getCard('hcp_events');
    const hcpAuto = getCard('hcp_auto_open');
    const hcpAutoUnique = getCard('hcp_auto_unique');
    const gatepass = getCard('gatepass');
    const warnings = (dash && dash.warnings) || [];
    let compounds = [];
    let periods = [];
    try { compounds = await PalmApp.loadCompounds(); } catch (e) { compounds = []; }
    try { periods = await PalmApp.loadPeriods(); } catch (e) { periods = []; }
    const selectedCompound = PalmApp.state.selectedCompound || 'all';
    const selectedPeriod = PalmApp.state.selectedPeriod || '';
    const periodMeta = periods.find(p => p.period_key === selectedPeriod) || periods[0] || null;
    const periodLabel = periodMeta ? (periodMeta.period_name || periodMeta.period_key) : selectedPeriod;

    return `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:24px;">
        <div>
          <h1 class="headline-lg">Executive Overview</h1>
          <p class="body-md" style="color:var(--secondary);">Unified portfolio health, access throughput, and cross-compound integrity metrics.</p>
        </div>
        <div style="display:flex; gap:12px;">
          <select class="form-control-select" onchange="PalmApp.selectCompound(this.value)">
            <option value="all" ${selectedCompound === 'all' ? 'selected' : ''}>${PalmApp.state.scope && PalmApp.state.scope.all ? 'All Developments' : 'All Assigned Communities'} (${compounds.length})</option>
            ${compounds.map(c => `<option value="${pEsc(c.name)}" ${selectedCompound === c.name ? 'selected' : ''}>${pEsc(c.name)}</option>`).join('')}
          </select>
          <select class="form-control-select" onchange="PalmApp.selectPeriod(this.value)">
            ${periods.map(p => `<option value="${pEsc(p.period_key)}" ${selectedPeriod === p.period_key ? 'selected' : ''}>${pEsc(p.period_name || p.period_key)}</option>`).join('')}
          </select>
          <button class="btn-primary" onclick="PalmApp.navigate('reports')"><span class="material-symbols-outlined">analytics</span> Executive Dossier</button>
        </div>
      </div>

      ${warnings.length ? `
      <div style="background:#FFF8E1; border:1px solid #FFE082; border-left:4px solid #B78103; padding:12px 18px; border-radius:var(--radius-default); margin-bottom:24px; display:flex; align-items:center; justify-content:space-between; gap:16px;">
        <div style="display:flex; align-items:flex-start; gap:12px;">
          <span class="material-symbols-outlined" style="color:#B78103;">warning</span>
          <div>
            <div style="font-size:13px; font-weight:600; color:#5D4037;">Reporting data warnings (${warnings.length})</div>
            <div style="font-size:12px; color:#795548;">${warnings.map(w => pEsc(w)).join('<br/>')}</div>
          </div>
        </div>
        ${PalmApp.canRoute('data-quality') ? `<button class="btn-secondary" style="height:32px; font-size:12px;" onclick="PalmApp.navigate('data-quality')">Review data quality</button>` : ''}
      </div>
      ` : ''}

      <!-- 8-Card KPI Metric Grid (Real values from /api/dashboard) -->
      <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:16px; margin-bottom:24px;">
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Active Units</span><span class="status-pill neutral">CRM active units</span></div>
          <div class="kpi-value">${pFmt(activeUnits.value)}</div>
          <div class="kpi-trend positive"><span class="material-symbols-outlined" style="font-size:16px;">trending_up</span> ${pFmtPct(coverage.value)} Registration Coverage</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Units With Users</span><span class="status-pill neutral">Active user link</span></div>
          <div class="kpi-value">${pFmt(unitsWithUsers.value)}</div>
          <div class="kpi-trend positive"><span class="material-symbols-outlined" style="font-size:16px;">trending_up</span> ${pFmtPct(coverage.value)} Registration Coverage</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Active Registered Users</span><span class="status-pill neutral">Status Active</span></div>
          <div class="kpi-value">${pFmt(usersActive.value)}</div>
          <div class="kpi-trend positive"><span class="material-symbols-outlined" style="font-size:16px;">trending_up</span> ${pEsc(usersActive.sub) || 'Registered users'}</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Registered Vehicles</span><span class="status-pill neutral">CRM registry</span></div>
          <div class="kpi-value">${pFmt(vehiclesReg.value)}</div>
          <div class="kpi-trend positive"><span class="material-symbols-outlined" style="font-size:16px;">tag</span> ${pFmt(hcpEvents.value)} HCP access events</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Unique Vehicles</span><span class="status-pill neutral">Distinct plates</span></div>
          <div class="kpi-value">${pFmt(hcpUnique.value)}</div>
          <div class="kpi-trend"><span class="material-symbols-outlined" style="font-size:16px;">schedule</span> ${pFmt(hcpEvents.value)} Total events</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Vehicle Events (HCP)</span><span class="status-pill neutral">Entry + exit</span></div>
          <div class="kpi-value">${pFmt(hcpEvents.value)}</div>
          <div class="kpi-trend"><span class="material-symbols-outlined" style="font-size:16px;">info</span> Imported HCP access records</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Automated Openings</span><span class="status-pill neutral">Result = PASS</span></div>
          <div class="kpi-value">${pFmt(hcpAuto.value)}</div>
          <div class="kpi-trend positive"><span class="material-symbols-outlined" style="font-size:16px;">bolt</span> ${pFmt(hcpAutoUnique.value)} Unique vehicles</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Gate Passes</span><span class="status-pill neutral">Imported passes</span></div>
          <div class="kpi-value">${pFmt(gatepass.value)}</div>
          <div class="kpi-trend"><span class="material-symbols-outlined" style="font-size:16px;">info</span> Active gate passes by access type</div>
        </div>
      </div>

      <!-- Two-Column Operational Panels (HCP Topology + CRM Pipeline) -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:24px;">
        <!-- HCP Gate Topology -->
        <div class="exec-panel">
          <div class="exec-panel-header">
            <div>
              <h3 class="title-md">HCP Compound Registry</h3>
              <div class="body-sm" style="color:var(--secondary);">Reporting scope: ${pEsc(selectedCompound === 'all' ? 'All Compounds' : selectedCompound)} • Period ${pEsc(periodLabel)}</div>
            </div>
            ${PalmApp.canRoute('hcp-connectivity') ? `<button class="btn-ghost" onclick="PalmApp.navigate('hcp-connectivity')"><span class="material-symbols-outlined">open_in_new</span></button>` : ''}
          </div>
          <div style="padding:16px 20px;">
            ${compounds.slice(0, 5).map(c => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--hairline-divider);">
              <div><strong>${pEsc(c.name)}</strong></div>
              <span class="status-pill neutral">In registry</span>
            </div>`).join('')}
            ${compounds.length === 0 ? `<div style="padding:10px 0; border-bottom:1px solid var(--hairline-divider); color:var(--secondary); font-size:12px;">No compound registry entries returned by the backend.</div>` : ''}
          </div>
        </div>

        <!-- CRM & Anomaly Intelligence -->
        <div class="exec-panel">
          <div class="exec-panel-header">
            <div>
              <h3 class="title-md">Property CRM &amp; Identity Reconciliation</h3>
              <div class="body-sm" style="color:var(--secondary);">Open findings reported by the insight engine for the selected scope and period</div>
            </div>
            ${PalmApp.canRoute('identity-matching') ? `<button class="btn-ghost" onclick="PalmApp.navigate('identity-matching')"><span class="material-symbols-outlined">tune</span></button>` : ''}
          </div>
          <div style="padding:16px 20px;">
            ${((PalmApp.state.insights && PalmApp.state.insights.insights) || []).slice(0, 4).map(ins => `
            <div style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--hairline-divider);">
              <span class="status-pill critical">Anomaly</span>
              <div style="flex:1;">
                <div style="font-weight:600; font-size:13px;">${pEsc(ins)}</div>
              </div>
              <button class="btn-secondary" style="height:30px; font-size:11px;" onclick="PalmApp.navigate('ai-analyst')">Investigate</button>
            </div>`).join('')}
            ${(!PalmApp.state.insights || !PalmApp.state.insights.insights || PalmApp.state.insights.insights.length === 0) ? `<div style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--hairline-divider);"><span class="status-pill operational">Clear</span><div style="flex:1;"><div style="font-weight:600; font-size:13px;">No open anomalies reported by the insight engine.</div></div></div>` : ''}
          </div>
        </div>
      </div>
    `;
  },

  // 3. VEHICLE ACCESS (HCP) — DESIGN: EXECUTIVE VEHICLE ACCESS CONSOLE
  'vehicle-access': async function() {
    const af = PalmApp.state.accessFilters || { direction: 'all', result: 'all', gate: 'all' };
    const plateFilter = PalmApp.state.accessPlate || '';
    const compound = PalmApp.state.selectedCompound || 'all';
    const period = PalmApp.state.selectedPeriod || '';
    // Connectivity: if the selected compound's HCP link is up and the sync gate is open,
    // retrieve (sync) data from HCP automatically (once per compound per session).
    let hcpGate = { open: false, gate: 'blocked' };
    let selectedCid = null;
    const selectedCompoundObj = (PalmApp.state.compounds || []).find(x => x.name === compound);
    if (selectedCompoundObj) selectedCid = selectedCompoundObj.id;
    if (compound !== 'all' && selectedCid) {
      try { hcpGate = await PalmApp.hcpGateOpen(selectedCid); } catch (e) { hcpGate = { open: false, gate: 'blocked' }; }
      if (hcpGate.open && PalmApp.state.hcpSyncedCompound !== selectedCid) {
        PalmApp.state.hcpSyncedCompound = selectedCid;
        try {
          PalmApp.showToast('Retrieving data from HCP for ' + compound + '…');
          PalmApp.syncHcpCompound(selectedCid).then(r => {
            PalmApp.showToast('HCP sync started (run ' + (r && r.runId ? r.runId : '') + ').');
          }).catch(e => {
            PalmApp.showToast('HCP sync failed: ' + (e && e.message ? e.message : e));
          });
        } catch (e) {
          PalmApp.showToast('HCP sync failed: ' + (e && e.message ? e.message : e));
        }
      }
    }
    let hourly = [];
    let heatmap = [];
    let liveEvents = [];
    let liveEventsTotal = 0;
    let usedLiveHeatmap = false;
    if (selectedCid && hcpGate.open) {
      try { hourly = await PalmApp.loadHcpLiveHourly(selectedCid); usedLiveHeatmap = true; } catch (e) { hourly = []; usedLiveHeatmap = false; }
      try { heatmap = await PalmApp.loadHcpLiveHeatmap(selectedCid); } catch (e) { heatmap = []; usedLiveHeatmap = false; }
      if (!Array.isArray(hourly) || hourly.length === 0) { usedLiveHeatmap = false; }
      try {
        const lr = await PalmApp.loadHcpLiveEventsForCompound(selectedCid, 'events', 1, 100);
        liveEvents = (lr && (lr.rows || lr.items)) || [];
        liveEventsTotal = (lr && lr.total != null) ? lr.total : liveEvents.length;
      } catch (e) { liveEvents = []; }
    }
    if (!usedLiveHeatmap) {
      try { hourly = await PalmApp.loadAccessHourly({ period, compound }); } catch (e) { hourly = []; }
      try { heatmap = await PalmApp.loadAccessHeatmap({ period, compound }); } catch (e) { heatmap = []; }
    }
    const periodMeta = (PalmApp.state.periods || []).find(p => p.period_key === period) || null;
    const from = PalmApp.state.accessFrom || (periodMeta ? periodMeta.period_start || '' : '');
    const to = PalmApp.state.accessTo || (periodMeta ? periodMeta.period_end || '' : '');
    const hourFilter = PalmApp.state.accessHour || '';
    const listParams = { period, compound, direction: af.direction, result: af.result, gate: af.gate, search: plateFilter || undefined, from: from || undefined, to: to || undefined, hour: hourFilter || undefined, dir: PalmApp.state.accessSortDir || 'desc' };
    let access = { rows: [], total: 0 };
    try { access = await PalmApp.loadPagedList('access', '/api/access', listParams); } catch (e) { access = { rows: [], total: 0 }; }
    const rows = access.rows || [];
    const total = access.total != null ? access.total : rows.length;
    const compounds = PalmApp.state.compounds || [];
    const gateOpts = ['all', 'G1', 'G2', 'G3_1', 'G3_2', 'V1A_CH', 'V1B_CH'];
    const gateLabels = { all: 'All gates', G1: 'G1 (Main Boulevard)', G2: 'G2 (Commercial)', G3_1: 'G3_1 (Service South)', G3_2: 'G3_2 (Service North)', V1A_CH: 'V1A_CH (Executive)', V1B_CH: 'V1B_CH (VIP North)' };
    const resultOpts = ['all', 'PASS', 'NOT_PASSED'];
    const resultLabels = { all: 'All results', PASS: 'Passed', NOT_PASSED: 'Not Passed' };
    const dirOpts = ['all', 'ENTRY', 'EXIT'];
    const dirLabels = { all: 'Entry+Exit', ENTRY: 'Entry Only', EXIT: 'Exit Only' };
    const resPill = res => (/not\s*passed|fail|denied|rejected|hold|blocked/i.test(String(res || '')) ? 'critical' : (/pass|ok|approved|valid|success|open/i.test(String(res || '')) ? 'operational' : 'neutral'));

    const hourMap = {};
    (Array.isArray(hourly) ? hourly : []).forEach(x => { hourMap[String(x.hh).padStart(2, '0')] = x.v; });
    const hourRows = [];
    for (let h = 0; h < 24; h += 1) { const hh = String(h).padStart(2, '0'); hourRows.push({ hh, v: hourMap[hh] || 0 }); }
    const maxHour = hourRows.reduce((m, r) => Math.max(m, r.v), 0);
    const daysMap = {};
    (Array.isArray(heatmap) ? heatmap : []).forEach(x => { const d = String(x.d); const hh = String(x.hh).padStart(2, '0'); if (!daysMap[d]) daysMap[d] = {}; daysMap[d][hh] = x.v; });
    const heatDays = Object.keys(daysMap).sort();
    const heatMax = (Array.isArray(heatmap) ? heatmap : []).reduce((m, x) => Math.max(m, x.v), 0);

    const hourBarHtml = hourRows.map(r => {
      const w = maxHour > 0 ? (r.v / maxHour) * 100 : 0;
      const alpha = maxHour > 0 ? Math.max(0.2, Math.min(1, 0.2 + 0.8 * (r.v / maxHour))) : 0.3;
      const bg = 'rgba(155, 0, 14, ' + alpha.toFixed(3) + ')';
      const label = String(r.hh).padStart(2, '0') + ':00';
      const v = r.v;
      return `
<div class="flex items-center text-xs font-body-sm">
  <span class="w-11 text-text-muted font-mono">${pEsc(label)}</span>
  <div class="flex-1 bg-surface-subtle h-3 rounded-xs overflow-hidden mx-2 relative">
    <div class="h-full rounded-xs" style="width: ${w}%; background: ${bg};"></div>
  </div>
  <span class="w-12 text-right font-mono text-text-secondary text-[11px]">${pFmt(v)}</span>
</div>`;
    }).join('');

    const heatCell = (d, hh) => {
      const v = (daysMap[d] || {})[hh] || 0;
      let bg = 'transparent';
      let fg = 'var(--text-secondary)';
      if (v > 0) {
        const t = heatMax > 0 ? v / heatMax : 0;
        bg = t < 0.33 ? '#e2f0d9' : (t < 0.66 ? '#a8d08d' : '#548235');
        fg = t < 0.66 ? '#1c1b1a' : '#ffffff';
      }
      return `<td class="py-2 px-1 text-center font-body-sm cursor-pointer hover:ring-1 hover:ring-primary transition-all" style="background-color: ${bg}; color: ${fg};" onclick="PalmApp.setAccessDateHour('${pEsc(d)}', '${pEsc(hh)}')" title="Filter to ${pEsc(d)} hour ${pEsc(hh)}">${v > 0 ? String(v) : '—'}</td>`;
    };
    const heatRowHtml = heatDays.map(d => {
      const cells = [];
      for (let h = 0; h < 24; h += 1) cells.push(heatCell(d, String(h).padStart(2, '0')));
      return `
<tr class="hover:bg-surface-subtle/50 transition-colors">
  <td class="py-2.5 pr-3 text-text-secondary font-semibold">${pEsc(d)}</td>
  ${cells.join('')}
</tr>`;
    }).join('');

    const gateSelect = (key, value, opts, labels) => `
      <select class="w-full h-10 px-3 rounded-lg bg-surface-subtle border border-border-hairline font-label-md text-label-md text-text-primary appearance-none cursor-pointer focus:outline-none focus:border-primary" onchange="PalmApp.setAccessFilter('${key}', this.value)">
        ${opts.map(o => `<option value="${pEsc(o)}" ${value === o ? 'selected' : ''}>${pEsc(labels[o] || o)}</option>`).join('')}
      </select>`;
    const compoundSelect = `
      <select class="w-full h-10 pl-9 pr-8 rounded-lg bg-surface-subtle border border-border-hairline font-label-md text-label-md text-text-primary appearance-none cursor-pointer focus:outline-none focus:border-primary" onchange="PalmApp.selectCompound(this.value)">
        <option value="all" ${compound === 'all' ? 'selected' : ''}>All compounds</option>
        ${compounds.map(c => `<option value="${pEsc(c.name)}" ${compound === c.name ? 'selected' : ''}>${pEsc(c.name)}</option>`).join('')}
      </select>
      <span class="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-text-muted">
        <span class="material-symbols-outlined text-[16px]">expand_more</span>
      </span>`;

    const rowsHtml = rows.map(r => {
      const pill = resPill(r.result);
      const flagged = String(r.result || '') === 'NOT_PASSED';
      const ownerName = r.owner_matched || r.owner_raw || 'Unassigned Visitor';
      const ownerArabic = r.owner_raw && r.owner_raw !== ownerName ? `<span class="font-normal text-text-muted"> / ${pEsc(r.owner_raw)}</span>` : '';
      const ownerHref = (PalmApp.can('resident.detail') && r.owner_user_id) ? `href="#/resident-detail?id=${Number(r.owner_user_id)}"` : 'href="#"';
      const ownerTarget = (PalmApp.can('resident.detail') && r.owner_user_id) ? ` onclick="PalmApp.openResidentPage(${Number(r.owner_user_id)}); return false;"` : '';
      const ownerLink = flagged
        ? `<a class="block font-title-md text-title-md text-text-primary hover:text-primary transition-colors leading-snug" ${ownerHref}${ownerTarget}>${pEsc(ownerName)}${ownerArabic}</a>`
        : `<a class="block font-title-md text-title-md text-text-primary hover:text-primary transition-colors leading-snug" ${ownerHref}${ownerTarget}>${pEsc(ownerName)}</a>`;
      const ownerSub = [r.compound, r.vehicle_list].filter(Boolean).join(' · ');
      const actions = flagged
        ? `<div class="flex items-center justify-end gap-2">
            <button class="px-2 py-1 rounded bg-[#FDF3F3] text-status-critical text-label-sm font-semibold hover:bg-status-critical hover:text-on-primary transition-colors">${flagged && String(r.result || '') === 'NOT_PASSED' ? 'Verify Now' : 'Incident Log'}</button>
            <button class="p-1.5 rounded hover:bg-surface-subtle text-text-muted hover:text-text-primary transition-colors" title="Actions Menu"><span class="material-symbols-outlined text-[18px]">more_vert</span></button>
          </div>`
        : `<div class="flex items-center justify-end gap-1">
            <button class="p-1.5 rounded hover:bg-surface-subtle text-text-muted hover:text-text-primary transition-colors" title="Telemetry History"><span class="material-symbols-outlined text-[18px]">history</span></button>
            <button class="p-1.5 rounded hover:bg-surface-subtle text-text-muted hover:text-text-primary transition-colors" title="Access Permissions"><span class="material-symbols-outlined text-[18px]">key</span></button>
            <button class="p-1.5 rounded hover:bg-surface-subtle text-text-muted hover:text-text-primary transition-colors" title="Actions Menu"><span class="material-symbols-outlined text-[18px]">more_vert</span></button>
          </div>`;
      return `
<tr class="hover:bg-surface-canvas transition-colors group">
  <td class="py-3 pl-4 pr-2">
    <input class="rounded accent-primary w-4 h-4 cursor-pointer" type="checkbox"/>
  </td>
  <td class="py-3 px-3 whitespace-nowrap">
    <a class="inline-flex items-center gap-1.5 text-text-primary group-hover:text-primary transition-colors font-semibold" href="#">
      <span class="font-mono tracking-wider">${pEsc(r.plate)}</span>
      <span class="material-symbols-outlined text-[14px] opacity-0 group-hover:opacity-100 transition-opacity">arrow_forward</span>
    </a>
    <div class="font-label-sm text-label-sm text-text-muted">${pEsc(r.source_kind || 'HCP')}</div>
  </td>
  <td class="py-3 px-3">${pEsc(r.compound || '—')}</td>
  <td class="py-3 px-3">
    <span class="status-pill neutral">${pEsc(r.direction || '—')}</span>
  </td>
  <td class="py-3 px-3 font-mono">${pEsc(r.enter_time || '—')}</td>
  <td class="py-3 px-3 font-mono">${pEsc(r.exit_time || '—')}</td>
  <td class="py-3 px-3">${pEsc(r.gate || '—')}</td>
  <td class="py-3 px-3">
    <span class="status-pill ${pill}">${pEsc(r.result || '—')}</span>
  </td>
  <td class="py-3 px-4 text-text-secondary text-xs">${pEsc(r.reason || '—')}</td>
  <td class="py-3 pr-4 pl-2 text-right">
    <div>${ownerLink}</div>
    ${ownerSub ? `<div class="font-label-sm text-label-sm text-text-secondary">${pEsc(ownerSub)}</div>` : ''}
    <div class="mt-2 flex items-center justify-end gap-1">${actions}</div>
  </td>
</tr>`;
    }).join('');

    const firstIdx = rows.length ? (access.page - 1) * access.limit : 0;
    const lastIdx = rows.length ? firstIdx + rows.length : 0;
    const rangeText = rows.length ? `${pFmt(firstIdx + 1)}–${pFmt(lastIdx)}` : '0';

    // Pre-computed live HCP HTML (avoid nested template literals in the main template).
    const resPillVa = res => (/not\s*passed|fail|denied|rejected|hold|blocked/i.test(String(res || '')) ? 'critical' : (/pass|ok|approved|valid|success|open/i.test(String(res || '')) ? 'operational' : 'neutral'));
    const liveGateHtml = (selectedCid && liveEvents.length)
      ? `<div class="mt-4"><div class="font-label-caps text-label-caps text-text-muted uppercase mb-2">Latest event per gate (live)</div><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">` +
        Object.values(liveEvents.reduce((acc, e) => {
          const g = e.gate || 'Unknown';
          if (!acc[g] || String(e.event_time || '') > String(acc[g].event_time || '')) acc[g] = e;
          return acc;
        }, {})).map(e =>
          `<div class="p-3 rounded-lg bg-surface-subtle border border-border-hairline">
            <div class="flex items-center justify-between mb-1">
              <span class="font-title-md text-title-md text-text-primary">${pEsc(e.gate || 'Unknown')}</span>
              <span class="status-pill ${resPillVa(e.result)}">${pEsc(e.result || '—')}</span>
            </div>
            <div class="font-mono text-body-sm text-text-secondary">${pEsc(pFmtCapture(e.event_time || ''))}</div>
            <div class="font-label-sm text-label-sm text-text-muted mt-1">${pEsc(e.direction || '')} · ${pEsc(e.ref_plate || e.plate || '')} ${pEsc(e.ref_person || '')}</div>
          </div>`
        ).join('') +
        `</div></div>`
      : `<div class="mt-4 p-8 rounded-lg bg-surface-subtle border border-dashed border-border-strong flex flex-col items-center justify-center text-center">
          <div class="w-12 h-12 rounded-full bg-surface-card flex items-center justify-center text-text-muted shadow-2xs mb-3">
            <span class="material-symbols-outlined text-[24px]">stream</span>
          </div>
          <p class="font-body-md text-body-md text-text-secondary font-medium">${selectedCid ? 'No live HCP events retrieved yet. Connection is ' + (hcpGate.open ? 'up' : 'down') + ' — check VPN routing to 192.168.15.15:443 and click Retry.' : 'Select a compound to view live gate status.'}</p>
          <span class="font-label-sm text-label-sm text-text-muted mt-1">${selectedCid ? 'Click "Sync all connected" or "Refresh from HCP" to retrieve data.' : 'Socket pipeline ready · TLS 1.3 encrypted channel'}</span>
        </div>`;

    const liveAuditHtml = (selectedCid && liveEvents.length) ? (
      `<div class="w-full bg-surface-card rounded-xl shadow-sm border border-border-hairline mb-8 overflow-hidden flex flex-col">
        <div class="p-4 px-5 border-b border-border-hairline flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-card">
          <div class="flex items-center gap-3">
            <span class="font-headline-sm text-headline-sm font-bold text-text-primary">Live Audit Trail (HCP)</span>
            <span class="text-text-muted font-body-sm text-body-sm">|</span>
            <span class="font-body-sm text-body-sm text-text-secondary">Showing ${pFmt(Math.min(liveEvents.length, 25))} of ${pFmt(liveEventsTotal)} live HCP events (newest first)</span>
          </div>
          <div class="flex items-center gap-2">
            <button class="h-9 px-3 rounded-lg border border-border-hairline bg-surface-card hover:bg-surface-subtle text-text-primary font-label-md text-label-md font-medium transition-all shadow-2xs flex items-center gap-1.5" type="button" onclick="PalmApp.toggleAccessSort()">
              <span class="material-symbols-outlined text-[16px] text-text-secondary">${PalmApp.state.accessSortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>
              ${PalmApp.state.accessSortDir === 'asc' ? 'Oldest first' : 'Newest first'}
            </button>
          </div>
        </div>
        <div class="overflow-x-auto w-full">
          <table class="exec-table">
            <thead><tr><th>Event ID</th><th>Capture Time</th><th>Gate</th><th>Direction</th><th>Plate / Subject</th><th>Result</th></tr></thead>
            <tbody>` +
      liveEvents.slice(0, 25).map(r =>
        `<tr>
          <td class="font-mono">#${pEsc(r.id || r.source_id || '')}</td>
          <td class="font-mono">${pEsc(pFmtCapture(r.event_time || r.enter_time || r.exit_time || ''))}</td>
          <td>${pEsc(r.gate || '')}</td>
          <td>${pEsc(r.direction || '')}</td>
          <td>${pEsc(r.ref_plate || r.plate || '')} ${pEsc(r.ref_person || r.owner_raw || '')}</td>
          <td><span class="status-pill ${resPillVa(r.result)}">${pEsc(r.result || '')}</span></td>
        </tr>`
      ).join('') +
      `</tbody></table></div>
        ${liveEvents.length > 25 ? `<div style="padding:12px 20px; border-top:1px solid var(--hairline-divider); text-align:center;"><button class="btn-secondary" onclick="PalmApp.state.hcpLiveEventsPage = (PalmApp.state.hcpLiveEventsPage||1)+1; PalmApp.navigate('vehicle-access', true);">Load more live events</button></div>` : ''}
      </div>`
    ) : '';


    return `
      <!-- Executive Header: breadcrumbs, title, live badge, subtitle + role switcher -->
      <div class="flex flex-col lg:flex-row lg:items-center justify-between pb-6 gap-4">
        <div class="flex flex-col space-y-1">
          <nav class="flex items-center gap-2 font-label-sm text-label-sm text-text-muted">
            <span class="hover:text-text-primary transition-colors cursor-pointer">Executive Overview</span>
            <span class="material-symbols-outlined text-[14px]">chevron_right</span>
            <span class="text-text-primary font-semibold">Vehicle Access</span>
          </nav>
          <div class="flex items-baseline gap-3">
            <h1 class="font-headline-lg text-headline-lg text-text-primary tracking-tight font-bold">Vehicle Access (HCP)</h1>
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-status-active/10 text-status-active font-label-sm text-label-sm font-semibold">
              <span class="w-1.5 h-1.5 rounded-full bg-status-active animate-pulse"></span>
              Live Stream Active
            </span>
          </div>
          <p class="font-body-md text-body-md text-text-secondary">
            Entry/exit events — totals vs unique vehicles are reported separately across master-planned compounds.
          </p>
        </div>
        <div class="flex items-center gap-3 self-start lg:self-center">
          <div class="flex items-center bg-surface-card p-1 rounded-xl shadow-sm border border-border-hairline">
            <button class="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold transition-all">Super Admin</button>
            <button class="px-3 py-1.5 rounded-lg text-text-secondary hover:text-text-primary font-label-md text-label-md font-semibold transition-all">Management</button>
            <button class="px-3 py-1.5 rounded-lg text-text-secondary hover:text-text-primary font-label-md text-label-md font-semibold transition-all">Operations</button>
          </div>
          <div class="hidden sm:flex items-center gap-2 px-3 py-2 bg-surface-card rounded-xl shadow-sm border border-border-hairline text-text-secondary">
            <span class="material-symbols-outlined text-[18px] text-primary">sensors</span>
            <span class="font-label-sm text-label-sm font-medium">HCP Artemis v4.8</span>
          </div>
          ${selectedCid ? `<div class="hidden sm:flex items-center gap-2 px-3 py-2 bg-surface-card rounded-xl shadow-sm border border-border-hairline">
            <span class="w-2 h-2 rounded-full ${hcpGate.open ? 'bg-status-active' : 'bg-text-muted'}"></span>
            <span class="font-label-sm text-label-sm font-medium ${hcpGate.open ? 'text-status-active' : 'text-text-muted'}">${hcpGate.open ? 'HCP connected &amp; verified' : 'HCP not connected'}</span>
            ${hcpGate.open ? '' : `<button class="ml-1 text-primary font-label-sm text-label-sm font-semibold" onclick="PalmApp.openHcpEditDrawer(${selectedCid})">Configure</button>`}
            <button class="ml-1 text-primary font-label-sm text-label-sm font-semibold" onclick="PalmApp.hcpGateOpen(${selectedCid}).then(()=>PalmApp.navigate('vehicle-access', true)).catch(()=>{})" title="Retry connection">Retry</button>
          </div>` : ''}
        </div>
      </div>

      <!-- Primary Filter Bar -->
      <div class="w-full bg-surface-card rounded-xl p-4 shadow-sm border border-border-hairline mb-6">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
          <div class="lg:col-span-2 relative">
            <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
              <span class="material-symbols-outlined text-[18px]">search</span>
            </span>
            <input class="w-full h-10 pl-9 pr-3 rounded-lg bg-surface-subtle border border-border-hairline font-body-sm text-body-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all" placeholder="Plate, QR token, or owner..." type="text" value="${pEsc(plateFilter)}" onchange="PalmApp.setAccessPlate(this.value)" />
          </div>
          <div class="lg:col-span-2 relative">
            <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
              <span class="material-symbols-outlined text-[18px]">apartment</span>
            </span>
            ${compoundSelect}
          </div>
          <div class="lg:col-span-1">
            <select class="w-full h-10 px-3 rounded-lg bg-surface-subtle border border-border-hairline font-label-md text-label-md text-text-primary appearance-none cursor-pointer focus:outline-none focus:border-primary" onchange="PalmApp.setAccessFilter('direction', this.value)">
              ${dirOpts.map(d => `<option value="${pEsc(d)}" ${af.direction === d ? 'selected' : ''}>${pEsc(dirLabels[d] || d)}</option>`).join('')}
            </select>
          </div>
          <div class="lg:col-span-1">
            <select class="w-full h-10 px-3 rounded-lg bg-surface-subtle border border-border-hairline font-label-md text-label-md text-text-primary appearance-none cursor-pointer focus:outline-none focus:border-primary" onchange="PalmApp.setAccessFilter('result', this.value)">
              ${resultOpts.map(r => `<option value="${pEsc(r)}" ${af.result === r ? 'selected' : ''}>${pEsc(resultLabels[r] || r)}</option>`).join('')}
            </select>
          </div>
          <div class="lg:col-span-1">
            <select class="w-full h-10 px-3 rounded-lg bg-surface-subtle border border-border-hairline font-label-md text-label-md text-text-primary appearance-none cursor-pointer focus:outline-none focus:border-primary" onchange="PalmApp.setAccessFilter('gate', this.value)">
              ${gateOpts.map(g => `<option value="${pEsc(g)}" ${af.gate === g ? 'selected' : ''}>${pEsc(gateLabels[g] || g)}</option>`).join('')}
            </select>
          </div>
          <div class="lg:col-span-1">
            <select class="w-full h-10 px-3 rounded-lg bg-surface-subtle border border-border-hairline font-label-md text-label-md text-text-primary appearance-none cursor-pointer focus:outline-none focus:border-primary" onchange="PalmApp.setAccessHour(this.value)">
              <option value="" ${hourFilter === '' ? 'selected' : ''}>All hours</option>
              ${Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).map(hh => `<option value="${hh}" ${hourFilter === hh ? 'selected' : ''}>${hh}:00</option>`).join('')}
            </select>
          </div>
          <div class="lg:col-span-2 flex items-center gap-1.5">
            <div class="relative flex-1">
              <input class="w-full h-10 px-2 pl-7 rounded-lg bg-surface-subtle border border-border-hairline font-body-sm text-body-sm text-text-primary focus:outline-none focus:border-primary text-center" type="date" value="${pEsc(from)}" onchange="PalmApp.setAccessFrom(this.value)" />
              <span class="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-text-muted">
                <span class="material-symbols-outlined text-[15px]">calendar_today</span>
              </span>
            </div>
            <span class="text-text-muted text-xs">→</span>
            <div class="relative flex-1">
              <input class="w-full h-10 px-2 pl-7 rounded-lg bg-surface-subtle border border-border-hairline font-body-sm text-body-sm text-text-primary focus:outline-none focus:border-primary text-center" type="date" value="${pEsc(to)}" onchange="PalmApp.setAccessTo(this.value)" />
              <span class="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-text-muted">
                <span class="material-symbols-outlined text-[15px]">event</span>
              </span>
            </div>
          </div>
          <div class="lg:col-span-2 flex items-center gap-2 justify-end">
            <button class="h-10 px-5 rounded-lg bg-primary hover:bg-[#820E13] text-on-primary font-label-md text-label-md font-semibold transition-all shadow-xs flex items-center gap-1.5" type="button" onclick="PalmApp.applyAccessFilters()">
              <span class="material-symbols-outlined text-[16px]">tune</span>
              Apply
            </button>
            <button class="h-10 px-3 rounded-lg text-text-secondary hover:text-text-primary font-label-md text-label-md font-semibold transition-colors hover:bg-surface-subtle" type="button" onclick="PalmApp.resetAccessFilters()">Reset</button>
          </div>
        </div>
      </div>

      <!-- Analytical Intelligence Grid: By Hour + Heatmap -->
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-6">
        <div class="xl:col-span-4 bg-surface-card rounded-xl p-5 shadow-sm border border-border-hairline flex flex-col justify-between">
          <div class="flex items-center justify-between pb-3 border-b border-border-hairline mb-3">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-xs bg-primary"></span>
              <h2 class="font-headline-sm text-headline-sm text-text-primary font-bold">By Hour</h2>
            </div>
            <span class="font-label-caps text-label-caps text-text-muted uppercase">Distribution (24H)</span>
          </div>
          <p class="font-body-sm text-body-sm text-text-secondary mb-3">${usedLiveHeatmap ? 'Live HCP data for the selected compound.' : 'Imported HCP data for the selected period.'}</p>
          <div class="flex-1 space-y-1.5 overflow-y-auto max-h-[380px] pr-2">
${hourBarHtml}
          </div>
        </div>

        <div class="xl:col-span-8 bg-surface-card rounded-xl p-5 shadow-sm border border-border-hairline flex flex-col justify-between">
          <div class="flex items-center justify-between pb-3 border-b border-border-hairline mb-3">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-[19px] text-primary">grid_view</span>
              <h2 class="font-headline-sm text-headline-sm text-text-primary font-bold">Heatmap (Hour × Day)</h2>
            </div>
            <div class="flex items-center gap-3 font-label-sm text-label-sm text-text-muted">
              <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs bg-[#e2f0d9]"></span> Low</span>
              <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs bg-[#a8d08d]"></span> Med</span>
              <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs bg-[#548235]"></span> Peak Volume</span>
            </div>
          </div>
          <div class="overflow-x-auto w-full pb-2">
            <table class="w-full border-collapse text-left min-w-[760px]">
              <thead>
                <tr class="bg-surface-subtle text-text-secondary font-label-caps text-label-caps uppercase border-b border-border-strong tracking-wider">
                  <th class="py-2 pr-3 font-bold">DAY</th>
                  ${hourRows.map(h => `<th class="py-2 px-1 text-center font-bold">${pEsc(h.hh)}</th>`).join('')}
                </tr>
              </thead>
              <tbody class="divide-y divide-border-hairline font-body-sm text-body-sm">
${heatRowHtml}
              </tbody>
            </table>
          </div>
          <div class="mt-3 pt-3 border-t border-border-hairline flex items-center justify-between text-xs text-text-muted">
            <span>Heat cell opacity represents normalized 15-minute gate pulse frequency</span>
            <button class="text-primary hover:underline font-medium inline-flex items-center gap-1" type="button" onclick="PalmApp.mountPage()">Full 30-Day Heat Analysis <span class="material-symbols-outlined text-[14px]">arrow_forward</span></button>
          </div>
        </div>
      </div>

      <!-- High-Density Operational Records & Telemetry Table -->
      <div class="w-full bg-surface-card rounded-xl shadow-sm border border-border-hairline mb-8 overflow-hidden flex flex-col">
        <div class="p-4 px-5 border-b border-border-hairline flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-card">
          <div class="flex items-center gap-3">
            <span class="font-headline-sm text-headline-sm font-bold text-text-primary">${pFmt(total)} records</span>
            <span class="text-text-muted font-body-sm text-body-sm">|</span>
            <span class="font-body-sm text-body-sm text-text-secondary">Live Audit Trail (HCP Cluster Delta 0.8s)${hourFilter ? ' · hour ' + hourFilter + ':00' : ''}${from || to ? ' · ' + (from || '') + (to && to !== from ? ' → ' + to : '') : ''}</span>
          </div>
          <div class="flex items-center gap-2">
            <button class="h-9 px-3 rounded-lg border border-border-hairline bg-surface-card hover:bg-surface-subtle text-text-primary font-label-md text-label-md font-medium transition-all shadow-2xs flex items-center gap-1.5" type="button" onclick="PalmApp.toggleAccessSort()">
              <span class="material-symbols-outlined text-[16px] text-text-secondary">${PalmApp.state.accessSortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>
              ${PalmApp.state.accessSortDir === 'asc' ? 'Oldest first' : 'Newest first'}
            </button>
            <button class="h-9 px-3 rounded-lg border border-border-hairline bg-surface-card hover:bg-surface-subtle text-text-primary font-label-md text-label-md font-medium transition-all shadow-2xs flex items-center gap-1.5" type="button" onclick="PalmApp.exportEntity('access', { period: period, compound: compound, direction: af.direction, result: af.result, gate: af.gate, from: from, to: to, hour: hourFilter })">
              <span class="material-symbols-outlined text-[16px] text-text-secondary">download</span>
              Export current view (.xlsx)
            </button>
            <button class="h-9 px-3 rounded-lg border border-border-hairline bg-surface-card hover:bg-surface-subtle text-text-primary font-label-md text-label-md font-medium transition-all shadow-2xs flex items-center gap-1.5" type="button" onclick="PalmApp.exportEntity('access', { period: period, compound: compound })">
              <span class="material-symbols-outlined text-[16px] text-text-secondary">table_view</span>
              Export all matching (.xlsx)
            </button>
          </div>
        </div>
        <div class="p-4 px-5 border-b border-border-hairline flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-card">
          <div class="font-body-sm text-body-sm text-text-secondary">
            Showing <span class="font-semibold text-text-primary">${pFmt(rangeText)}</span> of <span class="font-semibold text-text-primary">${pFmt(total)}</span> records
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5 font-body-sm text-body-sm text-text-muted pl-2 border-l border-border-hairline">
              <span>Rows:</span>
              <select class="h-8 px-2 rounded bg-surface-subtle border border-border-hairline text-text-primary text-xs font-semibold focus:outline-none" onchange="PalmApp.setAccessPageSize(this.value)">
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <nav class="inline-flex items-center gap-1 font-label-sm text-label-sm">
              <button class="w-8 h-8 flex items-center justify-center rounded bg-surface-card hover:bg-surface-canvas text-text-secondary transition-colors" disabled title="Previous Page" onclick="PalmApp.gotoAccessPrev()">
                <span class="material-symbols-outlined text-[17px]">chevron_left</span>
              </button>
              <button class="w-8 h-8 flex items-center justify-center rounded bg-primary text-on-primary font-semibold shadow-xs">1</button>
              <button class="w-8 h-8 flex items-center justify-center rounded bg-surface-card hover:bg-surface-subtle text-text-primary transition-colors">2</button>
              <span class="px-1 text-text-muted text-xs">…</span>
              <button class="w-8 h-8 flex items-center justify-center rounded bg-surface-card hover:bg-surface-subtle text-text-primary transition-colors">5900</button>
              <button class="w-8 h-8 flex items-center justify-center rounded bg-surface-card hover:bg-surface-subtle text-text-primary transition-colors" title="Next Page" onclick="PalmApp.gotoAccessNext()">
                <span class="material-symbols-outlined text-[17px]">chevron_right</span>
              </button>
            </nav>
          </div>
        </div>
        <div class="overflow-x-auto w-full">
          <table class="w-full text-left border-collapse min-w-[1040px]">
            <thead>
              <tr class="bg-surface-subtle text-text-secondary font-label-caps text-label-caps uppercase border-b border-border-strong tracking-wider">
                <th class="py-3 pl-4 pr-2 w-10">
                  <input class="rounded accent-primary w-4 h-4 cursor-pointer" type="checkbox"/>
                </th>
                <th class="py-3 px-3 font-bold">PLATE</th>
                <th class="py-3 px-3 font-bold">COMPOUND</th>
                <th class="py-3 px-3 font-bold">DIR</th>
                <th class="py-3 px-3 font-bold">ENTER</th>
                <th class="py-3 px-3 font-bold">EXIT</th>
                <th class="py-3 px-3 font-bold">GATE</th>
                <th class="py-3 px-3 font-bold">RESULT</th>
                <th class="py-3 px-4 font-bold">REASON</th>
                <th class="py-3 pr-4 pl-2 text-right font-bold">OWNER / IDENTITY</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border-hairline font-body-sm text-body-sm">
              ${rowsHtml}
              ${rows.length === 0 ? `<tr><td colspan="10" style="text-align:center; color:var(--text-secondary); padding:32px;">No access events found for the selected reporting period and compound scope.</td></tr>` : ''}
            </tbody>
          </table>
        </div>

      </div>

${liveAuditHtml}

      <!-- Live Gate View: latest event per gate (HCP) -->
      <div class="w-full bg-surface-card rounded-xl p-5 shadow-sm border border-border-hairline mb-12">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border-hairline">
          <div>
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-primary animate-ping"></span>
              <h3 class="font-headline-sm text-headline-sm text-text-primary font-bold">HCP Live Access Events</h3>
            </div>
            <p class="font-body-sm text-body-sm text-text-secondary mt-0.5">
              Read-only vehicle access events retrieved from the HCP Artemis API — provenance: <span class="font-mono text-text-primary">live-hcp-gateway.palmhills</span>
            </p>
          </div>
          <div class="flex items-center gap-3">
            <div class="relative w-56">
              <select class="w-full h-10 px-3 pl-8 rounded-lg bg-surface-subtle border border-border-hairline font-body-sm text-body-sm text-text-primary appearance-none cursor-pointer focus:outline-none focus:border-primary">
                <option>All compounds</option>
                ${compounds.map(c => `<option>${pEsc(c.name)}</option>`).join('')}
              </select>
              <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-text-muted">
                <span class="material-symbols-outlined text-[17px]">domain</span>
              </span>
              <span class="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-text-muted">
                <span class="material-symbols-outlined text-[15px]">expand_more</span>
              </span>
            </div>
            <button class="h-10 px-4 rounded-lg bg-primary hover:bg-[#820E13] text-on-primary font-label-md text-label-md font-semibold transition-all shadow-xs flex items-center gap-2" type="button" onclick="PalmApp.loadHcpLiveEvents(15)">
              <span class="material-symbols-outlined text-[17px]">refresh</span>
              Load HCP events
            </button>
          </div>
        </div>
${liveGateHtml}
      </div>

    `;
  },

// 4. GATE PASSES — REAL DATA FROM /api/gatepasses
  'gate-passes': async function() {
    const period = PalmApp.state.selectedPeriod || '';
    const compound = PalmApp.state.selectedCompound || 'all';
    let passes = { rows: [] };
    try { passes = await PalmApp.loadPagedList('gatepasses', '/api/gatepasses', { period, compound }); } catch (e) { passes = { rows: [] }; }
    const rows = passes.rows || [];
    const typePill = t => (/guest|vip|delegate|beach/i.test(String(t || '')) ? 'operational' : (/contractor|commercial|delivery|maintenance/i.test(String(t || '')) ? 'neutral' : (/courier|physical|hold|lock/i.test(String(t || '')) ? 'critical' : 'neutral')));
    const validity = v => {
      if (!v) return '<span class="status-pill neutral">No expiry recorded</span>';
      const t = Date.parse(String(v).replace(' ', 'T'));
      if (isNaN(t)) return `<span class="status-pill neutral">${pEsc(v)}</span>`;
      return t < Date.now()
        ? '<span class="status-pill critical">Expired</span>'
        : '<span class="status-pill operational">Valid</span>';
    };

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">Gate Passes</h1>
          <p class="body-md" style="color:var(--secondary);">Gate passes imported for the selected reporting month, with validity derived from the recorded expiry.</p>
        </div>
        <button class="btn-secondary" onclick="PalmApp.exportEntity('gatepasses', { period: PalmApp.state.selectedPeriod, compound: PalmApp.state.selectedCompound })"><span class="material-symbols-outlined">download</span> Export (.xlsx)</button>
      </div>

      <div class="exec-panel">
        ${PalmApp.pagerHtml('gatepasses')}
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead>
              <tr><th>Pass Token / QR</th><th>Visitor / Holder</th><th>Unit & Compound</th><th>Pass Type</th><th>Entry Window</th><th>Valid Until</th><th>Validity</th></tr>
            </thead>
            <tbody>
              ${rows.map(r => `
              <tr>
                <td class="font-mono"><strong>GP-${String(r.id).padStart(5, '0')}</strong></td>
                <td>${r.user ? `<a href="#" onclick="PalmApp.searchResident(${JSON.stringify(String(r.user))}); return false;" title="Find resident">${pEsc(r.user)}</a>` : '—'}</td>
                <td>${pEsc(r.compound)} • ${r.unit ? `<a href="#" onclick="PalmApp.searchUnit(${JSON.stringify(String(r.unit))}); return false;" title="Find unit">${pEsc(r.unit)}</a>` : ''}</td>
                <td><span class="status-pill ${typePill(r.access_type)}">${pEsc(r.access_type)}</span></td>
                <td>${pEsc(r.entry_date)}</td>
                <td>${pEsc(r.valid_until)}</td>
                <td>${validity(r.valid_until)}</td>
              </tr>`).join('')}
              ${rows.length === 0 ? `<tr><td colspan="7" style="text-align:center; color:var(--secondary); padding:32px;">No gate passes recorded for the selected reporting period.</td></tr>` : ''}
            </tbody>
          </table>
</div>
      </div>
    `;
  },

  // 5. HCP COMPOUND CONNECTIVITY — REAL DATA FROM /api/hcp
  'hcp-connectivity': async function() {
    // Read-only factual view. Every value below comes from the backend; nothing
    // is assumed. The backend records the observed network state and the
    // configured integration metadata; it does not establish tunnels or call
    // HCP APIs unless a verified adapter and credentials are present.
    let list = [];
    let registry = [];
    let detail = null;
    let conn = null;
    let loadError = '';
    try { list = await PalmApp.loadHcpCompounds(); } catch (e) { loadError = e && e.message ? e.message : String(e); list = []; }
    try { registry = await PalmApp.loadHcpRegistry(); } catch (e) { registry = []; }

    let comps = [];
    try { comps = await PalmApp.loadCompounds(); } catch (e) { comps = []; }
    const selectedName = PalmApp.state.selectedCompound || 'all';
    let cid = comps.length ? comps[0].id : null;
    if (selectedName !== 'all') {
      const found = comps.find(c => c.name === selectedName);
      if (found) cid = found.id;
    }
    let history = null;
    if (cid) {
      try { detail = await PalmApp.loadHcpCompound(cid); } catch (e) { detail = null; }
      try { conn = await PalmApp.loadHcpConnectivity(cid); } catch (e) { conn = null; }
      try { history = await PalmApp.loadHcpHistory(cid); } catch (e) { history = null; }
      if (history && history.tests && history.tests.length) {
        try { await PalmApp.loadHcpRun(history.tests[0].id); history.stagesByRun = history.stagesByRun || {}; history.stagesByRun[history.tests[0].id] = (PalmApp.state.hcpRun && PalmApp.state.hcpRun.stages) || []; } catch (e) { /* ignore */ }
      }
    }

    const connRow = (conn && conn.state) || {};
    const connState = String(connRow.conn_state || connRow.vpn_state || 'unknown');
    const statePill = connState === 'up' ? 'operational' : connState === 'degraded' ? 'warning' : connState === 'down' ? 'critical' : 'neutral';
    const gateState = (conn && conn.gate) || 'unknown';
    const gatePill = gateState === 'open' ? 'operational' : 'neutral';
    const latestCheck = (conn && conn.checks && conn.checks[0]) || null;
    const hcpCfg = (detail && detail.hcp) || {};
    const cred = (detail && detail.cred) || {};
    const integ = (detail && detail.integ) || {};
    const lastRun = (detail && detail.lastRun) || null;
    const value = (v, fallback) => (v === null || v === undefined || v === '' ? (fallback || 'Not configured') : v);
    const configured = list.filter(c => c.hcpHost);
    const withAuth = list.filter(c => c.authStatus === 'authenticated');

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">Compound Connectivity &amp; Integration Readiness</h1>
          <p class="body-md" style="color:var(--secondary);">Observed network state (real backend data) and configured HCP integration metadata per compound. Editing is available via “Edit configuration”; this build does not establish tunnels or call HCP APIs.</p>
        </div>
        <div style="display:flex; gap:10px;">
          ${cid ? `<button class="btn-secondary" onclick="PalmApp.openHcpEditDrawer(${Number(cid)})"><span class="material-symbols-outlined">edit</span> Edit configuration</button>` : ''}
          ${cid ? `<button class="btn-secondary" onclick="PalmApp.checkHcpConnection(${Number(cid)})"><span class="material-symbols-outlined">network_check</span> Run connectivity check</button>` : ''}
        </div>
      </div>

      ${loadError ? `<div class="exec-panel" style="padding:16px 20px; margin-bottom:20px; border-left:3px solid var(--status-critical);">
        <div class="body-sm" style="color:var(--status-critical);">Connectivity data could not be loaded: ${pEsc(loadError)}</div>
      </div>` : ''}

      <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:16px; margin-bottom:20px;">
        <div class="exec-panel" style="padding:18px 20px;">
          <div class="label-caps" style="color:var(--secondary);">Compounds tracked</div>
          <div class="headline-md font-mono">${pFmt(list.length)}</div>
        </div>
        <div class="exec-panel" style="padding:18px 20px;">
          <div class="label-caps" style="color:var(--secondary);">Host configured</div>
          <div class="headline-md font-mono">${pFmt(configured.length)}</div>
        </div>
        <div class="exec-panel" style="padding:18px 20px;">
          <div class="label-caps" style="color:var(--secondary);">Authenticated</div>
          <div class="headline-md font-mono">${pFmt(withAuth.length)}</div>
        </div>
        <div class="exec-panel" style="padding:18px 20px;">
          <div class="label-caps" style="color:var(--secondary);">Verified adapters</div>
          <div class="headline-md font-mono">${pFmt(registry.filter(a => a.verified).length)}</div>
        </div>
      </div>

      <div class="exec-panel" style="padding:20px; margin-bottom:20px;">
        <h3 class="headline-sm" style="margin-bottom:4px;">Compound registry</h3>
        <p class="body-sm" style="color:var(--secondary); margin-bottom:14px;">Status is exactly what the backend has recorded. “Unknown” means a check has not produced a result yet — it is not a success.</p>
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Compound</th><th>HCP host</th><th>Mode</th><th>Config</th><th>Observed link</th><th>Auth</th><th>Version</th><th>Last test</th></tr></thead>
            <tbody>
              ${list.map(c => {
                const st = c.netStatus === 'reachable' ? 'up' : (c.netStatus || 'unknown');
                const stPill = st === 'up' ? 'operational' : st === 'down' ? 'critical' : 'neutral';
                return `<tr>
                  <td>${pEsc(c.name)}</td>
                  <td class="font-mono">${c.hcpHost ? pEsc(c.hcpHost) : '<span style="color:var(--secondary);">Not configured</span>'}</td>
                  <td>${pEsc(c.integrationMode || '—')}</td>
                  <td><span class="status-pill ${c.configStatus === 'ready' ? 'operational' : 'neutral'}">${pEsc(c.configStatus || 'draft')}</span></td>
                  <td><span class="status-pill ${stPill}">${pEsc(st)}</span></td>
                  <td><span class="status-pill ${c.authStatus === 'authenticated' ? 'operational' : c.authStatus === 'failed' ? 'critical' : 'neutral'}">${pEsc(c.authStatus || 'unknown')}</span></td>
                  <td class="font-mono">${c.hcpVersion ? pEsc(c.hcpVersion) : '—'}</td>
                  <td class="font-mono">${c.lastTest ? pEsc(c.lastTest.finished_at || c.lastTest.started_at || '') : 'Never'}</td>
                </tr>`;
              }).join('')}
              ${list.length === 0 ? '<tr><td colspan="8" style="text-align:center; color:var(--secondary); padding:28px;">No compounds returned by the backend.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>

      ${detail ? `
      <div style="display:grid; grid-template-columns:1.2fr 0.8fr; gap:24px;">
        <div class="exec-panel" style="padding:24px;">
          <h3 class="headline-sm" style="margin-bottom:4px;">${pEsc((detail.compound && detail.compound.name) || 'Selected compound')}</h3>
          <p class="body-sm" style="color:var(--secondary); margin-bottom:16px;">Configuration currently stored on the server. Secret fields are never returned.</p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
            <div><div class="label-caps" style="color:var(--secondary);">HCP host</div><div class="font-mono">${pEsc(value(hcpCfg.hcp_host))}</div></div>
            <div><div class="label-caps" style="color:var(--secondary);">Port / HTTPS</div><div class="font-mono">${pEsc(value(hcpCfg.hcp_port || 443))} · ${hcpCfg.https === 0 ? 'No' : 'Yes'}</div></div>
            <div><div class="label-caps" style="color:var(--secondary);">HCP version</div><div class="font-mono">${pEsc(value(hcpCfg.hcp_version, 'Unverified'))}</div></div>
            <div><div class="label-caps" style="color:var(--secondary);">OpenAPI version</div><div class="font-mono">${pEsc(value(hcpCfg.openapi_version, 'Unverified'))}</div></div>
            <div><div class="label-caps" style="color:var(--secondary);">TLS verification</div><div>${hcpCfg.tls_verify === 0 ? '<span class="status-pill warning">Disabled</span>' : '<span class="status-pill operational">Enabled</span>'}</div></div>
            <div><div class="label-caps" style="color:var(--secondary);">Custom CA</div><div>${hcpCfg.tls_ca ? 'Pinned' : 'None'}</div></div>
            <div><div class="label-caps" style="color:var(--secondary);">App key</div><div class="font-mono">${cred.app_key ? pEsc(cred.app_key) : '<span style="color:var(--secondary);">Not configured</span>'}</div></div>
            <div><div class="label-caps" style="color:var(--secondary);">App secret</div><div class="font-mono">${cred.app_secret_enc ? '•••••••• (stored)' : '<span style="color:var(--secondary);">Not configured</span>'}</div></div>
            <div><div class="label-caps" style="color:var(--secondary);">Integration mode</div><div>${pEsc(value(integ.integration_mode))}</div></div>
            <div><div class="label-caps" style="color:var(--secondary);">Integration enabled</div><div>${integ.integration_enabled ? 'Yes' : 'No'}</div></div>
          </div>
          <p class="body-sm" style="color:var(--secondary); margin-top:16px;">Configuration is editable via the <strong>Edit configuration</strong> button above (PUT /api/hcp/compounds/:id). Secret fields are never returned; leave them blank to keep the stored value.</p>
        </div>

        <div class="exec-panel" style="padding:24px;">
          <h3 class="headline-sm" style="margin-bottom:12px;">Observed state</h3>
          <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--surface-container-low); border-radius:var(--radius-default); margin-bottom:10px;">
            <div><strong>Network link</strong><div class="body-sm" style="color:var(--secondary);">${connRow.last_check_at ? 'Last checked ' + pEsc(connRow.last_check_at) : 'Never checked'}</div></div>
            <span class="status-pill ${statePill}">${pEsc(connState)}</span>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--surface-container-low); border-radius:var(--radius-default); margin-bottom:10px;">
            <div><strong>Sync gate</strong><div class="body-sm" style="color:var(--secondary);">Requires observed link, verified adapter and established credentials</div></div>
            <span class="status-pill ${gatePill}">${pEsc(gateState)}</span>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--surface-container-low); border-radius:var(--radius-default); margin-bottom:10px;">
            <div><strong>Last connectivity check</strong><div class="body-sm" style="color:var(--secondary);">${latestCheck ? pEsc(latestCheck.checked_at || '') : 'No checks recorded'}</div></div>
            <span class="font-mono">${latestCheck && latestCheck.latency_ms != null ? pEsc(latestCheck.latency_ms) + ' ms' : '—'}</span>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--surface-container-low); border-radius:var(--radius-default);">
            <div><strong>Last diagnostic run</strong><div class="body-sm" style="color:var(--secondary);">${lastRun ? pEsc(lastRun.finished_at || lastRun.started_at || '') : 'Never run'}</div></div>
            <span class="status-pill ${lastRun && lastRun.status === 'completed' ? 'operational' : lastRun && lastRun.status === 'failed' ? 'critical' : 'neutral'}">${pEsc(lastRun ? lastRun.status : 'none')}</span>
          </div>
          <p class="body-sm" style="color:var(--secondary); margin-top:14px;">The backend cannot open a VPN tunnel. It only records and observes the link assigned to this compound. Sync stays blocked until a version-specific, verified adapter is in place.</p>
        </div>
      </div>` : ''}

      <div class="exec-panel" style="padding:20px; margin-top:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h3 class="headline-sm" style="margin-bottom:0;">Diagnostics — last run</h3>
          ${cid ? `<button class="btn-secondary" onclick="PalmApp.runHcpDiagnostics(${Number(cid)}).then(()=>{ PalmApp.showToast('Diagnostics started; refresh in a moment.'); }).catch(e=>PalmApp.showToast('Diagnostics failed: '+(e&&e.message?e.message:e)))"><span class="material-symbols-outlined">play_arrow</span> Run diagnostics</button>` : ''}
        </div>
        ${history && history.tests && history.tests.length ? (() => {
          const run = history.tests[0];
          const stages = (history.stagesByRun && history.stagesByRun[run.id]) || [];
          const stagePill = (s) => s === 'success' ? 'operational' : s === 'failed' ? 'critical' : s === 'blocked' || s === 'warning' ? 'warning' : 'neutral';
          return `
            <div class="body-sm" style="color:var(--secondary); margin-bottom:10px;">
              Run #${run.id} · status <strong>${pEsc(run.status)}</strong> · started ${pEsc(run.started_at || '')} · finished ${pEsc(run.finished_at || '—')} · ${pEsc(run.summary || '')}
            </div>
            ${stages.length ? `<div class="exec-table-wrap"><table class="exec-table"><thead><tr><th>Stage</th><th>Status</th><th>Duration</th><th>Message</th></tr></thead><tbody>
              ${stages.map(s => `<tr>
                <td class="font-mono">${pEsc(s.stage)}</td>
                <td><span class="status-pill ${stagePill(s.status)}">${pEsc(s.status)}</span></td>
                <td class="font-mono">${s.duration_ms != null ? pEsc(s.duration_ms) + ' ms' : '—'}</td>
                <td class="body-sm">${pEsc(s.message || '')}${s.action ? '<div class="body-sm" style="color:var(--status-warning); margin-top:4px;">Action: ' + pEsc(s.action) + '</div>' : ''}</td>
              </tr>`).join('')}
            </tbody></table></div>` : '<div class="body-sm" style="color:var(--secondary);">No stage detail recorded for this run.</div>'}
          `;
        })() : '<div class="body-sm" style="color:var(--secondary);">No diagnostic runs recorded yet. Click “Run diagnostics” to execute the connection test (VPN state, route/TCP, TLS, service reachability, version identify, adapter compatibility, auth, read-only operations, sync gate).</div>'}
      </div>

      <div class="exec-panel" style="padding:20px; margin-top:20px;">
        <h3 class="headline-sm" style="margin-bottom:4px;">Adapter registry</h3>
        <p class="body-sm" style="color:var(--secondary); margin-bottom:14px;">Only an adapter marked <strong>verified</strong> may be used for live data. Unverified adapters keep sync blocked by design.</p>
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Adapter</th><th>Label</th><th>HCP versions</th><th>OpenAPI versions</th><th>Verified</th><th>Limitations</th></tr></thead>
            <tbody>
              ${registry.map(a => `<tr>
                <td class="font-mono">${pEsc(a.adapter_id)}</td>
                <td>${pEsc(a.label || '')}</td>
                <td class="font-mono">${pEsc(a.hcp_versions || '[]')}</td>
                <td class="font-mono">${pEsc(a.openapi_versions || '[]')}</td>
                <td><span class="status-pill ${a.verified ? 'operational' : 'neutral'}">${a.verified ? 'Verified' : 'Unverified'}</span></td>
                <td class="body-sm">${pEsc(a.limitations || '')}</td>
              </tr>`).join('')}
              ${registry.length === 0 ? '<tr><td colspan="6" style="text-align:center; color:var(--secondary); padding:24px;">Adapter registry is empty.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 6. HCP ACCESS EVENTS — REAL ROWS FROM /api/access (IMPORTED, NOT LIVE)
  'hcp-live': async function() {
    const compound = PalmApp.state.selectedCompound || 'all';
    const compounds = PalmApp.state.compounds || [];
    const selectedCompoundObj = (compound !== 'all') ? compounds.find(x => x.name === compound) : null;
    const selectedCid = selectedCompoundObj ? selectedCompoundObj.id : null;

    // Connectivity: if up & verified, retrieve (sync) data from HCP and prefer live events.
    let hcpGate = { open: false, gate: 'blocked' };
    let liveRows = null;
    let liveTotal = 0;
    if (selectedCid) {
      try { hcpGate = await PalmApp.hcpGateOpen(selectedCid); } catch (e) { hcpGate = { open: false, gate: 'blocked' }; }
      if (hcpGate.open) {
        if (PalmApp.state.hcpSyncedCompound !== selectedCid) {
          PalmApp.state.hcpSyncedCompound = selectedCid;
          PalmApp.showToast('Retrieving data from HCP for ' + compound + '…');
          PalmApp.syncHcpCompound(selectedCid).then(() => {
            PalmApp.showToast('HCP sync completed.');
          }).catch(e => {
            PalmApp.showToast('HCP sync failed: ' + (e && e.message ? e.message : e));
          });
        }
        try {
          const r = await PalmApp.loadHcpLiveEventsForCompound(selectedCid, 'events');
          const rows = (r && (r.rows || r.items)) || [];
          liveRows = rows;
          liveTotal = (r && r.total) != null ? r.total : rows.length;
        } catch (e) { liveRows = null; }
      }
    }

    // Fallback to imported data if no live data.
    let access = { rows: [], total: 0 };
    if (!liveRows) {
      try { access = await PalmApp.loadHcpLiveEvents(15); } catch (e) { access = { rows: [], total: 0 }; }
    }
    const importedRows = access.rows || [];
    const importedTotal = access.total != null ? access.total : importedRows.length;
    const useLive = Array.isArray(liveRows);
    const rows = useLive ? liveRows : importedRows;
    const total = useLive ? liveTotal : importedTotal;
    const resPill = res => (/not\s*passed|fail|denied|rejected|hold|blocked/i.test(String(res || '')) ? 'critical' : (/pass|ok|approved|valid|success|open/i.test(String(res || '')) ? 'operational' : 'neutral'));

    const badge = selectedCid
      ? `<span class="status-pill ${hcpGate.open ? 'operational' : 'neutral'}">${hcpGate.open ? 'HCP connected &amp; verified' : 'HCP not connected'}</span>`
      : `<span class="status-pill neutral">All compounds</span>`;

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">HCP Access Events</h1>
          <p class="body-md" style="color:var(--secondary);">${useLive ? 'Live HCP events retrieved for the selected compound (most recent first).' : 'The most recent HCP vehicle-access records imported for the selected reporting period. This view is not a live socket stream: records appear after an import is processed.'}</p>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          ${badge}
          <span class="status-pill ${useLive ? 'operational' : 'neutral'}">${useLive ? 'Live from HCP' : 'Imported data'}</span>
          ${selectedCid && !hcpGate.open ? `<button class="btn-ghost" onclick="PalmApp.openHcpEditDrawer(${selectedCid})"><span class="material-symbols-outlined">settings</span> Configure HCP</button>` : ''}
          ${selectedCid ? `<button class="btn-ghost" onclick="PalmApp.hcpGateOpen(${selectedCid}).then(()=>PalmApp.navigate('hcp-live', true)).catch(()=>{})"><span class="material-symbols-outlined">refresh</span> Retry connection</button>` : ''}
          <button class="btn-secondary" onclick="PalmApp.navigate('vehicle-access')"><span class="material-symbols-outlined">toll</span> Open full access log</button>
        </div>
      </div>

      <div class="exec-panel">
        <div style="padding:12px 20px; border-bottom:1px solid var(--hairline-divider); display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <span class="body-sm" style="color:var(--secondary);">Showing ${pFmt(rows.length)} of ${pFmt(total)} access events ${useLive ? 'from HCP' : 'in scope for the selected period'}.</span>
          <button class="btn-ghost" onclick="PalmApp.exportEntity('access', { period: PalmApp.state.selectedPeriod, compound: PalmApp.state.selectedCompound })">Export (.xlsx)</button>
        </div>
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Event ID</th><th>Capture Time</th><th>Compound &amp; Gate</th><th>Method</th><th>Identified Subject</th><th>Access Result</th></tr></thead>
            <tbody>
              ${rows.map(r => `
              <tr>
                <td class="font-mono">#${pEsc(r.id || r.source_id || '')}</td>
                <td class="font-mono">${pEsc(pFmtCapture(r.enter_time || r.exit_time || r.event_time || ''))}</td>
                <td>${pEsc(r.compound || compound)} • ${pEsc(r.gate || '')}</td>
                <td>${pEsc(r.method || '')}</td>
                <td>${pEsc(r.plate || r.ref_plate || '')} ${pEsc(r.owner_raw || r.ref_person || '')}</td>
                <td><span class="status-pill ${resPill(r.result)}">${pEsc(r.result || '')}</span></td>
              </tr>`).join('')}
              ${rows.length === 0 ? `<tr><td colspan="6" style="text-align:center; color:var(--secondary); padding:32px;">${useLive ? 'No live HCP events retrieved for this compound.' : 'No access events were imported for the selected reporting period and compound scope.'}</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 7. HCP VEHICLE COUNT COMPARISON — REAL DATA FROM /api/hcp/vehicle-comparison
  'hcp-vehicle-counts': async function() {
    let cmp = { compounds: [] };
    try { cmp = await PalmApp.loadHcpVehicleComparison(); } catch (e) { cmp = { compounds: [] }; }
    const rows = cmp.compounds || [];

    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">HCP vs Property CRM Vehicle Count Benchmark</h1>
        <p class="body-md" style="color:var(--secondary);">Auditing discrepancies between physical gate passage counts in HikCentral and contractually registered vehicles in CRM.</p>
      </div>

      <div class="exec-panel">
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Compound</th><th>HCP Optical Detections</th><th>CRM Matched</th><th>Variance (Unmatched)</th><th>Audit Status</th></tr></thead>
            <tbody>
              ${rows.map(r => `
              <tr>
                <td><strong>${pEsc(r.compound)}</strong></td>
                <td class="font-mono">${pFmt(r.hcp_vehicles)}</td>
                <td class="font-mono">${pFmt(r.hcp_matched_crm)}</td>
                <td class="font-mono" style="color:${r.hcp_unmatched > 0 ? 'var(--status-critical)' : 'var(--status-active)'}">${pFmt(r.hcp_unmatched)} (Unmatched)</td>
                <td><span class="status-pill ${r.hcp_unmatched > 0 ? 'critical' : 'operational'}">${r.hcp_unmatched > 0 ? 'Tag Discrepancy' : 'Reconciled'}</span></td>
              </tr>`).join('')}
              ${rows.length === 0 ? `<tr><td colspan="5" style="text-align:center; color:var(--secondary); padding:32px;">No HCP vehicle comparison rows available for the selected scope.</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 8. INVITATIONS — REAL DATA FROM /api/invitations
  'invitations': async function() {
    const period = PalmApp.state.selectedPeriod || '';
    const compound = PalmApp.state.selectedCompound || 'all';
    let inv = { rows: [] };
    try { inv = await PalmApp.loadPagedList('invitations', '/api/invitations', { period, compound }); } catch (e) { inv = { rows: [] }; }
    const rows = inv.rows || [];
    const statePill = st => (/active|pre-cleared|approved|issued|cleared/i.test(String(st || '')) ? 'operational' : (/pending|review|hold|draft/i.test(String(st || '')) ? 'warning' : 'neutral'));

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">Resident Guest Invitations</h1>
          <p class="body-md" style="color:var(--secondary);">Invitations recorded for the selected reporting month.</p>
        </div>
        <button class="btn-secondary" onclick="PalmApp.exportEntity('invitations', { period: PalmApp.state.selectedPeriod, compound: PalmApp.state.selectedCompound })"><span class="material-symbols-outlined">download</span> Export (.xlsx)</button>
      </div>
      <div class="exec-panel">
        ${PalmApp.pagerHtml('invitations')}
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Invitation Code</th><th>Host Homeowner</th><th>Target Unit</th><th>Guest Name</th><th>Valid Timeframe</th><th>Pass State</th></tr></thead>
            <tbody>
              ${rows.map(r => `
              <tr>
                <td class="font-mono">${pEsc(r.code || ('INV-' + String(r.id).padStart(5, '0')))}</td>
                <td>${r.provider ? `<a href="#" onclick="PalmApp.searchResident(${JSON.stringify(String(r.provider))}); return false;" title="Find resident">${pEsc(r.provider)}</a>` : '—'}</td>
                <td>${r.invite_to ? `<a href="#" onclick="PalmApp.searchUnit(${JSON.stringify(String(r.invite_to))}); return false;" title="Find unit">${pEsc(r.invite_to)}</a>` : '—'}</td>
                <td>${r.member_name ? `<a href="#" onclick="PalmApp.searchResident(${JSON.stringify(String(r.member_name))}); return false;" title="Find resident">${pEsc(r.member_name)}</a>` : '—'}</td>
                <td>${pEsc(r.created_on)}</td>
                <td><span class="status-pill ${statePill(r.status)}">${pEsc(r.status)}</span></td>
              </tr>`).join('')}
              ${rows.length === 0 ? `<tr><td colspan="6" style="text-align:center; color:var(--secondary); padding:32px;">No invitation requests recorded for the selected reporting period.</td></tr>` : ''}
            </tbody>
          </table>
</div>
      </div>
    `;
  },

  // 9. VISITORS — REAL DATA FROM /api/gatepasses (visitor proxy)
  'visitors': async function() {
    const period = PalmApp.state.selectedPeriod || '';
    const compound = PalmApp.state.selectedCompound || 'all';
    let passes = { rows: [] };
    try { passes = await PalmApp.loadPagedList('visitors-gatepasses', '/api/gatepasses', { period, compound }); } catch (e) { passes = { rows: [] }; }
    const rows = passes.rows || [];

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">Visitors Audit Log</h1>
          <p class="body-md" style="color:var(--secondary);">Gate passes recorded for the selected reporting month, shown as the visitor audit trail.</p>
        </div>
        <button class="btn-secondary" onclick="PalmApp.exportEntity('gatepasses', { period: PalmApp.state.selectedPeriod, compound: PalmApp.state.selectedCompound })"><span class="material-symbols-outlined">download</span> Export (.xlsx)</button>
      </div>
      <div class="exec-panel">
        ${PalmApp.pagerHtml('visitors-gatepasses')}
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Pass Token / QR</th><th>Visitor / Holder</th><th>Unit & Compound</th><th>Pass Type</th><th>Entry Window</th><th>Valid Until</th></tr></thead>
            <tbody>
              ${rows.map(r => `
              <tr>
                <td class="font-mono"><strong>GP-${String(r.id).padStart(5, '0')}</strong></td>
                <td>${pEsc(r.user)}</td>
                <td>${pEsc(r.compound)} • ${pEsc(r.unit)}</td>
                <td>${pEsc(r.access_type)}</td>
                <td>${pEsc(r.entry_date)}</td>
                <td>${pEsc(r.valid_until)}</td>
              </tr>`).join('')}
              ${rows.length === 0 ? `<tr><td colspan="6" style="text-align:center; color:var(--secondary); padding:32px;">No visitor gate passes recorded for the selected reporting period.</td></tr>` : ''}
            </tbody>
          </table>
</div>
      </div>
    `;
  },

  // 10. FACE RECOGNITION — REAL STATUS (HCP PERSON AUTH NOT IN CURRENT UPLOAD)
  'face-recognition': async function() {
    let periods = [];
    try { periods = await PalmApp.loadPeriods(); } catch (e) { periods = []; }
    const periodMeta = periods.find(p => p.period_key === PalmApp.state.selectedPeriod) || periods[0] || null;
    const periodLabel = periodMeta ? (periodMeta.period_name || periodMeta.period_key) : PalmApp.state.selectedPeriod;

    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">MinMoe Face Recognition Terminals</h1>
        <p class="body-md" style="color:var(--secondary);">Pedestrian turnstiles, clubhouse access, and executive lounge biometric telemetry.</p>
      </div>
      <div class="exec-panel"><div style="padding:48px; text-align:center; color:var(--secondary);">Biometric face-recognition telemetry for ${pEsc(periodLabel)} is unavailable — no HCP person/visitor authentication file was included in the upload. Imported ANPR and UHF barrier access events remain available under HCP Access Events.</div></div>
    `;
  },

  // 11. IDENTITY MATCHING — REAL DATA FROM /api/matching
  'identity-matching': async function() {
    let m = { matched: 0, possible: [], unmatched: [] };
    try { m = await PalmApp.loadMatching(); } catch (e) { m = { matched: 0, possible: [], unmatched: [] }; }
    const possibleRows = m.possible || [];
    const unmatchedRows = m.unmatched || [];
    const total = (m.matched || 0) + possibleRows.length + unmatchedRows.length;
    const score = total ? Math.round(((m.matched || 0) / total) * 1000) / 10 : 0;
    const canDecide = PalmApp.can('identity.decide');
    const actionCell = (name, label, id) => canDecide
      ? `<button class="btn-ghost" onclick="PalmApp.resolveIdentity(${pEsc(JSON.stringify(name))}, '${label}', ${id == null ? 'undefined' : Number(id)})">${label === 'reject' ? 'Reject' : 'Confirm'}</button>`
      : '<span class="body-sm" style="color:var(--secondary);">View only</span>';

    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">CRM Identity Matching</h1>
        <p class="body-md" style="color:var(--secondary);">Cross-matching between HCP vehicle-owner records and the Property CRM registry. Matches are name-based; ambiguous names require a human decision.</p>
      </div>
      <div class="exec-panel" style="margin-bottom:20px;">
        <div style="padding:40px; text-align:center;">
          <div class="font-mono" style="font-size:56px; font-weight:700; color:var(--primary-container);">${pFmt(score)}%</div>
          <div class="body-md" style="color:var(--secondary); margin-top:8px;">Identity match score across ${pFmt(total)} HCP owner records</div>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-top:28px;">
            <div style="padding:16px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid var(--hairline-divider);"><div class="font-mono" style="font-size:22px; font-weight:700;">${pFmt(m.matched)}</div><div class="body-sm" style="color:var(--secondary);">Matched</div></div>
            <div style="padding:16px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid var(--hairline-divider);"><div class="font-mono" style="font-size:22px; font-weight:700;">${pFmt(possibleRows.length)}</div><div class="body-sm" style="color:var(--secondary);">Possible matches</div></div>
            <div style="padding:16px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid var(--hairline-divider);"><div class="font-mono" style="font-size:22px; font-weight:700;">${pFmt(unmatchedRows.length)}</div><div class="body-sm" style="color:var(--secondary);">Unmatched</div></div>
          </div>
        </div>
      </div>

      <div class="exec-panel" style="padding:20px; margin-bottom:20px;">
        <h3 class="headline-sm" style="margin-bottom:4px;">Possible matches requiring review</h3>
        <p class="body-sm" style="color:var(--secondary); margin-bottom:14px;">Each row is an HCP owner name and the CRM candidates the backend found in your scope. Confirming links the identities; rejecting marks the HCP owner as unmatched.</p>
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>HCP owner</th><th>CRM candidate</th><th>Units</th><th>Compounds</th><th>Action</th></tr></thead>
            <tbody>
              ${possibleRows.map(p => {
                const opts = p.options || [];
                if (!opts.length) {
                  return `<tr><td>${pEsc(p.hcpName)}</td><td colspan="3" style="color:var(--secondary);">No CRM candidate in your scope</td><td>${actionCell(p.hcpName, 'reject')}</td></tr>`;
                }
                return opts.map(o => `<tr>
                  <td>${pEsc(p.hcpName)}</td>
                  <td>${pEsc(o.name)} <span class="body-sm" style="color:var(--secondary);">#${pEsc(o.id)}</span></td>
                  <td>${pEsc(o.units || '—')}</td>
                  <td>${pEsc(o.compounds || '—')}</td>
                  <td>${actionCell(p.hcpName, 'confirm', o.id)}</td>
                </tr>`).join('');
              }).join('')}
              ${possibleRows.length === 0 ? '<tr><td colspan="5" style="text-align:center; color:var(--secondary); padding:24px;">No ambiguous HCP owner records for the selected scope.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>

      <div class="exec-panel" style="padding:20px;">
        <h3 class="headline-sm" style="margin-bottom:4px;">Unmatched HCP owners</h3>
        <p class="body-sm" style="color:var(--secondary); margin-bottom:14px;">Names with no CRM match in the selected scope. They remain unmatched until a candidate record is created or confirmed.</p>
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>HCP owner</th><th>Status</th></tr></thead>
            <tbody>
              ${unmatchedRows.map(p => `<tr><td>${pEsc(p.hcpName)}</td><td><span class="status-pill neutral">Unmatched</span></td></tr>`).join('')}
              ${unmatchedRows.length === 0 ? '<tr><td colspan="2" style="text-align:center; color:var(--secondary); padding:24px;">No unmatched HCP owners for the selected scope.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 12. TRENDS (Portfolio Trends) — REAL DATA FROM /api/trends
  'portfolio-trends': async function() {
    let trends = [];
    try { trends = await PalmApp.loadTrends('active_units'); } catch (e) { trends = []; }
    const rows = trends || [];

    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Portfolio Access & Occupancy Trends</h1>
        <p class="body-md" style="color:var(--secondary);">Long-term traffic distribution, seasonal peak utilization, and barrier cycle analytics.</p>
      </div>
      <div class="exec-panel">
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Reporting Period</th><th>Metric</th><th>Value</th></tr></thead>
            <tbody>
              ${rows.map(r => `
              <tr>
                <td>${pEsc(r.period)}</td>
                <td>${pEsc(r.metric || 'active_units')}</td>
                <td class="font-mono">${pFmt(r.value)}</td>
              </tr>`).join('')}
              ${rows.length === 0 ? `<tr><td colspan="3" style="text-align:center; color:var(--secondary); padding:32px;">No trend history available for the selected reporting scope.</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 13. DATA QUALITY — REAL DATA FROM /api/quality
  'data-quality': async function() {
    let q = { period: null, score: 0, fileIssues: [], records: [], reconciliation: [] };
    try { q = await PalmApp.loadQuality(); } catch (e) { q = { period: null, score: 0, fileIssues: [], records: [], reconciliation: [] }; }
    const fileIssues = q.fileIssues || [];
    const records = q.records || [];

    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Data Quality & Telemetry Audit</h1>
        <p class="body-md" style="color:var(--secondary);">Monitoring missing datasets, orphaned relationships, unmatched identities and export completeness for the selected reporting period.</p>
      </div>
      <div class="exec-panel">
        <div style="padding:32px; display:grid; grid-template-columns:200px 1fr; gap:32px; align-items:start;">
          <div style="text-align:center; padding:24px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid var(--hairline-divider);">
            <div class="font-mono" style="font-size:48px; font-weight:700; color:${q.score >= 90 ? 'var(--status-active)' : (q.score >= 70 ? 'var(--status-warning)' : 'var(--status-critical)')};">${pFmt(q.score)}</div>
            <div class="body-sm" style="color:var(--secondary); margin-top:8px;">Data Health Score</div>
          </div>
          <div>
            <h3 class="title-md" style="margin-bottom:12px;">File & Record Issues</h3>
            ${fileIssues.length === 0 && records.length === 0 ? `<div class="body-md" style="color:var(--secondary);">No issues detected across the current reporting period.</div>` : `
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${fileIssues.map((f, i) => `
              <div key="${i}" style="display:flex; justify-content:space-between; gap:16px; padding:12px 16px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid var(--hairline-divider);">
                <span class="body-md">${pEsc(f.message)}</span>
                <span class="font-mono" style="color:${f.severity === 'error' ? 'var(--status-critical)' : 'var(--status-warning)'};">${pEsc(f.severity)}</span>
              </div>`).join('')}
              ${records.map((r, i) => `
              <div key="${i}" style="display:flex; justify-content:space-between; gap:16px; padding:12px 16px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid var(--hairline-divider);">
                <span class="body-md">${pEsc(r.message)}</span>
                <span class="font-mono" style="color:${r.severity === 'error' ? 'var(--status-critical)' : 'var(--status-warning)'};">${pFmt(r.count)}</span>
              </div>`).join('')}
            </div>`}
          </div>
        </div>
      </div>
    `;
  },

  // 14. MONTHLY IMPORTS — REAL UPLOAD (POST /api/uploads) + IMPORT REGISTRY
  'monthly-imports': async function() {
    let imports = [];
    try { const r = await PalmApp.apiGet('/api/imports'); imports = Array.isArray(r) ? r : (r.rows || []); } catch (e) { imports = []; }
    let compounds = [];
    try { compounds = await PalmApp.loadCompounds(); } catch (e) { compounds = []; }
    const pendingImportId = PalmApp.state.pendingImportId || null;
    const defaultPeriod = PalmApp.defaultImportPeriod ? PalmApp.defaultImportPeriod() : '';
    const statusTone = st => (/completed/i.test(String(st || '')) ? 'operational'
      : (/fail|error|deleted|rolled/i.test(String(st || '')) ? 'critical'
      : (/cancel/i.test(String(st || '')) ? 'neutral' : 'warning')));
    const isRunning = st => /^(PROCESSING|VALIDATING)$/i.test(String(st || ''));
    const canProcess = st => /^(FAILED|ANALYZING|UPLOADED|staged)$/i.test(String(st || ''));
    const periodKnown = r => Boolean(r.reporting_period || r.detected_period_key);
    const sourceLabel = r => r.source_kind ? r.source_kind.replace(/_/g, ' ') : 'Legacy monthly';
    const hcpSelected = PalmApp.state.hcpCompoundId;
    const hcpPreview = PalmApp.state.hcpPreview || null;
    const crmImports = imports.filter(r => r.source_kind === 'CRM_UPLOAD');
    const hcpImports = imports.filter(r => r.source_kind === 'HCP_MANUAL_UPLOAD' || r.source_kind === 'HCP_API_SYNC');

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">CRM &amp; HCP Imports</h1>
          <p class="body-md" style="color:var(--secondary);">Separate workflows: CRM masters and compound-scoped HCP exports. Processing runs in a background worker.</p>
        </div>
        <button class="btn-secondary" onclick="PalmApp.mountPage()"><span class="material-symbols-outlined">refresh</span> Refresh</button>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
        <div class="exec-panel" style="padding:24px;">
          <h3 class="title-md" style="margin-bottom:4px;">CRM Upload</h3>
          <p class="body-sm" style="color:var(--secondary); margin-bottom:14px;">Users, units, unit access, vehicles, gate passes, invitations. HCP files are rejected by this workflow — use the HCP card for those.</p>
          <input type="file" id="crm-file-input" accept=".zip,.xlsx,.xls,.csv" style="display:none;" onchange="PalmApp.handleCrmFile(this)" />
          <button class="btn-primary" onclick="PalmApp.pickCrmFile()"><span class="material-symbols-outlined">upload_file</span> Browse CRM file / ZIP</button>
          <div style="margin-top:16px; display:flex; flex-direction:column; gap:6px;">
            ${crmImports.slice(0, 5).map(r => `<div class="body-sm" style="display:flex; justify-content:space-between; gap:12px; padding:8px 12px; background:var(--surface-container-low); border-radius:var(--radius-default);"><span>#${pEsc(r.id)} • ${pEsc(r.source_filename || '')}</span><span class="status-pill ${statusTone(r.status)}">${pEsc(r.status)}</span></div>`).join('') || '<div class="body-sm" style="color:var(--secondary);">No CRM uploads yet.</div>'}
          </div>
        </div>
        <div class="exec-panel" style="padding:24px;">
          <h3 class="title-md" style="margin-bottom:4px;">Compound HCP Upload</h3>
          <p class="body-sm" style="color:var(--secondary); margin-bottom:14px;">Vehicle entrance/exit exports for one compound from the existing compounds database. Records are persisted against the selected compound ID — never a typed name.</p>
          <div style="display:flex; gap:10px; align-items:center; margin-bottom:12px;">
            <select class="form-control-select" style="min-width:220px;" onchange="PalmApp.setHcpCompound(this.value)">
              <option value="">Select compound (required)</option>
              ${compounds.map(c => `<option value="${Number(c.id)}" ${hcpSelected === Number(c.id) ? 'selected' : ''}>${pEsc(c.name)}</option>`).join('')}
            </select>
            <input type="file" id="hcp-file-input" accept=".zip,.xlsx,.xls,.csv" style="display:none;" onchange="PalmApp.handleHcpFile(this)" />
            <button class="btn-primary" onclick="PalmApp.pickHcpFile()" ${hcpSelected ? '' : 'disabled'}><span class="material-symbols-outlined">upload_file</span> Browse HCP file / ZIP</button>
          </div>
          ${hcpSelected ? '' : '<div class="body-sm" style="color:var(--status-warning); margin-bottom:12px;">Select a compound to enable HCP upload. Only compounds in your assigned scope are listed.</div>'}
          ${hcpPreview ? `
            <div style="border:1px solid var(--hairline-divider); border-radius:var(--radius-default); padding:14px;">
              <div class="title-md" style="margin-bottom:8px;">Preview — import #${pEsc(hcpPreview.import.id)}${hcpPreview.compound ? ' (' + pEsc(hcpPreview.compound.name) + ')' : ''}</div>
              <div class="body-sm" style="margin-bottom:8px;">Files: <strong>${pFmt(hcpPreview.totals.files)}</strong> • Records: <strong>${pFmt(hcpPreview.totals.records)}</strong> • Valid: <strong>${pFmt(hcpPreview.totals.validFiles)}</strong> • Invalid: <strong>${pFmt(hcpPreview.totals.invalidFiles)}</strong> • Period: <strong>${pEsc(hcpPreview.import.detected_period_key || hcpPreview.import.reporting_period || 'confirm on confirm')}</strong></div>
              ${hcpPreview.validation.map(v => `<div class="body-sm" style="padding:6px 0; border-bottom:1px solid var(--hairline-divider);"><strong>${pEsc(v.filename)}</strong> — ${pEsc(v.dataset)} • ${pFmt(v.rows)} rows • ${pEsc(v.status)}${v.error ? ' • ' + pEsc(v.error) : ''}</div>`).join('')}
              <button class="btn-primary" style="margin-top:14px;" onclick="PalmApp.confirmHcpImport(${Number(hcpPreview.import.id)})">Confirm import</button>
            </div>` : `<div class="body-sm" style="color:var(--secondary); margin-bottom:14px;">After staging, load the preview before confirming.</div>`}
          <div style="margin-top:12px; display:flex; flex-direction:column; gap:6px;">
            ${hcpImports.slice(0, 5).map(r => `<div class="body-sm" style="display:flex; justify-content:space-between; gap:12px; padding:8px 12px; background:var(--surface-container-low); border-radius:var(--radius-default);">
              <span>#${pEsc(r.id)} • ${pEsc(r.source_filename || '')}${r.compound_id ? ' • compound #' + pEsc(r.compound_id) : ''}</span>
              <span style="display:flex; gap:8px; align-items:center;"><span class="status-pill ${statusTone(r.status)}">${pEsc(r.status)}</span><button class="btn-ghost" onclick="PalmApp.previewHcpImport(${Number(r.id)})">Preview</button></span>
            </div>`).join('') || '<div class="body-sm" style="color:var(--secondary);">No HCP uploads yet.</div>'}
          </div>
        </div>
      </div>

      <div class="exec-panel" style="padding:24px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:12px;">
          <div>
            <h3 class="title-md" style="margin-bottom:4px;">Import registry (${imports.length})</h3>
            <div class="body-sm" style="color:var(--secondary);">CRM imports need a confirmed month (CRM exports carry no HCP timestamps). HCP imports are bound to their compound. Uploading does not re-send the files.</div>
          </div>
        </div>
        ${imports.length ? `
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${imports.slice(0, 10).map((r, i) => {
            const pending = pendingImportId != null && String(pendingImportId) === String(r.id);
            return `
          <div style="display:flex; flex-direction:column; gap:8px; padding:12px 16px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid ${pending ? 'var(--status-warning)' : 'var(--hairline-divider)'};">
            <div style="display:flex; justify-content:space-between; gap:16px; align-items:center;">
              <div style="min-width:0;">
                <div class="body-md" style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${pEsc(r.source_filename || ('Import #' + r.id))}</div>
                <div class="body-sm" style="color:var(--secondary);">Import #${pEsc(r.id)} • ${pEsc(sourceLabel(r))}${r.compound_id ? ' • compound #' + pEsc(r.compound_id) : ''} • Period ${pEsc(r.reporting_period || r.detected_period_key || 'not confirmed')} • ${pEsc(r.uploaded_at || '')}</div>
              </div>
              <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
                <span class="status-pill ${statusTone(r.status)}">${pEsc(r.status)}</span>
                ${canProcess(r.status) && !periodKnown(r) ? `
                  <input type="month" id="import-period-${pEsc(r.id)}" value="${pEsc(defaultPeriod)}" class="form-control-input" style="width:150px; height:32px; font-size:12px;" title="Reporting month (YYYY-MM)" />
                  <button class="btn-primary" style="height:32px; font-size:11px;" onclick="PalmApp.processStagedImport(${Number(r.id)}, document.getElementById('import-period-${pEsc(r.id)}').value)">Process</button>
                ` : (canProcess(r.status) && !isRunning(r.status) ? `
                  <button class="btn-secondary" style="height:30px; font-size:11px;" onclick="PalmApp.processStagedImport(${Number(r.id)}, '${pEsc(r.reporting_period || r.detected_period_key || '')}')">Reprocess</button>
                ` : (isRunning(r.status) ? `<span class="body-sm" style="color:var(--secondary);">Working…</span>` : ''))}
              </div>
            </div>
          </div>`;
          }).join('')}
        </div>` : `<div class="body-sm" style="color:var(--secondary);">No imports recorded yet. Upload a CRM or HCP file to begin.</div>`}
      </div>
    `;
  },

  // 15. ASK PALM AI / AI ANALYST — ANSWERS COMPUTED BY /api/ai/ask
  'ai-analyst': async function() {
    const chat = PalmApp.state.aiChat || [];
    const pendingIdx = chat.findIndex(m => m.loading);
    if (pendingIdx !== -1) {
      let question = '';
      for (let i = pendingIdx - 1; i >= 0; i -= 1) { if (chat[i].from === 'user') { question = chat[i].text; break; } }
      try {
        const r = await PalmApp.loadAiAsk(question);
        chat[pendingIdx] = { from: 'ai', text: r.answer, ts: Date.now(), table: r.table };
      } catch (e) {
        if (e && e.status === 401) return '';
        chat[pendingIdx] = { from: 'ai', text: 'The analyst could not answer: ' + ((e && e.message) || 'unexpected error'), ts: Date.now() };
      }
      PalmApp.state.aiChat = chat;
    }

    const scope = PalmApp.state.scope || {};
    const scopeCompounds = Array.isArray(scope.compounds) ? scope.compounds : [];
    const selected = PalmApp.state.selectedCompound || 'all';
    const scopeText = selected !== 'all' ? selected : (scope.all ? 'All developments' : (scopeCompounds.length ? scopeCompounds.join(', ') : 'All assigned communities'));
    const periodText = PalmApp.state.selectedPeriod || 'Latest available period';
    const roleText = PalmApp.state.role || 'Unknown role';

    const renderTable = t => {
      if (!t) return '';
      return `<div style="margin-top:10px; overflow-x:auto;">
        <table class="exec-table">
          <thead><tr>${(t.columns || []).map(c => `<th>${pEsc(c)}</th>`).join('')}</tr></thead>
          <tbody>${(t.rows || []).map(r => `<tr>${(r || []).map(c => `<td>${pEsc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`;
    };

    return `
      <div style="display:grid; grid-template-columns:280px 1fr; gap:24px; height:calc(100vh - 160px);">
        <!-- AI Context Sidebar -->
        <div class="exec-panel" style="padding:20px; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:18px;">
              <div style="width:40px; height:40px; border-radius:50%; background:var(--primary-container); display:flex; align-items:center; justify-content:center; color:#fff;">
                <span class="material-symbols-outlined">psychology</span>
              </div>
              <div>
                <h3 class="title-md">Palm AI Copilot</h3>
                <span class="status-pill neutral" style="font-size:9px;">Backend-grounded</span>
              </div>
            </div>
            <div class="label-caps" style="color:var(--secondary); margin-bottom:8px;">Active context</div>
            <div style="padding:10px; background:var(--surface-container-low); border-radius:var(--radius-default); font-size:12px; margin-bottom:16px;">
              <strong>Scope:</strong> ${pEsc(scopeText)}<br/>
              <strong>Reporting period:</strong> ${pEsc(periodText)}<br/>
              <strong>Role:</strong> ${pEsc(roleText)}
            </div>
            <div class="label-caps" style="color:var(--secondary); margin-bottom:8px;">Suggested queries</div>
            <button class="btn-ghost" style="width:100%; text-align:left; font-size:12px; justify-content:flex-start; margin-bottom:4px;" onclick="PalmApp.askAi('Summarize the current portfolio operational posture')">◆ Summarize the current portfolio posture</button>
            <button class="btn-ghost" style="width:100%; text-align:left; font-size:12px; justify-content:flex-start; margin-bottom:4px;" onclick="PalmApp.askAi('Audit ANPR tag mismatches by compound')">◆ Audit ANPR tag mismatches by compound</button>
            <button class="btn-ghost" style="width:100%; text-align:left; font-size:12px; justify-content:flex-start; margin-bottom:4px;" onclick="PalmApp.askAi('Which compounds have the lowest unit coverage?')">◆ Which compounds have the lowest unit coverage?</button>
          </div>
          <div class="body-sm" style="font-size:11px; color:var(--secondary);">Answers are computed from imported data on the server; compound scope and PII masking apply to every query.</div>
        </div>

        <!-- Chat Console -->
        <div class="exec-panel" style="display:flex; flex-direction:column; overflow:hidden;">
          <div style="flex:1; padding:24px; overflow-y:auto;">
            ${chat.length === 0 ? `<div class="body-sm" style="color:var(--secondary);">Ask a question about the selected reporting period, or choose a suggested query. The answer is computed by the backend from imported data; it is not a live stream.</div>` : ''}
            ${chat.map(m => `
            <div style="display:flex; ${m.from === 'user' ? 'justify-content:flex-end' : 'justify-content:flex-start'}; margin-bottom:20px;">
              <div style="max-width:${m.from === 'user' ? '75' : '85'}%; background:${m.from === 'user' ? 'var(--primary-container)' : 'var(--surface-container-low)'}; color:${m.from === 'user' ? '#fff' : 'var(--on-surface)'}; padding:12px 18px; border-radius:${m.from === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px'}; font-size:13.5px; ${m.from === 'ai' ? 'border:1px solid var(--hairline-divider);' : ''} white-space:pre-line;">
                ${m.loading ? 'Computing answer from imported data…' : pEsc(m.text)}
                ${m.from === 'ai' ? renderTable(m.table) : ''}
              </div>
            </div>`).join('')}
          </div>

          <!-- Input Bar -->
          <div style="padding:16px 20px; border-top:1px solid var(--hairline-divider); background:var(--surface-container-lowest); display:flex; gap:12px; align-items:center;">
            <input id="ai-question" type="text" class="form-control-input" style="flex:1; height:44px;" placeholder="Ask about compound operations, residents, vehicles or access events…" onkeydown="if(event.key==='Enter'){PalmApp.askAiFromInput();}" />
            <button class="btn-primary" style="height:44px; padding:0 24px;" onclick="PalmApp.askAiFromInput()"><span class="material-symbols-outlined">send</span> Ask</button>
          </div>
        </div>
      </div>
    `;
  },

  // 16. REPORTS — REAL EXPORT FROM /api/report.xlsx
  'reports': async function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Executive Reports & Dossier Generation</h1>
        <p class="body-md" style="color:var(--secondary);">Generate board-ready operational summaries, occupancy economics, and incident audits.</p>
      </div>
      <div class="exec-panel" style="padding:24px;">
        <button class="btn-primary" onclick="PalmApp.exportReport()"><span class="material-symbols-outlined">table_view</span> Generate Monthly Executive Workbook (XLSX)</button>
      </div>
    `;
  },

  // 17. SETTINGS
  // 17. SETTINGS — REAL VALUES FROM /api/settings
  'settings': async function() {
    let settings = {};
    let loadError = '';
    try { settings = await PalmApp.loadSettings(); } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) throw e;
      loadError = e && e.message ? e.message : String(e);
    }
    const compounds = (PalmApp.state && PalmApp.state.compounds) || [];
    const canBusiness = PalmApp.can('settings.business');
    const canSystem = PalmApp.can('settings.system');
    const v = k => (settings[k] == null || settings[k] === '' ? '' : String(settings[k]));
    const disabled = canBusiness ? '' : ' disabled';
    const sysDisabled = canSystem ? '' : ' disabled';
    const keySet = !!v('ai_api_key');
    const val = (k, fallback) => (v(k) ? pEsc(v(k)) : `<span style="color:var(--secondary);">${pEsc(fallback)}</span>`);

    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">System &amp; Governance Settings</h1>
        <p class="body-md" style="color:var(--secondary);">Values below are read live from the application database. Every change is written through <span class="font-mono">PUT /api/settings</span> and recorded in the audit log.</p>
      </div>

      ${loadError ? `<div class="exec-panel" style="padding:16px 20px; margin-bottom:20px; border-left:3px solid var(--status-critical);">
        <div class="body-sm" style="color:var(--status-critical);">Settings could not be loaded: ${pEsc(loadError)}</div>
      </div>` : ''}

      <div id="settings-form">
        <div class="exec-panel" style="padding:24px; margin-bottom:20px;">
          <h3 class="title-md" style="margin-bottom:4px;">Business settings</h3>
          <p class="body-sm" style="color:var(--secondary); margin-bottom:18px;">Operational defaults used by the dashboard and reporting views. Requires the <span class="font-mono">settings.business</span> permission to change.</p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; max-width:820px;">
            <div>
              <label class="label-md" for="setting-timezone">Reporting timezone</label>
              <input id="setting-timezone" type="text" class="form-control-input" style="width:100%;" data-setting-key="timezone" value="${pEsc(v('timezone'))}" placeholder="Not configured"${disabled} />
              <div class="body-sm" style="color:var(--secondary); margin-top:6px;">IANA timezone used when reporting dates are interpreted.</div>
            </div>
            <div>
              <div class="label-md">Parking-lot compound map</div>
              <pre class="font-mono" style="margin:0; padding:10px 12px; background:var(--surface-container-low); border-radius:var(--radius-default); font-size:11.5px; white-space:pre-wrap; word-break:break-word; max-height:120px; overflow:auto;">${pEsc(v('parking_lot_compound') || 'Not configured')}</pre>
              <div class="body-sm" style="color:var(--secondary); margin-top:6px;">Gate-to-compound JSON map consumed by the import pipeline. It is shown read-only here; a dedicated editor is Phase 2.</div>
            </div>
          </div>
          <div style="margin-top:18px; display:flex; align-items:center; gap:12px;">
            <button class="btn-primary" onclick="PalmApp.saveSettingsForm('business')"${canBusiness ? '' : ' disabled'}>Save business settings</button>
            ${canBusiness ? '' : '<span class="body-sm" style="color:var(--secondary);">Your role can view settings but not change them.</span>'}
          </div>
        </div>

        <div class="exec-panel" style="padding:24px;">
          <h3 class="title-md" style="margin-bottom:4px;">AI provider settings</h3>
          <p class="body-sm" style="color:var(--secondary); margin-bottom:18px;">Used by the Ask Palm AI copilot. Requires the <span class="font-mono">settings.system</span> permission to change.</p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; max-width:820px;">
            <div>
              <label class="label-md" for="setting-provider">Provider</label>
              <input id="setting-provider" type="text" class="form-control-input" style="width:100%;" data-setting-key="ai_provider" value="${pEsc(v('ai_provider'))}" placeholder="Not configured"${sysDisabled} />
            </div>
            <div>
              <label class="label-md" for="setting-model">Model</label>
              <input id="setting-model" type="text" class="form-control-input" style="width:100%;" data-setting-key="ai_model" value="${pEsc(v('ai_model'))}" placeholder="Not configured"${sysDisabled} />
            </div>
            <div>
              <label class="label-md" for="setting-endpoint">Endpoint (optional)</label>
              <input id="setting-endpoint" type="text" class="form-control-input" style="width:100%;" data-setting-key="ai_endpoint" value="${pEsc(v('ai_endpoint'))}" placeholder="Not configured"${sysDisabled} />
            </div>
            <div>
              <label class="label-md" for="setting-apikey">API key</label>
              <input id="setting-apikey" type="password" class="form-control-input" style="width:100%;" data-setting-key="ai_api_key" value="" placeholder="${keySet ? '•••• set — leave blank to keep' : 'Not configured'}" autocomplete="new-password"${sysDisabled} />
              <div class="body-sm" style="color:var(--secondary); margin-top:6px;">The stored key is never returned by the API. Leave blank to keep the current value.</div>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; max-width:820px; margin-top:18px;">
            <div>
              <div class="label-md">AI key state</div>
              <div class="font-mono">${keySet ? '<span class="status-pill operational">Stored</span>' : '<span class="status-pill neutral">Not configured</span>'}</div>
            </div>
            <div>
              <div class="label-md">Processing version</div>
              <div class="font-mono">${val('processing_version', 'Not configured')}</div>
              <div class="body-sm" style="color:var(--secondary); margin-top:6px;">Recorded on each import for traceability; managed by the import pipeline.</div>
            </div>
          </div>
          <div style="margin-top:18px; display:flex; align-items:center; gap:12px;">
            <button class="btn-primary" onclick="PalmApp.saveSettingsForm('system')"${canSystem ? '' : ' disabled'}>Save system settings</button>
            ${canSystem ? '<span class="body-sm" style="color:var(--secondary);">Changes are audit-logged with before/after values.</span>' : '<span class="body-sm" style="color:var(--secondary);">Only Super Admin can change system settings.</span>'}
          </div>
        </div>
      </div>
    `;
  },

  // 18. KPI DEFINITIONS — REAL DATA FROM /api/kpi-definitions
  'kpi-definitions': async function() {
    let defs = [];
    try { defs = await PalmApp.loadKpiDefinitions(); } catch (e) { defs = []; }

    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">KPI Command Center & Mathematical Formulas</h1>
        <p class="body-md" style="color:var(--secondary);">Formulas governing occupancy ratios, ANPR match accuracy, and gate cycle latency.</p>
      </div>
      <div class="exec-panel">
        <div style="display:flex; flex-direction:column; gap:12px;">
          ${defs.map(d => `
          <div style="padding:16px 20px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid var(--hairline-divider);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <strong class="body-md">${pEsc(d.name)}</strong>
              <span class="font-mono" style="color:var(--primary-container);">${pEsc(d.id)}</span>
            </div>
            <div class="body-sm" style="color:var(--secondary); margin-bottom:8px;">${pEsc(d.definition)}</div>
            <div class="font-mono" style="font-size:12px; color:var(--on-surface); background:var(--surface-container-lowest); padding:10px 12px; border-radius:var(--radius-default); border:1px solid var(--hairline-divider);">${pEsc(d.formula)}</div>
          </div>`).join('')}
          ${defs.length === 0 ? `<div class="body-md" style="color:var(--secondary);">No KPI definitions returned by the backend.</div>` : ''}
        </div>
      </div>
    `;
  },

  // 19. COMPOUNDS (Compound Comparison) — REAL DATA FROM /api/compare
  'compound-comparison': async function() {
    let cmp = { rows: [] };
    try { cmp = await PalmApp.loadCompare(); } catch (e) { cmp = { rows: [] }; }
    const rows = cmp.rows || [];

    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Compound Cross-Comparison Matrix</h1>
        <p class="body-md" style="color:var(--secondary);">Benchmarking operational throughput, resident adoption, and gate efficiency across all developments.</p>
      </div>
      <div class="exec-panel">
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Development</th><th>Total Units</th><th>Occupancy %</th><th>Daily ANPR Volume</th><th>Barrier Latency</th><th>Status</th></tr></thead>
            <tbody>
              ${rows.map(r => `
              <tr>
                <td><strong>${pEsc(r.compound)}</strong></td>
                <td class="font-mono">${pFmt(r.activeUnits)}</td>
                <td class="font-mono">${pFmtPct(r.coverage)}</td>
                <td class="font-mono">${pFmt(r.hcpUnique)}</td>
                <td class="font-mono">${pFmt(r.hcpAuto)}ms</td>
                <td><span class="status-pill operational">Benchmarked</span></td>
              </tr>`).join('')}
              ${rows.length === 0 ? `<tr><td colspan="6" style="text-align:center; color:var(--secondary); padding:32px;">No compound comparison rows available for the selected reporting period.</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // Units
  'units': async function() {
    const compound = PalmApp.state.selectedCompound || 'all';
    const listParams = {
      compound,
      search: PalmApp.state.unitsSearch || undefined,
      preset: (PalmApp.state.unitsPreset && PalmApp.state.unitsPreset !== 'all') ? PalmApp.state.unitsPreset : undefined,
      sort: (PalmApp.state.unitsSort || {}).key,
      dir: (PalmApp.state.unitsSort || {}).dir,
    };
    let units = { rows: [], total: 0 };
    try { units = await PalmApp.loadPagedList('units', '/api/units', listParams); } catch (e) { units = { rows: [], total: 0 }; }
    const rows = units.rows || [];

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">Master Property Units Directory</h1>
          <p class="body-md" style="color:var(--secondary);">Registry of master-planned residential units. Click a column title to sort ascending/descending.</p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <input type="text" class="form-control-input" placeholder="Search units..." value="${pEsc(PalmApp.state.unitsSearch || '')}" onchange="PalmApp.setUnitsSearch(this.value)" style="width: 200px;" />
          <select class="form-control-select" onchange="PalmApp.setUnitsPreset(this.value)" title="Occupancy filter">
            <option value="all" ${PalmApp.state.unitsPreset === 'all' ? 'selected' : ''}>All units</option>
            <option value="with_users" ${PalmApp.state.unitsPreset === 'with_users' ? 'selected' : ''}>With users</option>
            <option value="without_users" ${PalmApp.state.unitsPreset === 'without_users' ? 'selected' : ''}>Without users</option>
          </select>
        </div>
      </div>
      <div class="exec-panel">
        ${PalmApp.pagerHtml('units')}
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr>
              ${PalmApp.sortHeader('units', 'unit_number', 'Unit Number')}
              ${PalmApp.sortHeader('units', 'compound', 'Compound')}
              ${PalmApp.sortHeader('units', 'related_unit', 'Related Unit')}
              ${PalmApp.sortHeader('units', 'users', 'Registered Users')}
              ${PalmApp.sortHeader('units', 'passes', 'Gate Passes')}
            </tr></thead>
            <tbody>
              ${rows.map(u => `
              <tr>
                <td><a href="#/unit-detail?id=${Number(u.id)}" class="font-mono">${pEsc(u.unit_number)}</a></td>
                <td>${pEsc(u.compound)}</td>
                <td>${pEsc(u.related_unit)}</td>
                <td>${pFmt(u.users)}</td>
                <td>${pFmt(u.passes)}</td>
              </tr>`).join('')}
              ${rows.length === 0 ? `<tr><td colspan="5" style="text-align:center; color:var(--secondary); padding:32px;">No unit records match the current filters.</td></tr>` : ''}
            </tbody>
          </table>
</div>
        <div style="padding:12px 20px; border-top:1px solid var(--hairline-divider); display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <span class="body-sm" style="color:var(--secondary);">Total units in scope: ${pFmt(units.total)}</span>
          <button class="btn-ghost" onclick="PalmApp.exportEntity('units', { compound: PalmApp.state.selectedCompound, search: PalmApp.state.unitsSearch || undefined, preset: PalmApp.state.unitsPreset === 'all' ? undefined : PalmApp.state.unitsPreset })">Export Directory</button>
        </div>
      </div>
    `;
  },

  // Residents
  'residents': async function() {
    const filter = PalmApp.state.residentsFilter || '';
    const status = PalmApp.state.residentsStatus || 'all';
    const type = PalmApp.state.residentsType || 'all';
    const gender = PalmApp.state.residentsGender || 'all';
    const maritalStatus = PalmApp.state.residentsMaritalStatus || 'all';
    const filtersOpen = !!PalmApp.state.residentsFiltersOpen;
    const compound = PalmApp.state.selectedCompound || 'all';
    const listParams = {
      compound,
      search: filter || undefined,
      status: status !== 'all' ? status : undefined,
      type: type !== 'all' ? type : undefined,
      gender: gender !== 'all' ? gender : undefined,
      maritalStatus: maritalStatus !== 'all' ? maritalStatus : undefined,
      sort: (PalmApp.state.residentsSort || {}).key,
      dir: (PalmApp.state.residentsSort || {}).dir,
    };
    let users = { rows: [], total: 0 };
    try { users = await PalmApp.loadPagedList('residents', '/api/users', listParams); } catch (e) { users = { rows: [], total: 0 }; }
    const rows = users.rows || [];
    const statusOpts = ['all', 'Active', 'Deactivated', 'Under Review', 'Rejected'];
    const typeOpts = ['all', 'Owner', 'Tenant', 'Family Member', 'Helper', 'Helpers', 'Tenant Family Member', 'REF Owner'];

    return `      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <h1 class="headline-lg">Residents &amp; Occupancy Directory</h1>
          <p class="body-md" style="color:var(--secondary);">Verified property owners, registered tenants, and linked family profiles. Click a column title to sort ascending/descending.</p>
        </div>
        <button class="btn-secondary" onclick="PalmApp.toggleResidentsFilters()"><span class="material-symbols-outlined">filter_list</span> ${filtersOpen ? 'Hide filters' : 'Show filters'}</button>
      </div>
      <div class="exec-panel" style="padding:16px 20px; margin-bottom:20px; ${filtersOpen ? '' : 'display:none;'}">
        <div style="display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr; gap:12px; align-items:end;">
          <div>
            <label class="label-caps" style="color:var(--secondary); display:block; margin-bottom:4px;">Search (name, mobile, email, national ID, passport, unit)</label>
            <input type="text" class="form-control-input" placeholder="Search residents..." value="${pEsc(filter)}" onchange="PalmApp.setResidentsFilter(this.value)" style="width:100%;" />
          </div>
          <div>
            <label class="label-caps" style="color:var(--secondary); display:block; margin-bottom:4px;">Status</label>
            <select class="form-control-select" onchange="PalmApp.setResidentsStatus(this.value)" style="width:100%;" title="Status filter">
              ${statusOpts.map(s => `<option value="${pEsc(s)}" ${status === s ? 'selected' : ''}>${s === 'all' ? 'All statuses' : pEsc(s)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label-caps" style="color:var(--secondary); display:block; margin-bottom:4px;">Registered as</label>
            <select class="form-control-select" onchange="PalmApp.setResidentsType(this.value)" style="width:100%;" title="Resident type filter">
              ${typeOpts.map(t => `<option value="${pEsc(t)}" ${type === t ? 'selected' : ''}>${t === 'all' ? 'All types' : pEsc(t)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label-caps" style="color:var(--secondary); display:block; margin-bottom:4px;">Gender</label>
            <select class="form-control-select" onchange="PalmApp.setResidentsGender(this.value)" style="width:100%;" title="Gender filter">
              <option value="all" ${gender === 'all' ? 'selected' : ''}>All genders</option>
              <option value="Male" ${gender === 'Male' ? 'selected' : ''}>Male</option>
              <option value="Female" ${gender === 'Female' ? 'selected' : ''}>Female</option>
            </select>
          </div>
          <div>
            <label class="label-caps" style="color:var(--secondary); display:block; margin-bottom:4px;">Marital status</label>
            <select class="form-control-select" onchange="PalmApp.setResidentsMaritalStatus(this.value)" style="width:100%;" title="Marital status filter">
              <option value="all" ${maritalStatus === 'all' ? 'selected' : ''}>All</option>
              <option value="Married" ${maritalStatus === 'Married' ? 'selected' : ''}>Married</option>
              <option value="Single" ${maritalStatus === 'Single' ? 'selected' : ''}>Single</option>
            </select>
          </div>
        </div>
      </div>
      <div class="exec-panel">
        ${PalmApp.pagerHtml('residents')}
        <div class="exec-table-wrap">
          <table class="exec-table" style="min-width:1500px;">
            <thead><tr>
              ${PalmApp.sortHeader('residents', 'name', 'Name')}
              <th>Mobile</th>
              <th>National ID</th>
              <th>Passport</th>
              ${PalmApp.sortHeader('residents', 'gender', 'Gender')}
              ${PalmApp.sortHeader('residents', 'marital_status', 'Marital status')}
              ${PalmApp.sortHeader('residents', 'registered_as', 'Registered as')}
              ${PalmApp.sortHeader('residents', 'status', 'Status')}
              ${PalmApp.sortHeader('residents', 'created_on', 'Created on')}
              <th>Approved on</th>
              <th>Compounds &amp; Units</th>
              <th>Action</th>
            </tr></thead>
            <tbody>
              ${rows.map(u => `
              <tr>
                <td><a href="#/resident-detail?id=${Number(u.id)}"><strong>${pEsc(u.name)}</strong></a></td>
                <td class="font-mono">${pEsc(u.mobile || '—')}</td>
                <td class="font-mono">${pEsc(u.national_id || '—')}</td>
                <td class="font-mono">${pEsc(u.passport || '—')}</td>
                <td>${pEsc(u.gender || '—')}</td>
                <td>${pEsc(u.marital_status || '—')}</td>
                <td><span class="status-pill neutral">${pEsc(u.registered_as || 'Resident')}</span></td>
                <td>${pEsc(u.status)}</td>
                <td class="font-mono">${pEsc(u.created_on || '—')}</td>
                <td class="font-mono">${pEsc(u.first_seen || '—')}</td>
                <td>${pEsc(u.compounds || '—')} • ${pFmt(u.units)} unit${Number(u.units) === 1 ? '' : 's'}</td>
                <td><a href="#/resident-detail?id=${Number(u.id)}" class="btn-ghost">Profile</a></td>
              </tr>`).join('')}
              ${rows.length === 0 ? `<tr><td colspan="12" style="text-align:center; color:var(--secondary); padding:32px;">No resident records match the current filters.</td></tr>` : ''}
            </tbody>
          </table>
</div>
        <div style="padding:12px 20px; border-top:1px solid var(--hairline-divider); display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <span class="body-sm" style="color:var(--secondary);">Resident records in scope: ${pFmt(users.total)}</span>
          <button class="btn-ghost" onclick="PalmApp.exportEntity('users', { compound: PalmApp.state.selectedCompound, search: PalmApp.state.residentsFilter || undefined, status: PalmApp.state.residentsStatus === 'all' ? undefined : PalmApp.state.residentsStatus, type: PalmApp.state.residentsType === 'all' ? undefined : PalmApp.state.residentsType, gender: PalmApp.state.residentsGender === 'all' ? undefined : PalmApp.state.residentsGender, maritalStatus: PalmApp.state.residentsMaritalStatus === 'all' ? undefined : PalmApp.state.residentsMaritalStatus })">Export Registry</button>
        </div>
      </div>
    `;
  },

  // Vehicles
  'vehicles': async function() {
    const filter = PalmApp.state.vehiclesFilter || '';
    let vehicles = { rows: [], total: 0 };
    let stats = { total: 0, approved: 0, underReview: 0, deactivated: 0, rejected: 0, withActivity: 0 };
    try { vehicles = await PalmApp.loadPagedList('vehicles', '/api/vehicles', { compound: PalmApp.state.selectedCompound || 'all', search: filter || undefined }); } catch (e) { vehicles = { rows: [], total: 0 }; }
    try { stats = await PalmApp.loadVehiclesStats(); } catch (e) { stats = { total: 0, approved: 0, underReview: 0, deactivated: 0, rejected: 0, withActivity: 0 }; }
    const rows = vehicles.rows || [];

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">Vehicles & ANPR UHF Tags</h1>
          <p class="body-md" style="color:var(--secondary);">CRM-registered vehicles linked to residents and their compounds, with HCP gate access matched by license plate and person.</p>
        </div>
        <div style="display:flex; gap:10px;">
          <input type="text" class="form-control-input" placeholder="Search plates, owners..." value="${pEsc(filter)}" onchange="PalmApp.setVehiclesFilter(this.value)" style="width: 250px;" />
          <button class="btn-primary" onclick="PalmApp.navigate('vehicles')">Search</button>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:16px; margin-bottom:20px;">
        <div class="kpi-stat-card"><div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Total Vehicles</span></div><div class="kpi-value">${pFmt(stats.total)}</div></div>
        <div class="kpi-stat-card"><div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Approved</span></div><div class="kpi-value">${pFmt(stats.approved)}</div></div>
        <div class="kpi-stat-card"><div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Under Review</span></div><div class="kpi-value">${pFmt(stats.underReview)}</div></div>
        <div class="kpi-stat-card"><div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> With ANPR Activity</span></div><div class="kpi-value">${pFmt(stats.withActivity)}</div></div>
      </div>
      <div class="exec-panel">
        ${PalmApp.pagerHtml('vehicles')}
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Plate</th><th>Make / Model</th><th>Year</th><th>Status</th><th>Resident</th><th>Compounds / Units</th><th>HCP Access</th></tr></thead>
            <tbody>
              ${rows.map(v => {
                const resident = v.owner || v.owner_raw || '';
                const hcpLine = [
                  `${pFmt(v.hcp_events)} events${v.hcp_last_event ? ` • last ${pEsc(v.hcp_last_event).replace('T', ' ')}` : ''}`,
                  v.hcp_compounds ? `compounds: ${pEsc(v.hcp_compounds)}` : '',
                  v.hcp_owner_name ? `person: ${pEsc(v.hcp_owner_name)}` : '',
                ].filter(Boolean).join('<br/>');
                return `
              <tr>
                <td><a href="#/vehicle-detail?id=${Number(v.id)}" class="font-mono">${pEsc(v.plate_original)}</a></td>
                <td>${pEsc(v.make)} ${pEsc(v.model)}</td>
                <td>${pFmt(v.year)}</td>
                <td><span class="status-pill ${String(v.status).toLowerCase().includes('approv') ? 'operational' : 'neutral'}">${pEsc(v.status)}</span></td>
                <td>${v.owner_id && PalmApp.can('resident.detail') ? `<a href="#/resident-detail?id=${Number(v.owner_id)}">${pEsc(resident)}</a>` : pEsc(resident || '—')}</td>
                <td>${pEsc(v.compounds || '—')}${v.units ? `<br/><span class="body-sm" style="color:var(--secondary);">${pEsc(v.units)}</span>` : ''}</td>
                <td class="body-sm">${hcpLine || '—'}</td>
              </tr>`;
              }).join('')}
              ${rows.length === 0 ? `<tr><td colspan="7" style="text-align:center; color:var(--secondary); padding:32px;">No vehicle records returned by the backend.</td></tr>` : ''}
            </tbody>
          </table>
</div>
        <div style="padding:12px 20px; border-top:1px solid var(--hairline-divider); display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <span class="body-sm" style="color:var(--secondary);">Vehicles in scope: ${pFmt(vehicles.total)}</span>
          <button class="btn-ghost" onclick="PalmApp.exportEntity('vehicles', { compound: PalmApp.state.selectedCompound, search: PalmApp.state.vehiclesFilter || undefined })">Export Registry</button>
        </div>
      </div>
    `;
  },

  // ---- Entity detail pages: Unit <-> User <-> Vehicle <-> HCP person access ----
  'unit-detail': async function() {
    const id = PalmApp.state.detailId;
    if (!id) return `<div class="exec-panel" style="padding:28px;"><h2 class="headline-sm">No unit selected</h2><p class="body-sm" style="color:var(--secondary);">Open a unit from the Units directory.</p><button class="btn-primary" style="margin-top:12px;" onclick="PalmApp.navigate('units')">Back to Units</button></div>`;
    const d = await PalmApp.loadUnitDetail(id);
    const u = (d && d.unit) || {};
    const users = (d && d.users) || [];
    const vehicles = (d && d.vehicles) || [];
    const hcp = (d && d.hcpEvents) || [];
    const passes = (d && d.passes) || [];
    const inv = (d && d.invitations) || [];
    const canResident = PalmApp.can('resident.detail');
    return `
      <button class="btn-ghost" onclick="PalmApp.navigate('units')">← Units</button>
      <div style="margin:12px 0 20px;">
        <h1 class="headline-lg">Unit ${pEsc(u.unit_number || '—')}</h1>
        <p class="body-md" style="color:var(--secondary);">${pEsc(u.compound || '—')} • Related: ${pEsc(u.related_unit || '—')} • Gate: ${pEsc(u.gate_suspension || '—')} • Rent: ${pEsc(u.rent_suspension || '—')} • Maintenance: ${pEsc(u.maint_fees || '—')}</p>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
        <div class="exec-panel">
          <div class="exec-panel-header"><h3 class="title-md">Residents (${users.length})</h3></div>
          <div style="padding:12px 20px;">
            ${users.map(x => `<div style="padding:8px 0; border-bottom:1px solid var(--hairline-divider);">
              ${canResident && x.name ? `<a href="#/resident-detail?id=${Number(x.id)}">${pEsc(x.name)}</a>` : `<strong>${pEsc(x.name || '—')}</strong>`}
              <div class="body-sm" style="color:var(--secondary);">${pEsc(x.registered_as || '')} • ${pEsc(x.access_type || '')} • ${pEsc(x.rel_status || x.status || '')}</div>
            </div>`).join('') || '<div class="body-sm" style="color:var(--secondary);">No linked residents.</div>'}
          </div>
        </div>
        <div class="exec-panel">
          <div class="exec-panel-header"><h3 class="title-md">Vehicles (${vehicles.length})</h3></div>
          <div style="padding:12px 20px;">
            ${vehicles.map(v => `<div style="padding:8px 0; border-bottom:1px solid var(--hairline-divider);">
              <a href="#/vehicle-detail?id=${Number(v.id)}" class="font-mono">${pEsc(v.plate_original || '—')}</a>
              <div class="body-sm" style="color:var(--secondary);">${pEsc(v.make || '')} ${pEsc(v.model || '')} • ${pEsc(v.status || '')}</div>
            </div>`).join('') || '<div class="body-sm" style="color:var(--secondary);">No linked vehicles.</div>'}
          </div>
        </div>
      </div>
      <div class="exec-panel" style="margin-top:20px;">
        <div class="exec-panel-header"><h3 class="title-md">HCP Access (${hcp.length} recent)</h3></div>
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Plate</th><th>Time</th><th>Gate</th><th>Direction</th><th>Result</th><th>Owner (HCP)</th></tr></thead>
            <tbody>
              ${hcp.map(e => `<tr>
                <td class="font-mono">${pEsc(e.plate_original)}</td>
                <td class="font-mono">${pEsc(e.enter_time || e.exit_time || '')}</td>
                <td>${pEsc(e.gate || '')} (${pEsc(e.compound || '')})</td>
                <td>${pEsc(e.direction || '')}</td>
                <td>${pEsc(e.result || '')}</td>
                <td>${e.owner_user_id && canResident ? `<a href="#/resident-detail?id=${Number(e.owner_user_id)}">${pEsc(e.owner_raw || 'matched owner')}</a>` : pEsc(e.owner_raw || '—')}</td>
              </tr>`).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--secondary); padding:24px;">No HCP events for this unit.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="exec-panel" style="margin-top:20px; padding:16px 20px;">
        <h3 class="title-md" style="margin-bottom:8px;">Gate passes &amp; invitations</h3>
        <div class="body-sm" style="color:var(--secondary);">
          Gate passes: ${passes.map(p => `${pEsc(p.access_type)} × ${pFmt(p.n)}`).join(', ') || 'none'} •
          Invitations: ${inv.map(i => `${pEsc(i.status)} × ${pFmt(i.n)}`).join(', ') || 'none'}
        </div>
      </div>
    `;
  },

  'resident-detail': async function() {
    const id = PalmApp.state.detailId;
    if (!id) return `<div class="exec-panel" style="padding:28px;"><h2 class="headline-sm">No resident selected</h2><p class="body-sm" style="color:var(--secondary);">Open a resident from the Residents directory.</p><button class="btn-primary" style="margin-top:12px;" onclick="PalmApp.navigate('residents')">Back to Residents</button></div>`;
    const d = await PalmApp.loadResidentDetail(id);
    const u = (d && d.user) || {};
    const units = (d && d.units) || [];
    const vehicles = (d && d.vehicles) || [];
    const events = (d && d.hcpEventsList) || [];
    const vehicleByPlate = {};
    vehicles.forEach(v => { if (v.plate_original) vehicleByPlate[String(v.plate_original).toLowerCase()] = v.id; });
    return `
      <button class="btn-ghost" onclick="PalmApp.navigate('residents')">← Residents</button>
      <div style="margin:12px 0 20px;">
        <h1 class="headline-lg">${pEsc(u.name || '—')}</h1>
        <p class="body-md" style="color:var(--secondary);">${pEsc(u.registered_as || 'Resident')} • ${pEsc(u.status || '—')} • ${pEsc(u.mobile || '')} • ${pEsc(u.email || '')} • ${pEsc(u.national_id || '')}</p>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
        <div class="exec-panel">
          <div class="exec-panel-header"><h3 class="title-md">Unit access (${units.length})</h3></div>
          <div style="padding:12px 20px;">
            ${units.map(x => `<div style="padding:8px 0; border-bottom:1px solid var(--hairline-divider);">
              ${x.unit_id ? `<a href="#/unit-detail?id=${Number(x.unit_id)}" class="font-mono">${pEsc(x.unit_number || '—')}</a>` : `<strong class="font-mono">${pEsc(x.unit_number || '—')}</strong>`}
              <div class="body-sm" style="color:var(--secondary);">${pEsc(x.compound || '')} • ${pEsc(x.access_type || '')} • ${pEsc(x.status || '')}</div>
            </div>`).join('') || '<div class="body-sm" style="color:var(--secondary);">No linked units.</div>'}
          </div>
        </div>
        <div class="exec-panel">
          <div class="exec-panel-header"><h3 class="title-md">Vehicles (${vehicles.length})</h3></div>
          <div style="padding:12px 20px;">
            ${vehicles.map(v => `<div style="padding:8px 0; border-bottom:1px solid var(--hairline-divider);">
              <a href="#/vehicle-detail?id=${Number(v.id)}" class="font-mono">${pEsc(v.plate_original || '—')}</a>
              <div class="body-sm" style="color:var(--secondary);">${pEsc(v.make || '')} ${pEsc(v.model || '')} • ${pEsc(v.status || '')}</div>
            </div>`).join('') || '<div class="body-sm" style="color:var(--secondary);">No linked vehicles.</div>'}
          </div>
        </div>
      </div>
      <div class="exec-panel" style="margin-top:20px;">
        <div class="exec-panel-header"><h3 class="title-md">HCP Person Access (${pFmt(d.hcpEvents)} total, ${events.length} shown)</h3></div>
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Plate</th><th>Time</th><th>Gate</th><th>Direction</th><th>Result</th></tr></thead>
            <tbody>
              ${events.map(e => {
                const vid = vehicleByPlate[String(e.plate_original || '').toLowerCase()];
                return `<tr>
                  <td class="font-mono">${vid ? `<a href="#/vehicle-detail?id=${Number(vid)}">${pEsc(e.plate_original)}</a>` : pEsc(e.plate_original)}</td>
                  <td class="font-mono">${pEsc(e.enter_time || e.exit_time || '')}</td>
                  <td>${pEsc(e.gate || '')} (${pEsc(e.compound || '')})</td>
                  <td>${pEsc(e.direction || '')}</td>
                  <td>${pEsc(e.result || '')}</td>
                </tr>`;
              }).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--secondary); padding:24px;">No HCP events matched to this person or their vehicles.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  'vehicle-detail': async function() {
    const id = PalmApp.state.detailId;
    if (!id) return `<div class="exec-panel" style="padding:28px;"><h2 class="headline-sm">No vehicle selected</h2><p class="body-sm" style="color:var(--secondary);">Open a vehicle from the Vehicles directory.</p><button class="btn-primary" style="margin-top:12px;" onclick="PalmApp.navigate('vehicles')">Back to Vehicles</button></div>`;
    const d = await PalmApp.loadVehicleDetail(id);
    const v = (d && d.vehicle) || {};
    const events = (d && d.events) || [];
    const ownerUnits = (d && d.ownerUnits) || [];
    const canResident = PalmApp.can('resident.detail');
    return `
      <button class="btn-ghost" onclick="PalmApp.navigate('vehicles')">← Vehicles</button>
      <div style="margin:12px 0 20px;">
        <h1 class="headline-lg font-mono">${pEsc(v.plate_original || '—')}</h1>
        <p class="body-md" style="color:var(--secondary);">${pEsc(v.make || '')} ${pEsc(v.model || '')} • ${pEsc(v.year || '')} • ${pEsc(v.status || '')} • Owner: ${v.user_id && canResident ? `<a href="#/resident-detail?id=${Number(v.user_id)}">${pEsc(v.owner || '—')}</a>` : pEsc(v.owner || '—')}</p>
      </div>
      <div class="exec-panel" style="margin-bottom:20px;">
        <div class="exec-panel-header"><h3 class="title-md">Owner's unit access (${ownerUnits.length})</h3></div>
        <div style="padding:12px 20px;">
          ${ownerUnits.map(x => `<div style="padding:8px 0; border-bottom:1px solid var(--hairline-divider);">
            ${x.unit_id ? `<a href="#/unit-detail?id=${Number(x.unit_id)}" class="font-mono">${pEsc(x.unit_number || '—')}</a>` : `<strong class="font-mono">${pEsc(x.unit_number || '—')}</strong>`}
            <div class="body-sm" style="color:var(--secondary);">${pEsc(x.compound || '')} • ${pEsc(x.access_type || '')} • ${pEsc(x.status || '')}</div>
          </div>`).join('') || '<div class="body-sm" style="color:var(--secondary);">No unit access rows for the owner.</div>'}
        </div>
      </div>
      <div class="exec-panel">
        <div class="exec-panel-header"><h3 class="title-md">HCP Vehicle Access (${events.length} recent)</h3></div>
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Time</th><th>Gate</th><th>Direction</th><th>Method</th><th>Result</th><th>Reason</th></tr></thead>
            <tbody>
              ${events.map(e => `<tr>
                <td class="font-mono">${pEsc(e.enter_time || e.exit_time || '')}</td>
                <td>${pEsc(e.gate || '')} (${pEsc(e.compound || '')})</td>
                <td>${pEsc(e.direction || '')}</td>
                <td>${pEsc(e.method || '')}</td>
                <td>${pEsc(e.result || '')}</td>
                <td>${pEsc(e.reason || '')}</td>
              </tr>`).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--secondary); padding:24px;">No HCP events for this plate.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
};
