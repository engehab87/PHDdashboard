// ==========================================================================
// Palm Hills Executive Real Estate Intelligence — All Page Renderers
// File: app-pages.js
// ==========================================================================

window.PalmPages = {

  // 1. LOGIN PAGE (Split Visual + Form Layout)
  'login': function() {
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

          <div style="z-index:2; max-width:540px;">
            <div class="label-caps" style="color:#C4161C; margin-bottom:12px;">PALM HILLS ENTERPRISE CORE</div>
            <h1 class="display-lg" style="color:#FFF; margin-bottom:20px; line-height:1.2;">Architectural Precision. Unified Operations.</h1>
            <p style="color:#9A968F; font-size:15px; line-height:1.6;">Continuous telemetric governance across 8 master-planned developments. Real-time integration with Hikvision HikCentral (HCP) access portals and Master Property CRM registry.</p>
            
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; margin-top:40px; border-top:1px solid #343230; padding-top:24px;">
              <div>
                <div class="font-mono" style="font-size:24px; font-weight:700; color:#FFF;">31,015</div>
                <div class="label-caps" style="color:#73706B; font-size:10px;">Master Units</div>
              </div>
              <div>
                <div class="font-mono" style="font-size:24px; font-weight:700; color:#FFF;">147.5k</div>
                <div class="label-caps" style="color:#73706B; font-size:10px;">Monthly ANPR Logs</div>
              </div>
              <div>
                <div class="font-mono" style="font-size:24px; font-weight:700; color:#FFF;">18ms</div>
                <div class="label-caps" style="color:#73706B; font-size:10px;">HCP Cluster Latency</div>
              </div>
            </div>
          </div>

          <div class="body-sm" style="color:#5C5A57; z-index:2;">
            Palm Hills Developments Group © 2026 • Confidential Executive Access Tier
          </div>
        </div>

        <!-- SSO & Login Form (Right) -->
        <div style="flex:0.9; display:flex; align-items:center; justify-content:center; padding:48px; background:var(--surface-container-lowest);">
          <div style="width:100%; max-width:420px;">
            <h2 class="headline-md" style="margin-bottom:8px;">Sign In to Executive Core</h2>
            <p class="body-md" style="color:var(--secondary); margin-bottom:28px;">Authorize using your institutional clearance credentials.</p>

            <!-- Microsoft SSO Button -->
            <button class="btn-secondary" style="width:100%; justify-content:center; height:44px; margin-bottom:24px; font-weight:600;" onclick="PalmApp.navigate('overview')">
              <svg width="20" height="20" viewBox="0 0 21 21"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9H11z"/><path fill="#ffb900" d="M11 11h9v9H11z"/></svg>
              Sign In with Microsoft Entra ID
            </button>

            <div style="display:flex; align-items:center; gap:14px; margin-bottom:24px;">
              <span style="flex:1; height:1px; background:var(--hairline-divider);"></span>
              <span class="label-caps" style="color:var(--secondary); font-size:10px;">OR SERVICE CREDENTIALS</span>
              <span style="flex:1; height:1px; background:var(--hairline-divider);"></span>
            </div>

            <div style="margin-bottom:16px;">
              <label class="label-md" style="display:block; margin-bottom:6px;">Executive Email</label>
              <input type="email" class="form-control-input" style="width:100%;" value="mohamed.adel@palmhills.com" />
            </div>

            <div style="margin-bottom:24px;">
              <label class="label-md" style="display:block; margin-bottom:6px;">Security Token / Password</label>
              <input type="password" class="form-control-input" style="width:100%;" value="••••••••••••••••" />
            </div>

            <button class="btn-primary" style="width:100%; justify-content:center; height:44px;" onclick="PalmApp.navigate('overview')">
              Enter Operations Console
            </button>

            <div style="margin-top:24px; padding:12px; background:var(--surface-container-low); border-radius:var(--radius-default); border:1px solid var(--hairline-divider); display:flex; gap:10px; align-items:center;">
              <span class="material-symbols-outlined" style="color:var(--primary-container); font-size:18px;">lock</span>
              <div class="body-sm" style="font-size:11.5px; color:var(--secondary);">Mutual TLS 1.3 enforced. All activities cryptographically audited.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // 2. EXECUTIVE OVERVIEW (Dashboard)
  'overview': function() {
    return `
      <!-- Scope Bar -->
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:24px;">
        <div>
          <h1 class="headline-lg">Executive Overview</h1>
          <p class="body-md" style="color:var(--secondary);">Unified portfolio health, access throughput, and cross-compound integrity metrics.</p>
        </div>
        <div style="display:flex; gap:12px;">
          <select class="form-control-select">
            <option>All Developments (8 Master Compounds)</option>
            <option>Badya (6th of October)</option>
            <option>Palm Hills October Main</option>
            <option>The Crown & Golf Views</option>
            <option>Hacienda Bay & White</option>
          </select>
          <select class="form-control-select">
            <option>September 2026 (Live Audit)</option>
            <option>August 2026</option>
            <option>Q3 2026 YTD</option>
          </select>
          <button class="btn-primary" onclick="PalmApp.navigate('reports')"><span class="material-symbols-outlined">analytics</span> Executive Dossier</button>
        </div>
      </div>

      <!-- Warning Banners (Ceiling Alert) -->
      <div style="background:#FFF8E1; border:1px solid #FFE082; border-left:4px solid #B78103; padding:12px 18px; border-radius:var(--radius-default); margin-bottom:24px; display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:12px;">
          <span class="material-symbols-outlined" style="color:#B78103;">warning</span>
          <div>
            <div style="font-size:13px; font-weight:600; color:#5D4037;">High-Volume Dataset Warning: Active Gate Passes Ceiling (100,000 Records Approached)</div>
            <div style="font-size:12px; color:#795548;">Active telemetry buffer is at 99.8% capacity. Cold-storage pipeline auto-purge is active on Amazon S3 Cairo Cluster.</div>
          </div>
        </div>
        <button class="btn-secondary" style="height:32px; font-size:12px;" onclick="PalmApp.navigate('settings')">Configure Storage</button>
      </div>

      <!-- 8-Card KPI Metric Grid -->
      <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:16px; margin-bottom:24px;">
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Active Units</span><span class="status-pill operational">Active</span></div>
          <div class="kpi-value">31,015</div>
          <div class="kpi-trend positive"><span class="material-symbols-outlined" style="font-size:16px;">trending_up</span> +4.2% YoY across 8 Zones</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Units with Users</span><span class="status-pill operational">Enrolled</span></div>
          <div class="kpi-value">8,117</div>
          <div class="kpi-trend positive"><span class="material-symbols-outlined" style="font-size:16px;">trending_up</span> 26.17% Portfolio Coverage</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Verified Residents</span><span class="status-pill operational">KYC Done</span></div>
          <div class="kpi-value">15,048</div>
          <div class="kpi-trend positive"><span class="material-symbols-outlined" style="font-size:16px;">trending_up</span> +8.2% vs last month</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Registered Vehicles</span><span class="status-pill neutral">ANPR</span></div>
          <div class="kpi-value">2,059</div>
          <div class="kpi-trend positive"><span class="material-symbols-outlined" style="font-size:16px;">tag</span> UHF Tags Paired</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Unique Vehicles</span><span class="status-pill warning">High Flow</span></div>
          <div class="kpi-value">21,972</div>
          <div class="kpi-trend"><span class="material-symbols-outlined" style="font-size:16px;">schedule</span> Active in last 30d</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Vehicle Events (HCP)</span><span class="status-pill critical">Ceiling</span></div>
          <div class="kpi-value">147,500</div>
          <div class="kpi-trend negative"><span class="material-symbols-outlined" style="font-size:16px;">error</span> 100k batch export capped</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Automated Openings</span><span class="status-pill operational">RFID / ANPR</span></div>
          <div class="kpi-value">2,123</div>
          <div class="kpi-trend positive"><span class="material-symbols-outlined" style="font-size:16px;">bolt</span> Fast-lane zero-barrier</div>
        </div>
        <div class="kpi-stat-card">
          <div class="kpi-header"><span class="kpi-title"><span style="color:#C4161C;">◆</span> Issued Gate Passes</span><span class="status-pill critical">Ceiling</span></div>
          <div class="kpi-value">100,000</div>
          <div class="kpi-trend negative"><span class="material-symbols-outlined" style="font-size:16px;">crisis_alert</span> At 100k Monthly Dump</div>
        </div>
      </div>

      <!-- Two-Column Operational Panels (HCP Topology + CRM Pipeline) -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:24px;">
        <!-- HCP Gate Topology -->
        <div class="exec-panel">
          <div class="exec-panel-header">
            <div>
              <h3 class="title-md">Hikvision HCP Gate Topology (8 Developments)</h3>
              <div class="body-sm" style="color:var(--secondary);">Real-time pulse and optical ANPR barrier latency</div>
            </div>
            <button class="btn-ghost" onclick="PalmApp.navigate('hcp-live')"><span class="material-symbols-outlined">open_in_new</span></button>
          </div>
          <div style="padding:16px 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--hairline-divider);">
              <div><strong>Badya Smart Portals</strong> (4 Gates • 12 Lanes)</div>
              <span class="status-pill operational">All 12 Online • 14ms</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--hairline-divider);">
              <div><strong>Palm Hills October Main</strong> (6 Gates • 18 Lanes)</div>
              <span class="status-pill operational">Operational • 18ms</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--hairline-divider);">
              <div><strong>The Crown & Golf Views</strong> (3 Gates • 8 Lanes)</div>
              <span class="status-pill warning">Gate 2 Boom Calibrating</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0;">
              <div><strong>East Cairo (Katameya & New Cairo)</strong> (2 Gates)</div>
              <span class="status-pill operational">Healthy • 22ms</span>
            </div>
          </div>
        </div>

        <!-- CRM & Anomaly Intelligence -->
        <div class="exec-panel">
          <div class="exec-panel-header">
            <div>
              <h3 class="title-md">Property CRM & Identity Reconciliation</h3>
              <div class="body-sm" style="color:var(--secondary);">Discrepancies between ANPR detections and Property CRM lease registries</div>
            </div>
            <button class="btn-ghost" onclick="PalmApp.navigate('identity-matching')"><span class="material-symbols-outlined">tune</span></button>
          </div>
          <div style="padding:16px 20px;">
            <div style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--hairline-divider);">
              <span class="status-pill critical">Mismatch</span>
              <div style="flex:1;">
                <div style="font-weight:600; font-size:13px;">Plate QHD 721 (The Crown Gate 1)</div>
                <div class="body-sm" style="color:var(--secondary);">Decommissioned contractor tag used. Guard override recorded.</div>
              </div>
              <button class="btn-secondary" style="height:30px; font-size:11px;" onclick="PalmApp.openDrawer('Security Anomaly', 'Plate QHD 721 was intercepted at The Crown Gate 1. Driver was contractor for Orascom Fitouts whose permit expired 24h ago.')">Investigate</button>
            </div>
            <div style="display:flex; align-items:center; gap:12px; padding:10px 0;">
              <span class="status-pill warning">Duplicate</span>
              <div style="flex:1;">
                <div style="font-weight:600; font-size:13px;">National ID 28409180102938 (Badya V-112)</div>
                <div class="body-sm" style="color:var(--secondary);">Linked to both Primary Owner and Tenant Lease contracts simultaneously.</div>
              </div>
              <button class="btn-secondary" style="height:30px; font-size:11px;" onclick="PalmApp.navigate('residents')">Resolve</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // 3. VEHICLE ACCESS (HCP)
  'vehicle-access': function() {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">Vehicle Access (HCP)</h1>
          <p class="body-md" style="color:var(--secondary);">147,500 real-time barrier entry and exit pulses captured by HikCentral optical ANPR nodes.</p>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn-secondary" onclick="PalmApp.showToast('Exporting current view to .xlsx...')"><span class="material-symbols-outlined">download</span> Export (.xlsx)</button>
          <button class="btn-primary" onclick="PalmApp.showToast('Triggering live wire stream...')"><span class="material-symbols-outlined">sensors</span> Stream Live Wire</button>
        </div>
      </div>

      <!-- Multi-Parameter Filters -->
      <div class="exec-panel" style="padding:16px 20px; margin-bottom:20px;">
        <div style="display:grid; grid-template-columns:1.5fr 1fr 1fr 1fr 1fr auto; gap:12px; align-items:center;">
          <input type="text" class="form-control-input" placeholder="Filter plate, QR token, or owner..." />
          <select class="form-control-select"><option>All Compounds</option><option>Badya</option><option>The Crown</option><option>Hacienda Bay</option></select>
          <select class="form-control-select"><option>Entry + Exit</option><option>Entry Only</option><option>Exit Only</option></select>
          <select class="form-control-select"><option>All Results</option><option>Passed</option><option>Not Passed</option></select>
          <select class="form-control-select"><option>All Gates</option><option>Gate 1 Main</option><option>Gate 2 VIP</option><option>Gate 3 Logistics</option></select>
          <button class="btn-primary" style="height:40px;">Apply</button>
        </div>
      </div>

      <!-- Access Table -->
      <div class="exec-panel">
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead>
              <tr>
                <th>License Plate</th>
                <th>Compound</th>
                <th>Direction</th>
                <th>Timestamp Enter</th>
                <th>Timestamp Exit</th>
                <th>Gate Node</th>
                <th>Result</th>
                <th>Audit Reason / Provenance</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong class="font-mono">ف ج ر ٨٣٥</strong> <span style="color:var(--secondary); font-size:11px;">(FJR-835)</span></td>
                <td>Badya</td>
                <td><span class="status-pill neutral">ENTRY</span></td>
                <td class="font-mono">2026-09-30 23:50:12</td>
                <td>—</td>
                <td>Gate 2 East</td>
                <td><span class="status-pill operational">Passed</span></td>
                <td>Valid ANPR Resident Auto-Open</td>
                <td><button class="btn-ghost" onclick="PalmApp.openDrawer('Vehicle Trace: FJR-835', 'Resident: Dr. Karim Mansour (Badya Villa 112). UHF Tag active.')">Trace</button></td>
              </tr>
              <tr>
                <td><strong class="font-mono">ص ب ٦٦١٣</strong> <span style="color:var(--secondary); font-size:11px;">(SB-6613)</span></td>
                <td>Badya</td>
                <td><span class="status-pill neutral">EXIT</span></td>
                <td>—</td>
                <td class="font-mono">2026-09-30 23:47:04</td>
                <td>Gate 2 East</td>
                <td><span class="status-pill critical">Not Passed</span></td>
                <td>Vehicle Not In Allowed List: Barrier Held</td>
                <td><button class="btn-ghost" onclick="PalmApp.showToast('Security alert dispatched')">Flag</button></td>
              </tr>
              <tr>
                <td><strong class="font-mono">أ هـ د ٤١٩</strong> <span style="color:var(--secondary); font-size:11px;">(AHD-419)</span></td>
                <td>Hacienda Bay</td>
                <td><span class="status-pill neutral">ENTRY</span></td>
                <td class="font-mono">2026-09-30 23:43:18</td>
                <td>—</td>
                <td>Main Portal</td>
                <td><span class="status-pill operational">Passed</span></td>
                <td>Resident RFID UHF Match</td>
                <td><button class="btn-ghost">Trace</button></td>
              </tr>
              <tr>
                <td><strong class="font-mono">QHD 721</strong></td>
                <td>The Crown</td>
                <td><span class="status-pill neutral">ENTRY</span></td>
                <td class="font-mono">2026-09-30 23:40:02</td>
                <td>—</td>
                <td>Gate 1 VIP</td>
                <td><span class="status-pill critical">Not Passed</span></td>
                <td>Decommissioned Contractor Tag: Guard Override</td>
                <td><button class="btn-primary" style="height:28px; font-size:11px;" onclick="PalmApp.showToast('Incident dossier logged to Security')">Intercept</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 4. GATE PASSES
  'gate-passes': function() {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">Gate Passes & Telemetry</h1>
          <p class="body-md" style="color:var(--secondary);">Real-time issuance, QR authorizations, delivery fleets, and contractor permits across all compounds.</p>
        </div>
        <button class="btn-primary" onclick="PalmApp.openDrawer('Issue Emergency Gate Pass', '<p>Enter host unit and visitor credentials to bypass offline barriers.</p>')"><span class="material-symbols-outlined">add_card</span> Issue Emergency Pass</button>
      </div>

      <div class="exec-panel">
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead>
              <tr><th>Pass Token / QR</th><th>Visitor / Holder</th><th>Unit & Compound</th><th>Pass Type</th><th>Entry Window</th><th>Valid Until</th><th>Clearance State</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="font-mono"><strong>GP-98124</strong></td>
                <td>Sherif El-Ganzoury (+20 100 482 9911)</td>
                <td>Badya • District 4, V-112</td>
                <td><span class="status-pill operational">VIP Delegate</span></td>
                <td>2026-10-02 08:00</td>
                <td>2026-10-02 23:59</td>
                <td><span class="status-pill operational">Entered Gate 1</span></td>
              </tr>
              <tr>
                <td class="font-mono"><strong>GP-98120</strong></td>
                <td>Mahmoud El-Sayed (Orascom Fitouts)</td>
                <td>The Crown • Villa 7</td>
                <td><span class="status-pill neutral">Contractor</span></td>
                <td>2026-10-02 07:00</td>
                <td>2026-10-02 17:00</td>
                <td><span class="status-pill operational">Entered Gate 3</span></td>
              </tr>
              <tr>
                <td class="font-mono"><strong>GP-98002</strong></td>
                <td>Unknown Courier (Motorcycle)</td>
                <td>Palm Hills Oct • Bamboo V-44</td>
                <td><span class="status-pill critical">Physical Hold</span></td>
                <td>2026-10-02 11:04</td>
                <td>2026-10-02 11:34</td>
                <td><span class="status-pill critical">Barrier Locked</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 5. HCP COMPOUND CONNECTIVITY
  'hcp-connectivity': function() {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">HCP Compound Connectivity & Gateway</h1>
          <p class="body-md" style="color:var(--secondary);">Configuration topology for Hikvision HikCentral Artemis OpenAPI clusters and secure IPsec VPN tunnels.</p>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn-secondary" onclick="PalmApp.showToast('Running diagnostic latency sweep across 8 clusters...')"><span class="material-symbols-outlined">network_check</span> Run Diagnostic Test</button>
          <button class="btn-primary" onclick="PalmApp.showToast('Forced full synchronization with HCP OpenAPI')"><span class="material-symbols-outlined">sync</span> Sync Now</button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1.2fr 0.8fr; gap:24px;">
        <div class="exec-panel" style="padding:24px;">
          <h3 class="headline-sm" style="margin-bottom:16px;">HCP Server & OpenAPI Credentials</h3>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
            <div><label class="label-md">OpenAPI Host / Endpoint</label><input type="text" class="form-control-input" style="width:100%;" value="https://hcp-gateway.palmhills.com" /></div>
            <div><label class="label-md">Port</label><input type="text" class="form-control-input" style="width:100%;" value="443 (HTTPS TLS 1.3)" /></div>
            <div><label class="label-md">Artemis App Key</label><input type="text" class="form-control-input" style="width:100%;" value="28491048-HCP-LIVE" /></div>
            <div><label class="label-md">Artemis App Secret</label><input type="password" class="form-control-input" style="width:100%;" value="••••••••••••••••••••" /></div>
          </div>
          <div style="margin-bottom:20px;">
            <label class="label-md">Mutual TLS CA Certificate Fingerprint</label>
            <input type="text" class="form-control-input font-mono" style="width:100%;" value="SHA256:7B:3E:91:0A:F2:1C:88:51:33:9A:C4:16:1C:E8:22:90" readonly />
          </div>
          <button class="btn-primary" onclick="PalmApp.showToast('Saved connection settings.')">Save Gateway Config</button>
        </div>

        <div class="exec-panel" style="padding:24px;">
          <h3 class="headline-sm" style="margin-bottom:16px;">Diagnostic Cluster Status</h3>
          <div style="padding:12px; background:var(--surface-container-low); border-radius:var(--radius-default); margin-bottom:12px; display:flex; justify-content:space-between;">
            <div><strong>Artemis API v2.8 Core</strong><div class="body-sm" style="color:var(--secondary);">TCP Handshake: 18ms</div></div>
            <span class="status-pill operational">ONLINE</span>
          </div>
          <div style="padding:12px; background:var(--surface-container-low); border-radius:var(--radius-default); margin-bottom:12px; display:flex; justify-content:space-between;">
            <div><strong>MinMoe Face Recognition Stream</strong><div class="body-sm" style="color:var(--secondary);">WebSocket: Active (1,048 syncs)</div></div>
            <span class="status-pill operational">ONLINE</span>
          </div>
          <div style="padding:12px; background:var(--surface-container-low); border-radius:var(--radius-default); display:flex; justify-content:space-between;">
            <div><strong>ANPR Optical Barrier Node</strong><div class="body-sm" style="color:var(--secondary);">Camera Stream: 99.8% Accuracy</div></div>
            <span class="status-pill operational">ONLINE</span>
          </div>
        </div>
      </div>
    `;
  },

  // 6. HCP LIVE DATA
  'hcp-live': function() {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h1 class="headline-lg">HCP Live Wire Telemetry Stream</h1>
          <p class="body-md" style="color:var(--secondary);">Direct live stream pipeline from MinMoe face terminals, UHF readers, and ANPR barrier nodes.</p>
        </div>
        <span class="status-pill operational"><span style="width:6px; height:6px; border-radius:50%; background:var(--status-active);"></span> Live Socket Streaming</span>
      </div>

      <div class="exec-panel">
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Event ID</th><th>Capture Time</th><th>Compound & Gate</th><th>Terminal Type</th><th>Identified Subject</th><th>Access Status</th></tr></thead>
            <tbody>
              <tr><td class="font-mono">#99281</td><td class="font-mono">Just now (10:44:02)</td><td>Badya Gate 1 Fast-Lane</td><td>ANPR Camera (Lane 2)</td><td>Mercedes S500 (س ق ر ٨٩٤)</td><td><span class="status-pill operational">Barrier Auto-Raised</span></td></tr>
              <tr><td class="font-mono">#99280</td><td class="font-mono">10:43:55</td><td>The Crown Clubhouse</td><td>MinMoe Optical Face ID</td><td>Laila Shoukry (Resident)</td><td><span class="status-pill operational">Pedestrian Match (99.8%)</span></td></tr>
              <tr><td class="font-mono">#99279</td><td class="font-mono">10:42:19</td><td>Woodville North Gate</td><td>UHF RFID Barrier</td><td>Delivery Van (Commercial)</td><td><span class="status-pill warning">QR Verification Required</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 7. HCP VEHICLE COUNT COMPARISON
  'hcp-vehicle-counts': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">HCP vs Property CRM Vehicle Count Benchmark</h1>
        <p class="body-md" style="color:var(--secondary);">Auditing discrepancies between physical gate passage counts in HikCentral and contractually registered vehicles in CRM.</p>
      </div>

      <div class="exec-panel">
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Compound</th><th>CRM Registered Vehicles</th><th>HCP Optical Detections</th><th>Variance (Unmatched)</th><th>Audit Status</th></tr></thead>
            <tbody>
              <tr><td><strong>Badya (6th of October)</strong></td><td class="font-mono">842</td><td class="font-mono">912</td><td class="font-mono" style="color:var(--status-warning);">+70 (Guests/Contractors)</td><td><span class="status-pill warning">Audit Pending</span></td></tr>
              <tr><td><strong>Palm Hills October Main</strong></td><td class="font-mono">1,120</td><td class="font-mono">1,114</td><td class="font-mono" style="color:var(--status-active);">-6 (Off-site)</td><td><span class="status-pill operational">Reconciled</span></td></tr>
              <tr><td><strong>The Crown & Golf Views</strong></td><td class="font-mono">310</td><td class="font-mono">358</td><td class="font-mono" style="color:var(--status-critical);">+48 (Unregistered ANPR)</td><td><span class="status-pill critical">Tag Discrepancy</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 8. INVITATIONS
  'invitations': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Resident Guest Invitations</h1>
        <p class="body-md" style="color:var(--secondary);">Active digital passes generated by homeowners via the Palm Hills Community Mobile App.</p>
      </div>
      <div class="exec-panel">
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Invitation Code</th><th>Host Homeowner</th><th>Target Unit</th><th>Guest Name</th><th>Valid Timeframe</th><th>Pass State</th></tr></thead>
            <tbody>
              <tr><td class="font-mono">INV-88219</td><td>Eng. Tarek Hegazy</td><td>Palm Hills Oct Bamboo V-44</td><td>Ahmed Farouk</td><td>Oct 2, 2026 • 14:00 - 22:00</td><td><span class="status-pill operational">Active</span></td></tr>
              <tr><td class="font-mono">INV-88218</td><td>Dr. Karim Mansour</td><td>Badya District 4 Villa 112</td><td>Ambassador Hany Talaat</td><td>Oct 2, 2026 • All Day</td><td><span class="status-pill operational">Pre-Cleared</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 9. VISITORS
  'visitors': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Visitors Audit Log</h1>
        <p class="body-md" style="color:var(--secondary);">Complete physical registry of visiting couriers, maintenance crews, and non-resident entries.</p>
      </div>
      <div class="exec-panel"><div style="padding:48px; text-align:center; color:var(--secondary);">Displaying active visitor records. Real-time capture synchronized with security gate kiosks.</div></div>
    `;
  },

  // 10. FACE RECOGNITION
  'face-recognition': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">MinMoe Face Recognition Terminals</h1>
        <p class="body-md" style="color:var(--secondary);">Pedestrian turnstiles, clubhouse access, and executive lounge biometric telemetry.</p>
      </div>
      <div class="exec-panel"><div style="padding:48px; text-align:center; color:var(--secondary);">12 MinMoe optical terminals active across Badya, October Main, and Hacienda Bay clubhouses.</div></div>
    `;
  },

  // 11. IDENTITY MATCHING
  'identity-matching': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">CRM Identity Matching & KYC</h1>
        <p class="body-md" style="color:var(--secondary);">Automated cross-matching between National IDs, Title Deeds, and HCP Biometric Profiles.</p>
      </div>
      <div class="exec-panel"><div style="padding:48px; text-align:center; color:var(--secondary);">Identity match score: 98.4% across 15,048 verified resident profiles.</div></div>
    `;
  },

  // 12. TRENDS (Portfolio Trends)
  'portfolio-trends': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Portfolio Access & Occupancy Trends</h1>
        <p class="body-md" style="color:var(--secondary);">Long-term traffic distribution, seasonal peak utilization, and barrier cycle analytics.</p>
      </div>
      <div class="exec-panel"><div style="padding:48px; text-align:center; color:var(--secondary);">Aggregated telemetry trends across Q1–Q3 2026. Peak gate utilization concentrated at 08:00–11:00 and 16:00–19:00 daily.</div></div>
    `;
  },

  // 13. DATA QUALITY
  'data-quality': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Data Quality & Telemetry Audit</h1>
        <p class="body-md" style="color:var(--secondary);">Monitoring orphaned records, OCR plate confidence thresholds, and missing CRM unit contracts.</p>
      </div>
      <div class="exec-panel"><div style="padding:48px; text-align:center; color:var(--secondary);">Data health score: 99.4%. No corrupted transmission packets detected in the last 48 hours.</div></div>
    `;
  },

  // 14. MONTHLY IMPORTS
  'monthly-imports': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Monthly Data Imports & CSV Batching</h1>
        <p class="body-md" style="color:var(--secondary);">Ingest bulk property sales contracts, historical gate passage dumps, and utility registers.</p>
      </div>
      <div class="exec-panel" style="padding:48px; text-align:center; border:2px dashed var(--hairline-divider);">
        <span class="material-symbols-outlined" style="font-size:48px; color:var(--primary-container); margin-bottom:12px;">upload_file</span>
        <h3 class="headline-sm">Drop Monthly Dataset (.csv, .xlsx) Here</h3>
        <p class="body-sm" style="color:var(--secondary); margin-top:6px;">Accepts up to 500,000 records per batch. Automatic schema mapping to Property CRM.</p>
        <button class="btn-primary" style="margin-top:16px;">Browse File System</button>
      </div>
    `;
  },

  // 15. ASK PALM AI / AI ANALYST
  'ai-analyst': function() {
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
                <span class="status-pill operational" style="font-size:9px;">v4.8 Neural</span>
              </div>
            </div>
            <div class="label-caps" style="color:var(--secondary); margin-bottom:8px;">Scope & Authority</div>
            <div style="padding:10px; background:var(--surface-container-low); border-radius:var(--radius-default); font-size:12px; margin-bottom:16px;">
              <strong>Active Context:</strong> Full Portfolio (8 Developments)<br/>
              <strong>Data Freshness:</strong> Live Wire (HCP + CRM)<br/>
              <strong>Clearance:</strong> Super Admin
            </div>
            <div class="label-caps" style="color:var(--secondary); margin-bottom:8px;">Suggested Queries</div>
            <button class="btn-ghost" style="width:100%; text-align:left; font-size:12px; justify-content:flex-start; margin-bottom:4px;" onclick="PalmApp.showToast('Executing: Audit tag mismatches...')">◆ Audit tag mismatches in The Crown</button>
            <button class="btn-ghost" style="width:100%; text-align:left; font-size:12px; justify-content:flex-start; margin-bottom:4px;" onclick="PalmApp.showToast('Executing: Explain 100k pass limit...')">◆ Explain 100k pass ceiling risks</button>
            <button class="btn-ghost" style="width:100%; text-align:left; font-size:12px; justify-content:flex-start;" onclick="PalmApp.showToast('Executing: Summarize peak ANPR inflow...')">◆ Summarize peak ANPR inflow today</button>
          </div>
          <div class="body-sm" style="font-size:11px; color:var(--secondary);">Enterprise encryption active • Read-only access to HikCentral core.</div>
        </div>

        <!-- Chat Console -->
        <div class="exec-panel" style="display:flex; flex-direction:column; overflow:hidden;">
          <div style="flex:1; padding:24px; overflow-y:auto;">
            <!-- Message 1: User -->
            <div style="display:flex; justify-content:flex-end; margin-bottom:20px;">
              <div style="max-width:75%; background:var(--primary-container); color:#fff; padding:12px 18px; border-radius:12px 12px 2px 12px; font-size:13.5px;">
                Show me anomalies in Gate Passes and tag mismatches between Hikvision ANPR and Property CRM in Badya and The Crown over the last 48 hours.
              </div>
            </div>

            <!-- Message 2: AI Response -->
            <div style="display:flex; justify-content:flex-start; margin-bottom:20px;">
              <div style="max-width:85%; background:var(--surface-container-low); border:1px solid var(--hairline-divider); padding:16px 20px; border-radius:12px 12px 12px 2px; font-size:13.5px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                  <span class="status-pill critical">Critical Anomaly Detected</span>
                  <span class="font-mono" style="font-size:11px; color:var(--secondary);">Query ID #99824</span>
                </div>
                <p style="margin-bottom:12px;">Correlating real-time optical ANPR capture with the Master CRM Property Registry across <strong>Badya</strong> and <strong>The Crown</strong> identified <strong>3 Tag Mismatches</strong> and 142 truncated gate logs due to the 100,000 monthly record export ceiling:</p>
                <div style="padding:12px; background:var(--surface-card); border:1px solid var(--hairline-divider); border-radius:var(--radius-default); margin-bottom:8px;">
                  <strong>Incident 01 • The Crown (Gate 1 VIP):</strong> Plate <code>QHD 721</code> accessed via guard manual override. Hardware tag <code>UHF PHD-9912</code> was previously assigned to a decommissioned contractor.
                </div>
                <div style="display:flex; gap:10px; margin-top:12px;">
                  <button class="btn-primary" style="height:32px; font-size:12px;" onclick="PalmApp.navigate('vehicle-access')">View Incident in ANPR</button>
                  <button class="btn-secondary" style="height:32px; font-size:12px;" onclick="PalmApp.showToast('Dispatching report to security...')">Dispatch to Field Guard</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Input Bar -->
          <div style="padding:16px 20px; border-top:1px solid var(--hairline-divider); background:var(--surface-container-lowest); display:flex; gap:12px; align-items:center;">
            <input type="text" class="form-control-input" style="flex:1; height:44px;" placeholder="Ask Palm AI about compound operations, resident CRM, ANPR telemetry..." />
            <button class="btn-primary" style="height:44px; padding:0 24px;" onclick="PalmApp.showToast('Query submitted to AI engine...')"><span class="material-symbols-outlined">send</span> Execute</button>
          </div>
        </div>
      </div>
    `;
  },

  // 16. REPORTS
  'reports': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Executive Reports & Dossier Generation</h1>
        <p class="body-md" style="color:var(--secondary);">Generate board-ready operational summaries, occupancy economics, and incident audits.</p>
      </div>
      <div class="exec-panel" style="padding:24px;">
        <button class="btn-primary" onclick="PalmApp.showToast('Compiling executive PDF dossier...')"><span class="material-symbols-outlined">picture_as_pdf</span> Generate Monthly Board Dossier (PDF)</button>
      </div>
    `;
  },

  // 17. SETTINGS
  'settings': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">System & Governance Settings</h1>
        <p class="body-md" style="color:var(--secondary);">Security clearance protocols, archival retention, and master API key management.</p>
      </div>
      <div class="exec-panel" style="padding:24px;">
        <h3 class="title-md" style="margin-bottom:16px;">Archival Storage Tiering (100,000 Record Ceiling)</h3>
        <p class="body-sm" style="color:var(--secondary); margin-bottom:16px;">Configure auto-purge and cold-storage offloading to Amazon S3 Cairo Cluster when monthly gate passes approach 100,000 items.</p>
        <button class="btn-primary" onclick="PalmApp.showToast('Settings saved.')">Save Preferences</button>
      </div>
    `;
  },

  // 18. KPI DEFINITIONS
  'kpi-definitions': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">KPI Command Center & Mathematical Formulas</h1>
        <p class="body-md" style="color:var(--secondary);">Formulas governing occupancy ratios, ANPR match accuracy, and gate cycle latency.</p>
      </div>
      <div class="exec-panel"><div style="padding:48px; text-align:center; color:var(--secondary);">Standard operating KPI formulas documented and calibrated to Palm Hills Developments criteria.</div></div>
    `;
  },

  // 19. COMPOUNDS (Compound Comparison)
  'compound-comparison': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Compound Cross-Comparison Matrix</h1>
        <p class="body-md" style="color:var(--secondary);">Benchmarking operational throughput, resident adoption, and gate efficiency across all 8 developments.</p>
      </div>
      <div class="exec-panel">
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Development</th><th>Total Units</th><th>Occupancy %</th><th>Daily ANPR Volume</th><th>Barrier Latency</th><th>Status</th></tr></thead>
            <tbody>
              <tr><td><strong>Badya</strong></td><td class="font-mono">14,200</td><td class="font-mono">31.4%</td><td class="font-mono">42,500 / day</td><td class="font-mono">14ms</td><td><span class="status-pill operational">Prime Flow</span></td></tr>
              <tr><td><strong>Palm Hills October Main</strong></td><td class="font-mono">8,600</td><td class="font-mono">78.2%</td><td class="font-mono">51,200 / day</td><td class="font-mono">18ms</td><td><span class="status-pill operational">Stable</span></td></tr>
              <tr><td><strong>The Crown & Golf Views</strong></td><td class="font-mono">4,100</td><td class="font-mono">45.0%</td><td class="font-mono">19,800 / day</td><td class="font-mono">38ms</td><td><span class="status-pill warning">Reviewing</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // Units
  'units': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Master Property Units Directory</h1>
        <p class="body-md" style="color:var(--secondary);">Registry of 31,015 units across Badya, October, Hacienda Bay, and The Crown.</p>
      </div>
      <div class="exec-panel"><div style="padding:48px; text-align:center; color:var(--secondary);">Master CRM Unit Registry loaded. Filters available by development, delivery stage, and contract ownership.</div></div>
    `;
  },

  // Residents
  'residents': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Residents & Occupancy Directory</h1>
        <p class="body-md" style="color:var(--secondary);">15,048 verified property owners, registered tenants, and linked family profiles.</p>
      </div>
      <div class="exec-panel">
        <div class="exec-table-wrap">
          <table class="exec-table">
            <thead><tr><th>Resident Identity</th><th>Compound & Unit</th><th>Ownership Status</th><th>Contact & KYC</th><th>Action</th></tr></thead>
            <tbody>
              <tr>
                <td><strong>Dr. Karim Mansour</strong> <span class="status-pill operational">VIP</span></td>
                <td>Badya • District 4, V-112</td>
                <td>Primary Owner</td>
                <td class="font-mono">+20 100 849 2011</td>
                <td><button class="btn-ghost" onclick="PalmApp.openDrawer('Dr. Karim Mansour', '<p>Villa 112 • Title Deed Verified • 2 Linked Vehicles</p>')">Profile</button></td>
              </tr>
              <tr>
                <td><strong>Nour El-Sherif</strong></td>
                <td>Palm Hills October • Bamboo V-44</td>
                <td>Primary Owner</td>
                <td class="font-mono">+20 122 391 0021</td>
                <td><button class="btn-ghost">Profile</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // Vehicles
  'vehicles': function() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="headline-lg">Vehicles & ANPR UHF Tags</h1>
        <p class="body-md" style="color:var(--secondary);">2,059 resident-paired vehicles equipped with high-speed RFID gate transponders.</p>
      </div>
      <div class="exec-panel"><div style="padding:48px; text-align:center; color:var(--secondary);">Active vehicle database synchronized with property deeds and resident KYC cards.</div></div>
    `;
  }
};
