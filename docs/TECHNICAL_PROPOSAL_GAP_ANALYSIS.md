# Technical Proposal Gap Analysis

**Reference:** Initium Solutions, *Community Operations Intelligence Platform — Technical Proposal v1.0*, November 2026 (35 pages, text extracted and read in full).
**Audit method:** source inspection, live API calls, SQLite inspection, and the import/security tests documented in `TEST_AND_ACCEPTANCE_REPORT.md`. A screen or endpoint existing is **not** treated as proof.
**Date:** 2026-11-06.

Status values: **IMPLEMENTED AND VERIFIED** · **PARTIALLY IMPLEMENTED** · **NOT IMPLEMENTED** · **DEFECTIVE** · **NOT APPLICABLE TO CURRENT PHASE** · **REQUIRES BUSINESS APPROVAL**.

---

## 0. Compliance summary (verified, not screen-counted)

| Area | Weighted findings |
|---|---|
| Prototype experience preserved | Strong: 18 modules present, real data behind most |
| Phase 1 security foundation | **Critical failure**: no auth, no server authorization, no scope, no PII masking |
| Phase 1 data ingestion | **Strong**: real, idempotent, restartable, non-blocking; month confirmation fixed |
| Phase 1 KPI governance | Partial: catalog + snapshots exist, dashboard reads live tables |
| Phase 1 operational modules | Partial: server paging exists, UI cannot page; resident detail placeholder |
| Phase 1 reports/exports | Partial: real XLSX, but mislabeled PDF, synchronous, unmasked, unscoped |
| Phase 1 settings | Not implemented (presentation only) |
| Phase 2 scope (HCP, identity, quality, AI, trends) | Partially built ahead of schedule, but unsecured and incomplete |
| Future architecture documentation | Produced in this audit; application not migrated (correct) |

**Verified requirement completion (Phase 1 only): roughly 38%.** This is deliberately conservative; security is a gating workstream and is 0% implemented, and several modules are only first-page shells.

---

## 1. Section-by-section traceability

### 2. Our understanding / scope (pp. 4–5)

| Ref | Requirement | Current implementation | Evidence | Status | Gap | Priority | Phase | Proposed correction | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| 2.1 | Microsoft organizational sign-in | Browser flag / fake login | `app-pages.js:14`, `app.js:90` | NOT IMPLEMENTED | No Entra, MSAL, token, session | Critical | Current (local dev auth), Future (Entra) | Add server-side session + local dev identity now; Entra adapter later | Unauthenticated API call returns 401 |
| 2.1 | Management/Operations are presentation modes, not roles | Buttons call `setRole`, changing permissions | `app.js:74-88,109-118,252-253` | DEFECTIVE | Mode and security role are the same state | High | Current | Separate `mode` from `role`; mode affects layout only | Switching mode never changes API results or permissions |
| 2.1 | Five business roles | Three UI profiles | `app.js:66-88` | NOT IMPLEMENTED | Missing Community Manager/Admin; no RBAC | Critical | Current | Implement five roles + permission catalog | Role matrix tests pass |
| 2.1 | Compound scope enforced server-side | Compound query parameter trusted | `server.js:58,72,82,94,113` | NOT IMPLEMENTED | Cross-compound access trivial | Critical | Current | Resolve user scopes; intersect with request | Cross-compound requests return 403/empty |
| 2.1 | Read-only AI, no writes | AI has no write path | `ai.js` | IMPLEMENTED AND VERIFIED | Agent is read-only; optional provider verbalization only | — | Phase 2 | Keep | No write tools exist |
| 2.2 | No modification of CRM/HCP source records | App never writes upstream | `ingest.js` writes local DB only | IMPLEMENTED AND VERIFIED | — | — | Current | Keep | No outbound write calls to CRM/HCP |

### 3. Validated experience (pp. 6–14)

| Ref | Requirement | Current implementation | Evidence | Status | Gap | Priority | Phase | Proposed correction | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| 3.1 | Branded sign-in with Microsoft | Presentation only | `app-pages.js:14` | PARTIALLY IMPLEMENTED | Visual exists; no flow | High | Current/Future | Local sign-in now; MSAL later | Sign-in yields a server session |
| 3.2 | Executive overview with KPI ribbon and drill-down | Real cards/charts; drill links | `app-pages.js:98-245` | IMPLEMENTED AND VERIFIED | Values not read from locked snapshot | High | Current | Read snapshot for closed periods | Card value == snapshot value |
| 3.3 | Compound comparison reconciles to overview incl. Unassigned | Real rows | `kpis.js:compareCompounds` | PARTIALLY IMPLEMENTED | No Unassigned row; no export/sort | High | Current | Add Unassigned + totals + export | Portfolio = sum(compounds) + Unassigned |
| 3.4 | Trends over up to 12 snapshots | Real series | `app-pages.js:617` | PARTIALLY IMPLEMENTED | Only 2 periods; no empty-state policy | Medium | Phase 2 | Add snapshot history and state | 12-period series from locked snapshots |
| 3.5 | AI workspace with context and "How calculated?" | Context exists; no explanation link | `app-pages.js:767-847` | PARTIALLY IMPLEMENTED | No citation/tool trace/validation | Medium | Phase 2 | Add tool trace + numeric validation | Answer cites period/source |
| 3.6 | Reports module: executive pack, ops report, quality audit, archive | One XLSX button labeled PDF | `app-pages.js:848-858` | DEFECTIVE | Label mismatch; 3 of 4 reports missing | High | Current/Phase 2 | Fix label; add reports | Each report downloadable and audited |
| 3.7 | KPI definitions show name/formula/sources/version | Real catalog | `kpis.js:7-20` | PARTIALLY IMPLEMENTED | No owner/version/refresh | Medium | Current | Add version/owner to catalog | Version displayed and stored with snapshot |
| 3.8 | Operational lists: segments, search, filters, count, paging, drawer | Real lists; no UI pager | `app-pages.js:936-1055` | PARTIALLY IMPLEMENTED | First 50 rows only; resident drawer placeholder | High | Current | Add pager/sort; real resident drawer | Page/sort/filter round-trips |
| 3.9 | Vehicle access: immutable events, Entry/Exit, Pass/Denied | Real | `server.js:219`, HCP ingest | IMPLEMENTED AND VERIFIED | PII unmasked; no scope | High | Current (security) | Mask plates/owners by role | Masked for non-privileged roles |
| 3.10 | Identity matching queue with confirm/reject persisted | Read + POST exists | `server.js:264-290`, `app-pages.js:589` | PARTIALLY IMPLEMENTED | UI decision flow unclear; actor/reason not captured | Medium | Phase 2 | Add decision UI + audit | Decision persists with actor/time/reason |
| 3.11 | Honest unavailable states (face/visitor authentication) | Face page states missing source | `app-pages.js:573-588` | IMPLEMENTED AND VERIFIED | — | — | Phase 2 | Keep | No fabricated values |
| 3.12 | Global search after 2 chars, permission-aware | Header input only | `app.js:...` | PARTIALLY IMPLEMENTED | No dedicated API, no ranking/permission | Medium | Current | Add `/api/search` | Results ≤1 s after debounce |
| 3.13 | Notifications | Static dot | shell | NOT IMPLEMENTED | No service/read state | Low | Phase 2 | Add notification service | Completion raises notification |
| 3.14 | Responsive + WCAG 2.1 AA | Responsive CSS; unaudited | `styles.css` | PARTIALLY IMPLEMENTED | No axe/keyboard/screen-reader evidence | Medium | Current | Run axe; fix focus/contrast | Automated + manual pass |

### 4. Solution architecture (pp. 15–17)

| Ref | Requirement | Current implementation | Evidence | Status | Gap | Priority | Phase | Proposed correction | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| 4.1 | Layered architecture, no browser KPI computation | KPI calculation is server-side | `kpis.js` | IMPLEMENTED AND VERIFIED | Route handlers still mix SQL/business | Medium | Current | Extract services | Controllers thin; services testable |
| 4.2 | Entra ID + MSAL (future) | None | — | NOT IMPLEMENTED | — | Critical (future) | Future | Documented in `ENTRA_ID_AND_DYNAMICS_INTEGRATION_READINESS.md` | Live sign-in verified before claim |
| 4.3 | ASP.NET Core / Azure SQL / Azure (future) | Node/SQLite | `package.json`, `db.js` | NOT APPLICABLE TO CURRENT PHASE | Future only | High (future) | Future | Documented migration plans | Migration not executed |
| 4.4 | Async jobs never block interactive use | Child process per import, verified | `jobs/runner.js`; 8–14 ms health during import | IMPLEMENTED AND VERIFIED | Exports still synchronous | High | Current/Phase 2 | Move large exports to jobs | Upload/export returns 202 + job id |
| 4.5 | Server-side paging, bounded pages, stable sort | Present but no tie-breaker; UI no pager | `server.js:61-67,121-136` | PARTIALLY IMPLEMENTED | Stability and UI | High | Current | Add tie-breakers + pager | Repeatable ordering |
| 4.6 | One error envelope with code/correlationId | Ad-hoc `{error}` | `server.js` | NOT IMPLEMENTED | No correlation | Medium | Current | Add error middleware | 401/403/503 distinguishable |
| 4.7 | Idempotency keys for writes | Only imports idempotent | `ingest.js` fingerprints | PARTIALLY IMPLEMENTED | Other writes not idempotent | Medium | Current | Add key support | Retried write has one effect |
| 4.8 | OpenAPI contract + generated client | None | — | NOT IMPLEMENTED | No contract | High (migration) | Current | Write `API_CONTRACTS.md`, then OpenAPI | Contract validated in tests |

### 5. Data architecture and ingestion (pp. 18–20)

| Ref | Requirement | Current implementation | Evidence | Status | Gap | Priority | Phase | Proposed correction | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| 5.1 | ZIP/XLSX/XLS/CSV upload up to 1 GB | Implemented | `server.js:34-45`; verified | IMPLEMENTED AND VERIFIED | No malware scan (on-prem) | High | Current | Add scanning hook; document | Rejected malicious archive |
| 5.2 | Path traversal prevention | Blocked and verified | `ingest.js:305-326` | IMPLEMENTED AND VERIFIED | — | — | Current | Keep | Traversal ZIP rejected |
| 5.3 | Decompression-bomb protection | No entry-count/total-size cap | `ingest.js:315-330` | NOT IMPLEMENTED | 1 GB upload can expand unbounded | High | Current | Add caps | Oversized archive rejected |
| 5.4 | Structure-based classification with confidence | Implemented | `datasets.js`, `ingest.js` | IMPLEMENTED AND VERIFIED | — | — | Current | Keep | Wrong filename still classified |
| 5.5 | Period inferred + confirmed by administrator | Implemented (month picker on failure) | `app-pages.js:740-755`; verified | IMPLEMENTED AND VERIFIED | Auto-detect only HCP timestamps | High | Current | Keep; allow override always | CRM-only package processes with confirmed month |
| 5.6 | Unknown files held for review | Staged as UNKNOWN/skipped | `ingest.js` | IMPLEMENTED AND VERIFIED | No UI to assign type | Medium | Phase 2 | Add review UI | Unknown file list with assignment |
| 5.7 | Truncation detection (exact export cap) | Detects 100,000 rows | `quality.js:27` | IMPLEMENTED AND VERIFIED | Warning only; list labeling weak | High | Current | Show lower-bound badge everywhere | UI discloses lower bound |
| 5.8 | Master upsert with field-level history | Implemented (`*_history`, `changed_records`) | `ingest.js` | IMPLEMENTED AND VERIFIED | History contains unredacted PII | Medium | Current | Redact at rest/export | No raw PII in audit views |
| 5.9 | Immutable events with deterministic fingerprint | Implemented; unique indexes | `event_fingerprints`, `event_hash` | IMPLEMENTED AND VERIFIED | — | — | Current | Keep | Re-upload adds 0 events |
| 5.10 | Snapshot and publish; period selectable only after publish | Snapshot written; all periods always selectable | `ingest.js`, `kpis.js` | PARTIALLY IMPLEMENTED | No publish/lock state | High | Current | Add snapshot status | Unpublished period not selectable |
| 5.11 | Import history with actor, duration, counts, logs | Counts/logs present; actor absent | `imports` table | PARTIALLY IMPLEMENTED | No uploader identity | High | Current | Add actor + correlation | History shows actor |
| 5.12 | Reprocessing idempotent | Verified | `ingest.js`; reprocess test | IMPLEMENTED AND VERIFIED | — | — | Current | Keep | Second run new=0 |
| 5.13 | Rollback / period deletion / guarded reset | Implemented with confirmation | `server.js:438-465` | PARTIALLY IMPLEMENTED | No authorization; no job guard | Critical | Current | Gate by permission + no active job | 403 for non-admin |
| 5.14 | Original package retained | `data/uploads/` retained | filesystem | IMPLEMENTED AND VERIFIED | No retention policy | Medium | Current | Add policy/config | Retention enforced |
| 5.15 | Normalization preserves raw + normalized | Separate columns | `normalize.js`, schema | IMPLEMENTED AND VERIFIED | Plate Arabic normalization partial | Medium | Phase 2 | Complete plate rules | Both scripts searchable |
| 5.16 | Compound attribution unresolved → Unassigned | Nulls possible; no Unassigned row | schema | PARTIALLY IMPLEMENTED | Unassigned not surfaced/reconciled | High | Current | Add disclosure row | Totals reconcile |

### 6. KPI engine and data quality (p. 21)

| Ref | Requirement | Current implementation | Evidence | Status | Gap | Priority | Phase | Proposed correction | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| 6.1 | Versioned KPI catalog with owner/definition/formula/sources | Catalog exists; no version/owner | `kpis.js:7-20` | PARTIALLY IMPLEMENTED | Governance fields | High | Current | Extend catalog | Version stored in snapshot |
| 6.2 | One calculation reused by cards/charts/reports/AI | Centered on `computeDashboard`/`computeKpis` | `kpis.js`, `ai.js` | IMPLEMENTED AND VERIFIED | Reports use same functions | — | Current | Keep | Same value across surfaces |
| 6.3 | Dashboard reads locked snapshot | Reads live tables | `kpis.js:67-80` | DEFECTIVE | History can shift | Critical | Current | Read `period_metrics`/snapshot | Closed period stable after new import |
| 6.4 | Reconciliation: portfolio = compounds + Unassigned | No test; no Unassigned row | — | NOT IMPLEMENTED | — | High | Current | Add reconciliation test/API | Automated check passes |
| 6.5 | Data-quality 0–100 with 9 dimensions + weights | Partial dimensions; score exists | `quality.js` | PARTIALLY IMPLEMENTED | 9 dimensions and published weights missing | Medium | Phase 2 | Extend rule engine | Dimension report + weights |
| 6.6 | Quality issues with severity/source/count/sample | Implemented | `quality.js` | IMPLEMENTED AND VERIFIED | Samples not privacy-filtered | High | Current | Mask samples | No PII in sample |

### 7. AI analyst (p. 22) — Phase 2

| Ref | Requirement | Current implementation | Evidence | Status | Gap | Priority | Phase | Proposed correction | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| 7.1 | Tool-grounded, read-only orchestration | Local deterministic answers from computed KPIs | `ai.js` | PARTIALLY IMPLEMENTED | No tool framework/citations | Medium | Phase 2 | Add tools + trace | Figures match tool output |
| 7.2 | Numeric post-validation | None | — | NOT IMPLEMENTED | Provider text can add numbers | Medium | Phase 2 | Validate numbers | Reject ungrounded figures |
| 7.3 | Honest limits for unavailable sources | Local answers state limits | `ai.js` | IMPLEMENTED AND VERIFIED | — | — | Phase 2 | Keep | No invented face data |
| 7.4 | PII excluded from prompts | Only aggregated computed text sent | `ai.js:249` | IMPLEMENTED AND VERIFIED | Verify per provider | High | Phase 2 | Add field allowlist | Prompt audit shows no PII |

### 8. Security, privacy, audit (p. 23)

| Ref | Requirement | Current implementation | Evidence | Status | Gap | Priority | Phase | Proposed correction | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| 8.1 | Entra ID sole authority | None | — | NOT IMPLEMENTED | No auth | Critical | Current/Future | Session abstraction + Entra adapter | 401 without identity |
| 8.2 | Server-side role/compound enforcement | None | — | NOT IMPLEMENTED | — | Critical | Current | Permission middleware | Matrix tests pass |
| 8.3 | PII masking at API layer by role | None | `/api/users` returns mobile/email; `/api/users/:id` national_id | NOT IMPLEMENTED | Full exposure | Critical | Current | Central masker + per-role policy | Masked for all but authorized |
| 8.4 | PII exports require permission + audit | None | `/api/export` | NOT IMPLEMENTED | — | Critical | Current | Add permission/audit/watermark | Sensitive export audited |
| 8.5 | Append-only audit with actor/time/action/target/result/correlation/before-after | Minimal actor/action/detail | `db.js:396-399` | PARTIALLY IMPLEMENTED | Missing most fields; actor defaults system | High | Current | Extend schema and helper | Denials/actions fully recorded |
| 8.6 | Rate limiting on auth/AI/export/upload | None | — | NOT IMPLEMENTED | Abuse risk | High | Current | Add limiter | 429 after threshold |
| 8.7 | HTTPS/HSTS/WAF | Not at app level | plain HTTP | NOT APPLICABLE (local) | Deploy-time | High | Future | Document in Azure blueprint | TLS verified in Azure |
| 8.8 | Secrets write-only, never displayed | `ai_api_key` masked; HCP secrets encrypted | `server.js:476-489`, `hcp/crypto.js` | IMPLEMENTED AND VERIFIED | — | — | Current | Keep | No plaintext secret in API |

### 9. Non-functional (p. 24)

| Ref | Requirement | Current implementation | Evidence | Status | Gap | Priority | Phase | Proposed correction | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| 9.1 | Dashboard/lists <2 s warm | Dashboard 1.73 s measured | live test | IMPLEMENTED AND VERIFIED | Some heavy queries | Medium | Current | Add indexes/caching | p95 <2 s |
| 9.2 | Global search <1 s after debounce | No search API | — | NOT IMPLEMENTED | — | Medium | Current | Add indexed search | p95 <1 s |
| 9.3 | Progress for >1 s operations | Import progress % | `imports.progress` | IMPLEMENTED AND VERIFIED | Export has no progress | Medium | Phase 2 | Job progress | UI shows job progress |
| 9.4 | Imports/exports never block UI | Imports isolated; exports synchronous | verified | PARTIALLY IMPLEMENTED | Large export blocks | High | Phase 2 | Jobify exports | API responsive during export |
| 9.5 | Restartable, idempotent jobs | Import recovery/idempotency verified | `jobs/runner.js` | IMPLEMENTED AND VERIFIED | Exports not restartable | Medium | Future | Job queue | Restart resumes safely |
| 9.6 | Health/readiness with DB/jobs | `/api/health` only `{ok}` | `server.js:50` | PARTIALLY IMPLEMENTED | No DB/job check | High | Current | Add checks | Health reflects DB/worker state |
| 9.7 | Backup/recovery documented | Script added; no schedule | `scripts/backup-db.js` | PARTIALLY IMPLEMENTED | No automation/runbook | High | Current | Add runbook + schedule | Restore rehearsed |

### 10–14. Phases, delivery, acceptance, governance (pp. 25–33)

| Ref | Requirement | Status | Gap |
|---|---|---|---|
| 10.1 | Phase 1: community-app data only | PARTIALLY IMPLEMENTED | HCP modules are present ahead of phase and visible |
| 10.2 | Phase 1 hides HCP-dependent modules | NOT IMPLEMENTED | Vehicle access/face/visitors/HCP screens are visible |
| 10.3 | Phase 1 five operational modules with server search/filters/paging/detail/exports | PARTIALLY IMPLEMENTED | Paging UI, resident detail, scope and masking missing |
| 10.4 | Phase 1 executive pack (Excel), settings, alias mappings | PARTIALLY IMPLEMENTED | Report label wrong; settings fake; aliases only in DB |
| 11.1 | Reconciliation-based acceptance | NOT IMPLEMENTED | No reconciliation harness |
| 12.1 | Release readiness conditions incl. auth, real exports, audit, PII | NOT IMPLEMENTED | Security conditions unmet |
| 13.1 | Role-based training/guides | NOT IMPLEMENTED | Documentation only, no guides yet |

### 15. Assumptions / dependencies / risks (p. 34)

| Ref | Item | Status |
|---|---|---|
| 15.1 | Hosted in Palm Hills Azure subscription | Future; current is local |
| 15.2 | Monthly file packages (no direct CRM/HCP integration) | Matches: imports are file-based |
| 15.3 | HCP person/visitor data unavailable → honest unavailable state | Implemented and verified |
| 15.4 | Entra app registration/consent required before auth can be called complete | **Blocked on Microsoft admin**; must not be claimed |

---

## 2. Critical defects found (not just missing features)

1. **No authentication on any route** — includes `/api/admin/reset`, `/api/periods/:period/delete`, `/api/settings`, `/api/audit`, `/api/users/:id` (national ID), `/api/export`.
2. **No authorization or scope** — any caller can read any compound.
3. **PII unmasked** in lists, details and exports.
4. **KPI drift** — dashboard reads live masters, so reprocessing changes closed periods.
5. **Modes conflated with roles** — switching to "Management" silently removes operational routes, implying security.
6. **Reports mislabeled PDF** while emitting XLSX.
7. **Settings do not persist** (`Save Preferences` toast only).
8. **Operational lists cannot page past 50 rows from the UI.**
9. **Resident detail drawer is a placeholder.**
10. **No decompression-bomb limits** on ZIP extraction.
11. **No rate limiting or CSRF protection** (CSRF becomes relevant with sessions).
12. **Audit actor always `system`**, with no correlation ID or result.

## 3. Business decisions still required

| # | Decision | Blocks |
|---|---|---|
| B1 | Identity-match decisions for Community Manager/Admin: allowed or not | Permission matrix row "Pending policy" |
| B2 | PII unmasked-access permission and approval owner | PII masking policy |
| B3 | Export permission for sensitive plates/mobiles | Export controls |
| B4 | Reporting-period close/lock policy and restatement process | Snapshot lockdown |
| B5 | Which profile owns data-quality weights | Phase 2 scoring |
| B6 | HCP Phase 2 start and sample availability | HCP analytics |

## 4. Items that must not be claimed until externally verified

- Microsoft Entra ID sign-in (needs app registration, tenant consent, credentials).
- Dynamics 365 / Dataverse integration (needs environment and service principal).
- Azure deployment, WAF, Key Vault, private networking.
- AI answer accuracy (needs evaluation set and provider selection).
- HCP live integration (needs network access and credentials; current code is preparation only).
