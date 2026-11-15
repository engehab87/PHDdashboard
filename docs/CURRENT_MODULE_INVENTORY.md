# Current Module Inventory

**Frontend:** `frontend/app-pages.js` page renderers, `frontend/app.js` shell/router.
**Evidence:** route keys at `app-pages.js:14-1015`; API calls at lines listed below.
**Status legend:** Verified (real data, exercised), Partial (real but incomplete/defective), Presentation-only (no persistence), Unavailable (honest no-source state).

| # | Route / module | Renderer | Data source | Status | Notes |
|---|---|---|---|---|---|
| 0 | `login` | `app-pages.js:14` | none | **Presentation-only** | Branded sign-in; sets a browser flag. No Entra, MSAL, password or token. |
| 1 | `overview` | `:98` | `/api/dashboard`, `/api/insights` | **Verified** | Real KPI ribbon, charts and warnings. Uses live KPI computation, not locked snapshots. |
| 2 | `vehicle-access` | `:246` | `/api/access` | **Verified** | Real HCP events, server filters, 50-row page. Plate/owner PII unmasked. |
| 3 | `gate-passes` | `:332` | `/api/gatepasses` | **Verified** | Real 100k-capped data, labeled as proxy. No explicit lower-bound banner in the list itself. |
| 4 | `hcp-connectivity` | `:373` | `/api/hcp/*` | **Verified (Phase 2)** | Real config, connectivity checks, VPN status. Publicly reachable. |
| 5 | `hcp-live` | `:434` | `/api/access` (limit 15) | **Partial** | Shows recent HCP events, not a true live stream; labeled as live. |
| 6 | `hcp-vehicle-counts` | `:472` | `/api/hcp/vehicle-comparison` | **Verified** | CRM vs HCP comparison. |
| 7 | `invitations` | `:505` | `/api/invitations` | **Verified** | Real invitations; no server-side compound scope. |
| 8 | `visitors` | `:539` | `/api/gatepasses` | **Partial** | Uses gate passes as visitor proxy; the list is explicitly labeled proxy in the page copy. |
| 9 | `face-recognition` | `:573` | `/api/periods` | **Unavailable (honest)** | States that HCP person-authentication data is missing; does not fabricate. Good. |
| 10 | `identity-matching` | `:589` | `/api/matching` | **Partial** | Reads candidates; decision persistence exists at `/api/matching` but is not clearly exposed in the UI. No actor/time/reason capture in the UI. |
| 11 | `portfolio-trends` | `:617` | `/api/trends` | **Partial** | Real series but only two periods/snapshots exist; UI does not show the proposal's single-period informational state clearly. |
| 12 | `data-quality` | `:647` | `/api/quality` | **Partial** | Real file/record checks and score; not the full nine-dimension engine with published weights. |
| 13 | `monthly-imports` | `:686` | `/api/uploads`, `/api/imports*` | **Verified** | Real upload, drag/drop, progress, registry, failure detail, month confirmation, retry. Fixed Nov 2026. |
| 14 | `ai-analyst` | `:767` | `/api/ai/ask` | **Partial** | Grounded local deterministic answer from computed KPIs; optional LLM verbalization if configured. No citations panel, no tool-trace, no numeric post-validation. |
| 15 | `reports` | `:848` | `/api/report.xlsx` | **Defective** | UI says "PDF" but generates XLSX. Only one report; no community operations report, quality audit, or snapshot archive. No permission/scope/PII controls. |
| 16 | `settings` | `:861` | none | **Presentation-only** | "Save Preferences" only shows a toast; no persistence, authorization or audit. Contains an unrelated Amazon S3 claim. |
| 17 | `kpi-definitions` | `:876` | `/api/kpi-definitions` | **Verified** | Real catalog: name, definition, formula, sources. No version number/owner. |
| 18 | `compound-comparison` | `:903` | `/api/compare` | **Verified** | Real rows; no export, sort or Unassigned reconciliation row. |
| 19 | `units` | `:936` | `/api/units` | **Partial** | Server paging exists but the page requests a default page and has no pager/sort UI; only first 50 rows reachable. Search is a simple LIKE. |
| 20 | `residents` | `:972` | `/api/users` | **Partial** | Same paging limitation; detail drawer is a placeholder string, not `/api/users/:id`. PII shown unmasked. |
| 21 | `vehicles` | `:1015` | `/api/vehicles`, `/api/vehicles/stats` | **Partial** | Same paging limitation; plates unmasked. |

## Shell and global controls

| Feature | Status | Evidence |
|---|---|---|
| Hash router | Verified | `app.js:90-134` |
| Sidebar navigation | Verified | `app.js:181-286` |
| Role/profile switch (3 profiles) | **Defective vs proposal** | `app.js:66-88,109-118`; modes conflated with roles |
| Management/Operations modes | **Not implemented as modes** | Buttons call `setRole`; no `mode` state |
| Compound selector | Verified (UI) | `renderScopeBar`; selection is sent to APIs, server does not validate it |
| Period selector | Verified (UI) | `loadPeriods`; periods 2026-09 and 2026-10 |
| Global search | **Partial** | Header search exists; results are not backed by a dedicated cross-entity API |
| Notifications | **Presentation-only** | Bell with static dot; no notification service |
| Light/dark theme | Verified | `toggleTheme`, persisted? (not verified) |
| Responsive layout | Partial | CSS breakpoints exist; not accessibility-verified |
| Accessibility (WCAG 2.1 AA) | **Not verified** | No axe run, no keyboard/focus audit |
| Loading/empty/error states | Partial | Some try/catch fallbacks; no consistent stale/partial states |
| Record detail drawers | Partial | Units/vehicles render real detail; residents placeholder |
| Exports | Partial | Real XLSX; synchronous; no PII masking, scope enforcement or export audit actor |
| AI copilot | Partial | Real computed answers; no provider guarantee, citations or validation |

## Dead / duplicate frontend assets

| File | Issue |
|---|---|
| `frontend/app_pages.js` | Legacy copy, not loaded by `index.html`; contains an older `monthly-imports` mock. |
| `frontend/style.css` | Secondary stylesheet; possible duplication with `styles.css`. |
| `frontend/stitch_palm_hills_executive_dashboard_redesign (2).zip` | Design artifact checked into the web root; should be removed from deployment. |
| Root `stitch-*` / `stitch_*` directories | Design artifacts, not part of the app. |

## Module-level gaps that block Phase 1 acceptance

1. Login is not real; no server session.
2. Roles/modes are conflated and client-side only.
3. Operational lists cannot page beyond the first 50 rows in the UI.
4. Resident detail is a placeholder.
5. Reports are mislabeled and incomplete.
6. Settings do not persist.
7. PII is exposed everywhere.
8. No compound scope enforcement.
