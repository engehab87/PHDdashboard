# API and Integration Contract

**Date:** 2026-11-06
**Status:** current contract + target contract
**Reference:** Initium Technical Proposal v1.0, sections 4.5–4.8, 8

---

## 1. Versioning and base path

- Current: `/api/*` on `http://localhost:2020`.
- Target: `/api/v1/*`, with `/api/*` aliased during transition. No external consumer exists today, so the move is low risk.
- Content type: `application/json` except exports (XLSX) and uploads (multipart).
- Correlation: every response carries `X-Correlation-Id` (generated if absent).

---

## 2. Error envelope (target)

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Outside your assigned communities",
    "correlationId": "3f1c...",
    "details": { "route": "/api/units", "compound": "Badya" }
  }
}
```

Compatibility: existing clients read `error` as a string. During transition the server returns
`{ "error": "<message>", "code": "...", "correlationId": "..." }` so old code keeps working.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid body/query |
| 401 | `UNAUTHENTICATED` | No/expired session |
| 403 | `FORBIDDEN` / `CSRF_FAILED` | Permission or scope denial |
| 404 | `NOT_FOUND` | Unknown entity |
| 409 | `CONFLICT` | Duplicate import start, version conflict |
| 422 | `UNPROCESSABLE` | Upload/import validation failure |
| 429 | `RATE_LIMITED` | Throttled |
| 500 | `INTERNAL` | Unexpected error (never include stack) |
| 503 | `UNAVAILABLE` | DB/worker unavailable |

---

## 3. Authentication contract

### `POST /api/auth/login`

```json
{ "email": "user@palmhills.com", "password": "..." }
```

`200`:
```json
{
  "user": { "id": 1, "email": "...", "displayName": "...", "role": "Community Manager", "permissions": ["dashboard.view", "..."], "scope": { "all": false, "compounds": [{ "id": 3, "name": "Badya" }] } },
  "csrfToken": "..."
}
```
Sets `ph_session` (HttpOnly) and `ph_csrf` (readable) cookies.

Errors: `401 INVALID_CREDENTIALS` (generic), `429 RATE_LIMITED`, `403 ACCOUNT_DISABLED`.

### `GET /api/auth/me`
Returns the same `user` object plus `csrfToken`. `401` when unauthenticated.

### `POST /api/auth/logout`
Revokes the session, clears cookies, writes an audit event.

### User administration (Super Admin / Admin)
- `GET /api/auth/users`
- `POST /api/auth/users` `{ email, displayName, role, password?, scopes?: [compoundId] }`
- `PUT /api/auth/users/:id` `{ displayName?, role?, status? }`
- `PUT /api/auth/users/:id/scopes` `{ compoundIds: [..] }`
- `POST /api/auth/users/:id/revoke-sessions`

All audited with before/after.

---

## 4. Pagination, sorting, filtering

Canonical list envelope:

```json
{
  "total": 34708,
  "page": 1,
  "limit": 50,
  "rows": [],
  "scope": { "compound": "all", "resolved": ["Badya", "..."] },
  "truncatedLowerBound": false
}
```

- `limit` max 5,000 (lists), 500 (import sub-lists).
- Stable ordering requires a tie-breaker: units `(unit_number, id)`, users `(name COLLATE NOCASE, id)`, vehicles `(plate_original, id)`, events `(COALESCE(enter_time,exit_time) DESC, id DESC)`.
- Applied filters are reflected in the URL by the frontend.
- Unknown sort values fall back to the default; never interpolate sort text into SQL.

---

## 5. Endpoint groups (see `CURRENT_API_INVENTORY.md` for all 64)

| Group | Endpoints | Permission family |
|---|---|---|
| Auth | `/auth/*` | public / authenticated / `user.manage` |
| Reference | `/periods`, `/compounds`, `/kpi-definitions` | `period.view`, `compound.view`, `kpi.view` |
| Analytics | `/dashboard`, `/compare`, `/trends`, `/insights`, `/snapshots` | `*.view` |
| Operations | `/units`, `/users`, `/vehicles`, `/gatepasses`, `/invitations`, `/access` | `*.list` / `*.detail` |
| Quality/identity | `/quality`, `/matching` | `quality.*`, `identity.*` |
| AI | `/ai/ask` | `ai.use` |
| Export/report | `/export`, `/report.xlsx` | `export.data`, `report.executive` |
| Import | `/uploads`, `/imports*` | `import.view`, `import.manage`, `import.rollback` |
| Admin | `/periods/:period/delete`, `/admin/reset`, `/settings`, `/audit` | `period.delete`, `system.reset`, `settings.*`, `audit.view` |
| HCP | `/hcp/*` | `import.manage` (Phase 2) |

---

## 6. Idempotency

| Operation | Key | Behaviour |
|---|---|---|
| Import processing | `imports.id` + status | `409` if already processing; reprocess is content-idempotent via fingerprints |
| Upload | `source_files(import_id, file_hash)` unique | Duplicate file in same import rejected |
| Future generic writes | `Idempotency-Key` header | Store key + response hash for 24 h |

---

## 7. Exports

### `GET /api/export`
Params: `entity` (`users|units|vehicles|invitations|gatepasses|access`), `scope` (`page|all`), filters, `period`.
- Requires `export.data`; unfiltered/full extracts require `export.sensitive` when the entity contains Tier 1/2 PII.
- Applies the actor's compound scope.
- Applies the PII masker unless `export.sensitive`.
- Writes an audit event with entity, row count, scope, masking flag.
- Large exports should become async jobs: `202 { jobId }` + progress endpoint. Current is synchronous.

### `GET /api/report.xlsx`
Executive workbook: summary, compound comparison, users by type, invitations, gate passes, access by day, quality, KPI definitions. Requires `report.executive`. The frontend label must say XLSX, not PDF, until a PDF renderer exists.

---

## 8. Upload contract

`POST /api/uploads` multipart field `zip` (or `file`).
Returns:
```json
{ "importId": 4, "files": [ { "filename": "...", "dataset": "ALL_USERS", "confidence": 0.98, "rows": 34769, "truncated": false } ], "detected": { "periodKey": null } }
```
When `detected.periodKey` is null, the client must ask for a month and call `/api/imports/:id/process` with `{ periodKey: "YYYY-MM" }`.

---

## 9. HCP integration boundary (Phase 2)

- Files are the only approved inbound channel in Phase 1.
- Direct HCP API/VPN code exists but is **preparation only**; no live call has been verified.
- HCP admin routes must never be exposed without `import.manage`.
- Secrets are write-only and encrypted at rest.
- Do not claim HCP integration is complete until a real period is processed end-to-end with production credentials.

---

## 10. OpenAPI and generated client (target)

1. Author `docs/openapi.yaml` from this contract and the route table.
2. Validate responses in tests.
3. Generate a typed client for the future React application.
4. Keep `/api/v1` stable; additive changes only within a major version.

---

## 11. Integration readiness

| Integration | Current | Blocked by | Claim status |
|---|---|---|---|
| Entra ID | Not implemented | Tenant app registration + consent | **Do not claim** |
| Dynamics 365 / Dataverse | Not implemented | Environment + service principal | **Do not claim** |
| Azure Database for PostgreSQL | Code converted; requires `DATABASE_URL` | Provisioned server + first `migrate()` run | **Do not claim until verified** |
| HCP live API | Code prepared, not verified | Network + credentials | **Do not claim** |
| Power BI | Not implemented | Contract + gateway | Not claimed |
| SMTP/notifications | Not implemented | Provider | Not claimed |

See `ENTRA_ID_AND_DYNAMICS_INTEGRATION_READINESS.md`.
