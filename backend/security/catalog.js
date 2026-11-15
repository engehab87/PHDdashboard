'use strict';
/* Central permission catalog and route authorization map.
   Single source of truth: roles, permissions, and the permission required by each route.
   No route handler may make an ad-hoc role decision. */

const ROLES = ['Top Management', 'Community Manager', 'Community Admin', 'Admin', 'Super Admin'];

const P = {
  PERIOD_VIEW: 'period.view',
  COMPOUND_VIEW: 'compound.view',
  KPI_VIEW: 'kpi.view',
  DASHBOARD_VIEW: 'dashboard.view',
  COMPARE_VIEW: 'compare.view',
  TREND_VIEW: 'trend.view',
  INSIGHT_VIEW: 'insight.view',
  SNAPSHOT_VIEW: 'snapshot.view',
  QUALITY_VIEW: 'quality.view',
  QUALITY_FULL: 'quality.full',
  UNIT_LIST: 'unit.list',
  UNIT_DETAIL: 'unit.detail',
  RESIDENT_LIST: 'resident.list',
  RESIDENT_DETAIL: 'resident.detail',
  RESIDENT_WRITE: 'resident.write',
  VEHICLE_LIST: 'vehicle.list',
  VEHICLE_DETAIL: 'vehicle.detail',
  VEHICLE_STATS: 'vehicle.stats',
  GATEPASS_LIST: 'gatepass.list',
  INVITATION_LIST: 'invitation.list',
  ACCESS_LIST: 'access.list',
  ACCESS_ANALYTICS: 'access.analytics',
  IDENTITY_VIEW: 'identity.view',
  IDENTITY_DECIDE: 'identity.decide',
  AI_USE: 'ai.use',
  EXPORT_DATA: 'export.data',
  EXPORT_SENSITIVE: 'export.sensitive',
  REPORT_EXECUTIVE: 'report.executive',
  IMPORT_VIEW: 'import.view',
  IMPORT_MANAGE: 'import.manage',
  IMPORT_ROLLBACK: 'import.rollback',
  PERIOD_DELETE: 'period.delete',
  SYSTEM_RESET: 'system.reset',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_BUSINESS: 'settings.business',
  SETTINGS_SYSTEM: 'settings.system',
  AUDIT_VIEW: 'audit.view',
  USER_MANAGE: 'user.manage',
  SCOPE_ALL: 'scope.all',
  PII_UNMASK: 'pii.unmask',
  PII_EXPORT: 'pii.export',
};

const ALL_PERMISSIONS = Object.freeze(Object.values(P).filter((v, i, a) => a.indexOf(v) === i));

const READ_ALL = [
  P.PERIOD_VIEW, P.COMPOUND_VIEW, P.KPI_VIEW, P.DASHBOARD_VIEW, P.COMPARE_VIEW,
  P.TREND_VIEW, P.INSIGHT_VIEW, P.SNAPSHOT_VIEW, P.QUALITY_VIEW,
];

const OPERATIONAL_READ = [
  P.UNIT_LIST, P.UNIT_DETAIL, P.RESIDENT_LIST, P.RESIDENT_DETAIL,
  P.VEHICLE_LIST, P.VEHICLE_DETAIL, P.VEHICLE_STATS,
  P.GATEPASS_LIST, P.INVITATION_LIST, P.ACCESS_LIST, P.ACCESS_ANALYTICS,
];

/* Role definitions. `scopeAll` is expressed as the scope.all permission. */
const ROLE_DEFINITIONS = {
  'Top Management': {
    description: 'Portfolio-wide executive oversight. Read-only, no resident-level PII.',
    permissions: [
      ...READ_ALL,
      P.UNIT_LIST, P.UNIT_DETAIL,
      P.VEHICLE_LIST, P.VEHICLE_DETAIL, P.VEHICLE_STATS,
      P.GATEPASS_LIST, P.INVITATION_LIST, P.ACCESS_LIST, P.ACCESS_ANALYTICS,
      P.AI_USE, P.EXPORT_DATA, P.REPORT_EXECUTIVE, P.SCOPE_ALL,
    ],
  },
  'Community Manager': {
    description: 'Runs operations for assigned communities.',
    permissions: [
      ...READ_ALL, ...OPERATIONAL_READ,
      P.RESIDENT_WRITE, P.IDENTITY_VIEW,
      P.AI_USE, P.EXPORT_DATA, P.REPORT_EXECUTIVE,
    ],
  },
  'Community Admin': {
    description: 'Administers assigned communities, imports, quality and identity.',
    permissions: [
      ...READ_ALL, ...OPERATIONAL_READ,
      P.QUALITY_FULL, P.RESIDENT_WRITE, P.IDENTITY_VIEW, P.IDENTITY_DECIDE,
      P.AI_USE, P.EXPORT_DATA, P.REPORT_EXECUTIVE,
      P.IMPORT_VIEW, P.IMPORT_MANAGE,
      P.SETTINGS_VIEW, P.SETTINGS_BUSINESS, P.AUDIT_VIEW,
    ],
  },
  'Admin': {
    description: 'Platform administration across the portfolio.',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => p !== P.SYSTEM_RESET && p !== P.SETTINGS_SYSTEM),
    ],
  },
  'Super Admin': {
    description: 'Root governance and recovery.',
    permissions: [...ALL_PERMISSIONS],
  },
};

/** @returns {Set<string>} */
function permissionsForRole(role) {
  const def = ROLE_DEFINITIONS[role];
  return new Set(def ? def.permissions : []);
}

function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_DEFINITIONS, role);
}

/* ------------------------------------------------------------------ *
 * Route authorization map.
 * Ordered: first match wins. Anything under /api not matched is denied.
 * `authOnly` means an authenticated user with any role is allowed.
 * `public` means no session required.
 * ------------------------------------------------------------------ */
const ROUTE_RULES = [
  { method: 'GET', re: /^\/api\/health\/?$/, public: true },
  { method: 'POST', re: /^\/api\/auth\/login\/?$/, public: true },
  { method: 'POST', re: /^\/api\/auth\/logout\/?$/, authOnly: true },
  { method: 'GET', re: /^\/api\/auth\/me\/?$/, authOnly: true },
  { method: 'GET', re: /^\/api\/auth\/users\/?$/, permission: P.USER_MANAGE },
  { method: 'POST', re: /^\/api\/auth\/users\/?$/, permission: P.USER_MANAGE },
  { method: 'PUT', re: /^\/api\/auth\/users\/[^/]+\/scopes\/?$/, permission: P.USER_MANAGE },
  { method: 'POST', re: /^\/api\/auth\/users\/[^/]+\/revoke-sessions\/?$/, permission: P.USER_MANAGE },
  { method: 'PUT', re: /^\/api\/auth\/users\/[^/]+\/?$/, permission: P.USER_MANAGE },

  { method: 'GET', re: /^\/api\/periods\/?$/, permission: P.PERIOD_VIEW },
  { method: 'GET', re: /^\/api\/compounds\/?$/, permission: P.COMPOUND_VIEW },
  { method: 'GET', re: /^\/api\/kpi-definitions\/?$/, permission: P.KPI_VIEW },
  { method: 'GET', re: /^\/api\/dashboard\/?$/, permission: P.DASHBOARD_VIEW },
  { method: 'GET', re: /^\/api\/compare\/?$/, permission: P.COMPARE_VIEW },

  { method: 'GET', re: /^\/api\/units\/[^/]+\/?$/, permission: P.UNIT_DETAIL },
  { method: 'GET', re: /^\/api\/units\/?$/, permission: P.UNIT_LIST },
  { method: 'GET', re: /^\/api\/users\/[^/]+\/?$/, permission: P.RESIDENT_DETAIL },
  { method: 'PUT', re: /^\/api\/users\/[^/]+\/image\/?$/, permission: P.RESIDENT_WRITE },
  { method: 'GET', re: /^\/api\/users\/?$/, permission: P.RESIDENT_LIST },

  { method: 'GET', re: /^\/api\/vehicles\/stats\/?$/, permission: P.VEHICLE_STATS },
  { method: 'GET', re: /^\/api\/vehicles\/[^/]+\/?$/, permission: P.VEHICLE_DETAIL },
  { method: 'GET', re: /^\/api\/vehicles\/?$/, permission: P.VEHICLE_LIST },

  { method: 'GET', re: /^\/api\/gatepasses\/?$/, permission: P.GATEPASS_LIST },
  { method: 'GET', re: /^\/api\/invitations\/?$/, permission: P.INVITATION_LIST },
  { method: 'GET', re: /^\/api\/access\/hourly\/?$/, permission: P.ACCESS_ANALYTICS },
  { method: 'GET', re: /^\/api\/access\/heatmap\/?$/, permission: P.ACCESS_ANALYTICS },
  { method: 'GET', re: /^\/api\/access\/?$/, permission: P.ACCESS_LIST },

  { method: 'GET', re: /^\/api\/trends\/?$/, permission: P.TREND_VIEW },
  { method: 'GET', re: /^\/api\/quality\/?$/, permission: P.QUALITY_VIEW },
  { method: 'GET', re: /^\/api\/matching\/?$/, permission: P.IDENTITY_VIEW },
  { method: 'POST', re: /^\/api\/matching\/?$/, permission: P.IDENTITY_DECIDE },
  { method: 'GET', re: /^\/api\/insights\/?$/, permission: P.INSIGHT_VIEW },
  { method: 'GET', re: /^\/api\/snapshots\/[^/]+\/?$/, permission: P.SNAPSHOT_VIEW },
  { method: 'GET', re: /^\/api\/snapshots\/?$/, permission: P.SNAPSHOT_VIEW },

  { method: 'POST', re: /^\/api\/ai\/ask\/?$/, permission: P.AI_USE },
  { method: 'GET', re: /^\/api\/export\/?$/, permission: P.EXPORT_DATA },
  { method: 'GET', re: /^\/api\/report\.xlsx\/?$/, permission: P.REPORT_EXECUTIVE },

  { method: 'POST', re: /^\/api\/uploads\/?$/, permission: P.IMPORT_MANAGE },
  { method: 'POST', re: /^\/api\/crm-uploads\/?$/, permission: P.IMPORT_MANAGE },
  { method: 'POST', re: /^\/api\/hcp-uploads\/?$/, permission: P.IMPORT_MANAGE },
  { method: 'GET', re: /^\/api\/imports\/[^/]+\/preview\/?$/, permission: P.IMPORT_VIEW },
  { method: 'GET', re: /^\/api\/imports\/[^/]+\/(summary|log|duplicates|changes)\/?$/, permission: P.IMPORT_VIEW },
  { method: 'GET', re: /^\/api\/imports\/[^/]+\/?$/, permission: P.IMPORT_VIEW },
  { method: 'GET', re: /^\/api\/imports\/?$/, permission: P.IMPORT_VIEW },
  { method: 'POST', re: /^\/api\/imports\/[^/]+\/(process|reprocess|cancel)\/?$/, permission: P.IMPORT_MANAGE },
  { method: 'POST', re: /^\/api\/imports\/[^/]+\/rollback\/?$/, permission: P.IMPORT_ROLLBACK },

  { method: 'POST', re: /^\/api\/periods\/[^/]+\/delete\/?$/, permission: P.PERIOD_DELETE },
  { method: 'POST', re: /^\/api\/admin\/reset\/?$/, permission: P.SYSTEM_RESET },

  { method: 'GET', re: /^\/api\/settings\/?$/, permission: P.SETTINGS_VIEW },
  { method: 'PUT', re: /^\/api\/settings\/?$/, permission: P.SETTINGS_BUSINESS },
  { method: 'GET', re: /^\/api\/audit\/?$/, permission: P.AUDIT_VIEW },

  // HCP administration is Phase 2; all of it is an administrative surface.
  { method: 'GET', re: /^\/api\/hcp(\/|$)/, permission: P.IMPORT_MANAGE },
  { method: 'POST', re: /^\/api\/hcp(\/|$)/, permission: P.IMPORT_MANAGE },
  { method: 'PUT', re: /^\/api\/hcp(\/|$)/, permission: P.IMPORT_MANAGE },
  { method: 'DELETE', re: /^\/api\/hcp(\/|$)/, permission: P.IMPORT_MANAGE },
];

function matchRoute(method, pathname) {
  for (const rule of ROUTE_RULES) {
    if (rule.method !== method) continue;
    if (rule.re.test(pathname)) return rule;
  }
  return null;
}

module.exports = {
  ROLES,
  P,
  ALL_PERMISSIONS,
  ROLE_DEFINITIONS,
  permissionsForRole,
  isValidRole,
  ROUTE_RULES,
  matchRoute,
};
