# HCP Sync Agent — Standalone HCP → Cloud Database Sync

Standalone Node.js agent that pulls records from **Hikvision HikCentral Professional** (HCP) via the OpenAPI/Artemis interface and upserts them into a **cloud PostgreSQL database**. Built from the API specifications in `HCP_API_SPECS.md` (parent dashboard project).

## What it does

1. **Authenticates** to HCP using AK/SK digest signature (HMAC-SHA256) per the Hikvision OpenAPI Developer Guide V3.1.1.
2. **Discovers** the HCP platform version via `POST /artemis/api/common/v1/version`.
3. **Fetches** records page-by-page from read-only OpenAPI endpoints:
   - `POST /artemis/api/pms/v1/crossRecords/page` — vehicle access events
   - `POST /artemis/api/resource/v1/person/personList` — persons
   - `POST /artemis/api/visitor/v1/appointment/appointmentlist` — visitors
4. **Normalizes** records into a canonical schema (provenance `live-hcp`).
5. **Upserts** into PostgreSQL keyed on `(compound_id, source_entity, source_id)` — idempotent, no duplicates.
6. **Tracks** sync runs and per-category cursors for incremental resume.

## Project layout

```
hcp-sync-agent/
├── package.json
├── .env.example          # copy to .env and fill in secrets
├── .gitignore
├── README.md
├── src/
│   ├── index.js          # entry point (scheduler / --once)
│   ├── config.js         # env loading + validation
│   ├── logger.js         # structured logger (text|json)
│   ├── auth.js           # AK/SK signature builder
│   ├── hcp-client.js     # HCP OpenAPI HTTP client (TLS, signed POST)
│   ├── db.js             # PostgreSQL schema + upsert + cursors
│   ├── normalizer.js     # HCP response → canonical schema
│   └── sync.js           # sync orchestrator + scheduler
```

## Prerequisites

- **Node.js 22+** (tested on v24.21.0)
- **PostgreSQL** database (cloud or self-hosted) with `pg` connectivity
- **HCP OpenAPI credentials** (app key + secret) with read-only API scope
- **Camera index code** (required for vehicle access events via `crossRecords/page`)
- Network reachability from the agent host to `HCP_HOST:HCP_PORT` (typically 443 HTTPS)

## Quick start

```bash
# 1. Copy env template and fill in your values
cp .env.example .env
# edit .env with your HCP host, credentials, and DATABASE_URL

# 2. Install dependencies
npm install

# 3. Run a single sync
node src/index.js --once

# 4. Run as a continuous scheduler (syncs every SYNC_INTERVAL_MS)
node src/index.js
```

### Example `.env`

```
HCP_HOST=192.168.15.15
HCP_PORT=443
HCP_HTTPS=1
HCP_TLS_VERIFY=1
HCP_TLS_CA=
HCP_READ_TIMEOUT_MS=15000
HCP_APP_KEY=your_app_key
HCP_APP_SECRET=your_app_secret
HCP_CAMERA_INDEX_CODE=1
HCP_SYNC_LOOKBACK_DAYS=30
DATABASE_URL=postgresql://syncuser:syncpass@cloud-db.example.com:5432/hcp_sync
SYNC_INTERVAL_MS=300000
SYNC_ENABLED_CATEGORIES=persons,vehicles,access-events,visitors
LOG_LEVEL=info
LOG_FORMAT=text
```

> ⚠️ **Security:** `.env` contains plaintext secrets. Restrict file permissions (`chmod 600 .env`) and never commit it. In production, inject secrets via your platform's secret manager instead of a `.env` file.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `HCP_HOST` | HCP server hostname/IP | (required) |
| `HCP_PORT` | HCP API port | `443` |
| `HCP_HTTPS` | Use HTTPS | `1` |
| `HCP_TLS_VERIFY` | Enable TLS certificate verification | `1` |
| `HCP_TLS_CA` | Pinned CA certificate (PEM) | (unset) |
| `HCP_READ_TIMEOUT_MS` | HTTP read timeout | `15000` |
| `HCP_APP_KEY` | OpenAPI application key | (required) |
| `HCP_APP_SECRET` | OpenAPI application secret | (required) |
| `HCP_CAMERA_INDEX_CODE` | Camera index for vehicle events | (required for vehicles) |
| `HCP_SYNC_LOOKBACK_DAYS` | Days to look back per sync | `30` |
| `DATABASE_URL` | PostgreSQL connection string | (required) |
| `SYNC_INTERVAL_MS` | Scheduler interval (0 = manual only) | `300000` |
| `SYNC_ENABLED_CATEGORIES` | Comma-separated categories | `persons,vehicles,access-events,visitors` |
| `LOG_LEVEL` | `error\|warn\|info\|debug` | `info` |
| `LOG_FORMAT` | `text\|json` | `text` |

## Data model

Synced records live in `hcp_live_records`:

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL | PK |
| `compound_id` | TEXT | Compound identifier |
| `source_system` | TEXT | Always `hcp-live` |
| `hcp_version` | TEXT | HCP platform version |
| `openapi_version` | TEXT | OpenAPI version |
| `adapter_id` | TEXT | `hcp-artemis-v26` |
| `adapter_version` | TEXT | `hcp-normalized/1.0.0` |
| `source_entity` | TEXT | `persons\|vehicles\|access-events\|visitors` |
| `source_id` | TEXT | HCP native ID |
| `event_time` | TIMESTAMPTZ | Event timestamp |
| `retrieved_at` | TIMESTAMPTZ | When fetched |
| `provenance` | TEXT | Always `live-hcp` |
| `data` | JSONB | Raw mapped fields |
| `created_at` / `updated_at` | TIMESTAMPTZ | Row timestamps |

Unique constraint: `(compound_id, source_entity, source_id)` — re-syncing updates in place.

Supporting tables:
- `hcp_sync_runs` — per-run status, counts, errors
- `hcp_sync_cursors` — per-category incremental cursor
- `hcp_sync_audit` — action log

## Synchronization behaviour

- **Idempotent:** Re-syncing the same HCP records updates existing rows; no duplicates.
- **Fail-closed:** If auth, TLS, or a category is blocked, the run is marked `blocked`/`failed` — never recorded as a successful zero-record sync.
- **Incremental:** Cursors are stored per `(compound_id, category)` for resume (Phase 2 schema; currently full-window refetch).
- **Read-only to HCP:** The agent only performs `POST` reads. No door-control, write, or biometric operations.
- **No biometric data:** Face images/templates are never extracted or stored.

## Docker (optional)

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY src ./src
COPY .env .env
CMD ["node", "src/index.js"]
```

## Relationship to the parent dashboard

This agent mirrors the normalization and endpoint set used by the main Palm Hills dashboard (`backend/hcp/adapters/artemis-v26.js`, `HCP_API_SPECS.md`). It can run independently to feed a cloud data warehouse, while the dashboard continues to use its local SQLite database for uploaded monthly files.

## License

Internal use — Palm Hills Community Operations Intelligence Platform.
