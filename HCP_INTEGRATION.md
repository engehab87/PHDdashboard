# Compound Connectivity & HCP Integration — operations guide

> Stack note: the project is **Node.js + Express + SQLite** (`backend/`, `node:sqlite`),
> not PHP. This feature was implemented on the existing stack per the
> preserve-conventions rule. All paths below are relative to the project root.

## 1. Architecture discovered (summary)

- Backend: Node 22+ (`24.21.0` observed), Express 4, Multer, SheetJS; DB `data/app.db`
  via `backend/db.js` (`migrate()` idempotent + `ensureCol` guards).
- Reused, not duplicated: `compounds` table (id/name/code/active). New tables are
  additive (`compound_integrations`, `compound_network`, `compound_hcp`,
  `compound_credentials`, `hcp_adapter_registry`, `hcp_test_runs`,
  `hcp_test_stages`, `hcp_sync_runs`, `hcp_capabilities`, `hcp_live_persons`,
  `hcp_live_vehicles`, `hcp_live_events`). Rollback: drop only the `compound_*`
  / `hcp_*` tables — existing tables untouched.
- No login/roles exist (trusted intranet, SRS §3). Sensitive HCP endpoints
  audit-log and never return secrets; add real authN/Z before internet exposure.
- No official Hikvision HCP/OpenAPI spec exists in the project (`docs/hcp/`
  absent). No VPN env vars set. Localhost cannot reach Palm Hills internal HCP
  servers from here (no route) — connection tests report this honestly.

## 2. Files created / modified

- Created: `backend/hcp/crypto.js`, `registry.js`, `netcheck.js`, `store.js`,
  `routes.js`, `adapters/base.js`, `adapters/generic.js`,
  `adapters/artemis-v26.js`, `vpn.js`, `health.js`,
  `tests/hcp.test.js`, `tests/hcp-tls.test.js`, `tests/hcp-phase1.test.js`,
  `tests/hcp-vpn.test.js`, `tests/hcp-artemis-v26.test.js`,
  `HCP_INTEGRATION.md` (this file).
- Modified: `backend/db.js` (calls `migrateHcp`), `backend/server.js` (mounts
  `/api/hcp`, starts health scheduler), `frontend/app.js` (nav entry),
  `frontend/app-pages.js` (`#/hcp` list + detail pages + live summary),
  `package.json` (test script).

## 3. Credential encryption

- AES-256-GCM (`backend/hcp/crypto.js`), key from env `HCP_VAULT_KEY` (64 hex
  chars = 32 bytes). Keys live outside DB/web root, never logged/committed.
- Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Local dev (PowerShell): `$env:HCP_VAULT_KEY="<64-hex>"; node server.js`
- Production: set via the approved secret manager / service env.
- Missing/invalid key → `503` with setup instructions; secrets never stored
  plaintext. Blank secret fields on edit preserve the stored value.
  `app_key` is displayable; `app_secret_enc`/`vpn_password_enc` always return
  `***set***`. Changing `HCP_VAULT_KEY` orphans old secrets → re-enter them.

## 4. Configure the first compound

1. Start backend with `HCP_VAULT_KEY` set. Open `#/hcp` → **Add compound**.
2. General: set mode (`corporate-vpn` if the backend host is already on VPN),
   check **Integration enabled** only after tests pass (stays disabled by default).
3. Network: host/port/protocol/credentials as provided by IT. Note: the app
   never dials VPN itself — establish dedicated tunnels in the approved client.
4. HCP: internal host, port (443), HTTPS on, platform version + OpenAPI version
   as **manual (administrator-confirmed)** until documented auto-discovery lands.
5. Credentials: paste app key + secret (secret masked, stored encrypted).
6. **Test Connection** → watch the 9 live stages. Network stages (DNS/TCP/TLS)
   verify the real route; API stages run the documented `version` discovery call
   and report the actual result (still blocked for sync until a verified
   adapter exists).
7. (Optional) Camera index code: if your HCP uses `crossRecords/page` for
   vehicle events, enter the camera index code in the HCP Server section — it
   is a required parameter for that endpoint.
8. **Synchronize now** stays blocked until a verified adapter exists; failed
   syncs never delete history.

## 5. Environment variables / deployment

| Var | Purpose | Default |
|---|---|---|
| `HCP_VAULT_KEY` | 64-hex vault key (REQUIRED for secrets) | unset → fail-secure |
| `PORT` | backend port | 2020 |
| `DB_PATH` | sqlite file | `data/app.db` |

## 6. VPN / network prerequisites (for Palm Hills IT)

- If the dashboard host joins the existing corporate VPN, confirm the backend
  process can route to each HCP host:port (firewall allow + DNS). No per-compound
  tunnel needed in that case (mode `corporate-vpn`).
- If separate tunnels are required: provide the approved client/gateway,
  protocol (OpenVPN/IPsec/WireGuard/connector), certificates, routes, and
  credentials per compound. The app verifies reachability; it does not manage
  tunnels or execute OS commands.
- Provide per compound: HCP internal host/IP, API port, HTTPS + CA chain,
  HCP platform version + build, OpenAPI version + build, camera index code
  (required for `crossRecords/page` vehicle events), authorized application
  key/secret, and the read-only permission scope granted.

## 7. Official documentation used / supported versions

- **Hikvision HikCentral Professional OpenAPI Developer Guide V3.1.1**
  (https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html).
  `GET /api/hcp/registry` lists two entries:
  1. `hcp-openapi-v1-generic` (RETIRED — matches nothing; former unverified
     2.x/1.x claim withdrawn).
  2. `hcp-artemis-v26` (HCP 2.6.0 / OpenAPI 2.6, `verified: false` — pending
     live server verification).
- `docs/hcp/` is absent — no official spec file is checked into the project.
  To unblock live API: drop the official Hikvision *HikCentral Professional
  OpenAPI Guide* (matching the installed HCP build) into `docs/hcp/`, then mark
  the adapter `verified: true`.
- Until then: network/TLS diagnostics are real; auth/permission/sample-read
  stages report `blocked pending-adapter`. Mock-test passes are labelled
  simulated.

## 8. API endpoints added (all under `/api/hcp`)

`GET /compounds` · `POST /compounds` · `GET /compounds/:id` ·
`PUT /compounds/:id` · `POST /compounds/:id/test` (202, async) ·
`GET /runs/:runId` (poll stages) · `GET /compounds/:id/history` ·
`GET /compounds/:id/capabilities` · `POST /compounds/:id/sync` (202, blocked
until verified adapter) · `GET /sync/:runId` ·
`GET /compounds/:id/live/:category` (persons|vehicles|events, provenance-labelled)
· `GET /compounds/:id/live-summary` (dashboard summary: connectivity, counts,
last sync) · `GET /compounds/:id/connectivity` (state + checks + gate) ·
`POST /compounds/:id/check` (on-demand health observation) ·
`GET /vpn/status` · `POST /vpn/connect` (requires `{ "confirm": true }`) ·
`GET /registry`.

## 9. Data-source labelling

Dashboard data keeps its origin: **uploaded files** (monthly ZIP engine,
unchanged), **live HCP (cached)** (`hcp_live_*` tables, `provenance='live-hcp'`),
**historical snapshots** (`period_snapshots`, never overwritten by syncs),
**sample** (only in tests/docs, never in the UI as live).

## 10. Known limitations / blockers

1. No official HCP/OpenAPI docs → live auth/fetch blocked (by design, not a bug).
2. No VPN tunnel management from the backend (adapter interface + docs only).
3. No authN/Z layer (pre-existing gap) — restrict network access to admins.
4. `tls_verify=0` is available per compound but discouraged and flagged.
5. Face images/templates are never retrieved (analytics use event metadata only).

## 12. Approved hardening changes (16-Oct-2026, diagnostic review)
- `PUT /api/hcp/compounds/:id` validates HCP settings via
  `validateHcpConfig()` (`backend/hcp/store.js`) and returns `warnings`
  (e.g. `HTTPS_DISABLED_ON_443`, `TLS_VERIFY_DISABLED`, `TLS_CA_INVALID`).
  Settings are preserved exactly as entered — never silently rewritten.
- All real HTTPS API traffic uses per-compound TLS agent with verification ON
  by default (`backend/hcp/netcheck.js`, Node built-in `https`). Per-compound
  approved CA pinned, hostname/IP checks enabled. `verify=false` is fail-closed
  (refused before any socket opens). `rejectUnauthorized:false` is used only by
  the handshake-only `tlsInspect()` diagnostic, never for API requests.
- Tests: `tests/hcp-tls.test.js` (11 tests) + `tests/hcp-artemis-v26.test.js`
  (14 tests).

## 13. Phase 1 — independent connectivity layer (17-Oct-2026)
- New additive tables: `compound_connectivity` (link_ref, conn_state
  up/degraded/down/unknown, last_check_at, last_up_at, fail_count,
  backoff_until, intervals), `connectivity_checks` (pruned to 200/compound),
  `hcp_sync_cursors` (schema for Phase 2 incremental resume).
- `backend/hcp/health.js` (new): `nextConnState` transitions with exponential
  backoff (60s→30min cap), `checkConnectivity` (DNS+TCP+TLS handshake only),
  `startHealthScheduler` (env `HCP_HEALTHCHECK_MS`, default 5 min), fail-closed
  `syncGate` (blocks on disabled/unknown/down/degraded connectivity,
  missing/unverified adapter, missing/undecryptable auth).
- Diagnostics are exactly nine stages: vpn-state, route-tcp, tls,
  service-reach, version-identify (blocked — documented
  `POST /artemis/api/common/v1/version` reserved for Phase 3), adapter-compat
  (exact match, no fallback), auth (presence+decryptability only), readonly-op
  (blocked), sync-state (gate verdict).
- Registry hardened: retired generic template matches nothing; selection is
  exact equality after `V`-prefix normalization.
- Blocked fetches record `blocked` runs with reasons — never `completed`
  with zeros; `last_sync_at` updates only when records were retrieved.
- Tests: `tests/hcp-phase1.test.js` (16 tests).

## 14. Phase 2 — FortiClient VPN connectivity (17-Oct-2026)
- New file: `backend/hcp/vpn.js` — FortiClient VPN provider abstraction,
  separate from HCP API code. Uses `child_process.execFile` with a fixed
  executable path and fixed argument arrays — never shell command strings,
  never HTTP-supplied arguments. Configuration from environment variables only:
  `FORTICLIENT_CLI`, `FORTICLIENT_TUNNEL`, `FORTICLIENT_ENABLED`. Disabled by
  default — no tunnel is ever created or dialed by this backend.
- Provider methods: `getStatus()` (CLI `-vpnstatus`), `connect()`
  (`-vpnconnect <tunnel>`, concurrency-protected), `checkRouteAndReachability()`
  (DNS + TCP), `getHealth()` (VPN + route/TCP + TLS handshake).
- Additive migration: `compound_connectivity.vpn_state`, `vpn_tunnel`,
  `vpn_last_check` columns (guarded with `ensureCol`, live-DB safe).
- `syncGate` gains `VPN_NOT_CONNECTED` reason when `FORTICLIENT_ENABLED=true`
  and tunnel is not connected.
- New endpoints: `GET /api/hcp/vpn/status`, `POST /api/hcp/vpn/connect`
  (audit-logged; `connect` requires `{ "confirm": true }`). Deployment MUST add
  real authN/Z in front. No credentials accepted from browser requests.
- TLS: verification always enabled. No bypasses.
- Tests: `tests/hcp-vpn.test.js` (14 tests, mocked CLI + network, hermetic).

## 15. Phase 3 — Hikvision Artemis OpenAPI adapter (HCP 2.6.0 / OpenAPI 2.6) (17-Oct-2026)
- New file: `backend/hcp/adapters/artemis-v26.js` — implements the Artemis
  OpenAPI adapter strictly from the official Hikvision HikCentral Professional
  OpenAPI Developer Guide V3.1.1
  (https://enpinfo.hikvision.com/hkwsen/unzip/20260723200832_95640_doc/index.html).
- Authentication: AK/SK digest per guide's "Signature and Authentication":
  HMAC-SHA256(appSecret, signatureString) base64; headers
  X-Ca-Key/X-Ca-Signature/X-Ca-Signature-Headers/X-Ca-Timestamp/X-Ca-Nonce.
  Signature string = METHOD + "\n" + Accept + "\n" + Content-MD5 + "\n" +
  Content-Type + "\n" + Date + "\n" + sorted headers + Uri.
- Read-only endpoints implemented:
  - POST /artemis/api/common/v1/version (version discovery / auth test)
  - POST /artemis/api/pms/v1/crossRecords/page (vehicle access events,
    paginated, 31-day window, max 500/page)
  - POST /artemis/api/resource/v1/person/personList (persons)
  - POST /artemis/api/visitor/v1/appointment/appointmentlist (visitors)
- Registry entry `hcp-artemis-v26`: hcpVersions ['2.6.0'],
  openapiVersions ['2.6'], verified:false (pending live server verification).
- Routes updated: `auth` stage and `doSync` use the resolved adapter class
  dynamically via `ADAPTER_CLASSES` map — no hardcoded GenericAdapter.
- TLS: verification always enabled via per-compound `https.Agent` with optional
  pinned CA. `rejectUnauthorized:false` never used on API requests.
- Biometric images/templates are NEVER retrieved or stored.
- Tests: `tests/hcp-artemis-v26.test.js` (14 tests, hermetic, mocked).
- Full suite: 99/100 passing. The single failure is pre-existing
  (`kpi.test.js` quality report case-sensitivity, SRS §16), unrelated to this
  change.

### Environment variables (all phases)

| Variable | Purpose | Example |
|---|---|---|
| `HCP_VAULT_KEY` | 64-hex AES-256-GCM key (required) | (64 hex chars) |
| `FORTICLIENT_ENABLED` | Enable VPN control ('true' to activate) | `true` |
| `FORTICLIENT_CLI` | Full path to forticli.exe | `C:\Program Files\Fortinet\FortiClient\forticli.exe` |
| `FORTICLIENT_TUNNEL` | Tunnel/profile name to connect | `PHNC-Tunnel` |
| `HCP_HEALTHCHECK_MS` | Health check interval ms (0 disables) | `300000` |

### IT prerequisites

1. FortiClient edition/version installed on the backend host with CLI
   (`forticli.exe`) available — verify CLI syntax (`-vpnstatus`,
   `-vpnconnect <tunnel>`) against the installed edition before enabling.
2. FortiClient service identity / tunnel profile pre-configured by IT with
   route to `192.168.15.15:443` — the backend does not create or modify
   tunnels, routes, or firewall rules.
3. SAN-correct server certificate for `192.168.15.15` (current cert has
   CN=127.0.0.1 which does not match the IP) — IT must reissue or the
   approved CA PEM must be pinned in Configuration → Custom CA.
4. Hikvision partner APPkey/APPsecret per compound with read-only API
   allowlist — stored encrypted via `HCP_VAULT_KEY`, never logged.
5. HCP build numbers (`hcp_build`, `openapi_build`) — currently NULL, to be
   confirmed against the installed release.
6. Restrict network access to the backend until real authN/Z is added
   (app currently has no login layer, trusted intranet only).
7. Official Hikvision OpenAPI guide for the installed HCP build — checked into
   `docs/hcp/` before any adapter is marked `verified`. No endpoints are
   implemented without documentation.


