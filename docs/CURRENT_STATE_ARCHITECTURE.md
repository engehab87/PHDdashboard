# Current State Architecture

**Project:** Palm Hills Community Operations Intelligence Platform (Executive Dashboard)
**Audit date:** 2026-11-06
**Audit basis:** direct inspection of the running application, source files, SQLite schema and live API responses.
**Reference:** Initium Solutions, *Community Operations Intelligence Platform — Technical Proposal v1.0* (November 2026).

---

## 1. Executive summary

The application is a working, data-backed dashboard, not a mock-up. It already imports real monthly CRM packages, stores masters and events, computes KPIs and serves operational lists. The prototype described in the Initium proposal ("in-memory data, browser-flag session, simulated imports/exports, fixed AI answer") has since been partially productised: imports, KPI calculation, exports and AI are now real.

The primary architectural gap is **security**: there is no authentication, no server-side authorization, no compound scoping, no PII masking and only a minimal audit helper. Every one of the 64 HTTP routes is publicly reachable. UI role switching is cosmetic.

A second gap is **contract discipline**: business logic is embedded in route handlers and in `frontend/*.js`; there is no OpenAPI contract, no DTO layer and no centralized permission policy.

A third gap is **KPI governance**: dashboard KPIs are computed live from base tables on every request rather than read from the locked monthly `period_snapshots` row, so a late-arriving correction silently changes a "closed" month.

---

## 2. Verified technology stack

| Layer | Actual implementation | Evidence |
|---|---|---|
| Runtime | Node.js 24 (`node:sqlite` built-in) | `backend/db.js:2` |
| HTTP framework | Express 4.19 | `package.json`, `backend/server.js` |
| Database | **SQLite** (file `data/app.db`, WAL mode) — **not MySQL** | `backend/db.js:8-12`; live file 551 MB |
| Frontend | Vanilla JavaScript, server-served static files, hash router | `frontend/index.html`, `frontend/app.js:90-134` |
| Charts | Hand-rendered HTML/CSS bars (no chart library) | `frontend/app-pages.js` |
| Excel parsing | SheetJS `xlsx` | `backend/ingest.js` |
| ZIP handling | `adm-zip` | `backend/ingest.js:13` |
| Upload | `multer`, 1 GB limit, disk storage | `backend/server.js:34-45` |
| Documents | `docx`, `pdf-parse` (audit tooling) | `package.json` |
| AI | Local deterministic answer engine; optional OpenAI-compatible HTTP call | `backend/ai.js:231-261` |
| Background jobs | Child-process worker per import | `backend/jobs/runner.js`, `backend/jobs/run-import.js` |
| Tests | `node:test` suites under `tests/` | `package.json` scripts |

> **Important correction to the task brief:** the running system is SQLite, not MySQL. All database migration documentation is therefore written as SQLite → Azure SQL, with a MySQL-compatibility note where relevant.

---

## 3. Process and deployment topology

```
Browser (vanilla JS SPA, hash routes)
        │  HTTP, no auth headers or session
        ▼
Express server (single process, port 2020)
   ├── static frontend (frontend/)
   ├── /api/* route handlers (business logic inline)
   ├── /api/hcp/* HCP administration and sync
   └── child process per import (node backend/jobs/run-import.js)
                │
                ▼
        SQLite data/app.db  (WAL)
        data/uploads/       (uploaded packages)
        data/raw/import_N/  (extracted files)
```

- Long imports no longer block the event loop: the route returns `202` and a detached worker performs the synchronous ingestion (`backend/server.js:404-429`).
- The server is a single instance. There is no horizontal scaling, queue, cache tier or reverse proxy in the current environment.
- `data/app.db` is the only persistent store. There is no external object storage; uploaded ZIPs are retained on local disk.

---

## 4. Backend structure

| File | Responsibility | Notes |
|---|---|---|
| `backend/server.js` | All non-HCP API routes, uploads, exports, settings, audit endpoint, static hosting | ~496 lines; route handlers contain SQL and business rules |
| `backend/db.js` | Schema, additive migrations, `audit()` helper | 18 domain tables + governance tables |
| `backend/kpis.js` | KPI catalog (`DEFINITIONS`), `computeDashboard`, `compareCompounds`, `periodIdOf` | Central calculation layer; reads live tables |
| `backend/quality.js` | Data-quality report and issue detection | File-level and record-level issues |
| `backend/ingest.js` | ZIP extraction, classification, validation, normalization, load, snapshots, rollback, delete/reset | ~78 KB, the largest module |
| `backend/datasets.js` | Dataset signatures, filename patterns, column maps | Structure-first classification |
| `backend/normalize.js` | Name, phone, unit, plate and compound normalization | Preserves raw values in separate columns |
| `backend/ai.js` | Grounded local answer generator + optional provider verbalization | Read-only |
| `backend/jobs/runner.js` | Child-process import orchestration, PID tracking, restart recovery | Added Nov 2026 |
| `backend/jobs/run-import.js` | Worker entry point | Added Nov 2026 |
| `backend/hcp/*` | HCP credentials, connectivity checks, VPN helper, adapters, sync | 11 files, extensive Phase 2 surface |

### Business logic location

- KPI formulas: `backend/kpis.js` (good, centralized).
- Import rules: `backend/ingest.js` (centralized but infrastructure-coupled).
- Authorization rules: **none exist**.
- Frontend business logic: route allowlists, role metadata and display gating live in `frontend/app.js:66-88`; pages read/write state directly in `frontend/app-pages.js`.

---

## 5. Frontend structure

| File | Responsibility | Notes |
|---|---|---|
| `frontend/index.html` | Shell, fonts, style links, script order (`app-pages.js` then `app.js`) | Only active entry point |
| `frontend/app.js` | `PalmApp` state, hash router, shell render, API client, import UI, filters | ~700 lines |
| `frontend/app-pages.js` | All page renderers keyed on route | ~1,400 lines |
| `frontend/styles.css` | Primary design system | |
| `frontend/style.css` | Secondary/legacy stylesheet | Duplication risk |
| `frontend/app_pages.js` | **Unused legacy file** (underscore name, not loaded) | Dead code; should be removed after confirmation |

### Navigation and pseudo-roles

`frontend/app.js:66-88` defines **three** profiles, not the five business roles:

| UI profile | Treats as | Route allowlist |
|---|---|---|
| Super Admin | role | all 21 routes |
| Management | role **and** presentation mode | overview, comparison, trends, AI, reports, KPI definitions, data quality, residents, units |
| Operations | role **and** presentation mode | overview, vehicles, access, gate passes, invitations, visitors, face, identity, HCP live/counts, quality, connectivity |

The header buttons labelled **Management** and **Operations** call `PalmApp.setRole()` (`frontend/app.js:252-253`), which changes the permission allowlist. This directly contradicts the proposal's rule that *Management and Operations are presentation modes, not security roles*. There is no separate `mode` state.

### State and API access

- State is a plain object on `PalmApp.state` (period, compound, route, filters, role).
- `api()` performs `fetch` with no credentials and no CSRF token.
- Lists request server pages, but several pages still post-filter or aggregate in the browser.
- Detail drawers call `/api/units/:id`, `/api/users/:id`, `/api/vehicles/:id`.

---

## 6. Authentication and authorization (current)

| Control | Status | Evidence |
|---|---|---|
| Authentication | **NOT IMPLEMENTED** | No middleware, no session, no token validation anywhere in `backend/` |
| Entra ID / MSAL | **NOT IMPLEMENTED** | No MSAL dependency or configuration |
| Server-side role checks | **NOT IMPLEMENTED** | Route handlers never read a role |
| Permission identifiers | **NOT IMPLEMENTED** | No permission catalog |
| Compound scoping | **NOT IMPLEMENTED** | `compound` query parameter is trusted as supplied |
| PII masking | **NOT IMPLEMENTED** | `/api/users` returns `mobile`, `email`; `/api/users/:id` returns `national_id`; vehicles return full plates |
| Audit actor | **PARTIAL** | `audit()` defaults actor to `'system'`; routes do not pass a real actor |
| Audit coverage | **PARTIAL** | Imports, settings, exports, reports, AI, matching and image update log; authentication and authorization denials cannot be logged because they do not exist |
| Rate limiting | **NOT IMPLEMENTED** | |
| Security headers / HTTPS | **NOT IMPLEMENTED** at app level | Plain HTTP on port 2020 |
| CSRF | **NOT APPLICABLE YET** | No cookie session exists; becomes required when auth is added |

---

## 7. Data flow

### Monthly import

1. `POST /api/uploads` (multer) stores the package in `data/uploads/`.
2. `stageUpload()` extracts safe entries to `data/raw/import_N/`, classifies each file by column signature, records `source_files` and `raw_files`, and detects the period from HCP event timestamps.
3. If the period is `null`, the API returns the staged import and the UI requires month confirmation (CRM-only packages have no HCP timestamps).
4. `POST /api/imports/:id/process` starts a child worker and returns `202`.
5. The worker calls `processImport(id, periodKey)`, which validates schemas, normalizes rows, upserts masters with field-level history, inserts fingerprinted events, writes `period_metrics` and a `period_snapshots` row, and updates import status/logs.
6. Startup recovery marks interrupted `PROCESSING`/`VALIDATING` imports as `FAILED` unless their recorded worker PID is still alive.

### Dashboard read

1. `GET /api/dashboard?period=&compound=` → `computeDashboard()`.
2. `computeDashboard()` queries `units`, `user_units`, `users`, `vehicles`, `hcp_vehicle_events`, `invitations`, `gate_passes` directly for the requested period, with no permission or scope validation.
3. The frontend renders cards and charts from the JSON.

---

## 8. Current state versus proposal target (summary)

| Proposal capability | Current state |
|---|---|
| Entra ID sign-in | Absent; simulated UI sign-in with `sessionStorage` |
| Five business roles | Three UI profiles; modes conflated with roles |
| Server authorization | Absent |
| Compound scope enforcement | Absent |
| Role-based PII masking | Absent |
| Append-only audit with actor/correlation/before-after | Minimal helper, no actor propagation |
| Governed KPI snapshot as source of truth | Snapshots written, but dashboard reads live tables |
| Asynchronous, restartable, idempotent imports | **Implemented and verified** (child process, PID recovery, fingerprint idempotency) |
| Server-side paging/sorting/filtering | Partially implemented (`/api/units`, `/api/users`, `/api/vehicles`, events) |
| Real exports | Implemented, synchronous, unmasked, unscoped |
| Grounded AI | Local deterministic engine grounded in computed KPIs; optional provider verbalization |
| Data-quality engine | Partial rule set (files, completeness, duplicates, referential checks) |
| HCP integration | Extensive Phase 2 code: storage, credentials, connectivity, adapters, sync; not required for Phase 1 |
| React 19 / ASP.NET Core / Azure SQL | Not present; documented as future state only |

---

## 9. Deployment and operability

- Start command: `node backend/server.js` (from project root) with `.env` loaded by the process environment.
- Port: `2020` (`PORT` in `.env`).
- Database path: `DB_PATH=data/app.db`.
- Logs: `server.log` (stdout). No structured logging, correlation IDs or log rotation.
- Health: `GET /api/health` returns `{ok:true,version}` only — it does not test the database, workers or last successful import.
- Backup: no automated backup. A manual consistent backup script now exists at `scripts/backup-db.js` (added during this audit).
- Recovery: child-process imports are restart-aware; no other job recovery exists.

---

## 10. Architectural risks

1. **Complete absence of authentication/authorization** — any network client can read all resident PII and trigger destructive endpoints (rollback, period deletion, full reset). The destructive endpoints require a typed confirmation but no identity.
2. **PII exposure** — names, mobiles, emails, national IDs and plates are returned unmasked to any caller.
3. **KPI drift** — live computation means historical totals can change after reprocessing; snapshots are not authoritative.
4. **Single-process SQLite** — adequate for current volumes, but synchronous queries and a single writer limit concurrency; some list queries are heavy.
5. **Dead/duplicated frontend code** — `app_pages.js`, `style.css` and `styles.css` create maintenance ambiguity.
6. **No API contract** — future React/ASP.NET Core migration has no generated client or stable DTOs.
7. **Local-only file storage** — uploads and raw extracts are on the application disk; no retention policy or malware scanning.

---

## 11. Evidence index

| Claim | Evidence |
|---|---|
| No auth middleware | `grep` across `backend/` finds no `req.user`, `authorization`, session or JWT handling |
| 64 public routes | route inventory in `CURRENT_API_INVENTORY.md` |
| PII returned | live `GET /api/users?limit=1` returns `mobile`/`email`; `GET /api/users/:id` returns `national_id` |
| Live KPI computation | `backend/kpis.js` queries base tables; `period_snapshots` is not read by `computeDashboard` |
| Child-process imports | `backend/jobs/runner.js`; verified 202 response in 553 ms and 8–14 ms health responses during a 31 MB import |
| Restart recovery | verified: interrupted import marked FAILED with recovery message after server restart |
| Idempotent reprocess | verified: second run reported `new=0`, all records unchanged/duplicate, totals identical |
| SQLite not MySQL | `backend/db.js:2,11`; `data/app.db` header |
