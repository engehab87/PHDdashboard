# HCP Integration — API Specifications

> **Palm Hills Community Operations Intelligence Platform**
> **Document date:** Sun Oct 18 2026
> **Stack:** Node.js v24.21.0 + Express 4 + PostgreSQL (`pg`, Azure Database for PostgreSQL) + SheetJS
> **Backend port:** `http://localhost:2020` (configurable via `PORT` env)
> **Frontend port:** Served by XAMPP Apache on `:80`; CORS allows `:80` → `:2020`
>
> This document specifies:
> 1. Supported **Open API versions** (Hikvision OpenAPI / Artemis guide versions)
> 2. Supported **HCP versions** (HikCentral Professional platform versions)
> 3. **API calls required for syncing dashboard records from HCP** (both `/api/hcp` dashboard-facing and the underlying HCP OpenAPI endpoints called by adapters)
> 4. Authentication model, sync flow, version-matching rules, and limitations

---

## Table of Contents

1. [Supported Open API Versions](#1-supported-open-api-versions)
2. [Supported HCP Versions](#2-supported-hcp-versions)
3. [Version Registry & Matching Rules](#3-version-registry--matching-rules)
4. [Adapter Overview](#4-adapter-overview)
5. [Authentication Model](#5-authentication-model)
6. [API Calls Required for Syncing Dashboard Records from HCP](#6-api-calls-required-for-syncing-dashboard-records-from-hcp)
   - 6.1 HCP OpenAPI Endpoints (called by the Artemis v2.6 adapter)
   - 6.2 Dashboard-Facing HCP API (`/api/hcp`) endpoints
7. [Sync Flow (End-to-End)](#7-sync-flow-end-to-end)
8. [Connection Diagnostic Stages](#8-connection-diagnostic-stages)
9. [VPN / FortiClient Integration](#9-vpn--forticlient-integration)
10. [Data Sync Categories & Normalization](#10-data-sync-categories--normalization)
11. [Security & Limitations](#11-security--limitations)
12. [Environment Variables](#12-environment-variables)
13. [Errors & Status Codes](#13-errors--status-codes)

---

## 1. Supported Open API Versions

| OpenAPI Version | Adapter ID | Guide / Source | Status | Live API Verified |
|---|---|---|---|---|
| `2.6` | `hcp-artemis-v26` | Hikvision HikCentral Professional OpenAPI Developer Guide V3.1.1 (`https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html`) | Implemented, unverified against live server | **No** (`verified: false`) |
| `1.x` / `2.x` (retired) | `hcp-openapi-v1-generic` | None (no official guide attached; `docs/hcp/` absent) | **RETIRED — matches nothing** | N/A |

**Notes:**
- The retired generic template (`hcp-openapi-v1-genc`) previously claimed unverified HCP 2.x/1.x compatibility. That claim was withdrawn; its `hcpVersions: []` and `openapiVersions: []` mean it matches **nothing**.
- OpenAPI version and HCP platform version are **separate axes** and are never treated as interchangeable.
- Selection requires **exact equality** after normalization (leading `V` stripped, trimmed). No major-version prefix wildcards (`2.x` never matches `2.6.0`).

---

## 2. Supported HCP Versions

| HCP Platform Version | OpenAPI Version | Adapter ID | Doc Revision | Verified |
|---|---|---|---|---|
| `2.6.0` | `2.6` | `hcp-artemis-v26` | `V3.1.1_20260723` | **No** (pending live server verification) |
| *(none — retired)* | *(none — retired)* | `hcp-openapi-v1-generic` | — | N/A |

**Configuration fields (stored in `compound_hcp` table):**
- `hcp_version` — administrator-confirmed platform version (e.g. `2.6.0`)
- `openapi_version` — administrator-confirmed OpenAPI/guide version (e.g. `2.6`)
- `detected_hcp_version` — populated only by live discovery (Phase 2 adapter), reserved, not executed in Phase 1
- `hcp_build` — currently NULL, to be confirmed against installed release
- `openapi_build` — currently NULL
- `version_source` — `manual` (default); auto-detect reserved for Phase 2
- `base_url`, `hcp_host`, `hcp_port` (default 443), `https` (0/1), `tls_verify` (0/1), `tls_ca` (PEM), `camera_index_code`, `read_timeout_ms`

---

## 3. Version Registry & Matching Rules

**Source:** `backend/hcp/registry.js`

Rules (enforced Oct 2026 review):
1. HCP product version and OpenAPI/guide version are separate fields — never interchangeable.
2. Selection is **exact version equality** after `normVersion()` (trim + strip leading `V`/`v`).
3. No major-version prefix wildcards: `"2.x"` never matches `2.6.0`; a `2.6.1` entry never matches `2.6.0`.
4. An entry with empty version lists matches **nothing** (retired template).
5. Unverified entries may be returned as diagnostic candidates, but sync and live auth require `verified === true` (enforced by the sync gate).
6. Only adapters backed by official Hikvision documentation checked into `docs/hcp/` may be marked `verified`. Never invent endpoints.

**Match function:** `matchAdapter(entries, { hcpVersion, openapiVersion })` returns the first entry where:
- `hcpVersions` (normalized) includes the normalized `hcpVersion`, AND
- if `openapiVersion` is provided and the entry lists `openapiVersions`, the entry must list it exactly.

**Registry entries:** `GET /api/hcp/registry` (sanitized — secrets stripped).

---

## 4. Adapter Overview

| Field | Value (Artemis v2.6) |
|---|---|
| Adapter ID | `hcp-artemis-v26` |
| Label | Hikvision Artemis OpenAPI v2.6 (HCP 2.6.0 / OpenAPI 2.6) |
| HCP Versions | `['2.6.0']` |
| OpenAPI Versions | `['2.6']` |
| Doc Title | Hikvision HikCentral Professional OpenAPI Developer Guide V3.1.1 |
| Doc Location | `https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html` |
| Doc Revision | `V3.1.1_20260723` |
| Auth | AK/SK digest: HMAC-SHA256(appSecret, signatureString) base64 |
| Auth Headers | `X-Ca-Key`, `X-Ca-Signature`, `X-Ca-Signature-Headers`, `X-Ca-Timestamp`, `X-Ca-Nonce` |
| Endpoints | 4 read-only POST endpoints (see §6.1) |
| Categories | `persons`, `vehicles`, `access-events`, `visitors` |
| Schema Version | `hcp-normalized/1.0.0` |
| Verified | `false` (pending live server verification) |
| Biometric data | NEVER retrieved or stored |

**Adapter contract** (`backend/hcp/adapters/base.js`): every adapter implements `id`, `authenticate()`, `checkPermissions()`, `fetchCategory()`, `normalize()`, and `mappingVersion`.

---

## 5. Authentication Model

### 5.1 Dashboard Application Auth
- **No login/roles layer exists** (trusted intranet, SRS §3).
- State-changing endpoints require explicit intent (`{ "confirm": true }`) where destructive.
- All endpoints are audit-logged; secrets never returned.
- Deployment behind the internet **MUST** add real authN/Z in front.

### 5.2 HCP OpenAPI Auth (Artemis v2.6 adapter)
- Credentials stored **encrypted** (AES-256-GCM) in `compound_credentials.app_secret_enc`; key from `HCP_VAULT_KEY` env (64 hex chars = 32 bytes).
- `app_key` is displayable; `app_secret_enc` / `vpn_password_enc` always return `***set***`.
- Blank secret fields on edit preserve the stored value.
- Changing `HCP_VAULT_KEY` orphans old secrets → re-enter them.
- Missing/invalid vault key → `503` with setup instructions.

### 5.3 AK/SK Signature (per official guide V3.1.1)

Signature string construction:
```
METHOD + "\n" + Accept + "\n" + Content-MD5 + "\n" + Content-Type + "\n" + Date + "\n" + SignedHeaders + Uri
```

- `SignedHeaders` = lowercase header names sorted alphabetically, each as `name:value`
- Excluded from signature: `X-Ca-Signature`, `X-Ca-Signature-Headers`, `Accept`, `Content-MD5`, `Content-Type`, `Date`, `Content-Length`, `Server`, `Connection`, `Host`, `Transfer-Encoding`, `X-Application-Context`, `Content-Encoding`
- Signature = `Base64(HMAC-SHA256(appSecret, signatureString), UTF-8)`
- `X-Ca-Key` carries the `appKey`
- Headers sent: `accept`, `content-md5`, `content-type`, `date`, `x-ca-key`, `x-ca-timestamp`, `x-ca-nonce`, `x-ca-signature-headers`, `x-ca-signature`
- `date` = ISO UTC string (`new Date().toUTCString()`)
- `x-ca-timestamp` = `Date.now().toString()` (epoch ms)
- `x-ca-nonce` = UUID v4
- `content-type` = `application/json;charset=UTF-8`
- `accept` = `application/json`

All HCP API traffic is **read-only POST**. TLS verification always enabled via per-compound `https.Agent` with optional pinned CA. `rejectUnauthorized:false` is used **only** by the handshake-only `tlsInspect()` diagnostic, never for API requests.

---

## 6. API Calls Required for Syncing Dashboard Records from HCP

This section has two parts:
- **§6.1** The HCP OpenAPI endpoints called by the Artemis adapter to fetch records from the HCP server.
- **§6.2** The dashboard-facing REST API (`/api/hcp`) that orchestrates sync, stores results, and serves synced data to the frontend.

### 6.1 HCP OpenAPI Endpoints (Artemis v2.6 Adapter)

All endpoints are `POST` under base path `/artemis/api`. Base URL: `{http|https}://{hcp_host}:{hcp_port|443}`.

| # | Endpoint | Purpose | Category | Required Params | Pagination | Time Window | Max Page Size |
|---|---|---|---|---|---|---|---|
| 1 | `POST /artemis/api/common/v1/version` | Version discovery / auth test | System | `body: {}` | N/A | N/A | N/A |
| 2 | `POST /artemis/api/pms/v1/crossRecords/page` | Vehicle access events (entrance/exit) | `vehicles` / `access-events` | `cameraIndexCode`, `startTime`, `endTime`, `pageNo`, `pageSize` | Yes (`hasMore` via `list.length === pageSize`) | 31-day window | 500 |
| 3 | `POST /artemis/api/resource/v1/person/personList` | Persons (residents, staff, etc.) | `persons` | `pageNo`, `pageSize` | Yes | N/A | 500 |
| 4 | `POST /artemis/api/visitor/v1/appointment/appointmentlist` | Visitor appointments | `visitors` | `pageNo`, `pageSize` | Yes | N/A | 500 |

#### 6.1.1 `POST /artemis/api/common/v1/version` — Version Discovery / Auth Test
- **Purpose:** Proves `appKey`/`appSecret` are valid and the OpenAPI gateway is reachable. Used as the `authenticate()` step in the connection test and sync gate.
- **Request body:** `{}`
- **Success response:** HTTP 2xx, JSON with `code === "0"`, `data.softVersion` = detected HCP platform version string.
- **Failure:** `code !== "0"` → auth-failure; non-JSON → invalid-response; network error → API_UNREACHABLE.
- **Notes:** Documented discovery call is reserved for the Phase 2 adapter; not executed in Phase 1 diagnostics (reported as `blocked`).

#### 6.1.2 `POST /artemis/api/pms/v1/crossRecords/page` — Vehicle Access Events
- **Purpose:** Fetch paginated vehicle entrance/exit records from HCP. Synced to `hcp_live_events` table.
- **Required:** `cameraIndexCode` (per-compound config field or call opt). Without it → `blocked: missing-camera`.
- **Time window:** `startTime` / `endTime` limited to a 31-day window (default: now − 30 days → now). Format: ISO `...+00:00`.
- **Pagination:** `pageNo` (default 1), `pageSize` (default 100, max 500). `hasMore` = `list.length === pageSize`.
- **Response:** `{ code, msg, data: { list: [...], total } }`
- **Normalization maps:** `crossRecordSyscode` → `source_id`; `plateNo` → `data.plate`; `vehicleDirectionType` (1=EXIT, 2=ENTRY) → `data.direction`; `cameraIndexCode` → `data.gate`; `ownerName` → `data.ownerRef`; `crossTime` → `data.event_time`.
- **Biometric:** Never retrieved or stored.

#### 6.1.3 `POST /artemis/api/resource/v1/person/personList` — Persons
- **Purpose:** Fetch paginated person records from HCP. Synced to `hcp_live_persons` table.
- **Request body:** `{ pageNo, pageSize }`
- **Response:** `{ code, msg, data: { list: [...], total } }`
- **Normalization maps:** `personId` → `source_id`; `name` → `data.name`; `personType` → `data.userType`; `unitRef` → `data.unitRef`.
- **Biometric:** Never retrieved or stored.

#### 6.1.4 `POST /artemis/api/visitor/v1/appointment/appointmentlist` — Visitors
- **Purpose:** Fetch paginated visitor appointment records from HCP. Synced to `hcp_live_visitors` (normalized as `visitors`).
- **Request body:** `{ pageNo, pageSize }`
- **Response:** `{ code, msg, data: { list: [...], total } }`
- **Normalization maps:** `visitorId` or `id` → `source_id`; `visitorName` or `name` → `data.visitor`; `hostName` → `data.hostRef`; `status` → `data.status`.

### 6.2 Dashboard-Facing HCP API (`/api/hcp`) Endpoints

All mounted at `/api/hcp` on the Express backend (`backend/hcp/routes.js`).

| Method | Endpoint | Description | Auth / Guard | Body |
|---|---|---|---|---|
| GET | `/registry` | List adapter registry entries (sanitized) | None | — |
| GET | `/compounds` | List all compounds with integration/net/HCP summary | None | — |
| POST | `/compounds` | Create a compound | None | `{ name, description }` |
| GET | `/compounds/:id` | Compound detail (full config, last test, last sync, live counts) | None | — |
| PUT | `/compounds/:id` | Update compound (network, HCP config, credentials; blank secrets preserve existing) | `validateHcpConfig()`; vault required for secret changes | `{ name, integrationMode, enabled, configStatus, notes, network, hcp, creds }` |
| POST | `/compounds/:id/test` | Run 9-stage connection diagnostic (async, 202) | None | `{ kind }` |
| GET | `/runs/:runId` | Poll test run stages | None | — |
| GET | `/compounds/:id/history` | Test runs + sync runs (last 20 each) | None | — |
| GET | `/compounds/:id/capabilities` | HCP capability states | None | — |
| POST | `/compounds/:id/sync` | Start incremental sync (202, fail-closed gate) | `syncGate` — blocked if connectivity down/unknown, adapter unverified, credentials missing/undecryptable, VPN not connected (if enabled) | — |
| GET | `/sync/:runId` | Poll sync run result | None | — |
| GET | `/compounds/:id/live/:category` | Paged live data browser (persons\|vehicles\|events), provenance-labelled | None | `?page, ?limit` |
| GET | `/compounds/:id/live-summary` | Dashboard summary: connectivity, counts, versions, last sync, events-by-day | None | — |
| GET | `/compounds/:id/connectivity` | Connectivity state + recent checks + gate verdict | None | — |
| POST | `/compounds/:id/check` | On-demand health observation (bypasses backoff) | None | — |
| GET | `/vpn/status` | FortiClient VPN status | None | — |
| POST | `/vpn/connect` | Connect FortiClient tunnel (requires `{ confirm: true }`) | `{ confirm: true }`; audit-logged | `{ confirm, host, port, compoundId }` |

---

## 7. Sync Flow (End-to-End)

### 7.1 Prerequisites (Sync Gate — `syncGate`)
Before any sync, the gate checks (all must pass):
1. **Connectivity** — `compound_connectivity.conn_state === 'up'` (not `down`/`degraded`/`unknown`)
2. **Adapter** — resolved adapter exists AND `verified === true`
3. **Credentials** — `app_key` present AND `app_secret_enc` decryptable with current `HCP_VAULT_KEY`
4. **VPN** — if `FORTICLIENT_ENABLED=true`, tunnel must be connected (`VPN_NOT_CONNECTED` blocks otherwise)

If any condition fails → `POST /compounds/:id/sync` returns `400` with reasons; sync is **blocked**, never forced.

### 7.2 Sync Execution (`doSync`)
1. Insert `hcp_sync_runs` row (`status` starts running, `schema_version = 'hcp-normalized/1.0.0'`)
2. Resolve adapter class from `ADAPTER_CLASSES` map
3. Decrypt `app_secret` via vault; instantiate adapter with `{ compound, hcp, creds, net }`
4. For each category in `adapter.categories` (e.g. `['persons','vehicles','access-events','visitors']`):
   - Call `ga.fetchCategory(cat)` with up to 3 retries (`withRetry`)
   - If `page.blocked` → increment `blocked`, skip category (never recorded as completed zero-records)
   - Otherwise accumulate `retrieved += page.records.length`
5. **Outcome:**
   - `retrieved === 0 && failed === 0` → status `blocked`, summary explains blocked categories; `last_sync_at` NOT updated; historical data untouched
   - `retrieved > 0` → status `completed`, `last_sync_at` updated; records normalized and staged to `hcp_live_*` tables (insert/upsert logic per category)
   - Exception → status `failed` with `error_summary`
6. Audit-log result: `hcp.sync.result` with retrieved/inserted/duplicates/failed/blocked counts
7. Poll status via `GET /sync/:runId`

### 7.3 Data Storage (Normalized)
Synced records are stored with provenance `live-hcp` in additive tables:

| Table | Category | Key Fields |
|---|---|---|
| `hcp_live_persons` | persons | `compound_id`, `source_id`, `hcp_version`, `openapi_version`, `adapter_id`, `source_entity`, `event_time`, `retrieved_at`, `provenance`, `data` (JSON) |
| `hcp_live_vehicles` | vehicles | same base + `data.plate`, `data.direction`, `data.gate`, `data.ownerRef`, `data.event_time` |
| `hcp_live_events` | access-events | same base + vehicle event fields |
| `hcp_sync_cursors` | (Phase 2) | schema for incremental resume (not yet wired) |

**Data-source labelling (dashboard):**
- **Uploaded files** — monthly ZIP engine (unchanged)
- **Live HCP (cached)** — `hcp_live_*` tables, `provenance='live-hcp'`
- **Historical snapshots** — `period_snapshots`, never overwritten by syncs
- **Sample** — only in tests/docs, never in UI as live

---

## 8. Connection Diagnostic Stages

Nine stages, in order, run on `POST /compounds/:id/test` (async, polled via `GET /runs/:runId`). Later stages never claim what earlier ones did not prove.

| # | Stage | What It Verifies | Blocked / Fail Conditions |
|---|---|---|---|
| 1 | `vpn-state` | Host configured, connectivity row exists, link state, HTTPS-on-443 combo | Missing host; `down`/`unknown` link; HTTPS disabled on port 443 |
| 2 | `route-tcp` | DNS resolution + TCP open to host:port | DNS fail; port refused/unreachable |
| 3 | `tls` | TLS handshake + certificate verification (fail-closed) | `tls_verify=0` → refused; cert error → inspect-only handshake, show fingerprint |
| 4 | `service-reach` | HTTP GET to server root (any status proves web service answers) | No HTTP response despite open route |
| 5 | `version-identify` | Administrator-configured HCP/OpenAPI versions (manual) | Mismatch between configured and detected; discovery call reserved for Phase 2 |
| 6 | `adapter-compat` | Exact version match → adapter selected | No compatible adapter; unverified adapter → blocked message |
| 7 | `auth` | Decrypt secret, instantiate adapter, call `authenticate()` (version discovery) | Missing key/secret; decrypt failure; adapter class missing; auth failure |
| 8 | `readonly-op` | Phase 1 executes no API operations | Always `blocked` in Phase 1 (discovery call reserved for Phase 2) |
| 9 | `sync-state` | `syncGate` verdict | Any gate reason → warning |

**Run outcomes:** `completed` (gate open) or `failed`/`blocked` (gate blocked with reasons). `last_sync_at` updates only when records were actually retrieved.

---

## 9. VPN / FortiClient Integration

**Source:** `backend/hcp/vpn.js`, endpoints `GET /api/hcp/vpn/status` and `POST /api/hcp/vpn/connect`.

- Provider: FortiClient CLI (`forticli.exe`), path from `FORTICLIENT_CLI` env
- Tunnel/profile: `FORTICLIENT_TUNNEL` env
- Enabled only when `FORTICLIENT_ENABLED=true` (disabled by default — no tunnel ever created/dialed by backend)
- Methods: `getStatus()` (`-vpnstatus`), `connect()` (`-vpnconnect <tunnel>`, concurrency-protected), `checkRouteAndReachability()` (DNS + TCP), `getHealth()` (VPN + route/TCP + TLS handshake)
- Uses `child_process.execFile` with fixed executable path and fixed argument arrays — **never shell command strings, never HTTP-supplied arguments**
- `POST /vpn/connect` requires `{ "confirm": true }`; audit-logged; no credentials accepted from browser requests (all VPN config from env vars)
- After connect, independently verifies route + TCP + TLS to the compound's HCP endpoint
- Additive migration columns: `compound_connectivity.vpn_state`, `vpn_tunnel`, `vpn_last_check`

---

## 10. Data Sync Categories & Normalization

| Category | HCP Endpoint | Target Table | Required Config | Notes |
|---|---|---|---|---|
| `persons` | `POST /artemis/api/resource/v1/person/personList` | `hcp_live_persons` | appKey/appSecret | personId → source_id |
| `vehicles` / `access-events` | `POST /artemis/api/pms/v1/crossRecords/page` | `hcp_live_vehicles` / `hcp_live_events` | **cameraIndexCode** (required) | 31-day window, max 500/page, vehicleDirectionType 1=EXIT/2=ENTRY |
| `visitors` | `POST /artemis/api/visitor/v1/appointment/appointmentlist` | `hcp_live_visitors` (normalized `visitors`) | appKey/appSecret | visitorId → source_id |
| `face-events` | *(not implemented)* | — | — | Biometric images/templates NEVER retrieved or stored |

**Normalization base fields (all records):**
- `compound_id`, `source_system: 'hcp-live'`, `hcp_version`, `openapi_version`, `adapter_id`, `adapter_version: 'hcp-normalized/1.0.0'`, `source_entity`, `source_id`, `event_time`, `retrieved_at`, `provenance: 'live-hcp'`, `data` (JSON blob of raw mapped fields)

---

## 11. Security & Limitations

### Known Limitations (from HCP_INTEGRATION.md §10)
1. No official HCP/OpenAPI docs checked into project (`docs/hcp/` absent) → live auth/fetch blocked by design, not a bug
2. No VPN tunnel management from backend (adapter interface + docs only)
3. No authN/Z layer (pre-existing gap) — restrict network access to admins
4. `tls_verify=0` available per compound but discouraged and flagged
5. Face images/templates never retrieved (analytics use event metadata only)

### TLS / Transport Security
- All real HTTPS API traffic uses per-compound TLS agent with verification ON by default (`netcheck.httpsGet`, Node built-in `https`)
- Per-compound approved CA pinned, hostname/IP checks enabled
- `verify=false` is fail-closed (refused before any socket opens)
- `rejectUnauthorized:false` used **only** by handshake-only `tlsInspect()` diagnostic, never for API requests
- Current cert for `192.168.15.15` has CN=127.0.0.1 (SAN mismatch) — IT must reissue or approved CA PEM must be pinned in Configuration → Custom CA

### Credential Security
- AES-256-GCM encryption; key from `HCP_VAULT_KEY` (64 hex chars)
- Keys live outside DB/web root, never logged/committed
- `app_secret_enc` / `vpn_password_enc` always return `***set***` in responses
- Blank secret fields preserve stored value

---

## 12. Environment Variables

| Variable | Purpose | Default / Example |
|---|---|---|
| `HCP_VAULT_KEY` | 64-hex AES-256-GCM key (REQUIRED for secrets) | unset → fail-secure; generate: `crypto.randomBytes(32).toString('hex')` |
| `PORT` | Backend port | `2020` |
| `DATABASE_URL` | PostgreSQL connection string (required) | `postgresql://user:password@server.postgres.database.azure.com:5432/db?sslmode=require` |
| `PGSSLMODE` | PostgreSQL TLS mode | `require` |
| `FORTICLIENT_ENABLED` | Enable VPN control | (unset = disabled) |
| `FORTICLIENT_CLI` | Full path to `forticli.exe` | `C:\Program Files\Fortinet\FortiClient\forticli.exe` |
| `FORTICLIENT_TUNNEL` | Tunnel/profile name to connect | `PHNC-Tunnel` |
| `HCP_HEALTHCHECK_MS` | Health check interval ms (0 disables) | `300000` (5 min) |

---

## 13. Errors & Status Codes

| Code | Meaning |
|---|---|
| `200` | Successful GET |
| `202` | Async job started (`POST /test`, `POST /sync`, `POST /process`) |
| `204` | CORS preflight OPTIONS |
| `400` | Validation error (missing confirm, invalid config, sync blocked) |
| `404` | Not found (compound, run, sync) |
| `503` | Vault unavailable / missing `HCP_VAULT_KEY` |
| `blocked` | Sync/test stage blocked (reasons: no adapter, unverified adapter, missing credentials, missing cameraIndexCode, VPN not connected, TLS verification disabled) |
| `failed` | Auth/test run failed with actionable message |

**Blocked fetch policy:** A blocked fetch is NEVER recorded as a successful zero-record sync. Blocked runs are marked `blocked` with reasons; `last_sync_at` updates only when records were actually retrieved. Historical data is never touched by failed/blocked syncs.

---

## Appendix: Full Dashboard REST API Reference (`/api`)

For completeness, the broader dashboard API (mounting at `/api`, non-HCP) includes:

**Periods & Dashboard:**
- `GET /api/health` — `{ ok: true, version: '1.0.0' }`
- `GET /api/periods` — reporting periods
- `GET /api/compounds` — compound list
- `GET /api/kpi-definitions` — KPI definitions
- `GET /api/dashboard` — aggregated dashboard
- `GET /api/compare` — compound comparison
- `GET /api/trends` — trend metrics

**Master Data:**
- `GET /api/units`, `GET /api/units/:id`
- `GET /api/users`, `GET /api/users/:id`
- `GET /api/vehicles`, `GET /api/vehicles/:id`
- `GET /api/gatepasses`, `GET /api/invitations`, `GET /api/access`
- `GET /api/access/hourly`, `GET /api/access/heatmap`
- `GET /api/quality`, `GET /api/matching`, `POST /api/matching`
- `GET /api/insights`, `POST /api/ai/ask`

**Import Engine (Phase 2 monthly ZIP):**
- `POST /api/uploads` — stage upload
- `GET /api/imports`, `GET /api/imports/:id`, `GET /api/imports/:id/summary`
- `GET /api/imports/:id/log`, `GET /api/imports/:id/duplicates`, `GET /api/imports/:id/changes`
- `POST /api/imports/:id/process`, `POST /api/imports/:id/reprocess`, `POST /api/imports/:id/cancel`
- `POST /api/imports/:id/rollback` (`{ confirm: true }`)
- `POST /api/periods/:period/delete` (`{ confirm: true, period: "<YYYY-MM>" }`)
- `POST /api/admin/reset` (`{ confirm: true, phrase: "RESET ALL DATA" }`)

**Snapshots, Settings, Audit, Export:**
- `GET /api/snapshots`, `GET /api/snapshots/:period`
- `GET /api/settings`, `PUT /api/settings`
- `GET /api/audit`
- `GET /api/export`, `GET /api/report.xlsx`

---

*End of specification. For operational details (credential encryption, compound configuration, VPN prerequisites, IT requirements), see `HCP_INTEGRATION.md`. For the September 2026 reference dataset results, see `README.md`.*
