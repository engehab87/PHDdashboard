# RBAC Requirements and Role Matrix

**Status:** requirements + implemented design baseline
**Version:** 1.0
**Date:** 2026-11-06
**Reference:** Initium Technical Proposal v1.0, sections 2.1, 8, 10.3

---

## 1. Principles

1. **Authorization is server-side.** The browser never decides what a user may see. Client-side hiding is presentation only.
2. **Five business roles only:** Top Management, Community Manager, Community Admin, Admin, Super Admin.
3. **Management and Operations are presentation modes, not roles.** They change layout, default filters and copy — never permissions.
4. **Deny by default.** A route with no declared permission is inaccessible to everyone except a Super Admin; an unauthenticated request is always `401`.
5. **Compound scope is data, not a query parameter.** The server resolves the user's allowed compounds and intersects them with every request.
6. **PII is masked by default.** Unmasked identifiers require an explicit capability, and every sensitive export is audited.
7. **Every allow/deny decision is auditable.** Authentication, authorization denials, data exports and destructive operations must be recorded with actor, action, target and result.

---

## 2. Role definitions

| Role | Business purpose | Default scope | Writes |
|---|---|---|---|
| **Top Management** | Executive oversight of the whole portfolio | All compounds, read-only | None |
| **Community Manager** | Runs operations for assigned communities | Assigned compounds | Resident/vehicle image update; no identity decisions by default (policy B1) |
| **Community Admin** | Administers assigned communities, imports and quality | Assigned compounds | Imports, identity decisions, resident writes, settings.business |
| **Admin** | Platform administration across the portfolio | All compounds | Imports, rollback, period deletion, user administration, settings.business, unmasked PII |
| **Super Admin** | Root governance and recovery | All compounds | Everything, including `system.reset`, `settings.system`, role assignment |

> **Policy B1 remains open:** whether Community Manager may confirm/reject identity matches. Until approved, the matrix denies `identity.decide` to Community Manager and grants it to Community Admin.

---

## 3. Permission catalog

Identifiers are stable strings used in code, tests and audit records.

### 3.1 Reference and navigation

| Permission | Meaning |
|---|---|
| `period.view` | List reporting periods and their status |
| `compound.view` | List compounds (scoped) |
| `kpi.view` | Read the KPI definition catalog |
| `dashboard.view` | Read KPI cards/charts |
| `compare.view` | Read compound comparison |
| `trend.view` | Read trend series |
| `insight.view` | Read generated insight strings |
| `snapshot.view` | Read locked snapshots |
| `quality.view` | Read quality summary |
| `quality.full` | Read full record-level quality detail and samples |

### 3.2 Operational data

| Permission | Meaning |
|---|---|
| `unit.list` / `unit.detail` | List / open units |
| `resident.list` / `resident.detail` | List / open residents |
| `resident.write` | Update resident image/attributes |
| `vehicle.list` / `vehicle.detail` / `vehicle.stats` | Vehicles |
| `gatepass.list` | Gate passes |
| `invitation.list` | Invitations |
| `access.list` | HCP vehicle events |
| `access.analytics` | Hourly/heatmap aggregations |
| `identity.view` | Identity-matching queue |
| `identity.decide` | Confirm/reject a match (policy B1) |

### 3.3 AI, exports, reports

| Permission | Meaning |
|---|---|
| `ai.use` | Ask the grounded analyst |
| `export.data` | Export standard (masked) datasets |
| `export.sensitive` | Export unmasked identifiers |
| `report.executive` | Generate the executive report |

### 3.4 Administration

| Permission | Meaning |
|---|---|
| `import.view` | View import registry, logs, duplicates, changes |
| `import.manage` | Upload, process, reprocess, cancel |
| `import.rollback` | Roll back a completed import |
| `period.delete` | Delete a reporting period and its data |
| `system.reset` | Full database reset |
| `settings.view` | Read settings |
| `settings.business` | Change business settings (timezone, parking-lot map) |
| `settings.system` | Change system/secret settings |
| `audit.view` | Read the audit trail |
| `user.manage` | Create/deactivate users, assign roles and compound scopes |

### 3.5 Data capabilities (not UI actions)

| Capability | Meaning |
|---|---|
| `scope.all` | Access every compound; otherwise scope is the assigned list |
| `pii.unmask` | Receive unmasked mobile, email, national ID, plates and owner names |
| `pii.export` | Include unmasked identifiers in exports (requires `export.sensitive`) |

---

## 4. Role → permission matrix

`Y` = granted · `—` = denied · `S` = granted within assigned compound scope.

| Permission | Top Management | Community Manager | Community Admin | Admin | Super Admin |
|---|:--:|:--:|:--:|:--:|:--:|
| period.view | Y | Y | Y | Y | Y |
| compound.view | Y | S | S | Y | Y |
| kpi.view | Y | Y | Y | Y | Y |
| dashboard.view | Y | S | S | Y | Y |
| compare.view | Y | S | S | Y | Y |
| trend.view | Y | S | S | Y | Y |
| insight.view | Y | S | S | Y | Y |
| snapshot.view | Y | S | S | Y | Y |
| quality.view | Y | S | S | Y | Y |
| quality.full | — | — | S | Y | Y |
| unit.list / unit.detail | Y | S | S | Y | Y |
| resident.list / resident.detail | — | S | S | Y | Y |
| resident.write | — | S | S | Y | Y |
| vehicle.list / detail / stats | Y | S | S | Y | Y |
| gatepass.list | Y | S | S | Y | Y |
| invitation.list | Y | S | S | Y | Y |
| access.list | Y | S | S | Y | Y |
| access.analytics | Y | S | S | Y | Y |
| identity.view | — | S | S | Y | Y |
| identity.decide | — | — (B1) | S | Y | Y |
| ai.use | Y | S | S | Y | Y |
| export.data | Y (masked) | S (masked) | S (masked) | Y | Y |
| export.sensitive | — | — | — (B2) | Y | Y |
| report.executive | Y | S | S | Y | Y |
| import.view | — | — | S | Y | Y |
| import.manage | — | — | S | Y | Y |
| import.rollback | — | — | — | Y | Y |
| period.delete | — | — | — | Y | Y |
| system.reset | — | — | — | — | Y |
| settings.view | — | — | S | Y | Y |
| settings.business | — | — | S | Y | Y |
| settings.system | — | — | — | — | Y |
| audit.view | — | — | S | Y | Y |
| user.manage | — | — | — | Y | Y |
| scope.all | Y | — | — | Y | Y |
| pii.unmask | — | — | — (B2) | Y | Y |
| pii.export | — | — | — | Y | Y |

**Notes**
- Top Management has portfolio read but **no resident-level PII** and no operational writes. This satisfies "executive oversight without operational access".
- Admin and Super Admin are the only roles that see unmasked identifiers portfolio-wide. Community Admin/Manager see masked data inside their scope.
- A user with neither `scope.all` nor any `user_compound_scopes` row is **denied** all scoped data (`403`, not empty data).

---

## 5. Route → permission mapping (authoritative)

| Method | Route | Permission | Scope enforced |
|---|---|---|---|
| GET | `/api/health` | public | — |
| POST | `/api/auth/login` | public (rate-limited) | — |
| GET | `/api/auth/me` | authenticated | — |
| POST | `/api/auth/logout` | authenticated + CSRF | — |
| GET | `/api/auth/users` | `user.manage` | n/a |
| POST | `/api/auth/users` | `user.manage` | n/a |
| PUT | `/api/auth/users/:id` | `user.manage` | n/a |
| PUT | `/api/auth/users/:id/scopes` | `user.manage` | n/a |
| GET | `/api/periods` | `period.view` | — |
| GET | `/api/compounds` | `compound.view` | yes |
| GET | `/api/kpi-definitions` | `kpi.view` | — |
| GET | `/api/dashboard` | `dashboard.view` | yes |
| GET | `/api/compare` | `compare.view` | yes |
| GET | `/api/units`, `/api/units/:id` | `unit.list`, `unit.detail` | yes |
| GET | `/api/users`, `/api/users/:id` | `resident.list`, `resident.detail` | yes |
| PUT | `/api/users/:id/image` | `resident.write` | yes |
| GET | `/api/vehicles`, `/api/vehicles/:id`, `/api/vehicles/stats` | `vehicle.*` | yes |
| GET | `/api/gatepasses` | `gatepass.list` | yes |
| GET | `/api/invitations` | `invitation.list` | yes |
| GET | `/api/access` | `access.list` | yes |
| GET | `/api/access/hourly`, `/api/access/heatmap` | `access.analytics` | yes |
| GET | `/api/trends` | `trend.view` | yes |
| GET | `/api/quality` | `quality.view` / `quality.full` | yes |
| GET | `/api/matching` | `identity.view` | yes |
| POST | `/api/matching` | `identity.decide` | yes |
| GET | `/api/insights` | `insight.view` | yes |
| GET | `/api/snapshots`, `/api/snapshots/:period` | `snapshot.view` | yes |
| POST | `/api/ai/ask` | `ai.use` | yes |
| GET | `/api/export` | `export.data`; sensitive fields require `export.sensitive` | yes |
| GET | `/api/report.xlsx` | `report.executive` | yes |
| POST | `/api/uploads` | `import.manage` | n/a |
| GET | `/api/imports*` | `import.view` | — |
| POST | `/api/imports/:id/process|reprocess|cancel` | `import.manage` | — |
| POST | `/api/imports/:id/rollback` | `import.rollback` | — |
| POST | `/api/periods/:period/delete` | `period.delete` | — |
| POST | `/api/admin/reset` | `system.reset` | — |
| GET | `/api/settings` | `settings.view` | — |
| PUT | `/api/settings` | `settings.business` + `settings.system` per key | — |
| GET | `/api/audit` | `audit.view` | — |
| `/api/hcp/*` | all | `import.manage` (Phase 2 admin) | — |

---

## 6. Authentication requirements

| Requirement | Decision |
|---|---|
| Identity provider now | Local email + password (scrypt) server session, because Entra ID is blocked on tenant consent |
| Identity provider future | Microsoft Entra ID via OIDC; same session/authorization layer, different authenticator |
| Session transport | `HttpOnly`, `SameSite=Lax`, `Secure` in production cookie; `Authorization: Bearer` supported for automation |
| Session lifetime | 8 hours idle / 12 hours absolute; revocable |
| CSRF | Double-submit token for cookie-authenticated state-changing requests |
| Password storage | `scrypt` with per-user random salt; timing-safe comparison |
| Bootstrap | Super Admin seeded from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`; otherwise a random password is written once to `data/bootstrap-admin.txt` |
| Login throttling | 5 failures per 15 minutes per IP+email, then `429` |
| Logout | Revokes the session row; audit event recorded |

---

## 7. Acceptance tests (mandatory)

| # | Scenario | Expected |
|---|---|---|
| 1 | Anonymous `GET /api/users` | `401` |
| 2 | Anonymous `POST /api/admin/reset` | `401` |
| 3 | Top Management `GET /api/users` | `403` |
| 4 | Community Manager requests another compound | `403` |
| 5 | Community Manager `GET /api/users` | masked mobile/email, no national ID |
| 6 | Community Manager `GET /api/export?entity=users` | masked export, audited |
| 7 | Admin `GET /api/users` | unmasked, audited |
| 8 | Community Admin `POST /api/matching` | allowed (B1 pending) |
| 9 | Community Manager `POST /api/matching` | `403` |
| 10 | Admin `POST /api/imports/:id/rollback` | allowed |
| 11 | Community Admin `POST /api/admin/reset` | `403` |
| 12 | Super Admin `POST /api/admin/reset` | allowed (confirmation still required) |
| 13 | `GET /api/dashboard?compound=<outside scope>` | `403` |
| 14 | State-changing request without CSRF header (cookie auth) | `403` |
| 15 | Repeated failed logins | `429` |
| 16 | Audit after denial | row with actor, action, result=DENIED, correlation ID |
| 17 | Mode switch Management↔Operations | no change in API permissions |
| 18 | Expired/revoked session | `401` |

---

## 8. Open policy decisions

| ID | Decision | Owner | Current default |
|---|---|---|---|
| B1 | May Community Manager decide identity matches? | Business | Denied |
| B2 | Who may see unmasked PII? | Data protection owner | Admin + Super Admin only |
| B3 | Which roles may export plates/mobiles? | Business + DPO | Admin + Super Admin |
| B4 | Period close/lock and restatement process | Finance + Operations | Snapshot written; no lock state |
| B5 | Owner of quality weights | Operations | Not weighted |
| B6 | HCP Phase 2 start and sample data | Palm Hills + Initium | Phase 2, not started |
