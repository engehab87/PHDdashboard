/* Palm Hills Executive Real Estate Intelligence — Core Application Logic */
(function() {
  'use strict';

  const API_BASE = (() => {
    try {
      if (window.API_BASE) return window.API_BASE;
      if (location.port === '2020') return '';
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '') return 'http://localhost:2020';
    } catch (e) { /* ignore */ }
    return '';
  })();
  const apiUrl = p => (p.charAt(0) === '/' && p.indexOf('/api/') === 0 ? API_BASE + p : p);
  const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  // UI-only route -> permission map. The server is authoritative; this only hides
  // navigation that would return 403 and keeps deep links honest.
  const ROUTE_PERMISSIONS = {
    overview: 'dashboard.view',
    units: 'unit.list',
    residents: 'resident.list',
    vehicles: 'vehicle.list',
    'unit-detail': 'unit.detail',
    'resident-detail': 'resident.detail',
    'vehicle-detail': 'vehicle.detail',
    'vehicle-access': 'access.list',
    'gate-passes': 'gatepass.list',
    invitations: 'invitation.list',
    visitors: 'invitation.list',
    'face-recognition': 'access.analytics',
    'identity-matching': 'identity.view',
    'hcp-live': 'access.list',
    'hcp-vehicle-counts': 'access.analytics',
    'compound-comparison': 'compare.view',
    'portfolio-trends': 'trend.view',
    'ai-analyst': 'ai.use',
    reports: 'report.executive',
    'kpi-definitions': 'kpi.view',
    'data-quality': 'quality.view',
    'monthly-imports': 'import.view',
    'hcp-connectivity': 'import.manage',
    settings: 'settings.view',
  };

  function apiError(message, status, code, correlationId) {
    const e = new Error(message);
    e.status = status;
    e.code = code;
    e.correlationId = correlationId;
    return e;
  }
  function readCookie(name) {
    try {
      const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (_) { return null; }
  }
  function initialsOf(value) {
    const parts = String(value || '').trim().split(/[\s@._-]+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts[1] || '')[0] || '').toUpperCase() || '?';
  }

  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = { ...(opts.headers || {}) };
    const st = window.PalmApp && window.PalmApp.state;
    if (UNSAFE_METHODS.has(method)) {
      const token = (st && st.csrfToken) || readCookie('ph_csrf');
      if (token) headers['X-CSRF-Token'] = token;
      if (opts.body && !headers['Content-Type'] && !(opts.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    let r;
    try {
      r = await fetch(apiUrl(path), { ...opts, method, headers, credentials: 'include', signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      throw apiError('Backend unreachable at ' + apiUrl(path), 0, 'NETWORK');
    }
    clearTimeout(timer);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { /* plain text */ }
      const msg = (data && data.error) || ('API error ' + r.status);
      const isLogin = path.indexOf('/api/auth/login') === 0;
      if (r.status === 401 && !isLogin && window.PalmApp) {
        window.PalmApp.expireSession(msg);
      }
      throw apiError(msg, r.status, data && data.code, data && data.correlationId);
    }
    if (r.status === 204) return null;
    const ct = r.headers.get('content-type') || '';
    if (ct.indexOf('application/json') === -1) return r;
    return r.json();
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US');
  const fmtPct = n => (n == null ? '—' : Number(n).toFixed(2) + '%');

  // Presentation modes only. These never grant or remove access; the role and
  // its server-issued permissions are the single source of truth.
  const MODE_META = {
    management: {
      label: 'Management',
      badgeClass: 'neutral',
      banner: 'Management presentation: portfolio framing, executive summaries and KPI trends. Presentation only — not a permission.',
    },
    operations: {
      label: 'Operations',
      badgeClass: 'warning',
      banner: 'Operations presentation: registry detail, gate activity and site workflows. Presentation only — not a permission.',
    },
  };

  const ROLE_BADGE = {
    'Top Management': 'neutral',
    'Community Manager': 'operational',
    'Community Admin': 'operational',
    'Admin': 'warning',
    'Super Admin': 'critical',
  };

  const NAV_GROUPS = [
    ['Operations', [
      ['overview', 'dashboard', 'Executive Overview'],
      ['units', 'apartment', 'Units'],
      ['residents', 'badge', 'Residents'],
      ['vehicles', 'directions_car', 'Vehicles & ANPR'],
      ['vehicle-access', 'toll', 'Vehicle Access (HCP)'],
      ['gate-passes', 'pin', 'Gate Passes'],
      ['invitations', 'mail', 'Invitations'],
      ['visitors', 'person_pin_circle', 'Visitors'],
      ['face-recognition', 'face', 'Face Recognition'],
      ['identity-matching', 'fingerprint', 'Identity Matching'],
      ['hcp-live', 'sensors', 'HCP Access Events'],
      ['hcp-vehicle-counts', 'compare_arrows', 'HCP Vehicle Counts'],
    ]],
    ['Intelligence', [
      ['compound-comparison', 'domain_add', 'Compound Comparison'],
      ['portfolio-trends', 'trending_up', 'Portfolio Trends'],
      ['ai-analyst', 'psychology', 'Ask Palm AI Copilot'],
      ['reports', 'description', 'Reports'],
      ['kpi-definitions', 'tune', 'KPI Definitions'],
    ]],
    ['Governance', [
      ['data-quality', 'verified', 'Data Quality'],
      ['monthly-imports', 'upload_file', 'Monthly Imports'],
      ['hcp-connectivity', 'hub', 'Compound Connectivity'],
      ['settings', 'settings', 'Settings'],
    ]],
  ];

  window.PalmApp = {
    state: {
      booting: true,
      isAuthenticated: false,
      sessionError: '',
      user: null,
      role: null,
      permissions: [],
      scope: { all: false, compounds: [] },
      csrfToken: '',
      mode: 'management',
      currentRoute: 'overview',
      selectedCompound: 'all',
      selectedPeriod: '',
      theme: 'light',
      periods: [],
      compounds: [],
      dashboard: null,
      compare: null,
      quality: null,
      insights: null,
      kpiDefs: null,
      gatePasses: null,
      invitations: null,
      access: null,
      users: null,
      units: null,
      vehicles: null,
      vehiclesStats: null,
      settings: null,
      trends: null,
      matching: null,
      hcpVehicleComparison: null,
      hcpConnectivity: null,
      hcpCompounds: null,
      hcpCompound: null,
      hcpRegistry: null,
      aiChat: [],
      paging: {},
      accessFilters: { direction: 'all', result: 'all', gate: 'all' },
      accessPlate: '',
      accessFrom: '',
      accessTo: '',
      accessHour: '',
      accessSortDir: 'desc',
      hcpSyncedCompound: null,
      _hcpCheckInFlight: false,
      hcpLiveEventsPage: 1,
      hcpLiveEventsLimit: 100,
      residentsFilter: '',
      residentsStatus: 'all',
      residentsType: 'all',
      residentsGender: 'all',
      residentsMaritalStatus: 'all',
      residentsFiltersOpen: false,
      residentsSort: { key: 'name', dir: 'asc' },
      unitsSearch: '',
      unitsPreset: 'all',
      unitsSort: { key: 'unit_number', dir: 'asc' },
      vehiclesFilter: '',
      detailId: null,
      hcpCompoundId: null,
      hcpPreview: null,
      importBusy: false,
      pendingImportId: null,
    },

    // ---- Session, role and permission helpers -----------------------------
    can: function(permission) {
      if (!permission) return true;
      const perms = this.state.permissions || [];
      if (Array.isArray(permission)) return permission.every(p => perms.indexOf(p) !== -1);
      return perms.indexOf(permission) !== -1;
    },

    canRoute: function(route) {
      if (route === 'login') return true;
      const need = ROUTE_PERMISSIONS[route];
      if (!need) return false;
      return this.can(need);
    },

    firstAllowedRoute: function() {
      const keys = Object.keys(ROUTE_PERMISSIONS);
      for (let i = 0; i < keys.length; i += 1) {
        if (this.canRoute(keys[i])) return keys[i];
      }
      return 'overview';
    },

    applySession: function(user, csrfToken) {
      this.state.user = user || null;
      this.state.role = (user && user.role) || null;
      this.state.permissions = Array.isArray(user && user.permissions) ? user.permissions.slice() : [];
      this.state.scope = (user && user.scope) || { all: false, compounds: [] };
      this.state.csrfToken = csrfToken || (user && user.csrfToken) || '';
      this.state.isAuthenticated = !!(user && user.role);
      this.state.sessionError = '';
    },

    expireSession: function(message) {
      if (!this.state.isAuthenticated) return;
      this.state.isAuthenticated = false;
      this.state.user = null;
      this.state.role = null;
      this.state.permissions = [];
      this.state.csrfToken = '';
      this.state.scope = { all: false, compounds: [] };
      this.state.booting = false;
      this.state.sessionError = message || 'Your session expired. Sign in again.';
      this.render();
    },

    loadBootstrapData: async function() {
      try {
        const results = await Promise.all([api('/api/periods'), api('/api/compounds')]);
        this.state.periods = Array.isArray(results[0]) ? results[0] : [];
        this.state.compounds = Array.isArray(results[1]) ? results[1] : [];
        const keys = this.state.periods.map(p => p.period_key);
        if (!keys.length) this.state.selectedPeriod = '';
        else if (keys.indexOf(this.state.selectedPeriod) === -1) this.state.selectedPeriod = keys[0];
        const names = this.state.compounds.map(c => c.name);
        if (this.state.selectedCompound !== 'all' && names.indexOf(this.state.selectedCompound) === -1) {
          this.state.selectedCompound = 'all';
        }
      } catch (e) {
        if (!e || e.status !== 401) this.showToast('Could not load reporting scope: ' + (e && e.message ? e.message : e));
      }
    },

    bootstrapSession: async function() {
      this.state.booting = true;
      try {
        const me = await api('/api/auth/me');
        this.applySession(me.user, me.csrfToken);
      } catch (e) {
        this.state.isAuthenticated = false;
        this.state.user = null;
        this.state.permissions = [];
        if (e && e.status && e.status !== 401) {
          this.state.sessionError = e.message || 'The backend is unreachable.';
        }
      }
      if (this.state.isAuthenticated) await this.loadBootstrapData();
      this.state.booting = false;
    },

    submitLogin: async function(event) {
      if (event && event.preventDefault) event.preventDefault();
      const form = (event && event.target) || document.getElementById('login-form');
      const emailEl = form && form.querySelector('input[name="email"]');
      const passEl = form && form.querySelector('input[name="password"]');
      const errEl = document.getElementById('login-error');
      const btn = form && form.querySelector('button[type="submit"]');
      const email = emailEl ? emailEl.value.trim() : '';
      const password = passEl ? passEl.value : '';
      const setError = m => {
        if (!errEl) return;
        errEl.textContent = m || '';
        errEl.style.display = m ? 'block' : 'none';
      };
      if (!email || !password) { setError('Enter your email and password.'); return false; }
      setError('');
      if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Signing in…'; }
      try {
        const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        this.applySession(res.user, res.csrfToken);
        await this.loadBootstrapData();
        const hash = window.location.hash.replace('#/', '');
        const route = (hash && hash !== 'login' && this.canRoute(hash)) ? hash : this.firstAllowedRoute();
        this.state.currentRoute = route;
        if (window.location.hash !== '#/' + route) window.location.hash = '#/' + route;
        await this.render();
      } catch (e) {
        setError(e && e.message ? e.message : 'Sign-in failed.');
        if (passEl) { passEl.value = ''; passEl.focus(); }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Sign In'; }
      }
      return false;
    },

    logout: async function() {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* session already gone */ }
      this.state.isAuthenticated = false;
      this.state.user = null;
      this.state.role = null;
      this.state.permissions = [];
      this.state.csrfToken = '';
      this.state.scope = { all: false, compounds: [] };
      this.state.sessionError = '';
      this.state.dashboard = null;
      this.state.compare = null;
      this.state.quality = null;
      this.state.insights = null;
      this.state.gatePasses = null;
      this.state.invitations = null;
      this.state.access = null;
      this.state.users = null;
      this.state.units = null;
      this.state.vehicles = null;
      this.state.aiChat = [];
      window.location.hash = '#/login';
      await this.render();
    },

    parseHash: function() {
      const raw = (window.location.hash || '').replace('#/', '');
      const parts = raw.split('?');
      const route = parts[0] || 'overview';
      const params = {};
      if (parts[1]) {
        parts[1].split('&').forEach(function(pair) {
          const kv = pair.split('=');
          if (kv[0]) params[decodeURIComponent(kv[0])] = kv.length > 1 ? decodeURIComponent(kv[1]) : '';
        });
      }
      if (params.id != null) this.state.detailId = params.id;
      return { route: route === 'login' ? 'overview' : route, params: params };
    },

    init: async function() {
      const first = this.parseHash();
      this.state.currentRoute = first.route;
      window.addEventListener('hashchange', () => {
        if (!this.state.isAuthenticated) { this.render(); return; }
        const next = this.parseHash();
        this.state.currentRoute = next.route;
        this.render();
      });
      await this.bootstrapSession();
      if (this.state.isAuthenticated) {
        const cur = this.parseHash();
        if (!cur.route || cur.route === 'login' || !this.canRoute(cur.route)) {
          this.state.currentRoute = this.firstAllowedRoute();
          window.location.hash = '#/' + this.state.currentRoute;
        } else {
          this.state.currentRoute = cur.route;
        }
      }
      await this.render();
    },

    setMode: function(mode) {
      if (!MODE_META[mode] || this.state.mode === mode) return;
      this.state.mode = mode;
      this.render();
    },

    toggleTheme: function() {
      this.state.theme = this.state.theme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', this.state.theme);
      this.showToast('Switched theme to ' + this.state.theme + ' mode');
      this.render();
    },

    navigate: function(route, pushHash = true) {
      if (route === 'login') { this.logout(); return; }
      if (!this.state.isAuthenticated) { this.render(); return; }
      const next = route || 'overview';
      this.state.currentRoute = next;
      if (pushHash) {
        const target = '#/' + next;
        if (window.location.hash !== target) { window.location.hash = target; return; }
      }
      this.render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    showToast: function(msg) {
      const shelf = document.getElementById('toast-shelf');
      if (!shelf) return;
      const bubble = document.createElement('div');
      bubble.className = 'toast-bubble';
      bubble.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#C4161C;"></span> ' + msg;
      shelf.appendChild(bubble);
      setTimeout(() => { bubble.style.opacity = '0'; bubble.style.transition = 'opacity 300ms ease'; setTimeout(() => bubble.remove(), 300); }, 3200);
    },

    openDrawer: function(title, contentHtml) {
      const backdrop = document.getElementById('drawer-backdrop');
      const panel = document.getElementById('drawer-panel');
      const container = document.getElementById('drawer-content');
      if (!backdrop || !panel || !container) return;
      container.innerHTML = `
        <div style="padding:18px 24px; border-bottom:1px solid var(--hairline-divider); display:flex; justify-content:space-between; align-items:center;">
          <h3 class="headline-sm">${esc(title)}</h3>
          <button class="btn-ghost" onclick="PalmApp.closeDrawer()"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div style="padding:24px; overflow-y:auto; flex:1;">
          ${contentHtml}
        </div>
      `;
      backdrop.classList.add('active');
      panel.classList.add('open');
      backdrop.onclick = () => this.closeDrawer();
    },

    closeDrawer: function() {
      const backdrop = document.getElementById('drawer-backdrop');
      const panel = document.getElementById('drawer-panel');
      if (backdrop) backdrop.classList.remove('active');
      if (panel) panel.classList.remove('open');
    },

    fmt: function(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); },
    fmtPct: function(n) { return n == null ? '—' : Number(n).toFixed(2) + '%'; },

    render: async function() {
      const root = document.getElementById('root');
      if (!root) return;
      if (this.state.booting) {
        root.innerHTML = '<div style="min-height:100vh; display:flex; align-items:center; justify-content:center; color:var(--secondary); font-size:13px;">Starting Palm Hills Executive Core…</div>';
        return;
      }
      if (!this.state.isAuthenticated) {
        root.innerHTML = PalmPages['login']();
        return;
      }
      const user = this.state.user || {};
      const role = this.state.role || 'Unknown role';
      const badge = ROLE_BADGE[role] || 'neutral';
      const modeMeta = MODE_META[this.state.mode] || MODE_META.management;
      const scopedCompounds = (this.state.scope && this.state.scope.compounds) || [];
      const scopeLabel = (this.state.scope && this.state.scope.all)
        ? 'Entire portfolio'
        : (scopedCompounds.length === 1 ? scopedCompounds[0].name : scopedCompounds.length + ' assigned communities');
      const displayName = user.displayName || user.email || 'Signed-in user';
      const canExport = this.canRoute('reports');
      const canVerify = this.canRoute('hcp-connectivity');
      const nav = NAV_GROUPS.map(group => {
        const items = group[1].filter(item => this.canRoute(item[0]));
        if (!items.length) return '';
        return `<div class="nav-group-header">${esc(group[0])}</div>` +
          items.map(item => this.renderNavItem(item[0], item[1], item[2])).join('');
      }).join('');

      root.innerHTML = `
        <!-- Fixed Left Sidebar (256px) -->
        <aside id="app-sidebar">
          <div style="padding:22px 20px 18px; border-bottom:1px solid var(--hairline-divider); display:flex; align-items:center; gap:12px;">
            <img src="brand/palm-hills-logo.png" alt="Palm Hills logo" style="width:34px; height:auto; display:block;" />
            <div>
              <div style="font-family:var(--font-display); font-weight:800; font-size:14.5px; letter-spacing:0.04em; color:var(--on-surface);">PALM HILLS</div>
              <div class="label-caps" style="color:var(--primary-container); font-size:9.5px;">EXECUTIVE CORE</div>
            </div>
          </div>
          <div style="flex:1; padding:12px 0; overflow-y:auto;">${nav}</div>
          <div style="padding:14px 16px; border-top:1px solid var(--hairline-divider); background:var(--surface-container-low);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; font-size:11px;">
              <span style="display:flex; align-items:center; gap:6px; color:var(--status-active); font-weight:600;">
                <span style="width:7px; height:7px; border-radius:50%; background:var(--status-active);"></span> Authenticated session
              </span>
              <span class="font-mono" style="color:var(--secondary);">local</span>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:34px; height:34px; border-radius:50%; background:#1c1b1a; color:#fff; display:flex; align-items:center; justify-content:center; font-family:var(--font-display); font-weight:700; font-size:12px;">${esc(initialsOf(displayName))}</div>
              <div style="flex:1; min-width:0;">
                <div style="font-weight:600; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(displayName)}</div>
                <div style="font-size:11px; color:var(--secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${esc(role + ' — ' + scopeLabel)}">${esc(role)} • ${esc(scopeLabel)}</div>
              </div>
              <button class="btn-ghost" style="padding:4px;" title="Sign out" onclick="PalmApp.logout()">
                <span class="material-symbols-outlined" style="font-size:18px;">logout</span>
              </button>
            </div>
          </div>
        </aside>

        <div id="app-main-viewport">
          <header id="app-topbar">
            <div style="display:flex; align-items:center; gap:16px;">
              <div style="position:relative; width:340px;">
                <span class="material-symbols-outlined" style="position:absolute; left:12px; top:10px; color:var(--secondary); font-size:20px;">search</span>
                <input type="text" class="form-control-input" style="width:100%; padding-left:38px; height:38px; border-radius:var(--radius-default);" placeholder="Search units, residents, vehicles, passes..." />
                <span class="font-mono" style="position:absolute; right:10px; top:11px; font-size:10px; color:var(--secondary); background:var(--surface-container); padding:1px 5px; border-radius:2px;">⌘K</span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              <span class="label-caps" style="color:var(--secondary); font-size:9.5px;" title="Presentation mode changes layout emphasis only; it never changes permissions.">VIEW MODE</span>
              <div style="display:flex; background:var(--surface-container); padding:3px; border-radius:var(--radius-default); border:1px solid var(--border-strong);" title="Presentation mode only — permissions come from your assigned role">
                ${this.renderModeBtn('management')}
                ${this.renderModeBtn('operations')}
              </div>
              <span class="status-pill ${badge}" style="white-space:nowrap;" title="Role and scope are enforced by the server">${esc(role)}</span>
              <button class="btn-icon" onclick="PalmApp.toggleTheme()" title="Toggle Dark/Light Mode">
                <span class="material-symbols-outlined">${this.state.theme === 'light' ? 'dark_mode' : 'light_mode'}</span>
              </button>
              <div style="display:flex; align-items:center; gap:8px; padding-left:8px; border-left:1px solid var(--hairline-divider);">
                <span class="label-caps" style="color:var(--secondary);">HOTLINE</span>
                <span class="font-mono" style="font-weight:700; font-size:13px; color:var(--primary-container);">19743</span>
              </div>
            </div>
          </header>
          <div class="role-context-bar">
            <div>
              <span class="status-pill ${badge}" style="margin-right:8px;">${esc(role)}</span>
              <span class="body-sm" style="color:var(--secondary);">${esc(modeMeta.banner)}</span>
            </div>
            <div style="display:flex; gap:8px;">
              ${canExport ? '<button class="btn-ghost" style="font-size:12px;" onclick="PalmApp.navigate(\'reports\')"><span class="material-symbols-outlined" style="font-size:16px;">file_download</span> Export Summary</button>' : ''}
              ${canVerify ? '<button class="btn-ghost" style="font-size:12px;" onclick="PalmApp.navigate(\'hcp-connectivity\')"><span class="material-symbols-outlined" style="font-size:16px;">sync</span> Verify Sync</button>' : ''}
            </div>
          </div>
          <main id="content-container">
            <div class="page-loading" style="min-height:400px; display:flex; align-items:center; justify-content:center; color:var(--secondary); font-size:13px;">Loading…</div>
          </main>
        </div>
        ${this.canRoute('ai-analyst') ? `<button class="floating-ai-btn" onclick="PalmApp.navigate('ai-analyst')">
          <span class="material-symbols-outlined" style="font-size:20px;">psychology</span>
          <span>Ask Palm AI</span>
        </button>` : ''}
      `;
      await this.mountPage();
    },

    mountPage: async function() {
      const main = document.querySelector('#content-container');
      if (!main) return;
      const route = this.state.currentRoute || 'overview';
      if (route === 'login') {
        this.state.currentRoute = this.firstAllowedRoute();
        return this.mountPage();
      }
      if (!this.canRoute(route)) {
        main.innerHTML = this.renderDenied(route);
        return;
      }
      const pageFn = PalmPages[route];
      if (typeof pageFn !== 'function') {
        main.innerHTML = this.renderDenied(route, 'This module is not available in the current build.');
        return;
      }
      main.innerHTML = '<div class="page-loading" style="min-height:320px; display:flex; align-items:center; justify-content:center; color:var(--secondary); font-size:13px;">Loading…</div>';
      try {
        const html = await pageFn();
        main.innerHTML = html;
        if (route !== 'overview') {
          try {
            const scopeHtml = await this.renderScopeBar();
            main.insertAdjacentHTML('afterbegin', scopeHtml);
          } catch (_) { /* scope bar is optional */ }
        }
      } catch (e) {
        if (e && e.status === 401) return; // api() already switched to the login view
        if (e && e.status === 403) { main.innerHTML = this.renderDenied(route, e.message); return; }
        main.innerHTML = `
          <div class="exec-panel" style="padding:28px; border-left:3px solid var(--status-critical);">
            <h2 class="headline-sm" style="margin-bottom:8px;">This module could not be loaded</h2>
            <p class="body-md" style="color:var(--secondary); margin-bottom:12px;">${esc((e && e.message) || 'Unexpected error')}</p>
            <p class="body-sm" style="color:var(--secondary);">No data was changed. Retry, or contact an administrator with the correlation ID shown in the browser console.</p>
          </div>`;
        if (e && e.correlationId && window.console) console.warn('API correlationId', e.correlationId);
      }
    },

    renderDenied: function(route, detail) {
      const role = this.state.role || 'your role';
      return `
        <div class="exec-panel" style="padding:32px; border-left:3px solid var(--status-critical);">
          <div class="label-caps" style="color:var(--status-critical); margin-bottom:8px;">403 — NOT AUTHORIZED</div>
          <h1 class="headline-md" style="margin-bottom:10px;">This module is outside your assigned scope</h1>
          <p class="body-md" style="color:var(--secondary); margin-bottom:8px;">
            ${esc(detail || 'Your role does not include the permission required for “' + route + '”.')}
          </p>
          <p class="body-sm" style="color:var(--secondary);">
            Signed in as <strong>${esc(role)}</strong>. The server enforces the same rule, so this page cannot be reached by guessing a URL.
          </p>
        </div>`;
    },

    renderModeBtn: function(mode) {
      const active = this.state.mode === mode;
      const activeStyle = active ? 'background:var(--primary-container); color:#ffffff; font-weight:600;' : 'background:transparent; color:var(--secondary);';
      return `
        <button type="button" style="border:none; padding:4px 12px; font-size:12px; border-radius:2px; cursor:pointer; font-family:var(--font-display); transition:all 120ms ease; ${activeStyle}" onclick="PalmApp.setMode('${mode}')">
          ${esc(MODE_META[mode].label)}
        </button>
      `;
    },

    renderNavItem: function(route, icon, label) {
      if (!this.canRoute(route)) return '';
      const isActive = this.state.currentRoute === route;
      return `
        <a href="#/${route}" class="nav-item-link ${isActive ? 'active' : ''}">
          <span class="material-symbols-outlined" style="font-size:20px;">${icon}</span>
          <span>${esc(label)}</span>
        </a>
      `;
    },

    // ---- Real backend data loaders (Palm Hills Executive API) ----
    apiGet: async function(path) { return api(path); },

    // ---- Monthly dataset upload (POST /api/uploads, multipart field "zip") ----
    uploadDataset: function(file, onProgress, endpoint, extraFields) {
      const url = endpoint || '/api/uploads';
      return new Promise((resolve, reject) => {
        if (!file) { reject(new Error('No file selected')); return; }
        const fd = new FormData();
        fd.append('zip', file, file.name || 'dataset');
        if (extraFields) {
          for (const k of Object.keys(extraFields)) fd.append(k, String(extraFields[k]));
        }
        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl(url));
        xhr.withCredentials = true;
        const token = this.state.csrfToken || readCookie('ph_csrf');
        if (token) xhr.setRequestHeader('X-CSRF-Token', token);
        xhr.upload.onprogress = e => {
          if (onProgress && e.lengthComputable) { try { onProgress(e.loaded / e.total); } catch (_) {} }
        };
        xhr.onload = () => {
          let data = {};
          try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else {
            const err = apiError(data.error || ('Upload failed (HTTP ' + xhr.status + ')'), xhr.status, data.code, data.correlationId);
            if (xhr.status === 401) this.expireSession(data.error);
            reject(err);
          }
        };
        xhr.onerror = () => reject(apiError('Backend unreachable at ' + apiUrl(url), 0, 'NETWORK'));
        xhr.ontimeout = () => reject(apiError('Upload timed out', 0, 'TIMEOUT'));
        xhr.timeout = 0;
        xhr.send(fd);
      });
    },
    loadImportPreview: async function(importId) { const r = await api('/api/imports/' + encodeURIComponent(importId) + '/preview'); this.state.hcpPreview = r; return r; },

    processImport: async function(importId, periodKey) {
      const payload = {};
      if (periodKey) payload.periodKey = periodKey;
      return api('/api/imports/' + encodeURIComponent(importId) + '/process', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    // Authenticated binary download. Uses fetch (cookies + CSRF) instead of
    // window.open so the session and structured errors are honoured.
    downloadFile: async function(path, fallbackName) {
      const res = await api(path);
      if (!res || typeof res.blob !== 'function') throw apiError('Expected a file response', 0, 'BAD_RESPONSE');
      const blob = await res.blob();
      const rowCount = res.headers.get('X-Export-Row-Count');
      const truncated = res.headers.get('X-Export-Truncated') === 'true';
      let name = fallbackName || 'download';
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename\*?=(?:UTF-8'')?"?([^\";]+)"?/i.exec(cd);
      if (m) { try { name = decodeURIComponent(m[1]); } catch (_) { name = m[1]; } }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return { name: name, rowCount: rowCount == null ? null : Number(rowCount), truncated: truncated };
    },

    loadPeriods: async function() { this.state.periods = await api('/api/periods'); return this.state.periods; },
    loadCompounds: async function() { this.state.compounds = await api('/api/compounds'); return this.state.compounds; },
    loadDashboard: async function() { const d = await api('/api/dashboard?period=' + encodeURIComponent(this.state.selectedPeriod || '') + '&compound=' + encodeURIComponent(this.state.selectedCompound || 'all')); this.state.dashboard = d; return d; },
    loadCompare: async function() { const c = await api('/api/compare?period=' + encodeURIComponent(this.state.selectedPeriod || '')); this.state.compare = c; return c; },
    loadQuality: async function() { const q = await api('/api/quality?period=' + encodeURIComponent(this.state.selectedPeriod || '')); this.state.quality = q; return q; },
    loadInsights: async function() { const i = await api('/api/insights?period=' + encodeURIComponent(this.state.selectedPeriod || '')); this.state.insights = i; return i; },
    loadKpiDefinitions: async function() { const k = await api('/api/kpi-definitions'); this.state.kpiDefs = k; return k; },
    loadGatePasses: async function(params) { params = params || {}; if (params.period == null) params.period = this.state.selectedPeriod; if (params.compound == null) params.compound = this.state.selectedCompound; const q = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&'); const r = await api('/api/gatepasses?' + q); this.state.gatePasses = r; return r; },
    loadInvitations: async function(params) { params = params || {}; if (params.period == null) params.period = this.state.selectedPeriod; if (params.compound == null) params.compound = this.state.selectedCompound; const q = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&'); const r = await api('/api/invitations?' + q); this.state.invitations = r; return r; },
    loadAccess: async function(params) { params = params || {}; if (params.period == null) params.period = this.state.selectedPeriod; if (params.compound == null) params.compound = this.state.selectedCompound; const q = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&'); const r = await api('/api/access?' + q); this.state.access = r; return r; },
    loadAccessHourly: async function(params) { params = params || {}; if (params.period == null) params.period = this.state.selectedPeriod; if (params.compound == null) params.compound = this.state.selectedCompound; const q = this.buildQuery(params); const r = await api('/api/access/hourly?' + q); return r; },
    loadAccessHeatmap: async function(params) { params = params || {}; if (params.period == null) params.period = this.state.selectedPeriod; if (params.compound == null) params.compound = this.state.selectedCompound; const q = this.buildQuery(params); const r = await api('/api/access/heatmap?' + q); return r; },
    loadUsers: async function(params) { params = params || {}; const q = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&'); const r = await api('/api/users?' + q); this.state.users = r; return r; },
    loadUnits: async function(params) { params = params || {}; const q = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&'); const r = await api('/api/units?' + q); this.state.units = r; return r; },
    loadVehicles: async function(params) { params = params || {}; const q = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&'); const r = await api('/api/vehicles?' + q); this.state.vehicles = r; return r; },
    loadVehiclesStats: async function() { const q = (this.state.selectedCompound && this.state.selectedCompound !== 'all') ? '?compound=' + encodeURIComponent(this.state.selectedCompound) : ''; const s = await api('/api/vehicles/stats' + q); this.state.vehiclesStats = s; return s; },
    loadSettings: async function() { const s = await api('/api/settings'); this.state.settings = s; return s; },
    saveSettings: async function (values) {
      const body = values || {};
      if (!Object.keys(body).length) { this.showToast('No changes to save.'); return false; }
      try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
        this.showToast('Settings saved and audit-logged.');
        await this.loadSettings();
        await this.mountPage();
        return true;
      } catch (e) {
        if (e && e.status === 401) return false;
        if (e && e.status === 403) { this.showToast('Save denied: your role cannot change these settings.'); return false; }
        this.showToast('Save failed: ' + esc(e && e.message ? e.message : e));
        return false;
      }
    },
    resolveIdentity: async function(hcpName, action, userId) {
      try {
        await api('/api/matching', { method: 'POST', body: JSON.stringify({ hcpName: hcpName, action: action, userId: userId }) });
        this.showToast(action === 'reject' ? 'Identity match rejected.' : 'Identity match confirmed.');
        await this.mountPage();
      } catch (e) {
        if (e && e.status === 401) return;
        if (e && e.status === 403) { this.showToast('Not permitted: identity decisions require the identity.decide permission.'); return; }
        this.showToast('Identity decision failed: ' + esc(e && e.message ? e.message : e));
      }
    },

    saveSettingsForm: async function(group) {
      const box = document.getElementById('settings-form');
      if (!box) return false;
      const current = this.state.settings || {};
      const BUSINESS = ['timezone', 'parking_lot_compound'];
      const SYSTEM = ['ai_provider', 'ai_model', 'ai_endpoint', 'ai_api_key'];
      const values = {};
      const fields = box.querySelectorAll('[data-setting-key]');
      for (let i = 0; i < fields.length; i += 1) {
        const el = fields[i];
        if (el.disabled) continue;
        const key = el.getAttribute('data-setting-key');
        if (group === 'business' && BUSINESS.indexOf(key) === -1) continue;
        if (group === 'system' && SYSTEM.indexOf(key) === -1) continue;
        const next = el.value == null ? '' : String(el.value);
        // A blank API key means "keep the stored secret"; the API never returns it.
        if (key === 'ai_api_key' && next === '') continue;
        const before = current[key] == null ? '' : String(current[key]);
        if (next === before) continue;
        values[key] = next;
      }
      return this.saveSettings(values);
    },
    loadTrends: async function(metric) { const m = metric || 'active_units'; const t = await api('/api/trends?period=' + encodeURIComponent(this.state.selectedPeriod || '') + '&metric=' + encodeURIComponent(m)); this.state.trends = t; return t; },
    loadMatching: async function() { const m = await api('/api/matching?period=' + encodeURIComponent(this.state.selectedPeriod || '')); this.state.matching = m; return m; },
    loadHcpVehicleComparison: async function() { const c = await api('/api/hcp/vehicle-comparison'); this.state.hcpVehicleComparison = c; return c; },
    loadHcpConnectivity: async function(compoundId) { const r = await api('/api/hcp/compounds/' + encodeURIComponent(compoundId) + '/connectivity'); this.state.hcpConnectivity = r; return r; },
    loadHcpHistory: async function(compoundId) { const r = await api('/api/hcp/compounds/' + encodeURIComponent(compoundId) + '/history'); this.state.hcpHistory = r; return r; },
    loadHcpRun: async function(runId) { const r = await api('/api/hcp/runs/' + encodeURIComponent(runId)); this.state.hcpRun = r; return r; },
    runHcpDiagnostics: async function(compoundId) {
      const r = await api('/api/hcp/compounds/' + encodeURIComponent(compoundId) + '/test', { method: 'POST', body: JSON.stringify({ kind: 'connection' }) });
      return r;
    },
    syncHcpCompound: async function(compoundId) { const r = await api('/api/hcp/compounds/' + encodeURIComponent(compoundId) + '/sync', { method: 'POST', body: JSON.stringify({}) }); return r; },
    loadHcpLiveEventsForCompound: async function(compoundId, category, page, limit) { category = category || 'events'; const qs = []; if (page) qs.push('page=' + encodeURIComponent(page)); if (limit) qs.push('limit=' + encodeURIComponent(limit)); const q = qs.length ? ('?' + qs.join('&')) : ''; const r = await api('/api/hcp/compounds/' + encodeURIComponent(compoundId) + '/live/' + encodeURIComponent(category) + q); this.state.hcpLiveEvents = r; return r; },
    loadHcpLiveHeatmap: async function(compoundId) { const r = await api('/api/hcp/compounds/' + encodeURIComponent(compoundId) + '/live-heatmap'); return r; },
    loadHcpLiveHourly: async function(compoundId) { const r = await api('/api/hcp/compounds/' + encodeURIComponent(compoundId) + '/live-hourly'); return r; },
    hcpGateOpen: async function(compoundId) {
      // Use cached state for fast rendering (no blocking). Run a fresh check in
      // the background; re-render the current HCP page when it completes so the
      // status reflects the latest VPN/network state.
      let conn = null;
      try { conn = await this.loadHcpConnectivity(compoundId); } catch (e) { conn = null; }
      const state = conn && conn.state ? conn.state : {};
      const connOk = (state.conn_state === 'up' || state.vpn_state === 'up');
      const gate = conn && conn.gate ? conn.gate : 'blocked';
      const result = { open: connOk && gate === 'open', conn: conn, gate: gate };
      // Background refresh (non-blocking): update state and re-render when done.
      if (!this._hcpCheckInFlight) {
        this._hcpCheckInFlight = true;
        this.checkHcpConnection(compoundId, { silent: true }).then(() => {
          return this.loadHcpConnectivity(compoundId);
        }).then((fresh) => {
          const freshState = fresh && fresh.state ? fresh.state : {};
          const freshOk = (freshState.conn_state === 'up' || freshState.vpn_state === 'up');
          const freshGate = fresh && fresh.gate ? fresh.gate : 'blocked';
          if (freshOk !== connOk || freshGate !== gate) {
            // State changed — re-render if on an HCP page.
            const route = this.state.currentRoute;
            if (route === 'vehicle-access' || route === 'hcp-live' || route === 'hcp-connectivity') {
              this.mountPage();
            }
          }
        }).catch(() => {}).finally(() => { this._hcpCheckInFlight = false; });
      }
      return result;
    },
    syncAllHcpCompounds: async function() {
      this.showToast('Syncing all connected compounds from HCP…');
      let comps = [];
      try { comps = await this.loadHcpCompounds(); } catch (e) { comps = []; }
      let synced = 0, skipped = 0, failed = 0;
      for (const c of (comps || [])) {
        try {
          const gate = await this.hcpGateOpen(c.id);
          if (!gate.open) { skipped++; continue; }
          await this.syncHcpCompound(c.id);
          synced++;
        } catch (e) { failed++; }
      }
      this.showToast('HCP sync complete: ' + synced + ' synced, ' + skipped + ' skipped (not connected), ' + failed + ' failed.');
      return { synced, skipped, failed };
    },
    loadHcpCompounds: async function() { const r = await api('/api/hcp/compounds'); this.state.hcpCompounds = r; return r; },
    loadHcpCompound: async function(compoundId) { const r = await api('/api/hcp/compounds/' + encodeURIComponent(compoundId)); this.state.hcpCompound = r; return r; },
    saveHcpCompound: async function(compoundId, body) { const r = await api('/api/hcp/compounds/' + encodeURIComponent(compoundId), { method: 'PUT', body: JSON.stringify(body || {}) }); return r; },
    openHcpEditDrawer: function(compoundId) {
      const detail = (this.state.hcpCompound && this.state.hcpCompound.compound && this.state.hcpCompound.compound.id === Number(compoundId)) ? this.state.hcpCompound : null;
      const hcp = (detail && detail.hcp) || {};
      const cred = (detail && detail.cred) || {};
      const integ = (detail && detail.integ) || {};
      const net = (detail && detail.net) || {};
      const compound = (detail && detail.compound) || {};
      const v = (x, fb) => (x === null || x === undefined || x === '' ? (fb || '') : x);
      const html = `
        <form id="hcp-edit-form" onsubmit="return PalmApp.submitHcpEdit(event, ${Number(compoundId)})" style="display:flex; flex-direction:column; gap:16px;">
          <h3 class="headline-sm" style="margin-bottom:4px;">Edit HCP configuration</h3>
          <p class="body-sm" style="color:var(--secondary);">Writes through PUT /api/hcp/compounds/${Number(compoundId)}. Secret fields: leave blank to keep the stored value.</p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div><label class="label-md">Compound name</label><input id="hcp-name" class="form-control-input" style="width:100%;" value="${pEsc(compound.name || '')}" /></div>
            <div><label class="label-md">Config status</label><select id="hcp-configStatus" class="form-control-select" style="width:100%;"><option value="draft" ${integ.config_status === 'draft' ? 'selected' : ''}>draft</option><option value="ready" ${integ.config_status === 'ready' ? 'selected' : ''}>ready</option></select></div>
            <div><label class="label-md">Integration mode</label><select id="hcp-integrationMode" class="form-control-select" style="width:100%;"><option value="corporate-vpn" ${integ.integration_mode === 'corporate-vpn' ? 'selected' : ''}>corporate-vpn</option><option value="direct" ${integ.integration_mode === 'direct' ? 'selected' : ''}>direct</option></select></div>
            <div><label class="label-md">Integration enabled</label><input id="hcp-enabled" type="checkbox" ${integ.integration_enabled ? 'checked' : ''} /></div>
          </div>
          <h4 class="title-md" style="margin-top:8px;">HCP server</h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div><label class="label-md">HCP host</label><input id="hcp-host" class="form-control-input" style="width:100%;" value="${pEsc(v(hcp.hcp_host))}" placeholder="internal HCP hostname or IP" /></div>
            <div><label class="label-md">Port</label><input id="hcp-port" class="form-control-input" style="width:100%;" type="number" value="${pEsc(v(hcp.hcp_port, 443))}" /></div>
            <div><label class="label-md">HTTPS</label><input id="hcp-https" type="checkbox" ${hcp.https !== 0 ? 'checked' : ''} /></div>
            <div><label class="label-md">TLS verification</label><input id="hcp-tlsVerify" type="checkbox" ${hcp.tls_verify !== 0 ? 'checked' : ''} /></div>
            <div><label class="label-md">HCP version</label><input id="hcp-hcpVersion" class="form-control-input" style="width:100%;" value="${pEsc(v(hcp.hcp_version))}" placeholder="e.g. 2.6.0" /></div>
            <div><label class="label-md">OpenAPI version</label><input id="hcp-openapiVersion" class="form-control-input" style="width:100%;" value="${pEsc(v(hcp.openapi_version))}" placeholder="e.g. 2.6" /></div>
            <div><label class="label-md">Base URL (optional)</label><input id="hcp-baseUrl" class="form-control-input" style="width:100%;" value="${pEsc(v(hcp.base_url))}" /></div>
            <div><label class="label-md">Read timeout (ms)</label><input id="hcp-readTimeout" class="form-control-input" style="width:100%;" type="number" value="${pEsc(v(hcp.read_timeout_ms, 15000))}" /></div>
            <div style="grid-column:1 / -1;"><label class="label-md">Custom CA (PEM)</label><textarea id="hcp-tlsCa" class="form-control-input" style="width:100%; min-height:80px; font-family:var(--font-mono); font-size:11px;">${pEsc(v(hcp.tls_ca))}</textarea></div>
            <div style="grid-column:1 / -1;"><label class="label-md">Camera index code(s)</label><input id="hcp-cameras" class="form-control-input" style="width:100%;" value="${pEsc(v(hcp.camera_index_codes || hcp.camera_index_code))}" placeholder="comma-separated" /></div>
            <div><label class="label-md">Vehicle group index codes</label><input id="hcp-vehicleGroups" class="form-control-input" style="width:100%;" value="${pEsc(v(hcp.vehicle_group_index_codes))}" placeholder="comma-separated" /></div>
            <div><label class="label-md">Parking lot index codes</label><input id="hcp-parkingLots" class="form-control-input" style="width:100%;" value="${pEsc(v(hcp.parking_lot_index_codes))}" placeholder="comma-separated" /></div>
          </div>
          <h4 class="title-md" style="margin-top:8px;">Credentials (blank keeps existing)</h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div><label class="label-md">App key</label><input id="hcp-appKey" class="form-control-input" style="width:100%;" value="${pEsc(v(cred.app_key))}" /></div>
            <div><label class="label-md">App secret</label><input id="hcp-appSecret" class="form-control-input" style="width:100%;" type="password" placeholder="leave blank to keep" /></div>
          </div>
          <h4 class="title-md" style="margin-top:8px;">Network / VPN</h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div><label class="label-md">VPN host</label><input id="hcp-vpnHost" class="form-control-input" style="width:100%;" value="${pEsc(v(net.vpn_host))}" /></div>
            <div><label class="label-md">VPN port</label><input id="hcp-vpnPort" class="form-control-input" style="width:100%;" type="number" value="${pEsc(v(net.vpn_port))}" /></div>
            <div><label class="label-md">VPN protocol</label><input id="hcp-vpnProtocol" class="form-control-input" style="width:100%;" value="${pEsc(v(net.vpn_protocol, 'corporate-vpn'))}" /></div>
            <div><label class="label-md">VPN username</label><input id="hcp-vpnUsername" class="form-control-input" style="width:100%;" value="${pEsc(v(net.vpn_username))}" /></div>
            <div><label class="label-md">VPN password</label><input id="hcp-vpnPassword" class="form-control-input" style="width:100%;" type="password" placeholder="leave blank to keep" /></div>
            <div><label class="label-md">Conn timeout (ms)</label><input id="hcp-connTimeout" class="form-control-input" style="width:100%;" type="number" value="${pEsc(v(net.conn_timeout_ms, 8000))}" /></div>
          </div>
          <div><label class="label-md">Notes</label><textarea id="hcp-notes" class="form-control-input" style="width:100%; min-height:60px;">${pEsc(v(integ.notes))}</textarea></div>
          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:8px;">
            <button type="button" class="btn-ghost" onclick="PalmApp.closeDrawer()">Cancel</button>
            <button type="submit" class="btn-primary">Save configuration</button>
          </div>
        </form>
      `;
      this.openDrawer('Edit compound connectivity', html);
    },
    submitHcpEdit: async function(event, compoundId) {
      if (event) { event.preventDefault(); }
      const g = (id) => document.getElementById(id);
      const val = (id) => { const e = g(id); return e ? (e.value || '').trim() : ''; };
      const chk = (id) => { const e = g(id); return !!(e && e.checked); };
      const num = (id) => { const v = val(id); return v === '' ? null : Number(v); };
      const body = {
        name: val('hcp-name') || undefined,
        enabled: chk('hcp-enabled'),
        integrationMode: val('hcp-integrationMode'),
        configStatus: val('hcp-configStatus'),
        notes: val('hcp-notes'),
        network: {
          vpnHost: val('hcp-vpnHost') || null,
          vpnPort: num('hcp-vpnPort'),
          vpnProtocol: val('hcp-vpnProtocol') || 'corporate-vpn',
          vpnUsername: val('hcp-vpnUsername') || null,
          vpnPassword: val('hcp-vpnPassword') || undefined,
          connTimeoutMs: num('hcp-connTimeout') || 8000,
        },
        hcp: {
          hcp_host: val('hcp-host') || null,
          hcp_port: num('hcp-port'),
          https: chk('hcp-https') ? 1 : 0,
          hcp_version: val('hcp-hcpVersion') || null,
          openapi_version: val('hcp-openapiVersion') || null,
          tls_verify: chk('hcp-tlsVerify') ? 1 : 0,
          tls_ca: val('hcp-tlsCa') || null,
          base_url: val('hcp-baseUrl') || null,
          read_timeout_ms: num('hcp-readTimeout'),
          camera_index_code: (val('hcp-cameras').split(',')[0] || '').trim() || null,
          camera_index_codes: val('hcp-cameras') || null,
          vehicle_group_index_codes: val('hcp-vehicleGroups') || null,
          parking_lot_index_codes: val('hcp-parkingLots') || null,
        },
        creds: {
          appKey: val('hcp-appKey') || null,
          appSecret: val('hcp-appSecret') || undefined,
        },
      };
      if (body.creds.appSecret === undefined) delete body.creds.appSecret;
      if (body.network.vpnPassword === undefined) delete body.network.vpnPassword;
      try {
        await this.saveHcpCompound(compoundId, body);
        this.showToast('Configuration saved.');
        this.closeDrawer();
        try { this.state.hcpCompound = await this.loadHcpCompound(compoundId); } catch (_) {}
        try { this.state.hcpConnectivity = await this.loadHcpConnectivity(compoundId); } catch (_) {}
        this.navigate('hcp-connectivity', true);
      } catch (e) {
        this.showToast('Save failed: ' + (e && e.message ? e.message : e));
      }
    },

    loadHcpRegistry: async function() { const r = await api('/api/hcp/registry'); this.state.hcpRegistry = r; return r; },
    checkHcpConnection: async function(compoundId, opts) {
      opts = opts || {};
      if (!opts.silent) this.showToast('Running the observed connectivity check…');
      try {
        const r = await api('/api/hcp/compounds/' + encodeURIComponent(compoundId) + '/check', { method: 'POST', body: '{}' });
        this.showToast('Connectivity check recorded: ' + (r && r.state ? r.state : 'unknown'));
      } catch (e) {
        if (!e || e.status !== 401) this.showToast('Connectivity check failed: ' + (e && e.message ? e.message : e));
      }
      await this.mountPage();
    },
    loadHcpLiveEvents: async function(limit) { const r = await api('/api/access?period=' + encodeURIComponent(this.state.selectedPeriod || '') + '&limit=' + (limit || 15)); this.state.access = r; return r; },
    loadAiAsk: async function(question) { const r = await api('/api/ai/ask', { method: 'POST', body: JSON.stringify({ question, periodKey: this.state.selectedPeriod }) }); return r; },

    // ---- Paged lists -----------------------------------------------------
    // Lists are loaded one page at a time and accumulated in memory. A changed
    // filter produces a new signature, which resets the accumulation instead of
    // mixing rows from two different queries.
    buildQuery: function(params) {
      const q = params || {};
      return Object.keys(q).filter(k => q[k] !== undefined && q[k] !== null && q[k] !== '')
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
    },
    loadPagedList: async function(key, path, params) {
      const sig = JSON.stringify(params || {});
      const existing = (this.state.paging && this.state.paging[key]) || null;
      if (existing && existing.signature === sig) return existing;
      const q = this.buildQuery(Object.assign({ page: 1, limit: 50 }, params));
      const r = await api(path + (q ? '?' + q : ''));
      const st = {
        signature: sig,
        path: path,
        params: params || {},
        page: r.page || 1,
        limit: r.limit || 50,
        rows: Array.isArray(r.rows) ? r.rows : [],
        total: r.total != null ? r.total : (Array.isArray(r.rows) ? r.rows.length : 0),
      };
      this.state.paging[key] = st;
      return st;
    },
    loadMoreList: async function(key) {
      const cur = (this.state.paging && this.state.paging[key]) || null;
      if (!cur) return null;
      if (cur.rows.length >= cur.total) return cur;
      const q = this.buildQuery(Object.assign({ page: cur.page + 1, limit: cur.limit }, cur.params));
      const r = await api(cur.path + (q ? '?' + q : ''));
      const merged = {
        ...cur,
        page: r.page || cur.page + 1,
        limit: r.limit || cur.limit,
        rows: cur.rows.concat(Array.isArray(r.rows) ? r.rows : []),
        total: r.total != null ? r.total : cur.total,
      };
      this.state.paging[key] = merged;
      return merged;
    },
    loadMoreListUI: async function(key) {
      const cur = (this.state.paging && this.state.paging[key]) || null;
      if (!cur) return;
      try {
        await this.loadMoreList(key);
        await this.mountPage();
      } catch (e) {
        if (!e || e.status !== 401) this.showToast('Could not load more rows: ' + (e && e.message ? e.message : e));
      }
    },
    pagerHtml: function(key) {
      const st = (this.state.paging && this.state.paging[key]) || null;
      if (!st || !st.total) return '';
      const showing = st.rows.length;
      const more = showing < st.total;
      return `<div style="padding:12px 20px; border-top:1px solid var(--hairline-divider); display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <span class="body-sm" style="color:var(--secondary);">Showing ${showing.toLocaleString('en-US')} of ${st.total.toLocaleString('en-US')} records</span>
        ${more
          ? `<button class="btn-secondary" onclick="PalmApp.loadMoreListUI('${key}')">Load more</button>`
          : `<span class="body-sm" style="color:var(--secondary);">End of results</span>`}
      </div>`;
    },

    askAiFromInput: function() {
      const el = document.getElementById('ai-question');
      const q = el && el.value ? String(el.value).trim() : '';
      if (!q) { this.showToast('Type a question first.'); return; }
      return this.askAi(q);
    },
    askAi: async function(question) {
      const q = question || 'Summarize the current portfolio operational posture.';
      this.state.aiChat = [
        { from: 'user', text: q, ts: Date.now() },
        { from: 'ai', text: 'Consulting executive intelligence…', ts: Date.now(), loading: true }
      ];
      await this.mountPage();
      try {
        const r = await this.loadAiAsk(q);
        this.state.aiChat = [
          { from: 'user', text: q, ts: Date.now() },
          { from: 'ai', text: r.answer, ts: Date.now(), table: r.table }
        ];
      } catch (e) {
        this.state.aiChat = [
          { from: 'user', text: q, ts: Date.now() },
          { from: 'ai', text: 'The analyst could not answer: ' + (e && e.message ? e.message : e), ts: Date.now() }
        ];
      }
      await this.mountPage();
    },

    exportReport: async function() {
      const period = this.state.selectedPeriod || '';
      const compound = this.state.selectedCompound || 'all';
      this.showToast('Generating the executive workbook (XLSX)…');
      try {
        const out = await this.downloadFile(
          '/api/report.xlsx?period=' + encodeURIComponent(period) + '&compound=' + encodeURIComponent(compound),
          'palm-hills-executive-' + (period || 'latest') + '.xlsx'
        );
        this.showToast('Downloaded ' + out.name + (out.truncated ? ' (row cap reached)' : '') + '.');
      } catch (e) {
        if (!e || e.status !== 401) this.showToast('Report generation failed: ' + (e && e.message ? e.message : e));
      }
    },

    exportEntity: async function(entity, params) {
      const q = Object.assign({ entity: entity, scope: 'all' }, params || {});
      const query = Object.keys(q).filter(k => q[k] !== undefined && q[k] !== null && q[k] !== '')
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
      this.showToast('Preparing ' + entity + ' export…');
      try {
        const out = await this.downloadFile('/api/export?' + query, entity + '-export.xlsx');
        const count = out.rowCount == null ? '' : ' (' + out.rowCount.toLocaleString('en-US') + ' rows)';
        this.showToast('Downloaded ' + out.name + count + (out.truncated ? ' — capped for memory safety' : '') + '.');
      } catch (e) {
        if (!e || e.status !== 401) this.showToast('Export failed: ' + (e && e.message ? e.message : e));
      }
    },

    openResident: async function(userId) { return this.openResidentPage(userId); },

    // ---- Entity detail navigation (Unit <-> User <-> Vehicle <-> HCP) ----
    openEntity: function(kind, id) {
      const routes = { unit: 'unit-detail', resident: 'resident-detail', vehicle: 'vehicle-detail' };
      const route = routes[kind];
      if (!route || id == null || id === '') return;
      this.state.detailId = String(id);
      this.state.currentRoute = route;
      const target = '#/' + route + '?id=' + encodeURIComponent(String(id));
      if (window.location.hash !== target) {
        window.location.hash = target;
        return;
      }
      this.render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    openUnit: function(id) { return this.openEntity('unit', id); },
    openResidentPage: function(id) { return this.openEntity('resident', id); },
    openVehicle: function(id) { return this.openEntity('vehicle', id); },
    loadUnitDetail: async function(id) { const r = await api('/api/units/' + encodeURIComponent(id)); this.state.unitDetail = r; return r; },
    loadResidentDetail: async function(id) { const r = await api('/api/users/' + encodeURIComponent(id)); this.state.residentDetail = r; return r; },
    loadVehicleDetail: async function(id) { const r = await api('/api/vehicles/' + encodeURIComponent(id)); this.state.vehicleDetail = r; return r; },

    openResidentDrawer: async function(userId) {
      this.openDrawer('Resident record', '<div class="body-sm" style="color:var(--secondary);">Loading resident record…</div>');
    },

    openAccessEvent: function(index) {
      const st = (this.state.paging && this.state.paging.access) || null;
      const r = st && st.rows ? st.rows[Number(index)] : null;
      if (!r) return;
      const canResident = this.can('resident.detail');
      const ownerHtml = (r.owner_user_id && canResident)
        ? `<a href="#/resident-detail?id=${Number(r.owner_user_id)}">${esc(r.owner_matched || r.owner_raw || ('User #' + r.owner_user_id))}</a>`
        : esc(r.owner_matched || r.owner_raw || '—');
      const row = (label, value) => `<div style="display:flex; justify-content:space-between; gap:16px; padding:8px 0; border-bottom:1px solid var(--hairline-divider);"><span class="label-caps" style="color:var(--secondary);">${esc(label)}</span><span class="font-mono" style="text-align:right;">${esc(value == null || value === '' ? '—' : value)}</span></div>`;
      this.openDrawer('HCP event #' + r.id, `
        <div>
          ${row('Plate', r.plate)}
          ${row('Owner (HCP / CRM)', ownerHtml)}
          ${row('Compound', r.compound)}
          ${row('Gate', r.gate)}
          ${row('Direction', r.direction)}
          ${row('Enter', r.enter_time)}
          ${row('Exit', r.exit_time)}
          ${row('Method', r.method)}
          ${row('Result', r.result)}
          ${row('Reason', r.reason)}
        </div>
        <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">
          <button class="btn-secondary" onclick="PalmApp.closeDrawer(); PalmApp.goVehicleByPlate(${JSON.stringify(String(r.plate || ''))})">Find vehicle by plate</button>
          <button class="btn-ghost" onclick="PalmApp.closeDrawer(); PalmApp.navigate('vehicle-access')">Back to list</button>
        </div>
      `);
    },
    goVehicleByPlate: function(plate) {
      this.state.vehiclesFilter = plate || '';
      this.navigate('vehicles', true);
    },
    searchResident: function(name) {
      this.state.residentsFilter = name || '';
      this.navigate('residents', true);
    },
    searchUnit: function(text) {
      this.state.unitsSearch = text || '';
      this.navigate('units', true);
    },

    selectCompound: function(name) { this.state.selectedCompound = name || 'all'; this.navigate(this.state.currentRoute, false); },    selectPeriod: function(key) { this.state.selectedPeriod = key; this.navigate(this.state.currentRoute, false); },
    setAccessFilter: function(key, value) { this.state.accessFilters[key] = value || 'all'; this.navigate('vehicle-access', true); },
    setAccessPlate: function(value) { this.state.accessPlate = value || ''; this.navigate('vehicle-access', true); },
    setAccessFrom: function(value) { this.state.accessFrom = value || ''; this.navigate('vehicle-access', true); },
    setAccessTo: function(value) { this.state.accessTo = value || ''; this.navigate('vehicle-access', true); },
    setAccessHour: function(value) { this.state.accessHour = value || ''; this.navigate('vehicle-access', true); },
    toggleAccessSort: function() { this.state.accessSortDir = (this.state.accessSortDir === 'asc') ? 'desc' : 'asc'; this.navigate('vehicle-access', true); },
    setAccessDateHour: function(day, hour) {
      this.state.accessFrom = day || '';
      this.state.accessTo = day || '';
      this.state.accessHour = (hour == null ? '' : String(hour).padStart(2, '0'));
      this.navigate('vehicle-access', true);
    },
    applyAccessFilters: function() { this.navigate('vehicle-access', true); },
    resetAccessFilters: function() {
      this.state.accessFilters = { direction: 'all', result: 'all', gate: 'all' };
      this.state.accessPlate = '';
      this.state.accessFrom = '';
      this.state.accessTo = '';
      this.state.accessHour = '';
      this.navigate('vehicle-access', true);
    },
    accessListParams: function() {
      const af = this.state.accessFilters || { direction: 'all', result: 'all', gate: 'all' };
      const plate = this.state.accessPlate || '';
      const from = this.state.accessFrom || '';
      const to = this.state.accessTo || '';
      const hour = this.state.accessHour || '';
      const params = { period: this.state.selectedPeriod, compound: this.state.selectedCompound, direction: af.direction, result: af.result, gate: af.gate, search: plate || undefined, from: from || undefined, to: to || undefined, hour: hour || undefined };
      return params;
    },
    setAccessPageSize: async function(n) { await this.loadPagedList('access', '/api/access', Object.assign({ page: 1, limit: Number(n) }, this.accessListParams())); await this.mountPage(); },
    gotoAccessPrev: async function() { const st = (this.state.paging && this.state.paging.access) || null; if (!st || (st.page || 1) <= 1) return; await this.loadPagedList('access', '/api/access', Object.assign({ page: (st.page || 1) - 1 }, this.accessListParams())); await this.mountPage(); },
    gotoAccessNext: async function() { const st = (this.state.paging && this.state.paging.access) || null; if (!st) return; if ((st.rows || []).length >= (st.total || 0)) return; await this.loadPagedList('access', '/api/access', Object.assign({ page: (st.page || 1) + 1 }, this.accessListParams())); await this.mountPage(); },
    setResidentsFilter: function(value) { this.state.residentsFilter = value || ''; this.navigate('residents', false); },
    setResidentsStatus: function(value) { this.state.residentsStatus = value || 'all'; this.navigate('residents', false); },
    setResidentsType: function(value) { this.state.residentsType = value || 'all'; this.navigate('residents', false); },
    setResidentsGender: function(value) { this.state.residentsGender = value || 'all'; this.navigate('residents', false); },
    setResidentsMaritalStatus: function(value) { this.state.residentsMaritalStatus = value || 'all'; this.navigate('residents', false); },
    toggleResidentsFilters: function() { this.state.residentsFiltersOpen = !this.state.residentsFiltersOpen; this.navigate('residents', false); },
    setUnitsSearch: function(value) { this.state.unitsSearch = value || ''; this.navigate('units', false); },
    setUnitsPreset: function(value) { this.state.unitsPreset = value || 'all'; this.navigate('units', false); },
    sortHeader: function(listKey, columnKey, label) {
      const cur = (listKey === 'residents' ? this.state.residentsSort : this.state.unitsSort) || {};
      const isActive = cur.key === columnKey;
      const arrow = isActive ? (cur.dir === 'desc' ? ' ▼' : ' ▲') : '';
      const handler = listKey === 'residents' ? 'PalmApp.toggleResidentsSort' : 'PalmApp.toggleUnitsSort';
      return `<th style="cursor:pointer; user-select:none;" onclick="${handler}('${columnKey}')" title="Sort by ${esc(label)}">${esc(label)}${arrow}</th>`;
    },
    toggleResidentsSort: function(key) {
      const cur = this.state.residentsSort || { key: 'name', dir: 'asc' };
      const dir = cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : 'asc';
      this.state.residentsSort = { key: key, dir: dir };
      this.navigate('residents', false);
    },
    toggleUnitsSort: function(key) {
      const cur = this.state.unitsSort || { key: 'unit_number', dir: 'asc' };
      const dir = cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : 'asc';
      this.state.unitsSort = { key: key, dir: dir };
      this.navigate('units', false);
    },
    setVehiclesFilter: function(value) { this.state.vehiclesFilter = value || ''; this.navigate('vehicles', false); },

    // ---- Monthly imports upload UI ----
    pickImportFile: function() {
      const el = document.getElementById('import-file-input');
      if (el) el.click();
    },
    dragOverImport: function(ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      const dz = document.getElementById('import-dropzone');
      if (dz) { dz.style.borderColor = 'var(--primary-container)'; dz.style.background = 'var(--surface-container-low)'; }
    },
    dragLeaveImport: function(ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      const dz = document.getElementById('import-dropzone');
      if (dz) { dz.style.borderColor = 'var(--hairline-divider)'; dz.style.background = 'transparent'; }
    },
    dropImportFile: function(ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      this.dragLeaveImport();
      const f = ev && ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) this.uploadChosenFile(f);
    },
    handleImportFile: function(input) {
      const f = input && input.files && input.files[0];
      if (input) input.value = '';
      if (f) this.uploadChosenFile(f);
    },
    setImportStatus: function(message, pct, tone) {
      const wrapEl = document.getElementById('import-upload-progress');
      const statusEl = document.getElementById('import-upload-status');
      const barEl = document.getElementById('import-upload-bar');
      if (wrapEl) wrapEl.style.display = 'block';
      const colors = {
        error: 'var(--status-critical)',
        ok: 'var(--status-active)',
        warn: 'var(--status-warning)',
        busy: 'var(--secondary)'
      };
      if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.color = colors[tone] || 'var(--secondary)';
      }
      if (barEl) {
        barEl.style.width = Math.max(0, Math.min(100, Math.round((pct != null ? pct : 0) * 100))) + '%';
        barEl.style.background = (tone === 'error' || tone === 'warn' || tone === 'ok') ? colors[tone] : 'var(--primary-container)';
      }
    },
    defaultImportPeriod: function() {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - 1);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    },
    uploadChosenFile: async function(file) {
      const name = (file && file.name) || 'dataset';
      if (!/\.(zip|xlsx|xls|csv)$/i.test(name)) {
        this.setImportStatus('Unsupported file type: ' + name + ' — use .zip, .xlsx, .xls or .csv.', 0, 'error');
        this.showToast('Unsupported file type: ' + name);
        return;
      }
      this.state.importBusy = true;
      this.setImportStatus('Uploading ' + name + ' … 0%', 0.01, 'busy');
      try {
        const res = await this.uploadDataset(file, p => this.setImportStatus('Uploading ' + name + ' … ' + Math.round(p * 100) + '%', p, 'busy'));
        const detected = (res && res.detected) || {};
        const periodKey = detected.periodKey || detected.period_key || null;
        const fileCount = (res && res.files && res.files.length) || 0;
        const importId = res && res.importId;
        this.state.importBusy = false;
        if (!periodKey) {
          // CRM-only exports carry no HCP event timestamps, so the month cannot be
          // inferred safely. Never guess — ask the operator to confirm below.
          this.state.pendingImportId = importId;
          this.setImportStatus('Uploaded as import #' + importId + ' (' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + '). Reporting month could not be detected — confirm it below and click Process.', 1, 'warn');
          this.showToast('Upload staged as import #' + importId + '. Confirm the reporting month below.');
          await this.mountPage();
          return;
        }
        this.setImportStatus('Uploaded: import #' + importId + ' (' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + ' detected, period ' + periodKey + '). Starting analysis…', 1, 'busy');
        this.showToast('Import #' + importId + ' uploaded — processing…');
        try {
          await this.processImport(importId, periodKey);
          this.setImportStatus('Import #' + importId + ' queued for processing. Its status appears in the registry below.', 1, 'ok');
          this.showToast('Processing import #' + importId + '…');
        } catch (pe) {
          this.setImportStatus('Uploaded as import #' + importId + ', but processing did not start: ' + (pe && pe.message ? pe.message : pe), 1, 'error');
          this.showToast('Uploaded, but processing did not start.');
        }
        await this.mountPage();
      } catch (e) {
        this.state.importBusy = false;
        const msg = e && e.message ? e.message : String(e);
        this.setImportStatus('Upload failed: ' + msg, 0, 'error');
        this.showToast('Upload failed: ' + msg);
      }
    },
    processStagedImport: async function(importId, periodKey) {
      const pk = periodKey || this.defaultImportPeriod();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(pk)) {
        this.showToast('Choose a valid reporting month (YYYY-MM).');
        return;
      }
      try {
        this.showToast('Starting import #' + importId + ' for ' + pk + '…');
        await this.processImport(importId, pk);
        this.state.pendingImportId = null;
        this.showToast('Import #' + importId + ' processing started for ' + pk + '.');
      } catch (e) {
        this.showToast('Could not start import #' + importId + ': ' + (e && e.message ? e.message : e));
      }
      await this.mountPage();
    },
    pickCrmFile: function() { const el = document.getElementById('crm-file-input'); if (el) el.click(); },
    pickHcpFile: function() { const el = document.getElementById('hcp-file-input'); if (el) el.click(); },
    setHcpCompound: function(value) { this.state.hcpCompoundId = value ? Number(value) : null; this.navigate('monthly-imports', false); },
    handleCrmFile: function(input) { const f = input && input.files && input.files[0]; if (input) input.value = ''; if (f) this.uploadChosenCrmFile(f); },
    handleHcpFile: function(input) { const f = input && input.files && input.files[0]; if (input) input.value = ''; if (f) this.uploadChosenHcpFile(f); },
    uploadChosenCrmFile: async function(file) {
      const name = (file && file.name) || 'dataset';
      if (!/\.(zip|xlsx|xls|csv)$/i.test(name)) { this.showToast('Unsupported file: ' + name); return; }
      this.state.importBusy = true;
      try {
        const res = await this.uploadDataset(file, null, '/api/crm-uploads');
        const fileCount = (res && res.files && res.files.length) || 0;
        const importId = res && res.importId;
        this.state.importBusy = false;
        this.state.pendingImportId = importId;
        this.showToast('CRM upload staged as import #' + importId + ' (' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + '). Confirm the month below.');
        await this.mountPage();
      } catch (e) {
        this.state.importBusy = false;
        this.showToast('CRM upload failed: ' + (e && e.message ? e.message : e));
      }
    },
    uploadChosenHcpFile: async function(file) {
      const name = (file && file.name) || 'dataset';
      const compoundId = Number(this.state.hcpCompoundId);
      if (!compoundId || !Number.isInteger(compoundId)) { this.showToast('Select a compound first (required).'); return; }
      if (!/\.(zip|xlsx|xls|csv)$/i.test(name)) { this.showToast('Unsupported file: ' + name); return; }
      this.state.importBusy = true;
      try {
        const res = await this.uploadDataset(file, null, '/api/hcp-uploads', { compoundId });
        const fileCount = (res && res.files && res.files.length) || 0;
        const importId = res && res.importId;
        this.state.importBusy = false;
        this.state.pendingImportId = importId;
        this.state.hcpPreview = null;
        this.showToast('HCP upload staged as import #' + importId + ' for compound #' + compoundId + '. Preview it below, then confirm.');
        await this.mountPage();
      } catch (e) {
        this.state.importBusy = false;
        this.showToast('HCP upload failed: ' + (e && e.message ? e.message : e));
      }
    },
    previewHcpImport: async function(importId) {
      try {
        await this.loadImportPreview(importId);
        await this.mountPage();
      } catch (e) {
        if (!e || e.status !== 401) this.showToast('Preview failed: ' + (e && e.message ? e.message : e));
      }
    },
    confirmHcpImport: async function(importId) {
      const detected = (this.state.hcpPreview && this.state.hcpPreview.import) || {};
      const pk = detected.detected_period_key || detected.reporting_period || this.defaultImportPeriod();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(pk)) { this.showToast('Choose a valid reporting month (YYYY-MM).'); return; }
      try {
        this.showToast('Confirming HCP import #' + importId + ' for ' + pk + '…');
        await this.processImport(importId, pk);
        this.state.pendingImportId = null;
        this.state.hcpPreview = null;
        this.showToast('HCP import #' + importId + ' processing started for ' + pk + '.');
      } catch (e) {
        this.showToast('Could not confirm: ' + (e && e.message ? e.message : e));
      }
      await this.mountPage();
    },
    renderScopeBar: async function() {
      // Ensure compounds and periods are loaded before rendering the scope bar
      if (!this.state.compounds || this.state.compounds.length === 0) {
        try { this.state.compounds = await api('/api/compounds'); } catch (e) { this.state.compounds = []; }
      }
      if (!this.state.periods || this.state.periods.length === 0) {
        try { this.state.periods = await api('/api/periods'); } catch (e) { this.state.periods = []; }
      }
      const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const compounds = this.state.compounds || [];
      const periods = this.state.periods || [];
      const selectedCompound = this.state.selectedCompound || 'all';
      const selectedPeriod = this.state.selectedPeriod || '';
      const periodMeta = periods.find(p => p.period_key === selectedPeriod) || periods[0] || null;
      const periodLabel = periodMeta ? (periodMeta.period_name || periodMeta.period_key) : (selectedPeriod || 'latest');
      const scopeAll = !!(this.state.scope && this.state.scope.all);
      const scopeLabel = selectedCompound === 'all'
        ? (scopeAll ? 'All developments' : (compounds.length === 1 ? compounds[0].name : 'All assigned communities'))
        : selectedCompound;
      const allLabel = scopeAll
        ? 'All Developments (' + compounds.length + ' compounds)'
        : 'All Assigned Communities (' + compounds.length + ')';
      return `
        <div class="exec-panel" style="padding:14px 18px; margin-bottom:20px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
          <span class="label-caps" style="color:var(--secondary); font-size:10px; letter-spacing:0.12em;">REPORTING SCOPE</span>
          <select class="form-control-select" onchange="PalmApp.selectCompound(this.value)">
            <option value="all" ${selectedCompound === 'all' ? 'selected' : ''}>${esc(allLabel)}</option>
            ${compounds.map(c => `<option value="${esc(c.name)}" ${selectedCompound === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <select class="form-control-select" onchange="PalmApp.selectPeriod(this.value)">
            ${periods.map(p => `<option value="${esc(p.period_key)}" ${selectedPeriod === p.period_key ? 'selected' : ''}>${esc(p.period_name || p.period_key)}</option>`).join('')}
          </select>
          <div class="body-sm" style="margin-left:auto; color:var(--secondary);">Scope: ${esc(scopeLabel)} &bull; Period: ${esc(periodLabel)}</div>
        </div>
      `;
    },
  };

  document.addEventListener('DOMContentLoaded', () => { window.PalmApp.init(); });
})();
