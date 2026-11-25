# Implementation Roadmap

**Date:** 2026-11-06
**Baseline:** Initium proposal v1.0, 22-week plan (M1 week 2, M2 week 11, M3 week 16, M4 week 21, M5 week 22)
**Constraint (historical):** keep the running Node.js/Express/SQLite application; React 19, ASP.NET Core and Azure SQL were future state only.

> **Deployment-copy note:** `dashboards-azure` is now backed by Azure Database for PostgreSQL; see `AZURE_POSTGRES_DEPLOYMENT.md`.

---

## 1. Guiding sequence

1. **Stop the bleeding** — authentication, authorization, scope, PII masking (security gates everything).
2. **Make the numbers trustworthy** — snapshot-based reads, reconciliation, period lifecycle.
3. **Finish Phase 1 usability** — paging, resident detail, reports, settings.
4. **Harden operations** — health, backups, rate limits, upload limits, logging.
5. **Phase 2** — HCP, identity matching, quality engine, AI analyst, trends.
6. **Future platform** — Entra ID, Azure hosting, Azure SQL, React, ASP.NET Core (documented, not executed).

---

## 2. Work packages

### WP-1 — Security foundation (Critical, 1–2 weeks)

| Task | Detail | Acceptance |
|---|---|---|
| 1.1 Auth schema | `dashboard_users`, `user_sessions`, `user_compound_scopes`, audit columns | Migration is additive and safe on the live DB |
| 1.2 Password + session | scrypt, hashed tokens, cookies, Bearer, idle/absolute expiry | Login/logout/me work; expired session = 401 |
| 1.3 Permission catalog | 5 roles, permissions, route map | Matrix unit tests pass |
| 1.4 Route guards | Every `/api/*` route declares a permission | Anonymous = 401; wrong role = 403 |
| 1.5 Compound scope | Server resolution + SQL intersection | Cross-compound = 403 |
| 1.6 PII masking | Central masker at API boundary | Tier 1/2 masked per matrix |
| 1.7 Audit | Extended schema; deny and action events | Denial row has actor/role/result/correlation |
| 1.8 CSRF + rate limits | Double-submit; login/AI/export/upload | 403 without token; 429 after threshold |
| 1.9 Admin UI | User/role/scope management | Super Admin can create a scoped user |

### WP-2 — KPI governance (Critical, 1 week)

| Task | Detail | Acceptance |
|---|---|---|
| 2.1 Snapshot-first reads | Serve published period from `period_snapshots` | Published KPI unchanged after later import |
| 2.2 Reconciliation | Portfolio = compounds + Unassigned | Automated test passes |
| 2.3 Period lifecycle | `open/published/superseded/deleted` | Unpublished period not selectable |
| 2.4 Versioning | `kpi_version` + `processing_version` in snapshot | Displayed and stored |
| 2.5 Unassigned row | Comparison includes Unassigned | Sum equals overview |

### WP-3 — Phase 1 module completion (High, 2 weeks)

| Task | Detail | Acceptance |
|---|---|---|
| 3.1 List paging | Pager/sort server round-trip on units, residents, vehicles | Navigate beyond page 1 |
| 3.2 Resident drawer | Real `/api/users/:id` detail | Shows units, vehicles, passes (masked) |
| 3.3 Reports | Label XLSX; add operations and quality reports | Each downloads and is audited |
| 3.4 Settings | Persist to `settings`; permissioned; audited | Reload shows saved values |
| 3.5 Global search | `/api/search` across entities, permission-aware | Results < 1 s after debounce |
| 3.6 Modes | Separate `mode` from `role` | Mode never changes permissions |
| 3.7 Accessibility | axe + keyboard/focus/contrast | WCAG 2.1 AA evidence |
| 3.8 Dead code | Remove `app_pages.js`, duplicate CSS/artifacts | No unreferenced assets |

### WP-4 — Operational hardening (High, 1 week)

| Task | Detail | Acceptance |
|---|---|---|
| 4.1 Health | `/api/health` checks DB, workers, last import | Returns component status |
| 4.2 Backups | Daily automated + pre-destructive | Restore rehearsal recorded |
| 4.3 Upload limits | Entry count/size/ratio, encrypted ZIP rejection | Malicious archive rejected |
| 4.4 Logging | Structured logs + correlation IDs | Trace one request end-to-end |
| 4.5 Error envelope | Global error middleware | No stack traces leaked |
| 4.6 Async exports | Job + progress for large extracts | API responsive during export |
| 4.7 API contract | `openapi.yaml` + validation | Contract test passes |

### WP-CRM-HCP — Separate CRM / HCP uploads (done 2026-11-07)
Dedicated workflows with `source_kind` + compound-ID persistence; `POST /api/crm-uploads` + `POST /api/hcp-uploads` (+ preview), backend compound-scope enforcement, shared fingerprint contract for a future `HCP_API_SYNC`. See `docs/CRM_HCP_IMPORT_ARCHITECTURE.md`. Acceptance: hermetic workflow tests 8/8 (`tests/crm-hcp-import.test.js`), security harness 23/23, scoped-manager 403 + admin scoped-upload verified in browser. Legacy combined `POST /api/uploads` remains supported (source NULL).

### WP-5 — Phase 2 (after Phase 1 acceptance)

HCP ingestion, identity matching workflow, nine-dimension quality engine, AI tool trace + numeric validation, trends to 12 snapshots, notifications, audit administration UI.

### WP-6 — Future platform (not executed)

Entra ID, Azure SQL migration, React 19 frontend, ASP.NET Core services, Azure hosting/WAF/Key Vault, Dynamics 365. Documented in the migration and integration readiness documents.

---

## 3. Sequencing and dependencies

```
WP-1 ──► WP-2 ──► WP-3 ──► WP-4 ──► Phase 1 acceptance ──► WP-5 ──► WP-6
  │                                    ▲
  └──────────── audit evidence ────────┘
```

- WP-2 and WP-3 depend on WP-1 because every query must be scoped and masked.
- WP-4 can start in parallel once WP-1 lands.
- Phase 2 must not start before Phase 1 acceptance and business decisions B1–B6 are resolved.

---

## 4. Milestones (adjusted to current state)

| Milestone | Proposal target | Realistic now | Evidence required |
|---|---|---|---|
| M1 Design sign-off | Week 2 | Complete (this documentation set) | Signed scope + decisions |
| M2 Phase 1 go-live | Week 11 | After WP-1..WP-4 | Security checklist, UAT, reconciliation |
| M3 First HCP period | Week 16 | Phase 2 start + data | One real period end-to-end |
| M4 Phase 2 UAT | Week 21 | Phase 2 | UAT sign-off |
| M5 Phase 2 go-live | Week 22 | Phase 2 | Hypercare plan |

The original 11-week M2 is not achievable from the current baseline without the security work; the estimate above assumes a focused team and no external blockers.

---

## 5. Effort estimate (indicative)

| Work package | Effort |
|---|---|
| WP-1 Security foundation | 8–12 person-days |
| WP-2 KPI governance | 5–7 |
| WP-3 Phase 1 completion | 8–12 |
| WP-4 Hardening | 5–8 |
| WP-5 Phase 2 | 25–40 |
| WP-6 Platform migration | 40–70 |
| Testing/UAT overhead | 20–25% |

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Enabling auth locks out the current workflow | Bootstrap admin, documented credentials, staged rollout |
| Snapshot-first changes reported numbers | Reconcile snapshots to live before publishing; label source |
| Scope model breaks legitimate cross-compound users | Multi-scope assignment; explicit Unassigned grant |
| SQLite write contention during imports | Child-process worker (done); consider queue/Postgres later |
| Entra blocked | Local auth now; adapter later; never claim Entra complete |
| Data quality unknown | Run reconciliation and quality report before go-live |

---

## 7. Definition of done for Phase 1

- [ ] All 18 security acceptance tests pass.
- [ ] Every `/api/*` route authenticated and permissioned.
- [ ] Compound scope enforced and tested.
- [ ] PII masking verified in lists, details and exports.
- [ ] Audit complete for auth, denials, exports, imports, destructive actions.
- [ ] Published period KPIs stable and reconciled.
- [ ] Lists page beyond 50 rows; resident drawer real.
- [ ] Reports correctly labeled; settings persist.
- [ ] Health, backups, upload limits, rate limits, error envelope.
- [ ] `docs/` set complete and reviewed.
- [ ] Business decisions B1–B6 recorded.
