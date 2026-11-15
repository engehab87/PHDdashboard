# Module Acceptance Matrix (Phase 1)

**Date:** 2026-11-06
**Legend:** ✅ verified with evidence · 🟡 partial · ❌ missing/defective · ⛔ blocked externally · N/A not in Phase 1

| # | Module | Phase 1 requirement | Current | Target after WP-1..WP-4 | Evidence |
|---|---|---|---|---|---|
| 1 | Sign-in | Organizational sign-in | ❌ fake browser flag | ✅ local session + Entra adapter later | `app-pages.js:14` |
| 2 | Shell/navigation | Role-aware nav, modes separate | ❌ roles = modes | ✅ server permissions; mode cosmetic | `app.js:66-118` |
| 3 | Executive overview | KPI ribbon, drill-down, locked values | 🟡 real but live-computed | ✅ snapshot-first | `kpis.js:51-109` |
| 4 | Compound comparison | Reconcile to overview incl. Unassigned | 🟡 no Unassigned row | ✅ reconciliation row + totals | `kpis.js:111-142` |
| 5 | Units | List/search/filter/sort/page/detail | 🟡 server paging, no UI pager | ✅ full pager + drawer | `app-pages.js:936` |
| 6 | Residents | List/search/filter/detail, masked | 🟡 no pager, placeholder drawer, raw PII | ✅ pager, real drawer, masking | `app-pages.js:972` |
| 7 | Vehicles & ANPR | List/detail/stats, masked plates | 🟡 no pager, raw plates, broken compound filter | ✅ pager, masking, scope via owner | `app-pages.js:1015`; `server.js:185` |
| 8 | Vehicle access (HCP) | Immutable events, filters | 🟡 Phase 2 data present, public | ✅ permissioned, scoped, masked | `server.js:219` |
| 9 | Gate passes | List, proxy label, lower-bound label | 🟡 real data, weak truncation label | ✅ explicit ≥100,000 label | `server.js:205` |
| 10 | Invitations | List/status/type/search | 🟡 real, no compound scope | ✅ scoped/attributed label | `server.js:212` |
| 11 | Visitors | Visitor authentication | 🟡 gate-pass proxy, honest | ✅ proxy label retained | `app-pages.js:539` |
| 12 | Face recognition | Honest unavailable state | ✅ no fabrication | ✅ keep | `app-pages.js:573` |
| 13 | Identity matching | Queue + confirm/reject persisted | 🟡 API exists, weak UI | Phase 2 | `server.js:264` |
| 14 | Portfolio trends | Up to 12 snapshots | 🟡 2 periods | Phase 2 | `server.js:250` |
| 15 | Data quality | Score + issues | 🟡 partial dimensions | Phase 2 full engine | `quality.js` |
| 16 | Monthly imports | Upload/validate/process/recover/retry | ✅ verified end-to-end | ✅ plus ZIP limits | `jobs/runner.js`; verified |
| 17 | AI analyst | Read-only grounded answers | 🟡 grounded, no trace | Phase 2 | `ai.js` |
| 18 | Reports | Executive pack (XLSX) | ❌ labeled PDF, one report | ✅ correct label + reports | `app-pages.js:848` |
| 19 | Settings | Persist, permissioned, audited | ❌ toast only | ✅ persisted + audited | `app-pages.js:861` |
| 20 | KPI definitions | Name/formula/sources/version | 🟡 no version/owner | ✅ versioned | `kpis.js:6-21` |
| 21 | Audit | Actor/action/target/result/correlation | 🟡 minimal | ✅ extended | `db.js:396` |
| 22 | Security | Auth, RBAC, scope, PII, CSRF, rate limit | ❌ none | ✅ WP-1 | audit |
| 23 | Health | DB/worker/last import | ❌ `{ok}` only | ✅ component health | `server.js:50` |
| 24 | Backups | Scheduled + rehearsed restore | 🟡 script only | ✅ automated + runbook | `scripts/backup-db.js` |
| 25 | API contract | OpenAPI + envelope | ❌ none | ✅ WP-4 | `CURRENT_API_INVENTORY.md` |
| 26 | Accessibility | WCAG 2.1 AA | ❌ not verified | ✅ WP-3 | — |
| 27 | Entra ID | Organizational identity | ⛔ blocked | Future | `ENTRA_ID_AND_DYNAMICS_INTEGRATION_READINESS.md` |
| 28 | Dynamics 365 | Direct CRM integration | ⛔ blocked / not required | Future | same |
| 29 | Azure hosting | Production platform | ⛔ blocked | Future | migration doc |
| 30 | React 19 / ASP.NET Core | Target stack | N/A | Future | migration doc |

## Phase 1 exit status

| Gate | Status |
|---|---|
| Imports reliable | ✅ verified (non-blocking, idempotent, recoverable, month confirmation) |
| Data present for 2026-09 and 2026-10 | ✅ verified |
| Reconciliation | 🟡 units reconcile; other KPIs untested |
| Security | ❌ fails (no auth/RBAC/scope/PII) |
| Module completeness | 🟡 8 of 30 fully verified |
| Documentation | ✅ this set |
| **Phase 1 acceptance** | **❌ not met until WP-1 and WP-2 complete** |
