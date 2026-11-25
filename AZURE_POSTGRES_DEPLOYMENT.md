# Azure PostgreSQL deployment

This copy of the dashboard targets **Azure Database for PostgreSQL**. No PostgreSQL
server is installed locally: the Node process opens a remote `pg` pool using
`DATABASE_URL`.

## What changed

- `backend/db.js` keeps the original synchronous API
  (`db.prepare(sql).get/all/run()`, `db.exec()`, `db.transaction()`) so the 500+
  existing call sites did not need to become `async`. Queries are dispatched to
  `backend/pg-worker.js`, which owns a single-client `pg` pool.
- `backend/pg-dialect.js` translates SQLite-flavoured SQL (`?` placeholders,
  `AUTOINCREMENT`, `IFNULL`, `GROUP_CONCAT`, `datetime('now')`, `INSERT OR IGNORE`)
  into PostgreSQL.
- Schema/migrations, HCP migrations, ingest upserts, AI schema introspection,
  quality checks, inventory and backup scripts are PostgreSQL-compatible.

## Required environment

Set these in Azure App Service → **Configuration → Application settings**
(and in local `.env` for development):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://<user>:<password>@<server>.postgres.database.azure.com:5432/<database>?sslmode=require` |
| `PGSSLMODE` | `require` (or `verify-full` when you provide CA trust) |
| `HCP_VAULT_KEY` | Existing 64-hex AES-256-GCM key; changing it orphans stored HCP secrets |
| `WEBSITES_PORT` | `2020` for Linux App Service containers |

Optional tuning:

| Variable | Default | Purpose |
|---|---|---|
| `DB_RPC_BUFFER_MB` | `64` | Shared-memory buffer for one SQL request/response |
| `DB_QUERY_TIMEOUT_MS` | `120000` | Maximum synchronous wait for one query |

Individual `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` variables
are also accepted when `DATABASE_URL` is not set. `DB_PATH` is no longer used.

`npm start` and `start.bat` load `.env` with `--env-file-if-exists=.env`; Azure
App Service settings take precedence over file values.

> Do not commit real credentials. Keep `DATABASE_URL` in App Service settings or
> Key Vault, not in source control.

## First deployment / schema bootstrap

Requires Node.js 22.9+ (for `--env-file-if-exists`); Node 24 LTS is recommended.

```bash
npm install
npm run build
node -e "require('./backend/db').migrate()"
npm start
```

`migrate()` is idempotent: it creates tables/indexes, adds missing columns,
seeds `settings`, runs HCP migrations and performs canonical-resident cleanup.
It must be able to connect to the PostgreSQL server.

On Windows PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://user:password@server.postgres.database.azure.com:5432/palm_hills?sslmode=require"
$env:PGSSLMODE = "require"
npm run build
node -e "require('./backend/db').migrate()"
npm start
```

## Filesystem note

The database is now remote, but the app still writes uploaded ZIPs, extracted
files and generated reports under `data/`. On App Service that filesystem is
ephemeral; mount persistent storage if those artifacts must survive restarts.
`data/backups/` is only for logical JSON dumps produced by `scripts/backup-db.js`.

## Tests

The test suite requires a disposable PostgreSQL database. `npm test` sets
`NODE_ENV=test` and `backend/db.js` refuses to run unless `TEST_DATABASE_URL`
points at an isolated database (override only with
`ALLOW_TESTS_ON_DATABASE_URL=1`). The runner creates short-lived databases for
each test file from an empty-schema template and a legacy-data template, so
the login must be allowed to `CREATE DATABASE` / `DROP DATABASE` on that
server; tests never write to `DATABASE_URL`:

```bash
# Azure test server
$env:TEST_DATABASE_URL = "postgresql://user:password@test-server.postgres.database.azure.com:5432/dashboard_tests?sslmode=require"
npm test

# Local PostgreSQL used during the conversion check
$env:TEST_DATABASE_URL = "postgresql://postgres:<local-password>@127.0.0.1:5432/palm_hills_test?sslmode=disable"
npm test
```

## Backup

Application-level logical backup (no `pg_dump` binary required):

```bash
node scripts/backup-db.js data/backups/manual.json
```

For production, also enable Azure Database for PostgreSQL automated backups /
geo-redundancy. The JSON dump is a convenience export, not a replacement for
point-in-time restore.

## Existing SQLite data

Deploying the code with an empty PostgreSQL database starts with no uploaded
periods. To preserve the historical `data/app.db`, run the one-time logical
migration against the same `DATABASE_URL`:

```bash
node scripts/migrate-sqlite-to-postgres.js --dry-run
node scripts/migrate-sqlite-to-postgres.js
```

Set `SQLITE_SOURCE` if the legacy file is not at `data/app.db`. The script
creates the PostgreSQL schema first, inserts tables in foreign-key order,
preserves explicit IDs, restores self-references and resets identity sequences.
It is additive by default; `--truncate` deletes all migrated target rows first
and must be used deliberately. After the import, re-run `npm run build` and
`npm start`. Keep the SQLite file read-only after cutover and do not mix the two
stores.
