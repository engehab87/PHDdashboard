# Current API Inventory

**Base URL:** `http://localhost:2020`
**Evidence:** `backend/server.js` (52 routes) and `backend/hcp/routes.js` (12 routes) — 64 total.
**Authentication:** none on any route. **Authorization:** none on any route.

> All routes are reachable without a token, cookie or role. The table therefore omits an "auth" column; every route is **PUBLIC** today. Recommended permission identifiers are listed for the Stage 2 implementation.

---

## 1. Core read APIs

| Method | Path | Query / body | Returns | Permission (recommended) |
|---|---|---|---|---|
| GET | `/api/health` | — | `{ok,version}` | public |
| GET | `/api/periods` | — | periods + file counts | `period.view` |
| GET | `/api/compounds` | — | id/name list | `compound.view` |
| GET | `/api/kpi-definitions` | — | KPI catalog | `kpi.view` |
| GET | `/api/dashboard` | `period`, `compound` | cards, charts, warnings | `dashboard.view` + scope |
| GET | `/api/compare` | `period` | compound comparison rows | `compare.view` + scope |
| GET | `/api/units` | `compound,search,preset,sort,page,limit` | paged units | `unit.list` + scope |
| GET | `/api/units/:id` | — | unit + users/vehicles/passes/invitations/handover | `unit.detail` + scope |
| GET | `/api/users` | `status,type,compound,search,page,limit` | paged users | `resident.list` + scope |
| GET | `/api/users/:id` | — | user + units/vehicles/pass count/HCP count | `resident.detail` + scope |
| PUT | `/api/users/:id/image` | `{image_url}` | update user image | `resident.write` (policy) |
| GET | `/api/vehicles` | `status,search,page,limit` | paged vehicles | `vehicle.list` |
| GET | `/api/vehicles/stats` | `compound` | vehicle stats | `vehicle.view` + scope |
| GET | `/api/vehicles/:id` | — | vehicle detail | `vehicle.detail` |
| GET | `/api/gatepasses` | `period,compound,type,search,from,to,page,limit` | paged gate passes | `gatepass.list` + scope |
| GET | `/api/invitations` | `period,status,type,search,page,limit` | paged invitations | `invitation.list` + scope |
| GET | `/api/access` | `period,compound,direction,result,gate,search,from,to,page,limit` | paged HCP events | `access.list` + scope |
| GET | `/api/access/hourly` | `period,compound` | hourly aggregation | `access.analytics` + scope |
| GET | `/api/access/heatmap` | `period,compound` | day/hour heatmap | `access.analytics` + scope |
| GET | `/api/trends` | `period,metric` | trend series | `trend.view` + scope |
| GET | `/api/quality` | `period` | quality report | `quality.view` (summary/full) |
| GET | `/api/matching` | `period` | identity candidates | `identity.view` |
| GET | `/api/insights` | `period` | generated insight strings | `dashboard.view` + scope |
| GET | `/api/snapshots` | — | snapshot list | `snapshot.view` |
| GET | `/api/snapshots/:period` | — | snapshot detail + history | `snapshot.view` + scope |

## 2. Write and administrative APIs

| Method | Path | Body | Permission (recommended) |
|---|---|---|---|
| POST | `/api/matching` | match decision | `identity.decide` |
| POST | `/api/ai/ask` | `{question,periodKey,context}` | `ai.use` + scope |
| GET | `/api/export` | `entity,scope,filters` | `export.data` + scope; sensitive for PII |
| GET | `/api/report.xlsx` | `period,compound` | `report.executive` + scope |
| POST | `/api/uploads` | multipart `zip` | `import.manage` |
| GET | `/api/imports` | — | `import.view` |
| GET | `/api/imports/:id` | — | `import.view` |
| GET | `/api/imports/:id/summary` | — | `import.view` |
| GET | `/api/imports/:id/log` | — | `import.view` |
| GET | `/api/imports/:id/duplicates` | `page,limit,dataset` | `import.view` |
| GET | `/api/imports/:id/changes` | `page,limit,entity` | `import.view` |
| POST | `/api/imports/:id/process` | `{periodKey,overrides}` | `import.manage` |
| POST | `/api/imports/:id/reprocess` | — | `import.manage` |
| POST | `/api/imports/:id/cancel` | — | `import.manage` |
| POST | `/api/imports/:id/rollback` | `{confirm:true}` | `import.rollback` |
| POST | `/api/periods/:period/delete` | `{confirm:true,period}` | `period.delete` |
| POST | `/api/admin/reset` | `{confirm:true,phrase}` | `system.reset` |
| GET | `/api/settings` | — | `settings.view` |
| PUT | `/api/settings` | key/value map | `settings.business` / `settings.system` |
| GET | `/api/audit` | — | `audit.view` |

## 3. HCP administration APIs (`backend/hcp/routes.js`)

Mounted under `/api/hcp`. These are Phase 2 administration surfaces and are currently public.

| Method | Path | Purpose |
|---|---|---|
| GET | `/compounds` | HCP config per compound |
| POST | `/compounds` | Create config |
| GET | `/compounds/:id` | Read config (secrets redacted) |
| PUT | `/compounds/:id` | Update config/credentials |
| POST | `/compounds/:id/test` | Test connection |
| GET | `/runs/:runId` | Test run detail |
| GET | `/compounds/:id/history` | Run history |
| GET | `/compounds/:id/connectivity` | Connectivity state |
| POST | `/compounds/:id/check` | Run connectivity check |
| GET | `/vpn/status` | VPN status |
| POST | `/vpn/connect` | Connect VPN (real-world side effect) |
| GET | `/compounds/:id/capabilities` | Adapter capabilities |
| POST | `/compounds/:id/sync` | Start HCP sync |
| GET | `/sync/:runId` | Sync run detail |
| GET | `/compounds/:id/live/:category` | Live data |
| GET | `/compounds/:id/live-summary` | Live summary |
| GET | `/registry` | Adapter registry |
| GET | `/vehicle-comparison` | CRM vs HCP comparison |

## 4. Error and status conventions (current)

- Most handlers return `{ error: string }` with 400/404/500.
- Import start returns `202`; duplicate start returns `409`; missing import `404`.
- No error `code`, `correlationId` or field-level details.
- Unhandled exceptions fall through to Express's default HTML error page (no global error middleware).
- CORS is not configured (same-origin only).
- No rate limiting, request size limit beyond multer's 1 GB, or request logging.

## 5. Pagination and filtering

- `paged()` and `paged2()` clamp `limit` to 5,000 (lists) and 500 (import sub-lists).
- Stable ordering is only partially guaranteed: users order by name (ties not broken), units by unit_number, events by implicit row order.
- `total` is computed with a separate `COUNT(*)` query.
- Compound filtering is a name lookup; an unknown name yields an empty result, not an error.

## 6. Consumers

| Consumer | APIs used |
|---|---|
| `frontend/app-pages.js` | dashboard, compare, units, users, vehicles, gatepasses, invitations, access, trends, quality, matching, imports, snapshots, settings, audit, reports/exports |
| `frontend/app.js` | periods, compounds, uploads, import process/reprocess, AI ask, export, settings |
| HCP screens | `/api/hcp/*` |
| Scripts/tests | direct module calls plus HTTP in tests |

No external system consumes these APIs today, so a versioned `/api/v1` prefix can be introduced with a compatibility alias.

## 7. Contract gaps

- No OpenAPI/Swagger document.
- No DTO validation layer; bodies are used as supplied.
- No idempotency-key handling for generic writes.
- No `ETag`/caching headers.
- No documented permission per route (this document is the proposed source until the permission catalog is implemented).
